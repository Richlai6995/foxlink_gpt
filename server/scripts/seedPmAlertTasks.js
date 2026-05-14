'use strict';
/**
 * Seed PM 貴金屬漲跌幅警示排程(daily / weekly / monthly)
 *
 * 跑法:
 *   node server/scripts/seedPmAlertTasks.js
 *
 * 內容(idempotent by task name,重跑 skip):
 *   1. [PM] 貴金屬日漲幅警示(>8%)— daily 08:00, cooldown 24h
 *   2. [PM] 貴金屬週漲幅警示(>8%)— weekly Mon 08:00, cooldown 7d
 *   3. [PM] 貴金屬月漲幅警示(>8%)— monthly day1 08:00, cooldown 30d
 *
 * 每個 task pipeline:3 個 alert node(PT/PD/RH),
 *   data_source=sql_query 從 pm_price_history 取 [基準, 當前] array,
 *   comparison=rate_change abs threshold_pct=8,
 *   actions=alert_history + email(ADMIN_NOTIFY_EMAIL)。
 *
 * Status 預設 'paused' — 由 admin 在 /admin 排程頁手動 enable,可以順便檢查 / 補收件人。
 *
 * 注:scheduled_tasks 強制要過 LLM 一次,所以 prompt 寫個極短佔位(flash + 1-2 token output),
 *     alert node 用 sql_query 自取 DB,不依賴 LLM 輸出。
 */

try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); }
catch (_) { /* K8s pod 沒 dotenv */ }

let oracleDb;
try { oracleDb = require('../database-oracle'); }
catch (_) { oracleDb = require('/app/database-oracle'); }

const ADMIN_ACCOUNT = process.env.DEFAULT_ADMIN_ACCOUNT || 'ADMIN';
const NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'fl_support@foxlink.com.tw';

const METALS = [
  { code: 'PT', name: '鉑', emoji: '⚪' },
  { code: 'PD', name: '鈀', emoji: '🟡' },
  { code: 'RH', name: '銠', emoji: '⚫' },
];

const THRESHOLD_PCT = 8;
const SOURCE = 'JohnsonMatthey';

// rn=1 是當前最新,rn=Nback 是基準
// SELECT 結果要按 as_of_date ASC 排序(舊→新),這樣 array 最後一筆 = current,前面 = historical
function buildSql(metalCode, daysBack) {
  return `SELECT price_usd FROM (
  SELECT price_usd, as_of_date,
         ROW_NUMBER() OVER (ORDER BY as_of_date DESC) rn
  FROM pm_price_history
  WHERE source='${SOURCE}'
    AND metal_code='${metalCode}'
    AND price_usd IS NOT NULL
    AND price_usd > 0
) WHERE rn IN (1, ${daysBack + 1})
ORDER BY as_of_date ASC`;
}

function buildAlertNode(timeframe, metal, daysBack, cooldownMin) {
  const tfLabel = { daily: '日', weekly: '週', monthly: '月' }[timeframe];
  return {
    id: `alert_${timeframe}_${metal.code.toLowerCase()}`,
    type: 'alert',
    label: `${metal.code} ${metal.name} ${tfLabel}漲幅 > ${THRESHOLD_PCT}%`,
    data_source: 'sql_query',
    data_config: {
      sql: buildSql(metal.code, daysBack),
    },
    comparison: 'rate_change',
    comparison_config: {
      operator: 'abs',
      threshold_pct: THRESHOLD_PCT,
    },
    severity: 'warning',
    cooldown_minutes: cooldownMin,
    actions: [
      { type: 'alert_history' },
      { type: 'email', to: [NOTIFY_EMAIL] },
    ],
    message_template:
      `${metal.emoji} **${metal.name}(${metal.code})** ${tfLabel}價格變動觸發警示\n` +
      `\n` +
      `• 當前報價:USD $\{{trigger_value}} / oz\n` +
      `• 基準價(${daysBack} 交易日前):USD $\{{threshold_value}} / oz\n` +
      `• 變動:{{reason}}\n` +
      `\n` +
      `資料源:Johnson Matthey daily fix(pm_price_history)`,
    use_llm_analysis: false,
  };
}

