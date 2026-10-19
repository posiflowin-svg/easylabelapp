// No login prompt; restrict administrative uploads to approved public IPs.
const normalize = value => String(value || '').trim().replace(/^::ffff:/, '');
module.exports = function bulkUploadAccess(req, res, next) {
  const approved = (process.env.TEMPLATE_BULK_ALLOWED_IPS || '')
    .split(',').map(normalize).filter(Boolean);
  const remote = normalize(req.ip);
  if (approved.length && approved.includes(remote)) return next();
  return res.status(403).json({
    success: false, code: 'BULK_UPLOAD_IP_NOT_ALLOWED',
    message: approved.length ? 'Bulk upload is restricted to approved IP addresses.'
      : 'Set TEMPLATE_BULK_ALLOWED_IPS in Render Environment to use password-free bulk upload.',
    detectedIp: remote
  });
};
