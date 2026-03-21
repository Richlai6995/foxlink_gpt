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
const { translateFields, translateDescription, batchTranslateDescriptions } = require('../services/translationService');

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
              vector_top_k, vector_similarity_threshold,
              name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi
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
    const { name, description, icon, sort_order, project_id, policy_category_id,
            name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi } = req.body;
    if (!name) return res.status(400).json({ error: '主題名稱為必填' });
    if (project_id && !await canEditProject(db, project_id, req.user)) return res.status(403).json({ error: '無此專案權限' });
    const r = await db.prepare(
      `INSERT INTO ai_select_topics (name, description, icon, sort_order, created_by, project_id, policy_category_id) VALUES (?,?,?,?,?,?,?)`
    ).run(name, description || null, icon || null, sort_order || 0, req.user.id, project_id || null, policy_category_id || null);
    const newId = r.lastInsertRowid;
    const trans = (name_zh !== undefined)
      ? { name_zh: name_zh || null, name_en: name_en || null, name_vi: name_vi || null, desc_zh: desc_zh || null, desc_en: desc_en || null, desc_vi: desc_vi || null }
      : await translateFields({ name, description }).catch(() => ({ name_zh: null, name_en: null, name_vi: null, desc_zh: null, desc_en: null, desc_vi: null }));
    if (trans.name_zh !== undefined) {
      await db.prepare(`UPDATE ai_select_topics SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, newId);
    }
    const topic = await db.prepare(`SELECT * FROM ai_select_topics WHERE id=?`).get(newId);
    res.json(topic || { id: newId, ...trans });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/topics/:id
router.put('/designer/topics/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const topic = await db.prepare(`SELECT * FROM ai_select_topics WHERE id=?`).get(req.params.id);
    if (!topic) return res.status(404).json({ error: '不存在' });
    if (req.user.role !== 'admin' && topic.created_by !== req.user.id) {
      if (topic.project_id && !await canAccessProject(db, topic.project_id, req.user, 'develop')) return res.status(403).json({ error: '無權限' });
    }
    const { name, description, icon, sort_order, is_active, project_id, policy_category_id,
            name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi } = req.body;
    const finalName = name ?? topic.name;
    const finalDesc = description !== undefined ? (description || null) : topic.description;
    const finalCatId = policy_category_id !== undefined ? (policy_category_id || null) : topic.policy_category_id;
    await db.prepare(
      `UPDATE ai_select_topics SET name=?, description=?, icon=?, sort_order=?, is_active=?, project_id=?, policy_category_id=? WHERE id=?`
    ).run(finalName, finalDesc, icon ?? topic.icon, sort_order ?? 0, is_active ?? 1, project_id || null, finalCatId, req.params.id);
    if (name_zh !== undefined) {
      await db.prepare(`UPDATE ai_select_topics SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(name_zh || null, name_en || null, name_vi || null, desc_zh || null, desc_en || null, desc_vi || null, req.params.id);
    } else {
      const nameChanged = name !== undefined && name !== topic.name;
      const descChanged = description !== undefined && description !== topic.description;
      if (nameChanged || descChanged) {
        const trans = await translateFields({
          name: nameChanged ? finalName : null,
          description: descChanged ? finalDesc : null,
        }).catch(() => ({}));
        const setClauses = []; const params = [];
        if (nameChanged && trans.name_zh !== undefined) { setClauses.push('name_zh=?,name_en=?,name_vi=?'); params.push(trans.name_zh, trans.name_en, trans.name_vi); }
        if (descChanged && trans.desc_zh !== undefined) { setClauses.push('desc_zh=?,desc_en=?,desc_vi=?'); params.push(trans.desc_zh, trans.desc_en, trans.desc_vi); }
        if (setClauses.length) await db.prepare(`UPDATE ai_select_topics SET ${setClauses.join(',')} WHERE id=?`).run(...params, req.params.id);
      }
    }
    const updated = await db.prepare(`SELECT * FROM ai_select_topics WHERE id=?`).get(req.params.id);
    res.json(updated || { ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/topics/:id/translate
router.post('/designer/topics/:id/translate', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const topic = await db.prepare(`SELECT * FROM ai_select_topics WHERE id=?`).get(req.params.id);
    if (!topic) return res.status(404).json({ error: '不存在' });
    const trans = await translateFields({ name: topic.name, description: topic.description });
    await db.prepare(`UPDATE ai_select_topics SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
      .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, req.params.id);
    res.json(trans);
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
      topic_id, name, description, target_schema_ids, target_join_ids, schema_where_only_ids, vector_search_enabled,
      system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public,
      vector_top_k, vector_similarity_threshold, vector_skip_fields,
      name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi,
    } = req.body;
    if (!topic_id || !name) return res.status(400).json({ error: '主題與名稱為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_select_designs
         (topic_id, name, description, target_schema_ids, target_join_ids, schema_where_only_ids, vector_search_enabled,
          system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public,
          vector_top_k, vector_similarity_threshold, vector_skip_fields, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      topic_id, name, description || null,
      target_schema_ids ? JSON.stringify(target_schema_ids) : null,
      target_join_ids ? JSON.stringify(target_join_ids) : null,
      schema_where_only_ids ? JSON.stringify(schema_where_only_ids) : null,
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
    const newId = r.lastInsertRowid;
    const trans = (name_zh !== undefined)
      ? { name_zh: name_zh || null, name_en: name_en || null, name_vi: name_vi || null, desc_zh: desc_zh || null, desc_en: desc_en || null, desc_vi: desc_vi || null }
      : await translateFields({ name, description }).catch(() => ({ name_zh: null, name_en: null, name_vi: null, desc_zh: null, desc_en: null, desc_vi: null }));
    if (trans.name_zh !== undefined) {
      await db.prepare(`UPDATE ai_select_designs SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, newId);
    }
    res.json({ id: newId, ...trans });
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
      topic_id, name, description, target_schema_ids, target_join_ids, schema_where_only_ids, vector_search_enabled,
      system_prompt, few_shot_examples, chart_config, cache_ttl_minutes, is_public,
      vector_top_k, vector_similarity_threshold, vector_skip_fields,
      name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi,
    } = req.body;
    const existing = await db.prepare(`SELECT name, description FROM ai_select_designs WHERE id=?`).get(req.params.id);
    await db.prepare(
      `UPDATE ai_select_designs SET
         topic_id=?, name=?, description=?, target_schema_ids=?, target_join_ids=?, schema_where_only_ids=?, vector_search_enabled=?,
         system_prompt=?, few_shot_examples=?, chart_config=?, cache_ttl_minutes=?, is_public=?,
         vector_top_k=?, vector_similarity_threshold=?, vector_skip_fields=?,
         updated_at=SYSTIMESTAMP
       WHERE id=?`
    ).run(
      topic_id, name, description || null,
      target_schema_ids ? JSON.stringify(target_schema_ids) : null,
      target_join_ids ? JSON.stringify(target_join_ids) : null,
      schema_where_only_ids ? JSON.stringify(schema_where_only_ids) : null,
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
    if (name_zh !== undefined) {
      await db.prepare(`UPDATE ai_select_designs SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(name_zh || null, name_en || null, name_vi || null, desc_zh || null, desc_en || null, desc_vi || null, req.params.id);
    } else {
      const nameChanged = name !== undefined && existing && name !== existing.name;
      const descChanged = description !== undefined && existing && description !== existing.description;
      if (nameChanged || descChanged) {
        const trans = await translateFields({
          name: nameChanged ? name : null,
          description: descChanged ? (description || null) : null,
        }).catch(() => ({}));
        const setClauses = []; const params = [];
        if (nameChanged && trans.name_zh !== undefined) { setClauses.push('name_zh=?,name_en=?,name_vi=?'); params.push(trans.name_zh, trans.name_en, trans.name_vi); }
        if (descChanged && trans.desc_zh !== undefined) { setClauses.push('desc_zh=?,desc_en=?,desc_vi=?'); params.push(trans.desc_zh, trans.desc_en, trans.desc_vi); }
        if (setClauses.length) await db.prepare(`UPDATE ai_select_designs SET ${setClauses.join(',')} WHERE id=?`).run(...params, req.params.id);
      }
    }
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

// GET /api/dashboard/schemas-for-design/:designId — 一般使用者也可存取（供欄位選擇器用）
router.get('/schemas-for-design/:designId', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const designId = parseInt(req.params.designId);
    const design = await db.prepare('SELECT target_schema_ids, schema_where_only_ids FROM ai_select_designs WHERE id=?').get(designId);
    if (!design) return res.json([]);
    let ids = [];
    let whereOnlyIds = [];
    try {
      const raw = design.target_schema_ids;
      if (raw) ids = Array.isArray(raw) ? raw : JSON.parse(raw);
    } catch { ids = []; }
    try {
      const raw2 = design.schema_where_only_ids;
      if (raw2) whereOnlyIds = Array.isArray(raw2) ? raw2 : JSON.parse(raw2);
    } catch { whereOnlyIds = []; }
    if (!ids.length) return res.json([]);
    const placeholders = ids.map(() => '?').join(',');
    const schemas = await db.prepare(`SELECT * FROM ai_schema_definitions WHERE id IN (${placeholders})`).all(...ids);
    // 只回傳 is_visible != 0 的欄位給 field picker
    const columns = await db.prepare(`SELECT * FROM ai_schema_columns WHERE schema_id IN (${placeholders}) AND NVL(is_visible,1) != 0 ORDER BY id ASC`).all(...ids);
    const colMap = {};
    for (const c of columns) {
      if (!colMap[c.schema_id]) colMap[c.schema_id] = [];
      colMap[c.schema_id].push(c);
    }
    const whereOnlySet = new Set(whereOnlyIds.map(Number));
    res.json(schemas.map(s => ({
      ...s,
      columns: colMap[s.id] || [],
      where_only: whereOnlySet.has(Number(s.id)),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dashboard/designer/schemas
router.get('/designer/schemas', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { project_id, all } = req.query;
    const u = req.user;
    let filter = '';
    let binds = [];
    if (all === 'true') {
      // 查全部（供跨專案複製 schema 用），非 admin 只能看自己有存取權的
      if (u.role !== 'admin') {
        filter = `WHERE s.created_by=? OR EXISTS (
          SELECT 1 FROM ai_select_projects p WHERE p.id=s.project_id AND (
            p.created_by=? OR EXISTS (SELECT 1 FROM ai_project_shares sh WHERE sh.project_id=p.id AND sh.share_type='develop' AND ((sh.grantee_type='user' AND sh.grantee_id=?) OR (sh.grantee_type='role' AND sh.grantee_id=?)))
          ))`;
        binds = [u.id, u.id, String(u.id), String(u.role_id || '')];
      }
    } else if (project_id) {
      // 包含指定專案的 schema，以及沒有指定專案（共用）的 schema
      filter = 'WHERE s.project_id=? OR s.project_id IS NULL';
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
    const { table_name, display_name, display_name_en, display_name_vi, alias, source_type, source_sql, db_connection, business_notes, join_hints, base_conditions, vector_etl_job_id, columns, project_id } = req.body;
    if (!table_name) return res.status(400).json({ error: 'table_name 為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_schema_definitions (table_name, display_name, display_name_en, display_name_vi, alias, source_type, source_sql, db_connection, business_notes, join_hints, base_conditions, vector_etl_job_id, created_by, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      table_name, display_name || null, display_name_en || null, display_name_vi || null,
      alias || null, source_type || 'table', source_sql || null,
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

    // 自動翻譯顯示名稱（若 EN/VI 未提供）
    let autoEn = display_name_en || null, autoVi = display_name_vi || null;
    if (display_name && (!autoEn || !autoVi)) {
      try {
        const trans = await translateFields({ name: display_name });
        autoEn = autoEn || trans.name_en || null;
        autoVi = autoVi || trans.name_vi || null;
        await db.prepare(`UPDATE ai_schema_definitions SET display_name_en=?, display_name_vi=? WHERE id=?`)
          .run(autoEn, autoVi, schemaId);
      } catch (_) {}
    }
    res.json({ id: schemaId, display_name_en: autoEn, display_name_vi: autoVi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dashboard/designer/schemas/:id
router.put('/designer/schemas/:id', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { table_name, display_name, display_name_en, display_name_vi, alias, source_type, source_sql, db_connection, business_notes, join_hints, base_conditions, vector_etl_job_id, is_active, project_id } = req.body;
    // 自動翻譯顯示名稱（若 EN/VI 未提供）
    let finalEn = display_name_en || null, finalVi = display_name_vi || null;
    if (display_name && (!finalEn || !finalVi)) {
      try {
        const trans = await translateFields({ name: display_name });
        finalEn = finalEn || trans.name_en || null;
        finalVi = finalVi || trans.name_vi || null;
      } catch (_) {}
    }
    await db.prepare(
      `UPDATE ai_schema_definitions SET
         table_name=?, display_name=?, display_name_en=?, display_name_vi=?, alias=?, source_type=?, source_sql=?,
         db_connection=?, business_notes=?, join_hints=?, base_conditions=?, vector_etl_job_id=?, is_active=?,
         project_id=?, updated_at=SYSTIMESTAMP
       WHERE id=?`
    ).run(
      table_name, display_name || null, finalEn, finalVi,
      alias || null, source_type || 'table', source_sql || null,
      db_connection || 'erp',
      business_notes || null,
      join_hints ? JSON.stringify(join_hints) : null,
      Array.isArray(base_conditions) ? JSON.stringify(base_conditions) : (base_conditions || null),
      vector_etl_job_id || null,
      is_active ?? 1,
      project_id || null,
      req.params.id
    );
    res.json({ ok: true, display_name_en: finalEn, display_name_vi: finalVi });
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
              is_filter_key, filter_layer, filter_source, desc_en, desc_vi, is_visible)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          req.params.id, col.column_name, col.data_type || null, col.description || null,
          col.is_vectorized ? 1 : 0,
          col.value_mapping ? JSON.stringify(col.value_mapping) : null,
          col.sample_values ? JSON.stringify(col.sample_values) : null,
          col.is_virtual ? 1 : 0,
          col.expression || null,
          col.is_filter_key ? 1 : 0,
          col.filter_layer || null,
          col.filter_source || null,
          col.desc_en || null,
          col.desc_vi || null,
          col.is_visible === 0 ? 0 : 1
        );
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/schemas/:id/copy — 複製 schema 到指定專案
router.post('/designer/schemas/:id/copy', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { target_project_id } = req.body;
    const src = await db.prepare(`SELECT * FROM ai_schema_definitions WHERE id=?`).get(req.params.id);
    if (!src) return res.status(404).json({ error: '來源 Schema 不存在' });
    const cols = await db.prepare(`SELECT * FROM ai_schema_columns WHERE schema_id=? ORDER BY id ASC`).all(req.params.id);
    const r = await db.prepare(
      `INSERT INTO ai_schema_definitions (table_name, display_name, display_name_en, display_name_vi, alias, source_type, source_sql,
         db_connection, business_notes, join_hints, base_conditions, vector_etl_job_id, created_by, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      src.table_name, src.display_name, src.display_name_en, src.display_name_vi,
      src.alias, src.source_type, src.source_sql, src.db_connection,
      src.business_notes, src.join_hints, src.base_conditions, src.vector_etl_job_id,
      req.user.id, target_project_id || null
    );
    const newId = r.lastInsertRowid;
    for (const col of cols) {
      await db.prepare(
        `INSERT INTO ai_schema_columns (schema_id, column_name, data_type, description, is_vectorized, value_mapping, sample_values,
           is_virtual, expression, is_filter_key, filter_layer, filter_source, desc_en, desc_vi, is_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId, col.column_name, col.data_type, col.description, col.is_vectorized,
        col.value_mapping, col.sample_values, col.is_virtual, col.expression,
        col.is_filter_key, col.filter_layer, col.filter_source, col.desc_en, col.desc_vi,
        col.is_visible === 0 ? 0 : 1
      );
    }
    res.json({ id: newId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/schemas/:id/translate — 重新翻譯顯示名稱
router.post('/designer/schemas/:id/translate', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const s = await db.prepare(`SELECT display_name FROM ai_schema_definitions WHERE id=?`).get(req.params.id);
    if (!s) return res.status(404).json({ error: '不存在' });
    const trans = await translateFields({ name: s.display_name });
    await db.prepare(`UPDATE ai_schema_definitions SET display_name_en=?, display_name_vi=? WHERE id=?`)
      .run(trans.name_en || null, trans.name_vi || null, req.params.id);
    res.json({ display_name_en: trans.name_en || null, display_name_vi: trans.name_vi || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/schemas/:id/columns/translate — 批次自動翻譯欄位說明
router.post('/designer/schemas/:id/columns/translate', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const cols = await db.prepare(
      `SELECT id, description FROM ai_schema_columns WHERE schema_id=? AND description IS NOT NULL`
    ).all(req.params.id);
    // 批次翻譯（每 30 筆一次 LLM call，避免大表逐筆超時）
    const resultMap = await batchTranslateDescriptions(cols, 30);
    let updated = 0;
    for (const [id, t] of resultMap) {
      await db.prepare(`UPDATE ai_schema_columns SET desc_en=?,desc_vi=? WHERE id=?`).run(t.desc_en, t.desc_vi, id);
      updated++;
    }
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dashboard/designer/designs/:id/translate — 重新翻譯
router.post('/designer/designs/:id/translate', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const d = await db.prepare(`SELECT name, description FROM ai_select_designs WHERE id=?`).get(req.params.id);
    if (!d) return res.status(404).json({ error: '不存在' });
    const trans = await translateFields({ name: d.name, description: d.description });
    await db.prepare(`UPDATE ai_select_designs SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
      .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, req.params.id);
    res.json(trans);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dashboard/designer/schemas/:id/columns/export-csv
router.get('/designer/schemas/:id/columns/export-csv', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const cols = await db.prepare(
      `SELECT column_name, data_type, description, desc_en, desc_vi, is_virtual, expression FROM ai_schema_columns WHERE schema_id=? ORDER BY id ASC`
    ).all(req.params.id);
    const schema = await db.prepare(`SELECT table_name FROM ai_schema_definitions WHERE id=?`).get(req.params.id);
    const lines = ['column_name,data_type,description,desc_en,desc_vi,is_virtual,expression'];
    for (const c of cols) {
      const escape = v => `"${(v || '').replace(/"/g, '""')}"`;
      lines.push([escape(c.column_name), escape(c.data_type || ''), escape(c.description || ''), escape(c.desc_en || ''), escape(c.desc_vi || ''), c.is_virtual ? '1' : '0', escape(c.expression || '')].join(','));
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
    const { rows } = req.body; // [{ column_name, description, desc_en, desc_vi }]
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows 為必填陣列' });
    let updated = 0;
    for (const row of rows) {
      if (!row.column_name) continue;
      const r = await db.prepare(
        `UPDATE ai_schema_columns SET description=?, desc_en=?, desc_vi=? WHERE schema_id=? AND column_name=?`
      ).run(row.description || null, row.desc_en || null, row.desc_vi || null, req.params.id, row.column_name);
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

// POST /api/dashboard/designer/schemas/:id/refresh — 從 ERP DB 重新抓欄位清單，保留既有欄位設定
router.post('/designer/schemas/:id/refresh', requireDesigner, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const schema = await db.prepare(`SELECT * FROM ai_schema_definitions WHERE id=?`).get(req.params.id);
    if (!schema) return res.status(404).json({ error: 'Schema 不存在' });

    if (schema.source_type === 'sql') {
      return res.status(400).json({ error: '自訂 SQL 類型無法自動刷新欄位，請手動編輯' });
    }

    // 解析 owner.table_name
    const fullName = (schema.table_name || '').trim();
    const dot = fullName.indexOf('.');
    const owner = dot > 0 ? fullName.slice(0, dot).toUpperCase() : 'APPS';
    const tableName = dot > 0 ? fullName.slice(dot + 1).toUpperCase() : fullName.toUpperCase();

    if (!tableName) return res.status(400).json({ error: 'Schema 的 table_name 為空' });

    const erpPool = await require('../services/dashboardService').getErpPool();
    const oracledb = require('oracledb');
    const conn = await erpPool.getConnection();
    let freshCols = [];
    try {
      const result = await conn.execute(
        `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.DATA_LENGTH, c.DATA_PRECISION, c.DATA_SCALE, cc.COMMENTS
         FROM   ALL_TAB_COLUMNS c
         LEFT JOIN ALL_COL_COMMENTS cc
                ON cc.OWNER = c.OWNER AND cc.TABLE_NAME = c.TABLE_NAME AND cc.COLUMN_NAME = c.COLUMN_NAME
         WHERE  c.OWNER = :owner AND c.TABLE_NAME = :tableName
         ORDER BY c.COLUMN_ID`,
        { owner, tableName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      for (const r of (result.rows || [])) {
        let typeStr = r.DATA_TYPE;
        if (r.DATA_TYPE === 'NUMBER' && r.DATA_PRECISION != null)
          typeStr = `NUMBER(${r.DATA_PRECISION}${r.DATA_SCALE ? ',' + r.DATA_SCALE : ''})`;
        else if (r.DATA_TYPE === 'VARCHAR2' || r.DATA_TYPE === 'CHAR')
          typeStr = `${r.DATA_TYPE}(${r.DATA_LENGTH})`;
        freshCols.push({ column_name: r.COLUMN_NAME, data_type: typeStr, description: r.COMMENTS || null });
      }
    } finally {
      await conn.close().catch(() => {});
    }

    if (freshCols.length === 0) {
      return res.status(404).json({ error: `在 Oracle 找不到 ${fullName} 的欄位，請確認 table_name 正確` });
    }

    // 取現有欄位（保留所有設定）
    const existingCols = await db.prepare(`SELECT * FROM ai_schema_columns WHERE schema_id=? ORDER BY id ASC`).all(req.params.id);
    const existingMap = new Map(existingCols.map(c => [c.column_name.toUpperCase(), c]));
    const freshSet = new Set(freshCols.map(c => c.column_name.toUpperCase()));

    const toAdd = freshCols.filter(c => !existingMap.has(c.column_name.toUpperCase()));
    const toRemove = existingCols.filter(c => !freshSet.has(c.column_name.toUpperCase()));

    // 刪除消失的欄位
    for (const col of toRemove) {
      await db.prepare(`DELETE FROM ai_schema_columns WHERE id=?`).run(col.id);
    }
    // 新增欄位（用 Oracle 說明，其餘設定保持預設）
    for (const col of toAdd) {
      await db.prepare(
        `INSERT INTO ai_schema_columns (schema_id, column_name, data_type, description) VALUES (?, ?, ?, ?)`
      ).run(req.params.id, col.column_name, col.data_type, col.description);
    }
    // 更新既有欄位的 data_type（型態可能改變，其他設定保留不動）
    for (const col of freshCols) {
      const existing = existingMap.get(col.column_name.toUpperCase());
      if (existing && existing.data_type !== col.data_type) {
        await db.prepare(`UPDATE ai_schema_columns SET data_type=? WHERE id=?`).run(col.data_type, existing.id);
      }
    }

    await db.prepare(`UPDATE ai_schema_definitions SET updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(req.params.id);

    res.json({
      ok: true,
      added: toAdd.length,
      removed: toRemove.length,
      unchanged: existingCols.length - toRemove.length,
      total: freshCols.length,
      added_cols: toAdd.map(c => c.column_name),
      removed_cols: toRemove.map(c => c.column_name),
    });
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
      embedding_dimension, is_incremental, trigger_intent,
      job_type, target_table, target_mode, upsert_key, delete_sql,
      schedule_type, schedule_config, project_id
    } = req.body;
    if (!name || !source_sql) return res.status(400).json({ error: '名稱與 source_sql 為必填' });
    const cronExpr = scheduleToCron(schedule_type || 'cron', schedule_config);
    const r = await db.prepare(
      `INSERT INTO ai_etl_jobs
         (name, source_sql, source_connection, vectorize_fields, metadata_fields,
          embedding_dimension, cron_expression, is_incremental, created_by,
          job_type, target_table, target_mode, upsert_key, delete_sql, schedule_type, schedule_config, project_id, trigger_intent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      project_id || null,
      trigger_intent || null
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
      embedding_dimension, is_incremental, status, trigger_intent,
      job_type, target_table, target_mode, upsert_key, delete_sql,
      schedule_type, schedule_config, project_id
    } = req.body;
    const cronExpr = scheduleToCron(schedule_type || 'cron', schedule_config);
    await db.prepare(
      `UPDATE ai_etl_jobs SET
         name=?, source_sql=?, source_connection=?, vectorize_fields=?, metadata_fields=?,
         embedding_dimension=?, cron_expression=?, is_incremental=?, status=?,
         job_type=?, target_table=?, target_mode=?, upsert_key=?, delete_sql=?,
         schedule_type=?, schedule_config=?, project_id=?, trigger_intent=?
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
      trigger_intent || null,
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
  const { design_id, question, vector_top_k, vector_similarity_threshold, model_key, lang, override_sql } = req.body;
  if (!design_id || !question?.trim()) {
    return res.status(400).json({ error: 'design_id 與 question 為必填' });
  }

  const isDesigner = req.user.role === 'admin' || req.user.can_design_ai_select == 1;

  let _categoryId = null;
  try {
    const db = require('../database-oracle').db;
    const design = await db.prepare(`SELECT id, is_public, is_suspended, created_by, topic_id FROM ai_select_designs WHERE id=?`).get(design_id);
    if (!design) return res.status(404).json({ error: '設計不存在' });
    if (design.is_suspended == 1) return res.status(403).json({ error: '此查詢設計已暫停使用' });
    const ok = await canAccessDesign(db, design, req.user);
    if (!ok) return res.status(403).json({ error: '無此查詢設計的存取權限' });

    // 取得主題的政策類別
    if (design.topic_id) {
      const topic = await db.prepare(`SELECT policy_category_id FROM ai_select_topics WHERE id=?`).get(design.topic_id);
      _categoryId = topic?.policy_category_id || null;
    }

    // ── 資料權限前置檢查（非 admin）────────────────────────────────────────
    if (req.user.role !== 'admin') {
      const { getEffectivePolicies } = require('./dataPermissions');
      const policies = await getEffectivePolicies(db, req.user.id, _categoryId);
      const allRules = policies.flatMap(p => p.rules);
      if (allRules.length > 0) {
        const forbidden = checkForbiddenInQuestion(question.trim(), allRules);
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
    // 取得有效政策（依主題的政策類別過濾）
    let effectivePolicy = null;
    if (req.user.role !== 'admin') {
      try {
        const { getEffectivePolicies } = require('./dataPermissions');
        const db = require('../database-oracle').db;
        const policies = await getEffectivePolicies(db, req.user.id, _categoryId);
        if (policies.length > 0) {
          effectivePolicy = { rules: policies.flatMap(p => p.rules) };
        }
      } catch (_) {}
    }

    const { runDashboardQuery } = require('../services/dashboardService');
    await runDashboardQuery({
      designId: Number(design_id),
      question: question.trim(),
      userId: req.user.id,
      user: req.user,
      isDesigner,
      overrideSql: override_sql || null,
      send: sendWrapped,
      vectorTopK: vector_top_k ? Number(vector_top_k) : undefined,
      vectorSimilarityThreshold: vector_similarity_threshold ?? undefined,
      modelKey: model_key || null,
      effectivePolicy,
      lang: lang || 'zh-TW',
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
    const { UPLOAD_DIR: _ud } = require('../config/paths');
    const uploadDir = require('path').join(_ud, 'dashboard_icons');
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

// POST /api/dashboard/upload-logo — 上傳公司 Logo
router.post('/upload-logo', async (req, res) => {
  try {
    const multer = require('multer');
    const path = require('path');
    const { UPLOAD_DIR: _ud } = require('../config/paths');
    const uploadDir = path.join(_ud, 'dashboard_logos');
    require('fs').mkdirSync(uploadDir, { recursive: true });
    const storage = multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, `logo_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`),
    });
    const upload = multer({
      storage,
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('只允許圖片檔案'));
      },
    }).single('logo');
    upload(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '未收到檔案' });
      res.json({ url: `/uploads/dashboard_logos/${req.file.filename}` });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dashboard/upload-wallpaper — 上傳儀表板壁紙圖片
router.post('/upload-wallpaper', async (req, res) => {
  try {
    const multer = require('multer');
    const path = require('path');
    const { UPLOAD_DIR: _ud } = require('../config/paths');
    const uploadDir = path.join(_ud, 'dashboard_wallpapers');
    require('fs').mkdirSync(uploadDir, { recursive: true });
    const storage = multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, `wp_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`),
    });
    const upload = multer({
      storage,
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('只允許圖片檔案'));
      },
    }).single('wallpaper');
    upload(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '未收到檔案' });
      res.json({ url: `/uploads/dashboard_wallpapers/${req.file.filename}` });
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

// ── GET /api/dashboard/multiorg-scope ── 前端啟動時主動取得使用者的 MultiOrg 範圍 ──
router.get('/multiorg-scope', async (req, res) => {
  if (req.user.role === 'admin') return res.json({ has_restrictions: false, is_admin: true });
  try {
    const db = require('../database-oracle').db;
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
    const { getEffectivePolicies } = require('./dataPermissions');
    const policiesArr = await getEffectivePolicies(db, req.user.id, categoryId);
    const policy = policiesArr.length ? { rules: policiesArr.flatMap(p => p.rules) } : null;

    if (!policy?.rules?.length) return res.json({ has_restrictions: false });

    const {
      MULTIORG_VALUE_TYPES, loadOrgHierarchy, loadAutoOrgIds, resolveUserScope, buildScopePayload,
    } = require('../services/multiOrgService');
    const { getErpPool } = require('../services/dashboardService');

    const hasMultiOrgRules = policy.rules.some(r => MULTIORG_VALUE_TYPES.has(r.value_type));
    if (!hasMultiOrgRules) return res.json({ has_restrictions: false });

    // 重新從 DB 取最新使用者資料（session 可能快取舊的組織欄位）
    const freshUser = await (require('../database-oracle').db).prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id) || req.user;

    const hierarchy = await loadOrgHierarchy(getErpPool);

    // auto_from_employee rule 需要先推導 ORGANIZATION_IDs
    let autoOrgIds = new Set();
    const hasAutoRule = policy.rules.some(r => r.value_type === 'auto_from_employee');
    if (hasAutoRule) {
      const { loadDeptHierarchy } = require('../services/orgHierarchyService');
      const deptHierarchy = await loadDeptHierarchy(getErpPool);
      autoOrgIds = loadAutoOrgIds(freshUser, deptHierarchy);
      console.log(`[multiorg-scope] auto_from_employee: derived ${autoOrgIds.size} ORGANIZATION_IDs for user ${freshUser.username}`);
    }

    const scope = resolveUserScope(policy.rules, hierarchy, autoOrgIds);
    const payload = buildScopePayload(scope);
    if (payload.denied) return res.status(403).json(payload);
    res.json(payload);
  } catch (e) {
    console.error('[multiorg-scope]', e.message);
    res.status(503).json({ error: '無法驗證資料權限（ERP 連線異常）', unavailable: true });
  }
});

// ── GET /api/dashboard/org-scope ── 前端啟動時主動取得使用者的公司組織範圍 ──
router.get('/org-scope', async (req, res) => {
  if (req.user.role === 'admin') return res.json({ has_restrictions: false, is_admin: true });
  try {
    const db = require('../database-oracle').db;
    // 重新從 DB 取最新使用者資料（session 可能快取舊的組織欄位）
    const freshUser = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id) || req.user;
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;

    const { getEffectivePolicies } = require('./dataPermissions');
    const policiesArr = await getEffectivePolicies(db, freshUser.id, categoryId);
    const policy = policiesArr.length ? { rules: policiesArr.flatMap(p => p.rules) } : null;

    if (!policy?.rules?.length) return res.json({ has_restrictions: false });

    const {
      ORG_HIERARCHY_VALUE_TYPES, loadDeptHierarchy, resolveUserDeptScope, buildOrgScopePayload,
    } = require('../services/orgHierarchyService');
    const { getErpPool } = require('../services/dashboardService');

    const hasOrgRules = policy.rules.some(r => ORG_HIERARCHY_VALUE_TYPES.has(r.value_type || r.filter_source));
    if (!hasOrgRules) return res.json({ has_restrictions: false });

    const hierarchy = await loadDeptHierarchy(getErpPool);
    const scope = resolveUserDeptScope(policy.rules, freshUser, hierarchy);
    const payload = buildOrgScopePayload(scope);
    if (payload.denied) return res.status(403).json(payload);
    res.json(payload);
  } catch (e) {
    console.error('[org-scope]', e.message);
    res.status(503).json({ error: '無法驗證組織權限（ERP 連線異常）', unavailable: true });
  }
});

// ── 資料權限前置問題檢查 ──────────────────────────────────────────────────────
/**
 * 雙向檢查（Layer 3/4 非 MultiOrg 規則，例如 dept_code / profit_center）：
 * 1. exclude 規則：問題中出現被排除的值 → 拒絕
 * 2. include 規則：問題中出現不在允許清單的值 → 拒絕
 *
 * ⚠️ MultiOrg 相關 value_type（organization_code, organization_id,
 *    operating_unit, set_of_books_id）已移至 SSE phase 的 multiOrgService
 *    做 hierarchy 展開後的精確比對，不在這裡處理。
 *
 * Returns array of { term, reason } 被拒絕的項目
 */
function checkForbiddenInQuestion(question, rules) {
  const { MULTIORG_VALUE_TYPES } = require('../services/multiOrgService');
  const { ORG_HIERARCHY_VALUE_TYPES } = require('../services/orgHierarchyService');
  const forbidden = [];
  const qUpper = question.toUpperCase();
  const qLower = question.toLowerCase();

  // 依 value_type 分組計算 include / exclude
  // ⚠️ MultiOrg 和 Layer 3 OrgHierarchy 都由 SSE phase 各自的 service 處理，這裡跳過
  const groups = {};
  for (const r of rules) {
    if (MULTIORG_VALUE_TYPES.has(r.value_type)) continue;
    if (ORG_HIERARCHY_VALUE_TYPES.has(r.value_type || r.filter_source)) continue; // ← Layer 3 不在此處理
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
      // org_group_name / org_section / profit_center / dept_code → 由 orgHierarchyService 處理，不在此
      // organization_code / operating_unit / set_of_books_id → 由 multiOrgService 處理，不在此
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

// ═══════════════════════════════════════════════════════════════════════════════
// ── AI 命名查詢 (Saved Queries) ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/** 判斷 user 是否能存取某 saved query（use 或 manage） */
async function canAccessSavedQuery(db, query, user) {
  if (user.role === 'admin') return true;
  if (query.user_id === user.id) return true;
  const shares = await db.prepare(
    `SELECT share_type FROM ai_saved_query_shares WHERE query_id=? AND (
      (grantee_type='user' AND grantee_id=?) OR
      (grantee_type='role' AND grantee_id=?) OR
      (grantee_type='department' AND grantee_id=?) OR
      (grantee_type='cost_center' AND grantee_id=?) OR
      (grantee_type='division' AND grantee_id=?) OR
      (grantee_type='org_group' AND grantee_id=?)
    )`
  ).all(
    query.id,
    String(user.id), String(user.role_id || ''), String(user.dept_code || ''),
    String(user.profit_center || ''), String(user.org_section || ''),
    String(user.org_group_name || '')
  );
  return shares.length > 0;
}

async function canManageSavedQuery(db, query, user) {
  if (user.role === 'admin') return true;
  if (query.user_id === user.id) return true;
  const shares = await db.prepare(
    `SELECT share_type FROM ai_saved_query_shares WHERE query_id=? AND share_type='manage' AND (
      (grantee_type='user' AND grantee_id=?) OR
      (grantee_type='role' AND grantee_id=?) OR
      (grantee_type='department' AND grantee_id=?) OR
      (grantee_type='cost_center' AND grantee_id=?) OR
      (grantee_type='division' AND grantee_id=?) OR
      (grantee_type='org_group' AND grantee_id=?)
    )`
  ).all(
    query.id,
    String(user.id), String(user.role_id || ''), String(user.dept_code || ''),
    String(user.profit_center || ''), String(user.org_section || ''),
    String(user.org_group_name || '')
  );
  return shares.length > 0;
}

// GET /saved-queries — 取得我的 + 被分享的查詢（按分類分組）
router.get('/saved-queries', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const user = req.user;
    const uid = String(user.id), rid = String(user.role_id || ''),
          dept = String(user.dept_code || ''), pc = String(user.profit_center || ''),
          div = String(user.org_section || ''), og = String(user.org_group_name || '');
    const rows = await db.prepare(`
      SELECT sq.*, u.name as creator_name, u.employee_id as creator_emp_id,
             d.name as design_name, d.name_en as design_name_en, d.name_vi as design_name_vi,
             t.name as topic_name, t.name_en as topic_name_en, t.name_vi as topic_name_vi,
             CASE WHEN sq.user_id = ? THEN 1
                  WHEN EXISTS (SELECT 1 FROM ai_saved_query_shares
                               WHERE query_id=sq.id AND share_type='manage' AND (
                                 (grantee_type='user' AND grantee_id=?) OR
                                 (grantee_type='role' AND grantee_id=?) OR
                                 (grantee_type='department' AND grantee_id=?) OR
                                 (grantee_type='cost_center' AND grantee_id=?) OR
                                 (grantee_type='division' AND grantee_id=?) OR
                                 (grantee_type='org_group' AND grantee_id=?)
                               )) THEN 1
                  ELSE 0 END AS can_manage
      FROM ai_saved_queries sq
      LEFT JOIN users u ON u.id = sq.user_id
      LEFT JOIN ai_select_designs d ON d.id = sq.design_id
      LEFT JOIN ai_select_topics t ON t.id = d.topic_id
      WHERE sq.is_active = 1
        AND (
          sq.user_id = ?
          OR sq.id IN (
            SELECT query_id FROM ai_saved_query_shares WHERE
              (grantee_type='user' AND grantee_id=?) OR
              (grantee_type='role' AND grantee_id=?) OR
              (grantee_type='department' AND grantee_id=?) OR
              (grantee_type='cost_center' AND grantee_id=?) OR
              (grantee_type='division' AND grantee_id=?) OR
              (grantee_type='org_group' AND grantee_id=?)
          )
        )
      ORDER BY sq.category NULLS LAST, sq.sort_order, sq.name
    `).all(
      user.id, uid, rid, dept, pc, div, og,
      user.id, uid, rid, dept, pc, div, og
    );
    const isAdmin = user.role === 'admin';
    res.json(rows.map(r => ({ ...r, can_manage: isAdmin ? 1 : r.can_manage })));
  } catch (e) {
    console.error('[saved-queries GET]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /saved-queries — 新增命名查詢
router.post('/saved-queries', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const { name, name_en, name_vi, description, category, design_id, question, pinned_sql,
            chart_config, parameters_schema, auto_run, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: '名稱必填' });
    // Auto-translate if not provided
    let tEn = name_en || null, tVi = name_vi || null;
    if (!tEn || !tVi) {
      try {
        const t = await translateFields({ name, description: null });
        if (!tEn) tEn = t.name_en || null;
        if (!tVi) tVi = t.name_vi || null;
      } catch {}
    }
    const r = await db.prepare(`
      INSERT INTO ai_saved_queries
        (user_id, name, name_en, name_vi, description, category, design_id, question, pinned_sql,
         chart_config, parameters_schema, auto_run, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      req.user.id, name, tEn, tVi, description || null, category || null,
      design_id || null, question || null, pinned_sql || null,
      chart_config ? JSON.stringify(chart_config) : null,
      parameters_schema ? JSON.stringify(parameters_schema) : null,
      auto_run ? 1 : 0, sort_order || 0
    );
    const newRow = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(r.lastInsertRowid);
    res.json(newRow);
  } catch (e) {
    console.error('[saved-queries POST]', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /saved-queries/:id — 更新命名查詢
router.put('/saved-queries/:id', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const query = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    if (!query) return res.status(404).json({ error: '查詢不存在' });
    if (!await canManageSavedQuery(db, query, req.user))
      return res.status(403).json({ error: '無權限修改' });

    const { name, name_en, name_vi, description, category, design_id, question, pinned_sql,
            chart_config, parameters_schema, auto_run, sort_order } = req.body;
    // Auto-translate if name changed or translations not provided
    let tEn = name_en !== undefined ? (name_en || null) : query.name_en;
    let tVi = name_vi !== undefined ? (name_vi || null) : query.name_vi;
    if (name !== query.name && !name_en && !name_vi) {
      try {
        const t = await translateFields({ name, description: null });
        tEn = t.name_en || null; tVi = t.name_vi || null;
      } catch {}
    }
    await db.prepare(`
      UPDATE ai_saved_queries SET
        name=?, name_en=?, name_vi=?, description=?, category=?, design_id=?, question=?, pinned_sql=?,
        chart_config=?, parameters_schema=?, auto_run=?, sort_order=?,
        updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(
      name, tEn, tVi, description || null, category || null, design_id || null,
      question || null, pinned_sql || null,
      chart_config ? JSON.stringify(chart_config) : null,
      parameters_schema ? JSON.stringify(parameters_schema) : null,
      auto_run ? 1 : 0, sort_order || 0,
      req.params.id
    );
    const updated = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    res.json(updated);
  } catch (e) {
    console.error('[saved-queries PUT]', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /saved-queries/:id
router.delete('/saved-queries/:id', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const query = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    if (!query) return res.status(404).json({ error: '查詢不存在' });
    if (!await canManageSavedQuery(db, query, req.user))
      return res.status(403).json({ error: '無權限刪除' });
    await db.prepare(`UPDATE ai_saved_queries SET is_active=0, updated_at=SYSTIMESTAMP WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /saved-queries/:id/translate — 重新翻譯名稱
router.post('/saved-queries/:id/translate', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const query = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    if (!query) return res.status(404).json({ error: '不存在' });
    if (!await canManageSavedQuery(db, query, req.user))
      return res.status(403).json({ error: '無權限' });
    const t = await translateFields({ name: query.name, description: null });
    await db.prepare(`UPDATE ai_saved_queries SET name_en=?, name_vi=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(t.name_en, t.name_vi, req.params.id);
    res.json({ name_zh: query.name, name_en: t.name_en, name_vi: t.name_vi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /saved-queries/:id/clone — 另存為（被分享者複製一份自己的）
router.post('/saved-queries/:id/clone', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const query = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    if (!query) return res.status(404).json({ error: '查詢不存在' });
    if (!await canAccessSavedQuery(db, query, req.user))
      return res.status(403).json({ error: '無存取權限' });

    const newName = (req.body.name || query.name) + ' (複製)';
    const r = await db.prepare(`
      INSERT INTO ai_saved_queries
        (user_id, name, description, category, design_id, question, pinned_sql,
         chart_config, parameters_schema, auto_run, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      req.user.id, newName, query.description, query.category,
      query.design_id, query.question, query.pinned_sql,
      query.chart_config, query.parameters_schema, query.auto_run, 0
    );
    const newRow = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(r.lastInsertRowid);
    res.json(newRow);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /saved-queries/:id/chart-config — 僅更新圖表設定（Tableau 自動存檔用）
router.patch('/saved-queries/:id/chart-config', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const query = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    if (!query) return res.status(404).json({ error: '查詢不存在' });
    if (!await canManageSavedQuery(db, query, req.user))
      return res.status(403).json({ error: '無權限修改' });
    const { chart_config } = req.body;
    await db.prepare(`UPDATE ai_saved_queries SET chart_config=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(chart_config ? JSON.stringify(chart_config) : null, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /saved-queries/:id/last-run — 更新最後執行時間
router.patch('/saved-queries/:id/last-run', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    await db.prepare(`UPDATE ai_saved_queries SET last_run_at=SYSTIMESTAMP WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /saved-queries/:id/shares
router.get('/saved-queries/:id/shares', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const query = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    if (!query) return res.status(404).json({ error: '查詢不存在' });
    if (!await canManageSavedQuery(db, query, req.user))
      return res.status(403).json({ error: '無管理權限' });
    const shares = await db.prepare(`SELECT * FROM ai_saved_query_shares WHERE query_id=? ORDER BY id`).all(req.params.id);
    res.json(shares);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /saved-queries/:id/shares
router.post('/saved-queries/:id/shares', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const query = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    if (!query) return res.status(404).json({ error: '查詢不存在' });
    if (!await canManageSavedQuery(db, query, req.user))
      return res.status(403).json({ error: '無管理權限' });
    const { grantee_type, grantee_id, share_type } = req.body;
    if (!grantee_type || !grantee_id) return res.status(400).json({ error: '必填欄位缺少' });
    // 避免重複
    const exists = await db.prepare(
      `SELECT id FROM ai_saved_query_shares WHERE query_id=? AND grantee_type=? AND grantee_id=?`
    ).get(req.params.id, grantee_type, String(grantee_id));
    if (exists) {
      await db.prepare(`UPDATE ai_saved_query_shares SET share_type=? WHERE id=?`).run(share_type || 'use', exists.id);
    } else {
      await db.prepare(`INSERT INTO ai_saved_query_shares (query_id, grantee_type, grantee_id, share_type, granted_by) VALUES (?,?,?,?,?)`
      ).run(req.params.id, grantee_type, String(grantee_id), share_type || 'use', req.user.id);
    }
    const shares = await db.prepare(`SELECT * FROM ai_saved_query_shares WHERE query_id=? ORDER BY id`).all(req.params.id);
    res.json(shares);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /saved-queries/:id/shares/:shareId
router.delete('/saved-queries/:id/shares/:shareId', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const query = await db.prepare('SELECT * FROM ai_saved_queries WHERE id=?').get(req.params.id);
    if (!query || !await canManageSavedQuery(db, query, req.user))
      return res.status(403).json({ error: '無管理權限' });
    await db.prepare(`DELETE FROM ai_saved_query_shares WHERE id=? AND query_id=?`).run(req.params.shareId, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /saved-queries/param-values — 取得某 schema 欄位的 distinct 值（供參數下拉使用）
router.get('/saved-queries/param-values', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  const { getErpPool } = require('../services/dashboardService');
  try {
    const { schema_id, column_name, fetch_values_sql, search } = req.query;
    if (!column_name) return res.status(400).json({ error: '欄位名稱必填' });

    let sql = fetch_values_sql;
    const searchFilter = search ? search.trim() : '';
    const limit = searchFilter ? 100 : 50; // 無搜尋先載前50，有搜尋撈100
    if (!sql && schema_id) {
      const schemaDef = await db.prepare('SELECT table_name, source_sql, source_type FROM ai_schema_definitions WHERE id=?').get(schema_id);
      if (!schemaDef) return res.status(404).json({ error: 'Schema 不存在' });
      const col = column_name.toUpperCase();
      const source = schemaDef.source_type === 'sql' ? `(${schemaDef.source_sql})` : schemaDef.table_name;
      const likeClause = searchFilter ? ` AND UPPER(${col}) LIKE UPPER('%${searchFilter.replace(/'/g, "''")}%')` : '';
      sql = `SELECT DISTINCT ${col} AS val FROM ${source} WHERE ${col} IS NOT NULL${likeClause} ORDER BY 1 FETCH FIRST ${limit} ROWS ONLY`;
    }
    if (!sql) return res.status(400).json({ error: '無法組建查詢' });

    const erpPool = await getErpPool();
    const conn = await erpPool.getConnection();
    try {
      const result = await conn.execute(sql, [], { outFormat: require('oracledb').OUT_FORMAT_OBJECT });
      const rows = (result.rows || []).map(r => {
        const keys = Object.keys(r);
        const val = r.VAL ?? r[keys[0]];
        const label = r.LABEL ?? val;
        return { val, label };
      });
      res.json(rows);
    } finally {
      await conn.close();
    }
  } catch (e) {
    console.error('[param-values]', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── AI 儀表板 (Report Dashboards) ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function canAccessDashboard(db, board, user) {
  if (user.role === 'admin') return true;
  if (board.user_id === user.id) return true;
  const shares = await db.prepare(
    `SELECT share_type FROM ai_report_dashboard_shares WHERE dashboard_id=? AND (
      (grantee_type='user' AND grantee_id=?) OR
      (grantee_type='role' AND grantee_id=?) OR
      (grantee_type='department' AND grantee_id=?) OR
      (grantee_type='cost_center' AND grantee_id=?) OR
      (grantee_type='division' AND grantee_id=?) OR
      (grantee_type='org_group' AND grantee_id=?)
    )`
  ).all(
    board.id,
    String(user.id), String(user.role_id || ''), String(user.dept_code || ''),
    String(user.profit_center || ''), String(user.org_section || ''),
    String(user.org_group_name || '')
  );
  return shares.length > 0;
}

async function canManageDashboard(db, board, user) {
  if (user.role === 'admin') return true;
  if (board.user_id === user.id) return true;
  const shares = await db.prepare(
    `SELECT share_type FROM ai_report_dashboard_shares WHERE dashboard_id=? AND share_type='manage' AND (
      (grantee_type='user' AND grantee_id=?) OR
      (grantee_type='role' AND grantee_id=?) OR
      (grantee_type='department' AND grantee_id=?) OR
      (grantee_type='cost_center' AND grantee_id=?) OR
      (grantee_type='division' AND grantee_id=?) OR
      (grantee_type='org_group' AND grantee_id=?)
    )`
  ).all(
    board.id,
    String(user.id), String(user.role_id || ''), String(user.dept_code || ''),
    String(user.profit_center || ''), String(user.org_section || ''),
    String(user.org_group_name || '')
  );
  return shares.length > 0;
}

// GET /report-dashboards
router.get('/report-dashboards', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const user = req.user;
    const uid = String(user.id), rid = String(user.role_id || ''),
          dept = String(user.dept_code || ''), pc = String(user.profit_center || ''),
          div = String(user.org_section || ''), og = String(user.org_group_name || '');
    const rows = await db.prepare(`
      SELECT rd.*, u.name as creator_name,
             CASE WHEN rd.user_id = ? THEN 1
                  WHEN EXISTS (SELECT 1 FROM ai_report_dashboard_shares
                               WHERE dashboard_id=rd.id AND share_type='manage' AND (
                                 (grantee_type='user' AND grantee_id=?) OR
                                 (grantee_type='role' AND grantee_id=?) OR
                                 (grantee_type='department' AND grantee_id=?) OR
                                 (grantee_type='cost_center' AND grantee_id=?) OR
                                 (grantee_type='division' AND grantee_id=?) OR
                                 (grantee_type='org_group' AND grantee_id=?)
                               )) THEN 1
                  ELSE 0 END AS can_manage
      FROM ai_report_dashboards rd
      LEFT JOIN users u ON u.id = rd.user_id
      WHERE rd.is_active = 1
        AND (
          rd.user_id = ?
          OR rd.id IN (
            SELECT dashboard_id FROM ai_report_dashboard_shares WHERE
              (grantee_type='user' AND grantee_id=?) OR
              (grantee_type='role' AND grantee_id=?) OR
              (grantee_type='department' AND grantee_id=?) OR
              (grantee_type='cost_center' AND grantee_id=?) OR
              (grantee_type='division' AND grantee_id=?) OR
              (grantee_type='org_group' AND grantee_id=?)
          )
        )
      ORDER BY rd.category NULLS LAST, rd.sort_order, rd.name
    `).all(
      user.id, uid, rid, dept, pc, div, og,
      user.id, uid, rid, dept, pc, div, og
    );
    const isAdmin = user.role === 'admin';
    res.json(rows.map(r => ({ ...r, can_manage: isAdmin ? 1 : r.can_manage })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /report-dashboards
router.post('/report-dashboards', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const { name, name_en, name_vi, description, description_en, description_vi, category, category_en, category_vi, layout_config, sort_order, bg_color, bg_image_url, bg_opacity, global_filters_schema, bookmarks, toolbar_bg_color, toolbar_text_color, logo_url, logo_height } = req.body;
    if (!name) return res.status(400).json({ error: '名稱必填' });
    let tEn = name_en || null, tVi = name_vi || null;
    if (!tEn || !tVi) {
      try {
        const t = await translateFields({ name, description: null });
        if (!tEn) tEn = t.name_en || null;
        if (!tVi) tVi = t.name_vi || null;
      } catch {}
    }
    const r = await db.prepare(`
      INSERT INTO ai_report_dashboards (user_id, name, name_en, name_vi, description, description_en, description_vi, category, category_en, category_vi, layout_config, sort_order, bg_color, bg_image_url, bg_opacity, global_filters_schema, bookmarks, toolbar_bg_color, toolbar_text_color, logo_url, logo_height)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      req.user.id, name, tEn, tVi,
      description || null, description_en || null, description_vi || null,
      category || null, category_en || null, category_vi || null,
      layout_config ? JSON.stringify(layout_config) : null, sort_order || 0,
      bg_color || null, bg_image_url || null, bg_opacity != null ? Number(bg_opacity) : 1,
      global_filters_schema ? (typeof global_filters_schema === 'string' ? global_filters_schema : JSON.stringify(global_filters_schema)) : null,
      bookmarks ? (typeof bookmarks === 'string' ? bookmarks : JSON.stringify(bookmarks)) : null,
      toolbar_bg_color || null, toolbar_text_color || null,
      logo_url || null, logo_height != null ? Number(logo_height) : 28
    );
    const newRow = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(r.lastInsertRowid);
    res.json({ ...newRow, can_manage: 1 });  // 建立者一定有管理權
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /report-dashboards/:id
router.put('/report-dashboards/:id', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const board = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(req.params.id);
    if (!board) return res.status(404).json({ error: '儀表板不存在' });
    if (!await canManageDashboard(db, board, req.user))
      return res.status(403).json({ error: '無權限修改' });
    const { name, name_en, name_vi, description, description_en, description_vi, category, category_en, category_vi, layout_config, sort_order, auto_refresh_interval, bg_color, bg_image_url, bg_opacity, global_filters_schema, bookmarks, toolbar_bg_color, toolbar_text_color, logo_url, logo_height } = req.body;
    await db.prepare(`
      UPDATE ai_report_dashboards SET
        name=?, name_en=?, name_vi=?, description=?, description_en=?, description_vi=?,
        category=?, category_en=?, category_vi=?, layout_config=?, sort_order=?,
        auto_refresh_interval=?, bg_color=?, bg_image_url=?, bg_opacity=?,
        global_filters_schema=?, bookmarks=?, toolbar_bg_color=?, toolbar_text_color=?,
        logo_url=?, logo_height=?, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(
      name, name_en || null, name_vi || null,
      description || null, description_en || null, description_vi || null,
      category || null, category_en || null, category_vi || null,
      layout_config ? (typeof layout_config === 'string' ? layout_config : JSON.stringify(layout_config)) : null,
      sort_order || 0,
      auto_refresh_interval != null ? Number(auto_refresh_interval) : null,
      bg_color || null, bg_image_url || null, bg_opacity != null ? Number(bg_opacity) : 1,
      global_filters_schema ? (typeof global_filters_schema === 'string' ? global_filters_schema : JSON.stringify(global_filters_schema)) : null,
      bookmarks ? (typeof bookmarks === 'string' ? bookmarks : JSON.stringify(bookmarks)) : null,
      toolbar_bg_color || null, toolbar_text_color || null,
      logo_url || null, logo_height != null ? Number(logo_height) : 28,
      req.params.id
    );
    const updated = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(req.params.id);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /report-dashboards/:id
router.delete('/report-dashboards/:id', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const board = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(req.params.id);
    if (!board) return res.status(404).json({ error: '儀表板不存在' });
    if (!await canManageDashboard(db, board, req.user))
      return res.status(403).json({ error: '無權限刪除' });
    await db.prepare(`UPDATE ai_report_dashboards SET is_active=0, updated_at=SYSTIMESTAMP WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /report-dashboards/:id/translate — 重新翻譯名稱 + 說明 + 分類
router.post('/report-dashboards/:id/translate', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const board = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(req.params.id);
    if (!board) return res.status(404).json({ error: '不存在' });
    if (!await canManageDashboard(db, board, req.user))
      return res.status(403).json({ error: '無權限' });
    // Use body values if provided (user may have edited but not saved yet)
    const nameStr = req.body.name || board.name;
    const descStr = req.body.description !== undefined ? req.body.description : board.description;
    const catStr = req.body.category !== undefined ? req.body.category : board.category;
    const nameT = await translateFields({ name: nameStr, description: null });
    let descEn = null, descVi = null, catEn = null, catVi = null;
    if (descStr) {
      const descT = await translateFields({ name: descStr, description: null }).catch(() => ({}));
      descEn = descT.name_en || null; descVi = descT.name_vi || null;
    }
    if (catStr) {
      const catT = await translateFields({ name: catStr, description: null }).catch(() => ({}));
      catEn = catT.name_en || null; catVi = catT.name_vi || null;
    }
    await db.prepare(`UPDATE ai_report_dashboards SET name_en=?, name_vi=?, description_en=?, description_vi=?, category_en=?, category_vi=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(nameT.name_en, nameT.name_vi, descEn, descVi, catEn, catVi, req.params.id);
    res.json({
      name_zh: board.name, name_en: nameT.name_en, name_vi: nameT.name_vi,
      description_en: descEn, description_vi: descVi,
      category_en: catEn, category_vi: catVi,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /translate-text — 通用單一文字翻譯（不綁定任何 DB 記錄）
router.post('/translate-text', requireDashboard, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const t = await translateFields({ name: text, description: null });
    res.json({ zh: t.name_zh || text, en: t.name_en, vi: t.name_vi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /report-dashboards/:id/clone
router.post('/report-dashboards/:id/clone', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const board = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(req.params.id);
    if (!board) return res.status(404).json({ error: '儀表板不存在' });
    if (!await canAccessDashboard(db, board, req.user))
      return res.status(403).json({ error: '無存取權限' });
    const newName = (req.body.name || board.name) + ' (複製)';
    const r = await db.prepare(`
      INSERT INTO ai_report_dashboards (user_id, name, description, category, layout_config, sort_order)
      VALUES (?,?,?,?,?,?)
    `).run(req.user.id, newName, board.description, board.category, board.layout_config, 0);
    const newRow = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(r.lastInsertRowid);
    res.json(newRow);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /report-dashboards/:id/shares
router.get('/report-dashboards/:id/shares', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const board = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(req.params.id);
    if (!board || !await canManageDashboard(db, board, req.user))
      return res.status(403).json({ error: '無管理權限' });
    const shares = await db.prepare(`SELECT * FROM ai_report_dashboard_shares WHERE dashboard_id=? ORDER BY id`).all(req.params.id);
    res.json(shares);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /report-dashboards/:id/shares
router.post('/report-dashboards/:id/shares', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const board = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(req.params.id);
    if (!board || !await canManageDashboard(db, board, req.user))
      return res.status(403).json({ error: '無管理權限' });
    const { grantee_type, grantee_id, share_type } = req.body;
    if (!grantee_type || !grantee_id) return res.status(400).json({ error: '必填欄位缺少' });
    const exists = await db.prepare(
      `SELECT id FROM ai_report_dashboard_shares WHERE dashboard_id=? AND grantee_type=? AND grantee_id=?`
    ).get(req.params.id, grantee_type, String(grantee_id));
    if (exists) {
      await db.prepare(`UPDATE ai_report_dashboard_shares SET share_type=? WHERE id=?`).run(share_type || 'use', exists.id);
    } else {
      await db.prepare(`INSERT INTO ai_report_dashboard_shares (dashboard_id, grantee_type, grantee_id, share_type, granted_by) VALUES (?,?,?,?,?)`
      ).run(req.params.id, grantee_type, String(grantee_id), share_type || 'use', req.user.id);
    }
    const shares = await db.prepare(`SELECT * FROM ai_report_dashboard_shares WHERE dashboard_id=? ORDER BY id`).all(req.params.id);
    res.json(shares);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /report-dashboards/:id/shares/:shareId
router.delete('/report-dashboards/:id/shares/:shareId', requireDashboard, async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const board = await db.prepare('SELECT * FROM ai_report_dashboards WHERE id=?').get(req.params.id);
    if (!board || !await canManageDashboard(db, board, req.user))
      return res.status(403).json({ error: '無管理權限' });
    await db.prepare(`DELETE FROM ai_report_dashboard_shares WHERE id=? AND dashboard_id=?`).run(req.params.shareId, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
