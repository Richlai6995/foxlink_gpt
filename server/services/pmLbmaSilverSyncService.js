'use strict';

/**
 * PM LBMA Silver Daily Sync(2026-06-02)
 *
 * 為什麼:LBMA Silver JSON 4647+ 筆歷史,LLM fetch 工具拿到的 context 會被截斷,
 * 害 LLM 取「陣列最後一筆」常拿到 1971 年那種早期歷史 row 而非真實最新。改 server-side
 * 直接 fetch + parse 最後一筆,寫進 pm_price_history。
 *
 * 排程:每天台北時間 07:30 跑(LBMA Fix 通常 London 12:00 publish = TW 19:00,但隔天
 * 早上才 publish 到 JSON 也很常見,TW 07:30 抓比 06:00 master scrape 後 1.5h 跑保險)。
 * 啟動後 5 分鐘也跑一次。
 *
 * 寫入規則:沿用 backfillLBMA.js 的 insertOne 邏輯(同 source / unit / price_type),
 * 用 UPSERT 邏輯避免重複(看 (AG, as_of_date) 已存在就 skip)。
 *
 * Trigger:
 *   - server.js startLbmaSilverSyncCron()
 *   - 手動:require('./pmLbmaSilverSyncService').runOnce()
 */

const RUN_HOUR_TPE = 7;
const RUN_MIN_TPE = 30;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;  // 啟動 5 分鐘後跑一次

const LBMA_SILVER_ENDPOINT = 'https://prices.lbma.org.uk/json/silver.json';
const SOURCE = 'LBMA';

let _timer = null;
let _lastRun = null;

function _msUntilNextRun() {
  const now = new Date();
  const tpeNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const tpeTarget = new Date(tpeNow);
  tpeTarget.setUTCHours(RUN_HOUR_TPE, RUN_MIN_TPE, 0, 0);
  if (tpeTarget <= tpeNow) tpeTarget.setUTCDate(tpeTarget.getUTCDate() + 1);
  return tpeTarget.getTime() - tpeNow.getTime();
}

function _scheduleNext() {
  const ms = _msUntilNextRun();
  _timer = setTimeout(async () => {
    try { await runOnce(); } catch (e) { console.error('[PmLbmaSilver] daily error:', e.message); }
    _scheduleNext();
  }, ms);
  console.log(`[PmLbmaSilver] Next run scheduled in ${Math.round(ms / 1000 / 60)}min (台北 ${RUN_HOUR_TPE}:${String(RUN_MIN_TPE).padStart(2, '0')})`);
}

function startLbmaSilverSyncCron() {
  console.log(`[PmLbmaSilver] Starting daily ${RUN_HOUR_TPE}:${String(RUN_MIN_TPE).padStart(2, '0')} (Asia/Taipei) cron + initial 5-min catchup`);
  setTimeout(
    () => runOnce().catch(e => console.error('[PmLbmaSilver] initial error:', e.message)),
    FIRST_RUN_DELAY_MS,
  );
  _scheduleNext();
}

function stopLbmaSilverSyncCron() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

function getLastRunMeta() {
  return { lastRun: _lastRun };
}

/**
 * Fetch LBMA Silver JSON + 取真實「最後一筆 USD 有效」row,upsert 進 pm_price_history
 * @returns {{ inserted: 0|1, skipped: 0|1, latestDate?: string, latestPrice?: number }}
 */
