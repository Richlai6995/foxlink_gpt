const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');
const db = require('../database-oracle').db;

router.use(verifyToken);
router.use(verifyAdmin);

// GET /api/roles  — list all roles with assigned MCP/DIFY ids
router.get('/', async (req, res) => {
  try {
    const roles = await db.prepare(`SELECT * FROM roles ORDER BY id ASC`).all();
    for (const role of roles) {
      role.mcp_server_ids = (await db
        .prepare(`SELECT mcp_server_id FROM role_mcp_servers WHERE role_id=?`)
        .all(role.id))
        .map((r) => r.mcp_server_id);
      role.dify_kb_ids = (await db
        .prepare(`SELECT dify_kb_id FROM role_dify_kbs WHERE role_id=?`)
        .all(role.id))
        .map((r) => r.dify_kb_id);
    }
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/roles  — create role
router.post('/', async (req, res) => {
  const { name, description, is_default, mcp_server_ids = [], dify_kb_ids = [],
    budget_daily, budget_weekly, budget_monthly,
    allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
    allow_image_upload, image_max_mb, allow_scheduled_tasks,
    allow_create_skill, allow_external_skill, allow_code_skill,
    can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research } = req.body;
  if (!name) return res.status(400).json({ error: 'name 為必填' });
  try {
    if (is_default) {
      await db.prepare(`UPDATE roles SET is_default=0`).run();
    }
    const parseBudget = (v) => (v != null && v !== '') ? Number(v) : null;
    const result = await db
      .prepare(`INSERT INTO roles (name, description, is_default,
                  budget_daily, budget_weekly, budget_monthly,
                  allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
                  allow_image_upload, image_max_mb, allow_scheduled_tasks,
                  allow_create_skill, allow_external_skill, allow_code_skill,
                  can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, description || null, is_default ? 1 : 0,
        parseBudget(budget_daily), parseBudget(budget_weekly), parseBudget(budget_monthly),
        allow_text_upload !== undefined ? (allow_text_upload ? 1 : 0) : 1,
        text_max_mb || 10,
        allow_audio_upload !== undefined ? (allow_audio_upload ? 1 : 0) : 0,
        audio_max_mb || 10,
        allow_image_upload !== undefined ? (allow_image_upload ? 1 : 0) : 1,
        image_max_mb || 10,
        allow_scheduled_tasks ? 1 : 0,
        allow_create_skill ? 1 : 0,
        allow_external_skill ? 1 : 0,
        allow_code_skill ? 1 : 0,
        can_create_kb ? 1 : 0,
        kb_max_size_mb != null ? Number(kb_max_size_mb) : 500,
        kb_max_count   != null ? Number(kb_max_count)   : 5,
        can_deep_research !== undefined ? (can_deep_research ? 1 : 0) : 1);
    const roleId = result.lastInsertRowid;
    await _syncAssignments(db, roleId, mcp_server_ids, dify_kb_ids);
    res.json({ id: roleId, success: true });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: '角色名稱已存在' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/roles/:id  — update role
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, is_default, mcp_server_ids = [], dify_kb_ids = [],
    budget_daily, budget_weekly, budget_monthly,
    allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
    allow_image_upload, image_max_mb, allow_scheduled_tasks,
    allow_create_skill, allow_external_skill, allow_code_skill,
    can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research } = req.body;
  if (!name) return res.status(400).json({ error: 'name 為必填' });
  try {
    if (is_default) {
      await db.prepare(`UPDATE roles SET is_default=0 WHERE id != ?`).run(id);
    }
    const parseBudget = (v) => (v != null && v !== '') ? Number(v) : null;
    await db.prepare(
      `UPDATE roles SET name=?, description=?, is_default=?,
         budget_daily=?, budget_weekly=?, budget_monthly=?,
         allow_text_upload=?, text_max_mb=?, allow_audio_upload=?, audio_max_mb=?,
         allow_image_upload=?, image_max_mb=?, allow_scheduled_tasks=?,
         allow_create_skill=?, allow_external_skill=?, allow_code_skill=?,
         can_create_kb=?, kb_max_size_mb=?, kb_max_count=?, can_deep_research=?,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(name, description || null, is_default ? 1 : 0,
      parseBudget(budget_daily), parseBudget(budget_weekly), parseBudget(budget_monthly),
      allow_text_upload !== undefined ? (allow_text_upload ? 1 : 0) : 1,
      text_max_mb || 10,
      allow_audio_upload !== undefined ? (allow_audio_upload ? 1 : 0) : 0,
      audio_max_mb || 10,
      allow_image_upload !== undefined ? (allow_image_upload ? 1 : 0) : 1,
      image_max_mb || 10,
      allow_scheduled_tasks ? 1 : 0,
      allow_create_skill ? 1 : 0,
      allow_external_skill ? 1 : 0,
      allow_code_skill ? 1 : 0,
      can_create_kb ? 1 : 0,
      kb_max_size_mb != null ? Number(kb_max_size_mb) : 500,
      kb_max_count   != null ? Number(kb_max_count)   : 5,
      can_deep_research !== undefined ? (can_deep_research ? 1 : 0) : 1,
      id);
    await _syncAssignments(db, id, mcp_server_ids, dify_kb_ids);
    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: '角色名稱已存在' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/roles/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare(`UPDATE users SET role_id=NULL WHERE role_id=?`).run(id);
    await db.prepare(`DELETE FROM roles WHERE id=?`).run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── helper ──────────────────────────────────────────────────────────────────
async function _syncAssignments(db, roleId, mcpIds, difyIds) {
  await db.prepare(`DELETE FROM role_mcp_servers WHERE role_id=?`).run(roleId);
  for (const mid of mcpIds) {
    try { await db.prepare(`INSERT INTO role_mcp_servers (role_id, mcp_server_id) VALUES (?, ?)`).run(roleId, mid); } catch (_) { }
  }
  await db.prepare(`DELETE FROM role_dify_kbs WHERE role_id=?`).run(roleId);
  for (const did of difyIds) {
    try { await db.prepare(`INSERT INTO role_dify_kbs (role_id, dify_kb_id) VALUES (?, ?)`).run(roleId, did); } catch (_) { }
  }
}

module.exports = router;
