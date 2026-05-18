'use strict';
/**
 * Knowledge Base Routes
 *
 * POST   /api/kb                         建立知識庫
 * GET    /api/kb                         列出可存取的知識庫
 * GET    /api/kb/orgs                    取得組織選項 (用於共享設定)
 * GET    /api/kb/:id                     取得知識庫詳情
 * PUT    /api/kb/:id                     更新知識庫設定
 * DELETE /api/kb/:id                     刪除知識庫
 *
 * GET    /api/kb/:id/documents           列出文件
 * POST   /api/kb/:id/documents           上傳文件 (multipart)
 * DELETE /api/kb/:id/documents/:docId    刪除文件
 * GET    /api/kb/:id/documents/:docId/chunks  列出文件的分塊
 *
 * POST   /api/kb/:id/search              召回測試 / 語意搜尋
 *
 * GET    /api/kb/:id/access              列出共享設定
 * POST   /api/kb/:id/access              新增共享
 * DELETE /api/kb/:id/access/:grantId     移除共享
 *
 * POST   /api/kb/:id/request-public      申請公開 (擁有者)
 */

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const { verifyToken } = require('./auth');
const { embedText, toVectorStr } = require('../services/kbEmbedding');
const { parseDocument, chunkDocument } = require('../services/kbDocParser');
const { classifyUpload } = require('../utils/uploadFileTypes');
const { translateFields } = require('../services/translationService');
const { resolveGranteeNamesInRows, getLangFromReq } = require('../services/granteeNameResolver');

router.use(verifyToken);

function getDb() { return require('../database-oracle').db; }

// ─── Token usage helpers (mirrors chat.js) ────────────────────────────────────
async function calcEmbedCost(db, model, date, inputTokens) {
  try {
    const DI = `TO_DATE(?, 'YYYY-MM-DD')`;
    const price = await db.prepare(
      `SELECT price_input, currency FROM token_prices WHERE model=? AND start_date<=${DI} AND (end_date IS NULL OR end_date>=${DI}) ORDER BY start_date DESC FETCH FIRST 1 ROWS ONLY`
    ).get(model, date, date);
    if (!price) return { cost: null, currency: null };
    return { cost: (inputTokens * price.price_input) / 1_000_000, currency: price.currency };
  } catch { return { cost: null, currency: null }; }
}

async function upsertOcrTokenUsage(db, userId, date, model, inputTokens, outputTokens) {
  try {
    const DI = `TO_DATE(?, 'YYYY-MM-DD')`;
    const price = await db.prepare(
      `SELECT price_input, price_output, currency FROM token_prices WHERE model=? AND start_date<=${DI} AND (end_date IS NULL OR end_date>=${DI}) ORDER BY start_date DESC FETCH FIRST 1 ROWS ONLY`
    ).get(model, date, date);
    const cost = price
      ? ((inputTokens * (price.price_input || 0) + outputTokens * (price.price_output || 0)) / 1_000_000)
      : null;
    const currency = price?.currency || null;

    const D = `TO_DATE(?, 'YYYY-MM-DD')`;
    const existing = await db.prepare(`SELECT id FROM token_usage WHERE user_id=? AND usage_date=${D} AND model=?`).get(userId, date, model);
    if (existing) {
      await db.prepare(
        `UPDATE token_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+?,
         cost=CASE WHEN ? IS NOT NULL THEN COALESCE(cost,0)+? ELSE cost END,
         currency=COALESCE(?, currency)
         WHERE user_id=? AND usage_date=${D} AND model=?`
      ).run(inputTokens, outputTokens, cost, cost, currency, userId, date, model);
    } else {
      await db.prepare(
        `INSERT INTO token_usage (user_id, usage_date, model, input_tokens, output_tokens, image_count, cost, currency) VALUES (?,${D},?,?,?,0,?,?)`
      ).run(userId, date, model, inputTokens, outputTokens, cost, currency);
    }
  } catch (e) {
    console.error('[KB] OCR token upsert error:', e.message);
  }
}

async function upsertEmbedTokenUsage(db, userId, date, model, inputTokens) {
  try {
    const { cost, currency } = await calcEmbedCost(db, model, date, inputTokens);
    const D = `TO_DATE(?, 'YYYY-MM-DD')`;
    const existing = await db.prepare(`SELECT id FROM token_usage WHERE user_id=? AND usage_date=${D} AND model=?`).get(userId, date, model);
    if (existing) {
      await db.prepare(
        `UPDATE token_usage SET input_tokens=input_tokens+?,
         cost=CASE WHEN ? IS NOT NULL THEN COALESCE(cost,0)+? ELSE cost END,
         currency=COALESCE(?, currency)
         WHERE user_id=? AND usage_date=${D} AND model=?`
      ).run(inputTokens, cost, cost, currency, userId, date, model);
    } else {
      await db.prepare(
        `INSERT INTO token_usage (user_id, usage_date, model, input_tokens, output_tokens, image_count, cost, currency) VALUES (?,${D},?,?,0,0,?,?)`
      ).run(userId, date, model, inputTokens, cost, currency);
    }
  } catch (e) {
    console.error('[KB] Token upsert error:', e.message);
  }
}

const UPLOAD_BASE = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

