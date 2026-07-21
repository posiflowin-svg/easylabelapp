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
    `${Date.now()}-${file.originalname.replace(/[^a-z0-9.\-_]/gi, '-')}`
  )
});

const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.svg']);
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowed = allowedMimeTypes.has(file.mimetype) && allowedExtensions.has(extension);
    callback(allowed ? null : new Error('Only SVG, PNG, JPG and JPEG borders are allowed'), allowed);
  }
});

router.get('/', controller.list);
router.get('/categories', controller.categories);

router.post('/admin/upload', upload.single('border'), controller.create);
router.post('/admin/:id/update', upload.single('border'), controller.update);
router.post('/admin/:id/delete', controller.remove);
router.post('/admin/:id/toggle', controller.toggle);

router.post('/admin/categories/create', controller.createCategory);
router.post('/admin/categories/:id/update', controller.updateCategory);
router.post('/admin/categories/:id/delete', controller.removeCategory);

module.exports = router;
