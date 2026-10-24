const jwt = require('jsonwebtoken');
module.exports = (req,res,next) => {
  const header = String(req.headers.authorization || '');
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  if (!token || !process.env.JWT_SECRET) return res.status(401).json({success:false,message:'Verified account session required'});
  try {
    const payload = jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});
    if (!payload.userId) throw Error('Missing user ID');
    req.authUserId=String(payload.userId);
    next();
  } catch(e) { return res.status(401).json({success:false,message:'Invalid or expired account session'}); }
};
