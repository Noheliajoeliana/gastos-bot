process.env.TZ = 'America/Mexico_City';

require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

const User = require('./models/User');
const { clearSession, getSession } = require('./utils/session');

const menu = require('./handlers/menu');
const gasto = require('./handlers/gasto');
const ingreso = require('./handlers/ingreso');
const transferencia = require('./handlers/transferencia');
const prestamo = require('./handlers/prestamo');
const pagoPrestamo = require('./handlers/pagoPrestamo');
const pagarDeuda = require('./handlers/pagarDeuda');
const consultas = require('./handlers/consultas');
const nuevoPeriodo = require('./handlers/nuevoPeriodo');
const eliminar = require('./handlers/eliminar');

const bot = new Telegraf(process.env.BOT_TOKEN);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Authorization + user context middleware
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  if (!user) {
    return ctx.reply('⛔ No tienes acceso a este bot.');
  }
  const other = await User.findOne({ _id: { $ne: user._id } });
  ctx.user = user;
  ctx.otherUser = other;
  ctx.users = { nohelia: null, antonio: null };

  // Populate named shortcuts for business logic
  const [u1, u2] = [user, other];
  for (const u of [u1, u2]) {
    if (u.name === 'Nohelia') ctx.users.nohelia = u;
    if (u.name === 'Antonio') ctx.users.antonio = u;
  }

  return next();
});

// /cancelar — aborts any active flow
bot.command('cancelar', (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session) return ctx.reply('No hay ningún flujo activo.');
  clearSession(ctx.chat.id);
  ctx.reply('❌ Flujo cancelado. Usa /menu para empezar.');
});

// Register all handlers
menu.register(bot);
gasto.register(bot);
ingreso.register(bot);
transferencia.register(bot);
prestamo.register(bot);
pagoPrestamo.register(bot);
pagarDeuda.register(bot);
consultas.register(bot);
nuevoPeriodo.register(bot);
eliminar.register(bot);

// Text message router — delegates to active session handler
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const session = getSession(ctx.chat.id);
  if (!session) {
    return ctx.reply('Usa /menu para ver las opciones disponibles.');
  }

  // Only handle text when waiting for text input
  const textSteps = ['enterAmount', 'enterRate', 'enterNote'];
  if (!textSteps.includes(session.step)) {
    return ctx.reply('Por favor usa los botones de arriba, o /cancelar para salir.');
  }

  try {
    switch (session.command) {
      case 'gasto': await gasto.handleText(ctx); break;
      case 'ingreso': await ingreso.handleText(ctx); break;
      case 'transferencia': await transferencia.handleText(ctx); break;
      case 'prestamo': await prestamo.handleText(ctx); break;
      case 'pagoPrestamo': await pagoPrestamo.handleText(ctx); break;
      case 'pagarDeuda': await pagarDeuda.handleText(ctx); break;
      default: ctx.reply('Usa /menu para ver las opciones.');
    }
  } catch (err) {
    console.error('Text handler error:', err);
    ctx.reply('❌ Ocurrió un error. Intenta de nuevo o usa /cancelar.');
  }
});

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

if (WEBHOOK_DOMAIN) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  app.use(bot.webhookCallback(webhookPath));
}

app.get('/', (req, res) => res.send('Bot de finanzas de pareja 💸'));

app.listen(PORT, async () => {
  console.log(`🌐 HTTP server on port ${PORT}`);
  if (WEBHOOK_DOMAIN) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    await bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}${webhookPath}`);
    console.log('🤖 Bot started (webhook)');
  } else {
    bot.launch();
    console.log('🤖 Bot started (long-polling)');
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
