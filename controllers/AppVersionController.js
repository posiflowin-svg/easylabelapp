const AppVersions = require('../models/Appversion')
const { error } = require('console')

// Show the list of AppVersions
const index = (req, res, next) => {
    AppVersions.find()
    .then(response => {
        res.json({
            response
        })
    })
    .catch(error => {
        res.json({
            message: 'An error Occured!'
        })
    })
}
// get single AppVersions
const show = (req, res, next) => {
    let AppVersionsID = req.body.AppVersionsID
    AppVersions.findById(AppVersionsID)
    .then(response => {
        res.json({
            response
        })
    })
    .catch(error => {
        res.json({
            message: 'An error Occured!'
        })
    })
}

// add new AppVersions
const store = (req, res, next) => {
    let AppVersion = new AppVersions({
        appVersion: req.body.appVersion,
        isForce: req.body.isForce
    })
    AppVersion.save()
    .then(response => {
        res.json({
            message: 'AppVersions Added Successfully!'
        })
    })
    .catch(error => {
        res.json({
            message: 'An error Occured!'
        })
    })
}

// update AppVersions
const update = (req, res, next) => {
    let AppVersionsID = req.body.AppVersionsID
    let updateData = {
        appVersion: req.body.appVersion,
        isForce: req.body.isForce
    }
    AppVersions.findByIdAndUpdate(AppVersionsID, {$set: updateData})
    .then(response => {
        res.json({
            message: 'AppVersions Updated Successfully!'
        })
    })
    .catch(error => {
        res.json({
            message: 'An error Occured!'
        })
    })
}

// delete AppVersions
const destroy = (req, res, next) => {
    let AppVersionsID = req.body.AppVersionsID
    AppVersions.findByIdAndDelete(AppVersionsID)
    .then(response => {
        res.json({
            message: 'AppVersions Deleted Successfully!'
        })
    })
    .catch(error => {
        res.json({
            message: 'An error Occured!'
        })
    })
}

// Fetch the first AppVersion record
const getLatestVersion = (req, res, next) => {
    AppVersions.findOne()
    .then(response => {
        res.json({
            appVersion: response.appVersion,
            isForce: response.isForce
        })
    })
    .catch(error => {
        res.json({
            message: 'An error occurred while fetching the app version.'
        })
    })
}

// Update the first (or only) AppVersion record
const updateLatestVersion = (req, res, next) => {
    let updateData = {
        appVersion: req.body.appVersion,
        isForce: req.body.isForce
    }

    AppVersions.findOneAndUpdate({}, { $set: updateData }, { new: true })
    .then(response => {
        res.json({
            message: 'App version updated successfully! Refresh Page!',
            response
        })
    })
    .catch(error => {
        res.json({
            message: 'An error occurred while updating the app version.'
        })
    })
}

module.exports = {
    index, show, store, update, destroy, getLatestVersion, updateLatestVersion
}