const express=require('express');
const multer=require('multer');
const AdmZip=require('adm-zip');
const crypto=require('crypto');
const Template=require('../models/Template');
const PendingTemplate=require('../models/PendingTemplate');
const adminOnly=require('../middleware/adminOnly');
const masterOnly=require('../middleware/masterTemplateAdmin');
const TAXONOMY=require('../config/iconTaxonomy');
const router=express.Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024}});
const MAX_ITEMS=200,MAX_BYTES=20*1024*1024;
const sizes=new Set(['50x12','50x25','50x30','50x50','50x75','38x12','38x25','38x38','38x15','75x25','75x50','100x15','100x50','100x100','100x150']);
function validJson(value){
 const v=typeof value==='string'?JSON.parse(value):value;
 if(!v || v.dataFormat!=='EPL' || typeof v.dataBase64!=='string' || !/^[A-Za-z0-9+/=]+$/.test(v.dataBase64) || v.dataBase64.length>1500000)throw Error('Invalid EasyLabel EPL template');
 return JSON.stringify(v);
}
function parseEntry(filename,data){
 const obj=JSON.parse(data.toString('utf8'));
 const wrapped=(obj.jsonData!==undefined?obj.jsonData:obj);
 return {name:String(obj.name||filename.replace(/\.json$/i,'')).trim().slice(0,140),jsonData:validJson(wrapped)};
}
router.get('/admin',adminOnly,(req,res)=>res.render('template-bulk'));
router.post('/upload',adminOnly,upload.single('file'),async(req,res)=>{
 try{
  if(!req.file)return res.status(400).json({success:false,message:'Upload a ZIP of EasyLabel JSON files.'});
  const zip=new AdmZip(req.file.buffer);
  const entries=zip.getEntries().filter(e=>!e.isDirectory&&e.entryName.toLowerCase().endsWith('.json')&&!e.entryName.startsWith('__MACOSX/'));
  if(!entries.length||entries.length>MAX_ITEMS)return res.status(400).json({success:false,message:'ZIP must contain 1 to 200 JSON templates.'});
  let total=0;const rows=[],errors=[];
  for(const entry of entries){
   try{
    if(entry.header.size>1500000)throw Error('File too large');
    total+=entry.header.size;
    if(total>MAX_BYTES)throw Error('Batch exceeds 20 MB uncompressed');
    rows.push(parseEntry(entry.entryName.split('/').pop(),entry.getData()));
   }catch(e){errors.push({file:entry.entryName,error:e.message});}
  }
  if(errors.length)return res.status(400).json({success:false,message:'Upload rejected. Correct invalid files and retry.',errors:errors.slice(0,30)});
  const batchId=crypto.randomUUID();
  await PendingTemplate.insertMany(rows.map(r=>({...r,batchId,status:'pending'})),{ordered:true});
  res.status(201).json({success:true,batchId,uploaded:rows.length,pending:rows.length});
 }catch(e){res.status(400).json({success:false,message:e.message});}
});
router.get('/pending',masterOnly,async(req,res)=>{
 try{
  const page=Math.max(1,Math.min(10000,parseInt(req.query.page)||1));
  const limit=Math.max(1,Math.min(50,parseInt(req.query.limit)||25));
  const status=req.query.status==='published'?'published':'pending';
  const filter={status};
  const [data,total]=await Promise.all([PendingTemplate.find(filter).sort({createdAt:1}).skip((page-1)*limit).limit(limit).lean(),PendingTemplate.countDocuments(filter)]);
  res.json({success:true,data,total,page,limit});
 }catch(e){res.status(500).json({success:false,message:'Unable to load templates.'});}
});
router.get('/me',masterOnly,(req,res)=>res.json({success:true,master:true}));
router.patch('/:id/publish',masterOnly,async(req,res)=>{
 try{
  const pending=await PendingTemplate.findById(req.params.id);
  if(!pending)return res.status(404).json({success:false,message:'Pending template not found.'});
  if(pending.status!=='pending')return res.status(409).json({success:false,message:'Already published.'});
  const mainCategory=String(req.body.mainCategory||'').trim();
  const templateCategory=String(req.body.templateCategory||'').trim();
  const category=TAXONOMY.find(t=>t.name===mainCategory);
  if(!category||!category.subcategories.includes(templateCategory))return res.status(400).json({success:false,message:'Invalid category and subcategory.'});
  const width=Number(req.body.labelWidthMm),height=Number(req.body.labelHeightMm);
  if(!sizes.has(`${width}x${height}`))return res.status(400).json({success:false,message:'Unsupported label size.'});
  const accessType=String(req.body.accessType||'free').toLowerCase();
  if(!['free','premium','business'].includes(accessType))return res.status(400).json({success:false,message:'Invalid access type.'});
  const template=await Template.create({name:String(req.body.name||pending.name).trim(),jsonData:pending.jsonData,
   previewImageUrl:pending.previewImageUrl,mainCategory,templateCategory,labelWidthMm:width,labelHeightMm:height,
   accessType,requiredPlan:accessType,featuredOnHome:req.body.featuredOnHome===true,
   isActive:true,displayOrder:0});
  pending.status='published';pending.publishedTemplateId=template._id;
  pending.configuredBy=req.masterTemplateUser._id;pending.publishedAt=new Date();await pending.save();
  res.json({success:true,templateId:template._id,pendingId:pending._id});
 }catch(e){res.status(400).json({success:false,message:e.message});}
});
module.exports=router;
