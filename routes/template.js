const express = require('express');
const router = express.Router();
const TemplateController = require('../controllers/TemplateController');

router.get('/', TemplateController.index);
router.get('/free', TemplateController.getFree);
router.get('/premium', TemplateController.getPremium);
router.post('/show', TemplateController.show);
router.post('/store', TemplateController.store);
router.get('/getByMainCategory', TemplateController.getByMainCategory);
router.post('/update', TemplateController.update);
router.post('/delete', TemplateController.destroy);
router.post('/delete-all', TemplateController.destroyAll);
router.get('/categories', TemplateController.category);
router.get(
    '/getByTemplateCategory',
    TemplateController.getByTemplateCategory
);

module.exports = router;
