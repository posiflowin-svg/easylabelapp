const IconLibrary = require('../models/IconLibrary');
const ICON_TAXONOMY = require('../config/iconTaxonomy');

async function migrateLegacyCategoryNames() {
  // Keep existing uploaded icons visible after taxonomy renames.
  await IconLibrary.updateMany(
    { mainCategory: 'Fashion, Clothing & Accessories' },
    { $set: { mainCategory: 'Clothing And Accessories' } }
  );

  await IconLibrary.updateMany(
    { mainCategory: 'Manufacturing, Wholesale & Logistics' },
    { $set: { mainCategory: 'Manufacturer and Wholesaler' } }
  );

  // Old logistics-related sub-categories are no longer part of Manufacturer and Wholesaler.
  // Preserve old records but move the main category to Courier/Logistics where possible.
  await IconLibrary.updateMany(
    { name: 'Courier / Logistics Company' },
    { $set: { mainCategory: 'Courier/Logistics', name: 'Logistics Company', slug: slugify('Logistics Company') } }
  );

  await IconLibrary.updateMany(
    { name: 'E-commerce Seller' },
    { $set: { mainCategory: 'Courier/Logistics', name: 'E-commerce Shipping', slug: slugify('E-commerce Shipping') } }
  );
}


function slugify(s){return String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}

function toNodeBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return Buffer.from(value);

  // Mongoose Buffer document can expose the real Buffer through value().
  try {
    if (typeof value.value === 'function') {
      const v = value.value();
      if (v && v !== value) {
        const b = toNodeBuffer(v);
        if (b && b.length) return b;
      }
    }
  } catch (_) {}

  // Node's JSON Buffer shape.
  if (value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  // BSON Binary returned by lean().  Depending on bson/mongoose version the
  // payload can be Buffer, Uint8Array or available via value(true).
  try {
    if (value._bsontype === 'Binary') {
      if (typeof value.value === 'function') {
        const v = value.value(true);
        if (v) return Buffer.from(v);
      }
      if (value.buffer) return Buffer.from(value.buffer);
    }
  } catch (_) {}

  if (value.buffer) {
    try {
      if (Buffer.isBuffer(value.buffer)) return Buffer.from(value.buffer);
      if (ArrayBuffer.isView(value.buffer)) {
        return Buffer.from(value.buffer.buffer, value.buffer.byteOffset, value.buffer.byteLength);
      }
      if (value.buffer instanceof ArrayBuffer) return Buffer.from(value.buffer);
      if (Array.isArray(value.buffer)) return Buffer.from(value.buffer);
    } catch (_) {}
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);

  // Legacy/base64 value fallback.
  if (typeof value === 'string') {
    try {
      const clean = value.replace(/^data:[^;]+;base64,/, '');
      const b = Buffer.from(clean, 'base64');
      if (b.length) return b;
    } catch (_) {}
  }
  return null;
}

function detectImageMime(buffer, suppliedMime) {
  if (!buffer || buffer.length < 4) return suppliedMime || 'application/octet-stream';

  // PNG
  if (buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'image/png';
  }
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // WEBP: RIFF....WEBP
  if (buffer.length >= 12 &&
      buffer.toString('ascii',0,4) === 'RIFF' &&
      buffer.toString('ascii',8,12) === 'WEBP') return 'image/webp';

  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8')
    .replace(/^\uFEFF/, '').trim().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml') || head.includes('<svg')) {
    return 'image/svg+xml';
  }

  return suppliedMime || 'application/octet-stream';
}

exports.page=async(req,res)=>{
  await migrateLegacyCategoryNames();
  const categories=await IconLibrary.find().sort({mainCategory:1,displayOrder:1,name:1}).lean();
  res.render('icon-library',{
    categories,
    taxonomy:ICON_TAXONOMY,
    message:req.query.message||''
  });
};

exports.list=async(req,res)=>{
  const cats=await IconLibrary.find({active:true}).sort({displayOrder:1,name:1}).lean();
  res.set('Cache-Control','no-store, no-cache, must-revalidate');
  res.json({
    success:true,
    categories:cats.map(c=>({
      id:String(c._id),
      name:c.name,
      slug:c.slug,
      mainCategory:c.mainCategory || '',
      subCategory:c.name,
      displayOrder:c.displayOrder,
      icons:(c.icons||[])
        .filter(i=>i.active)
        .sort((a,b)=>(a.displayOrder||0)-(b.displayOrder||0))
        .map(i=>({
          id:String(i._id),
          name:i.name,
          mimeType:i.mimeType || '',
          // Add a deterministic version to avoid stale icon proxies/caches.
          url:`/icon-assets/${c._id}/${i._id}?v=${encodeURIComponent(String(i._id))}`
        }))
    }))
  });
};

