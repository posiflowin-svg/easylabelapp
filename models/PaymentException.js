const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  paymentId: {type:String,required:true,unique:true,index:true},
  razorpayOrderId: {type:String,index:true},
  amountPaise: Number,
  currency: String,
  status: {type:String,enum:['unmatched','linked','review_required'],default:'unmatched',index:true},
  shopOrderId: String,
  customerPhoneLast4: String,
  accountKey: String,
  source: {type:String,default:'webhook'},
  capturedAt: Date,
  lastSeenAt: Date,
  reviewNote: String
},{timestamps:true});
module.exports = mongoose.model('PaymentException',schema);
