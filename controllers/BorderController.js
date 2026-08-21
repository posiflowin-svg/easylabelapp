const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const Border = require('../models/Border');
const BorderCategory = require('../models/BorderCategory');
const BorderAsset = require('../models/BorderAsset');

const DEFAULT_CATEGORIES = ['new', 'hot', 'fancy', 'plant', 'holiday', 'animal'];
const SUPPORTED_SIZES = [
  '50x25','50x30','50x50','50x12','38x38','38x25','38x15',
  '75x25','75x50','100x50','100x150','100x15'
];

function borderAssetDirectory() {
  const directory = path.join(__dirname, '..', 'public', 'border-assets');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function borderMimeType(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function persistBorderAsset(filename, data) {
  await BorderAsset.updateOne(
    { filename },
    {
      $set: {
        contentType: borderMimeType(filename),
        data,
        size: data.length
      }
    },
    { upsert: true }
  );
}

function borderFilenameFromUrl(url) {
  try {
    if (!url || !String(url).includes('/border-assets/')) return '';
    return path.basename(
      decodeURIComponent(String(url).split('/border-assets/').pop().split('?')[0])
    );
  } catch (_) {
    return '';
  }
}


function publicBaseUrl(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

function normaliseAccessLevel(value, legacyVip) {
  const level = String(value || '').trim().toLowerCase();
  if (['free', 'premium', 'business'].includes(level)) return level;
  return legacyVip ? 'premium' : 'free';
}

function categoryKey(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function removeLocalAsset(url) {
  try {
    const filename = borderFilenameFromUrl(url);
    if (!filename) return;

    // Remove the local cache copy when present.
    const filePath = path.join(borderAssetDirectory(), filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // The Mongo copy is the persistent source of truth. Fire-and-forget is safe
    // here because cleanup must never block the admin response.
    BorderAsset.deleteOne({ filename }).catch(error => {
      console.warn('Unable to remove persisted border asset:', error.message);
    });
  } catch (error) {
    console.warn('Unable to remove old border asset:', error.message);
  }
}

function removeUploadedZip(req) {
  try {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  } catch (error) {
    console.warn('Unable to remove uploaded ZIP:', error.message);
  }
}

function cleanupUploadedFiles(req) {
  removeUploadedZip(req);
  Object.values(req.files || {}).flat().forEach(file => {
    if (file && file.filename) removeLocalAsset(`${publicBaseUrl(req)}/border-assets/${file.filename}`);
  });
}

function sanitiseBaseName(value) {
  return String(value || 'border')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'border';
}

function detectSupportedSize(filename) {
  const normalised = String(filename || '').toLowerCase().replace(/[×*]/g, 'x');
  for (const size of SUPPORTED_SIZES) {
    const escaped = size.replace('x', '[x_-]?');
    const pattern = new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`, 'i');
    if (pattern.test(normalised)) return size;
  }
  return '';
}

async function extractZipVariants(req) {
  if (!req.file) throw new Error('Please choose one ZIP file containing the border sizes.');

  const zipPath = req.file.path;
  const destination = borderAssetDirectory();
  const base = publicBaseUrl(req);
  const created = [];

  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    if (!entries.length) throw new Error('The uploaded ZIP is empty.');
    if (entries.length > 60) throw new Error('The ZIP contains too many files. Maximum 60 entries are allowed.');

    const variants = {};
    const ignored = [];
    let totalBytes = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const originalName = path.basename(entry.entryName || '');
      if (!originalName || originalName.startsWith('.') || originalName === '__MACOSX') continue;

      const extension = path.extname(originalName).toLowerCase();
      if (!['.svg', '.png', '.jpg', '.jpeg'].includes(extension)) {
        ignored.push(originalName);
        continue;
      }

      const size = detectSupportedSize(originalName);
      if (!size) {
        ignored.push(originalName);
        continue;
      }
      if (variants[size]) throw new Error(`More than one file was found for ${size}. Keep only one file for each size.`);

      const data = entry.getData();
      totalBytes += data.length;
      if (data.length > 10 * 1024 * 1024) throw new Error(`${originalName} is larger than 10 MB.`);
      if (totalBytes > 50 * 1024 * 1024) throw new Error('Extracted ZIP content is larger than 50 MB.');

      const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${sanitiseBaseName(req.body.name)}-${size}${extension}`;
      // Keep a local copy for fast serving during the current process, but also
      // persist the exact asset bytes in MongoDB so Render deploys/restarts do not
      // make fresh Android installs show blank border cards.
      fs.writeFileSync(path.join(destination, filename), data);
      await persistBorderAsset(filename, data);

      created.push(filename);
      // Store a host-independent URL. This prevents stale http/old-host URLs from
      // breaking the admin preview and Android import after Render redeploys.
      variants[size] = `/border-assets/${encodeURIComponent(filename)}`;
    }

    if (!Object.keys(variants).length) {
      throw new Error('No supported border files were found. Filenames must include a size such as 50x25.svg or Plain_Border_50x25.svg.');
    }

    return { variants, ignored };
  } catch (error) {
    created.forEach(filename => removeLocalAsset(`${base}/border-assets/${filename}`));
    throw error;
  } finally {
    removeUploadedZip(req);
  }
}

function mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value.toObject === 'function') return value.toObject();
  return { ...value };
}

function firstVariant(variants) {
  for (const size of SUPPORTED_SIZES) if (variants[size]) return variants[size];
  return '';
}

async function ensureDefaultCategories() {
  const count = await BorderCategory.countDocuments();
  if (count > 0) return;
  await BorderCategory.insertMany(DEFAULT_CATEGORIES.map((name, index) => ({
    name, label: name.charAt(0).toUpperCase() + name.slice(1), sortOrder: index, active: true
  })), { ordered: false }).catch(() => {});
}

function normaliseAssetUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const filename = borderFilenameFromUrl(raw);
  return filename ? `/border-assets/${encodeURIComponent(filename)}` : raw;
}

function serializeBorder(border) {
  const rawVariants = mapToObject(border.variants);
  const variants = {};
  for (const [size, url] of Object.entries(rawVariants)) variants[size] = normaliseAssetUrl(url);
  const previewUrl = normaliseAssetUrl(border.previewUrl) || normaliseAssetUrl(border.thumbnailUrl) || variants['50x25'] || normaliseAssetUrl(border.imageUrl) || firstVariant(variants);
  return {
    ...border,
    variants,
    files: variants,
    previewUrl,
    thumbnailUrl: previewUrl,
    imageUrl: normaliseAssetUrl(border.imageUrl) || firstVariant(variants) || previewUrl,
    accessLevel: normaliseAccessLevel(border.accessLevel, border.isVip),
    isVip: normaliseAccessLevel(border.accessLevel, border.isVip) !== 'free'
  };
}


/**
 * Persistent public border asset endpoint.
 *
 * Border URLs stored in Mongo remain /border-assets/<filename>, so no Android
 * change is required. Assets are read from Mongo first; a local filesystem copy
 * is used only as a backward-compatible fallback.
 */
exports.assetFile = async (req, res) => {
  try {
    const filename = path.basename(String(req.params.filename || ''));
    if (!filename) return res.status(404).end();

    const asset = await BorderAsset.findOne({ filename }).lean();
    if (asset && asset.data) {
      // Mongoose normally returns a Node Buffer. Buffer.from also safely handles
      // BSON Binary/Uint8Array shapes from different Mongo/Mongoose versions.
      let bytes = asset.data;
      if (!Buffer.isBuffer(bytes)) {
        if (bytes.buffer && Buffer.isBuffer(bytes.buffer)) bytes = bytes.buffer;
        else if (bytes.buffer instanceof ArrayBuffer) bytes = Buffer.from(bytes.buffer);
        else bytes = Buffer.from(bytes);
      }
      res.set('Content-Type', asset.contentType || borderMimeType(filename));
      res.set('Content-Length', String(bytes.length));
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.end(bytes);
    }

    // Backward compatibility for assets that still physically exist in an old
    // deployment or in source-controlled public/border-assets.
    const localPath = path.join(borderAssetDirectory(), filename);
    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(localPath);
    }

    return res.status(404).json({
      success: false,
      message: 'Border asset not found. Re-upload this border once from Border Management.'
    });
  } catch (error) {
    console.error('Unable to serve border asset:', error);
    return res.status(500).json({ success: false, message: 'Unable to load border asset.' });
  }
};

