'use strict';

/**
 * PM Source Health Monitor — Phase 5 Track F-3
 *
 * 每 6h 跑一次,對 PM_SOURCES 內每個 URL 發 HEAD(失敗 fallback GET 前 1KB)
 * 並寫 pm_source_health 表。連續 3 次失敗 → email admin + 標 is_disabled=1。
 *
 * is_disabled 不影響任何業務流程(prompt 仍會嘗試),只給 admin UI 提示
 * 「該 source 應從 prompt 移除或修 URL」— 動 prompt 是人為決定。
 *
 * Trigger:
 *   - server.js startSourceHealthCron()
 *   - admin: POST /api/pm/admin/sources/check-now(手動)
 */

const FAILURE_THRESHOLD = 3;
const CHECK_EVERY_HOURS = 6;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;       // 啟動 2 分鐘後首次跑
const REQ_TIMEOUT_MS = 12 * 1000;
const ALERT_COOLDOWN_HOURS = 24;

let _interval = null;
let _lastRun = null;

function startSourceHealthCron() {
  console.log(`[PmSourceHealth] Starting cron — every ${CHECK_EVERY_HOURS}h`);
  setTimeout(() => runOnce().catch(e => console.error('[PmSourceHealth] initial error:', e.message)), FIRST_RUN_DELAY_MS);
  _interval = setInterval(
    () => runOnce().catch(e => console.error('[PmSourceHealth] error:', e.message)),
    CHECK_EVERY_HOURS * 60 * 60 * 1000,
  );
}

function stopSourceHealthCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

function getLastRunMeta() {
  return { lastRun: _lastRun };
}

async function runOnce() {
  const db = require('../database-oracle').db;
  if (!db) return { ok: false };
  const startedAt = new Date();
  const { PM_SOURCES } = require('./pmSourceList');

  // 確保每個 source 都有 row(idempotent seed)
  for (const s of PM_SOURCES) {
    try {
      const ex = await db.prepare(`SELECT id FROM pm_source_health WHERE source_url=?`).get(s.url);
      if (!ex) {
        await db.prepare(`
          INSERT INTO pm_source_health (source_url, source_label) VALUES (?, ?)
        `).run(s.url, s.label);
      }
    } catch (e) { console.warn('[PmSourceHealth] seed row failed:', e.message); }
  }

  let okCount = 0;
  let failCount = 0;
  let alertedCount = 0;

  for (const s of PM_SOURCES) {
    const result = await checkOne(s.url);
    try {
      const cur = await db.prepare(`
        SELECT consecutive_failures, last_alerted_at FROM pm_source_health WHERE source_url=?
      `).get(s.url);
      const prevFails = Number(cur?.consecutive_failures || 0);
      const lastAlertedAt = cur?.last_alerted_at;

      if (result.ok) {
        await db.prepare(`
          UPDATE pm_source_health
          SET last_check_at=SYSTIMESTAMP, last_status='ok', last_http_status=?,
              last_error=NULL, last_response_ms=?,
              consecutive_failures=0, is_disabled=0
          WHERE source_url=?
        `).run(result.httpStatus || null, result.responseMs || null, s.url);
        okCount++;
      } else {
        const newFails = prevFails + 1;
        const shouldDisable = newFails >= FAILURE_THRESHOLD ? 1 : 0;
        await db.prepare(`
          UPDATE pm_source_health
          SET last_check_at=SYSTIMESTAMP, last_status=?, last_http_status=?,
              last_error=?, last_response_ms=?,
              consecutive_failures=?, is_disabled=?
          WHERE source_url=?
        `).run(
          result.status,
          result.httpStatus || null,
          (result.error || '').slice(0, 1900),
          result.responseMs || null,
          newFails, shouldDisable,
          s.url,
        );
        failCount++;

        // alert(連續失敗 >= 閾值 + cooldown 過期)
        if (shouldDisable) {
          const cooldownMs = ALERT_COOLDOWN_HOURS * 60 * 60 * 1000;
          const timeSinceLastAlert = lastAlertedAt
            ? Date.now() - new Date(lastAlertedAt).getTime()
            : Infinity;
          if (timeSinceLastAlert > cooldownMs) {
            await sendAlert({ source: s, fails: newFails, error: result.error });
            await db.prepare(`UPDATE pm_source_health SET last_alerted_at=SYSTIMESTAMP WHERE source_url=?`).run(s.url);
            alertedCount++;
          }
        }
      }
    } catch (e) {
      console.warn('[PmSourceHealth] update row failed:', e.message);
    }
  }

  _lastRun = startedAt.toISOString();
  console.log(`[PmSourceHealth] Done — ok=${okCount} fail=${failCount} alerted=${alertedCount}`);
  return { ok: true, okCount, failCount, alertedCount };
}

