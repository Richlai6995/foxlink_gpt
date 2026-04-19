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
const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = path.join(UPLOAD_BASE, 'kb', req.params.id || 'tmp');
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
    const allowed = ['.pdf','.docx','.pptx','.xlsx','.xls','.txt','.md','.csv',
                     '.jpg','.jpeg','.png','.gif','.webp','.bmp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }

/**
 * Check if current user can access this KB (owner / shared / public).
 * Returns the kb row or null.
 */
async function getAccessibleKb(db, kbId, userId) {
  const user = await db.prepare('SELECT role, dept_code, profit_center, org_section, org_group_name, role_id, factory_code FROM users WHERE id=?').get(userId);
  if (!user) return null;

  if (user.role === 'admin') {
    return db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kbId);
  }

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
  return kb || null;
}

/**
 * Check if user can EDIT a KB (owner, admin, or has kb_access with permission='edit').
 * Returns the kb row if allowed, null otherwise.
 */
async function getEditableKb(db, kbId, userId, userRole) {
  if (userRole === 'admin') return db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kbId);
  // owner check
  const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kbId);
  if (!kb) return null;
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

  const {
    name, description,
    embedding_dims = 768,
    chunk_strategy = 'regular',
    chunk_config   = {},
    retrieval_mode = 'hybrid',
    rerank_model   = null,
    top_k_fetch    = 10,
    top_k_return   = 5,
    score_threshold = 0,
    ocr_model      = null,
    parse_mode     = 'text_only',
    pdf_ocr_mode   = 'off',
    tags,
    name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi,
  } = req.body;
  const tagsStr = JSON.stringify(tags || []);

  if (!name?.trim()) return res.status(400).json({ error: '知識庫名稱為必填' });
  if (![768, 1536, 3072].includes(Number(embedding_dims))) {
    return res.status(400).json({ error: '維度必須為 768 / 1536 / 3072' });
  }

  try {
    const id = uuid();
    await db.prepare(`
      INSERT INTO knowledge_bases
        (id, creator_id, name, description,
         embedding_model, embedding_dims,
         chunk_strategy, chunk_config,
         retrieval_mode, rerank_model,
         top_k_fetch, top_k_return, score_threshold, ocr_model, parse_mode, pdf_ocr_mode, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      // Both 'use' and 'edit' permissions show the KB in the list.
      // 'use' = can search/chat only; 'edit' = can also modify documents.
      // Oracle does not allow DISTINCT on CLOB columns (ORA-22848).
      // Use a subquery on id only, then join back to get full row including CLOBs.
      rows = await db.prepare(`
        SELECT kb.*, u.name AS creator_name, u.employee_id AS creator_emp
        FROM knowledge_bases kb
        JOIN users u ON u.id = kb.creator_id
        WHERE kb.id IN (
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

    // Mark each row with whether current user is owner
    const result = rows.map((r) => ({
      ...r,
      is_owner: String(r.creator_id) === String(uid) || user.role === 'admin',
      chunk_config: (() => { try { return JSON.parse(r.chunk_config || '{}'); } catch { return {}; } })(),
    }));
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
    const kb = await getAccessibleKb(db, req.params.id, req.user.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫或無存取權限' });
    kb.is_owner = String(kb.creator_id) === String(req.user.id) || req.user.role === 'admin';
    kb.can_edit = kb.is_owner || !!(await getEditableKb(db, req.params.id, req.user.id, req.user.role));
    kb.chunk_config = (() => { try { return JSON.parse(kb.chunk_config || '{}'); } catch { return {}; } })();
    res.json(kb);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /api/kb/:id  ─────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
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
      name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi,
    } = req.body;

    const finalName = name ?? target.name;
    const finalDesc = description !== undefined ? description : target.description;
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

    await db.prepare(`
      UPDATE knowledge_bases
      SET name=?, description=?,
          chunk_strategy=?, chunk_config=?,
          retrieval_mode=?, rerank_model=?,
          top_k_fetch=?, top_k_return=?, score_threshold=?,
          ocr_model=?, parse_mode=?, pdf_ocr_mode=?,
          tags=?, retrieval_config=?,
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
      req.params.id,
    );

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
});

// ─── DELETE /api/kb/:id  ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const db = getDb();
  try {
    const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    if (String(kb.creator_id) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅知識庫擁有者可刪除' });
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
    if (!kb) return res.status(404).json({ error: '找不到知識庫或無存取權限' });
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
router.post('/:id/documents', upload.array('files', 20), async (req, res) => {
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
      toProcess.push({ docId, filePath: file.path, ext, parseMode: uploadParseMode, pdfOcrMode: uploadPdfOcrMode });
    }

    // Process sequentially to avoid Gemini API rate limits when multiple files are uploaded
    setImmediate(async () => {
      for (const item of toProcess) {
        await processDocument(db, target, item.docId, item.filePath, item.ext, item.parseMode, item.pdfOcrMode).catch((e) => {
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
});

// ─── DELETE /api/kb/:id/documents/:docId  ─────────────────────────────────────
router.delete('/:id/documents/:docId', async (req, res) => {
  const db = getDb();
  try {
    const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=? AND creator_id=?').get(req.params.id, req.user.id);
    if (!kb && req.user.role !== 'admin') return res.status(403).json({ error: '僅知識庫擁有者可刪除文件' });

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

    await db.prepare('DELETE FROM kb_documents WHERE id=?').run(req.params.docId);
    await updateKbStats(db, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kb/:id/documents/:docId/reparse  ──────────────────────────────
// Re-parse a single document with optional new pdf_ocr_mode / parse_mode override.
router.post('/:id/documents/:docId/reparse', async (req, res) => {
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

    // Delete existing chunks, update doc mode, mark processing
    await db.prepare('DELETE FROM kb_chunks WHERE doc_id=?').run(req.params.docId);
    await db.prepare(`
      UPDATE kb_documents SET status='processing', chunk_count=0, error_msg=NULL,
        parse_mode=?, pdf_ocr_mode=?, updated_at=SYSTIMESTAMP WHERE id=?
    `).run(parseMode, pdfOcrMode, req.params.docId);
    await updateKbStats(db, req.params.id);

    setImmediate(() => {
      processDocument(db, target, doc.id, filePath, doc.file_type, parseMode, pdfOcrMode).catch((e) => {
        console.error('[KB] reparse processDocument error:', e.message);
        db.prepare("UPDATE kb_documents SET status='error', error_msg=? WHERE id=?").run(e.message, doc.id).catch(() => {});
      });
    });

    res.status(202).json({ id: doc.id, status: 'processing', parse_mode: parseMode, pdf_ocr_mode: pdfOcrMode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    if (!kb) return res.status(404).json({ error: '無存取權限' });
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
    if (!kb) return res.status(404).json({ error: '找不到知識庫或無存取權限' });

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
    const kb = await db.prepare('SELECT creator_id FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    if (String(kb.creator_id) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅擁有者可檢視共享設定' });
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
    const kb = await db.prepare('SELECT creator_id FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    if (String(kb.creator_id) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅擁有者可新增共享' });
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
    const kb = await db.prepare('SELECT creator_id FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫' });
    if (String(kb.creator_id) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅擁有者可移除共享' });
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
async function processDocument(db, kb, docId, filePath, fileType, parseMode = null, pdfOcrMode = null) {
  try {
    console.log(`[KB] Processing doc ${docId} (${fileType})`);

    // Parse document → text (may include OCR for embedded images / per-page PDF OCR)
    const effectiveOcrModel  = kb.ocr_model || await require('../services/llmDefaults').resolveDefaultModel(db, 'ocr');
    const effectiveParseMode = parseMode   || kb.parse_mode    || 'text_only';
    const effectivePdfOcrMode = pdfOcrMode || kb.pdf_ocr_mode || 'off';
    const { text: rawText, ocrInputTokens, ocrOutputTokens } = await parseDocument(
      filePath, fileType, effectiveOcrModel, effectiveParseMode, effectivePdfOcrMode,
    );
    const wordCount = rawText.split(/\s+/).filter(Boolean).length;

    // Update content in db
    await db.prepare('UPDATE kb_documents SET content=?, word_count=? WHERE id=?').run(rawText, wordCount, docId);

    // Chunk config
    const cfg    = (() => { try { return JSON.parse(kb.chunk_config || '{}'); } catch { return {}; } })();
    const chunks = chunkDocument(rawText, kb.chunk_strategy || 'regular', cfg);

    if (chunks.length === 0) {
      await db.prepare("UPDATE kb_documents SET status='ready', chunk_count=0, updated_at=SYSTIMESTAMP WHERE id=?").run(docId);
      await updateKbStats(db, kb.id);
      return;
    }

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

    for (const { index: i, chunk, embedding, title_embedding } of embedded) {
      const chunkId = uuid();
      const chunkTokens = Math.ceil(chunk.content.length / 4);
      await db.prepare(`
        INSERT INTO kb_chunks (id, doc_id, kb_id, parent_id, chunk_type, content, parent_content, position, token_count, embedding, title_embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TO_VECTOR(?), ${title_embedding ? 'TO_VECTOR(?)' : 'NULL'})
      `).run(
        chunkId, docId, kb.id, null,
        chunk.chunk_type || 'regular',
        chunk.content,
        chunk.parent_content || null,
        i,
        chunkTokens,
        embedding,
        ...(title_embedding ? [title_embedding] : []),
      );
      totalEmbedTokens += chunkTokens;
    }
    const chunkCount = embedded.length;

    await db.prepare(`
      UPDATE kb_documents SET status='ready', chunk_count=?, updated_at=SYSTIMESTAMP WHERE id=?
    `).run(chunkCount, docId);

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

module.exports = router;
