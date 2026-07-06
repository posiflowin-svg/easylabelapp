const express = require('express');
const router = express.Router();

const AppVersionController = require('../controllers/AppVersionController');

router.get('/', AppVersionController.index);
router.post('/show', AppVersionController.show);
router.post('/store', AppVersionController.store);
router.post('/update', AppVersionController.update);
router.post('/delete', AppVersionController.destroy);
router.get('/latest', AppVersionController.getLatestVersion);
router.post('/update-latest', AppVersionController.updateLatestVersion);

module.exports = router;
