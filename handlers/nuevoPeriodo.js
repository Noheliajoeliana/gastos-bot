const { Markup } = require('telegraf');
const Period = require('../models/Period');
const { clearSession } = require('../utils/session');
const { formatDate } = require('../utils/helpers');

async function startNuevoPeriodo(ctx) {
  clearSession(ctx.chat.id);
  const current = await Period.findOne({ isActive: true });
  const since = current ? formatDate(current.startDate) : 'el inicio';
  await ctx.reply(
    `🔁 *¿Iniciar nuevo periodo?*\n\nEl periodo actual comenzó el ${since}.\nLos resúmenes mostrarán solo movimientos a partir de hoy.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirmar', 'np:ok'), Markup.button.callback('❌ Cancelar', 'np:x')],
      ]),
    }
  );
}

function register(bot) {
  bot.command('nuevoperiodo', startNuevoPeriodo);
  bot.action(/^mn:np$/, async (ctx) => { await ctx.answerCbQuery(); await startNuevoPeriodo(ctx); });

  bot.action(/^np:/, async (ctx) => {
    await ctx.answerCbQuery();
    const action = ctx.callbackQuery.data.split(':')[1];

    if (action === 'x') { return ctx.reply('❌ Cancelado.'); }

    if (action === 'ok') {
      await Period.updateMany({ isActive: true }, { isActive: false });
      const newPeriod = await Period.create({
        startDate: new Date(),
        createdBy: ctx.user._id,
        isActive: true,
      });
      await ctx.reply(
        `✅ *Nuevo periodo iniciado.*\nComienza el ${formatDate(newPeriod.startDate)}.`,
        { parse_mode: 'Markdown' }
      );
    }
  });
}

module.exports = { register };
