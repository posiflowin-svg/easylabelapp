const mongoose = require('mongoose');

const aiUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserSubscription', default: null },
  requestType: { type: String, enum: ['generate', 'improve', 'retry'], default: 'generate' },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
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
module.exports = mongoose.model('AIUsage', aiUsageSchema);
