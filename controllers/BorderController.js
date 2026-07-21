const Border = require('../models/Border');

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

exports.list = async (req, res) => {
  try {
    const query = { active: true };
    const category = String(req.query.category || '').toLowerCase();
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

exports.page = async (req, res) => {
  const borders = await Border.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  res.render('borders', {
    borders: borders.map((border) => ({
      ...border,
      accessLevel: normaliseAccessLevel(border.accessLevel, border.isVip)
    }))
  });
};

exports.create = async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('SVG/PNG/JPG border file required');
    const base = publicBaseUrl(req);
    const imageUrl = `${base}/border-assets/${req.file.filename}`;
    const accessLevel = normaliseAccessLevel(req.body.accessLevel, req.body.isVip === 'on');
    await Border.create({
      name: req.body.name || req.file.originalname,
      category: String(req.body.category || 'new').toLowerCase(),
      accessLevel,
      isVip: accessLevel !== 'free',
      sortOrder: Number(req.body.sortOrder || 0),
      imageUrl,
      thumbnailUrl: imageUrl,
      active: true
    });
    res.redirect('/border-management');
  } catch (error) {
    res.status(500).send(error.message);
  }
};

exports.remove = async (req, res) => {
  await Border.findByIdAndDelete(req.params.id);
  res.redirect('/border-management');
};

exports.toggle = async (req, res) => {
  const border = await Border.findById(req.params.id);
  if (border) {
    border.active = !border.active;
    await border.save();
  }
  res.redirect('/border-management');
};
