'use strict';
/**
 * LBMA 歷史 backfill — Au / Ag(2008-01-01 至今)
 *
 * 對齊既有架構:
 *   - 基本金屬(CU/AL/NI/ZN/PB/SN):Westmetall(LME)— backfillWestmetall.js
 *   - PGM(PT/PD/RH):Johnson Matthey — backfillJohnsonMatthey.js
 *   - 貴金屬 Au/Ag:LBMA(本檔)
 *
 * Endpoint(純 JSON,無防護):
 *   Gold PM Fix:https://prices.lbma.org.uk/json/gold_pm.json
 *   Silver Fix :https://prices.lbma.org.uk/json/silver.json
 *
 * 每筆:{ d: '2008-01-02', v: [USD, GBP, EUR] }  → 取 v[0] USD,unit='USD/oz'
 *
 * 跑法:
 *   node server/scripts/backfillLBMA.js [--dry-run] [--metals=AU,AG] [--start=YYYY] [--force-range=A:B]
 *   K8s pod:
 *   kubectl exec -n foxlink <pod> -- node /app/scripts/backfillLBMA.js
 *
 * Notes:
 *   - 早期(1968-2000s)某些 row v[0] 可能 null,自動過濾
 *   - source='LBMA' — alert_rules AU/AG 的 SQL 用 `1=1`(不過濾 source)會自動撈到
 *   - 用 Gold PM Fix(對齊 JM/LME 「日收盤」語意);如需 Gold AM 可改 endpoint
 */

try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); }
catch (_) { /* K8s pod 沒 dotenv */ }

let oracleDb;
try { oracleDb = require('../database-oracle'); }
catch (_) { oracleDb = require('/app/database-oracle'); }
let db = null;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const metalsArg = args.find(a => a.startsWith('--metals='));
const METALS_FILTER = metalsArg
  ? new Set(metalsArg.split('=')[1].split(',').map(s => s.trim().toUpperCase()))
  : null;

const startArg = args.find(a => a.startsWith('--start='));
const START_YEAR = startArg ? parseInt(startArg.split('=')[1], 10) : 2008;
if (!Number.isFinite(START_YEAR) || START_YEAR < 1968 || START_YEAR > 2100) {
  console.error('--start 必須 YYYY (1968-2100)'); process.exit(1);
}
const START_DATE = `${START_YEAR}-01-01`;

const forceRangeArg = args.find(a => a.startsWith('--force-range='));
let FORCE_RANGE = null;
if (forceRangeArg) {
  const v = forceRangeArg.split('=')[1] || '';
  const parts = v.split(':');
  if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
    console.error('--force-range 格式必須 YYYY-MM-DD:YYYY-MM-DD'); process.exit(1);
  }
  FORCE_RANGE = { from: parts[0], to: parts[1] };
}

const METALS = [
  { code: 'AU', name: '黃金', endpoint: 'https://prices.lbma.org.uk/json/gold_pm.json',
    conversionNote: 'LBMA Gold PM Fix backfill', priceType: 'pm_fix' },
  { code: 'AG', name: '白銀', endpoint: 'https://prices.lbma.org.uk/json/silver.json',
    conversionNote: 'LBMA Silver Fix backfill',    priceType: 'fix' },
].filter(m => !METALS_FILTER || METALS_FILTER.has(m.code));

const SOURCE = 'LBMA';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Foxlink Cortex backfill) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.json();
}

async function getExistingDates(code) {
  const rows = await db.prepare(`
    SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d
    FROM pm_price_history
    WHERE UPPER(metal_code) = UPPER(?)
      AND source = ?
    ORDER BY as_of_date
  `).all(code, SOURCE);
  const set = new Set();
  for (const r of rows) {
    const d = r.d || r.D;
    if (d) set.add(d);
  }
  return set;
}

