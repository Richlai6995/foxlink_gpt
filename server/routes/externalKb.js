'use strict';
/**
 * External KB API  /api/v1
 * Public access via API key — no session required.
 *
 * 端點(scope 標在右側):
 *   GET    /api/v1/openapi.json               (任意)        自描述
 *   GET    /api/v1/kb/list                    kb:read       列出可存取 KB
 *   POST   /api/v1/kb/search                  kb:search     搜尋 KB
 *   POST   /api/v1/kb/chat                    kb:chat       單輪 KB 問答
 *   POST   /api/v1/kb/images/list             kb:image:read 列 KB 圖片
 *   GET    /api/v1/kb/images/:imageId         kb:image:read 下載圖片
 *
 * Auth: Authorization: Bearer <api-key>
 *
 * 注意事項:
 *   1) 保密 KB(is_confidential=1)— 預設拒絕;呼叫端的 api_keys.allow_confidential=1
 *      才可看(由 admin 顯式勾)。即使白名單列了保密 KB,沒這個旗標也一樣擋。
 *   2) Rate limit:per-key-per-minute(api_keys.rate_limit_per_min,預設 60,0=不限)。
 *      用 redisClient.incrSharedValue 做 sliding 1-min bucket(支援多 pod)。
 *   3) Usage log:每個 request 完成後 fire-and-forget INSERT 一筆到 api_key_usage_log。
 *      包含 endpoint/status/tokens/bytes/duration,給 admin 用量分析用。
 */
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const net     = require('net');
const path    = require('path');
const fs      = require('fs');
const { upsertTokenUsage } = require('../services/tokenService');
const { isSafeId, ensureWithinRoot } = require('../utils/pathSafety');
const { incrSharedValue } = require('../services/redisClient');
const knowledgeBase = require('./knowledgeBase'); // 共用 internal handlers + multer

