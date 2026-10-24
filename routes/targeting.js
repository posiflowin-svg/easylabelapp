const express = require('express');
const UsageEvent = require('../models/UsageEvent');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const router = express.Router();
const TargetedCampaignDraft = require('../models/TargetedCampaignDraft');
router.use((req,res,next) => {
  if (!req.session || !req.session.adminAuthenticated) return res.status(401).json({success:false,message:'Admin verification required. Please authenticate before viewing customer targeting.'});
  next();
});
function dateRange(period, from, to) {
  const now = new Date();
  if (period === 'month') return {$gte:new Date(now.getFullYear(),now.getMonth(),1)};
  if (period === 'last') return {$gte:new Date(now.getFullYear(),now.getMonth()-1,1),$lt:new Date(now.getFullYear(),now.getMonth(),1)};
  if (period === '90days') return {$gte:new Date(now.getTime()-90*86400000)};
  if (period === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from||'') || !/^\d{4}-\d{2}-\d{2}$/.test(to||'')) throw new Error('Valid from and to dates required');
    const start=new Date(from+'T00:00:00Z'), end=new Date(to+'T23:59:59.999Z');
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start>end) throw new Error('Invalid date range');
    return {$gte:start,$lte:end};
  }
  return null;
}
router.get('/audience',async(req,res)=>{
  try {
    const width=Number(req.query.width),height=Number(req.query.height),minimum=Number(req.query.minPrints||1);
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>300||height>300) return res.status(400).json({success:false,message:'Select a valid label size'});
    if(!Number.isInteger(minimum)||minimum<1||minimum>10000000) return res.status(400).json({success:false,message:'Invalid minimum copies'});
    const period=String(req.query.period||'month');
    if(!['month','last','90days','lifetime','custom'].includes(period)) return res.status(400).json({success:false,message:'Invalid period'});
    const match={eventType:'LABEL_PRINT',labelWidthMm:width,labelHeightMm:height};
    const dates=dateRange(period,req.query.from,req.query.to);if(dates)match.occurredAt=dates;
    const pipeline=[{$match:match},{$addFields:{identity:{$cond:[{$ne:['$customerId','']},{$concat:['id:','$customerId']},{$cond:[{$ne:['$customerMobile','']},{$concat:['mobile:','$customerMobile']},{$cond:[{$ne:['$deviceId','']},{$concat:['device:','$deviceId']},null]}]}]}}},{$match:{identity:{$ne:null}}},{$group:{_id:'$identity',customerId:{$first:'$customerId'},name:{$last:'$customerName'},mobile:{$last:'$customerMobile'},copies:{$sum:'$copies'},jobs:{$sum:1},lastUsed:{$max:'$occurredAt'}}},{$match:{copies:{$gte:minimum}}},{$sort:{copies:-1,_id:1}}];
    const countResult=await UsageEvent.aggregate([...pipeline,{$count:'total'}]).allowDiskUse(true);
    const total=countResult[0]?.total||0;
    const page=Math.min(100000,Math.max(1,Number.parseInt(req.query.page,10)||1));
    const limit=100;
    const rows=await UsageEvent.aggregate([...pipeline,{$skip:(page-1)*limit},{$limit:limit}]).allowDiskUse(true);
    res.json({success:true,total,page,pageSize:limit,batches:Math.ceil(total/5000),rows});
  } catch(e){res.status(400).json({success:false,message:e.message||'Unable to load audience'});}
});

// Authenticated, bounded Shop catalog lookup for campaign draft configuration.
router.get('/products', async (req,res) => {
 try {
  const q=String(req.query.q||'').trim().slice(0,80);
  const filter={active:{$ne:false}};
  if(q){
   const escaped=q.replace(/[^a-zA-Z0-9 ]/g, c => '\\'+c);
   const regex=new RegExp(escaped,'i');
   filter.$or=[{name:regex},{sku:regex},{'category.name':regex},{'variants.sku':regex}];
  }
  const docs=await Product.find(filter).select('name sku price category images variants active').sort({name:1,_id:1}).limit(60).lean();
  res.json({success:true,products:docs.map(p=>({id:String(p._id),name:p.name,sku:p.sku||'',price:p.price,category:p.category?.name||'',image:p.images?.[0]||'',variants:(p.variants||[]).filter(v=>v.active!==false).map(v=>({sku:v.sku,name:v.name,price:v.price}))}))});
 }catch(e){res.status(500).json({success:false,message:'Unable to load Shop products'});}
});

