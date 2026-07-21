const mongoose = require('mongoose');

const borderCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, lowercase: true, unique: true },
  label: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.models.BorderCategory || mongoose.model('BorderCategory', borderCategorySchema);
