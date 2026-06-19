const { Markup } = require('telegraf');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const { getSession, setSession, clearSession, updateSession } = require('../utils/session');
const { toUSD, fmt, updateAccountBalance } = require('../utils/helpers');

const CANCEL_BTN = Markup.button.callback('❌ Cancelar', 'tr:x');

async function startTransferencia(ctx) {
  clearSession(ctx.chat.id);
  setSession(ctx.chat.id, { command: 'transferencia', step: 'selectFrom', data: {} });
  const accounts = await Account.find({ isActive: true }).populate('owner');
  if (accounts.length < 2) return ctx.reply('❌ Se necesitan al menos 2 cuentas activas.');
  const buttons = accounts.map(a => [Markup.button.callback(`${a.name} (${a.owner.name}) $${fmt(a.balance)}`, `tr:frm:${a._id}`)]);
  buttons.push([CANCEL_BTN]);
  await ctx.reply('🔄 *¿Cuenta origen?*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askToAccount(ctx, fromId) {
  const accounts = await Account.find({ isActive: true, _id: { $ne: fromId } }).populate('owner');
  updateSession(ctx.chat.id, { step: 'selectTo' });
  const buttons = accounts.map(a => [Markup.button.callback(`${a.name} (${a.owner.name}) $${fmt(a.balance)}`, `tr:to:${a._id}`)]);
  buttons.push([CANCEL_BTN]);
  await ctx.reply('🏦 *¿Cuenta destino?*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askNote(ctx) {
  updateSession(ctx.chat.id, { step: 'enterNote' });
  await ctx.reply('📝 *¿Nota?*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⏭️ Omitir', 'tr:nte:sk'), CANCEL_BTN]]),
  });
}

async function askConfirm(ctx) {
  const { data } = getSession(ctx.chat.id);
  const from = await Account.findById(data.fromId).populate('owner');
  const to = await Account.findById(data.toId).populate('owner');
  const lines = [
    `📤 *Origen:* ${from.name} (${from.owner.name})`,
    `📥 *Destino:* ${to.name} (${to.owner.name})`,
    `💵 *Monto:* ${fmt(data.amount)} ${data.currency}${data.currency !== 'USD' ? ` → $${fmt(data.amountUSD)} USD` : ''}`,
  ];
  if (data.note) lines.push(`📝 *Nota:* ${data.note}`);
  updateSession(ctx.chat.id, { step: 'confirm' });
  await ctx.reply(
    `*Resumen de la transferencia:*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Confirmar', 'tr:ok'), CANCEL_BTN]]) }
  );
}

function register(bot) {
  bot.command('transferencia', startTransferencia);
  bot.action(/^mn:tr$/, async (ctx) => { await ctx.answerCbQuery(); await startTransferencia(ctx); });

  bot.action(/^tr:/, async (ctx) => {
    await ctx.answerCbQuery();
    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const value = parts.slice(2).join(':');
    const session = getSession(ctx.chat.id);
    if (!session || session.command !== 'transferencia') return;

    if (action === 'x') { clearSession(ctx.chat.id); return ctx.reply('❌ Flujo cancelado.'); }

    if (action === 'frm') {
      const from = await Account.findById(value);
      updateSession(ctx.chat.id, {
        data: { fromId: from._id, fromCurrency: from.originalCurrency },
      });
      await askToAccount(ctx, from._id);
      return;
    }

    if (action === 'to') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, toId: value }, step: 'enterAmount' });
      await ctx.reply('💵 *¿Cuánto?* Escribe el monto:', { parse_mode: 'Markdown' });
      return;
    }

    if (action === 'cur') {
      const s = getSession(ctx.chat.id);
      if (value === 'usd') {
        updateSession(ctx.chat.id, { data: { ...s.data, currency: 'USD', exchangeRate: 1, amountUSD: s.data.amount } });
        await askNote(ctx);
      } else {
        const cur = s.data.fromCurrency || 'MXN';
        updateSession(ctx.chat.id, { step: 'enterRate', data: { ...s.data, currency: cur } });
        await ctx.reply(`🔢 *¿Tasa de cambio?*\n_¿Cuántos ${cur} equivalen a 1 USD?_`, { parse_mode: 'Markdown' });
      }
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
        type: 'transfer',
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        amountUSD: data.amountUSD,
        account: data.fromId,
        toAccount: data.toId,
        registeredBy: ctx.user._id,
        owner: ctx.user._id,
        note: data.note || null,
      });
      await updateAccountBalance(data.fromId, -data.amountUSD);
      await updateAccountBalance(data.toId, data.amountUSD);
      clearSession(ctx.chat.id);
      await ctx.reply('✅ *Transferencia registrada.*', { parse_mode: 'Markdown' });
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
        [Markup.button.callback('🇺🇸 USD', 'tr:cur:usd'), Markup.button.callback('🔢 Otra', 'tr:cur:oth')],
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
    await askNote(ctx);
    return;
  }

  if (session.step === 'enterNote') {
    updateSession(ctx.chat.id, { data: { ...session.data, note: text } });
    await askConfirm(ctx);
  }
}

module.exports = { register, handleText };
