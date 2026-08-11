const mongoose = require('mongoose');

const shopBannerSchema = new mongoose.Schema({
  title: { type: String, default: '', trim: true, maxlength: 120 },
  subtitle: { type: String, default: '', trim: true, maxlength: 240 },
  badge: { type: String, default: 'EasyLabel Shop', trim: true, maxlength: 60 },
  sortOrder: { type: Number, default: 0, index: true },
  active: { type: Boolean, default: true, index: true },
  clickUrl: { type: String, default: '', trim: true },
  imageUrl: { type: String, default: '', trim: true },
  imageData: { type: Buffer, select: false },
  imageContentType: { type: String, default: '', select: false }
}, { timestamps: true });

module.exports = mongoose.model('ShopBanner', shopBannerSchema);
