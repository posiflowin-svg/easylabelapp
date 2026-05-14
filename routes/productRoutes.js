const express = require('express');
const router = express.Router();
const {
    getAllProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    getProductsByCategory,
    getAllCategories
} = require('../controllers/productController');

router.route('/categories')
    .get(getAllCategories);

router.route('/')
    .get(getAllProducts)
    .post(createProduct);

router.route('/:id')
    .get(getProduct)
    .put(updateProduct)
    .delete(deleteProduct);

router.route('/category/:category')
    .get(getProductsByCategory);

module.exports = router;