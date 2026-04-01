'use strict';

/**
 * Webex Bot Polling Listener
 *
 * 多 Pod 防重複：
 *   - Leader election：每次 poll 前搶 Redis lock，只有 leader 執行 API 呼叫
 *   - 訊息級 lock：每則訊息處理前搶 Redis lock (webex:msg:{id})，防重複回應
 *   - 共享游標：_lastChecked 存 Redis，所有 pod 共享同一時間戳，避免 leader 輪轉時用舊值重撈
 *   - 429 退避：遇到 rate limit 自動指數退避（最長 2 分鐘）
 *
 * 策略：
 *   1. GET /v1/rooms?sortBy=lastactivity&max=200
 *      → 新 DM 房間排最前面，不需 cache，首次訊息 ≤ POLL_INTERVAL 即被發現
 *   2. filter: room.lastActivity > prevLastChecked
 *   3. GET /v1/messages?roomId={id}&max=50（翻頁直到碰舊訊息，不漏）
 *   4. 每則訊息：tryLock(webex:msg:{id}, 300s) → 搶到才處理
 */

const { getWebexService } = require('./webexService');
const { tryLock, getSharedValue, setSharedValue } = require('./redisClient');

const POLL_INTERVAL  = parseInt(process.env.WEBEX_POLL_INTERVAL_MS || '8000', 10);
const ROOMS_PER_POLL = parseInt(process.env.WEBEX_ROOMS_PER_POLL   || '200',  10);
const MSGS_PAGE_SIZE = 50;
const MAX_PAGES      = 3;    // 最多翻 3 頁 = 150 筆/room/cycle
const MSG_LOCK_TTL   = 300;  // seconds — 訊息處理鎖有效期（5 分鐘，涵蓋慢 AI 回應）
const LEADER_LOCK_KEY = 'webex:poll:leader';
const LEADER_LOCK_TTL = Math.max(Math.ceil(POLL_INTERVAL / 1000) * 2, 20); // 至少 20 秒
const CURSOR_KEY     = 'webex:poll:lastChecked';
const CURSOR_TTL     = 600;  // 10 min

let _started   = false;
let _backoffMs = 0;        // 429 退避時間
const BACKOFF_MAX = 120_000; // 最長退避 2 分鐘

/** 讀取共享游標（Redis），fallback 30 秒前 */
async function getLastChecked() {
  try {
    const val = await getSharedValue(CURSOR_KEY);
    if (val) return val;
  } catch {}
  return new Date(Date.now() - 30_000).toISOString();
}

/** 寫入共享游標到 Redis */
async function saveLastChecked(isoStr) {
  try {
    await setSharedValue(CURSOR_KEY, isoStr, CURSOR_TTL);
  } catch {}
}

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

  // 初始化共享游標
  saveLastChecked(new Date(Date.now() - 30_000).toISOString());

  console.log(`[WebexListener] Polling started (interval=${POLL_INTERVAL}ms, leader-lock=${LEADER_LOCK_TTL}s, msg-lock=${MSG_LOCK_TTL}s, cursor=redis-shared)`);

  setInterval(() => {
    pollOnce().catch(e => console.error('[WebexListener] Poll error:', e.message));
  }, POLL_INTERVAL);
}

async function pollOnce() {
  // ── 429 退避中：跳過本次 ──────────────────────────────────────────────────
  if (_backoffMs > 0) {
    _backoffMs = Math.max(0, _backoffMs - POLL_INTERVAL);
    return;
  }

  // ── Leader election：只有搶到 lock 的 pod 才執行 API 呼叫 ─────────────────
  let isLeader = false;
  try {
    isLeader = await tryLock(LEADER_LOCK_KEY, LEADER_LOCK_TTL);
  } catch {
    isLeader = true; // Redis 掛了就每個 pod 都跑（保守降級）
  }
  if (!isLeader) return; // 其他 pod 跳過

  let webex;
  try { webex = getWebexService(); } catch { return; }

  const botPersonId     = await webex.getBotPersonId().catch(() => null);
  const prevLastChecked = await getLastChecked();
  const nowIso          = new Date().toISOString();
  await saveLastChecked(nowIso); // 先更新游標，避免其他 pod 用舊值

  // ── Step 1: 取最近活躍的 rooms ─────────────────────────────────────────────
  let rooms = [];
  try {
    const res = await webex.client.get('/rooms', {
      params: { max: ROOMS_PER_POLL, sortBy: 'lastactivity' },
    });
    rooms = res.data?.items || [];
    _backoffMs = 0;
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) {
      _backoffMs = _backoffMs > 0 ? Math.min(_backoffMs * 2, BACKOFF_MAX) : 15_000;
      console.warn(`[WebexListener] 429 Rate limited — backing off ${_backoffMs / 1000}s`);
    } else {
      console.error('[WebexListener] GET /rooms error:', status, e.message);
    }
    await saveLastChecked(prevLastChecked); // 回滾游標
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
        const status = e.response?.status;
        if (status === 429) {
          _backoffMs = _backoffMs > 0 ? Math.min(_backoffMs * 2, BACKOFF_MAX) : 15_000;
          console.warn(`[WebexListener] 429 on /messages — backing off ${_backoffMs / 1000}s`);
          return;
        }
        console.warn(`[WebexListener] GET /messages room=${room.id} page=${page}:`, status);
        break;
      }
      if (msgs.length === 0) break;

      const freshInPage = msgs.filter(m => m.created > prevLastChecked);
      newMsgs.push(...freshInPage);

      if (freshInPage.length < msgs.length) break;
      beforeMessage = msgs[msgs.length - 1].id;
    }

    if (newMsgs.length === 0) continue;
    newMsgs.reverse(); // oldest-first

    console.log(`[WebexListener] room="${room.title?.slice(0, 20)}" → ${newMsgs.length} msg(s)`);

    for (const msg of newMsgs) {
      if (botPersonId && msg.personId === botPersonId) {
        console.log(`[WebexListener] Skipped bot own msg: id=${msg.id}`);
        continue;
      }

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
