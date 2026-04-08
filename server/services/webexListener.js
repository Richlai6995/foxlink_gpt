'use strict';

/**
 * Webex Bot Listener — WebSocket mode (primary) + Polling fallback
 *
 * WebSocket 模式（預設）：
 *   - 透過 webex-node-bot-framework 建立 outbound websocket 到 Webex Mercury
 *   - 即時推送，延遲 < 1 秒
 *   - 一個 Bot Token 只能開一條 websocket，K8s 多 Pod 透過 Redis leader election 確保單一連線
 *
 * Polling 模式（fallback）：
 *   - 每 POLL_INTERVAL ms 輪詢 /rooms + /messages
 *   - Leader election + 訊息級 Redis lock 防重複
 *
 * 環境變數：
 *   WEBEX_MODE=websocket|polling  （預設 websocket）
 *   WEBEX_WS_RECONNECT_MAX=3      （websocket 連續失敗幾次後降級為 polling）
 *   WEBEX_POLL_INTERVAL_MS=8000
 *   WEBEX_ROOMS_PER_POLL=200
 *   WEBEX_POLLING_ENABLED=true|false （舊 env，polling mode 下仍可用）
 */

const { getWebexService } = require('./webexService');
const { tryLock, getSharedValue, setSharedValue } = require('./redisClient');

// ── 共用常數 ──────────────────────────────────────────────────────────────────
const MSG_LOCK_TTL = 300; // 訊息處理鎖 5 分鐘（涵蓋慢 AI 回應）

// ── WebSocket 模式常數 ───────────────────────────────────────────────────────
const WS_LEADER_LOCK_KEY = 'webex:ws:leader';
const WS_LEADER_LOCK_TTL = 30;            // 30 秒續約
const WS_LEADER_RENEW_MS = 10_000;        // 每 10 秒續約一次
const WS_RECONNECT_MAX = parseInt(process.env.WEBEX_WS_RECONNECT_MAX || '3', 10);

// ── Polling 模式常數 ─────────────────────────────────────────────────────────
const POLL_INTERVAL  = parseInt(process.env.WEBEX_POLL_INTERVAL_MS || '8000', 10);
const ROOMS_PER_POLL = parseInt(process.env.WEBEX_ROOMS_PER_POLL   || '200',  10);
const MSGS_PAGE_SIZE = 50;
const MAX_PAGES      = 3;
const POLL_LEADER_LOCK_KEY = 'webex:poll:leader';
const POLL_LEADER_LOCK_TTL = Math.max(Math.ceil(POLL_INTERVAL / 1000) * 2, 20);
const CURSOR_KEY     = 'webex:poll:lastChecked';
const CURSOR_TTL     = 600;

let _started = false;

// ══════════════════════════════════════════════════════════════════════════════
// WebSocket 模式
// ══════════════════════════════════════════════════════════════════════════════

let _framework = null;
let _wsRenewTimer = null;
let _wsFailCount = 0;

