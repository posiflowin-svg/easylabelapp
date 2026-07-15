const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const bannerSchema = new Schema({
    title: { type: String, trim: true, default: '' },
    type: {
        type: String,
        enum: ['json', 'gif', 'image'],
        default: 'image'
    },
    // Backward-compatible external URL field.
    link: { type: String, trim: true, default: '' },
    imageData: { type: Buffer, select: false },
    imageContentType: { type: String, default: '' },
    position: { type: Number, min: 1, max: 3, default: 1 },
    isActive: { type: Boolean, default: true },
    clickType: {
        type: String,
        enum: ['shop', 'url', 'none'],
        default: 'shop'
    },
    clickUrl: { type: String, trim: true, default: '' },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null }
}, { timestamps: true });

bannerSchema.index({ position: 1, createdAt: -1 });

module.exports = mongoose.models.Banner || mongoose.model('Banner', bannerSchema);
