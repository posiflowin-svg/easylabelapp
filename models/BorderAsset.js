const mongoose = require('mongoose');

const borderAssetSchema = new mongoose.Schema({
  filename: { type: String, required: true, unique: true, index: true, trim: true },
  contentType: { type: String, required: true, default: 'application/octet-stream' },
  data: { type: Buffer, required: true },
  size: { type: Number, default: 0 }
}, { timestamps: true });

module.exports =
  mongoose.models.BorderAsset ||
  mongoose.model('BorderAsset', borderAssetSchema);
