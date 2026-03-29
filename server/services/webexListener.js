'use strict';

/**
 * Webex Bot Polling Listener
 *
 * 採用輪詢（outbound polling）模式而非 Webhook（inbound），
 * 因為 flgpt.foxlink.com.tw 為內網，Webex Cloud 無法主動連線。
 *
 * 每 POLL_INTERVAL ms 呼叫 GET /v1/events?resource=messages&type=created
 * 取得新訊息後呼叫 handleWebexMessage(message)。
 *
 * 啟動: startPolling()  (由 server.js 呼叫)
 */

const { getWebexService } = require('./webexService');

const POLL_INTERVAL = parseInt(process.env.WEBEX_POLL_INTERVAL_MS || '5000', 10);

let _started = false;
let _lastChecked = null; // ISO string, 上次查詢時間

/**
 * 啟動輪詢。若 WEBEX_BOT_TOKEN 未設定則跳過。
 * 只啟動一次（多次呼叫 idempotent）。
 */
function startPolling() {
  if (!process.env.WEBEX_BOT_TOKEN) {
    console.log('[WebexListener] WEBEX_BOT_TOKEN not set — polling disabled');
    return;
  }
  if (_started) return;
  _started = true;

  // 起始時間往前 30 秒，避免剛重啟時漏掉訊息
  _lastChecked = new Date(Date.now() - 30_000).toISOString();

  console.log(`[WebexListener] Polling started (interval=${POLL_INTERVAL}ms, from=${_lastChecked})`);

  setInterval(() => {
    pollOnce().catch(e => {
      console.error('[WebexListener] Poll error:', e.message);
    });
  }, POLL_INTERVAL);
}

/**
 * 執行一次輪詢。
 * 取得自 _lastChecked 至 now 的新訊息，逐一呼叫 handleWebexMessage。
 */
async function pollOnce() {
  let webex;
  try {
    webex = getWebexService();
  } catch (e) {
    // token 未設定，靜默忽略
    return;
  }

  // 取得 bot 自身 personId（用來過濾自己發的訊息）
  const botPersonId = await webex.getBotPersonId().catch(() => null);

  const now = new Date().toISOString();
  const from = _lastChecked;
  _lastChecked = now;

  let res;
  try {
    res = await webex.client.get('/events', {
      params: {
        resource: 'messages',
        type: 'created',
        from,
        to: now,
      },
    });
  } catch (e) {
    console.error('[WebexListener] GET /events error:', e.response?.status, e.message);
    // 回滾時間，避免跳過這段區間
    _lastChecked = from;
    return;
  }

  const items = res.data?.items || [];
  if (items.length === 0) return;

  console.log(`[WebexListener] ${items.length} new event(s) since ${from}`);

  // 動態載入（避免 require 順序問題）
  let handleWebexMessage;
  try {
    handleWebexMessage = require('../routes/webex').handleWebexMessage;
  } catch (e) {
    console.error('[WebexListener] Cannot load handleWebexMessage:', e.message);
    return;
  }

  for (const event of items) {
    // 過濾 Bot 自身訊息
    if (botPersonId) {
      if (event.actorId === botPersonId) continue;
      if (event.data?.personId === botPersonId) continue;
    }

    // 取完整訊息
    const msgId = event.data?.id;
    if (!msgId) continue;

    let message;
    try {
      message = await webex.getMessage(msgId);
    } catch (e) {
      console.error(`[WebexListener] getMessage(${msgId}) error:`, e.message);
      continue;
    }

    console.log(`[WebexListener] Dispatch: id=${msgId} from="${message.personEmail}" text="${(message.text || '').slice(0, 60)}"`);

    // 背景處理，不 block 下一筆
    setImmediate(() => {
      handleWebexMessage(message).catch(e => {
        console.error('[WebexListener] handleWebexMessage error:', e.message, e.stack);
      });
    });
  }
}

module.exports = { startPolling };
