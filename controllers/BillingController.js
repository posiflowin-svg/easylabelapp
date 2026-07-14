const mongoose = require('mongoose');
const UserSubscription = require('../models/UserSubscription');
const PremiumPlan = require('../models/PremiumPlan');
const PaymentTransaction = require('../models/PaymentTransaction');
const BillingWebhookEvent = require('../models/BillingWebhookEvent');
const googlePlayService = require('../services/googlePlayService');

function validId(id) { return mongoose.Types.ObjectId.isValid(id); }

async function planForProduct(productId) {
  return PremiumPlan.findOne({ $or: [{ googleProductId: productId }, { key: productId }], active: true });
}

async function upsertVerifiedSubscription({ userId, purchaseToken, productId, result }) {
  const plan = await planForProduct(result.productId || productId);
  if (!plan) throw new Error(`No active plan is mapped to Google product ${result.productId || productId}.`);
  const expiryDate = result.expiryDate || new Date(Date.now() + 30 * 86400000);
  const update = {
    userId,
    planKey: plan.key,
    status: result.status,
    source: result.testMode ? 'manual' : 'google_play',
    expiryDate,
    autoRenew: result.autoRenew,
    purchaseToken,
    googleOrderId: result.orderId || '',
    googleProductId: result.productId || productId,
    lastVerifiedAt: new Date(),
    verificationMode: result.testMode ? 'test' : 'live'
  };
  const subscription = await UserSubscription.findOneAndUpdate(
    { purchaseToken },
    { $set: update, $setOnInsert: { startDate: new Date(), createdBy: 'google_play' } },
    { new: true, upsert: true, runValidators: true }
  );
  if (result.orderId) {
    await PaymentTransaction.updateOne(
      { orderId: result.orderId },
      { $setOnInsert: { userId, subscriptionId: subscription._id, planKey: plan.key, amount: plan.price, source: result.testMode ? 'manual' : 'google_play', status: 'paid', orderId: result.orderId, paidAt: new Date() } },
      { upsert: true }
    );
  }
  return { subscription, plan };
}

exports.verify = async (req, res) => {
  try {
    const { userId, purchaseToken, productId } = req.body;
    if (!validId(userId) || !purchaseToken || !productId) return res.status(400).json({ success: false, message: 'Valid userId, purchaseToken and productId are required.' });
    const result = await googlePlayService.verifySubscription({ purchaseToken, productId });
    const { subscription, plan } = await upsertVerifiedSubscription({ userId, purchaseToken, productId, result });
    res.json({ success: true, testMode: Boolean(result.testMode), subscription, planKey: plan.key });
  } catch (error) {
    console.error('Google verification failed:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.restore = async (req, res) => {
  try {
    const { userId, purchases } = req.body;
    if (!validId(userId) || !Array.isArray(purchases)) return res.status(400).json({ success: false, message: 'Valid userId and purchases array are required.' });
    const restored = [];
    for (const purchase of purchases.slice(0, 10)) {
      const result = await googlePlayService.verifySubscription(purchase);
      const saved = await upsertVerifiedSubscription({ userId, purchaseToken: purchase.purchaseToken, productId: purchase.productId, result });
      restored.push(saved.subscription);
    }
    res.json({ success: true, restored });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.rtdn = async (req, res) => {
  let event;
  try {
    const envelope = req.body || {};
    const message = envelope.message || {};
    const decoded = message.data ? JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')) : envelope;
    const sub = decoded.subscriptionNotification || {};
    event = await BillingWebhookEvent.findOneAndUpdate(
      { messageId: message.messageId || undefined },
      { $setOnInsert: { messageId: message.messageId || '', eventTime: decoded.eventTimeMillis ? new Date(Number(decoded.eventTimeMillis)) : new Date(), notificationType: Number(sub.notificationType || 0), packageName: decoded.packageName || '', productId: sub.subscriptionId || '', purchaseToken: sub.purchaseToken || '', rawPayload: decoded } },
      { new: true, upsert: true }
    );
    if (!sub.purchaseToken) {
      event.status = 'ignored'; event.processedAt = new Date(); await event.save();
      return res.status(204).end();
    }
    const existing = await UserSubscription.findOne({ purchaseToken: sub.purchaseToken });
    if (!existing) {
      event.status = 'ignored'; event.error = 'No local subscription for purchase token.'; event.processedAt = new Date(); await event.save();
      return res.status(204).end();
    }
    const result = googlePlayService.normalizeSubscription(await googlePlayService.fetchSubscription(sub.purchaseToken), sub.subscriptionId);
    await upsertVerifiedSubscription({ userId: existing.userId, purchaseToken: sub.purchaseToken, productId: sub.subscriptionId, result });
    event.status = 'processed'; event.processedAt = new Date(); await event.save();
    res.status(204).end();
  } catch (error) {
    if (event) { event.status = 'failed'; event.error = error.message; event.processedAt = new Date(); await event.save().catch(() => {}); }
    console.error('RTDN error:', error);
    res.status(500).json({ success: false });
  }
};

exports.config = (req, res) => res.json({
  success: true,
  packageName: googlePlayService.PACKAGE_NAME,
  testMode: googlePlayService.TEST_MODE,
  googleConfigured: googlePlayService.isConfigured()
});
