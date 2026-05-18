/**
 * Notification Engine — Phase 1 真接 4 通道
 *
 * 對齊 spec §14.9 + Admin/NotificationRules.tsx 的 8 規則。
 *
 * Phase 1 ship(2026-05-18):
 *   - in_app_badge → userNotificationService.create()(寫進 user_notifications 表 → 鈴鐺紅點)
 *   - webex_dm     → webexService.sendDirectMessage()(要 user.email)
 *   - email        → mailService.sendMail()(要 user.email)
 *   - webex_group  → stub log(暫無 project-specific group)
 *   - browser_push → stub log(無基礎建設)
 *
 * Recipients 解析:從 rule.target + ctx 查 db 拿 user_id + email
 *   · 'PM + 業務'        → projects.pm_user_id + sales_user_id
 *   · 'project members'  → project_members + pm + sales
 *   · '業務 + 助理'      → sales + project_members.role='assistant'
 *   · 'R · primary_owner' → tasks.primary_owner_user_id (需 ctx.task_id)
 *   · 'A · accountable_role' → tasks.accountable_role 對應 project role
 *   · 'admin + super_user' → users.role='admin'
 *   · '#announcement Pin' → 不發 per-user(messagesService 已處理 announcement)
 *
 * Actor 自己會被 skip(不通知發訊者本人)。
 *
 * Dispatch 是 async,但呼叫方可 fire-and-forget(不 await)— 引擎內部 try/catch,失敗只 log。
 */

const { makeLogger } = require('./logger');
const log = makeLogger('notificationEngine');

const RULES = {
  TASK_OVERDUE:    { channels: ['webex_dm', 'in_app_badge', 'email'], priority: 'HIGH',   target: 'A · accountable_role' },
  TASK_AT_70:      { channels: ['webex_dm', 'in_app_badge'],           priority: 'NORMAL', target: 'R · primary_owner' },
  DECISION_NEW:    { channels: ['in_app_badge', 'email'],              priority: 'NORMAL', target: 'project members' },
  BLOCKER_NEW:     { channels: ['webex_dm', 'in_app_badge', 'email'],  priority: 'HIGH',   target: 'PM + 業務' },
  STAGE_GATE:      { channels: ['webex_dm', 'in_app_badge'],           priority: 'HIGH',   target: '業務 + 助理' },
  PROJECT_PAUSED:  { channels: ['in_app_badge'],                       priority: 'LOW',    target: 'project members' },
  CONF_FIELD_CHG:  { channels: ['email'],                              priority: 'HIGH',   target: 'admin + super_user' },
  SUMMARY_DAILY:   { channels: ['in_app_badge'],                       priority: 'NORMAL', target: '#announcement Pin' },
};

// In-memory dispatch log(給 admin 看 — 重啟會清)
const _dispatchLog = [];
const MAX_LOG = 500;

/**
 * 觸發通知
 *
 * @param {object} db        — DB handle(舊 API 不傳會走 fallback log-only)
 * @param {string} ruleCode  — e.g. 'BLOCKER_NEW'
 * @param {object} ctx       — { project_id, task_id?, message_id?, actor, title, body, link_url? }
 */
async function dispatch(db, ruleCode, ctx = {}) {
  // 舊 API 相容:如果第一個參數是 string,代表沒傳 db → 走 log-only
  if (typeof db === 'string') {
    ctx = ruleCode || {};
    ruleCode = db;
    db = null;
  }

  const rule = RULES[ruleCode];
  if (!rule) {
    log.warn(`unknown rule code: ${ruleCode}`);
    return null;
  }

  // 注入 rule_code 進 ctx,_dispatchChannel / _sendInAppBadge 內可用
  ctx = { ...ctx, rule_code: ruleCode };

  const event = {
    rule_code: ruleCode,
    channels: rule.channels,
    priority: rule.priority,
    target_desc: rule.target,
    project_id: ctx.project_id || null,
    actor: ctx.actor || null,
    title: ctx.title || '',
    body: ctx.body || '',
    dispatched_at: new Date().toISOString(),
    recipients: [],          // [{ user_id, name, email, channels: [...]}]
    delivery: {              // 各通道送出統計
      in_app_badge: 0,
      webex_dm: 0,
      email: 0,
      webex_group: 0,
      browser_push: 0,
    },
    errors: [],
  };

  try {
    // 解析 recipients(沒 db handle 跳過實際發送)
    const recipients = db ? await _resolveRecipients(db, rule.target, ctx) : [];
    event.recipients = recipients.map((r) => ({ user_id: r.id, name: r.name, email: r.email }));

    // 逐通道 dispatch
    for (const ch of rule.channels) {
      try {
        const n = await _dispatchChannel(db, ch, recipients, rule, ctx);
        event.delivery[ch] = n;
        log.log(`📨 [${ruleCode}] ${ch} → ${rule.target}(${n} 人) · ${ctx.title || ''}`);
      } catch (e) {
        event.errors.push({ channel: ch, error: e.message });
        log.warn(`📨 [${ruleCode}] ${ch} failed: ${e.message}`);
      }
    }
  } catch (e) {
    event.errors.push({ stage: 'resolve_recipients', error: e.message });
    log.warn(`recipients resolve failed: ${e.message}`);
  }

  _dispatchLog.push(event);
  if (_dispatchLog.length > MAX_LOG) _dispatchLog.shift();

  return event;
}

