/**
 * Daily Report Service — Sprint M-13(spec §12.10.4 #33 主管 AI 日報)
 *
 * 每日 / 每週彙整,給 user 的關注專案 / 自己負責的專案。
 *
 * 流程(每天 09:00 跑):
 *   1. 找符合條件的 user(admin / PM / sales / director / super)
 *   2. 各自找其關注專案(PM/sales 自己負責 + super_user self-joined + director scope)
 *   3. 對每個專案跑 StatusSummary(複用 statusSummary.js)
 *   4. 把 N 個 SUMMARY 組成一份 markdown 日報
 *   5. 寫 user_notifications + email + Webex DM(per user 設定)
 *
 * Manual trigger:
 *   - runForUser(db, { userId, period: 'daily' | 'weekly' })
 *
 * Scheduling:
 *   - 預設不開(避免 demo 環境天天跑 LLM)
 *   - env `PROJECTS_DAILY_REPORT_CRON='0 9 * * *'` 開啟
 */

const { makeLogger } = require('./logger');
const log = makeLogger('dailyReportService');

const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true';

/**
 * 為單一 user 跑日報 / 週報
 *
 * @param {object} db
 * @param {object} input
 * @param {number} input.userId
 * @param {'daily'|'weekly'} [input.period='daily']
 * @param {boolean} [input.dryRun]  — true:只回 markdown 不發通知
 */
async function runForUser(db, { userId, period = 'daily', dryRun = false } = {}) {
  if (!userId) throw new Error('userId required');

  const user = await db.prepare(
    `SELECT id, username, name, email FROM users WHERE id = ? AND status = 'active'`,
  ).get(userId);
  if (!user) throw new Error('user not found');

  // 找 user 關注的 active 專案
  const projects = await _findUserActiveProjects(db, userId);
  if (projects.length === 0) {
    log.log(`user ${userId} has no active projects · skip ${period} report`);
    return { skipped: true, reason: 'no_active_projects', user_id: userId };
  }

  // 抓每個專案的 StatusSummary
  const statusSummary = require('../ai/statusSummary');
  const summaries = [];
  for (const p of projects.slice(0, 20)) {  // 最多 20 個
    try {
      const s = await statusSummary.getSummary(db, p.id);
      if (s) summaries.push({ project: p, summary: s });
    } catch (e) {
      log.warn(`status summary failed for project ${p.id}: ${e.message}`);
    }
  }

  // 組 markdown
  const md = await _buildReportMarkdown({
    user, period, summaries, totalProjects: projects.length,
  });

  if (dryRun) {
    return { markdown: md, summaries_count: summaries.length, dry_run: true };
  }

  // 發通知
  const result = { summaries_count: summaries.length, channels: [] };
  // 1. user_notifications(鈴鐺)
  try {
    const userNotif = require('../../services/userNotificationService');
    const subjectIcon = period === 'weekly' ? '📊' : '☀️';
    await userNotif.create(db, {
      userId: user.id,
      type: `proj_${period}_report`,
      title: `${subjectIcon} ${period === 'weekly' ? '週報' : '日報'} · ${summaries.length} 個專案`,
      message: md.slice(0, 1000),
      linkUrl: `/projects-platform/dashboard`,
      payload: { period, projects_count: summaries.length, generated_at: new Date().toISOString() },
    });
    result.channels.push('in_app_badge');
  } catch (e) {
    log.warn(`in_app_badge ${period} report failed: ${e.message}`);
  }

  // 2. Email(若有 email)
  if (user.email) {
    try {
      const mailService = require('../../services/mailService');
      const ok = await mailService.sendMail({
        to: user.email,
        subject: `[Cortex 專案 ${period === 'weekly' ? '週報' : '日報'}] ${summaries.length} 個關注專案 · ${new Date().toLocaleDateString('zh-TW')}`,
        html: _markdownToHtml(md),
      });
      if (ok) result.channels.push('email');
    } catch (e) {
      log.warn(`email ${period} report failed: ${e.message}`);
    }
  }

  log.log(`${period} report user=${user.id}(${user.username}) projects=${summaries.length} channels=${result.channels.join('/')}`);
  return result;
}

/**
 * 批次跑(scheduled job 入口)
 */
async function runForAll(db, { period = 'daily' } = {}) {
  log.log(`runForAll · period=${period} · start`);
  const userIds = await _findReportableUsers(db);
  log.log(`runForAll · ${userIds.length} reportable users`);

  const results = { sent: 0, skipped: 0, errors: [] };
  for (const userId of userIds) {
    try {
      const r = await runForUser(db, { userId, period });
      if (r.skipped) results.skipped++;
      else results.sent++;
    } catch (e) {
      log.warn(`user ${userId} ${period} report failed: ${e.message}`);
      results.errors.push({ user_id: userId, error: e.message });
    }
  }
  log.log(`runForAll · ${period} done · sent=${results.sent} skipped=${results.skipped} errors=${results.errors.length}`);
  return results;
}

