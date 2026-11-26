// Bounded, process-local cache; mounted only behind the existing admin policy.
const cache=new Map(), TTL=60000, MAX=80;
module.exports=function(req,res,next){
 const key=req.path+'?'+new URLSearchParams(Object.entries(req.query).sort(([a],[b])=>a.localeCompare(b))).toString();
 const hit=cache.get(key);if(hit&&Date.now()-hit.at<TTL)return res.json(hit.body);
 const json=res.json.bind(res);res.json=function(body){if(res.statusCode===200&&body&&body.success&&body.purchaseSync!=='unavailable'){cache.delete(key);cache.set(key,{at:Date.now(),body});while(cache.size>MAX)cache.delete(cache.keys().next().value);}return json(body);};next();
};
