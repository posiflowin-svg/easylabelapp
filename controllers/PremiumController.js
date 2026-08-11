const mongoose = require('mongoose');
const PremiumFeature = require('../models/PremiumFeature');
const PremiumPlan = require('../models/PremiumPlan');
const UserSubscription = require('../models/UserSubscription');
const User = require('../models/User');
const PromoCampaign = require('../models/PromoCampaign');
const CampaignInteraction = require('../models/CampaignInteraction');
const PushNotification = require('../models/PushNotification');
const PremiumSetting = require('../models/PremiumSetting');
const AIUsage = require('../models/AIUsage');
const PaymentTransaction = require('../models/PaymentTransaction');
const Banner = require('../models/Banner');

const DEFAULT_FEATURES = [
  { key: 'premium_fonts', name: 'Premium Fonts', description: 'Exclusive professional fonts for label design.', category: 'design', icon: 'fa-font', displayOrder: 1 },
  { key: 'premium_templates', name: 'Premium Label Templates', description: 'Professionally designed thermal label templates.', category: 'content', icon: 'fa-tags', displayOrder: 2 },
  { key: 'ai_label_design', name: 'AI Label Designer', description: 'AI-assisted editable thermal label layouts.', category: 'ai', icon: 'fa-wand-magic-sparkles', displayOrder: 3 },
  { key: 'cloud_backup', name: 'Cloud Backup', description: 'Secure Quick Billing cloud sync for products, inventory, images, customers, suppliers and sales across devices.', category: 'cloud', icon: 'fa-cloud-arrow-up', displayOrder: 4 },
  { key: 'team_sharing', name: 'Team Sharing', description: 'Share and sync templates across authorised team phones.', category: 'team', icon: 'fa-users', displayOrder: 5 }
];

const DEFAULT_PLANS = [
  {
    key: 'premium_monthly', name: 'EasyLabel Premium', description: 'Premium design tools for individual users.',
    price: 99, billingPeriod: 'monthly', autoRenew: true, displayOrder: 1,
    featureKeys: ['premium_fonts', 'premium_templates', 'ai_label_design'], aiMonthlyLimit: 30, teamMemberLimit: 1
  },
  {
    key: 'business_monthly', name: 'EasyLabel Business', description: 'Premium design plus cloud and team collaboration.',
    price: 299, billingPeriod: 'monthly', autoRenew: true, displayOrder: 2, recommended: true,
    featureKeys: ['premium_fonts', 'premium_templates', 'ai_label_design', 'cloud_backup', 'team_sharing'],
    aiMonthlyLimit: 150, teamMemberLimit: 5
  }
];

async function ensureDefaults() {
  for (const item of DEFAULT_FEATURES) {
    await PremiumFeature.updateOne({ key: item.key }, { $setOnInsert: item }, { upsert: true });
  }
  for (const item of DEFAULT_PLANS) {
    await PremiumPlan.updateOne({ key: item.key }, { $setOnInsert: item }, { upsert: true });
  }
  await PremiumSetting.updateOne({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true });
}

function isActiveSubscription(subscription, now = new Date()) {
  return ['active', 'trial', 'grace_period'].includes(subscription.status) && new Date(subscription.expiryDate) > now;
}


function parseOptionalDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function campaignIdentityQuery(campaignId, userId, deviceId) {
  return {
    campaignId,
    userId: userId || null,
    deviceId: String(deviceId || '')
  };
}

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfWeek(date = new Date()) {
  const value = startOfDay(date);
  const day = value.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + mondayOffset);
  return value;
}

async function resolveCampaignAudience(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { audience: 'free', subscription: null };
  }

  const now = new Date();
  const subscriptions = await UserSubscription.find({ userId })
    .sort({ expiryDate: -1, createdAt: -1 })
    .lean();

  const active = subscriptions.find(item => isActiveSubscription(item, now));
  if (active) {
    if (active.planKey === 'business_monthly' || String(active.planKey).includes('business')) {
      return { audience: 'business', subscription: active };
    }
    return { audience: 'premium', subscription: active };
  }

  const hadSubscription = subscriptions.length > 0;
  return {
    audience: hadSubscription ? 'expired' : 'free',
    subscription: subscriptions[0] || null
  };
}

