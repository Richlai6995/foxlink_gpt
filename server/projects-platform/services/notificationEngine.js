/**
 * Notification Engine(stub)— Phase 1 demo
 *
 * 對齊 spec §14.9 + Admin/NotificationRules.tsx 的 8 規則。
 *
 * Phase 1 範圍:
 *   - 規則 router(從 ruleCode 找 recipients + channels)
 *   - 4 通道 stub:
 *     · in_app_badge — 寫 console + 暫存記憶體(沒 user_notifications 表先 fallback log)
 *     · webex_dm — stub log
 *     · webex_group — stub log
 *     · email — stub log
 *     · browser_push — stub log
 *
 * Phase 2 接 Cortex 既有 Webex Bot + SMTP service。
 */

const { makeLogger } = require('./logger');
const log = makeLogger('notificationEngine');

// 8 規則 mapping(對齊 Admin/NotificationRules.tsx 顯示的 8 規則)
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

// 簡易記憶體 store(Phase 2 換成 user_notifications 表 + Webex 真發送)
const _dispatchLog = [];
const MAX_LOG = 200;

/**
 * 觸發通知
 *
 * @param {string} ruleCode  e.g. 'BLOCKER_NEW'
 * @param {object} ctx       上下文(project_id / message_id / actor / title / body)
 */
function dispatch(ruleCode, ctx = {}) {
  const rule = RULES[ruleCode];
  if (!rule) {
    log.warn(`unknown rule code: ${ruleCode}`);
    return null;
  }

  const event = {
    rule_code: ruleCode,
    channels: rule.channels,
    priority: rule.priority,
    target_desc: rule.target,
    ...ctx,
    dispatched_at: new Date().toISOString(),
  };

  // 各通道 stub
  for (const ch of rule.channels) {
    log.log(`📨 [${ruleCode}] ${ch} → ${rule.target} · ${ctx.title || ''}`);
  }

  // 記憶體 log(查得到誰被通知過)
  _dispatchLog.push(event);
  if (_dispatchLog.length > MAX_LOG) _dispatchLog.shift();

  return event;
}

/** 取最近通知 log(給 Admin / debug 用)*/
function recentLog(limit = 50) {
  return _dispatchLog.slice(-limit).reverse();
}

/** 統計 — 哪些規則被觸發多次 */
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
