const express = require('express');
const router = express.Router();
const colorController = require('../controllers/colorController');

// CRUD Routes
router.get('/', colorController.getAllThemes);
router.get('/:id', colorController.getTheme);
router.post('/', colorController.createTheme);
router.put('/:id', colorController.updateTheme);
router.delete('/:id', colorController.deleteTheme);

module.exports = router;