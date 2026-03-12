/**
 * AI 戰情 Routes — /api/dashboard
 *
 * 權限：
 *   verifyToken              — 所有人
 *   can_use_ai_dashboard     — 查詢功能
 *   can_design_ai_select     — Schema / Topic / Design / ETL 設計功能
 *   admin                    — 全部
 */
const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');

router.use(verifyToken);

// ── Audit helper ──────────────────────────────────────────────────────────────
async function logDashboardAudit(db, userId, designId, question, sql) {
  try {
    await db.prepare(
      `INSERT INTO audit_logs (user_id, session_id, content) VALUES (?, ?, ?)`
    ).run(userId, `dashboard_${designId}`, `[AI戰情室][設計:${designId}] ${question}\nSQL: ${sql || ''}`);
  } catch (e) {
    console.warn('[Dashboard] audit log error:', e.message);
  }
}

// ── Project access check helper ───────────────────────────────────────────────
async function canAccessProject(db, projectId, user, shareType = 'any') {
  if (user.role === 'admin') return true;
  const proj = await db.prepare(`SELECT id, created_by, is_public, public_approved FROM ai_select_projects WHERE id=?`).get(projectId);
  if (!proj) return false;
  if (proj.created_by === user.id) return true;
  if (proj.is_public === 1 && proj.public_approved === 1 && shareType !== 'develop') return true;
  const shares = await db.prepare(
    `SELECT share_type FROM ai_project_shares WHERE project_id=? AND (
       (grantee_type='user' AND grantee_id=?) OR
       (grantee_type='role' AND grantee_id=?) OR
       (grantee_type='department' AND grantee_id=?) OR
       (grantee_type='cost_center' AND grantee_id=?) OR
       (grantee_type='division' AND grantee_id=?) OR
       (grantee_type='org_group' AND grantee_id=?)
     )`
  ).all(
    projectId,
    String(user.id), String(user.role_id || ''), String(user.dept_code || ''),
    String(user.profit_center || ''), String(user.org_section || ''),
    String(user.org_group_name || '')
  );
  if (shareType === 'any') return shares.length > 0;
  if (shareType === 'develop') return shares.some(s => s.share_type === 'develop');
  return shares.length > 0; // 'use'
}

async function canEditProject(db, projectId, user) {
  if (user.role === 'admin') return true;
  const proj = await db.prepare(`SELECT created_by FROM ai_select_projects WHERE id=?`).get(projectId);
  if (!proj) return false;
  if (proj.created_by === user.id) return true;
  return await canAccessProject(db, projectId, user, 'develop');
}

// ── Design-level access check (backward compat) ────────────────────────────────
async function canAccessDesign(db, design, user) {
  if (user.role === 'admin') return true;
  if (design.created_by === user.id) return true;
  if (design.is_public === 1 || design.is_public === '1') return true;
  const shares = await db.prepare(
    `SELECT id FROM ai_dashboard_shares WHERE design_id=? AND (
      (grantee_type='user' AND grantee_id=?) OR
      (grantee_type='role' AND grantee_id=?) OR
      (grantee_type='department' AND grantee_id=?) OR
      (grantee_type='cost_center' AND grantee_id=?) OR
      (grantee_type='division' AND grantee_id=?) OR
      (grantee_type='org_group' AND grantee_id=?)
    )`
  ).all(
    design.id,
    String(user.id),
    String(user.role_id || ''),
    String(user.dept_code || ''),
    String(user.profit_center || ''),
    String(user.org_section || ''),
    String(user.org_group_name || '')
  );
  return shares.length > 0;
}

// ─── Permission middleware ────────────────────────────────────────────────────
async function requireDashboard(req, res, next) {
  try {
    const u = req.user;
    if (u.role === 'admin' || u.can_use_ai_dashboard == 1) return next();
    const db = require('../database-oracle').db;
    if (u.role_id) {
      const role = await db.prepare('SELECT can_use_ai_dashboard FROM roles WHERE id=?').get(u.role_id);
      if (role?.can_use_ai_dashboard == 1) return next();
    }
    // 若使用者或其角色有任何專案分享記錄，也允許通過
    const sharedCount = await db.prepare(
      `SELECT COUNT(*) CNT FROM ai_project_shares WHERE
        (grantee_type='user' AND grantee_id=?) OR
        (grantee_type='role' AND grantee_id=?)`
    ).get(String(u.id), String(u.role_id || ''));
    if (sharedCount?.CNT > 0) return next();
    return res.status(403).json({ error: '無 AI 戰情查詢權限' });
  } catch (e) { next(e); }
}

async function requireDesigner(req, res, next) {
  try {
    const u = req.user;
    if (u.role === 'admin' || u.can_design_ai_select == 1) return next();
    const db = require('../database-oracle').db;
    if (u.role_id) {
      const role = await db.prepare('SELECT can_design_ai_select FROM roles WHERE id=?').get(u.role_id);
      if (role?.can_design_ai_select == 1) return next();
    }
    // 若使用者或其角色有任何「開發」分享記錄，也允許通過
    const devSharedCount = await db.prepare(
      `SELECT COUNT(*) CNT FROM ai_project_shares WHERE share_type='develop' AND (
        (grantee_type='user' AND grantee_id=?) OR
        (grantee_type='role' AND grantee_id=?))`
    ).get(String(u.id), String(u.role_id || ''));
    if (devSharedCount?.CNT > 0) return next();
    return res.status(403).json({ error: '無 AI 戰情設計權限' });
  } catch (e) { next(e); }
}

// ─── Projects ────────────────────────────────────────────────────────────────

