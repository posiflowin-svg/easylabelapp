// Bulk uploads require either a verified, approved client IP or a private
// capability link. No password form is needed. Do not trust arbitrary forwarded
// IP headers or allow an entire shared Cloudflare IP range.
const crypto = require('crypto');
const net = require('net');
const normalize = value => String(value || '').trim().replace(/^::ffff:/, '');
const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
module.exports = function bulkUploadAccess(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const approved = (process.env.TEMPLATE_BULK_ALLOWED_IPS || '')
    .split(',').map(normalize).filter(Boolean);
  // Express req.ip is derived from the configured trust-proxy policy.
  // Do not use CF-Connecting-IP or the first X-Forwarded-For entry without
  // validating the complete chain of trusted proxies.
  const remote = normalize(req.ip);
  if (net.isIP(remote) && approved.includes(remote)) return next();
  const configuredToken = String(process.env.TEMPLATE_BULK_ACCESS_TOKEN || '');
  const supplied = req.method === 'GET' ? String(req.query.access || '')
    : String(req.get('X-Template-Bulk-Token') || '');
  if (configuredToken.length >= 32 && supplied.length >= 32 &&
      supplied.length <= 512 && safeEqual(configuredToken, supplied)) return next();
  return res.status(403).json({
    success: false, code: 'BULK_UPLOAD_ACCESS_DENIED',
    message: 'Upload requires an approved IP or a private access link. Set TEMPLATE_BULK_ACCESS_TOKEN (32+ random characters) in Render and open /api/template-bulk/admin?access=YOUR_TOKEN.',
    detectedIp: remote
  });
};
