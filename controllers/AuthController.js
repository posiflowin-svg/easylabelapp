const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').replace(/\D/g, '').trim();

const generateReferralCode = (userId) => {
    return `${userId.slice(-4)}${Date.now().toString().slice(-6)}`;
};

const publicUser = (user) => ({
    id: user._id.toString(),
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    referal: user.referralCode || '',
    referralCode: user.referralCode || ''
});

const register = async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        const email = normalizeEmail(req.body.email);
        const phone = normalizePhone(req.body.phone);
        const password = String(req.body.password || '');
        const referredBy = String(req.body.referredBy || '').trim();

        if (!name || !email || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        if (!/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
        }

        if (phone.length !== 10) {
            return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number' });
        }

        const existingUser = await User.findOne({
            $or: [
                { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
                { phone }
            ]
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: existingUser.email && normalizeEmail(existingUser.email) === email
                    ? 'Email already registered. Please login.'
                    : 'Mobile number already registered. Please login.'
            });
        }

        const hashedPass = await bcrypt.hash(password, 10);
        const user = new User({
            name,
            email,
            phone,
            password: hashedPass,
            referredBy: referredBy || null,
            hasPurchased: false,
            rewardGiven: false
        });

        // Create the referral code before the first save. This avoids a duplicate
        // null value on older MongoDB unique referralCode indexes.
        user.referralCode = generateReferralCode(user._id.toString());
        await user.save();

        return res.status(201).json({
            success: true,
            message: 'User Added Successfully!',
            referralCode: user.referralCode,
            user: publicUser(user)
        });
    } catch (error) {
        console.error('Register error:', error);
        if (error && error.code === 11000) {
            return res.status(409).json({ success: false, message: 'Email, mobile number, or referral code already exists' });
        }
        return res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
};

const updateUserStatus = async (req, res) => {
    try {
        const email = normalizeEmail(req.query.email);
        const { hasPurchased, rewardGiven } = req.body;

        if (!email) return res.status(400).json({ message: 'Email is required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (hasPurchased !== undefined) user.hasPurchased = hasPurchased;
        if (rewardGiven !== undefined) user.rewardGiven = rewardGiven;
        await user.save();

        return res.json({ message: 'User status updated successfully!', user });
    } catch (error) {
        console.error('Update user status error:', error);
        return res.status(500).json({ message: 'An error occurred!', error: error.message });
    }
};

const login = async (req, res) => {
    try {
        const username = String(req.body.username || req.body.email || req.body.phone || '').trim();
        const password = String(req.body.password || '');
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required' });
        }

        const email = normalizeEmail(username);
        const phone = normalizePhone(username);
        const user = await User.findOne({ $or: [{ email }, { phone }] });
        if (!user) return res.status(404).json({ success: false, message: 'No user found!' });

        const matched = await bcrypt.compare(password, user.password || '');
        if (!matched) return res.status(401).json({ success: false, message: 'Password does not match!' });

        const secret = process.env.JWT_SECRET || 'verySecretValue';
        const token = jwt.sign({ userId: user._id.toString(), name: user.name, email: user.email }, secret, { expiresIn: '7d' });
        return res.json({ success: true, message: 'Login Successful!', token, user: publicUser(user) });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
};

const quickLogin = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'No user found with this email!' });
        }

        return res.json({
            success: true,
            message: 'Quick Login Successful!',
            user: publicUser(user)
        });
    } catch (error) {
        console.error('Quick login error:', error);
        return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
};

const getReferredUsers = async (req, res) => {
    try {
        const phone = normalizePhone(req.query.phone);
        if (!phone) return res.status(400).json({ message: 'Phone number is required' });

        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.referralCode) {
            return res.status(404).json({
                message: 'No referral code available for this user',
                referralCode: null,
                referredUsers: []
            });
        }

        const referredUsers = await User.find({ referredBy: user.referralCode })
            .select('name email hasPurchased rewardGiven');

        return res.json({
            message: referredUsers.length > 0 ? 'Referred users retrieved successfully!' : 'No referred users found',
            referralCode: user.referralCode,
            referredUsers,
            hasReferralCode: Boolean(user.referralCode)
        });
    } catch (error) {
        console.error('Get referred users error:', error);
        return res.status(500).json({ message: 'An error occurred!', error: error.message });
    }
};

module.exports = { register, login, quickLogin, updateUserStatus, getReferredUsers };
