const { Markup } = require('telegraf');
const Loan = require('../models/Loan');
const { getSession, setSession, clearSession, updateSession } = require('../utils/session');
const { toUSD, fmt } = require('../utils/helpers');

const CANCEL_BTN = Markup.button.callback('❌ Cancelar', 'pr:x');

async function startPrestamo(ctx) {
  clearSession(ctx.chat.id);
  setSession(ctx.chat.id, { command: 'prestamo', step: 'selectDir', data: {} });
  const otherName = ctx.otherUser.name;
  await ctx.reply(
    '🤝 *¿Quién presta?*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`💸 Yo le presto a ${otherName}`, 'pr:dir:me')],
        [Markup.button.callback(`🤲 ${otherName} me presta`, 'pr:dir:his')],
        [CANCEL_BTN],
      ]),
    }
  );
}

async function askNote(ctx) {
  updateSession(ctx.chat.id, { step: 'enterNote' });
  await ctx.reply('📝 *¿Nota?*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⏭️ Omitir', 'pr:nte:sk'), CANCEL_BTN]]),
  });
}

async function askConfirm(ctx) {
  const { data } = getSession(ctx.chat.id);
  // himToHer: Nohelia lends to Antonio → Antonio owes Nohelia
  // herToHim: Antonio lends to Nohelia → Nohelia owes Antonio
  const lender = data.direction === 'himToHer' ? ctx.user.name : ctx.otherUser.name;
  const borrower = data.direction === 'himToHer' ? ctx.otherUser.name : ctx.user.name;
  const lines = [
    `💸 *Prestamista:* ${lender}`,
    `🤲 *Deudor:* ${borrower}`,
    `💵 *Monto:* ${fmt(data.amount)} ${data.currency}${data.currency !== 'USD' ? ` → $${fmt(data.amountUSD)} USD` : ''}`,
  ];
  if (data.note) lines.push(`📝 *Nota:* ${data.note}`);
  updateSession(ctx.chat.id, { step: 'confirm' });
  await ctx.reply(
    `*Resumen del préstamo:*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Confirmar', 'pr:ok'), CANCEL_BTN]]) }
  );
}

function register(bot) {
  bot.command('prestamo', startPrestamo);
  bot.action(/^mn:pr$/, async (ctx) => { await ctx.answerCbQuery(); await startPrestamo(ctx); });

  bot.action(/^pr:/, async (ctx) => {
    await ctx.answerCbQuery();
    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const value = parts.slice(2).join(':');
    const session = getSession(ctx.chat.id);
    if (!session || session.command !== 'prestamo') return;

    if (action === 'x') { clearSession(ctx.chat.id); return ctx.reply('❌ Flujo cancelado.'); }

    if (action === 'dir') {
      // 'me' = I lend to him → himToHer (debt direction: him to her = Antonio owes Nohelia)
      const direction = value === 'me' ? 'himToHer' : 'herToHim';
      updateSession(ctx.chat.id, { data: { direction }, step: 'enterAmount' });
      await ctx.reply('💵 *¿Cuánto?* Escribe el monto:', { parse_mode: 'Markdown' });
      return;
    }

    if (action === 'cur') {
      const s = getSession(ctx.chat.id);
      if (value === 'usd') {
        updateSession(ctx.chat.id, { data: { ...s.data, currency: 'USD', exchangeRate: 1, amountUSD: s.data.amount } });
        await askNote(ctx);
      } else {
        updateSession(ctx.chat.id, { step: 'enterRate', data: { ...s.data, currency: 'MXN' } });
        await ctx.reply('🔢 *¿Tasa de cambio?*\n_¿Cuántos MXN equivalen a 1 USD?_', { parse_mode: 'Markdown' });
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
      await Loan.create({
        direction: data.direction,
        originalAmount: data.amount,
        remainingAmount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        amountUSD: data.amountUSD,
        remainingAmountUSD: data.amountUSD,
        note: data.note || null,
        status: 'active',
      });
      clearSession(ctx.chat.id);
      await ctx.reply('✅ *Préstamo registrado.*', { parse_mode: 'Markdown' });
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
        [Markup.button.callback('🇺🇸 USD', 'pr:cur:usd'), Markup.button.callback('🔢 Otra', 'pr:cur:oth')],
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
