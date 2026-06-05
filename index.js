require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const Expense = require('./models/Expense');
const Debt = require('./models/Debt');
const { getWeekStart, parseExpense, calculateUSD, calculateSummary } = require('./utils/helpers');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Only these two Telegram user IDs are allowed to interact with the bot.
// Stored as integers because Telegraf exposes ctx.from.id as a number.
const AUTHORIZED_USERS = [
  parseInt(process.env.USER_ID_1),
  parseInt(process.env.USER_ID_2)
];

/**
 * In-memory state for a pending /corte (settlement) request.
 *
 * A corte requires explicit confirmation from the *other* user before it
 * executes, preventing accidental or unilateral resets. The object tracks:
 *   active       - Whether a request is currently waiting for confirmation.
 *   initiatedBy  - Telegram ID of the user who triggered /corte.
 *   timestamp    - When the request was created (used for logging; expiry is
 *                  handled by clearPendingReset via setTimeout).
 */
const pendingReset = {
  active: false,
  initiatedBy: null,
  timestamp: null
};

/**
 * Schedules the automatic expiry of a pending corte request after 5 minutes.
 *
 * 5 minutes was chosen as a balance between giving the other user enough time
 * to respond and avoiding a stale pending state that could confuse future requests.
 * The function only clears the state if it is still marked active — this prevents
 * a race condition where the timer fires after the request was already resolved.
 */
function clearPendingReset() {
  setTimeout(() => {
    if (pendingReset.active) {
      pendingReset.active = false;
      pendingReset.initiatedBy = null;
      pendingReset.timestamp = null;
    }
  }, 5 * 60 * 1000);
}

/**
 * Generates the weekly summary message, sends it to both users, and marks all
 * shared expenses and individual debts as settled.
 *
 * This function is the core settlement routine. It is called either manually
 * via /corte (after the other user confirms with /si) or could be triggered
 * on a schedule. The sign convention used for balance variables is:
 *   positive value → user 2 owes user 1
 *   negative value → user 1 owes user 2
 *
 * This convention is applied consistently to both balance_gastos (shared
 * expenses) and balance_deudas (individual debts) so they can be summed into
 * a single final balance without extra conditionals.
 */
