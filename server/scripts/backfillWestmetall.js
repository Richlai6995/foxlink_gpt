'use strict';
/**
 * Westmetall 歷史 backfill — 6 個基本金屬 LME cash settlement(2008-至今)
 *
 * 跑法:
 *   node server/scripts/backfillWestmetall.js [--dry-run] [--metals=CU,AL]
 *   K8s pod:
 *   kubectl exec -n foxlink <pod> -- node /app/scripts/backfillWestmetall.js [--dry-run]
 *
 * --dry-run     : 只解析 + 印筆數,不寫 DB
 * --metals=...  : 只跑指定金屬(逗號分隔大寫 code),預設跑全 6 種
 *
 * 流程:
 *   1. 對每個金屬:fetch Westmetall HTML
 *   2. regex 解析所有 row(date / cash / 3month / stock)
 *   3. 撈 DB 該金屬既有 as_of_date,過濾掉重複
 *   4. 排序 asc + 算 day_change_pct
 *   5. batch INSERT(靠 UNIQUE constraint 保護,衝突 ORA-00001 → skip)
 *   6. 印 per-metal summary
 *
 * 注意:跑前 server 重啟過,確保 pm_price_history 有 UNIQUE(metal_code, as_of_date)
 *      若沒有 constraint,衝突也不會擋,可能重複 INSERT(雖然 pre-filter 應該防住,但保險起見)
 */

// 兼容 local + K8s 兩種位置
try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); }
catch (_) { /* K8s pod 沒 dotenv */ }

let oracleDb;
try { oracleDb = require('../database-oracle'); }
catch (_) { oracleDb = require('/app/database-oracle'); }
let db = null;  // 在 main() 開頭 await init() 後賦值

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const metalsArg = args.find(a => a.startsWith('--metals='));
const METALS_FILTER = metalsArg
  ? new Set(metalsArg.split('=')[1].split(',').map(s => s.trim().toUpperCase()))
  : null;

const METALS = [
  { code: 'CU', name: '銅', field: 'LME_Cu_cash' },
  { code: 'AL', name: '鋁', field: 'LME_Al_cash' },
  { code: 'NI', name: '鎳', field: 'LME_Ni_cash' },
  { code: 'ZN', name: '鋅', field: 'LME_Zn_cash' },
  { code: 'PB', name: '鉛', field: 'LME_Pb_cash' },
  { code: 'SN', name: '錫', field: 'LME_Sn_cash' },
].filter(m => !METALS_FILTER || METALS_FILTER.has(m.code));

const MONTH_MAP = {
  Jan: 0, January: 0,
  Feb: 1, February: 1,
  Mar: 2, March: 2,
  Apr: 3, April: 3,
  May: 4,
  Jun: 5, June: 5,
  Jul: 6, July: 6,
  Aug: 7, August: 7,
  Sep: 8, September: 8,
  Oct: 9, October: 9,
  Nov: 10, November: 10,
  Dec: 11, December: 11,
};

// '08. May 2026' → '2026-05-08'
function parseDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\.\s+(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const mon = MONTH_MAP[m[2]];
  if (mon == null) return null;
  return `${m[3]}-${String(mon + 1).padStart(2, '0')}-${day}`;
}