// GET /api/dashboard/projects
router.get('/projects', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const u = req.user;
    let projects;
    if (u.role === 'admin') {
      projects = await db.prepare(
        `SELECT p.*, u.name AS creator_name,
                (SELECT COUNT(*) FROM ai_select_topics t WHERE t.project_id=p.id AND t.is_active=1) AS topic_count
         FROM ai_select_projects p LEFT JOIN users u ON u.id=p.created_by
         ORDER BY p.id ASC`
      ).all();
    } else {
      projects = await db.prepare(
        `SELECT p.*, u.name AS creator_name,
                (SELECT COUNT(*) FROM ai_select_topics t WHERE t.project_id=p.id AND t.is_active=1) AS topic_count
         FROM ai_select_projects p LEFT JOIN users u ON u.id=p.created_by
         WHERE p.created_by=?
            OR (p.is_public=1 AND p.public_approved=1)
            OR EXISTS (
              SELECT 1 FROM ai_project_shares s WHERE s.project_id=p.id AND (
                (s.grantee_type='user' AND s.grantee_id=?) OR
                (s.grantee_type='role' AND s.grantee_id=?) OR
                (s.grantee_type='department' AND s.grantee_id=?) OR
                (s.grantee_type='cost_center' AND s.grantee_id=?) OR
                (s.grantee_type='division' AND s.grantee_id=?)
              )
            )
         ORDER BY p.id ASC`
      ).all(
        u.id, String(u.id), String(u.role_id || ''), String(u.dept_code || ''),
        String(u.profit_center || ''), String(u.org_section || '')
      );
    }
    res.json(projects);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dashboard/projects
router.post('/projects', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description, is_public } = req.body;
    if (!name) return res.status(400).json({ error: '專案名稱為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_select_projects (name, description, is_public, created_by) VALUES (?,?,?,?)`
    ).run(name, description || null, is_public ? 1 : 0, req.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/dashboard/projects/:id
router.put('/projects/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    if (!await canEditProject(db, req.params.id, req.user)) return res.status(403).json({ error: '無權限' });
    const { name, description, is_public } = req.body;
    const isPublicVal = is_public ? 1 : 0;
    // 改成公開申請時重置核准狀態，需重新由管理員核准
    await db.prepare(
      `UPDATE ai_select_projects SET name=?, description=?, is_public=?, public_approved=0, public_approved_by=NULL, public_approved_at=NULL WHERE id=?`
    ).run(name, description || null, isPublicVal, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/dashboard/projects/:id/approve-public  (管理員核准公開)
router.patch('/projects/:id/approve-public', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { approved } = req.body; // true=核准, false=拒絕(取消公開申請)
    if (approved) {
      await db.prepare(
        `UPDATE ai_select_projects SET public_approved=1, public_approved_by=?, public_approved_at=SYSTIMESTAMP WHERE id=?`
      ).run(req.user.id, req.params.id);
    } else {
      await db.prepare(
        `UPDATE ai_select_projects SET is_public=0, public_approved=0, public_approved_by=NULL, public_approved_at=NULL WHERE id=?`
      ).run(req.params.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/dashboard/projects/:id
router.delete('/projects/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    if (!await canEditProject(db, req.params.id, req.user)) return res.status(403).json({ error: '無權限' });
    await db.prepare(`DELETE FROM ai_select_projects WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dashboard/projects/:id/shares
router.get('/projects/:id/shares', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    if (!await canEditProject(db, req.params.id, req.user)) return res.status(403).json({ error: '無權限' });
    const shares = await db.prepare(`SELECT * FROM ai_project_shares WHERE project_id=? ORDER BY id ASC`).all(req.params.id);
    res.json(shares);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dashboard/projects/:id/shares
router.post('/projects/:id/shares', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    if (!await canEditProject(db, req.params.id, req.user)) return res.status(403).json({ error: '無權限' });
    const { share_type, grantee_type, grantee_id } = req.body;
    const r = await db.prepare(
      `INSERT INTO ai_project_shares (project_id, share_type, grantee_type, grantee_id, granted_by) VALUES (?,?,?,?,?)`
    ).run(req.params.id, share_type || 'use', grantee_type, grantee_id, req.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/dashboard/projects/:id/shares/:shareId
router.delete('/projects/:id/shares/:shareId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    if (!await canEditProject(db, req.params.id, req.user)) return res.status(403).json({ error: '無權限' });
    await db.prepare(`DELETE FROM ai_project_shares WHERE id=? AND project_id=?`).run(req.params.shareId, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/dashboard/projects/:id/suspend
router.patch('/projects/:id/suspend', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    if (!await canEditProject(db, req.params.id, req.user)) return res.status(403).json({ error: '無權限' });
    await db.prepare(`UPDATE ai_select_projects SET is_suspended=? WHERE id=?`).run(req.body.suspended ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Topics ──────────────────────────────────────────────────────────────────

// GET /api/dashboard/topics — 主題清單（含子任務），viewer 端
router.get('/topics', requireDashboard, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const u = req.user;
    const { project_id } = req.query;

    let projectFilter = '';
    let topicBinds = [];

    if (u.role === 'admin') {
      if (project_id) {
        projectFilter = 'AND t.project_id=?';
        topicBinds = [project_id];
      }
    } else {
      projectFilter = `AND (
        t.project_id IS NULL
        OR EXISTS (
          SELECT 1 FROM ai_select_projects p WHERE p.id=t.project_id AND (
            p.created_by=?
            OR (p.is_public=1 AND p.public_approved=1)
            OR EXISTS (
              SELECT 1 FROM ai_project_shares s WHERE s.project_id=p.id AND (
                (s.grantee_type='user' AND s.grantee_id=?) OR
                (s.grantee_type='role' AND s.grantee_id=?) OR
                (s.grantee_type='department' AND s.grantee_id=?) OR
                (s.grantee_type='cost_center' AND s.grantee_id=?) OR
                (s.grantee_type='division' AND s.grantee_id=?)
              )
            )
          )
        )
      )`;
      topicBinds = [u.id, String(u.id), String(u.role_id || ''), String(u.dept_code || ''), String(u.profit_center || ''), String(u.org_section || '')];
      if (project_id) {
        projectFilter += ' AND t.project_id=?';
        topicBinds.push(project_id);
      }
    }

    const topics = await db.prepare(
      `SELECT t.* FROM ai_select_topics t WHERE t.is_active=1 AND t.is_suspended=0 ${projectFilter} ORDER BY t.sort_order ASC, t.id ASC`
    ).all(...topicBinds);

    const designs = await db.prepare(
      `SELECT id, topic_id, name, description, vector_search_enabled, chart_config,
              is_public, created_by, is_suspended,
              vector_top_k, vector_similarity_threshold
       FROM ai_select_designs
       WHERE is_suspended=0
       ORDER BY id ASC`
    ).all();

    const designMap = {};
    for (const d of designs) {
      if (!designMap[d.topic_id]) designMap[d.topic_id] = [];
      designMap[d.topic_id].push(d);
    }

    res.json(topics.map(t => ({ ...t, designs: designMap[t.id] || [] })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dashboard/designer/topics — 設計者的主題清單
router.get('/designer/topics', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { project_id } = req.query;
    const u = req.user;
    // Designer sees: own topics, OR topics from projects where user is creator or has any share (use/develop)
    let filter = u.role === 'admin' ? '' : `AND (t.created_by=? OR t.project_id IS NULL OR EXISTS (
      SELECT 1 FROM ai_select_projects p WHERE p.id=t.project_id AND (
        p.created_by=? OR (p.is_public=1 AND p.public_approved=1) OR EXISTS (
          SELECT 1 FROM ai_project_shares sh WHERE sh.project_id=p.id AND (
            (sh.grantee_type='user' AND sh.grantee_id=?) OR
            (sh.grantee_type='role' AND sh.grantee_id=?) OR
            (sh.grantee_type='department' AND sh.grantee_id=?) OR
            (sh.grantee_type='cost_center' AND sh.grantee_id=?) OR
            (sh.grantee_type='division' AND sh.grantee_id=?)
          )
        )
      )
    ))`;
    let binds = u.role === 'admin' ? [] : [u.id, u.id, String(u.id), String(u.role_id || ''), String(u.dept_code || ''), String(u.profit_center || ''), String(u.org_section || '')];
    if (project_id) {
      filter += ' AND t.project_id=?';
      binds.push(project_id);
    }
    const topics = await db.prepare(`SELECT t.* FROM ai_select_topics t WHERE t.is_active=1 ${filter} ORDER BY t.sort_order ASC, t.id ASC`).all(...binds);
    const designs = await db.prepare(`SELECT * FROM ai_select_designs ORDER BY id ASC`).all();
    const designMap = {};
    for (const d of designs) {
      if (!designMap[d.topic_id]) designMap[d.topic_id] = [];
      designMap[d.topic_id].push(d);
    }
    res.json(topics.map(t => ({ ...t, designs: designMap[t.id] || [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dashboard/designer/topics
router.post('/designer/topics', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description, icon, sort_order, project_id } = req.body;
    if (!name) return res.status(400).json({ error: '主題名稱為必填' });
    if (project_id && !await canEditProject(db, project_id, req.user)) return res.status(403).json({ error: '無此專案權限' });
    const r = await db.prepare(
      `INSERT INTO ai_select_topics (name, description, icon, sort_order, created_by, project_id) VALUES (?,?,?,?,?,?)`
    ).run(name, description || null, icon || null, sort_order || 0, req.user.id, project_id || null);
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/topics/:id
router.put('/designer/topics/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const topic = await db.prepare(`SELECT created_by, project_id FROM ai_select_topics WHERE id=?`).get(req.params.id);
    if (!topic) return res.status(404).json({ error: '不存在' });
    if (req.user.role !== 'admin' && topic.created_by !== req.user.id) {
      if (topic.project_id && !await canAccessProject(db, topic.project_id, req.user, 'develop')) return res.status(403).json({ error: '無權限' });
    }
    const { name, description, icon, sort_order, is_active, project_id } = req.body;
    await db.prepare(
      `UPDATE ai_select_topics SET name=?, description=?, icon=?, sort_order=?, is_active=?, project_id=? WHERE id=?`
    ).run(name, description || null, icon || null, sort_order ?? 0, is_active ?? 1, project_id || null, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/designer/topics/:id
router.delete('/designer/topics/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const topic = await db.prepare(`SELECT created_by, project_id FROM ai_select_topics WHERE id=?`).get(req.params.id);
    if (!topic) return res.status(404).json({ error: '不存在' });
    if (req.user.role !== 'admin' && topic.created_by !== req.user.id) {
      if (!topic.project_id || !await canAccessProject(db, topic.project_id, req.user, 'develop')) return res.status(403).json({ error: '無權限' });
    }
    await db.prepare(`DELETE FROM ai_select_topics WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Designs ─────────────────────────────────────────────────────────────────

// GET /api/dashboard/designer/designs/:id
router.get('/designer/designs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const d = await db.prepare(`SELECT * FROM ai_select_designs WHERE id=?`).get(req.params.id);
    if (!d) return res.status(404).json({ error: '不存在' });
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/designs
router.post('/designer/designs', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const {
      topic_id, name, description, target_schema_ids, target_join_ids, vector_search_enabled,
      system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public,
      vector_top_k, vector_similarity_threshold, vector_skip_fields
    } = req.body;
    if (!topic_id || !name) return res.status(400).json({ error: '主題與名稱為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_select_designs
         (topic_id, name, description, target_schema_ids, target_join_ids, vector_search_enabled,
          system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public,
          vector_top_k, vector_similarity_threshold, vector_skip_fields, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      topic_id, name, description || null,
      target_schema_ids ? JSON.stringify(target_schema_ids) : null,
      target_join_ids ? JSON.stringify(target_join_ids) : null,
      vector_search_enabled ? 1 : 0,
      system_prompt || null,
      few_shot_examples || null,
      chart_config || null,
      cache_ttl_minutes || 30,
      is_public ? 1 : 0,
      vector_top_k || 10,
      vector_similarity_threshold || '0.50',
      vector_skip_fields || null,
      req.user.id
    );
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/designs/:id
router.put('/designer/designs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const design = await db.prepare(`SELECT d.created_by, t.project_id FROM ai_select_designs d JOIN ai_select_topics t ON t.id=d.topic_id WHERE d.id=?`).get(req.params.id);
    if (!design) return res.status(404).json({ error: '不存在' });
    if (req.user.role !== 'admin' && design.created_by !== req.user.id) {
      if (!design.project_id || !await canAccessProject(db, design.project_id, req.user, 'develop')) return res.status(403).json({ error: '無權限' });
    }
    const {
      topic_id, name, description, target_schema_ids, target_join_ids, vector_search_enabled,
      system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public,
      vector_top_k, vector_similarity_threshold, vector_skip_fields
    } = req.body;
    await db.prepare(
      `UPDATE ai_select_designs SET
         topic_id=?, name=?, description=?, target_schema_ids=?, target_join_ids=?, vector_search_enabled=?,
         system_prompt=?, few_shot_examples=?, chart_config=?, cache_ttl_minutes=?, is_public=?,
         vector_top_k=?, vector_similarity_threshold=?, vector_skip_fields=?,
         updated_at=SYSTIMESTAMP
       WHERE id=?`
    ).run(
      topic_id, name, description || null,
      target_schema_ids ? JSON.stringify(target_schema_ids) : null,
      target_join_ids ? JSON.stringify(target_join_ids) : null,
      vector_search_enabled ? 1 : 0,
      system_prompt || null,
      few_shot_examples || null,
      chart_config || null,
      cache_ttl_minutes || 30,
      is_public ? 1 : 0,
      vector_top_k || 10,
      vector_similarity_threshold || '0.50',
      vector_skip_fields || null,
      req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/designer/designs/:id
router.delete('/designer/designs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const design = await db.prepare(`SELECT d.created_by, t.project_id FROM ai_select_designs d JOIN ai_select_topics t ON t.id=d.topic_id WHERE d.id=?`).get(req.params.id);
    if (!design) return res.status(404).json({ error: '不存在' });
    if (req.user.role !== 'admin' && design.created_by !== req.user.id) {
      if (!design.project_id || !await canAccessProject(db, design.project_id, req.user, 'develop')) return res.status(403).json({ error: '無權限' });
    }
    await db.prepare(`DELETE FROM ai_select_designs WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Schema 知識庫 ────────────────────────────────────────────────────────────

// GET /api/dashboard/designer/schemas
router.get('/designer/schemas', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { project_id } = req.query;
    const u = req.user;
    let filter = '';
    let binds = [];
    if (project_id) {
      filter = 'WHERE s.project_id=?';
      binds = [project_id];
    } else if (u.role !== 'admin') {
      filter = `WHERE (s.project_id IS NULL AND s.created_by=?) OR EXISTS (
        SELECT 1 FROM ai_select_projects p WHERE p.id=s.project_id AND (
          p.created_by=? OR EXISTS (
            SELECT 1 FROM ai_project_shares sh WHERE sh.project_id=p.id AND sh.share_type='develop' AND (
              (sh.grantee_type='user' AND sh.grantee_id=?) OR
              (sh.grantee_type='role' AND sh.grantee_id=?)
            )
          )
        )
      )`;
      binds = [u.id, u.id, String(u.id), String(u.role_id || '')];
    }
    const schemas = await db.prepare(`SELECT s.* FROM ai_schema_definitions s ${filter} ORDER BY s.id ASC`).all(...binds);
    const columns = await db.prepare(`SELECT * FROM ai_schema_columns ORDER BY schema_id ASC, id ASC`).all();
    const colMap = {};
    for (const c of columns) {
      if (!colMap[c.schema_id]) colMap[c.schema_id] = [];
      colMap[c.schema_id].push(c);
    }
    res.json(schemas.map(s => ({ ...s, columns: colMap[s.id] || [] })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/schemas
router.post('/designer/schemas', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { table_name, display_name, alias, source_type, source_sql, db_connection, business_notes, join_hints, base_conditions, vector_etl_job_id, columns, project_id } = req.body;
    if (!table_name) return res.status(400).json({ error: 'table_name 為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_schema_definitions (table_name, display_name, alias, source_type, source_sql, db_connection, business_notes, join_hints, base_conditions, vector_etl_job_id, created_by, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      table_name, display_name || null, alias || null, source_type || 'table', source_sql || null,
      db_connection || 'erp',
      business_notes || null,
      join_hints ? JSON.stringify(join_hints) : null,
      Array.isArray(base_conditions) ? JSON.stringify(base_conditions) : (base_conditions || null),
      vector_etl_job_id || null,
      req.user.id,
      project_id || null
    );
    const schemaId = r.lastInsertRowid;

    if (columns && Array.isArray(columns)) {
      for (const col of columns) {
        await db.prepare(
          `INSERT INTO ai_schema_columns
             (schema_id, column_name, data_type, description, is_vectorized, value_mapping, sample_values)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          schemaId, col.column_name, col.data_type || null, col.description || null,
          col.is_vectorized ? 1 : 0,
          col.value_mapping ? JSON.stringify(col.value_mapping) : null,
          col.sample_values ? JSON.stringify(col.sample_values) : null
        );
      }
    }
    res.json({ id: schemaId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/schemas/:id
router.put('/designer/schemas/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { table_name, display_name, alias, source_type, source_sql, db_connection, business_notes, join_hints, base_conditions, vector_etl_job_id, is_active, project_id } = req.body;
    await db.prepare(
      `UPDATE ai_schema_definitions SET
         table_name=?, display_name=?, alias=?, source_type=?, source_sql=?,
         db_connection=?, business_notes=?, join_hints=?, base_conditions=?, vector_etl_job_id=?, is_active=?,
         project_id=?, updated_at=SYSTIMESTAMP
       WHERE id=?`
    ).run(
      table_name, display_name || null, alias || null, source_type || 'table', source_sql || null,
      db_connection || 'erp',
      business_notes || null,
      join_hints ? JSON.stringify(join_hints) : null,
      Array.isArray(base_conditions) ? JSON.stringify(base_conditions) : (base_conditions || null),
      vector_etl_job_id || null,
      is_active ?? 1,
      project_id || null,
      req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/schemas/:id/columns — 整批更新欄位 metadata
router.put('/designer/schemas/:id/columns', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { columns } = req.body;
    await db.prepare(`DELETE FROM ai_schema_columns WHERE schema_id=?`).run(req.params.id);
    if (columns && Array.isArray(columns)) {
      for (const col of columns) {
        await db.prepare(
          `INSERT INTO ai_schema_columns
             (schema_id, column_name, data_type, description, is_vectorized, value_mapping, sample_values, is_virtual, expression,
              is_filter_key, filter_layer, filter_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          req.params.id, col.column_name, col.data_type || null, col.description || null,
          col.is_vectorized ? 1 : 0,
          col.value_mapping ? JSON.stringify(col.value_mapping) : null,
          col.sample_values ? JSON.stringify(col.sample_values) : null,
          col.is_virtual ? 1 : 0,
          col.expression || null,
          col.is_filter_key ? 1 : 0,
          col.filter_layer || null,
          col.filter_source || null
        );
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dashboard/designer/schemas/:id/columns/export-csv
router.get('/designer/schemas/:id/columns/export-csv', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const cols = await db.prepare(
      `SELECT column_name, data_type, description, is_virtual, expression FROM ai_schema_columns WHERE schema_id=? ORDER BY id ASC`
    ).all(req.params.id);
    const schema = await db.prepare(`SELECT table_name FROM ai_schema_definitions WHERE id=?`).get(req.params.id);
    const lines = ['column_name,data_type,description,is_virtual,expression'];
    for (const c of cols) {
      const escape = v => `"${(v || '').replace(/"/g, '""')}"`;
      lines.push([escape(c.column_name), escape(c.data_type || ''), escape(c.description || ''), c.is_virtual ? '1' : '0', escape(c.expression || '')].join(','));
    }
    const filename = `schema_${schema?.table_name || req.params.id}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + lines.join('\r\n')); // BOM for Excel UTF-8
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/schemas/:id/columns/import-csv — 只更新 description（依 column_name 對應）
router.post('/designer/schemas/:id/columns/import-csv', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { rows } = req.body; // [{ column_name, description }]
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows 為必填陣列' });
    let updated = 0;
    for (const row of rows) {
      if (!row.column_name) continue;
      const r = await db.prepare(
        `UPDATE ai_schema_columns SET description=? WHERE schema_id=? AND column_name=?`
      ).run(row.description || null, req.params.id, row.column_name);
      if (r.changes) updated++;
    }
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/designer/schemas/:id
router.delete('/designer/schemas/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_schema_definitions WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/schemas/import-oracle
router.post('/designer/schemas/import-oracle', requireDesigner, async (req, res) => {
  const { table_names, owner: defaultOwner = 'APPS', db_connection = 'erp' } = req.body;
  if (!Array.isArray(table_names) || table_names.length === 0)
    return res.status(400).json({ error: 'table_names 為必填陣列' });
  if (table_names.length > 50)
    return res.status(400).json({ error: '單次最多匯入 50 個 table' });

  const NAME_RE = /^[A-Z0-9_$]+$/i;
  const parsed = table_names
    .map(t => {
      const s = t.trim().toUpperCase();
      const dot = s.indexOf('.');
      if (dot > 0) {
        return { owner: s.slice(0, dot), table: s.slice(dot + 1) };
      }
      return { owner: (defaultOwner || 'APPS').toUpperCase(), table: s };
    })
    .filter(({ owner, table }) =>
      NAME_RE.test(owner) && owner.length <= 128 &&
      NAME_RE.test(table) && table.length <= 128
    );

  if (parsed.length === 0)
    return res.status(400).json({ error: 'table_names 格式不合法' });

  try {
    const { db } = require('../database-oracle');
    const erpPool = await require('../services/dashboardService').getErpPool();
    const oracledb = require('oracledb');

    const byOwner = {};
    for (const { owner, table } of parsed) {
      if (!byOwner[owner]) byOwner[owner] = [];
      byOwner[owner].push(table);
    }

    const byTable = {};
    const conn = await erpPool.getConnection();
    try {
      for (const [ownerKey, tables] of Object.entries(byOwner)) {
        const inList = tables.map(t => `'${t}'`).join(',');
        const sql = `
          SELECT c.OWNER, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE,
                 c.DATA_LENGTH, c.DATA_PRECISION, c.DATA_SCALE, cc.COMMENTS
          FROM   ALL_TAB_COLUMNS c
          LEFT JOIN ALL_COL_COMMENTS cc
                 ON cc.OWNER = c.OWNER AND cc.TABLE_NAME = c.TABLE_NAME AND cc.COLUMN_NAME = c.COLUMN_NAME
          WHERE  c.OWNER = :owner
            AND  c.TABLE_NAME IN (${inList})
          ORDER BY c.TABLE_NAME, c.COLUMN_ID
        `;
        const result = await conn.execute(sql, { owner: ownerKey },
          { outFormat: oracledb.OUT_FORMAT_OBJECT });
        for (const r of (result.rows || [])) {
          const key = `${r.OWNER}.${r.TABLE_NAME}`;
          if (!byTable[key]) byTable[key] = [];
          let typeStr = r.DATA_TYPE;
          if (r.DATA_TYPE === 'NUMBER' && r.DATA_PRECISION != null)
            typeStr = `NUMBER(${r.DATA_PRECISION}${r.DATA_SCALE ? ',' + r.DATA_SCALE : ''})`;
          else if (r.DATA_TYPE === 'VARCHAR2' || r.DATA_TYPE === 'CHAR')
            typeStr = `${r.DATA_TYPE}(${r.DATA_LENGTH})`;
          byTable[key].push({ column_name: r.COLUMN_NAME, data_type: typeStr, description: r.COMMENTS || null });
        }
      }
    } finally {
      await conn.close();
    }

    const imported = [];
    const skipped = [];

    for (const { owner: ownerKey, table: tname } of parsed) {
      const key = `${ownerKey}.${tname}`;
      if (!byTable[key]) { skipped.push(key); continue; }

      const fullName = key;

      let existing = await db.prepare(
        `SELECT id FROM ai_schema_definitions WHERE table_name=? AND db_connection=?`
      ).get(fullName, db_connection);

      let schemaId;
      if (existing) {
        schemaId = existing.id;
        await db.prepare(`UPDATE ai_schema_definitions SET updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(schemaId);
      } else {
        const r = await db.prepare(
          `INSERT INTO ai_schema_definitions (table_name, display_name, db_connection, created_by)
           VALUES (?, ?, ?, ?)`
        ).run(fullName, tname, db_connection, req.user.id);
        schemaId = r.lastInsertRowid;
      }

      await db.prepare(`DELETE FROM ai_schema_columns WHERE schema_id=?`).run(schemaId);
      for (const col of byTable[key]) {
        await db.prepare(
          `INSERT INTO ai_schema_columns (schema_id, column_name, data_type, description) VALUES (?, ?, ?, ?)`
        ).run(schemaId, col.column_name, col.data_type, col.description);
      }

      imported.push({ table: fullName, columns: byTable[key].length, schema_id: schemaId });
    }

    res.json({ imported, skipped, total_tables: parsed.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Schema Joins ─────────────────────────────────────────────────────────────

// GET /api/dashboard/designer/joins
router.get('/designer/joins', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { project_id } = req.query;
    const u = req.user;
    let filter = '';
    let binds = [];
    if (project_id) {
      filter = 'WHERE j.project_id=?';
      binds = [project_id];
    } else if (u.role !== 'admin') {
      filter = `WHERE j.project_id IS NULL OR EXISTS (
        SELECT 1 FROM ai_select_projects p WHERE p.id=j.project_id AND (
          p.created_by=? OR EXISTS (
            SELECT 1 FROM ai_project_shares sh WHERE sh.project_id=p.id AND sh.share_type='develop' AND (
              (sh.grantee_type='user' AND sh.grantee_id=?) OR
              (sh.grantee_type='role' AND sh.grantee_id=?)
            )
          )
        )
      )`;
      binds = [u.id, String(u.id), String(u.role_id || '')];
    }
    const joins = await db.prepare(
      `SELECT j.*,
              sl.table_name AS left_table, sl.display_name AS left_display, sl.alias AS left_alias,
              sr.table_name AS right_table, sr.display_name AS right_display, sr.alias AS right_alias
       FROM ai_schema_joins j
       LEFT JOIN ai_schema_definitions sl ON sl.id = j.left_schema_id
       LEFT JOIN ai_schema_definitions sr ON sr.id = j.right_schema_id
       ${filter} ORDER BY j.id ASC`
    ).all(...binds);
    res.json(joins);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/joins
router.post('/designer/joins', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, left_schema_id, right_schema_id, join_type, conditions_json, project_id } = req.body;
    if (!name || !left_schema_id || !right_schema_id)
      return res.status(400).json({ error: 'name, left_schema_id, right_schema_id 為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_schema_joins (name, left_schema_id, right_schema_id, join_type, conditions_json, created_by, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name, left_schema_id, right_schema_id, join_type || 'LEFT',
      Array.isArray(conditions_json) ? JSON.stringify(conditions_json) : (conditions_json || '[]'),
      req.user.id,
      project_id || null
    );
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/joins/:id
router.put('/designer/joins/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, left_schema_id, right_schema_id, join_type, conditions_json, project_id } = req.body;
    await db.prepare(
      `UPDATE ai_schema_joins SET name=?, left_schema_id=?, right_schema_id=?, join_type=?, conditions_json=?, project_id=? WHERE id=?`
    ).run(
      name, left_schema_id, right_schema_id, join_type || 'LEFT',
      Array.isArray(conditions_json) ? JSON.stringify(conditions_json) : (conditions_json || '[]'),
      project_id || null,
      req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/designer/joins/:id
router.delete('/designer/joins/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_schema_joins WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ETL Jobs ─────────────────────────────────────────────────────────────────

// GET /api/dashboard/etl/jobs
router.get('/etl/jobs', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { project_id } = req.query;
    const u = req.user;
    let filter = '';
    let binds = [];
    if (project_id) {
      filter = 'WHERE j.project_id=?';
      binds = [project_id];
    } else if (u.role !== 'admin') {
      filter = `WHERE j.project_id IS NULL OR EXISTS (
        SELECT 1 FROM ai_select_projects p WHERE p.id=j.project_id AND (
          p.created_by=? OR EXISTS (
            SELECT 1 FROM ai_project_shares sh WHERE sh.project_id=p.id AND sh.share_type='develop' AND (
              (sh.grantee_type='user' AND sh.grantee_id=?) OR
              (sh.grantee_type='role' AND sh.grantee_id=?)
            )
          )
        )
      )`;
      binds = [u.id, String(u.id), String(u.role_id || '')];
    }
    const jobs = await db.prepare(
      `SELECT j.*,
              (SELECT COUNT(*) FROM ai_etl_run_logs l WHERE l.job_id=j.id) AS run_count
       FROM ai_etl_jobs j ${filter} ORDER BY j.id ASC`
    ).all(...binds);
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/etl/jobs
router.post('/etl/jobs', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { scheduleToCron } = require('../services/dashboardService');
    const {
      name, source_sql, source_connection, vectorize_fields, metadata_fields,
      embedding_dimension, is_incremental,
      job_type, target_table, target_mode, upsert_key, delete_sql,
      schedule_type, schedule_config, project_id
    } = req.body;
    if (!name || !source_sql) return res.status(400).json({ error: '名稱與 source_sql 為必填' });
    const cronExpr = scheduleToCron(schedule_type || 'cron', schedule_config);
    const r = await db.prepare(
      `INSERT INTO ai_etl_jobs
         (name, source_sql, source_connection, vectorize_fields, metadata_fields,
          embedding_dimension, cron_expression, is_incremental, created_by,
          job_type, target_table, target_mode, upsert_key, delete_sql, schedule_type, schedule_config, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name, source_sql, source_connection || 'erp',
      vectorize_fields ? JSON.stringify(vectorize_fields) : null,
      metadata_fields ? JSON.stringify(metadata_fields) : null,
      embedding_dimension || 768,
      cronExpr || null,
      is_incremental ? 1 : 0,
      req.user.id,
      job_type || 'vector',
      target_table || null,
      target_mode || 'truncate_insert',
      upsert_key || null,
      delete_sql || null,
      schedule_type || 'cron',
      schedule_config ? JSON.stringify(schedule_config) : null,
      project_id || null
    );
    const newId = r.lastInsertRowid;
    // 為新 ETL job 加 AI_VECTOR_STORE partition（vector job 才需要）
    if ((job_type || 'vector') === 'vector') {
      const { addVectorStorePartition } = require('../database-oracle');
      addVectorStorePartition(newId).catch(e => console.warn('[Partition] ETL create:', e.message));
    }
    if (cronExpr) {
      const { scheduleEtlJob } = require('../services/dashboardService');
      scheduleEtlJob(newId, cronExpr);
    }
    res.json({ id: newId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/etl/jobs/:id
router.put('/etl/jobs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { scheduleToCron, scheduleEtlJob } = require('../services/dashboardService');
    const {
      name, source_sql, source_connection, vectorize_fields, metadata_fields,
      embedding_dimension, is_incremental, status,
      job_type, target_table, target_mode, upsert_key, delete_sql,
      schedule_type, schedule_config, project_id
    } = req.body;
    const cronExpr = scheduleToCron(schedule_type || 'cron', schedule_config);
    await db.prepare(
      `UPDATE ai_etl_jobs SET
         name=?, source_sql=?, source_connection=?, vectorize_fields=?, metadata_fields=?,
         embedding_dimension=?, cron_expression=?, is_incremental=?, status=?,
         job_type=?, target_table=?, target_mode=?, upsert_key=?, delete_sql=?,
         schedule_type=?, schedule_config=?, project_id=?
       WHERE id=?`
    ).run(
      name, source_sql, source_connection || 'erp',
      vectorize_fields ? JSON.stringify(vectorize_fields) : null,
      metadata_fields ? JSON.stringify(metadata_fields) : null,
      embedding_dimension || 768,
      cronExpr || null,
      is_incremental ? 1 : 0,
      status || 'active',
      job_type || 'vector',
      target_table || null,
      target_mode || 'truncate_insert',
      upsert_key || null,
      delete_sql || null,
      schedule_type || 'cron',
      schedule_config ? JSON.stringify(schedule_config) : null,
      project_id || null,
      req.params.id
    );
    if (cronExpr && status !== 'inactive') {
      scheduleEtlJob(Number(req.params.id), cronExpr);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dashboard/etl/jobs/:id
router.delete('/etl/jobs/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { dropVectorStorePartition } = require('../database-oracle');
    // 先 DROP PARTITION（比等 cascade delete 快）
    await dropVectorStorePartition(Number(req.params.id));
    await db.prepare(`DELETE FROM ai_etl_jobs WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/etl/jobs/:id/run — 立即執行
router.post('/etl/jobs/:id/run', requireDesigner, async (req, res) => {
  try {
    const { runEtlJob } = require('../services/dashboardService');
    runEtlJob(Number(req.params.id)).catch(e => console.error('[ETL] manual run error:', e.message));
    res.json({ ok: true, message: 'ETL job 已排入執行佇列' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/etl/jobs/:id/cancel — 取消執行中的 ETL job
router.post('/etl/jobs/:id/cancel', requireDesigner, async (req, res) => {
  try {
    const { cancelEtlJob } = require('../services/dashboardService');
    cancelEtlJob(Number(req.params.id));
    res.json({ ok: true, message: 'ETL job 取消請求已送出' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dashboard/etl/jobs/:id/logs
router.get('/etl/jobs/:id/logs', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const logs = await db.prepare(
      `SELECT * FROM ai_etl_run_logs WHERE job_id=? ORDER BY id DESC FETCH FIRST 50 ROWS ONLY`
    ).all(req.params.id);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI 查詢 (SSE Streaming) ──────────────────────────────────────────────────

// POST /api/dashboard/query
router.post('/query', requireDashboard, async (req, res) => {
  const { design_id, question, vector_top_k, vector_similarity_threshold, model_key } = req.body;
  if (!design_id || !question?.trim()) {
    return res.status(400).json({ error: 'design_id 與 question 為必填' });
  }

  const isDesigner = req.user.role === 'admin' || req.user.can_design_ai_select == 1;

  try {
    const db = require('../database-oracle').db;
    const design = await db.prepare(`SELECT id, is_public, is_suspended, created_by FROM ai_select_designs WHERE id=?`).get(design_id);
    if (!design) return res.status(404).json({ error: '設計不存在' });
    if (design.is_suspended == 1) return res.status(403).json({ error: '此查詢設計已暫停使用' });
    const ok = await canAccessDesign(db, design, req.user);
    if (!ok) return res.status(403).json({ error: '無此查詢設計的存取權限' });

    // ── 資料權限前置檢查（非 admin）────────────────────────────────────────
    if (req.user.role !== 'admin') {
      const { getEffectivePolicy } = require('./dataPermissions');
      const policy = await getEffectivePolicy(db, req.user.id);
      if (policy?.rules?.length > 0) {
        const forbidden = checkForbiddenInQuestion(question.trim(), policy.rules);
        if (forbidden.length > 0) {
          return res.status(403).json({
            error: `⛔ 資料權限不足，無法執行此查詢。\n\n問題中包含未授權的條件：\n${forbidden.map(f => `• ${f}`).join('\n')}\n\n請確認您有權限查詢這些資料後再試。`,
            forbidden,
          });
        }
      }
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let lastSql = '';
  let lastRowCount = 0;
  const sendWrapped = (event, data) => {
    if (event === 'sql_preview' && data?.sql) lastSql = data.sql;
    if (event === 'result' && data?.row_count != null) lastRowCount = data.row_count;
    send(event, data);
  };

  try {
    // 取得有效政策（用於 SQL 層級過濾）
    let effectivePolicy = null;
    if (req.user.role !== 'admin') {
      try {
        const { getEffectivePolicy } = require('./dataPermissions');
        const db = require('../database-oracle').db;
        effectivePolicy = await getEffectivePolicy(db, req.user.id);
      } catch (_) {}
    }

    const { runDashboardQuery } = require('../services/dashboardService');
    await runDashboardQuery({
      designId: Number(design_id),
      question: question.trim(),
      userId: req.user.id,
      user: req.user,
      isDesigner,
      send: sendWrapped,
      vectorTopK: vector_top_k ? Number(vector_top_k) : undefined,
      vectorSimilarityThreshold: vector_similarity_threshold ?? undefined,
      modelKey: model_key || null,
      effectivePolicy,
    });
    const db = require('../database-oracle').db;
    await logDashboardAudit(db, req.user.id, design_id, question.trim(), lastSql);
    // 儲存查詢歷史
    if (lastSql) {
      try {
        const design = await db.prepare(
          `SELECT d.name AS design_name, t.name AS topic_name
           FROM ai_select_designs d LEFT JOIN ai_select_topics t ON t.id=d.topic_id
           WHERE d.id=?`
        ).get(design_id);
        await db.prepare(
          `INSERT INTO ai_dashboard_history (user_id, design_id, design_name, topic_name, question, generated_sql, row_count)
           VALUES (?,?,?,?,?,?,?)`
        ).run(
          req.user.id, Number(design_id),
          design?.design_name || null, design?.topic_name || null,
          question.trim(), lastSql, lastRowCount ?? 0
        );
      } catch (_) {}
    }
  } catch (e) {
    send('error', { message: e.message });
  } finally {
    send('done', {});
    res.end();
  }
});

// POST /api/dashboard/query/invalidate-cache — 清除指定 design 的快取
router.post('/query/invalidate-cache', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { design_id } = req.body;
    if (design_id) {
      await db.prepare(`DELETE FROM ai_query_cache WHERE design_id=?`).run(design_id);
    } else {
      await db.prepare(`DELETE FROM ai_query_cache WHERE expires_at < SYSTIMESTAMP`).run();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢歷史 ─────────────────────────────────────────────────────────────────

// GET /api/dashboard/history
router.get('/history', requireDashboard, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { design_id, limit: lim = 50 } = req.query;
    let sql = `SELECT * FROM (
      SELECT h.id, h.design_id, h.design_name, h.topic_name, h.question,
             h.generated_sql, h.row_count,
             TO_CHAR(h.created_at,'YYYY/MM/DD HH24:MI') AS created_at
      FROM ai_dashboard_history h
      WHERE h.user_id=?
      ${design_id ? 'AND h.design_id=?' : ''}
      ORDER BY h.created_at DESC
    ) WHERE ROWNUM<=?`;
    const binds = design_id
      ? [req.user.id, Number(design_id), Number(lim)]
      : [req.user.id, Number(lim)];
    const rows = await db.prepare(sql).all(...binds);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/dashboard/history/:id
router.delete('/history/:id', requireDashboard, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_dashboard_history WHERE id=? AND user_id=?`)
      .run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/dashboard/history  (清除全部)
router.delete('/history', requireDashboard, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { design_id } = req.query;
    if (design_id) {
      await db.prepare(`DELETE FROM ai_dashboard_history WHERE user_id=? AND design_id=?`)
        .run(req.user.id, Number(design_id));
    } else {
      await db.prepare(`DELETE FROM ai_dashboard_history WHERE user_id=?`).run(req.user.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dashboard/orgs — 組織選項 (供分享設定的 LOV 使用)
router.get('/orgs', async (req, res) => {
  const db = require('../database-oracle').db;
  try {
    const [depts, pcs, sections, groups] = await Promise.all([
      db.prepare(`SELECT DISTINCT dept_code AS code, dept_name AS name FROM users WHERE dept_code IS NOT NULL ORDER BY dept_code`).all(),
      db.prepare(`SELECT DISTINCT profit_center AS code, profit_center_name AS name FROM users WHERE profit_center IS NOT NULL ORDER BY profit_center`).all(),
      db.prepare(`SELECT DISTINCT org_section AS code, org_section_name AS name FROM users WHERE org_section IS NOT NULL ORDER BY org_section`).all(),
      db.prepare(`SELECT DISTINCT org_group_name AS name FROM users WHERE org_group_name IS NOT NULL ORDER BY org_group_name`).all(),
    ]);
    res.json({ depts, profit_centers: pcs, org_sections: sections, org_groups: groups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI Dashboard Shares (design-level, backward compat) ───────────────────────

// GET /api/dashboard/designs/:id/shares
router.get('/designs/:id/shares', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const design = await db.prepare(`SELECT created_by FROM ai_select_designs WHERE id=?`).get(req.params.id);
    if (!design) return res.status(404).json({ error: '設計不存在' });
    if (req.user.role !== 'admin' && design.created_by !== req.user.id) {
      return res.status(403).json({ error: '無權限' });
    }
    const shares = await db.prepare(`SELECT * FROM ai_dashboard_shares WHERE design_id=? ORDER BY id ASC`).all(req.params.id);
    res.json(shares);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dashboard/designs/:id/shares
router.post('/designs/:id/shares', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const design = await db.prepare(`SELECT created_by FROM ai_select_designs WHERE id=?`).get(req.params.id);
    if (!design) return res.status(404).json({ error: '設計不存在' });
    if (req.user.role !== 'admin' && design.created_by !== req.user.id) {
      return res.status(403).json({ error: '只有設計者或管理員可以設定分享' });
    }
    const { share_type, grantee_type, grantee_id } = req.body;
    if (!grantee_type || !grantee_id) return res.status(400).json({ error: '缺少 grantee_type/grantee_id' });
    if (!['use', 'develop'].includes(share_type)) return res.status(400).json({ error: 'share_type 必須為 use 或 develop' });
    const r = await db.prepare(
      `INSERT INTO ai_dashboard_shares (design_id, share_type, grantee_type, grantee_id, granted_by) VALUES (?,?,?,?,?)`
    ).run(req.params.id, share_type, grantee_type, String(grantee_id), req.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/dashboard/designs/:id/shares/:shareId
router.delete('/designs/:id/shares/:shareId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const design = await db.prepare(`SELECT created_by FROM ai_select_designs WHERE id=?`).get(req.params.id);
    if (!design) return res.status(404).json({ error: '設計不存在' });
    if (req.user.role !== 'admin' && design.created_by !== req.user.id) {
      return res.status(403).json({ error: '無權限' });
    }
    await db.prepare(`DELETE FROM ai_dashboard_shares WHERE id=? AND design_id=?`).run(req.params.shareId, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/dashboard/topics/:id/suspend
router.patch('/topics/:id/suspend', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { suspended } = req.body;
    await db.prepare(`UPDATE ai_select_topics SET is_suspended=? WHERE id=?`).run(suspended ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/dashboard/designs/:id/suspend
router.patch('/designs/:id/suspend', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { suspended } = req.body;
    await db.prepare(`UPDATE ai_select_designs SET is_suspended=? WHERE id=?`).run(suspended ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dashboard/topics/:id/copy
router.post('/topics/:id/copy', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, design_ids, project_id } = req.body;
    const srcTopic = await db.prepare(`SELECT * FROM ai_select_topics WHERE id=?`).get(req.params.id);
    if (!srcTopic) return res.status(404).json({ error: '來源主題不存在' });
    const newProjectId = project_id || srcTopic.project_id || null;
    const tr = await db.prepare(
      `INSERT INTO ai_select_topics (name, description, icon, sort_order, created_by, project_id) VALUES (?,?,?,?,?,?)`
    ).run(name || srcTopic.name + ' (複本)', srcTopic.description, srcTopic.icon, srcTopic.sort_order, req.user.id, newProjectId);
    const newTopicId = tr.lastInsertRowid;
    let designs = await db.prepare(`SELECT * FROM ai_select_designs WHERE topic_id=?`).all(req.params.id);
    if (design_ids && design_ids.length > 0) {
      designs = designs.filter(d => design_ids.includes(d.id));
    }
    for (const d of designs) {
      await db.prepare(
        `INSERT INTO ai_select_designs (topic_id, name, description, target_schema_ids, target_join_ids,
           system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public,
           vector_search_enabled, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(newTopicId, d.name + ' (複本)', d.description, d.target_schema_ids, d.target_join_ids,
        d.system_prompt, d.few_shot_examples, d.chart_config, d.cache_ttl_minutes, 0,
        d.vector_search_enabled, req.user.id);
    }
    res.json({ id: newTopicId, designs_copied: designs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dashboard/topics/:id/icon — upload topic icon
router.post('/topics/:id/icon', requireDesigner, async (req, res) => {
  try {
    const multer = require('multer');
    const path = require('path');
    const uploadDir = path.join(__dirname, '../uploads/dashboard_icons');
    require('fs').mkdirSync(uploadDir, { recursive: true });
    const storage = multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, `topic_${req.params.id}_${Date.now()}${path.extname(file.originalname)}`)
    });
    const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('只允許圖片檔案'));
    }}).single('icon');
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '未收到檔案' });
      const iconUrl = `/uploads/dashboard_icons/${req.file.filename}`;
      const db = require('../database-oracle').db;
      await db.prepare(`UPDATE ai_select_topics SET icon_url=? WHERE id=?`).run(iconUrl, req.params.id);
      res.json({ icon_url: iconUrl });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dashboard/admin/shares — admin only，以 project 為主
router.get('/admin/shares', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
    const db = require('../database-oracle').db;
    const projects = await db.prepare(
      `SELECT p.id, p.name, p.is_public, p.public_approved, p.is_suspended, u.name AS creator_name,
              (SELECT COUNT(*) FROM ai_project_shares s WHERE s.project_id=p.id) AS share_count,
              (SELECT COUNT(*) FROM ai_select_topics t WHERE t.project_id=p.id AND t.is_active=1) AS topic_count
       FROM ai_select_projects p LEFT JOIN users u ON u.id=p.created_by
       ORDER BY p.id ASC`
    ).all();
    res.json(projects);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 資料權限前置問題檢查 ──────────────────────────────────────────────────────
/**
 * 雙向檢查：
 * 1. exclude 規則：問題中出現被排除的值 → 拒絕
 * 2. include 規則：問題中出現不在允許清單的值 → 拒絕
 *    （僅針對有明確代碼格式的 value_type：organization_code, dept_code, profit_center,
 *      org_section；其他 ID 型只做 exclude 檢查）
 *
 * Returns array of { term, reason } 被拒絕的項目
 */
function checkForbiddenInQuestion(question, rules) {
  const forbidden = [];
  const qUpper = question.toUpperCase();
  const qLower = question.toLowerCase();

  // 依 value_type 分組計算 include / exclude
  const groups = {};
  for (const r of rules) {
    const key = `${r.layer}_${r.value_type}`;
    if (!groups[key]) groups[key] = { value_type: r.value_type, includes: [], excludes: [] };
    if (r.include_type === 'include') groups[key].includes.push({ id: r.value_id, name: r.value_name });
    else                              groups[key].excludes.push({ id: r.value_id, name: r.value_name });
  }

  for (const group of Object.values(groups)) {
    const { value_type, includes, excludes } = group;

    // ── 1. exclude 檢查：問題包含被排除的值 ──────────────────────────────
    for (const item of excludes) {
      const terms = [item.id, item.name].filter(Boolean);
      if (terms.some(t => qLower.includes(t.toLowerCase()))) {
        forbidden.push(`${item.name || item.id}（已排除）`);
      }
    }

    // ── 2. include 反向檢查：問題包含不在允許清單的代碼值 ────────────────
    // 只針對 code/name 型（不是 ID 型）做此檢查，避免數字誤判
    const CODE_TYPES = new Set([
      'organization_code', 'dept_code', 'profit_center',
      'org_section', 'org_group_name',
      'operating_unit_name', 'set_of_books_name',
    ]);
    if (includes.length > 0 && CODE_TYPES.has(value_type)) {
      const allowedIds  = includes.map(i => (i.id  || '').toUpperCase()).filter(Boolean);
      const allowedNames = includes.map(i => (i.name || '').toLowerCase()).filter(Boolean);

      // 從問題中萃取「可能是代碼」的詞：大寫英數字母 2-6 碼
      const codePattern = /\b[A-Z][A-Z0-9]{1,5}\b/g;
      const detectedCodes = [...new Set([...qUpper.matchAll(codePattern)].map(m => m[0]))];

      for (const code of detectedCodes) {
        // 跳過常見保留字，避免誤判
        const COMMON_WORDS = new Set([
          'SELECT','FROM','WHERE','AND','OR','NOT','IN','IS','NULL','AS','BY',
          'ORDER','GROUP','HAVING','JOIN','ON','LEFT','RIGHT','INNER','OUTER',
          'WITH','CASE','WHEN','THEN','ELSE','END','LIKE','BETWEEN','EXISTS',
          'DISTINCT','INTO','TOP','SET','UPDATE','INSERT','DELETE',
          'SQL','ERP','ORG','BOM','MRP','PO','SO','WO','API','URL','UTC',
        ]);
        if (COMMON_WORDS.has(code)) continue;

        // 如果這個代碼不在 allowedIds 且不是 allowedNames 的子字串 → 可疑
        const isAllowed = allowedIds.includes(code) ||
          allowedNames.some(n => n.includes(code.toLowerCase()) || code.toLowerCase().includes(n));
        if (!isAllowed) {
          forbidden.push(`${code}（無 ${value_type} 查詢權限，允許：${allowedIds.join(', ')}）`);
        }
      }
    }
  }

  return [...new Set(forbidden)];
}

module.exports = router;
