const crypto=require('crypto');
const MasterDevice=require('../models/MasterDevice');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
module.exports=async(req,res,next)=>{
 try{
  const token=(req.get('authorization')||'').match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1];
  if(!token)return res.status(401).json({success:false,message:'Activate this phone as Master Admin.'});
  const device=await MasterDevice.findOne({credentialHash:hash(token),revokedAt:null});
  if(!device)return res.status(403).json({success:false,message:'Master Admin access revoked or invalid.'});
  req.masterTemplateDevice=device;
  MasterDevice.updateOne({_id:device._id},{$set:{lastUsedAt:new Date()}}).catch(()=>{});
  next();
 }catch(e){res.status(500).json({success:false,message:'Master device verification failed.'});}
};