function campaignMatchesAudience(campaign, audience) {
  return campaign.targetAudience === 'all' || campaign.targetAudience === audience;
}

function campaignFrequencyAllows(campaign, interaction, now = new Date()) {
  if (!interaction) return true;

  const count = Number(interaction.impressionCount || 0);
  const maxDisplays = Number(campaign.maxDisplays || 0);
  if (maxDisplays > 0 && count >= maxDisplays) return false;

  if (campaign.frequency === 'every_open') return true;
  if (campaign.frequency === 'once') return count === 0;

  if (!interaction.lastDisplayedAt) return true;

  const last = new Date(interaction.lastDisplayedAt);
  if (campaign.frequency === 'daily') return last < startOfDay(now);
  if (campaign.frequency === 'weekly') return last < startOfWeek(now);

  return true;
}

function sanitizeCampaignPayload(body) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('Campaign title is required.');

  const startDate = parseOptionalDate(body.startDate, new Date());
  const endDate = parseOptionalDate(body.endDate, null);

  if (endDate && startDate && endDate <= startDate) {
    throw new Error('End date must be after start date.');
  }

  const buttonAction = body.buttonAction || 'open_subscription';
  const actionValue = String(body.actionValue || '').trim();

  if (buttonAction === 'open_url' && actionValue) {
    try {
      const parsed = new URL(actionValue);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch (_) {
      throw new Error('Open URL action requires a valid http/https URL.');
    }
  }

  if (buttonAction === 'open_feature' && !actionValue) {
    throw new Error('Open Feature action requires a feature key/page value.');
  }

  return {
    title,
    campaignType: body.campaignType || 'popup',
    subtitle: String(body.subtitle || '').trim(),
    imageUrl: String(body.imageUrl || '').trim(),
    buttonText: String(body.buttonText || 'View Plans').trim(),
    buttonAction,
    actionValue,
    targetAudience: body.targetAudience || 'free',
    frequency: body.frequency || 'once',
    startDate,
    endDate,
    active: body.active === true || body.active === 'true',
    priority: Number(body.priority || 0),
    maxDisplays: Math.max(0, Number(body.maxDisplays || 0))
  };
}

