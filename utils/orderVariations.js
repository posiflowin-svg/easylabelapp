'use strict';
const Product = require('../models/Product');
const mongoose = require('mongoose');

// Preserve fields already provided by Android. Do not invent a selection.
function preserveOrderVariations(items) {
  return items.map(item => {
    const variant = item.variant && typeof item.variant === 'object' ? item.variant : {};
    const variation = item.variation && typeof item.variation === 'object' ? item.variation : {};
    const source = {...variation, ...variant};
    const out = {...item};
    const id = item.variantId || item.variationId || source.id || source._id;
    const name = item.variantName || item.variationName || source.name || source.title;
    const sku = item.variantSku || item.variationSku || source.sku;
    const attrs = item.variantAttributes || item.variationAttributes || source.attributes;
    if (id) out.variantId = String(id);
    if (name) out.variantName = String(name);
    if (sku) out.variantSku = String(sku);
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) out.variantAttributes = attrs;
    return out;
  });
}

// Display-only legacy recovery. Only infer a variant from an exact unique
// catalog match. Never change order price, quantity, payment or stored records.
async function enrichOrderVariations(orders) {
  const items = (orders || []).flatMap(o => o.products || []);
  const ids = [...new Set(items.map(i => String(i.productId?._id || i.productId || ''))
    .filter(id => mongoose.isValidObjectId(id)))];
  if (!ids.length) return;
  const products = await Product.find({_id:{$in:ids}}, 'variants').lean();
  const byId = new Map(products.map(p => [String(p._id),p]));
  for (const item of items) {
    if (item.variantName || item.variantSku || item.variantId) continue;
    const product = byId.get(String(item.productId?._id || item.productId || ''));
    if (!product || !Array.isArray(product.variants)) continue;
    const variants = product.variants.filter(v => v.active !== false);
    const matches = variants.filter(v => Math.abs(Number(v.price) - Number(item.price)) < 0.005);
    if (matches.length !== 1) continue;
    const v = matches[0];
    item.variantName = v.name;
    item.variantSku = v.sku;
    item.variantAttributes = v.attributes || {};
  }
}
module.exports = {preserveOrderVariations, enrichOrderVariations};
