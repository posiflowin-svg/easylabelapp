const express = require('express');
const router = express.Router();
const controller = require('../controllers/productController');

router.get('/storefront', controller.getStorefront);
router.get('/categories', controller.getAllCategories);
router.get('/settings', controller.getShopSettings);
router.put('/settings', controller.updateShopSettings);
router.get('/category/:category', controller.getProductsByCategory);
router.route('/').get(controller.getAllProducts).post(controller.createProduct);
router.route('/:id').get(controller.getProduct).put(controller.updateProduct).delete(controller.deleteProduct);

module.exports = router;
