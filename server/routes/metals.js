/**
 * Metals Lite — 一般 user 看的金屬情報精簡版 routes
 * 路徑統一 /api/metals/*
 *
 * 規劃見 docs/metals-lite-plan.md。
 *
 * 權限 gate:`verifyMetalsAccess`
 *   1. admin 通過
 *   2. help_books.code='metals-public' 的 share 通過
 *   3. help_books.code='precious-metals' 的 share 也通過(採購可預覽)
 *
 * Endpoints:
 *   GET  /prices                       — 11 金屬最新報價 + 日/週/月漲跌
 *   GET  /prices/timeseries?metal=&days=
 *   GET  /macro                        — 宏觀 8 項
 *   GET  /news?limit=20                — 今日新聞(_blank 開原始)
 *   GET  /reports?type=weekly|monthly  — published=1 最新一筆
 *   POST /ai-analyze                   — SSE streaming AI 問答(限縮 prompt + 預塞 RAG)
 *   GET  /export.xlsx?metals=          — 3 sheet 匯出
 *   GET  /preferences                  — 共用 pm_user_preferences
 *   PUT  /preferences
 */
const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const { streamChat } = require('../services/gemini');

const METAL_ZH_NAMES = {
  AU: '金', AG: '銀', PT: '鉑', PD: '鈀', RH: '銠',
  CU: '銅', AL: '鋁', NI: '鎳', ZN: '鋅', PB: '鉛', SN: '錫',
};
const PRECIOUS_METALS = ['AU', 'AG', 'PT', 'PD', 'RH'];
const BASE_METALS = ['CU', 'AL', 'NI', 'ZN', 'PB', 'SN'];
const ALL_METALS = [...PRECIOUS_METALS, ...BASE_METALS];
const groupOf = (code) => (PRECIOUS_METALS.includes(code) ? '貴金屬' : (BASE_METALS.includes(code) ? '基本金屬' : '其他'));

// ── grantee tuples helper(沿用 helpSections / pmBriefing 的 pattern)──
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

async function userHasBookByCode(db, user, code) {
  const book = await db.prepare(
    `SELECT id, is_special, is_active FROM help_books WHERE code = ?`
  ).get(code);
  if (!book || Number(book.is_active) === 0) return false;
  if (Number(book.is_special) === 0) return true;
  const tuples = userGranteeTuples(user);
  if (tuples.length === 0) return false;
  const orClauses = tuples.map(() => '(grantee_type = ? AND grantee_id = ?)').join(' OR ');
  const params = tuples.flatMap(([t, v]) => [t, v]);
  const row = await db.prepare(`
    SELECT 1 AS hit FROM help_book_shares
    WHERE book_id = ? AND (${orClauses}) FETCH FIRST 1 ROWS ONLY
  `).get(book.id, ...params);
  return !!row;
}

