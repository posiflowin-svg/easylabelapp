const express = require('express');
const router = express.Router();
const PaymentException = require('../models/PaymentException');
const Order = require('../models/Order');
const razorpay = require('../services/razorpayService');

// Only a verified admin may view or reconcile customer payment records.
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
      PaymentException.find({status}).select('paymentId razorpayOrderId amountPaise currency status shopOrderId customerPhoneLast4 capturedAt lastSeenAt reviewNote').sort({capturedAt:-1}).skip((page-1)*limit).limit(limit).lean(),
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

// Admin-initiated recovery for legacy Android payments. Never create a fake order
// or infer cart/shipping data from a payment amount, phone number or timestamp.
router.post('/reconcile',async(req,res)=>{
  const paymentId=String(req.body?.paymentId||'').trim();
  const accountKey=String(req.body?.accountKey||process.env.RAZORPAY_ACTIVE_ACCOUNT||'1').trim();
  if(!/^pay_[A-Za-z0-9]+$/.test(paymentId) || !['1','2'].includes(accountKey)) return res.status(400).json({success:false,message:'Valid Razorpay payment ID and accountKey (1 or 2) required'});
  try {
    const account=razorpay.getAccount(accountKey);
    const payment=await razorpay.fetchPayment({paymentId,accountKey});
    if(payment.status!=='captured' || !payment.order_id || payment.currency!=='INR' || !Number.isSafeInteger(Number(payment.amount)) || Number(payment.amount)<=0)
      return res.status(409).json({success:false,message:'Payment must be captured in INR and linked to a Razorpay order'});
    const existing=await Order.findOne({razorpayPaymentId:paymentId});
    if(existing){
      if(existing.razorpayOrderId!==payment.order_id || Math.round(existing.totalAmount*100)!==Number(payment.amount)) return res.status(409).json({success:false,message:'Payment is linked to a conflicting Shop order'});
      return res.json({success:true,status:'already_linked',shopOrderId:existing.orderId});
    }
    const order=await Order.findOne({razorpayOrderId:payment.order_id});
    if(order && (!order.paymentAccountKey || order.paymentAccountKey===account.accountKey) && !order.razorpayPaymentId && Math.round(order.totalAmount*100)===Number(payment.amount)){
      const updated=await Order.findOneAndUpdate({_id:order._id,razorpayOrderId:payment.order_id,$or:[{razorpayPaymentId:{$exists:false}},{razorpayPaymentId:null}]},{$set:{razorpayPaymentId:paymentId,paymentStatus:'Paid',paymentMethod:'Online',paymentVerifiedAt:new Date(),paymentAccountKey:account.accountKey}},{new:true});
      if(updated){
        await PaymentException.updateOne({paymentId},{$set:{status:'linked',shopOrderId:updated.orderId,lastSeenAt:new Date(),accountKey:account.accountKey}});
        return res.json({success:true,status:'linked',shopOrderId:updated.orderId});
      }
      return res.status(409).json({success:false,message:'Order changed during reconciliation; refresh and retry'});
    }
    const note=order?'Existing checkout conflicts with payment amount/account or already has a different payment':'No checkout snapshot found; customer, cart and shipping details require manual review';
    await PaymentException.updateOne({paymentId},{$setOnInsert:{paymentId,source:'admin_reconciliation'},$set:{razorpayOrderId:payment.order_id,amountPaise:Number(payment.amount),currency:'INR',accountKey:account.accountKey,status:'review_required',reviewNote:note,customerPhoneLast4:String(payment.contact||'').replace(/\D/g,'').slice(-4),capturedAt:payment.created_at?new Date(payment.created_at*1000):new Date(),lastSeenAt:new Date()}},{upsert:true});
    return res.json({success:true,status:'review_required',message:note});
  }catch(e){console.error('Razorpay admin reconciliation failed:',e.message);return res.status(502).json({success:false,message:'Razorpay verification or reconciliation failed; check server logs'});}
});
module.exports=router;
