const express = require('express');
const router = express.Router();
const controller = require('../controllers/NotificationApiController');
router.post('/register-device', controller.registerDevice);
router.post('/disable-device', controller.disableDevice);
router.post('/:id/send-live', controller.send);
module.exports = router;
