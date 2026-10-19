const mongoose=require('mongoose');
const schema=new mongoose.Schema({name:{type:String,required:true,maxlength:80},credentialHash:{type:String,required:true,unique:true},revokedAt:{type:Date,default:null},lastUsedAt:{type:Date,default:null}},{timestamps:true});
module.exports=mongoose.model('MasterDevice',schema);
