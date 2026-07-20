const mongoose = require('mongoose');
const AICredit = require('../models/AICredit');
const AITransaction = require('../models/AITransaction');
const UserSubscription = require('../models/UserSubscription');
const PremiumPlan = require('../models/PremiumPlan');
const User = require('../models/User');

// Development-only unlimited AI access.
// Override in Render with DEV_AI_EMAILS (comma-separated) or DEV_AI_MOBILES.
// Set DEV_AI_TEST_MODE=false to disable all automatic test credits.
const DEFAULT_DEV_AI_EMAIL = 'marketingposiflow@gmail.com';
const DEV_AI_CREDIT_LIMIT = 999;

function normalizedCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

async function isDeveloperAccount(userId) {
  if (String(process.env.DEV_AI_TEST_MODE || 'true').toLowerCase() === 'false') return false;

  const emails = normalizedCsv(process.env.DEV_AI_EMAILS || DEFAULT_DEV_AI_EMAIL);
  const mobiles = normalizedCsv(process.env.DEV_AI_MOBILES).map(value => value.replace(/\D/g, '').slice(-10));
  if (!emails.length && !mobiles.length) return false;

  const user = await User.findById(userId).select('email phone mobile mobileNumber').lean();
  if (!user) return false;

  const email = String(user.email || '').trim().toLowerCase();
  const mobile = String(user.phone || user.mobile || user.mobileNumber || '').replace(/\D/g, '').slice(-10);
  return (email && emails.includes(email)) || (mobile && mobiles.includes(mobile));
}

function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function activePlanForUser(userId) {
  const now = new Date();
  const subscription = await UserSubscription.findOne({
    userId,
    status: { $in: ['active', 'trial', 'grace_period'] },
    expiryDate: { $gt: now }
  }).sort({ expiryDate: -1 }).lean();

  if (!subscription) return { subscription: null, plan: null, planKey: 'free', monthlyLimit: 0 };

  const plan = await PremiumPlan.findOne({ key: subscription.planKey, active: true }).lean();
  return {
    subscription,
    plan,
    planKey: subscription.planKey,
    monthlyLimit: plan ? Number(plan.aiMonthlyLimit || 0) : 0
  };
}

async function ensureAccount(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Valid userId is required.');
    error.statusCode = 400;
    throw error;
  }

  const currentMonth = monthKey();
  const developerMode = await isDeveloperAccount(userId);
  const activePlan = developerMode
    ? { subscription: null, plan: null, planKey: 'free', monthlyLimit: DEV_AI_CREDIT_LIMIT }
    : await activePlanForUser(userId);
  const { subscription, plan, planKey, monthlyLimit } = activePlan;

  let account = await AICredit.findOne({ userId });
  if (!account) {
    account = await AICredit.create({
      userId,
      planKey,
      monthKey: currentMonth,
      monthlyLimit,
      monthlyUsed: 0
    });
  } else {
    let changed = false;
    if (account.monthKey !== currentMonth) {
      account.monthKey = currentMonth;
      account.monthlyUsed = 0;
      account.lastResetAt = new Date();
      changed = true;
    }
    // Keep the configured test account fully topped up on every request.
    if (developerMode && account.monthlyUsed !== 0) {
      account.monthlyUsed = 0;
      changed = true;
    }
    if (account.planKey !== planKey || account.monthlyLimit !== monthlyLimit) {
      account.planKey = planKey;
      account.monthlyLimit = monthlyLimit;
      // Preserve usage when changing plans during the same month.
      changed = true;
    }
    if (changed) await account.save();
  }

  return { account, subscription, plan, developerMode };
}

function balancePayload(account) {
  const monthlyRemaining = Math.max(0, account.monthlyLimit - account.monthlyUsed);
  return {
    planKey: account.planKey,
    monthKey: account.monthKey,
    monthlyLimit: account.monthlyLimit,
    monthlyUsed: account.monthlyUsed,
    monthlyRemaining,
    purchasedCredits: account.purchasedCredits,
    totalAvailable: monthlyRemaining + account.purchasedCredits,
    lastResetAt: account.lastResetAt
  };
}

