const express = require('express');
const router = express.Router();
const c = require('../controllers/UsageAnalyticsController');
const cache = require('../middleware/usageCache');
const admin = require('../middleware/adminSecurity').requireAdmin;
router.get('/groups', admin, async (req,res) => {
 try { const snap=await require('../services/usageGroups').get(); const group=String(req.query.group||''); const q=String(req.query.customer||'').trim().toLowerCase(); const page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1)); const rows=snap.rows.filter(r=>(!group||r.group===group)&&(!q||[r.name,r.mobile,r.email].some(v=>String(v||'').toLowerCase().includes(q)))); res.json({success:true,counts:snap.counts,updatedAt:snap.updatedAt,from:snap.from,total:rows.length,page,rows:rows.slice((page-1)*100,page*100)}); } catch(e){console.error(e);res.status(503).json({success:false,message:'Usage groups temporarily unavailable'});}
});
// Shared-key endpoint for CRM background synchronization.
router.post('/crm/usage-groups', async (req,res)=>{
 const key=String(process.env.POSIFLOW_ANALYTICS_KEY||process.env.EASYLABEL_ANALYTICS_KEY||'').trim();
 if(!key||String(req.get('x-easylabel-key')||'').trim()!==key)return res.status(401).json({success:false});
 try{
 const normalize=v=>String(v||'').replace(/\D/g,'').slice(-10);
 const wanted=new Set((Array.isArray(req.body?.mobiles)?req.body.mobiles:[]).slice(0,500).map(normalize).filter(v=>/^\d{10}$/.test(v)));
 const snap=await require('../services/usageGroups').get(); const data={};
 for(const row of snap.rows){const m=normalize(row.mobile);if(!wanted.has(m))continue;const v=data[m]||(data[m]={labels12m:0,labelsPrinted:0,lastActivity:null});v.labels12m+=Number(row.labels||0);v.labelsPrinted+=Number(row.lifetimeLabels||0);if(!v.lastActivity||new Date(row.lastActivity)>new Date(v.lastActivity))v.lastActivity=row.lastActivity;}
 for(const v of Object.values(data))v.group=require('../services/usageGroups').classify(v.labels12m);
 res.json({success:true,data,updatedAt:snap.updatedAt});
 }catch(e){console.error('CRM usage groups:',e.message);res.status(503).json({success:false});}
});
router.post('/events', c.ingest);
router.get('/summary', admin, cache, c.summary);
router.get('/customers', admin, cache, c.customers);
router.get('/recent', admin, cache, c.recent);
router.get('/models', admin, cache, c.models);
router.get('/customer-activity', c.customerActivity);

// Server-to-server endpoint used by Posiflow CRM Label Customer page.
// Protected by the same shared analytics key used between both applications.
router.post('/crm/customer-summaries', async (req, res) => {
  const configured = String(process.env.POSIFLOW_ANALYTICS_KEY || process.env.EASYLABEL_ANALYTICS_KEY || '').trim();
  const supplied = String(req.get('x-easylabel-key') || '').trim();
  if (!configured || !supplied || configured !== supplied) return res.status(401).json({success:false,message:'Unauthorized'});
  return c.customerSummaries(req,res);
});

router.get('/crm/customer-activity', async (req, res) => {
  const configured = String(process.env.POSIFLOW_ANALYTICS_KEY || process.env.EASYLABEL_ANALYTICS_KEY || '').trim();
  const supplied = String(req.get('x-easylabel-key') || '').trim();
  if (!configured || !supplied || configured !== supplied) {
    return res.status(401).json({ success:false, message:'Unauthorized' });
  }
  return c.customerActivity(req, res);
});

router.get('/purchase-history', async (req, res, next) => {
  try {
    if (typeof c.purchaseHistory !== 'function') {
      return res.status(503).json({ success: false, message: 'Purchase history service is unavailable' });
    }
    return await c.purchaseHistory(req, res, next);
  } catch (err) {
    return next(err);
  }
});
module.exports = router;
