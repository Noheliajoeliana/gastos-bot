const { Markup } = require('telegraf');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const { getSession, setSession, clearSession, updateSession } = require('../utils/session');
const { fmt, updateAccountBalance, formatDate } = require('../utils/helpers');

const CANCEL_BTN = Markup.button.callback('❌ Cancelar', 'el:x');

async function startEliminar(ctx) {
  clearSession(ctx.chat.id);
  const txs = await Transaction.find()
    .populate('category')
    .populate('account')
    .sort({ date: -1 })
    .limit(5);

  if (txs.length === 0) return ctx.reply('📭 No hay movimientos para eliminar.');

  setSession(ctx.chat.id, { command: 'eliminar', step: 'selectTx', data: {} });

  const typeEmoji = { expense: '💸', income: '💰', transfer: '🔄' };
  const buttons = txs.map((tx, i) => {
    const cat = tx.category ? tx.category.name : tx.type === 'transfer' ? 'Transferencia' : '—';
    const note = tx.note ? ` — ${tx.note}` : '';
    const label = `${typeEmoji[tx.type]} $${fmt(tx.amountUSD)} ${cat}${note} (${formatDate(tx.date)})`;
    return [Markup.button.callback(label.substring(0, 62), `el:tx:${tx._id}`)];
  });
  buttons.push([CANCEL_BTN]);

  await ctx.reply(
    '🗑️ *¿Qué movimiento eliminar?*\n_(últimos 5)_',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
}

function register(bot) {
  bot.command('eliminar', startEliminar);

  bot.action(/^el:/, async (ctx) => {
    await ctx.answerCbQuery();
    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const value = parts.slice(2).join(':');
    const session = getSession(ctx.chat.id);
    if (!session || session.command !== 'eliminar') return;

    if (action === 'x') { clearSession(ctx.chat.id); return ctx.reply('❌ Cancelado.'); }

    if (action === 'tx') {
      const tx = await Transaction.findById(value).populate('category').populate('account');
      if (!tx) return ctx.reply('❌ Movimiento no encontrado.');
      updateSession(ctx.chat.id, { data: { txId: tx._id }, step: 'confirm' });

      const cat = tx.category ? tx.category.name : tx.type === 'transfer' ? 'Transferencia' : '—';
      const lines = [
        `Tipo: ${tx.type}`,
        `Monto: $${fmt(tx.amountUSD)} USD`,
        `Categoría: ${cat}`,
        `Cuenta: ${tx.account ? tx.account.name : '—'}`,
        `Fecha: ${formatDate(tx.date)}`,
      ];
      if (tx.note) lines.push(`Nota: ${tx.note}`);
      await ctx.reply(
        `🗑️ *¿Eliminar este movimiento?*\n\n${lines.join('\n')}`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Sí, eliminar', 'el:ok'), CANCEL_BTN]]) }
      );
      return;
    }

    if (action === 'ok') {
      const { data } = getSession(ctx.chat.id);
      const tx = await Transaction.findById(data.txId);
      if (!tx) { clearSession(ctx.chat.id); return ctx.reply('❌ Movimiento no encontrado.'); }

      // Reverse account balance
      if (tx.type === 'expense') {
        await updateAccountBalance(tx.account, tx.amountUSD); // add back
      } else if (tx.type === 'income') {
        await updateAccountBalance(tx.account, -tx.amountUSD); // remove
      } else if (tx.type === 'transfer') {
        await updateAccountBalance(tx.account, tx.amountUSD); // restore source
        if (tx.toAccount) await updateAccountBalance(tx.toAccount, -tx.amountUSD); // restore dest
      }

      await Transaction.findByIdAndDelete(data.txId);
      clearSession(ctx.chat.id);
      await ctx.reply('✅ *Movimiento eliminado.*', { parse_mode: 'Markdown' });
    }
  });
}

module.exports = { register };
