const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Product name is required'], trim: true, maxlength: 160 },
  sku: { type: String, default: '', trim: true, index: true },
  price: { type: Number, required: [true, 'Selling price is required'], min: 0 },
  mrp: { type: Number, default: 0, min: 0 },
  images: [{ type: String, trim: true }],
  category: {
    name: { type: String, required: [true, 'Category name is required'], trim: true },
    imageUrl: { type: String, default: '', trim: true }
  },
  description: { type: String, default: '', maxlength: 4000 },
  badge: { type: String, default: '', trim: true, maxlength: 40 },
  stock: { type: Number, default: -1 }, // -1 = unlimited / not tracked
  active: { type: Boolean, default: true, index: true },
  featured: { type: Boolean, default: false, index: true },
  sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

productSchema.index({ name: 'text', sku: 'text', description: 'text', 'category.name': 'text' });

module.exports = mongoose.model('Product', productSchema);
