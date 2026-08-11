const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/productController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'productVideo') {
      return ['video/mp4', 'video/webm'].includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error('Product video must be MP4 or WebM.'));
    }
    return ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Images must be JPG, PNG or WebP.'));
  }
});

const productUpload = upload.fields([
  { name: 'productImages', maxCount: 8 },
  { name: 'aPlusImages', maxCount: 10 },
  { name: 'productVideo', maxCount: 1 }
]);

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
router.get('/media/:id', controller.getProductMedia);
router.route('/').get(controller.getAllProducts).post(productUpload, controller.createProduct);
router.route('/:id').get(controller.getProduct).put(productUpload, controller.updateProduct).delete(controller.deleteProduct);

module.exports = router;
