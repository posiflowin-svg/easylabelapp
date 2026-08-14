const Product = require('../models/Product');
const ShopSettings = require('../models/ShopSettings');
const ShopCategory = require('../models/ShopCategory');
const ShopBanner = require('../models/ShopBanner');
const ProductMedia = require('../models/ProductMedia');
const ErrorResponse = require('../utils/errorResponse');
const fs = require('fs');

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

    // Keep URL-entered media separate from uploaded media so the admin edit form
    // does not copy generated /api/products/media URLs back into URL textareas.
    product.externalImages = Array.isArray(product.images) ? [...product.images] : [];
    product.externalAPlusImages = Array.isArray(product.aPlusImages) ? [...product.aPlusImages] : [];

    product.images = [...productImages, ...product.externalImages].filter(Boolean);
    product.aPlusImages = [...aPlusImages, ...product.externalAPlusImages].filter(Boolean);

    product.uploadedMedia = items
      .filter(x => x.kind === 'product_image')
      .map(x => ({
        _id: x._id,
        kind: x.kind,
        sortOrder: Number(x.sortOrder || 0),
        originalName: x.originalName || '',
        url: productMediaUrl(req, x)
      }));

    product.uploadedAPlusMedia = items
      .filter(x => x.kind === 'aplus_image')
      .map(x => ({
        _id: x._id,
        kind: x.kind,
        sortOrder: Number(x.sortOrder || 0),
        originalName: x.originalName || '',
        url: productMediaUrl(req, x)
      }));

    if (video) product.productVideoUrl = productMediaUrl(req, video);
  });

  return plain;
}

async function fileBuffer(file) {
  if (file && Buffer.isBuffer(file.buffer)) return file.buffer;
  if (file && file.path) return fs.promises.readFile(file.path);
  throw new Error(`Uploaded file data is unavailable: ${file?.originalname || 'unknown file'}`);
}

async function removeTempUpload(file) {
  if (!file || !file.path) return;
  try { await fs.promises.unlink(file.path); } catch (_) {}
}

async function nextMediaSortOrder(productId, kind) {
  const last = await ProductMedia.findOne({ productId, kind })
    .sort({ sortOrder: -1 })
    .select('sortOrder')
    .lean();
  return last ? Number(last.sortOrder || 0) + 1 : 0;
}

async function saveMediaFilesSequentially(productId, kind, files, startOrder) {
  let sortOrder = startOrder;

  for (const file of files) {
    try {
      const data = await fileBuffer(file);

      // One Mongo document is limited to ~16 MB. Multer already limits each
      // upload to 15 MB; keep an explicit guard so the admin gets a useful error.
      if (data.length > 15 * 1024 * 1024) {
        throw new Error(`${file.originalname || 'File'} is larger than 15 MB.`);
      }

      await ProductMedia.create({
        productId,
        kind,
        sortOrder,
        originalName: file.originalname || '',
        contentType: file.mimetype || 'application/octet-stream',
        data
      });

      sortOrder += 1;
    } finally {
      // Release both disk space and the single in-memory buffer before moving
      // to the next file. This avoids the previous Render memory spike.
      await removeTempUpload(file);
    }
  }
}

