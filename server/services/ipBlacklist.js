'use strict';

/**
 * IP Blacklist — 外網 anti-bot 防線
 *
 * 來源:
 *   - manual:admin 手動加(可永久)
 *   - auto_failure:同 IP 1hr 失敗達閾值自動加(預設 24hr)
 *   - auto_ua:User-Agent 命中黑名單自動加(預設 7 天)
 *
 * Redis cache:
 *   bl:ip:{ip}  TTL = expires_at 或 max
 *   讀取走 cache,DB 為 source of truth(admin 手動 add/remove 同步刷 cache)
 *
 * 內網 IP 永遠不被擋 — middleware 的 isInternal 檢查在 blacklist 之前
 */

const redisClient = require('./redisClient');

const KEY_BL = (ip) => `bl:ip:${ip}`;
const NEGATIVE_CACHE_TTL = 60;  // 不在黑名單的 IP cache 60 秒,降低 DB 查詢頻率
const VAL_BLOCKED = '1';
const VAL_NOT_BLOCKED = '0';

const cfg = () => ({
  autoFailureBlockHours: parseInt(process.env.ANTI_BOT_FAIL_BLOCK_HOURS || '24', 10),
  autoUaBlockDays:       parseInt(process.env.ANTI_BOT_UA_BLOCK_DAYS || '7', 10),
});

// ── UA 黑名單 — 已知滲透 / 掃描工具 ──────────────────────────────
// 不擋 curl / wget / python-requests(K8s probe / monitoring 也用,誤殺風險高)
const UA_BLACKLIST_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /\bnmap\b/i,
  /masscan/i,
  /\bzmap\b/i,
  /dirbuster/i,
  /gobuster/i,
  /wpscan/i,
  /hydra/i,
  /metasploit/i,
  /burp\s*suite|burpcollaborator/i,
  /acunetix/i,
  /nessus/i,
  /openvas/i,
  /\bw3af\b/i,
  /skipfish/i,
];

/** UA 字串是否命中黑名單模式 */
function matchUaBlacklist(ua) {
  if (!ua || typeof ua !== 'string') return null;
  for (const re of UA_BLACKLIST_PATTERNS) {
    if (re.test(ua)) return re.source;
  }
  return null;
}

// ── DB CRUD ─────────────────────────────────────────────────────────

async function dbAdd(db, { ip, reason, source, createdBy, ttlHours }) {
  const expiresExpr = ttlHours
    ? `SYSTIMESTAMP + NUMTODSINTERVAL(${Number(ttlHours)}, 'HOUR')`
    : 'NULL';
  // UPSERT 模式:既有 IP 直接更新 reason / expires_at(延長 / 變更原因)
  const existing = await db.prepare(`SELECT id FROM ip_blacklist WHERE ip = ?`).get(ip);
  if (existing) {
    await db.prepare(
      `UPDATE ip_blacklist SET reason = ?, source = ?, created_by = ?, expires_at = ${expiresExpr}
       WHERE id = ?`
    ).run(reason || null, source || 'manual', createdBy || null, existing.id);
    return existing.id;
  }
  const r = await db.prepare(
    `INSERT INTO ip_blacklist (ip, reason, source, created_by, expires_at)
     VALUES (?, ?, ?, ?, ${expiresExpr})`
  ).run(ip, reason || null, source || 'manual', createdBy || null);
  return r.lastInsertRowid;
}

async function dbRemove(db, ip) {
  const r = await db.prepare(`DELETE FROM ip_blacklist WHERE ip = ?`).run(ip);
  return r.changes || 0;
}

async function dbList(db, { activeOnly = false, source } = {}) {
  let sql = `SELECT bl.id, bl.ip, bl.reason, bl.source, bl.created_by, bl.created_at, bl.expires_at,
                    u.username AS created_by_username, u.name AS created_by_name
             FROM ip_blacklist bl
             LEFT JOIN users u ON bl.created_by = u.id
             WHERE 1=1`;
  const params = [];
  if (activeOnly) sql += ` AND (bl.expires_at IS NULL OR bl.expires_at > SYSTIMESTAMP)`;
  if (source) { sql += ` AND bl.source = ?`; params.push(source); }
  sql += ` ORDER BY bl.created_at DESC FETCH FIRST 500 ROWS ONLY`;
  return db.prepare(sql).all(...params);
}

async function dbCheck(db, ip) {
  const row = await db.prepare(
    `SELECT id, expires_at, reason FROM ip_blacklist
     WHERE ip = ? AND (expires_at IS NULL OR expires_at > SYSTIMESTAMP)
     FETCH FIRST 1 ROWS ONLY`
  ).get(ip);
  return row || null;
}

// ── Cache + 對外 API ───────────────────────────────────────────────

async function isBlacklisted(ip) {
  if (!ip) return false;
  // Redis cache
  const cached = await redisClient.getSharedValue(KEY_BL(ip));
  if (cached === VAL_BLOCKED) return true;
  if (cached === VAL_NOT_BLOCKED) return false;
  // Cache miss → 查 DB
  const db = require('../database-oracle').db;
  const row = await dbCheck(db, ip);
  if (row) {
    // 算 TTL:有 expires_at 則用差值,否則 1 hr 重查
    const ttl = row.expires_at
      ? Math.max(60, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000))
      : 3600;
    await redisClient.setSharedValue(KEY_BL(ip), VAL_BLOCKED, ttl);
    return true;
  }
  await redisClient.setSharedValue(KEY_BL(ip), VAL_NOT_BLOCKED, NEGATIVE_CACHE_TTL);
  return false;
}

async function add({ ip, reason, source = 'manual', createdBy = null, ttlHours = null }) {
  if (!ip) throw new Error('ip required');
  const db = require('../database-oracle').db;
  const id = await dbAdd(db, { ip, reason, source, createdBy, ttlHours });
  // 刷 cache:寫入 ttlHours 對應秒數,沒設(永久)用 24 hr 重查間隔
  const ttl = ttlHours ? Math.floor(Number(ttlHours) * 3600) : 24 * 3600;
  await redisClient.setSharedValue(KEY_BL(ip), VAL_BLOCKED, ttl);
  console.warn(`[IpBlacklist] ADD ip=${ip} source=${source} reason="${reason || ''}" ttl=${ttlHours || 'permanent'}h`);
  return id;
}

async function remove(ip) {
  if (!ip) return 0;
  const db = require('../database-oracle').db;
  const n = await dbRemove(db, ip);
  // 清 cache(設 short negative cache 防 race)
  await redisClient.setSharedValue(KEY_BL(ip), VAL_NOT_BLOCKED, NEGATIVE_CACHE_TTL);
  console.log(`[IpBlacklist] REMOVE ip=${ip} affected=${n}`);
  return n;
}

async function list(opts) {
  const db = require('../database-oracle').db;
  return dbList(db, opts);
}

// Fire-and-forget add(同 IP 失敗達閾值 / UA 命中時呼用)
function addAsync(opts) {
  add(opts).catch(e => console.warn(`[IpBlacklist] addAsync failed: ${e.message}`));
}

module.exports = {
  cfg,
  matchUaBlacklist,
  UA_BLACKLIST_PATTERNS,
  isBlacklisted,
  add,
  addAsync,
  remove,
  list,
};
