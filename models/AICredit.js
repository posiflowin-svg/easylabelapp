const mongoose = require('mongoose');

const aiCreditSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  planKey: { type: String, default: 'free', trim: true, lowercase: true },
  monthKey: { type: String, required: true, index: true }, // YYYY-MM in UTC
  monthlyLimit: { type: Number, default: 0, min: 0 },
  monthlyUsed: { type: Number, default: 0, min: 0 },
  purchasedCredits: { type: Number, default: 0, min: 0 },
  lifetimePurchased: { type: Number, default: 0, min: 0 },
  lifetimeUsed: { type: Number, default: 0, min: 0 },
  lastResetAt: { type: Date, default: Date.now },
  lastUsageAt: { type: Date, default: null }
}, { timestamps: true });

aiCreditSchema.virtual('monthlyRemaining').get(function monthlyRemaining() {
  return Math.max(0, this.monthlyLimit - this.monthlyUsed);
});

aiCreditSchema.set('toJSON', { virtuals: true });
aiCreditSchema.index({ userId: 1, monthKey: 1 });

module.exports = mongoose.model('AICredit', aiCreditSchema);
