const express = require('express');
const router = express.Router();
const PaymentException = require('../models/PaymentException');
const Order = require('../models/Order');
// Explicit authenticated admin session only; never expose customer payment records publicly.
router.use((req,res,next)=>{
  if (!req.session?.adminAuthenticated) return res.status(403).json({success:false,message:'Admin verification required'});
  res.set('Cache-Control','no-store');next();
});
router.get('/',async(req,res)=>{
  try {
    const page=Math.max(1,Math.min(10000,Number(req.query.page)||1));
    const limit=25;
    const status=['unmatched','linked','review_required'].includes(req.query.status)?req.query.status:'unmatched';
    const [items,total]=await Promise.all([
      PaymentException.find({status}).select('paymentId razorpayOrderId amountPaise currency status shopOrderId customerPhoneLast4 capturedAt lastSeenAt').sort({capturedAt:-1}).skip((page-1)*limit).limit(limit).lean(),
      PaymentException.countDocuments({status})
    ]);
    res.json({success:true,page,limit,total,items});
  }catch(e){console.error('Payment exception listing failed:',e.message);res.status(500).json({success:false,message:'Unable to load payment exceptions'});}
});
router.get('/summary',async(req,res)=>{
  try {
    const counts=await PaymentException.aggregate([{$group:{_id:'$status',count:{$sum:1},amountPaise:{$sum:'$amountPaise'}}}]);
    res.json({success:true,counts});
  }catch(e){res.status(500).json({success:false,message:'Unable to load payment summary'});}
});
module.exports=router;
