require('dotenv').config();
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const Expense = require('./models/Expense');
const { getWeekStart, parseExpense, calculateUSD, calculateSummary } = require('./utils/helpers');

const bot = new Telegraf(process.env.BOT_TOKEN);

// IDs autorizados
const AUTHORIZED_USERS = [
  parseInt(process.env.USER_ID_1),
  parseInt(process.env.USER_ID_2)
];

// Sistema de confirmación para reset
const pendingReset = {
  active: false,
  initiatedBy: null,
  timestamp: null
};

// Función para limpiar confirmación pendiente después de 5 minutos
function clearPendingReset() {
  setTimeout(() => {
    if (pendingReset.active) {
      pendingReset.active = false;
      pendingReset.initiatedBy = null;
      pendingReset.timestamp = null;
    }
  }, 5 * 60 * 1000); // 5 minutos
}

// Función para enviar resumen semanal
async function enviarResumenSemanal() {
  try {
    console.log('📅 Ejecutando resumen semanal...');

    const weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });

    if (!weekDoc || weekDoc.expenses.length === 0) {
      console.log('No hay gastos esta semana');
      // Enviar mensaje a ambos usuarios
      for (const userId of AUTHORIZED_USERS) {
        await bot.telegram.sendMessage(
            userId,
            '📊 *RESUMEN SEMANAL*\n\nNo hubo gastos esta semana. 🎉',
            { parse_mode: 'Markdown' }
        );
      }

      // Si existe el documento vacío, marcarlo como procesado
      if (weekDoc) {
        weekDoc.processed = true;
        weekDoc.weekEnd = new Date();
        await weekDoc.save();
      }

      return;
    }

    const summary = calculateSummary(
        weekDoc.expenses,
        AUTHORIZED_USERS[0],
        AUTHORIZED_USERS[1]
    );

    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;

    // Construir mensaje
    let msg = '📊 *RESUMEN SEMANAL*\n';

    // Gastos Usuario 1
    msg += `👤 *${userName1}* gastó: $${summary.total1.toFixed(2)}\n`;
    summary.expenses1.forEach(exp => {
      msg += `  ${exp.num}. $${exp.amountUSD.toFixed(2)} - ${exp.description}\n`;
    });

    msg += '\n';

    // Gastos Usuario 2
    msg += `👤 *${userName2}* gastó: $${summary.total2.toFixed(2)}\n`;
    summary.expenses2.forEach(exp => {
      msg += `  ${exp.num}. $${exp.amountUSD.toFixed(2)} - ${exp.description}\n`;
    });

    msg += '\n';
    msg += `💰 *Total general:* $${summary.totalGeneral.toFixed(2)}\n\n`;

    // Balance
    if (summary.balance > 0) {
      const deudor = summary.deudor === 'Usuario1' ? userName1 : userName2;
      const acreedor = summary.acreedor === 'Usuario1' ? userName1 : userName2;
      msg += `⚖️ *${deudor}* le debe *$${summary.balance.toFixed(2)}* a *${acreedor}*\n\n`;
    } else {
      msg += '⚖️ *Están a mano* 🎉\n\n';
    }

    msg += '✨ Nueva semana comienza ahora.';

    // Enviar a ambos usuarios
    for (const userId of AUTHORIZED_USERS) {
      await bot.telegram.sendMessage(userId, msg, { parse_mode: 'Markdown' });
    }

    // Marcar semana como procesada (NO ELIMINAR)
    weekDoc.processed = true;
    weekDoc.weekEnd = new Date();
    await weekDoc.save();

    console.log('✅ Resumen semanal enviado y semana marcada como procesada');

  } catch (error) {
    console.error('❌ Error en resumen semanal:', error);
  }
}

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB conectado correctamente'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// Middleware: Solo usuarios autorizados
bot.use((ctx, next) => {
  if (AUTHORIZED_USERS.includes(ctx.from.id)) {
    return next();
  }
  ctx.reply('⛔ No tienes acceso a este bot.');
});

bot.command('start', (ctx) => {
  ctx.reply('¡Hola! Bot de gastos iniciado ✅');
});

