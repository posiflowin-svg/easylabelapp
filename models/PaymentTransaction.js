const mongoose = require('mongoose');

const paymentTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSubscription', default: null },
  planKey: { type: String, required: true, trim: true, lowercase: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'INR' },
  source: { type: String, enum: ['manual', 'google_play'], default: 'manual' },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'paid' },
  orderId: { type: String, default: '' },
  purchaseToken: { type: String, default: '' },
  paidAt: { type: Date, default: Date.now },
  notes: { type: String, default: '' }
}, { timestamps: true });

paymentTransactionSchema.index({ orderId: 1 }, { sparse: true });
paymentTransactionSchema.index({ paidAt: -1 });
module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
