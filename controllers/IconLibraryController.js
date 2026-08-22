const IconLibrary = require('../models/IconLibrary');

function slugify(s){return String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}

function toNodeBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return Buffer.from(value);

  // Mongoose/BSON buffer variants.
  if (value.buffer && Buffer.isBuffer(value.buffer)) {
    return Buffer.from(value.buffer);
  }
  if (value.value && typeof value.value === 'function') {
    try {
      const v = value.value();
      if (Buffer.isBuffer(v)) return Buffer.from(v);
    } catch (_) {}
  }

  // JSON-serialized Node Buffer fallback.
  if (value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  // MongoDB Binary/BSON style.
  if (value._bsontype === 'Binary' && value.buffer) {
    try { return Buffer.from(value.buffer); } catch (_) {}
  }

  // Last safe fallback for Uint8Array-like values.
  try {
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } catch (_) {}

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
  const categories=await IconLibrary.find().sort({displayOrder:1,name:1}).lean();
  res.render('icon-library',{categories,message:req.query.message||''});
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
      {_id:req.params.categoryId, 'icons._id':req.params.iconId, active:true},
      {icons:{$elemMatch:{_id:req.params.iconId,active:true}}}
    ).lean();

    if(!c || !c.icons || !c.icons.length) return res.sendStatus(404);

    const i = c.icons[0];
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
      'Cache-Control': 'public, max-age=3600, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-EasyLabel-Icon-Bytes': String(buffer.length)
    });
    return res.end(buffer);
  } catch(e) {
    console.error('Icon asset error:',e);
    return res.sendStatus(500);
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
