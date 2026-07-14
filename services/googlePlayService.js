'use strict';

const PACKAGE_NAME =
  process.env.GOOGLE_PLAY_PACKAGE_NAME ||
  'com.caysn.shreyanseasylabel';

const TEST_MODE =
  String(process.env.PREMIUM_TEST_MODE || 'true').toLowerCase() === 'true';

function getCredentials() {
  if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch (error) {
      throw new Error(
        `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is invalid JSON: ${error.message}`
      );
    }
  }

  if (
    process.env.GOOGLE_PLAY_CLIENT_EMAIL &&
    process.env.GOOGLE_PLAY_PRIVATE_KEY
  ) {
    return {
      client_email: process.env.GOOGLE_PLAY_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PLAY_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
  }

  return null;
}

function isConfigured() {
  return Boolean(getCredentials());
}

function mapState(state) {
  const value = String(state || '').toUpperCase();

  if (value.includes('ACTIVE')) return 'active';
  if (value.includes('GRACE')) return 'grace_period';
  if (value.includes('ON_HOLD')) return 'on_hold';
  if (value.includes('PAUSED') || value.includes('PENDING')) {
    return 'payment_pending';
  }
  if (value.includes('CANCELED') || value.includes('CANCELLED')) {
    return 'cancelled';
  }
  if (value.includes('EXPIRED')) return 'expired';

  return 'payment_pending';
}

/**
 * Load google-auth-library only when live Google verification is actually used.
 * This prevents the whole server from crashing in PREMIUM_TEST_MODE when the
 * package has not yet been installed.
 */
function loadGoogleAuth() {
  try {
    const { GoogleAuth } = require('google-auth-library');
    return GoogleAuth;
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'Missing package "google-auth-library". Run: npm install google-auth-library'
      );
    }
    throw error;
  }
}

async function getAccessToken() {
  const credentials = getCredentials();

  if (!credentials) {
    throw new Error('Google Play service account is not configured.');
  }

  const GoogleAuth = loadGoogleAuth();

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });

  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token =
    typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;

  if (!token) {
    throw new Error('Google Play access token could not be generated.');
  }

  return token;
}

async function fetchSubscription(purchaseToken) {
  if (!purchaseToken) {
    throw new Error('purchaseToken is required.');
  }

  if (typeof fetch !== 'function') {
    throw new Error(
      'This Node.js version does not support fetch. Use Node.js 18 or newer.'
    );
  }

  const accessToken = await getAccessToken();

  const url =
    'https://androidpublisher.googleapis.com/androidpublisher/v3/' +
    `applications/${encodeURIComponent(PACKAGE_NAME)}/` +
    `purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body?.error?.message ||
        `Google Play verification failed (${response.status}).`
    );
  }

  return body;
}

function normalizeSubscription(data, fallbackProductId = '') {
  const lineItem =
    Array.isArray(data?.lineItems) && data.lineItems.length > 0
      ? data.lineItems[0]
      : null;

  const productId = lineItem?.productId || fallbackProductId;
  const expiryDate = lineItem?.expiryTime
    ? new Date(lineItem.expiryTime)
    : null;

  const autoRenew = Boolean(
    lineItem?.autoRenewingPlan?.autoRenewEnabled
  );

  return {
    productId,
    status: mapState(data?.subscriptionState),
    expiryDate,
    autoRenew,
    orderId: data?.latestOrderId || '',
    raw: data || null
  };
}

async function verifySubscription({ purchaseToken, productId }) {
  if (!productId) {
    throw new Error('productId is required.');
  }

  if (TEST_MODE && !isConfigured()) {
    const configuredDays = Number(process.env.PREMIUM_TEST_DAYS || 30);
    const days =
      Number.isFinite(configuredDays) && configuredDays > 0
        ? configuredDays
        : 30;

    return {
      productId,
      status: 'active',
      expiryDate: new Date(Date.now() + days * 86400000),
      autoRenew: false,
      orderId: `TEST-${Date.now()}`,
      testMode: true,
      raw: null
    };
  }

  if (!purchaseToken) {
    throw new Error('purchaseToken is required.');
  }

  const liveData = await fetchSubscription(purchaseToken);
  return normalizeSubscription(liveData, productId);
}

module.exports = {
  PACKAGE_NAME,
  TEST_MODE,
  isConfigured,
  verifySubscription,
  fetchSubscription,
  normalizeSubscription
};
