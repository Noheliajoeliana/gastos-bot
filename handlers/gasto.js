const { Markup } = require('telegraf');
const Account = require('../models/Account');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { getSession, setSession, clearSession, updateSession } = require('../utils/session');
const {
  toUSD, fmt, getFrequentConfig, updateAccountBalance,
  calculateDebt, getMonthlySpending,
} = require('../utils/helpers');

const CANCEL_BTN = Markup.button.callback('❌ Cancelar', 'g:x');

async function startGasto(ctx) {
  clearSession(ctx.chat.id);
  setSession(ctx.chat.id, { command: 'gasto', step: 'init', data: {} });

  const freq = await getFrequentConfig(ctx.user._id);
  if (freq) {
    const accWithOwner = await Account.findById(freq.account._id).populate('owner');
    const splitLabel = freq.splitType === 'proportional'
      ? `${ctx.users.nohelia.defaultSplit}/${ctx.users.antonio.defaultSplit}`
      : '50/50';
    updateSession(ctx.chat.id, {
      step: 'freqCheck',
      data: {
        freqAccountId: freq.account._id,
        freqAccountCurrency: accWithOwner.originalCurrency,
        freqSplitType: freq.splitType,
      },
    });
    await ctx.reply(
      `⚡ *¿Usar configuración frecuente?*\n_(${freq.account.name} de ${accWithOwner.owner.name}, ${splitLabel})_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Sí', 'g:freq:y'), Markup.button.callback('🔄 No, cambiar', 'g:freq:n')],
          [CANCEL_BTN],
        ]),
      }
    );
  } else {
    await askAccountOwner(ctx);
  }
}

async function askAccountOwner(ctx) {
  updateSession(ctx.chat.id, { step: 'selectOwner' });
  const otherName = ctx.otherUser.name;
  await ctx.reply(
    '👤 *¿De quién es la cuenta?*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🙋 Mía', 'g:own:mine'), Markup.button.callback(`👤 De ${otherName}`, 'g:own:his')],
        [CANCEL_BTN],
      ]),
    }
  );
}

async function askAccount(ctx, ownerId, ownerName) {
  const accounts = await Account.find({ owner: ownerId, isActive: true });
  if (accounts.length === 0) return ctx.reply(`❌ ${ownerName} no tiene cuentas activas.`);
  updateSession(ctx.chat.id, { step: 'selectAccount' });
  const buttons = accounts.map(a =>
    [Markup.button.callback(`${a.name} ($${fmt(a.balance)})`, `g:acc:${a._id}`)]
  );
  buttons.push([CANCEL_BTN]);
  await ctx.reply(
    `🏦 *¿De qué cuenta de ${ownerName}?*`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
}

async function askAmount(ctx) {
  updateSession(ctx.chat.id, { step: 'enterAmount' });
  await ctx.reply('💵 *¿Cuánto?* Escribe el monto:', { parse_mode: 'Markdown' });
}

async function askCurrency(ctx, prefix) {
  updateSession(ctx.chat.id, { step: 'selectCurrency' });
  const s = getSession(ctx.chat.id);
  const cur = s.data.accountCurrency || 'MXN';
  await ctx.reply(
    '💱 *¿En qué moneda?*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🇺🇸 USD', `${prefix}:usd`), Markup.button.callback(`🔢 ${cur}`, `${prefix}:oth`)],
        [CANCEL_BTN],
      ]),
    }
  );
}

async function askShared(ctx) {
  updateSession(ctx.chat.id, { step: 'selectShared' });
  await ctx.reply(
    '🤝 *¿Es compartido?*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👤 Solo mío', 'g:shr:n'), Markup.button.callback('👥 Compartido', 'g:shr:y')],
        [CANCEL_BTN],
      ]),
    }
  );
}

async function askSplit(ctx) {
  updateSession(ctx.chat.id, { step: 'selectSplit' });
  const { nohelia, antonio } = ctx.users;
  await ctx.reply(
    '⚖️ *¿Cómo se divide?*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('50 / 50', 'g:spl:eq'),
          Markup.button.callback(`${nohelia.defaultSplit} / ${antonio.defaultSplit}`, 'g:spl:pr'),
        ],
        [CANCEL_BTN],
      ]),
    }
  );
}

async function askCategoryForUser(ctx, user, callbackPrefix, title) {
  const cats = await Category.find({ owner: user._id, transactionType: 'expense' });
  if (cats.length === 0) return ctx.reply(`❌ ${user.name} no tiene categorías de gasto configuradas.`);
  const step = callbackPrefix === 'g:caN' ? 'selectCatN' : 'selectCatA';
  updateSession(ctx.chat.id, { step });
  const buttons = cats.map(c => [Markup.button.callback(c.name, `${callbackPrefix}:${c._id}`)]);
  buttons.push([CANCEL_BTN]);
  await ctx.reply(`🏷️ *${title}*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askExpenseOwner(ctx) {
  updateSession(ctx.chat.id, { step: 'selectExpenseOwner' });
  const otherName = ctx.otherUser.name;
  await ctx.reply(
    '👤 *¿De quién es el gasto?*',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🙋 Mío', 'g:ono:mine'), Markup.button.callback(`👤 De ${otherName}`, 'g:ono:his')],
        [CANCEL_BTN],
      ]),
    }
  );
}

