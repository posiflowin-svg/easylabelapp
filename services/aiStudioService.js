const sharp = require('sharp');
const provider = require('./aiProviderService');

const ALLOWED_TYPES = new Set(['text', 'barcode', 'qrcode', 'line', 'rectangle', 'image']);

function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanBase64(value) {
  if (!value) return '';
  return String(value).replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
}

function validateImage(base64) {
  const clean = cleanBase64(base64);
  if (!clean) return '';
  const bytes = Buffer.byteLength(clean, 'base64');
  const max = Number(process.env.AI_MAX_IMAGE_BYTES || 8 * 1024 * 1024);
  if (bytes > max) {
    const error = new Error(`Image is too large. Maximum allowed is ${Math.round(max / 1024 / 1024)} MB.`);
    error.statusCode = 413;
    error.code = 'AI_IMAGE_TOO_LARGE';
    throw error;
  }
  return clean;
}

function normalizeLayout(layout, widthMm, heightMm) {
  const width = clamp(widthMm, 20, 110, 50);
  const height = clamp(heightMm, 10, 160, 30);
  const raw = Array.isArray(layout?.elements) ? layout.elements : [];
  const elements = raw.slice(0, 40).filter(item => ALLOWED_TYPES.has(String(item?.type || '').toLowerCase())).map(item => {
    const type = String(item.type).toLowerCase();
    const x = clamp(item.x, 0, width, 0);
    const y = clamp(item.y, 0, height, 0);
    const maxW = Math.max(1, width - x);
    const maxH = Math.max(1, height - y);
    return {
      type,
      value: String(item.value || '').slice(0, 1000),
      x,
      y,
      width: clamp(item.width, 1, maxW, Math.min(10, maxW)),
      height: clamp(item.height, 1, maxH, Math.min(5, maxH)),
      fontKey: String(item.fontKey || 'default').slice(0, 60),
      fontSize: clamp(item.fontSize, 6, 72, 12),
      alignment: ['left', 'center', 'right'].includes(item.alignment) ? item.alignment : 'left',
      bold: Boolean(item.bold),
      rotation: [0, 90, 180, 270].includes(Number(item.rotation)) ? Number(item.rotation) : 0,
      strokeWidth: clamp(item.strokeWidth, 1, 6, 1)
    };
  });
  return { widthMm: width, heightMm: height, background: 'white', colorMode: 'black_white', elements };
}

function schemaPrompt(width, height) {
  return `Return JSON only. Canvas is ${width}mm x ${height}mm. Use black on white only and optimize for 203 DPI thermal printing. No gradients, shadows, grey backgrounds, tiny text or decorative clutter. Keep every object within the canvas. Schema: {"elements":[{"type":"text|barcode|qrcode|line|rectangle","value":"","x":0,"y":0,"width":10,"height":5,"fontKey":"default","fontSize":12,"alignment":"left|center|right","bold":false,"rotation":0,"strokeWidth":1}]}. Coordinates and sizes are millimetres.`;
}

async function layoutFromPrompt({ feature, prompt, widthMm, heightMm, imageBase64, mimeType }) {
  const width = clamp(widthMm, 20, 110, 50);
  const height = clamp(heightMm, 10, 160, 30);
  const result = await provider.generateJson({
    prompt: `${schemaPrompt(width, height)}\nTask: ${feature}.\nUser request: ${String(prompt || '').slice(0, 5000)}`,
    imageBase64: imageBase64 ? validateImage(imageBase64) : '',
    mimeType
  });
  return { ...result, layout: normalizeLayout(result.data, width, height) };
}

async function scan(input) {
  if (!input.imageBase64) {
    const error = new Error('imageBase64 is required for AI Scan.');
    error.statusCode = 400;
    throw error;
  }
  return layoutFromPrompt({
    feature: 'Reconstruct the uploaded label as editable objects. Preserve visible text, hierarchy, barcode/QR values when readable, borders and approximate positions. Do not invent legal or product data.',
    prompt: input.prompt || 'Recreate this label accurately.',
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    imageBase64: input.imageBase64,
    mimeType: input.mimeType || 'image/jpeg'
  });
}

async function design(input) {
  if (!input.prompt) {
    const error = new Error('prompt is required for AI Design.');
    error.statusCode = 400;
    throw error;
  }
  return layoutFromPrompt({ feature: 'Create a professional editable thermal label.', ...input });
}

async function voice(input) {
  const transcript = input.transcript || input.prompt;
  if (!transcript) {
    const error = new Error('transcript is required for Voice to Label.');
    error.statusCode = 400;
    throw error;
  }
  return layoutFromPrompt({ feature: 'Create a label from this voice transcript.', ...input, prompt: transcript });
}

async function product(input) {
  const details = input.prompt || JSON.stringify(input.product || {});
  return layoutFromPrompt({
    feature: 'Create a retail product label. Prioritize product name, variant, quantity/weight, MRP, barcode and required identifiers supplied by the user. Never invent compliance numbers.',
    ...input,
    prompt: details
  });
}

async function shipping(input) {
  if (!input.prompt && !input.imageBase64) {
    const error = new Error('prompt or imageBase64 is required for Shipping Label AI.');
    error.statusCode = 400;
    throw error;
  }
  return layoutFromPrompt({
    feature: 'Create a shipping label. Extract only visible/provided sender, receiver, phone, address, order number, tracking number, barcode and COD amount. Never invent missing values.',
    ...input,
    prompt: input.prompt || 'Extract this document and create a clear shipping label.'
  });
}

async function thermal(input) {
  const clean = validateImage(input.imageBase64);
  if (!clean) {
    const error = new Error('imageBase64 is required for Image to Thermal.');
    error.statusCode = 400;
    throw error;
  }
  const threshold = clamp(input.threshold, 0, 255, 160);
  const maxWidth = Math.round(clamp(input.maxWidthPx, 128, 1600, 800));
  const output = await sharp(Buffer.from(clean, 'base64'))
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .normalize()
    .threshold(threshold)
    .png({ colors: 2, compressionLevel: 9 })
    .toBuffer();
  return {
    provider: 'server-thermal-engine',
    model: 'sharp-monochrome-v1',
    image: { mimeType: 'image/png', base64: output.toString('base64') },
    usage: {}
  };
}

async function logo(input) {
  if (!input.prompt) {
    const error = new Error('prompt is required for AI Logo Generator.');
    error.statusCode = 400;
    throw error;
  }
  const generated = await provider.generateImage({
    prompt: `Create one simple professional logo for thermal label printing. Subject: ${String(input.prompt).slice(0, 1500)}. Pure black artwork on pure white background. Flat vector-like silhouette, thick clean strokes, no gradients, no shadows, no grey, no mockup, no photograph, no tiny details and no surrounding text unless explicitly requested.`
  });
  return thermal({
    imageBase64: generated.image.base64,
    threshold: input.threshold || 170,
    maxWidthPx: input.maxWidthPx || 800
  }).then(result => ({ ...result, provider: generated.provider, model: generated.model, usage: generated.usage }));
}

module.exports = { scan, design, voice, thermal, logo, shipping, product, normalizeLayout };
