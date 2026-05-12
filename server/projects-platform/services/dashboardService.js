/**
 * Dashboard Service — 跨專案儀表板 7 widget 資料聚合
 *
 * 對齊 PPT slide 13 + HTML demo renderDashboard()
 *
 * 7 widget:
 *   1. SLA 燈號統計(超期/接近/正常/暫停)
 *   2. 我的關注專案(Watchlist + priority_score >= 6 自動訂閱)
 *   3. 我的 Task(紅/黃/綠 計數)
 *   4. 待 Review(form / task)
 *   5. Delay 熱點(stage 卡了幾件)
 *   6. 本期 KPI(本週新增 / 結案 / 贏單率 / 平均回應時間)
 *   7. 成員負載熱圖(BU 視角)
 *
 * Phase 1 / Sprint D:全部 ad-hoc query,Phase 2 加 cache。
 * Watchlist 表 + auto-subscribe 規則:Sprint 後續或 Phase 2 補,目前 priority_score >= 6 全列。
 */

const { makeLogger } = require('./logger');
const log = makeLogger('dashboardService');

// ─── Helpers ─────────────────────────────────────────────────────────
function parseJsonSafe(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/** SLA 燈號分類:依 sla_due_at vs now,沒 sla 算正常 */
function classifySla(p, now = new Date()) {
  if (p.lifecycle_status === 'PAUSED') return 'gray';
  if (p.lifecycle_status === 'CLOSED') return null; // 不算
  if (!p.sla_due_at) return 'green';
  const due = new Date(p.sla_due_at).getTime();
  const t = now.getTime();
  if (due < t) return 'red';
  const hoursLeft = (due - t) / 3600000;
  if (hoursLeft < 24) return 'yellow';
  return 'green';
}

/** 取出 visible projects(同 projectsService.list 邏輯) */
async function _accessibleProjects(db, user) {
  const isAdmin = user.role === 'admin';
  const params = [];
  const where = ['p.lifecycle_status != \'CLOSED\'']; // dashboard 預設不含 CLOSED
  if (!isAdmin) {
    where.push(`(
      p.pm_user_id = ?
      OR p.sales_user_id = ?
      OR EXISTS (SELECT 1 FROM project_members pm
                  WHERE pm.project_id = p.id AND pm.user_id = ?)
    )`);
    params.push(user.id, user.id, user.id);
  }
  const rows = await db.prepare(
    `SELECT p.id, p.project_code, p.data_payload,
            p.lifecycle_status, p.importance, p.urgency, p.priority_score,
            p.sla_due_at, p.pm_user_id, p.sales_user_id, p.bu_id,
            pt.type_code, p.is_confidential, p.created_at, p.updated_at
       FROM projects p
       JOIN project_types pt ON pt.id = p.project_type_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.priority_score DESC NULLS LAST, p.updated_at DESC`,
  ).all(...params);
  return rows.map((r) => ({ ...r, data_payload: parseJsonSafe(r.data_payload, {}) }));
}

// ─── Widget 1: SLA Lights ────────────────────────────────────────────
function widgetSlaLights(projects) {
  const counts = { red: 0, yellow: 0, green: 0, gray: 0 };
  for (const p of projects) {
    const c = classifySla(p);
    if (c && counts[c] !== undefined) counts[c]++;
  }
  return counts;
}

// ─── Widget 2: Watchlist(priority_score >= 6 自動訂閱)──────────────
function widgetWatchlist(projects) {
  const watch = projects
    .filter((p) => Number(p.priority_score || 0) >= 6 || p.importance === 'HIGH')
    .slice(0, 8)
    .map((p) => ({
      id: p.project_code,
      project_id: Number(p.id),
      title: p.data_payload?.title || p.project_code,
      lifecycle: p.lifecycle_status,
      priority_score: p.priority_score,
      sla_light: classifySla(p) || 'gray',
      hint: hintFromProject(p),
    }));
  return watch;
}

function hintFromProject(p) {
  if (p.lifecycle_status === 'PAUSED') return '暫停中';
  const c = classifySla(p);
  if (c === 'red') return '已超期';
  if (c === 'yellow') return '24h 內到期';
  // fallback
  const updated = p.updated_at ? new Date(p.updated_at) : null;
  if (!updated) return '進行中';
  const days = Math.floor((Date.now() - updated.getTime()) / 86400000);
  return days === 0 ? '今天更新' : `${days} 天前更新`;
}

// ─── Widget 3: 我的 Task ─────────────────────────────────────────────
async function widgetMyTasks(db, user) {
  const rows = await db.prepare(
    `SELECT t.id, t.status, t.computed_due_at, t.progress_percent
       FROM project_tasks t
      WHERE (t.primary_owner_user_id = ?
             OR INSTR(t.collaborator_user_ids, '"' || ? || '"') > 0
             OR INSTR(t.collaborator_user_ids, '' || ? || '') > 0)
        AND t.status NOT IN ('DONE', 'CANCELLED')`,
  ).all(user.id, user.id, user.id).catch(() => []);

  const counts = { red: 0, yellow: 0, green: 0 };
  const now = Date.now();
  for (const r of rows) {
    if (!r.computed_due_at) { counts.green++; continue; }
    const due = new Date(r.computed_due_at).getTime();
    if (due < now) counts.red++;
    else if (due - now < 24 * 3600000) counts.yellow++;
    else counts.green++;
  }
  return { ...counts, total: rows.length };
}

// ─── Widget 4: 待 Review ────────────────────────────────────────────
async function widgetReviewQueue(db, _user) {
  const tasks = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM project_tasks WHERE status = 'READY_FOR_REVIEW'`,
  ).get();
  // form_review 暫時為 0(qp_form_* schema 在 Sprint E 才上)
  return {
    form_review: 0,
    task_review: Number(tasks?.cnt || 0),
  };
}

// ─── Widget 5: Delay 熱點(每 stage 卡了幾件)────────────────────────
async function widgetDelayHotspot(db, _user) {
  const rows = await db.prepare(
    `SELECT s.stage_code, COUNT(*) AS cnt
       FROM project_stages s
       JOIN projects p ON p.id = s.project_id
      WHERE s.status IN ('ACTIVE', 'READY_FOR_GATE')
        AND s.sla_due_at IS NOT NULL
        AND s.sla_due_at < SYSTIMESTAMP
        AND p.lifecycle_status NOT IN ('CLOSED', 'PAUSED')
      GROUP BY s.stage_code
      ORDER BY COUNT(*) DESC
      FETCH FIRST 5 ROWS ONLY`,
  ).all().catch(() => []);
  const total = rows.reduce((a, r) => a + Number(r.cnt), 0) || 1;
  return rows.map((r) => ({
    stage: r.stage_code,
    cnt: Number(r.cnt),
    ratio: Math.round((Number(r.cnt) / total) * 100),
  }));
}

// ─── Widget 6: 本期 KPI ─────────────────────────────────────────────
async function widgetKpi(db, _user) {
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000);
  const oneMonthAgo = new Date(Date.now() - 30 * 86400000);

  const [newWk, closedWk, winRate, avgResp] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c FROM projects WHERE created_at >= ?`).get(oneWeekAgo).then((r) => Number(r?.c || 0)),
    db.prepare(`SELECT COUNT(*) AS c FROM projects WHERE closed_at >= ?`).get(oneWeekAgo).then((r) => Number(r?.c || 0)).catch(() => 0),
    // 贏單率 mock — 結案案的 WIN/LOSS 還沒實作,先給個 demo 數
    Promise.resolve(0.68),
    // 平均回應時間 mock(stage 1 SLA 4h 通常達標)
    Promise.resolve(18),
  ]);

  return {
    new_this_week: newWk,
    closed_this_week: closedWk,
    win_rate: winRate,
    avg_response_hours: avgResp,
    period_label: '本週',
  };
}

