const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PosEnquiry = require('../models/PosEnquiry');
const router = express.Router();
const valid = (value, allowed) => allowed.includes(value);
router.post('/', async (req,res) => {
  try {
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];
    let user = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'verySecretValue');
        user = await User.findById(decoded.userId).select('name email phone');
      } catch (error) {
        // Expired/invalid token is not proof of identity. Reject rather than
        // silently downgrade a purportedly authenticated submission.
        return res.status(401).json({success:false,message:'Session expired.'});
      }
      if (!user) return res.status(401).json({success:false,message:'Account not found.'});
    }
    const body = req.body || {};
    const supportedTypes = ['POS','THERMAL_LABEL','THERMAL_RECEIPT','MOBILE_PRINTER','RECEIPT_PRINTER','LABEL_PRINTER','BARCODE_SCANNER'];
    const enquiryType = body.enquiryType || 'POS';
    if (!supportedTypes.includes(enquiryType)) return res.status(400).json({success:false,message:'Invalid enquiry category.'});
    const {businessType,outlets,purchaseTimeline,discountInterest} = body;
    let enquiryFields;
    if (enquiryType === 'THERMAL_LABEL') {
      const usage = ['Below 1,000','1,000–5,000','5,000–10,000','10,000–50,000','Above 50,000'];
      const sizes = ['50 x 25 mm','50 x 30 mm','50 x 50 mm','38 x 25 mm','100 x 150 mm','Other / Not Sure'];
      const types = ['Tearable','Non-Tearable','Not Sure'];
      if (!valid(body.monthlyLabelUsage,usage) || !valid(body.labelSize,sizes) ||
          !valid(body.labelType,types) || typeof body.hasLabelPrinter !== 'boolean') {
        return res.status(400).json({success:false,message:'Please complete the Thermal Label enquiry questions.'});
      }
      enquiryFields = { enquiryType, category:'Thermal Label',
        monthlyLabelUsage:body.monthlyLabelUsage, labelSize:body.labelSize,
        labelType:body.labelType, hasLabelPrinter:body.hasLabelPrinter,
        specialRequirements:String(body.specialRequirements || '').trim().slice(0,1000),
        productId:String(body.productId || '').slice(0,120),
        productName:String(body.productName || '').slice(0,200),
        sku:String(body.sku || '').slice(0,120) };
    } else if (enquiryType !== 'POS') {
      const definitions = {
        THERMAL_RECEIPT: {monthlyRollUsage:['Below 100','100–500','500–1,000','1,000–5,000','Above 5,000'],paperWidth:['58mm','80mm','Other / Not Sure'],rollDiameter:['30mm','40mm','50mm','80mm','Not Sure'],hasLabelPrinter:[true,false]},
        MOBILE_PRINTER: {businessType:['Retail / Grocery Store','Restaurant / Cafe','Delivery / Logistics','Pharmacy / Medical Store','Billing / Field Sales','Other'],dailyVolume:['Below 100','100–500','500–1,000','Above 1,000'],purchaseQuantity:['1','2–5','6–10','Above 10'],paperWidth:['58mm','80mm','Not Sure']},
        RECEIPT_PRINTER: {businessType:['Retail / Grocery Store','Restaurant / Cafe','Delivery / Logistics','Pharmacy / Medical Store','Billing / Field Sales','Other'],dailyVolume:['Below 100','100–500','500–1,000','Above 1,000'],purchaseQuantity:['1','2–5','6–10','Above 10'],paperWidth:['58mm','80mm','Not Sure']},
        LABEL_PRINTER: {labelWidth:['2 inch','3 inch','4 inch','Not Sure'],dailyVolume:['Below 500','500–2,000','Above 2,000'],connectivity:['USB','Bluetooth','Wi-Fi','LAN','Not Sure'],printingPurpose:['Product Labels','Shipping Labels','Barcode Labels','Other'],purchaseQuantity:['1','2–5','6–10','Above 10']},
        BARCODE_SCANNER: {businessType:['Retail / Grocery Store','Supermarket / Hypermarket','Pharmacy / Medical Store','Warehouse / Logistics','Clothing / Fashion Store','Other'],dailyVolume:['Below 100','100–500','500–1,000','Above 1,000'],purchaseQuantity:['1','2–5','6–10','Above 10'],scannerType:['Wired USB','Wireless','Desktop / Hands-Free','Not Sure']}
      };
      const fields = definitions[enquiryType];
      if (!fields || Object.entries(fields).some(([key,values])=>!valid(body[key],values)))
        return res.status(400).json({success:false,message:'Please complete all required enquiry questions.'});
      enquiryFields = {enquiryType,category:enquiryType,...Object.fromEntries(Object.keys(fields).map(key=>[key,body[key]])),
        specialRequirements:String(body.specialRequirements||'').trim().slice(0,1000),
        productId:String(body.productId||'').slice(0,120),productName:String(body.productName||'').slice(0,200),sku:String(body.sku||'').slice(0,120)};
    } else {
      if (!valid(businessType,['Retail Shop','Supermarket','Restaurant / Cafe','Other Business','Other']) ||
          !valid(outlets,['1 Outlet','2-5 Outlets','6+ Outlets']) ||
          !valid(purchaseTimeline,['Within 7 Days','Within 30 Days','Exploring Options','Just Exploring']) ||
          typeof discountInterest !== 'boolean') return res.status(400).json({success:false,message:'Please answer all POS enquiry questions.'});
      enquiryFields = {enquiryType,businessType,outlets,purchaseTimeline,discountInterest};
    }
    let contact;
    if (user) {
      contact = { user:user._id, customerName:user.name, customerEmail:user.email,
        customerPhone:user.phone, identityVerification:'Verified' };
    } else {
      // A legacy quick-login has no identity proof. These fields are unverified,
      // even if they match a registered account. Never attach its User ID.
      const name = String(req.body.customerName || '').trim().slice(0,120);
      const email = String(req.body.customerEmail || '').trim().toLowerCase().slice(0,254);
      const phone = String(req.body.customerPhone || '').replace(/\D/g,'').slice(-10);
      if (!name || (!email && !phone) ||
          (email && !/^\S+@\S+\.\S+$/.test(email)) ||
          (phone && !/^\d{10}$/.test(phone))) {
        return res.status(400).json({success:false,message:'Valid customer contact details are required.'});
      }
      contact = {customerName:name, customerEmail:email, customerPhone:phone,
        identityVerification:'Unverified'};
    }
    const enquiry = await PosEnquiry.create({...contact,...enquiryFields});
    res.status(201).json({success:true,message:'Enquiry submitted successfully.',id:enquiry._id});
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return res.status(401).json({success:false,message:'Session expired. Please sign in again.'});
    console.error('POS enquiry submission:',e);res.status(500).json({success:false,message:'Could not save enquiry.'});
  }
});
// This password protects POS enquiries only. The rest of EasyLabel remains unchanged.
// Configure POS_ENQUIRY_ADMIN_PASSWORD and SESSION_SECRET on Render.
const loginAttempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
function samePassword(input, expected) {
  if (typeof input !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
function adminOnly(req, res, next) {
  if (req.session && req.session.posEnquiryAuthenticated === true) return next();
  if (req.method === 'GET' && req.accepts('html')) return res.redirect('/api/pos-enquiries/admin/login');
  return res.status(403).json({ success:false, message:'POS Enquiry admin authentication required' });
}
router.get('/admin/login', (req,res) => {
  if (req.session?.posEnquiryAuthenticated) return res.redirect('/api/pos-enquiries/admin');
  res.set('Cache-Control','no-store');
  res.render('pos-enquiries-login', { configured: !!process.env.POS_ENQUIRY_ADMIN_PASSWORD });
});
router.post('/admin/login', async (req,res) => {
  res.set('Cache-Control','no-store');
  if (!process.env.POS_ENQUIRY_ADMIN_PASSWORD) return res.status(503).json({success:false,message:'POS Enquiry admin password is not configured on Render.'});
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({success:false,message:'Invalid request origin.'}); }
    catch (_) { return res.status(403).json({success:false,message:'Invalid request origin.'}); }
  }
  const key = req.ip || 'unknown';
  const now = Date.now();
  let record = loginAttempts.get(key);
  if (!record || now - record.since > ATTEMPT_WINDOW_MS) record = { since:now, failures:0 };
  if (record.failures >= 8) return res.status(429).json({success:false,message:'Too many attempts. Try again in 15 minutes.'});
  if (!samePassword(req.body?.password, process.env.POS_ENQUIRY_ADMIN_PASSWORD)) {
    record.failures++; loginAttempts.set(key,record);
    return res.status(401).json({success:false,message:'Incorrect POS Enquiry password.'});
  }
  loginAttempts.delete(key);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({success:false,message:'Could not start session.'});
    req.session.posEnquiryAuthenticated = true;
    req.session.save(error => error
      ? res.status(500).json({success:false,message:'Could not save session.'})
      : res.json({success:true}));
  });
});
router.post('/admin/logout', adminOnly, (req,res) => {
  req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/api/pos-enquiries/admin/login'); });
});
router.get('/admin',adminOnly,async(req,res)=>{
 try { const status=req.query.status;const category=req.query.category;const filter=['New','Contacted','Converted','Closed'].includes(status)?{status}:{};
 if(['THERMAL_LABEL','THERMAL_RECEIPT','MOBILE_PRINTER','RECEIPT_PRINTER','LABEL_PRINTER','BARCODE_SCANNER'].includes(category))filter.enquiryType=category;
 if(category==='POS')filter.enquiryType={$in:['POS',null]};
 const items=await PosEnquiry.find(filter).sort({createdAt:-1}).limit(1000).lean();res.render('pos-enquiries',{items,status:status||'',category:category||'ALL'});
 }catch(e){console.error(e);res.status(500).send('Unable to load enquiries');}
});
router.post('/admin/:id/status',adminOnly,async(req,res)=>{
 try{if(!valid(req.body.status,['New','Contacted','Converted','Closed']))return res.status(400).send('Invalid status');
 await PosEnquiry.findByIdAndUpdate(req.params.id,{status:req.body.status});res.redirect('/api/pos-enquiries/admin?'+new URLSearchParams({...(req.body.category?{category:req.body.category}:{}),...(req.body.filterStatus?{status:req.body.filterStatus}:{})}).toString());
 }catch(e){res.status(400).send('Unable to update status');}
});
module.exports=router;
