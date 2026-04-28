'use strict';

/**
 * PM Retention Cleanup
 *
 * 依 system_settings.pm_retention_days(JSON map)定期清理:
 *   - pm_news + PM-新聞庫(KB doc + chunks)— 同步,避免脫節
 *   - PM-原始資料庫(KB doc + chunks)
 *   - PM-分析庫(KB doc + chunks)+ pm_analysis_report
 *   - pm_price_history / pm_macro_history / forecast_history / pm_alert_history
 *
 * Admin 設定 null / 空 = 永久保留(不清)。
 *
 * Cron 預設凌晨 3:00 跑一次(避開新聞/全網收集 6:00,避開使用者尖峰)。
 *
 * 介面:
 *   getConfig(db)               → 讀 settings + merge defaults + 各 entity 統計(總筆/最舊日期)
 *   setConfig(db, config)       → 寫回 system_settings
 *   previewCleanup(db, config?) → dry-run,回每 entity 會砍幾筆 / 不會碰幾筆
 *   runCleanup(db, config?)     → 真的 DELETE
 *   startScheduler(db)          → 註冊 daily cron
 *   stopScheduler()
 */

const cron = require('node-cron');

const SETTING_KEY = 'pm_retention_days';
const SETTING_KEY_ENABLED = 'pm_retention_auto_enabled';
const SETTING_KEY_HOUR    = 'pm_retention_auto_hour';
const SETTING_KEY_MINUTE  = 'pm_retention_auto_minute';

// ── 預設保留天數 ──────────────────────────────────────────────────────────
// null = 永久保留(不會被自動清)。admin 在 UI 改值會覆蓋。
const DEFAULTS = Object.freeze({
  pm_news:          180,  // 半年
  kb_raw:           14,   // 報價快照短期參考
  kb_analysis:      null, // LLM 日/週/月報,趨勢分析用,永久
  pm_price_history: null, // 趨勢圖表必要
  pm_macro_history: null, // 同上
  forecast_history: 90,   // 過了只是回顧驗證
  pm_alert_history: 180,  // 半年警示記錄
});

