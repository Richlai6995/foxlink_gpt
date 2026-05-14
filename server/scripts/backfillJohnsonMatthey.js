'use strict';
/**
 * Johnson Matthey 貴金屬歷史 backfill — Pt / Pd / Rh(2008-01-01 至今)
 *
 * 跑法:
 *   node server/scripts/backfillJohnsonMatthey.js [--dry-run] [--metals=PT,PD]
 *   K8s pod:
 *   kubectl exec -n foxlink <pod> -- node /app/scripts/backfillJohnsonMatthey.js [--dry-run]
 *
 * --dry-run            : 只解析 + 印筆數,不寫 DB
 * --metals=PT,PD,RH    : 只跑指定金屬(預設跑全 3 種)
 * --force-range=A:B    : 先 DELETE 指定區間該 metal 的 row 再重塞(覆蓋壞資料)
 * --start=YYYY         : 指定起始年(預設 2008)
 *
 * 流程(關鍵):
 *   JM portlet API 區間 > 1 年會 server 端聚合成 monthly avg,所以必須「按年分段」拿 daily。
 *   1. 對每年 (start_year .. 今年):POST portlet endpoint 抓該年 Pt/Pd/Rh daily JSON
 *   2. 解析 metalList,以 metal_code 分組
 *   3. 撈 DB 既有 dates,過濾掉重複
 *   4. 排序 asc + 算 day_change_pct(銜接前一日從 DB 撈)
 *   5. INSERT(UNIQUE(metal_code, as_of_date, source) 保護)
 *   6. 每年間 sleep 1s 友善 JM
 *
 * 注意:JM 慣例「無 AM/PM 分」,一天一個 fix,price 多為整數;偶見小數(JM 當天多次更新平均)。
 *      照 parseFloat 原值存,不四捨五入。
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
if (!Number.isFinite(START_YEAR) || START_YEAR < 1990 || START_YEAR > 2100) {
  console.error('--start 必須 YYYY (1990-2100)'); process.exit(1);
}

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

// JM API metal code(camel) → 內部 DB code(大寫)+ 中文名
const METALS = [
  { code: 'PT', name: '鉑', jmCode: 'Pt' },
  { code: 'PD', name: '鈀', jmCode: 'Pd' },
  { code: 'RH', name: '銠', jmCode: 'Rh' },
].filter(m => !METALS_FILTER || METALS_FILTER.has(m.code));

const JM_ENDPOINT = 'https://matthey.com/products-and-markets/pgms-and-circularity/pgm-management'
  + '?p_p_id=jm_metal_price_portlet_JmMetalPricePortlet'
  + '&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_cacheability=cacheLevelPage';
const JM_PREFIX = '_jm_metal_price_portlet_JmMetalPricePortlet_';
const SOURCE = 'JohnsonMatthey';
const SOURCE_URL = 'https://matthey.com/products-and-markets/pgms-and-circularity/pgm-management';

// '31/01/2008' → '2008-01-31'
function parseJmDate(s) {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// '01-01-2008' format for JM POST body
function toJmFormat(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-');
  return `${d}-${m}-${y}`;
}

async function fetchYear(year, metalsForRequest) {
  const from = `01-01-${year}`;
  const to = `31-12-${year}`;
  const body = new URLSearchParams();
  // JM 接收 5 個 slot,我們最多 3 個 metal,其餘空字串
  for (let i = 0; i < 5; i++) {
    const jmCode = metalsForRequest[i]?.jmCode || '';
    body.append(`${JM_PREFIX}selectedMetal${i}`, jmCode);
  }
  body.append(`${JM_PREFIX}start_Date`, from);
  body.append(`${JM_PREFIX}end_Date`, to);

  const res = await fetch(JM_ENDPOINT, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Foxlink Cortex backfill) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for year=${year}`);
  const json = await res.json();
  if (json.status === 'Error') throw new Error(`JM API status=Error for year=${year}`);
  return Array.isArray(json.metalList) ? json.metalList : [];
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

async function insertOne(code, name, row, prevPrice) {
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
        ?, 'USD/oz', 1.0, 'Johnson Matthey PGM base price backfill', 0,
        'base', 'JM', ?,
        ?, ?
      )
    `).run(
      row.date, code, name,
      row.price,
      row.price,
      dayChg,
      SOURCE, SOURCE_URL
    );
    return 'inserted';
  } catch (e) {
    if (e.errorNum === 1 || /UNIQUE|ORA-00001/i.test(e.message || '')) {
      return 'duplicate';
    }
    throw e;
  }
}

async function backfillMetal(metal, allYearData) {
  console.log(`\n══ ${metal.code} ${metal.name} ══`);

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

  // 1. 從跨年資料抓該 metal、去重(同 date 取一筆)+ 排序 asc
  const byDate = new Map();
  for (const item of allYearData) {
    if (item.metalCode !== metal.jmCode) continue;
    const date = parseJmDate(item.metalValueDate);
    const price = parseFloat(item.price);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    // 同日多筆理論不會發生,保險取最後一筆
    byDate.set(date, { date, price });
  }
  const allRows = [...byDate.values()];
  allRows.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`JM 回傳 ${allRows.length} 個 trading day`);
  if (allRows.length === 0) {
    return { metal: metal.code, scraped: 0, inserted: 0, skipped: 0 };
  }

  // 2. 撈 DB 既有,過濾
  const existing = await getExistingDates(metal.code);
  console.log(`DB 既有 ${metal.code}@${SOURCE} 資料 ${existing.size} 筆`);
  const newRows = allRows.filter(r => !existing.has(r.date));
  console.log(`篩出 ${newRows.length} 筆 DB 沒有的`);
  if (newRows.length === 0) {
    console.log(`[${metal.code}] DB 已有全部歷史 — 不用 backfill`);
    return { metal: metal.code, scraped: allRows.length, inserted: 0, skipped: allRows.length };
  }

  console.log(`backfill 區間:${newRows[0].date} ~ ${newRows[newRows.length - 1].date}`);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] 略過 INSERT;sample:`);
    for (const r of newRows.slice(0, 3)) console.log(`  ${r.date}  price=${r.price}`);
    if (newRows.length > 6) console.log('  ...');
    for (const r of newRows.slice(-3)) console.log(`  ${r.date}  price=${r.price}`);
    return { metal: metal.code, scraped: allRows.length, inserted: 0, skipped: 0, dryRun: newRows.length };
  }

  // 3. INSERT
  let inserted = 0, duplicates = 0, errors = 0;

  // 銜接 prev price(DB 該 metal 第一筆 new 之前的最新 price)
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
      const result = await insertOne(metal.code, metal.name, r, prevPrice);
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
  console.log(`Johnson Matthey 歷史 backfill  ${DRY_RUN ? '(DRY-RUN)' : '(LIVE)'}`);
  console.log(`金屬:${METALS.map(m => m.code).join(', ')}`);
  console.log(`起始年:${START_YEAR}`);
  console.log('═'.repeat(60));

  console.log('Oracle pool 初始化中…');
  db = await oracleDb.init();
  console.log('Oracle pool ready');

  // 一次性按年抓全資料(JM > 1 年會 monthly aggregate,所以按年切)
  const currentYear = new Date().getUTCFullYear();
  const allData = [];
  const failed = [];
  for (let y = START_YEAR; y <= currentYear; y++) {
    process.stdout.write(`fetch ${y}… `);
    try {
      const rows = await fetchYear(y, METALS);
      allData.push(...rows);
      console.log(`${rows.length} rows`);
    } catch (e) {
      console.log(`FAIL ${e.message}`);
      failed.push({ year: y, error: e.message });
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (failed.length > 0) {
    console.log(`\nRetry ${failed.length} 個失敗年份…`);
    for (const f of failed.slice()) {
      process.stdout.write(`retry ${f.year}… `);
      try {
        const rows = await fetchYear(f.year, METALS);
        allData.push(...rows);
        console.log(`${rows.length} rows`);
        failed.splice(failed.indexOf(f), 1);
      } catch (e) {
        console.log(`FAIL again ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n總共抓到 ${allData.length} 個 metal-day records(${failed.length} 年 retry 後仍失敗)`);

  const summary = [];
  for (const metal of METALS) {
    try {
      const s = await backfillMetal(metal, allData);
      summary.push(s);
    } catch (e) {
      console.error(`[${metal.code}] FATAL:`, e.message);
      summary.push({ metal: metal.code, error: e.message });
    }
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
  if (failed.length > 0) {
    console.log(`\n⚠️  失敗年份:${failed.map(f => f.year).join(', ')}`);
  }
  console.log(`\n總耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