async function enviarResumenSemanal() {
  try {
    console.log('📅 Running weekly summary…');

    const weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });
    const debts = await Debt.find({ settled: false });

    if ((!weekDoc || weekDoc.expenses.length === 0) && debts.length === 0) {
      console.log('No expenses or debts to process');
      for (const userId of AUTHORIZED_USERS) {
        await bot.telegram.sendMessage(
          userId,
          '📊 *RESUMEN SEMANAL*\n\nNo hubo gastos ni deudas esta semana. 🎉',
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    const proportion1 = parseFloat(process.env.USER_PROPORTION_1);
    const proportion2 = parseFloat(process.env.USER_PROPORTION_2);
    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;

    let msg = '📊 *RESUMEN SEMANAL*\n';
    if (weekDoc) {
      msg += `Semana del ${weekDoc.weekStart.toLocaleDateString('es-ES')}\n`;
    }
    msg += '\n';

    // ── SHARED EXPENSES ──────────────────────────────────────────────────────
    // balance_gastos uses the sign convention described above.
    let balance_gastos = 0;

    if (weekDoc && weekDoc.expenses.length > 0) {
      const summary = calculateSummary(
        weekDoc.expenses,
        AUTHORIZED_USERS[0],
        AUTHORIZED_USERS[1],
        proportion1,
        proportion2
      );

      msg += `👤 *${userName1}* gastó: $${summary.total1.toFixed(2)}\n`;
      summary.expenses1.forEach((exp, i) => {
        const tipo = exp.isProporcional ? ' 📊' : ' ⚖️';
        const fecha = exp.date ? new Date(exp.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : '';
        msg += `  ${i + 1}.${tipo} $${exp.amountUSD.toFixed(2)} - ${exp.description}${fecha ? ` (${fecha})` : ''}\n`;
      });
      msg += `  _Debía pagar: $${summary.debeUser1.toFixed(2)}_\n`;

      msg += '\n';

      msg += `👤 *${userName2}* gastó: $${summary.total2.toFixed(2)}\n`;
      summary.expenses2.forEach((exp, i) => {
        const tipo = exp.isProporcional ? ' 📊' : ' ⚖️';
        const fecha = exp.date ? new Date(exp.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : '';
        msg += `  ${i + 1}.${tipo} $${exp.amountUSD.toFixed(2)} - ${exp.description}${fecha ? ` (${fecha})` : ''}\n`;
      });
      msg += `  _Debía pagar: $${summary.debeUser2.toFixed(2)}_\n`;

      msg += '\n';
      msg += `💰 *Total general:* $${summary.totalGeneral.toFixed(2)}\n\n`;

      msg += '*Balance gastos compartidos:*\n';
      if (summary.balance > 0) {
        const deudor = summary.deudor === 'Usuario1' ? userName1 : userName2;
        const acreedor = summary.acreedor === 'Usuario1' ? userName1 : userName2;
        msg += `${deudor} debía $${summary.balance.toFixed(2)} a ${acreedor}\n\n`;

        // Translate the symbolic deudor into a signed number for the final total.
        if (summary.deudor === 'Usuario1') {
          balance_gastos = -summary.balance; // user 1 owes → negative
        } else {
          balance_gastos = summary.balance;  // user 2 owes → positive
        }
      } else {
        msg += 'Estaban a mano 🎉\n\n';
      }
    }

    // ── INDIVIDUAL DEBTS ─────────────────────────────────────────────────────
    // balance_deudas also follows the same sign convention so both balances
    // can be added together for the final total.
    let balance_deudas = 0;

    if (debts.length > 0) {
      msg += '━━━━━━━━━━━━━━━━\n';
      msg += '💳 *DEUDAS INDIVIDUALES*\n\n';

      let nohelia_debe = 0;
      let antonio_debe = 0;

      debts.forEach((debt, index) => {
        const debtorName = debt.debtorId === AUTHORIZED_USERS[0] ? userName1 : userName2;
        const creditorName = debt.creditorId === AUTHORIZED_USERS[0] ? userName1 : userName2;

        msg += `${index + 1}. ${debtorName} → ${creditorName}: $${debt.amount.toFixed(2)}\n`;
        msg += `   📝 ${debt.description}\n`;

        if (debt.debtorId === AUTHORIZED_USERS[0]) {
          nohelia_debe += debt.amount;
        } else {
          antonio_debe += debt.amount;
        }
      });

      // Net the two sides to avoid counting mutual debts twice.
      msg += '\n*Balance deudas individuales:*\n';
      const balanceDeudas = Math.abs(nohelia_debe - antonio_debe);
      if (nohelia_debe > antonio_debe) {
        msg += `${userName1} debía $${balanceDeudas.toFixed(2)} a ${userName2}\n\n`;
        balance_deudas = -balanceDeudas; // user 1 owes → negative
      } else if (antonio_debe > nohelia_debe) {
        msg += `${userName2} debía $${balanceDeudas.toFixed(2)} a ${userName1}\n\n`;
        balance_deudas = balanceDeudas; // user 2 owes → positive
      } else {
        msg += 'Estaban a mano 🎉\n\n';
      }
    }

    // ── FINAL TOTAL ──────────────────────────────────────────────────────────
    // Adding the two signed balances gives the combined net amount owed.
    // Math.abs(balance_total) < 0.01 is used instead of === 0 to guard against
    // floating-point rounding errors in USD amounts converted from bolívars.
    msg += '━━━━━━━━━━━━━━━━\n';
    msg += '💵 *BALANCE TOTAL FINAL*\n\n';

    const balance_total = balance_gastos + balance_deudas;

    if (Math.abs(balance_total) < 0.01) {
      msg += '*¡Están completamente a mano!* 🎉\n\n';
    } else if (balance_total > 0) {
      msg += `*${userName2}* le debe *$${Math.abs(balance_total).toFixed(2)}* a *${userName1}*\n\n`;
    } else {
      msg += `*${userName1}* le debe *$${Math.abs(balance_total).toFixed(2)}* a *${userName2}*\n\n`;
    }

    msg += '✨ Nueva semana comienza ahora.\n';
    msg += '✅ Todos los gastos y deudas han sido saldados.';

    for (const userId of AUTHORIZED_USERS) {
      await bot.telegram.sendMessage(userId, msg, { parse_mode: 'Markdown' });
    }

    // Mark the week document as processed so it no longer appears in /resumen.
    if (weekDoc) {
      weekDoc.processed = true;
      weekDoc.weekEnd = new Date();
      await weekDoc.save();
    }

    // Bulk-settle all outstanding individual debts in a single DB operation.
    if (debts.length > 0) {
      await Debt.updateMany(
        { settled: false },
        {
          $set: {
            settled: true,
            settledAt: new Date()
          }
        }
      );
    }

    console.log('✅ Weekly summary sent, expenses and debts settled');

  } catch (error) {
    console.error('❌ Error in weekly summary:', error);
  }
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

/**
 * Authorization middleware — rejects all updates from users not in AUTHORIZED_USERS.
 * Applied globally before any command handler runs.
 */
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
      '• Con bs: `1200 bs 60 restaurante`\n\n' +
      '*Deudas individuales:*\n' +
      '• `/deuda 50 cash préstamo Nohelia` - Registrar deuda\n' +
      '• `/deuda 1200 bs 60 préstamo Antonio` - Con bs\n' +
      '• /eliminardeuda N - Eliminar deuda (error)\n\n' +
      '*Comandos principales:*\n' +
      '• /resumen - Ver gastos y deudas actuales\n' +
      '• /corte - Solicitar corte (salda todo)\n' +
      '• /si - Confirmar corte\n' +
      '• /no - Rechazar corte\n' +
      '• /cancelar - Cancelar solicitud\n' +
      '• /eliminar N - Eliminar gasto\n' +
      '• /ayuda - Ver esta ayuda',
    { parse_mode: 'Markdown' }
  );
});

/**
 * /resumen — Displays the current week's shared expenses, individual debts,
 * and combined net balance without making any changes to the database.
 *
 * calculateSummary is called twice when both expense and debt sections are
 * present: once for the per-user expense breakdown and once for the final
 * balance block. This avoids storing intermediate summary results across the
 * two rendering passes while keeping the code straightforward.
 */
bot.command('resumen', async (ctx) => {
  try {
    const weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });
    const debts = await Debt.find({ settled: false });

    if ((!weekDoc || weekDoc.expenses.length === 0) && debts.length === 0) {
      return ctx.reply('📊 No hay gastos ni deudas registrados esta semana.');
    }

    const proportion1 = parseFloat(process.env.USER_PROPORTION_1);
    const proportion2 = parseFloat(process.env.USER_PROPORTION_2);
    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;

    let msg = '📊 *RESUMEN DE LA SEMANA*\n\n';

    // ── SHARED EXPENSES ──────────────────────────────────────────────────────
    if (weekDoc && weekDoc.expenses.length > 0) {
      const summary = calculateSummary(
        weekDoc.expenses,
        AUTHORIZED_USERS[0],
        AUTHORIZED_USERS[1],
        proportion1,
        proportion2
      );

      msg += `👤 *${userName1}* gastó: $${summary.total1.toFixed(2)}\n`;
      summary.expenses1.forEach(exp => {
        const tipo = exp.isProportional ? ' 📊' : ' ⚖️';
        const fecha = exp.date ? new Date(exp.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : '';
        msg += `  ${exp.num}.${tipo} $${exp.amountUSD.toFixed(2)} - ${exp.description}${fecha ? ` (${fecha})` : ''}\n`;
      });
      msg += `  _Debe pagar: $${summary.debeUser1.toFixed(2)}_\n`;

      msg += '\n';

      msg += `👤 *${userName2}* gastó: $${summary.total2.toFixed(2)}\n`;
      summary.expenses2.forEach(exp => {
        const tipo = exp.isProportional ? ' 📊' : ' ⚖️';
        const fecha = exp.date ? new Date(exp.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : '';
        msg += `  ${exp.num}.${tipo} $${exp.amountUSD.toFixed(2)} - ${exp.description}${fecha ? ` (${fecha})` : ''}\n`;
      });
      msg += `  _Debe pagar: $${summary.debeUser2.toFixed(2)}_\n`;

      msg += '\n';
      msg += `💰 *Total general:* $${summary.totalGeneral.toFixed(2)}\n\n`;

      msg += '*Balance gastos compartidos:*\n';
      if (summary.balance > 0) {
        const deudor = summary.deudor === 'Usuario1' ? userName1 : userName2;
        const acreedor = summary.acreedor === 'Usuario1' ? userName1 : userName2;
        msg += `${deudor} debe $${summary.balance.toFixed(2)} a ${acreedor}\n\n`;
      } else {
        msg += 'Están a mano 🎉\n\n';
      }
    }

    // ── INDIVIDUAL DEBTS ─────────────────────────────────────────────────────
    if (debts.length > 0) {
      msg += '━━━━━━━━━━━━━━━━\n';
      msg += '💳 *DEUDAS INDIVIDUALES*\n\n';

      let nohelia_debe = 0;
      let antonio_debe = 0;

      debts.forEach((debt, index) => {
        const debtorName = debt.debtorId === AUTHORIZED_USERS[0] ? userName1 : userName2;
        const creditorName = debt.creditorId === AUTHORIZED_USERS[0] ? userName1 : userName2;

        msg += `${index + 1}. ${debtorName} → ${creditorName}: $${debt.amount.toFixed(2)}\n`;
        msg += `   📝 ${debt.description}\n`;

        if (debt.debtorId === AUTHORIZED_USERS[0]) {
          nohelia_debe += debt.amount;
        } else {
          antonio_debe += debt.amount;
        }
      });

      msg += '\n*Balance deudas individuales:*\n';
      const balanceDeudas = Math.abs(nohelia_debe - antonio_debe);
      if (nohelia_debe > antonio_debe) {
        msg += `${userName1} debe $${balanceDeudas.toFixed(2)} a ${userName2}\n\n`;
      } else if (antonio_debe > nohelia_debe) {
        msg += `${userName2} debe $${balanceDeudas.toFixed(2)} a ${userName1}\n\n`;
      } else {
        msg += 'Están a mano 🎉\n\n';
      }
    }

    // ── FINAL TOTAL ──────────────────────────────────────────────────────────
    msg += '━━━━━━━━━━━━━━━━\n';
    msg += '💵 *BALANCE TOTAL*\n\n';

    let balance_gastos = 0;
    let balance_deudas = 0;

    // Re-compute the shared-expense balance for the final total section.
    if (weekDoc && weekDoc.expenses.length > 0) {
      const summary = calculateSummary(
        weekDoc.expenses,
        AUTHORIZED_USERS[0],
        AUTHORIZED_USERS[1],
        proportion1,
        proportion2
      );

      if (summary.balance > 0) {
        if (summary.deudor === 'Usuario1') {
          balance_gastos = -summary.balance; // user 1 owes → negative
        } else {
          balance_gastos = summary.balance;  // user 2 owes → positive
        }
      }
    }

    // Re-compute the individual-debt balance for the final total section.
    // antonio_debe - nohelia_debe is positive when user 2 owes more, matching
    // the sign convention: positive = user 2 owes user 1.
    if (debts.length > 0) {
      let nohelia_debe = 0;
      let antonio_debe = 0;

      debts.forEach(debt => {
        if (debt.debtorId === AUTHORIZED_USERS[0]) {
          nohelia_debe += debt.amount;
        } else {
          antonio_debe += debt.amount;
        }
      });

      balance_deudas = antonio_debe - nohelia_debe;
    }

    const balance_total = balance_gastos + balance_deudas;

    if (Math.abs(balance_total) < 0.01) {
      msg += '*¡Están completamente a mano!* 🎉';
    } else if (balance_total > 0) {
      msg += `*${userName2}* le debe *$${Math.abs(balance_total).toFixed(2)}* a *${userName1}*`;
    } else {
      msg += `*${userName1}* le debe *$${Math.abs(balance_total).toFixed(2)}* a *${userName2}*`;
    }

    msg += '\n\n_📊 = Proporcional (41/59) | ⚖️ = 50/50_';

    ctx.reply(msg, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error generating summary:', error);
    ctx.reply('❌ Hubo un error al generar el resumen.');
  }
});

/**
 * /eliminar N — Removes expense number N from the current week.
 *
 * Users can only delete their own expenses (ownership check via userId).
 * The expense array is 1-indexed in user-facing output but 0-indexed in the
 * database, so gastoNum - 1 is used as the splice index.
 */
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

    if (gastoNum > weekDoc.expenses.length) {
      return ctx.reply(`❌ Solo hay ${weekDoc.expenses.length} gastos registrados.`);
    }

    const gastoEliminado = weekDoc.expenses[gastoNum - 1];
    const amountUSD = calculateUSD(
      gastoEliminado.amount,
      gastoEliminado.method,
      gastoEliminado.rate
    );

    if (gastoEliminado.userId !== ctx.from.id) {
      return ctx.reply('❌ Solo puedes eliminar tus propios gastos.');
    }

    weekDoc.expenses.splice(gastoNum - 1, 1);
    await weekDoc.save();

    ctx.reply(
      '✅ *Gasto eliminado:*\n\n' +
        `💰 $${amountUSD.toFixed(2)}\n` +
        `📝 ${gastoEliminado.description}`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error deleting expense:', error);
    ctx.reply('❌ Hubo un error al eliminar el gasto.');
  }
});

