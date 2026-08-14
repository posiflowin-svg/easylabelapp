const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const router = express.Router();
const controller = require('../controllers/productController');

const lightweightUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 20,
    fields: 80
  },
  fileFilter: (req, file, cb) => {
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const videoTypes = ['video/mp4', 'video/webm'];

    if (file.fieldname === 'productVideoFile' || file.fieldname === 'productVideo') {
      return videoTypes.includes(file.mimetype)
        ? cb(null, true)
        : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Product video must be MP4 or WebM'));
    }

    if (!imageTypes.includes(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Images must be JPG, PNG or WebP'));
    }

    cb(null, true);
  }
});

const productUploadTempDir = path.join(os.tmpdir(), 'easylabel-shop-uploads');
fs.mkdirSync(productUploadTempDir, { recursive: true });

const productDiskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, productUploadTempDir),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '');
    const safeBase = path.basename(file.originalname || 'upload', path.extname(file.originalname || ''))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 60);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${safeBase}${safeExt}`);
  }
});

const productUploadDisk = multer({
  storage: productDiskStorage,
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 20,
    fields: 80
  },
  fileFilter: (req, file, cb) => {
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const videoTypes = ['video/mp4', 'video/webm'];

    if (file.fieldname === 'productVideoFile' || file.fieldname === 'productVideo') {
      return videoTypes.includes(file.mimetype)
        ? cb(null, true)
        : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Product video must be MP4 or WebM'));
    }

    if (!imageTypes.includes(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Images must be JPG, PNG or WebP'));
    }

    cb(null, true);
  }
});

const productUpload = productUploadDisk.fields([
  { name: 'productImageFiles', maxCount: 8 },
  { name: 'aPlusImageFiles', maxCount: 10 },
  { name: 'productVideoFile', maxCount: 1 },

  // Backward compatibility with previous Shop Manager builds.
  { name: 'productImages', maxCount: 8 },
  { name: 'aPlusImages', maxCount: 10 },
  { name: 'productVideo', maxCount: 1 }
]);

function uploadedFiles(req) {
  return Object.values(req.files || {}).flat().filter(Boolean);
}

function cleanupProductTempFiles(req) {
  for (const file of uploadedFiles(req)) {
    if (!file.path) continue;
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
}

const MAX_PRODUCT_UPLOAD_TOTAL = 45 * 1024 * 1024;


const handleProductUpload = (req, res, next) => {
  productUpload(req, res, (err) => {
    if (err) {
      cleanupProductTempFiles(req);

      if (err instanceof multer.MulterError) {
        let message = err.message || 'Upload failed';
        if (err.code === 'LIMIT_FILE_SIZE') {
          message = 'One selected file is too large. Maximum size is 15 MB per file.';
        }
        if (err.code === 'LIMIT_FILE_COUNT') message = 'Too many files selected.';
        if (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field) {
          message = `Unsupported upload field or file type: ${err.field}`;
        }
        return res.status(400).json({ success: false, message });
      }

      return res.status(400).json({
        success: false,
        message: err.message || 'Unable to receive product media upload.'
      });
    }

    const files = uploadedFiles(req);
    const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (totalBytes > MAX_PRODUCT_UPLOAD_TOTAL) {
      cleanupProductTempFiles(req);
      return res.status(413).json({
        success: false,
        message: `Selected media is too large (${(totalBytes / 1024 / 1024).toFixed(1)} MB). Maximum total upload is 45 MB. Upload fewer images at a time.`
      });
    }

    // Controller owns temp-file cleanup after this point.
    req.cleanupProductTempFiles = () => cleanupProductTempFiles(req);
    next();
  });
};

router.get('/storefront', controller.getStorefront);
router.get('/settings', controller.getShopSettings);
router.put('/settings', controller.updateShopSettings);

// Managed categories.
router.get('/categories', controller.getAllCategories);
router.post('/categories/manage', lightweightUpload.single('image'), controller.createCategory);
router.put('/categories/manage/:id', lightweightUpload.single('image'), controller.updateCategory);
router.delete('/categories/manage/:id', controller.deleteCategory);
router.get('/categories/:id/image', controller.getCategoryImage);

// Managed Shop hero slider.
router.post('/banners/manage', lightweightUpload.single('image'), controller.createShopBanner);
router.put('/banners/manage/:id', lightweightUpload.single('image'), controller.updateShopBanner);
router.delete('/banners/manage/:id', controller.deleteShopBanner);
router.get('/banners/:id/image', controller.getShopBannerImage);

router.post('/:id/media/delete-selection', express.json(), controller.deleteProductMediaSelection);
router.put('/:id/reorder-images', express.json(), controller.reorderProductImages);
router.delete('/:id/bulk-delete-images', express.json(), controller.bulkDeleteProductImages);
router.delete('/:id/media/:mediaId', controller.deleteProductImage);
router.put('/:id/reorder-aplus-images', express.json(), controller.reorderAPlusImages);
router.delete('/:id/bulk-delete-aplus-images', express.json(), controller.bulkDeleteAPlusImages);
router.delete('/:id/aplus-media/:mediaId', controller.deleteAPlusImage);

router.get('/category/:category', controller.getProductsByCategory);
router.get('/media/:id', controller.getProductMedia);
router.route('/').get(controller.getAllProducts).post(handleProductUpload, controller.createProduct);
router.route('/:id').get(controller.getProduct).put(handleProductUpload, controller.updateProduct).delete(controller.deleteProduct);

module.exports = router;
