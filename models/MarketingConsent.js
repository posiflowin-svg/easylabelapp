const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,unique:true,index:true},
 push:{type:Boolean,default:false},banner:{type:Boolean,default:false},
 source:{type:String,default:'android-settings'},updatedAt:{type:Date,default:Date.now},
 history:[{push:Boolean,banner:Boolean,source:String,at:Date}]
},{timestamps:true});
module.exports=mongoose.model('MarketingConsent',schema);
