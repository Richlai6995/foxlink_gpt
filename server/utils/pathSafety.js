'use strict';

/**
 * 上傳路徑與檔名安全工具(2026-05-09 path-traversal hardening)。
 *
 * 用途:multer storage 的 destination / filename 與 handler 內,
 *      把 req.params.id 之類「會直接拼進檔案路徑」的字串擋住 traversal。
 *
 * 防禦面:
 *   1. 攻擊者送 :id = "../../etc" → escape 出 upload root
 *   2. originalname = "evil.svg" 但 mimetype 偽稱 image/png → SVG XSS
 *   3. originalname = "shell.php.jpg" → NUL byte truncation(Node 18+ 已防,但留意)
 */

const path = require('path');

const NUMERIC_ID_RE = /^\d+$/;
const ALPHA_ID_RE   = /^[A-Za-z0-9_\-]{1,64}$/;

/**
 * 驗證一個 path component 是「純數字 ID」(常用於 DB primary key 從 URL 來)。
 * @param {*} v
 * @returns {boolean}
 */
function isNumericId(v) {
  return typeof v === 'string' && NUMERIC_ID_RE.test(v) && v.length <= 16;
}

/**
 * 驗證一個 path component 是 alphanumeric + `_-`(支援 UUID-like)。
 * @param {*} v
 * @returns {boolean}
 */
function isSafeId(v) {
  return typeof v === 'string' && ALPHA_ID_RE.test(v);
}

/**
 * Express middleware factory:擋住非數字 ID。
 * 用在 multer middleware **之前**,避免不合法 :id 觸發 destination cb 寫到任意目錄。
 *
 *   router.post('/:id/upload', requireNumericParam('id'), upload.single(...), handler);
 */
function requireNumericParam(...names) {
  return (req, res, next) => {
    for (const name of names) {
      if (!isNumericId(req.params[name])) {
        return res.status(400).json({ error: `Invalid ${name}` });
      }
    }
    next();
  };
}

/**
 * 安全副檔名 whitelist 抽取。沒命中 whitelist 回 null(handler / fileFilter 應 reject)。
 *
 *   safeExtension('evil.svg', ['.png','.jpg','.webp'])  // null
 *   safeExtension('photo.PNG', ['.png','.jpg'])         // '.png'(已 lowercase)
 *
 * @param {string} originalname
 * @param {string[]} allowed   小寫副檔名陣列(含點)
 * @returns {string|null}
 */
function safeExtension(originalname, allowed) {
  if (typeof originalname !== 'string') return null;
  // 用最後一個點起算(避免 'foo.bar.tar.gz' 抓到 .gz 但不在 allowed 時通過)
  const ext = path.extname(originalname).toLowerCase();
  if (!ext) return null;
  return allowed.includes(ext) ? ext : null;
}

/**
 * 驗證最終算出來的絕對路徑「沒有 escape」指定的 root 目錄。
 * 雙重防護用:即使 sanitize 漏網,這層仍能擋。
 *
 *   ensureWithinRoot('/app/uploads', '/app/uploads/kb/123/x.pdf')  // true
 *   ensureWithinRoot('/app/uploads', '/app/etc/passwd')            // false
 *
 * @param {string} rootDir   絕對路徑 root
 * @param {string} fullPath  要檢查的絕對路徑
 * @returns {boolean}
 */
function ensureWithinRoot(rootDir, fullPath) {
  const root = path.resolve(rootDir);
  const full = path.resolve(fullPath);
  // 加 path.sep 防 'rootDir2' 比對到 'rootDir' 字首誤判
  return full === root || full.startsWith(root + path.sep);
}

module.exports = {
  isNumericId,
  isSafeId,
  requireNumericParam,
  safeExtension,
  ensureWithinRoot,
};