// Draft only: do not dispatch messages or grant discounts from an unverified customer identifier.
router.post('/drafts', async (req,res) => {
 try {
  const body=req.body||{};
  const width=Number(body.width), height=Number(body.height), minPrints=Number(body.minPrints||1);
  const period=String(body.period||'month');
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>300||height>300) throw Error('Invalid label size');
  if(!Number.isInteger(minPrints)||minPrints<1||minPrints>10000000) throw Error('Invalid minimum copies');
  if(!['month','last','90days','lifetime','custom'].includes(period)) throw Error('Invalid period');
  const mode=String(body.mode||'manual');
  if(!['manual','batch','all'].includes(mode)) throw Error('Invalid audience mode');
  const channel=String(body.channel||'push');
  if(!['push','banner','both'].includes(channel)) throw Error('Invalid channel');
  const discountType=String(body.discountType||'percent');
  const discountValue=Number(body.discountValue);
  if(!['percent','fixed'].includes(discountType)||!Number.isFinite(discountValue)||discountValue<0||discountValue>1000000||(discountType==='percent'&&discountValue>100)) throw Error('Invalid discount');
  const productId=String(body.productId||'').trim();
  if(!mongoose.isValidObjectId(productId)) throw Error('Select a product from the Shop dropdown');
  const product=await Product.findOne({_id:productId,active:{$ne:false}}).select('name sku variants').lean();
  if(!product) throw Error('Selected product is no longer available in the Shop');
  const variantSku=String(body.variantSku||'').trim();
  if(variantSku && !(product.variants||[]).some(v=>v.active!==false&&v.sku===variantSku)) throw Error('Selected product variant is unavailable');
  const title=String(body.title||'').trim();
  if(!title||title.length>150) throw Error('Enter a campaign title (max 150 characters)');
  const date=dateRange(period,body.from,body.to);
  const match={eventType:'LABEL_PRINT',labelWidthMm:width,labelHeightMm:height};if(date)match.occurredAt=date;
  const pipeline=[{$match:match},{$addFields:{identity:{$cond:[{$ne:['$customerId','']},{$concat:['id:','$customerId']},{$cond:[{$ne:['$customerMobile','']},{$concat:['mobile:','$customerMobile']},{$cond:[{$ne:['$deviceId','']},{$concat:['device:','$deviceId']},null]}]}]}}},{$match:{identity:{$ne:null}}},{$group:{_id:'$identity',copies:{$sum:'$copies'}}},{$match:{copies:{$gte:minPrints}}},{$sort:{copies:-1,_id:1}}];
  const maxAudience=100000;
  const totalResult=await UsageEvent.aggregate([...pipeline,{$count:'total'}]).allowDiskUse(true);
  const total=totalResult[0]?.total||0;
  if(total>maxAudience) throw Error('Audience exceeds 100,000 users; narrow the filters');
  let chosen=[];
  if(mode==='manual') {
   const requested=body.identities;
   if(!Array.isArray(requested)||requested.length===0||requested.length>5000||requested.some(v=>typeof v!=='string'||v.length>256)) throw Error('Select between 1 and 5,000 customers');
   const wanted=[...new Set(requested)];
   const rows=await UsageEvent.aggregate([...pipeline,{$match:{_id:{$in:wanted}}},{$project:{_id:1}}]).allowDiskUse(true);
   chosen=rows.map(r=>r._id);
   if(chosen.length!==wanted.length) throw Error('Selection changed; refresh the audience and try again');
  } else {
   const batch=Number(body.batch||1);
   if(mode==='batch'&&(!Number.isInteger(batch)||batch<1||batch>Math.ceil(total/5000))) throw Error('Invalid batch');
   const skip=mode==='batch'?(batch-1)*5000:0;
   const limit=mode==='batch'?5000:maxAudience;
   const rows=await UsageEvent.aggregate([...pipeline,{$skip:skip},{$limit:limit},{$project:{_id:1}}]).allowDiskUse(true);
   chosen=rows.map(r=>r._id);
  }
  if(!chosen.length) throw Error('No matching customers');
  const draft=await TargetedCampaignDraft.create({title,channel,productId,variantSku,discountType,discountValue,audienceMode:mode,filter:{width,height,minPrints,period,from:body.from||'',to:body.to||''},identities:chosen,status:'draft'});
  res.status(201).json({success:true,id:draft._id,count:chosen.length,status:'draft',message:'Campaign draft saved. Sending and discounts are not active.'});
 }catch(e){res.status(400).json({success:false,message:e.message||'Unable to save draft'});}
});
router.get('/drafts', async(req,res)=>{
 try {const drafts=await TargetedCampaignDraft.find({}).sort({createdAt:-1}).limit(30).select('-identities').lean();res.json({success:true,drafts});}
 catch(e){res.status(500).json({success:false,message:'Unable to load drafts'});}
});


// V42: review is read-only. Never equate a printed device ID or phone number
// with an authenticated account for sending or granting a price discount.
router.get('/drafts/:id/review', async (req,res) => {
 try {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({success:false,message:'Invalid draft ID'});
  const draft=await TargetedCampaignDraft.findById(req.params.id).select('+identities').lean();
  if (!draft) return res.status(404).json({success:false,message:'Campaign draft not found'});
  const DeviceToken=require('../models/DeviceToken');
  const ids=(draft.identities||[]).filter(v=>typeof v==='string'&&v.startsWith('id:')).map(v=>v.slice(3));
  const validIds=[...new Set(ids.filter(v=>mongoose.isValidObjectId(v)))];
  // Only an exact account ObjectId match is considered a candidate. This is
  // NOT sufficient evidence of customer consent or eligibility to send.
  const registered=validIds.length ? await DeviceToken.distinct('userId',{enabled:true,userId:{$in:validIds.map(v=>new mongoose.Types.ObjectId(v))}}) : [];
  const product=await Product.findById(draft.productId).select('name sku price active variants').lean();
  res.json({success:true,review:{id:String(draft._id),title:draft.title,status:draft.status,channel:draft.channel,audienceCount:(draft.identities||[]).length,accountIdCandidates:validIds.length,registeredDeviceAccounts:registered.length,unverifiedIdentities:(draft.identities||[]).length-validIds.length,product:product?{name:product.name,sku:product.sku,active:product.active!==false}:null,variantSku:draft.variantSku,discountType:draft.discountType,discountValue:draft.discountValue,readyToSend:false,notes:['No notifications have been sent.','Account identity and marketing permission must be verified before sending.','Discount checkout validation and Android targeted-banner entitlement are not installed.']}});
 } catch(e) {res.status(500).json({success:false,message:'Unable to review campaign'});}
});
module.exports=router;
