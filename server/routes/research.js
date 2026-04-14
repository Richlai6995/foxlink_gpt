'use strict';
/**
 * Deep Research Routes  /api/research
 */
const express   = require('express');
const router    = express.Router();
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const { v4: uuid } = require('uuid');
const { verifyToken } = require('./auth');
const { runResearchJob, rerunSections, generatePlan, searchUserKbs, suggestKbs } = require('../services/researchService');
const { upsertTokenUsage } = require('../services/tokenService');
const { budgetGuard } = require('../middleware/budgetGuard');
const { UPLOAD_DIR } = require('../config/paths');
const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash';

router.use(verifyToken);

// Research file upload storage
const researchUpload = multer({
  dest: path.join(UPLOAD_DIR, 'tmp'),
  limits: { fileSize: 200 * 1024 * 1024 },
});

function getDb() {
  const { db } = require('../database-oracle');
  return db;
}

// ── Permission helper ──────────────────────────────────────────────────────────
async function checkPermission(db, user) {
  if (user.role === 'admin') return true;
  if (user.can_deep_research === 1) return true;
  if (user.can_deep_research === 0) return false;
  if (!user.role_id) return true;
  const role = await db.prepare('SELECT can_deep_research FROM roles WHERE id=?').get(user.role_id);
  return role ? (role.can_deep_research !== 0) : true;
}

