'use strict';

/**
 * Webex Bot Polling Listener
 *
 * Bot Token 限制：
 *   - GET /v1/events          → 403  (Compliance Officer only)
 *   - GET /v1/messages?mentionedPeople=me → 400 (personal token only)
 *
 * 正確方法：
 *   Step 1: GET /v1/rooms?max=1000
 *           → 回傳 Bot 所在所有房間，每間含 lastActivity
 *   Step 2: 過濾 lastActivity > prevLastChecked（通常只剩 0-2 間）
 *   Step 3: 對每間 active room: GET /v1/messages?roomId={id}&max=10
 *   Step 4: 過濾 created > prevLastChecked 的新訊息並處理
 *
 * 效率：只有真正有新訊息的房間才呼叫 messages API。
 */

const { getWebexService } = require('./webexService');

const POLL_INTERVAL     = parseInt(process.env.WEBEX_POLL_INTERVAL_MS || '8000', 10);
const ROOMS_CACHE_TTL   = parseInt(process.env.WEBEX_ROOMS_CACHE_TTL_MS || '60000', 10); // rooms list 快取
const MSGS_PER_ROOM     = 10; // 每間房間每次最多拉幾筆

let _started       = false;
let _lastChecked   = null;  // ISO string
let _roomsCache    = [];    // 快取的 rooms 清單
let _roomsCachedAt = 0;     // 快取時間 (ms)

function startPolling() {
  if (!process.env.WEBEX_BOT_TOKEN) {
    console.log('[WebexListener] WEBEX_BOT_TOKEN not set — polling disabled');
    return;
  }
  if (_started) return;
  _started = true;

  // 往前 30 秒，避免重啟漏訊息
  _lastChecked = new Date(Date.now() - 30_000).toISOString();

  console.log(`[WebexListener] Polling started (interval=${POLL_INTERVAL}ms, strategy=rooms+messages)`);

  setInterval(() => {
    pollOnce().catch(e => console.error('[WebexListener] Poll error:', e.message));
  }, POLL_INTERVAL);
}

async function pollOnce() {
  let webex;
  try { webex = getWebexService(); } catch { return; }

  const botPersonId      = await webex.getBotPersonId().catch(() => null);
  const prevLastChecked  = _lastChecked;
  _lastChecked           = new Date().toISOString();

  // ── Step 1: 取 rooms 清單（含 lastActivity），有快取則用快取 ────────────────
  const now = Date.now();
  if (now - _roomsCachedAt > ROOMS_CACHE_TTL) {
    try {
      const res = await webex.client.get('/rooms', { params: { max: 1000 } });
      _roomsCache    = res.data?.items || [];
      _roomsCachedAt = now;
      console.log(`[WebexListener] Rooms cache refreshed: ${_roomsCache.length} rooms`);
    } catch (e) {
      console.error('[WebexListener] GET /rooms error:', e.response?.status, e.message);
      _lastChecked = prevLastChecked; // rollback，下次補掃
      return;
    }
  }

  // ── Step 2: 只對 lastActivity 有更新的房間拉訊息 ───────────────────────────
  const activeRooms = _roomsCache.filter(r => r.lastActivity > prevLastChecked);
  if (activeRooms.length === 0) return;

  console.log(`[WebexListener] ${activeRooms.length} active room(s) of ${_roomsCache.length}`);

  let handleWebexMessage;
  try {
    handleWebexMessage = require('../routes/webex').handleWebexMessage;
  } catch (e) {
    console.error('[WebexListener] Cannot load handleWebexMessage:', e.message);
    return;
  }

  // ── Step 3 & 4: 拉訊息、過濾新訊息、派送 ────────────────────────────────────
  for (const room of activeRooms) {
    let msgs;
    try {
      const res = await webex.client.get('/messages', {
        params: { roomId: room.id, max: MSGS_PER_ROOM },
      });
      msgs = res.data?.items || [];
    } catch (e) {
      console.warn(`[WebexListener] GET /messages room=${room.id} error:`, e.response?.status, e.message);
      continue;
    }

    // items 是 newest-first；過濾出新訊息後 reverse 為 oldest-first
    const newMsgs = msgs
      .filter(m => m.created > prevLastChecked)
      .reverse();

    for (const msg of newMsgs) {
      // 過濾 Bot 自身訊息
      if (botPersonId && msg.personId === botPersonId) continue;

      console.log(`[WebexListener] Dispatch: id=${msg.id} room=${room.title?.slice(0,20)} type=${msg.roomType} from="${msg.personEmail}" text="${(msg.text || '').slice(0, 60)}"`);

      setImmediate(() => {
        handleWebexMessage(msg).catch(e => {
          console.error('[WebexListener] handleWebexMessage error:', e.message, e.stack);
        });
      });
    }
  }
}

module.exports = { startPolling };