exports.asset=async(req,res)=>{
  try {
    /*
     * Use lean() and a positional icon lookup so we send the actual binary bytes,
     * not a Mongoose/BSON wrapper object. Returning the wrapper made Android receive
     * HTTP 200 with non-image bytes, which caused BitmapFactory to return null and
     * "Unsupported icon image".
     */
    const c = await IconLibrary.findOne(
      {_id:req.params.categoryId, active:true}
    ).lean();

    if(!c || !Array.isArray(c.icons)) return res.sendStatus(404);
    const i = c.icons.find(x => x && String(x._id) === String(req.params.iconId) && x.active !== false);
    if(!i) return res.sendStatus(404);
    const buffer = toNodeBuffer(i.data);
    if(!buffer || !buffer.length) {
      console.error('Icon asset has no binary data', req.params.categoryId, req.params.iconId);
      return res.sendStatus(404);
    }

    const mime = detectImageMime(buffer, i.mimeType);
    res.status(200);
    res.set({
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `inline; filename="${String(i.filename || 'icon').replace(/"/g,'')}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-EasyLabel-Icon-Bytes': String(buffer.length)
    });
    return res.end(buffer);
  } catch(e) {
    console.error('Icon asset error:',e);
    return res.sendStatus(500);
  }
};


function resolveTaxonomy(mainCategory, subCategory) {
  const main = ICON_TAXONOMY.find(x => x.name === mainCategory);
  if (!main) throw new Error('Please select a valid main category');
  if (!main.subcategories.includes(subCategory)) {
    throw new Error('Please select a valid sub category');
  }
  return main;
}

exports.uploadByTaxonomy=async(req,res)=>{
  try{
    const mainCategory=String(req.body.mainCategory||'').trim();
    const subCategory=String(req.body.subCategory||'').trim();
    resolveTaxonomy(mainCategory, subCategory);

    if(!req.file) throw new Error('Choose an icon file');

    const buffer = Buffer.from(req.file.buffer);
    const mime = detectImageMime(buffer, req.file.mimetype);
    if(!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(mime)) {
      throw new Error('Unsupported icon image. Upload PNG, JPG, WebP or SVG.');
    }

    let c = await IconLibrary.findOne({name:subCategory});
    if(!c) {
      const mainIndex = ICON_TAXONOMY.findIndex(x => x.name === mainCategory);
      const subIndex = ICON_TAXONOMY[mainIndex].subcategories.indexOf(subCategory);
      c = await IconLibrary.create({
        name:subCategory,
        slug:slugify(subCategory),
        mainCategory,
        displayOrder:(mainIndex * 100) + subIndex,
        active:true,
        icons:[]
      });
    } else if(c.mainCategory !== mainCategory) {
      c.mainCategory = mainCategory;
    }

    if (req.body.mainCategory) c.mainCategory = String(req.body.mainCategory).trim();
    c.icons.push({
      name:req.body.name||req.file.originalname,
      filename:req.file.originalname,
      mimeType:mime,
      data:buffer,
      displayOrder:Number(req.body.displayOrder)||0,
      active:true
    });
    await c.save();

    res.redirect('/icon-library?message='+encodeURIComponent(
      `Icon uploaded to ${mainCategory} > ${subCategory}`
    ));
  }catch(e){
    res.redirect('/icon-library?message='+encodeURIComponent(e.message));
  }
};

exports.createCategory=async(req,res)=>{
  try{
    let slug=slugify(req.body.name);
    if(!slug) throw new Error('Category name required');
    await IconLibrary.create({
      name:req.body.name,slug,displayOrder:Number(req.body.displayOrder)||0,active:true
    });
    res.redirect('/icon-library?message=Category%20created');
  }catch(e){
    res.redirect('/icon-library?message='+encodeURIComponent(e.message));
  }
};

exports.upload=async(req,res)=>{
  try{
    const c=await IconLibrary.findById(req.params.id);
    if(!c)throw new Error('Category not found');
    if(!req.file)throw new Error('Choose an icon file');

    const buffer = Buffer.from(req.file.buffer);
    const mime = detectImageMime(buffer, req.file.mimetype);

    if(!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(mime)) {
      throw new Error('Unsupported icon image. Upload PNG, JPG, WebP or SVG.');
    }

    if (req.body.mainCategory) c.mainCategory = String(req.body.mainCategory).trim();
    c.icons.push({
      name:req.body.name||req.file.originalname,
      filename:req.file.originalname,
      mimeType:mime,
      data:buffer,
      displayOrder:Number(req.body.displayOrder)||0,
      active:true
    });
    await c.save();
    res.redirect('/icon-library?message=Icon%20uploaded');
  }catch(e){
    res.redirect('/icon-library?message='+encodeURIComponent(e.message));
  }
};

exports.toggleCategory=async(req,res)=>{
  const c=await IconLibrary.findById(req.params.id);
  if(c){c.active=!c.active;await c.save();}
  res.redirect('/icon-library');
};

exports.deleteCategory=async(req,res)=>{
  await IconLibrary.findByIdAndDelete(req.params.id);
  res.redirect('/icon-library');
};

exports.deleteIcon=async(req,res)=>{
  const c=await IconLibrary.findById(req.params.id);
  if(c){c.icons.pull(req.params.iconId);await c.save();}
  res.redirect('/icon-library');
};
