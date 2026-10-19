const mongoose=require('mongoose');
const schema=new mongoose.Schema({codeHash:{type:String,required:true,unique:true},name:{type:String,required:true,maxlength:80},expiresAt:{type:Date,required:true},usedAt:{type:Date,default:null}},{timestamps:true});
schema.index({expiresAt:1},{expireAfterSeconds:86400});
module.exports=mongoose.model('MasterActivation',schema);
