const express = require('express')
const r̥outer  = express.Router()

const TemplateController = require('../controllers/TemplateController')

r̥outer.get('/', TemplateController.index)
r̥outer.post('/show', TemplateController.show)
r̥outer.post('/store', TemplateController.store)
r̥outer.get('/getByMainCategory', TemplateController.getByMainCategory)
r̥outer.post('/update', TemplateController.update)
r̥outer.post('/delete', TemplateController.destroy)
r̥outer.get('/categories', TemplateController.category)
r̥outer.get('/getByTemplateCategory', TemplateController.getByTemplateCategory)

module.exports = r̥outer