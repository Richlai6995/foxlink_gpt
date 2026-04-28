/**
 * PM Briefing routes — 採購每日資料一站式瀏覽
 * 路徑統一 /api/pm/briefing/*
 *
 * Permission gate 復用 pmReview 的 userHasPmAccess(help_book_shares for 'precious-metals')
 *
 * Endpoints:
 *   GET  /prices                      — 11 金屬最新報價(含日變化)
 *   GET  /prices/timeseries?metal=&days=  — 個別金屬 N 日趨勢
 *   GET  /prices/export.csv?from=&to=&metals=  — CSV 下載
 *
 *   GET  /news                        — 新聞列表(含篩選 / 分頁 / 釘選 join)
 *   GET  /news/sources                — distinct sources(篩選 dropdown 用)
 *   POST /news/:id/pin                — 釘選
 *   DELETE /news/:id/pin              — 取消釘選
 *   GET  /news/export.pdf?...         — PDF 下載(套用當前 filter,max 500 筆)
 *
 *   GET  /reports?type=daily|weekly|monthly&offset=0  — 撈第 offset 期(0=最新)
 *
 *   GET  /preferences                 — 我的偏好
 *   PUT  /preferences                 — 更新
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

// ── 復用 pmReview 的權限檢查(避免 import circular,本檔內 inline 一份)──
function userGranteeTuples(user) {
  const map = [
    ['user',        String(user?.id ?? '')],
    ['role',        String(user?.role_id ?? '')],
    ['factory',     String(user?.factory_code ?? '')],
    ['department',  String(user?.dept_code ?? '')],
    ['cost_center', String(user?.profit_center ?? '')],
    ['division',    String(user?.org_section ?? '')],
    ['org_group',   String(user?.org_group_name ?? '')],
  ];
  return map.filter(([, v]) => v && v !== 'null' && v !== 'undefined');
}

async function verifyPmUser(req, res, next) {
  try {
    const db = require('../database-oracle').db;
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'No user' });
    if (user.role === 'admin') return next();

    const book = await db.prepare(
      `SELECT id, is_special, is_active FROM help_books WHERE code = 'precious-metals'`
    ).get();
    if (!book || Number(book.is_active) === 0) return res.status(403).json({ error: '無權' });
    if (Number(book.is_special) === 0) return next();

    const tuples = userGranteeTuples(user);
    if (tuples.length === 0) return res.status(403).json({ error: '需要貴金屬閱讀權限' });
    const orClauses = tuples.map(() => '(grantee_type = ? AND grantee_id = ?)').join(' OR ');
    const params = tuples.flatMap(([t, v]) => [t, v]);
    const row = await db.prepare(`
      SELECT 1 AS hit FROM help_book_shares
      WHERE book_id = ? AND (${orClauses}) FETCH FIRST 1 ROWS ONLY
    `).get(book.id, ...params);
    if (!row) return res.status(403).json({ error: '需要貴金屬閱讀權限' });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PRICES
// ────────────────────────────────────────────────────────────────────────────

// 取每金屬最新一筆 + 日變化
router.get('/prices', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metalsCsv = req.query.metals;
    // 統一 UPPER() 比對 — DB 跟 client 任一邊大小寫不一致都不會 miss
    const filter = metalsCsv
      ? `AND UPPER(metal_code) IN (${metalsCsv.split(',').map(() => 'UPPER(?)').join(',')})`
      : '';
    const params = metalsCsv ? metalsCsv.split(',') : [];

    const rows = await db.prepare(`
      SELECT * FROM (
        SELECT UPPER(metal_code) AS metal_code, metal_name, price_usd, day_change_pct,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date, source,
               ROW_NUMBER() OVER (PARTITION BY UPPER(metal_code) ORDER BY as_of_date DESC) AS rn
        FROM pm_price_history
        WHERE as_of_date >= TRUNC(SYSDATE) - 30
          AND price_usd IS NOT NULL
          ${filter}
      ) WHERE rn = 1
      ORDER BY metal_code
    `).all(...params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 個別金屬 N 日趨勢(畫 mini chart 用)— 簡化版:date + AVG(price)
router.get('/prices/timeseries', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metal = String(req.query.metal || '').trim();
    const days = Math.min(Math.max(Number(req.query.days || 30), 1), 365);
    if (!metal) return res.status(400).json({ error: 'metal required' });
    const rows = await db.prepare(`
      SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS date,
             AVG(price_usd) AS price
      FROM pm_price_history
      WHERE UPPER(metal_code) = UPPER(?) AND as_of_date >= TRUNC(SYSDATE) - ?
        AND price_usd IS NOT NULL
      GROUP BY as_of_date
      ORDER BY as_of_date
    `).all(metal, days);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 完整歷史(所有欄位)— 給「歷史價格」tab 的 detail table 用
router.get('/prices/history', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metalsCsv = req.query.metals;
    const from = req.query.from || null;
    const to = req.query.to || null;
    const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 5000);

    const where = ['price_usd IS NOT NULL'];
    const params = [];
    if (from) { where.push(`as_of_date >= TO_DATE(?, 'YYYY-MM-DD')`); params.push(from); }
    if (to)   { where.push(`as_of_date <= TO_DATE(?, 'YYYY-MM-DD')`); params.push(to); }
    if (metalsCsv) {
      const arr = String(metalsCsv).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) {
        where.push(`UPPER(metal_code) IN (${arr.map(() => 'UPPER(?)').join(',')})`);
        params.push(...arr);
      }
    }

    const rows = await db.prepare(`
      SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
             TO_CHAR(scraped_at, 'YYYY-MM-DD HH24:MI') AS scraped_at,
             UPPER(metal_code) AS metal_code, metal_name,
             original_price, original_currency, original_unit,
             price_usd, unit, fx_rate_to_usd, conversion_note, is_estimated,
             price_type, market, grade,
             day_change_pct, lme_stock, stock_change,
             source, source_url
      FROM pm_price_history
      WHERE ${where.join(' AND ')}
      ORDER BY as_of_date DESC, metal_code
      FETCH FIRST ? ROWS ONLY
    `).all(...params, limit);

    res.json({ rows, count: rows.length });
  } catch (e) {
    console.error('[PmBriefing] /prices/history error:', e);
    res.status(500).json({ error: e.message });
  }
});

// CSV 匯出
router.get('/prices/export.csv', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const from = req.query.from || null;
    const to = req.query.to || null;
    const metalsCsv = req.query.metals;

    const where = ['price_usd IS NOT NULL'];
    const params = [];
    if (from) { where.push('as_of_date >= TO_DATE(?, \'YYYY-MM-DD\')'); params.push(from); }
    if (to)   { where.push('as_of_date <= TO_DATE(?, \'YYYY-MM-DD\')'); params.push(to); }
    if (metalsCsv) {
      const arr = metalsCsv.split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) {
        where.push(`UPPER(metal_code) IN (${arr.map(() => 'UPPER(?)').join(',')})`);
        params.push(...arr);
      }
    }

    const rows = await db.prepare(`
      SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
             TO_CHAR(scraped_at, 'YYYY-MM-DD HH24:MI') AS scraped_at,
             UPPER(metal_code) AS metal_code, metal_name,
             original_price, original_currency, original_unit,
             price_usd, unit, fx_rate_to_usd, conversion_note, is_estimated,
             price_type, market, grade,
             day_change_pct, lme_stock, stock_change,
             source, source_url
      FROM pm_price_history
      WHERE ${where.join(' AND ')}
      ORDER BY as_of_date DESC, metal_code
      FETCH FIRST 50000 ROWS ONLY
    `).all(...params);

    // CSV with UTF-8 BOM(Excel 不亂碼)— 全欄位,跟「歷史價格」detail table 對齊
    const headers = ['as_of_date','metal_code','metal_name','original_price','original_currency','original_unit','price_usd','unit','fx_rate_to_usd','day_change_pct','source','source_url','price_type','market','grade','lme_stock','stock_change','is_estimated','conversion_note','scraped_at'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(headers.map(h => csvEscape(r[h])).join(','));
    }
    const csv = '﻿' + lines.join('\n');

    const fname = `PM_價格_${from || 'all'}_${to || 'all'}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ────────────────────────────────────────────────────────────────────────────
// FORECAST + PURCHASE overlay(D — 採購節奏 vs 預測 chart 疊加)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/pm/briefing/forecast-overlay?metal=&from=&to=
// 同 target_date 多筆 forecast(不同 forecast_date)→ 取最新 forecast_date 那筆
router.get('/forecast-overlay', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metal = String(req.query.metal || '').trim();
    const from = req.query.from || null;
    const to = req.query.to || null;
    if (!metal) return res.status(400).json({ error: 'metal required' });

    const where = [`f.entity_type = 'metal'`, `UPPER(f.entity_code) = UPPER(?)`];
    const params = [metal];
    if (from) { where.push(`f.target_date >= TO_DATE(?, 'YYYY-MM-DD')`); params.push(from); }
    if (to)   { where.push(`f.target_date <= TO_DATE(?, 'YYYY-MM-DD')`); params.push(to); }

    const rows = await db.prepare(`
      SELECT * FROM (
        SELECT TO_CHAR(f.target_date, 'YYYY-MM-DD')   AS target_date,
               TO_CHAR(f.forecast_date, 'YYYY-MM-DD') AS forecast_date,
               f.predicted_mean, f.predicted_lower, f.predicted_upper,
               f.confidence, f.model_used,
               ROW_NUMBER() OVER (PARTITION BY f.target_date ORDER BY f.forecast_date DESC) AS rn
        FROM forecast_history f
        WHERE ${where.join(' AND ')}
      ) WHERE rn = 1
      ORDER BY target_date
      FETCH FIRST 1000 ROWS ONLY
    `).all(...params);
    res.json(rows);
  } catch (e) {
    console.error('[PmBriefing] /forecast-overlay error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pm/briefing/purchase-overlay?metal=&from=&to=
// 回 by month aggregated;factory=ALL 表示跨廠加總
router.get('/purchase-overlay', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metal = String(req.query.metal || '').trim();
    const from = req.query.from || null;
    const to = req.query.to || null;
    if (!metal) return res.status(400).json({ error: 'metal required' });

    const where = [`UPPER(metal_code) = UPPER(?)`];
    const params = [metal];
    if (from) { where.push(`purchase_month >= ?`); params.push(String(from).slice(0, 7)); }
    if (to)   { where.push(`purchase_month <= ?`); params.push(String(to).slice(0, 7)); }

    const rows = await db.prepare(`
      SELECT purchase_month,
             SUM(total_qty)    AS total_qty,
             SUM(total_amount) AS total_amount,
             AVG(avg_unit_price) AS avg_unit_price,
             SUM(po_count)     AS po_count,
             SUM(supplier_count) AS supplier_count,
             COUNT(DISTINCT factory_code) AS factory_count
      FROM pm_purchase_history
      WHERE ${where.join(' AND ')}
      GROUP BY purchase_month
      ORDER BY purchase_month
    `).all(...params);
    res.json(rows);
  } catch (e) {
    console.error('[PmBriefing] /purchase-overlay error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pm/briefing/metrics-summary?metal=&days=180
// 三個 KPI:採購擇時 / AI MAPE / 庫存天數
router.get('/metrics-summary', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metal = String(req.query.metal || '').trim();
    const days = Math.min(Math.max(Number(req.query.days || 180), 1), 730);
    if (!metal) return res.status(400).json({ error: 'metal required' });

    // 1. 採購擇時:過去 N 天「採購均價 vs 市場月均」差異 %
    let timingPct = null;
    try {
      const r = await db.prepare(`
        SELECT
          (SELECT AVG(avg_unit_price) FROM pm_purchase_history
           WHERE UPPER(metal_code) = UPPER(?)
             AND TO_DATE(purchase_month || '-01', 'YYYY-MM-DD') >= TRUNC(SYSDATE) - ?) AS our_avg,
          (SELECT AVG(price_usd) FROM pm_price_history
           WHERE UPPER(metal_code) = UPPER(?) AND as_of_date >= TRUNC(SYSDATE) - ? AND price_usd IS NOT NULL) AS market_avg
        FROM dual
      `).get(metal, days, metal, days);
      const ours = Number(r?.our_avg ?? r?.OUR_AVG);
      const mkt  = Number(r?.market_avg ?? r?.MARKET_AVG);
      if (Number.isFinite(ours) && Number.isFinite(mkt) && mkt > 0) {
        timingPct = ((ours - mkt) / mkt) * 100;
      }
    } catch (_) {}

    // 2. AI 預測 MAPE(近 30 天)— 從 pm_forecast_accuracy 撈
    let mape30 = null;
    let mapeSamples = 0;
    try {
      const r = await db.prepare(`
        SELECT AVG(ABS(pct_error)) AS mape, COUNT(*) AS n
        FROM pm_forecast_accuracy
        WHERE entity_type = 'metal' AND UPPER(entity_code) = UPPER(?)
          AND target_date >= TRUNC(SYSDATE) - 30
          AND pct_error IS NOT NULL
      `).get(metal);
      const m = Number(r?.mape ?? r?.MAPE);
      if (Number.isFinite(m)) { mape30 = m; mapeSamples = Number((r?.n ?? r?.N) || 0); }
    } catch (_) {}

    // 3. 庫存天數:總在庫 / (近 30 天月平均用量 / 30)
    let daysOfSupply = null;
    let onhandKg = null;
    try {
      const inv = await db.prepare(`
        SELECT SUM(NVL(onhand_qty, 0) + NVL(in_transit_qty, 0)) AS total_inv
        FROM pm_inventory WHERE UPPER(metal_code) = UPPER(?)
      `).get(metal);
      const usage = await db.prepare(`
        SELECT AVG(total_qty) AS avg_monthly
        FROM pm_purchase_history
        WHERE UPPER(metal_code) = UPPER(?)
          AND TO_DATE(purchase_month || '-01', 'YYYY-MM-DD') >= TRUNC(SYSDATE) - 90
      `).get(metal);
      const inventory = Number(inv?.total_inv ?? inv?.TOTAL_INV);
      const monthly = Number(usage?.avg_monthly ?? usage?.AVG_MONTHLY);
      if (Number.isFinite(inventory)) onhandKg = inventory;
      if (Number.isFinite(inventory) && Number.isFinite(monthly) && monthly > 0) {
        daysOfSupply = inventory / (monthly / 30);
      }
    } catch (_) {}

    res.json({
      timing_pct: timingPct,
      mape_30d: mape30,
      mape_samples: mapeSamples,
      days_of_supply: daysOfSupply,
      onhand_total: onhandKg,
    });
  } catch (e) {
    console.error('[PmBriefing] /metrics-summary error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// MACRO 宏觀指標(DXY / VIX / UST10Y / WTI 等 — 金價的關鍵 driver)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/pm/briefing/macro — 每個 indicator 取最新一筆 + 與前一筆對比
router.get('/macro', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT * FROM (
        SELECT indicator_code, indicator_name, value, unit, source,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               LAG(value) OVER (PARTITION BY indicator_code ORDER BY as_of_date) AS prev_value,
               ROW_NUMBER() OVER (PARTITION BY indicator_code ORDER BY as_of_date DESC) AS rn
        FROM pm_macro_history
        WHERE as_of_date >= TRUNC(SYSDATE) - 14
          AND value IS NOT NULL
      ) WHERE rn = 1
      ORDER BY indicator_code
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// ALERTS 警示(近期)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/pm/briefing/alerts?days=7&limit=10 — 近期警示記錄
router.get('/alerts', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const days = Math.min(Math.max(Number(req.query.days || 7), 1), 90);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const rows = await db.prepare(`
      SELECT id,
             TO_CHAR(triggered_at, 'YYYY-MM-DD HH24:MI') AS triggered_at,
             rule_code, severity, entity_type, entity_code,
             trigger_value, threshold_value, message,
             ack_user_id,
             TO_CHAR(ack_at, 'YYYY-MM-DD HH24:MI') AS ack_at,
             channels_sent
      FROM pm_alert_history
      WHERE triggered_at >= SYSDATE - ?
      ORDER BY triggered_at DESC
      FETCH FIRST ? ROWS ONLY
    `).all(days, limit);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pm/briefing/alerts/:id/ack — user ack 一筆警示
router.post('/alerts/:id/ack', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`
      UPDATE pm_alert_history SET ack_user_id = ?, ack_at = SYSTIMESTAMP
      WHERE id = ? AND ack_user_id IS NULL
    `).run(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// NEWS
// ────────────────────────────────────────────────────────────────────────────

function buildNewsWhere(query, userId) {
  const where = [];
  const params = [];

  if (query.metal) {
    const arr = String(query.metal).split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length > 0) {
      const orClauses = arr.map(() => `INSTR(',' || NVL(n.related_metals,'') || ',', ?) > 0`).join(' OR ');
      where.push(`(${orClauses})`);
      params.push(...arr.map(m => `,${m},`));
    }
  }
  if (query.source) {
    const arr = String(query.source).split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length > 0) {
      where.push(`n.source IN (${arr.map(() => '?').join(',')})`);
      params.push(...arr);
    }
  }
  if (query.sentiment) {
    if (query.sentiment === 'positive') where.push(`(n.sentiment_label = 'positive' OR n.sentiment_label = 'very_positive')`);
    else if (query.sentiment === 'negative') where.push(`(n.sentiment_label = 'negative' OR n.sentiment_label = 'very_negative')`);
    else if (query.sentiment === 'neutral') where.push(`n.sentiment_label = 'neutral'`);
  }
  if (query.from) {
    where.push(`COALESCE(n.published_at, n.scraped_at) >= TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS')`);
    params.push(`${query.from}T00:00:00`);
  }
  if (query.to) {
    where.push(`COALESCE(n.published_at, n.scraped_at) <= TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS')`);
    params.push(`${query.to}T23:59:59`);
  }
  if (query.q) {
    where.push(`(LOWER(n.title) LIKE ? OR LOWER(n.summary) LIKE ?)`);
    const kw = `%${String(query.q).toLowerCase()}%`;
    params.push(kw, kw);
  }
  if (query.pinned_only === '1' || query.pinned_only === 1 || query.pinned_only === true) {
    where.push(`EXISTS (SELECT 1 FROM pm_news_pins p WHERE p.news_id = n.id AND p.user_id = ?)`);
    params.push(userId);
  }
  return { where: where.length > 0 ? 'WHERE ' + where.join(' AND ') : '', params };
}

router.get('/news', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const page = Math.max(Number(req.query.page || 1), 1);
    const size = Math.min(Math.max(Number(req.query.size || 50), 1), 200);
    const offset = (page - 1) * size;
    const { where, params } = buildNewsWhere(req.query, req.user.id);

    const totalRow = await db.prepare(`SELECT COUNT(*) AS cnt FROM pm_news n ${where}`).get(...params);
    const total = Number(totalRow?.cnt || 0);

    const rows = await db.prepare(`
      SELECT n.id, n.url, n.title, n.source, n.language,
             TO_CHAR(n.published_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS published_at,
             TO_CHAR(n.scraped_at,   'YYYY-MM-DD"T"HH24:MI:SS') AS scraped_at,
             n.summary, n.sentiment_score, n.sentiment_label,
             n.related_metals, n.topics,
             (SELECT 1 FROM pm_news_pins p WHERE p.news_id = n.id AND p.user_id = ? FETCH FIRST 1 ROWS ONLY) AS is_pinned
      FROM pm_news n
      ${where}
      ORDER BY COALESCE(n.published_at, n.scraped_at) DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `).all(req.user.id, ...params, offset, size);

    res.json({ rows, total, page, size });
  } catch (e) {
    console.error('[PmBriefing] /news error:', e);
    res.status(500).json({ error: e.message });
  }
});

// distinct sources for dropdown
router.get('/news/sources', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT source, COUNT(*) AS cnt
      FROM pm_news
      WHERE source IS NOT NULL AND scraped_at >= TRUNC(SYSDATE) - 60
      GROUP BY source ORDER BY cnt DESC
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/news/:id/pin', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    try {
      await db.prepare(`INSERT INTO pm_news_pins (user_id, news_id) VALUES (?, ?)`).run(req.user.id, req.params.id);
    } catch (e) {
      if (!/ORA-00001|UNIQUE/i.test(e.message)) throw e;  // 已釘 = success(idempotent)
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/news/:id/pin', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM pm_news_pins WHERE user_id = ? AND news_id = ?`).run(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PDF 匯出 — max 500 筆
router.get('/news/export.pdf', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { where, params } = buildNewsWhere(req.query, req.user.id);
    const PDF_MAX = 500;

    const totalRow = await db.prepare(`SELECT COUNT(*) AS cnt FROM pm_news n ${where}`).get(...params);
    const total = Number(totalRow?.cnt || 0);
    if (total > PDF_MAX) {
      return res.status(400).json({
        error: `篩選結果 ${total} 筆 > ${PDF_MAX} 上限,請縮小日期範圍或加 filter`,
        total, limit: PDF_MAX,
      });
    }

    const rows = await db.prepare(`
      SELECT n.title, n.source, n.url,
             COALESCE(n.published_at, n.scraped_at) AS dt,
             n.sentiment_label, n.related_metals, n.summary
      FROM pm_news n
      ${where}
      ORDER BY COALESCE(n.published_at, n.scraped_at) DESC
      FETCH FIRST ${PDF_MAX} ROWS ONLY
    `).all(...params);

    const PDFDocument = require('pdfkit');
    const path = require('path');
    const fs = require('fs');
    const fontPath = path.join(__dirname, '..', 'fonts', 'NotoSansTC-Regular.ttf');
    const hasCJKFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const fname = `PM_新聞_${req.query.from || 'all'}_${req.query.to || 'all'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    doc.pipe(res);

    if (hasCJKFont) doc.registerFont('cjk', fontPath);
    const cjkFont = (size) => doc.font(hasCJKFont ? 'cjk' : 'Helvetica').fontSize(size);

    cjkFont(16).text('PM 新聞匯出', { align: 'center' });
    cjkFont(9).fillColor('#666').text(
      `篩選:${req.query.metal ? '金屬=' + req.query.metal + '  ' : ''}${req.query.source ? '來源=' + req.query.source + '  ' : ''}${req.query.sentiment ? '情緒=' + req.query.sentiment + '  ' : ''}${req.query.from ? `${req.query.from} ~ ${req.query.to || '今'}  ` : ''}${req.query.q ? '關鍵字=' + req.query.q : ''}`,
      { align: 'center' }
    );
    cjkFont(9).fillColor('#666').text(`共 ${rows.length} 筆 · 匯出於 ${new Date().toISOString().slice(0, 19)}`, { align: 'center' });
    doc.moveDown(0.5).strokeColor('#ddd').moveTo(40, doc.y).lineTo(555, doc.y).stroke().moveDown(0.5);

    for (const r of rows) {
      const sentColor =
        /positive/i.test(r.sentiment_label || '') ? '#16a34a' :
        /negative/i.test(r.sentiment_label || '') ? '#dc2626' : '#64748b';
      cjkFont(11).fillColor('#111').text(r.title || '(無標題)', { continued: false });
      cjkFont(8).fillColor(sentColor).text(`[${r.sentiment_label || '—'}]  `, { continued: true });
      cjkFont(8).fillColor('#666').text(`${r.source || '—'} · ${r.dt ? String(r.dt).slice(0, 19) : '—'} · ${r.related_metals || '—'}`);
      if (r.summary) cjkFont(9).fillColor('#333').text(String(r.summary));
      if (r.url) cjkFont(8).fillColor('#0066cc').text(String(r.url), { link: r.url, underline: true });
      doc.moveDown(0.6);
      if (doc.y > 760) doc.addPage();
    }

    doc.end();
  } catch (e) {
    console.error('[PmBriefing] /news/export.pdf error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// REPORTS — daily / weekly / monthly,可翻歷史
// ────────────────────────────────────────────────────────────────────────────

// 取所有 [PM]% 排程任務的執行狀態 + 對應目的地表的資料量,
// 給前端「資料健康度面板」一頁看完六個任務跑得怎樣 / 哪個沒進資料。
router.get('/data-health', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;

    // 1) 6 個 PM 排程任務的元資料
    const tasks = await db.prepare(`
      SELECT id, name, status, schedule_type, schedule_hour, schedule_minute,
             schedule_interval_hours, schedule_times_json,
             TO_CHAR(last_run_at, 'YYYY-MM-DD HH24:MI:SS') AS last_run_at,
             last_run_status, run_count
      FROM scheduled_tasks
      WHERE name LIKE '[PM]%'
      ORDER BY id
    `).all();

    // 2) 各目的地表的資料量摘要
    const safeGet = async (sql) => {
      try { return await db.prepare(sql).get(); } catch (_) { return null; }
    };

    const today = new Date().toISOString().slice(0, 10);

    const newsRecent = await safeGet(`
      SELECT COUNT(*) AS n,
             TO_CHAR(MAX(scraped_at), 'YYYY-MM-DD HH24:MI') AS latest
      FROM pm_news WHERE scraped_at >= SYSTIMESTAMP - INTERVAL '24' HOUR
    `);
    const newsTotal = await safeGet(`SELECT COUNT(*) AS n FROM pm_news`);

    const priceLatest = await safeGet(`
      SELECT TO_CHAR(MAX(as_of_date), 'YYYY-MM-DD') AS latest_date,
             COUNT(*) AS today_rows
      FROM pm_price_history
      WHERE as_of_date >= TRUNC(SYSDATE)
    `);
    const priceMetalsToday = await safeGet(`
      SELECT COUNT(DISTINCT metal_code) AS n
      FROM pm_price_history WHERE as_of_date >= TRUNC(SYSDATE)
    `);

    const macroLatest = await safeGet(`
      SELECT TO_CHAR(MAX(as_of_date), 'YYYY-MM-DD') AS latest_date,
             COUNT(DISTINCT indicator_code) AS indicator_count
      FROM pm_macro_history
    `);
    const macroToday = await safeGet(`
      SELECT COUNT(*) AS n FROM pm_macro_history WHERE as_of_date >= TRUNC(SYSDATE)
    `);

    const dailyReport = await safeGet(`
      SELECT TO_CHAR(MAX(as_of_date), 'YYYY-MM-DD') AS latest_date
      FROM pm_analysis_report WHERE report_type = 'daily'
    `);
    const weeklyReport = await safeGet(`
      SELECT TO_CHAR(MAX(as_of_date), 'YYYY-MM-DD') AS latest_date
      FROM pm_analysis_report WHERE report_type = 'weekly'
    `);
    const monthlyReport = await safeGet(`
      SELECT TO_CHAR(MAX(as_of_date), 'YYYY-MM-DD') AS latest_date
      FROM pm_analysis_report WHERE report_type = 'monthly'
    `);

    const forecastTotal = await safeGet(`SELECT COUNT(*) AS n FROM forecast_history`);
    const forecastToday = await safeGet(`
      SELECT COUNT(*) AS n,
             COUNT(DISTINCT entity_code) AS metals
      FROM forecast_history
      WHERE entity_type='metal' AND forecast_date >= TRUNC(SYSDATE)
    `);
    const forecastLatest = await safeGet(`
      SELECT TO_CHAR(MAX(forecast_date), 'YYYY-MM-DD') AS latest_date FROM forecast_history
    `);

    const num = (r, k) => Number(r?.[k] ?? r?.[k.toUpperCase()] ?? 0);
    const str = (r, k) => r?.[k] ?? r?.[k.toUpperCase()] ?? null;

    // 3) 對每個 task 撈最新一筆 task_run 的 pipeline_log_json,parse 出
    //    db_write/kb_write summary。讓使用者區分「跑成功 + 真寫入」vs
    //    「跑成功但 db_write 全 skipped(LLM 抓的 url 都重複 / mapping 失敗)」
    const taskWritesById = new Map();
    for (const t of tasks) {
      const tid = t.id || t.ID;
      try {
        const lastRun = await db.prepare(`
          SELECT pipeline_log_json
          FROM scheduled_task_runs
          WHERE task_id = ?
          ORDER BY run_at DESC
          FETCH FIRST 1 ROWS ONLY
        `).get(tid);
        let raw = lastRun?.pipeline_log_json || lastRun?.PIPELINE_LOG_JSON;
        if (raw && typeof raw !== 'string' && raw.toString) raw = raw.toString();
        if (!raw) continue;
        const log = JSON.parse(raw);
        if (!Array.isArray(log)) continue;
        const dbWrites = [];
        const kbWrites = [];
        for (const node of log) {
          if (node?.db_write_summary) {
            const s = node.db_write_summary;
            dbWrites.push({
              table: s.table || node.table || null,
              inserted: Number(s.inserted || 0),
              updated:  Number(s.updated  || 0),
              skipped:  Number(s.skipped  || 0),
              errors:   Array.isArray(s.errors) ? s.errors.length : 0,
            });
          }
          if (node?.kb_write_summary) {
            const s = node.kb_write_summary;
            kbWrites.push({
              kb_name: s.kb_name || node.kb_name || null,
              docs:    Number(s.documents_created || 0),
              chunks:  Number(s.chunks_created    || 0),
              skipped: Number(s.skipped_duplicates || 0),
              errors:  Array.isArray(s.errors) ? s.errors.length : 0,
            });
          }
        }
        if (dbWrites.length || kbWrites.length) {
          taskWritesById.set(tid, { db_writes: dbWrites, kb_writes: kbWrites });
        }
      } catch (_) { /* parse fail → 算沒摘要 */ }
    }

    res.json({
      today,
      tasks: tasks.map(t => {
        const tid = t.id || t.ID;
        const writes = taskWritesById.get(tid) || null;
        return {
          id: tid,
          name: t.name || t.NAME,
          status: t.status || t.STATUS,
          schedule_type: t.schedule_type || t.SCHEDULE_TYPE,
          schedule_hour: t.schedule_hour ?? t.SCHEDULE_HOUR,
          schedule_minute: t.schedule_minute ?? t.SCHEDULE_MINUTE,
          schedule_interval_hours: t.schedule_interval_hours ?? t.SCHEDULE_INTERVAL_HOURS,
          schedule_times_json: t.schedule_times_json || t.SCHEDULE_TIMES_JSON,
          last_run_at: t.last_run_at || t.LAST_RUN_AT,
          last_run_status: t.last_run_status || t.LAST_RUN_STATUS,
          run_count: t.run_count ?? t.RUN_COUNT ?? 0,
          last_run_writes: writes,
        };
      }),
      data: {
        news: {
          total: num(newsTotal, 'n'),
          last_24h: num(newsRecent, 'n'),
          latest: str(newsRecent, 'latest'),
        },
        price: {
          latest_date: str(priceLatest, 'latest_date'),
          today_rows: num(priceLatest, 'today_rows'),
          today_metals: num(priceMetalsToday, 'n'),
          target_metals: 11,
        },
        macro: {
          latest_date: str(macroLatest, 'latest_date'),
          indicator_count: num(macroLatest, 'indicator_count'),
          today_rows: num(macroToday, 'n'),
        },
        daily_report:   { latest_date: str(dailyReport, 'latest_date') },
        weekly_report:  { latest_date: str(weeklyReport, 'latest_date') },
        monthly_report: { latest_date: str(monthlyReport, 'latest_date') },
        forecast: {
          total: num(forecastTotal, 'n'),
          today_rows: num(forecastToday, 'n'),
          today_metals: num(forecastToday, 'metals'),
          target_metals: 11,
          latest_date: str(forecastLatest, 'latest_date'),
        },
      },
    });
  } catch (e) {
    console.error('[PmBriefing] /data-health error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 取「[PM] 每日金屬日報」排程設定,讓前端 fallback 文字動態顯示時間(避免寫死 18:00)
router.get('/schedule-info', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const row = await db.prepare(`
      SELECT schedule_type, schedule_hour, schedule_minute,
             schedule_weekday, schedule_monthday,
             schedule_interval_hours, schedule_times_json,
             schedule_cron_expr, status
      FROM scheduled_tasks
      WHERE name = '[PM] 每日金屬日報'
      FETCH FIRST 1 ROWS ONLY
    `).get();
    res.json({ daily_report: row || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/reports', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const type = String(req.query.type || 'daily').toLowerCase();
    if (!['daily', 'weekly', 'monthly'].includes(type)) return res.status(400).json({ error: 'type 必須 daily/weekly/monthly' });
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const limit = Math.min(Math.max(Number(req.query.limit || 1), 1), 20);

    // pm_analysis_report 是 Phase 2 既有表(report_type / as_of_date / content)
    // 第一順位:撈 pm_analysis_report
    const exists = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE table_name='PM_ANALYSIS_REPORT'`
    ).get();
    if (!exists || Number(exists.cnt || exists.CNT || 0) === 0) {
      return res.json({ rows: [], note: 'pm_analysis_report 表不存在' });
    }

    const cols = await db.prepare(`
      SELECT LOWER(column_name) AS c FROM user_tab_columns
      WHERE UPPER(table_name)='PM_ANALYSIS_REPORT'
    `).all();
    const colSet = new Set((cols || []).map(r => r.c || r.C));
    const contentCol = colSet.has('content') ? 'content'
                     : colSet.has('content_md') ? 'content_md'
                     : colSet.has('summary') ? 'summary'
                     : null;
    const fileCol = colSet.has('file_url') ? 'file_url'
                  : colSet.has('docx_path') ? 'docx_path' : null;
    if (!contentCol) return res.json({ rows: [], note: 'pm_analysis_report 找不到 content 欄位' });

    const rows = await db.prepare(`
      SELECT id, report_type,
             TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
             ${colSet.has('title') ? 'title' : `'${type} 報告' AS title`},
             ${contentCol} AS content
             ${fileCol ? `, ${fileCol} AS file_url` : ''}
      FROM pm_analysis_report
      WHERE report_type = ?
      ORDER BY as_of_date DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `).all(type, offset, limit);

    res.json({ rows });
  } catch (e) {
    console.error('[PmBriefing] /reports error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// USER PREFERENCES
// ────────────────────────────────────────────────────────────────────────────

router.get('/preferences', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const r = await db.prepare(`
      SELECT focused_metals, default_24h_only
      FROM pm_user_preferences WHERE user_id = ?
    `).get(req.user.id);
    res.json({
      focused_metals: r?.focused_metals ? String(r.focused_metals).split(',').map(s => s.trim()).filter(Boolean) : [],
      default_24h_only: r?.default_24h_only != null ? Number(r.default_24h_only) : 1,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/preferences', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const focused = Array.isArray(req.body?.focused_metals)
      ? req.body.focused_metals.filter(Boolean).join(',')
      : '';
    const def24h = req.body?.default_24h_only != null ? Number(req.body.default_24h_only) : 1;

    const ex = await db.prepare(`SELECT user_id FROM pm_user_preferences WHERE user_id=?`).get(req.user.id);
    if (ex) {
      await db.prepare(`
        UPDATE pm_user_preferences
        SET focused_metals=?, default_24h_only=?, updated_at=SYSTIMESTAMP
        WHERE user_id=?
      `).run(focused, def24h, req.user.id);
    } else {
      await db.prepare(`
        INSERT INTO pm_user_preferences (user_id, focused_metals, default_24h_only)
        VALUES (?, ?, ?)
      `).run(req.user.id, focused, def24h);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
