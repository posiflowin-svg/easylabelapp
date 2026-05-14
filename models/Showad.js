const mongoose = require('mongoose')
const { type } = require('os')

const ShowAdSchema = new mongoose.Schema({
    image_url: {
        type: String,
        required: true
    },
    target_url: {
        type: String,
        required: true
    }
}, { timestamps: true });

const ShowAd = mongoose.model('ShowAd', ShowAdSchema)
module.exports = ShowAd