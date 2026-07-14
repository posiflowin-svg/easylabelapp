const mongoose = require('mongoose');

const promoCampaignSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  campaignType: { type: String, enum: ['popup', 'home_banner', 'full_screen', 'new_feature', 'upgrade_banner'], default: 'popup' },
  subtitle: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  buttonText: { type: String, default: 'View Plans' },
  buttonAction: { type: String, enum: ['open_subscription', 'open_feature', 'open_url', 'dismiss'], default: 'open_subscription' },
  actionValue: { type: String, default: '' },
  targetAudience: { type: String, enum: ['all', 'free', 'premium', 'business', 'expired'], default: 'free' },
  frequency: { type: String, enum: ['once', 'daily', 'weekly', 'every_open'], default: 'once' },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, default: null },
  active: { type: Boolean, default: true },
  priority: { type: Number, default: 0 },
  maxDisplays: { type: Number, default: 1, min: 0 },
  displayCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

module.exports = mongoose.model('PromoCampaign', promoCampaignSchema);
