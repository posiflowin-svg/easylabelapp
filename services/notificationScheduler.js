const PushNotification = require('../models/PushNotification');
const DeviceToken = require('../models/DeviceToken');
const UserSubscription = require('../models/UserSubscription');
const firebaseService = require('./firebaseService');

let running = false;
async function sendItem(item) {
  let userIds = null;
  if (item.targetAudience !== 'all') {
    const active = await UserSubscription.find({ status: { $in: ['active','trial','grace_period','cancelled'] }, expiryDate: { $gt: new Date() } }).select('userId planKey').lean();
    if (item.targetAudience === 'free') {
      const paid = new Set(active.map(s => String(s.userId)));
      const registered = await DeviceToken.find({ enabled:true }).select('userId').lean();
      userIds = [...new Set(registered.map(t=>String(t.userId)).filter(id=>!paid.has(id)))];
    } else if (item.targetAudience === 'expired') {
      const current = new Set(active.map(s=>String(s.userId)));
      userIds = (await UserSubscription.distinct('userId')).map(String).filter(id=>!current.has(id));
    } else {
      const key = item.targetAudience === 'business' ? 'business_monthly' : 'premium_monthly';
      userIds = active.filter(s=>s.planKey===key).map(s=>s.userId);
    }
  }
  const q={enabled:true}; if(userIds) q.userId={$in:userIds};
  const docs=await DeviceToken.find(q).select('token').lean();
  const result=await firebaseService.sendToTokens(docs.map(d=>d.token), {title:item.title,body:item.message,imageUrl:item.imageUrl}, {notificationId:String(item._id),actionType:item.actionType,actionValue:item.actionValue,buttonText:item.buttonText});
  if (!result.skipped) { item.status='sent'; item.sentAt=new Date(); item.sentCount=result.successCount||0; item.failedCount=result.failureCount||0; await item.save(); }
}
async function tick(){ if(running)return; running=true; try { const due=await PushNotification.find({status:'scheduled',scheduleAt:{$ne:null,$lte:new Date()}}).limit(25); for(const item of due){try{await sendItem(item)}catch(e){console.error('Scheduled push failed',item._id,e.message)}} } finally {running=false;} }
function start(){ setInterval(tick,60000); setTimeout(tick,5000); }
module.exports={start,tick};
