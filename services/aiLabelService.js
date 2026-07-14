const ALLOWED_TYPES = new Set(['text', 'barcode', 'qrcode', 'line', 'rectangle']);

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeLayout(layout, widthMm, heightMm) {
  const elements = Array.isArray(layout?.elements) ? layout.elements.slice(0, 20) : [];
  return {
    widthMm,
    heightMm,
    background: 'white',
    elements: elements.filter(e => ALLOWED_TYPES.has(e.type)).map(e => ({
      type: e.type,
      value: String(e.value || '').slice(0, 500),
      x: clamp(e.x, 0, widthMm),
      y: clamp(e.y, 0, heightMm),
      width: clamp(e.width, 1, widthMm),
      height: clamp(e.height, 1, heightMm),
      fontKey: String(e.fontKey || 'default').slice(0, 50),
      fontSize: clamp(e.fontSize || 12, 6, 72),
      alignment: ['left', 'center', 'right'].includes(e.alignment) ? e.alignment : 'left',
      bold: Boolean(e.bold)
    }))
  };
}

function fallbackLayout(input) {
  const width = clamp(input.widthMm || 50, 20, 110);
  const height = clamp(input.heightMm || 30, 10, 160);
  const elements = [
    { type: 'text', value: input.productName || 'PRODUCT NAME', x: 2, y: 2, width: width - 4, height: 6, fontKey: 'default_bold', fontSize: 18, alignment: 'center', bold: true },
    { type: 'text', value: input.mrp ? `MRP ${input.mrp}` : '', x: 2, y: 9, width: width - 4, height: 5, fontKey: 'default_bold', fontSize: 14, alignment: 'center', bold: true }
  ];
  if (input.barcode) elements.push({ type: 'barcode', value: input.barcode, x: 5, y: Math.max(14, height - 12), width: width - 10, height: 9 });
  return normalizeLayout({ elements }, width, height);
}

async function generate(input) {
  const width = clamp(input.widthMm || 50, 20, 110);
  const height = clamp(input.heightMm || 30, 10, 160);
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  const endpoint = process.env.AI_PROVIDER_ENDPOINT;
  if (!apiKey || !endpoint) return { provider: 'fallback', layout: fallbackLayout(input) };

  const prompt = `Return ONLY JSON for a black-and-white thermal label layout. Width ${width}mm, height ${height}mm. Product: ${input.productName || ''}. Industry: ${input.industry || ''}. MRP: ${input.mrp || ''}. Barcode: ${input.barcode || ''}. Style: ${input.style || 'clean'}. JSON schema: {"elements":[{"type":"text|barcode|qrcode|line|rectangle","value":"","x":0,"y":0,"width":10,"height":5,"fontKey":"default","fontSize":12,"alignment":"left|center|right","bold":false}]}. Keep all elements inside the label and optimize for monochrome thermal printing.`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.AI_PROVIDER_MODEL || 'default', prompt })
  });
  if (!response.ok) throw new Error(`AI provider failed (${response.status}).`);
  const body = await response.json();
  const raw = body.output || body.text || body.content || body;
  const parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/```json|```/g, '').trim()) : raw;
  return { provider: process.env.AI_PROVIDER_NAME || 'custom', layout: normalizeLayout(parsed, width, height) };
}

module.exports = { generate, fallbackLayout };
