const mongoose = require('mongoose');

const shopSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true, index: true },
  enabled: { type: Boolean, default: true },
  heroTitle: { type: String, default: 'Everything your business needs' },
  heroSubtitle: { type: String, default: 'Printers, labels, scanners and POS hardware — delivered to your door.' },
  heroBadge: { type: String, default: 'EasyLabel Shop' },
  heroImageUrl: { type: String, default: '' },
  shippingText: { type: String, default: 'Fast dispatch • Secure payments • Easy support' },
  supportText: { type: String, default: 'Need help choosing? Contact our sales team.' },
  sliderIntervalMs: { type: Number, default: 4500, min: 2000, max: 15000 }
}, { timestamps: true });

module.exports = mongoose.model('ShopSettings', shopSettingsSchema);
