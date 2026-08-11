const mongoose = require('mongoose');

const productMediaSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  kind: { type: String, enum: ['product_image', 'aplus_image', 'video'], required: true, index: true },
  sortOrder: { type: Number, default: 0 },
  originalName: { type: String, default: '' },
  contentType: { type: String, required: true },
  data: { type: Buffer, required: true, select: false }
}, { timestamps: true });

productMediaSchema.index({ productId: 1, kind: 1, sortOrder: 1 });
module.exports = mongoose.model('ProductMedia', productMediaSchema);
