const { Markup } = require('telegraf');
const Account = require('../models/Account');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const Loan = require('../models/Loan');
const Period = require('../models/Period');
const {
  fmt, calculateNetBalance, getMonthlySpending, netBalanceText, formatDate,
} = require('../utils/helpers');

const MENU_BTN = Markup.button.callback('🔙 Volver', 'co:menu');

async function startConsultas(ctx) {
  await ctx.reply(
    '📊 *Consultas*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💰 Saldo neto', 'co:net'), Markup.button.callback('🏦 Cuentas', 'co:acc')],
        [Markup.button.callback('📋 Presupuesto', 'co:bud'), Markup.button.callback('🤝 Préstamos', 'co:lns')],
        [Markup.button.callback('📅 Resumen periodo', 'co:per'), Markup.button.callback('🕐 Últimos 10', 'co:lst')],
      ]),
    }
  );
}

async function showNetBalance(ctx) {
  const bal = await calculateNetBalance();
  const lines = [
    `💸 *Deuda gastos compartidos:* $${fmt(Math.abs(bal.saldoDeuda))} ${bal.saldoDeuda >= 0 ? '(Nohelia debe)' : '(Antonio debe)'}`,
    `🤝 *Préstamos activos:* $${fmt(Math.abs(bal.saldoPrestamos))} ${bal.saldoPrestamos >= 0 ? '(Nohelia debe)' : '(Antonio debe)'}`,
    '',
    `📊 *Total:* ${netBalanceText(bal)}`,
  ];
  await ctx.reply(`*Saldo neto*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[MENU_BTN]]) });
}

async function showAccounts(ctx) {
  const accounts = await Account.find({ isActive: true }).populate('owner').sort({ 'owner.name': 1, name: 1 });
  const grouped = {};
  for (const a of accounts) {
    const name = a.owner.name;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(`  • ${a.name}: *$${fmt(a.balance)}* (${a.originalCurrency})`);
  }
  const lines = Object.entries(grouped).map(([name, accs]) => `👤 *${name}*\n${accs.join('\n')}`);
  await ctx.reply(`🏦 *Saldo de cuentas*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[MENU_BTN]]) });
}

async function showBudget(ctx) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const month = now.toLocaleString('es-MX', { month: 'long', year: 'numeric' });

  const categories = await Category.find({ transactionType: 'expense', monthlyBudget: { $ne: null } }).populate('owner');
  if (categories.length === 0) {
    return ctx.reply('📋 No hay categorías con presupuesto definido.');
  }

  const grouped = {};
  for (const cat of categories) {
    const spent = await getMonthlySpending(cat._id);
    const pct = cat.monthlyBudget > 0 ? (spent / cat.monthlyBudget) * 100 : 0;
    const over = spent > cat.monthlyBudget;
    const name = cat.owner.name;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(`  ${over ? '⚠️' : '✅'} ${cat.name}: $${fmt(spent)} / $${fmt(cat.monthlyBudget)} (${pct.toFixed(0)}%)`);
  }

  const lines = Object.entries(grouped).map(([name, rows]) => `👤 *${name}*\n${rows.join('\n')}`);
  await ctx.reply(
    `📋 *Presupuesto — ${month}*\n\n${lines.join('\n\n')}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[MENU_BTN]]) }
  );
}

async function showLoans(ctx) {
  const loans = await Loan.find({ status: 'active' });
  if (loans.length === 0) return ctx.reply('✅ No hay préstamos activos.', { ...Markup.inlineKeyboard([[MENU_BTN]]) });

  const { nohelia, antonio } = ctx.users;
  const lines = loans.map((loan, i) => {
    const lender = loan.direction === 'himToHer' ? nohelia.name : antonio.name;
    const borrower = loan.direction === 'himToHer' ? antonio.name : nohelia.name;
    return `${i + 1}. ${lender} → ${borrower}\n   Original: $${fmt(loan.amountUSD)} | Pendiente: *$${fmt(loan.remainingAmountUSD)}*${loan.note ? `\n   📝 ${loan.note}` : ''}`;
  });
  await ctx.reply(
    `🤝 *Préstamos activos*\n\n${lines.join('\n\n')}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[MENU_BTN]]) }
  );
}