// ─── Widget 7: 成員負載熱圖(BU 視角)──────────────────────────────
async function widgetMemberLoad(db, _user) {
  // 統計每個 PM 名下進行中專案數(粗略 load = active 專案數 * 20%)
  const rows = await db.prepare(
    `SELECT u.id, u.name, u.username,
            COUNT(p.id) AS total_projects,
            SUM(CASE WHEN p.sla_due_at < SYSTIMESTAMP THEN 1 ELSE 0 END) AS overdue
       FROM users u
       JOIN projects p ON p.pm_user_id = u.id
      WHERE p.lifecycle_status = 'ACTIVE'
      GROUP BY u.id, u.name, u.username
      ORDER BY total_projects DESC
      FETCH FIRST 8 ROWS ONLY`,
  ).all().catch(() => []);

  return rows.map((r) => {
    const total = Number(r.total_projects);
    const overdue = Number(r.overdue || 0);
    const load = Math.min(100, total * 25);  // 4 個案 ≈ 100% load(粗估)
    return {
      user_id: Number(r.id),
      name: r.name || r.username,
      total_projects: total,
      load_percent: load,
      overdue,
      color: overdue > 0 ? 'red' : load > 75 ? 'amber' : 'green',
      alert: overdue > 0 ? `${overdue} 超期` : load > 90 ? '負載高' : '',
    };
  });
}

// ─── Main API ────────────────────────────────────────────────────────
async function getDashboard(db, user) {
  if (!user) throw new Error('user required');

  const projects = await _accessibleProjects(db, user);

  const [w3, w4, w5, w6, w7] = await Promise.all([
    widgetMyTasks(db, user),
    widgetReviewQueue(db, user),
    widgetDelayHotspot(db, user),
    widgetKpi(db, user),
    widgetMemberLoad(db, user),
  ]);

  return {
    generated_at: new Date().toISOString(),
    user: { id: user.id, role: user.role },
    sla_lights: widgetSlaLights(projects),       // widget 1
    watchlist: widgetWatchlist(projects),         // widget 2
    my_tasks: w3,                                  // widget 3
    review_queue: w4,                              // widget 4
    delay_hotspot: w5,                             // widget 5
    kpi: w6,                                       // widget 6
    member_load: w7,                               // widget 7
  };
}

module.exports = {
  getDashboard,
  // 暴露給 statusSummary 用
  classifySla,
  hintFromProject,
};