async function runOnce() {
  const db = require('../database-oracle').db;
  if (!db) return { ok: false };
  const startedAt = new Date();

  let raw;
  try {
    const res = await fetch(LBMA_SILVER_ENDPOINT, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Foxlink Cortex sync) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    console.error('[PmLbmaSilver] fetch failed:', e.message);
    _lastRun = { at: startedAt.toISOString(), error: e.message };
    return { error: e.message };
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    console.error('[PmLbmaSilver] LBMA JSON 不是 array 或空');
    return { error: 'invalid_shape' };
  }

  // 從 array 尾端往前找:第一個 v[0] (USD) 有效的 row
  // 為什麼:早期 row 可能 v[0]=null(只有 GBP/EUR);array sorted asc 所以最後幾筆是最新
  let latest = null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const item = raw[i];
    if (!item || !item.d || !Array.isArray(item.v)) continue;
    const usd = Number(item.v[0]);
    if (Number.isFinite(usd) && usd > 0) {
      latest = { date: item.d, price: usd };
      break;
    }
  }

  if (!latest) {
    console.error('[PmLbmaSilver] LBMA JSON 找不到 USD 有效 row');
    return { error: 'no_valid_usd' };
  }

  // 撈 (AG, latest.date) 是否已存在
  let existing;
  try {
    existing = await db.prepare(`
      SELECT id FROM pm_price_history
      WHERE UPPER(metal_code) = 'AG'
        AND as_of_date = TO_DATE(?, 'YYYY-MM-DD')
        AND source = ?
    `).get(latest.date, SOURCE);
  } catch (e) {
    console.error('[PmLbmaSilver] dedup check failed:', e.message);
    return { error: e.message };
  }

  if (existing && (existing.id || existing.ID)) {
    console.log(`[PmLbmaSilver] (AG, ${latest.date}) 已存在,skip insert`);
    _lastRun = { at: startedAt.toISOString(), skipped: 1, latestDate: latest.date };
    return { inserted: 0, skipped: 1, latestDate: latest.date, latestPrice: latest.price };
  }

  // 算 day_change_pct(跟 DB 既有上一筆 AG@LBMA 算)
  let prevPrice = null;
  try {
    const prevRow = await db.prepare(`
      SELECT price_usd FROM (
        SELECT price_usd FROM pm_price_history
        WHERE UPPER(metal_code) = 'AG'
          AND source = ?
          AND as_of_date < TO_DATE(?, 'YYYY-MM-DD')
          AND price_usd IS NOT NULL
        ORDER BY as_of_date DESC
      ) WHERE ROWNUM = 1
    `).get(SOURCE, latest.date);
    const p = Number(prevRow?.price_usd ?? prevRow?.PRICE_USD);
    if (Number.isFinite(p) && p > 0) prevPrice = p;
  } catch (_) {}

  let dayChg = null;
  if (prevPrice != null && prevPrice > 0) {
    dayChg = Number((((latest.price - prevPrice) / prevPrice) * 100).toFixed(2));
  }

  // INSERT(沿用 backfillLBMA.js 的格式)
  try {
    await db.prepare(`
      INSERT INTO pm_price_history (
        as_of_date, scraped_at, metal_code, metal_name,
        original_price, original_currency, original_unit,
        price_usd, unit, fx_rate_to_usd, conversion_note, is_estimated,
        price_type, market, day_change_pct,
        source, source_url
      ) VALUES (
        TO_DATE(?, 'YYYY-MM-DD'), SYSTIMESTAMP, 'AG', '白銀',
        ?, 'USD', 'USD/troy oz',
        ?, 'USD/oz', 1.0, 'LBMA Silver Fix daily sync', 0,
        'fix', 'LBMA', ?,
        ?, ?
      )
    `).run(
      latest.date,
      latest.price,
      latest.price,
      dayChg,
      SOURCE,
      LBMA_SILVER_ENDPOINT,
    );
    console.log(`[PmLbmaSilver] Inserted AG ${latest.date} = ${latest.price} USD/oz (D%=${dayChg ?? 'null'})`);
    _lastRun = { at: startedAt.toISOString(), inserted: 1, latestDate: latest.date, latestPrice: latest.price };
    return { inserted: 1, skipped: 0, latestDate: latest.date, latestPrice: latest.price };
  } catch (e) {
    console.error('[PmLbmaSilver] INSERT failed:', e.message);
    _lastRun = { at: startedAt.toISOString(), error: e.message };
    return { error: e.message };
  }
}

module.exports = {
  startLbmaSilverSyncCron,
  stopLbmaSilverSyncCron,
  getLastRunMeta,
  runOnce,
};