async function verifyMetalsAccess(req, res, next) {
  try {
    const db = require('../database-oracle').db;
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'No user' });
    if (user.role === 'admin') return next();

    // metals-public 或 precious-metals 任一通過即可
    if (await userHasBookByCode(db, user, 'metals-public')) return next();
    if (await userHasBookByCode(db, user, 'precious-metals')) return next();
    return res.status(403).json({ error: '需要金屬情報閱讀權限' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /prices?metals=AU,CU,...
 * 回每金屬最新一筆 + 日/週/月漲跌%
 *
 * 漲跌算法:取目標日(latest)價,跟目標日 -1d / -7d / -30d 最近一筆價比
 * (DB 不見得每天都有,所以用「最近一筆 ≤ 該日期」邏輯,而非嚴格 LAG)
 */
router.get('/prices', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metalsCsv = req.query.metals;
    const asOf = String(req.query.as_of || '').trim();  // 'YYYY-MM-DD',空=今天
    const filter = metalsCsv
      ? `AND UPPER(metal_code) IN (${metalsCsv.split(',').map(() => 'UPPER(?)').join(',')})`
      : '';
    const params = metalsCsv ? metalsCsv.split(',') : [];

    // 基準日 SQL fragment — 給定就 TO_DATE,沒給就 TRUNC(SYSDATE)
    // 用 TRUNC(as_of_date) 比較避 DATE 帶時分秒被 <= 'YYYY-MM-DD' 排掉的雷
    // (e.g. as_of_date='2026-05-10 18:00:00' 對 <= TO_DATE('2026-05-10') 是 false)
    const validAsOf = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null;
    const baseDateExpr = validAsOf ? `TO_DATE(?, 'YYYY-MM-DD')` : `TRUNC(SYSDATE)`;
    const dateBinds = validAsOf ? [validAsOf, validAsOf] : [];

    const latestRows = await db.prepare(`
      SELECT * FROM (
        SELECT UPPER(metal_code) AS metal_code, metal_name, price_usd, day_change_pct,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               as_of_date AS as_of_date_raw, source,
               ROW_NUMBER() OVER (PARTITION BY UPPER(metal_code) ORDER BY as_of_date DESC) AS rn
        FROM pm_price_history
        WHERE TRUNC(as_of_date) <= ${baseDateExpr}
          AND TRUNC(as_of_date) >= ${baseDateExpr} - 60
          AND price_usd IS NOT NULL
          ${filter}
      ) WHERE rn = 1
      ORDER BY metal_code
    `).all(...dateBinds, ...params);

    // 2) 對每金屬撈 -7d / -30d 最近一筆,算漲跌
    const result = [];
    for (const r of latestRows) {
      const code = r.metal_code || r.METAL_CODE;
      const latestPrice = Number(r.price_usd ?? r.PRICE_USD);
      const asOfRaw = r.as_of_date_raw || r.AS_OF_DATE_RAW;

      const fetchPriceAt = async (offset) => {
        try {
          const row = await db.prepare(`
            SELECT price_usd FROM (
              SELECT price_usd FROM pm_price_history
              WHERE UPPER(metal_code) = ?
                AND as_of_date <= ?
                AND as_of_date >= ? - ?
                AND price_usd IS NOT NULL
              ORDER BY as_of_date DESC
            ) WHERE ROWNUM = 1
          `).get(code, asOfRaw, asOfRaw, offset + 7); // 找 [offset, offset+7] 區間最近一筆
          return Number(row?.price_usd ?? row?.PRICE_USD);
        } catch (_) { return NaN; }
      };

      // 7 / 30 天前
      const price7 = await fetchPriceAt(7);
      const price30 = await fetchPriceAt(30);
      const weekChg = Number.isFinite(price7) && price7 > 0
        ? ((latestPrice - price7) / price7) * 100 : null;
      const monthChg = Number.isFinite(price30) && price30 > 0
        ? ((latestPrice - price30) / price30) * 100 : null;

      result.push({
        metal_code: code,
        metal_name: r.metal_name || r.METAL_NAME || METAL_ZH_NAMES[code] || code,
        group: groupOf(code),
        price_usd: latestPrice,
        as_of_date: r.as_of_date || r.AS_OF_DATE,
        source: r.source || r.SOURCE,
        day_change_pct: Number(r.day_change_pct ?? r.DAY_CHANGE_PCT) || null,
        week_change_pct: weekChg != null && Number.isFinite(weekChg) ? Number(weekChg.toFixed(2)) : null,
        month_change_pct: monthChg != null && Number.isFinite(monthChg) ? Number(monthChg.toFixed(2)) : null,
      });
    }

    res.json(result);
  } catch (e) {
    console.error('[Metals] /prices error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /prices/timeseries?metal=&days=180&end_date=YYYY-MM-DD
 * 回 [{ date, price }] 給走勢圖。max 3650 (10 年);end_date 預設今天
 */
router.get('/prices/timeseries', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metal = String(req.query.metal || '').trim();
    const days = Math.min(Math.max(Number(req.query.days || 180), 1), 3650);
    const endDate = String(req.query.end_date || '').trim();
    if (!metal) return res.status(400).json({ error: 'metal required' });

    const validEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null;
    const baseDateExpr = validEnd ? `TO_DATE(?, 'YYYY-MM-DD')` : `TRUNC(SYSDATE)`;
    const dateBinds = validEnd ? [validEnd, validEnd] : [];

    // 用 TRUNC(as_of_date) 比較,避免 DATE 帶時分秒被排除
    const sql = `
      SELECT TO_CHAR(TRUNC(as_of_date), 'YYYY-MM-DD') AS date,
             AVG(price_usd) AS price
      FROM pm_price_history
      WHERE UPPER(metal_code) = UPPER(?)
        AND TRUNC(as_of_date) <= ${baseDateExpr}
        AND TRUNC(as_of_date) >= ${baseDateExpr} - ?
        AND price_usd IS NOT NULL
      GROUP BY TRUNC(as_of_date)
      ORDER BY TRUNC(as_of_date)
    `;
    const rows = await db.prepare(sql).all(metal, ...dateBinds, days);
    console.log(`[Metals] timeseries metal=${metal} days=${days} end=${validEnd || 'today'} → ${rows.length} rows`);
    res.json(rows.map(r => ({
      date: r.date || r.DATE,
      price: Number(r.price ?? r.PRICE),
    })));
  } catch (e) {
    console.error('[Metals] /prices/timeseries error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MACRO
// ─────────────────────────────────────────────────────────────────────────────

router.get('/macro', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const asOf = String(req.query.as_of || '').trim();
    const validAsOf = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null;
    const baseDateExpr = validAsOf ? `TO_DATE(?, 'YYYY-MM-DD')` : `TRUNC(SYSDATE)`;
    const dateBinds = validAsOf ? [validAsOf, validAsOf] : [];
    const rows = await db.prepare(`
      SELECT * FROM (
        SELECT indicator_code, indicator_name, value, unit, source,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               LAG(value) OVER (PARTITION BY indicator_code ORDER BY as_of_date) AS prev_value,
               ROW_NUMBER() OVER (PARTITION BY indicator_code ORDER BY as_of_date DESC) AS rn
        FROM pm_macro_history
        WHERE TRUNC(as_of_date) <= ${baseDateExpr}
          AND TRUNC(as_of_date) >= ${baseDateExpr} - 14
          AND value IS NOT NULL
      ) WHERE rn = 1
      ORDER BY indicator_code
    `).all(...dateBinds);
    const norm = rows.map(r => {
      const val = Number(r.value ?? r.VALUE);
      const prev = Number(r.prev_value ?? r.PREV_VALUE);
      const chg = Number.isFinite(prev) && prev !== 0 ? ((val - prev) / prev) * 100 : null;
      return {
        indicator_code: r.indicator_code || r.INDICATOR_CODE,
        indicator_name: r.indicator_name || r.INDICATOR_NAME,
        value: val,
        unit: r.unit || r.UNIT,
        as_of_date: r.as_of_date || r.AS_OF_DATE,
        day_change_pct: chg != null && Number.isFinite(chg) ? Number(chg.toFixed(2)) : null,
      };
    });
    res.json(norm);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEWS — 今日抓取 / 點擊 _blank
// ─────────────────────────────────────────────────────────────────────────────

router.get('/news', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 200);
    const date = String(req.query.date || '').trim();    // 'YYYY-MM-DD' 看那天 scraped 的
    const todayOnly = !date && String(req.query.today || '1') === '1';
    const where = [];
    const params = [];
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // 那天 scraped 的(00:00 ~ 隔天 00:00)
      where.push(`scraped_at >= TO_DATE(?, 'YYYY-MM-DD') AND scraped_at < TO_DATE(?, 'YYYY-MM-DD') + 1`);
      params.push(date, date);
    } else if (todayOnly) {
      where.push(`scraped_at >= TRUNC(SYSDATE)`);
    } else {
      where.push(`scraped_at >= TRUNC(SYSDATE) - 7`);
    }
    const rows = await db.prepare(`
      SELECT id, url, title, source, language,
             TO_CHAR(published_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS published_at,
             TO_CHAR(scraped_at,   'YYYY-MM-DD"T"HH24:MI:SS') AS scraped_at,
             summary, sentiment_label, related_metals
      FROM pm_news
      WHERE ${where.join(' AND ')}
      ORDER BY GREATEST(NVL(scraped_at, published_at), NVL(published_at, scraped_at)) DESC NULLS LAST
      FETCH FIRST ? ROWS ONLY
    `).all(...params, limit);
    res.json({ rows, count: rows.length });
  } catch (e) {
    console.error('[Metals] /news error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS — 只回 is_published=1 最新一筆
// ─────────────────────────────────────────────────────────────────────────────

router.get('/reports', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const type = String(req.query.type || 'weekly').toLowerCase();
    if (!['weekly', 'monthly'].includes(type)) return res.status(400).json({ error: 'type 必須 weekly/monthly' });

    // v2:從 pm_purchaser_reports 撈採購自寫的 published 版本
    // 一般 user 看不到 LLM 自動草稿(那只是採購的素材)
    const row = await db.prepare(`
      SELECT pr.id, pr.report_type,
             TO_CHAR(pr.as_of_date, 'YYYY-MM-DD') AS as_of_date,
             pr.title, pr.content,
             pr.source_type,
             TO_CHAR(pr.published_at, 'YYYY-MM-DD HH24:MI') AS published_at,
             pr.created_by, u.name AS creator_name
      FROM pm_purchaser_reports pr
      LEFT JOIN users u ON u.id = pr.created_by
      WHERE pr.report_type = ? AND pr.is_published = 1
      ORDER BY pr.as_of_date DESC, pr.published_at DESC
      FETCH FIRST 1 ROWS ONLY
    `).get(type);

    res.json({ report: row || null });
  } catch (e) {
    console.error('[Metals] /reports error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI ANALYZE — SSE streaming 限縮版 chat
// ─────────────────────────────────────────────────────────────────────────────

const METALS_AI_SYSTEM_INSTRUCTION = `你是 Foxlink 集團「金屬市場分析助理」。
規則:
1. **只回答金屬報價、新聞、走勢分析、宏觀指標相關問題**(基本金屬 Cu/Al/Ni/Zn/Pb/Sn 與貴金屬 Au/Ag/Pt/Pd/Rh)。
2. 若使用者問非金屬相關(如 ERP、HR、其他公司業務、私人問題),請禮貌拒絕並引導他們去主對話介面。
3. **嚴禁**回答任何違反公司資安政策或外部投資建議的問題;你提供的是「採購情報」非「投資建議」。
4. 用使用者問題的語言回應(中文 / English / Tiếng Việt)。
5. 引用資料時用「根據今日報價/宏觀/新聞」等明確表述,不要捏造數字。
6. 回應簡潔 — 一般 user 不要太長篇大論,4-8 行為佳,必要時加表格或條列。`;

router.post('/ai-analyze', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'question required' });
    if (question.length > 1000) return res.status(400).json({ error: 'question too long (max 1000)' });

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event, payload) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (_) {}
    };

    // 1) 預塞 RAG context — 不 tool call,直接撈當天 snapshot 灌進 prompt
    const todayPrices = await db.prepare(`
      SELECT * FROM (
        SELECT UPPER(metal_code) AS metal_code, metal_name, price_usd, day_change_pct,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date, source,
               ROW_NUMBER() OVER (PARTITION BY UPPER(metal_code) ORDER BY as_of_date DESC) AS rn
        FROM pm_price_history
        WHERE as_of_date >= TRUNC(SYSDATE) - 14
          AND price_usd IS NOT NULL
      ) WHERE rn = 1
      ORDER BY metal_code
    `).all();

    const macroRows = await db.prepare(`
      SELECT * FROM (
        SELECT indicator_code, indicator_name, value,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               ROW_NUMBER() OVER (PARTITION BY indicator_code ORDER BY as_of_date DESC) AS rn
        FROM pm_macro_history
        WHERE as_of_date >= TRUNC(SYSDATE) - 14
          AND value IS NOT NULL
      ) WHERE rn = 1
      ORDER BY indicator_code
    `).all();

    const newsRows = await db.prepare(`
      SELECT title, source, summary, sentiment_label, related_metals,
             TO_CHAR(scraped_at, 'YYYY-MM-DD HH24:MI') AS scraped_at
      FROM pm_news
      WHERE scraped_at >= TRUNC(SYSDATE) - 2
      ORDER BY scraped_at DESC
      FETCH FIRST 10 ROWS ONLY
    `).all();

    const fmt = (n) => Number.isFinite(Number(n)) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
    const sign = (n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return '';
      return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    };

    const priceContext = (todayPrices || []).map(r => {
      const code = r.metal_code || r.METAL_CODE;
      return `${code}(${r.metal_name || r.METAL_NAME || METAL_ZH_NAMES[code] || code}): $${fmt(r.price_usd ?? r.PRICE_USD)} ${sign(r.day_change_pct ?? r.DAY_CHANGE_PCT)} (${r.as_of_date || r.AS_OF_DATE}, ${r.source || r.SOURCE || ''})`;
    }).join('\n');

    const macroContext = (macroRows || []).map(r =>
      `${r.indicator_code || r.INDICATOR_CODE}(${r.indicator_name || r.INDICATOR_NAME}): ${fmt(r.value ?? r.VALUE)} (${r.as_of_date || r.AS_OF_DATE})`
    ).join('\n');

    const newsContext = (newsRows || []).map((r, i) =>
      `[${i + 1}] ${r.title || r.TITLE} | ${r.source || r.SOURCE || ''} | ${r.related_metals || r.RELATED_METALS || ''} | ${r.sentiment_label || r.SENTIMENT_LABEL || ''}\n   ${(r.summary || r.SUMMARY || '').slice(0, 200)}`
    ).join('\n\n');

    const ragContext = `=== 當前金屬報價 ===\n${priceContext || '(暫無資料)'}\n\n=== 宏觀指標 ===\n${macroContext || '(暫無資料)'}\n\n=== 近 2 日新聞 Top 10 ===\n${newsContext || '(暫無資料)'}`;
    const fullSystem = `${METALS_AI_SYSTEM_INSTRUCTION}\n\n---\n以下是當前資料快照(供你回答用,不要重複貼出來,引用即可):\n\n${ragContext}`;

    // 2) 呼叫 streamChat,session-only — history=[], 無 file
    const apiModel = process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
    const userParts = [{ text: question }];

    let totalText = '';
    const onChunk = (text) => {
      if (!text) return;
      totalText += text;
      send('chunk', { text });
    };

    try {
      const result = await streamChat(
        apiModel,
        [], // history = empty (session-only)
        userParts,
        onChunk,
        fullSystem,
        true, // disableSearch — 我們已餵了 RAG,不需 google
        { reasoning_effort: 'low', max_output_tokens: 2048 }
      );
      send('done', {
        input_tokens: result?.inputTokens || 0,
        output_tokens: result?.outputTokens || 0,
      });
    } catch (e) {
      console.error('[Metals] /ai-analyze stream error:', e);
      send('error', { error: e.message });
    } finally {
      res.end();
    }
  } catch (e) {
    console.error('[Metals] /ai-analyze error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      try { res.end(); } catch (_) {}
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// XLSX EXPORT — 3 sheet:金屬報價 / 宏觀數據 / 說明
// ─────────────────────────────────────────────────────────────────────────────

router.get('/export.xlsx', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const ExcelJS = require('exceljs');
    const metalsCsv = req.query.metals;
    const asOf = String(req.query.as_of || '').trim();
    const validAsOf = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null;
    const baseDateExpr = validAsOf ? `TO_DATE(?, 'YYYY-MM-DD')` : `TRUNC(SYSDATE)`;
    const dateBinds = validAsOf ? [validAsOf, validAsOf] : [];
    const filter = metalsCsv
      ? `AND UPPER(metal_code) IN (${metalsCsv.split(',').map(() => 'UPPER(?)').join(',')})`
      : '';
    const params = metalsCsv ? metalsCsv.split(',') : [];

    // Sheet 1: 金屬報價
    const latestRows = await db.prepare(`
      SELECT * FROM (
        SELECT UPPER(metal_code) AS metal_code, metal_name, price_usd, day_change_pct,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               as_of_date AS as_of_date_raw, source,
               ROW_NUMBER() OVER (PARTITION BY UPPER(metal_code) ORDER BY as_of_date DESC) AS rn
        FROM pm_price_history
        WHERE TRUNC(as_of_date) <= ${baseDateExpr}
          AND TRUNC(as_of_date) >= ${baseDateExpr} - 60
          AND price_usd IS NOT NULL
          ${filter}
      ) WHERE rn = 1
      ORDER BY metal_code
    `).all(...dateBinds, ...params);

    const priceRows = [];
    for (const r of latestRows) {
      const code = r.metal_code || r.METAL_CODE;
      const latestPrice = Number(r.price_usd ?? r.PRICE_USD);
      const asOfRaw = r.as_of_date_raw || r.AS_OF_DATE_RAW;
      const fetchPriceAt = async (offset) => {
        try {
          const row = await db.prepare(`
            SELECT price_usd FROM (
              SELECT price_usd FROM pm_price_history
              WHERE UPPER(metal_code) = ?
                AND as_of_date <= ?
                AND as_of_date >= ? - ?
                AND price_usd IS NOT NULL
              ORDER BY as_of_date DESC
            ) WHERE ROWNUM = 1
          `).get(code, asOfRaw, asOfRaw, offset + 7);
          return Number(row?.price_usd ?? row?.PRICE_USD);
        } catch (_) { return NaN; }
      };
      const price7 = await fetchPriceAt(7);
      const price30 = await fetchPriceAt(30);
      priceRows.push({
        metal_code: code,
        metal_name: r.metal_name || r.METAL_NAME || METAL_ZH_NAMES[code] || code,
        group: groupOf(code),
        price_usd: Number.isFinite(latestPrice) ? latestPrice : null,
        as_of_date: r.as_of_date || r.AS_OF_DATE,
        day_change_pct: Number(r.day_change_pct ?? r.DAY_CHANGE_PCT) || null,
        week_change_pct: Number.isFinite(price7) && price7 > 0 ? Number((((latestPrice - price7) / price7) * 100).toFixed(2)) : null,
        month_change_pct: Number.isFinite(price30) && price30 > 0 ? Number((((latestPrice - price30) / price30) * 100).toFixed(2)) : null,
        source: r.source || r.SOURCE,
      });
    }

    // Sheet 2: 宏觀
    const macroRows = await db.prepare(`
      SELECT * FROM (
        SELECT indicator_code, indicator_name, value, unit,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               LAG(value) OVER (PARTITION BY indicator_code ORDER BY as_of_date) AS prev_value,
               ROW_NUMBER() OVER (PARTITION BY indicator_code ORDER BY as_of_date DESC) AS rn
        FROM pm_macro_history
        WHERE TRUNC(as_of_date) <= ${baseDateExpr}
          AND TRUNC(as_of_date) >= ${baseDateExpr} - 14
          AND value IS NOT NULL
      ) WHERE rn = 1
      ORDER BY indicator_code
    `).all(...dateBinds);

    // Build workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Foxlink Cortex Metals Lite';
    wb.created = new Date();

    // Sheet 1
    const ws1 = wb.addWorksheet('金屬報價');
    ws1.columns = [
      { header: 'metal_code', key: 'metal_code', width: 12 },
      { header: 'metal_name', key: 'metal_name', width: 12 },
      { header: 'group', key: 'group', width: 12 },
      { header: 'price_usd', key: 'price_usd', width: 14 },
      { header: 'as_of_date', key: 'as_of_date', width: 14 },
      { header: 'day_change_pct', key: 'day_change_pct', width: 16 },
      { header: 'week_change_pct', key: 'week_change_pct', width: 16 },
      { header: 'month_change_pct', key: 'month_change_pct', width: 18 },
      { header: 'source', key: 'source', width: 18 },
    ];
    ws1.getRow(1).font = { bold: true };
    ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7E0' } };
    priceRows.forEach(r => ws1.addRow(r));
    ws1.getColumn('price_usd').numFmt = '#,##0.00';
    ['day_change_pct', 'week_change_pct', 'month_change_pct'].forEach(c => {
      ws1.getColumn(c).numFmt = '+0.00"%";-0.00"%";0"%"';
    });

    // Sheet 2
    const ws2 = wb.addWorksheet('宏觀數據');
    ws2.columns = [
      { header: 'indicator_code', key: 'indicator_code', width: 16 },
      { header: 'indicator_name', key: 'indicator_name', width: 22 },
      { header: 'value', key: 'value', width: 14 },
      { header: 'unit', key: 'unit', width: 10 },
      { header: 'as_of_date', key: 'as_of_date', width: 14 },
      { header: 'day_change_pct', key: 'day_change_pct', width: 16 },
    ];
    ws2.getRow(1).font = { bold: true };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
    for (const r of macroRows) {
      const val = Number(r.value ?? r.VALUE);
      const prev = Number(r.prev_value ?? r.PREV_VALUE);
      const chg = Number.isFinite(prev) && prev !== 0 ? ((val - prev) / prev) * 100 : null;
      ws2.addRow({
        indicator_code: r.indicator_code || r.INDICATOR_CODE,
        indicator_name: r.indicator_name || r.INDICATOR_NAME,
        value: Number.isFinite(val) ? val : null,
        unit: r.unit || r.UNIT,
        as_of_date: r.as_of_date || r.AS_OF_DATE,
        day_change_pct: chg != null && Number.isFinite(chg) ? Number(chg.toFixed(2)) : null,
      });
    }
    ws2.getColumn('value').numFmt = '#,##0.0000';
    ws2.getColumn('day_change_pct').numFmt = '+0.00"%";-0.00"%";0"%"';

    // Sheet 3:說明 / 法務留證
    const ws3 = wb.addWorksheet('說明');
    ws3.columns = [
      { header: '項目', key: 'k', width: 24 },
      { header: '內容', key: 'v', width: 80 },
    ];
    ws3.getRow(1).font = { bold: true };
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
    const exporter = req.user?.username ? `${req.user.username} (${req.user.name || ''})` : '(未知)';
    [
      ['匯出時間', stamp + ' (UTC)'],
      ['匯出人', exporter],
      ['基準日期', asOf || '今日 (' + now.toISOString().slice(0, 10) + ')'],
      ['涵蓋金屬', metalsCsv || '全部 11 種'],
      ['資料來源', 'Foxlink 集團內部 PM 排程抓取(LBMA / Westmetall / SMM 等公開資訊)'],
      ['免責聲明', '本資料供集團內部採購情報參考,非投資建議。價格以實際採購單成交為準,本系統不對任何因引用本資料而產生的決策損失負責。'],
      ['資料口徑', '金屬報價:基準日 ≤ as_of 60 天內最新一筆;週/月漲跌:對 7 天/30 天前最近一筆比較;宏觀:14 天內最新一筆。'],
    ].forEach(([k, v]) => ws3.addRow({ k, v }));

    // Output
    const buf = await wb.xlsx.writeBuffer();
    const fname = `metals_snapshot_${now.toISOString().slice(0, 10)}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('[Metals] /export.xlsx error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// USER PREFERENCES — 共用 pm_user_preferences
// ─────────────────────────────────────────────────────────────────────────────

router.get('/preferences', verifyToken, verifyMetalsAccess, async (req, res) => {
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

router.put('/preferences', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const focused = Array.isArray(req.body?.focused_metals)
      ? req.body.focused_metals.filter(Boolean).map(s => String(s).toUpperCase()).join(',')
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