exports.list = async (req, res) => {
  try {
    const query = { active: true };
    const category = categoryKey(req.query.category);
    if (category && category !== 'all') {
      if (category === 'vip') query.$or = [{ accessLevel: { $in: ['premium','business'] } }, { isVip: true }];
      else query.category = category;
    }
    const borders = await Border.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
    res.json({ success: true, borders: borders.map(serializeBorder) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.categories = async (req, res) => {
  try {
    await ensureDefaultCategories();
    const categories = await BorderCategory.find({ active: true }).sort({ sortOrder: 1, label: 1 }).lean();
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.page = async (req, res) => {
  await ensureDefaultCategories();
  const [borders, categories] = await Promise.all([
    Border.find().sort({ sortOrder: 1, createdAt: -1 }).lean(),
    BorderCategory.find().sort({ sortOrder: 1, label: 1 }).lean()
  ]);
  res.render('borders', {
    message: req.query.message || '', error: req.query.error || '', categories,
    sizes: SUPPORTED_SIZES,
    borders: borders.map(serializeBorder)
  });
};

exports.create = async (req, res) => {
  try {
    const zipResult = await extractZipVariants(req);
    const variants = zipResult.variants;

    const category = categoryKey(req.body.category) || 'new';
    if (!(await BorderCategory.exists({ name: category, active: true }))) {
      cleanupUploadedFiles(req);
      return res.redirect('/border-management?error=' + encodeURIComponent('Please select a valid active category.'));
    }

    const accessLevel = normaliseAccessLevel(req.body.accessLevel, req.body.isVip === 'on');
    const previewUrl = variants['50x25'] || firstVariant(variants);
    await Border.create({
      name: String(req.body.name || 'Border Design').trim(), category, variants,
      previewUrl, thumbnailUrl: previewUrl, imageUrl: firstVariant(variants),
      accessLevel, isVip: accessLevel !== 'free', sortOrder: Number(req.body.sortOrder || 0), active: true
    });
    const uploadedSizes = Object.keys(variants).join(', ');
    const ignoredNote = zipResult.ignored.length ? ` Ignored: ${zipResult.ignored.join(', ')}.` : '';
    res.redirect('/border-management?message=' + encodeURIComponent(`Border ZIP uploaded successfully. Sizes: ${uploadedSizes}.${ignoredNote}`));
  } catch (error) {
    cleanupUploadedFiles(req);
    res.redirect('/border-management?error=' + encodeURIComponent(error.message));
  }
};

exports.update = async (req, res) => {
  try {
    const border = await Border.findById(req.params.id);
    if (!border) throw new Error('Border not found.');
    const category = categoryKey(req.body.category) || border.category;
    if (!(await BorderCategory.exists({ name: category, active: true }))) throw new Error('Please select a valid active category.');

    border.name = String(req.body.name || border.name).trim();
    border.category = category;
    border.accessLevel = normaliseAccessLevel(req.body.accessLevel, border.isVip);
    border.isVip = border.accessLevel !== 'free';
    border.sortOrder = Number(req.body.sortOrder || 0);
    border.active = req.body.active === 'true' || req.body.active === 'on';

    const existing = mapToObject(border.variants);
    let ignored = [];
    if (req.file) {
      const zipResult = await extractZipVariants(req);
      ignored = zipResult.ignored;
      for (const [size, url] of Object.entries(zipResult.variants)) {
        if (existing[size]) removeLocalAsset(existing[size]);
        existing[size] = url;
      }
    }
    border.variants = existing;
    border.previewUrl = existing['50x25'] || firstVariant(existing) || border.previewUrl;
    border.thumbnailUrl = border.previewUrl;
    border.imageUrl = firstVariant(existing) || border.imageUrl;
    await border.save();
    const ignoredNote = ignored.length ? ` Ignored: ${ignored.join(', ')}.` : '';
    res.redirect('/border-management?message=' + encodeURIComponent(`Border design updated successfully.${ignoredNote}`));
  } catch (error) {
    cleanupUploadedFiles(req);
    res.redirect('/border-management?error=' + encodeURIComponent(error.message));
  }
};

exports.remove = async (req, res) => {
  try {
    const border = await Border.findByIdAndDelete(req.params.id);
    if (border) {
      const urls = new Set(Object.values(mapToObject(border.variants)));
      urls.add(border.imageUrl); urls.add(border.previewUrl); urls.add(border.thumbnailUrl);
      urls.forEach(removeLocalAsset);
    }
    res.redirect('/border-management?message=' + encodeURIComponent('Border deleted.'));
  } catch (error) {
    res.redirect('/border-management?error=' + encodeURIComponent(error.message));
  }
};

exports.toggle = async (req, res) => {
  try {
    const border = await Border.findById(req.params.id);
    if (border) { border.active = !border.active; await border.save(); }
    res.redirect('/border-management?message=' + encodeURIComponent('Border status updated.'));
  } catch (error) {
    res.redirect('/border-management?error=' + encodeURIComponent(error.message));
  }
};

exports.createCategory = async (req, res) => {
  try {
    const name = categoryKey(req.body.name);
    const label = String(req.body.label || req.body.name || '').trim();
    if (!name || !label) throw new Error('Category name is required.');
    await BorderCategory.create({
      name,
      label,
      sortOrder: Number(req.body.sortOrder || 0),
      active: true
    });
    res.redirect('/border-management?message=' + encodeURIComponent('Category added successfully.'));
  } catch (error) {
    const message = error && error.code === 11000 ? 'This category already exists.' : error.message;
    res.redirect('/border-management?error=' + encodeURIComponent(message));
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const category = await BorderCategory.findById(req.params.id);
    if (!category) throw new Error('Category not found.');
    const oldName = category.name;
    const newName = categoryKey(req.body.name) || oldName;
    category.name = newName;
    category.label = String(req.body.label || category.label).trim();
    category.sortOrder = Number(req.body.sortOrder || 0);
    category.active = req.body.active === 'true' || req.body.active === 'on';
    await category.save();
    if (oldName !== newName) await Border.updateMany({ category: oldName }, { $set: { category: newName } });
    res.redirect('/border-management?message=' + encodeURIComponent('Category updated successfully.'));
  } catch (error) {
    const message = error && error.code === 11000 ? 'This category already exists.' : error.message;
    res.redirect('/border-management?error=' + encodeURIComponent(message));
  }
};

exports.removeCategory = async (req, res) => {
  try {
    const category = await BorderCategory.findById(req.params.id);
    if (!category) throw new Error('Category not found.');
    const used = await Border.countDocuments({ category: category.name });
    if (used > 0) throw new Error(`Move or delete the ${used} border(s) in this category before deleting it.`);
    await category.deleteOne();
    res.redirect('/border-management?message=' + encodeURIComponent('Category deleted.'));
  } catch (error) {
    res.redirect('/border-management?error=' + encodeURIComponent(error.message));
  }
};
