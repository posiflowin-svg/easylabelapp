const express = require('express');
const multer = require('multer');
const router = express.Router();
const BannerController = require('../controllers/BannerController');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 600 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error('Only JPG, PNG, WebP and GIF images are supported.'));
        }
        cb(null, true);
    }
});

// Public Android API and image delivery.
router.get('/banners', BannerController.getBanners);
router.get('/banners/:id/image', BannerController.getBannerImage);

// Dashboard management routes.
router.post('/banners/manage', upload.single('image'), BannerController.addBanner);
router.put('/banners/manage/:id', upload.single('image'), BannerController.editBanner);
router.put('/banners/manage/:id/toggle', BannerController.toggleBanner);
router.delete('/banners/manage/:id', BannerController.deleteBanner);

// Old API compatibility.
router.post('/banners', BannerController.addBanner);
router.put('/banners_edit', BannerController.editBanner);
router.delete('/banners_delete', BannerController.deleteBanner);

module.exports = router;
