const express = require('express');
const router = express.Router();
const c = require('../controllers/UsageAnalyticsController');
router.post('/events', c.ingest);
router.get('/summary', c.summary);
router.get('/customers', c.customers);
router.get('/recent', c.recent);
router.get('/models', c.models);
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