/**
 * /corte — Initiates a settlement request that requires confirmation from the
 * other user before executing.
 *
 * The two-user confirmation flow prevents either person from unilaterally
 * closing the week. Once initiated, the request auto-expires after 5 minutes
 * via clearPendingReset if the other user does not respond.
 */
bot.command('corte', async (ctx) => {
  try {
    const weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });
    const debts = await Debt.find({ settled: false });

    if ((!weekDoc || weekDoc.expenses.length === 0) && debts.length === 0) {
      return ctx.reply('📊 No hay gastos ni deudas para hacer el corte.');
    }

    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;
    const initiatorId = ctx.from.id;
    const initiatorName = initiatorId === AUTHORIZED_USERS[0] ? userName1 : userName2;
    const otherUserId = initiatorId === AUTHORIZED_USERS[0] ? AUTHORIZED_USERS[1] : AUTHORIZED_USERS[0];
    const otherUserName = initiatorId === AUTHORIZED_USERS[0] ? userName2 : userName1;

    let previewMsg = '📋 *Vista previa del corte:*\n\n';

    if (weekDoc && weekDoc.expenses.length > 0) {
      previewMsg += `💰 Gastos compartidos: ${weekDoc.expenses.length}\n`;
    }

    if (debts.length > 0) {
      previewMsg += `💳 Deudas individuales: ${debts.length}\n`;
    }

    previewMsg += '\nTodo será saldado al confirmar.';

    pendingReset.active = true;
    pendingReset.initiatedBy = initiatorId;
    pendingReset.timestamp = new Date();

    ctx.reply(
      `${previewMsg}\n\n` +
      '✅ Solicitud de corte enviada.\n' +
      `Esperando confirmación de *${otherUserName}*...\n\n` +
      'Usa /cancelar para cancelar la solicitud.',
      { parse_mode: 'Markdown' }
    );

    await bot.telegram.sendMessage(
      otherUserId,
      `${previewMsg}\n\n` +
      `🔔 *${initiatorName}* quiere hacer el corte.\n\n` +
      '¿Estás de acuerdo?\n\n' +
      '• /si - Confirmar y hacer el corte\n' +
      '• /no - Rechazar',
      { parse_mode: 'Markdown' }
    );

    clearPendingReset();

  } catch (error) {
    console.error('Error in /corte command:', error);
    ctx.reply('❌ Hubo un error al procesar la solicitud.');
  }
});

