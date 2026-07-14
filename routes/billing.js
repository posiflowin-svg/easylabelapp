const express = require('express');
const router = express.Router();
const controller = require('../controllers/BillingController');
router.get('/config', controller.config);
router.post('/verify', controller.verify);
router.post('/restore', controller.restore);
router.post('/rtdn', controller.rtdn);
module.exports = router;
