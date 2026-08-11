const Product = require('../models/Product');
const ShopSettings = require('../models/ShopSettings');
const ErrorResponse = require('../utils/errorResponse');

function normalizeProductPayload(body = {}) {
  const images = Array.isArray(body.images)
    ? body.images.map(v => String(v || '').trim()).filter(Boolean)
    : String(body.images || '').split(/\r?\n|,/).map(v => v.trim()).filter(Boolean);

  const category = body.category && typeof body.category === 'object'
    ? body.category
    : { name: body.categoryName || body.category || '', imageUrl: body.categoryImageUrl || '' };

  return {
    name: String(body.name || '').trim(),
    sku: String(body.sku || '').trim(),
    price: Number(body.price || 0),
    mrp: Number(body.mrp || 0),
    images,
    category: {
      name: String(category.name || '').trim(),
      imageUrl: String(category.imageUrl || '').trim()
    },
    description: String(body.description || '').trim(),
    badge: String(body.badge || '').trim(),
    stock: body.stock === '' || body.stock === undefined ? -1 : Number(body.stock),
    active: body.active === true || body.active === 'true',
    featured: body.featured === true || body.featured === 'true',
    sortOrder: Number(body.sortOrder || 0)
  };
}

exports.getAllProducts = async (req, res, next) => {
  try {
    const query = {};
    if (req.query.active === 'true') query.active = true;
    if (req.query.category) query['category.name'] = req.query.category;
    if (req.query.featured === 'true') query.featured = true;
    if (req.query.q) {
      const q = String(req.query.q).trim();
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { sku: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { 'category.name': { $regex: q, $options: 'i' } }
      ];
    }

    const products = await Product.find(query).sort({ featured: -1, sortOrder: 1, createdAt: -1 });
    res.status(200).json({ success: true, count: products.length, data: products });
  } catch (err) { next(err); }
};

exports.getStorefront = async (req, res, next) => {
  try {
    const [settingsDoc, products] = await Promise.all([
      ShopSettings.findOne({ key: 'default' }).lean(),
      Product.find({ active: true }).sort({ featured: -1, sortOrder: 1, createdAt: -1 }).lean()
    ]);

    const settings = settingsDoc || {
      enabled: true,
      heroTitle: 'Everything your business needs',
      heroSubtitle: 'Printers, labels, scanners and POS hardware — delivered to your door.',
      heroBadge: 'EasyLabel Shop',
      heroImageUrl: '',
      shippingText: 'Fast dispatch • Secure payments • Easy support',
      supportText: 'Need help choosing? Contact our sales team.'
    };

    const map = new Map();
    for (const product of products) {
      const name = product?.category?.name || 'Other';
      if (!map.has(name)) {
        map.set(name, { name, imageUrl: product?.category?.imageUrl || '' });
      }
    }

    res.json({
      success: true,
      settings,
      categories: Array.from(map.values()),
      count: products.length,
      data: products
    });
  } catch (err) { next(err); }
};

exports.getShopSettings = async (req, res, next) => {
  try {
    const settings = await ShopSettings.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: { key: 'default' } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
};

exports.updateShopSettings = async (req, res, next) => {
  try {
    const data = {
      enabled: req.body.enabled === true || req.body.enabled === 'true',
      heroTitle: String(req.body.heroTitle || '').trim(),
      heroSubtitle: String(req.body.heroSubtitle || '').trim(),
      heroBadge: String(req.body.heroBadge || '').trim(),
      heroImageUrl: String(req.body.heroImageUrl || '').trim(),
      shippingText: String(req.body.shippingText || '').trim(),
      supportText: String(req.body.supportText || '').trim()
    };
    const settings = await ShopSettings.findOneAndUpdate(
      { key: 'default' }, { $set: data }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
};

exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    res.status(200).json({ success: true, data: product });
  } catch (err) { next(err); }
};

exports.createProduct = async (req, res, next) => {
  try {
    const payload = normalizeProductPayload(req.body);
    if (!payload.name) return res.status(400).json({ success: false, message: 'Product name is required' });
    if (!payload.category.name) return res.status(400).json({ success: false, message: 'Category is required' });
    if (!payload.images.length) return res.status(400).json({ success: false, message: 'At least one image URL is required' });
    const product = await Product.create(payload);
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, normalizeProductPayload(req.body), {
      new: true, runValidators: true
    });
    if (!product) return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    res.status(200).json({ success: true, data: product });
  } catch (err) { next(err); }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    res.status(200).json({ success: true, data: {} });
  } catch (err) { next(err); }
};

exports.getProductsByCategory = async (req, res, next) => {
  try {
    const products = await Product.find({ 'category.name': req.params.category, active: true })
      .sort({ featured: -1, sortOrder: 1, createdAt: -1 });
    res.status(200).json({ success: true, count: products.length, data: products });
  } catch (err) { next(err); }
};

exports.getAllCategories = async (req, res, next) => {
  try {
    const categories = await Product.aggregate([
      { $match: { active: true } },
      { $group: { _id: '$category.name', imageUrl: { $first: '$category.imageUrl' }, count: { $sum: 1 } } },
      { $project: { _id: 0, name: '$_id', imageUrl: 1, count: 1 } },
      { $sort: { name: 1 } }
    ]);
    res.status(200).json({ success: true, count: categories.length, data: categories });
  } catch (err) { next(err); }
};

exports.page = async (req, res) => {
  try {
    const [products, settings] = await Promise.all([
      Product.find().sort({ featured: -1, sortOrder: 1, createdAt: -1 }).lean(),
      ShopSettings.findOne({ key: 'default' }).lean()
    ]);
    res.render('shop-management', { products, settings: settings || {} });
  } catch (error) {
    res.status(500).send(error.message);
  }
};
