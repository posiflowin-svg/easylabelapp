const mongoose = require('mongoose');
const DeviceToken = require('../models/DeviceToken');
const UserSubscription = require('../models/UserSubscription');
const PushNotification = require('../models/PushNotification');
const User = require('../models/User');
const firebaseService = require('../services/firebaseService');

const campaignAuth = require('../middleware/campaignAuth');
exports.registerDevice = [campaignAuth, async (req,res) => {
 try {
  const {token,deviceId,appVersion}=req.body||{};
  if(typeof token!=='string'||token.trim().length<20||token.length>4096)return res.status(400).json({success:false,message:'Valid FCM token required'});
  const user=await User.findById(req.authUserId).select('_id').lean();
  if(!user)return res.status(404).json({success:false,message:'Account not found'});
  const item=await DeviceToken.findOneAndUpdate({token:token.trim()},{$set:{userId:user._id,deviceId:String(deviceId||'').slice(0,128),appVersion:String(appVersion||'').slice(0,60),enabled:true,lastSeenAt:new Date()}},{new:true,upsert:true,runValidators:true});
  res.json({success:true,registered:true});
 }catch(e){res.status(500).json({success:false,message:'Device registration failed'});}
}];
exports.disableDevice = [campaignAuth, async(req,res)=>{
 try {await DeviceToken.updateOne({token:String(req.body?.token||''),userId:req.authUserId},{$set:{enabled:false}});res.json({success:true});}
 catch(e){res.status(500).json({success:false,message:'Unable to disable device'});}
}];

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


exports.trackEvent = async (req, res) => {
  try {
    const type = String(req.body?.type || '').toLowerCase();
    if (!['open', 'click'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be open or click.' });
    }
    const update = type === 'click' ? { $inc: { clickCount: 1 } } : { $inc: { openedCount: 1 } };
    const item = await PushNotification.findByIdAndUpdate(req.params.id, update, { new: true }).select('sentCount openedCount clickCount');
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};
