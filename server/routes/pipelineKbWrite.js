'use strict';

/**
 * Pipeline KB Write API
 *
 * 給 pipeline `kb_write` 節點 admin UI 用,不是面向終端使用者的功能。
 * 權限走 KB 既有共享(getAccessibleKbForWrite),不需要 admin / pipeline_admin。
 *
 * Mount 在 /api/pipeline-kb-write:
 *   GET   /accessible-kbs   — 列出 user 有寫入權的 KB(供 UI 下拉)
 *   POST  /dry-run          — 試跑 kb_write 節點,不真寫入
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

router.use(verifyToken);

const db = () => require('../database-oracle').db;

// ── GET /accessible-kbs ──────────────────────────────────────────────────────
// 回傳當前 user 可寫入的 KB(owner / kb_access / public)
router.get('/accessible-kbs', async (req, res) => {
  try {
    const uid = req.user.id;
    const user = await db().prepare(
      `SELECT role, dept_code, profit_center, org_section, org_group_name, role_id, factory_code
       FROM users WHERE id=?`
    ).get(uid);
    if (!user) return res.json([]);

    let rows;
    if (user.role === 'admin') {
      rows = await db().prepare(
        `SELECT id, name, description, doc_count, chunk_count
         FROM knowledge_bases ORDER BY updated_at DESC`
      ).all();
    } else {
      rows = await db().prepare(`
        SELECT kb.id, kb.name, kb.description, kb.doc_count, kb.chunk_count
        FROM knowledge_bases kb
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
    res.json(rows || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /dry-run ────────────────────────────────────────────────────────────
// body: { node_config: { kb_id, ... }, source_text: '...' }
router.post('/dry-run', async (req, res) => {
  try {
    const { node_config, source_text } = req.body || {};
    if (!node_config) return res.status(400).json({ error: '缺少 node_config' });

    const { executeKbWrite } = require('../services/pipelineKbWriter');
    const result = await executeKbWrite(db(), node_config, source_text || '', {
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

module.exports = router;
