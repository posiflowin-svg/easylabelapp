const mongoose = require('mongoose');

const premiumSettingSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },
  premiumSystemEnabled: { type: Boolean, default: true },
  aiDesignerEnabled: { type: Boolean, default: true },
  cloudBackupEnabled: { type: Boolean, default: true },
  teamSharingEnabled: { type: Boolean, default: true },
  popupEnabled: { type: Boolean, default: true },
  notificationsEnabled: { type: Boolean, default: true },
  defaultCloudRetentionDays: { type: Number, default: 30, min: 0 },
  supportEmail: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('PremiumSetting', premiumSettingSchema);
