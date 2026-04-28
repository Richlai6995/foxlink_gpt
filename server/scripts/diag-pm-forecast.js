/**
 * READ-ONLY 診斷:看 forecast_history 為什麼是空的
 *
 * Usage: node scripts/diag-pm-forecast.js
 *
 * 印出:
 *   1. forecast_history 統計 (total / by entity_type / by entity_code 最新)
 *   2. pm_price_history 最新 as_of_date 跟 11 金屬覆蓋情況
 *   3. 所有 [PM]% scheduled_tasks 的 status / model / 上次 run / 上次錯誤
 *   4. 對於 pipeline_json 包含 forecast_history 的 task,印 db_write 節點的 input/array_path/mapping 狀態
 *   5. forecast_timeseries_llm Skill 是否存在 + is_active
 *   6. pm_forecast_accuracy 統計(若 forecast_history 有資料,這表才會慢慢 build)
 */
'use strict';
require('dotenv').config();

const oracleDb = require('../database-oracle');

async function main() {
  await oracleDb.init();
  const db = oracleDb.db;

  console.log('\n══════════ 1. forecast_history 統計 ══════════');
  const fhTotal = await db.prepare(`SELECT COUNT(*) AS n FROM forecast_history`).get();
  console.log(`Total rows: ${fhTotal?.n ?? fhTotal?.N ?? 0}`);

  const fhByType = await db.prepare(`
    SELECT entity_type AS et, COUNT(*) AS n
    FROM forecast_history GROUP BY entity_type ORDER BY entity_type
  `).all();
  console.log('By entity_type:');
  console.table(fhByType.map(r => ({ entity_type: r.et || r.ET, rows: r.n || r.N })));

  const fhByMetal = await db.prepare(`
    SELECT entity_code AS code,
           COUNT(*) AS rows_n,
           TO_CHAR(MAX(forecast_date), 'YYYY-MM-DD') AS last_forecast,
           TO_CHAR(MAX(target_date),   'YYYY-MM-DD') AS last_target,
           MAX(model_used) AS last_model
    FROM forecast_history
    WHERE entity_type='metal'
    GROUP BY entity_code ORDER BY entity_code
  `).all();
  if (fhByMetal.length) {
    console.log('Metal forecast 覆蓋:');
    console.table(fhByMetal.map(r => ({
      code: r.code || r.CODE,
      rows: r.rows_n || r.ROWS_N,
      last_forecast: r.last_forecast || r.LAST_FORECAST,
      last_target:   r.last_target   || r.LAST_TARGET,
      model: (r.last_model || r.LAST_MODEL || '').slice(0, 30),
    })));
  } else {
    console.log('  (空 — 11 金屬都沒 forecast row)');
  }

  console.log('\n══════════ 2. pm_price_history 統計 ══════════');
  const phTotal = await db.prepare(`SELECT COUNT(*) AS n, TO_CHAR(MAX(as_of_date),'YYYY-MM-DD') AS d FROM pm_price_history`).get();
  console.log(`Total rows: ${phTotal?.n ?? phTotal?.N ?? 0}, latest as_of_date: ${phTotal?.d || phTotal?.D || '(none)'}`);
  const phByMetal = await db.prepare(`
    SELECT metal_code AS code, COUNT(*) AS rows_n,
           TO_CHAR(MIN(as_of_date),'YYYY-MM-DD') AS first_d,
           TO_CHAR(MAX(as_of_date),'YYYY-MM-DD') AS last_d
    FROM pm_price_history GROUP BY metal_code ORDER BY metal_code
  `).all();
  console.table(phByMetal.map(r => ({
    code: r.code || r.CODE,
    rows: r.rows_n || r.ROWS_N,
    first_date: r.first_d || r.FIRST_D,
    last_date:  r.last_d  || r.LAST_D,
  })));

  console.log('\n══════════ 3. [PM]% scheduled_tasks 狀態 ══════════');
  // schema 沒有 next_run_at / last_error 欄位,改用 last_run_at + last_run_status + 從 task_runs 撈最近 error_msg
  const tasks = await db.prepare(`
    SELECT id, name, status, model, schedule_type, schedule_hour, schedule_minute,
           TO_CHAR(last_run_at, 'YYYY-MM-DD HH24:MI') AS last_run,
           last_run_status, run_count
    FROM scheduled_tasks
    WHERE name LIKE '[PM]%'
    ORDER BY id
  `).all();
  if (!tasks.length) {
    console.log('  ⚠ 找不到任何 [PM]% task — pmScheduledTaskSeed 沒跑過 / 失敗?');
  } else {
    console.table(tasks.map(t => ({
      id: t.id || t.ID,
      name: (t.name || t.NAME || '').slice(0, 30),
      status: t.status || t.STATUS,
      type: t.schedule_type || t.SCHEDULE_TYPE,
      hh_mm: `${String(t.schedule_hour ?? t.SCHEDULE_HOUR ?? 0).padStart(2, '0')}:${String(t.schedule_minute ?? t.SCHEDULE_MINUTE ?? 0).padStart(2, '0')}`,
      last_run: t.last_run || t.LAST_RUN || '(never)',
      last_status: t.last_run_status || t.LAST_RUN_STATUS || '-',
      runs: t.run_count ?? t.RUN_COUNT ?? 0,
    })));

    // 對「[PM] 每日金屬日報」+「[PM] 全網金屬資料收集」撈最近 5 次 run 的 error
    for (const target of ['每日金屬日報', '全網金屬資料收集']) {
      const t = tasks.find(x => String(x.name || x.NAME || '').includes(target));
      if (!t) continue;
      const id = t.id || t.ID;
      const runs = await db.prepare(`
        SELECT TO_CHAR(run_at, 'YYYY-MM-DD HH24:MI:SS') AS r, status, duration_ms,
               SUBSTR(response_preview, 1, 120) AS prev,
               SUBSTR(error_msg, 1, 400) AS err
        FROM scheduled_task_runs WHERE task_id = ?
        ORDER BY run_at DESC FETCH FIRST 5 ROWS ONLY
      `).all(id);
      console.log(`\n  ── [PM] ${target} 最近 5 次 run ──`);
      if (!runs.length) { console.log('    (沒任何 run 紀錄 — task 從沒跑過)'); continue; }
      for (const r of runs) {
        console.log(`    ${r.r || r.R} | ${r.status || r.STATUS} | ${r.duration_ms || r.DURATION_MS || 0}ms`);
        if (r.err || r.ERR) console.log(`      ERR: ${(r.err || r.ERR).slice(0, 350)}`);
        else if (r.prev || r.PREV) console.log(`      preview: ${(r.prev || r.PREV).slice(0, 100)}`);
      }
    }
  }

  console.log('\n══════════ 4. db_write→forecast_history 節點檢查 ══════════');
  let forecastWriteFound = 0;
  for (const t of tasks) {
    const raw = t.pipeline_json || t.PIPELINE_JSON;
    let nodes;
    if (!raw) {
      const pjRow = await db.prepare(`SELECT pipeline_json FROM scheduled_tasks WHERE id=?`).get(t.id || t.ID);
      const pj = pjRow?.pipeline_json || pjRow?.PIPELINE_JSON;
      try { nodes = JSON.parse(typeof pj === 'string' ? pj : pj?.toString() || '[]'); } catch { continue; }
    } else {
      try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { continue; }
    }
    if (!Array.isArray(nodes)) continue;

    for (const n of nodes) {
      if (n?.type !== 'db_write') continue;
      if (String(n.table || '').toLowerCase() !== 'forecast_history') continue;
      forecastWriteFound++;
      const mappingCols = (n.column_mapping || []).map(m => m.column).join(', ');
      const hasOldPlaceholder = (n.column_mapping || []).some(m => m.column === '__expand__');
      console.log(`  Task #${t.id || t.ID} "${t.name || t.NAME}":`);
      console.log(`    array_path:  ${n.array_path || '(未設 — 將 fail!)'}`);
      console.log(`    operation:   ${n.operation}`);
      console.log(`    key_columns: ${(n.key_columns || []).join(', ')}`);
      console.log(`    columns(${(n.column_mapping || []).length}): ${mappingCols.slice(0, 100)}${mappingCols.length > 100 ? '…' : ''}`);
      if (hasOldPlaceholder) console.log(`    ⚠ 含舊 __expand__ placeholder — 跑 server reseed 可清掉`);
      if (n._note_for_admin) console.log(`    ⚠ _note_for_admin: ${String(n._note_for_admin).slice(0, 100)}`);
    }
  }
  if (forecastWriteFound === 0) {
    console.log('  ⊘ 沒任何 task 帶 db_write→forecast_history 節點');
  }

  console.log('\n══════════ 5. forecast_timeseries_llm Skill ══════════');
  const skill = await db.prepare(`SELECT id, name, type, is_public, is_admin_approved FROM skills WHERE UPPER(name)=UPPER(?)`).get('forecast_timeseries_llm');
  if (!skill) {
    console.log('  ⊘ 沒裝 — server 啟動時 autoSeedForecastSkill 應該會建,檢查啟動 log');
  } else {
    console.log(`  ✓ id=${skill.id || skill.ID}, type=${skill.type || skill.TYPE}, public=${skill.is_public || skill.IS_PUBLIC}, approved=${skill.is_admin_approved || skill.IS_ADMIN_APPROVED}`);
  }

  console.log('\n══════════ 6. pm_forecast_accuracy 統計 ══════════');
  const accCnt = await db.prepare(`SELECT COUNT(*) AS n FROM pm_forecast_accuracy`).get();
  console.log(`Total rows: ${accCnt?.n ?? accCnt?.N ?? 0}`);
  if ((accCnt?.n ?? accCnt?.N ?? 0) > 0) {
    const sample = await db.prepare(`
      SELECT entity_code AS code, COUNT(*) AS rows_n,
             ROUND(AVG(abs_pct_error), 2) AS avg_mape
      FROM pm_forecast_accuracy WHERE entity_type='metal'
      GROUP BY entity_code ORDER BY entity_code
    `).all();
    console.table(sample.map(r => ({
      code: r.code || r.CODE,
      rows: r.rows_n || r.ROWS_N,
      avg_mape_pct: r.avg_mape || r.AVG_MAPE,
    })));
  }

  console.log('\n══════════ 結論 + 下一步 ══════════');
  const fhRows = Number(fhTotal?.n ?? fhTotal?.N ?? 0);
  if (fhRows === 0) {
    console.log('  forecast_history 是空的 — 兩條路:');
    console.log('    A. 跑 backfill: npm run pm:backfill-forecasts');
    console.log('    B. 啟用 [PM] 每日金屬日報 task(status=enabled)等明天 18:00 自動跑(已修 array_path)');
  } else if (forecastWriteFound > 0) {
    console.log('  ✓ pipeline 已配,有 forecast 資料。重啟 server 後 array_path patch 會自動套(若舊 task 缺)');
  }
  console.log('');

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
