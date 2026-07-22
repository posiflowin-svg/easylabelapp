const express = require('express');
const router = express.Router();
const User = require('../models/User');
const AuthController = require('../controllers/AuthController');

router.post('/register', AuthController.register);
router.put('/update-status', AuthController.updateUserStatus);
router.get('/referred-users', AuthController.getReferredUsers);
router.post('/login', AuthController.login);
router.post('/quickLogin', AuthController.quickLogin);
router.get('/users', async (req, res) => {
    const { from, to } = req.query;
    try {
        const query = {};
        if (from && to) query.createdAt = { $gte: new Date(from), $lte: new Date(to) };
        const users = await User.find(query).select('name email phone createdAt');
        return res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        return res.status(500).json({ message: 'Error fetching users', error: error.message });
    }
});

module.exports = router;