// '13,445.00' → 13445.00
function parseNumber(s) {
  if (!s) return null;
  const cleaned = String(s).trim().replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function fetchHtml(field) {
  const url = `https://www.westmetall.com/en/markdaten.php?action=table&field=${field}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Foxlink Cortex backfill) AppleWebKit/537.36',
      'Accept': 'text/html',
    },
    // 18 年表格約 1MB+,等久一點
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

// Westmetall HTML 結構:每筆 row 是 <tr> 含 4 個 <td>(date / cash / 3-month / stock)
// header row 是 <tr class="shaded">...<th>,不會被 td-only regex 抓到
function parseRows(html) {
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<\/tr>/gi;
  const out = [];
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const date = parseDate(m[1]);
    const cash = parseNumber(m[2]);
    const stock = parseNumber(m[4]);
    if (date && cash != null && cash > 0) {
      out.push({ date, cash_usd: cash, lme_stock: stock });
    }
  }
  return out;
}

async function getExistingDates(code) {
  const rows = await db.prepare(`
    SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d
    FROM pm_price_history
    WHERE UPPER(metal_code) = UPPER(?)
    ORDER BY as_of_date
  `).all(code);
  const set = new Set();
  for (const r of rows) {
    const d = r.d || r.D;
    if (d) set.add(d);
  }
  return set;
}

async function insertOne(code, name, sourceUrl, row, prevCash) {
  // day_change_pct vs prev(scrape series 內的前一日)
  let dayChg = null;
  if (prevCash != null && prevCash > 0) {
    dayChg = Number((((row.cash_usd - prevCash) / prevCash) * 100).toFixed(2));
  }

  try {
    await db.prepare(`
      INSERT INTO pm_price_history (
        as_of_date, scraped_at, metal_code, metal_name,
        original_price, original_currency, original_unit,
        price_usd, unit, fx_rate_to_usd, conversion_note, is_estimated,
        price_type, market, lme_stock, day_change_pct,
        source, source_url
      ) VALUES (
        TO_DATE(?, 'YYYY-MM-DD'), SYSTIMESTAMP, ?, ?,
        ?, 'USD', 'USD/MT',
        ?, 'USD/T', 1.0, 'Westmetall LME cash settlement backfill', 0,
        'settlement', 'LME', ?, ?,
        'Westmetall (LME backfill)', ?
      )
    `).run(
      row.date, code, name,
      row.cash_usd,
      row.cash_usd,
      row.lme_stock,
      dayChg,
      sourceUrl
    );
    return 'inserted';
  } catch (e) {
    // ORA-00001 unique violated → 重複,跳過(理論上 pre-filter 已過濾掉,這是保險絲)
    if (e.errorNum === 1 || /UNIQUE|ORA-00001/i.test(e.message || '')) {
      return 'duplicate';
    }
    throw e;
  }
}

async function backfillOne(metal) {
  const sourceUrl = `https://www.westmetall.com/en/markdaten.php?action=table&field=${metal.field}`;
  console.log(`\n══ ${metal.code} ${metal.name} ══`);
  console.log(`URL: ${sourceUrl}`);

  // 1. fetch
  let html;
  try {
    html = await fetchHtml(metal.field);
  } catch (e) {
    console.error(`[${metal.code}] fetch 失敗:`, e.message);
    return { metal: metal.code, scraped: 0, inserted: 0, skipped: 0, error: e.message };
  }
  console.log(`HTML size: ${(html.length / 1024).toFixed(1)} KB`);

  // 2. parse
  const allRows = parseRows(html);
  console.log(`解析到 ${allRows.length} 筆 row`);
  if (allRows.length === 0) {
    console.warn(`[${metal.code}] 0 筆 — HTML 結構可能變了,先檢查 page source`);
    return { metal: metal.code, scraped: 0, inserted: 0, skipped: 0 };
  }

  // 3. 撈既有 DB dates,過濾
  const existing = await getExistingDates(metal.code);
  console.log(`DB 既有 ${metal.code} 資料 ${existing.size} 筆`);
  const newRows = allRows.filter(r => !existing.has(r.date));
  console.log(`篩出 ${newRows.length} 筆 DB 沒有的`);
  if (newRows.length === 0) {
    console.log(`[${metal.code}] DB 已有全部歷史 — 不用 backfill`);
    return { metal: metal.code, scraped: allRows.length, inserted: 0, skipped: allRows.length };
  }

  // 4. 排序 asc(scrape HTML 是新→舊,反轉後算 day_change)
  newRows.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`backfill 區間:${newRows[0].date} ~ ${newRows[newRows.length - 1].date}`);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] 略過 INSERT;首末 5 筆 sample:`);
    for (const r of newRows.slice(0, 3)) {
      console.log(`  ${r.date}  cash=${r.cash_usd}  stock=${r.lme_stock}`);
    }
    if (newRows.length > 6) console.log('  ...');
    for (const r of newRows.slice(-3)) {
      console.log(`  ${r.date}  cash=${r.cash_usd}  stock=${r.lme_stock}`);
    }
    return { metal: metal.code, scraped: allRows.length, inserted: 0, skipped: 0, dryRun: newRows.length };
  }

  // 5. INSERT — 順序跑(對 4500 row 約 30 秒,可接受;executeMany 改進有空再做)
  let inserted = 0, duplicates = 0, errors = 0;
  let prevCash = null;
  // 為了 day_change_pct 正確,計算前一筆 cash 應該包含「DB 已有的 row」對應該日的前一日
  // 簡化版:只用本次 backfill series 內的 prev — boundary 銜接 DB row 那邊允許 null
  for (let i = 0; i < newRows.length; i++) {
    const r = newRows[i];
    try {
      const result = await insertOne(metal.code, metal.name, sourceUrl, r, prevCash);
      if (result === 'inserted') inserted++;
      else duplicates++;
      prevCash = r.cash_usd;
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
  console.log(`Westmetall 歷史 backfill  ${DRY_RUN ? '(DRY-RUN)' : '(LIVE)'}`);
  console.log(`金屬:${METALS.map(m => m.code).join(', ')}`);
  console.log('═'.repeat(60));

  // Oracle pool 初始化(同 server.js 啟動流程)
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
    // 對 Westmetall 友善 — 每金屬間隔 1 秒,別 hammer
    await new Promise(r => setTimeout(r, 1000));
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
