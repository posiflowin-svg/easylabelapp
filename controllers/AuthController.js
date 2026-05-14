const User   = require('../models/User')
const bcrypt = require('bcryptjs')
const jwt    = require('jsonwebtoken')

// Generate referral code using user ID and timestamp
const generateReferralCode = (userId) => {
    return `${userId.slice(-4)}${Date.now().toString().slice(-6)}`;
};

const register = async (req, res, next) => {
    try {
        const { name, email, phone, password, referredBy } = req.body;

        // Validate required fields
        if (!name || !email || !phone || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        // Check if email or phone already exists
        const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
        if (existingUser) {
            return res.status(400).json({ message: 'Email or phone already in use' });
        }

        // Hash password
        const hashedPass = await bcrypt.hash(password, 10);

        // Create new user
        const user = new User({
            name,
            email,
            phone,
            password: hashedPass,
            referredBy: referredBy || null,
            hasPurchased: false,
            rewardGiven: false
        });

        await user.save();

        // Generate referral code based on user ID and timestamp
        user.referralCode = generateReferralCode(user._id.toString());
        await user.save();

        res.status(201).json({ message: 'User Added Successfully!', referralCode: user.referralCode });
    } catch (error) {
        res.status(500).json({ message: 'An error occurred!', error: error.message });
    }
};
// Update hasPurchased and rewardGiven by user email
const updateUserStatus = async (req, res) => {
    try {
        const { email } = req.query;  // Use req.query to get email from query parameters
        const { hasPurchased, rewardGiven } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.hasPurchased = hasPurchased !== undefined ? hasPurchased : user.hasPurchased;
        user.rewardGiven = rewardGiven !== undefined ? rewardGiven : user.rewardGiven;

        await user.save();
        res.json({ message: 'User status updated successfully!', user });
    } catch (error) {
        res.status(500).json({ message: 'An error occurred!', error: error.message });
    }
};

const login = (req, res, next) =>{
    var username = req.body.username
    var password = req.body.password

    User.findOne({$or: [{email:username}, {phone:username}]})
    .then(user => {
        if(user) {
            bcrypt.compare(password, user.password, function(err, result) {
                if(err) {
                    res.json({
                        error: err
                    })
                }
                if(result){
                    let token = jwt.sign({name:user.name}, 'verySecretValue', {expiresIn: '1h'})
                    res.json({
                        message: 'Login Successful!',
                        token
                    })
                }else{
                    res.json({
                        message: 'Password does not macthed!'
                    })
                }
            })
        } else {
            res.json({
                message: 'No user Found!'
            })
        }
    })
}

const quickLogin = (req, res, next) => {
    const email = req.body.email;

    User.findOne({ email: email })
        .then(user => {
            if (user) {
                res.json({
                    message: 'Quick Login Successful!',
                    user: {
                        name: user.name,
                        email: user.email,
                        referal: user.referralCode,
                        phone: user.phone
                    }
                });
            } else {
                res.json({
                    message: 'No user found with this email!'
                });
            }
        })
        .catch(error => {
            res.json({
                message: 'An error occurred!',
                error: error
            });
        });
};

const getReferredUsers = async (req, res) => {
    try {
        const { phone } = req.query; // Get phone number from query parameters

        if (!phone) {
            return res.status(400).json({ message: 'Phone number is required' });
        }

        // Find the user with the given phone number
        const user = await User.findOne({ phone });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.referralCode) {
            return res.status(404).json({ 
                message: 'No referral code available for this user',
                referralCode: null,
                referredUsers: []
            });
        }

        // Use the retrieved referral code to get referred users
        const referredUsers = await User.find({ referredBy: user.referralCode })
            .select('name email hasPurchased rewardGiven');

        res.json({ 
            message: referredUsers.length > 0 
                ? 'Referred users retrieved successfully!' 
                : 'No referred users found',
            referralCode: user.referralCode,
            referredUsers,
            hasReferralCode: !!user.referralCode
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'An error occurred!', 
            error: error.message 
        });
    }
};


module.exports = {
    register, login, quickLogin, updateUserStatus, getReferredUsers
}