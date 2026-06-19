const { Markup } = require('telegraf');
const Account = require('../models/Account');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const { getSession, setSession, clearSession, updateSession } = require('../utils/session');
const { toUSD, fmt, updateAccountBalance, getMonthlySpending } = require('../utils/helpers');

const CANCEL_BTN = Markup.button.callback('❌ Cancelar', 'in:x');

async function startIngreso(ctx) {
  clearSession(ctx.chat.id);
  setSession(ctx.chat.id, { command: 'ingreso', step: 'selectFor', data: {} });
  const otherName = ctx.otherUser.name;
  await ctx.reply(
    '💰 *¿Para quién es el ingreso?*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🙋 Para mí', 'in:for:me'), Markup.button.callback(`👤 Para ${otherName}`, 'in:for:his')],
        [CANCEL_BTN],
      ]),
    }
  );
}

async function askAccount(ctx, ownerId, ownerName) {
  const accounts = await Account.find({ owner: ownerId, isActive: true });
  if (accounts.length === 0) return ctx.reply(`❌ ${ownerName} no tiene cuentas activas.`);
  updateSession(ctx.chat.id, { step: 'selectAccount' });
  const buttons = accounts.map(a => [Markup.button.callback(`${a.name} ($${fmt(a.balance)})`, `in:acc:${a._id}`)]);
  buttons.push([CANCEL_BTN]);
  await ctx.reply('🏦 *¿En qué cuenta?*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askCategory(ctx, ownerId, ownerName) {
  const cats = await Category.find({ owner: ownerId, transactionType: 'income' });
  if (cats.length === 0) return ctx.reply(`❌ ${ownerName} no tiene categorías de ingreso.`);
  updateSession(ctx.chat.id, { step: 'selectCategory' });
  const buttons = cats.map(c => [Markup.button.callback(c.name, `in:cat:${c._id}`)]);
  buttons.push([CANCEL_BTN]);
  await ctx.reply('🏷️ *¿Categoría?*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askNote(ctx) {
  updateSession(ctx.chat.id, { step: 'enterNote' });
  await ctx.reply(
    '📝 *¿Nota?*',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⏭️ Omitir', 'in:nte:sk'), CANCEL_BTN]]) }
  );
}

async function askConfirm(ctx) {
  const { data } = getSession(ctx.chat.id);
  const account = await Account.findById(data.accountId);
  const cat = await Category.findById(data.categoryId);
  const lines = [
    `🏦 *Cuenta:* ${account.name}`,
    `💵 *Monto:* ${fmt(data.amount)} ${data.currency}${data.currency !== 'USD' ? ` → $${fmt(data.amountUSD)} USD` : ''}`,
    `🏷️ *Categoría:* ${cat.name}`,
  ];
  if (data.note) lines.push(`📝 *Nota:* ${data.note}`);
  updateSession(ctx.chat.id, { step: 'confirm' });
  await ctx.reply(
    `*Resumen del ingreso:*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Confirmar', 'in:ok'), CANCEL_BTN]]) }
  );
}

function register(bot) {
  bot.command('ingreso', startIngreso);
  bot.action(/^mn:in$/, async (ctx) => { await ctx.answerCbQuery(); await startIngreso(ctx); });

  bot.action(/^in:/, async (ctx) => {
    await ctx.answerCbQuery();
    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const value = parts.slice(2).join(':');
    const session = getSession(ctx.chat.id);
    if (!session || session.command !== 'ingreso') return;

    if (action === 'x') { clearSession(ctx.chat.id); return ctx.reply('❌ Flujo cancelado.'); }

    if (action === 'for') {
      const owner = value === 'me' ? ctx.user : ctx.otherUser;
      updateSession(ctx.chat.id, { data: { ownerId: owner._id } });
      await askAccount(ctx, owner._id, owner.name);
      return;
    }

    if (action === 'acc') {
      const account = await Account.findById(value).populate('owner');
      updateSession(ctx.chat.id, {
        data: { ...session.data, accountId: account._id, accountCurrency: account.originalCurrency },
      });
      updateSession(ctx.chat.id, { step: 'enterAmount' });
      await ctx.reply('💵 *¿Cuánto?* Escribe el monto:', { parse_mode: 'Markdown' });
      return;
    }

    if (action === 'cur') {
      const s = getSession(ctx.chat.id);
      if (value === 'usd') {
        updateSession(ctx.chat.id, { data: { ...s.data, currency: 'USD', exchangeRate: 1, amountUSD: s.data.amount } });
        await askCategory(ctx, s.data.ownerId, ctx.user.name);
      } else {
        const cur = s.data.accountCurrency || 'MXN';
        updateSession(ctx.chat.id, { step: 'enterRate', data: { ...s.data, currency: cur } });
        await ctx.reply(`🔢 *¿Tasa de cambio?*\n_¿Cuántos ${cur} equivalen a 1 USD?_`, { parse_mode: 'Markdown' });
      }
      return;
    }

    if (action === 'cat') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, categoryId: value } });
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
      await Transaction.create({
        type: 'income',
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        amountUSD: data.amountUSD,
        account: data.accountId,
        category: data.categoryId,
        registeredBy: ctx.user._id,
        owner: data.ownerId,
        note: data.note || null,
      });
      await updateAccountBalance(data.accountId, data.amountUSD);
      clearSession(ctx.chat.id);
      await ctx.reply('✅ *Ingreso registrado.*', { parse_mode: 'Markdown' });

      const cat = await Category.findById(data.categoryId);
      if (cat && cat.monthlyBudget) {
        const spent = await getMonthlySpending(data.categoryId);
        if (spent > cat.monthlyBudget) {
          await ctx.reply(`⚠️ Presupuesto excedido: ${cat.name} $${fmt(spent)} / $${fmt(cat.monthlyBudget)}`);
        }
      }
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
    await ctx.reply(
      '💱 *¿En qué moneda?*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🇺🇸 USD', 'in:cur:usd'), Markup.button.callback('🔢 Otra', 'in:cur:oth')],
          [CANCEL_BTN],
        ]),
      }
    );
    return;
  }

  if (session.step === 'enterRate') {
    const rate = parseFloat(text);
    if (isNaN(rate) || rate <= 0) return ctx.reply('❌ Ingresa una tasa válida.');
    const amountUSD = toUSD(session.data.amount, rate);
    updateSession(ctx.chat.id, { data: { ...session.data, exchangeRate: rate, amountUSD } });
    const s = getSession(ctx.chat.id);
    await askCategory(ctx, s.data.ownerId, '');
    return;
  }

  if (session.step === 'enterNote') {
    updateSession(ctx.chat.id, { data: { ...session.data, note: text } });
    await askConfirm(ctx);
  }
}

module.exports = { register, handleText };
