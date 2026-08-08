const express = require('express');
const router = express.Router();
const c = require('../controllers/CloudBackupController');
router.get('/status', c.status);
router.get('/list', c.list);
router.get('/:id/download', c.download);
router.post('/upload', c.uploadMiddleware, c.upload);
module.exports = router;
