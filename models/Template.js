const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ACCESS_TYPES = ['free', 'premium', 'business'];
const templateSchema = new Schema({
 name:{type:String,required:true,trim:true}, mainCategory:{type:String,required:true,trim:true},
 templateCategory:{type:String,required:true,trim:true}, jsonData:{type:String,required:true},
 accessType:{type:String,enum:ACCESS_TYPES,default:'free',index:true},
 requiredPlan:{type:String,enum:ACCESS_TYPES,default:'free'},
 featuredOnHome:{type:Boolean,default:false,index:true}, isActive:{type:Boolean,default:true,index:true},
 displayOrder:{type:Number,default:0},
 previewImageUrl:{type:String,default:''},
 svgImageUrl:{type:String,default:''},
 sizeWidthMm:{type:Number,default:0},
 sizeHeightMm:{type:Number,default:0},
 designFormat:{type:String,default:'epl'},
 previewOnly:{type:Boolean,default:false},
 collection:{type:String,default:''},
 version:{type:Number,default:1}
},{timestamps:true});
templateSchema.pre('validate',function(next){if(!ACCESS_TYPES.includes(this.accessType))this.accessType='free';this.requiredPlan=this.accessType;next();});
const Template=mongoose.model('Template',templateSchema); Template.ACCESS_TYPES=ACCESS_TYPES; module.exports=Template;
