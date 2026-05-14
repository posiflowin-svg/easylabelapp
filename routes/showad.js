const express = require('express')
const r̥outer  = express.Router()

const ShowAdController = require('../controllers/ShowAdController')

r̥outer.get('/', ShowAdController.index)
r̥outer.post('/show', ShowAdController.show)
r̥outer.post('/store', ShowAdController.store)
r̥outer.post('/update', ShowAdController.update)
r̥outer.post('/delete', ShowAdController.destroy)

module.exports = r̥outer