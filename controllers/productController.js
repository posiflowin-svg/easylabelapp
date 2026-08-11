const Product = require('../models/Product');
const ShopSettings = require('../models/ShopSettings');
const ShopCategory = require('../models/ShopCategory');
const ShopBanner = require('../models/ShopBanner');
const ProductMedia = require('../models/ProductMedia');
const ErrorResponse = require('../utils/errorResponse');

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 'on';
}

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  let base = configured || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
  if (base.startsWith('http://') && base.includes('.onrender.com')) {
    base = `https://${base.substring('http://'.length)}`;
  }
  return base;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);
}

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
    bulletPoints: normalizeStringArray(body.bulletPoints),
    aPlusImages: normalizeStringArray(body.aPlusImages),
    aPlusTexts: normalizeStringArray(body.aPlusTexts),
    productVideoUrl: String(body.productVideoUrl || '').trim(),
    badge: String(body.badge || '').trim(),
    stock: body.stock === '' || body.stock === undefined ? -1 : Number(body.stock),
    active: boolValue(body.active, true),
    featured: boolValue(body.featured, false),
    sortOrder: Number(body.sortOrder || 0)
  };
}

function productMediaUrl(req, media) {
  const base = publicBaseUrl(req);
  const version = media.updatedAt ? new Date(media.updatedAt).getTime() : Date.now();
  return `${base}/api/products/media/${media._id}?v=${version}`;
}