// ── Entity 定義 ───────────────────────────────────────────────────────────
// 每個 target 帶:label / 計算「會清掉幾筆 + 最舊日期 + 總筆」的 SELECT,以及實際清理 fn
// KB 類的清理會連帶 kb_chunks + 重算 knowledge_bases stats
const TARGETS = [
  {
    key: 'pm_news',
    label: '新聞 + PM-新聞庫(同步清,避免 SUMMARY 點開找不到 KB 全文)',
    kbName: 'PM-新聞庫',
    countOlderSql: `
      SELECT COUNT(*) AS n,
             TO_CHAR(MIN(COALESCE(published_at, scraped_at, creation_date)), 'YYYY-MM-DD') AS oldest
        FROM pm_news
       WHERE COALESCE(published_at, scraped_at, creation_date) < SYSDATE - ?`,
    countTotalSql: `SELECT COUNT(*) AS n FROM pm_news`,
    runCleanup: async (db, days) => {
      // 1. 撈 KB id
      const kbRow = await db.prepare(`SELECT id FROM knowledge_bases WHERE name='PM-新聞庫'`).get();
      const kbId = kbRow?.id || kbRow?.ID;

      // 2. 算待砍 row 的 url_hash(用 pm_news 為主,順便 join 對應的 KB doc)
      const oldHashRows = await db.prepare(`
        SELECT url_hash FROM pm_news
         WHERE COALESCE(published_at, scraped_at, creation_date) < SYSDATE - ?
      `).all(days);
      const hashes = (oldHashRows || []).map(r => r.url_hash || r.URL_HASH).filter(Boolean);

      // 3. 砍對應 KB doc + chunks(分批,Oracle bind 上限 1000)
      let kbDocsRemoved = 0, kbChunksRemoved = 0;
      if (kbId && hashes.length) {
        for (let i = 0; i < hashes.length; i += 800) {
          const batch = hashes.slice(i, i + 800);
          const ph = batch.map(() => '?').join(',');
          const r1 = await db.prepare(
            `DELETE FROM kb_chunks WHERE doc_id IN (
               SELECT id FROM kb_documents WHERE kb_id=? AND source_hash IN (${ph})
             )`
          ).run(kbId, ...batch);
          kbChunksRemoved += r1?.changes ?? r1?.rowsAffected ?? 0;
          const r2 = await db.prepare(
            `DELETE FROM kb_documents WHERE kb_id=? AND source_hash IN (${ph})`
          ).run(kbId, ...batch);
          kbDocsRemoved += r2?.changes ?? r2?.rowsAffected ?? 0;
        }
      }

      // 4. 砍 pm_news_pins(避免孤兒)→ 砍 pm_news
      let pinsRemoved = 0;
      try {
        const pr = await db.prepare(`
          DELETE FROM pm_news_pins WHERE news_id IN (
            SELECT id FROM pm_news
             WHERE COALESCE(published_at, scraped_at, creation_date) < SYSDATE - ?
          )
        `).run(days);
        pinsRemoved = pr?.changes ?? pr?.rowsAffected ?? 0;
      } catch (_) {}

      const dr = await db.prepare(`
        DELETE FROM pm_news
         WHERE COALESCE(published_at, scraped_at, creation_date) < SYSDATE - ?
      `).run(days);
      const newsRemoved = dr?.changes ?? dr?.rowsAffected ?? 0;

      // 5. 重算 KB stats
      if (kbId) await refreshKbStats(db, kbId);

      return { news: newsRemoved, news_pins: pinsRemoved, kb_docs: kbDocsRemoved, kb_chunks: kbChunksRemoved };
    },
  },
  {
    key: 'kb_raw',
    label: 'KB:PM-原始資料庫(全網收集寫入的 raw 全文)',
    kbName: 'PM-原始資料庫',
    countOlderSql: null,  // KB 類在下方 buildKbStats 統一處理
    runCleanup: async (db, days) => cleanupKbByName(db, 'PM-原始資料庫', days),
  },
  {
    key: 'kb_analysis',
    label: 'KB:PM-分析庫 + pm_analysis_report(LLM 日/週/月報)',
    kbName: 'PM-分析庫',
    countOlderSql: null,
    runCleanup: async (db, days) => {
      const kbResult = await cleanupKbByName(db, 'PM-分析庫', days);
      const ar = await db.prepare(`DELETE FROM pm_analysis_report WHERE as_of_date < SYSDATE - ?`).run(days);
      return { ...kbResult, analysis_reports: ar?.changes ?? ar?.rowsAffected ?? 0 };
    },
  },
  {
    key: 'pm_price_history',
    label: '價格歷史(pm_price_history)',
    countOlderSql: `
      SELECT COUNT(*) AS n,
             TO_CHAR(MIN(as_of_date), 'YYYY-MM-DD') AS oldest
        FROM pm_price_history WHERE as_of_date < SYSDATE - ?`,
    countTotalSql: `SELECT COUNT(*) AS n FROM pm_price_history`,
    runCleanup: async (db, days) => {
      const r = await db.prepare(`DELETE FROM pm_price_history WHERE as_of_date < SYSDATE - ?`).run(days);
      return { rows: r?.changes ?? r?.rowsAffected ?? 0 };
    },
  },
  {
    key: 'pm_macro_history',
    label: '宏觀指標歷史(pm_macro_history)',
    countOlderSql: `
      SELECT COUNT(*) AS n,
             TO_CHAR(MIN(as_of_date), 'YYYY-MM-DD') AS oldest
        FROM pm_macro_history WHERE as_of_date < SYSDATE - ?`,
    countTotalSql: `SELECT COUNT(*) AS n FROM pm_macro_history`,
    runCleanup: async (db, days) => {
      const r = await db.prepare(`DELETE FROM pm_macro_history WHERE as_of_date < SYSDATE - ?`).run(days);
      return { rows: r?.changes ?? r?.rowsAffected ?? 0 };
    },
  },
  {
    key: 'forecast_history',
    label: '預測歷史(forecast_history,以 forecast_date 為基準)',
    countOlderSql: `
      SELECT COUNT(*) AS n,
             TO_CHAR(MIN(forecast_date), 'YYYY-MM-DD') AS oldest
        FROM forecast_history WHERE forecast_date < SYSDATE - ?`,
    countTotalSql: `SELECT COUNT(*) AS n FROM forecast_history`,
    runCleanup: async (db, days) => {
      const r = await db.prepare(`DELETE FROM forecast_history WHERE forecast_date < SYSDATE - ?`).run(days);
      return { rows: r?.changes ?? r?.rowsAffected ?? 0 };
    },
  },
  {
    key: 'pm_alert_history',
    label: '警示歷史(pm_alert_history)',
    countOlderSql: `
      SELECT COUNT(*) AS n,
             TO_CHAR(MIN(COALESCE(triggered_at, creation_date)), 'YYYY-MM-DD') AS oldest
        FROM pm_alert_history WHERE COALESCE(triggered_at, creation_date) < SYSDATE - ?`,
    countTotalSql: `SELECT COUNT(*) AS n FROM pm_alert_history`,
    runCleanup: async (db, days) => {
      const r = await db.prepare(`
        DELETE FROM pm_alert_history WHERE COALESCE(triggered_at, creation_date) < SYSDATE - ?
      `).run(days);
      return { rows: r?.changes ?? r?.rowsAffected ?? 0 };
    },
  },
];

