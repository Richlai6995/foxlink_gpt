'use strict';

/**
 * Webex Bot Polling Listener
 *
 * Bot Token 限制：
 *   - GET /v1/events          → 403 (Compliance Officer only)
 *   - GET /v1/messages?mentionedPeople=me → 400 (personal token only)
 *
 * 策略：
 *   1. GET /v1/rooms  (快取 ROOMS_CACHE_TTL)
 *   2. 需要 poll 的房間：
 *      a. 既有房間：lastActivity > prevLastChecked
 *      b. 新發現的房間：立即 poll，用 _globalStart 為 threshold（不遺漏第一則訊息）
 *   3. GET /v1/messages?roomId={id}&max=10 → 過濾新訊息 → handleWebexMessage
 */

const { getWebexService } = require('./webexService');

const POLL_INTERVAL   = parseInt(process.env.WEBEX_POLL_INTERVAL_MS   || '8000', 10);
const ROOMS_CACHE_TTL = parseInt(process.env.WEBEX_ROOMS_CACHE_TTL_MS || '20000', 10);
const MSGS_PER_ROOM   = 10;

let _started         = false;
let _lastChecked     = null;  // ISO
let _globalStart     = null;  // ISO — 啟動時間，新房間回溯用
let _roomsCache      = [];
let _roomsCachedAt   = 0;
let _knownRoomIds    = null;  // Set<string>，null=尚未初始化
let _newRoomQueue    = [];    // 新發現但尚未 poll 的房間，下次一定 poll

function startPolling() {
  if (!process.env.WEBEX_BOT_TOKEN) {
    console.log('[WebexListener] WEBEX_BOT_TOKEN not set — polling disabled');
    return;
  }
  if (_started) return;
  _started = true;

  const start  = new Date(Date.now() - 30_000);
  _lastChecked = start.toISOString();
  _globalStart = start.toISOString();

  console.log(`[WebexListener] Polling started (interval=${POLL_INTERVAL}ms, roomsCacheTTL=${ROOMS_CACHE_TTL}ms)`);

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

  // ── Step 1: 刷新 rooms 快取 ────────────────────────────────────────────────
  const now = Date.now();
  if (now - _roomsCachedAt > ROOMS_CACHE_TTL) {
    try {
      const res   = await webex.client.get('/rooms', { params: { max: 1000 } });
      _roomsCache = res.data?.items || [];
      _roomsCachedAt = now;

      if (_knownRoomIds === null) {
        // 初次：全部視為已知，不回溯
        _knownRoomIds = new Set(_roomsCache.map(r => r.id));
        console.log(`[WebexListener] Rooms initialized: ${_roomsCache.length} rooms`);
      } else {
        // 找出新房間（新用戶第一次 DM bot 時產生）
        const newRooms = _roomsCache.filter(r => !_knownRoomIds.has(r.id));
        if (newRooms.length > 0) {
          console.log(`[WebexListener] ${newRooms.length} new room(s) discovered, queuing for immediate poll`);
          _newRoomQueue.push(...newRooms);
          newRooms.forEach(r => _knownRoomIds.add(r.id));
        }
      }
    } catch (e) {
      console.error('[WebexListener] GET /rooms error:', e.response?.status, e.message);
      _lastChecked = prevLastChecked;
      return;
    }
  }

  if (!_knownRoomIds) return;

  // ── Step 2: 決定哪些房間需要 poll ──────────────────────────────────────────
  const activeRooms = _roomsCache.filter(r => r.lastActivity > prevLastChecked);

  // 新發現的房間強制加入（即使 lastActivity 早於 prevLastChecked 也要掃）
  const newRoomsNow  = _newRoomQueue.splice(0);
  const newRoomIdSet = new Set(newRoomsNow.map(r => r.id));
  const roomsToPoll  = [
    ...activeRooms.filter(r => !newRoomIdSet.has(r.id)),
    ...newRoomsNow,
  ];

  if (roomsToPoll.length === 0) return;

  const newCount = newRoomsNow.length;
  console.log(`[WebexListener] Polling ${roomsToPoll.length} room(s) (${newCount} new) of ${_roomsCache.length}`);

  let handleWebexMessage;
  try {
    handleWebexMessage = require('../routes/webex').handleWebexMessage;
  } catch (e) {
    console.error('[WebexListener] Cannot load handleWebexMessage:', e.message);
    return;
  }

  // ── Step 3 & 4: 取訊息、過濾、派送 ──────────────────────────────────────────
  for (const room of roomsToPoll) {
    let msgs;
    try {
      const res = await webex.client.get('/messages', {
        params: { roomId: room.id, max: MSGS_PER_ROOM },
      });
      msgs = res.data?.items || [];
    } catch (e) {
      console.warn(`[WebexListener] GET /messages room=${room.id} error:`, e.response?.status);
      continue;
    }

    // 新發現的房間：用 _globalStart 為 threshold，確保第一則訊息不遺漏
    // 既有房間：用 prevLastChecked
    const threshold = newRoomIdSet.has(room.id) ? _globalStart : prevLastChecked;

    const newMsgs = msgs.filter(m => m.created > threshold).reverse(); // oldest-first

    for (const msg of newMsgs) {
      if (botPersonId && msg.personId === botPersonId) continue;

      console.log(`[WebexListener] Dispatch: room="${room.title?.slice(0, 20)}" type=${msg.roomType} from="${msg.personEmail}" text="${(msg.text || '').slice(0, 60)}"`);

      setImmediate(() => {
        handleWebexMessage(msg).catch(e => {
          console.error('[WebexListener] handleWebexMessage error:', e.message);
        });
      });
    }
  }
}

module.exports = { startPolling };