function getDb() {
  return require('../database-oracle').db;
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

const UPLOAD_BASE = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

// 預設 scopes(legacy key 沒填欄位時當這份)— read-only。寫入 scope 必須 admin 顯式勾。
const DEFAULT_SCOPES = ['kb:read', 'kb:search', 'kb:chat', 'kb:image:read'];

// 凡是寫入操作的 scope:必須搭配 acts_as_user_id 才能呼叫(否則動作無歸屬)
const WRITE_SCOPES = new Set([
  'kb:document:write',
  'kb:image:write',
  'kb:settings:write',
  'kb:confidential:write', // is_confidential 切換獨立 scope(對齊 internal owner-only 規則)
]);

// ── IP allowlist 工具 ────────────────────────────────────────────────────────
// 支援單一 IP 或 CIDR(IPv4/IPv6)。簡單實作:解析後比對 prefix bits。
function ipMatchesCidr(ip, cidr) {
  if (!ip || !cidr) return false;
  if (!cidr.includes('/')) return ip === cidr;
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits)) return false;
  const ipBuf   = ipToBuffer(ip);
  const baseBuf = ipToBuffer(base);
  if (!ipBuf || !baseBuf || ipBuf.length !== baseBuf.length) return false;
  const fullBytes = Math.floor(bits / 8);
  const tailBits  = bits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (ipBuf[i] !== baseBuf[i]) return false;
  }
  if (tailBits === 0) return true;
  const mask = 0xff << (8 - tailBits) & 0xff;
  return (ipBuf[fullBytes] & mask) === (baseBuf[fullBytes] & mask);
}
function ipToBuffer(ip) {
  if (net.isIPv4(ip)) {
    return Buffer.from(ip.split('.').map((x) => Number(x)));
  }
  if (net.isIPv6(ip)) {
    // 展開 :: 與短碼 — 用 Buffer of 16 bytes
    try {
      const parts = ip.split(':');
      const fill = 8 - parts.filter((x) => x !== '').length;
      const expanded = [];
      for (const p of parts) {
        if (p === '') {
          for (let i = 0; i < fill; i++) expanded.push('0');
        } else expanded.push(p);
      }
      while (expanded.length < 8) expanded.push('0');
      const buf = Buffer.alloc(16);
      for (let i = 0; i < 8; i++) {
        const v = parseInt(expanded[i], 16) || 0;
        buf[i * 2]     = (v >> 8) & 0xff;
        buf[i * 2 + 1] = v & 0xff;
      }
      return buf;
    } catch { return null; }
  }
  return null;
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  let ip = xff ? String(xff).split(',')[0].trim() : (req.ip || req.connection?.remoteAddress || '');
  // IPv4-mapped IPv6(`::ffff:10.x.x.x`)→ 取 IPv4 部分,避免跟 IPv4 CIDR 比對時 byte 長度不同被誤擋
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

// chat 接受的 model 名稱白名單 — 防止 caller 塞昂貴 / 不存在的 model 進來。
// gemini-*  → Vertex / Studio 系列(含 gemini-3.x-pro-preview / gemini-2.5-flash / gemini-3-flash)
const CHAT_MODEL_RE = /^gemini-[0-9a-z._-]+$/i;

// ── Usage log helper ─────────────────────────────────────────────────────────
function logUsage(db, apiKeyId, fields) {
  const {
    endpoint, method, status, kbId, tIn, tOut, bytesOut, durationMs,
    actsAsUserId, clientIp: ip, resourceId, errorMessage,
  } = fields || {};
  // fire-and-forget — 寫不到也不要擋 response
  try {
    db.prepare(`
      INSERT INTO api_key_usage_log (
        api_key_id, endpoint, method, status_code, kb_id,
        tokens_in, tokens_out, bytes_out, duration_ms,
        acts_as_user_id, client_ip, resource_id, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apiKeyId,
      (endpoint || '').slice(0, 100),
      (method   || '').slice(0, 10),
      Number.isFinite(status) ? status : null,
      kbId || null,
      Number(tIn)  || 0,
      Number(tOut) || 0,
      Number(bytesOut) || 0,
      Number(durationMs) || 0,
      actsAsUserId != null ? Number(actsAsUserId) : null,
      ip ? String(ip).slice(0, 45) : null,
      resourceId ? String(resourceId).slice(0, 200) : null,
      errorMessage ? String(errorMessage).slice(0, 500) : null,
    ).catch(() => {});
  } catch (_) {}
}

// 從 req/body 抽 resource_id(次級資源)— 給 owner 稽核「誰刪/改了我的什麼」
function extractResourceId(req, body) {
  // 路徑帶的 docId / imageId 優先(對應大部分寫操作)
  if (req.params?.docId)   return `doc:${req.params.docId}`;
  if (req.params?.imageId) return `image:${req.params.imageId}`;
  // 上傳:multer 多檔,取第一個檔名(完整列表會在 res body)
  if (req.files?.length) {
    const buf = req.files[0].originalname;
    const name = buf ? Buffer.from(buf, 'latin1').toString('utf8') : '';
    return req.files.length > 1 ? `upload:${name} +${req.files.length - 1}` : `upload:${name}`;
  }
  // batch-delete:body.ids
  if (Array.isArray(req.body?.ids) && req.body.ids.length) {
    const ids = req.body.ids;
    return ids.length > 3
      ? `batch:${ids.slice(0, 3).join(',')}...(+${ids.length - 3})`
      : `batch:${ids.join(',')}`;
  }
  // image download
  if (req.params?.imageId === undefined && body?.image_id) return `image:${body.image_id}`;
  return null;
}

// ── API Key middleware ───────────────────────────────────────────────────────
async function requireApiKey(req, res, next) {
  const db = getDb();
  const authHeader = req.headers['authorization'] || '';
  const raw = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!raw) return res.status(401).json({ error: 'Missing API key' });

  try {
    const hash = hashKey(raw);
    const apiKey = await db.prepare(`
      SELECT id, name, accessible_kbs, is_active, expires_at,
             scopes, rate_limit_per_min, allow_confidential,
             acts_as_user_id, allowed_ips
      FROM api_keys
      WHERE key_hash = ?
    `).get(hash);

    if (!apiKey)           return res.status(401).json({ error: 'Invalid API key' });
    if (!apiKey.is_active) return res.status(403).json({ error: 'API key is disabled' });
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      return res.status(403).json({ error: 'API key has expired' });
    }

    // IP allowlist(若有設):來源 IP 必須在 CIDR 內。空 list / 不存在 = 不限。
    if (apiKey.allowed_ips) {
      let cidrs = [];
      try { cidrs = JSON.parse(apiKey.allowed_ips); } catch {}
      if (Array.isArray(cidrs) && cidrs.length > 0) {
        const ip = clientIp(req);
        const ok = cidrs.some((c) => ipMatchesCidr(ip, String(c).trim()));
        if (!ok) {
          logUsage(db, apiKey.id, {
            endpoint: req.path, method: req.method, status: 403, durationMs: 0,
            clientIp: ip, errorMessage: 'IP not allowed',
          });
          return res.status(403).json({ error: 'IP not allowed' });
        }
      }
    }

    // KB 白名單:["*"] 或 null = 全部可存取的 KB;[id1, id2] = 指定 KBs
    let parsed = null;
    try { parsed = JSON.parse(apiKey.accessible_kbs || '["*"]'); } catch { parsed = ['*']; }
    req.apiKey       = apiKey;
    req.allowedKbIds = (parsed.includes('*') || parsed.includes(0)) ? null : parsed;
    req.apiKeyScopes = (() => {
      try {
        const s = JSON.parse(apiKey.scopes || '[]');
        return Array.isArray(s) && s.length ? s : DEFAULT_SCOPES;
      } catch { return DEFAULT_SCOPES; }
    })();
    req.allowConfidential = Number(apiKey.allow_confidential) === 1;

    // 解析 acts_as_user(寫入操作必備)— 若有設,撈完整 user 物件給 internal handler 用
    if (apiKey.acts_as_user_id) {
      const user = await db.prepare(`
        SELECT id, role, name, username, dept_code, dept_name,
               profit_center, profit_center_name, org_section, org_section_name,
               org_group_name, role_id, factory_code, can_create_kb,
               kb_max_size_mb, kb_max_count, status
        FROM users WHERE id=?
      `).get(apiKey.acts_as_user_id);
      if (!user || user.status === 'inactive') {
        logUsage(db, apiKey.id, {
          endpoint: req.path, method: req.method, status: 403, durationMs: 0,
          clientIp: clientIp(req), errorMessage: 'acts_as user not found or inactive',
        });
        return res.status(403).json({ error: 'acts_as user not found or inactive' });
      }
      req.actsAsUser = user;
    }

    // Rate limit(per-key-per-minute)— 用 1-min bucket;0 = 不限
    const rpm = Number(apiKey.rate_limit_per_min);
    if (Number.isFinite(rpm) && rpm > 0) {
      try {
        const bucketKey = `apikey-rl:${apiKey.id}:${Math.floor(Date.now() / 60000)}`;
        const cnt = await incrSharedValue(bucketKey, 65); // TTL 比窗口長一點防 race
        if (cnt > rpm) {
          res.setHeader('Retry-After', '60');
          res.setHeader('X-RateLimit-Limit', String(rpm));
          res.setHeader('X-RateLimit-Remaining', '0');
          logUsage(db, apiKey.id, {
            endpoint: req.path, method: req.method, status: 429, durationMs: 0,
            actsAsUserId: req.actsAsUser?.id || null,
            clientIp: clientIp(req), errorMessage: `Rate limit exceeded (${rpm}/min)`,
          });
          return res.status(429).json({ error: 'Rate limit exceeded', limit: rpm, window_seconds: 60 });
        }
        res.setHeader('X-RateLimit-Limit', String(rpm));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rpm - cnt)));
      } catch (e) {
        // rate limit 失敗不擋請求(fail open),只記 log
        console.warn('[ExternalKB] rate limit check failed:', e.message);
      }
    }

    // Update last_used_at(fire-and-forget;await Promise 不擋主流程)
    db.prepare(`UPDATE api_keys SET last_used_at = SYSTIMESTAMP WHERE id = ?`)
      .run(apiKey.id)
      .catch(() => {});

    // 解析來源 IP 一次,後面 logUsage 跟 IP allowlist 共用
    const reqIp = clientIp(req);
    req._cachedClientIp = reqIp;

    // 包 res.json 自動記 usage log。所有寫入操作 / 失敗回應都會經過這層,
    // 失敗時從 body.error 拉錯誤訊息,acts_as / resource_id / IP 也一起塞進去。
    const startedAt = Date.now();
    const origJson = res.json.bind(res);
    res.json = (body) => {
      const status   = res.statusCode || 200;
      const bytesOut = Buffer.byteLength(JSON.stringify(body || ''), 'utf8');
      const errMsg   = status >= 400 ? (body && (body.error || body.message)) : null;
      logUsage(db, apiKey.id, {
        endpoint:     req.path,
        method:       req.method,
        status,
        kbId:         (req.body && (req.body.kb_id || req.body.kbId)) || (req.params && req.params.kbId) || null,
        tIn:          res.locals?.tokensIn  || 0,
        tOut:         res.locals?.tokensOut || 0,
        bytesOut,
        durationMs:   Date.now() - startedAt,
        actsAsUserId: req.actsAsUser?.id || null,
        clientIp:     reqIp,
        resourceId:   res.locals?.resourceId || extractResourceId(req, body),
        errorMessage: errMsg,
      });
      return origJson(body);
    };

    next();
  } catch (e) {
    console.error('[ExternalKB] API key check failed:', e.message);
    res.status(500).json({ error: e.message });
  }
}

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKeyScopes?.includes(scope)) {
      return res.status(403).json({ error: `Missing scope: ${scope}` });
    }
    next();
  };
}

// 任何寫入端點都必須 acts_as 一個 real user — 這是 service-account 模式的核心。
// 沒掛 acts_as_user_id 的 key 拿不到寫入權限,即使 scope 對。
function requireActsAsUser(req, res, next) {
  if (!req.actsAsUser) {
    return res.status(403).json({
      error: 'This operation requires API key with acts_as_user_id; ask admin to bind a service user',
    });
  }
  next();
}

// 把外部 :kbId 改寫成 internal :id;把 acts_as_user 偽裝成 req.user;
// 把 api_key.id 塞進 req.viaApiKey 給 audit log 用。
// 這是 service-account 模式的核心 — internal handler 不知道差別,所有 kb_access /
// 配額 / 保密 KB owner-only 檢查照舊跑,外部 caller 就是不能繞過。
function adaptToInternal(req, _res, next) {
  if (req.params.kbId) req.params.id = req.params.kbId;
  req.user      = req.actsAsUser;
  req.viaApiKey = req.apiKey?.id || null;
  next();
}

// 切 is_confidential 需要單獨 scope(對齊 internal owner-only 規則,二層防線)
function checkConfidentialToggle(req, res, next) {
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'is_confidential')) {
    if (!req.apiKeyScopes?.includes('kb:confidential:write')) {
      return res.status(403).json({ error: 'Missing scope: kb:confidential:write' });
    }
  }
  next();
}

// Write endpoints 專用 access check:
//   1. KB 必須在 api_keys.accessible_kbs 白名單內(讀取走 getAccessibleKb,write 之前沒檢查 — 補上)
//   2. 保密 KB 必須有 allow_confidential=1(對齊讀取規則,避免不對稱)
// 注意:這個 check 在 internal handler 的 getEditableKb 之前跑,擋的是 API key 層級的 policy;
// 真正的 kb_access edit/owner 檢查仍由 internal handler 跑(那是 user 層級的)。
async function checkKbAccessForWrite(req, res, next) {
  const kbId = req.params.kbId;
  if (!kbId) return next();
  // KB 白名單
  if (req.allowedKbIds && !req.allowedKbIds.includes(Number(kbId)) && !req.allowedKbIds.includes(String(kbId))) {
    return res.status(403).json({ error: 'KB not in API key whitelist' });
  }
  // 保密 KB 開關
  try {
    const db = getDb();
    const kb = await db.prepare(`SELECT is_confidential FROM knowledge_bases WHERE id=?`).get(kbId);
    if (!kb) return res.status(404).json({ error: 'KB not found' });
    if (Number(kb.is_confidential) === 1 && !req.allowConfidential) {
      return res.status(403).json({ error: 'API key does not allow confidential KB operations' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── openapi 自描述(允許未認證以便 caller 探測;不洩漏任何資料)─────────────────
router.get('/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'FOXLINK GPT External KB API',
      version: '1.1.0',
      description: 'External knowledge-base access via API key. Send Authorization: Bearer <key>.',
    },
    components: {
      securitySchemes: {
        ApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'API_KEY' },
      },
    },
    security: [{ ApiKey: [] }],
    paths: {
      '/api/v1/kb/list':                                  { get:    { summary: 'List accessible KBs',                                          scope: 'kb:read' } },
      '/api/v1/kb/search':                                { post:   { summary: 'Search a KB (hybrid retrieval)',                                scope: 'kb:search', body: { kb_id: 'string', query: 'string', top_k: 'number?' } } },
      '/api/v1/kb/chat':                                  { post:   { summary: 'Single-turn KB chat (returns answer + image_ids)',              scope: 'kb:chat', body: { kb_id: 'string', question: 'string', model: 'string?' } } },
      '/api/v1/kb/images/list':                           { post:   { summary: 'List images in a KB',                                           scope: 'kb:image:read', body: { kb_id: 'string', limit: 'number?', offset: 'number?' } } },
      '/api/v1/kb/images/{imageId}':                      { get:    { summary: 'Download an image binary',                                     scope: 'kb:image:read' } },
      '/api/v1/kb/{kbId}':                                { put:    { summary: 'Update KB settings (retrieval/parse/tags/...)',                scope: 'kb:settings:write', requires_acts_as: true, notes: 'Set is_confidential requires extra scope kb:confidential:write AND acts_as_user must be KB owner.' } },
      '/api/v1/kb/{kbId}/documents':                      { post:   { summary: 'Upload documents (multipart files[])',                         scope: 'kb:document:write', requires_acts_as: true } },
      '/api/v1/kb/{kbId}/documents/{docId}':              { delete: { summary: 'Delete a document',                                            scope: 'kb:document:write', requires_acts_as: true } },
      '/api/v1/kb/{kbId}/documents/{docId}/reparse':      { post:   { summary: 'Re-parse a document with new parse_mode / pdf_ocr_mode',       scope: 'kb:document:write', requires_acts_as: true, body: { parse_mode: 'string?', pdf_ocr_mode: 'string?', extract_images: 'boolean?' } } },
      '/api/v1/kb/{kbId}/images':                         { post:   { summary: 'Upload images (multipart files[])',                            scope: 'kb:image:write',    requires_acts_as: true } },
      '/api/v1/kb/{kbId}/images/{imageId}':               { patch:  { summary: 'Update image caption (re-embeds chunk)',                       scope: 'kb:image:write',    requires_acts_as: true, body: { caption: 'string' } },
                                                            delete: { summary: 'Delete an image',                                              scope: 'kb:image:write',    requires_acts_as: true } },
      '/api/v1/kb/{kbId}/images/batch-delete':            { post:   { summary: 'Batch delete images (up to 200 per call)',                     scope: 'kb:image:write',    requires_acts_as: true, body: { ids: 'string[]' } } },
      '/api/v1/kb/{kbId}/images/{imageId}/retry-caption': { post:   { summary: 'Re-run vision caption + re-embed chunk',                       scope: 'kb:image:write',    requires_acts_as: true } },
    },
    notes: [
      'Confidential KBs (is_confidential=1) are blocked for read unless the API key has allow_confidential=1.',
      'Write endpoints require api_keys.acts_as_user_id set; permissions follow the bound user (kb_access / ownership / quota).',
      'Toggling is_confidential requires scope kb:confidential:write AND the acts_as user MUST be the KB owner.',
      'Rate limit is per-key-per-minute; see api_keys.rate_limit_per_min (0 = unlimited).',
      'IP allowlist via api_keys.allowed_ips (CIDR JSON array).',
      'Audit logs of write operations include via_api_key column for traceability back to the calling key.',
    ],
  });
});

router.use(requireApiKey);

// ── KB access guard helper ───────────────────────────────────────────────────
async function getAccessibleKb(db, kbId, req) {
  if (req.allowedKbIds && !req.allowedKbIds.includes(Number(kbId)) && !req.allowedKbIds.includes(String(kbId))) {
    return null;
  }
  const kb = await db.prepare(`SELECT * FROM knowledge_bases WHERE id = ?`).get(kbId);
  if (!kb) return null;
  // 保密 KB:預設拒絕;呼叫端必須有 allow_confidential 才可看(admin 給 key 時手動勾)
  if (Number(kb.is_confidential) === 1 && !req.allowConfidential) return null;
  return kb;
}

// ── GET /api/v1/kb/list ──────────────────────────────────────────────────────
router.get('/kb/list', requireScope('kb:read'), async (req, res) => {
  const db = getDb();
  try {
    // 多回幾個欄位讓 caller 知道 KB 能力:doc_count / chunk_count / total_size / tags /
    // is_confidential / extract_embedded_images / 多語言名稱。
    let rows;
    if (req.allowedKbIds && req.allowedKbIds.length > 0) {
      const placeholders = req.allowedKbIds.map(() => '?').join(',');
      rows = await db.prepare(`
        SELECT id, name, name_zh, name_en, name_vi,
               description, desc_zh, desc_en, desc_vi,
               retrieval_mode, embedding_dims,
               doc_count, chunk_count, total_size_bytes, tags,
               is_confidential, extract_embedded_images,
               TO_CHAR(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
               TO_CHAR(updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at
        FROM knowledge_bases
        WHERE id IN (${placeholders})
        ORDER BY name
      `).all(...req.allowedKbIds);
    } else {
      rows = await db.prepare(`
        SELECT id, name, name_zh, name_en, name_vi,
               description, desc_zh, desc_en, desc_vi,
               retrieval_mode, embedding_dims,
               doc_count, chunk_count, total_size_bytes, tags,
               is_confidential, extract_embedded_images,
               TO_CHAR(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
               TO_CHAR(updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at
        FROM knowledge_bases
        ORDER BY name
      `).all();
    }
    // 沒勾 allow_confidential 的 key 一律拿不到保密 KB(對齊 search/chat)
    const filtered = rows.filter((r) => Number(r.is_confidential) !== 1 || req.allowConfidential);
    res.json({
      kbs: filtered.map((r) => ({
        ...r,
        tags: (() => { try { return JSON.parse(r.tags || '[]'); } catch { return []; } })(),
        is_confidential: Number(r.is_confidential) === 1,
        extract_embedded_images: Number(r.extract_embedded_images) !== 0,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/v1/kb/search ───────────────────────────────────────────────────
router.post('/kb/search', requireScope('kb:search'), async (req, res) => {
  const db = getDb();
  const { kb_id, query, top_k } = req.body;
  if (!kb_id || !query?.trim()) {
    return res.status(400).json({ error: 'kb_id and query are required' });
  }

  try {
    const kb = await getAccessibleKb(db, kb_id, req);
    if (!kb) return res.status(404).json({ error: 'KB not found or not accessible' });

    const { retrieveKbChunks } = require('../services/kbRetrieval');
    const { results } = await retrieveKbChunks(db, {
      kb, query,
      topK:   top_k != null ? Number(top_k) : undefined,
      source: 'external_api',
    });

    res.json({
      kb_id:   kb.id,
      kb_name: kb.name,
      query,
      results: results.map((r) => {
        let meta = {};
        try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch {}
        // image_ids 可能來自 (a) image chunk: { image_id }  (b) regular chunk 嵌圖: { image_ids:[] }
        const imageIds = meta.image_ids
          ? (Array.isArray(meta.image_ids) ? meta.image_ids : [])
          : (meta.image_id ? [meta.image_id] : []);
        return {
          id:           r.id,
          doc_id:       r.doc_id || null,
          chunk_type:   r.chunk_type || 'regular',
          content:      r.content,
          context:      r.parent_content || null,
          filename:     r.filename,
          score:        parseFloat((r.score || 0).toFixed(4)),
          match_type:   r.match_type,
          image_ids:    imageIds,
        };
      }),
    });
  } catch (e) {
    console.error('[ExternalKB] Search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/v1/kb/chat ─────────────────────────────────────────────────────
// Single-turn:retrieve KB context → ask Gemini。命中 image chunk 時把 kb-img:// 注入 prompt,
// 讓 LLM 用 markdown 圖片語法引用;同時把圖片 ids 回給 caller 自己 render。
router.post('/kb/chat', requireScope('kb:chat'), async (req, res) => {
  const db = getDb();
  const { kb_id, question, model } = req.body;
  if (!kb_id || !question?.trim()) {
    return res.status(400).json({ error: 'kb_id and question are required' });
  }
  // Model 白名單驗證 — 沒給就用 env 預設 Flash
  let modelName = (model || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash').toString();
  if (!CHAT_MODEL_RE.test(modelName)) {
    return res.status(400).json({ error: 'Invalid model; only gemini-* are allowed' });
  }

  try {
    const kb = await getAccessibleKb(db, kb_id, req);
    if (!kb) return res.status(404).json({ error: 'KB not found or not accessible' });

    const { retrieveKbChunks } = require('../services/kbRetrieval');
    const retrieveResult = await retrieveKbChunks(db, {
      kb, query: question, source: 'external_api',
    });
    const results = retrieveResult.results;

    // 收集命中的圖片 ids — 推給 LLM context + 回給 caller
    const allImageIds = [];
    let context = '';
    if (results.length === 0) {
      context = `[知識庫「${kb.name}」未找到相關內容]`;
    } else {
      const chunks = results.map((r, i) => {
        let meta = {};
        try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch {}
        const ids = meta.image_ids
          ? (Array.isArray(meta.image_ids) ? meta.image_ids : [])
          : (meta.image_id ? [meta.image_id] : []);
        ids.forEach((id) => { if (!allImageIds.includes(id)) allImageIds.push(id); });
        const imgRefs = ids.length ? `\n相關圖片:${ids.map((id) => `kb-img://${id}`).join(' ')}` : '';
        const ctx = r.parent_content ? `上下文：${r.parent_content.slice(0, 300)}\n\n片段：` : '';
        return `[${i + 1}] 來源: ${r.filename} (相關度 ${(r.score * 100).toFixed(0)}%)\n${ctx}${r.content}${imgRefs}`;
      });
      context = `【來自知識庫「${kb.name}」的相關內容】\n\n${chunks.join('\n\n---\n\n')}`;
    }

    const imageHint = allImageIds.length
      ? `\n\n若需在回答中引用圖片,請使用 markdown:![描述](kb-img://<image_id>),caller 端會解析。`
      : '';
    const prompt = `你是一個知識庫助手,請根據以下知識庫內容回答使用者的問題。若知識庫內容不足以回答,請說明。${imageHint}

${context}

使用者問題：${question}`;

    const { getGenerativeModel, extractText, extractUsage } = require('../services/geminiClient');
    const geminiModel = getGenerativeModel({ model: modelName });
    const result = await geminiModel.generateContent(prompt);
    const answer = extractText(result);
    const usage  = extractUsage(result);
    const inTok  = usage.inputTokens  || 0;
    const outTok = usage.outputTokens || 0;
    res.locals.tokensIn  = inTok;
    res.locals.tokensOut = outTok;

    // Record token usage under KB owner — 注意欄位是 creator_id 不是 created_by(過去 bug)
    const ownerId = kb.creator_id ?? kb.CREATOR_ID;
    if ((inTok || outTok) && ownerId) {
      const today = new Date().toISOString().split('T')[0];
      upsertTokenUsage(getDb(), ownerId, today, modelName, inTok, outTok).catch(() => {});
    }

    res.json({
      kb_id:    kb.id,
      kb_name:  kb.name,
      question,
      answer,
      sources:  results.map((r) => ({
        filename: r.filename,
        doc_id:   r.doc_id || null,
        score:    parseFloat((r.score || 0).toFixed(4)),
      })),
      image_ids: allImageIds,
      usage: {
        input_tokens:  inTok,
        output_tokens: outTok,
        model:         modelName,
      },
    });
  } catch (e) {
    console.error('[ExternalKB] Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/v1/kb/images/list ──────────────────────────────────────────────
router.post('/kb/images/list', requireScope('kb:image:read'), async (req, res) => {
  const db = getDb();
  const { kb_id, limit = 50, offset = 0 } = req.body || {};
  if (!kb_id) return res.status(400).json({ error: 'kb_id is required' });
  try {
    const kb = await getAccessibleKb(db, kb_id, req);
    if (!kb) return res.status(404).json({ error: 'KB not found or not accessible' });

    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const rows = await db.prepare(`
      SELECT id, kb_id, doc_id, chunk_id, source, filename, mime_type, file_size,
             caption, caption_status, width, height,
             TO_CHAR(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at
      FROM kb_images WHERE kb_id=?
      ORDER BY created_at DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `).all(kb.id, off, lim);
    const total = await db.prepare(`SELECT COUNT(*) AS cnt FROM kb_images WHERE kb_id=?`).get(kb.id);
    res.json({
      kb_id: kb.id,
      total: Number(total?.cnt || 0),
      limit: lim,
      offset: off,
      images: rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/v1/kb/images/:imageId ───────────────────────────────────────────
// 二進位下載 — 走 API key 權限(對齊 internal /api/kb/images/:imageId 的設計但用 API key 認證)
router.get('/kb/images/:imageId', requireScope('kb:image:read'), async (req, res) => {
  const db = getDb();
  try {
    if (!isSafeId(req.params.imageId)) return res.status(400).json({ error: 'Invalid image id' });
    const img = await db.prepare(`SELECT * FROM kb_images WHERE id=?`).get(req.params.imageId);
    if (!img) return res.status(404).json({ error: 'Image not found' });

    const kb = await getAccessibleKb(db, img.kb_id, req);
    if (!kb) return res.status(404).json({ error: 'KB not accessible' });

    const abs = path.join(UPLOAD_BASE, img.stored_path);
    if (!ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), abs)) {
      return res.status(400).json({ error: 'Path escape' });
    }
    if (!fs.existsSync(abs)) return res.status(410).json({ error: 'File missing on disk' });

    res.setHeader('Content-Type',  img.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    // usage log:image binary 用 file_size 當 bytes_out(更接近實際流量),不走 res.json 包裝
    logUsage(db, req.apiKey.id, {
      endpoint:     req.path,
      method:       req.method,
      status:       200,
      kbId:         img.kb_id,
      bytesOut:     Number(img.file_size) || 0,
      durationMs:   0,
      actsAsUserId: req.actsAsUser?.id || null,
      clientIp:     req._cachedClientIp || clientIp(req),
      resourceId:   `image:${req.params.imageId}`,
    });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    console.error('[ExternalKB] Image download error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  Write endpoints — service-account 模式
//
//  全部 wrap internal handler:
//    - requireScope:scope 檢查
//    - requireActsAsUser:必須掛 acts_as_user_id
//    - adaptToInternal:把 acts_as_user 偽裝成 req.user,改寫 :kbId → :id
//    - 最後丟給 internal named handler。internal 端 getEditableKb / getQuota /
//      保密 KB owner-only 規則照舊跑,擋不擋由 internal 決定,外部 API 無 bypass。
//
//  保密 KB:擋住 only if user 真的沒被 owner 加進 kb_access。allow_confidential=0
//  的 key,加 KB 讀寫也照樣擋,因為 getAccessibleKb 先擋。要寫保密 KB:owner 必須
//  到內部 UI 把 acts_as_user 加為 kb_access permission='edit',並把 API key 勾
//  allow_confidential=1。兩者都做才通。
// ═════════════════════════════════════════════════════════════════════════════

const internal       = knowledgeBase.handlers;
const internalUpload = knowledgeBase.multer.upload;
const internalImageUpload = knowledgeBase.multer.imageUpload;

// PUT /api/v1/kb/:kbId — 更新 KB 設定
router.put(
  '/kb/:kbId',
  requireScope('kb:settings:write'),
  requireActsAsUser,
  checkConfidentialToggle,
  checkKbAccessForWrite,
  adaptToInternal,
  (req, res) => internal.putKbHandler(req, res),
);

// POST /api/v1/kb/:kbId/documents — 上傳文件(multipart files[])
router.post(
  '/kb/:kbId/documents',
  requireScope('kb:document:write'),
  requireActsAsUser,
  checkKbAccessForWrite,
  adaptToInternal,           // 必須在 multer 之前 — multer storage 讀 req.params.id 來決定目錄
  internalUpload.array('files', 20),
  (req, res) => internal.uploadDocumentsHandler(req, res),
);

// DELETE /api/v1/kb/:kbId/documents/:docId
router.delete(
  '/kb/:kbId/documents/:docId',
  requireScope('kb:document:write'),
  requireActsAsUser,
  checkKbAccessForWrite,
  adaptToInternal,
  (req, res) => internal.deleteDocumentHandler(req, res),
);

// POST /api/v1/kb/:kbId/documents/:docId/reparse — 重新解析(可改 parse_mode / pdf_ocr_mode)
router.post(
  '/kb/:kbId/documents/:docId/reparse',
  requireScope('kb:document:write'),
  requireActsAsUser,
  checkKbAccessForWrite,
  adaptToInternal,
  (req, res) => internal.reparseDocumentHandler(req, res),
);

// POST /api/v1/kb/:kbId/images — 上傳圖片(multipart files[])
router.post(
  '/kb/:kbId/images',
  requireScope('kb:image:write'),
  requireActsAsUser,
  checkKbAccessForWrite,
  adaptToInternal,
  internalImageUpload.array('files', 10),
  (req, res) => internal.uploadImagesHandler(req, res),
);

// POST /api/v1/kb/:kbId/images/batch-delete — 批次刪(必須在 :imageId 之前註冊,
// 否則 Express 會把 'batch-delete' 當成 :imageId)
router.post(
  '/kb/:kbId/images/batch-delete',
  requireScope('kb:image:write'),
  requireActsAsUser,
  checkKbAccessForWrite,
  adaptToInternal,
  (req, res) => internal.batchDeleteImagesHandler(req, res),
);

// POST /api/v1/kb/:kbId/images/:imageId/retry-caption — 重試 vision caption
router.post(
  '/kb/:kbId/images/:imageId/retry-caption',
  requireScope('kb:image:write'),
  requireActsAsUser,
  checkKbAccessForWrite,
  adaptToInternal,
  (req, res) => internal.retryCaptionHandler(req, res),
);

// PATCH /api/v1/kb/:kbId/images/:imageId — 更新 caption(會重新 embed 對應 chunk)
router.patch(
  '/kb/:kbId/images/:imageId',
  requireScope('kb:image:write'),
  requireActsAsUser,
  checkKbAccessForWrite,
  adaptToInternal,
  (req, res) => internal.patchImageHandler(req, res),
);

// DELETE /api/v1/kb/:kbId/images/:imageId
router.delete(
  '/kb/:kbId/images/:imageId',
  requireScope('kb:image:write'),
  requireActsAsUser,
  checkKbAccessForWrite,
  adaptToInternal,
  (req, res) => internal.deleteImageHandler(req, res),
);

module.exports = router;