/**
 * /si — Confirms a pending corte request.
 *
 * Only the user who did NOT initiate the request can confirm it, ensuring
 * mutual agreement. After confirmation, pendingReset is cleared before calling
 * enviarResumenSemanal to avoid any re-entrancy issues if the summary function
 * were somehow triggered again before it finishes.
 */
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

    await bot.telegram.sendMessage(
      pendingReset.initiatedBy,
      `✅ *${confirmerName}* confirmó el corte. Generando resumen...`,
      { parse_mode: 'Markdown' }
    );

    pendingReset.active = false;
    pendingReset.initiatedBy = null;
    pendingReset.timestamp = null;

    await enviarResumenSemanal();

  } catch (error) {
    console.error('Error confirming corte:', error);
    ctx.reply('❌ Hubo un error al confirmar el corte.');
  }
});

/**
 * /no — Rejects a pending corte request.
 *
 * Only the non-initiating user can reject; the initiator must use /cancelar.
 * Both users are notified of the rejection so neither is left waiting.
 */
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

    await bot.telegram.sendMessage(
      pendingReset.initiatedBy,
      `❌ *${rejecterName}* rechazó la solicitud de corte.`,
      { parse_mode: 'Markdown' }
    );

    pendingReset.active = false;
    pendingReset.initiatedBy = null;
    pendingReset.timestamp = null;

  } catch (error) {
    console.error('Error rejecting corte:', error);
    ctx.reply('❌ Hubo un error al rechazar la solicitud.');
  }
});

