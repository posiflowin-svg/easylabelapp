const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const DEFAULT_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

const ENV_TEXT_FALLBACKS = String(process.env.GEMINI_FALLBACK_MODELS || process.env.GEMINI_SCAN_FALLBACK_MODELS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const TEXT_MODEL_FALLBACKS = [
  DEFAULT_MODEL,
  ...ENV_TEXT_FALLBACKS,
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
].filter((model, index, list) => model && list.indexOf(model) === index);

const IMAGE_MODEL_FALLBACKS = [
  DEFAULT_IMAGE_MODEL,
  'gemini-3.1-flash-lite-image'
].filter((model, index, list) => model && list.indexOf(model) === index);

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

async function requestSingleModel({ model, parts, generationConfig, apiKey }) {
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
      const error = providerError(
        message,
        response.status >= 500 ? 502 : response.status,
        'GEMINI_REQUEST_FAILED'
      );
      error.providerStatus = response.status;
      error.model = model;
      throw error;
    }

    return { body, model };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw providerError('AI request timed out.', 504, 'AI_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isModelAvailabilityError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.providerStatus === 404 ||
    message.includes('no longer available') ||
    message.includes('not found') ||
    message.includes('not supported for generatecontent') ||
    message.includes('model is not available')
  );
}

function isRetryableProviderError(error) {
  const status = Number(error?.providerStatus || error?.statusCode || 0);
  const message = String(error?.message || '').toLowerCase();
  return (
    status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 ||
    message.includes('high demand') ||
    message.includes('overloaded') ||
    message.includes('temporarily unavailable') ||
    message.includes('resource exhausted') ||
    message.includes('rate limit') ||
    message.includes('quota')
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geminiRequest({
  model = DEFAULT_MODEL,
  fallbackModels = TEXT_MODEL_FALLBACKS,
  parts,
  generationConfig = {}
}) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_API_KEY;
  if (!apiKey) {
    throw providerError('GEMINI_API_KEY is not configured.', 503, 'AI_NOT_CONFIGURED');
  }

  if (typeof fetch !== 'function') {
    throw providerError('Global fetch is unavailable. Use Node.js 18 or newer.', 500, 'FETCH_UNAVAILABLE');
  }

  const models = [model, ...fallbackModels]
    .filter((item, index, list) => item && list.indexOf(item) === index);

  let lastError;
  const retriesPerModel = Math.max(1, Math.min(3, Number(process.env.AI_RETRIES_PER_MODEL || 2)));
  const baseDelayMs = Math.max(500, Number(process.env.AI_RETRY_BASE_DELAY_MS || 1200));

  for (const candidateModel of models) {
    for (let attempt = 1; attempt <= retriesPerModel; attempt++) {
      try {
        return await requestSingleModel({
          model: candidateModel,
          parts,
          generationConfig,
          apiKey
        });
      } catch (error) {
        lastError = error;
        const unavailable = isModelAvailabilityError(error);
        const retryable = isRetryableProviderError(error);

        if (!unavailable && !retryable) throw error;

        if (retryable && attempt < retriesPerModel) {
          const delayMs = baseDelayMs * attempt;
          console.warn(`[AI] ${candidateModel} busy (attempt ${attempt}/${retriesPerModel}). Retrying in ${delayMs}ms.`);
          await sleep(delayMs);
          continue;
        }

        console.warn(`[AI] Switching from ${candidateModel} to fallback model.`);
        break;
      }
    }
  }

  if (lastError && isRetryableProviderError(lastError)) {
    throw providerError(
      'AI is busy right now. Please wait a few seconds and try again.',
      503,
      'AI_BUSY'
    );
  }

  throw lastError || providerError('No supported Gemini model is available.', 502, 'GEMINI_MODEL_UNAVAILABLE');
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

  const result = await geminiRequest({
    model,
    fallbackModels: TEXT_MODEL_FALLBACKS,
    parts,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  });

  const { body, model: resolvedModel } = result;
  const json = parseJsonText(extractText(body));

  return {
    provider: 'gemini',
    model: resolvedModel,
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

  const result = await geminiRequest({
    model,
    fallbackModels: TEXT_MODEL_FALLBACKS,
    parts,
    generationConfig: {
      temperature: 0.2
    }
  });

  const { body, model: resolvedModel } = result;
  const text = extractText(body);
  if (!text) {
    throw providerError('AI returned an empty text response.', 502, 'AI_TEXT_MISSING');
  }

  return {
    provider: 'gemini',
    model: resolvedModel,
    text,
    usage: body.usageMetadata || {}
  };
}

async function generateImage({ prompt, model = DEFAULT_IMAGE_MODEL }) {
  const result = await geminiRequest({
    model,
    fallbackModels: IMAGE_MODEL_FALLBACKS,
    parts: [{ text: prompt }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  });

  const { body, model: resolvedModel } = result;
  const image = extractImage(body);
  if (!image) {
    throw providerError('AI did not return an image.', 502, 'AI_IMAGE_MISSING');
  }

  return {
    provider: 'gemini',
    model: resolvedModel,
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
