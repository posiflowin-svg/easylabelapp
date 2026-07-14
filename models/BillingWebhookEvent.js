const mongoose = require('mongoose');

const billingWebhookEventSchema = new mongoose.Schema({
  source: { type: String, enum: ['google_play_rtdn'], default: 'google_play_rtdn' },
  messageId: { type: String, default: '' },
  eventTime: { type: Date, default: Date.now },
  notificationType: { type: Number, default: 0 },
  packageName: { type: String, default: '' },
  productId: { type: String, default: '' },
  purchaseToken: { type: String, default: '', index: true },
  status: { type: String, enum: ['received', 'processed', 'ignored', 'failed'], default: 'received' },
  error: { type: String, default: '' },
  rawPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  processedAt: { type: Date, default: null }
}, { timestamps: true });

billingWebhookEventSchema.index({ messageId: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('BillingWebhookEvent', billingWebhookEventSchema);
