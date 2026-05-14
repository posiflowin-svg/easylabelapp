const express = require('express');
const router = express.Router();

const UserTemplateController = require('../controllers/UserTemplateController');

router.get('/', UserTemplateController.index);
router.post('/show', UserTemplateController.show);
router.get('/get-by-name', UserTemplateController.getByName);
router.post('/store', UserTemplateController.store);
router.post('/bulk-upload', UserTemplateController.bulkUpload);
router.post('/sync', UserTemplateController.syncTemplates);
router.get('/export', UserTemplateController.exportTemplates);
router.get('/getByMainCategory', UserTemplateController.getByMainCategory);
router.post('/update', UserTemplateController.update);
router.post('/delete', UserTemplateController.destroy);
router.get('/categories', UserTemplateController.categories);
router.get('/getByTemplateCategory', UserTemplateController.getByTemplateCategory);

module.exports = router;