const express=require('express');
const mongoose=require('mongoose');
const auth=require('../middleware/campaignAuth');
const Consent=require('../models/MarketingConsent');
const Draft=require('../models/TargetedCampaignDraft');
const Product=require('../models/Product');
const PromoCampaign=require('../models/PromoCampaign');
const router=express.Router();
router.use(auth);
router.get('/consent',async(req,res)=>{
 try {const row=await Consent.findOne({userId:req.authUserId}).lean();res.json({success:true,push:row?.push===true,banner:row?.banner===true});}
 catch(e){res.status(500).json({success:false,message:'Unable to read preferences'});}
});
router.put('/consent',async(req,res)=>{
 try {
  if(typeof req.body?.push!=='boolean'||typeof req.body?.banner!=='boolean')return res.status(400).json({success:false,message:'push and banner must be booleans'});
  const {push,banner}=req.body;
  await Consent.updateOne({userId:req.authUserId},{$set:{push,banner,source:'authenticated-app',updatedAt:new Date()},$push:{history:{$each:[{push,banner,source:'authenticated-app',at:new Date()}],$slice:-30}}},{upsert:true});
  res.json({success:true,push,banner});
 }catch(e){res.status(500).json({success:false,message:'Unable to update preferences'});}
});
router.get('/saved-campaigns',async(req,res)=>{
 try {
  const consent=await Consent.findOne({userId:req.authUserId}).lean();
  if(!consent?.banner)return res.json({success:true,campaigns:[]});
  const now=new Date();
  const promos=await PromoCampaign.find({active:true,targetAudience:'saved',startDate:{$lte:now},$or:[{endDate:null},{endDate:{$gte:now}}]}).limit(100).lean();
  const ids=promos.map(p=>p.savedAudienceId).filter(Boolean);
  const drafts=await Draft.find({_id:{$in:ids},identities:'id:'+req.authUserId}).select('_id').lean();
  const allowed=new Set(drafts.map(d=>String(d._id)));
  res.json({success:true,campaigns:promos.filter(p=>allowed.has(String(p.savedAudienceId))).map(p=>({id:p._id,title:p.title,subtitle:p.subtitle,imageUrl:p.imageUrl,buttonText:p.buttonText,buttonAction:p.buttonAction,actionValue:p.actionValue,campaignType:p.campaignType}))});
 }catch(e){res.status(500).json({success:false,message:'Unable to load saved campaigns'});}
});
router.get('/banners',async(req,res)=>{
 try {
  const consent=await Consent.findOne({userId:req.authUserId}).lean();
  if(!consent?.banner)return res.json({success:true,banners:[]});
  const drafts=await Draft.find({status:'active',channel:{$in:['banner','both']},identities:'id:'+req.authUserId}).select('-identities').limit(10).lean();
  const products=await Product.find({_id:{$in:drafts.map(d=>d.productId).filter(mongoose.isValidObjectId)},active:{$ne:false}}).select('name sku').lean();
  const lookup=new Map(products.map(p=>[String(p._id),p]));
  res.json({success:true,banners:drafts.filter(d=>lookup.has(d.productId)).map(d=>({campaignId:d._id,title:d.title,productId:d.productId,productName:lookup.get(d.productId).name,variantSku:d.variantSku,discountType:d.discountType,discountValue:d.discountValue}))});
 }catch(e){res.status(500).json({success:false,message:'Unable to load campaigns'});}
});
module.exports=router;
