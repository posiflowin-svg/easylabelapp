const mongoose = require('mongoose');

const pushNotificationSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  imageUrl: { type: String, default: '' },
  targetAudience: { type: String, enum: ['all', 'free', 'premium', 'business', 'expired'], default: 'all' },
  actionType: { type: String, enum: ['none', 'open_subscription', 'open_feature', 'open_url'], default: 'none' },
  actionValue: { type: String, default: '' },
  scheduleAt: { type: Date, default: null },
  status: { type: String, enum: ['draft', 'scheduled', 'sent', 'cancelled'], default: 'draft' },
  sentAt: { type: Date, default: null },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  buttonText: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('PushNotification', pushNotificationSchema);
