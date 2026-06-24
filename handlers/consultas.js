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
    .populate({ path: 'account', populate: { path: 'owner' } })
    .populate({ path: 'toAccount', populate: { path: 'owner' } })
    .populate('owner')
    .sort({ date: 1 });

  const { nohelia, antonio } = ctx.users;
  const lines = [`📅 *Resumen del periodo*\n_Desde ${formatDate(period.startDate)}_`];

  function buildUserSection(user) {
    const section = [];
    const nonTransfers = txs.filter(tx => tx.type !== 'transfer' && tx.owner && tx.owner._id.equals(user._id));
    const transfers = txs.filter(tx =>
      tx.type === 'transfer' && tx.account && tx.account.owner && tx.account.owner._id.equals(user._id)
    );

    const byCategory = {};
    for (const tx of nonTransfers) {
      const catName = tx.category ? tx.category.name : (tx.type === 'income' ? 'Ingresos sin categoría' : 'Sin categoría');
      if (!byCategory[catName]) byCategory[catName] = { total: 0, items: [] };
      byCategory[catName].total += tx.amountUSD;
      const acct = tx.account ? ` [${tx.account.name}]` : '';
      const note = tx.note ? ` — ${tx.note}` : '';
      byCategory[catName].items.push(`    ${formatDate(tx.date)} $${fmt(tx.amountUSD)}${acct}${note}`);
    }

    for (const [cat, { total, items }] of Object.entries(byCategory)) {
      section.push(`  🏷 *${cat}:* $${fmt(total)}`);
      section.push(...items);
    }

    if (transfers.length > 0) {
      if (section.length > 0) section.push('');
      section.push('  🔄 *Transferencias:*');
      for (const tx of transfers) {
        const dest = tx.toAccount ? `${tx.toAccount.name} (${tx.toAccount.owner ? tx.toAccount.owner.name : '?'})` : '?';
        const note = tx.note ? ` — ${tx.note}` : '';
        section.push(`    ${formatDate(tx.date)} $${fmt(tx.amountUSD)} → ${dest}${note}`);
      }
    }

    return section;
  }

  // 1. Antonio
  lines.push('');
  lines.push(`👤 *${antonio.name}*`);
  const antonioLines = buildUserSection(antonio);
  lines.push(...(antonioLines.length > 0 ? antonioLines : ['  _sin movimientos_']));

  // 2. Nohelia
  lines.push('');
  lines.push(`👤 *${nohelia.name}*`);
  const noheliaLines = buildUserSection(nohelia);
  lines.push(...(noheliaLines.length > 0 ? noheliaLines : ['  _sin movimientos_']));

  // 3. Préstamos activos
  const loans = await Loan.find({ status: 'active' });
  lines.push('');
  lines.push('🤝 *Préstamos activos*');
  if (loans.length === 0) {
    lines.push('  _ninguno_');
  } else {
    for (const loan of loans) {
      const lender = loan.direction === 'himToHer' ? nohelia.name : antonio.name;
      const borrower = loan.direction === 'himToHer' ? antonio.name : nohelia.name;
      const noteStr = loan.note ? ` — ${loan.note}` : '';
      lines.push(`  • ${lender} → ${borrower}: *$${fmt(loan.remainingAmountUSD)}* pendiente${noteStr}`);
    }
  }

  // 4. Deuda neta global
  const bal = await calculateNetBalance();
  lines.push('');
  lines.push(`💸 *Deuda neta:* ${netBalanceText(bal)}`);

  const msg = lines.join('\n');
  if (msg.length > 4000) {
    await ctx.reply(msg.substring(0, 4000) + '\n_…(truncado)_', { parse_mode: 'Markdown' });
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
