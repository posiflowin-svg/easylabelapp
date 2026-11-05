const PosEnquiry=require('../models/PosEnquiry');
async function syncEnquiry(id){
 const url=String(process.env.POSIFLOW_CRM_URL||'').replace(/\/$/,'');
 const key=String(process.env.EASYLABEL_ENQUIRY_SYNC_KEY||'');
 if(!url||key.length<24)return {success:false,message:'CRM sync not configured'};
 const enquiry=await PosEnquiry.findById(id).lean();if(!enquiry)return {success:false,message:'Enquiry not found'};
 const payload={...enquiry,id:String(enquiry._id)};
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch(url+'/api/easylabel-app-enquiries/sync',{method:'POST',headers:{'Content-Type':'application/json','x-easylabel-enquiry-key':key},body:JSON.stringify(payload),signal:controller.signal});
  if(!response.ok)return {success:false,message:'CRM HTTP '+response.status};
  return {success:true};
 }catch(e){return {success:false,message:e.message};}finally{clearTimeout(timeout);}
}
module.exports={syncEnquiry};
