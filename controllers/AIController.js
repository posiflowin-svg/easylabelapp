const mongoose = require('mongoose');
const UserSubscription = require('../models/UserSubscription');
const PremiumPlan = require('../models/PremiumPlan');
const AIUsage = require('../models/AIUsage');
const aiLabelService = require('../services/aiLabelService');

exports.generateLabel = async (req, res) => {
  const started = Date.now();
  try {
    const { userId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: 'Valid userId is required.' });
    const subscription = await UserSubscription.findOne({ userId, status: { $in: ['active', 'trial', 'grace_period'] }, expiryDate: { $gt: new Date() } }).sort({ expiryDate: -1 });
    if (!subscription) return res.status(403).json({ success: false, code: 'PREMIUM_REQUIRED', message: 'AI Label Designer requires an active subscription.' });
    const plan = await PremiumPlan.findOne({ key: subscription.planKey, active: true });
    if (!plan || !(plan.featureKeys || []).includes('ai_label_design')) return res.status(403).json({ success: false, code: 'FEATURE_NOT_INCLUDED', message: 'AI Label Designer is not included in this plan.' });
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const used = await AIUsage.countDocuments({ userId, status: 'success', createdAt: { $gte: monthStart } });
    if (plan.aiMonthlyLimit > 0 && used >= plan.aiMonthlyLimit) return res.status(429).json({ success: false, code: 'AI_LIMIT_REACHED', message: 'Monthly AI design limit reached.', limit: plan.aiMonthlyLimit, used });
    const result = await aiLabelService.generate(req.body);
    await AIUsage.create({ userId, subscriptionId: subscription._id, requestType: 'generate', status: 'success', modelName: result.provider, generationTimeMs: Date.now() - started, labelSize: `${req.body.widthMm || 50}x${req.body.heightMm || 30}` });
    res.json({ success: true, layout: result.layout, provider: result.provider, usage: { used: used + 1, limit: plan.aiMonthlyLimit } });
  } catch (error) {
    if (mongoose.Types.ObjectId.isValid(req.body.userId)) await AIUsage.create({ userId: req.body.userId, requestType: 'generate', status: 'failed', generationTimeMs: Date.now() - started, notes: error.message }).catch(() => {});
    res.status(500).json({ success: false, message: error.message });
  }
};
