const mongoose = require('mongoose');

const SUPPORTED_SIZES = [
  '50x25','50x30','50x50','50x12','38x38','38x25','38x15',
  '75x25','75x50','100x50','100x150','100x15'
];

const borderSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, default: 'new', lowercase: true, trim: true },

  // Common 50x25 preview shown in the Android border library.
  previewUrl: { type: String, default: '' },
  thumbnailUrl: { type: String, default: '' },

  // Exact design file for each supported label size.
  variants: {
    type: Map,
    of: String,
    default: {}
  },

  // Legacy fields kept so old app/backend records continue to work.
  imageUrl: { type: String, default: '' },
  labelSize: { type: String, default: '' },

  accessLevel: {
    type: String,
    enum: ['free', 'premium', 'business'],
    default: 'premium',
    index: true
  },
  isVip: { type: Boolean, default: true },
  active: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

borderSchema.statics.SUPPORTED_SIZES = SUPPORTED_SIZES;

module.exports = mongoose.models.Border || mongoose.model('Border', borderSchema);
