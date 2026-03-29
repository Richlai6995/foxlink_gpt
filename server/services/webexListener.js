'use strict';

/**
 * Webex Bot Polling Listener
 *
 * 多 Pod 防重複：每則訊息處理前先搶 Redis lock (webex:msg:{id})
 * 搶不到的 Pod 直接略過，避免重複回應。
 * REDIS_URL 未設定時 fallback 到 MemoryStore（單 Pod 仍可用）。
 *
 * 策略：
 *   1. GET /v1/rooms?sortBy=lastactivity&max=200
 *      → 新 DM 房間排最前面，不需 cache，首次訊息 ≤ POLL_INTERVAL 即被發現
 *   2. filter: room.lastActivity > prevLastChecked
 *   3. GET /v1/messages?roomId={id}&max=50（翻頁直到碰舊訊息，不漏）
 *   4. 每則訊息：tryLock(webex:msg:{id}, 60s) → 搶到才處理
 */

const { getWebexService } = require('./webexService');
const { tryLock }         = require('./redisClient');

const POLL_INTERVAL  = parseInt(process.env.WEBEX_POLL_INTERVAL_MS || '8000', 10);
const ROOMS_PER_POLL = parseInt(process.env.WEBEX_ROOMS_PER_POLL   || '200',  10);
const MSGS_PAGE_SIZE = 50;
const MAX_PAGES      = 3;    // 最多翻 3 頁 = 150 筆/room/cycle
const MSG_LOCK_TTL   = 60;   // seconds — 訊息處理鎖的有效期

let _started     = false;
let _lastChecked = null;

function startPolling() {
  if (!process.env.WEBEX_BOT_TOKEN) {
    console.log('[WebexListener] WEBEX_BOT_TOKEN not set — polling disabled');
    return;
  }
  if (process.env.WEBEX_POLLING_ENABLED === 'false') {
    console.log('[WebexListener] Polling disabled by env (WEBEX_POLLING_ENABLED=false)');
    return;
  }
  if (_started) return;
  _started = true;

  _lastChecked = new Date(Date.now() - 30_000).toISOString();
  console.log(`[WebexListener] Polling started (interval=${POLL_INTERVAL}ms, redis-lock=enabled)`);

  setInterval(() => {
    pollOnce().catch(e => console.error('[WebexListener] Poll error:', e.message));
  }, POLL_INTERVAL);
}

async function pollOnce() {
  let webex;
  try { webex = getWebexService(); } catch { return; }

  const botPersonId     = await webex.getBotPersonId().catch(() => null);
  const prevLastChecked = _lastChecked;
  _lastChecked          = new Date().toISOString();

  // ── Step 1: 取最近活躍的 rooms ─────────────────────────────────────────────
  let rooms = [];
  try {
    const res = await webex.client.get('/rooms', {
      params: { max: ROOMS_PER_POLL, sortBy: 'lastactivity' },
    });
    rooms = res.data?.items || [];
  } catch (e) {
    console.error('[WebexListener] GET /rooms error:', e.response?.status, e.message);
    _lastChecked = prevLastChecked;
    return;
  }

  const activeRooms = rooms.filter(r => r.lastActivity > prevLastChecked);
  if (activeRooms.length === 0) return;

  console.log(`[WebexListener] ${activeRooms.length} active room(s)`);

  let handleWebexMessage;
  try {
    handleWebexMessage = require('../routes/webex').handleWebexMessage;
  } catch (e) {
    console.error('[WebexListener] Cannot load handleWebexMessage:', e.message);
    return;
  }

  // ── Step 2: 對每間 active room 拉訊息（翻頁）──────────────────────────────
  for (const room of activeRooms) {
    const newMsgs = [];
    let beforeMessage;
    let page = 0;

    while (page < MAX_PAGES) {
      page++;
      let msgs;
      try {
        const params = { roomId: room.id, max: MSGS_PAGE_SIZE };
        if (beforeMessage) params.beforeMessage = beforeMessage;
        const res = await webex.client.get('/messages', { params });
        msgs = res.data?.items || [];
      } catch (e) {
        console.warn(`[WebexListener] GET /messages room=${room.id} page=${page}:`, e.response?.status);
        break;
      }
      if (msgs.length === 0) break;

      const freshInPage = msgs.filter(m => m.created > prevLastChecked);
      newMsgs.push(...freshInPage);

      if (freshInPage.length < msgs.length) break; // 碰到舊訊息，停止翻頁
      beforeMessage = msgs[msgs.length - 1].id;    // 繼續翻下一頁
    }

    if (newMsgs.length === 0) continue;
    newMsgs.reverse(); // oldest-first

    console.log(`[WebexListener] room="${room.title?.slice(0, 20)}" → ${newMsgs.length} msg(s)`);

    for (const msg of newMsgs) {
      if (botPersonId && msg.personId === botPersonId) continue;

      // ── Redis distributed lock：多 Pod 只有一個搶到的才處理 ───────────────
      const lockKey = `webex:msg:${msg.id}`;
      let acquired = false;
      try {
        acquired = await tryLock(lockKey, MSG_LOCK_TTL);
      } catch (e) {
        console.warn('[WebexListener] tryLock error:', e.message);
        acquired = true; // Redis 掛了就讓每個 Pod 都處理（保守降級）
      }
      if (!acquired) {
        console.log(`[WebexListener] Skipped (lock held by another pod): msg=${msg.id}`);
        continue;
      }

      console.log(`[WebexListener] Dispatch: type=${msg.roomType} from="${msg.personEmail}" text="${(msg.text || '').slice(0, 60)}"`);

      setImmediate(() => {
        handleWebexMessage(msg).catch(e => {
          console.error('[WebexListener] handleWebexMessage error:', e.message);
        });
      });
    }
  }
}

module.exports = { startPolling };
