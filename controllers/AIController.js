const mongoose = require('mongoose');
const AIUsage = require('../models/AIUsage');
const AITransaction = require('../models/AITransaction');
const AICredit = require('../models/AICredit');
const aiLabelService = require('../services/aiLabelService');
const creditService = require('../services/aiCreditService');

function apiError(res, error) {
  return res.status(error.statusCode || 500).json({
    success: false,
    code: error.code || 'AI_REQUEST_FAILED',
    message: error.message,
    balance: error.balance || undefined
  });
}

exports.getCredits = async (req, res) => {
  try {
    const userId = req.params.userId || req.query.userId;
    const { account, subscription, plan } = await creditService.ensureAccount(userId);
    return res.json({
      success: true,
      balance: creditService.balancePayload(account),
      subscription: subscription ? {
        planKey: subscription.planKey,
        status: subscription.status,
        expiryDate: subscription.expiryDate
      } : null,
      plan: plan ? { name: plan.name, aiMonthlyLimit: plan.aiMonthlyLimit } : null
    });
  } catch (error) {
    return apiError(res, error);
  }
};

exports.useCredit = async (req, res) => {
  try {
    const { userId, feature = 'other', requestId = '', metadata = {} } = req.body;
    const result = await creditService.consumeCredit({ userId, feature, requestId, metadata });
    return res.json({ success: true, ...result });
  } catch (error) {
    return apiError(res, error);
  }
};

exports.purchaseConfirmation = async (req, res) => {
  try {
    const { userId, credits, amount, packKey, paymentId, orderId, notes } = req.body;
    if (!paymentId) return res.status(400).json({ success: false, message: 'paymentId is required.' });
    const result = await creditService.addPurchasedCredits({
      userId,
      credits: Number(credits),
      amount: Number(amount || 0),
      packKey,
      paymentId,
      orderId,
      type: 'purchase',
      notes
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return apiError(res, error);
  }
};

exports.adminGrantCredits = async (req, res) => {
  try {
    const { userId, credits, notes } = req.body;
    const result = await creditService.addPurchasedCredits({
      userId,
      credits: Number(credits),
      type: 'admin_grant',
      notes: notes || 'Granted by administrator'
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return apiError(res, error);
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Valid userId is required.' });
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const transactions = await AITransaction.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ success: true, transactions });
  } catch (error) {
    return apiError(res, error);
  }
};

exports.adminDashboard = async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [todayRequests, monthRequests, failedRequests, activeCreditUsers, totals, revenue, features] = await Promise.all([
      AIUsage.countDocuments({ createdAt: { $gte: dayStart } }),
      AIUsage.countDocuments({ createdAt: { $gte: monthStart } }),
      AIUsage.countDocuments({ createdAt: { $gte: monthStart }, status: 'failed' }),
      AICredit.countDocuments({ $or: [{ monthlyLimit: { $gt: 0 } }, { purchasedCredits: { $gt: 0 } }] }),
      AICredit.aggregate([{ $group: { _id: null, purchasedRemaining: { $sum: '$purchasedCredits' }, lifetimePurchased: { $sum: '$lifetimePurchased' }, lifetimeUsed: { $sum: '$lifetimeUsed' } } }]),
      AITransaction.aggregate([{ $match: { type: 'purchase', status: 'completed', createdAt: { $gte: monthStart } } }, { $group: { _id: null, amount: { $sum: '$amount' }, credits: { $sum: '$credits' } } }]),
      AIUsage.aggregate([{ $match: { createdAt: { $gte: monthStart }, status: 'success' } }, { $group: { _id: '$requestType', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
    ]);

    return res.json({
      success: true,
      dashboard: {
        todayRequests,
        monthRequests,
        failedRequests,
        activeCreditUsers,
        purchasedCreditsRemaining: totals[0]?.purchasedRemaining || 0,
        lifetimePurchasedCredits: totals[0]?.lifetimePurchased || 0,
        lifetimeUsedCredits: totals[0]?.lifetimeUsed || 0,
        monthlyCreditRevenue: revenue[0]?.amount || 0,
        monthlyCreditsSold: revenue[0]?.credits || 0,
        featureUsage: features.map(item => ({ feature: item._id, count: item.count }))
      }
    });
  } catch (error) {
    return apiError(res, error);
  }
};

exports.generateLabel = async (req, res) => {
  const started = Date.now();
  let debit = null;
  try {
    const { userId, requestId = '' } = req.body;
    debit = await creditService.consumeCredit({
      userId,
      feature: 'design',
      requestId,
      metadata: { labelSize: `${req.body.widthMm || 50}x${req.body.heightMm || 30}` }
    });

    const result = await aiLabelService.generate(req.body);
    const { subscription } = await creditService.ensureAccount(userId);

    await AIUsage.create({
      userId,
      subscriptionId: subscription?._id || null,
      requestType: 'design',
      status: 'success',
      creditSource: debit.source,
      creditTransactionId: debit.transaction._id,
      requestId: requestId || undefined,
      modelName: result.provider,
      generationTimeMs: Date.now() - started,
      labelSize: `${req.body.widthMm || 50}x${req.body.heightMm || 30}`
    });

    return res.json({
      success: true,
      layout: result.layout,
      provider: result.provider,
      credits: debit.balance
    });
  } catch (error) {
    if (debit && debit.transaction && !debit.idempotent) {
      await creditService.refundCredit({ transactionId: debit.transaction._id, notes: error.message }).catch(() => {});
    }
    if (mongoose.Types.ObjectId.isValid(req.body.userId)) {
      await AIUsage.create({
        userId: req.body.userId,
        requestType: 'design',
        status: 'failed',
        creditSource: debit?.source || 'none',
        creditTransactionId: debit?.transaction?._id || null,
        requestId: req.body.requestId || undefined,
        generationTimeMs: Date.now() - started,
        notes: error.message
      }).catch(() => {});
    }
    return apiError(res, error);
  }
};