exports.page = async (req, res) => {
  try {
    await ensureDefaults();
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const [features, plans, subscriptions, users, totalUsers, campaigns, notifications, settings, payments, aiUsageMonth, aiUsageToday, homeBanners] = await Promise.all([
      PremiumFeature.find().sort({ displayOrder: 1, createdAt: 1 }).lean(),
      PremiumPlan.find().sort({ displayOrder: 1, price: 1 }).lean(),
      UserSubscription.find().sort({ createdAt: -1 }).limit(1000).populate('userId', 'name email phone mobile').lean(),
      User.find().select('name email phone mobile').sort({ createdAt: -1 }).limit(3000).lean(),
      User.countDocuments(),
      PromoCampaign.find().sort({ priority: -1, createdAt: -1 }).limit(200).lean(),
      PushNotification.find().sort({ createdAt: -1 }).limit(200).lean(),
      PremiumSetting.findOne({ key: 'global' }).lean(),
      PaymentTransaction.find({ status: 'paid', paidAt: { $gte: monthStart } }).sort({ paidAt: -1 }).limit(500).lean(),
      AIUsage.find({ createdAt: { $gte: monthStart } }).sort({ createdAt: -1 }).limit(1000).lean(),
      AIUsage.find({ createdAt: { $gte: todayStart } }).lean(),
      Banner.find().sort({ position: 1, createdAt: -1 }).lean()
    ]);

    const now = new Date();
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const activeSubscriptions = subscriptions.filter(s => isActiveSubscription(s, now));
    const premiumCount = activeSubscriptions.filter(s => s.planKey === 'premium_monthly').length;
    const businessCount = activeSubscriptions.filter(s => s.planKey === 'business_monthly').length;
    const expiringSoon = activeSubscriptions.filter(s => new Date(s.expiryDate) <= inSevenDays).length;
    const expiredCount = subscriptions.filter(s => s.status === 'expired' || new Date(s.expiryDate) <= now).length;
    const trialCount = activeSubscriptions.filter(s => s.status === 'trial').length;
    const estimatedMrr = activeSubscriptions.reduce((sum, s) => {
      const plan = plans.find(p => p.key === s.planKey);
      if (!plan || !plan.active) return sum;
      if (plan.billingPeriod === 'monthly') return sum + Number(plan.price || 0);
      if (plan.billingPeriod === 'yearly') return sum + Number(plan.price || 0) / 12;
      return sum;
    }, 0);

    const paidRevenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const aiMonthCost = aiUsageMonth.reduce((sum, u) => sum + Number(u.estimatedCostInr || 0), 0);
    const aiSuccess = aiUsageMonth.filter(u => u.status === 'success');
    const avgGenerationMs = aiSuccess.length ? Math.round(aiSuccess.reduce((sum, u) => sum + Number(u.generationTimeMs || 0), 0) / aiSuccess.length) : 0;
    const autoRenewCount = activeSubscriptions.filter(s => s.autoRenew).length;
    const cancelledCount = subscriptions.filter(s => s.status === 'cancelled').length;
    const renewalRate = activeSubscriptions.length ? (autoRenewCount / activeSubscriptions.length) * 100 : 0;
    const churnRate = subscriptions.length ? (cancelledCount / subscriptions.length) * 100 : 0;

    res.render('premium', {
      features, plans, subscriptions, users, campaigns, notifications, settings, payments, aiUsageMonth, homeBanners,
      aiStats: { today: aiUsageToday.length, month: aiUsageMonth.length, cost: aiMonthCost, avgGenerationMs },
      stats: {
        totalUsers,
        freeUsers: Math.max(0, totalUsers - activeSubscriptions.length),
        active: activeSubscriptions.length,
        premiumCount,
        businessCount,
        estimatedMrr: Math.round(estimatedMrr),
        expiringSoon,
        expiredCount,
        trialCount,
        paidRevenue: Math.round(paidRevenue),
        renewalRate: Number(renewalRate.toFixed(1)),
        churnRate: Number(churnRate.toFixed(1)),
        autoRenewCount,
        cancelledCount
      }
    });
  } catch (error) {
    console.error('Subscription Management page error:', error);
    res.status(500).send('Unable to load Subscription Management. ' + error.message);
  }
};

