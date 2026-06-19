const { Markup } = require('telegraf');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const Account = require('../models/Account');
const { getSession, setSession, clearSession, updateSession } = require('../utils/session');
const { toUSD, fmt, updateAccountBalance } = require('../utils/helpers');

const CANCEL_BTN = Markup.button.callback('❌ Cancelar', 'pp:x');

async function startPagoPrestamo(ctx) {
  clearSession(ctx.chat.id);
  const loans = await Loan.find({ status: 'active' });
  if (loans.length === 0) return ctx.reply('✅ No hay préstamos activos pendientes.');
  setSession(ctx.chat.id, { command: 'pagoPrestamo', step: 'selectLoan', data: {} });
  const { nohelia, antonio } = ctx.users;
  const buttons = loans.map(loan => {
    const lender = loan.direction === 'himToHer' ? nohelia.name : antonio.name;
    const borrower = loan.direction === 'himToHer' ? antonio.name : nohelia.name;
    const label = `${lender} → ${borrower}: $${fmt(loan.remainingAmountUSD)}`;
    return [Markup.button.callback(label, `pp:ln:${loan._id}`)];
  });
  buttons.push([CANCEL_BTN]);
  await ctx.reply('💳 *¿Qué préstamo se paga?*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askFromAccount(ctx, payer) {
  const accounts = await Account.find({ owner: payer._id, isActive: true });
  updateSession(ctx.chat.id, { step: 'selectFrom' });
  const buttons = accounts.map(a => [Markup.button.callback(`${a.name} ($${fmt(a.balance)})`, `pp:frm:${a._id}`)]);
  buttons.push([CANCEL_BTN]);
  await ctx.reply(`📤 *¿De qué cuenta de ${payer.name}?*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askToAccount(ctx, receiver) {
  const accounts = await Account.find({ owner: receiver._id, isActive: true });
  updateSession(ctx.chat.id, { step: 'selectTo' });
  const buttons = accounts.map(a => [Markup.button.callback(`${a.name} ($${fmt(a.balance)})`, `pp:to:${a._id}`)]);
  buttons.push([CANCEL_BTN]);
  await ctx.reply(`📥 *¿A qué cuenta de ${receiver.name}?*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askNote(ctx) {
  updateSession(ctx.chat.id, { step: 'enterNote' });
  await ctx.reply('📝 *¿Nota?*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⏭️ Omitir', 'pp:nte:sk'), CANCEL_BTN]]),
  });
}

