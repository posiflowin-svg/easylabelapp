const mongoose = require('mongoose');

const iconSchema = new mongoose.Schema({
  name:String,
  filename:String,
  mimeType:String,
  data:Buffer,
  displayOrder:{type:Number,default:0},
  active:{type:Boolean,default:true}
}, {_id:true});

const schema = new mongoose.Schema({
  // `name` remains the sub-category name so older Android builds and existing
  // records continue to work exactly as before.
  name:{type:String,required:true,unique:true,trim:true},
  slug:{type:String,required:true,unique:true},
  mainCategory:{type:String,default:'',trim:true,index:true},
  displayOrder:{type:Number,default:0},
  active:{type:Boolean,default:true},
  icons:[iconSchema]
}, {timestamps:true});

module.exports = mongoose.model('IconLibrary', schema);