/** 找該 user 關注的 active 專案 */
async function _findUserActiveProjects(db, userId) {
  const rows = await db.prepare(`
    SELECT DISTINCT p.id, p.project_code, p.lifecycle_status, p.priority_score, p.bu_id, p.data_payload
      FROM projects p
     WHERE p.lifecycle_status = 'ACTIVE'
       AND (
         p.pm_user_id = ?
         OR p.sales_user_id = ?
         OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
         OR p.id IN (SELECT project_id FROM project_super_users WHERE user_id = ? AND left_at IS NULL)
       )
     ORDER BY p.priority_score DESC NULLS LAST, p.updated_at DESC
  `).all(userId, userId, userId, userId).catch(() => []);
  return rows;
}

/** 找應該收日報的 user(admin / PM / sales / director / super_user)*/
async function _findReportableUsers(db) {
  // admin
  const admins = await db.prepare(
    `SELECT id FROM users WHERE role = 'admin' AND status = 'active'`,
  ).all().catch(() => []);
  // PM / sales(任一 active 專案的)
  const pmSales = await db.prepare(`
    SELECT DISTINCT u.id
      FROM users u
      JOIN projects p ON p.pm_user_id = u.id OR p.sales_user_id = u.id
     WHERE u.status = 'active' AND p.lifecycle_status = 'ACTIVE'
  `).all().catch(() => []);
  // director / super(有 active role grant)
  const directors = await db.prepare(`
    SELECT DISTINCT g.user_id AS id
      FROM user_role_grants g
      JOIN user_role_definitions d ON d.id = g.role_id
     WHERE g.is_active = 1
       AND (g.expires_at IS NULL OR g.expires_at > SYSTIMESTAMP)
       AND d.role_code IN ('project.bu_director', 'project.top_director', 'project.bu_super', 'project.hq_super')
  `).all().catch(() => []);

  const ids = new Set();
  for (const r of admins)    ids.add(Number(r.id));
  for (const r of pmSales)   ids.add(Number(r.id));
  for (const r of directors) ids.add(Number(r.id));
  return [...ids];
}

async function _buildReportMarkdown({ user, period, summaries, totalProjects }) {
  const dt = new Date().toLocaleDateString('zh-TW');
  const subjectIcon = period === 'weekly' ? '📊' : '☀️';
  const periodCh = period === 'weekly' ? '週報' : '日報';

  const lines = [];
  lines.push(`# ${subjectIcon} Cortex 專案${periodCh} · ${dt}`);
  lines.push('');
  lines.push(`hi **${user.name || user.username}**,以下是你關注的 ${summaries.length}/${totalProjects} 個 active 專案重點:`);
  lines.push('');

  // 紅燈專案優先
  const redSorts = summaries
    .map((x) => ({ ...x, hasRed: (x.summary.risk_count || 0) > 0 || (x.summary.overdue_task_count || 0) > 0 }))
    .sort((a, b) => Number(b.hasRed) - Number(a.hasRed));

  for (const s of redSorts) {
    const p = s.project;
    const sm = s.summary;
    const titleField = (() => { try { return JSON.parse(p.data_payload || '{}').title; } catch { return null; } })();
    const dot = sm.risk_count > 0 ? '🔴' : sm.overdue_task_count > 0 ? '🟡' : '🟢';
    lines.push(`## ${dot} ${p.project_code} · ${titleField || '—'}`);
    lines.push('');
    if (sm.one_liner)  lines.push(`**${sm.one_liner}**`);
    if (sm.progress)   lines.push(`- 進度:${sm.progress}`);
    if (sm.risk)       lines.push(`- 風險:${sm.risk}`);
    if (sm.todo)       lines.push(`- 24h 待辦:${sm.todo}`);
    lines.push('');
  }

  // 末尾 LLM-friendly key insight summary(若有 LLM)
  if (USE_LLM && summaries.length >= 3) {
    try {
      const insight = await _llmKeyInsight(period, summaries);
      if (insight) {
        lines.push('---');
        lines.push('');
        lines.push(`### 🤖 AI 重點濃縮`);
        lines.push('');
        lines.push(insight);
        lines.push('');
      }
    } catch (e) {
      log.warn(`llm key insight failed: ${e.message}`);
    }
  }

  lines.push('---');
  lines.push(`_由 Cortex 專案管理平台自動生成 · ${new Date().toLocaleString('zh-TW')}_`);
  return lines.join('\n');
}