async function checkOne(url) {
  const start = Date.now();
  try {
    // 先試 HEAD;若 405/501 改用 GET
    let resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
      headers: { 'User-Agent': 'Cortex-PM-HealthCheck/1.0' },
    }).catch(e => ({ _err: e }));

    if (resp?._err) {
      return classifyError(resp._err, Date.now() - start);
    }

    // HEAD 不被支援 → 改 GET (range 1KB)
    if (resp.status === 405 || resp.status === 501) {
      resp = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
        headers: { 'User-Agent': 'Cortex-PM-HealthCheck/1.0', 'Range': 'bytes=0-1024' },
      }).catch(e => ({ _err: e }));
      if (resp?._err) return classifyError(resp._err, Date.now() - start);
    }

    const responseMs = Date.now() - start;
    if (resp.status >= 200 && resp.status < 400) {
      return { ok: true, status: 'ok', httpStatus: resp.status, responseMs };
    }
    return {
      ok: false,
      status: resp.status >= 500 ? 'server_error' : 'client_error',
      httpStatus: resp.status,
      responseMs,
      error: `HTTP ${resp.status}`,
    };
  } catch (e) {
    return classifyError(e, Date.now() - start);
  }
}

function classifyError(err, responseMs) {
  const msg = err?.message || String(err);
  if (err?.name === 'TimeoutError' || /timeout|ETIMEDOUT/i.test(msg)) {
    return { ok: false, status: 'timeout', responseMs, error: msg };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
    return { ok: false, status: 'dns_fail', responseMs, error: msg };
  }
  if (/ECONNREFUSED|ECONNRESET|certificate|TLS/i.test(msg)) {
    return { ok: false, status: 'conn_fail', responseMs, error: msg };
  }
  return { ok: false, status: 'unknown_fail', responseMs, error: msg };
}

async function sendAlert({ source, fails, error }) {
  try {
    const { sendMail } = require('./mailService');
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;
    if (!adminEmail) {
      console.warn('[PmSourceHealth] ADMIN_NOTIFY_EMAIL not set, alert skipped');
      return;
    }
    const subject = `[PM][Source 失效] ${source.label} 連續 ${fails} 次失敗`;
    const html = `
      <h3>PM Source 健康監控警示</h3>
      <p><b>Source:</b> ${source.label}</p>
      <p><b>URL:</b> <a href="${source.url}">${source.url}</a></p>
      <p><b>連續失敗次數:</b> ${fails}</p>
      <p><b>最後錯誤:</b> ${(error || '(unknown)').slice(0, 500)}</p>
      <hr/>
      <p>系統已將此 source 標記為 <code>is_disabled=1</code>。
      建議至 admin /admin → 「PM 平台健康」頁查看,
      若需從 prompt 移除請手動編輯 <code>[PM] 全網金屬資料收集</code> 排程。</p>
    `;
    await sendMail({ to: adminEmail, subject, html });
    console.log(`[PmSourceHealth] Alert email sent for ${source.label}`);
  } catch (e) {
    console.error('[PmSourceHealth] Alert email failed:', e.message);
  }
}

module.exports = {
  startSourceHealthCron,
  stopSourceHealthCron,
  runOnce,
  getLastRunMeta,
};