/**
 * /cancelar — Allows the initiator to withdraw their own corte request.
 *
 * Only the user who started the request can cancel it. The other user is
 * notified so they know they no longer need to respond.
 */
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

    await bot.telegram.sendMessage(
      otherUserId,
      `ℹ️ *${initiatorName}* canceló la solicitud de corte.`,
      { parse_mode: 'Markdown' }
    );

    pendingReset.active = false;
    pendingReset.initiatedBy = null;
    pendingReset.timestamp = null;

  } catch (error) {
    console.error('Error cancelling request:', error);
    ctx.reply('❌ Hubo un error al cancelar la solicitud.');
  }
});

/**
 * /deuda — Records a one-sided debt from one user to the other.
 *
 * Format: /deuda <amount> <method> [<rate>] <description> <debtorName>
 * The last token is always the name of the person who owes the money. If the
 * method is "bs", the third token must be the exchange rate, and the description
 * is everything between the rate and the debtor name.
 *
 * The amount is stored in USD regardless of the input currency so that the
 * balance calculation in /resumen and /corte works with a single unit.
 * Both users receive a confirmation message so the transaction is transparent.
 */
bot.command('deuda', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1); // drop the "/deuda" token

    if (args.length < 4) {
      return ctx.reply(
        '❌ Formato incorrecto.\n\n' +
          '*Uso:* `/deuda monto método [tasa] descripción usuario`\n\n' +
          '*Ejemplos:*\n' +
          '• `/deuda 50 cash préstamo gasolina Nohelia`\n' +
          '• `/deuda 1200 bs 60 préstamo Antonio`\n\n' +
          'El usuario al final indica quién DEBE el dinero.',
        { parse_mode: 'Markdown' }
      );
    }

    const amount = parseFloat(args[0]);
    const method = args[1].toLowerCase();

    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('❌ El monto debe ser un número positivo.');
    }

    if (!['cash', 'bs'].includes(method)) {
      return ctx.reply('❌ El método debe ser "cash" o "bs".');
    }

    let rate = null;
    let description = '';
    let debtorName = '';

    if (method === 'bs') {
      if (args.length < 5) {
        return ctx.reply('❌ Falta la tasa de conversión para bs.');
      }

      rate = parseFloat(args[2]);
      if (isNaN(rate) || rate <= 0) {
        return ctx.reply('❌ La tasa debe ser un número positivo.');
      }

      debtorName = args[args.length - 1];
      description = args.slice(3, -1).join(' ');

    } else {
      debtorName = args[args.length - 1];
      description = args.slice(2, -1).join(' ');
    }

    if (!description.trim()) {
      return ctx.reply('❌ Debes incluir una descripción.');
    }

    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;

    let debtorId;
    let creditorId;
    let creditorName;

    if (debtorName.toLowerCase() === userName1.toLowerCase()) {
      debtorId = AUTHORIZED_USERS[0];
      creditorId = AUTHORIZED_USERS[1];
      creditorName = userName2;
      debtorName = userName1; // normalize capitalization
    } else if (debtorName.toLowerCase() === userName2.toLowerCase()) {
      debtorId = AUTHORIZED_USERS[1];
      creditorId = AUTHORIZED_USERS[0];
      creditorName = userName1;
      debtorName = userName2; // normalize capitalization
    } else {
      return ctx.reply(
        `❌ El usuario debe ser "${userName1}" o "${userName2}".`,
        { parse_mode: 'Markdown' }
      );
    }

    // Convert to USD at entry time so the debt amount is always in a single currency.
    const amountUSD = method === 'cash' ? amount : amount / rate;

    const debt = new Debt({
      debtorId,
      creditorId,
      amount: amountUSD,
      description
    });

    await debt.save();

    let confirmMsg = '💳 *DEUDA REGISTRADA*\n\n';
    confirmMsg += `${debtorName} le debe $${amountUSD.toFixed(2)} a ${creditorName}\n`;
    if (method === 'bs') {
      confirmMsg += `(${amount} bs a tasa ${rate})\n`;
    }
    confirmMsg += `📝 ${description}`;

    ctx.reply(confirmMsg, { parse_mode: 'Markdown' });

    // Notify the other user regardless of who registered the debt.
    const otherUserId = ctx.from.id === AUTHORIZED_USERS[0] ? AUTHORIZED_USERS[1] : AUTHORIZED_USERS[0];
    await bot.telegram.sendMessage(
      otherUserId,
      confirmMsg,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Error recording debt:', error);
    ctx.reply('❌ Hubo un error al registrar la deuda.');
  }
});

