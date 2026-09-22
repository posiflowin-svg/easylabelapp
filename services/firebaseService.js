const admin = require('firebase-admin');

let initialized = false;
let initializationError = null;

function normalizePrivateKey(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\n/g, '\n');
}

function getCredentials() {
  // Option 1 (backward compatible): paste the complete Firebase service-account JSON
  // into FIREBASE_SERVICE_ACCOUNT_JSON in Render.
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parsed.private_key) parsed.private_key = normalizePrivateKey(parsed.private_key);
      return parsed;
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON: ${error.message}`);
    }
  }

  // Option 2 (recommended for Render): store the three values separately.
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId.trim(),
      client_email: clientEmail.trim(),
      private_key: privateKey
    };
  }

  return null;
}

function initialize() {
  if (initialized && admin.apps.length) return true;
  try {
    const credentials = getCredentials();
    if (!credentials) {
      initializationError = 'Missing Firebase credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Render (or FIREBASE_SERVICE_ACCOUNT_JSON).';
      return false;
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(credentials),
        projectId: credentials.project_id || process.env.FIREBASE_PROJECT_ID
      });
    }
    initialized = true;
    initializationError = null;
    console.log(`[Firebase] Admin SDK initialized for project ${credentials.project_id || process.env.FIREBASE_PROJECT_ID || 'configured project'}`);
    return true;
  } catch (error) {
    initialized = false;
    initializationError = error.message;
    console.error('[Firebase] Admin SDK initialization failed:', error.message);
    return false;
  }
}

function getConfigurationStatus() {
  const configured = initialize();
  return { configured, error: configured ? null : initializationError };
}

async function sendToTokens(tokens, notification, data = {}) {
  const uniqueTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!uniqueTokens.length) {
    return { successCount: 0, failureCount: 0, skipped: true, reason: 'No registered devices found. Open the latest Android app on a logged-in device first.' };
  }
  if (!initialize()) {
    return { successCount: 0, failureCount: 0, skipped: true, reason: initializationError || 'Firebase not configured' };
  }

  const message = {
    tokens: uniqueTokens,
    notification: {
      title: String(notification.title || ''),
      body: String(notification.body || ''),
      ...(notification.imageUrl ? { imageUrl: String(notification.imageUrl) } : {})
    },
    data: Object.fromEntries(
      Object.entries(data || {}).map(([key, value]) => [key, String(value ?? '')])
    ),
    android: {
      priority: 'high',
      notification: {
        channelId: 'easylabel_marketing',
        ...(notification.imageUrl ? { imageUrl: String(notification.imageUrl) } : {})
      }
    }
  };

  const result = await admin.messaging().sendEachForMulticast(message);

  // Disable stale/invalid FCM tokens so future sends do not repeatedly fail.
  const invalidCodes = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token'
  ]);
  const invalidTokens = [];
  result.responses.forEach((response, index) => {
    if (!response.success && invalidCodes.has(response.error?.code)) {
      invalidTokens.push(uniqueTokens[index]);
    }
  });
  if (invalidTokens.length) {
    try {
      const DeviceToken = require('../models/DeviceToken');
      await DeviceToken.updateMany({ token: { $in: invalidTokens } }, { $set: { enabled: false } });
    } catch (error) {
      console.error('[Firebase] Could not disable invalid tokens:', error.message);
    }
  }

  return result;
}

module.exports = { initialize, getConfigurationStatus, sendToTokens };
