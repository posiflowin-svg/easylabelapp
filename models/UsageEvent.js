const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const usageEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  eventType: { type: String, required: true, enum: ['LABEL_PRINT', 'BILL_PRINT', 'INVENTORY_SNAPSHOT'], index: true },
  customerId: { type: String, default: '', index: true },
  customerName: { type: String, default: '', index: true },
  customerMobile: { type: String, default: '', index: true },
  customerEmail: { type: String, default: '' },
  deviceId: { type: String, default: '' },
  appVersion: { type: String, default: '' },
  printerModel: { type: String, default: '' },
  source: { type: String, default: '' },
  occurredAt: { type: Date, required: true, index: true },
  labelWidthMm: { type: Number, default: 0 },
  labelHeightMm: { type: Number, default: 0 },
  copies: { type: Number, default: 0 },
  billNo: { type: String, default: '' },
  billAmount: { type: Number, default: 0 },
  itemCount: { type: Number, default: 0 },
  paymentMode: { type: String, default: '' },
  inventoryCount: { type: Number, default: 0 },
  inventoryItems: [{ productId: { type: String, default: '' }, name: { type: String, default: '' }, category: { type: String, default: '' } }]
}, { timestamps: true });

usageEventSchema.index({ customerMobile: 1, occurredAt: -1 });
usageEventSchema.index({ eventType: 1, occurredAt: -1 });

module.exports = mongoose.model('UsageEvent', usageEventSchema);
