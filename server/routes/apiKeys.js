'use strict';
/**
 * API Key Management  /api/api-keys
 * Admin-only CRUD for external KB API keys
 *
 * DB schema: id VARCHAR2(36) PK (UUID), accessible_kbs CLOB, scopes CLOB,
 *            rate_limit_per_min NUMBER, allow_confidential NUMBER(1)
 *
 * 端點:
 *   GET    /api/api-keys                 — 列出所有 key
 *   POST   /api/api-keys                 — 建立(回 raw key,僅此一次)
 *   PATCH  /api/api-keys/:id             — 更新 name/desc/kbs/expires/active/scopes/rate_limit/allow_confidential
 *   DELETE /api/api-keys/:id             — 刪除(連動 usage log CASCADE)
 *   GET    /api/api-keys/:id/usage       — 用量統計(總請求數 / 錯誤率 / 流量 / token / 最近 N 筆)
 *   GET    /api/api-keys/scopes          — 可用 scope 清單 + 說明(給前端 render checkbox)
 */
const express    = require('express');
const router     = express.Router();
const crypto     = require('crypto');
const { randomUUID } = crypto;
const { verifyToken, verifyAdmin } = require('./auth');

router.use(verifyToken);
router.use(verifyAdmin);

function getDb() {
  return require('../database-oracle').db;
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateKey() {
  return (process.env.API_KEY_PREFIX || 'fxlk_') + crypto.randomBytes(24).toString('hex');
}

// ── Scope catalog ────────────────────────────────────────────────────────────
// 對應 externalKb.js 的 requireScope 名稱。前端把這份直接 render 成 checkbox。
// write=true 的 scope 需要搭配 acts_as_user_id;UI 上做醒目標示。
const AVAILABLE_SCOPES = [
  // ── Read ──
  { key: 'kb:read',       label: '讀取 KB 列表',     description: 'GET /api/v1/kb/list',                                            group: 'read',  write: false },
  { key: 'kb:search',     label: '搜尋 KB',          description: 'POST /api/v1/kb/search(語意+全文檢索)',                         group: 'read',  write: false },
  { key: 'kb:chat',       label: 'KB 問答',          description: 'POST /api/v1/kb/chat(會吃 LLM token,記在 KB owner 帳上)',     group: 'read',  write: false },
  { key: 'kb:image:read', label: '讀取/下載圖片',    description: 'POST /api/v1/kb/images/list、GET /api/v1/kb/images/:id',         group: 'read',  write: false },
  // ── Write(必須掛 acts_as_user_id;權限走那個 user 既有 kb_access)──
  { key: 'kb:settings:write',     label: '修改 KB 設定',   description: 'PUT /api/v1/kb/:id(retrieval / parse / tags…)',           group: 'write', write: true },
  { key: 'kb:document:write',     label: '上傳/刪文件',    description: 'POST/DELETE /api/v1/kb/:id/documents',                      group: 'write', write: true },
  { key: 'kb:image:write',        label: '上傳/刪圖片',    description: 'POST/DELETE /api/v1/kb/:id/images',                         group: 'write', write: true },
  { key: 'kb:confidential:write', label: '切換保密狀態',   description: '附加給 settings:write 的 is_confidential 切換權(acts_as 必須是 KB owner)', group: 'write', write: true },
];
const DEFAULT_SCOPES = AVAILABLE_SCOPES.filter((s) => !s.write).map((s) => s.key); // 預設只給 read-only

// 規範化 scopes input → JSON array string
function normalizeScopes(raw) {
  if (raw === undefined || raw === null) return null; // null = 不更新
  if (!Array.isArray(raw)) raw = [];
  const known = new Set(AVAILABLE_SCOPES.map((s) => s.key));
  const valid = raw.filter((s) => typeof s === 'string' && known.has(s));
  return JSON.stringify(valid.length ? valid : DEFAULT_SCOPES);
}

// ── GET /api/api-keys/scopes ─────────────────────────────────────────────────
router.get('/scopes', (_req, res) => {
  res.json({ scopes: AVAILABLE_SCOPES, defaults: DEFAULT_SCOPES });
});

// ── GET /api/api-keys/bindable-users — 列出可當 acts_as_user 的活躍 user ─────
// 給前端下拉選單用。隱藏停用 / 停權的帳號避免 admin 設錯。
router.get('/bindable-users', async (_req, res) => {
  const db = getDb();
  try {
    const users = await db.prepare(`
      SELECT id, username, name, employee_id, dept_name, role
      FROM users
      WHERE status = 'active' OR status IS NULL
      ORDER BY name
    `).all();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/api-keys ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const db = getDb();
  try {
    const keys = await db.prepare(`
      SELECT k.id, k.name, k.key_prefix, k.description,
             k.accessible_kbs AS kb_ids,
             k.scopes, k.rate_limit_per_min, k.allow_confidential,
             k.acts_as_user_id, k.allowed_ips,
             k.is_active, k.expires_at,
             TO_CHAR(k.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
             TO_CHAR(k.last_used_at,'YYYY-MM-DD HH24:MI:SS') AS last_used_at,
             u.name AS created_by_name, u.username AS created_by_username,
             au.name AS acts_as_name, au.username AS acts_as_username
      FROM api_keys k
      LEFT JOIN users u  ON u.id  = k.created_by
      LEFT JOIN users au ON au.id = k.acts_as_user_id
      ORDER BY k.created_at DESC
    `).all();
    // 順手帶最近 24h 用量摘要(讓 list 頁可以看 hot key)
    for (const k of keys) {
      try {
        const stat = await db.prepare(`
          SELECT COUNT(*) AS req, NVL(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END),0) AS errs
          FROM api_key_usage_log
          WHERE api_key_id=? AND called_at >= SYSTIMESTAMP - INTERVAL '1' DAY
        `).get(k.id);
        k.req_24h = Number(stat?.req || 0);
        k.err_24h = Number(stat?.errs || 0);
      } catch { k.req_24h = 0; k.err_24h = 0; }
    }
    res.json(keys);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 規範化 IP allowlist:接受 string[] / null;空 array → null;每筆 trim。
function normalizeIps(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (Array.isArray(raw)) {
    const clean = raw.map((x) => String(x).trim()).filter(Boolean);
    return clean.length ? JSON.stringify(clean) : null;
  }
  // 接受換行分隔字串(textarea 直接送)
  const lines = String(raw).split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  return lines.length ? JSON.stringify(lines) : null;
}

// 寫入 scope 必須搭配 acts_as_user_id — 不然動作沒歸屬,擋下
function requiresActsAs(scopesJson) {
  try {
    const arr = JSON.parse(scopesJson || '[]');
    const writeKeys = AVAILABLE_SCOPES.filter((s) => s.write).map((s) => s.key);
    return Array.isArray(arr) && arr.some((s) => writeKeys.includes(s));
  } catch { return false; }
}

// ── POST /api/api-keys ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const db = getDb();
  const {
    name, description = '', kb_ids = null, expires_at = null,
    scopes, rate_limit_per_min, allow_confidential,
    acts_as_user_id = null, allowed_ips = null,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name 為必填' });
  try {
    const scopesJson = normalizeScopes(scopes) || JSON.stringify(DEFAULT_SCOPES);
    // 寫入 scope 必須掛 acts_as_user_id(沒掛 = 拒絕建立)
    if (requiresActsAs(scopesJson) && !acts_as_user_id) {
      return res.status(400).json({ error: '寫入 scope 必須綁定 acts_as_user(service account)' });
    }
    // 若有 acts_as_user_id,驗該 user 存在且 active
    if (acts_as_user_id) {
      const u = await db.prepare(`SELECT id, status FROM users WHERE id=?`).get(acts_as_user_id);
      if (!u || (u.status && u.status !== 'active')) {
        return res.status(400).json({ error: 'acts_as_user 不存在或已停用' });
      }
    }

    const id     = randomUUID();
    const raw    = generateKey();
    const hash   = hashKey(raw);
    const prefix = raw.slice(0, 12);
    const kbJson = kb_ids?.length ? JSON.stringify(kb_ids) : '["*"]';
    const rpm = Number.isFinite(Number(rate_limit_per_min)) ? Math.max(0, Number(rate_limit_per_min)) : 60;
    const allowConf = allow_confidential ? 1 : 0;
    const ipsJson = normalizeIps(allowed_ips);

    await db.prepare(`
      INSERT INTO api_keys (
        id, name, key_hash, key_prefix, created_by,
        accessible_kbs, description, expires_at,
        scopes, rate_limit_per_min, allow_confidential,
        acts_as_user_id, allowed_ips
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ${expires_at ? "TO_TIMESTAMP(?,'YYYY-MM-DD')" : 'NULL'}, ?, ?, ?, ?, ?)
    `).run(
      id, name.trim(), hash, prefix, req.user.id,
      kbJson, description || null,
      ...(expires_at ? [expires_at] : []),
      scopesJson, rpm, allowConf,
      acts_as_user_id || null,
      ipsJson,
    );
    res.status(201).json({ id, key: raw, prefix });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/api-keys/:id ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const db = getDb();
  const {
    name, description, is_active, kb_ids, expires_at,
    scopes, rate_limit_per_min, allow_confidential,
    acts_as_user_id, allowed_ips,
  } = req.body;
  try {
    // 先抓 current key 狀態,scope / acts_as 改動時要相互驗證
    const current = await db.prepare(`SELECT scopes, acts_as_user_id FROM api_keys WHERE id=?`).get(req.params.id);
    if (!current) return res.status(404).json({ error: 'API key 不存在' });

    const sets   = [];
    const params = [];
    if (name        !== undefined) { sets.push('name=?');           params.push(name); }
    if (description !== undefined) { sets.push('description=?');    params.push(description || null); }
    if (is_active   !== undefined) { sets.push('is_active=?');      params.push(is_active ? 1 : 0); }
    if (kb_ids      !== undefined) { sets.push('accessible_kbs=?'); params.push(kb_ids?.length ? JSON.stringify(kb_ids) : '["*"]'); }
    if (expires_at  !== undefined) { sets.push('expires_at=?');     params.push(expires_at || null); }
    if (scopes      !== undefined) { sets.push('scopes=?');         params.push(normalizeScopes(scopes)); }
    if (rate_limit_per_min !== undefined) {
      const rpm = Number.isFinite(Number(rate_limit_per_min)) ? Math.max(0, Number(rate_limit_per_min)) : 0;
      sets.push('rate_limit_per_min=?'); params.push(rpm);
    }
    if (allow_confidential !== undefined) {
      sets.push('allow_confidential=?'); params.push(allow_confidential ? 1 : 0);
    }
    if (acts_as_user_id !== undefined) {
      if (acts_as_user_id) {
        const u = await db.prepare(`SELECT id, status FROM users WHERE id=?`).get(acts_as_user_id);
        if (!u || (u.status && u.status !== 'active')) return res.status(400).json({ error: 'acts_as_user 不存在或已停用' });
      }
      sets.push('acts_as_user_id=?'); params.push(acts_as_user_id || null);
    }
    if (allowed_ips !== undefined) {
      sets.push('allowed_ips=?'); params.push(normalizeIps(allowed_ips));
    }

    // 交叉驗證:更新後若仍有 write scope 但沒 acts_as_user_id,擋下
    const nextScopes  = scopes      !== undefined ? normalizeScopes(scopes) : current.scopes;
    const nextActsAs  = acts_as_user_id !== undefined ? (acts_as_user_id || null) : current.acts_as_user_id;
    if (requiresActsAs(nextScopes) && !nextActsAs) {
      return res.status(400).json({ error: '此 key 含寫入 scope,必須同步設定 acts_as_user' });
    }

    if (!sets.length) return res.status(400).json({ error: '無可更新欄位' });
    params.push(req.params.id);
    await db.prepare(`UPDATE api_keys SET ${sets.join(', ')} WHERE id=?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/api-keys/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const db = getDb();
  try {
    // usage log 走 FK CASCADE,這裡只刪 key 本身
    await db.prepare('DELETE FROM api_keys WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/api-keys/:id/usage ──────────────────────────────────────────────
// query: ?days=7&limit=50
router.get('/:id/usage', async (req, res) => {
  const db = getDb();
  try {
    const days  = Math.min(90, Math.max(1, Number(req.query.days)  || 7));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));

    const summary = await db.prepare(`
      SELECT
        COUNT(*)                                            AS req_total,
        NVL(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS req_errors,
        NVL(SUM(tokens_in),  0)                             AS tokens_in,
        NVL(SUM(tokens_out), 0)                             AS tokens_out,
        NVL(SUM(bytes_out),  0)                             AS bytes_out,
        NVL(ROUND(AVG(duration_ms)), 0)                     AS avg_ms
      FROM api_key_usage_log
      WHERE api_key_id=? AND called_at >= SYSTIMESTAMP - NUMTODSINTERVAL(?, 'DAY')
    `).get(req.params.id, days);

    const byEndpoint = await db.prepare(`
      SELECT endpoint, method, COUNT(*) AS cnt,
             NVL(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS errs
      FROM api_key_usage_log
      WHERE api_key_id=? AND called_at >= SYSTIMESTAMP - NUMTODSINTERVAL(?, 'DAY')
      GROUP BY endpoint, method
      ORDER BY cnt DESC
    `).all(req.params.id, days);

    const recent = await db.prepare(`
      SELECT l.endpoint, l.method, l.status_code, l.kb_id, l.tokens_in, l.tokens_out,
             l.bytes_out, l.duration_ms,
             l.acts_as_user_id, l.client_ip, l.resource_id, l.error_message,
             TO_CHAR(l.called_at,'YYYY-MM-DD HH24:MI:SS') AS called_at,
             u.name AS acts_as_name, u.username AS acts_as_username,
             k.name AS kb_name
      FROM api_key_usage_log l
      LEFT JOIN users u ON u.id = l.acts_as_user_id
      LEFT JOIN knowledge_bases k ON k.id = l.kb_id
      WHERE l.api_key_id=?
      ORDER BY l.called_at DESC
      FETCH FIRST ${limit} ROWS ONLY
    `).all(req.params.id);

    res.json({
      days, limit,
      summary: {
        req_total:  Number(summary?.req_total  || 0),
        req_errors: Number(summary?.req_errors || 0),
        tokens_in:  Number(summary?.tokens_in  || 0),
        tokens_out: Number(summary?.tokens_out || 0),
        bytes_out:  Number(summary?.bytes_out  || 0),
        avg_ms:     Number(summary?.avg_ms     || 0),
      },
      by_endpoint: byEndpoint,
      recent,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
