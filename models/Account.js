const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  balance: { type: Number, default: 0 },
  originalCurrency: { type: String, required: true },
  isActive: { type: Boolean, default: true },
});

module.exports = mongoose.model('Account', accountSchema);
