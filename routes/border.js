const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const controller = require('../controllers/BorderController');

const directory = path.join(__dirname, '..', 'public', 'border-assets');
fs.mkdirSync(directory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, directory),
  filename: (req, file, callback) => callback(
    null,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.originalname.replace(/[^a-z0-9.\-_]/gi, '-')}`
  )
});

const uploadZip = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const isZip = extension === '.zip' && ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype);
    callback(isZip ? null : new Error('Please upload a ZIP file only.'), isZip);
  }
});

router.get('/', controller.list);
router.get('/categories', controller.categories);

router.post('/admin/upload', uploadZip.single('borderZip'), controller.create);
router.post('/admin/:id/update', uploadZip.single('borderZip'), controller.update);
router.post('/admin/:id/delete', controller.remove);
router.post('/admin/:id/toggle', controller.toggle);

router.post('/admin/categories/create', controller.createCategory);
router.post('/admin/categories/:id/update', controller.updateCategory);
router.post('/admin/categories/:id/delete', controller.removeCategory);

module.exports = router;
