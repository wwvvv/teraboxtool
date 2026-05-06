const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const JWT_EXPIRES_IN = '7d';
const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');

function getJwtSecret() {
  const settings = _loadSettingsRaw();
  if (settings._jwtSecret) return settings._jwtSecret;
  const secret = crypto.randomBytes(32).toString('hex');
  settings._jwtSecret = secret;
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch {}
  return secret;
}

function _loadSettingsRaw() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  return {};
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hashed) {
  if (!hashed) return false;
  if (hashed.startsWith('$2')) {
    return bcrypt.compareSync(password, hashed);
  }
  const legacyHash = crypto.createHash('sha256').update(password + '__teratool__').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(hashed));
}

function generateToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  let token = null;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    token = auth.slice(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: '登录已过期' });
  }
  next();
}

module.exports = { hashPassword, verifyPassword, generateToken, verifyToken, authMiddleware };