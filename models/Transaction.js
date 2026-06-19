const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['expense', 'income', 'transfer'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  exchangeRate: { type: Number, required: true, default: 1 },
  amountUSD: { type: Number, required: true },
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  date: { type: Date, default: Date.now },
  note: { type: String, default: null },
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },

  isShared: { type: Boolean, default: false },
  splitType: { type: String, enum: ['equal', 'proportional', null], default: null },
  splitHers: { type: Number, default: null },
  splitHis: { type: Number, default: null },
  debtDirection: { type: String, enum: ['toHim', 'toHer', null], default: null },
  debtAmount: { type: Number, default: null },

  toAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