// ─────────────────────────────────────────────────────────────────────
// Recipients resolver
// 回傳 [{ id, name, email, username, role_in_project? }]
// ─────────────────────────────────────────────────────────────────────
async function _resolveRecipients(db, targetDesc, ctx) {
  const actorId = Number(ctx.actor) || null;
  const projectId = Number(ctx.project_id) || null;

  // No-op targets
  if (targetDesc === '#announcement Pin') return [];

  // admin + super_user(Sprint H 後 union user_role_grants 含 admin / project.bu_super / project.hq_super)
  if (targetDesc === 'admin + super_user') {
    const rows = await db.prepare(`
      SELECT DISTINCT u.id, u.name, u.email, u.username
        FROM users u
       WHERE u.status = 'active' AND u.email IS NOT NULL
         AND (
           u.role = 'admin'
           OR EXISTS (
             SELECT 1 FROM user_role_grants g
               JOIN user_role_definitions d ON d.id = g.role_id
              WHERE g.user_id = u.id AND g.is_active = 1
                AND (g.expires_at IS NULL OR g.expires_at > SYSTIMESTAMP)
                AND d.role_code IN ('admin', 'project.bu_super', 'project.hq_super')
           )
         )
    `).all().catch(() => []);
    return _dedup(rows, actorId);
  }

  if (!projectId) {
    log.warn(`target "${targetDesc}" requires project_id in ctx`);
    return [];
  }

  // Load project for pm_user_id + sales_user_id
  const project = await db.prepare(
    `SELECT id, pm_user_id, sales_user_id, created_by_user_id
       FROM projects WHERE id = ?`,
  ).get(projectId).catch(() => null);

  if (!project) {
    log.warn(`project ${projectId} not found`);
    return [];
  }

  const pmId = Number(project.pm_user_id) || null;
  const salesId = Number(project.sales_user_id) || null;

  // task-based targets
  if (targetDesc === 'R · primary_owner') {
    const taskId = Number(ctx.task_id);
    if (!taskId) return [];
    const task = await db.prepare(
      `SELECT primary_owner_user_id FROM project_tasks WHERE id = ?`,
    ).get(taskId).catch(() => null);
    if (!task?.primary_owner_user_id) return [];
    return _loadUsers(db, [task.primary_owner_user_id], actorId);
  }

  if (targetDesc === 'A · accountable_role') {
    // task.accountable_role(如 'PM'/'SALES')→ 對應 project role 上的 user
    const taskId = Number(ctx.task_id);
    if (!taskId) return [];
    const task = await db.prepare(
      `SELECT accountable_role, primary_owner_user_id FROM project_tasks WHERE id = ?`,
    ).get(taskId).catch(() => null);
    if (!task) return [];

    const ids = new Set();
    const accRole = String(task.accountable_role || '').toUpperCase();
    if (accRole === 'PM' && pmId) ids.add(pmId);
    if ((accRole === 'SALES' || accRole === 'HOST') && salesId) ids.add(salesId);
    if (task.primary_owner_user_id) ids.add(Number(task.primary_owner_user_id));
    return _loadUsers(db, [...ids], actorId);
  }

  // PM + 業務
  if (targetDesc === 'PM + 業務') {
    const ids = [pmId, salesId].filter(Boolean);
    return _loadUsers(db, ids, actorId);
  }

  // 業務 + 助理
  if (targetDesc === '業務 + 助理') {
    const ids = new Set();
    if (salesId) ids.add(salesId);
    const assistants = await db.prepare(
      `SELECT user_id FROM project_members
        WHERE project_id = ? AND LOWER(role) IN ('assistant','助理','sales_assistant')`,
    ).all(projectId).catch(() => []);
    for (const r of assistants) ids.add(Number(r.user_id));
    return _loadUsers(db, [...ids], actorId);
  }

  // project members(含 PM + sales + 全 member,不含 chat_guest/outsider)
  if (targetDesc === 'project members') {
    const ids = new Set();
    if (pmId) ids.add(pmId);
    if (salesId) ids.add(salesId);
    const members = await db.prepare(
      `SELECT user_id, role FROM project_members WHERE project_id = ?`,
    ).all(projectId).catch(() => []);
    for (const m of members) {
      const role = String(m.role || '').toLowerCase();
      // 排除 chat_guest / outsider(只通知正式成員)
      if (role === 'chat_guest' || role === 'outsider') continue;
      ids.add(Number(m.user_id));
    }
    return _loadUsers(db, [...ids], actorId);
  }

  log.warn(`unsupported target: ${targetDesc}`);
  return [];
}

