const express = require('express');
const router = express.Router();
const c = require('../controllers/UsageAnalyticsController');
router.post('/events', c.ingest);
router.get('/summary', c.summary);
router.get('/customers', c.customers);
router.get('/recent', c.recent);
router.get('/models', c.models);
router.get('/customer-activity', c.customerActivity);
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
