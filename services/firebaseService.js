const admin = require('firebase-admin');

let initialized = false;

function getCredentials() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

function initialize() {
  if (initialized) return true;
  const credentials = getCredentials();
  if (!credentials) return false;
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(credentials) });
  }
  initialized = true;
  return true;
}

async function sendToTokens(tokens, notification, data = {}) {
  const uniqueTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!uniqueTokens.length) return { successCount: 0, failureCount: 0, skipped: true };
  if (!initialize()) return { successCount: 0, failureCount: 0, skipped: true, reason: 'Firebase not configured' };
  const result = await admin.messaging().sendEachForMulticast({
    tokens: uniqueTokens,
    notification: { title: notification.title, body: notification.body, imageUrl: notification.imageUrl || undefined },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')]))
  });
  return result;
}

module.exports = { initialize, sendToTokens };
