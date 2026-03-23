const mongoose = require('mongoose');

/**
 * Mongoose schema for an individual (non-shared) debt between the two users.
 *
 * Unlike shared expenses, individual debts are not tied to a billing week —
 * they accumulate independently and are settled all at once during a /corte.
 * Keeping them in a separate collection avoids polluting the weekly expense
 * aggregate with one-sided transactions (e.g. one person lending money to the
 * other for a personal purchase).
 *
 * Fields:
 *   debtorId    - Telegram numeric ID of the user who owes the money.
 *   creditorId  - Telegram numeric ID of the user who is owed the money.
 *   amount      - Debt amount in USD (bolívar amounts are converted at entry time).
 *   description - Human-readable reason for the debt.
 *   settled     - False while the debt is outstanding; set to true on /corte.
 *   settledAt   - Timestamp of when the debt was marked as settled; null while open.
 */
const debtSchema = new mongoose.Schema({
  debtorId: {
    type: Number,
    required: true
  },
  creditorId: {
    type: Number,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  settled: {
    type: Boolean,
    default: false
  },
  settledAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Debt', debtSchema);