const mongoose = require('mongoose');

// Nuevo modelo para deudas individuales
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