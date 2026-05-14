// models/WalletTransaction.js
const mongoose = require('mongoose');

const WalletTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletUser', required: true },
  type: { type: String, enum: ['add', 'redeem'], required: true },
  points: { type: Number, required: true },
  reason: { type: String },
  ticketId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WalletTransaction', WalletTransactionSchema);
