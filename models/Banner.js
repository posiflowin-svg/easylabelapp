const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Banner Model
const bannerSchema = new Schema({
    type: {
        type: String,
        enum: ['json', 'gif'],
        required: true
    },
    link: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true // Default to true (on)
    }
}, { timestamps: true });

const Banner = mongoose.model('Banner', bannerSchema);
module.exports = Banner;
