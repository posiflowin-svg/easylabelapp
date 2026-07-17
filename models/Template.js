const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ACCESS_TYPES = ['free', 'premium', 'business'];

const templateSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },

    // Business group selected by user during registration, e.g. Retail, Grocery, School.
    mainCategory: {
        type: String,
        required: true,
        trim: true,
        index: true
    },

    // Label-use category, e.g. Price Tag, Expiry Date, Name Tag.
    templateCategory: {
        type: String,
        required: true,
        trim: true,
        index: true
    },

    // Exact JSON exported from EasyLabel Android editor.
    jsonData: {
        type: String,
        required: true
    },

    labelWidthMm: {
        type: Number,
        required: true,
        min: 1,
        index: true
    },

    labelHeightMm: {
        type: Number,
        required: true,
        min: 1,
        index: true
    },

    accessType: {
        type: String,
        enum: ACCESS_TYPES,
        default: 'free',
        index: true
    },

    requiredPlan: {
        type: String,
        enum: ACCESS_TYPES,
        default: 'free'
    },

    featuredOnHome: {
        type: Boolean,
        default: false,
        index: true
    },

    isActive: {
        type: Boolean,
        default: true,
        index: true
    },

    displayOrder: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

templateSchema.pre('validate', function(next) {
    if (!ACCESS_TYPES.includes(this.accessType)) {
        this.accessType = 'free';
    }
    this.requiredPlan = this.accessType;
    next();
});

templateSchema.index({
    mainCategory: 1,
    templateCategory: 1,
    labelWidthMm: 1,
    labelHeightMm: 1,
    accessType: 1,
    displayOrder: 1
});

const Template = mongoose.model('Template', templateSchema);
Template.ACCESS_TYPES = ACCESS_TYPES;

module.exports = Template;
