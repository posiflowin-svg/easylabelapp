const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AccountDeletionRequest = require('../models/AccountDeletionRequest');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').replace(/\D/g, '').trim();

exports.page = (req, res) => {
    res.render('delete-account', {
        submitted: false,
        error: '',
        identifier: ''
    });
};

exports.submit = async (req, res) => {
    try {
        const identifier = String(req.body.identifier || '').trim();
        const password = String(req.body.password || '');
        const reason = String(req.body.reason || '').trim().slice(0, 1000);

        if (!identifier || !password) {
            return res.status(400).render('delete-account', {
                submitted: false,
                error: 'Enter your registered email/mobile number and password.',
                identifier
            });
        }

        const isEmail = identifier.includes('@');
        const email = normalizeEmail(identifier);
        const phone = normalizePhone(identifier);

        const user = await User.findOne(isEmail ? { email } : { phone });
        if (!user) {
            return res.status(404).render('delete-account', {
                submitted: false,
                error: 'We could not find an EasyLabel account with these details.',
                identifier
            });
        }

        const passwordMatches = await bcrypt.compare(password, user.password || '');
        if (!passwordMatches) {
            return res.status(401).render('delete-account', {
                submitted: false,
                error: 'The password is incorrect. Please try again.',
                identifier
            });
        }

        const existing = await AccountDeletionRequest.findOne({
            userId: user._id,
            status: { $in: ['pending', 'processing'] }
        }).lean();

        if (!existing) {
            await AccountDeletionRequest.create({
                userId: user._id,
                name: user.name || '',
                email: user.email || '',
                phone: user.phone || '',
                reason,
                status: 'pending',
                requestedAt: new Date()
            });
        }

        return res.status(200).render('delete-account', {
            submitted: true,
            error: '',
            identifier: ''
        });
    } catch (error) {
        console.error('Account deletion request error:', error);
        return res.status(500).render('delete-account', {
            submitted: false,
            error: 'We could not submit your request right now. Please try again later.',
            identifier: String(req.body.identifier || '').trim()
        });
    }
};

// JSON endpoint for a future in-app Delete Account button.
exports.submitApi = async (req, res) => {
    try {
        const identifier = String(req.body.identifier || '').trim();
        const password = String(req.body.password || '');
        const reason = String(req.body.reason || '').trim().slice(0, 1000);

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: 'Registered email/mobile number and password are required.'
            });
        }

        const isEmail = identifier.includes('@');
        const email = normalizeEmail(identifier);
        const phone = normalizePhone(identifier);
        const user = await User.findOne(isEmail ? { email } : { phone });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Account not found.' });
        }

        const passwordMatches = await bcrypt.compare(password, user.password || '');
        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: 'Incorrect password.' });
        }

        const request = await AccountDeletionRequest.findOneAndUpdate(
            {
                userId: user._id,
                status: { $in: ['pending', 'processing'] }
            },
            {
                $setOnInsert: {
                    userId: user._id,
                    name: user.name || '',
                    email: user.email || '',
                    phone: user.phone || '',
                    reason,
                    status: 'pending',
                    requestedAt: new Date()
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        return res.json({
            success: true,
            message: 'Account deletion request received.',
            requestId: request._id,
            status: request.status
        });
    } catch (error) {
        console.error('Account deletion API error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to submit account deletion request.'
        });
    }
};
