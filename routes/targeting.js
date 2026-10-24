const express = require('express');
const UsageEvent = require('../models/UsageEvent');
const router = express.Router();
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
module.exports=router;