async function showPeriod(ctx) {
  const period = await Period.findOne({ isActive: true });
  if (!period) return ctx.reply('❌ No hay periodo activo.');

  const txs = await Transaction.find({ date: { $gte: period.startDate } })
    .populate('category')
    .populate('account')
    .populate('owner')
    .sort({ date: 1 });

  if (txs.length === 0) return ctx.reply(`📅 No hay movimientos desde el ${formatDate(period.startDate)}.`);

  const { nohelia, antonio } = ctx.users;
  const lines = [`📅 *Resumen del periodo*\n_Desde ${formatDate(period.startDate)}_\n`];

  // ── Movimientos por categoría ──────────────────────────────────────────────
  const byCategory = {};
  for (const tx of txs) {
    const key = tx.category ? tx.category.name : tx.type === 'transfer' ? '🔄 Transferencias' : 'Sin categoría';
    const owner = tx.owner ? tx.owner.name : '';
    const label = `${key} (${owner})`;
    if (!byCategory[label]) byCategory[label] = { total: 0, items: [] };
    byCategory[label].total += tx.amountUSD;
    const note = tx.note ? ` — ${tx.note}` : '';
    byCategory[label].items.push(`    ${formatDate(tx.date)} $${fmt(tx.amountUSD)}${note}`);
  }

  for (const [cat, { total, items }] of Object.entries(byCategory)) {
    lines.push(`*${cat}:* $${fmt(total)}`);
    lines.push(...items);
  }

  // ── Deudas generadas por gastos compartidos ────────────────────────────────
  const sharedTxs = txs.filter(tx => tx.isShared && tx.debtAmount > 0);

  if (sharedTxs.length > 0) {
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('💸 *Deudas por gastos compartidos*\n');

    const toHim = sharedTxs.filter(tx => tx.debtDirection === 'toHim');
    const toHer = sharedTxs.filter(tx => tx.debtDirection === 'toHer');

    if (toHim.length > 0) {
      const total = toHim.reduce((s, tx) => s + tx.debtAmount, 0);
      lines.push(`👤 *${nohelia.name} debe a ${antonio.name}:* $${fmt(total)}`);
      for (const tx of toHim) {
        const concept = tx.note || (tx.category ? tx.category.name : 'Sin concepto');
        lines.push(`    ${formatDate(tx.date)} $${fmt(tx.debtAmount)} — ${concept}`);
      }
    }

    if (toHer.length > 0) {
      if (toHim.length > 0) lines.push('');
      const total = toHer.reduce((s, tx) => s + tx.debtAmount, 0);
      lines.push(`👤 *${antonio.name} debe a ${nohelia.name}:* $${fmt(total)}`);
      for (const tx of toHer) {
        const concept = tx.note || (tx.category ? tx.category.name : 'Sin concepto');
        lines.push(`    ${formatDate(tx.date)} $${fmt(tx.debtAmount)} — ${concept}`);
      }
    }

    const netPeriod = toHim.reduce((s, tx) => s + tx.debtAmount, 0)
                    - toHer.reduce((s, tx) => s + tx.debtAmount, 0);
    lines.push('');
    if (Math.abs(netPeriod) < 0.01) {
      lines.push('📊 *Neto del periodo:* a mano 🎉');
    } else if (netPeriod > 0) {
      lines.push(`📊 *Neto del periodo:* ${nohelia.name} debe $${fmt(netPeriod)} a ${antonio.name}`);
    } else {
      lines.push(`📊 *Neto del periodo:* ${antonio.name} debe $${fmt(Math.abs(netPeriod))} a ${nohelia.name}`);
    }
  }

  const msg = lines.join('\n');
  if (msg.length > 4000) {
    await ctx.reply(msg.substring(0, 4000) + '\n…_(truncado)_', { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[MENU_BTN]]) });
  }
}

async function showLast10(ctx) {
  const txs = await Transaction.find()
    .populate('category')
    .populate('account')
    .populate('owner')
    .sort({ date: -1 })
    .limit(10);

  if (txs.length === 0) return ctx.reply('📭 No hay movimientos registrados.');

  const typeEmoji = { expense: '💸', income: '💰', transfer: '🔄' };
  const lines = txs.map((tx, i) => {
    const cat = tx.category ? tx.category.name : tx.type === 'transfer' ? 'Transferencia' : '—';
    const note = tx.note ? ` — ${tx.note}` : '';
    return `${i + 1}. ${typeEmoji[tx.type]} *$${fmt(tx.amountUSD)}* ${cat}${note}\n   ${formatDate(tx.date)} · ${tx.account ? tx.account.name : ''}`;
  });

  await ctx.reply(
    `🕐 *Últimos 10 movimientos*\n\n${lines.join('\n\n')}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[MENU_BTN]]) }
  );
}

function register(bot) {
  bot.command('consultas', startConsultas);
  bot.action(/^mn:co$/, async (ctx) => { await ctx.answerCbQuery(); await startConsultas(ctx); });

  bot.action(/^co:/, async (ctx) => {
    await ctx.answerCbQuery();
    const action = ctx.callbackQuery.data.split(':')[1];

    if (action === 'menu') { await startConsultas(ctx); return; }
    if (action === 'net') { await showNetBalance(ctx); return; }
    if (action === 'acc') { await showAccounts(ctx); return; }
    if (action === 'bud') { await showBudget(ctx); return; }
    if (action === 'lns') { await showLoans(ctx); return; }
    if (action === 'per') { await showPeriod(ctx); return; }
    if (action === 'lst') { await showLast10(ctx); return; }
  });
}

module.exports = { register };
