const provider = require('./aiProviderService');

const ALLOWED_TYPES = new Set(['text', 'barcode', 'qrcode', 'line', 'rectangle', 'image']);
const ALLOWED_ALIGNMENTS = new Set(['left', 'center', 'right']);

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function cleanBase64(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const comma = text.indexOf(',');
  return comma >= 0 ? text.slice(comma + 1) : text;
}

function inferMimeType(value, fallback = 'image/jpeg') {
  const match = String(value || '').match(/^data:([^;,]+)[;,]/i);
  return match ? match[1] : fallback;
}

function validateImageInput(input) {
  const raw = input.imageBase64 || input.image || input.dataUrl;
  const imageBase64 = cleanBase64(raw);
  if (!imageBase64) {
    const error = new Error('imageBase64 or dataUrl is required.');
    error.statusCode = 400;
    error.code = 'IMAGE_REQUIRED';
    throw error;
  }
  const approximateBytes = Math.floor(imageBase64.length * 0.75);
  const maxBytes = Number(process.env.AI_MAX_IMAGE_BYTES || 8 * 1024 * 1024);
  if (approximateBytes > maxBytes) {
    const error = new Error(`Image is too large. Maximum allowed size is ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    error.statusCode = 413;
    error.code = 'IMAGE_TOO_LARGE';
    throw error;
  }
  return { imageBase64, mimeType: input.mimeType || inferMimeType(raw) };
}

function normalizeElement(element, widthMm, heightMm) {
  const type = String(element?.type || '').toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return null;
  const normalized = {
    type,
    value: String(element.value || '').slice(0, 2000),
    x: clamp(element.x, 0, widthMm),
    y: clamp(element.y, 0, heightMm),
    width: clamp(element.width, 0.5, widthMm),
    height: clamp(element.height, 0.5, heightMm),
    rotation: clamp(element.rotation || 0, -180, 180),
    fontKey: String(element.fontKey || 'default').slice(0, 80),
    fontSize: clamp(element.fontSize || 12, 5, 72),
    alignment: ALLOWED_ALIGNMENTS.has(element.alignment) ? element.alignment : 'left',
    bold: Boolean(element.bold),
    invert: Boolean(element.invert)
  };
  if (type === 'image') {
    normalized.dataUrl = String(element.dataUrl || '').slice(0, 2_000_000);
    normalized.fit = ['contain', 'cover', 'stretch'].includes(element.fit) ? element.fit : 'contain';
  }
  return normalized;
}

function normalizeLayout(raw, input = {}) {
  const widthMm = clamp(raw?.widthMm || input.widthMm || 50, 20, 110);
  const heightMm = clamp(raw?.heightMm || input.heightMm || 30, 10, 160);
  const elements = (Array.isArray(raw?.elements) ? raw.elements : [])
    .slice(0, 40)
    .map(item => normalizeElement(item, widthMm, heightMm))
    .filter(Boolean);
  return {
    version: 2,
    widthMm,
    heightMm,
    dpi: Number(input.dpi || 203),
    background: 'white',
    printMode: 'monochrome',
    elements
  };
}

function layoutSchemaPrompt(input) {
  return `Return JSON only. Create an editable black-and-white thermal label.
Canvas: ${input.widthMm || 50}mm × ${input.heightMm || 30}mm, ${input.dpi || 203} DPI.
Allowed element types only: text, barcode, qrcode, line, rectangle, image.
Schema: {"widthMm":50,"heightMm":30,"elements":[{"type":"text","value":"TEXT","x":0,"y":0,"width":20,"height":5,"fontKey":"default","fontSize":12,"alignment":"left","bold":false,"rotation":0,"invert":false}]}.
Coordinates and sizes are millimetres. Keep every element inside the canvas. Use strong contrast, no colours, no gradients, no shadows, no grey backgrounds, and readable spacing. Prefer native text/barcode/QR objects instead of a flattened image.`;
}

async function design(input) {
  const prompt = `${layoutSchemaPrompt(input)}\nUser request: ${String(input.prompt || '').slice(0, 4000)}\nProduct name: ${input.productName || ''}\nIndustry: ${input.industry || ''}\nMRP: ${input.mrp || ''}\nBarcode: ${input.barcode || ''}\nQR value: ${input.qrValue || ''}\nStyle: ${input.style || 'clean professional'}.`;
  const result = await provider.generateJson({ prompt });
  return { ...result, layout: normalizeLayout(result.json, input) };
}

async function product(input) {
  const prompt = `${layoutSchemaPrompt(input)}\nCreate a retail product label from these details:\n${JSON.stringify({ productName: input.productName, brand: input.brand, mrp: input.mrp, salePrice: input.salePrice, weight: input.weight, barcode: input.barcode, qrValue: input.qrValue, sku: input.sku, batch: input.batch, expiry: input.expiry, extraText: input.extraText, style: input.style })}`;
  const result = await provider.generateJson({ prompt });
  return { ...result, layout: normalizeLayout(result.json, input) };
}

async function shipping(input) {
  const prompt = `${layoutSchemaPrompt({ ...input, widthMm: input.widthMm || 100, heightMm: input.heightMm || 150 })}\nCreate a courier shipping label. Include sender, receiver, phone, address, PIN, order number, tracking barcode/QR, COD/prepaid status and amount when provided. Prioritize address and tracking readability. Details:\n${JSON.stringify(input.details || input)}`;
  const result = await provider.generateJson({ prompt });
  return { ...result, layout: normalizeLayout(result.json, { ...input, widthMm: input.widthMm || 100, heightMm: input.heightMm || 150 }) };
}

async function voice(input) {
  if (!String(input.transcript || input.prompt || '').trim()) {
    const error = new Error('Voice transcript is required. Convert speech to text in Android and send transcript.');
    error.statusCode = 400;
    error.code = 'TRANSCRIPT_REQUIRED';
    throw error;
  }
  return design({ ...input, prompt: input.transcript || input.prompt });
}

async function scan(input) {
  const image = validateImageInput(input);
  const prompt = `${layoutSchemaPrompt(input)}
You are EasyLabel AI Scan Engine. Analyze only the physical label inside the attached cropped photo and reconstruct it as native editable objects.

STRICT RULES:
1. Return JSON only; never return SVG, HTML, markdown or a flattened full-label image.
2. Preserve exact visible wording and reading order. Never invent product details.
3. Detect text, barcode, qrcode, image/logo, line and rectangle independently.
4. Use millimetre coordinates relative to the requested canvas.
5. For barcode/QR, return the decoded value when readable. If not readable, keep value empty and add a warning.
6. For logos/icons that cannot be represented as text or shapes, include an image element only when a compact cropped dataUrl is genuinely available; otherwise create a rectangle placeholder and warning.
7. Border-only boxes must use rectangle with filled=false. Solid black areas use filled=true.
8. Set fontSize, bold, alignment and rotation as accurately as possible.
9. Keep every object inside the canvas and avoid overlaps introduced by reconstruction.
10. Also return confidence from 0 to 1 and warnings as an array.

Expected top-level shape:
{"widthMm":50,"heightMm":30,"confidence":0.9,"warnings":[],"elements":[...]}
Optional correction instruction from user: ${String(input.prompt || '').slice(0, 1000)}`;
  const result = await provider.generateJson({ prompt, ...image, model: process.env.GEMINI_SCAN_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash' });
  const layout = normalizeLayout(result.json, input);
  if (!layout.elements.length) {
    const error = new Error('No editable label elements were detected. Crop closer to the label and try again.');
    error.statusCode = 422;
    error.code = 'NO_LABEL_ELEMENTS';
    throw error;
  }
  return {
    ...result,
    layout,
    confidence: clamp(result.json?.confidence ?? 0.7, 0, 1),
    warnings: Array.isArray(result.json?.warnings) ? result.json.warnings.slice(0, 20).map(String) : []
  };
}

function sanitizeSvg(svg) {
  let value = String(svg || '').trim();
  value = value.replace(/^```(?:svg|xml)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = value.indexOf('<svg');
  const end = value.lastIndexOf('</svg>');
  if (start < 0 || end < start) throw Object.assign(new Error('AI returned invalid SVG.'), { statusCode: 502, code: 'AI_INVALID_SVG' });
  value = value.slice(start, end + 6);
  value = value.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/https?:\/\/[^"'\s)]+/gi, '');
  if (Buffer.byteLength(value, 'utf8') > 500000) throw Object.assign(new Error('Generated SVG is too large.'), { statusCode: 502, code: 'AI_SVG_TOO_LARGE' });
  return value;
}

async function logo(input) {
  const prompt = `Create a simple one-colour black logo for a thermal label printer. Prompt: ${String(input.prompt || input.brand || '').slice(0, 2000)}. Return SVG only. Transparent background. Use only black fills/strokes and white/transparent negative space. No gradients, filters, shadows, external images, scripts, text fonts, URLs or colour. Use viewBox="0 0 512 512" and bold shapes that remain clear at 203 DPI.`;
  const result = await provider.generateText({ prompt });
  const svg = sanitizeSvg(result.text);
  return {
    ...result,
    svg,
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  };
}

async function thermal(input) {
  const image = validateImageInput(input);
  const prompt = `Convert the attached image/logo into a simple pure black-and-white SVG suitable for a 203 DPI thermal printer. Preserve the recognizable subject, remove background, simplify tiny details, increase line thickness, and use only black and transparent/white. Return SVG only with viewBox="0 0 512 512". No gradients, filters, scripts, URLs or external assets.`;
  const result = await provider.generateText({ prompt, ...image });
  const svg = sanitizeSvg(result.text);
  return {
    ...result,
    svg,
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  };
}

module.exports = { design, product, shipping, voice, scan, logo, thermal, normalizeLayout };
