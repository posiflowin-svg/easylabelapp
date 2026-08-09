const mongoose = require('mongoose');

const campaignInteractionSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PromoCampaign',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  deviceId: { type: String, default: '', trim: true, index: true },
  impressionCount: { type: Number, default: 0, min: 0 },
  clickCount: { type: Number, default: 0, min: 0 },
  dismissCount: { type: Number, default: 0, min: 0 },
  firstDisplayedAt: { type: Date, default: null },
  lastDisplayedAt: { type: Date, default: null },
  lastClickedAt: { type: Date, default: null },
  lastDismissedAt: { type: Date, default: null }
}, { timestamps: true });

campaignInteractionSchema.index(
  { campaignId: 1, userId: 1, deviceId: 1 },
  { unique: true }
);

module.exports = mongoose.model('CampaignInteraction', campaignInteractionSchema);
