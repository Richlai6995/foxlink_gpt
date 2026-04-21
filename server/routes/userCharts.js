/**
 * userCharts — Phase 5:使用者自建圖庫 + 分享 API
 *
 * 設計原則(對齊 ai_dashboard_shares + canAccessDesign):
 *   - Template Share:分享 spec + tool ref + params,絕不分享資料
 *   - 7 維 grantee_type:user/role/factory/department/cost_center/division/org_group
 *   - share_type:'use' | 'manage'(不發明 view/edit)
 *   - canAccessUserChart:admin > owner > public+approved > shares 表
 *   - freeform chart(source_tool=NULL):不可分享
 *
 * 路由:
 *   GET    /api/user-charts                   — 列我的 + 別人分享給我的(可 ?scope=mine|shared|all)
 *   POST   /api/user-charts                   — 建立(從 chat inline chart pin)
 *   GET    /api/user-charts/:id               — 取單張(含權限檢查)
 *   PUT    /api/user-charts/:id               — 編輯(僅 owner / admin / manage 權限)
 *   DELETE /api/user-charts/:id               — 刪除(僅 owner / admin)
 *   POST   /api/user-charts/:id/execute       — 重跑 source tool 取資料(被分享者用自己權限)
 *   GET    /api/user-charts/:id/shares        — 列分享
 *   POST   /api/user-charts/:id/shares        — 加分享(對齊 ShareModal.tsx 格式)
 *   DELETE /api/user-charts/:id/shares/:shareId
 *   GET    /api/user-charts/admin/popular     — admin:熱門分享圖(use_count desc)供採納
 *   POST   /api/user-charts/admin/:id/adopt   — admin:採納為戰情室 official(預留 stub)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');
const { runSourceTool, computeSchemaHash, parseSourceTool } = require('../services/chartExecutor');

router.use(verifyToken);

// ── 權限檢查 — 邏輯照抄 dashboard.js canAccessDesign ───────────────────────────
async function canAccessUserChart(db, chart, user, shareType = 'any') {
  if (!chart) return false;
  if (user.role === 'admin') return true;
  if (chart.owner_id === user.id) return true;
  if (chart.is_public === 1 && chart.public_approved === 1 && shareType !== 'manage') return true;
  const shares = await db.prepare(
    `SELECT share_type FROM user_chart_shares WHERE chart_id=? AND (
       (grantee_type='user'        AND grantee_id=?) OR
       (grantee_type='role'        AND grantee_id=?) OR
       (grantee_type='department'  AND grantee_id=?) OR
       (grantee_type='cost_center' AND grantee_id=?) OR
       (grantee_type='division'    AND grantee_id=?) OR
       (grantee_type='factory'     AND grantee_id=?) OR
       (grantee_type='org_group'   AND grantee_id=?)
     )`
  ).all(
    chart.id,
    String(user.id), String(user.role_id || ''), String(user.dept_code || ''),
    String(user.profit_center || ''), String(user.org_section || ''),
    String(user.factory_code || ''), String(user.org_group_name || '')
  );
  if (shares.length === 0) return false;
  if (shareType === 'any') return true;
  if (shareType === 'manage') return shares.some(s => s.share_type === 'manage');
  return true; // 'use'
}

// 簡化版 owner-only check(編輯 / 刪除 / 改 spec)
async function canManageUserChart(db, chart, user) {
  if (user.role === 'admin') return true;
  if (chart && chart.owner_id === user.id) return true;
  return await canAccessUserChart(db, chart, user, 'manage');
}

// 把 chart row 的 CLOB JSON 欄位 parse 給 client
function hydrateChart(chart) {
  if (!chart) return chart;
  const out = { ...chart };
  for (const k of ['chart_spec', 'source_params']) {
    if (out[k] && typeof out[k] === 'string') {
      try { out[k] = JSON.parse(out[k]); } catch (_) {}
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const scope = req.query.scope || 'all'; // 'mine' | 'shared' | 'all'
    const u = req.user;

    // 我的
    let mine = [];
    if (scope === 'mine' || scope === 'all') {
      mine = await db.prepare(
        `SELECT id, owner_id, title, description, source_type, source_tool,
                source_schema_hash, is_public, use_count, created_at, updated_at,
                NULL AS share_via
         FROM user_charts WHERE owner_id=? ORDER BY updated_at DESC`
      ).all(u.id);
    }

    // 別人分享給我的
    let shared = [];
    if (scope === 'shared' || scope === 'all') {
      shared = await db.prepare(
        `SELECT DISTINCT c.id, c.owner_id, c.title, c.description, c.source_type, c.source_tool,
                c.source_schema_hash, c.is_public, c.use_count, c.created_at, c.updated_at,
                s.share_type AS share_via,
                (SELECT employee_id || ' ' || name FROM users WHERE id=c.owner_id) AS owner_name
         FROM user_charts c
         JOIN user_chart_shares s ON s.chart_id=c.id
         WHERE c.owner_id<>? AND (
           (s.grantee_type='user'        AND s.grantee_id=?) OR
           (s.grantee_type='role'        AND s.grantee_id=?) OR
           (s.grantee_type='department'  AND s.grantee_id=?) OR
           (s.grantee_type='cost_center' AND s.grantee_id=?) OR
           (s.grantee_type='division'    AND s.grantee_id=?) OR
           (s.grantee_type='factory'     AND s.grantee_id=?) OR
           (s.grantee_type='org_group'   AND s.grantee_id=?)
         )
         ORDER BY c.updated_at DESC`
      ).all(
        u.id,
        String(u.id), String(u.role_id || ''), String(u.dept_code || ''),
        String(u.profit_center || ''), String(u.org_section || ''),
        String(u.factory_code || ''), String(u.org_group_name || '')
      );
    }

    res.json({ mine, shared });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE — 從 chat inline chart pin 進來
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const {
      title, description, chart_spec,
      source_type, source_tool, source_tool_version,
      source_schema_hash, source_prompt, source_params,
      source_session_id, source_message_id,
    } = req.body;

    if (!title || !chart_spec) return res.status(400).json({ error: '缺 title 或 chart_spec' });
    if (typeof chart_spec === 'object' && (!chart_spec.type || !chart_spec.x_field)) {
      return res.status(400).json({ error: 'chart_spec 結構不完整' });
    }

    const specStr = typeof chart_spec === 'string' ? chart_spec : JSON.stringify(chart_spec);
    const paramsStr = source_params == null ? null : (typeof source_params === 'string' ? source_params : JSON.stringify(source_params));

    const r = await db.prepare(
      `INSERT INTO user_charts (
         owner_id, title, description, chart_spec,
         source_type, source_tool, source_tool_version, source_schema_hash,
         source_prompt, source_params, source_session_id, source_message_id
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      req.user.id, title, description || null, specStr,
      source_type || null, source_tool || null, source_tool_version || null, source_schema_hash || null,
      source_prompt || null, paramsStr, source_session_id || null, source_message_id || null
    );
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET single
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const chart = await db.prepare(`SELECT * FROM user_charts WHERE id=?`).get(req.params.id);
    if (!chart) return res.status(404).json({ error: '圖表不存在' });
    if (!(await canAccessUserChart(db, chart, req.user))) return res.status(403).json({ error: '無權限存取' });
    res.json(hydrateChart(chart));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — owner/admin/manage 權限
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const chart = await db.prepare(`SELECT * FROM user_charts WHERE id=?`).get(req.params.id);
    if (!chart) return res.status(404).json({ error: '圖表不存在' });
    if (!(await canManageUserChart(db, chart, req.user))) return res.status(403).json({ error: '無編輯權限' });

    const fields = [];
    const args = [];
    const allow = ['title', 'description', 'chart_spec', 'source_params', 'source_prompt', 'source_schema_hash'];
    for (const k of allow) {
      if (req.body[k] !== undefined) {
        let v = req.body[k];
        if ((k === 'chart_spec' || k === 'source_params') && typeof v === 'object') v = JSON.stringify(v);
        fields.push(`${k}=?`);
        args.push(v);
      }
    }
    if (fields.length === 0) return res.json({ ok: true });
    fields.push('updated_at=SYSTIMESTAMP');
    args.push(req.params.id);
    await db.prepare(`UPDATE user_charts SET ${fields.join(',')} WHERE id=?`).run(...args);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — owner/admin only
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const chart = await db.prepare(`SELECT * FROM user_charts WHERE id=?`).get(req.params.id);
    if (!chart) return res.status(404).json({ error: '圖表不存在' });
    if (req.user.role !== 'admin' && chart.owner_id !== req.user.id) {
      return res.status(403).json({ error: '只有圖表擁有者可以刪除' });
    }
    await db.prepare(`DELETE FROM user_charts WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTE — 重跑 source tool 取資料(被分享者用自己權限)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/execute', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const chart = await db.prepare(`SELECT * FROM user_charts WHERE id=?`).get(req.params.id);
    if (!chart) return res.status(404).json({ error: '圖表不存在' });
    if (!(await canAccessUserChart(db, chart, req.user))) return res.status(403).json({ error: '無使用權限' });

    if (!chart.source_tool) {
      return res.status(400).json({ error: '此圖表為 freeform chart,無可重跑的 tool 來源' });
    }

    const userInputs = req.body?.params || {};
    const result = await runSourceTool(db, chart, userInputs, req.user, {
      sessionId: req.body?.session_id || null,
    });

    if (result.error) return res.status(400).json({ error: result.error, warnings: result.warnings });

    // bump use_count + 更新 schema hash(若有變動)
    try {
      await db.prepare(`UPDATE user_charts SET use_count=NVL(use_count,0)+1 WHERE id=?`).run(chart.id);
      if (result.schemaHash && result.schemaHash !== chart.source_schema_hash) {
        // 不主動覆蓋,只 warn(避免靜默 hide breaking change)
      }
    } catch (_) {}

    // 把存的 chart_spec 套上新 data 回給 client
    let spec;
    try { spec = JSON.parse(chart.chart_spec); } catch { spec = null; }
    if (!spec) return res.status(500).json({ error: 'chart_spec JSON 損壞' });

    res.json({
      spec: { ...spec, data: result.rows },
      warnings: result.warnings || [],
      schema_hash: result.schemaHash,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARES — 對齊 dashboard.js /designs/:id/shares pattern,讓 ShareModal 直接 reuse
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/shares', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const chart = await db.prepare(`SELECT owner_id, source_tool FROM user_charts WHERE id=?`).get(req.params.id);
    if (!chart) return res.status(404).json({ error: '圖表不存在' });
    if (req.user.role !== 'admin' && chart.owner_id !== req.user.id) {
      return res.status(403).json({ error: '只有擁有者可以管理分享' });
    }
    const shares = await db.prepare(
      `SELECT s.*,
         CASE WHEN s.grantee_type='user'        THEN (SELECT employee_id || ' ' || name FROM users WHERE id=TO_NUMBER(s.grantee_id))
              WHEN s.grantee_type='role'        THEN (SELECT name FROM roles WHERE id=TO_NUMBER(s.grantee_id))
              WHEN s.grantee_type='department'  THEN s.grantee_id || ' ' || NVL((SELECT MAX(dept_name) FROM users WHERE dept_code=s.grantee_id), '')
              WHEN s.grantee_type='cost_center' THEN s.grantee_id || ' ' || NVL((SELECT MAX(profit_center_name) FROM users WHERE profit_center=s.grantee_id), '')
              WHEN s.grantee_type='division'    THEN s.grantee_id || ' ' || NVL((SELECT MAX(org_section_name) FROM users WHERE org_section=s.grantee_id), '')
              ELSE s.grantee_id END AS grantee_name
       FROM user_chart_shares s WHERE s.chart_id=? ORDER BY s.id ASC`
    ).all(req.params.id);
    res.json(shares);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/shares', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const chart = await db.prepare(`SELECT owner_id, source_tool FROM user_charts WHERE id=?`).get(req.params.id);
    if (!chart) return res.status(404).json({ error: '圖表不存在' });
    if (req.user.role !== 'admin' && chart.owner_id !== req.user.id) {
      return res.status(403).json({ error: '只有擁有者可以管理分享' });
    }
    // freeform chart 禁止分享(無 tool 重跑能力)
    if (!chart.source_tool) {
      return res.status(400).json({ error: '無 tool 來源的 freeform chart 不可分享(無法重執行取資料)' });
    }
    const { share_type, grantee_type, grantee_id } = req.body;
    if (!grantee_type || !grantee_id) return res.status(400).json({ error: '缺 grantee_type / grantee_id' });
    if (!['use', 'manage'].includes(share_type)) return res.status(400).json({ error: 'share_type 必須為 use 或 manage' });

    // 同 grantee 已存在則 update share_type(避免 upsert 在 sql.js 需要)
    const existing = await db.prepare(
      `SELECT id FROM user_chart_shares WHERE chart_id=? AND grantee_type=? AND grantee_id=?`
    ).get(req.params.id, grantee_type, String(grantee_id));
    if (existing) {
      await db.prepare(`UPDATE user_chart_shares SET share_type=? WHERE id=?`).run(share_type, existing.id);
    } else {
      await db.prepare(
        `INSERT INTO user_chart_shares (chart_id, share_type, grantee_type, grantee_id, granted_by) VALUES (?,?,?,?,?)`
      ).run(req.params.id, share_type, grantee_type, String(grantee_id), req.user.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/shares/:shareId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const chart = await db.prepare(`SELECT owner_id FROM user_charts WHERE id=?`).get(req.params.id);
    if (!chart) return res.status(404).json({ error: '圖表不存在' });
    if (req.user.role !== 'admin' && chart.owner_id !== req.user.id) {
      return res.status(403).json({ error: '無權限' });
    }
    await db.prepare(`DELETE FROM user_chart_shares WHERE id=? AND chart_id=?`).run(req.params.shareId, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN:熱門分享圖供採納為戰情室 official chart
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/popular', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db.prepare(
      `SELECT c.id, c.title, c.description, c.owner_id, c.source_type, c.source_tool,
              c.use_count, c.created_at, c.updated_at, c.adopted_from_user_chart_id,
              (SELECT employee_id || ' ' || name FROM users WHERE id=c.owner_id) AS owner_name,
              (SELECT COUNT(*) FROM user_chart_shares s WHERE s.chart_id=c.id) AS share_count,
              (SELECT MAX(d.id) FROM ai_select_designs d WHERE d.adopted_from_user_chart_id=c.id) AS adopted_design_id
       FROM user_charts c
       WHERE c.source_tool IS NOT NULL
       ORDER BY c.use_count DESC, c.updated_at DESC
       FETCH FIRST ? ROWS ONLY`
    ).all(limit);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/user-charts/admin/:id/adopt — admin 採納為戰情室 official chart
// 注意:此 endpoint 為「初稿」— 真正寫進 ai_select_designs 需要 SQL 與 chart spec 雙端對應,
// Phase 5 第一輪只把 chart 標記為「已採納」,實際的 design 由 admin 手動 paste / 編輯。
router.post('/admin/:id/adopt', verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const chart = await db.prepare(`SELECT * FROM user_charts WHERE id=?`).get(req.params.id);
    if (!chart) return res.status(404).json({ error: '圖表不存在' });

    const { topic_id, design_name, sql_query } = req.body || {};
    if (!topic_id || !design_name || !sql_query) {
      return res.status(400).json({ error: '需提供 topic_id / design_name / sql_query 才能完成採納' });
    }

    let spec;
    try { spec = JSON.parse(chart.chart_spec); } catch { spec = {}; }

    // 把 InlineChartSpec 轉成 AiChartDef 的最小可行格式(欄位 mapping 由 admin 自行調整)
    const aiChartDef = {
      type: spec.type || 'bar',
      title: design_name,
      x_field: spec.x_field,
      y_fields: spec.y_fields || [],
    };

    const r = await db.prepare(
      `INSERT INTO ai_select_designs (
         topic_id, name, sql_query, chart_def, created_by,
         is_public, public_approved, adopted_from_user_chart_id
       ) VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      topic_id, design_name, sql_query, JSON.stringify(aiChartDef), req.user.id,
      0, 0, chart.id
    );
    res.json({ design_id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
