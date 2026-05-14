// routes/couponRoutes.js
const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');

// Create a coupon
router.post('/', couponController.createCoupon);

// Validate a coupon
router.post('/validate', couponController.validateCoupon);

// Get all coupons
router.get('/', couponController.getAllCoupons);

// Update a coupon
router.put('/:id', couponController.updateCoupon);

// Delete a coupon
router.delete('/:id', couponController.deleteCoupon);

// Record coupon usage
router.post('/use', couponController.recordCouponUsage);

router.get('/scratch-card/:phone', couponController.getScratchCardStatus);

module.exports = router;