async function askConfirm(ctx) {
  const { data } = getSession(ctx.chat.id);
  const loan = await Loan.findById(data.loanId);
  const from = await Account.findById(data.fromId);
  const to = await Account.findById(data.toId);
  const newRemaining = Math.max(0, loan.remainingAmountUSD - data.amountUSD);
  const lines = [
    `💵 *Monto:* ${fmt(data.amount)} ${data.currency}${data.currency !== 'USD' ? ` → $${fmt(data.amountUSD)} USD` : ''}`,
    `📤 *Desde:* ${from.name}`,
    `📥 *Hacia:* ${to.name}`,
    `📊 *Saldo restante:* $${fmt(newRemaining)} USD`,
  ];
  if (data.note) lines.push(`📝 *Nota:* ${data.note}`);
  updateSession(ctx.chat.id, { step: 'confirm' });
  await ctx.reply(
    `*Resumen del pago:*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Confirmar', 'pp:ok'), CANCEL_BTN]]) }
  );
}

function register(bot) {
  bot.command('pagoprestamo', startPagoPrestamo);
  bot.action(/^mn:pp$/, async (ctx) => { await ctx.answerCbQuery(); await startPagoPrestamo(ctx); });

  bot.action(/^pp:/, async (ctx) => {
    await ctx.answerCbQuery();
    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const value = parts.slice(2).join(':');
    const session = getSession(ctx.chat.id);
    if (!session || session.command !== 'pagoPrestamo') return;

    if (action === 'x') { clearSession(ctx.chat.id); return ctx.reply('❌ Flujo cancelado.'); }

    if (action === 'ln') {
      const loan = await Loan.findById(value);
      // himToHer: Nohelia lent to Antonio → Antonio is borrower → Antonio pays
      const payerId = loan.direction === 'himToHer' ? ctx.users.antonio._id : ctx.users.nohelia._id;
      const receiverId = loan.direction === 'himToHer' ? ctx.users.nohelia._id : ctx.users.antonio._id;
      updateSession(ctx.chat.id, {
        data: { loanId: loan._id, payerId, receiverId },
        step: 'enterAmount',
      });
      await ctx.reply('💵 *¿Cuánto abona?* Escribe el monto:', { parse_mode: 'Markdown' });
      return;
    }

    if (action === 'cur') {
      const s = getSession(ctx.chat.id);
      if (value === 'usd') {
        updateSession(ctx.chat.id, { data: { ...s.data, currency: 'USD', exchangeRate: 1, amountUSD: s.data.amount } });
        const payer = s.data.payerId.equals(ctx.users.nohelia._id) ? ctx.users.nohelia : ctx.users.antonio;
        await askFromAccount(ctx, payer);
      } else {
        updateSession(ctx.chat.id, { step: 'enterRate', data: { ...s.data, currency: 'MXN' } });
        await ctx.reply('🔢 *¿Tasa de cambio?*\n_¿Cuántos MXN equivalen a 1 USD?_', { parse_mode: 'Markdown' });
      }
      return;
    }

    if (action === 'frm') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, fromId: value } });
      const s = getSession(ctx.chat.id);
      const receiver = s.data.receiverId.equals(ctx.users.nohelia._id) ? ctx.users.nohelia : ctx.users.antonio;
      await askToAccount(ctx, receiver);
      return;
    }

    if (action === 'to') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, toId: value } });
      await askNote(ctx);
      return;
    }

    if (action === 'nte' && value === 'sk') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, note: null } });
      await askConfirm(ctx);
      return;
    }

    if (action === 'ok') {
      const { data } = getSession(ctx.chat.id);
      const loan = await Loan.findById(data.loanId);
      await LoanPayment.create({
        loan: data.loanId,
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        amountUSD: data.amountUSD,
        fromAccount: data.fromId,
        toAccount: data.toId,
        note: data.note || null,
      });
      const newRemainingUSD = Math.max(0, loan.remainingAmountUSD - data.amountUSD);
      const newRemainingAmt = Math.max(0, loan.remainingAmount - data.amount);
      await Loan.findByIdAndUpdate(data.loanId, {
        remainingAmount: newRemainingAmt,
        remainingAmountUSD: newRemainingUSD,
        status: newRemainingUSD < 0.01 ? 'settled' : 'active',
      });
      await updateAccountBalance(data.fromId, -data.amountUSD);
      await updateAccountBalance(data.toId, data.amountUSD);
      clearSession(ctx.chat.id);
      const settled = newRemainingUSD < 0.01;
      await ctx.reply(
        settled
          ? '✅ *Préstamo pagado completamente.* 🎉'
          : `✅ *Pago registrado.* Saldo restante: $${fmt(newRemainingUSD)} USD`,
        { parse_mode: 'Markdown' }
      );
    }
  });
}

async function handleText(ctx) {
  const session = getSession(ctx.chat.id);
  const text = ctx.message.text.trim();

  if (session.step === 'enterAmount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return ctx.reply('❌ Ingresa un número positivo.');
    updateSession(ctx.chat.id, { data: { ...session.data, amount } });
    await ctx.reply('💱 *¿En qué moneda?*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🇺🇸 USD', 'pp:cur:usd'), Markup.button.callback('🔢 Otra', 'pp:cur:oth')],
        [CANCEL_BTN],
      ]),
    });
    return;
  }

  if (session.step === 'enterRate') {
    const rate = parseFloat(text);
    if (isNaN(rate) || rate <= 0) return ctx.reply('❌ Ingresa una tasa válida.');
    const amountUSD = toUSD(session.data.amount, rate);
    updateSession(ctx.chat.id, { data: { ...session.data, exchangeRate: rate, amountUSD } });
    const s = getSession(ctx.chat.id);
    const payer = s.data.payerId.equals(ctx.users.nohelia._id) ? ctx.users.nohelia : ctx.users.antonio;
    await askFromAccount(ctx, payer);
    return;
  }

  if (session.step === 'enterNote') {
    updateSession(ctx.chat.id, { data: { ...session.data, note: text } });
    await askConfirm(ctx);
  }
}

module.exports = { register, handleText };
