const router=require('express').Router();
const multer=require('multer');
const c=require('../controllers/IconLibraryController');

const allowed = ['image/png','image/jpeg','image/webp','image/svg+xml'];
const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:5*1024*1024},
  fileFilter:(req,file,cb)=>{
    // Some browsers report SVG as text/xml or application/octet-stream.
    const ext=(file.originalname||'').toLowerCase();
    const looksSvg=ext.endsWith('.svg');
    const ok=allowed.includes(file.mimetype) || looksSvg;
    cb(ok ? null : new Error('Upload PNG, JPG, WebP or SVG icon'), ok);
  }
});

router.get('/',c.list);
router.post('/admin/category',c.createCategory);
router.post('/admin/:id/upload',upload.single('icon'),c.upload);
router.post('/admin/:id/toggle',c.toggleCategory);
router.post('/admin/:id/delete',c.deleteCategory);
router.post('/admin/:id/icon/:iconId/delete',c.deleteIcon);

module.exports=router;
