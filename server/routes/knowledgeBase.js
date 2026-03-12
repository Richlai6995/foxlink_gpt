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
  const user = await db.prepare('SELECT role, dept_code, profit_center, org_section, org_group_name, role_id FROM users WHERE id=?').get(userId);
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
    user.org_group_name, user.org_group_name,
  );
  return kb || null;
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
router.get('/orgs', async (req, res) => {
  const db = getDb();
  try {
    const [depts, pcs, sections, groups] = await Promise.all([
      db.prepare(`SELECT DISTINCT dept_code AS code, dept_name AS name FROM users WHERE dept_code IS NOT NULL ORDER BY dept_name`).all(),
      db.prepare(`SELECT DISTINCT profit_center AS code, profit_center_name AS name FROM users WHERE profit_center IS NOT NULL ORDER BY profit_center_name`).all(),
      db.prepare(`SELECT DISTINCT org_section AS code, org_section_name AS name FROM users WHERE org_section IS NOT NULL ORDER BY org_section_name`).all(),
      db.prepare(`SELECT DISTINCT org_group_name AS name FROM users WHERE org_group_name IS NOT NULL ORDER BY org_group_name`).all(),
    ]);
    res.json({ depts, profit_centers: pcs, org_sections: sections, org_groups: groups });
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
  } = req.body;

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
         top_k_fetch, top_k_return, score_threshold, ocr_model, parse_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );
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
      'SELECT role, dept_code, profit_center, org_section, org_group_name, role_id FROM users WHERE id=?'
    ).get(uid);
    if (!user) return res.json([]);

    let rows;
    if (user.role === 'admin') {
      rows = await db.prepare(
        `SELECT kb.*, u.name AS creator_name, u.employee_id AS creator_emp
         FROM knowledge_bases kb
         JOIN users u ON u.id = kb.creator_id
         ORDER BY kb.updated_at DESC`
      ).all();
    } else {
      // Shared KBs with permission='use' only grant chat/search access — NOT visible in list/marketplace.
      // Only permission='edit' grants show the KB in the list (user can also view/edit).
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
              SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb2.id AND ka.permission='edit' AND (
                (ka.grantee_type='user'             AND ka.grantee_id=TO_CHAR(?))
                OR (ka.grantee_type='role'          AND ka.grantee_id=TO_CHAR(?))
                OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
                OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
                OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
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
        user.org_group_name, user.org_group_name,
      );
    }

    // Mark each row with whether current user is owner
    const result = rows.map((r) => ({
      ...r,
      is_owner: r.creator_id === uid || user.role === 'admin',
      chunk_config: (() => { try { return JSON.parse(r.chunk_config || '{}'); } catch { return {}; } })(),
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kb/:id  ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const db = getDb();
  try {
    const kb = await getAccessibleKb(db, req.params.id, req.user.id);
    if (!kb) return res.status(404).json({ error: '找不到知識庫或無存取權限' });
    kb.is_owner = kb.creator_id === req.user.id || req.user.role === 'admin';
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
    const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=? AND creator_id=?').get(req.params.id, req.user.id);
    if (!kb && req.user.role !== 'admin') return res.status(403).json({ error: '僅知識庫擁有者可修改設定' });
    const target = kb || await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!target) return res.status(404).json({ error: '找不到知識庫' });

    const {
      name, description,
      chunk_strategy, chunk_config,
      retrieval_mode, rerank_model,
      top_k_fetch, top_k_return, score_threshold,
      ocr_model, parse_mode,
    } = req.body;

    await db.prepare(`
      UPDATE knowledge_bases
      SET name=?, description=?,
          chunk_strategy=?, chunk_config=?,
          retrieval_mode=?, rerank_model=?,
          top_k_fetch=?, top_k_return=?, score_threshold=?,
          ocr_model=?, parse_mode=?,
          updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(
      name ?? target.name,
      description !== undefined ? description : target.description,
      chunk_strategy ?? target.chunk_strategy,
      chunk_config !== undefined ? JSON.stringify(chunk_config) : target.chunk_config,
      retrieval_mode ?? target.retrieval_mode,
      rerank_model !== undefined ? rerank_model : target.rerank_model,
      top_k_fetch  != null ? Number(top_k_fetch)  : target.top_k_fetch,
      top_k_return != null ? Number(top_k_return) : target.top_k_return,
      score_threshold != null ? Number(score_threshold) : target.score_threshold,
      ocr_model !== undefined ? (ocr_model || null) : target.ocr_model,
      parse_mode !== undefined ? (['text_only','format_aware'].includes(parse_mode) ? parse_mode : 'text_only') : (target.parse_mode || 'text_only'),
      req.params.id,
    );
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
    if (kb.creator_id !== req.user.id && req.user.role !== 'admin') {
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
    const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=? AND creator_id=?').get(req.params.id, req.user.id);
    if (!kb && req.user.role !== 'admin') return res.status(403).json({ error: '僅知識庫擁有者可上傳文件' });
    const target = kb || await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(req.params.id);
    if (!target) return res.status(404).json({ error: '找不到知識庫' });

    // Per-upload parse_mode override; falls back to KB-level default
    const uploadParseMode = (() => {
      const v = req.body?.parse_mode;
      return ['text_only', 'format_aware'].includes(v) ? v : (target.parse_mode || 'text_only');
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
      await db.prepare(`
        INSERT INTO kb_documents (id, kb_id, filename, file_type, file_size, status, parse_mode)
        VALUES (?, ?, ?, ?, ?, 'processing', ?)
      `).run(docId, req.params.id, originalName, ext, file.size, uploadParseMode);

      created.push({ id: docId, filename: originalName, status: 'processing' });
      toProcess.push({ docId, filePath: file.path, ext, parseMode: uploadParseMode });
    }

    // Process sequentially to avoid Gemini API rate limits when multiple files are uploaded
    setImmediate(async () => {
      for (const item of toProcess) {
        await processDocument(db, target, item.docId, item.filePath, item.ext, item.parseMode).catch((e) => {
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
      top_k = kb.top_k_return || 5,
      score_threshold = kb.score_threshold || 0,
    } = req.body;

    if (!query?.trim()) return res.status(400).json({ error: '請輸入查詢文字' });

    const mode  = retrieval_mode || kb.retrieval_mode || 'hybrid';
    const topK  = Math.min(Number(top_k), 50);
    const dims  = kb.embedding_dims || 768;
    const t0    = Date.now();

    let results = [];

    // Vector search
    if (mode === 'vector' || mode === 'hybrid') {
      const qEmb   = await embedText(query, { dims });
      const qVecStr = toVectorStr(qEmb);
      const fetchK = Math.min(topK * 3, 100); // fetch more, filter by score later
      const rows   = await db.prepare(`
        SELECT c.id, c.doc_id, c.chunk_type, c.position, c.content,
               c.parent_content,
               d.filename,
               VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vector_score
        FROM kb_chunks c
        JOIN kb_documents d ON d.id = c.doc_id
        WHERE c.kb_id=? AND c.chunk_type != 'parent'
        ORDER BY vector_score ASC
        FETCH FIRST ? ROWS ONLY
      `).all(qVecStr, req.params.id, fetchK);

      results = rows.map((r) => ({
        ...r,
        score: 1 - (r.vector_score || 0), // convert distance → similarity
        match_type: 'vector',
      }));
    }

    // Full-text search
    if (mode === 'fulltext' || mode === 'hybrid') {
      const likeQuery = `%${query.replace(/[%_]/g, '\\$&')}%`;
      const ftRows = await db.prepare(`
        SELECT c.id, c.doc_id, c.chunk_type, c.position, c.content,
               c.parent_content, d.filename,
               1 AS vector_score
        FROM kb_chunks c
        JOIN kb_documents d ON d.id = c.doc_id
        WHERE c.kb_id=? AND c.chunk_type != 'parent'
          AND UPPER(c.content) LIKE UPPER(?)
        FETCH FIRST ? ROWS ONLY
      `).all(req.params.id, likeQuery, topK * 2);

      if (mode === 'fulltext') {
        results = ftRows.map((r) => ({ ...r, score: 0.5, match_type: 'fulltext' }));
      } else {
        // Hybrid: merge & deduplicate, boost chunks found by both methods
        const vecIds = new Set(results.map((r) => r.id));
        for (const r of ftRows) {
          if (vecIds.has(r.id)) {
            const existing = results.find((x) => x.id === r.id);
            if (existing) { existing.score = Math.min(1, existing.score + 0.15); existing.match_type = 'hybrid'; }
          } else {
            results.push({ ...r, score: 0.4, match_type: 'fulltext' });
          }
        }
      }
    }

    // Filter by score threshold
    results = results
      .filter((r) => r.score >= Number(score_threshold))
      .sort((a, b) => b.score - a.score);

    // ── Rerank ──────────────────────────────────────────────────────────────
    // Use kb.rerank_model (llm_models key) if configured, otherwise try any active rerank model
    // Special value 'disabled' = explicitly skip rerank
    let rerankApplied = false;
    try {
      const rerankKey = kb.rerank_model;
      if (rerankKey === 'disabled') throw Object.assign(new Error('rerank disabled'), { _skip: true });
      const rerankRow = rerankKey
        ? await db.prepare(`SELECT id, api_model, extra_config_enc FROM llm_models WHERE key=? AND model_role='rerank' AND is_active=1`).get(rerankKey)
        : await db.prepare(`SELECT id, api_model, extra_config_enc FROM llm_models WHERE model_role='rerank' AND is_active=1 AND ROWNUM=1`).get();

      if (rerankRow?.extra_config_enc && results.length > 1) {
        const { decryptKey } = require('../services/llmKeyService');
        const creds = JSON.parse(decryptKey(rerankRow.extra_config_enc));
        const { rerankOci } = require('../services/ociAi');
        const fetchForRerank = results.slice(0, Math.min(results.length, topK * 3));
        const docs = fetchForRerank.map((r) => r.content || '');
        const rerankResp = await rerankOci(creds, rerankRow.api_model, query.trim(), docs, fetchForRerank.length);
        const ranked = rerankResp?.results || rerankResp?.rankings || [];
        if (ranked.length > 0) {
          results = ranked.map((item) => {
            const orig = fetchForRerank[item.index ?? item.resultIndex ?? 0];
            return { ...orig, rerank_score: item.relevanceScore ?? item.score ?? 0 };
          }).sort((a, b) => b.rerank_score - a.rerank_score);
          rerankApplied = true;
        }
      }
    } catch (e) {
      if (!e._skip) console.warn('[KB Search] Rerank failed, using original order:', e.message);
    }

    results = results.slice(0, topK);

    const elapsed = Date.now() - t0;

    // Save retrieval test record
    try {
      await db.prepare(`
        INSERT INTO kb_retrieval_tests (id, kb_id, user_id, query_text, retrieval_mode, top_k, score_threshold, results_json, elapsed_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuid(), req.params.id, req.user.id, query.slice(0, 500), mode, topK, score_threshold, JSON.stringify(results.map((r) => ({ id: r.id, score: r.score, content: r.content?.slice(0, 200) }))), elapsed);
    } catch (_) {}

    res.json({ results, elapsed_ms: elapsed, mode, query, rerank_applied: rerankApplied });
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
    if (kb.creator_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅擁有者可檢視共享設定' });
    }
    const grants = await db.prepare(
      `SELECT ka.*, u.name AS granted_by_name
       FROM kb_access ka
       LEFT JOIN users u ON u.id = ka.granted_by_uid
       WHERE ka.kb_id=? ORDER BY ka.granted_at DESC`
    ).all(req.params.id);
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
    if (kb.creator_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '僅擁有者可新增共享' });
    }

    const { grantee_type, grantee_id, permission = 'use' } = req.body;
    const validTypes = ['user', 'role', 'dept', 'profit_center', 'org_section', 'org_group'];
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
    if (kb.creator_id !== req.user.id && req.user.role !== 'admin') {
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
    if (kb.creator_id !== req.user.id) return res.status(403).json({ error: '僅擁有者可申請公開' });
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

// ─── Background: process a document ──────────────────────────────────────────
async function processDocument(db, kb, docId, filePath, fileType, parseMode = null) {
  try {
    console.log(`[KB] Processing doc ${docId} (${fileType})`);

    // Parse document → text (may include OCR for embedded images)
    const effectiveOcrModel = kb.ocr_model || await require('../services/llmDefaults').resolveDefaultModel(db, 'ocr');
    const effectiveParseMode = parseMode || kb.parse_mode || 'text_only';
    const { text: rawText, ocrInputTokens, ocrOutputTokens } = await parseDocument(filePath, fileType, effectiveOcrModel, effectiveParseMode);
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
    let chunkCount = 0;
    let totalEmbedTokens = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = uuid();
      const chunkTokens = Math.ceil(chunk.content.length / 4);

      // Embed with retry
      let embedding = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const emb = await embedText(chunk.content, { dims });
          embedding  = toVectorStr(emb);
          break;
        } catch (e) {
          if (attempt === 2) throw e;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }

      await db.prepare(`
        INSERT INTO kb_chunks (id, doc_id, kb_id, parent_id, chunk_type, content, parent_content, position, token_count, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TO_VECTOR(?))
      `).run(
        chunkId, docId, kb.id, null,
        chunk.chunk_type || 'regular',
        chunk.content,
        chunk.parent_content || null,
        i,
        chunkTokens,
        embedding,
      );
      chunkCount++;
      totalEmbedTokens += chunkTokens;

      // Throttle
      if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 100));
    }

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

module.exports = router;
