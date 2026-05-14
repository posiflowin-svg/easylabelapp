const express = require('express')
const r̥outer  = express.Router()

const AppVersionController = require('../controllers/AppVersionController')

r̥outer.get('/', AppVersionController.index)
r̥outer.post('/show', AppVersionController.show)
r̥outer.post('/store', AppVersionController.store)
r̥outer.post('/update', AppVersionController.update)
r̥outer.post('/delete', AppVersionController.destroy)
r̥outer.get('/latest', AppVersionController.getLatestVersion)
r̥outer.post('/update-latest', AppVersionController.updateLatestVersion)

module.exports = r̥outer