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


exports.importUsers = async (req, res) => {
  const fs = require('fs');

  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];

      if (char === '"' && insideQuotes && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  function normalizeHeader(header) {
    return String(header || '').trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  }

  function normalizePhone(phone) {
    if (!phone) return '';
    return String(phone).replace(/\D/g, '').slice(-10);
  }

  const filePath = req.file && req.file.path;

  try {
    if (!filePath) {
      return res.status(400).json({ message: 'CSV file is required' });
    }

    const csvText = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');

    if (lines.length < 2) {
      return res.status(400).json({ message: 'CSV file has no user rows' });
    }

    const headers = parseCsvLine(lines[0]).map(normalizeHeader);
    const summary = { totalRows: lines.length - 1, inserted: 0, skipped: 0, failed: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCsvLine(lines[i]);
        const row = {};

        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });

        const username = row.name || row.username || row.fullname || '';
        const email = (row.email || row.emailid || '').toLowerCase();
        const mobile = normalizePhone(row.phone || row.mobile || row.mobileno || '');

        if (!email && !mobile) {
          summary.failed++;
          summary.errors.push({ row: i + 1, reason: 'Missing email and mobile' });
          continue;
        }

        const duplicateQuery = [];
        if (email) duplicateQuery.push({ email });
        if (mobile) duplicateQuery.push({ mobile });

        let exists = null;
        if (duplicateQuery.length > 0) {
          exists = await WalletUser.findOne({ $or: duplicateQuery });
        }
        if (exists) {
          summary.skipped++;
          continue;
        }

        await WalletUser.create({
          username: username || (email ? email.split('@')[0] : mobile),
          email,
          mobile,
          wallet: { points: Number(row.points || row.wallet || 0) || 0 }
        });

        summary.inserted++;
      } catch (rowError) {
        summary.failed++;
        summary.errors.push({ row: i + 1, reason: rowError.message });
      }
    }

    res.json({ message: 'Wallet users import completed', ...summary });
  } catch (err) {
    res.status(500).json({ message: 'Import failed', error: err.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};