function buildTask({ name, timeframe, scheduleType, hour, minute, weekday, monthday, daysBack, cooldownMin }) {
  const pipeline = METALS.map(m => buildAlertNode(timeframe, m, daysBack, cooldownMin));
  return {
    name,
    schedule_type: scheduleType,
    schedule_hour: hour,
    schedule_minute: minute,
    schedule_weekday: weekday,  // 1 = Monday (對齊既有 [PM] task 慣例)
    schedule_monthday: monthday,
    model: 'flash',
    prompt: '本任務由 alert node 直接查詢 DB 判斷漲跌幅,無需 AI 分析。請回「OK」即可。',
    output_type: 'text',
    recipients_json: JSON.stringify([]),  // task 不發 email,alert action 自己發
    email_subject: '',
    email_body: '',
    pipeline_json: JSON.stringify(pipeline),
    status: 'paused',  // 對齊既有慣例,admin 確認後 enable
  };
}

const TASKS = [
  buildTask({
    name: `[PM] 貴金屬日漲幅警示(>${THRESHOLD_PCT}%)`,
    timeframe: 'daily',
    scheduleType: 'daily',
    hour: 8, minute: 0,
    weekday: 1, monthday: 1,
    daysBack: 1,
    cooldownMin: 24 * 60,  // 24h
  }),
  buildTask({
    name: `[PM] 貴金屬週漲幅警示(>${THRESHOLD_PCT}%)`,
    timeframe: 'weekly',
    scheduleType: 'weekly',
    hour: 8, minute: 0,
    weekday: 1,  // Monday
    monthday: 1,
    daysBack: 5,  // 5 trading days = 1 week
    cooldownMin: 7 * 24 * 60,  // 7d
  }),
  buildTask({
    name: `[PM] 貴金屬月漲幅警示(>${THRESHOLD_PCT}%)`,
    timeframe: 'monthly',
    scheduleType: 'monthly',
    hour: 8, minute: 0,
    weekday: 1,
    monthday: 1,  // 每月 1 號
    daysBack: 22,  // 22 trading days ≈ 1 month
    cooldownMin: 30 * 24 * 60,  // 30d
  }),
];

(async () => {
  console.log(`Seed PM 漲跌幅警示排程`);
  console.log(`通知信箱:${NOTIFY_EMAIL}`);
  console.log(`管理員帳號:${ADMIN_ACCOUNT}`);
  console.log('═'.repeat(60));

  const db = await oracleDb.init();

  // 1. 取得 admin user id
  const adminRow = await db.prepare(
    `SELECT id FROM users WHERE UPPER(username)=UPPER(?) FETCH FIRST 1 ROWS ONLY`
  ).get(ADMIN_ACCOUNT);
  const adminId = adminRow?.id ?? adminRow?.ID;
  if (!adminId) {
    console.error(`找不到 admin user "${ADMIN_ACCOUNT}",請確認 .env DEFAULT_ADMIN_ACCOUNT`);
    process.exit(1);
  }
  console.log(`admin user_id = ${adminId}`);

  // 2. 對每個 task idempotent INSERT
  const summary = [];
  for (const t of TASKS) {
    const existing = await db.prepare(
      `SELECT id, status FROM scheduled_tasks WHERE name=?`
    ).get(t.name);
    if (existing) {
      const eid = existing.id ?? existing.ID;
      const est = existing.status ?? existing.STATUS;
      console.log(`  ⏭️  "${t.name}" 已存在 (id=${eid}, status=${est}) — skip`);
      summary.push({ name: t.name, action: 'skip', id: eid });
      continue;
    }

    const r = await db.prepare(`
      INSERT INTO scheduled_tasks (
        user_id, name,
        schedule_type, schedule_hour, schedule_minute, schedule_weekday, schedule_monthday,
        model, prompt,
        output_type, recipients_json, email_subject, email_body,
        pipeline_json, status,
        run_count, created_at, updated_at
      ) VALUES (
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        0, SYSTIMESTAMP, SYSTIMESTAMP
      )
    `).run(
      adminId, t.name,
      t.schedule_type, t.schedule_hour, t.schedule_minute, t.schedule_weekday, t.schedule_monthday,
      t.model, t.prompt,
      t.output_type, t.recipients_json, t.email_subject, t.email_body,
      t.pipeline_json, t.status
    );
    const newId = r?.lastID ?? r?.lastInsertRowid ?? null;
    console.log(`  ✓  "${t.name}" 新增 (status=${t.status})`);
    summary.push({ name: t.name, action: 'inserted', id: newId });
  }

  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  for (const s of summary) {
    console.log(`  [${s.action}] ${s.name}`);
  }
  console.log(`\n下一步:到 /admin 排程頁面 enable 三個 task (預設 paused)。`);
  console.log(`觸發測試:可在排程頁手動 Run Now 看 pm_alert_history 有沒有 INSERT。`);
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
