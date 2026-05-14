const mongoose = require('mongoose')
const { type } = require('os')
const Schema   = mongoose.Schema

const appVersionSchema = new Schema({
    appVersion: {
        type: String
    },
    isForce: {
        type: String
    },
}, {timestamps: true})

const AppVersion = mongoose.model('AppVersion', appVersionSchema)
module.exports = AppVersion