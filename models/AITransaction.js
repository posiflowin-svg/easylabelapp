const mongoose = require('mongoose');

const aiTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: ['purchase', 'usage', 'refund', 'admin_grant', 'adjustment'],
    required: true,
    index: true
  },
  creditSource: { type: String, enum: ['monthly', 'purchased', 'none'], default: 'none' },
  feature: {
    type: String,
    enum: ['scan', 'design', 'voice', 'thermal', 'logo', 'shipping', 'product', 'other'],
    default: 'other'
  },
  credits: { type: Number, required: true }, // positive credit, negative debit
  balanceAfter: { type: Number, default: 0, min: 0 },
  monthlyRemainingAfter: { type: Number, default: 0, min: 0 },
  amount: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'INR' },
  packKey: { type: String, default: '' },
  paymentId: { type: String, default: undefined },
  orderId: { type: String, default: '' },
  requestId: { type: String, default: undefined },
  status: { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'completed' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  notes: { type: String, default: '' }
}, { timestamps: true });

aiTransactionSchema.index({ userId: 1, createdAt: -1 });
aiTransactionSchema.index({ paymentId: 1 }, { unique: true, sparse: true });
aiTransactionSchema.index({ requestId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('AITransaction', aiTransactionSchema);
