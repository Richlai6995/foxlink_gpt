'use strict';

/**
 * Webex Bot Polling Listener
 *
 * 策略：
 *   每次 poll:
 *   1. GET /v1/rooms?sortBy=lastactivity&max=200
 *      → 按最近活躍排序，新 DM 房間（lastActivity = 第一則訊息時間）
 *        會直接出現在最前面，不需要 cache / 等待發現
 *   2. filter: room.lastActivity > prevLastChecked
 *   3. 對每間 active room:
 *      GET /v1/messages?roomId={id}&max=50
 *      若 50 筆都是新的 → 繼續翻頁（beforeMessage pagination）
 *      直到碰到舊訊息為止，確保不漏訊息
 *
 * 延遲：新用戶第一則訊息 ≈ POLL_INTERVAL (預設 8s) + AI 時間
 * 容量：每個 active room 每次最多取 150 筆（3 頁），已足夠任何實際場景
 */

const { getWebexService } = require('./webexService');

const POLL_INTERVAL  = parseInt(process.env.WEBEX_POLL_INTERVAL_MS || '8000', 10);
const ROOMS_PER_POLL = parseInt(process.env.WEBEX_ROOMS_PER_POLL   || '200',  10);
const MSGS_PAGE_SIZE = 50;   // Webex API 每頁最大 50
const MAX_PAGES      = 3;    // 每間房間最多翻幾頁（150 筆），防爆

let _started     = false;
let _lastChecked = null; // ISO string

function startPolling() {
  if (!process.env.WEBEX_BOT_TOKEN) {
    console.log('[WebexListener] WEBEX_BOT_TOKEN not set — polling disabled');
    return;
  }
  if (_started) return;
  _started = true;

  // 往前 30 秒，避免重啟時漏掉剛發的訊息
  _lastChecked = new Date(Date.now() - 30_000).toISOString();

  console.log(`[WebexListener] Polling started (interval=${POLL_INTERVAL}ms)`);

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

  // ── Step 1: 取最近活躍的 rooms（sortBy=lastactivity）────────────────────────
  // 新 DM 的 lastActivity = 用戶第一則訊息時間，會排在最前面
  let rooms = [];
  try {
    const res = await webex.client.get('/rooms', {
      params: { max: ROOMS_PER_POLL, sortBy: 'lastactivity' },
    });
    rooms = res.data?.items || [];
  } catch (e) {
    console.error('[WebexListener] GET /rooms error:', e.response?.status, e.message);
    _lastChecked = prevLastChecked; // rollback
    return;
  }

  // ── Step 2: 只處理 lastActivity > prevLastChecked 的房間 ───────────────────
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

  // ── Step 3: 對每間 active room 拉訊息（支援翻頁，避免漏訊息）──────────────
  for (const room of activeRooms) {
    const newMsgs = [];
    let beforeMessage; // 翻頁游標（最舊那筆的 message ID）
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
        console.warn(`[WebexListener] GET /messages room=${room.id} page=${page} error:`, e.response?.status);
        break;
      }
      if (msgs.length === 0) break;

      // items 是 newest-first
      const freshInPage = msgs.filter(m => m.created > prevLastChecked);
      newMsgs.push(...freshInPage);

      // 如果這頁有部分是舊的 → 已經拉完所有新訊息，不需繼續翻頁
      if (freshInPage.length < msgs.length) break;

      // 整頁都是新的 → 可能還有更早的新訊息，繼續翻頁
      beforeMessage = msgs[msgs.length - 1].id; // 最舊那筆，下頁從這裡往前
    }

    if (newMsgs.length === 0) continue;

    // reverse: oldest-first，讓 AI 依序處理
    newMsgs.reverse();

    console.log(`[WebexListener] room="${room.title?.slice(0, 20)}" → ${newMsgs.length} new msg(s)${page > 1 ? ` (${page} pages)` : ''}`);

    for (const msg of newMsgs) {
      if (botPersonId && msg.personId === botPersonId) continue;

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
