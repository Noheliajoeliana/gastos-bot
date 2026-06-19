const mongoose = require('mongoose');

const periodSchema = new mongoose.Schema({
  startDate: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Period', periodSchema);