async function consumeCredit({ userId, feature = 'other', requestId = '', metadata = {} }) {
  const { account, developerMode } = await ensureAccount(userId);

  if (requestId) {
    const previous = await AITransaction.findOne({ requestId, userId, type: 'usage', status: 'completed' }).lean();
    if (previous) {
      const fresh = await AICredit.findOne({ userId });
      return { source: previous.creditSource, transaction: previous, balance: balancePayload(fresh), idempotent: true };
    }
  }

  let updated = await AICredit.findOneAndUpdate(
    {
      _id: account._id,
      $expr: { $lt: ['$monthlyUsed', '$monthlyLimit'] }
    },
    {
      $inc: { monthlyUsed: 1, lifetimeUsed: 1 },
      $set: { lastUsageAt: new Date() }
    },
    { new: true }
  );
  let source = 'monthly';

  if (!updated) {
    updated = await AICredit.findOneAndUpdate(
      { _id: account._id, purchasedCredits: { $gte: 1 } },
      {
        $inc: { purchasedCredits: -1, lifetimeUsed: 1 },
        $set: { lastUsageAt: new Date() }
      },
      { new: true }
    );
    source = 'purchased';
  }

  if (!updated) {
    const fresh = await AICredit.findById(account._id);
    const error = new Error('Your included AI labels and purchased AI credits are finished.');
    error.statusCode = 429;
    error.code = 'AI_CREDITS_EXHAUSTED';
    error.balance = balancePayload(fresh);
    throw error;
  }

  // Developer test account is unlimited: restore the included credit immediately.
  if (developerMode) {
    updated.monthlyUsed = 0;
    updated.monthlyLimit = DEV_AI_CREDIT_LIMIT;
    // Keep the existing planKey to remain compatible with any schema enum.
    await updated.save();
  }

  const balance = balancePayload(updated);
  const transaction = await AITransaction.create({
    userId,
    type: 'usage',
    creditSource: source,
    feature,
    credits: -1,
    balanceAfter: updated.purchasedCredits,
    monthlyRemainingAfter: balance.monthlyRemaining,
    requestId: requestId || undefined,
    metadata,
    status: 'completed'
  });

  return { source, transaction, balance, idempotent: false };
}

async function refundCredit({ transactionId, notes = 'AI request failed' }) {
  const usage = await AITransaction.findOne({ _id: transactionId, type: 'usage', status: 'completed' });
  if (!usage) return null;

  const increment = usage.creditSource === 'monthly'
    ? { monthlyUsed: -1, lifetimeUsed: -1 }
    : { purchasedCredits: 1, lifetimeUsed: -1 };

  const account = await AICredit.findOneAndUpdate(
    { userId: usage.userId },
    { $inc: increment },
    { new: true }
  );

  usage.status = 'refunded';
  await usage.save();

  const balance = balancePayload(account);
  await AITransaction.create({
    userId: usage.userId,
    type: 'refund',
    creditSource: usage.creditSource,
    feature: usage.feature,
    credits: 1,
    balanceAfter: account.purchasedCredits,
    monthlyRemainingAfter: balance.monthlyRemaining,
    metadata: { usageTransactionId: usage._id },
    notes,
    status: 'completed'
  });

  return balance;
}

async function addPurchasedCredits({ userId, credits, amount = 0, packKey = '', paymentId = '', orderId = '', type = 'purchase', notes = '' }) {
  if (!Number.isInteger(Number(credits)) || Number(credits) <= 0) {
    const error = new Error('credits must be a positive whole number.');
    error.statusCode = 400;
    throw error;
  }
  const { account } = await ensureAccount(userId);

  if (paymentId) {
    const existing = await AITransaction.findOne({ paymentId }).lean();
    if (existing) {
      const fresh = await AICredit.findOne({ userId });
      return { transaction: existing, balance: balancePayload(fresh), idempotent: true };
    }
  }

  const updated = await AICredit.findByIdAndUpdate(account._id, {
    $inc: { purchasedCredits: Number(credits), lifetimePurchased: Number(credits) }
  }, { new: true });
  const balance = balancePayload(updated);
  const transaction = await AITransaction.create({
    userId,
    type,
    creditSource: 'purchased',
    feature: 'other',
    credits: Number(credits),
    balanceAfter: updated.purchasedCredits,
    monthlyRemainingAfter: balance.monthlyRemaining,
    amount: Number(amount || 0),
    packKey,
    paymentId: paymentId || undefined,
    orderId,
    notes,
    status: 'completed'
  });
  return { transaction, balance, idempotent: false };
}

module.exports = {
  monthKey,
  ensureAccount,
  balancePayload,
  consumeCredit,
  refundCredit,
  addPurchasedCredits
};
