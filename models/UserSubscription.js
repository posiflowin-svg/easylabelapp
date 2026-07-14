const mongoose = require('mongoose');

const userSubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  planKey: { type: String, required: true, trim: true, lowercase: true },
  status: {
    type: String,
    enum: ['active', 'trial', 'grace_period', 'payment_pending', 'on_hold', 'cancelled', 'expired', 'refunded', 'revoked'],
    default: 'active'
  },
  source: { type: String, enum: ['manual', 'google_play'], default: 'manual' },
  startDate: { type: Date, default: Date.now },
  expiryDate: { type: Date, required: true },
  autoRenew: { type: Boolean, default: false },
  purchaseToken: { type: String, default: '' },
  googleOrderId: { type: String, default: '' },
  googleProductId: { type: String, default: '' },
  verificationMode: { type: String, enum: ['test', 'live', 'manual'], default: 'manual' },
  deviceCount: { type: Number, default: 1, min: 0 },
  lastVerifiedAt: { type: Date, default: null },
  notes: { type: String, default: '' },
  createdBy: { type: String, default: 'admin' }
}, { timestamps: true });

userSubscriptionSchema.index({ userId: 1, status: 1 });
userSubscriptionSchema.index({ purchaseToken: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('UserSubscription', userSubscriptionSchema);
