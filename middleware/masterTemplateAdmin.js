const jwt=require('jsonwebtoken');
const User=require('../models/User');
module.exports=async function masterTemplateAdmin(req,res,next){
 try{
  const token=(req.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token || !process.env.JWT_SECRET || !process.env.TEMPLATE_MASTER_EMAIL)
   return res.status(403).json({success:false,message:'Master Admin access is not configured.'});
  const decoded=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});
  if(!decoded.userId)return res.status(403).json({success:false,message:'Invalid login token.'});
  const user=await User.findById(decoded.userId).select('email');
  if(!user || user.email?.toLowerCase()!==process.env.TEMPLATE_MASTER_EMAIL.trim().toLowerCase())
   return res.status(403).json({success:false,message:'Master Admin only.'});
  req.masterTemplateUser=user;
  next();
 }catch(e){return res.status(401).json({success:false,message:'Please sign in again.'});}
};
