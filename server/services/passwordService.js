'use strict';

/**
 * 統一封裝密碼 hash / verify。
 *
 * 設計:
 *   - bcrypt cost=12(2026 標準,單次 ~250ms)
 *   - hash 字串包含演算法 + cost,未來換 algo 不影響舊 hash
 *   - verify() 接受 hash 或明文(過渡期 lazy migration 用),呼叫端用
 *     isHashed() 判斷是否為已 hash 字串
 *
 * Lazy migration:
 *   過渡期 users.password 可能是明文或 bcrypt hash。透過搭配 users.password_hashed
 *   旗標(Y/N)判斷。比 isHashed() regex 更嚴謹(避免使用者真實密碼剛好長得像 hash)。
 */

const bcrypt = require('bcrypt');

const COST = parseInt(process.env.BCRYPT_COST || '12', 10);

/**
 * Hash 一個明文密碼。
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash(60 字符)
 */
async function hash(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('passwordService.hash: plaintext required');
  }
  return bcrypt.hash(plaintext, COST);
}

/**
 * 驗證明文密碼是否符合 bcrypt hash。
 * @param {string} plaintext
 * @param {string} hashed bcrypt hash 字串
 * @returns {Promise<boolean>}
 */
async function verify(plaintext, hashed) {
  if (!plaintext || !hashed) return false;
  try {
    return await bcrypt.compare(plaintext, hashed);
  } catch (e) {
    // hashed 不是合法 bcrypt 字串 → 視為不符
    return false;
  }
}

/**
 * 判斷一個字串「看起來像」bcrypt hash。
 * bcrypt hash 形如 $2[abxy]$<cost>$<22 字 salt><31 字 hash>,共 60 字。
 * 用於 defensive check,正常流程依賴 users.password_hashed 欄位即可。
 */
function isHashed(s) {
  return typeof s === 'string' && /^\$2[abxy]\$\d{2}\$/.test(s) && s.length === 60;
}

module.exports = { hash, verify, isHashed, COST };
