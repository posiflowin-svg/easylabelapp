/**
 * Explicit, audited Razorpay reconciliation. Never guesses a payment from amount,
 * phone, timestamp, or legacy COD defaults.
 * Usage: node scripts/reconcileRazorpayOrders.js ./private/order-payment-mapping.json
 * Apply only after reviewing dry run: ... --apply
 * Mapping: [{"shopOrderId":"ORD...","paymentId":"pay_...","razorpayOrderId":"order_...","accountKey":"1"}]
 */
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const razorpay = require('../services/razorpayService');
async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!file) throw new Error('Pass a local JSON mapping file (not a public URL).');
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(entries)) throw new Error('Mapping must be a JSON array');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;
  if (!uri) throw new Error('MongoDB URI environment variable not configured');
  await mongoose.connect(uri);
  let verified = 0, changed = 0, rejected = 0;
  for (const entry of entries) {
    try {
      if (!entry.shopOrderId || !/^pay_[a-zA-Z0-9]+$/.test(entry.paymentId || '') || !/^order_[a-zA-Z0-9]+$/.test(entry.razorpayOrderId || '')) throw new Error('Invalid mapping identifiers');
      const order = await Order.findOne({orderId: entry.shopOrderId});
      if (!order) throw new Error('Shop order not found');
      const check = await razorpay.verifyPayment({paymentId:entry.paymentId,orderId:entry.razorpayOrderId,amount:order.totalAmount,accountKey:entry.accountKey});
      if (!check.verified || String(check.payment.currency).toUpperCase() !== 'INR') throw new Error('Payment not captured, amount/order mismatch or non-INR currency');
      if (order.razorpayPaymentId && order.razorpayPaymentId !== entry.paymentId) throw new Error('Different payment already attached');
      const duplicate = await Order.exists({razorpayPaymentId:entry.paymentId,orderId:{$ne:entry.shopOrderId}});
      if (duplicate) throw new Error('Payment attached to another order');
      verified++;
      if (apply) {
        const result = await Order.updateOne({ _id:order._id, $or:[{razorpayPaymentId:{$exists:false}},{razorpayPaymentId:null},{razorpayPaymentId:entry.paymentId}] }, {$set:{paymentMethod:'Online',paymentStatus:'Paid',razorpayPaymentId:entry.paymentId,razorpayOrderId:entry.razorpayOrderId,paymentAccountKey:check.account.accountKey,paymentVerifiedAt:new Date()}});
        if (!result.matchedCount) throw new Error('Concurrent update conflict');
        changed++;
      }
      console.log(`${apply?'APPLIED':'VERIFIED (DRY RUN)'} ${entry.shopOrderId}`);
    } catch (err) { rejected++; console.error(`REJECTED ${entry.shopOrderId||'(missing)'}: ${err.message}`); }
  }
  console.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',verified,changed,rejected}));
  if (rejected) process.exitCode = 1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>mongoose.disconnect());
