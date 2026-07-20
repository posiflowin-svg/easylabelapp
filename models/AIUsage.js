const mongoose = require('mongoose');

const aiUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSubscription', default: null },
  requestType: {
    type: String,
    enum: ['scan', 'design', 'voice', 'thermal', 'logo', 'shipping', 'product', 'generate', 'improve', 'retry'],
    default: 'design',
    index: true
  },
  status: { type: String, enum: ['success', 'failed'], default: 'success', index: true },
  creditSource: { type: String, enum: ['monthly', 'purchased', 'none'], default: 'none' },
  creditTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AITransaction', default: null },
  requestId: { type: String, default: undefined },
  modelName: { type: String, default: 'layout-ai' },
  inputTokens: { type: Number, default: 0, min: 0 },
  outputTokens: { type: Number, default: 0, min: 0 },
  estimatedCostInr: { type: Number, default: 0, min: 0 },
  generationTimeMs: { type: Number, default: 0, min: 0 },
  labelSize: { type: String, default: '' },
  notes: { type: String, default: '' }
}, { timestamps: true });

aiUsageSchema.index({ createdAt: -1 });
aiUsageSchema.index({ userId: 1, createdAt: -1 });
aiUsageSchema.index({ requestType: 1, createdAt: -1 });
aiUsageSchema.index({ requestId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('AIUsage', aiUsageSchema);