async function askCategory(ctx, ownerId) {
  const cats = await Category.find({ owner: ownerId, transactionType: 'expense' });
  const owner = await User.findById(ownerId);
  if (cats.length === 0) return ctx.reply(`❌ ${owner.name} no tiene categorías de gasto.`);
  updateSession(ctx.chat.id, { step: 'selectCategory' });
  const buttons = cats.map(c => [Markup.button.callback(c.name, `g:cat:${c._id}`)]);
  buttons.push([CANCEL_BTN]);
  await ctx.reply('🏷️ *¿Categoría?*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function askNote(ctx) {
  updateSession(ctx.chat.id, { step: 'enterNote' });
  await ctx.reply(
    '📝 *¿Nota?* Escribe texto o salta:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⏭️ Omitir', 'g:nte:sk'), CANCEL_BTN]]),
    }
  );
}

async function askConfirm(ctx) {
  const { data } = getSession(ctx.chat.id);
  const account = await Account.findById(data.accountId).populate('owner');
  const splitLabel = data.splitType === 'proportional'
    ? `${ctx.users.nohelia.defaultSplit}/${ctx.users.antonio.defaultSplit}`
    : '50/50';

  const lines = [
    `💳 *Cuenta:* ${account.name} (${account.owner.name})`,
    `💵 *Total pagado:* ${fmt(data.amount)} ${data.currency}${data.currency !== 'USD' ? ` = $${fmt(data.amountUSD)} USD` : ''}`,
  ];

  if (data.isShared) {
    const debt = calculateDebt(account.owner._id, data.amountUSD, data.splitType, ctx.users.nohelia, ctx.users.antonio);
    const payerPortion = data.amountUSD - debt.debtAmount;
    const catN = data.categoryNId ? await Category.findById(data.categoryNId) : null;
    const catA = data.categoryAId ? await Category.findById(data.categoryAId) : null;
    const debtor = debt.debtDirection === 'toHim' ? ctx.users.nohelia.name : ctx.users.antonio.name;
    const creditor = debt.debtDirection === 'toHim' ? ctx.users.antonio.name : ctx.users.nohelia.name;
    lines.push(`👥 *Compartido:* ${splitLabel}`);
    lines.push(`💵 *Gasto de ${account.owner.name}:* $${fmt(payerPortion)} USD`);
    lines.push(`💸 *Deuda de ${debtor}:* $${fmt(debt.debtAmount)} USD → ${creditor}`);
    if (catN) lines.push(`🏷️ *Cat. ${ctx.users.nohelia.name}:* ${catN.name}`);
    if (catA) lines.push(`🏷️ *Cat. ${ctx.users.antonio.name}:* ${catA.name}`);
  } else {
    const expenseOwner = data.expenseOwnerId ? await User.findById(data.expenseOwnerId) : account.owner;
    const cat = data.categoryId ? await Category.findById(data.categoryId) : null;
    lines.push(`👤 *Gasto de:* ${expenseOwner.name}`);
    if (cat) lines.push(`🏷️ *Categoría:* ${cat.name}`);
    if (!account.owner._id.equals(expenseOwner._id)) {
      const dir = account.owner._id.equals(ctx.users.antonio._id) ? 'toHim' : 'toHer';
      const debtor = dir === 'toHim' ? ctx.users.nohelia.name : ctx.users.antonio.name;
      const creditor = dir === 'toHim' ? ctx.users.antonio.name : ctx.users.nohelia.name;
      lines.push(`💸 *Deuda generada:* ${debtor} → ${creditor} $${fmt(data.amountUSD)} USD`);
    }
  }

  if (data.note) lines.push(`📝 *Nota:* ${data.note}`);

  updateSession(ctx.chat.id, { step: 'confirm' });
  await ctx.reply(
    `*Resumen del gasto:*\n\n${lines.join('\n')}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('✅ Confirmar', 'g:ok'), CANCEL_BTN]]),
    }
  );
}

async function confirmGasto(ctx) {
  const { data } = getSession(ctx.chat.id);
  const account = await Account.findById(data.accountId).populate('owner');
  const { nohelia, antonio } = ctx.users;

  const base = {
    type: 'expense',
    amount: data.amount,
    currency: data.currency,
    exchangeRate: data.exchangeRate,
    amountUSD: data.amountUSD,
    account: data.accountId,
    registeredBy: ctx.user._id,
    note: data.note || null,
  };

  if (data.isShared) {
    const debt = calculateDebt(account.owner._id, data.amountUSD, data.splitType, nohelia, antonio);
    const payerAmountUSD = data.amountUSD - debt.debtAmount; // payer's own portion only

    // Main transaction: payer's portion only (not the full amount)
    await Transaction.create({
      ...base,
      amountUSD: payerAmountUSD,
      owner: account.owner._id,
      category: account.owner._id.equals(nohelia._id) ? data.categoryNId : data.categoryAId,
      isShared: true,
      splitType: data.splitType,
      splitHers: nohelia.defaultSplit,
      splitHis: antonio.defaultSplit,
      debtDirection: debt.debtDirection,
      debtAmount: debt.debtAmount,
    });

    // Budget transaction for the other user (their portion)
    const otherCategoryId = account.owner._id.equals(nohelia._id) ? data.categoryAId : data.categoryNId;
    const otherId = account.owner._id.equals(nohelia._id) ? antonio._id : nohelia._id;
    if (otherCategoryId) {
      await Transaction.create({
        ...base,
        amountUSD: debt.debtAmount,
        owner: otherId,
        category: otherCategoryId,
        isShared: false,
      });
    }
  } else {
    const expenseOwnerId = data.expenseOwnerId || account.owner._id;
    const crossOwner = !account.owner._id.equals(expenseOwnerId);
    const debtFields = crossOwner
      ? {
          debtDirection: account.owner._id.equals(antonio._id) ? 'toHim' : 'toHer',
          debtAmount: data.amountUSD,
        }
      : {};
    await Transaction.create({
      ...base,
      owner: expenseOwnerId,
      category: data.categoryId || null,
      isShared: false,
      ...debtFields,
    });
  }

  await updateAccountBalance(data.accountId, -data.amountUSD);
  clearSession(ctx.chat.id);
  await ctx.reply('✅ *Gasto registrado.*', { parse_mode: 'Markdown' });

  // Budget alerts
  const catIds = data.isShared
    ? [data.categoryNId, data.categoryAId].filter(Boolean)
    : [data.categoryId].filter(Boolean);

  for (const catId of catIds) {
    const cat = await Category.findById(catId).populate('owner');
    if (!cat || !cat.monthlyBudget) continue;
    const spent = await getMonthlySpending(catId);
    if (spent > cat.monthlyBudget) {
      await ctx.reply(
        `⚠️ *Presupuesto excedido:* ${cat.owner.name} — ${cat.name}\n$${fmt(spent)} / $${fmt(cat.monthlyBudget)}`,
        { parse_mode: 'Markdown' }
      );
    }
  }
}

// After setting currency, decide next step based on whether freq config is active
async function afterCurrency(ctx) {
  const s = getSession(ctx.chat.id);
  if (s.data.isFreq) {
    // Frequent config: isShared=true and splitType are already set — go to categories
    await askCategoryForUser(ctx, ctx.users.nohelia, 'g:caN', `Categoría de ${ctx.users.nohelia.name}`);
  } else {
    await askShared(ctx);
  }
}

function register(bot) {
  bot.command('gasto', startGasto);
  bot.action(/^mn:g$/, async (ctx) => { await ctx.answerCbQuery(); await startGasto(ctx); });

  bot.action(/^g:/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const value = parts.slice(2).join(':');
    const session = getSession(ctx.chat.id);
    if (!session || session.command !== 'gasto') return;

    if (action === 'x') {
      clearSession(ctx.chat.id);
      return ctx.reply('❌ Flujo cancelado. Usa /menu para empezar.');
    }

    if (action === 'freq') {
      if (value === 'y') {
        const s = getSession(ctx.chat.id);
        updateSession(ctx.chat.id, {
          data: {
            accountId: s.data.freqAccountId,
            accountCurrency: s.data.freqAccountCurrency,
            splitType: s.data.freqSplitType,
            isShared: true,
            isFreq: true,
          },
        });
        await askAmount(ctx);
      } else {
        updateSession(ctx.chat.id, { data: {} });
        await askAccountOwner(ctx);
      }
      return;
    }

    if (action === 'own') {
      const owner = value === 'mine' ? ctx.user : ctx.otherUser;
      updateSession(ctx.chat.id, { data: { accountOwnerId: owner._id } });
      await askAccount(ctx, owner._id, owner.name);
      return;
    }

    if (action === 'acc') {
      const account = await Account.findById(value);
      updateSession(ctx.chat.id, {
        data: {
          ...getSession(ctx.chat.id).data,
          accountId: account._id,
          accountCurrency: account.originalCurrency,
        },
      });
      await askAmount(ctx);
      return;
    }

    if (action === 'cur') {
      const s = getSession(ctx.chat.id);
      if (value === 'usd') {
        updateSession(ctx.chat.id, {
          data: { ...s.data, currency: 'USD', exchangeRate: 1, amountUSD: s.data.amount },
        });
        await afterCurrency(ctx);
      } else {
        const cur = s.data.accountCurrency || 'MXN';
        updateSession(ctx.chat.id, { step: 'enterRate', data: { ...s.data, currency: cur } });
        await ctx.reply(
          `🔢 *¿Tasa de cambio?*\n_¿Cuántos ${cur} equivalen a 1 USD?_`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    if (action === 'shr') {
      const isShared = value === 'y';
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, isShared } });
      if (isShared) {
        await askSplit(ctx);
      } else {
        await askExpenseOwner(ctx);
      }
      return;
    }

    if (action === 'spl') {
      const splitType = value === 'pr' ? 'proportional' : 'equal';
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, splitType } });
      await askCategoryForUser(ctx, ctx.users.nohelia, 'g:caN', `Categoría de ${ctx.users.nohelia.name}`);
      return;
    }

    if (action === 'caN') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, categoryNId: value } });
      await askCategoryForUser(ctx, ctx.users.antonio, 'g:caA', `Categoría de ${ctx.users.antonio.name}`);
      return;
    }

    if (action === 'caA') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, categoryAId: value } });
      await askNote(ctx);
      return;
    }

    if (action === 'ono') {
      const owner = value === 'mine' ? ctx.user : ctx.otherUser;
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, expenseOwnerId: owner._id } });
      await askCategory(ctx, owner._id);
      return;
    }

    if (action === 'cat') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, categoryId: value } });
      await askNote(ctx);
      return;
    }

    if (action === 'nte' && value === 'sk') {
      updateSession(ctx.chat.id, { data: { ...getSession(ctx.chat.id).data, note: null } });
      await askConfirm(ctx);
      return;
    }

    if (action === 'ok') {
      await confirmGasto(ctx);
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
    const s = getSession(ctx.chat.id);
    const cur = s.data.accountCurrency || 'MXN';
    await ctx.reply(
      '💱 *¿En qué moneda?*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🇺🇸 USD', 'g:cur:usd'), Markup.button.callback(`🔢 ${cur}`, 'g:cur:oth')],
          [CANCEL_BTN],
        ]),
      }
    );
    return;
  }

  if (session.step === 'enterRate') {
    const rate = parseFloat(text);
    if (isNaN(rate) || rate <= 0) return ctx.reply('❌ Ingresa una tasa válida (número positivo).');
    const amountUSD = toUSD(session.data.amount, rate);
    updateSession(ctx.chat.id, { data: { ...session.data, exchangeRate: rate, amountUSD } });
    await afterCurrency(ctx);
    return;
  }

  if (session.step === 'enterNote') {
    updateSession(ctx.chat.id, { data: { ...session.data, note: text } });
    await askConfirm(ctx);
  }
}

module.exports = { register, handleText };