// ── KB 類共用清理 ────────────────────────────────────────────────────────
async function cleanupKbByName(db, kbName, days) {
  const kbRow = await db.prepare(`SELECT id FROM knowledge_bases WHERE name=?`).get(kbName);
  const kbId = kbRow?.id || kbRow?.ID;
  if (!kbId) return { kb_docs: 0, kb_chunks: 0, _note: `KB "${kbName}" 不存在,skipped` };

  const r1 = await db.prepare(`
    DELETE FROM kb_chunks WHERE doc_id IN (
      SELECT id FROM kb_documents
       WHERE kb_id=? AND COALESCE(published_at, created_at) < SYSDATE - ?
    )
  `).run(kbId, days);
  const r2 = await db.prepare(`
    DELETE FROM kb_documents
     WHERE kb_id=? AND COALESCE(published_at, created_at) < SYSDATE - ?
  `).run(kbId, days);

  await refreshKbStats(db, kbId);

  return {
    kb_docs:   r2?.changes ?? r2?.rowsAffected ?? 0,
    kb_chunks: r1?.changes ?? r1?.rowsAffected ?? 0,
  };
}

async function refreshKbStats(db, kbId) {
  try {
    const s = await db.prepare(`
      SELECT COUNT(*) AS doc_count,
             COALESCE(SUM(file_size),0)   AS total_bytes,
             COALESCE(SUM(chunk_count),0) AS chunk_count
        FROM kb_documents WHERE kb_id=?
    `).get(kbId);
    await db.prepare(`
      UPDATE knowledge_bases
         SET doc_count=?, chunk_count=?, total_size_bytes=?, updated_at=SYSTIMESTAMP
       WHERE id=?
    `).run(s?.doc_count || 0, s?.chunk_count || 0, s?.total_bytes || 0, kbId);
  } catch (e) {
    console.warn('[PmRetention] refreshKbStats failed:', e.message);
  }
}