bot.command('ayuda', (ctx) => {
  ctx.reply(
      '📝 *Cómo usar el bot:*\n\n' +
      '*Registrar gastos:*\n' +
      '• 50/50: `20 cash supermercado`\n' +
      '• Proporcional: `20 cash supermercado proporcional`\n' +
      '• Con bs: `1200 bs 60 restaurante`\n' +
      '• Con bs proporcional: `1200 bs 60 restaurante proporcional`\n\n' +
      '*Comandos:*\n' +
      '• /resumen - Ver gastos de la semana\n' +
      '• /corte - Solicitar corte semanal\n' +
      '• /si - Confirmar corte\n' +
      '• /no - Rechazar corte\n' +
      '• /cancelar - Cancelar solicitud\n' +
      '• /eliminar N - Eliminar gasto número N\n' +
      '• /ayuda - Ver esta ayuda',
      { parse_mode: 'Markdown' }
  );
});

bot.command('resumen', async (ctx) => {
  try {
    const weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });

    if (!weekDoc || weekDoc.expenses.length === 0) {
      return ctx.reply('📊 No hay gastos registrados esta semana.');
    }

    const proportion1 = parseFloat(process.env.USER_PROPORTION_1);
    const proportion2 = parseFloat(process.env.USER_PROPORTION_2);

    const summary = calculateSummary(
        weekDoc.expenses,
        AUTHORIZED_USERS[0],
        AUTHORIZED_USERS[1],
        proportion1,
        proportion2
    );

    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;

    // Construir mensaje
    let msg = '📊 *RESUMEN DE LA SEMANA*\n\n';

    // Gastos Usuario 1
    msg += `👤 *${userName1}* gastó: $${summary.total1.toFixed(2)}\n`;
    summary.expenses1.forEach(exp => {
      const tipo = exp.isProportional ? ' 📊' : ' ⚖️';
      msg += `  ${exp.num}.${tipo} $${exp.amountUSD.toFixed(2)} - ${exp.description}\n`;
    });
    msg += `  _Debe pagar: $${summary.debeUser1.toFixed(2)}_\n`;

    msg += '\n';

    // Gastos Usuario 2
    msg += `👤 *${userName2}* gastó: $${summary.total2.toFixed(2)}\n`;
    summary.expenses2.forEach(exp => {
      const tipo = exp.isProportional ? ' 📊' : ' ⚖️';
      msg += `  ${exp.num}.${tipo} $${exp.amountUSD.toFixed(2)} - ${exp.description}\n`;
    });
    msg += `  _Debe pagar: $${summary.debeUser2.toFixed(2)}_\n`;

    msg += '\n';
    msg += `💰 *Total general:* $${summary.totalGeneral.toFixed(2)}\n\n`;

    // Balance
    if (summary.balance > 0) {
      const deudor = summary.deudor === 'Usuario1' ? userName1 : userName2;
      const acreedor = summary.acreedor === 'Usuario1' ? userName1 : userName2;
      msg += `⚖️ *${deudor}* le debe *$${summary.balance.toFixed(2)}* a *${acreedor}*\n\n`;
    } else {
      msg += '⚖️ *Están a mano* 🎉\n\n';
    }

    msg += '_📊 = Proporcional (41/59) | ⚖️ = 50/50_';

    ctx.reply(msg, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error al generar resumen:', error);
    ctx.reply('❌ Hubo un error al generar el resumen.');
  }
});

