const express = require('express');
const router = express.Router();
const AccountDeletionController = require('../controllers/AccountDeletionController');

router.post('/request', AccountDeletionController.submitApi);

module.exports = router;
