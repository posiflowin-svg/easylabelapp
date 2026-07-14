const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true, trim: true },
  deviceId: { type: String, default: '', trim: true },
  platform: { type: String, enum: ['android'], default: 'android' },
  appVersion: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true });

deviceTokenSchema.index({ userId: 1, enabled: 1 });
module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