bot.command('eliminar', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');

    if (args.length < 2) {
      return ctx.reply(
          '❌ Debes especificar el número del gasto.\n\n' +
          'Usa: `/eliminar N`\n' +
          'Ejemplo: `/eliminar 3`\n\n' +
          'Usa /resumen para ver los números de los gastos.',
          { parse_mode: 'Markdown' }
      );
    }

    const gastoNum = parseInt(args[1]);

    if (isNaN(gastoNum) || gastoNum < 1) {
      return ctx.reply('❌ Número de gasto inválido.');
    }

    const weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });

    if (!weekDoc || weekDoc.expenses.length === 0) {
      return ctx.reply('📊 No hay gastos registrados esta semana.');
    }

    // Verificar que el número existe
    if (gastoNum > weekDoc.expenses.length) {
      return ctx.reply(`❌ Solo hay ${weekDoc.expenses.length} gastos registrados.`);
    }

    // Obtener el gasto antes de eliminarlo (para mostrar confirmación)
    const gastoEliminado = weekDoc.expenses[gastoNum - 1];
    const amountUSD = calculateUSD(
        gastoEliminado.amount,
        gastoEliminado.method,
        gastoEliminado.rate
    );

    // Verificar que el usuario solo pueda eliminar sus propios gastos
    if (gastoEliminado.userId !== ctx.from.id) {
      return ctx.reply('❌ Solo puedes eliminar tus propios gastos.');
    }

    // Eliminar el gasto
    weekDoc.expenses.splice(gastoNum - 1, 1);
    await weekDoc.save();

    ctx.reply(
        `✅ *Gasto eliminado:*\n\n` +
        `💰 $${amountUSD.toFixed(2)}\n` +
        `📝 ${gastoEliminado.description}`,
        { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error al eliminar gasto:', error);
    ctx.reply('❌ Hubo un error al eliminar el gasto.');
  }
});

bot.command('corte', async (ctx) => {
  try {
    const weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });

    if (!weekDoc || weekDoc.expenses.length === 0) {
      return ctx.reply('📊 No hay gastos registrados para hacer el corte.');
    }

    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;
    const initiatorId = ctx.from.id;
    const initiatorName = initiatorId === AUTHORIZED_USERS[0] ? userName1 : userName2;
    const otherUserId = initiatorId === AUTHORIZED_USERS[0] ? AUTHORIZED_USERS[1] : AUTHORIZED_USERS[0];
    const otherUserName = initiatorId === AUTHORIZED_USERS[0] ? userName2 : userName1;

    // Activar confirmación pendiente
    pendingReset.active = true;
    pendingReset.initiatedBy = initiatorId;
    pendingReset.timestamp = new Date();

    // Mensaje al iniciador
    ctx.reply(
        `✅ Solicitud de corte enviada.\n\n` +
        `Esperando confirmación de *${otherUserName}*...\n\n` +
        `Usa /cancelar para cancelar la solicitud.`,
        { parse_mode: 'Markdown' }
    );

    // Mensaje al otro usuario
    await bot.telegram.sendMessage(
        otherUserId,
        `🔔 *${initiatorName}* quiere hacer el corte semanal.\n\n` +
        `¿Estás de acuerdo?\n\n` +
        `• /si - Confirmar y hacer el corte\n` +
        `• /no - Rechazar`,
        { parse_mode: 'Markdown' }
    );

    // Auto-cancelar después de 5 minutos
    clearPendingReset();

  } catch (error) {
    console.error('Error en comando corte:', error);
    ctx.reply('❌ Hubo un error al procesar la solicitud.');
  }
});

bot.command('si', async (ctx) => {
  try {
    if (!pendingReset.active) {
      return ctx.reply('❌ No hay ninguna solicitud de corte pendiente.');
    }

    if (ctx.from.id === pendingReset.initiatedBy) {
      return ctx.reply('❌ No puedes confirmar tu propia solicitud. Debe confirmar la otra persona.');
    }

    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;
    const confirmerName = ctx.from.id === AUTHORIZED_USERS[0] ? userName1 : userName2;

    ctx.reply('✅ Confirmado. Generando resumen y haciendo el corte...');

    // Notificar al iniciador
    await bot.telegram.sendMessage(
        pendingReset.initiatedBy,
        `✅ *${confirmerName}* confirmó el corte. Generando resumen...`,
        { parse_mode: 'Markdown' }
    );

    // Limpiar estado de confirmación
    pendingReset.active = false;
    pendingReset.initiatedBy = null;
    pendingReset.timestamp = null;

    // Ejecutar resumen
    await enviarResumenSemanal();

  } catch (error) {
    console.error('Error al confirmar corte:', error);
    ctx.reply('❌ Hubo un error al confirmar el corte.');
  }
});

