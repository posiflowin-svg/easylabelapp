const UsageEvent = require('../models/UsageEvent');
const TTL = 300000;
let snapshot, pending;
function cutoff(now) { const d=new Date(now); const day=d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()-12); const end=new Date(d); end.setUTCMonth(end.getUTCMonth()+1); end.setUTCDate(0); d.setUTCDate(Math.min(day,end.getUTCDate())); return d; }
function classify(n){return n>=20000?'A':n>=10000?'B':n>=5000?'C':'D';}
async function refresh(){
 if(pending)return pending;
 pending=(async()=>{const now=new Date(), from=cutoff(now);
 const rows=await UsageEvent.aggregate([
 {$sort:{occurredAt:1,_id:1}},
 {$group:{_id:{$cond:[{$ne:[{$ifNull:['$customerMobile','']},'']},{$concat:['m:','$customerMobile']},{$cond:[{$ne:[{$ifNull:['$customerId','']},'']},{$concat:['i:','$customerId']},null]}]},mobile:{$last:'$customerMobile'},id:{$last:'$customerId'},name:{$last:'$customerName'},email:{$last:'$customerEmail'},lastActivity:{$max:'$occurredAt'},labels:{$sum:{$cond:[{$and:[{$eq:['$eventType','LABEL_PRINT']},{$gte:['$occurredAt',from]},{$lte:['$occurredAt',now]}]},'$copies',0]}}}},{$match:{_id:{$ne:null}}},{$sort:{labels:-1,_id:1}}
 ]).allowDiskUse(true);
 const counts={A:0,B:0,C:0,D:0}; for(const r of rows){r.group=classify(r.labels);counts[r.group]++;}
 snapshot={rows,counts,updatedAt:now,from};return snapshot;
 })().finally(()=>{pending=null;});return pending;
}
async function get(){if(!snapshot)return refresh();if(Date.now()-snapshot.updatedAt.getTime()>=TTL)refresh().catch(e=>console.error('Usage groups refresh:',e.message));return snapshot;}
function start(){refresh().catch(e=>console.error('Usage groups refresh:',e.message));const timer=setInterval(()=>refresh().catch(e=>console.error('Usage groups refresh:',e.message)),TTL);timer.unref();}
module.exports={get,start,classify,cutoff};
