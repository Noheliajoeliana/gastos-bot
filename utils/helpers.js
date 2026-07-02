const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const DebtPayment = require('../models/DebtPayment');
const Loan = require('../models/Loan');
const Account = require('../models/Account');

function toUSD(amount, exchangeRate) {
  return amount / exchangeRate;
}

function fmt(n) {
  return n.toFixed(2);
}

async function calculateNetBalance() {
  const [User] = [require('../models/User')];
  const nohelia = await User.findOne({ name: 'Nohelia' });
  const antonio = await User.findOne({ name: 'Antonio' });

  const sharedExpenses = await Transaction.find({ type: 'expense', debtDirection: { $in: ['toHim', 'toHer'] } });
  let toHimTotal = 0;
  let toHerTotal = 0;
  for (const exp of sharedExpenses) {
    if (exp.debtDirection === 'toHim') toHimTotal += exp.debtAmount;
    else if (exp.debtDirection === 'toHer') toHerTotal += exp.debtAmount;
  }

  const payments = await DebtPayment.find();
  let noheliaPayments = 0;
  let antonioPayments = 0;
  for (const p of payments) {
    if (p.paidBy.equals(nohelia._id)) noheliaPayments += p.amountUSD;
    else antonioPayments += p.amountUSD;
  }

  // positive → Nohelia owes Antonio
  const saldoDeuda = toHimTotal - toHerTotal - noheliaPayments + antonioPayments;

  const loans = await Loan.find({ status: 'active' });
  let herToHimTotal = 0; // Nohelia owes Antonio (Antonio lent to her)
  let himToHerTotal = 0; // Antonio owes Nohelia (Nohelia lent to him)
  for (const loan of loans) {
    if (loan.direction === 'herToHim') herToHimTotal += loan.remainingAmountUSD;
    else himToHerTotal += loan.remainingAmountUSD;
  }
  const saldoPrestamos = herToHimTotal - himToHerTotal;

  const saldoTotal = saldoDeuda + saldoPrestamos;

  return { saldoDeuda, saldoPrestamos, saldoTotal, nohelia, antonio };
}

async function getMonthlySpending(categoryId) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const result = await Transaction.aggregate([
    {
      $match: {
        category: new mongoose.Types.ObjectId(categoryId),
        type: 'expense',
        date: { $gte: startOfMonth, $lte: endOfMonth },
      },
    },
    { $group: { _id: null, total: { $sum: '$amountUSD' } } },
  ]);

  return result.length > 0 ? result[0].total : 0;
}

async function getFrequentConfig(userId) {
  const recent = await Transaction.find({
    type: 'expense',
    isShared: true,
    registeredBy: userId,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('account');

  if (recent.length < 3) return null;

  const counts = {};
  for (const t of recent) {
    const key = `${t.account._id}:${t.splitType}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [topKey, topCount] = sorted[0];

  if (topCount / recent.length < 0.6) return null;

  const [accountId, splitType] = topKey.split(':');
  const account = recent.find(t => t.account._id.toString() === accountId).account;

  return { account, splitType };
}

async function updateAccountBalance(accountId, delta) {
  await Account.findByIdAndUpdate(accountId, { $inc: { balance: delta } });
}

function calculateDebt(accountOwnerId, amountUSD, splitType, nohelia, antonio) {
  const isAntonioAccount = accountOwnerId.equals(antonio._id);
  const splitHers = splitType === 'proportional' ? nohelia.defaultSplit : 50;
  const splitHis = splitType === 'proportional' ? antonio.defaultSplit : 50;

  if (isAntonioAccount) {
    return {
      debtDirection: 'toHim',
      debtAmount: amountUSD * (splitHers / 100),
      splitHers,
      splitHis,
    };
  } else {
    return {
      debtDirection: 'toHer',
      debtAmount: amountUSD * (splitHis / 100),
      splitHers,
      splitHis,
    };
  }
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'America/Mexico_City',
  });
}

function netBalanceText(bal) {
  const { saldoTotal, nohelia, antonio } = bal;
  if (Math.abs(saldoTotal) < 0.01) return '¡Están a mano! 🎉';
  if (saldoTotal > 0) return `${nohelia.name} le debe *$${fmt(Math.abs(saldoTotal))}* a ${antonio.name}`;
  return `${antonio.name} le debe *$${fmt(Math.abs(saldoTotal))}* a ${nohelia.name}`;
}

module.exports = {
  toUSD,
  fmt,
  calculateNetBalance,
  getMonthlySpending,
  getFrequentConfig,
  updateAccountBalance,
  calculateDebt,
  formatDate,
  netBalanceText,
};
