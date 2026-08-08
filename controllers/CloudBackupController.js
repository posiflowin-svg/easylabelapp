const mongoose = require('mongoose');
const multer = require('multer');
const { Readable } = require('stream');
const CloudBackup = require('../models/CloudBackup');
const UserSubscription = require('../models/UserSubscription');
const User = require('../models/User');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.CLOUD_BACKUP_MAX_BYTES || 50 * 1024 * 1024) }
}).single('backup');

async function resolveUser(identity) {
  const value = String(identity || '').trim();
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) {
    const direct = await User.findById(value).lean();
    if (direct) return direct;
  }
  const regex = new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
  return User.findOne({ $or: [{ email: regex }, { phone: value }, { mobile: value }] }).lean();
}

async function requireBusiness(identity) {
  const user = await resolveUser(identity);
  if (!user) return { ok: false, code: 404, message: 'User not found' };
  const now = new Date();
  const sub = await UserSubscription.findOne({
    userId: user._id,
    planKey: 'business_monthly',
    status: { $in: ['active','trial','grace_period'] },
    expiryDate: { $gt: now }
  }).sort({ expiryDate: -1 }).lean();
  if (!sub) return { ok: false, code: 403, message: 'Cloud Backup requires the ₹299 Business plan' };
  return { ok: true, user, sub };
}

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'quickBillingCloudBackups' });
}

exports.uploadMiddleware = upload;

exports.status = async (req, res) => {
  try {
    const access = await requireBusiness(req.query.userId);
    if (!access.ok) return res.status(access.code).json({ success:false, message:access.message, business:false });
    const latest = await CloudBackup.findOne({ userId: access.user._id, status:'ready' }).sort({ createdAt:-1 }).lean();
    res.json({ success:true, business:true, expiryDate: access.sub.expiryDate, latest });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.upload = async (req, res) => {
  try {
    const access = await requireBusiness(req.body.userId);
    if (!access.ok) return res.status(access.code).json({ success:false, message:access.message });
    if (!req.file || !req.file.buffer || !req.file.buffer.length) return res.status(400).json({ success:false, message:'Backup file is required' });

    const createdAt = new Date();
    const filename = `EasyLabel_QB_Cloud_${access.user._id}_${Date.now()}.zip`;
    const stream = Readable.from(req.file.buffer);
    const gridId = new mongoose.Types.ObjectId();
    await new Promise((resolve, reject) => {
      const out = bucket().openUploadStreamWithId(gridId, filename, {
        contentType: 'application/zip',
        metadata: { userId: String(access.user._id), createdAt }
      });
      stream.pipe(out).on('error', reject).on('finish', resolve);
    });

    const backup = await CloudBackup.create({
      userId: access.user._id, gridFsId: gridId, fileName: filename, size: req.file.size,
      deviceId: req.body.deviceId || '', deviceName: req.body.deviceName || '', appVersion: req.body.appVersion || '',
      databaseVersion: Number(req.body.databaseVersion || 0),
      localUpdatedAt: req.body.localUpdatedAt ? new Date(Number(req.body.localUpdatedAt)) : createdAt,
      itemCount: Number(req.body.itemCount || 0), billCount: Number(req.body.billCount || 0),
      customerCount: Number(req.body.customerCount || 0), supplierCount: Number(req.body.supplierCount || 0),
      productImageCount: Number(req.body.productImageCount || 0)
    });

    // Retain the latest 5 snapshots per customer.
    const old = await CloudBackup.find({ userId: access.user._id, status:'ready' }).sort({ createdAt:-1 }).skip(5).lean();
    for (const b of old) {
      try { await bucket().delete(b.gridFsId); } catch (_) {}
      await CloudBackup.deleteOne({ _id:b._id });
    }
    res.json({ success:true, backup });
  } catch (e) { console.error('Cloud backup upload:', e); res.status(500).json({ success:false, message:e.message }); }
};

exports.list = async (req, res) => {
  try {
    const access = await requireBusiness(req.query.userId);
    if (!access.ok) return res.status(access.code).json({ success:false, message:access.message });
    const data = await CloudBackup.find({ userId:access.user._id, status:'ready' }).sort({ createdAt:-1 }).limit(10).lean();
    res.json({ success:true, backups:data });
  } catch(e){ res.status(500).json({ success:false, message:e.message }); }
};

exports.download = async (req, res) => {
  try {
    const access = await requireBusiness(req.query.userId);
    if (!access.ok) return res.status(access.code).json({ success:false, message:access.message });
    const backup = await CloudBackup.findOne({ _id:req.params.id, userId:access.user._id, status:'ready' }).lean();
    if (!backup) return res.status(404).json({ success:false, message:'Backup not found' });
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.fileName || 'EasyLabel_Cloud_Backup.zip'}"`);
    bucket().openDownloadStream(backup.gridFsId).on('error', err => { if(!res.headersSent) res.status(404).end(); }).pipe(res);
  } catch(e){ res.status(500).json({ success:false, message:e.message }); }
};