bot.command('no', async (ctx) => {
  try {
    if (!pendingReset.active) {
      return ctx.reply('❌ No hay ninguna solicitud de corte pendiente.');
    }

    if (ctx.from.id === pendingReset.initiatedBy) {
      return ctx.reply('❌ No puedes rechazar tu propia solicitud. Usa /cancelar para cancelarla.');
    }

    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;
    const rejecterName = ctx.from.id === AUTHORIZED_USERS[0] ? userName1 : userName2;

    ctx.reply('❌ Solicitud de corte rechazada.');

    // Notificar al iniciador
    await bot.telegram.sendMessage(
        pendingReset.initiatedBy,
        `❌ *${rejecterName}* rechazó la solicitud de corte.`,
        { parse_mode: 'Markdown' }
    );

    // Limpiar estado de confirmación
    pendingReset.active = false;
    pendingReset.initiatedBy = null;
    pendingReset.timestamp = null;

  } catch (error) {
    console.error('Error al rechazar corte:', error);
    ctx.reply('❌ Hubo un error al rechazar la solicitud.');
  }
});

bot.command('cancelar', async (ctx) => {
  try {
    if (!pendingReset.active) {
      return ctx.reply('❌ No hay ninguna solicitud de corte pendiente.');
    }

    if (ctx.from.id !== pendingReset.initiatedBy) {
      return ctx.reply('❌ Solo quien inició la solicitud puede cancelarla.');
    }

    const otherUserId = ctx.from.id === AUTHORIZED_USERS[0] ? AUTHORIZED_USERS[1] : AUTHORIZED_USERS[0];
    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;
    const initiatorName = ctx.from.id === AUTHORIZED_USERS[0] ? userName1 : userName2;

    ctx.reply('✅ Solicitud de corte cancelada.');

    // Notificar al otro usuario
    await bot.telegram.sendMessage(
        otherUserId,
        `ℹ️ *${initiatorName}* canceló la solicitud de corte.`,
        { parse_mode: 'Markdown' }
    );

    // Limpiar estado de confirmación
    pendingReset.active = false;
    pendingReset.initiatedBy = null;
    pendingReset.timestamp = null;

  } catch (error) {
    console.error('Error al cancelar solicitud:', error);
    ctx.reply('❌ Hubo un error al cancelar la solicitud.');
  }
});

// Registrar gasto (cualquier mensaje que no sea comando)
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    return;
  }

  try {
    const parsed = parseExpense(ctx.message.text);

    if (!parsed) {
      return ctx.reply(
          '❌ Formato incorrecto.\n\n' +
          'Usa:\n' +
          '• `20 cash supermercado`\n' +
          '• `20 cash supermercado proporcional`\n' +
          '• `1200 bs 60 restaurante`\n' +
          '• `1200 bs 60 restaurante proporcional`',
          { parse_mode: 'Markdown' }
      );
    }

    const { amount, method, rate, description, isProportional } = parsed;
    const amountUSD = calculateUSD(amount, method, rate);

    // Buscar semana activa (no procesada) o crear una nueva
    let weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });

    if (!weekDoc) {
      const weekStart = getWeekStart();
      weekDoc = new Expense({
        weekStart,
        processed: false,
        expenses: []
      });
    }

    // Agregar gasto
    weekDoc.expenses.push({
      userId: ctx.from.id,
      amount,
      method,
      rate,
      description,
      isProportional
    });

    await weekDoc.save();

    // Mensaje de confirmación
    let confirmMsg = `✅ Gasto registrado:\n\n`;
    confirmMsg += `💰 ${amount} ${method.toUpperCase()}`;
    if (method === 'bs') {
      confirmMsg += ` (tasa: ${rate}) = $${amountUSD.toFixed(2)}`;
    }
    confirmMsg += `\n📝 ${description}`;
    confirmMsg += `\n⚖️ División: ${isProportional ? 'Proporcional (41/59)' : '50/50'}`;

    ctx.reply(confirmMsg);

  } catch (error) {
    console.error('Error al registrar gasto:', error);
    ctx.reply('❌ Hubo un error al registrar el gasto. Intenta de nuevo.');
  }
});


// Iniciar bot
bot.launch();
console.log('🤖 Bot iniciado correctamente');

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