async function startWebSocket() {
  // Leader election：只有一個 Pod 可以開 websocket
  let isLeader = false;
  try {
    isLeader = await tryLock(WS_LEADER_LOCK_KEY, WS_LEADER_LOCK_TTL);
  } catch {
    isLeader = true; // Redis 掛了保守允許
  }

  if (!isLeader) {
    console.log('[WebexListener] WebSocket: another pod is leader, retrying in 15s...');
    setTimeout(() => startWebSocket().catch(e => console.error('[WebexListener] WS retry error:', e.message)), 15_000);
    return;
  }

  console.log('[WebexListener] WebSocket: this pod is leader, starting framework...');

  // 定期續約 leader lock
  _wsRenewTimer = setInterval(async () => {
    try {
      await setSharedValue(WS_LEADER_LOCK_KEY, '1', WS_LEADER_LOCK_TTL);
    } catch (e) {
      console.warn('[WebexListener] WS leader lock renew failed:', e.message);
    }
  }, WS_RENEW_MS);

  // 載入 polyfill（webex SDK 依賴 browser API）
  require('./webexPolyfill');
  const Framework = require('webex-node-bot-framework');

  let handleWebexMessage;
  try {
    handleWebexMessage = require('../routes/webex').handleWebexMessage;
  } catch (e) {
    console.error('[WebexListener] Cannot load handleWebexMessage:', e.message);
    return;
  }

  const webexService = getWebexService();
  const botPersonId = await webexService.getBotPersonId().catch(() => null);

  _framework = new Framework({
    token: process.env.WEBEX_BOT_TOKEN,
    maxStartupSpaces: 0, // 不預載房間，加速啟動
  });

  _framework.on('initialized', () => {
    console.log('[WebexListener] WebSocket connected via Mercury — listening for messages');
    _wsFailCount = 0; // 連線成功，重置失敗計數
  });

  _framework.on('spawn', (bot) => {
    // bot 被加入新房間時觸發（不做特殊處理）
  });

  // 監聯所有訊息
  _framework.hears(/.*/, async (bot, trigger) => {
    const message = trigger.message;

    // 過濾 bot 自己的訊息
    if (botPersonId && message.personId === botPersonId) return;

    // Redis 訊息鎖（防 websocket 重連時重複處理）
    const lockKey = `webex:msg:${message.id}`;
    let acquired = false;
    try {
      acquired = await tryLock(lockKey, MSG_LOCK_TTL);
    } catch {
      acquired = true; // Redis 故障保守降級
    }
    if (!acquired) {
      console.log(`[WebexListener] WS skipped (lock held): msg=${message.id}`);
      return;
    }

    console.log(`[WebexListener] WS dispatch: type=${message.roomType} from="${message.personEmail}" text="${(message.text || '').slice(0, 60)}"`);

    // 需要完整 message 物件（確保有 files 等欄位）
    let fullMessage = message;
    if (message.files && message.files.length > 0) {
      // websocket event 的 files 可能不完整，需要重新 GET
      try {
        fullMessage = await webexService.getMessage(message.id);
      } catch (e) {
        console.warn('[WebexListener] WS getMessage fallback error:', e.message);
        // 用原始 message 繼續
      }
    }

    setImmediate(() => {
      handleWebexMessage(fullMessage).catch(e => {
        console.error('[WebexListener] WS handleWebexMessage error:', e.message);
      });
    });
  }, 0); // priority 0 = highest

  // 錯誤處理
  _framework.on('error', (err) => {
    console.error('[WebexListener] Framework error:', err.message);
  });

  try {
    await _framework.start();
  } catch (e) {
    console.error('[WebexListener] WebSocket start failed:', e.message);
    _wsFailCount++;
    cleanupWebSocket();

    if (_wsFailCount >= WS_RECONNECT_MAX) {
      console.warn(`[WebexListener] WebSocket failed ${_wsFailCount} times, falling back to polling mode`);
      startPollingMode();
    } else {
      console.log(`[WebexListener] WebSocket retry ${_wsFailCount}/${WS_RECONNECT_MAX} in 10s...`);
      setTimeout(() => startWebSocket().catch(e2 => console.error('[WebexListener] WS retry error:', e2.message)), 10_000);
    }
  }
}

function cleanupWebSocket() {
  if (_wsRenewTimer) {
    clearInterval(_wsRenewTimer);
    _wsRenewTimer = null;
  }
  if (_framework) {
    try { _framework.stop(); } catch {}
    _framework = null;
  }
}

const WS_RENEW_MS = WS_LEADER_RENEW_MS;

// ══════════════════════════════════════════════════════════════════════════════
// Polling 模式（原有邏輯，保留為 fallback）
// ══════════════════════════════════════════════════════════════════════════════

let _backoffMs = 0;
const BACKOFF_MAX = 120_000;

async function getLastChecked() {
  try {
    const val = await getSharedValue(CURSOR_KEY);
    if (val) return val;
  } catch {}
  return new Date(Date.now() - 30_000).toISOString();
}

