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
    const filter = metalsCsv
      ? `AND metal_code IN (${metalsCsv.split(',').map(() => '?').join(',')})`
      : '';
    const params = metalsCsv ? metalsCsv.split(',') : [];

    const rows = await db.prepare(`
      SELECT * FROM (
        SELECT metal_code, metal_name, price_usd, day_change_pct, as_of_date, source,
               ROW_NUMBER() OVER (PARTITION BY metal_code ORDER BY as_of_date DESC) AS rn
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
      WHERE metal_code = ? AND as_of_date >= TRUNC(SYSDATE) - ?
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
        where.push(`metal_code IN (${arr.map(() => '?').join(',')})`);
        params.push(...arr);
      }
    }

    const rows = await db.prepare(`
      SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
             TO_CHAR(scraped_at, 'YYYY-MM-DD HH24:MI') AS scraped_at,
             metal_code, metal_name,
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
        where.push(`metal_code IN (${arr.map(() => '?').join(',')})`);
        params.push(...arr);
      }
    }

    const rows = await db.prepare(`
      SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
             metal_code, metal_name, source, price_usd, day_change_pct,
             original_price, original_currency, original_unit
      FROM pm_price_history
      WHERE ${where.join(' AND ')}
      ORDER BY as_of_date DESC, metal_code
      FETCH FIRST 50000 ROWS ONLY
    `).all(...params);

    // CSV with UTF-8 BOM(Excel 不亂碼)
    const headers = ['as_of_date','metal_code','metal_name','source','price_usd','day_change_pct','original_price','original_currency','original_unit'];
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
