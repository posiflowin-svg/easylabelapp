const mongoose = require('mongoose');

const borderSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, default: 'new', lowercase: true, trim: true },
  imageUrl: { type: String, required: true },
  thumbnailUrl: { type: String, default: '' },
  accessLevel: {
    type: String,
    enum: ['free', 'premium', 'business'],
    default: 'premium',
    index: true
  },
  // Kept for compatibility with older Android/backend builds.
  isVip: { type: Boolean, default: true },
  active: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.models.Border || mongoose.model('Border', borderSchema);
