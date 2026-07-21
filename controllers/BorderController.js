const fs = require('fs');
const path = require('path');
const Border = require('../models/Border');
const BorderCategory = require('../models/BorderCategory');

const DEFAULT_CATEGORIES = ['new', 'hot', 'fancy', 'plant', 'holiday', 'animal'];

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
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

async function ensureDefaultCategories() {
  const count = await BorderCategory.countDocuments();
  if (count > 0) return;
  await BorderCategory.insertMany(DEFAULT_CATEGORIES.map((name, index) => ({
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    sortOrder: index,
    active: true
  })), { ordered: false }).catch(() => {});
}

exports.list = async (req, res) => {
  try {
    const query = { active: true };
    const category = categoryKey(req.query.category);
    if (category && category !== 'all') {
      if (category === 'vip') {
        query.$or = [
          { accessLevel: { $in: ['premium', 'business'] } },
          { isVip: true }
        ];
      } else {
        query.category = category;
      }
    }

    const borders = await Border.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const output = borders.map((border) => ({
      ...border,
      accessLevel: normaliseAccessLevel(border.accessLevel, border.isVip),
      isVip: normaliseAccessLevel(border.accessLevel, border.isVip) !== 'free'
    }));
    res.json({ success: true, borders: output });
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
    message: req.query.message || '',
    error: req.query.error || '',
    categories,
    borders: borders.map((border) => ({
      ...border,
      accessLevel: normaliseAccessLevel(border.accessLevel, border.isVip)
    }))
  });
};

exports.create = async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('SVG/PNG/JPG border file required');
    const category = categoryKey(req.body.category) || 'new';
    const exists = await BorderCategory.exists({ name: category, active: true });
    if (!exists) {
      removeLocalAsset(`${publicBaseUrl(req)}/border-assets/${req.file.filename}`);
      return res.redirect('/border-management?error=' + encodeURIComponent('Please select a valid active category.'));
    }
    const base = publicBaseUrl(req);
    const imageUrl = `${base}/border-assets/${req.file.filename}`;
    const accessLevel = normaliseAccessLevel(req.body.accessLevel, req.body.isVip === 'on');
    await Border.create({
      name: String(req.body.name || req.file.originalname).trim(),
      category,
      accessLevel,
      isVip: accessLevel !== 'free',
      sortOrder: Number(req.body.sortOrder || 0),
      imageUrl,
      thumbnailUrl: imageUrl,
      active: true
    });
    res.redirect('/border-management?message=' + encodeURIComponent('Border uploaded successfully.'));
  } catch (error) {
    if (req.file) removeLocalAsset(`${publicBaseUrl(req)}/border-assets/${req.file.filename}`);
    res.redirect('/border-management?error=' + encodeURIComponent(error.message));
  }
};

exports.update = async (req, res) => {
  try {
    const border = await Border.findById(req.params.id);
    if (!border) return res.redirect('/border-management?error=' + encodeURIComponent('Border not found.'));

    const category = categoryKey(req.body.category) || border.category;
    const exists = await BorderCategory.exists({ name: category, active: true });
    if (!exists) {
      if (req.file) removeLocalAsset(`${publicBaseUrl(req)}/border-assets/${req.file.filename}`);
      return res.redirect('/border-management?error=' + encodeURIComponent('Please select a valid active category.'));
    }

    border.name = String(req.body.name || border.name).trim();
    border.category = category;
    border.accessLevel = normaliseAccessLevel(req.body.accessLevel, border.isVip);
    border.isVip = border.accessLevel !== 'free';
    border.sortOrder = Number(req.body.sortOrder || 0);
    border.active = req.body.active === 'true' || req.body.active === 'on';

    if (req.file) {
      const oldUrl = border.imageUrl;
      const imageUrl = `${publicBaseUrl(req)}/border-assets/${req.file.filename}`;
      border.imageUrl = imageUrl;
      border.thumbnailUrl = imageUrl;
      removeLocalAsset(oldUrl);
    }

    await border.save();
    res.redirect('/border-management?message=' + encodeURIComponent('Border updated successfully.'));
  } catch (error) {
    if (req.file) removeLocalAsset(`${publicBaseUrl(req)}/border-assets/${req.file.filename}`);
    res.redirect('/border-management?error=' + encodeURIComponent(error.message));
  }
};

exports.remove = async (req, res) => {
  try {
    const border = await Border.findByIdAndDelete(req.params.id);
    if (border) removeLocalAsset(border.imageUrl);
    res.redirect('/border-management?message=' + encodeURIComponent('Border deleted.'));
  } catch (error) {
    res.redirect('/border-management?error=' + encodeURIComponent(error.message));
  }
};

exports.toggle = async (req, res) => {
  try {
    const border = await Border.findById(req.params.id);
    if (border) {
      border.active = !border.active;
      await border.save();
    }
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