exports.createFeature = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    if (!key || !req.body.name) return res.status(400).json({ success: false, message: 'Feature key and name are required.' });
    const feature = await PremiumFeature.create({
      key,
      name: req.body.name,
      description: req.body.description || '',
      category: req.body.category || 'other',
      icon: req.body.icon || 'fa-star',
      enabled: req.body.enabled === true || req.body.enabled === 'true',
      displayOrder: Number(req.body.displayOrder || 0)
    });
    res.json({ success: true, data: feature });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Feature key already exists.' });
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteFeature = async (req, res) => {
  try {
    const feature = await PremiumFeature.findById(req.params.id);
    if (!feature) return res.status(404).json({ success: false, message: 'Feature not found' });
    const usedByPlan = await PremiumPlan.exists({ featureKeys: feature.key });
    if (usedByPlan) return res.status(409).json({ success: false, message: 'Remove this feature from all plans before deleting it.' });
    await feature.deleteOne();
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.updateFeature = async (req, res) => {
  try {
    const feature = await PremiumFeature.findByIdAndUpdate(req.params.id, {
      enabled: req.body.enabled === 'true' || req.body.enabled === true,
      name: req.body.name,
      description: req.body.description,
      category: req.body.category || 'other',
      icon: req.body.icon || 'fa-star',
      displayOrder: Number(req.body.displayOrder || 0)
    }, { new: true, runValidators: true });
    if (!feature) return res.status(404).json({ success: false, message: 'Feature not found' });
    res.json({ success: true, data: feature });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.createPlan = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    if (!key || !req.body.name) return res.status(400).json({ success: false, message: 'Plan key and name are required.' });
    const plan = await PremiumPlan.create({
      key,
      name: req.body.name,
      description: req.body.description || '',
      badgeText: req.body.badgeText || '',
      price: Number(req.body.price || 0),
      yearlyPrice: Number(req.body.yearlyPrice || 0),
      freeTrialDays: Number(req.body.freeTrialDays || 0),
      billingPeriod: req.body.billingPeriod || 'monthly',
      autoRenew: req.body.autoRenew === true || req.body.autoRenew === 'true',
      active: req.body.active !== false && req.body.active !== 'false',
      recommended: req.body.recommended === true || req.body.recommended === 'true',
      displayOrder: Number(req.body.displayOrder || 0),
      featureKeys: Array.isArray(req.body.featureKeys) ? req.body.featureKeys : [],
      aiMonthlyLimit: Number(req.body.aiMonthlyLimit || 0),
      teamMemberLimit: Number(req.body.teamMemberLimit || 1),
      googleProductId: req.body.googleProductId || '',
      googleBasePlanId: req.body.googleBasePlanId || ''
    });
    res.json({ success: true, data: plan });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Plan key already exists.' });
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    const plan = await PremiumPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    const hasSubscriptions = await UserSubscription.exists({ planKey: plan.key, status: { $in: ['active', 'trial', 'grace_period'] } });
    if (hasSubscriptions) return res.status(409).json({ success: false, message: 'This plan has active subscriptions. Deactivate it instead of deleting.' });
    await plan.deleteOne();
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.updatePlan = async (req, res) => {
  try {
    const featureKeys = Array.isArray(req.body.featureKeys)
      ? req.body.featureKeys
      : (req.body.featureKeys ? [req.body.featureKeys] : []);

    const update = {
      name: req.body.name,
      description: req.body.description || '',
      badgeText: req.body.badgeText || '',
      price: Number(req.body.price),
      yearlyPrice: Number(req.body.yearlyPrice || 0),
      freeTrialDays: Number(req.body.freeTrialDays || 0),
      billingPeriod: req.body.billingPeriod || 'monthly',
      autoRenew: req.body.autoRenew === 'true' || req.body.autoRenew === true,
      active: req.body.active === 'true' || req.body.active === true,
      recommended: req.body.recommended === 'true' || req.body.recommended === true,
      displayOrder: Number(req.body.displayOrder || 0),
      featureKeys,
      aiMonthlyLimit: Number(req.body.aiMonthlyLimit || 0),
      teamMemberLimit: Number(req.body.teamMemberLimit || 1),
      googleProductId: req.body.googleProductId || '',
      googleBasePlanId: req.body.googleBasePlanId || ''
    };
    const plan = await PremiumPlan.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};


exports.searchUsers = async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    if (!raw) return res.json({ success: true, users: [] });

    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const digits = raw.replace(/\D/g, '');
    const clauses = [];

    if (raw.length >= 2) {
      const rx = new RegExp(escapeRegex(raw), 'i');
      clauses.push({ name: rx }, { email: rx });
    }

    if (digits) {
      clauses.push({ phone: new RegExp(escapeRegex(digits)) });
    }

    if (mongoose.Types.ObjectId.isValid(raw)) {
      clauses.push({ _id: raw });
    }

    if (!clauses.length) return res.json({ success: true, users: [] });

    const users = await User.find({ $or: clauses })
      .select('name email phone')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ success: true, users });
  } catch (error) {
    console.error('Premium user search error:', error);
    res.status(500).json({ success: false, message: 'Unable to search users. ' + error.message });
  }
};

exports.createSubscription = async (req, res) => {
  try {
    const { userId, planKey, expiryDate, autoRenew, notes, status } = req.body;
    if (!userId || !planKey || !expiryDate) {
      return res.status(400).json({ success: false, message: 'User, plan and expiry date are required.' });
    }
    await UserSubscription.updateMany(
      { userId, status: { $in: ['active', 'trial', 'grace_period'] } },
      { $set: { status: 'cancelled' } }
    );
    const subscription = await UserSubscription.create({
      userId,
      planKey,
      expiryDate,
      autoRenew: autoRenew === 'true' || autoRenew === true,
      notes: notes || '',
      source: 'manual',
      status: status || 'active',
      googleOrderId: req.body.googleOrderId || '',
      deviceCount: Number(req.body.deviceCount || 1),

      // Manual subscriptions do not have a Google Play purchase token.
      // Do not store an empty string because purchaseToken has a sparse
      // unique index and multiple "" values trigger E11000.
      purchaseToken: undefined,
      googleProductId: '',
      verificationMode: 'manual'
    });
    res.json({ success: true, data: subscription });
  } catch (error) {
    if (error && error.code === 11000 && error.keyPattern && error.keyPattern.purchaseToken) {
      return res.status(400).json({
        success: false,
        message: 'Manual subscription could not be saved because of an old empty purchase-token record. Please retry after deploying the latest subscription fix.'
      });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateSubscriptionStatus = async (req, res) => {
  try {
    const subscription = await UserSubscription.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true }
    );
    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found' });
    res.json({ success: true, data: subscription });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.extendSubscription = async (req, res) => {
  try {
    const days = Number(req.body.days || 0);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return res.status(400).json({ success: false, message: 'Enter valid extension days.' });
    }
    const subscription = await UserSubscription.findById(req.params.id);
    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found' });
    const base = new Date(subscription.expiryDate) > new Date() ? new Date(subscription.expiryDate) : new Date();
    base.setDate(base.getDate() + days);
    subscription.expiryDate = base;
    if (['expired', 'cancelled'].includes(subscription.status)) subscription.status = 'active';
    await subscription.save();
    res.json({ success: true, data: subscription });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.catalog = async (req, res) => {
  try {
    await ensureDefaults();
    const [features, plans] = await Promise.all([
      PremiumFeature.find({ enabled: true }).sort({ displayOrder: 1 }).lean(),
      PremiumPlan.find({ active: true }).sort({ displayOrder: 1, price: 1 }).lean()
    ]);
    res.json({ success: true, features, plans });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.access = async (req, res) => {
  try {
    const userId = req.params.userId;
    const subscription = await UserSubscription.findOne({
      userId,
      status: { $in: ['active', 'trial', 'grace_period'] },
      expiryDate: { $gt: new Date() }
    }).sort({ expiryDate: -1 }).lean();

    if (!subscription) {
      return res.json({ success: true, subscription: null, entitlements: {}, limits: { aiDesignMonthly: 0, teamMembers: 1 } });
    }
    const plan = await PremiumPlan.findOne({ key: subscription.planKey, active: true }).lean();
    const enabledFeatures = await PremiumFeature.find({ enabled: true }).select('key').lean();
    const enabledSet = new Set(enabledFeatures.map(f => f.key));
    const entitlements = {};
    (plan?.featureKeys || []).forEach(key => { entitlements[key] = enabledSet.has(key); });

    res.json({
      success: true,
      subscription: {
        plan: subscription.planKey,
        status: subscription.status,
        expiresAt: subscription.expiryDate,
        autoRenew: subscription.autoRenew
      },
      entitlements,
      limits: {
        aiDesignMonthly: plan?.aiMonthlyLimit || 0,
        teamMembers: plan?.teamMemberLimit || 1
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.changeSubscriptionPlan = async (req, res) => {
  try {
    const plan = await PremiumPlan.findOne({ key: req.body.planKey, active: true });
    if (!plan) return res.status(400).json({ success: false, message: 'Selected plan is not active.' });
    const subscription = await UserSubscription.findByIdAndUpdate(req.params.id, { planKey: plan.key }, { new: true, runValidators: true });
    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found' });
    res.json({ success: true, data: subscription });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.createCampaign = async (req, res) => {
  try {
    const payload = sanitizeCampaignPayload(req.body);
    const campaign = await PromoCampaign.create(payload);
    res.json({ success: true, data: campaign });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.toggleCampaign = async (req, res) => {
  try {
    const campaign = await PromoCampaign.findByIdAndUpdate(req.params.id, { active: req.body.active === true || req.body.active === 'true' }, { new: true });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, data: campaign });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const item = await PromoCampaign.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Campaign not found' });
    await CampaignInteraction.deleteMany({ campaignId: item._id });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.createNotification = async (req, res) => {
  try {
    const status = req.body.scheduleAt ? 'scheduled' : 'draft';
    const item = await PushNotification.create({
      title: req.body.title,
      message: req.body.message,
      imageUrl: req.body.imageUrl || '',
      targetAudience: req.body.targetAudience || 'all',
      actionType: req.body.actionType || 'none',
      actionValue: req.body.actionValue || '',
      buttonText: req.body.buttonText || '',
      scheduleAt: req.body.scheduleAt || null,
      status
    });
    res.json({ success: true, data: item });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.updateNotificationStatus = async (req, res) => {
  try {
    const allowed = ['draft', 'scheduled', 'sent', 'cancelled'];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ success: false, message: 'Invalid notification status.' });
    const update = { status: req.body.status };
    if (req.body.status === 'sent') update.sentAt = new Date();
    const item = await PushNotification.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, data: item });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.deleteNotification = async (req, res) => {
  try {
    const item = await PushNotification.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.updateSettings = async (req, res) => {
  try {
    const bool = v => v === true || v === 'true';
    const settings = await PremiumSetting.findOneAndUpdate({ key: 'global' }, {
      premiumSystemEnabled: bool(req.body.premiumSystemEnabled),
      aiDesignerEnabled: bool(req.body.aiDesignerEnabled),
      cloudBackupEnabled: bool(req.body.cloudBackupEnabled),
      teamSharingEnabled: bool(req.body.teamSharingEnabled),
      popupEnabled: bool(req.body.popupEnabled),
      notificationsEnabled: bool(req.body.notificationsEnabled),
      defaultCloudRetentionDays: Number(req.body.defaultCloudRetentionDays || 30),
      supportEmail: req.body.supportEmail || ''
    }, { new: true, upsert: true, runValidators: true });
    res.json({ success: true, data: settings });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.activeCampaigns = async (req, res) => {
  try {
    const now = new Date();
    const userId = String(req.query.userId || '').trim();
    const deviceId = String(req.query.deviceId || '').trim();
    const campaignType = String(req.query.campaignType || '').trim();

    const audienceInfo = await resolveCampaignAudience(userId);
    const query = {
      active: true,
      startDate: { $lte: now },
      $or: [{ endDate: null }, { endDate: { $gte: now } }]
    };

    if (campaignType) query.campaignType = campaignType;

    const campaigns = await PromoCampaign.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    const eligible = [];
    for (const campaign of campaigns) {
      if (!campaignMatchesAudience(campaign, audienceInfo.audience)) continue;

      const identity = campaignIdentityQuery(
        campaign._id,
        mongoose.Types.ObjectId.isValid(userId) ? userId : null,
        deviceId
      );

      const interaction = await CampaignInteraction.findOne(identity).lean();
      if (!campaignFrequencyAllows(campaign, interaction, now)) continue;

      eligible.push({
        ...campaign,
        userAudience: audienceInfo.audience,
        userDisplayCount: Number(interaction?.impressionCount || 0)
      });
    }

    res.json({
      success: true,
      audience: audienceInfo.audience,
      campaigns: eligible
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.recordCampaignImpression = async (req, res) => {
  try {
    const campaign = await PromoCampaign.findById(req.params.id);
    if (!campaign || !campaign.active) {
      return res.status(404).json({ success: false, message: 'Active campaign not found' });
    }

    const userIdRaw = String(req.body.userId || '').trim();
    const userId = mongoose.Types.ObjectId.isValid(userIdRaw) ? userIdRaw : null;
    const deviceId = String(req.body.deviceId || '').trim();
    const identity = campaignIdentityQuery(campaign._id, userId, deviceId);

    const existing = await CampaignInteraction.findOne(identity).lean();
    if (!campaignFrequencyAllows(campaign.toObject(), existing, new Date())) {
      return res.status(409).json({
        success: false,
        message: 'Campaign display limit or frequency has already been reached.'
      });
    }

    const now = new Date();
    const interaction = await CampaignInteraction.findOneAndUpdate(
      identity,
      {
        $inc: { impressionCount: 1 },
        $set: { lastDisplayedAt: now },
        $setOnInsert: { firstDisplayedAt: now }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    campaign.displayCount = Number(campaign.displayCount || 0) + 1;
    campaign.lastDisplayedAt = now;
    await campaign.save();

    res.json({
      success: true,
      displayCount: interaction.impressionCount
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.recordCampaignClick = async (req, res) => {
  try {
    const campaign = await PromoCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const userIdRaw = String(req.body.userId || '').trim();
    const userId = mongoose.Types.ObjectId.isValid(userIdRaw) ? userIdRaw : null;
    const deviceId = String(req.body.deviceId || '').trim();
    const now = new Date();

    await CampaignInteraction.findOneAndUpdate(
      campaignIdentityQuery(campaign._id, userId, deviceId),
      {
        $inc: { clickCount: 1 },
        $set: { lastClickedAt: now }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    campaign.clickCount = Number(campaign.clickCount || 0) + 1;
    campaign.lastClickedAt = now;
    await campaign.save();

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.recordCampaignDismiss = async (req, res) => {
  try {
    const campaign = await PromoCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const userIdRaw = String(req.body.userId || '').trim();
    const userId = mongoose.Types.ObjectId.isValid(userIdRaw) ? userIdRaw : null;
    const deviceId = String(req.body.deviceId || '').trim();
    const now = new Date();

    await CampaignInteraction.findOneAndUpdate(
      campaignIdentityQuery(campaign._id, userId, deviceId),
      {
        $inc: { dismissCount: 1 },
        $set: { lastDismissedAt: now }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    campaign.dismissCount = Number(campaign.dismissCount || 0) + 1;
    await campaign.save();

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.campaignStats = async (req, res) => {
  try {
    const campaign = await PromoCampaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const uniqueUsers = await CampaignInteraction.countDocuments({
      campaignId: campaign._id,
      impressionCount: { $gt: 0 }
    });

    const ctr = campaign.displayCount > 0
      ? Number(((campaign.clickCount || 0) / campaign.displayCount * 100).toFixed(2))
      : 0;

    res.json({
      success: true,
      data: {
        impressions: Number(campaign.displayCount || 0),
        clicks: Number(campaign.clickCount || 0),
        dismissals: Number(campaign.dismissCount || 0),
        uniqueUsers,
        ctr
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const payload = sanitizeCampaignPayload(req.body);
    const item = await PromoCampaign.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateNotification = async (req, res) => {
  try {
    const item = await PushNotification.findByIdAndUpdate(req.params.id, {
      title: req.body.title,
      message: req.body.message,
      imageUrl: req.body.imageUrl || '',
      targetAudience: req.body.targetAudience || 'all',
      actionType: req.body.actionType || 'none',
      actionValue: req.body.actionValue || '',
      buttonText: req.body.buttonText || '',
      scheduleAt: req.body.scheduleAt || null,
      status: req.body.status || 'draft'
    }, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, data: item });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.sendNotification = async (req, res) => {
  try {
    const item = await PushNotification.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found' });
    // Phase 1.8: queue-ready admin action. Firebase delivery is connected in Phase 2.
    item.status = 'sent';
    item.sentAt = new Date();
    item.sentCount = Number(req.body.sentCount || 0);
    await item.save();
    res.json({ success: true, data: item, message: 'Marked as sent. Connect Firebase in Phase 2 for live delivery.' });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.deleteSubscription = async (req, res) => {
  try {
    const item = await UserSubscription.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Subscription not found' });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.recordManualPayment = async (req, res) => {
  try {
    const subscription = await UserSubscription.findById(req.params.id);
    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found' });
    const plan = await PremiumPlan.findOne({ key: subscription.planKey });
    const payment = await PaymentTransaction.create({
      userId: subscription.userId,
      subscriptionId: subscription._id,
      planKey: subscription.planKey,
      amount: Number(req.body.amount || plan?.price || 0),
      source: 'manual',
      status: 'paid',
      orderId: req.body.orderId || '',
      notes: req.body.notes || 'Manual admin payment entry'
    });
    res.json({ success: true, data: payment });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.recordAIUsage = async (req, res) => {
  try {
    const item = await AIUsage.create({
      userId: req.body.userId,
      subscriptionId: req.body.subscriptionId || null,
      requestType: req.body.requestType || 'generate',
      status: req.body.status || 'success',
      modelName: req.body.modelName || 'layout-ai',
      inputTokens: Number(req.body.inputTokens || 0),
      outputTokens: Number(req.body.outputTokens || 0),
      estimatedCostInr: Number(req.body.estimatedCostInr || 0),
      generationTimeMs: Number(req.body.generationTimeMs || 0),
      labelSize: req.body.labelSize || '',
      notes: req.body.notes || ''
    });
    res.json({ success: true, data: item });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};
