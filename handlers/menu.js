const { Markup } = require('telegraf');
const { clearSession } = require('../utils/session');

const MAIN_MENU = Markup.inlineKeyboard([
  [Markup.button.callback('💸 Gasto', 'mn:g'), Markup.button.callback('💰 Ingreso', 'mn:in')],
  [Markup.button.callback('🔄 Transferencia', 'mn:tr'), Markup.button.callback('🤝 Préstamo', 'mn:pr')],
  [Markup.button.callback('💳 Pagar préstamo', 'mn:pp'), Markup.button.callback('💵 Pagar deuda', 'mn:pd')],
  [Markup.button.callback('📊 Consultas', 'mn:co'), Markup.button.callback('🔁 Nuevo periodo', 'mn:np')],
]);

async function sendMainMenu(ctx) {
  await ctx.reply('💬 ¿Qué quieres registrar?', MAIN_MENU);
}

function register(bot) {
  bot.command('start', async (ctx) => {
    clearSession(ctx.chat.id);
    await sendMainMenu(ctx);
  });

  bot.command('menu', async (ctx) => {
    clearSession(ctx.chat.id);
    await sendMainMenu(ctx);
  });
}

module.exports = { register, sendMainMenu, MAIN_MENU };
