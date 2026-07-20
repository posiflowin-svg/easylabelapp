module.exports = function adminOnly(req, res, next) {
  const configuredSecret = process.env.AI_CREDIT_WEBHOOK_SECRET;
  const suppliedSecret = req.get('x-ai-credit-secret');
  const sessionAllowed = Boolean(req.session && req.session.adminAuthenticated);
  const secretAllowed = Boolean(configuredSecret && suppliedSecret === configuredSecret);

  if (sessionAllowed || secretAllowed) return next();

  return res.status(401).json({
    success: false,
    code: 'ADMIN_AUTH_REQUIRED',
    message: 'Administrator authentication is required.'
  });
};