// ── POST /api/research/upload-files  (upload attachments for research) ────────
const RESEARCH_MAX_FILES = parseInt(process.env.RESEARCH_MAX_FILES || '10', 10);
router.post('/upload-files', researchUpload.array('files', RESEARCH_MAX_FILES), async (req, res) => {
  try {
    const researchDir = path.join(UPLOAD_DIR, 'research_files');
    fs.mkdirSync(researchDir, { recursive: true });

    const saved = (req.files || []).map((f) => {
      const ext  = path.extname(f.originalname) || '';
      const dest = path.join(researchDir, `${uuid()}${ext}`);
      fs.renameSync(f.path, dest);
      return { name: f.originalname, path: dest, mime_type: f.mimetype, size: f.size };
    });
    res.json(saved);
  } catch (e) {
    console.error('[Research] upload-files error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/research/plan  (generate plan, not persisted) ───────────────────
router.post('/plan', budgetGuard, async (req, res) => {
  const db = getDb();
  try {
    const ok = await checkPermission(db, req.user);
    if (!ok) return res.status(403).json({ error: '您沒有深度研究功能的使用權限' });

    const { question, depth = 5 } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: '請輸入研究問題' });

    const kbRow = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM knowledge_bases kb
      WHERE kb.chunk_count > 0 AND (
        kb.creator_id=? OR kb.is_public=1
        OR EXISTS (SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
      )
    `).get(req.user.id, req.user.id);
    const hasKb = Number(kbRow?.cnt || 0) > 0;

    const { plan, inputTokens, outputTokens } = await generatePlan(question.trim(), depth, hasKb);

    const today = new Date().toISOString().split('T')[0];
    upsertTokenUsage(db, req.user.id, today, MODEL_FLASH, inputTokens, outputTokens).catch(() => {});

    res.json({ plan, has_kb: hasKb });
  } catch (e) {
    console.error('[Research] /plan error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/research/jobs  (confirm plan → create + start job) ──────────────
router.post('/jobs', budgetGuard, async (req, res) => {
  const db = getDb();
  try {
    const ok = await checkPermission(db, req.user);
    if (!ok) return res.status(403).json({ error: '您沒有深度研究功能的使用權限' });

    const running = await db.prepare(
      "SELECT COUNT(*) AS cnt FROM research_jobs WHERE user_id=? AND status IN ('pending','running')"
    ).get(req.user.id);
    if (Number(running?.cnt || 0) >= 3) {
      return res.status(429).json({ error: '您已有 3 個研究正在進行中，請等待完成後再新增' });
    }

    const {
      question,
      plan,
      session_id     = null,
      output_formats = 'docx',
      use_web_search = false,
      kb_config      = null,
      global_files   = [],   // [{name, path, mime_type}]
      ref_job_ids    = [],   // [jobId, ...] previous research refs
      model_key      = null, // llm_models.key — follows current chat session model
    } = req.body;

    // Resolve model_key: explicit > session's model > 'pro'
    let resolvedModelKey = model_key || 'pro';
    if (!model_key && session_id) {
      const sess = await db.prepare('SELECT model FROM chat_sessions WHERE id=?').get(session_id);
      if (sess?.model) resolvedModelKey = sess.model;
    }

    if (!plan?.sub_questions?.length) return res.status(400).json({ error: '研究計畫格式錯誤' });

    const jobId = uuid();

    await db.prepare(`
      INSERT INTO research_jobs
        (id, user_id, session_id, title, question, plan_json, status, use_web_search, output_formats,
         kb_config_json, global_files_json, ref_job_ids_json, model_key)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      req.user.id,
      session_id || null,
      (plan.title || '').slice(0, 500),
      (question || '').slice(0, 4000),
      JSON.stringify(plan),
      use_web_search ? 1 : 0,
      output_formats,
      kb_config    ? JSON.stringify(kb_config)  : null,
      global_files.length ? JSON.stringify(global_files) : null,
      ref_job_ids.length  ? JSON.stringify(ref_job_ids)  : null,
      resolvedModelKey,
    );

    if (session_id) {
      await db.prepare(
        `INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`
      ).run(session_id, `__RESEARCH_JOB__:${jobId}`);
    }

    setImmediate(() => {
      runResearchJob(db, jobId).catch((e) =>
        console.error('[Research] setImmediate runResearchJob error:', e.message)
      );
    });

    res.status(201).json({ id: jobId, status: 'pending' });
  } catch (e) {
    console.error('[Research] POST /jobs error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/research/accessible-resources  (KBs/Dify/MCP + completed jobs) ──
router.get('/accessible-resources', async (req, res) => {
  const db = getDb();
  try {
    const ok = await checkPermission(db, req.user);
    if (!ok) return res.status(403).json({ error: '無權限' });

    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const uRow = isAdmin ? null : await db.prepare(
      `SELECT role_id, dept_code, profit_center, org_section, org_group_name FROM users WHERE id=?`
    ).get(userId);
    const roleId = uRow?.role_id ? Number(uRow.role_id) : null;

    // Self-built KBs
    let selfKbs;
    if (isAdmin) {
      selfKbs = await db.prepare(
        `SELECT id, name, name_zh, name_en, name_vi, chunk_count FROM knowledge_bases WHERE chunk_count > 0 ORDER BY name`
      ).all();
    } else {
      selfKbs = await db.prepare(`
        SELECT kb.id, kb.name, kb.name_zh, kb.name_en, kb.name_vi, kb.chunk_count
        FROM knowledge_bases kb
        WHERE kb.chunk_count > 0 AND (
          kb.creator_id=?
          OR kb.is_public=1
          OR EXISTS (
            SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
              (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
              OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
            )
          )
        )
        ORDER BY kb.name
      `).all(userId, userId, roleId);
    }

    // Dify KBs — 改走 dify_access
    let difyKbs;
    if (isAdmin) {
      difyKbs = await db.prepare(
        `SELECT id, name, name_zh, name_en, name_vi FROM dify_knowledge_bases WHERE is_active=1 ORDER BY sort_order, name`
      ).all();
    } else {
      difyKbs = await db.prepare(`
        SELECT DISTINCT d.id, d.name, d.name_zh, d.name_en, d.name_vi
        FROM dify_knowledge_bases d
        JOIN dify_access a ON a.dify_kb_id=d.id
        WHERE d.is_active=1 AND (
          (a.grantee_type='user'        AND a.grantee_id=TO_CHAR(?))
          OR (a.grantee_type='role'     AND a.grantee_id=TO_CHAR(?) AND ? IS NOT NULL)
          OR (a.grantee_type='department'  AND a.grantee_id=? AND ? IS NOT NULL)
          OR (a.grantee_type='cost_center' AND a.grantee_id=? AND ? IS NOT NULL)
          OR (a.grantee_type='division'    AND a.grantee_id=? AND ? IS NOT NULL)
          OR (a.grantee_type='org_group'   AND a.grantee_id=? AND ? IS NOT NULL)
        )
        ORDER BY d.sort_order, d.name
      `).all(
        userId,
        roleId, roleId,
        uRow?.dept_code, uRow?.dept_code,
        uRow?.profit_center, uRow?.profit_center,
        uRow?.org_section, uRow?.org_section,
        uRow?.org_group_name, uRow?.org_group_name
      );
    }

    // MCP servers — 改走 mcp_access
    let mcpServers;
    if (isAdmin) {
      mcpServers = await db.prepare(
        `SELECT id, name, name_zh, name_en, name_vi, tools_json FROM mcp_servers WHERE is_active=1 ORDER BY name`
      ).all();
    } else {
      mcpServers = await db.prepare(`
        SELECT DISTINCT m.id, m.name, m.name_zh, m.name_en, m.name_vi, m.tools_json
        FROM mcp_servers m
        JOIN mcp_access a ON a.mcp_server_id=m.id
        WHERE m.is_active=1 AND (
          (a.grantee_type='user'        AND a.grantee_id=TO_CHAR(?))
          OR (a.grantee_type='role'     AND a.grantee_id=TO_CHAR(?) AND ? IS NOT NULL)
          OR (a.grantee_type='department'  AND a.grantee_id=? AND ? IS NOT NULL)
          OR (a.grantee_type='cost_center' AND a.grantee_id=? AND ? IS NOT NULL)
          OR (a.grantee_type='division'    AND a.grantee_id=? AND ? IS NOT NULL)
          OR (a.grantee_type='org_group'   AND a.grantee_id=? AND ? IS NOT NULL)
        )
        ORDER BY m.name
      `).all(
        userId,
        roleId, roleId,
        uRow?.dept_code, uRow?.dept_code,
        uRow?.profit_center, uRow?.profit_center,
        uRow?.org_section, uRow?.org_section,
        uRow?.org_group_name, uRow?.org_group_name
      );
    }

    // Completed research jobs (for "previous research as context")
    const prevJobs = await db.prepare(`
      SELECT id, title,
             TO_CHAR(completed_at,'YYYY-MM-DD HH24:MI') AS completed_at
      FROM research_jobs
      WHERE user_id=? AND status='done'
      ORDER BY completed_at DESC
      FETCH FIRST 20 ROWS ONLY
    `).all(userId);

    // AI 戰情 designs（僅 can_use_ai_dashboard 或 admin）
    // 使用 effective_can_use_ai_dashboard（已含 role 及 admin 判斷）
    let dashboardDesigns = [];
    const canUseDashboard = req.user.effective_can_use_ai_dashboard || isAdmin;
    if (canUseDashboard) {
      try {
        if (isAdmin) {
          dashboardDesigns = await db.prepare(`
            SELECT d.id, d.name, d.description, t.name AS topic_name
            FROM ai_select_designs d
            JOIN ai_select_topics t ON t.id = d.topic_id
            ORDER BY t.sort_order, t.name, d.name
          `).all();
        } else {
          dashboardDesigns = await db.prepare(`
            SELECT d.id, d.name, d.description, t.name AS topic_name
            FROM ai_select_designs d
            JOIN ai_select_topics t ON t.id = d.topic_id
            WHERE (d.created_by = ? OR d.is_public = 1
                OR EXISTS (
                  SELECT 1 FROM ai_dashboard_shares s
                  WHERE s.design_id = d.id
                    AND ((s.grantee_type = 'user' AND s.grantee_id = TO_CHAR(?))
                      OR (s.grantee_type = 'role' AND s.grantee_id = TO_CHAR(?)))
                ))
            ORDER BY t.sort_order, t.name, d.name
          `).all(userId, userId, roleId || 0);
        }
      } catch (e) { console.error('[Research] accessible-resources dashboard_designs error:', e.message); }
    }

    res.json({
      self_kbs: selfKbs.map((k) => ({ id: k.id, name: k.name, name_zh: k.name_zh, name_en: k.name_en, name_vi: k.name_vi, chunk_count: k.chunk_count })),
      dify_kbs: difyKbs.map((k) => ({ id: k.id, name: k.name, name_zh: k.name_zh, name_en: k.name_en, name_vi: k.name_vi })),
      mcp_servers: mcpServers.map((m) => ({
        id: m.id, name: m.name,
        name_zh: m.name_zh, name_en: m.name_en, name_vi: m.name_vi,
        tools_count: JSON.parse(m.tools_json || '[]').length,
      })),
      prev_jobs: prevJobs.map((j) => ({ id: j.id, title: j.title, completed_at: j.completed_at })),
      dashboard_designs: dashboardDesigns.map((d) => ({ id: d.id, name: d.name, description: d.description, topic_name: d.topic_name })),
      can_use_dashboard: canUseDashboard,
    });
  } catch (e) {
    console.error('[Research] /accessible-resources error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/research/suggest-kbs  (auto-suggest relevant KBs) ────────────────
router.get('/suggest-kbs', async (req, res) => {
  const db = getDb();
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.json({ kb_ids: [] });
    const ok = await checkPermission(db, req.user);
    if (!ok) return res.json({ kb_ids: [] });
    const suggested = await suggestKbs(db, req.user.id, q.trim());
    res.json({ kb_ids: suggested });
  } catch (e) {
    res.json({ kb_ids: [] });
  }
});

// ── GET /api/research/jobs  (list current user's jobs) ────────────────────────
router.get('/jobs', async (req, res) => {
  const db = getDb();
  try {
    const jobs = await db.prepare(`
      SELECT id, title, status, progress_step, progress_total, progress_label,
             use_web_search, output_formats, error_msg, is_notified,
             result_files_json,
             TO_CHAR(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
             TO_CHAR(completed_at,'YYYY-MM-DD HH24:MI:SS') AS completed_at
      FROM research_jobs
      WHERE user_id=?
      ORDER BY created_at DESC
      FETCH FIRST 50 ROWS ONLY
    `).all(req.user.id);
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/research/jobs/unnotified  ────────────────────────────────────────
router.get('/jobs/unnotified', async (req, res) => {
  const db = getDb();
  try {
    const jobs = await db.prepare(`
      SELECT id, title, status, result_files_json,
             TO_CHAR(completed_at,'YYYY-MM-DD HH24:MI:SS') AS completed_at
      FROM research_jobs
      WHERE user_id=? AND status='done' AND is_notified=0
    `).all(req.user.id);

    if (jobs.length > 0) {
      await db.prepare(
        `UPDATE research_jobs SET is_notified=1, updated_at=SYSTIMESTAMP
         WHERE user_id=? AND status='done' AND is_notified=0`
      ).run(req.user.id);
    }
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/research/jobs/:id  (single job detail + streaming sections) ──────
router.get('/jobs/:id', async (req, res) => {
  const db = getDb();
  try {
    const job = await db.prepare(`
      SELECT id, title, question, plan_json, status,
             progress_step, progress_total, progress_label,
             use_web_search, output_formats,
             result_summary, result_files_json, error_msg, is_notified,
             sections_json,
             TO_CHAR(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
             TO_CHAR(completed_at,'YYYY-MM-DD HH24:MI:SS') AS completed_at
      FROM research_jobs WHERE id=? AND user_id=?
    `).get(req.params.id, req.user.id);
    if (!job) return res.status(404).json({ error: '找不到研究任務' });
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/research/jobs/:id/rerun-sections ────────────────────────────────
// Body: { section_ids: [1,3,...], sq_overrides: [{id,question,hint,files,use_web_search}] }
router.post('/jobs/:id/rerun-sections', budgetGuard, async (req, res) => {
  const db = getDb();
  try {
    const job = await db.prepare(
      "SELECT id, status, user_id FROM research_jobs WHERE id=?"
    ).get(req.params.id);
    if (!job) return res.status(404).json({ error: '找不到研究任務' });
    if (job.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: '無權限' });
    if (job.status === 'running' || job.status === 'pending')
      return res.status(409).json({ error: '研究仍在進行中，無法重跑' });

    const { section_ids = [], sq_overrides = [], kb_config, global_files, title, objective } = req.body;
    if (!section_ids.length) return res.status(400).json({ error: '請選擇至少一個子問題' });

    // 若有傳入欄位，更新 job 記錄
    const updates = [];
    const params  = [];
    if (kb_config !== undefined)    { updates.push('kb_config_json=?');    params.push(kb_config ? JSON.stringify(kb_config) : null); }
    if (global_files !== undefined) { updates.push('global_files_json=?'); params.push(global_files?.length ? JSON.stringify(global_files) : null); }
    if (title !== undefined)        { updates.push('title=?');             params.push(title); }
    if (updates.length) {
      await db.prepare(`UPDATE research_jobs SET ${updates.join(',')} WHERE id=?`).run(...params, req.params.id);
    }
    // objective 存在 plan_json 裡，需單獨更新
    if (objective !== undefined) {
      const job2 = await db.prepare('SELECT plan_json FROM research_jobs WHERE id=?').get(req.params.id);
      if (job2?.plan_json) {
        const plan = JSON.parse(job2.plan_json);
        plan.objective = objective;
        await db.prepare('UPDATE research_jobs SET plan_json=? WHERE id=?').run(JSON.stringify(plan), req.params.id);
      }
    }

    // Respond immediately, run async
    res.json({ ok: true, job_id: req.params.id });

    setImmediate(() => rerunSections(db, req.params.id, section_ids, sq_overrides));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/research/jobs/:id ─────────────────────────────────────────────
router.delete('/jobs/:id', async (req, res) => {
  const db = getDb();
  try {
    const job = await db.prepare(
      'SELECT id, status, user_id FROM research_jobs WHERE id=?'
    ).get(req.params.id);
    if (!job) return res.status(404).json({ error: '找不到研究任務' });
    if (job.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: '無權限' });

    await db.prepare('DELETE FROM research_jobs WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/research/admin/jobs  (admin only) ─────────────────────────────────
router.get('/admin/jobs', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  const db = getDb();
  try {
    const { user_id, status, search, limit = 100, offset = 0 } = req.query;
    const conds = [];
    const params = [];
    if (user_id) { conds.push('rj.user_id=?'); params.push(Number(user_id)); }
    if (status)  { conds.push('rj.status=?');  params.push(status); }
    if (search)  { conds.push('(UPPER(rj.title) LIKE UPPER(?) OR UPPER(DBMS_LOB.SUBSTR(rj.question,2000,1)) LIKE UPPER(?))'); params.push(`%${search}%`, `%${search}%`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const jobs = await db.prepare(`
      SELECT rj.id, rj.title, rj.question, rj.status,
             rj.progress_step, rj.progress_total, rj.progress_label,
             rj.output_formats, rj.use_web_search,
             rj.error_msg, rj.result_files_json,
             TO_CHAR(rj.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
             TO_CHAR(rj.completed_at,'YYYY-MM-DD HH24:MI:SS') AS completed_at,
             u.id AS user_id, u.username, u.name AS user_name, u.employee_id
      FROM research_jobs rj
      LEFT JOIN users u ON u.id = rj.user_id
      ${where}
      ORDER BY rj.created_at DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `).all(...params, Number(offset), Number(limit));
    const total = await db.prepare(`SELECT COUNT(*) AS cnt FROM research_jobs rj ${where}`).get(...params);
    res.json({ jobs, total: Number(total?.cnt || 0) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Templates CRUD ────────────────────────────────────────────────────────────

// GET /api/research/templates  — list user's saved templates
router.get('/templates', async (req, res) => {
  const db = getDb();
  try {
    const ok = await checkPermission(db, req.user);
    if (!ok) return res.status(403).json({ error: '無權限' });
    const rows = await db.prepare(`
      SELECT id, title, question, plan_json, kb_config_json, global_files_json,
             output_formats, model_key,
             TO_CHAR(created_at,'YYYY-MM-DD HH24:MI') AS created_at,
             TO_CHAR(updated_at,'YYYY-MM-DD HH24:MI') AS updated_at
      FROM research_templates
      WHERE user_id=?
      ORDER BY updated_at DESC
    `).all(req.user.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/research/templates  — save new template
router.post('/templates', async (req, res) => {
  const db = getDb();
  try {
    const ok = await checkPermission(db, req.user);
    if (!ok) return res.status(403).json({ error: '無權限' });
    const { title, question, plan_json, kb_config_json, global_files_json, output_formats, model_key } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: '標題為必填' });
    const r = await db.prepare(`
      INSERT INTO research_templates (user_id, title, question, plan_json, kb_config_json, global_files_json, output_formats, model_key)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(req.user.id, title.trim(),
      question || null,
      plan_json ? JSON.stringify(plan_json) : null,
      kb_config_json ? JSON.stringify(kb_config_json) : null,
      global_files_json ? JSON.stringify(global_files_json) : null,
      output_formats || 'docx',
      model_key || null);
    const newRow = await db.prepare('SELECT id FROM research_templates WHERE ROWID=(SELECT MAX(ROWID) FROM research_templates WHERE user_id=?)').get(req.user.id);
    res.json({ ok: true, id: newRow?.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/research/templates/:id  — update template
router.put('/templates/:id', async (req, res) => {
  const db = getDb();
  try {
    const tmpl = await db.prepare('SELECT id, user_id FROM research_templates WHERE id=?').get(req.params.id);
    if (!tmpl) return res.status(404).json({ error: '找不到模板' });
    if (tmpl.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
    const { title, question, plan_json, kb_config_json, global_files_json, output_formats, model_key } = req.body;
    await db.prepare(`
      UPDATE research_templates SET
        title=?, question=?, plan_json=?, kb_config_json=?, global_files_json=?,
        output_formats=?, model_key=?, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(title?.trim() || tmpl.title,
      question || null,
      plan_json ? JSON.stringify(plan_json) : null,
      kb_config_json ? JSON.stringify(kb_config_json) : null,
      global_files_json ? JSON.stringify(global_files_json) : null,
      output_formats || 'docx',
      model_key || null,
      req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/research/templates/:id
router.delete('/templates/:id', async (req, res) => {
  const db = getDb();
  try {
    const tmpl = await db.prepare('SELECT id, user_id FROM research_templates WHERE id=?').get(req.params.id);
    if (!tmpl) return res.status(404).json({ error: '找不到模板' });
    if (tmpl.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
    await db.prepare('DELETE FROM research_templates WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
