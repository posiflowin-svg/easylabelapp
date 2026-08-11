const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/productController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG and WebP images are supported.'));
    }
    cb(null, true);
  }
});

router.get('/storefront', controller.getStorefront);
router.get('/settings', controller.getShopSettings);
router.put('/settings', controller.updateShopSettings);

// Managed categories.
router.get('/categories', controller.getAllCategories);
router.post('/categories/manage', upload.single('image'), controller.createCategory);
router.put('/categories/manage/:id', upload.single('image'), controller.updateCategory);
router.delete('/categories/manage/:id', controller.deleteCategory);
router.get('/categories/:id/image', controller.getCategoryImage);

// Managed Shop hero slider.
router.post('/banners/manage', upload.single('image'), controller.createShopBanner);
router.put('/banners/manage/:id', upload.single('image'), controller.updateShopBanner);
router.delete('/banners/manage/:id', controller.deleteShopBanner);
router.get('/banners/:id/image', controller.getShopBannerImage);

router.get('/category/:category', controller.getProductsByCategory);
router.route('/').get(controller.getAllProducts).post(controller.createProduct);
router.route('/:id').get(controller.getProduct).put(controller.updateProduct).delete(controller.deleteProduct);

module.exports = router;
