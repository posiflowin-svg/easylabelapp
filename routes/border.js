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

const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.svg']);
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowed = allowedMimeTypes.has(file.mimetype) && allowedExtensions.has(extension);
    callback(allowed ? null : new Error('Only SVG, PNG, JPG and JPEG borders are allowed'), allowed);
  }
});

const SIZE_FIELDS = [
  'border_50x25','border_50x30','border_50x50','border_50x12',
  'border_38x38','border_38x25','border_38x15','border_75x25',
  'border_75x50','border_100x50','border_100x150','border_100x15'
].map(name => ({ name, maxCount: 1 }));

router.get('/', controller.list);
router.get('/categories', controller.categories);

router.post('/admin/upload', upload.fields(SIZE_FIELDS), controller.create);
router.post('/admin/:id/update', upload.fields(SIZE_FIELDS), controller.update);
router.post('/admin/:id/delete', controller.remove);
router.post('/admin/:id/toggle', controller.toggle);

router.post('/admin/categories/create', controller.createCategory);
router.post('/admin/categories/:id/update', controller.updateCategory);
router.post('/admin/categories/:id/delete', controller.removeCategory);

module.exports = router;
