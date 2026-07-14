const mongoose = require('mongoose');
const DeviceToken = require('../models/DeviceToken');
const UserSubscription = require('../models/UserSubscription');
const PushNotification = require('../models/PushNotification');
const firebaseService = require('../services/firebaseService');

exports.registerDevice = async (req, res) => {
  try {
    const { userId, token, deviceId, appVersion } = req.body;
    if (!mongoose.Types.ObjectId.isValid(userId) || !token) return res.status(400).json({ success: false, message: 'Valid userId and token are required.' });
    const item = await DeviceToken.findOneAndUpdate({ token }, { userId, token, deviceId: deviceId || '', appVersion: appVersion || '', enabled: true, lastSeenAt: new Date() }, { new: true, upsert: true, runValidators: true });
    res.json({ success: true, data: item });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.disableDevice = async (req, res) => {
  try {
    await DeviceToken.updateOne({ token: req.body.token }, { enabled: false });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.send = async (req, res) => {
  try {
    const notification = await PushNotification.findById(req.params.id);
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found.' });
    let userIds = null;
    if (notification.targetAudience !== 'all') {
      const active = await UserSubscription.find({ status: { $in: ['active', 'trial', 'grace_period'] }, expiryDate: { $gt: new Date() } }).select('userId planKey').lean();
      if (notification.targetAudience === 'free') {
        const paid = new Set(active.map(s => String(s.userId)));
        const tokens = await DeviceToken.find({ enabled: true }).lean();
        userIds = [...new Set(tokens.map(t => String(t.userId)).filter(id => !paid.has(id)))];
      } else {
        const planKey = notification.targetAudience === 'business' ? 'business_monthly' : 'premium_monthly';
        userIds = active.filter(s => s.planKey === planKey).map(s => s.userId);
      }
    }
    const query = { enabled: true };
    if (userIds) query.userId = { $in: userIds };
    const tokens = await DeviceToken.find(query).select('token').lean();
    const result = await firebaseService.sendToTokens(tokens.map(t => t.token), { title: notification.title, body: notification.message, imageUrl: notification.imageUrl }, { actionType: notification.actionType, actionValue: notification.actionValue });
    notification.status = result.skipped ? 'draft' : 'sent';
    notification.sentAt = result.skipped ? null : new Date();
    notification.sentCount = result.successCount || 0;
    await notification.save();
    res.json({ success: true, result, data: notification });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};
