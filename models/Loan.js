const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema({
  direction: { type: String, enum: ['herToHim', 'himToHer'], required: true },
  originalAmount: { type: Number, required: true },
  remainingAmount: { type: Number, required: true },
  currency: { type: String, required: true },
  exchangeRate: { type: Number, required: true, default: 1 },
  amountUSD: { type: Number, required: true },
  remainingAmountUSD: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  note: { type: String, default: null },
  status: { type: String, enum: ['active', 'settled'], default: 'active' },
}, { timestamps: true });

module.exports = mongoose.model('Loan', loanSchema);