// ── KB 統計查詢(給 preview / config 列表用)─────────────────────────────
async function buildKbStats(db, kbName, days) {
  const kbRow = await db.prepare(`SELECT id FROM knowledge_bases WHERE name=?`).get(kbName);
  const kbId = kbRow?.id || kbRow?.ID;
  if (!kbId) return { will_remove: 0, total: 0, oldest: null, _note: `KB "${kbName}" 不存在` };

  const total = await db.prepare(`SELECT COUNT(*) AS n FROM kb_documents WHERE kb_id=?`).get(kbId);
  const oldest = await db.prepare(`
    SELECT TO_CHAR(MIN(COALESCE(published_at, created_at)), 'YYYY-MM-DD') AS oldest
      FROM kb_documents WHERE kb_id=?
  `).get(kbId);

  let willRemove = 0;
  if (days != null && days > 0) {
    const r = await db.prepare(`
      SELECT COUNT(*) AS n FROM kb_documents
       WHERE kb_id=? AND COALESCE(published_at, created_at) < SYSDATE - ?
    `).get(kbId, days);
    willRemove = r?.n ?? r?.N ?? 0;
  }

  return {
    will_remove: willRemove,
    total: total?.n ?? total?.N ?? 0,
    oldest: oldest?.oldest || oldest?.OLDEST || null,
  };
}

// ── 設定讀寫 ──────────────────────────────────────────────────────────────
async function getConfig(db) {
  const row = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get(SETTING_KEY);
  let saved = {};
  if (row?.value) {
    try { saved = JSON.parse(typeof row.value === 'string' ? row.value : row.value.toString()) || {}; }
    catch (_) { saved = {}; }
  }
  // merge:saved 優先,沒設的用 defaults
  const merged = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(saved, k)) {
      const v = saved[k];
      merged[k] = (v === '' || v == null) ? null : Number(v);
    }
  }
  return merged;
}

async function setConfig(db, newConfig) {
  // sanitize:只接受已知 key,值是 null 或 1-3650 的整數
  const sanitized = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(newConfig, k)) {
      sanitized[k] = DEFAULTS[k];
      continue;
    }
    const raw = newConfig[k];
    if (raw === '' || raw == null) {
      sanitized[k] = null; // 永久保留
      continue;
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      throw new Error(`${k} 的天數必須是 1-3650(或留空表示永久保留),收到: ${raw}`);
    }
    sanitized[k] = n;
  }

  const json = JSON.stringify(sanitized);
  const ex = await db.prepare(`SELECT key FROM system_settings WHERE key=?`).get(SETTING_KEY);
  if (ex) await db.prepare(`UPDATE system_settings SET value=? WHERE key=?`).run(json, SETTING_KEY);
  else    await db.prepare(`INSERT INTO system_settings (key, value) VALUES (?,?)`).run(SETTING_KEY, json);
  return sanitized;
}

// ── Preview / Run ─────────────────────────────────────────────────────────
/**
 * Dry-run:回每 entity 「會砍幾筆 / 還剩幾筆 / 最舊日期」,不真的 DELETE。
 */
async function previewCleanup(db, config = null) {
  const cfg = config || await getConfig(db);
  const out = [];
  for (const t of TARGETS) {
    const days = cfg[t.key];
    const item = { key: t.key, label: t.label, days, will_remove: 0, total: 0, oldest: null };

    if (t.kbName && !t.countOlderSql) {
      // KB-only target
      Object.assign(item, await buildKbStats(db, t.kbName, days));
    } else {
      // table target(可能也帶 KB,但 will_remove 以主表為準)
      try {
        const totalRow = await db.prepare(t.countTotalSql).get();
        item.total = totalRow?.n ?? totalRow?.N ?? 0;
      } catch (e) { item._error = e.message; }

      if (days != null && days > 0) {
        try {
          const r = await db.prepare(t.countOlderSql).get(days);
          item.will_remove = r?.n ?? r?.N ?? 0;
          item.oldest = r?.oldest || r?.OLDEST || null;
        } catch (e) { item._error = e.message; }
      }

      // pm_news 帶連動的 KB:PM-新聞庫
      if (t.key === 'pm_news') {
        const kbStats = await buildKbStats(db, 'PM-新聞庫', days);
        item.kb_paired = { kb_name: 'PM-新聞庫', ...kbStats };
      }
    }

    out.push(item);
  }
  return { config: cfg, targets: out };
}

/**
 * 真的執行清理。回每 entity 實際刪掉的 rows count。
 */
