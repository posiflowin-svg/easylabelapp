const express = require('express')
const r̥outer  = express.Router()

const BannerController = require('../controllers/BannerController')

r̥outer.post('/banners', BannerController.addBanner);
r̥outer.put('/banners_edit', BannerController.editBanner);
r̥outer.delete('/banners_delete', BannerController.deleteBanner);
r̥outer.get('/banners', BannerController.getBanners);

module.exports = r̥outer