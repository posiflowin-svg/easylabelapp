const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  customerName: String, customerEmail: String, customerPhone: String,
  identityVerification: { type: String, enum: ['Verified','Unverified'], default: 'Unverified' },
  enquiryType: { type: String, enum: ['POS','THERMAL_LABEL','THERMAL_RECEIPT','MOBILE_PRINTER','RECEIPT_PRINTER','LABEL_PRINTER','BARCODE_SCANNER'], default: 'POS' },
  category: String, dailyVolume: String, purchaseQuantity: String, paperWidth: String, rollDiameter: String, scannerType: String, printingPurpose: String, connectivity: String, labelWidth: String, monthlyRollUsage: String, monthlyLabelUsage: String, labelSize: String,
  labelType: String, hasLabelPrinter: Boolean, specialRequirements: String,
  productId: String, productName: String, sku: String,
  businessType: { type: String, enum: ['Retail Shop','Supermarket','Restaurant / Cafe','Other Business','Other','Retail / Grocery Store','Restaurant / Cafe','Delivery / Logistics','Pharmacy / Medical Store','Billing / Field Sales','Supermarket / Hypermarket','Warehouse / Logistics','Clothing / Fashion Store'], required: function() { return this.enquiryType === 'POS'; } },
  outlets: { type: String, enum: ['1 Outlet','2-5 Outlets','6+ Outlets'], required: function() { return this.enquiryType === 'POS'; } },
  purchaseTimeline: { type: String, enum: ['Within 7 Days','Within 30 Days','Exploring Options','Just Exploring'], required: function() { return this.enquiryType === 'POS'; } },
  discountInterest: { type: Boolean, default: false },
  status: { type: String, enum: ['New','Contacted','Converted','Closed'], default: 'New' }
}, { timestamps: true });
schema.index({createdAt:-1});
module.exports = mongoose.model('PosEnquiry',schema);
