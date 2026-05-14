// routes/walletTransactionRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/walletTransactionController');

router.post('/', controller.addTransaction);
router.get('/user/:userId', controller.getUserTransactions);

module.exports = router;
