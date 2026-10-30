'use strict';
const crypto = require('crypto');
const hits = new Map();
function isAdmin(req) { return Boolean(req.session && req.session.adminAuthenticated); }
function reject(req,res) { res.set('Cache-Control','no-store'); return res.status(401).json({success:false,code:'ADMIN_AUTH_REQUIRED',message:'Administrator login required'}); }
function requireAdmin(req,res,next) { if (!isAdmin(req)) return reject(req,res); res.set('Cache-Control','no-store'); next(); }
function adminPage(req,res,next) { if (!isAdmin(req)) return res.redirect('/admin-login'); res.set('Cache-Control','no-store'); next(); }
function loginLimiter(req,res,next) {
  const ip=req.ip||'unknown'; const now=Date.now();
  if(hits.size>5000) for(const [key,val] of hits) if(now-val.start>15*60*1000) hits.delete(key);
  const item=hits.get(ip)||{start:now,count:0};
  if(now-item.start>15*60*1000){item.start=now;item.count=0;}
  item.count++;hits.set(ip,item);
  if(item.count>15) return res.status(429).json({success:false,message:'Too many login attempts. Try again later.'});
  next();
}
function comparePassword(a,b) { const x=crypto.createHash('sha256').update(String(a||'')).digest(); const y=crypto.createHash('sha256').update(String(b||'')).digest(); return crypto.timingSafeEqual(x,y); }
function apiPolicy(req,res,next) {
 const p=req.path, m=req.method;
 const starts=(s)=>p===s||p.startsWith(s+'/');
 // App-facing read and payment paths remain available for old Android clients.
 if(starts('/api/order')) {
   const allowed=m==='POST'&&['/api/order/create','/api/order/payment/create','/api/order/payment/verify'].includes(p);
   // Legacy customer order lookup needs a separate identity-bound design; keep existing app working.
   if(allowed || (m==='GET'&&['/api/order/getById','/api/order/getOrdersByPhone'].includes(p))) return next();
   return requireAdmin(req,res,next);
 }
 if(starts('/api/ai') && m==='GET') return requireAdmin(req,res,next);
 if(starts('/api/walletuser') || starts('/api/wallettransaction') || p==='/api/import-users') return requireAdmin(req,res,next);
 if(starts('/api/appversion')) return (m==='GET'&&p==='/api/appversion/latest')?next():requireAdmin(req,res,next);
 if(starts('/api/showad')) return (m==='GET'&&p==='/api/showad')?next():requireAdmin(req,res,next);
 if(starts('/api/coupon')) return ((m==='POST'&&['/api/coupon/validate','/api/coupon/use'].includes(p))||(m==='GET'&&p.startsWith('/api/coupon/scratch-card/')))?next():requireAdmin(req,res,next);
 if(starts('/api/products')) {
   if(m==='GET') return next();
   return requireAdmin(req,res,next);
 }
 if(starts('/api/shopping')) return m==='GET'?next():requireAdmin(req,res,next);
 if(starts('/api/premium')) {
   if(m==='GET' && (['/api/premium/catalog','/api/premium/campaigns/active'].includes(p)||/^\/api\/premium\/(access\/[^/]+|campaigns\/[^/]+\/image|notifications\/[^/]+\/image)$/.test(p))) return next();
   if(m==='POST' && (/^\/api\/premium\/campaigns\/[^/]+\/(impression|click|dismiss)$/.test(p)||p==='/api/premium/ai-usage')) return next();
   return requireAdmin(req,res,next);
 }
 if(starts('/api/usage')) return (m==='POST'&&p==='/api/usage/events')?next():requireAdmin(req,res,next);
 if(starts('/api/campaign-customer')) return requireAdmin(req,res,next);
 if(starts('/api/targeting')) return requireAdmin(req,res,next);
 if(starts('/api/notifications')) return ((m==='POST'&&['/api/notifications/register-device','/api/notifications/disable-device'].includes(p))||(m==='POST'&&/^\/api\/notifications\/[^/]+\/event$/.test(p)))?next():requireAdmin(req,res,next);
 if(starts('/api/template')) return ((m==='GET')||(m==='POST'&&p==='/api/template/show'))?next():requireAdmin(req,res,next);
 if(starts('/api/borders')) return m==='GET'?next():requireAdmin(req,res,next);
 if(starts('/api/icon-library')) return m==='GET'?next():requireAdmin(req,res,next);
 if(starts('/api/pos-enquiries')) return (m==='POST'&&p==='/api/pos-enquiries')?next():requireAdmin(req,res,next);
 if(starts('/api/admin')) return requireAdmin(req,res,next);
 if(p==='/api/users'||p==='/api/referred-users'||p==='/api/update-status') return requireAdmin(req,res,next);
 next();
}
module.exports={requireAdmin,adminPage,loginLimiter,comparePassword,apiPolicy};
