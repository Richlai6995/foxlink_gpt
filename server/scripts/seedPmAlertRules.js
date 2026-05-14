'use strict';
/**
 * Seed PM 貴金屬漲跌幅警示規則 v2 — 3 條 rule(per metal)× 每條掛 3 個 schedule(日/週/月)
 *
 * v1 → v2 migration:
 *   v1 seed 出 9 條 rule(3 metal × 3 timeframe)— 名稱含「日漲幅 / 週漲幅 / 月漲幅」
 *   v2 改成 3 條 rule(每 metal 1 條,name 通用「漲幅警示」)+ alert_schedules 子記錄 3 筆(日/週/月)
 *
 * 跑法:
 *   node server/scripts/seedPmAlertRules.js
 *
 *   --delete-v1            砍掉 v1 留下的 9 條舊 rule(by name pattern「PT/PD/RH x 日/週/月漲幅警示」)
 *   --delete-old-tasks     一併砍最早 seedPmAlertTasks.js 留下的 scheduled_tasks
 *
 * 3 條 rule:
 *   [PM] PT 鉑 漲幅警示 (>8%)
 *   [PM] PD 鈀 漲幅警示 (>8%)
 *   [PM] RH 銠 漲幅警示 (>8%)
 *
 * 每條 rule 內 3 個 schedule:
 *   daily   — cron "0 8 * * *"   lookback_days=1   cooldown=1440
 *   weekly  — cron "0 8 * * 1"   lookback_days=5   cooldown=10080
 *   monthly — cron "0 8 1 * *"   lookback_days=22  cooldown=43200
 *
 * Rule 的 SQL template 用 {{lookback_days}} placeholder,alertRuleScheduler 評估時替換成各 schedule 的值。
 * 每條 rule 共用同一個 entity_code / message_template / actions — 但每個 schedule 結果寫進 pm_alert_history 各自有 rule_id。
 *
 * Idempotent: by rule_name 重跑 skip(只新增不覆蓋)
 */

try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); }
catch (_) { /* K8s pod 沒 dotenv */ }

let oracleDb;
try { oracleDb = require('../database-oracle'); }
catch (_) { oracleDb = require('/app/database-oracle'); }

const { nextFire, isSupportedCron } = require('../services/cronNext');

const ADMIN_ACCOUNT = process.env.DEFAULT_ADMIN_ACCOUNT || 'ADMIN';

// 警示通知收件人(採購窗口 5 人)
const NOTIFY_EMAILS = [
  'cynthia_Lin@foxlink.com',
  'Ann_wang@foxlink.com',
  'Sabrina_su@foxlink.com',
  'Jennifer_hsu@foxlink.com',
  'Queena_kuo@foxlink.com',
];

const args = process.argv.slice(2);
const DELETE_V1 = args.includes('--delete-v1');
const DELETE_OLD_TASKS = args.includes('--delete-old-tasks');
const SYNC_EMAILS = args.includes('--sync-emails');  // 用新 email 清單覆寫既有 rule 的 email action

// 11 個 metal 全套:6 基本金屬(LME via Westmetall)+ 5 貴金屬(PGM via JM + AU/AG)
// sourceFilter:寫成 SQL fragment(放在 WHERE 內), 不確定 source 時用 '1=1'(等於不過濾)
const METALS = [
  // 基本金屬(LME via Westmetall)
  { code: 'CU', name: '銅', emoji: '🟫', sourceFilter: `source LIKE 'Westmetall%'` },
  { code: 'AL', name: '鋁', emoji: '⚪', sourceFilter: `source LIKE 'Westmetall%'` },
  { code: 'NI', name: '鎳', emoji: '⚫', sourceFilter: `source LIKE 'Westmetall%'` },
  { code: 'ZN', name: '鋅', emoji: '⬜', sourceFilter: `source LIKE 'Westmetall%'` },
  { code: 'PB', name: '鉛', emoji: '⚫', sourceFilter: `source LIKE 'Westmetall%'` },
  { code: 'SN', name: '錫', emoji: '🔘', sourceFilter: `source LIKE 'Westmetall%'` },
  // 貴金屬
  { code: 'AU', name: '黃金', emoji: '🟡', sourceFilter: `1=1`  /* DB 尚無穩定 source,先不過濾;之後可在 UI 改 */ },
  { code: 'AG', name: '白銀', emoji: '⚪', sourceFilter: `1=1` },
  { code: 'PT', name: '鉑', emoji: '⚪', sourceFilter: `source='JohnsonMatthey'` },
  { code: 'PD', name: '鈀', emoji: '🟡', sourceFilter: `source='JohnsonMatthey'` },
  { code: 'RH', name: '銠', emoji: '⚫', sourceFilter: `source='JohnsonMatthey'` },
];

