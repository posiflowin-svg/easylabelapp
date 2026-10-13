const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerName: String, customerEmail: String, customerPhone: String,
  businessType: { type: String, enum: ['Retail Shop','Restaurant / Cafe','Other Business'], required: true },
  outlets: { type: String, enum: ['1 Outlet','2-5 Outlets','6+ Outlets'], required: true },
  purchaseTimeline: { type: String, enum: ['Within 7 Days','Within 30 Days','Exploring Options'], required: true },
  discountInterest: { type: Boolean, default: false },
  status: { type: String, enum: ['New','Contacted','Converted','Closed'], default: 'New' }
}, { timestamps: true });
schema.index({createdAt:-1});
module.exports = mongoose.model('PosEnquiry',schema);
