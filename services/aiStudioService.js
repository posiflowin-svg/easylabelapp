const provider = require('./aiProviderService');

const ALLOWED_TYPES = new Set(['text', 'barcode', 'qrcode', 'line', 'rectangle', 'image']);
const ALLOWED_ALIGNMENTS = new Set(['left', 'center', 'right']);
const ALLOWED_BARCODE_TYPES = new Set(['code128', 'code39', 'ean13', 'ean8', 'upca', 'upce', 'itf', 'codabar']);

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
    value: String(element.value || element.text || '').slice(0, 2000),
    x: clamp(element.x, 0, widthMm),
    y: clamp(element.y, 0, heightMm),
    width: clamp(element.width, 0.5, widthMm),
    height: clamp(element.height, 0.5, heightMm),
    rotation: clamp(element.rotation || 0, -180, 180),
    fontKey: String(element.fontKey || 'default').slice(0, 80),
    fontSize: clamp(element.fontSize || 12, 5, 72),
    alignment: ALLOWED_ALIGNMENTS.has(String(element.alignment || '').toLowerCase())
      ? String(element.alignment).toLowerCase() : 'left',
    verticalAlignment: ['top', 'center', 'bottom'].includes(String(element.verticalAlignment || '').toLowerCase())
      ? String(element.verticalAlignment).toLowerCase() : 'center',
    bold: Boolean(element.bold),
    italic: Boolean(element.italic),
    underline: Boolean(element.underline),
    lineWrap: element.lineWrap !== false,
    invert: Boolean(element.invert),
    confidence: clamp(element.confidence ?? 0.75, 0, 1)
  };
  if (type === 'barcode') {
    const barcodeType = String(element.barcodeType || 'code128').toLowerCase();
    normalized.barcodeType = ALLOWED_BARCODE_TYPES.has(barcodeType) ? barcodeType : 'code128';
    normalized.showText = Boolean(element.showText);
    normalized.moduleWidth = clamp(element.moduleWidth || 2, 1, 6);
  }
  if (type === 'qrcode') {
    normalized.errorCorrection = ['L', 'M', 'Q', 'H'].includes(String(element.errorCorrection || '').toUpperCase())
      ? String(element.errorCorrection).toUpperCase() : 'M';
  }
  if (type === 'line' || type === 'rectangle') {
    normalized.thickness = clamp(element.thickness || element.strokeWidth || 0.35, 0.15, 3);
    normalized.filled = Boolean(element.filled);
  }
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
  const requestedWidth = clamp(input.widthMm || 50, 20, 110);
  const requestedHeight = clamp(input.heightMm || 30, 10, 160);
  const prompt = `${layoutSchemaPrompt({ ...input, widthMm: requestedWidth, heightMm: requestedHeight })}
You are EasyLabel Phase-2.1 Fast Precision Scan Engine. Reconstruct the photographed thermal label as a native editable layout, not as a screenshot.

Perform one careful visual pass and return the editable JSON immediately.
- Perspective-correct the cropped label mentally.
- OCR visible text exactly, preserving capitalization, punctuation, currency symbols and line breaks.
- Detect barcode and QR objects only when they are genuinely visible.
- Keep logos/icons separate from text and never use a full-label screenshot as an image object.
- Match position, size, alignment, font hierarchy, border thickness and rotation.
- Keep all objects inside the ${requestedWidth}×${requestedHeight} mm canvas.

STRICT OUTPUT RULES:
1. Return JSON only; no SVG, HTML, markdown or explanation.
2. Never invent text or product information.
3. Allowed objects: text, barcode, qrcode, image, line, rectangle.
4. Coordinates and dimensions are millimetres.
5. Border-only boxes must use filled=false; never convert headings or logos into solid black rectangles.
6. Include confidence 0..1 for each element and for the complete layout.
7. Add warnings for unreadable barcode/QR/text instead of guessing.
8. Order elements from top-left to bottom-right.

Expected shape:
{"widthMm":${requestedWidth},"heightMm":${requestedHeight},"confidence":0.90,"warnings":[],"elements":[{"type":"text","value":"MRP ₹99","x":2,"y":2,"width":20,"height":4,"fontSize":12,"bold":true,"alignment":"left","verticalAlignment":"center","rotation":0,"confidence":0.98}]}
Optional user correction: ${String(input.prompt || '').slice(0, 1000)}`;

  const result = await provider.generateJson({
    prompt,
    ...image,
    model: process.env.GEMINI_SCAN_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  });

  const layout = normalizeLayout(result.json, { ...input, widthMm: requestedWidth, heightMm: requestedHeight });
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
    warnings: Array.isArray(result.json?.warnings)
      ? result.json.warnings.slice(0, 20).map(String)
      : []
  };
}

async function refineScan(input) {
  const image = validateImageInput(input);
  const requestedWidth = clamp(input.widthMm || input.draftLayout?.widthMm || 50, 20, 110);
  const requestedHeight = clamp(input.heightMm || input.draftLayout?.heightMm || 30, 10, 160);
  const draftLayout = normalizeLayout(input.draftLayout || input.layout || {}, {
    ...input,
    widthMm: requestedWidth,
    heightMm: requestedHeight
  });

  if (!draftLayout.elements.length) {
    const error = new Error('A scanned draft layout is required before improving the scan.');
    error.statusCode = 400;
    error.code = 'DRAFT_LAYOUT_REQUIRED';
    throw error;
  }

  const prompt = `You are EasyLabel Phase-2.1 Scan Refinement Engine.
Compare the attached original label image against the draft editable JSON below.
Return one corrected complete JSON layout only.

Correct only what the source image proves:
- OCR spelling, punctuation, currency symbols and line breaks
- missing or extra elements
- text hierarchy, bold style, alignment and rotation
- barcode/QR type and value when readable
- coordinates, dimensions, margins, overlaps and border thickness
- logos/icons that were incorrectly represented as black boxes

Do not redesign, beautify, invent content or flatten the label into an image.
Canvas: ${requestedWidth}×${requestedHeight} mm.
Allowed objects: text, barcode, qrcode, image, line, rectangle.
Draft JSON:
${JSON.stringify(draftLayout)}`;

  const result = await provider.generateJson({
    prompt,
    ...image,
    model: process.env.GEMINI_SCAN_REFINEMENT_MODEL || process.env.GEMINI_SCAN_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  });

  const layout = normalizeLayout(result.json, { ...input, widthMm: requestedWidth, heightMm: requestedHeight });
  if (!layout.elements.length) {
    const error = new Error('The improved scan did not contain editable elements. Keep the current scan and try again later.');
    error.statusCode = 422;
    error.code = 'REFINEMENT_EMPTY';
    throw error;
  }

  return {
    ...result,
    layout,
    confidence: clamp(result.json?.confidence ?? 0.8, 0, 1),
    warnings: Array.isArray(result.json?.warnings)
      ? result.json.warnings.slice(0, 20).map(String)
      : []
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

module.exports = { design, product, shipping, voice, scan, refineScan, logo, thermal, normalizeLayout };
