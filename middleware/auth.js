const jwt = require('jsonwebtoken');

function getJwtSecret() {
  return process.env.SESSION_SECRET || 'axomprep-dev-secret-change-me';
}

function requireAuth(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { requireAuth };
