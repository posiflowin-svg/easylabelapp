const express = require('express');
const router = express.Router();
const controller = require('../controllers/AIController');
const adminOnly = require('../middleware/adminOnly');

router.get('/credits/:userId', controller.getCredits);
router.get('/credits', controller.getCredits);
router.post('/credits/use', controller.useCredit);
router.get('/credits/:userId/transactions', controller.getTransactions);

// Call only after payment has been verified by your payment webhook/server.
router.post('/credits/purchase-confirmation', adminOnly, controller.purchaseConfirmation);
router.post('/credits/admin-grant', adminOnly, controller.adminGrantCredits);
router.get('/admin/dashboard', adminOnly, controller.adminDashboard);

router.post('/generate-label', controller.generateLabel);

module.exports = router;
