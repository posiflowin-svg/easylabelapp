const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const C = require('../controllers/BorderController');

const dir = path.join(__dirname, '..', 'public', 'border-assets');
fs.mkdirSync(dir, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/svg+xml'
]);

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const baseName = path
      .basename(file.originalname, extension)
      .replace(/[^a-z0-9_-]/gi, '-');
    cb(null, `${Date.now()}-${baseName}${extension}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeAllowed = ALLOWED_MIME_TYPES.has(file.mimetype);
    const extensionAllowed = ALLOWED_EXTENSIONS.has(extension);

    if (!mimeAllowed || !extensionAllowed) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'border'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.get('/', C.list);
router.post('/admin/upload', (req, res, next) => {
  upload.single('border')(req, res, (err) => {
    if (err) {
      return res.status(400).send('Only SVG, PNG, JPG or JPEG border files are allowed (maximum 10 MB).');
    }
    next();
  });
}, C.create);
router.post('/admin/:id/delete', C.remove);
router.post('/admin/:id/toggle', C.toggle);

module.exports = router;
