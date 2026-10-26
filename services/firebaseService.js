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

  // Firebase Admin multicast accepts at most 500 registration tokens per call.
  // Aggregate responses without exposing raw device tokens in API responses/logs.
  const BATCH_SIZE = 500;
  const invalidCodes = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token'
  ]);
  const invalidTokens = [];
  const summary = {
    successCount: 0, failureCount: 0, attemptedCount: 0,
    batchCount: Math.ceil(uniqueTokens.length / BATCH_SIZE),
    failedBatches: [], errorCounts: {}
  };
  for (let start = 0; start < uniqueTokens.length; start += BATCH_SIZE) {
    const batch = uniqueTokens.slice(start, start + BATCH_SIZE);
    const batchNumber = Math.floor(start / BATCH_SIZE) + 1;
    try {
      const result = await admin.messaging().sendEachForMulticast({ ...message, tokens: batch });
      summary.attemptedCount += batch.length;
      summary.successCount += result.successCount || 0;
      summary.failureCount += result.failureCount || 0;
      (result.responses || []).forEach((response, index) => {
        if (response.success) return;
        const code = response.error?.code || 'unknown';
        summary.errorCounts[code] = (summary.errorCounts[code] || 0) + 1;
        if (invalidCodes.has(code)) invalidTokens.push(batch[index]);
      });
    } catch (error) {
      // Do not retry blindly: a transport failure may have delivered some messages.
      summary.attemptedCount += batch.length;
      summary.failureCount += batch.length;
      summary.failedBatches.push(batchNumber);
      const code = error.code || 'batch-request-failed';
      summary.errorCounts[code] = (summary.errorCounts[code] || 0) + batch.length;
      console.error(`[Firebase] Multicast batch ${batchNumber}/${summary.batchCount} failed:`, error.message);
    }
  }
  if (invalidTokens.length) {
    try {
      const DeviceToken = require('../models/DeviceToken');
      await DeviceToken.updateMany({ token: { $in: invalidTokens } }, { $set: { enabled: false } });
    } catch (error) {
      console.error('[Firebase] Could not disable invalid tokens:', error.message);
    }
  }
  return summary;
}

module.exports = { initialize, getConfigurationStatus, sendToTokens };
