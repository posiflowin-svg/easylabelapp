const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PosEnquiry = require('../models/PosEnquiry');
const router = express.Router();
const valid = (value, allowed) => allowed.includes(value);
router.post('/', async (req,res) => {
  try {
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];
    if (!token) return res.status(401).json({success:false,message:'Please sign in to submit an enquiry.'});
    const decoded = jwt.verify(token,process.env.JWT_SECRET || 'verySecretValue');
    const user = await User.findById(decoded.userId).select('name email phone');
    if (!user) return res.status(401).json({success:false,message:'Account not found. Please sign in again.'});
    const {businessType,outlets,purchaseTimeline,discountInterest} = req.body || {};
    if (!valid(businessType,['Retail Shop','Restaurant / Cafe','Other Business']) ||
        !valid(outlets,['1 Outlet','2-5 Outlets','6+ Outlets']) ||
        !valid(purchaseTimeline,['Within 7 Days','Within 30 Days','Exploring Options']) ||
        typeof discountInterest !== 'boolean') return res.status(400).json({success:false,message:'Please answer all enquiry questions.'});
    const enquiry = await PosEnquiry.create({user:user._id,customerName:user.name,customerEmail:user.email,customerPhone:user.phone,businessType,outlets,purchaseTimeline,discountInterest});
    res.status(201).json({success:true,message:'Enquiry submitted successfully.',id:enquiry._id});
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') return res.status(401).json({success:false,message:'Session expired. Please sign in again.'});
    console.error('POS enquiry submission:',e);res.status(500).json({success:false,message:'Could not save enquiry.'});
  }
});
function adminOnly(req,res,next){if(req.session && req.session.adminAuthenticated) return next();res.status(403).send('Admin authentication required');}
router.get('/admin',adminOnly,async(req,res)=>{
 try { const status=req.query.status;const filter=['New','Contacted','Converted','Closed'].includes(status)?{status}:{};
 const items=await PosEnquiry.find(filter).sort({createdAt:-1}).limit(1000).lean();res.render('pos-enquiries',{items,status:status||''});
 }catch(e){console.error(e);res.status(500).send('Unable to load enquiries');}
});
router.post('/admin/:id/status',adminOnly,async(req,res)=>{
 try{if(!valid(req.body.status,['New','Contacted','Converted','Closed']))return res.status(400).send('Invalid status');
 await PosEnquiry.findByIdAndUpdate(req.params.id,{status:req.body.status});res.redirect('/api/pos-enquiries/admin');
 }catch(e){res.status(400).send('Unable to update status');}
});
module.exports=router;
