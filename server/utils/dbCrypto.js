'use strict';

const crypto = require('crypto');

function _deriveKey() {
  const secret = process.env.DASHBOARD_DB_SECRET || process.env.JWT_SECRET || 'foxlink-db-secret-key';
  return crypto.scryptSync(secret, 'foxlink-db-salt-v1', 32);
}

function encryptPassword(plain) {
  if (!plain) return '';
  const key = _deriveKey();
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptPassword(enc) {
  if (!enc) return '';
  try {
    const [ivHex, tagHex, encHex] = enc.split(':');
    const key      = _deriveKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8');
  } catch {
    return '';
  }
}

module.exports = { encryptPassword, decryptPassword };
