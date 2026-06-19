const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  transactionType: { type: String, enum: ['expense', 'income'], required: true },
  monthlyBudget: { type: Number, default: null },
});

module.exports = mongoose.model('Category', categorySchema);