async function saveLastChecked(isoStr) {
  try {
    await setSharedValue(CURSOR_KEY, isoStr, CURSOR_TTL);
  } catch {}
}

function startPollingMode() {
  if (process.env.WEBEX_POLLING_ENABLED === 'false') {
    console.log('[WebexListener] Polling disabled by env');
    return;
  }

  saveLastChecked(new Date(Date.now() - 30_000).toISOString());
  console.log(`[WebexListener] Polling started (interval=${POLL_INTERVAL}ms)`);

  setInterval(() => {
    pollOnce().catch(e => console.error('[WebexListener] Poll error:', e.message));
  }, POLL_INTERVAL);
}

async function pollOnce() {
  if (_backoffMs > 0) {
    _backoffMs = Math.max(0, _backoffMs - POLL_INTERVAL);
    return;
  }

  let isLeader = false;
  try {
    isLeader = await tryLock(POLL_LEADER_LOCK_KEY, POLL_LEADER_LOCK_TTL);
  } catch {
    isLeader = true;
  }
  if (!isLeader) return;

  let webex;
  try { webex = getWebexService(); } catch { return; }

  const botPersonId     = await webex.getBotPersonId().catch(() => null);
  const prevLastChecked = await getLastChecked();
  const nowIso          = new Date().toISOString();
  await saveLastChecked(nowIso);

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
    await saveLastChecked(prevLastChecked);
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
    newMsgs.reverse();

    console.log(`[WebexListener] room="${room.title?.slice(0, 20)}" → ${newMsgs.length} msg(s)`);

    for (const msg of newMsgs) {
      if (botPersonId && msg.personId === botPersonId) continue;

      const lockKey = `webex:msg:${msg.id}`;
      let acquired = false;
      try {
        acquired = await tryLock(lockKey, MSG_LOCK_TTL);
      } catch {
        acquired = true;
      }
      if (!acquired) continue;

      console.log(`[WebexListener] Poll dispatch: type=${msg.roomType} from="${msg.personEmail}" text="${(msg.text || '').slice(0, 60)}"`);

      setImmediate(() => {
        handleWebexMessage(msg).catch(e => {
          console.error('[WebexListener] handleWebexMessage error:', e.message);
        });
      });
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 啟動入口
// ══════════════════════════════════════════════════════════════════════════════

function startListener() {
  if (!process.env.WEBEX_BOT_TOKEN) {
    console.log('[WebexListener] WEBEX_BOT_TOKEN not set — listener disabled');
    return;
  }
  if (_started) return;
  _started = true;

  const mode = (process.env.WEBEX_MODE || 'webhook').toLowerCase();

  switch (mode) {
    case 'webhook':
      // Webhook 模式：不啟動任何 listener，由 POST /api/webex/webhook 被動接收
      // 確認 webhook 已註冊：node server/scripts/registerWebhook.js
      console.log('[WebexListener] Mode: Webhook (passive — events received via POST /api/webex/webhook)');
      console.log(`[WebexListener] Public URL: ${process.env.WEBEX_PUBLIC_URL || '(not set)'}`);
      break;

    case 'websocket':
      console.log('[WebexListener] Mode: WebSocket (outbound Mercury)');
      startWebSocket().catch(e => {
        console.error('[WebexListener] WebSocket init error:', e.message);
        console.warn('[WebexListener] Falling back to polling mode');
        startPollingMode();
      });
      break;

    case 'polling':
      console.log('[WebexListener] Mode: Polling');
      startPollingMode();
      break;

    default:
      console.warn(`[WebexListener] Unknown WEBEX_MODE="${mode}", defaulting to webhook`);
      console.log('[WebexListener] Mode: Webhook (passive)');
      break;
  }
}

// 向後相容：舊的 startPolling 名稱
function startPolling() {
  startListener();
}

module.exports = { startListener, startPolling };
