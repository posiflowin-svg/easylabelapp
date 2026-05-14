// middleware/auth.js
const jwt = require('jsonwebtoken');

const verifyAdmin = (req, res, next) => {
    try {
        // Get token from header
        const token = req.header('x-auth-token');
        
        if (!token) {
            return res.status(401).json({ 
                success: false,
                message: 'No token, authorization denied' 
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if user is admin
        if (decoded.role !== 'admin') {
            return res.status(403).json({ 
                success: false,
                message: 'Admin access required' 
            });
        }

        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ 
            success: false,
            message: 'Token is not valid' 
        });
    }
};

module.exports = { verifyAdmin };