'use strict';
/**
 * AES-256-GCM encrypt/decrypt for LLM API keys stored in DB.
 * Secret key: env LLM_KEY_SECRET (64 hex chars = 32 bytes).
 * Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function getSecret() {
  const raw = process.env.LLM_KEY_SECRET || '';
  if (raw.length === 64) return Buffer.from(raw, 'hex');
  // Auto-derive from JWT_SECRET if LLM_KEY_SECRET not set (convenient for dev)
  const fallback = process.env.JWT_SECRET || 'foxlink_llm_key_secret_default';
  return crypto.createHash('sha256').update(fallback).digest(); // 32 bytes
}

/**
 * Encrypt a plaintext API key.
 * Returns "<iv>:<tag>:<ciphertext>" (all hex).
 */
function encryptKey(plaintext) {
  if (!plaintext) return null;
  const key = getSecret();
  const iv  = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt stored "<iv>:<tag>:<ciphertext>" back to plaintext.
 * Returns null if input is empty or invalid.
 */
function decryptKey(stored) {
  if (!stored) return null;
  try {
    const parts = stored.split(':');
    if (parts.length !== 3) return stored; // Legacy plaintext fallback
    const [ivHex, tagHex, ctHex] = parts;
    const key    = getSecret();
    const iv     = Buffer.from(ivHex, 'hex');
    const tag    = Buffer.from(tagHex, 'hex');
    const ct     = Buffer.from(ctHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct) + decipher.final('utf8');
  } catch {
    return null;
  }
}

/**
 * Mask a key for display: show first 6 chars + "●●●●●●".
 */
function maskKey(stored) {
  if (!stored) return '';
  return '●●●●●●●●●●●●';
}

module.exports = { encryptKey, decryptKey, maskKey };