/**
 * /eliminardeuda N — Permanently deletes an individual debt (e.g. entered by mistake).
 *
 * This hard-deletes the document rather than marking it settled, so it will not
 * appear in history. Both users are notified to keep the record transparent.
 * Debt numbering is 1-based in user-facing output and derived from the query
 * order, so debtNum - 1 is used to index into the result array.
 */
bot.command('eliminardeuda', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');

    if (args.length < 2) {
      return ctx.reply(
        '❌ Debes especificar el número de la deuda.\n\n' +
          'Usa: `/eliminardeuda N`\n' +
          'Ejemplo: `/eliminardeuda 1`\n\n' +
          'Usa /deudas para ver los números.',
        { parse_mode: 'Markdown' }
      );
    }

    const debtNum = parseInt(args[1]);

    if (isNaN(debtNum) || debtNum < 1) {
      return ctx.reply('❌ Número de deuda inválido.');
    }

    const debts = await Debt.find({ settled: false });

    if (debts.length === 0) {
      return ctx.reply('📊 No hay deudas pendientes para eliminar.');
    }

    if (debtNum > debts.length) {
      return ctx.reply(`❌ Solo hay ${debts.length} deudas pendientes.`);
    }

    const debt = debts[debtNum - 1];

    const userName1 = process.env.USER_NAME_1;
    const userName2 = process.env.USER_NAME_2;
    const debtorName = debt.debtorId === AUTHORIZED_USERS[0] ? userName1 : userName2;
    const creditorName = debt.creditorId === AUTHORIZED_USERS[0] ? userName1 : userName2;

    await Debt.deleteOne({ _id: debt._id });

    const confirmMsg =
        '🗑️ *DEUDA ELIMINADA*\n\n' +
        `${debtorName} → ${creditorName}: $${debt.amount.toFixed(2)}\n` +
        `📝 ${debt.description}`;

    for (const userId of AUTHORIZED_USERS) {
      await bot.telegram.sendMessage(userId, confirmMsg, { parse_mode: 'Markdown' });
    }

  } catch (error) {
    console.error('Error deleting debt:', error);
    ctx.reply('❌ Hubo un error al eliminar la deuda.');
  }
});