async function saveUploadedProductMedia(productId, files = {}) {
  const productImageFiles = [
    ...(files.productImageFiles || []),
    ...(files.productImages || [])
  ];

  const aPlusImageFiles = [
    ...(files.aPlusImageFiles || []),
    ...(files.aPlusImages || [])
  ];

  const videoFiles = [
    ...(files.productVideoFile || []),
    ...(files.productVideo || [])
  ];

  // IMPORTANT: process sequentially. The previous Promise.all() held several
  // large Mongo write buffers at the same time and could exhaust Render memory.
  if (productImageFiles.length) {
    const startOrder = await nextMediaSortOrder(productId, 'product_image');
    await saveMediaFilesSequentially(
      productId, 'product_image', productImageFiles, startOrder
    );
  }

  if (aPlusImageFiles.length) {
    const startOrder = await nextMediaSortOrder(productId, 'aplus_image');
    await saveMediaFilesSequentially(
      productId, 'aplus_image', aPlusImageFiles, startOrder
    );
  }

  if (videoFiles.length) {
    await ProductMedia.deleteMany({ productId, kind: 'video' });
    await saveMediaFilesSequentially(productId, 'video', [videoFiles[0]], 0);

    // Clean any unexpected extra video temp files defensively.
    for (const extra of videoFiles.slice(1)) await removeTempUpload(extra);
  }
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
  let product = null;
  try {
    const payload = normalizeProductPayload(req.body);
    const uploadedImages = [
      ...(req.files?.productImageFiles || []),
      ...(req.files?.productImages || [])
    ];
    if (!payload.name) return res.status(400).json({ success: false, message: 'Product name is required' });
    if (!payload.category.name) return res.status(400).json({ success: false, message: 'Category is required' });
    if (!payload.images.length && !uploadedImages.length) {
      return res.status(400).json({ success: false, message: 'Upload at least one product image or add an image URL' });
    }

    product = await Product.create(payload);
    await saveUploadedProductMedia(product._id, req.files || {});
    const decorated = await decorateProductsWithUploadedMedia([product], req);
    return res.status(201).json({ success: true, data: decorated[0] });
  } catch (err) {
    console.error('Shop product create/upload failed:', err);

    // Do not leave a half-created empty product if media persistence failed.
    if (product && product._id) {
      try {
        await ProductMedia.deleteMany({ productId: product._id });
        await Product.findByIdAndDelete(product._id);
      } catch (_) {}
    }

    return res.status(500).json({
      success: false,
      message: `Product upload failed: ${err.message || 'Unable to save product media.'}`
    });
  } finally {
    if (typeof req.cleanupProductTempFiles === 'function') {
      try { req.cleanupProductTempFiles(); } catch (_) {}
    }
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, normalizeProductPayload(req.body), {
      new: true, runValidators: true
    });
    if (!product) {
      return res.status(404).json({
        success: false,
        message: `Product not found with id of ${req.params.id}`
      });
    }

    await saveUploadedProductMedia(product._id, req.files || {});
    const decorated = await decorateProductsWithUploadedMedia([product], req);
    return res.status(200).json({ success: true, data: decorated[0] });
  } catch (err) {
    console.error('Shop product update/upload failed:', err);
    return res.status(500).json({
      success: false,
      message: `Product update failed: ${err.message || 'Unable to save product media.'}`
    });
  } finally {
    if (typeof req.cleanupProductTempFiles === 'function') {
      try { req.cleanupProductTempFiles(); } catch (_) {}
    }
  }
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
    const decoratedProducts = await decorateProductsWithUploadedMedia(products, req);

    res.render('shop-management', {
      products: decoratedProducts,
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



async function compactMediaSequence(productId, kind) {
  const remaining = await ProductMedia.find({ productId, kind })
    .sort({ sortOrder: 1, createdAt: 1 })
    .select('_id');

  if (remaining.length) {
    await Promise.all(remaining.map((item, index) =>
      ProductMedia.updateOne({ _id: item._id }, { $set: { sortOrder: index } })
    ));
  }
}

exports.reorderProductImages = async (req, res) => {
  try {
    const productId = req.params.id;
    const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(String) : [];

    const media = await ProductMedia.find({
      productId,
      kind: 'product_image'
    }).select('_id sortOrder');

    const validIds = new Set(media.map(item => String(item._id)));
    const filtered = orderedIds.filter(id => validIds.has(id));

    // Append any uploaded images omitted by the client so no media is lost.
    media.forEach(item => {
      const id = String(item._id);
      if (!filtered.includes(id)) filtered.push(id);
    });

    await Promise.all(filtered.map((id, index) =>
      ProductMedia.findOneAndUpdate(
        { _id: id, productId, kind: 'product_image' },
        { $set: { sortOrder: index } },
        { new: true }
      )
    ));

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const decorated = await decorateProductsWithUploadedMedia([product], req);
    res.json({
      success: true,
      message: 'Product image sequence updated',
      data: decorated[0]
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to update image sequence' });
  }
};

exports.deleteProductImage = async (req, res) => {
  try {
    const { id: productId, mediaId } = req.params;
    const media = await ProductMedia.findOneAndDelete({
      _id: mediaId,
      productId,
      kind: 'product_image'
    });

    if (!media) return res.status(404).json({ success: false, message: 'Uploaded image not found' });

    await compactMediaSequence(productId, 'product_image');

    res.json({ success: true, message: 'Image deleted' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to delete image' });
  }
};


exports.reorderAPlusImages = async (req, res) => {
  try {
    const productId = req.params.id;
    const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(String) : [];

    const media = await ProductMedia.find({ productId, kind: 'aplus_image' })
      .select('_id sortOrder');

    const validIds = new Set(media.map(item => String(item._id)));
    const filtered = orderedIds.filter(id => validIds.has(id));
    media.forEach(item => {
      const id = String(item._id);
      if (!filtered.includes(id)) filtered.push(id);
    });

    await Promise.all(filtered.map((id, index) =>
      ProductMedia.findOneAndUpdate(
        { _id: id, productId, kind: 'aplus_image' },
        { $set: { sortOrder: index } },
        { new: true }
      )
    ));

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const decorated = await decorateProductsWithUploadedMedia([product], req);
    res.json({ success: true, message: 'A+ image sequence updated', data: decorated[0] });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to update A+ image sequence' });
  }
};

exports.deleteAPlusImage = async (req, res) => {
  try {
    const { id: productId, mediaId } = req.params;
    const media = await ProductMedia.findOneAndDelete({
      _id: mediaId,
      productId,
      kind: 'aplus_image'
    });

    if (!media) return res.status(404).json({ success: false, message: 'Uploaded A+ image not found' });

    await compactMediaSequence(productId, 'aplus_image');

    res.json({ success: true, message: 'A+ image deleted' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to delete A+ image' });
  }
};


exports.bulkDeleteProductImages = async (req, res) => {
  try {
    const productId = req.params.id;
    const mediaIds = Array.isArray(req.body.mediaIds)
      ? [...new Set(req.body.mediaIds.map(String).filter(Boolean))]
      : [];

    if (!mediaIds.length) {
      return res.status(400).json({ success: false, message: 'Select at least one product image to delete.' });
    }

    const result = await ProductMedia.deleteMany({
      _id: { $in: mediaIds },
      productId,
      kind: 'product_image'
    });

    await compactMediaSequence(productId, 'product_image');

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    const decorated = await decorateProductsWithUploadedMedia([product], req);
    res.json({
      success: true,
      deletedCount: Number(result.deletedCount || 0),
      message: `${Number(result.deletedCount || 0)} product image(s) deleted`,
      data: decorated[0]
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to delete selected product images.' });
  }
};

exports.bulkDeleteAPlusImages = async (req, res) => {
  try {
    const productId = req.params.id;
    const mediaIds = Array.isArray(req.body.mediaIds)
      ? [...new Set(req.body.mediaIds.map(String).filter(Boolean))]
      : [];

    if (!mediaIds.length) {
      return res.status(400).json({ success: false, message: 'Select at least one A+ image to delete.' });
    }

    const result = await ProductMedia.deleteMany({
      _id: { $in: mediaIds },
      productId,
      kind: 'aplus_image'
    });

    await compactMediaSequence(productId, 'aplus_image');

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    const decorated = await decorateProductsWithUploadedMedia([product], req);
    res.json({
      success: true,
      deletedCount: Number(result.deletedCount || 0),
      message: `${Number(result.deletedCount || 0)} A+ image(s) deleted`,
      data: decorated[0]
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to delete selected A+ images.' });
  }
};


// Reliable Shop Manager media delete endpoint.
// Uses POST so browsers/proxies do not drop DELETE request bodies.
exports.deleteProductMediaSelection = async (req, res) => {
  try {
    const productId = String(req.params.id || '').trim();
    const kind = String(req.body.kind || '').trim();
    const mediaIds = Array.isArray(req.body.mediaIds)
      ? [...new Set(req.body.mediaIds.map(id => String(id || '').trim()).filter(Boolean))]
      : [];

    if (!['product_image', 'aplus_image'].includes(kind)) {
      return res.status(400).json({ success: false, message: 'Invalid image type.' });
    }

    if (!mediaIds.length) {
      return res.status(400).json({ success: false, message: 'Select at least one image to delete.' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const existing = await ProductMedia.find({
      _id: { $in: mediaIds },
      productId,
      kind
    }).select('_id');

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Selected uploaded image(s) were not found.' });
    }

    const validIds = existing.map(item => item._id);
    const result = await ProductMedia.deleteMany({
      _id: { $in: validIds },
      productId,
      kind
    });

    await compactMediaSequence(productId, kind);

    const refreshedProduct = await Product.findById(productId);
    const decorated = await decorateProductsWithUploadedMedia([refreshedProduct], req);

    return res.json({
      success: true,
      deletedCount: Number(result.deletedCount || 0),
      message: `${Number(result.deletedCount || 0)} image(s) deleted successfully`,
      data: decorated[0]
    });
  } catch (error) {
    console.error('Shop Manager image delete failed:', error);
    return res.status(400).json({
      success: false,
      message: error && error.message ? error.message : 'Unable to delete selected image(s).'
    });
  }
};