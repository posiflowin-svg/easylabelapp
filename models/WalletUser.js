// models/WalletUser.js
const mongoose = require('mongoose');

const WalletUserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  wallet: {
    points: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.model('WalletUser', WalletUserSchema);
