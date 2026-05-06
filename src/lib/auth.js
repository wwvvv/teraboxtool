const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = '7d';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + '__teratool__').digest('hex');
}

function verifyPassword(password, hashed) {
  return hashPassword(password) === hashed;
}

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = auth.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: '登录已过期' });
  }
  next();
}

module.exports = { hashPassword, verifyPassword, generateToken, verifyToken, authMiddleware, JWT_SECRET };