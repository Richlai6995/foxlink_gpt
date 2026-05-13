/**
 * /api/projects/projects/:projectId/members — Members invite / remove / search
 *
 * Sprint E.2 後續:中途拉新成員
 *
 *   GET   /search?q=         搜 user(限本平台用,PM 都能搜)
 *   GET   /                  列當前成員(同 projects.get 但獨立)
 *   POST  /                  邀請成員(PM/admin only)
 *     body: { user_id, role, sub_role?, invited_by_pm_user_id? }
 *   DELETE /:memberId        踢人(PM/admin only,creator/pm 不能被踢)
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const { loadProject, requirePmOrAdmin } = require('../middleware/projectAclMiddleware');

const router = express.Router({ mergeParams: true });

router.use(loadProject());

function getDb() {
  return require('../../database-oracle').db;
}

// ─── GET /search?q= ─────────────────────────────────────────────────
// LOV 模式:不帶 q → 回前 30 個 active user;帶 q → 模糊搜尋
router.get('/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const db = getDb();

  let rows;
  if (q.length < 1) {
    // LOV 預設清單(熱門 / 最新登入 30 人)
    rows = await db.prepare(
      `SELECT id, username, name, employee_id, email, dept_name
         FROM users
        WHERE status = 'active'
        ORDER BY id DESC
        FETCH FIRST 30 ROWS ONLY`,
    ).all();
  } else {
    rows = await db.prepare(
      `SELECT id, username, name, employee_id, email, dept_name
         FROM users
        WHERE status = 'active'
          AND (UPPER(username) LIKE UPPER(?)
               OR UPPER(name) LIKE UPPER(?)
               OR employee_id LIKE ?)
        ORDER BY username
        FETCH FIRST 30 ROWS ONLY`,
    ).all(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  // 排除已是成員的 user
  const existing = await db.prepare(
    `SELECT user_id FROM project_members WHERE project_id = ?`,
  ).all(req.project.id);
  const inSet = new Set(existing.map((r) => Number(r.user_id)));

  res.json({
    users: rows.map((u) => ({
      id: Number(u.id),
      username: u.username,
      name: u.name,
      employee_id: u.employee_id,
      email: u.email,
      dept_name: u.dept_name,
      already_member: inSet.has(Number(u.id)),
    })),
  });
}));

// ─── GET / list members ─────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const db = getDb();
  const members = await db.prepare(
    `SELECT pm.id, pm.user_id, pm.role, pm.sub_role,
            pm.invited_by, pm.invited_by_pm_user_id, pm.invited_at,
            u.username, u.name, u.email, u.dept_name
       FROM project_members pm
       LEFT JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY pm.invited_at`,
  ).all(req.project.id);
  res.json({ members });
}));

// ─── POST / invite ──────────────────────────────────────────────────
router.post('/', requirePmOrAdmin, asyncHandler(async (req, res) => {
  const db = getDb();
  const { user_id, role, sub_role, invited_by_pm_user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!role)    return res.status(400).json({ error: 'role required' });

  // user 必須存在 + active
  const u = await db.prepare(
    `SELECT id FROM users WHERE id = ? AND status = 'active'`,
  ).get(Number(user_id));
  if (!u) return res.status(404).json({ error: 'user not found or inactive' });

  try {
    await db.prepare(
      `INSERT INTO project_members
         (project_id, user_id, role, sub_role, invited_by, invited_by_pm_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      req.project.id,
      Number(user_id),
      role,
      sub_role || null,
      req.user.id,
      invited_by_pm_user_id ? Number(invited_by_pm_user_id) : null,
    );

    // ⭐ 邀請完自動進 announcement + general channel(讓邀請者馬上看到對話)
    // chat_guest / outsider 不自動進(對齊 demo §10)
    if (role !== 'chat_guest' && role !== 'outsider') {
      const channels = await db.prepare(
        `SELECT id, channel_type FROM project_channels
          WHERE project_id = ? AND channel_type IN ('announcement', 'general') AND is_archived = 0`,
      ).all(req.project.id);
      for (const c of channels) {
        try {
          await db.prepare(
            `INSERT INTO channel_participants (channel_id, user_id, role) VALUES (?, ?, 'member')`,
          ).run(Number(c.id), Number(user_id));
        } catch (e) {
          if (!/UNIQUE constraint failed/.test(e.message)) {
            console.warn(`[members/invite] auto-join ${c.channel_type}:`, e.message);
          }
        }
      }
    }

    res.status(201).json({ ok: true });
  } catch (e) {
    if (/UNIQUE constraint failed/.test(e.message)) {
      return res.status(409).json({ error: 'user already a member' });
    }
    throw e;
  }
}));

// ─── DELETE /:memberId remove ───────────────────────────────────────
router.delete('/:memberId', requirePmOrAdmin, asyncHandler(async (req, res) => {
  const db = getDb();
  const memberId = Number(req.params.memberId);

  const m = await db.prepare(
    `SELECT user_id, role FROM project_members WHERE id = ? AND project_id = ?`,
  ).get(memberId, req.project.id);
  if (!m) return res.status(404).json({ error: 'member not found' });

  // 不可踢 creator / pm(避免無 owner 孤兒)
  if (Number(m.user_id) === Number(req.project.pm_user_id)) {
    return res.status(400).json({ error: 'cannot remove project PM(請先轉移 PM 才能踢)' });
  }
  if (Number(m.user_id) === Number(req.project.created_by_user_id)) {
    return res.status(400).json({ error: 'cannot remove project creator' });
  }

  await db.prepare(`DELETE FROM project_members WHERE id = ?`).run(memberId);
  res.json({ ok: true });
}));

module.exports = router;
