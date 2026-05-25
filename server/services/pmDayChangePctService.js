'use strict';

/**
 * PM day_change_pct 補算 Service(2026-05-25)
 *
 * 為什麼:[PM] 全網金屬資料收集 task 砍 TradingEconomics 後,LLM 輸出的
 * day_change_pct 一律是 null。改由 server 端用 SQL 從前一筆 LME / JM 收盤價
 * 自動補算 (today - prev) / prev * 100。
 *
 * 排程:每天台北時間 09:00 跑(master scrape 06:00 跑完後 3 小時,給 LLM 寫入
 * 留充足 buffer);啟動後 3 分鐘也跑一次(補歷史 NULL row + 第一次部署立即生效)。
 *
 * 補算範圍:所有 day_change_pct IS NULL 且 price_usd IS NOT NULL 的 row,
 * 不限日期(歷史 NULL 也順便補)。安全:price_usd <= 0 / prev 找不到的 row 不動。
 *
 * Trigger:
 *   - server.js startDayChangePctCron()
 *   - 手動:require('./pmDayChangePctService').runOnce()
 */

const RUN_HOUR_TPE = 9;                    // 台北 09:00 跑(master scrape 06:00 之後 3h buffer)
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;  // 啟動 3 分鐘後跑一次補歷史

let _timer = null;
let _lastRun = null;

function _msUntilNextRun() {
  // 算到下一個台北時間 09:00 的毫秒數
  const now = new Date();
  // Asia/Taipei = UTC+8(無 DST)
  const tpeNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const tpeTarget = new Date(tpeNow);
  tpeTarget.setUTCHours(RUN_HOUR_TPE, 0, 0, 0);
  if (tpeTarget <= tpeNow) tpeTarget.setUTCDate(tpeTarget.getUTCDate() + 1);
  return tpeTarget.getTime() - tpeNow.getTime();
}

function _scheduleNext() {
  const ms = _msUntilNextRun();
  _timer = setTimeout(async () => {
    try { await runOnce(); } catch (e) { console.error('[PmDayChangePct] daily error:', e.message); }
    _scheduleNext();
  }, ms);
  console.log(`[PmDayChangePct] Next run scheduled in ${Math.round(ms / 1000 / 60)}min (台北 09:00)`);
}

function startDayChangePctCron() {
  console.log('[PmDayChangePct] Starting daily 09:00 (Asia/Taipei) cron + initial 3-min catchup');
  setTimeout(
    () => runOnce().catch(e => console.error('[PmDayChangePct] initial error:', e.message)),
    FIRST_RUN_DELAY_MS,
  );
  _scheduleNext();
}

function stopDayChangePctCron() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

function getLastRunMeta() {
  return { lastRun: _lastRun };
}

/**
 * 補算 pm_price_history.day_change_pct(NULL → 從前一筆 same-metal 收盤價算 %)
 * @returns {{ updated: number, ranAt: string }}
 */
async function runOnce() {
  const db = require('../database-oracle').db;
  if (!db) return { ok: false };
  const startedAt = new Date();

  // 為什麼用 MERGE:Oracle MERGE 比 UPDATE+correlated subquery 快很多,
  // src 子查詢可以一次找出所有「有 prev 報價可算」的 row + 算好 %。
  //
  // 「前一筆」定義 = same metal_code,as_of_date < 本筆,price_usd IS NOT NULL,as_of_date 最大那筆
  // 限定 b.price_usd > 0 避免除 0 / 負數誤觸
  const sql = `
    MERGE INTO pm_price_history t
    USING (
      SELECT a.id,
             ROUND((a.price_usd - b.price_usd) / b.price_usd * 100, 4) AS chg
      FROM pm_price_history a
      JOIN pm_price_history b
        ON b.metal_code = a.metal_code
       AND b.as_of_date = (
             SELECT MAX(as_of_date) FROM pm_price_history
             WHERE metal_code = a.metal_code
               AND as_of_date < a.as_of_date
               AND price_usd IS NOT NULL
           )
      WHERE a.day_change_pct IS NULL
        AND a.price_usd IS NOT NULL
        AND a.price_usd > 0
        AND b.price_usd > 0
    ) src
    ON (t.id = src.id)
    WHEN MATCHED THEN UPDATE SET t.day_change_pct = src.chg
  `;

  let updated = 0;
  try {
    const r = await db.prepare(sql).run();
    updated = r.rowsAffected ?? r.changes ?? 0;
    _lastRun = { at: startedAt.toISOString(), updated };
    console.log(`[PmDayChangePct] Backfilled day_change_pct on ${updated} row(s)`);
  } catch (e) {
    console.error('[PmDayChangePct] MERGE failed:', e.message);
    _lastRun = { at: startedAt.toISOString(), updated: 0, error: e.message };
  }
  return { updated, ranAt: startedAt.toISOString() };
}

module.exports = {
  startDayChangePctCron,
  stopDayChangePctCron,
  getLastRunMeta,
  runOnce,
};