async function decorateProductsWithUploadedMedia(products, req) {
  const plain = products.map(item => item && typeof item.toObject === 'function' ? item.toObject() : { ...item });
  const ids = plain.map(item => item._id).filter(Boolean);
  if (!ids.length) return plain;

  const media = await ProductMedia.find({ productId: { $in: ids } })
    .select('-data')
    .sort({ kind: 1, sortOrder: 1, createdAt: 1 })
    .lean();

  const byProduct = new Map();
  media.forEach(item => {
    const key = String(item.productId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(item);
  });

  plain.forEach(product => {
    const items = byProduct.get(String(product._id)) || [];
    const productImages = items.filter(x => x.kind === 'product_image').map(x => productMediaUrl(req, x));
    const aPlusImages = items.filter(x => x.kind === 'aplus_image').map(x => productMediaUrl(req, x));
    const video = items.find(x => x.kind === 'video');

    product.images = [...productImages, ...(Array.isArray(product.images) ? product.images : [])].filter(Boolean);
    product.aPlusImages = [...aPlusImages, ...(Array.isArray(product.aPlusImages) ? product.aPlusImages : [])].filter(Boolean);
    if (video) product.productVideoUrl = productMediaUrl(req, video);
  });

  return plain;
}

async function saveUploadedProductMedia(productId, files = {}) {
  const tasks = [];

  (files.productImages || []).forEach((file, index) => {
    tasks.push(ProductMedia.create({
      productId, kind: 'product_image', sortOrder: index,
      originalName: file.originalname || '', contentType: file.mimetype, data: file.buffer
    }));
  });

  (files.aPlusImages || []).forEach((file, index) => {
    tasks.push(ProductMedia.create({
      productId, kind: 'aplus_image', sortOrder: index,
      originalName: file.originalname || '', contentType: file.mimetype, data: file.buffer
    }));
  });

  if ((files.productVideo || []).length) {
    await ProductMedia.deleteMany({ productId, kind: 'video' });
    const file = files.productVideo[0];
    tasks.push(ProductMedia.create({
      productId, kind: 'video', sortOrder: 0,
      originalName: file.originalname || '', contentType: file.mimetype, data: file.buffer
    }));
  }

  if (tasks.length) await Promise.all(tasks);
}

function publicCategory(category, req) {
  const base = publicBaseUrl(req);
  const hasStored = Boolean(category.imageContentType);
  const version = category.updatedAt ? new Date(category.updatedAt).getTime() : Date.now();
  return {
    _id: category._id,
    name: category.name,
    sortOrder: Number(category.sortOrder || 0),
    active: category.active !== false,
    imageUrl: hasStored
      ? `${base}/api/products/categories/${category._id}/image?v=${version}`
      : String(category.imageUrl || '')
  };
}

function publicBanner(banner, req) {
  const base = publicBaseUrl(req);
  const hasStored = Boolean(banner.imageContentType);
  const version = banner.updatedAt ? new Date(banner.updatedAt).getTime() : Date.now();
  return {
    _id: banner._id,
    title: banner.title || '',
    subtitle: banner.subtitle || '',
    badge: banner.badge || 'EasyLabel Shop',
    sortOrder: Number(banner.sortOrder || 0),
    active: banner.active !== false,
    clickUrl: banner.clickUrl || '',
    imageUrl: hasStored
      ? `${base}/api/products/banners/${banner._id}/image?v=${version}`
      : String(banner.imageUrl || '')
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
    const decorated = await decorateProductsWithUploadedMedia(products, req);
    res.status(200).json({ success: true, count: decorated.length, data: decorated });
  } catch (err) { next(err); }
};

exports.getStorefront = async (req, res, next) => {
  try {
    const [settingsDoc, products, categoryDocs, banners] = await Promise.all([
      ShopSettings.findOne({ key: 'default' }).lean(),
      Product.find({
        $or: [
          { active: true },
          { active: { $exists: false } }
        ]
      }).sort({ featured: -1, sortOrder: 1, createdAt: -1 }).lean(),
      ShopCategory.find({ active: true }).sort({ sortOrder: 1, name: 1 }).select('+imageContentType').lean(),
      ShopBanner.find({ active: true }).sort({ sortOrder: 1, createdAt: -1 }).select('+imageContentType').lean()
    ]);

    const settings = settingsDoc || {
      enabled: true,
      heroTitle: 'Premium Printing Made Easy',
      heroSubtitle: 'Best Quality • Best Price • Fast Delivery',
      heroBadge: 'EasyLabel Shop',
      heroImageUrl: '',
      shippingText: 'Fast dispatch • Secure payments • Easy support',
      supportText: 'Need help choosing? Contact our sales team.',
      sliderIntervalMs: 4500
    };

    let categories = categoryDocs.map(item => publicCategory(item, req));

    // Backward-compatible fallback until categories are explicitly managed.
    if (!categories.length) {
      const map = new Map();
      for (const product of products) {
        const name = product?.category?.name || 'Other';
        if (!map.has(name)) {
          map.set(name, {
            name,
            imageUrl: product?.category?.imageUrl || '',
            sortOrder: 0,
            active: true
          });
        }
      }
      categories = Array.from(map.values());
    }

    const decoratedProducts = await decorateProductsWithUploadedMedia(products, req);
    res.json({
      success: true,
      settings,
      banners: banners.map(item => publicBanner(item, req)),
      categories,
      count: decoratedProducts.length,
      data: decoratedProducts
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
      enabled: boolValue(req.body.enabled, true),
      heroTitle: String(req.body.heroTitle || '').trim(),
      heroSubtitle: String(req.body.heroSubtitle || '').trim(),
      heroBadge: String(req.body.heroBadge || '').trim(),
      heroImageUrl: String(req.body.heroImageUrl || '').trim(),
      shippingText: String(req.body.shippingText || '').trim(),
      supportText: String(req.body.supportText || '').trim(),
      sliderIntervalMs: Math.max(2000, Math.min(15000, Number(req.body.sliderIntervalMs || 4500)))
    };
    const settings = await ShopSettings.findOneAndUpdate(
      { key: 'default' }, { $set: data },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
};

exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    const decorated = await decorateProductsWithUploadedMedia([product], req);
    res.status(200).json({ success: true, data: decorated[0] });
  } catch (err) { next(err); }
};

exports.createProduct = async (req, res, next) => {
  try {
    const payload = normalizeProductPayload(req.body);
    const uploadedImages = req.files?.productImages || [];
    if (!payload.name) return res.status(400).json({ success: false, message: 'Product name is required' });
    if (!payload.category.name) return res.status(400).json({ success: false, message: 'Category is required' });
    if (!payload.images.length && !uploadedImages.length) {
      return res.status(400).json({ success: false, message: 'Upload at least one product image or add an image URL' });
    }

    const product = await Product.create(payload);
    await saveUploadedProductMedia(product._id, req.files || {});
    const decorated = await decorateProductsWithUploadedMedia([product], req);
    res.status(201).json({ success: true, data: decorated[0] });
  } catch (err) { next(err); }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, normalizeProductPayload(req.body), {
      new: true, runValidators: true
    });
    if (!product) return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    await saveUploadedProductMedia(product._id, req.files || {});
    const decorated = await decorateProductsWithUploadedMedia([product], req);
    res.status(200).json({ success: true, data: decorated[0] });
  } catch (err) { next(err); }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    await ProductMedia.deleteMany({ productId: product._id });
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
    const categories = await ShopCategory.find({ active: true })
      .sort({ sortOrder: 1, name: 1 }).select('+imageContentType').lean();
    if (categories.length) {
      return res.status(200).json({
        success: true,
        count: categories.length,
        data: categories.map(item => publicCategory(item, req))
      });
    }

    const legacy = await Product.aggregate([
      { $match: { $or: [{ active: true }, { active: { $exists: false } }] } },
      { $group: { _id: '$category.name', imageUrl: { $first: '$category.imageUrl' }, count: { $sum: 1 } } },
      { $project: { _id: 0, name: '$_id', imageUrl: 1, count: 1, sortOrder: { $literal: 0 } } },
      { $sort: { name: 1 } }
    ]);
    res.status(200).json({ success: true, count: legacy.length, data: legacy });
  } catch (err) { next(err); }
};

