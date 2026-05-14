// controllers/walletTransactionController.js
const WalletTransaction = require('../models/WalletTransaction');
const WalletUser = require('../models/WalletUser');
const mongoose = require('mongoose');

function generateTicketId() {
  const now = new Date();
  const id = 'TXN' +
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    Math.floor(1000 + Math.random() * 9000); // Random 4-digit number
  return id;
}

exports.addTransaction = async (req, res) => {
  try {
    const { userId, type, points, reason } = req.body;
    const user = await WalletUser.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newBalance =
      type === 'add' ? user.wallet.points + points :
      type === 'redeem' ? user.wallet.points - points :
      user.wallet.points;

    if (newBalance < 0) {
      return res.status(400).json({ error: 'Not enough points to redeem' });
    }

    const ticketId = generateTicketId();
    const transaction = new WalletTransaction({ userId, type, points, reason, ticketId });
    await transaction.save();

    user.wallet.points = newBalance;
    await user.save();

    res.status(201).json({ transaction, newBalance });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getUserTransactions = async (req, res) => {
  try {
    const userId = req.params.userId;

    // Check if userId is "USER_ID" (placeholder string)
    if (userId === "USER_ID") {
      return res.status(401).json({ 
        error: "Invalid session. Please try logging in again.",
        code: "SESSION_INVALID"
      });
    }

    // Check if userId is a valid MongoDB ObjectId (if you're using ObjectId references)
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        error: "Invalid user ID format",
        code: "INVALID_USER_ID"
      });
    }

    const transactions = await WalletTransaction.find({ userId }).sort({ timestamp: -1 });
    
    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ 
        message: "No transactions found for this user",
        code: "NO_TRANSACTIONS"
      });
    }

    res.json(transactions);

  } catch (err) {
    console.error("Error fetching transactions:", err);
    res.status(500).json({ 
      error: "Failed to fetch transactions",
      code: "SERVER_ERROR"
    });
  }
};