async function _llmKeyInsight(period, summaries) {
  const { getGenerativeModel, extractText } = require('../../services/geminiClient');
  const llmQueue = require('./llmQueue');

  const inputBlob = summaries.map((s) =>
    `[${s.project.project_code}] ${s.summary.one_liner || ''} · 風險:${s.summary.risk || '—'} · 待辦:${s.summary.todo || '—'}`,
  ).join('\n');

  const sys = `你是 Cortex 平台的 AI 助手,生成主管 ${period === 'weekly' ? '週' : '日'}報的「重點濃縮」段。
原則:
- 用繁體中文,< 200 字
- 條列 3-5 點,聚焦今日最重要的 issue / 進展 / 主管要關注的
- 不要重複每個專案的 one_liner(那已在上面列出),只挑「跨專案 pattern / 衝突 / 集中風險」`;
  const usr = `以下是 ${summaries.length} 個專案的 one_liner / 風險 / 待辦:\n\n${inputBlob}\n\n請寫「重點濃縮」段。`;

  const model = getGenerativeModel({
    model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
    systemInstruction: sys,
  });

  const res = await llmQueue.withLLM(async () => {
    return model.generateContent({ contents: [{ role: 'user', parts: [{ text: usr }] }] });
  }, { label: 'daily_report_insight', timeoutMs: 30_000 });

  return extractText(res).trim();
}

function _markdownToHtml(md) {
  // 極簡 markdown → HTML(避 dependency)
  let html = String(md);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="color:#0F3D5C;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:20px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="color:#0F3D5C;">$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\s*)+/gs, (m) => `<ul style="margin:6px 0;padding-left:20px;">${m}</ul>`);
  html = html.replace(/^---$/gm, '<hr style="border:0;border-top:1px solid #eee;margin:20px 0;" />');
  html = html.replace(/\n\n/g, '<br /><br />');
  return `<div style="font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;color:#333;">${html}</div>`;
}

// ─────────────────────────────────────────────────────────────────────
// Cron scheduler — Sprint M-13 補上線
// ─────────────────────────────────────────────────────────────────────
let _dailyJob   = null;
let _weeklyJob  = null;

/**
 * 註冊每日 / 每週 cron。
 *
 * env:
 *   PROJECTS_DAILY_REPORT_CRON   — daily 排程(預設 '0 9 * * *' = 每天 09:00)
 *   PROJECTS_WEEKLY_REPORT_CRON  — weekly 排程(預設 '0 9 * * 1' = 週一 09:00)
 *   PROJECTS_DAILY_REPORT_ENABLED — 'true' 才開啟(預設關,避免 demo 環境天天打 LLM)
 */
function startCron() {
  if (process.env.PROJECTS_DAILY_REPORT_ENABLED !== 'true') {
    log.log('cron skipped · PROJECTS_DAILY_REPORT_ENABLED != true');
    return;
  }

  const cron = require('node-cron');
  const dailyExpr  = process.env.PROJECTS_DAILY_REPORT_CRON  || '0 9 * * *';
  const weeklyExpr = process.env.PROJECTS_WEEKLY_REPORT_CRON || '0 9 * * 1';

  if (_dailyJob)  { _dailyJob.stop();  _dailyJob = null; }
  if (_weeklyJob) { _weeklyJob.stop(); _weeklyJob = null; }

  _dailyJob = cron.schedule(dailyExpr, async () => {
    log.log(`cron · daily report start at ${new Date().toISOString()}`);
    try {
      const db = require('../../database-oracle').db;
      const r = await runForAll(db, { period: 'daily' });
      log.log(`cron · daily report done · sent=${r.sent} skipped=${r.skipped} errors=${r.errors.length}`);
    } catch (e) {
      log.warn(`cron daily report failed: ${e.message}`);
    }
  });

  _weeklyJob = cron.schedule(weeklyExpr, async () => {
    log.log(`cron · weekly report start at ${new Date().toISOString()}`);
    try {
      const db = require('../../database-oracle').db;
      const r = await runForAll(db, { period: 'weekly' });
      log.log(`cron · weekly report done · sent=${r.sent} skipped=${r.skipped} errors=${r.errors.length}`);
    } catch (e) {
      log.warn(`cron weekly report failed: ${e.message}`);
    }
  });

  log.log(`cron · daily="${dailyExpr}" weekly="${weeklyExpr}" started`);
}

function stopCron() {
  if (_dailyJob)  { _dailyJob.stop();  _dailyJob = null;  log.log('daily cron stopped'); }
  if (_weeklyJob) { _weeklyJob.stop(); _weeklyJob = null; log.log('weekly cron stopped'); }
}

module.exports = {
  runForUser,
  runForAll,
  startCron,
  stopCron,
};
