// Razorpay webhook: configure RAZORPAY_WEBHOOK_SECRET separately from API key secret.
const crypto = require('crypto');
const Order = require('../models/Order');
const PaymentException = require('../models/PaymentException');
const razorpay = require('../services/razorpayService');
module.exports = async (req,res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !Buffer.isBuffer(req.body)) return res.sendStatus(503);
  const received = String(req.get('x-razorpay-signature') || '');
  const expected = crypto.createHmac('sha256',secret).update(req.body).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(received) || !crypto.timingSafeEqual(Buffer.from(received.toLowerCase()),Buffer.from(expected))) return res.sendStatus(401);
  let event; try { event=JSON.parse(req.body.toString('utf8')); } catch(e){return res.sendStatus(400)}
  if (event.event !== 'payment.captured') return res.sendStatus(200);
  const payment = event.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id || payment.status !== 'captured') return res.sendStatus(200);
  try {
    // Only update an order that already has a verified Razorpay order ID link.
    // Never guess the customer from mobile, amount, or transaction time.
    const order = await Order.findOne({razorpayOrderId:payment.order_id});
    if (!order) {
      // A captured payment must not disappear when an older app fails to create its order.
      // Do not fabricate product or shipping information from payment metadata.
      await PaymentException.updateOne({paymentId:payment.id},{
        $setOnInsert:{paymentId:payment.id,source:'webhook'},
        $set:{razorpayOrderId:payment.order_id,amountPaise:Number(payment.amount),
          currency:String(payment.currency||''),status:'unmatched',
          customerPhoneLast4:String(payment.contact||'').replace(/\D/g,'').slice(-4),
          capturedAt:payment.created_at?new Date(payment.created_at*1000):new Date(),lastSeenAt:new Date()}
      },{upsert:true});
      return res.sendStatus(200);
    }
    if (order.razorpayPaymentId && order.razorpayPaymentId !== payment.id) return res.sendStatus(409);
    if (Math.round(Number(order.totalAmount)*100) !== Number(payment.amount) || String(payment.currency).toUpperCase() !== 'INR') return res.sendStatus(409);
    const accountKey = order.paymentAccountKey || process.env.RAZORPAY_ACTIVE_ACCOUNT || '1';
    const check = await razorpay.verifyPayment({paymentId:payment.id,orderId:payment.order_id,amount:order.totalAmount,accountKey});
    if (!check.verified || String(check.payment.currency).toUpperCase() !== 'INR') return res.sendStatus(409);
    const used = await Order.exists({razorpayPaymentId:payment.id,_id:{$ne:order._id}});
    if (used) return res.sendStatus(409);
    const updated = await Order.updateOne({_id:order._id,$or:[{razorpayPaymentId:{$exists:false}},{razorpayPaymentId:null},{razorpayPaymentId:payment.id}]},{$set:{paymentStatus:'Paid',paymentMethod:'Online',razorpayPaymentId:payment.id,paymentVerifiedAt:new Date(),paymentAccountKey:check.account.accountKey}});
    if (!updated.matchedCount) return res.sendStatus(409);
    await PaymentException.updateOne({paymentId:payment.id},{$set:{status:'linked',shopOrderId:order.orderId,lastSeenAt:new Date()}});
    return res.sendStatus(200);
  } catch(e) { console.error('Razorpay webhook processing failed:',e.message);return res.sendStatus(500); }
};
