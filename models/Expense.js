const mongoose = require('mongoose');

/**
 * Mongoose schema for a weekly expense document.
 *
 * All expenses that occur within the same billing week are stored as a single
 * document (one document per week) using an embedded array. This denormalized
 * design was chosen to simplify weekly summaries and the reset flow: marking
 * one document as processed is enough to close the week without touching
 * individual expense records.
 *
 * Fields:
 *   weekStart     - The Sunday 19:01 timestamp that opens this billing period.
 *   weekEnd       - Set when the week is settled via /corte; null while still active.
 *   processed     - False while the week is open; set to true after the weekly
 *                   summary is sent and all balances are settled.
 *
 * Embedded expense fields:
 *   userId        - Telegram numeric ID of the user who paid.
 *   amount        - Raw amount as entered by the user (USD or bolívars).
 *   method        - "cash" (USD) or "bs" (Venezuelan bolívars).
 *   rate          - Exchange rate in bs/USD; null when method is "cash".
 *   description   - Human-readable label for the expense.
 *   isProportional- If true, the expense is split by income proportion instead of 50/50.
 *   date          - Timestamp of when the expense was registered.
 */
const expenseSchema = new mongoose.Schema({
  weekStart: {
    type: Date,
    required: true
  },
  weekEnd: {
    type: Date,
    default: null
  },
  processed: {
    type: Boolean,
    default: false
  },
  expenses: [{
    userId: {
      type: Number,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    method: {
      type: String,
      enum: ['cash', 'bs'],
      required: true
    },
    rate: {
      type: Number,
      default: null
    },
    description: {
      type: String,
      required: true
    },
    isProportional: {
      type: Boolean,
      default: false
    },
    date: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Expense', expenseSchema);