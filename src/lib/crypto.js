const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_FILE = require('path').join(__dirname, '..', '..', 'data', '.key');

function getOrGenerateKey() {
  const fs = require('fs');
  const dir = require('path').dirname(KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE, 'utf8').trim();
  }
  const key = crypto.randomBytes(KEY_LENGTH).toString('base64');
  fs.writeFileSync(KEY_FILE, key, 'utf8');
  return key;
}

function _deriveKey() {
  const raw = getOrGenerateKey();
  return crypto.scryptSync(raw, 'teratool_salt_v1', KEY_LENGTH);
}

function encrypt(text) {
  if (!text || text.startsWith('enc:')) return text;
  const key = _deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decrypt(ciphertext) {
  if (!ciphertext || !ciphertext.startsWith('enc:')) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length !== 4) return ciphertext;
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const encrypted = parts[3];
  const key = _deriveKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const ENCRYPTED_KEYS = ['wpPassword', 'teraboxCookie', 'teraboxJsToken', 'teraboxBdstoken'];

function decryptSettings(settings) {
  const result = { ...settings };
  for (const key of ENCRYPTED_KEYS) {
    if (result[key] && typeof result[key] === 'string') {
      result[key] = decrypt(result[key]);
    }
  }
  return result;
}

function encryptSettings(settings) {
  const result = { ...settings };
  for (const key of ENCRYPTED_KEYS) {
    if (result[key] && typeof result[key] === 'string' && !result[key].startsWith('enc:')) {
      result[key] = encrypt(result[key]);
    }
  }
  return result;
}

module.exports = { encrypt, decrypt, encryptSettings, decryptSettings, ENCRYPTED_KEYS, getOrGenerateKey };