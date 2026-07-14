const express = require('express');
const router = express.Router();
const controller = require('../controllers/AIController');
router.post('/generate-label', controller.generateLabel);
module.exports = router;
