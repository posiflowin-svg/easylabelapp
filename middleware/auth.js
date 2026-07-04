const express = require('express')
const fs = require('fs')
const multer = require('multer')
const r̥outer  = express.Router()
const User   = require('../models/User')
const AuthController = require('../controllers/AuthController')

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024
  }
})

function parseCsvLine(line) {
  const result = []
  let current = ''
  let insideQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"' && insideQuotes && next === '"') {
      current += '"'
      i++
    } else if (char === '"') {
      insideQuotes = !insideQuotes
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '')
}

function normalizePhone(phone) {
  if (phone === undefined || phone === null) return ''
  return String(phone).replace(/\D/g, '').slice(-10)
}

function parseDateSafe(value) {
  if (!value) return new Date()

  const raw = String(value).trim()
  if (!raw) return new Date()

  // dd-mm-yy / dd-mm-yyyy / dd/mm/yyyy
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/)
  if (dmy) {
    let day = parseInt(dmy[1], 10)
    let month = parseInt(dmy[2], 10) - 1
    let year = parseInt(dmy[3], 10)
    if (year < 100) year += 2000
    const date = new Date(year, month, day)
    if (!isNaN(date.getTime())) return date
  }

  const parsed = new Date(raw)
  return isNaN(parsed.getTime()) ? new Date() : parsed
}

function getValue(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]).trim()
    }
  }
  return ''
}


r̥outer.post('/register', AuthController.register)
r̥outer.put('/update-status', AuthController.updateUserStatus);
r̥outer.get('/referred-users', AuthController.getReferredUsers);
r̥outer.post('/login', AuthController.login)
r̥outer.post('/quickLogin', AuthController.quickLogin)
r̥outer.get("/users", async (req, res) => {
    const { from, to } = req.query;
  
    try {
      let query = {};
  
      if (from && to) {
        query.createdAt = { $gte: new Date(from), $lte: new Date(to) };
      }
  
      const users = await User.find(query).select("name email phone createdAt");
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error); // Log the error to the console
      res.status(500).json({ message: "Error fetching users", error: error.message });
    }
});
  

r̥outer.post('/import-users', upload.single('file'), async (req, res) => {
  const filePath = req.file && req.file.path

  try {
    if (!filePath) {
      return res.status(400).json({ message: 'CSV file is required' })
    }

    const csvText = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '')

    if (lines.length < 2) {
      return res.status(400).json({ message: 'CSV file has no user rows' })
    }

    const headers = parseCsvLine(lines[0]).map(normalizeHeader)
    const summary = {
      totalRows: lines.length - 1,
      inserted: 0,
      skipped: 0,
      failed: 0,
      errors: []
    }

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCsvLine(lines[i])
        const row = {}

        headers.forEach((header, index) => {
          row[header] = values[index] || ''
        })

        const name = getValue(row, ['name', 'username', 'fullname', 'user'])
        const email = getValue(row, ['email', 'emailid', 'mail']).toLowerCase()
        const phone = normalizePhone(getValue(row, ['phone', 'mobile', 'mobileno', 'phonenumber', 'contact']))
        const joiningDate = getValue(row, ['joiningdate', 'createdat', 'date', 'joindate'])

        if (!email && !phone) {
          summary.failed++
          summary.errors.push({ row: i + 1, reason: 'Missing email and phone' })
          continue
        }

        const duplicateQuery = []
        if (email) duplicateQuery.push({ email })
        if (phone) duplicateQuery.push({ phone })

        const exists = await User.findOne({ $or: duplicateQuery })
        if (exists) {
          summary.skipped++
          continue
        }

        const userData = {
          name: name || (email ? email.split('@')[0] : phone),
          email,
          phone,
          createdAt: parseDateSafe(joiningDate)
        }

        // If your CSV includes password/hash fields from Mongo export, preserve them.
        const password = getValue(row, ['password', 'pass'])
        const hashedPassword = getValue(row, ['hashedpassword', 'passwordhash', 'hash'])
        if (password) userData.password = password
        if (hashedPassword) userData.password = hashedPassword

        // Preserve commonly used app fields if present in future exports.
        const referralCode = getValue(row, ['referralcode', 'refercode'])
        const referredBy = getValue(row, ['referredby', 'refby'])
        const status = getValue(row, ['status', 'isactive'])
        if (referralCode) userData.referralCode = referralCode
        if (referredBy) userData.referredBy = referredBy
        if (status) userData.status = status

        await User.create(userData)
        summary.inserted++
      } catch (rowError) {
        summary.failed++
        summary.errors.push({ row: i + 1, reason: rowError.message })
      }
    }

    return res.json({
      message: 'Import completed',
      ...summary
    })
  } catch (error) {
    console.error('Import users error:', error)
    return res.status(500).json({ message: 'Import failed', error: error.message })
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
})

module.exports = r̥outer