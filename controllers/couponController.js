// controllers/couponController.js
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
// Create a new coupon
exports.createCoupon = async (req, res) => {
  try {
    const couponData = req.body;
    
    // For referral coupons, ensure no expiry date is set
    if (couponData.type === 'referral') {
      couponData.expiryDate = null;
    }
    
    const coupon = new Coupon(couponData);
    await coupon.save();
    
    res.status(201).json({
      success: true,
      data: coupon
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
};

// Validate and apply a coupon
exports.validateCoupon = async (req, res) => {
  try {
    const { code, phone, orderAmount } = req.body;
    const coupon = await Coupon.findOne({ code, isActive: true });
    
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found or inactive'
      });
    }
    
    // Additional validation for scratch cards
    if (coupon.type === 'scratch') {
      // Check if user has already used this scratch card in a non-active order
      const existingOrder = await Order.findOne({
        'customer.phone': phone,
        couponCode: code,
        status: { $ne: 'active' }
      });
      
      if (existingOrder) {
        return res.status(400).json({
          success: false,
          message: 'You have already used this scratch card'
        });
      }
    }
    // Check if coupon is expired (for regular coupons)
    if (coupon.type === 'regular' && new Date() > coupon.expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Coupon has expired'
      });
    }
    
    // Check max uses
    if (coupon.maxUses && coupon.currentUses >= coupon.maxUses) {
      return res.status(400).json({
        success: false,
        message: 'Coupon usage limit reached'
      });
    }
    
    // Check minimum order amount
    if (orderAmount < coupon.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount of ${coupon.minOrderAmount} required`
      });
    }
    
    // Calculate discount
    let discount = 0;
    if (coupon.discountAmount > 0) {
      discount = coupon.discountAmount;
    } else if (coupon.discountPercentage > 0) {
      discount = (orderAmount * coupon.discountPercentage) / 100;
    }
    
    res.json({
      success: true,
      data: {
        coupon,
        discount,
        finalAmount: orderAmount - discount
      }
    });
    
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// Get all coupons
exports.getAllCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find();
    res.json({
      success: true,
      data: coupons
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// Update a coupon
exports.updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true
    });
    
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }
    
    res.json({
      success: true,
      data: coupon
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
};

// Delete a coupon
exports.deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    await Coupon.findByIdAndDelete(id);
    
    res.json({
      success: true,
      data: null
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// Record coupon usage
exports.recordCouponUsage = async (req, res) => {
  try {
    const { code } = req.body;
    const coupon = await Coupon.findOneAndUpdate(
      { code },
      { $inc: { currentUses: 1 } },
      { new: true }
    );
    
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }
    
    res.json({
      success: true,
      data: coupon
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// Get scratch card status for user
exports.getScratchCardStatus = async (req, res) => {
  try {
    const { phone } = req.params;
    
    // Find active scratch card coupon
    const scratchCoupon = await Coupon.findOne({ 
      type: 'scratch', 
      isActive: true 
    });
    
    if (!scratchCoupon) {
      return res.status(404).json({
        success: false,
        message: 'No active scratch card available'
      });
    }
    
    // Check if user has any orders with this coupon
    const orderWithScratch = await Order.findOne({
      'customer.phone': phone,
      couponCode: scratchCoupon.code
    });
    
    res.json({
      success: true,
      data: {
        code: scratchCoupon.code,
        isUsed: !!orderWithScratch,
        discountPercentage: scratchCoupon.discountPercentage,
        description: scratchCoupon.description,
        minOrderAmount: scratchCoupon.minOrderAmount
      }
    });
    
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};