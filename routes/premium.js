const express = require('express');
const router = express.Router();
const premiumController = require('../controllers/PremiumController');
const multer = require('multer');

const notificationImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG and WebP images are supported.'));
    cb(null, true);
  }
});

router.get('/catalog', premiumController.catalog);
router.get('/access/:userId', premiumController.access);
router.get('/campaigns/active', premiumController.activeCampaigns);
router.post('/campaigns/:id/impression', premiumController.recordCampaignImpression);
router.post('/campaigns/:id/click', premiumController.recordCampaignClick);
router.post('/campaigns/:id/dismiss', premiumController.recordCampaignDismiss);
router.get('/campaigns/:id/stats', premiumController.campaignStats);
router.post('/features', premiumController.createFeature);
router.put('/features/:id', premiumController.updateFeature);
router.delete('/features/:id', premiumController.deleteFeature);
router.post('/plans', premiumController.createPlan);
router.put('/plans/:id', premiumController.updatePlan);
router.delete('/plans/:id', premiumController.deletePlan);
router.get('/users/search', premiumController.searchUsers);
router.post('/subscriptions', premiumController.createSubscription);
router.put('/subscriptions/:id/status', premiumController.updateSubscriptionStatus);
router.put('/subscriptions/:id/extend', premiumController.extendSubscription);
router.put('/subscriptions/:id/change-plan', premiumController.changeSubscriptionPlan);
router.post('/subscriptions/:id/payments', premiumController.recordManualPayment);
router.delete('/subscriptions/:id', premiumController.deleteSubscription);
router.get('/campaigns/:id/image', premiumController.getCampaignImage);
router.post('/campaigns', notificationImageUpload.single('image'), premiumController.createCampaign);
router.put('/campaigns/:id', notificationImageUpload.single('image'), premiumController.updateCampaign);
router.put('/campaigns/:id/toggle', premiumController.toggleCampaign);
router.delete('/campaigns/:id', premiumController.deleteCampaign);
router.get('/notifications/:id/image', premiumController.getNotificationImage);
router.post('/notifications', notificationImageUpload.single('image'), premiumController.createNotification);
router.put('/notifications/:id', premiumController.updateNotification);
router.put('/notifications/:id/status', premiumController.updateNotificationStatus);
router.post('/notifications/:id/send', premiumController.sendNotification);
router.delete('/notifications/:id', premiumController.deleteNotification);
router.post('/ai-usage', premiumController.recordAIUsage);
router.put('/settings', premiumController.updateSettings);

module.exports = router;