/**
 * Text message handler — registers a new shared expense from a free-text message.
 *
 * Commands (messages starting with "/") are ignored here and handled by their
 * respective bot.command() listeners. For all other text, the message is parsed
 * by parseExpense and stored in the current open week document.
 * If no open week document exists yet, a new one is created with the current
 * week's start date so that the first expense of the week is always associated
 * with the correct billing period.
 */
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

    // Find the active (unprocessed) week document, or create one if this is
    // the first expense of a new week.
    let weekDoc = await Expense.findOne({ processed: false }).sort({ weekStart: -1 });

    if (!weekDoc) {
      const weekStart = getWeekStart();
      weekDoc = new Expense({
        weekStart,
        processed: false,
        expenses: []
      });
    }

    weekDoc.expenses.push({
      userId: ctx.from.id,
      amount,
      method,
      rate,
      description,
      isProportional
    });

    await weekDoc.save();

    let confirmMsg = '✅ Gasto registrado:\n\n';
    confirmMsg += `💰 ${amount} ${method.toUpperCase()}`;
    if (method === 'bs') {
      confirmMsg += ` (tasa: ${rate}) = $${amountUSD.toFixed(2)}`;
    }
    confirmMsg += `\n📝 ${description}`;
    confirmMsg += `\n⚖️ División: ${isProportional ? 'Proporcional (41/59)' : '50/50'}`;

    ctx.reply(confirmMsg);

  } catch (error) {
    console.error('Error recording expense:', error);
    ctx.reply('❌ Hubo un error al registrar el gasto. Intenta de nuevo.');
  }
});

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

if (WEBHOOK_DOMAIN) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  app.use(bot.webhookCallback(webhookPath));
}

app.get('/', (req, res) => {
  res.send(
    'Joeliano Gastos Bot 💸\n\n' +
    'Comandos disponibles:\n' +
    '  /resumen      — Ver gastos y deudas de la semana\n' +
    '  /corte        — Solicitar cierre de semana\n' +
    '  /deuda        — Registrar deuda individual\n' +
    '  /eliminar N   — Eliminar un gasto\n' +
    '  /ayuda        — Ver ayuda completa en Telegram'
  );
});

app.listen(PORT, async () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
  if (WEBHOOK_DOMAIN) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    await bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}${webhookPath}`);
    console.log('🤖 Bot started in webhook mode');
  } else {
    bot.launch();
    console.log('🤖 Bot started in long-polling mode');
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));