async function runCleanup(db, config = null) {
  const cfg = config || await getConfig(db);
  const summary = [];
  for (const t of TARGETS) {
    const days = cfg[t.key];
    if (days == null || days <= 0) {
      summary.push({ key: t.key, label: t.label, days, skipped: 'retention=null(永久保留)' });
      continue;
    }
    try {
      const result = await t.runCleanup(db, days);
      summary.push({ key: t.key, label: t.label, days, ...result });
      console.log(`[PmRetention] ${t.key} (${days}d):`, JSON.stringify(result));
    } catch (e) {
      console.error(`[PmRetention] ${t.key} failed:`, e.message);
      summary.push({ key: t.key, label: t.label, days, error: e.message });
    }
  }
  return { ran_at: new Date().toISOString(), summary };
}

// ── Schedule(自動執行時間)──────────────────────────────────────────────
async function getSchedule(db) {
  const rows = await db.prepare(
    `SELECT key, value FROM system_settings WHERE key IN (?, ?, ?)`
  ).all(SETTING_KEY_ENABLED, SETTING_KEY_HOUR, SETTING_KEY_MINUTE);
  const map = Object.fromEntries((rows || []).map(r => [r.key || r.KEY, r.value || r.VALUE]));
  return {
    enabled: (map[SETTING_KEY_ENABLED] ?? '1') === '1',
    hour:    parseIntSafe(map[SETTING_KEY_HOUR],   3,  0, 23),
    minute:  parseIntSafe(map[SETTING_KEY_MINUTE], 0,  0, 59),
  };
}

async function setSchedule(db, { enabled, hour, minute }) {
  const sane = {
    enabled: enabled ? '1' : '0',
    hour:    String(parseIntSafe(hour, 3,  0, 23)),
    minute:  String(parseIntSafe(minute, 0, 0, 59)),
  };
  const upsert = async (key, value) => {
    const ex = await db.prepare(`SELECT key FROM system_settings WHERE key=?`).get(key);
    if (ex) await db.prepare(`UPDATE system_settings SET value=? WHERE key=?`).run(value, key);
    else    await db.prepare(`INSERT INTO system_settings (key, value) VALUES (?,?)`).run(key, value);
  };
  await upsert(SETTING_KEY_ENABLED, sane.enabled);
  await upsert(SETTING_KEY_HOUR,    sane.hour);
  await upsert(SETTING_KEY_MINUTE,  sane.minute);
  return {
    enabled: sane.enabled === '1',
    hour:    Number(sane.hour),
    minute:  Number(sane.minute),
  };
}

function parseIntSafe(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
}

// ── Cron ──────────────────────────────────────────────────────────────────
let scheduledTask = null;
let scheduledExpr = null;

async function startScheduler(db) {
  if (scheduledTask) { scheduledTask.stop(); scheduledTask = null; scheduledExpr = null; }

  const sched = await getSchedule(db);
  if (!sched.enabled) {
    console.log('[PmRetention] Scheduler disabled (admin 在 PM 平台設定關閉)');
    return;
  }

  const cronExpr = `${sched.minute} ${sched.hour} * * *`;
  scheduledTask = cron.schedule(cronExpr, async () => {
    console.log(`[PmRetention] Scheduled run at ${cronExpr}`);
    try {
      const r = await runCleanup(db);
      console.log('[PmRetention] Done:', JSON.stringify(r.summary));
    } catch (e) {
      console.error('[PmRetention] Scheduled run error:', e.message);
    }
  });
  scheduledExpr = cronExpr;
  console.log(`[PmRetention] Scheduler active: ${cronExpr}`);
}

function stopScheduler() {
  if (scheduledTask) { scheduledTask.stop(); scheduledTask = null; scheduledExpr = null; }
  console.log('[PmRetention] Scheduler stopped.');
}

function getSchedulerStatus() {
  return { running: !!scheduledTask, cron_expr: scheduledExpr };
}

module.exports = {
  DEFAULTS,
  getConfig,
  setConfig,
  previewCleanup,
  runCleanup,
  startScheduler,
  stopScheduler,
  getSchedule,
  setSchedule,
  getSchedulerStatus,
};