async function insertOne(code, name, sourceUrl, priceType, conversionNote, row, prevPrice) {
  let dayChg = null;
  if (prevPrice != null && prevPrice > 0) {
    dayChg = Number((((row.price - prevPrice) / prevPrice) * 100).toFixed(2));
  }
  try {
    await db.prepare(`
      INSERT INTO pm_price_history (
        as_of_date, scraped_at, metal_code, metal_name,
        original_price, original_currency, original_unit,
        price_usd, unit, fx_rate_to_usd, conversion_note, is_estimated,
        price_type, market, day_change_pct,
        source, source_url
      ) VALUES (
        TO_DATE(?, 'YYYY-MM-DD'), SYSTIMESTAMP, ?, ?,
        ?, 'USD', 'USD/troy oz',
        ?, 'USD/oz', 1.0, ?, 0,
        ?, 'LBMA', ?,
        ?, ?
      )
    `).run(
      row.date, code, name,
      row.price,
      row.price,
      conversionNote,
      priceType,
      dayChg,
      SOURCE, sourceUrl
    );
    return 'inserted';
  } catch (e) {
    if (e.errorNum === 1 || /UNIQUE|ORA-00001/i.test(e.message || '')) {
      return 'duplicate';
    }
    throw e;
  }
}

async function backfillOne(metal) {
  console.log(`\n══ ${metal.code} ${metal.name} ══`);
  console.log(`URL: ${metal.endpoint}`);

  // 0. FORCE RANGE
  if (FORCE_RANGE) {
    if (DRY_RUN) {
      const cntRow = await db.prepare(`
        SELECT COUNT(*) AS cnt FROM pm_price_history
        WHERE UPPER(metal_code) = UPPER(?)
          AND source = ?
          AND as_of_date >= TO_DATE(?, 'YYYY-MM-DD')
          AND as_of_date <= TO_DATE(?, 'YYYY-MM-DD')
      `).get(metal.code, SOURCE, FORCE_RANGE.from, FORCE_RANGE.to);
      const cnt = Number(cntRow?.cnt ?? cntRow?.CNT ?? 0);
      console.log(`[${metal.code}] --force-range ${FORCE_RANGE.from}~${FORCE_RANGE.to} 會刪 ${cnt} 筆(dry-run skip)`);
    } else {
      const r = await db.prepare(`
        DELETE FROM pm_price_history
        WHERE UPPER(metal_code) = UPPER(?)
          AND source = ?
          AND as_of_date >= TO_DATE(?, 'YYYY-MM-DD')
          AND as_of_date <= TO_DATE(?, 'YYYY-MM-DD')
      `).run(metal.code, SOURCE, FORCE_RANGE.from, FORCE_RANGE.to);
      const deleted = r?.rowsAffected ?? r?.changes ?? 0;
      console.log(`[${metal.code}] --force-range ${FORCE_RANGE.from}~${FORCE_RANGE.to} 刪掉 ${deleted} 筆`);
    }
  }

  // 1. fetch
  let raw;
  try { raw = await fetchJson(metal.endpoint); }
  catch (e) {
    console.error(`[${metal.code}] fetch 失敗:`, e.message);
    return { metal: metal.code, scraped: 0, inserted: 0, skipped: 0, error: e.message };
  }
  if (!Array.isArray(raw)) {
    console.error(`[${metal.code}] response 不是 array`);
    return { metal: metal.code, scraped: 0, inserted: 0, skipped: 0 };
  }
  console.log(`LBMA 回 ${raw.length} 筆(含早期 1968-至今)`);

  // 2. parse + filter:date >= START_DATE,v[0] USD 必須有效
  const allRows = [];
  for (const item of raw) {
    if (!item || !item.d || !Array.isArray(item.v)) continue;
    if (item.d < START_DATE) continue;
    const usd = Number(item.v[0]);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    allRows.push({ date: item.d, price: usd });
  }
  console.log(`篩出 ${START_DATE} 後且 USD 有效:${allRows.length} 筆`);
  if (allRows.length === 0) {
    return { metal: metal.code, scraped: 0, inserted: 0, skipped: 0 };
  }

  // 3. 撈既有 DB dates,過濾
  const existing = await getExistingDates(metal.code);
  console.log(`DB 既有 ${metal.code}@${SOURCE} 資料 ${existing.size} 筆`);
  const newRows = allRows.filter(r => !existing.has(r.date));
  console.log(`篩出 ${newRows.length} 筆 DB 沒有的`);
  if (newRows.length === 0) {
    console.log(`[${metal.code}] DB 已有全部歷史 — 不用 backfill`);
    return { metal: metal.code, scraped: allRows.length, inserted: 0, skipped: allRows.length };
  }

  // 4. 排序 asc
  newRows.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`backfill 區間:${newRows[0].date} ~ ${newRows[newRows.length - 1].date}`);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] 略過 INSERT;sample:`);
    for (const r of newRows.slice(0, 3)) console.log(`  ${r.date}  price=${r.price}`);
    if (newRows.length > 6) console.log('  ...');
    for (const r of newRows.slice(-3)) console.log(`  ${r.date}  price=${r.price}`);
    return { metal: metal.code, scraped: allRows.length, inserted: 0, skipped: 0, dryRun: newRows.length };
  }

  // 5. INSERT — 算 day_change_pct,銜接 prev 從 DB 撈
  let inserted = 0, duplicates = 0, errors = 0;
  let prevPrice = null;
  try {
    const firstDate = newRows[0].date;
    const prevRow = await db.prepare(`
      SELECT price_usd FROM (
        SELECT price_usd FROM pm_price_history
        WHERE UPPER(metal_code) = UPPER(?)
          AND source = ?
          AND as_of_date < TO_DATE(?, 'YYYY-MM-DD')
          AND price_usd IS NOT NULL
        ORDER BY as_of_date DESC
      ) WHERE ROWNUM = 1
    `).get(metal.code, SOURCE, firstDate);
    const p = Number(prevRow?.price_usd ?? prevRow?.PRICE_USD);
    if (Number.isFinite(p) && p > 0) prevPrice = p;
  } catch (_) { /* 沒前一筆 → null */ }

  for (let i = 0; i < newRows.length; i++) {
    const r = newRows[i];
    try {
      const result = await insertOne(metal.code, metal.name, metal.endpoint, metal.priceType, metal.conversionNote, r, prevPrice);
      if (result === 'inserted') inserted++;
      else duplicates++;
      prevPrice = r.price;
    } catch (e) {
      errors++;
      if (errors <= 5) console.error(`[${metal.code}] INSERT ${r.date} 失敗:`, e.message);
    }
    if ((i + 1) % 500 === 0) {
      console.log(`  進度 ${i + 1}/${newRows.length}(inserted=${inserted} dup=${duplicates} err=${errors})`);
    }
  }

  console.log(`[${metal.code}] 完成:inserted=${inserted} duplicates=${duplicates} errors=${errors}`);
  return { metal: metal.code, scraped: allRows.length, inserted, duplicates, errors };
}

(async () => {
  const t0 = Date.now();
  console.log(`LBMA 歷史 backfill  ${DRY_RUN ? '(DRY-RUN)' : '(LIVE)'}`);
  console.log(`金屬:${METALS.map(m => m.code).join(', ')}`);
  console.log(`起始日:${START_DATE}`);
  console.log('═'.repeat(60));

  console.log('Oracle pool 初始化中…');
  db = await oracleDb.init();
  console.log('Oracle pool ready');

  const summary = [];
  for (const metal of METALS) {
    try {
      const s = await backfillOne(metal);
      summary.push(s);
    } catch (e) {
      console.error(`[${metal.code}] FATAL:`, e.message);
      summary.push({ metal: metal.code, error: e.message });
    }
    await new Promise(r => setTimeout(r, 1000));  // 對 LBMA 友善
  }

  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  for (const s of summary) {
    if (s.error) {
      console.log(`  ${s.metal}: ERROR ${s.error}`);
    } else if (s.dryRun != null) {
      console.log(`  ${s.metal}: scrape=${s.scraped}  會 insert=${s.dryRun}(dry-run)`);
    } else {
      console.log(`  ${s.metal}: scrape=${s.scraped}  inserted=${s.inserted}  duplicates=${s.duplicates}  errors=${s.errors}`);
    }
  }
  console.log(`\n總耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
