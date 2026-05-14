const mongoose = require('mongoose')
const { type } = require('os')
const Schema   = mongoose.Schema

const templateSchema = new Schema({
    name: {
        type: String
    },
    mainCategory: {
        type: String,
        required: true
    },
    templateCategory: {
        type: String
    },
    jsonData: {
        type: String
    },
}, {timestamps: true})

const Template = mongoose.model('Template', templateSchema)
module.exports = Template