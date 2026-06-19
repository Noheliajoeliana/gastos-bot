const mongoose = require('mongoose');

const debtPaymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  exchangeRate: { type: Number, required: true, default: 1 },
  amountUSD: { type: Number, required: true },
  fromAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  toAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, default: Date.now },
  note: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('DebtPayment', debtPaymentSchema);
