const mongoose = require('mongoose');

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