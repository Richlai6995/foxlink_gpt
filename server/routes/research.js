'use strict';
/**
 * Deep Research Routes  /api/research
 */
const express   = require('express');
const router    = express.Router();
const { v4: uuid } = require('uuid');
const { verifyToken } = require('./auth');
const { runResearchJob, generatePlan, searchUserKbs } = require('../services/researchService');
const { upsertTokenUsage } = require('../services/tokenService');
const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash';

router.use(verifyToken);

function getDb() {
  const { db } = require('../database-oracle');
  return db;
}

// ── Permission helper ──────────────────────────────────────────────────────────
async function checkPermission(db, user) {
  if (user.role === 'admin') return true;
  // user-level override
  if (user.can_deep_research === 1) return true;
  if (user.can_deep_research === 0) return false;
  // fall back to role setting (default 1 = allowed)
  if (!user.role_id) return true;
  const role = await db.prepare('SELECT can_deep_research FROM roles WHERE id=?').get(user.role_id);
  return role ? (role.can_deep_research !== 0) : true;
}

// ── POST /api/research/plan  (generate plan, not persisted) ───────────────────
router.post('/plan', async (req, res) => {
  const db = getDb();
  try {
    const ok = await checkPermission(db, req.user);
    if (!ok) return res.status(403).json({ error: '您沒有深度研究功能的使用權限' });

    const { question, depth = 5 } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: '請輸入研究問題' });

    // Check if user has accessible KBs with content
    const kbRow = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM knowledge_bases kb
      WHERE kb.chunk_count > 0 AND (
        kb.creator_id=? OR kb.is_public=1
        OR EXISTS (SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
      )
    `).get(req.user.id, req.user.id);
    const hasKb = Number(kbRow?.cnt || 0) > 0;

    const { plan, inputTokens, outputTokens } = await generatePlan(question.trim(), depth, hasKb);

    // Record plan-generation tokens (fire-and-forget)
    const today = new Date().toISOString().split('T')[0];
    upsertTokenUsage(db, req.user.id, today, MODEL_FLASH, inputTokens, outputTokens).catch(() => {});

    res.json({ plan, has_kb: hasKb });
  } catch (e) {
    console.error('[Research] /plan error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/research/jobs  (confirm plan → create + start job) ──────────────
router.post('/jobs', async (req, res) => {
  const db = getDb();
  try {
    const ok = await checkPermission(db, req.user);
    if (!ok) return res.status(403).json({ error: '您沒有深度研究功能的使用權限' });

    // Check concurrent job limit (max 3 running per user)
    const running = await db.prepare(
      "SELECT COUNT(*) AS cnt FROM research_jobs WHERE user_id=? AND status IN ('pending','running')"
    ).get(req.user.id);
    if (Number(running?.cnt || 0) >= 3) {
      return res.status(429).json({ error: '您已有 3 個研究正在進行中，請等待完成後再新增' });
    }

    const {
      question,
      plan,
      session_id   = null,
      output_formats = 'docx',
      use_web_search = false,
    } = req.body;

    if (!plan?.sub_questions?.length) return res.status(400).json({ error: '研究計畫格式錯誤' });

    const jobId = uuid();

    await db.prepare(`
      INSERT INTO research_jobs
        (id, user_id, session_id, title, question, plan_json, status, use_web_search, output_formats)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      jobId,
      req.user.id,
      session_id || null,
      (plan.title || '').slice(0, 500),
      (question || '').slice(0, 4000),
      JSON.stringify(plan),
      use_web_search ? 1 : 0,
      output_formats,
    );

    // Insert placeholder chat message so research shows inline in history
    if (session_id) {
      await db.prepare(
        `INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`
      ).run(session_id, `__RESEARCH_JOB__:${jobId}`);
    }

    // Start background execution
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

// ── GET /api/research/jobs/unnotified  (jobs done but not yet notified) ────────
router.get('/jobs/unnotified', async (req, res) => {
  const db = getDb();
  try {
    const jobs = await db.prepare(`
      SELECT id, title, status, result_files_json,
             TO_CHAR(completed_at,'YYYY-MM-DD HH24:MI:SS') AS completed_at
      FROM research_jobs
      WHERE user_id=? AND status='done' AND is_notified=0
    `).all(req.user.id);

    // Mark as notified
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

// ── GET /api/research/jobs/:id  (single job detail) ───────────────────────────
router.get('/jobs/:id', async (req, res) => {
  const db = getDb();
  try {
    const job = await db.prepare(`
      SELECT id, title, question, plan_json, status,
             progress_step, progress_total, progress_label,
             use_web_search, output_formats,
             result_summary, result_files_json, error_msg, is_notified,
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

// ── DELETE /api/research/jobs/:id  (cancel / delete) ─────────────────────────
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

// ── GET /api/research/admin/jobs  (admin only — all users' jobs) ───────────────
router.get('/admin/jobs', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  const db = getDb();
  try {
    const { user_id, status, search, limit = 100, offset = 0 } = req.query;
    const conds = [];
    const params = [];
    if (user_id) { conds.push('rj.user_id=?'); params.push(Number(user_id)); }
    if (status)  { conds.push('rj.status=?');  params.push(status); }
    if (search)  { conds.push('(UPPER(rj.title) LIKE UPPER(?) OR UPPER(rj.question) LIKE UPPER(?))'); params.push(`%${search}%`, `%${search}%`); }
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

module.exports = router;
