const fs = require('fs');
const path = require('path');
const Border = require('../models/Border');
const BorderCategory = require('../models/BorderCategory');

const DEFAULT_CATEGORIES = ['new', 'hot', 'fancy', 'plant', 'holiday', 'animal'];
const SUPPORTED_SIZES = [
  '50x25','50x30','50x50','50x12','38x38','38x25','38x15',
  '75x25','75x50','100x50','100x150','100x15'
];

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
    if (!url || !url.includes('/border-assets/')) return;
    const filename = decodeURIComponent(url.split('/border-assets/').pop().split('?')[0]);
    const filePath = path.join(__dirname, '..', 'public', 'border-assets', path.basename(filename));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.warn('Unable to remove old border asset:', error.message);
  }
}

function cleanupUploadedFiles(req) {
  Object.values(req.files || {}).flat().forEach(file => {
    removeLocalAsset(`${publicBaseUrl(req)}/border-assets/${file.filename}`);
  });
}

function uploadedVariants(req) {
  const base = publicBaseUrl(req);
  const result = {};
  for (const size of SUPPORTED_SIZES) {
    const file = req.files && req.files[`border_${size}`] && req.files[`border_${size}`][0];
    if (file) result[size] = `${base}/border-assets/${file.filename}`;
  }
  return result;
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

function serializeBorder(border) {
  const variants = mapToObject(border.variants);
  const previewUrl = border.previewUrl || border.thumbnailUrl || variants['50x25'] || border.imageUrl || firstVariant(variants);
  return {
    ...border,
    variants,
    files: variants,
    previewUrl,
    thumbnailUrl: previewUrl,
    imageUrl: border.imageUrl || firstVariant(variants) || previewUrl,
    accessLevel: normaliseAccessLevel(border.accessLevel, border.isVip),
    isVip: normaliseAccessLevel(border.accessLevel, border.isVip) !== 'free'
  };
}

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
    const variants = uploadedVariants(req);
    if (!Object.keys(variants).length) throw new Error('Select at least one label size and upload its SVG/PNG/JPG file.');

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
    res.redirect('/border-management?message=' + encodeURIComponent('Border design and size files uploaded successfully.'));
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
    const replacements = uploadedVariants(req);
    for (const [size, url] of Object.entries(replacements)) {
      if (existing[size]) removeLocalAsset(existing[size]);
      existing[size] = url;
    }
    border.variants = existing;
    border.previewUrl = existing['50x25'] || firstVariant(existing) || border.previewUrl;
    border.thumbnailUrl = border.previewUrl;
    border.imageUrl = firstVariant(existing) || border.imageUrl;
    await border.save();
    res.redirect('/border-management?message=' + encodeURIComponent('Border design updated successfully.'));
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
