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

    // 半開區間 [start, end+1):確保 as_of_date 帶時分秒也能撈到
    let priceWhere, priceBinds;
    if (validAsOf) {
      priceWhere = `as_of_date >= TO_DATE(?, 'YYYY-MM-DD') - 60
                    AND as_of_date <  TO_DATE(?, 'YYYY-MM-DD') + 1`;
      priceBinds = [validAsOf, validAsOf];
    } else {
      priceWhere = `as_of_date >= TRUNC(SYSDATE) - 60
                    AND as_of_date <  TRUNC(SYSDATE) + 1`;
      priceBinds = [];
    }

    const latestRows = await db.prepare(`
      SELECT * FROM (
        SELECT UPPER(metal_code) AS metal_code, metal_name, price_usd, day_change_pct,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               as_of_date AS as_of_date_raw, source,
               ROW_NUMBER() OVER (PARTITION BY UPPER(metal_code) ORDER BY as_of_date DESC) AS rn
        FROM pm_price_history
        WHERE ${priceWhere}
          AND price_usd IS NOT NULL
          ${filter}
      ) WHERE rn = 1
      ORDER BY metal_code
    `).all(...priceBinds, ...params);

    // 2) 對每金屬撈 -7d / -30d 最近一筆,算漲跌
    //
    // 2 個 bug fix(2026-05-11):
    //   (a) 之前用 r.as_of_date_raw 結果 lowercaseKeys 把 JS Date → ISO 字串,
    //       oracledb bind 跟 DATE 欄比較 implicit cast 失敗 → query throw → catch NaN → UI 「—」
    //       改用 r.as_of_date(本來就是 'YYYY-MM-DD' 字串)+ TO_DATE(?, 'YYYY-MM-DD')
    //   (b) 上界 `<= asOfRaw`(沒減 offset)→ 永遠回最新 row,不是 N 天前
    //       改 `<= TO_DATE - offset` 才是真的 N 天前
    const result = [];
    for (const r of latestRows) {
      const code = r.metal_code || r.METAL_CODE;
      const latestPrice = Number(r.price_usd ?? r.PRICE_USD);
      const asOfStr = r.as_of_date || r.AS_OF_DATE;  // 'YYYY-MM-DD' 字串

      const fetchPriceAt = async (offset) => {
        try {
          const row = await db.prepare(`
            SELECT price_usd FROM (
              SELECT price_usd FROM pm_price_history
              WHERE UPPER(metal_code) = UPPER(?)
                AND as_of_date <= TO_DATE(?, 'YYYY-MM-DD') - ?
                AND as_of_date >= TO_DATE(?, 'YYYY-MM-DD') - ?
                AND price_usd IS NOT NULL
              ORDER BY as_of_date DESC
            ) WHERE ROWNUM = 1
          `).get(code, asOfStr, offset, asOfStr, offset + 7); // [asOf-offset-7, asOf-offset]
          return Number(row?.price_usd ?? row?.PRICE_USD);
        } catch (e) {
          console.warn(`[Metals] fetchPriceAt ${code} offset=${offset} 失敗:`, e.message);
          return NaN;
        }
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
    const daysRaw = Number(req.query.days || 180);
    const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 180, 1), 3650);
    const endDate = String(req.query.end_date || '').trim();
    if (!metal) return res.status(400).json({ error: 'metal required' });

    // 完全照抄 pmBriefing.js 既有 working pattern,**不做** end_date 條件分支。
    // 若 caller 給 end_date 就用它當「當前日」往回算 days,否則用 SYSDATE。
    // 用同一條 SQL(with 一個 binding 條件)避免雙分支隱藏 bug。
    const validEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null;
    const sql = validEnd
      ? `SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d,
                AVG(price_usd) AS p
         FROM pm_price_history
         WHERE UPPER(metal_code) = UPPER(?)
           AND as_of_date >= TO_DATE(?, 'YYYY-MM-DD') - ?
           AND as_of_date <  TO_DATE(?, 'YYYY-MM-DD') + 1
           AND price_usd IS NOT NULL
         GROUP BY as_of_date
         ORDER BY as_of_date`
      : `SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d,
                AVG(price_usd) AS p
         FROM pm_price_history
         WHERE UPPER(metal_code) = UPPER(?)
           AND as_of_date >= TRUNC(SYSDATE) - ?
           AND price_usd IS NOT NULL
         GROUP BY as_of_date
         ORDER BY as_of_date`;
    const binds = validEnd ? [metal, validEnd, days, validEnd] : [metal, days];

    console.log(`[Metals] timeseries metal=${metal} days=${days} end=${validEnd || 'today'} binds=${JSON.stringify(binds)}`);

    let rows;
    try {
      rows = await db.prepare(sql).all(...binds);
    } catch (sqlErr) {
      console.error('[Metals] timeseries SQL 失敗:', sqlErr?.message, '\nSQL:', sql, '\nBinds:', binds);
      return res.status(500).json({ error: sqlErr?.message || 'SQL error', sql_preview: sql.replace(/\s+/g, ' ').slice(0, 300) });
    }

    console.log(`[Metals] timeseries → ${rows.length} rows`);

    res.json(rows.map(r => ({
      date: r.d || r.D,
      price: Number(r.p ?? r.P),
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

    let macroWhere, macroBinds;
    if (validAsOf) {
      macroWhere = `as_of_date >= TO_DATE(?, 'YYYY-MM-DD') - 14
                    AND as_of_date <  TO_DATE(?, 'YYYY-MM-DD') + 1`;
      macroBinds = [validAsOf, validAsOf];
    } else {
      macroWhere = `as_of_date >= TRUNC(SYSDATE) - 14
                    AND as_of_date <  TRUNC(SYSDATE) + 1`;
      macroBinds = [];
    }

    const rows = await db.prepare(`
      SELECT * FROM (
        SELECT indicator_code, indicator_name, value, unit, source,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               LAG(value) OVER (PARTITION BY indicator_code ORDER BY as_of_date) AS prev_value,
               ROW_NUMBER() OVER (PARTITION BY indicator_code ORDER BY as_of_date DESC) AS rn
        FROM pm_macro_history
        WHERE ${macroWhere}
          AND value IS NOT NULL
      ) WHERE rn = 1
      ORDER BY indicator_code
    `).all(...macroBinds);
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

// 把 caller 給的 model preset / 名稱 resolve 成實際 API model 名,
// 並回傳「resolved name + 哪個 env var」讓前端顯示
function resolveLlmModel(input) {
  const FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
  const PRO = process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview';
  const s = String(input || '').trim().toLowerCase();
  if (s === 'pro' || s === 'gemini-pro') return { name: PRO, preset: 'pro' };
  if (s === 'flash' || s === 'gemini-flash') return { name: FLASH, preset: 'flash' };
  // 直接指定全名(白名單:只允許含 'gemini' / 'gpt' 的 string,防注入)
  if (s && /^[a-z0-9-_.]+$/i.test(s) && /gemini|gpt/.test(s)) return { name: s, preset: 'custom' };
  return { name: FLASH, preset: 'flash' };  // 預設
}

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
    const resolved = resolveLlmModel(req.body?.model);
    const apiModel = resolved.name;
    console.log(`[Metals/ai-analyze] model=${apiModel} (preset=${resolved.preset})`);
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
        model: apiModel,
        preset: resolved.preset,
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
// AI TA — 技術分析建議(streaming SSE)
// 跟 /ai-analyze 差別:這邊吃 chart 當前 context(metal/days/indicators),
// 後端算 indicator 摘要餵 LLM,專門產 TA 解讀(非泛用問答)。
// ─────────────────────────────────────────────────────────────────────────────

const METALS_TA_SYSTEM_INSTRUCTION = `你是 Foxlink 集團「金屬技術分析(TA)助理」。

任務:根據使用者目前看的 chart 配置(金屬 / 時間區間 / 勾的技術指標),
給「**當前形態描述 + 短期關注訊號**」,作為採購情報參考。

規則:
1. **只描述形態,不給投資建議**:
   - 描述:多頭 / 空頭 / 盤整 / 突破 / 跌破 / 超買 / 超賣 / 黃金交叉 / 死亡交叉
   - 不可說:「建議買進」「建議賣出」「建議避險」等指令性語句
2. **強制引用具體數值**:每個結論都要對應到我提供的 indicator 數值(MA20=X / RSI=Y 等),不能憑空講。
3. **結構化輸出**(markdown):
   - **整體趨勢**(基於 close vs MAs 的相對位置)
   - **動能信號**(RSI / MACD)
   - **關鍵價位**(近 30 天 high/low、各 MA 當前位置)
   - **短期關注**(若有 cross / 突破 / 跌破事件)
4. **強制結尾**附這句:「⚠ TA 是輔助參考,**非投資建議**,實際採購決策請依採購主管 / 銀行專員建議。」
5. **語氣中立**:不誇大、不恐嚇。回應簡潔 — 整段 200-400 字為佳。`;

router.post('/ai-ta-analyze', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { buildLlmContext } = require('../services/metalsIndicatorCalc');

    const metal = String(req.body?.metal || '').trim();
    const days = Math.min(Math.max(Number(req.body?.days || 180), 30), 3650);
    const endDate = String(req.body?.end_date || '').trim();
    const indicators = Array.isArray(req.body?.indicators) ? req.body.indicators : [];

    if (!metal) return res.status(400).json({ error: 'metal required' });
    const validEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null;

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

    // 1) 撈歷史價格 — 跟 timeseries 同邏輯
    let priceRows;
    try {
      if (validEnd) {
        priceRows = await db.prepare(`
          SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d, price_usd AS p
          FROM pm_price_history
          WHERE UPPER(metal_code) = UPPER(?)
            AND as_of_date >= TO_DATE(?, 'YYYY-MM-DD') - ?
            AND as_of_date <  TO_DATE(?, 'YYYY-MM-DD') + 1
            AND price_usd IS NOT NULL
          ORDER BY as_of_date
        `).all(metal, validEnd, days, validEnd);
      } else {
        priceRows = await db.prepare(`
          SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d, price_usd AS p
          FROM pm_price_history
          WHERE UPPER(metal_code) = UPPER(?)
            AND as_of_date >= TRUNC(SYSDATE) - ?
            AND price_usd IS NOT NULL
          ORDER BY as_of_date
        `).all(metal, days);
      }
    } catch (e) {
      send('error', { error: 'DB query failed: ' + e.message });
      return res.end();
    }

    if (!priceRows || priceRows.length === 0) {
      send('error', { error: `DB 沒有 ${metal} 在這區間的資料,先 backfill 或換時間區間` });
      return res.end();
    }

    // 2) 算 indicator context(LLM 餵料)
    const prices = priceRows.map(r => ({
      date: r.d || r.D,
      price: Number(r.p ?? r.P),
    })).filter(p => Number.isFinite(p.price));

    const ctx = buildLlmContext(prices, indicators);
    console.log(`[Metals/TA] metal=${metal} days=${days} bars=${ctx.stats?.bars} indicators=${indicators.join(',') || '(none)'}`);

    // 3) 組 prompt:把 ctx 序列化餵 LLM
    const ctxJson = JSON.stringify(ctx, null, 2);
    const indKeys = indicators.length > 0 ? indicators.join(', ') : '(無 — 只看純價格趨勢)';
    const fullSystem = `${METALS_TA_SYSTEM_INSTRUCTION}

---
使用者當前 chart 配置:
- 金屬:${metal}
- 時間區間:${days} 天 (${prices[0]?.date} ~ ${prices[prices.length - 1]?.date})
- 使用者勾的指標:${indKeys}

以下是 server 端算好的 indicator context(供你引用,**不要重複貼出來**,選對應使用者勾的指標解讀):

\`\`\`json
${ctxJson}
\`\`\`

請依規則 1-5 給 TA 解讀。`;

    // 4) streamChat
    const { streamChat } = require('../services/gemini');
    const resolvedTA = resolveLlmModel(req.body?.model);
    const apiModel = resolvedTA.name;
    console.log(`[Metals/TA] model=${apiModel} (preset=${resolvedTA.preset})`);
    const userParts = [{ text: `請給 ${metal} 當前的技術分析摘要。` }];

    let totalText = '';
    const onChunk = (text) => {
      if (!text) return;
      totalText += text;
      send('chunk', { text });
    };

    try {
      const result = await streamChat(
        apiModel,
        [],
        userParts,
        onChunk,
        fullSystem,
        true,  // disableSearch
        { reasoning_effort: 'low', max_output_tokens: 2048 }
      );
      send('done', {
        input_tokens: result?.inputTokens || 0,
        output_tokens: result?.outputTokens || 0,
        bars_analyzed: ctx.stats?.bars || 0,
        model: apiModel,
        preset: resolvedTA.preset,
      });
    } catch (e) {
      console.error('[Metals] /ai-ta-analyze stream error:', e);
      send('error', { error: e.message });
    } finally {
      res.end();
    }
  } catch (e) {
    console.error('[Metals] /ai-ta-analyze error:', e);
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
    const filter = metalsCsv
      ? `AND UPPER(metal_code) IN (${metalsCsv.split(',').map(() => 'UPPER(?)').join(',')})`
      : '';
    const params = metalsCsv ? metalsCsv.split(',') : [];

    let priceWhere, priceBinds;
    if (validAsOf) {
      priceWhere = `as_of_date >= TO_DATE(?, 'YYYY-MM-DD') - 60
                    AND as_of_date <  TO_DATE(?, 'YYYY-MM-DD') + 1`;
      priceBinds = [validAsOf, validAsOf];
    } else {
      priceWhere = `as_of_date >= TRUNC(SYSDATE) - 60
                    AND as_of_date <  TRUNC(SYSDATE) + 1`;
      priceBinds = [];
    }

    // Sheet 1: 金屬報價
    const latestRows = await db.prepare(`
      SELECT * FROM (
        SELECT UPPER(metal_code) AS metal_code, metal_name, price_usd, day_change_pct,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               as_of_date AS as_of_date_raw, source,
               ROW_NUMBER() OVER (PARTITION BY UPPER(metal_code) ORDER BY as_of_date DESC) AS rn
        FROM pm_price_history
        WHERE ${priceWhere}
          AND price_usd IS NOT NULL
          ${filter}
      ) WHERE rn = 1
      ORDER BY metal_code
    `).all(...priceBinds, ...params);

    const priceRows = [];
    for (const r of latestRows) {
      const code = r.metal_code || r.METAL_CODE;
      const latestPrice = Number(r.price_usd ?? r.PRICE_USD);
      const asOfStr = r.as_of_date || r.AS_OF_DATE;  // 同 /prices,改用 string 'YYYY-MM-DD'
      const fetchPriceAt = async (offset) => {
        try {
          const row = await db.prepare(`
            SELECT price_usd FROM (
              SELECT price_usd FROM pm_price_history
              WHERE UPPER(metal_code) = UPPER(?)
                AND as_of_date <= TO_DATE(?, 'YYYY-MM-DD') - ?
                AND as_of_date >= TO_DATE(?, 'YYYY-MM-DD') - ?
                AND price_usd IS NOT NULL
              ORDER BY as_of_date DESC
            ) WHERE ROWNUM = 1
          `).get(code, asOfStr, offset, asOfStr, offset + 7);
          return Number(row?.price_usd ?? row?.PRICE_USD);
        } catch (e) {
          console.warn(`[Metals/xlsx] fetchPriceAt ${code} offset=${offset} 失敗:`, e.message);
          return NaN;
        }
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
    let macroWhere2, macroBinds2;
    if (validAsOf) {
      macroWhere2 = `as_of_date >= TO_DATE(?, 'YYYY-MM-DD') - 14
                     AND as_of_date <  TO_DATE(?, 'YYYY-MM-DD') + 1`;
      macroBinds2 = [validAsOf, validAsOf];
    } else {
      macroWhere2 = `as_of_date >= TRUNC(SYSDATE) - 14
                     AND as_of_date <  TRUNC(SYSDATE) + 1`;
      macroBinds2 = [];
    }
    const macroRows = await db.prepare(`
      SELECT * FROM (
        SELECT indicator_code, indicator_name, value, unit,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
               LAG(value) OVER (PARTITION BY indicator_code ORDER BY as_of_date) AS prev_value,
               ROW_NUMBER() OVER (PARTITION BY indicator_code ORDER BY as_of_date DESC) AS rn
        FROM pm_macro_history
        WHERE ${macroWhere2}
          AND value IS NOT NULL
      ) WHERE rn = 1
      ORDER BY indicator_code
    `).all(...macroBinds2);

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
// CHART ANNOTATIONS — 使用者手寫標註(水平線 / 趨勢線 / 文字)
// 持久化 per (user, metal),不分享給別 user
// ─────────────────────────────────────────────────────────────────────────────

const ANN_TYPES = new Set(['horizontal', 'trendline', 'text']);

router.get('/annotations', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metal = String(req.query.metal || '').trim();
    if (!metal) return res.status(400).json({ error: 'metal required' });
    const rows = await db.prepare(`
      SELECT id, metal_code, ann_type, data_json, color, note,
             TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
      FROM pm_chart_annotations
      WHERE user_id = ? AND UPPER(metal_code) = UPPER(?)
      ORDER BY id DESC
    `).all(req.user.id, metal);
    // parse data_json
    const out = rows.map(r => {
      let data = null;
      try { data = JSON.parse(r.data_json || r.DATA_JSON || '{}'); } catch (_) {}
      return {
        id: r.id || r.ID,
        metal_code: r.metal_code || r.METAL_CODE,
        ann_type: r.ann_type || r.ANN_TYPE,
        data,
        color: r.color || r.COLOR,
        note: r.note || r.NOTE,
        created_at: r.created_at || r.CREATED_AT,
      };
    });
    res.json({ rows: out });
  } catch (e) {
    console.error('[Metals] GET /annotations error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/annotations', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { metal, ann_type, data, color, note } = req.body || {};
    if (!metal) return res.status(400).json({ error: 'metal required' });
    if (!ANN_TYPES.has(ann_type)) return res.status(400).json({ error: 'invalid ann_type' });
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data required (object)' });
    const dataJson = JSON.stringify(data);
    if (dataJson.length > 4000) return res.status(400).json({ error: 'data too large' });

    await db.prepare(`
      INSERT INTO pm_chart_annotations (user_id, metal_code, ann_type, data_json, color, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, String(metal).toUpperCase(), ann_type, dataJson,
      color || null,
      note ? String(note).slice(0, 200) : null
    );
    const newRow = await db.prepare(`
      SELECT id FROM pm_chart_annotations
      WHERE user_id = ? AND UPPER(metal_code) = UPPER(?)
      ORDER BY id DESC FETCH FIRST 1 ROWS ONLY
    `).get(req.user.id, metal);
    res.json({ ok: true, id: newRow?.id ?? newRow?.ID ?? null });
  } catch (e) {
    console.error('[Metals] POST /annotations error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/annotations/:id', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const r = await db.prepare(`
      DELETE FROM pm_chart_annotations WHERE id = ? AND user_id = ?
    `).run(id, req.user.id);
    const cnt = r?.rowsAffected ?? r?.changes ?? 0;
    if (!cnt) return res.status(404).json({ error: 'not found or not owned' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /annotations?metal=CU — 清空該金屬全部標註
router.delete('/annotations', verifyToken, verifyMetalsAccess, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metal = String(req.query.metal || '').trim();
    if (!metal) return res.status(400).json({ error: 'metal required' });
    const r = await db.prepare(`
      DELETE FROM pm_chart_annotations WHERE user_id = ? AND UPPER(metal_code) = UPPER(?)
    `).run(req.user.id, metal);
    res.json({ ok: true, deleted: r?.rowsAffected ?? r?.changes ?? 0 });
  } catch (e) {
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
