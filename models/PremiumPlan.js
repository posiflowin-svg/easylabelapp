const mongoose = require('mongoose');

const premiumPlanSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  badgeText: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  yearlyPrice: { type: Number, default: 0, min: 0 },
  freeTrialDays: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'INR' },
  billingPeriod: { type: String, enum: ['monthly', 'yearly', 'lifetime'], default: 'monthly' },
  autoRenew: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  recommended: { type: Boolean, default: false },
  displayOrder: { type: Number, default: 0 },
  featureKeys: [{ type: String, trim: true, lowercase: true }],
  googleProductId: { type: String, default: '' },
  googleBasePlanId: { type: String, default: '' },
  aiMonthlyLimit: { type: Number, default: 0, min: 0 },
  teamMemberLimit: { type: Number, default: 1, min: 1 }
}, { timestamps: true });

module.exports = mongoose.model('PremiumPlan', premiumPlanSchema);
