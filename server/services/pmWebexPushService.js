'use strict';

/**
 * PM Webex Push Service — Phase 5 Track C-3
 *
 * 排程定時(每分鐘檢查)→ 撈到 schedule_hhmm == 現在 hh:mm 的訂閱 → 發 Adaptive Card
 *
 * 防重複:last_sent_date == 今天日期 → skip(每天最多發一次,避免重啟後重發)
 *
 * 整合點:
 *   - server.js startPmWebexPushCron()
 *   - 訂閱 CRUD 走 /api/pm/subscriptions/* (見 routes/pmReview.js)
 */

const CHECK_EVERY_MS = 60 * 1000;            // 每分鐘檢查一次
const FIRST_RUN_DELAY_MS = 90 * 1000;        // 啟動 90s 後首次跑

let _interval = null;

function startPmWebexPushCron() {
  console.log('[PmWebexPush] Starting cron — checks every minute, fires when schedule_hhmm matches');
  setTimeout(() => tick().catch(e => console.error('[PmWebexPush] initial error:', e.message)), FIRST_RUN_DELAY_MS);
  _interval = setInterval(
    () => tick().catch(e => console.error('[PmWebexPush] tick error:', e.message)),
    CHECK_EVERY_MS,
  );
}

function stopPmWebexPushCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

async function tick() {
  const db = require('../database-oracle').db;
  if (!db) return;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayStr = now.toISOString().slice(0, 10);

  const subs = await db.prepare(`
    SELECT s.id, s.user_id, s.kind, s.target_room_id, s.last_sent_date,
           u.email, u.name, u.preferred_language, u.webex_bot_enabled
    FROM pm_webex_subscription s
    JOIN users u ON u.id = s.user_id
    WHERE s.is_active = 1 AND s.schedule_hhmm = ?
      AND (s.last_sent_date IS NULL OR s.last_sent_date <> ?)
      AND u.status = 'active' AND NVL(u.webex_bot_enabled, 1) = 1
  `).all(hhmm, todayStr);

  if (!subs || subs.length === 0) return;

  console.log(`[PmWebexPush] ${hhmm} — firing ${subs.length} subscription(s)`);
  for (const sub of subs) {
    try {
      await fireOne(db, sub);
      await db.prepare(`
        UPDATE pm_webex_subscription
        SET last_sent_at=SYSTIMESTAMP, last_sent_date=?
        WHERE id=?
      `).run(todayStr, sub.id);
    } catch (e) {
      console.error(`[PmWebexPush] sub#${sub.id} (user=${sub.user_id} kind=${sub.kind}) failed:`, e.message);
    }
  }
}

async function fireOne(db, sub) {
  const { getWebexService } = require('./webexService');
  const cards = require('./webexPmCards');
  const webex = getWebexService();
  const lang = sub.preferred_language || 'zh-TW';

  // 找 target room — 若 target_room_id 為空,從 webex_sessions 撈該 user 的 DM room
  let roomId = sub.target_room_id;
  if (!roomId) {
    const r = await db.prepare(`
      SELECT room_id FROM webex_sessions
      WHERE user_id = ? AND room_type='direct'
      ORDER BY last_active_at DESC NULLS LAST FETCH FIRST 1 ROWS ONLY
    `).get(sub.user_id);
    roomId = r?.room_id || r?.ROOM_ID || null;
  }
  if (!roomId) {
    console.warn(`[PmWebexPush] sub#${sub.id} no DM room (user 沒跟 bot 對過話?), skip`);
    return;
  }

  switch (sub.kind) {
    case 'daily_snapshot': {
      const rows = await db.prepare(`
        SELECT metal_code, price_usd, day_change_pct,
               TO_CHAR(MAX(as_of_date) OVER (), 'YYYY-MM-DD') AS latest_date
        FROM (
          SELECT metal_code,
                 FIRST_VALUE(price_usd) OVER (PARTITION BY metal_code ORDER BY as_of_date DESC) AS price_usd,
                 FIRST_VALUE(day_change_pct) OVER (PARTITION BY metal_code ORDER BY as_of_date DESC) AS day_change_pct,
                 as_of_date,
                 ROW_NUMBER() OVER (PARTITION BY metal_code ORDER BY as_of_date DESC) AS rn
          FROM pm_price_history
          WHERE metal_code IN ('Au','Ag','Pt','Pd','CU','AL','NI','ZN')
            AND as_of_date >= TRUNC(SYSDATE) - 7
            AND price_usd IS NOT NULL
        ) WHERE rn = 1
      `).all();
      if (!rows || rows.length === 0) {
        console.log(`[PmWebexPush] sub#${sub.id} no metal data, skip`);
        return;
      }
      const card = cards.buildSnapshotCard({
        metals: rows.map(r => ({
          metal_code: r.metal_code || r.METAL_CODE,
          price_usd: r.price_usd ?? r.PRICE_USD,
          day_change_pct: r.day_change_pct ?? r.DAY_CHANGE_PCT,
        })),
        asOfDate: rows[0].latest_date || rows[0].LATEST_DATE,
        lang,
      });
      await webex.sendCard(roomId, lang.startsWith('zh') ? '貴金屬今日快照' : 'Metals snapshot', card);
      console.log(`[PmWebexPush] sub#${sub.id} sent daily_snapshot to user=${sub.user_id}`);
      return;
    }
    default:
      console.warn(`[PmWebexPush] sub#${sub.id} unknown kind="${sub.kind}", skip`);
      return;
  }
}

module.exports = {
  startPmWebexPushCron,
  stopPmWebexPushCron,
};
