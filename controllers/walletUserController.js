// controllers/walletUserController.js
const WalletUser = require('../models/WalletUser');

exports.createUser = async (req, res) => {
  try {
    const { email, mobile, username } = req.body;

    // Validate required fields
    if (!email || !mobile) {
      return res.status(400).json({ error: 'Email and mobile are required fields' });
    }

    // Validate email format (basic check)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate mobile format (basic check for 10 digits)
    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ error: 'Mobile should be 10 digits' });
    }

    // Generate username from email if not provided
    let finalUsername = username;
    if (!finalUsername || finalUsername.trim() === '') {
      finalUsername = email.split('@')[0]; // Take part before @
    }

    // Create user with processed data
    const user = new WalletUser({
      email,
      mobile,
      username: finalUsername
    });

    await user.save();
    res.status(201).json(user);
    
  } catch (err) {
    // Handle duplicate key errors (like duplicate email)
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(400).json({ error: `${field} already exists` });
    }
    res.status(400).json({ error: err.message });
  }
};

exports.getAllUsers = async (req, res) => {
  const users = await WalletUser.find();
  res.json(users);
};

exports.getUserById = async (req, res) => {
  try {
      const user = await WalletUser.findOne({ mobile: req.params.id });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
};

exports.updateUser = async (req, res) => {
  const user = await WalletUser.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
};

exports.deleteUser = async (req, res) => {
  const user = await WalletUser.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'User deleted' });
};
