const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEFAULT_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

function providerError(message, statusCode = 502, code = 'AI_PROVIDER_FAILED') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function extractText(body) {
  const parts = body?.candidates?.[0]?.content?.parts || [];
  return parts.map(part => part.text || '').filter(Boolean).join('\n').trim();
}

function extractImage(body) {
  const parts = body?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      return {
        mimeType: inline.mimeType || inline.mime_type || 'image/png',
        base64: inline.data
      };
    }
  }
  return null;
}

function stripCodeFence(value) {
  return String(value || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonText(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (error) {
        throw providerError('AI returned invalid JSON.', 502, 'AI_INVALID_JSON');
      }
    }
    throw providerError('AI returned invalid JSON.', 502, 'AI_INVALID_JSON');
  }
}

async function geminiRequest({ model = DEFAULT_MODEL, parts, generationConfig = {} }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY;
  if (!apiKey) {
    throw providerError('GEMINI_API_KEY is not configured.', 503, 'AI_NOT_CONFIGURED');
  }

  if (typeof fetch !== 'function') {
    throw providerError('Global fetch is unavailable. Use Node.js 18 or newer.', 500, 'FETCH_UNAVAILABLE');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.AI_TIMEOUT_MS || 60000)
  );

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig
      }),
      signal: controller.signal
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = body?.error?.message || `Gemini request failed (${response.status}).`;
      throw providerError(
        message,
        response.status >= 500 ? 502 : response.status,
        'GEMINI_REQUEST_FAILED'
      );
    }

    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw providerError('AI request timed out.', 504, 'AI_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateJson({
  prompt,
  imageBase64,
  mimeType = 'image/jpeg',
  model = DEFAULT_MODEL
}) {
  const parts = [{ text: prompt }];

  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imageBase64
      }
    });
  }

  const body = await geminiRequest({
    model,
    parts,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  });

  const json = parseJsonText(extractText(body));

  return {
    provider: 'gemini',
    model,
    json,
    data: json,
    usage: body.usageMetadata || {}
  };
}

async function generateText({
  prompt,
  imageBase64,
  mimeType = 'image/jpeg',
  model = DEFAULT_MODEL
}) {
  const parts = [{ text: prompt }];

  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imageBase64
      }
    });
  }

  const body = await geminiRequest({
    model,
    parts,
    generationConfig: {
      temperature: 0.2
    }
  });

  const text = extractText(body);
  if (!text) {
    throw providerError('AI returned an empty text response.', 502, 'AI_TEXT_MISSING');
  }

  return {
    provider: 'gemini',
    model,
    text,
    usage: body.usageMetadata || {}
  };
}

async function generateImage({ prompt, model = DEFAULT_IMAGE_MODEL }) {
  const body = await geminiRequest({
    model,
    parts: [{ text: prompt }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  });

  const image = extractImage(body);
  if (!image) {
    throw providerError('AI did not return an image.', 502, 'AI_IMAGE_MISSING');
  }

  return {
    provider: 'gemini',
    model,
    image,
    usage: body.usageMetadata || {}
  };
}

module.exports = {
  generateJson,
  generateText,
  generateImage,
  providerError
};