// Multer storage: save to uploads/kb/<kb_id>/
const { isSafeId, ensureWithinRoot } = require('../utils/pathSafety');

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    // \u9632 path traversal:KB id \u662f UUID(alphanumeric + `_-`),\u4e0d\u662f\u7d14\u6578\u5b57\u3002
    // \u653b\u64ca\u8005\u9001 :id='../../etc' \u904e\u53bb\u6703 escape \u51fa UPLOAD_BASE/kb/ \u5beb\u5230\u4efb\u610f\u76ee\u9304,
    // \u6240\u4ee5\u7528 isSafeId(alphanumeric + `_-`)\u9a57\u8b49,\u64cb\u659c\u7dda/\u9ede/\u53cd\u659c\u7dda\u3002
    const id = req.params.id;
    if (id !== undefined && !isSafeId(String(id))) {
      return cb(new Error('Invalid KB id'));
    }
    const dir = path.join(UPLOAD_BASE, 'kb', id || 'tmp');
    // Double check:\u5373\u4f7f\u4e0a\u9762\u6f0f\u7db2,resolve \u5f8c\u7684 dir \u5fc5\u9808\u4ecd\u5728 UPLOAD_BASE/kb \u4e4b\u4e0b
    if (!ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), dir)) {
      return cb(new Error('Path escape detected'));
    }
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext  = path.extname(file.originalname);
    const stem = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    cb(null, `${Date.now()}_${stem}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB hard limit
  fileFilter(_req, file, cb) {
    // 對齊 chat 的 classifier(文字/代碼/config/log/eml/PDF/Office/圖片 都收)。
    // 黑名單(exe/zip/key)+ 影片仍會在 classifyUpload 內擋掉。音訊 KB 不收(沒 transcribe pipeline)。
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const c = classifyUpload(name, file.mimetype);
    if (!c.ok) return cb(new Error(c.reason || '不支援的檔案格式'), false);
    if (c.kind === 'audio') return cb(new Error('KB 暫不支援音訊檔(無轉錄 pipeline)'), false);
    cb(null, true);
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }

/**
 * Check if current user can access this KB (owner / shared / public).
 * Returns the kb row or null.
 *
 * 保密 KB(is_confidential=1)規則:admin 預設無權看內容,要走 owner / kb_access 才行。
 * 回傳的 kb 物件可能帶 `_adminMetadataOnly=true` flag(admin 對保密 KB 只能看 list metadata,
 * 不能撈內容/文件/chunks/檢索)。Caller 必須檢查這個 flag。
 */
async function getAccessibleKb(db, kbId, userId, { allowMetadataOnly = false } = {}) {
  const user = await db.prepare('SELECT role, dept_code, profit_center, org_section, org_group_name, role_id, factory_code FROM users WHERE id=?').get(userId);
  if (!user) return null;

  const kb = await db.prepare(`
    SELECT kb.* FROM knowledge_bases kb
    WHERE kb.id=?
      AND (
        kb.creator_id=?
        OR kb.is_public=1
        OR EXISTS (
          SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
            (ka.grantee_type='user'         AND ka.grantee_id=TO_CHAR(?))
            OR (ka.grantee_type='role'      AND ka.grantee_id=TO_CHAR(?))
            OR (ka.grantee_type='dept'      AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
          )
        )
      )
  `).get(
    kbId,
    userId,
    userId, user.role_id,
    user.dept_code, user.dept_code,
    user.profit_center, user.profit_center,
    user.org_section, user.org_section,
    user.factory_code, user.factory_code,
    user.org_group_name, user.org_group_name,
  );
  if (kb) return kb;

  // Admin fallback:對非保密 KB,admin 全部可看;對保密 KB,admin 只拿 metadata
  if (user.role === 'admin') {
    const adminKb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kbId);
    if (!adminKb) return null;
    if (Number(adminKb.is_confidential) === 1) {
      if (!allowMetadataOnly) return null; // 內容 API:直接擋
      return { ...adminKb, _adminMetadataOnly: true };
    }
    return adminKb;
  }
  return null;
}

/**
 * Check if user can EDIT a KB (owner, admin, or has kb_access with permission='edit').
 * Returns the kb row if allowed, null otherwise.
 *
 * 保密 KB:admin 不再 bypass — 必須是 owner 或在 kb_access 拿到 edit 才行。
 */
async function getEditableKb(db, kbId, userId, userRole) {
  const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kbId);
  if (!kb) return null;

  if (userRole === 'admin') {
    if (Number(kb.is_confidential) !== 1) return kb;
    // 保密 KB:admin 必須是 owner 才能 bypass(其他 admin 走下方 access check)
    if (String(kb.creator_id) === String(userId)) return kb;
    // fall through 走 access check
  }

  if (String(kb.creator_id) === String(userId)) return kb;
  // shared edit permission check
  const user = await db.prepare('SELECT dept_code, profit_center, org_section, org_group_name, role_id, factory_code FROM users WHERE id=?').get(userId);
  if (!user) return null;
  const access = await db.prepare(`
    SELECT 1 FROM kb_access WHERE kb_id=? AND permission='edit' AND (
      (grantee_type='user'          AND grantee_id=TO_CHAR(?))
      OR (grantee_type='role'       AND grantee_id=TO_CHAR(?))
      OR (grantee_type='dept'       AND grantee_id=? AND ? IS NOT NULL)
      OR (grantee_type='profit_center' AND grantee_id=? AND ? IS NOT NULL)
      OR (grantee_type='org_section'   AND grantee_id=? AND ? IS NOT NULL)
      OR (grantee_type='factory'       AND grantee_id=? AND ? IS NOT NULL)
      OR (grantee_type='org_group'     AND grantee_id=? AND ? IS NOT NULL)
    )
  `).get(
    kbId,
    userId, user.role_id,
    user.dept_code, user.dept_code,
    user.profit_center, user.profit_center,
    user.org_section, user.org_section,
    user.factory_code, user.factory_code,
    user.org_group_name, user.org_group_name,
  );
  return access ? kb : null;
}

/** Resolve effective KB dev permission for a user. */
async function canCreateKb(db, userId) {
  const user = await db.prepare('SELECT role, can_create_kb, role_id FROM users WHERE id=?').get(userId);
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.can_create_kb === 1) return true;
  if (user.can_create_kb === 0) return false; // explicit user-level deny overrides role
  // can_create_kb is null → fall through to role default
  if (user.role_id) {
    const role = await db.prepare('SELECT can_create_kb FROM roles WHERE id=?').get(user.role_id);
    if (role?.can_create_kb === 1) return true;
  }
  return false;
}

/** Get quota limits for a user. */
async function getQuota(db, userId) {
  const user = await db.prepare('SELECT role, kb_max_size_mb, kb_max_count, role_id FROM users WHERE id=?').get(userId);
  if (!user) return { maxSizeMb: 500, maxCount: 5 };
  if (user.role === 'admin') return { maxSizeMb: 99999, maxCount: 99999 };

  let sizeMb  = user.kb_max_size_mb;
  let count   = user.kb_max_count;
  if ((sizeMb == null || count == null) && user.role_id) {
    const role = await db.prepare('SELECT kb_max_size_mb, kb_max_count FROM roles WHERE id=?').get(user.role_id);
    sizeMb = sizeMb  ?? role?.kb_max_size_mb;
    count  = count   ?? role?.kb_max_count;
  }
  return { maxSizeMb: sizeMb ?? 500, maxCount: count ?? 5 };
}

// ─── GET /api/kb/orgs  (組織選項供共享使用) ────────────────────────────────────
// Query: ?lang=zh-TW|en|vi
// 見 docs/factory-share-layer-plan.md §3.3
router.get('/orgs', async (req, res) => {
  const db = getDb();
  try {
    const lang = (req.query.lang || 'zh-TW').toString();
    const factoryCache = require('../services/factoryCache');

    const [depts, pcs, sections, groups, factories] = await Promise.all([
      db.prepare(`SELECT DISTINCT dept_code AS code, dept_name AS name FROM users WHERE dept_code IS NOT NULL ORDER BY dept_name`).all(),
      db.prepare(`SELECT DISTINCT profit_center AS code, profit_center_name AS name FROM users WHERE profit_center IS NOT NULL ORDER BY profit_center_name`).all(),
      db.prepare(`SELECT DISTINCT org_section AS code, org_section_name AS name FROM users WHERE org_section IS NOT NULL ORDER BY org_section_name`).all(),
      db.prepare(`SELECT DISTINCT org_group_name AS name FROM users WHERE org_group_name IS NOT NULL ORDER BY org_group_name`).all(),
      factoryCache.listFactories(lang, db).catch(() => []),
    ]);
    const groupsOut = (groups || []).map(g => ({ code: null, name: g.name }));
    res.json({
      depts,
      profit_centers: pcs,
      org_sections: sections,
      org_groups: groupsOut,
      factories,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kb  ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const db = getDb();
  if (!await canCreateKb(db, req.user.id)) {
    return res.status(403).json({ error: '您沒有建立知識庫的權限，請聯絡管理員' });
  }
  const quota = await getQuota(db, req.user.id);
  const existing = await db.prepare('SELECT COUNT(*) AS cnt FROM knowledge_bases WHERE creator_id=?').get(req.user.id);
  if ((existing?.cnt || 0) >= quota.maxCount) {
    return res.status(403).json({ error: `已達知識庫數量上限 (${quota.maxCount} 個)` });
  }

  // v2 架構後所有 KB 統一 768 dim（HNSW/IVF 需固定維度；Matryoshka embedding 讓 768
  // 對 1536/3072 的精度損失 < 2%，不值得額外成本）。忽略前端傳入值，強制 768。
  const embedding_dims = 768;
  const {
    name, description,
    chunk_strategy = 'regular',
    chunk_config   = {},
    retrieval_mode = 'hybrid',
    rerank_model   = null,
    top_k_fetch    = 10,
    top_k_return   = 5,
    score_threshold = 0,
    ocr_model      = null,
    parse_mode     = 'text_only',
    pdf_ocr_mode   = 'auto',
    tags,
    is_confidential,
    extract_embedded_images,
    name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi,
  } = req.body;
  const tagsStr = JSON.stringify(tags || []);
  const confidential = is_confidential ? 1 : 0;
  const extractImg = extract_embedded_images === false || extract_embedded_images === 0 ? 0 : 1;

  if (!name?.trim()) return res.status(400).json({ error: '知識庫名稱為必填' });
  // 維度已強制 768（上方覆寫），此驗證保留當護欄
  if (Number(embedding_dims) !== 768) {
    return res.status(400).json({ error: '維度已統一為 768（v2 架構）' });
  }

  try {
    const id = uuid();
    await db.prepare(`
      INSERT INTO knowledge_bases
        (id, creator_id, name, description,
         embedding_model, embedding_dims,
         chunk_strategy, chunk_config,
         retrieval_mode, rerank_model,
         top_k_fetch, top_k_return, score_threshold, ocr_model, parse_mode, pdf_ocr_mode, tags,
         is_confidential, extract_embedded_images)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.user.id, name.trim(), description || null,
      await require('../services/llmDefaults').resolveDefaultModel(db, 'embedding'),
      Number(embedding_dims),
      chunk_strategy,
      typeof chunk_config === 'string' ? chunk_config : JSON.stringify(chunk_config),
      retrieval_mode, rerank_model,
      Number(top_k_fetch), Number(top_k_return), Number(score_threshold),
      ocr_model || null,
      ['text_only', 'format_aware'].includes(parse_mode) ? parse_mode : 'text_only',
      ['off', 'auto', 'force'].includes(pdf_ocr_mode) ? pdf_ocr_mode : 'off',
      tagsStr,
      confidential,
      extractImg,
    );
    // Auto-translate
    const trans = (name_zh !== undefined)
      ? { name_zh: name_zh || null, name_en: name_en || null, name_vi: name_vi || null, desc_zh: desc_zh || null, desc_en: desc_en || null, desc_vi: desc_vi || null }
      : await translateFields({ name: name.trim(), description }).catch(() => ({ name_zh: null, name_en: null, name_vi: null, desc_zh: null, desc_en: null, desc_vi: null }));
    if (trans.name_zh !== undefined) {
      await db.prepare(`UPDATE knowledge_bases SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, id);
    }
    const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(id);
    // 為新知識庫加 KB_CHUNKS partition
    const { addKbChunksPartition } = require('../database-oracle');
    addKbChunksPartition(id).catch(e => console.warn('[Partition] KB create:', e.message));
    res.status(201).json(kb);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb  ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const db  = getDb();
  const uid = req.user.id;
  try {
    const user = await db.prepare(
      'SELECT role, dept_code, profit_center, org_section, org_group_name, role_id, factory_code FROM users WHERE id=?'
    ).get(uid);
    if (!user) return res.json([]);

    let rows;
    {
      // Admin 也走相同過濾邏輯（不再 bypass），需透過 /unauthorized 搭配前端測試模式存取未授權 KB
      // 例外:保密 KB(is_confidential=1)admin 即使沒被分享也看得到 list metadata
      // (但 detail/content 走 _adminMetadataOnly 擋住,前端用 is_confidential + !can_view_content 渲染鎖頭)
      // Both 'use' and 'edit' permissions show the KB in the list.
      // 'use' = can search/chat only; 'edit' = can also modify documents.
      // Oracle does not allow DISTINCT on CLOB columns (ORA-22848).
      // Use a subquery on id only, then join back to get full row including CLOBs.
      const adminCarveOut = user.role === 'admin' ? `OR kb2.is_confidential=1` : '';
      rows = await db.prepare(`
        SELECT kb.*, u.name AS creator_name, u.employee_id AS creator_emp
        FROM knowledge_bases kb
        JOIN users u ON u.id = kb.creator_id
        WHERE kb.id IN (
          SELECT kb2.id FROM knowledge_bases kb2
          WHERE kb2.creator_id=?
            OR kb2.is_public=1
            ${adminCarveOut}
            OR EXISTS (
              SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb2.id AND (
                (ka.grantee_type='user'             AND ka.grantee_id=TO_CHAR(?))
                OR (ka.grantee_type='role'          AND ka.grantee_id=TO_CHAR(?))
                OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
                OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
                OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
                OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
                OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
              )
            )
        )
        ORDER BY kb.updated_at DESC
      `).all(
        uid,
        uid, user.role_id,
        user.dept_code, user.dept_code,
        user.profit_center, user.profit_center,
        user.org_section, user.org_section,
        user.factory_code, user.factory_code,
        user.org_group_name, user.org_group_name,
      );
    }

    // 計算每筆 row 對當前 user 是否「只能看 metadata」(保密 KB + 不是 owner + 不在 kb_access)
    const accessRows = await db.prepare(`
      SELECT DISTINCT kb_id FROM kb_access WHERE (
        (grantee_type='user'             AND grantee_id=TO_CHAR(?))
        OR (grantee_type='role'          AND grantee_id=TO_CHAR(?))
        OR (grantee_type='dept'          AND grantee_id=? AND ? IS NOT NULL)
        OR (grantee_type='profit_center' AND grantee_id=? AND ? IS NOT NULL)
        OR (grantee_type='org_section'   AND grantee_id=? AND ? IS NOT NULL)
        OR (grantee_type='factory'       AND grantee_id=? AND ? IS NOT NULL)
        OR (grantee_type='org_group'     AND grantee_id=? AND ? IS NOT NULL)
      )
    `).all(
      uid, user.role_id,
      user.dept_code, user.dept_code,
      user.profit_center, user.profit_center,
      user.org_section, user.org_section,
      user.factory_code, user.factory_code,
      user.org_group_name, user.org_group_name,
    );
    const sharedKbIds = new Set(accessRows.map((r) => r.kb_id || r.KB_ID));

    // Mark each row with whether current user is owner
    const result = rows.map((r) => {
      const isOwner       = String(r.creator_id) === String(uid);
      const isShared      = sharedKbIds.has(r.id);
      const isConfidential = Number(r.is_confidential) === 1;
      // admin 對保密 KB:不是 owner / 不在 kb_access → metadata-only
      const adminMetadataOnly = user.role === 'admin' && isConfidential && !isOwner && !isShared;
      return {
        ...r,
        is_owner:           isOwner || user.role === 'admin',
        can_view_content:   !adminMetadataOnly,
        _admin_metadata_only: adminMetadataOnly,
        chunk_config: (() => { try { return JSON.parse(r.chunk_config || '{}'); } catch { return {}; } })(),
      };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb/unauthorized  — admin only: 列出 admin 尚無權限的 KB（供測試模式）──
router.get('/unauthorized', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '僅管理員可存取' });
  const db = getDb();
  try {
    const uid = req.user.id;
    const user = await db.prepare(
      'SELECT role, dept_code, profit_center, org_section, org_group_name, role_id, factory_code FROM users WHERE id=?'
    ).get(uid);
    if (!user) return res.json([]);

    // Get authorized KB IDs (same logic as the list query)
    const authorizedRows = await db.prepare(`
      SELECT kb2.id FROM knowledge_bases kb2
      WHERE kb2.creator_id=?
        OR kb2.is_public=1
        OR EXISTS (
          SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb2.id AND (
            (ka.grantee_type='user'             AND ka.grantee_id=TO_CHAR(?))
            OR (ka.grantee_type='role'          AND ka.grantee_id=TO_CHAR(?))
            OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
          )
        )
    `).all(
      uid,
      uid, user.role_id,
      user.dept_code, user.dept_code,
      user.profit_center, user.profit_center,
      user.org_section, user.org_section,
      user.factory_code, user.factory_code,
      user.org_group_name, user.org_group_name,
    );
    const authorizedSet = new Set(authorizedRows.map(r => r.id));

    const all = await db.prepare(
      `SELECT kb.id, kb.name, kb.description, kb.embed_model, kb.chunk_count, u.name AS creator_name
       FROM knowledge_bases kb JOIN users u ON u.id = kb.creator_id
       ORDER BY kb.updated_at DESC`
    ).all();
    res.json(all.filter(k => !authorizedSet.has(k.id)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb/thesauri-names — KB 設定頁 LOV（必須在 /:id 之前，避免被匹配）
router.get('/thesauri-names', async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`SELECT name FROM kb_thesauri ORDER BY name`).all();
    res.json(rows.map((r) => r.NAME ?? r.name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/kb/:id  ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const db = getDb();
  try {
    // detail 給 metadata-only 也回(讓 admin 能看到名稱/owner/大小但不渲染內容)
    const kb = await getAccessibleKb(db, req.params.id, req.user.id, { allowMetadataOnly: true });
    if (!kb) return res.status(404).json({ error: '找不到知識庫或無存取權限' });
    const metadataOnly = !!kb._adminMetadataOnly;
    kb.is_owner = String(kb.creator_id) === String(req.user.id) || req.user.role === 'admin';
    kb.can_view_content = !metadataOnly;
    kb.can_edit = !metadataOnly && (String(kb.creator_id) === String(req.user.id) || !!(await getEditableKb(db, req.params.id, req.user.id, req.user.role)));
    kb.chunk_config = (() => { try { return JSON.parse(kb.chunk_config || '{}'); } catch { return {}; } })();
    if (metadataOnly) {
      // 把可能洩露內容的欄位拔掉(retrieval_config 含同義詞/權重不算機密但保守清掉)
      delete kb.retrieval_config;
      delete kb.tags;
    }
    res.json(kb);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /api/kb/:id  ─────────────────────────────────────────────────────────
async function putKbHandler(req, res) {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });

    const {
      name, description,
      chunk_strategy, chunk_config,
      retrieval_mode, rerank_model,
      top_k_fetch, top_k_return, score_threshold,
      ocr_model, parse_mode, pdf_ocr_mode, tags,
      retrieval_config,
      is_confidential,
      extract_embedded_images,
      name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi,
    } = req.body;

    const finalName = name ?? target.name;
    const finalDesc = description !== undefined ? description : target.description;

    // is_confidential 只有 owner 可切換(admin 在 getEditableKb 的保密分支已被擋,這裡是雙保險)
    let finalConfidential = Number(target.is_confidential) === 1 ? 1 : 0;
    let confidentialChanged = false;
    if (is_confidential !== undefined) {
      const wantConf = is_confidential ? 1 : 0;
      if (wantConf !== finalConfidential) {
        if (String(target.creator_id) !== String(req.user.id)) {
          return res.status(403).json({ error: '僅擁有者可變更保密狀態' });
        }
        finalConfidential = wantConf;
        confidentialChanged = true;
      }
    }
    // 互斥:勾保密 → 強制 is_public=0、public_status='private'(若還在 pending 一併取消)
    if (finalConfidential === 1 && (Number(target.is_public) === 1 || target.public_status === 'pending')) {
      await db.prepare(`UPDATE knowledge_bases SET is_public=0, public_status='private', public_request_at=NULL WHERE id=?`).run(req.params.id);
    }
    let finalRetrievalConfig = target.retrieval_config;
    if (retrieval_config !== undefined) {
      if (retrieval_config === null || retrieval_config === '') {
        finalRetrievalConfig = null;
      } else if (typeof retrieval_config === 'object') {
        finalRetrievalConfig = JSON.stringify(retrieval_config);
      } else if (typeof retrieval_config === 'string') {
        try { JSON.parse(retrieval_config); finalRetrievalConfig = retrieval_config; }
        catch { return res.status(400).json({ error: 'retrieval_config 不是合法 JSON' }); }
      }
    }

    // extract_embedded_images:undefined → keep,bool/0/1 → 寫入
    const finalExtractImg = extract_embedded_images === undefined
      ? (Number(target.extract_embedded_images) === 0 ? 0 : 1)
      : (extract_embedded_images === false || extract_embedded_images === 0 ? 0 : 1);

    await db.prepare(`
      UPDATE knowledge_bases
      SET name=?, description=?,
          chunk_strategy=?, chunk_config=?,
          retrieval_mode=?, rerank_model=?,
          top_k_fetch=?, top_k_return=?, score_threshold=?,
          ocr_model=?, parse_mode=?, pdf_ocr_mode=?,
          tags=?, retrieval_config=?,
          is_confidential=?, extract_embedded_images=?,
          updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(
      finalName,
      finalDesc,
      chunk_strategy ?? target.chunk_strategy,
      chunk_config !== undefined ? JSON.stringify(chunk_config) : target.chunk_config,
      retrieval_mode ?? target.retrieval_mode,
      rerank_model !== undefined ? rerank_model : target.rerank_model,
      top_k_fetch  != null ? Number(top_k_fetch)  : target.top_k_fetch,
      top_k_return != null ? Number(top_k_return) : target.top_k_return,
      score_threshold != null ? Number(score_threshold) : target.score_threshold,
      ocr_model !== undefined ? (ocr_model || null) : target.ocr_model,
      parse_mode !== undefined ? (['text_only','format_aware'].includes(parse_mode) ? parse_mode : 'text_only') : (target.parse_mode || 'text_only'),
      pdf_ocr_mode !== undefined ? (['off','auto','force'].includes(pdf_ocr_mode) ? pdf_ocr_mode : 'off') : (target.pdf_ocr_mode || 'off'),
      tags !== undefined ? JSON.stringify(tags || []) : (target.tags || '[]'),
      finalRetrievalConfig,
      finalConfidential, finalExtractImg,
      req.params.id,
    );

    if (confidentialChanged) {
      try {
        await db.prepare(`
          INSERT INTO audit_logs (user_id, content, has_sensitive, via_api_key)
          VALUES (?, ?, 0, ?)
        `).run(req.user.id, JSON.stringify({
          event: 'kb_confidential_toggle',
          kb_id: req.params.id,
          kb_name: target.name,
          from: Number(target.is_confidential) === 1 ? 1 : 0,
          to:   finalConfidential,
        }), req.viaApiKey || null);
      } catch (auditErr) {
        console.warn('[KB] audit log (confidential toggle) failed:', auditErr.message);
      }
    }

    if (name_zh !== undefined) {
      await db.prepare(`UPDATE knowledge_bases SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(name_zh || null, name_en || null, name_vi || null, desc_zh || null, desc_en || null, desc_vi || null, req.params.id);
    } else {
      const nameChanged = name !== undefined && name !== target.name;
      const descChanged = description !== undefined && description !== target.description;
      if (nameChanged || descChanged) {
        const trans = await translateFields({
          name: nameChanged ? finalName : null,
          description: descChanged ? finalDesc : null,
        }).catch(() => ({}));
        const setClauses = []; const params = [];
        if (nameChanged && trans.name_zh !== undefined) { setClauses.push('name_zh=?,name_en=?,name_vi=?'); params.push(trans.name_zh, trans.name_en, trans.name_vi); }
        if (descChanged && trans.desc_zh !== undefined) { setClauses.push('desc_zh=?,desc_en=?,desc_vi=?'); params.push(trans.desc_zh, trans.desc_en, trans.desc_vi); }
        if (setClauses.length) await db.prepare(`UPDATE knowledge_bases SET ${setClauses.join(',')} WHERE id=?`).run(...params, req.params.id);
      }
    }

    const updated = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(req.params.id);
    updated.chunk_config = (() => { try { return JSON.parse(updated.chunk_config || '{}'); } catch { return {}; } })();
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.put('/:id', putKbHandler);

// ─── DELETE /api/kb/:id  ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const db = getDb();
  try {
    const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    const isOwner = String(kb.creator_id) === String(req.user.id);
    const isConfidential = Number(kb.is_confidential) === 1;
    // 保密 KB:只有 owner 可刪;非保密 KB:owner 或 admin
    if (!isOwner && !(req.user.role === 'admin' && !isConfidential)) {
      return res.status(403).json({ error: isConfidential ? '保密知識庫僅擁有者可刪除' : '僅知識庫擁有者可刪除' });
    }
    // Delete uploaded files
    const kbDir = path.join(UPLOAD_BASE, 'kb', req.params.id);
    if (fs.existsSync(kbDir)) fs.rmSync(kbDir, { recursive: true });
    // 先 DROP KB_CHUNKS partition（比 cascade delete 快）
    const { dropKbChunksPartition } = require('../database-oracle');
    await dropKbChunksPartition(req.params.id);
    await db.prepare('DELETE FROM knowledge_bases WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb/:id/documents  ───────────────────────────────────────────────
router.get('/:id/documents', async (req, res) => {
  const db = getDb();
  try {
    const kb = await getAccessibleKb(db, req.params.id, req.user.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫或無存取權限(保密 KB 需 owner 分享)' });
    const docs = await db.prepare(
      `SELECT id, kb_id, filename, file_type, file_size, word_count, chunk_count, status, error_msg,
              TO_CHAR(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
              TO_CHAR(updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at
       FROM kb_documents WHERE kb_id=? ORDER BY created_at DESC`
    ).all(req.params.id);
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kb/:id/documents  (upload) ─────────────────────────────────────
async function uploadDocumentsHandler(req, res) {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });

    // Per-upload parse_mode override; falls back to KB-level default
    const uploadParseMode = (() => {
      const v = req.body?.parse_mode;
      return ['text_only', 'format_aware'].includes(v) ? v : (target.parse_mode || 'text_only');
    })();
    // Per-upload pdf_ocr_mode override; falls back to KB-level default
    const uploadPdfOcrMode = (() => {
      const v = req.body?.pdf_ocr_mode;
      return ['off', 'auto', 'force'].includes(v) ? v : (target.pdf_ocr_mode || 'off');
    })();
    // Per-upload extract_images override(true/false/'1'/'0')
    const uploadExtractImages = (() => {
      const v = req.body?.extract_images;
      if (v === undefined || v === null || v === '') return Number(target.extract_embedded_images) !== 0;
      return v === true || v === 'true' || v === '1' || v === 1;
    })();

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '未選擇任何檔案' });
    }

    const quota = await getQuota(db, req.user.id);
    const currentSize = await db.prepare('SELECT COALESCE(SUM(file_size),0) AS total FROM kb_documents WHERE kb_id=?').get(req.params.id);
    const maxBytes = quota.maxSizeMb * 1024 * 1024;
    let usedBytes = Number(currentSize?.total || 0);

    const created = [];
    const toProcess = []; // collect items to process sequentially
    for (const file of req.files) {
      // multer on Windows encodes originalname as latin1; convert to utf8 for CJK filenames
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      if (usedBytes + file.size > maxBytes) {
        fs.unlinkSync(file.path);
        created.push({ filename: originalName, status: 'error', error_msg: '超出容量上限' });
        continue;
      }
      usedBytes += file.size;
      const docId = uuid();
      const ext   = path.extname(originalName).toLowerCase().replace('.', '');
      const storedFilename = path.basename(file.path);
      await db.prepare(`
        INSERT INTO kb_documents (id, kb_id, filename, file_type, file_size, status, parse_mode, pdf_ocr_mode, stored_filename)
        VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?)
      `).run(docId, req.params.id, originalName, ext, file.size, uploadParseMode, uploadPdfOcrMode, storedFilename);

      created.push({ id: docId, filename: originalName, status: 'processing' });
      toProcess.push({ docId, filePath: file.path, ext, parseMode: uploadParseMode, pdfOcrMode: uploadPdfOcrMode, extractImages: uploadExtractImages });
    }

    // Process sequentially to avoid Gemini API rate limits when multiple files are uploaded
    setImmediate(async () => {
      for (const item of toProcess) {
        await processDocument(db, target, item.docId, item.filePath, item.ext, item.parseMode, item.pdfOcrMode, { extractImages: item.extractImages }).catch((e) => {
          console.error('[KB] processDocument error:', e.message);
        });
      }
    });

    // Update KB doc_count & total_size
    await updateKbStats(db, req.params.id);
    res.status(202).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.post('/:id/documents', upload.array('files', 20), uploadDocumentsHandler);

// ─── DELETE /api/kb/:id/documents/:docId  ─────────────────────────────────────
async function deleteDocumentHandler(req, res) {
  const db = getDb();
  try {
    const kbRow = await db.prepare('SELECT id, creator_id, is_confidential FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kbRow) return res.status(404).json({ error: '找不到知識庫' });
    const isOwner = String(kbRow.creator_id) === String(req.user.id);
    const isConfidential = Number(kbRow.is_confidential) === 1;
    // 保密 KB:admin 不能 bypass;非保密 KB:沿用舊規則(owner 或 admin)
    if (!isOwner && !(req.user.role === 'admin' && !isConfidential)) {
      return res.status(403).json({ error: isConfidential ? '保密知識庫僅擁有者可刪除文件' : '僅知識庫擁有者可刪除文件' });
    }

    const doc = await db.prepare('SELECT * FROM kb_documents WHERE id=? AND kb_id=?').get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).json({ error: '找不到文件' });

    // Remove physical file
    const kbDir = path.join(UPLOAD_BASE, 'kb', req.params.id);
    const files = fs.existsSync(kbDir) ? fs.readdirSync(kbDir) : [];
    for (const f of files) {
      if (f.includes(doc.filename.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_'))) {
        try { fs.unlinkSync(path.join(kbDir, f)); } catch {}
      }
    }

    // Phase A:刪除文件時連動清理 doc_embed 內嵌圖(沒 FK,要手動)
    try {
      const embeddedImgs = await db.prepare(`SELECT id, stored_path FROM kb_images WHERE doc_id=?`).all(req.params.docId);
      for (const img of embeddedImgs) {
        try {
          const abs = path.join(UPLOAD_BASE, img.stored_path);
          if (ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), abs) && fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch (e) { console.warn('[KB] unlink embedded image failed:', e.message); }
      }
      await db.prepare(`DELETE FROM kb_images WHERE doc_id=?`).run(req.params.docId);
    } catch (e) { console.warn('[KB] cleanup kb_images on doc delete failed:', e.message); }

    await db.prepare('DELETE FROM kb_documents WHERE id=?').run(req.params.docId);
    await updateKbStats(db, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.delete('/:id/documents/:docId', deleteDocumentHandler);

// ─── POST /api/kb/:id/documents/:docId/reparse  ──────────────────────────────
// Re-parse a single document with optional new pdf_ocr_mode / parse_mode override.
async function reparseDocumentHandler(req, res) {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });

    const doc = await db.prepare('SELECT * FROM kb_documents WHERE id=? AND kb_id=?').get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).json({ error: '找不到文件' });

    const filePath = _resolveDocFilePath(req.params.id, doc);
    if (!filePath) return res.status(410).json({ error: '原始檔案已遺失，無法重新解析' });

    const pdfOcrMode = ['off', 'auto', 'force'].includes(req.body?.pdf_ocr_mode)
      ? req.body.pdf_ocr_mode : (doc.pdf_ocr_mode || target.pdf_ocr_mode || 'off');
    const parseMode = ['text_only', 'format_aware'].includes(req.body?.parse_mode)
      ? req.body.parse_mode : (doc.parse_mode || target.parse_mode || 'text_only');
    const extractImages = req.body?.extract_images === undefined
      ? Number(target.extract_embedded_images) !== 0
      : (req.body.extract_images === true || req.body.extract_images === 'true' || req.body.extract_images === '1' || req.body.extract_images === 1);

    // Delete existing chunks + embedded images (Phase A — reparse 會重新抽圖)
    await db.prepare('DELETE FROM kb_chunks WHERE doc_id=?').run(req.params.docId);
    await _cleanupDocEmbeddedImages(db, req.params.docId);
    await db.prepare(`
      UPDATE kb_documents SET status='processing', chunk_count=0, error_msg=NULL,
        parse_mode=?, pdf_ocr_mode=?, updated_at=SYSTIMESTAMP WHERE id=?
    `).run(parseMode, pdfOcrMode, req.params.docId);
    await updateKbStats(db, req.params.id);

    setImmediate(() => {
      processDocument(db, target, doc.id, filePath, doc.file_type, parseMode, pdfOcrMode, { extractImages }).catch((e) => {
        console.error('[KB] reparse processDocument error:', e.message);
        db.prepare("UPDATE kb_documents SET status='error', error_msg=? WHERE id=?").run(e.message, doc.id).catch(() => {});
      });
    });

    res.status(202).json({ id: doc.id, status: 'processing', parse_mode: parseMode, pdf_ocr_mode: pdfOcrMode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.post('/:id/documents/:docId/reparse', reparseDocumentHandler);

// ─── POST /api/kb/:id/reparse-all  ────────────────────────────────────────────
// Re-parse ALL documents in the KB. Used when the user changes KB-level pdf_ocr_mode.
router.post('/:id/reparse-all', async (req, res) => {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });

    const pdfOcrMode = ['off', 'auto', 'force'].includes(req.body?.pdf_ocr_mode)
      ? req.body.pdf_ocr_mode : (target.pdf_ocr_mode || 'off');
    const parseMode = ['text_only', 'format_aware'].includes(req.body?.parse_mode)
      ? req.body.parse_mode : (target.parse_mode || 'text_only');

    const docs = await db.prepare('SELECT * FROM kb_documents WHERE kb_id=?').all(req.params.id);
    const reparsable = [];
    const skipped = [];
    for (const doc of docs) {
      const fp = _resolveDocFilePath(req.params.id, doc);
      if (fp) reparsable.push({ doc, filePath: fp });
      else skipped.push({ id: doc.id, filename: doc.filename, reason: 'file_missing' });
    }

    // Reset status for all reparsable docs
    for (const { doc } of reparsable) {
      await db.prepare('DELETE FROM kb_chunks WHERE doc_id=?').run(doc.id);
      await _cleanupDocEmbeddedImages(db, doc.id);
      await db.prepare(`
        UPDATE kb_documents SET status='processing', chunk_count=0, error_msg=NULL,
          parse_mode=?, pdf_ocr_mode=?, updated_at=SYSTIMESTAMP WHERE id=?
      `).run(parseMode, pdfOcrMode, doc.id);
    }
    await updateKbStats(db, req.params.id);

    // Fire sequentially in background
    setImmediate(async () => {
      for (const { doc, filePath } of reparsable) {
        await processDocument(db, target, doc.id, filePath, doc.file_type, parseMode, pdfOcrMode).catch((e) => {
          console.error('[KB] reparse-all error:', doc.id, e.message);
          db.prepare("UPDATE kb_documents SET status='error', error_msg=? WHERE id=?").run(e.message, doc.id).catch(() => {});
        });
      }
    });

    res.status(202).json({
      queued: reparsable.length,
      skipped,
      parse_mode: parseMode,
      pdf_ocr_mode: pdfOcrMode,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb/admin/health/oversized-docs  (admin only) ───────────────────
// Health check: find documents whose chunks exceed the configured max_size.
// These were produced by the pre-2026-04-18 chunker that didn't split
// oversized paragraphs. Reparsing with the current code fixes them.
router.get('/admin/health/oversized-docs', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '僅限管理員' });
  const threshold = Math.max(256, Number(req.query.threshold) || 1100); // default 1100 = 1024 + slack
  const db = getDb();
  try {
    const rows = await db.prepare(`
      SELECT c.kb_id, c.doc_id,
             kb.name     AS kb_name,
             kb.creator_id,
             u.name      AS creator_name,
             d.filename,
             d.file_type,
             d.file_size,
             d.status,
             COUNT(*) AS chunk_count,
             MAX(DBMS_LOB.GETLENGTH(c.content)) AS max_chunk_len,
             SUM(CASE WHEN DBMS_LOB.GETLENGTH(c.content) > ? THEN 1 ELSE 0 END) AS oversized_count
      FROM kb_chunks c
      JOIN kb_documents d ON d.id = c.doc_id
      JOIN knowledge_bases kb ON kb.id = c.kb_id
      LEFT JOIN users u ON u.id = kb.creator_id
      GROUP BY c.kb_id, c.doc_id, kb.name, kb.creator_id, u.name, d.filename, d.file_type, d.file_size, d.status
      HAVING SUM(CASE WHEN DBMS_LOB.GETLENGTH(c.content) > ? THEN 1 ELSE 0 END) > 0
      ORDER BY MAX(DBMS_LOB.GETLENGTH(c.content)) DESC
    `).all(threshold, threshold);
    res.json({ threshold, count: rows.length, docs: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kb/admin/health/reparse-oversized  (admin only) ───────────────
// Trigger reparse for every doc found by /oversized-docs. Respects each doc's
// existing parse_mode / pdf_ocr_mode (no mode change — just rechunk via the
// fixed chunker).
router.post('/admin/health/reparse-oversized', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '僅限管理員' });
  const threshold = Math.max(256, Number(req.body?.threshold) || 1100);
  const db = getDb();
  try {
    const rows = await db.prepare(`
      SELECT c.kb_id, c.doc_id
      FROM kb_chunks c
      GROUP BY c.kb_id, c.doc_id
      HAVING MAX(DBMS_LOB.GETLENGTH(c.content)) > ?
    `).all(threshold);

    const queued = [];
    const failed = [];

    for (const r of rows) {
      const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(r.kb_id);
      const doc = await db.prepare('SELECT * FROM kb_documents WHERE id=? AND kb_id=?').get(r.doc_id, r.kb_id);
      if (!kb || !doc) { failed.push({ ...r, reason: 'kb_or_doc_missing' }); continue; }

      const filePath = _resolveDocFilePath(r.kb_id, doc);
      if (!filePath) { failed.push({ kb_id: r.kb_id, doc_id: r.doc_id, filename: doc.filename, reason: 'file_missing' }); continue; }

      const parseMode  = doc.parse_mode    || kb.parse_mode    || 'text_only';
      const pdfOcrMode = doc.pdf_ocr_mode  || kb.pdf_ocr_mode  || 'off';

      await db.prepare('DELETE FROM kb_chunks WHERE doc_id=?').run(r.doc_id);
      await _cleanupDocEmbeddedImages(db, r.doc_id);
      await db.prepare(`
        UPDATE kb_documents SET status='processing', chunk_count=0, error_msg=NULL,
          updated_at=SYSTIMESTAMP WHERE id=?
      `).run(r.doc_id);

      queued.push({ kb_id: r.kb_id, doc_id: r.doc_id, filename: doc.filename });

      // Fire background reparse — don't await; respond fast
      setImmediate(() => {
        processDocument(db, kb, doc.id, filePath, doc.file_type, parseMode, pdfOcrMode).catch((e) => {
          console.error('[KB] health-reparse error:', doc.id, e.message);
          db.prepare("UPDATE kb_documents SET status='error', error_msg=? WHERE id=?").run(e.message, doc.id).catch(() => {});
        });
      });
    }

    res.status(202).json({ threshold, queued: queued.length, failed: failed.length, queued_docs: queued, failed_docs: failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Phase A:reparse / delete 文件時清掉它的 doc_embed 圖(避免孤兒)
async function _cleanupDocEmbeddedImages(db, docId) {
  try {
    const rows = await db.prepare(`SELECT id, stored_path FROM kb_images WHERE doc_id=?`).all(docId);
    for (const img of rows) {
      try {
        const abs = path.join(UPLOAD_BASE, img.stored_path);
        if (ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), abs) && fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (e) { console.warn('[KB] unlink embedded image failed:', e.message); }
    }
    await db.prepare(`DELETE FROM kb_images WHERE doc_id=?`).run(docId);
  } catch (e) {
    console.warn('[KB] _cleanupDocEmbeddedImages failed:', e.message);
  }
}

// Resolve the stored file path for a document — prefers stored_filename, falls back
// to scanning the KB directory for a file whose name contains the sanitized stem.
function _resolveDocFilePath(kbId, doc) {
  const kbDir = path.join(UPLOAD_BASE, 'kb', kbId);
  if (!fs.existsSync(kbDir)) return null;
  if (doc.stored_filename) {
    const p = path.join(kbDir, doc.stored_filename);
    if (fs.existsSync(p)) return p;
  }
  // Legacy fallback: find first file whose name includes the sanitized stem.
  const ext = path.extname(doc.filename);
  const stem = path.basename(doc.filename, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
  try {
    const files = fs.readdirSync(kbDir);
    const match = files.find((f) => f.includes(stem) && f.endsWith(ext));
    return match ? path.join(kbDir, match) : null;
  } catch { return null; }
}

// ─── GET /api/kb/:id/documents/:docId/chunks  ─────────────────────────────────
router.get('/:id/documents/:docId/chunks', async (req, res) => {
  const db = getDb();
  try {
    const kb = await getAccessibleKb(db, req.params.id, req.user.id);
    if (!kb) return res.status(404).json({ error: '無存取權限(保密 KB 需 owner 分享)' });
    const page  = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(50, parseInt(req.query.limit || '20'));
    const offset = (page - 1) * limit;
    const total = await db.prepare('SELECT COUNT(*) AS cnt FROM kb_chunks WHERE doc_id=?').get(req.params.docId);
    const chunks = await db.prepare(`
      SELECT id, position, chunk_type, token_count,
             SUBSTR(content, 1, 500) AS content_preview,
             SUBSTR(parent_content, 1, 300) AS parent_preview
      FROM kb_chunks WHERE doc_id=? ORDER BY position
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `).all(req.params.docId, offset, limit);
    res.json({ chunks, total: total?.cnt || 0, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kb/:id/search  (召回測試) ──────────────────────────────────────
router.post('/:id/search', async (req, res) => {
  const db = getDb();
  try {
    const kb = await getAccessibleKb(db, req.params.id, req.user.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫或無存取權限(保密 KB 需 owner 分享)' });

    const {
      query,
      retrieval_mode,
      top_k,
      score_threshold,
    } = req.body;

    if (!query?.trim()) return res.status(400).json({ error: '請輸入查詢文字' });

    // 若 request 覆寫 retrieval_mode，臨時塞進 kb 物件（service 會認）
    const kbWithOverride = retrieval_mode ? { ...kb, retrieval_mode } : kb;

    const { retrieveKbChunks } = require('../services/kbRetrieval');
    const { results, stats, rerankApplied } = await retrieveKbChunks(db, {
      kb:        kbWithOverride,
      query,
      topK:      top_k != null ? Number(top_k) : undefined,
      scoreThreshold: score_threshold != null ? Number(score_threshold) : undefined,
      userId:    req.user.id,
      source:    'search',
      debug:     !!req.body.debug,
    });

    res.json({
      results,
      elapsed_ms:    stats.elapsed_ms,
      mode:          stats.mode,
      query,
      rerank_applied: rerankApplied,
      stats:         req.body.debug ? stats : undefined,
    });
  } catch (e) {
    console.error('[KB Search]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb/:id/access  ──────────────────────────────────────────────────
router.get('/:id/access', async (req, res) => {
  const db = getDb();
  try {
    const kb = await db.prepare('SELECT creator_id, is_confidential FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    const isOwner = String(kb.creator_id) === String(req.user.id);
    const isConfidential = Number(kb.is_confidential) === 1;
    if (!isOwner && !(req.user.role === 'admin' && !isConfidential)) {
      return res.status(403).json({ error: isConfidential ? '保密知識庫共享設定僅擁有者可檢視' : '僅擁有者可檢視共享設定' });
    }
    const grants = await db.prepare(
      `SELECT ka.*, u.name AS granted_by_name
       FROM kb_access ka
       LEFT JOIN users u ON u.id = ka.granted_by_uid
       WHERE ka.kb_id=? ORDER BY ka.granted_at DESC`
    ).all(req.params.id);
    await resolveGranteeNamesInRows(grants, getLangFromReq(req), db);
    res.json(grants);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kb/:id/access  ─────────────────────────────────────────────────
router.post('/:id/access', async (req, res) => {
  const db = getDb();
  try {
    const kb = await db.prepare('SELECT creator_id, is_confidential FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    const isOwner = String(kb.creator_id) === String(req.user.id);
    const isConfidential = Number(kb.is_confidential) === 1;
    if (!isOwner && !(req.user.role === 'admin' && !isConfidential)) {
      return res.status(403).json({ error: isConfidential ? '保密知識庫僅擁有者可新增共享' : '僅擁有者可新增共享' });
    }

    const { grantee_type, grantee_id, permission = 'use' } = req.body;
    const validTypes = ['user', 'role', 'factory', 'dept', 'profit_center', 'org_section', 'org_group'];
    if (!validTypes.includes(grantee_type) || !grantee_id) {
      return res.status(400).json({ error: '請選擇有效的共享對象' });
    }
    if (!['use', 'edit'].includes(permission)) {
      return res.status(400).json({ error: "permission 必須為 'use' 或 'edit'" });
    }

    const grantId = uuid();
    await db.prepare(`
      INSERT INTO kb_access (id, kb_id, grantee_type, grantee_id, granted_by_type, granted_by_uid, permission)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(grantId, req.params.id, grantee_type, String(grantee_id), req.user.role === 'admin' ? 'admin' : 'creator', req.user.id, permission);

    const grant = await db.prepare('SELECT * FROM kb_access WHERE id=?').get(grantId);
    res.status(201).json(grant);
  } catch (e) {
    if (e.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '此共享對象已存在' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/kb/:id/access/:grantId  ─────────────────────────────────────
router.delete('/:id/access/:grantId', async (req, res) => {
  const db = getDb();
  try {
    const kb = await db.prepare('SELECT creator_id, is_confidential FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    const isOwner = String(kb.creator_id) === String(req.user.id);
    const isConfidential = Number(kb.is_confidential) === 1;
    if (!isOwner && !(req.user.role === 'admin' && !isConfidential)) {
      return res.status(403).json({ error: isConfidential ? '保密知識庫僅擁有者可移除共享' : '僅擁有者可移除共享' });
    }
    await db.prepare('DELETE FROM kb_access WHERE id=? AND kb_id=?').run(req.params.grantId, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kb/:id/request-public  ─────────────────────────────────────────
router.post('/:id/request-public', async (req, res) => {
  const db = getDb();
  try {
    const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    if (String(kb.creator_id) !== String(req.user.id)) return res.status(403).json({ error: '僅擁有者可申請公開' });
    if (Number(kb.is_confidential) === 1) return res.status(403).json({ error: '保密知識庫不可申請公開,請先取消保密' });
    if (kb.public_status === 'public') return res.status(409).json({ error: '已是公開狀態' });
    if (kb.public_status === 'pending') return res.status(409).json({ error: '已送出申請，等待管理員審核' });

    await db.prepare(`
      UPDATE knowledge_bases SET public_status='pending', public_request_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(req.params.id);
    res.json({ success: true, message: '申請已送出，等待管理員審核' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb/:id/retrieval-tests  ─────────────────────────────────────────
router.get('/:id/retrieval-tests', async (req, res) => {
  const db = getDb();
  try {
    const kb = await getAccessibleKb(db, req.params.id, req.user.id);
    if (!kb) return res.status(404).json({ error: '無存取權限' });
    const tests = await db.prepare(`
      SELECT rt.id, rt.query_text, rt.retrieval_mode, rt.top_k, rt.elapsed_ms,
             TO_CHAR(rt.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
             u.name AS user_name
      FROM kb_retrieval_tests rt
      LEFT JOIN users u ON u.id = rt.user_id
      WHERE rt.kb_id=? ORDER BY rt.created_at DESC
      FETCH FIRST 50 ROWS ONLY
    `).all(req.params.id);
    res.json(tests);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb/:id/external-access-log ─────────────────────────────────────
// 給 KB owner 查「我的 KB 過去 N 天被外部 API 動了什麼」。
// 權限對齊「能編輯這個 KB 的人」(owner / kb_access edit / admin 非保密) — 否則 SOC 不夠。
// 純 read-only 看歷史,不會修改任何資料。
//
// Query: ?days=30&limit=200
router.get('/:id/external-access-log', async (req, res) => {
  const db = getDb();
  try {
    const editable = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!editable) return res.status(403).json({ error: '需 KB 編輯權限才能查看外部存取記錄' });

    const days  = Math.min(365, Math.max(1, Number(req.query.days)  || 30));
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));

    const summary = await db.prepare(`
      SELECT
        COUNT(*)                                                       AS req_total,
        NVL(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0)    AS req_errors,
        NVL(SUM(bytes_out),  0)                                        AS bytes_out,
        COUNT(DISTINCT api_key_id)                                     AS distinct_keys,
        COUNT(DISTINCT acts_as_user_id)                                AS distinct_users
      FROM api_key_usage_log
      WHERE kb_id = ? AND called_at >= SYSTIMESTAMP - NUMTODSINTERVAL(?, 'DAY')
    `).get(req.params.id, days);

    const rows = await db.prepare(`
      SELECT l.endpoint, l.method, l.status_code,
             l.resource_id, l.tokens_in, l.tokens_out, l.bytes_out, l.duration_ms,
             l.client_ip, l.error_message,
             TO_CHAR(l.called_at,'YYYY-MM-DD HH24:MI:SS') AS called_at,
             l.api_key_id, k.name AS api_key_name, k.key_prefix,
             l.acts_as_user_id, u.name AS acts_as_name, u.username AS acts_as_username
      FROM api_key_usage_log l
      LEFT JOIN api_keys k ON k.id = l.api_key_id
      LEFT JOIN users    u ON u.id = l.acts_as_user_id
      WHERE l.kb_id = ? AND l.called_at >= SYSTIMESTAMP - NUMTODSINTERVAL(?, 'DAY')
      ORDER BY l.called_at DESC
      FETCH FIRST ${limit} ROWS ONLY
    `).all(req.params.id, days);

    res.json({
      days, limit,
      summary: {
        req_total:      Number(summary?.req_total      || 0),
        req_errors:     Number(summary?.req_errors     || 0),
        bytes_out:      Number(summary?.bytes_out      || 0),
        distinct_keys:  Number(summary?.distinct_keys  || 0),
        distinct_users: Number(summary?.distinct_users || 0),
      },
      rows,
    });
  } catch (e) {
    console.error('[KB External Log]', e);
    res.status(500).json({ error: e.message });
  }
});

// Embed concurrency — Vertex AI 企業配額約 2000+ RPM 實測；20 並發
// 對應 ~1500 RPM，穩定不撞上限。若走 AI Studio free tier (100 RPM)
// 需改 env KB_EMBED_CONCURRENCY=2 以下才不會 429。
const EMBED_CONCURRENCY = Number(process.env.KB_EMBED_CONCURRENCY || 20);

// Is this a rate-limit / quota error from the Gemini API?
function _isRateLimitError(e) {
  const s = String(e?.message || e || '');
  return /\b429\b|Too Many Requests|RESOURCE_EXHAUSTED|quota|rate limit/i.test(s);
}

// ─── Background: process a document ──────────────────────────────────────────
async function processDocument(db, kb, docId, filePath, fileType, parseMode = null, pdfOcrMode = null, opts = {}) {
  try {
    console.log(`[KB] Processing doc ${docId} (${fileType})`);

    // Parse document → text (may include OCR for embedded images / per-page PDF OCR)
    const effectiveOcrModel  = kb.ocr_model || await require('../services/llmDefaults').resolveDefaultModel(db, 'ocr');
    const effectiveParseMode = parseMode   || kb.parse_mode    || 'text_only';
    const effectivePdfOcrMode = pdfOcrMode || kb.pdf_ocr_mode || 'off';
    // Phase A:opts.extractImages=true 時把內嵌圖持久化到 kb_images;false 時走純 OCR(舊行為)
    // 未指定時看 KB 預設(kb.extract_embedded_images,預設 1)
    const shouldExtract = opts.extractImages !== undefined
      ? !!opts.extractImages
      : Number(kb.extract_embedded_images) !== 0;
    const parseOpts = shouldExtract ? { saveTo: { db, kbId: kb.id, docId, userId: kb.creator_id } } : {};
    const { text: rawText, ocrInputTokens, ocrOutputTokens } = await parseDocument(
      filePath, fileType, effectiveOcrModel, effectiveParseMode, effectivePdfOcrMode,
      parseOpts,
    );
    // 同 pipelineKbWriter:中文沒空白,用 split(/\s+/) 算 word 對 CJK 全部低估,改算去空白字數
    const wordCount = rawText.replace(/\s+/g, '').length;

    // Update content in db
    await db.prepare('UPDATE kb_documents SET content=?, word_count=? WHERE id=?').run(rawText, wordCount, docId);

    // Chunk config
    const cfg    = (() => { try { return JSON.parse(kb.chunk_config || '{}'); } catch { return {}; } })();
    const rawChunks = chunkDocument(rawText, kb.chunk_strategy || 'regular', cfg);

    if (rawChunks.length === 0) {
      await db.prepare("UPDATE kb_documents SET status='ready', chunk_count=0, updated_at=SYSTIMESTAMP WHERE id=?").run(docId);
      await updateKbStats(db, kb.id);
      return;
    }

    // Phase A:在 embed 之前先抽掉 [圖片inline:<uuid>] 佔位符 → metadata.image_ids,
    // 讓 embedding 跟最終 DB content 一致(embed 不含佔位符)。
    const IMG_PLACEHOLDER_RE = /\[圖片inline:([a-f0-9-]{36})\]/g;
    const chunks = rawChunks.map((c) => {
      const imageIds = [];
      let m;
      const re = new RegExp(IMG_PLACEHOLDER_RE.source, 'g');
      while ((m = re.exec(c.content)) !== null) imageIds.push(m[1]);
      if (imageIds.length === 0) return { ...c, _imageIds: [] };
      const cleaned = c.content.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
      return { ...c, content: cleaned, _imageIds: imageIds };
    });

    console.log(`[KB] Doc ${docId}: ${chunks.length} chunks, embedding...`);

    const dims = kb.embedding_dims || 768;
    let totalEmbedTokens = 0;

    // Parallel embed with concurrency limit, then sequential INSERT (Oracle pool single conn).
    const { default: pLimit } = await import('p-limit');
    const limit = pLimit(EMBED_CONCURRENCY);

    // Phase 3c: KB 啟用 multi-vector 時，額外 embed title vector（若能抽出 heading）
    const { extractTitle } = require('../services/kbRetrieval');
    let useMultiVector = false;
    try {
      const rc = kb.retrieval_config ? JSON.parse(kb.retrieval_config) : null;
      if (rc?.use_multi_vector === true) useMultiVector = true;
    } catch (_) {}

    const embedded = await Promise.all(chunks.map((chunk, i) => limit(async () => {
      let emb = null;
      let titleEmb = null;
      const title = useMultiVector ? extractTitle(chunk.content) : null;
      // 5 retries; longer backoff with jitter on 429 to avoid thundering herd
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          emb = await embedText(chunk.content, { dims });
          break;
        } catch (e) {
          if (attempt === 4) throw e;
          const base = _isRateLimitError(e)
            ? Math.min(60000, 5000 * Math.pow(2, attempt))  // 5s, 10s, 20s, 40s, cap 60s
            : 1000 * (attempt + 1);                          // 1s, 2s, 3s, 4s
          const jitter = Math.floor(Math.random() * 1000);
          await new Promise((r) => setTimeout(r, base + jitter));
        }
      }
      if (title) {
        try { titleEmb = await embedText(title, { dims }); }
        catch (e) { console.warn(`[KB] title embed failed for chunk ${i}:`, e.message); }
      }
      return {
        index: i, chunk,
        embedding: toVectorStr(emb),
        title_embedding: titleEmb ? toVectorStr(titleEmb) : null,
      };
    })));

    // Phase A:把每張內嵌圖綁到第一個出現它的 chunk(kb_images.chunk_id)— 用於後續刪 chunk 時連動
    const imageChunkBindings = []; // [{ chunkId, imageIds[] }]

    for (const { index: i, chunk, embedding, title_embedding } of embedded) {
      const chunkId = uuid();
      const imageIds = chunk._imageIds || [];
      const metadata = imageIds.length > 0 ? JSON.stringify({ image_ids: imageIds }) : null;
      if (imageIds.length > 0) imageChunkBindings.push({ chunkId, imageIds });

      const chunkTokens = Math.ceil(chunk.content.length / 4);
      await db.prepare(`
        INSERT INTO kb_chunks (id, doc_id, kb_id, parent_id, chunk_type, content, parent_content, position, token_count, embedding, title_embedding, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TO_VECTOR(?), ${title_embedding ? 'TO_VECTOR(?)' : 'NULL'}, ?)
      `).run(
        chunkId, docId, kb.id, null,
        chunk.chunk_type || 'regular',
        chunk.content,
        chunk.parent_content || null,
        i,
        chunkTokens,
        embedding,
        ...(title_embedding ? [title_embedding] : []),
        metadata,
      );
      totalEmbedTokens += chunkTokens;
    }
    const chunkCount = embedded.length;

    await db.prepare(`
      UPDATE kb_documents SET status='ready', chunk_count=?, updated_at=SYSTIMESTAMP WHERE id=?
    `).run(chunkCount, docId);

    // Phase A:把內嵌圖反向綁回它所屬的 chunk(刪 chunk 時可連動刪 image)
    for (const { chunkId, imageIds } of imageChunkBindings) {
      for (const imgId of imageIds) {
        await db.prepare(`UPDATE kb_images SET chunk_id=? WHERE id=? AND chunk_id IS NULL`).run(chunkId, imgId).catch(() => {});
      }
    }

    // Record embedding token usage for billing
    const today = new Date().toISOString().slice(0, 10);
    if (totalEmbedTokens > 0 && kb.creator_id) {
      const embedModel = kb.embedding_model || await require('../services/llmDefaults').resolveDefaultModel(db, 'embedding');
      await upsertEmbedTokenUsage(db, kb.creator_id, today, embedModel, totalEmbedTokens);
    }

    // Record OCR token usage for billing (DOCX / PPTX embedded images)
    if ((ocrInputTokens > 0 || ocrOutputTokens > 0) && kb.creator_id) {
      await upsertOcrTokenUsage(db, kb.creator_id, today, effectiveOcrModel, ocrInputTokens, ocrOutputTokens);
    }

    await updateKbStats(db, kb.id);
    console.log(`[KB] Doc ${docId} done. ${chunkCount} chunks stored.`);
  } catch (e) {
    console.error(`[KB] processDocument ${docId} failed:`, e.message);
    await db.prepare(`UPDATE kb_documents SET status='error', error_msg=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(e.message.slice(0, 500), docId).catch(() => {});
  }
}

async function updateKbStats(db, kbId) {
  try {
    const s = await db.prepare(`
      SELECT COUNT(*) AS doc_count, COALESCE(SUM(file_size),0) AS total_bytes, COALESCE(SUM(chunk_count),0) AS chunk_count
      FROM kb_documents WHERE kb_id=?
    `).get(kbId);
    await db.prepare(`
      UPDATE knowledge_bases SET doc_count=?, chunk_count=?, total_size_bytes=?, updated_at=SYSTIMESTAMP WHERE id=?
    `).run(s?.doc_count || 0, s?.chunk_count || 0, s?.total_bytes || 0, kbId);
  } catch (_) {}
}

// ─── POST /api/kb/:id/translate — 重新翻譯 ────────────────────────────────────
router.post('/:id/translate', async (req, res) => {
  const db = getDb();
  try {
    const kb = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!kb) return res.status(403).json({ error: '無編輯權限' });
    const trans = await translateFields({ name: kb.name, description: kb.description });
    await db.prepare(`UPDATE knowledge_bases SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
      .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, req.params.id);
    res.json(trans);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  KB Images (2026-05-12)
//
//  方案 B(此 phase):user 在 KB 圖庫獨立上傳圖片 → vision caption(Gemini Flash)
//  → 建一個 chunk_type='image' 的 kb_chunks(content=caption + filename),embed 進 vector。
//  retrieval 命中時把 image_id 一起送進 LLM context,LLM 用 ![desc](kb-img://{id}) 引用。
//
//  方案 A(未來 phase):docx/pdf parser 抽出內嵌圖,綁回對應 chunk 的 metadata.image_ids,
//  不另建 image chunk(內嵌圖通常與相鄰段落相關,共用該段 chunk 的 embedding)。
// ═════════════════════════════════════════════════════════════════════════════

const imageStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const id = req.params.id;
    if (id !== undefined && !isSafeId(String(id))) return cb(new Error('Invalid KB id'));
    const dir = path.join(UPLOAD_BASE, 'kb', id || 'tmp', 'images');
    if (!ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), dir)) return cb(new Error('Path escape detected'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    // 真正存檔名用 UUID,顯示用原始檔名 → 完全避開重名問題
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 單張 20 MB
  fileFilter(_req, file, cb) {
    if (!/^image\/(png|jpeg|jpg|gif|webp|bmp)$/i.test(file.mimetype)) {
      return cb(new Error('僅接受 png/jpeg/gif/webp/bmp 圖片'), false);
    }
    cb(null, true);
  },
});

// 背景處理一張 manual 上傳的圖:vision caption → embed → 建 image chunk
// 失敗時 UPDATE kb_images SET caption_status='failed', caption_error=...
async function _indexManualImage(db, target, imageId, filePath, mimetype, originalName, userCaption, userId) {
  try {
    const imgBuf = fs.readFileSync(filePath);
    let aiCaption = '';
    if (!userCaption) {
      aiCaption = await captionImage(imgBuf, mimetype);
      // captionImage 內部 catch 後回空字串 → 視為失敗
      if (!aiCaption) {
        await db.prepare(`UPDATE kb_images SET caption_status='failed', caption_error=?, updated_at=SYSTIMESTAMP WHERE id=?`)
          .run('AI 圖片描述產生失敗(可能 vision 配額不足或圖片無法解析)', imageId).catch(() => {});
        return;
      }
    }
    const finalCaption = userCaption || aiCaption || originalName.replace(/\.[^.]+$/, '');

    if (!userCaption && aiCaption) {
      await db.prepare(`UPDATE kb_images SET caption=?, caption_status='done', caption_error=NULL, updated_at=SYSTIMESTAMP WHERE id=?`)
        .run(aiCaption, imageId).catch(() => {});
    }

    // 建 image chunk
    const chunkContent = `[圖片] ${originalName}\n${finalCaption}`;
    const dims = target.embedding_dims || 768;
    const emb = await embedText(chunkContent, { dims });
    const embedStr = toVectorStr(emb);
    const chunkTokens = Math.ceil(chunkContent.length / 4);
    const today = new Date().toISOString().slice(0, 10);
    const embedModel = target.embedding_model || await require('../services/llmDefaults').resolveDefaultModel(db, 'embedding');
    await upsertEmbedTokenUsage(db, target.creator_id || userId, today, embedModel, chunkTokens);

    const chunkId = uuid();
    await db.prepare(`
      INSERT INTO kb_chunks (id, doc_id, kb_id, chunk_type, content, position, token_count, embedding, metadata)
      VALUES (?, NULL, ?, 'image', ?, 0, ?, TO_VECTOR(?), ?)
    `).run(
      chunkId, target.id,
      chunkContent,
      chunkTokens,
      embedStr,
      JSON.stringify({ image_id: imageId, filename: originalName }),
    );
    await db.prepare(`UPDATE kb_images SET chunk_id=? WHERE id=?`).run(chunkId, imageId).catch(() => {});
    console.log(`[KB Image] ${imageId} indexed → chunk ${chunkId}`);
  } catch (e) {
    console.error('[KB Image] background indexing failed:', imageId, e.message);
    await db.prepare(`UPDATE kb_images SET caption_status='failed', caption_error=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(String(e.message || e).slice(0, 1000), imageId).catch(() => {});
  }
}

// 取圖片描述:Gemini Flash vision,prompt 設計成「20-80 字描述 + OCR 文字」
async function captionImage(imageBuffer, mimeType) {
  try {
    const { getGenerativeModel, extractText } = require('../services/geminiClient');
    const model = getGenerativeModel({
      model: process.env.KB_IMAGE_CAPTION_MODEL || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
    });
    const result = await model.generateContent([
      { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
      { text:
        '請用繁體中文描述這張圖片,包含:\n' +
        '1) 主題與場景(20-80 字)\n' +
        '2) 圖片中可見的所有文字(逐字抄錄,若無則省略)\n' +
        '3) 關鍵物件/人物/數據(若有)\n' +
        '直接輸出描述,不要 markdown、不要前綴。'
      },
    ]);
    return extractText(result).trim();
  } catch (e) {
    console.warn('[KB Image] caption failed:', e.message);
    return '';
  }
}

// ─── POST /api/kb/:id/images  (上傳圖片) ─────────────────────────────────────
// 方案 B:user 主動上傳獨立圖片
async function uploadImagesHandler(req, res) {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: '未選擇任何檔案' });

    // 確保 KB 有 chunk partition(從未上傳過文件的 KB 可能沒建)
    try {
      const { addKbChunksPartition } = require('../database-oracle');
      await addKbChunksPartition(target.id).catch(() => {});
    } catch (_) {}

    const userCaption = (req.body?.caption || '').toString().trim();
    const created = [];

    for (const file of req.files) {
      const imageId      = uuid();
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      // stored_path 存相對路徑(uploads/kb/<kb_id>/images/<uuid>.<ext>),download 時拼上 UPLOAD_BASE
      const relPath      = path.posix.join('kb', target.id, 'images', path.basename(file.path));

      // user 有給 caption 就 done,沒給就 processing(背景跑 vision)
      const initialStatus = userCaption ? 'done' : 'processing';
      await db.prepare(`
        INSERT INTO kb_images
          (id, kb_id, doc_id, chunk_id, source, filename, stored_path, mime_type, file_size, caption, caption_status, created_by)
        VALUES (?, ?, NULL, NULL, 'manual', ?, ?, ?, ?, ?, ?, ?)
      `).run(imageId, target.id, originalName, relPath, file.mimetype, file.size, userCaption || null, initialStatus, req.user.id);

      created.push({ id: imageId, filename: originalName, status: initialStatus });

      // 背景跑 caption + embed + 建 image chunk
      setImmediate(() => _indexManualImage(db, target, imageId, file.path, file.mimetype, originalName, userCaption, req.user.id));
    }

    res.status(202).json(created);
  } catch (e) {
    console.error('[KB Image] upload error:', e);
    res.status(500).json({ error: e.message });
  }
}
router.post('/:id/images', imageUpload.array('files', 10), uploadImagesHandler);

// ─── GET /api/kb/:id/images  (列出 KB 內所有圖片) ────────────────────────────
router.get('/:id/images', async (req, res) => {
  const db = getDb();
  try {
    const kb = await getAccessibleKb(db, req.params.id, req.user.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫或無存取權限(保密 KB 需 owner 分享)' });
    const rows = await db.prepare(`
      SELECT id, kb_id, doc_id, chunk_id, source, filename, mime_type, file_size, caption,
             caption_status, caption_error,
             width, height, created_by,
             TO_CHAR(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at
      FROM kb_images WHERE kb_id=? ORDER BY created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/kb/:id/images/:imageId  (更新 caption) ──────────────────────
async function patchImageHandler(req, res) {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });
    const img = await db.prepare('SELECT * FROM kb_images WHERE id=? AND kb_id=?').get(req.params.imageId, req.params.id);
    if (!img) return res.status(404).json({ error: '找不到圖片' });

    const caption = (req.body?.caption || '').toString().trim();
    await db.prepare(`UPDATE kb_images SET caption=?, updated_at=SYSTIMESTAMP WHERE id=?`).run(caption || null, req.params.imageId);

    // 同步更新對應 chunk + 重新 embed(讓檢索跟著新 caption 走)
    if (img.chunk_id) {
      const newContent = `[圖片] ${img.filename}\n${caption || img.filename.replace(/\.[^.]+$/, '')}`;
      try {
        const dims = target.embedding_dims || 768;
        const emb = await embedText(newContent, { dims });
        const chunkTokens = Math.ceil(newContent.length / 4);
        const today = new Date().toISOString().slice(0, 10);
        const embedModel = target.embedding_model || await require('../services/llmDefaults').resolveDefaultModel(db, 'embedding');
        await upsertEmbedTokenUsage(db, target.creator_id || req.user.id, today, embedModel, chunkTokens);
        await db.prepare(`UPDATE kb_chunks SET content=?, token_count=?, embedding=TO_VECTOR(?) WHERE id=?`).run(
          newContent, chunkTokens, toVectorStr(emb), img.chunk_id,
        );
      } catch (e) {
        console.warn('[KB Image] re-embed on caption update failed:', e.message);
      }
    }
    res.json({ id: req.params.imageId, caption });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.patch('/:id/images/:imageId', patchImageHandler);

// ─── POST /api/kb/:id/images/batch-delete  (批次刪除) ────────────────────────
async function batchDeleteImagesHandler(req, res) {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
    if (ids.length === 0) return res.status(400).json({ error: '請提供至少一個圖片 id' });
    if (ids.length > 200) return res.status(400).json({ error: '單次最多刪除 200 張' });

    const deleted = [];
    const failed = [];
    for (const id of ids) {
      try {
        const img = await db.prepare('SELECT * FROM kb_images WHERE id=? AND kb_id=?').get(id, req.params.id);
        if (!img) { failed.push({ id, error: 'not_found' }); continue; }
        try {
          const abs = path.join(UPLOAD_BASE, img.stored_path);
          if (ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), abs) && fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch (e) { console.warn('[KB Image] batch unlink failed:', e.message); }
        if (img.chunk_id) {
          await db.prepare('DELETE FROM kb_chunks WHERE id=?').run(img.chunk_id).catch(() => {});
        }
        await db.prepare('DELETE FROM kb_images WHERE id=?').run(id);
        deleted.push(id);
      } catch (e) {
        failed.push({ id, error: e.message });
      }
    }
    res.json({ deleted: deleted.length, failed: failed.length, failed_items: failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.post('/:id/images/batch-delete', batchDeleteImagesHandler);

// ─── POST /api/kb/:id/images/:imageId/retry-caption  (重試 vision caption) ──
async function retryCaptionHandler(req, res) {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });
    const img = await db.prepare('SELECT * FROM kb_images WHERE id=? AND kb_id=?').get(req.params.imageId, req.params.id);
    if (!img) return res.status(404).json({ error: '找不到圖片' });
    if (img.source !== 'manual') return res.status(400).json({ error: '只能重試手動上傳的圖(內嵌圖請改用文件重新解析)' });

    // reset status,清掉舊 chunk(會重新建),重新 indexing
    if (img.chunk_id) {
      await db.prepare('DELETE FROM kb_chunks WHERE id=?').run(img.chunk_id).catch(() => {});
    }
    await db.prepare(`UPDATE kb_images SET caption_status='processing', caption_error=NULL, chunk_id=NULL, updated_at=SYSTIMESTAMP WHERE id=?`).run(req.params.imageId);

    const absPath = path.join(UPLOAD_BASE, img.stored_path);
    if (!ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), absPath) || !fs.existsSync(absPath)) {
      await db.prepare(`UPDATE kb_images SET caption_status='failed', caption_error=? WHERE id=?`)
        .run('檔案已遺失', req.params.imageId);
      return res.status(410).json({ error: '檔案已遺失,無法重試' });
    }
    setImmediate(() => _indexManualImage(db, target, img.id, absPath, img.mime_type, img.filename, null, req.user.id));
    res.status(202).json({ id: img.id, status: 'processing' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.post('/:id/images/:imageId/retry-caption', retryCaptionHandler);

// ─── DELETE /api/kb/:id/images/:imageId ─────────────────────────────────────
async function deleteImageHandler(req, res) {
  const db = getDb();
  try {
    const target = await getEditableKb(db, req.params.id, req.user.id, req.user.role);
    if (!target) return res.status(403).json({ error: '無編輯權限' });
    const img = await db.prepare('SELECT * FROM kb_images WHERE id=? AND kb_id=?').get(req.params.imageId, req.params.id);
    if (!img) return res.status(404).json({ error: '找不到圖片' });

    // 刪實體檔
    try {
      const abs = path.join(UPLOAD_BASE, img.stored_path);
      if (ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), abs) && fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (e) { console.warn('[KB Image] unlink failed:', e.message); }

    // 刪對應 chunk(若有)
    if (img.chunk_id) {
      await db.prepare('DELETE FROM kb_chunks WHERE id=?').run(img.chunk_id).catch(() => {});
    }
    await db.prepare('DELETE FROM kb_images WHERE id=?').run(req.params.imageId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.delete('/:id/images/:imageId', deleteImageHandler);

// ─── GET /api/kb/images/:imageId  (公開下載,走 KB access check) ────────────
// 路徑特意不帶 :id,讓 LLM 引用 `kb-img://{uuid}` 不用記 kb_id;
// access check 用 image.kb_id 查 getAccessibleKb(含保密 KB 規則)。
router.get('/images/:imageId', async (req, res) => {
  const db = getDb();
  try {
    if (!isSafeId(req.params.imageId)) return res.status(400).json({ error: 'Invalid image id' });
    const img = await db.prepare('SELECT * FROM kb_images WHERE id=?').get(req.params.imageId);
    if (!img) return res.status(404).json({ error: '找不到圖片' });

    // 權限:走 getAccessibleKb,保密 KB 自動套用既有規則(admin metadata-only 看不到 → 擋)
    const kb = await getAccessibleKb(db, img.kb_id, req.user.id);
    if (!kb) return res.status(404).json({ error: '無存取權限' });

    const abs = path.join(UPLOAD_BASE, img.stored_path);
    if (!ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), abs)) return res.status(400).json({ error: 'Path escape' });
    if (!fs.existsSync(abs)) return res.status(410).json({ error: '檔案已遺失' });

    res.setHeader('Content-Type', img.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300'); // 5 min cache(權限會變)
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    console.error('[KB Image] download error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Express Router 物件是 function,可以掛 properties 給 external API wrapper reuse。
// externalKb.js 會用這些 named handler + multer instance 在 acts_as_user 模式下做寫入操作,
// 完整套用既有保密 KB / kb_access / 配額 / audit 規則,不重複實作 logic。
module.exports = Object.assign(router, {
  handlers: {
    putKbHandler,
    uploadDocumentsHandler,
    deleteDocumentHandler,
    reparseDocumentHandler,
    uploadImagesHandler,
    deleteImageHandler,
    patchImageHandler,
    batchDeleteImagesHandler,
    retryCaptionHandler,
  },
  multer: {
    upload,        // 文件上傳(200 MB,full classifyUpload)
    imageUpload,   // 圖片上傳(20 MB,僅 png/jpeg/gif/webp/bmp)
  },
});
