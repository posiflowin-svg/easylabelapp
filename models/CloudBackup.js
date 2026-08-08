const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  gridFsId: { type: mongoose.Schema.Types.ObjectId, required: true },
  fileName: { type: String, default: '' },
  size: { type: Number, default: 0 },
  deviceId: { type: String, default: '' },
  deviceName: { type: String, default: '' },
  appVersion: { type: String, default: '' },
  databaseVersion: { type: Number, default: 0 },
  localUpdatedAt: { type: Date, default: null },
  itemCount: { type: Number, default: 0 },
  billCount: { type: Number, default: 0 },
  customerCount: { type: Number, default: 0 },
  supplierCount: { type: Number, default: 0 },
  productImageCount: { type: Number, default: 0 },
  status: { type: String, enum: ['ready','superseded'], default: 'ready' }
}, { timestamps: true });
schema.index({ userId: 1, createdAt: -1 });
module.exports = mongoose.model('CloudBackup', schema);
