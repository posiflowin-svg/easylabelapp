const express = require('express');
const router = express.Router();
const c = require('../controllers/UsageAnalyticsController');
router.post('/events', c.ingest);
router.get('/summary', c.summary);
module.exports = router;