const THRESHOLD_PCT = 8;

// 3 個 schedule 套餐:cron + lookback_days + cooldown
const SCHEDULES = [
  { key: 'daily',   cron: '0 8 * * *',  lookback: 1,  cooldown: 24 * 60 },        // 每天 08:00
  { key: 'weekly',  cron: '0 8 * * 1',  lookback: 5,  cooldown: 7 * 24 * 60 },    // 每週一 08:00
  { key: 'monthly', cron: '0 8 1 * *',  lookback: 22, cooldown: 30 * 24 * 60 },   // 每月 1 號 08:00
];

// SQL template:取 metal 的「最新 + {{lookback_days}} 個交易日前」兩筆,排成 [base, current]
// sourceFilter 由 metal 設定帶入(基本金屬=Westmetall,PT/PD/RH=JM,AU/AG=不過濾)
function buildSqlTemplate(metalCode, sourceFilter) {
  return `SELECT price_usd FROM (
  SELECT price_usd, as_of_date,
         ROW_NUMBER() OVER (ORDER BY as_of_date DESC) rn
  FROM pm_price_history
  WHERE ${sourceFilter}
    AND metal_code='${metalCode}'
    AND price_usd IS NOT NULL
    AND price_usd > 0
) WHERE rn IN (1, {{lookback_days}} + 1)
ORDER BY as_of_date ASC`;
}

// 區分基本金屬 / 貴金屬 用於訊息與單位顯示
function isPreciousMetal(code) {
  return ['AU', 'AG', 'PT', 'PD', 'RH'].includes(code);
}

function buildRule(metal) {
  const ruleName = `[PM] ${metal.code} ${metal.name} 漲幅警示 (>${THRESHOLD_PCT}%)`;
  const precious = isPreciousMetal(metal.code);
  const unit = precious ? 'USD / oz' : 'USD / MT';
  const sourceDesc = precious
    ? (metal.code === 'PT' || metal.code === 'PD' || metal.code === 'RH'
        ? 'Johnson Matthey daily fix'
        : '台灣銀行 / 多源(請於 SQL 內過濾)')
    : 'Westmetall LME cash settlement';
  return {
    rule_name: ruleName,
    bound_to: 'standalone',
    entity_type: 'metal',
    entity_code: metal.code,
    data_source: 'sql_query',
    data_config: JSON.stringify({ sql: buildSqlTemplate(metal.code, metal.sourceFilter) }),
    comparison: 'rate_change',
    comparison_config: JSON.stringify({
      operator: 'abs',
      threshold_pct: THRESHOLD_PCT,
    }),
    severity: 'warning',
    actions: JSON.stringify([
      { type: 'alert_history' },
      { type: 'email', to: NOTIFY_EMAILS.slice() },
    ]),
    message_template:
      `${metal.emoji} **${metal.name}({{entity_code}})** 價格變動觸發警示\n` +
      `\n` +
      `• 當前報價:USD $\{{trigger_value}} (${unit})\n` +
      `• 基準價:USD $\{{threshold_value}} (${unit})\n` +
      `• 變動:{{reason}}\n` +
      `\n` +
      `資料源:${sourceDesc}(pm_price_history)`,
    use_llm_analysis: 0,
    cooldown_minutes: 1440,  // rule-level default,實際被 schedule.cooldown_minutes 蓋
    dedup_key: `pm_${metal.code.toLowerCase()}`,
    is_active: 1,
  };
}

