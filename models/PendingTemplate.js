const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 name: {type:String,required:true,trim:true},
 jsonData:{type:String,required:true},
 previewImageUrl:{type:String,default:''},
 status:{type:String,enum:['pending','published'],default:'pending',index:true},
 batchId:{type:String,required:true,index:true},
 publishedTemplateId:{type:mongoose.Schema.Types.ObjectId,ref:'Template',default:null},
 configuredBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null},
 configuredByDevice:{type:mongoose.Schema.Types.ObjectId,ref:'MasterDevice',default:null},
 publishedAt:{type:Date,default:null}
},{timestamps:true});
module.exports=mongoose.model('PendingTemplate',schema);
