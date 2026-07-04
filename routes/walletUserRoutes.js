// routes/walletUserRoutes.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/walletUserController');
const upload = multer({ dest: 'uploads/' });

router.post('/import', upload.single('file'), controller.importUsers);
router.post('/', controller.createUser);
router.get('/', controller.getAllUsers);
router.get('/:id', controller.getUserById);
router.put('/:id', controller.updateUser);
router.delete('/:id', controller.deleteUser);

module.exports = router;