function isoToOracleTs(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

(async () => {
  console.log(`Seed PM 漲跌幅警示規則 v2(11 條 rule × 3 schedules)`);
  console.log(`管理員帳號:${ADMIN_ACCOUNT}`);
  console.log(`通知信箱(${NOTIFY_EMAILS.length} 人):${NOTIFY_EMAILS.join(', ')}`);
  console.log(`砍 v1 (legacy rule): ${DELETE_V1}`);
  console.log(`砍 scheduled_tasks: ${DELETE_OLD_TASKS}`);
  console.log(`Sync 既有 rule 的 email: ${SYNC_EMAILS}`);
  console.log('═'.repeat(60));

  const db = await oracleDb.init();

  // 0. owner_user_id
  const adminRow = await db.prepare(
    `SELECT id FROM users WHERE UPPER(username)=UPPER(?) FETCH FIRST 1 ROWS ONLY`
  ).get(ADMIN_ACCOUNT);
  const adminId = adminRow?.id ?? adminRow?.ID;
  if (!adminId) {
    console.error(`找不到 admin user "${ADMIN_ACCOUNT}"`);
    process.exit(1);
  }
  console.log(`admin user_id = ${adminId}`);

  // 1. 確認 schema migration 已跑(alert_schedules 表存在)
  const tableCheck = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name='ALERT_SCHEDULES'`
  ).get();
  const tcnt = Number(tableCheck?.cnt ?? tableCheck?.CNT ?? 0);
  if (tcnt === 0) {
    console.error('❌ alert_schedules 表不存在 — server 必須先重啟跑 migration');
    process.exit(1);
  }
  console.log('✓ alert_schedules 表 ready\n');

  // 1.5. (選配)只 sync 既有 rule 的 email recipients,保留 webex/webhook 等其他 action
  if (SYNC_EMAILS) {
    const pmRules = await db.prepare(
      `SELECT id, rule_name, actions FROM alert_rules WHERE rule_name LIKE '[PM]%'`
    ).all();
    let synced = 0;
    for (const r of (pmRules || [])) {
      const ruleId = r.id ?? r.ID;
      const ruleName = r.rule_name ?? r.RULE_NAME;
      let actions;
      try {
        const raw = r.actions ?? r.ACTIONS;
        actions = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
      } catch (_) { actions = []; }
      if (!Array.isArray(actions)) actions = [];

      // 移除既有 email actions,以新 NOTIFY_EMAILS 替代;其他 action(alert_history/webex/webhook)保留
      const others = actions.filter(a => a?.type !== 'email');
      const hasAlertHistory = others.some(a => a?.type === 'alert_history');
      const newActions = [
        ...(hasAlertHistory ? [] : [{ type: 'alert_history' }]),
        ...others,
        { type: 'email', to: NOTIFY_EMAILS.slice() },
      ];
      await db.prepare(`UPDATE alert_rules SET actions=?, last_modified=SYSTIMESTAMP WHERE id=?`)
        .run(JSON.stringify(newActions), ruleId);
      synced++;
      console.log(`  📧 sync email "${ruleName}" → ${NOTIFY_EMAILS.length} 人`);
    }
    console.log(`\n✓ sync emails 完成 ${synced} 條 rule\n`);
  }

  // 2. (選配)砍 scheduled_tasks 舊 task
  if (DELETE_OLD_TASKS) {
    const oldNames = [
      '[PM] 貴金屬日漲幅警示(>8%)',
      '[PM] 貴金屬週漲幅警示(>8%)',
      '[PM] 貴金屬月漲幅警示(>8%)',
    ];
    for (const name of oldNames) {
      const r = await db.prepare(`DELETE FROM scheduled_tasks WHERE name=?`).run(name);
      const n = r?.rowsAffected ?? r?.changes ?? 0;
      if (n > 0) console.log(`  🗑️  DELETE scheduled_tasks "${name}" → ${n} 筆`);
    }
    console.log('');
  }

  // 3. (選配)砍 v1 9 條 legacy alert_rules(by name pattern)
  if (DELETE_V1) {
    const v1Names = [];
    for (const m of METALS) {
      v1Names.push(`[PM] ${m.code} ${m.name} 日漲幅警示 (>8%)`);
      v1Names.push(`[PM] ${m.code} ${m.name} 週漲幅警示 (>8%)`);
      v1Names.push(`[PM] ${m.code} ${m.name} 月漲幅警示 (>8%)`);
    }
    for (const name of v1Names) {
      // 先刪 schedules 子表(雖然 v1 rules 應該沒 schedules,但 ON DELETE CASCADE 也會處理)
      const r = await db.prepare(`DELETE FROM alert_rules WHERE rule_name=?`).run(name);
      const n = r?.rowsAffected ?? r?.changes ?? 0;
      if (n > 0) console.log(`  🗑️  DELETE v1 rule "${name}"`);
    }
    console.log('');
  }

  // 4. 預驗 cron 表達式
  for (const s of SCHEDULES) {
    if (!isSupportedCron(s.cron)) {
      console.error(`❌ cron "${s.cron}" 不被 cronNext 支援,abort`);
      process.exit(1);
    }
    const nf = nextFire(s.cron, new Date());
    console.log(`  schedule "${s.key}" cron "${s.cron}" → 下次: ${nf?.toISOString()} (lookback=${s.lookback}d)`);
  }
  console.log('');

  // 5. 對每個 metal 建 1 條 rule + 3 個 schedule
  const summary = [];
  for (const metal of METALS) {
    const rule = buildRule(metal);
    const existing = await db.prepare(
      `SELECT id FROM alert_rules WHERE rule_name=?`
    ).get(rule.rule_name);

    let ruleId;
    if (existing) {
      ruleId = existing.id ?? existing.ID;
      console.log(`  ⏭️  rule "${rule.rule_name}" 已存在 (id=${ruleId}) — skip INSERT`);
      summary.push({ name: rule.rule_name, action: 'skip', id: ruleId });
    } else {
      const r = await db.prepare(`
        INSERT INTO alert_rules (
          rule_name, owner_user_id, bound_to,
          entity_type, entity_code,
          data_source, data_config,
          comparison, comparison_config,
          severity, actions, message_template, use_llm_analysis,
          cooldown_minutes, dedup_key, is_active,
          creation_date, last_modified
        ) VALUES (
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          SYSTIMESTAMP, SYSTIMESTAMP
        )
      `).run(
        rule.rule_name, adminId, rule.bound_to,
        rule.entity_type, rule.entity_code,
        rule.data_source, rule.data_config,
        rule.comparison, rule.comparison_config,
        rule.severity, rule.actions, rule.message_template, rule.use_llm_analysis,
        rule.cooldown_minutes, rule.dedup_key, rule.is_active
      );
      ruleId = r?.lastInsertRowid;
      console.log(`  ✓  rule "${rule.rule_name}" 新增 (id=${ruleId})`);
      summary.push({ name: rule.rule_name, action: 'inserted', id: ruleId });
    }

    // 5a. 為該 rule 補 3 個 schedule(by schedule_key idempotent)
    for (const s of SCHEDULES) {
      const exSched = await db.prepare(
        `SELECT id FROM alert_schedules WHERE rule_id=? AND schedule_key=?`
      ).get(ruleId, s.key);
      if (exSched) {
        console.log(`    ⏭️  schedule "${s.key}" 已存在,skip`);
        continue;
      }
      const nextAt = nextFire(s.cron, new Date());
      const nextSql = isoToOracleTs(nextAt);
      await db.prepare(`
        INSERT INTO alert_schedules
          (rule_id, schedule_key, schedule_cron_expr, lookback_days,
           cooldown_minutes, is_active, next_evaluate_at)
        VALUES (?, ?, ?, ?, ?, 1, TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS'))
      `).run(ruleId, s.key, s.cron, s.lookback, s.cooldown, nextSql);
      console.log(`    ✓  schedule "${s.key}" 新增 (next=${nextAt.toISOString()})`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  const inserted = summary.filter(s => s.action === 'inserted').length;
  const skipped = summary.filter(s => s.action === 'skip').length;
  console.log(`rule inserted=${inserted}  skipped=${skipped}`);
  console.log(`\n3 條 rule 各掛 3 個 schedule(日/週/月)— Admin 介面看到 3 條入口,每條編輯時看到 3 個排程。`);
  console.log(`alertRuleScheduler 每分鐘 tick,依各 schedule.next_evaluate_at 跑,SQL {{lookback_days}} 自動替換。`);
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
