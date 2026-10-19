const express=require('express');
const multer=require('multer');
const AdmZip=require('adm-zip');
const crypto=require('crypto');
const Template=require('../models/Template');
const PendingTemplate=require('../models/PendingTemplate');
const bulkUploadAccess=require('../middleware/bulkUploadAccess');
const masterOnly=require('../middleware/masterTemplateAdmin');
const MasterDevice=require('../models/MasterDevice');
const MasterActivation=require('../models/MasterActivation');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const adminGate=bulkUploadAccess;
const activationAttempts=new Map();

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
 let obj;
 try { obj=JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '').trim()); }
 catch(e) { throw Error('File must contain EasyLabel exported EPL JSON data (TXT exports are supported).'); }
 const wrapped=(obj.jsonData!==undefined?obj.jsonData:obj);
 return {name:String(obj.name||filename.replace(/\.(?:json|txt)$/i,'')).trim().slice(0,140),jsonData:validJson(wrapped)};
}
router.get('/admin',bulkUploadAccess,(req,res)=>res.render('template-bulk'));
router.post('/upload',bulkUploadAccess,upload.single('file'),async(req,res)=>{
 try{
  if(!req.file)return res.status(400).json({success:false,message:'Upload a ZIP containing EasyLabel .txt or .json exported templates.'});
  const zip=new AdmZip(req.file.buffer);
  const entries=zip.getEntries().filter(e=>!e.isDirectory&&/\.(?:json|txt)$/i.test(e.entryName)&&!e.entryName.startsWith('__MACOSX/'));
  if(!entries.length||entries.length>MAX_ITEMS)return res.status(400).json({success:false,message:'ZIP must contain 1 to 200 EasyLabel .txt or .json templates.'});
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
// Administrative device provisioning uses the existing private backend admin token.
router.post('/devices/codes',adminGate,express.json(),async(req,res)=>{
 try{
  const name=String(req.body?.name||'Master phone').trim().slice(0,80);
  const code=crypto.randomBytes(24).toString('hex');
  await MasterActivation.create({name,codeHash:hash(code),expiresAt:new Date(Date.now()+10*60*1000)});
  res.set('Cache-Control','no-store').json({success:true,code,expiresInMinutes:10,name});
 }catch(e){res.status(500).json({success:false,message:'Unable to create activation code.'});}
});
router.get('/devices',adminGate,async(req,res)=>{
 try{const devices=await MasterDevice.find().select('name revokedAt lastUsedAt createdAt').sort({createdAt:-1}).lean();res.json({success:true,devices});}
 catch(e){res.status(500).json({success:false,message:'Unable to list devices.'});}
});
router.post('/devices/:id/revoke',adminGate,async(req,res)=>{
 try{const device=await MasterDevice.findByIdAndUpdate(req.params.id,{$set:{revokedAt:new Date()}},{new:true});
 if(!device)return res.status(404).json({success:false,message:'Device not found.'});
 res.json({success:true});}catch(e){res.status(400).json({success:false,message:'Invalid device ID.'});}
});
// Activation does not require a customer login. Codes are single-use and expire after 10 minutes.
router.post('/activate',express.json(),async(req,res)=>{
 try{
  const ip=req.ip||'unknown';const now=Date.now();const old=activationAttempts.get(ip)||{n:0,until:now+600000};
  const attempt=old.until<now?{n:0,until:now+600000}:old;
  if(attempt.n>=10)return res.status(429).json({success:false,message:'Too many attempts. Try again later.'});
  attempt.n++;activationAttempts.set(ip,attempt);
  if(activationAttempts.size>5000){for(const [key,v] of activationAttempts){if(v.until<now)activationAttempts.delete(key);}}
  const code=String(req.body?.code||'').trim().toLowerCase();
  if(!/^[a-f0-9]{48}$/.test(code))return res.status(400).json({success:false,message:'Invalid activation code.'});
  const claim=await MasterActivation.findOneAndUpdate({codeHash:hash(code),usedAt:null,expiresAt:{$gt:new Date()}},{$set:{usedAt:new Date()}},{new:true});
  if(!claim)return res.status(403).json({success:false,message:'Code expired or already used.'});
  const credential=crypto.randomBytes(32).toString('hex');
  const device=await MasterDevice.create({name:claim.name,credentialHash:hash(credential)});
  res.set('Cache-Control','no-store').json({success:true,credential,deviceId:device._id,name:device.name});
 }catch(e){res.status(500).json({success:false,message:'Activation failed.'});}
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
// Destructive operations are restricted to pending records and authorized Master Admin devices.
router.delete('/pending/:id',masterOnly,async(req,res)=>{
 try{
  if(!/^[a-f0-9]{24}$/i.test(req.params.id))return res.status(400).json({success:false,message:'Invalid template ID.'});
  const deleted=await PendingTemplate.findOneAndDelete({_id:req.params.id,status:'pending'});
  if(!deleted)return res.status(404).json({success:false,message:'Pending template not found or already published.'});
  res.json({success:true,deleted:1});
 }catch(e){res.status(500).json({success:false,message:'Unable to delete template.'});}
});
router.post('/pending/bulk-delete',masterOnly,express.json({limit:'32kb'}),async(req,res)=>{
 try{
  const ids=req.body&&req.body.ids;
  if(!Array.isArray(ids)||ids.length===0||ids.length>50||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/i.test(id)))
   return res.status(400).json({success:false,message:'Provide 1 to 50 valid template IDs.'});
  const unique=[...new Set(ids)];
  const result=await PendingTemplate.deleteMany({_id:{$in:unique},status:'pending'});
  res.json({success:true,deleted:result.deletedCount,requested:unique.length});
 }catch(e){res.status(500).json({success:false,message:'Unable to delete selected templates.'});}
});

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
  pending.configuredByDevice=req.masterTemplateDevice._id;pending.publishedAt=new Date();await pending.save();
  res.json({success:true,templateId:template._id,pendingId:pending._id});
 }catch(e){res.status(400).json({success:false,message:e.message});}
});
module.exports=router;
