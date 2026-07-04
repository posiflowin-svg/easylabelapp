// controllers/walletUserController.js
const WalletUser = require('../models/WalletUser');
const User = require('../models/User');

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

  const filePath = req.file && req.file.path;

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
    return String(header || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/_/g, '')
      .replace(/-/g, '');
  }

  function normalizePhone(phone) {
    if (!phone) return '';
    return String(phone).replace(/\D/g, '').slice(-10);
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function parseDate(value) {
    if (!value) return undefined;

    const raw = String(value).trim();
    const directDate = new Date(raw);
    if (!isNaN(directDate.getTime())) return directDate;

    const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]) - 1;
      let year = Number(match[3]);
      if (year < 100) year += 2000;

      const parsed = new Date(year, month, day);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    return undefined;
  }

  try {
    if (!filePath) {
      return res.status(400).json({ message: 'CSV file is required' });
    }

    const csvText = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = csvText
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');

    if (lines.length < 2) {
      return res.status(400).json({ message: 'CSV file has no user rows' });
    }

    const headers = parseCsvLine(lines[0]).map(normalizeHeader);

    const summary = {
      totalRows: lines.length - 1,
      inserted: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};

      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      const name =
        row.name ||
        row.username ||
        row.fullname ||
        row.customername ||
        row.user ||
        row.customer ||
        '';

      const email = normalizeEmail(row.email || row.emailid || row.mail || '');
      const phone = normalizePhone(
        row.phone ||
        row.mobile ||
        row.mobileno ||
        row.phonenumber ||
        row.contact ||
        row.contactno ||
        row.mobilenumber ||
        ''
      );

      const joiningDate = parseDate(
        row.joiningdate ||
        row.createdat ||
        row.createddate ||
        row.date ||
        row.registeredat ||
        ''
      );

      if (!email && !phone) {
        summary.failed++;
        if (summary.errors.length < 25) {
          summary.errors.push({ row: i + 1, reason: 'Missing email and phone/mobile' });
        }
        continue;
      }

      rows.push({
        rowNumber: i + 1,
        name: name || (email ? email.split('@')[0] : phone),
        email,
        phone,
        ...(joiningDate ? { createdAt: joiningDate, updatedAt: joiningDate } : {})
      });
    }

    if (rows.length === 0) {
      return res.json({ message: 'No valid users found in CSV', ...summary });
    }

    // Remove duplicates inside uploaded CSV first.
    const seenEmails = new Set();
    const seenPhones = new Set();
    const uniqueRows = [];

    rows.forEach((user) => {
      const duplicateInCsv =
        (user.email && seenEmails.has(user.email)) ||
        (user.phone && seenPhones.has(user.phone));

      if (duplicateInCsv) {
        summary.skipped++;
        return;
      }

      if (user.email) seenEmails.add(user.email);
      if (user.phone) seenPhones.add(user.phone);
      uniqueRows.push(user);
    });

    const emailList = uniqueRows.map((u) => u.email).filter(Boolean);
    const phoneList = uniqueRows.map((u) => u.phone).filter(Boolean);

    // IMPORTANT:
    // This import is for the dashboard Users page, which loads data from /api/users.
    // /api/users uses the main User collection with fields: name, email, phone.
    // Do not check WalletUser here; otherwise old app users can be skipped wrongly.
    const existingQuery = [];
    if (emailList.length) existingQuery.push({ email: { $in: emailList } });
    if (phoneList.length) existingQuery.push({ phone: { $in: phoneList } });

    let existingUsers = [];
    if (existingQuery.length > 0) {
      existingUsers = await User.find({ $or: existingQuery }).select('email phone');
    }

    const existingEmails = new Set(
      existingUsers.map((u) => normalizeEmail(u.email)).filter(Boolean)
    );
    const existingPhones = new Set(
      existingUsers.map((u) => normalizePhone(u.phone)).filter(Boolean)
    );

    const usersToInsert = uniqueRows.filter((user) => {
      const exists =
        (user.email && existingEmails.has(user.email)) ||
        (user.phone && existingPhones.has(user.phone));

      if (exists) {
        summary.skipped++;
        return false;
      }

      return true;
    });

    if (usersToInsert.length > 0) {
      const batchSize = 500;

      for (let i = 0; i < usersToInsert.length; i += batchSize) {
        const batch = usersToInsert.slice(i, i + batchSize);

        try {
          const inserted = await User.insertMany(batch, { ordered: false });
          summary.inserted += inserted.length;
        } catch (batchError) {
          if (batchError.insertedDocs) {
            summary.inserted += batchError.insertedDocs.length;
          }

          if (batchError.writeErrors && Array.isArray(batchError.writeErrors)) {
            summary.failed += batchError.writeErrors.length;

            batchError.writeErrors
              .slice(0, Math.max(0, 25 - summary.errors.length))
              .forEach((writeError) => {
                summary.errors.push({
                  reason: writeError.errmsg || writeError.message || 'Insert failed'
                });
              });
          } else {
            summary.failed += batch.length;
            if (summary.errors.length < 25) {
              summary.errors.push({ reason: batchError.message });
            }
          }
        }
      }
    }

    return res.json({
      message: 'Users import completed',
      ...summary
    });
  } catch (err) {
    return res.status(500).json({ message: 'Import failed', error: err.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};