// ---------- Category management ----------
exports.createCategory = async (req, res) => {
  try {
    const data = {
      name: String(req.body.name || '').trim(),
      sortOrder: Number(req.body.sortOrder || 0),
      active: boolValue(req.body.active, true),
      imageUrl: String(req.body.imageUrl || '').trim()
    };
    if (!data.name) return res.status(400).json({ success: false, message: 'Category name is required.' });
    if (req.file) {
      data.imageData = req.file.buffer;
      data.imageContentType = req.file.mimetype;
      data.imageUrl = '';
    }
    const item = await ShopCategory.create(data);
    res.json({ success: true, data: publicCategory(item, req) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.code === 11000 ? 'Category already exists.' : error.message });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const item = await ShopCategory.findById(req.params.id).select('+imageData +imageContentType');
    if (!item) return res.status(404).json({ success: false, message: 'Category not found.' });

    item.name = String(req.body.name || item.name).trim();
    item.sortOrder = Number(req.body.sortOrder ?? item.sortOrder ?? 0);
    item.active = boolValue(req.body.active, item.active !== false);
    if (req.body.imageUrl !== undefined) item.imageUrl = String(req.body.imageUrl || '').trim();
    if (req.file) {
      item.imageData = req.file.buffer;
      item.imageContentType = req.file.mimetype;
      item.imageUrl = '';
    }
    await item.save();
    res.json({ success: true, data: publicCategory(item, req) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const item = await ShopCategory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Category not found.' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getCategoryImage = async (req, res) => {
  try {
    const item = await ShopCategory.findById(req.params.id).select('+imageData +imageContentType');
    if (!item || !item.imageData) return res.status(404).send('Category image not found');
    res.set('Content-Type', item.imageContentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(item.imageData);
  } catch (_) {
    res.status(404).send('Category image not found');
  }
};

// ---------- Slider management ----------
exports.createShopBanner = async (req, res) => {
  try {
    const data = {
      title: String(req.body.title || '').trim(),
      subtitle: String(req.body.subtitle || '').trim(),
      badge: String(req.body.badge || 'EasyLabel Shop').trim(),
      sortOrder: Number(req.body.sortOrder || 0),
      active: boolValue(req.body.active, true),
      clickUrl: String(req.body.clickUrl || '').trim(),
      imageUrl: String(req.body.imageUrl || '').trim()
    };
    if (req.file) {
      data.imageData = req.file.buffer;
      data.imageContentType = req.file.mimetype;
      data.imageUrl = '';
    }
    if (!req.file && !data.imageUrl && !data.title) {
      return res.status(400).json({ success: false, message: 'Add an image or banner title.' });
    }
    const item = await ShopBanner.create(data);
    res.json({ success: true, data: publicBanner(item, req) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateShopBanner = async (req, res) => {
  try {
    const item = await ShopBanner.findById(req.params.id).select('+imageData +imageContentType');
    if (!item) return res.status(404).json({ success: false, message: 'Slider banner not found.' });

    item.title = String(req.body.title ?? item.title ?? '').trim();
    item.subtitle = String(req.body.subtitle ?? item.subtitle ?? '').trim();
    item.badge = String(req.body.badge ?? item.badge ?? 'EasyLabel Shop').trim();
    item.sortOrder = Number(req.body.sortOrder ?? item.sortOrder ?? 0);
    item.active = boolValue(req.body.active, item.active !== false);
    item.clickUrl = String(req.body.clickUrl ?? item.clickUrl ?? '').trim();
    if (req.body.imageUrl !== undefined) item.imageUrl = String(req.body.imageUrl || '').trim();
    if (req.file) {
      item.imageData = req.file.buffer;
      item.imageContentType = req.file.mimetype;
      item.imageUrl = '';
    }
    await item.save();
    res.json({ success: true, data: publicBanner(item, req) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteShopBanner = async (req, res) => {
  try {
    const item = await ShopBanner.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Slider banner not found.' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getShopBannerImage = async (req, res) => {
  try {
    const item = await ShopBanner.findById(req.params.id).select('+imageData +imageContentType');
    if (!item || !item.imageData) return res.status(404).send('Banner image not found');
    res.set('Content-Type', item.imageContentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(item.imageData);
  } catch (_) {
    res.status(404).send('Banner image not found');
  }
};

exports.page = async (req, res) => {
  try {
    const [products, settings, categories, banners] = await Promise.all([
      Product.find().sort({ featured: -1, sortOrder: 1, createdAt: -1 }).lean(),
      ShopSettings.findOne({ key: 'default' }).lean(),
      ShopCategory.find().sort({ sortOrder: 1, name: 1 }).select('+imageContentType').lean(),
      ShopBanner.find().sort({ sortOrder: 1, createdAt: -1 }).select('+imageContentType').lean()
    ]);
    res.render('shop-management', {
      products,
      settings: settings || {},
      categories: categories.map(item => publicCategory(item, req)),
      banners: banners.map(item => publicBanner(item, req))
    });
  } catch (error) {
    res.status(500).send(error.message);
  }
};

exports.getProductMedia = async (req, res) => {
  try {
    const media = await ProductMedia.findById(req.params.id).select('+data');
    if (!media || !media.data) return res.status(404).send('Product media not found');
    res.set('Content-Type', media.contentType || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Accept-Ranges', 'bytes');
    res.send(media.data);
  } catch (_) {
    res.status(404).send('Product media not found');
  }
};
