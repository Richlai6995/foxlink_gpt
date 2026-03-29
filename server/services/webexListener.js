'use strict';

/**
 * Webex Bot Polling Listener
 *
 * GET /v1/events 是 Compliance Officer 專用（Bot Token 403）。
 * 正確做法：GET /v1/messages?mentionedPeople=me&max=50
 *   - Bot Token 有權限
 *   - DM：返回所有訊息（直接對話不需 @mention）
 *   - Group Room：返回 @mention Bot 的訊息
 *   - 返回最近 50 筆，newest-first；用 created 時間過濾新訊息
 *
 * 啟動: startPolling()  (由 server.js 呼叫)
 */

const { getWebexService } = require('./webexService');

const POLL_INTERVAL = parseInt(process.env.WEBEX_POLL_INTERVAL_MS || '8000', 10);
const POLL_MAX = 50; // 每次最多拉幾筆

let _started = false;
let _lastChecked = null; // ISO string，上次查詢截止時間

/**
 * 啟動輪詢。若 WEBEX_BOT_TOKEN 未設定則跳過。
 * 只啟動一次（idempotent）。
 */
function startPolling() {
  if (!process.env.WEBEX_BOT_TOKEN) {
    console.log('[WebexListener] WEBEX_BOT_TOKEN not set — polling disabled');
    return;
  }
  if (_started) return;
  _started = true;

  // 起始時間往前 30 秒，避免重啟時漏掉剛傳的訊息
  _lastChecked = new Date(Date.now() - 30_000).toISOString();

  console.log(`[WebexListener] Polling started (interval=${POLL_INTERVAL}ms, endpoint=messages?mentionedPeople=me)`);

  setInterval(() => {
    pollOnce().catch(e => {
      console.error('[WebexListener] Poll error:', e.message);
    });
  }, POLL_INTERVAL);
}

/**
 * 執行一次輪詢。
 * GET /v1/messages?mentionedPeople=me&max=50
 * 返回 newest-first；過濾出 created > _lastChecked 的項目處理。
 */
async function pollOnce() {
  let webex;
  try {
    webex = getWebexService();
  } catch (e) {
    return; // token 未設定，靜默忽略
  }

  // Bot 自身 personId（過濾自己發的訊息，避免無限迴圈）
  const botPersonId = await webex.getBotPersonId().catch(() => null);

  const prevLastChecked = _lastChecked;
  _lastChecked = new Date().toISOString(); // 先更新，避免錯誤時 rollback 造成重複處理

  let res;
  try {
    res = await webex.client.get('/messages', {
      params: {
        mentionedPeople: 'me',
        max: POLL_MAX,
      },
    });
  } catch (e) {
    console.error('[WebexListener] GET /messages error:', e.response?.status, e.message);
    _lastChecked = prevLastChecked; // rollback 時間，下次補掃
    return;
  }

  const items = res.data?.items || [];
  if (items.length === 0) return;

  // 過濾：只處理比上次時間點新的訊息；items 是 newest-first，reverse 後 oldest-first 處理
  const newItems = items
    .filter(m => m.created > prevLastChecked)
    .reverse();

  if (newItems.length === 0) return;

  console.log(`[WebexListener] ${newItems.length} new message(s) since ${prevLastChecked}`);

  let handleWebexMessage;
  try {
    handleWebexMessage = require('../routes/webex').handleWebexMessage;
  } catch (e) {
    console.error('[WebexListener] Cannot load handleWebexMessage:', e.message);
    return;
  }

  for (const msg of newItems) {
    // 過濾 Bot 自身訊息
    if (botPersonId && msg.personId === botPersonId) continue;

    console.log(`[WebexListener] Dispatch: id=${msg.id} from="${msg.personEmail}" room=${msg.roomType} text="${(msg.text || '').slice(0, 60)}"`);

    setImmediate(() => {
      handleWebexMessage(msg).catch(e => {
        console.error('[WebexListener] handleWebexMessage error:', e.message, e.stack);
      });
    });
  }
}

module.exports = { startPolling };
