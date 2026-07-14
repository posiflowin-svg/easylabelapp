'use strict';

const express = require('express');
const router = express.Router();
const ShowAdController = require('../controllers/ShowAdController');

router.get('/', ShowAdController.index);
router.post('/show', ShowAdController.show);
router.post('/store', ShowAdController.store);
router.post('/update', ShowAdController.update);
router.post('/delete', ShowAdController.destroy);

module.exports = router;
