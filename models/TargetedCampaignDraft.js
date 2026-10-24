const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 title:{type:String,required:true},channel:{type:String,enum:['push','banner','both'],required:true},
 productId:{type:String,required:true},variantSku:{type:String,default:''},discountType:{type:String,enum:['percent','fixed'],required:true},discountValue:{type:Number,required:true,min:0},
 audienceMode:{type:String,enum:['manual','batch','all'],required:true},filter:{type:mongoose.Schema.Types.Mixed,required:true},
 identities:{type:[String],select:false,required:true},
 status:{type:String,enum:['draft'],default:'draft'}
},{timestamps:true});
module.exports=mongoose.model('TargetedCampaignDraft',schema);
