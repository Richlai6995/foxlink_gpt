'use strict';

/**
 * Pipeline Writable Tables 管理 API
 *
 * 提供 admin(role='admin' 或 is_pipeline_admin=1)管理可被 pipeline `db_write` 節點寫入的表白名單。
 *
 * 路由(mount 在 /api/pipeline-writable-tables):
 *   GET    /                      list
 *   GET    /available-tables      列出 DB 中可被核准的表(扣除黑名單 + 已核准)
 *   GET    /:id                   get one
 *   POST   /                      create(admin 核准新表)
 *   PUT    /:id                   update
 *   DELETE /:id                   soft-delete(is_active=0)或硬刪
 *   POST   /:id/refresh-columns   從 ALL_TAB_COLUMNS 重新抓欄位 metadata
 *   POST   /dry-run               試跑,不寫 DB
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const { FORBIDDEN_TABLES, isForbidden, isValidIdentifier, OPERATIONS, TRANSFORMS } = require('../config/pipelineSecurity');

// ── 權限 middleware ──────────────────────────────────────────────────────────
function verifyPipelineAdmin(req, res, next) {
  const u = req.user || {};
  if (u.role === 'admin' || u.is_pipeline_admin === 1 || u.is_pipeline_admin === true) return next();
  return res.status(403).json({ error: '需要 pipeline_admin 或管理員權限' });
}

router.use(verifyToken);
router.use(verifyPipelineAdmin);

const db = () => require('../database-oracle').db;

// ── GET / — list ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await db().prepare(
      `SELECT id, table_name, display_name, description, allowed_operations,
              max_rows_per_run, is_active, approved_by, approved_at, last_refreshed_at, notes
       FROM pipeline_writable_tables ORDER BY is_active DESC, table_name`
    ).all();
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /available-tables — DB 中尚未核准的可選表 ────────────────────────────
router.get('/available-tables', async (req, res) => {
  try {
    const approved = await db().prepare(`SELECT LOWER(table_name) AS tn FROM pipeline_writable_tables`).all();
    const approvedSet = new Set((approved || []).map(r => r.tn || r.TN));

    const all = await db().prepare(
      `SELECT LOWER(table_name) AS tn FROM user_tables ORDER BY table_name`
    ).all();

    const candidates = (all || [])
      .map(r => r.tn || r.TN)
      .filter(t => t && !isForbidden(t) && !approvedSet.has(t));

    res.json(candidates);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const row = await db().prepare(
      `SELECT * FROM pipeline_writable_tables WHERE id=?`
    ).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'not found' });
    // parse column_metadata
    try { row.column_metadata = JSON.parse(row.column_metadata || row.COLUMN_METADATA || '[]'); }
    catch { row.column_metadata = []; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST / — create ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      table_name, display_name, description,
      allowed_operations, max_rows_per_run, notes,
    } = req.body;

    const tn = String(table_name || '').toLowerCase().trim();
    if (!isValidIdentifier(tn)) return res.status(400).json({ error: '非法 table 名稱' });
    if (isForbidden(tn)) return res.status(400).json({ error: `table ${tn} 位於系統黑名單,禁止核准` });

    // 檢查 DB 裡真的有這張表
    const tbl = await db().prepare(
      `SELECT table_name FROM user_tables WHERE UPPER(table_name)=UPPER(?)`
    ).get(tn);
    if (!tbl) return res.status(400).json({ error: `DB 中找不到 table ${tn}` });

    // 驗證 allowed_operations
    const ops = String(allowed_operations || 'insert,upsert').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const op of ops) {
      if (!OPERATIONS.includes(op)) return res.status(400).json({ error: `不支援的 operation: ${op}` });
    }

    // 自動抓欄位 metadata
    const cols = await db().prepare(
      `SELECT column_name, data_type, nullable, data_length, data_precision, data_scale
       FROM user_tab_columns WHERE UPPER(table_name)=UPPER(?) ORDER BY column_id`
    ).all(tn);
    const columnMeta = (cols || []).map(c => ({
      name: (c.column_name || c.COLUMN_NAME || '').toLowerCase(),
      type: c.data_type || c.DATA_TYPE,
      nullable: (c.nullable || c.NULLABLE) === 'Y',
      length: c.data_length ?? c.DATA_LENGTH,
      precision: c.data_precision ?? c.DATA_PRECISION,
      scale: c.data_scale ?? c.DATA_SCALE,
    }));

    await db().prepare(
      `INSERT INTO pipeline_writable_tables
         (table_name, display_name, description, allowed_operations, max_rows_per_run,
          column_metadata, is_active, approved_by, approved_at, last_refreshed_at, notes)
       VALUES (?,?,?,?,?,?,1,?,SYSTIMESTAMP,SYSTIMESTAMP,?)`
    ).run(
      tn,
      display_name || tn,
      description || null,
      ops.join(','),
      Number(max_rows_per_run) || 10000,
      JSON.stringify(columnMeta),
      req.user.id,
      notes || null,
    );
    res.json({ ok: true, table_name: tn, columns: columnMeta.length });
  } catch (e) {
    if (/ORA-00001/.test(e.message)) return res.status(400).json({ error: 'table 已經核准' });
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:id — update config(不可改 table_name)────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { display_name, description, allowed_operations, max_rows_per_run, is_active, notes } = req.body;
    const ops = allowed_operations
      ? String(allowed_operations).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : null;
    if (ops) {
      for (const op of ops) if (!OPERATIONS.includes(op)) return res.status(400).json({ error: `不支援的 operation: ${op}` });
    }

    await db().prepare(
      `UPDATE pipeline_writable_tables SET
         display_name      = COALESCE(?, display_name),
         description       = COALESCE(?, description),
         allowed_operations= COALESCE(?, allowed_operations),
         max_rows_per_run  = COALESCE(?, max_rows_per_run),
         is_active         = COALESCE(?, is_active),
         notes             = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      display_name ?? null,
      description ?? null,
      ops ? ops.join(',') : null,
      max_rows_per_run != null ? Number(max_rows_per_run) : null,
      is_active != null ? (is_active ? 1 : 0) : null,
      notes ?? null,
      Number(req.params.id),
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db().prepare(`DELETE FROM pipeline_writable_tables WHERE id=?`).run(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /:id/refresh-columns — 重新抓 ALL_TAB_COLUMNS ─────────────────────
router.post('/:id/refresh-columns', async (req, res) => {
  try {
    const row = await db().prepare(`SELECT table_name FROM pipeline_writable_tables WHERE id=?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'not found' });
    const tn = (row.table_name || row.TABLE_NAME).toLowerCase();

    const cols = await db().prepare(
      `SELECT column_name, data_type, nullable, data_length, data_precision, data_scale
       FROM user_tab_columns WHERE UPPER(table_name)=UPPER(?) ORDER BY column_id`
    ).all(tn);
    const columnMeta = (cols || []).map(c => ({
      name: (c.column_name || c.COLUMN_NAME || '').toLowerCase(),
      type: c.data_type || c.DATA_TYPE,
      nullable: (c.nullable || c.NULLABLE) === 'Y',
      length: c.data_length ?? c.DATA_LENGTH,
      precision: c.data_precision ?? c.DATA_PRECISION,
      scale: c.data_scale ?? c.DATA_SCALE,
    }));

    await db().prepare(
      `UPDATE pipeline_writable_tables SET column_metadata=?, last_refreshed_at=SYSTIMESTAMP WHERE id=?`
    ).run(JSON.stringify(columnMeta), Number(req.params.id));

    res.json({ ok: true, columns: columnMeta });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /dry-run — 模擬執行,不實際寫入 ─────────────────────────────────────
// body: { node_config, source_text }  — node_config 是 pipeline node 的完整設定
router.post('/dry-run', async (req, res) => {
  try {
    const { node_config, source_text } = req.body || {};
    if (!node_config) return res.status(400).json({ error: '缺少 node_config' });

    const { executeDbWrite } = require('../services/pipelineDbWriter');
    const result = await executeDbWrite(db(), node_config, source_text || '', {
      user: req.user,
      userId: req.user.id,
      runId: Date.now(),
      taskName: 'DRY-RUN',
      nodeId: 'preview',
      dryRun: true,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message, partial: e._partialResult || null });
  }
});

// ── GET /_config/meta — 給前端 UI 取可用的 transforms / operations ──────────
router.get('/_config/meta', (req, res) => {
  res.json({
    operations: OPERATIONS,
    transforms: Object.keys(TRANSFORMS),
    forbidden_tables: [...FORBIDDEN_TABLES],
  });
});

module.exports = router;
module.exports.verifyPipelineAdmin = verifyPipelineAdmin;
