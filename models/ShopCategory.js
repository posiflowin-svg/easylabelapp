const mongoose = require('mongoose');

const shopCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
  sortOrder: { type: Number, default: 0, index: true },
  active: { type: Boolean, default: true, index: true },
  imageUrl: { type: String, default: '', trim: true },
  imageData: { type: Buffer, select: false },
  imageContentType: { type: String, default: '', select: false }
}, { timestamps: true });

module.exports = mongoose.model('ShopCategory', shopCategorySchema);
