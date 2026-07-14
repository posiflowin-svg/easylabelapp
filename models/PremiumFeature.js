const mongoose = require('mongoose');

const premiumFeatureSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  category: { type: String, enum: ['design', 'content', 'ai', 'cloud', 'team', 'other'], default: 'other' },
  icon: { type: String, default: 'fa-star' },
  enabled: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('PremiumFeature', premiumFeatureSchema);