async function _loadUsers(db, userIds, excludeActor) {
  const uniq = [...new Set(userIds.filter(Boolean))].filter((id) => id !== excludeActor);
  if (uniq.length === 0) return [];
  const placeholders = uniq.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT id, name, email, username
       FROM users WHERE id IN (${placeholders}) AND status = 'active'`,
  ).all(...uniq).catch(() => []);
  return _dedup(rows, excludeActor);
}

function _dedup(rows, excludeActor) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || !r.id) continue;
    if (excludeActor && Number(r.id) === Number(excludeActor)) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Channel dispatchers
// 回傳:成功送達的 user 數
// ─────────────────────────────────────────────────────────────────────
async function _dispatchChannel(db, channel, recipients, rule, ctx) {
  switch (channel) {
    case 'in_app_badge':  return _sendInAppBadge(db, recipients, rule, ctx);
    case 'webex_dm':      return _sendWebexDm(recipients, rule, ctx);
    case 'email':         return _sendEmail(recipients, rule, ctx);
    case 'webex_group':   return _sendWebexGroup(recipients, rule, ctx);
    case 'browser_push':  return _sendBrowserPush(recipients, rule, ctx);
    default:              return 0;
  }
}

async function _sendInAppBadge(db, recipients, rule, ctx) {
  if (!db || recipients.length === 0) return 0;
  const userNotif = require('../../services/userNotificationService');
  let sock = null;
  try { sock = require('../../services/socketService'); } catch (_) {}

  const linkUrl = ctx.link_url || (ctx.project_id ? `/projects-platform/projects/${ctx.project_id}` : null);
  const notifType = `proj_${rule.priority === 'HIGH' ? 'high_' : ''}${ctx.rule_code || 'notice'}`.slice(0, 100);
  let n = 0;
  for (const r of recipients) {
    try {
      const id = await userNotif.create(db, {
        userId: r.id,
        type: notifType,
        title: ctx.title || '專案通知',
        message: ctx.body || null,
        linkUrl,
        payload: {
          source: 'projects-platform',
          project_id: ctx.project_id,
          message_id: ctx.message_id,
          task_id: ctx.task_id,
          priority: rule.priority,
        },
      });
      n++;

      // socket 即時推給該 user(鈴鐺紅點立即跳,不用等 20s poll)
      if (sock) {
        sock.emitProjectUserNotification(r.id, {
          id,
          type: notifType,
          title: ctx.title || '專案通知',
          message: ctx.body || null,
          link_url: linkUrl,
          priority: rule.priority,
          project_id: ctx.project_id || null,
          rule_code: ctx.rule_code,
        });
      }
    } catch (e) {
      log.warn(`in_app_badge → user ${r.id} failed: ${e.message}`);
    }
  }
  return n;
}

async function _sendWebexDm(recipients, rule, ctx) {
  const eligible = recipients.filter((r) => r.email);
  if (eligible.length === 0) return 0;

  let webex;
  try {
    webex = require('../../services/webexService');
  } catch (e) {
    log.warn(`webexService unavailable: ${e.message}`);
    return 0;
  }

  // 非阻塞:Webex API 可能慢,並發但個別 timeout 由 webexService 控
  const markdown = _buildMarkdown(rule, ctx);
  let n = 0;
  await Promise.all(eligible.map(async (r) => {
    try {
      const msgId = await webex.sendDirectMessage(r.email, markdown);
      if (msgId) n++;  // null = webexService 內部 catch 後回傳,當失敗
    } catch (e) {
      log.warn(`webex_dm → ${r.email} failed: ${e.message}`);
    }
  }));
  return n;
}

async function _sendEmail(recipients, rule, ctx) {
  const eligible = recipients.filter((r) => r.email);
  if (eligible.length === 0) return 0;

  let mailService;
  try {
    mailService = require('../../services/mailService');
  } catch (e) {
    log.warn(`mailService unavailable: ${e.message}`);
    return 0;
  }

  const subject = `[Cortex 專案] ${ctx.title || rule.priority}`;
  const html = _buildEmailHtml(rule, ctx);
  let n = 0;
  // Email 逐封送(避免合併 to 暴露收件者)
  for (const r of eligible) {
    try {
      const ok = await mailService.sendMail({ to: r.email, subject, html });
      if (ok) n++;  // false = SMTP 沒設或內部失敗
    } catch (e) {
      log.warn(`email → ${r.email} failed: ${e.message}`);
    }
  }
  return n;
}

async function _sendWebexGroup(recipients, rule, ctx) {
  // Phase 1:無 project-specific Webex group binding,先 log
  log.log(`webex_group (no-op stub) → ${recipients.length} users · ${ctx.title || ''}`);
  return 0;
}

async function _sendBrowserPush(recipients, rule, ctx) {
  log.log(`browser_push (no-op stub) → ${recipients.length} users · ${ctx.title || ''}`);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// Message builders
// ─────────────────────────────────────────────────────────────────────
function _buildMarkdown(rule, ctx) {
  const icon = rule.priority === 'HIGH' ? '🚨' : '📌';
  const title = ctx.title || rule.target;
  const body = ctx.body ? `\n\n> ${String(ctx.body).slice(0, 500)}` : '';
  const link = ctx.project_id
    ? `\n\n[👉 開啟專案](${_baseUrl()}/projects-platform/projects/${ctx.project_id})`
    : '';
  return `${icon} **${title}**${body}${link}`;
}

function _buildEmailHtml(rule, ctx) {
  const color = rule.priority === 'HIGH' ? '#dc2626' : '#0ea5e9';
  const title = ctx.title || rule.target;
  const body = ctx.body ? `<blockquote style="border-left:3px solid ${color};padding:6px 12px;color:#444;margin:12px 0;">${_escapeHtml(ctx.body)}</blockquote>` : '';
  const link = ctx.project_id
    ? `<p><a href="${_baseUrl()}/projects-platform/projects/${ctx.project_id}" style="display:inline-block;padding:8px 16px;background:${color};color:#fff;text-decoration:none;border-radius:6px;">開啟專案</a></p>`
    : '';
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px;">
      <h2 style="color:${color};margin:0 0 8px;font-size:16px;">${_escapeHtml(title)}</h2>
      <p style="color:#666;font-size:12px;margin:0 0 12px;">Cortex 專案管理 · ${rule.priority} · ${rule.target}</p>
      ${body}
      ${link}
      <hr style="border:0;border-top:1px solid #eee;margin:20px 0;" />
      <p style="color:#999;font-size:11px;">此通知由系統自動發送 · ${new Date().toLocaleString('zh-TW')}</p>
    </div>
  `;
}

function _escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function _baseUrl() {
  return process.env.APP_BASE_URL || process.env.APP_PUBLIC_URL || '';
}

// ─────────────────────────────────────────────────────────────────────
// Admin / debug API
// ─────────────────────────────────────────────────────────────────────
function recentLog(limit = 50) {
  return _dispatchLog.slice(-limit).reverse();
}

function stats() {
  const m = {};
  for (const e of _dispatchLog) {
    m[e.rule_code] = (m[e.rule_code] || 0) + 1;
  }
  return m;
}

module.exports = {
  dispatch,
  recentLog,
  stats,
  RULES,
};
