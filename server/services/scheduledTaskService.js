'use strict';

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

// ── Taiwan time helpers ────────────────────────────────────────────────────────
function twNow() {
  // Returns a Date that prints as Taiwan local time via toLocaleString
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}
function twDateStr(d = twNow()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function twTimestamp(d = twNow()) {
  const date = twDateStr(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${date} ${hh}:${mm}:${ss}`;
}

// ── Concurrency queue ─────────────────────────────────────────────────────────
const MAX_CONCURRENT = 2;
let _running = 0;
const _queue = [];

function enqueue(fn) {
  _queue.push(fn);
  drainQueue();
}

function drainQueue() {
  while (_running < MAX_CONCURRENT && _queue.length > 0) {
    const fn = _queue.shift();
    _running++;
    fn().finally(() => {
      _running--;
      drainQueue();
    });
  }
}

// ── Markdown → plain text (for email body) ────────────────────────────────────
function stripMarkdownForEmail(text) {
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')                        // headers → plain
    .replace(/\*\*(.+?)\*\*/gs, '$1')                          // **bold**
    .replace(/\*(.+?)\*/gs, '$1')                              // *italic*
    .replace(/__(.+?)__/gs, '$1')                              // __bold__
    .replace(/_(.+?)_/gs, '$1')                                // _italic_
    .replace(/`([^`]+)`/g, '$1')                               // `code`
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ( $2 )') // [text](url) → text ( url )
    .replace(/^\s*[-*]\s+/gm, '• ')                            // - / * bullets
    .replace(/^[-*_]{3,}$/gm, '──────────────────────────────') // HR
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Web fetch helper ──────────────────────────────────────────────────────────
async function fetchUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FOXLINK-GPT-Bot/1.0)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();

    const contentType = res.headers.get('content-type') || '';
    const isXml = contentType.includes('xml') || /^\s*(<\?xml|<rss|<feed)/.test(raw);

    let text;
    if (isXml) {
      // RSS/Atom: strip CDATA wrappers first so titles/descriptions are preserved
      text = raw
        .replace(/<!\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .replace(/<\/item>/gi, '\n---\n')   // separator between RSS items
        .replace(/<\/entry>/gi, '\n---\n')  // Atom feeds
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 50000);
    } else {
      // HTML: strip scripts/styles then all tags
      text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ( $1 )') // preserve absolute links only
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/td>/gi, '\t')
        .replace(/<\/th>/gi, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 50000);
    }
    return text;
  } catch (e) {
    return `[無法抓取 ${url}: ${e.message}]`;
  }
}

// ── Article link extraction (host-aware) ────────────────────────────────────
// 從 list 頁的原始 HTML 抽 article-like URL 出來,給 LLM 當白名單 + server enforce。
//
// 為什麼要做這個:Vertex 的 urlContext / googleSearch grounding 對 Gemini 3 系列實測無效
// (silent ignore),Gemini 2.5 Pro 也只回 readable text 不給 URL list。LLM 只看純文字
// 沒辦法準確產出真實 URL,只能在這層用 querySelectorAll('a[href]') 給它 ground truth。
//
// host-aware 規則:
//   • news.smm.cn 的 article 路徑 = `/news/<digits>`
//   • moneydj.com 的 article 路徑 = `*/newsviewer.aspx?a=<GUID>`
//   • 其他 host:通用「path 非根、不是 # / mailto / tel / javascript」過濾
//
// 回傳 unique URL 陣列(de-dup + 限上限,避免 prompt 爆肥)
function extractArticleLinks(document, baseUrl) {
  const urls = new Set();
  let host = '';
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch (_) {}
  const anchors = document.querySelectorAll('a[href]');
  for (const a of anchors) {
    const raw = a.getAttribute('href');
    if (!raw) continue;
    // 解析成絕對 URL(JSDOM 會自動以 baseUrl resolve)
    let href;
    try { href = new URL(raw, baseUrl).toString(); } catch (_) { continue; }
    let parsed;
    try { parsed = new URL(href); } catch (_) { continue; }
    if (!/^https?:$/.test(parsed.protocol)) continue;
    const lowHost = parsed.hostname.toLowerCase();

    // host-aware:對已知 source 嚴格匹配 article URL pattern
    if (host.endsWith('smm.cn') || host.endsWith('smm.com.cn')) {
      // SMM list 頁外部 link 不要,只要 SMM 自家 article
      if (!lowHost.endsWith('smm.cn') && !lowHost.endsWith('smm.com.cn')) continue;
      if (!/^\/news\/\d{6,12}/i.test(parsed.pathname)) continue;
    } else if (host.endsWith('moneydj.com')) {
      if (!lowHost.endsWith('moneydj.com')) continue;
      if (!/newsviewer\.aspx/i.test(parsed.pathname)) continue;
      const a2 = parsed.searchParams.get('a');
      if (!a2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a2)) continue;
    } else if (host.endsWith('platinuminvestment.com') || host.endsWith('matthey.com')) {
      // 機構級評論 — 同 host 且 path 非根
      if (!lowHost.endsWith(host) && !host.endsWith(lowHost)) continue;
      if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') continue;
      // 過濾常見 nav (下拉選單錨點)
      if (/^(#|\/$)/.test(parsed.pathname)) continue;
    } else {
      // 通用:路徑非根、不是 javascript:/mailto:/tel:
      if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') continue;
    }
    // 拿掉 hash + 共通追蹤 query param(utm_*),減少 dup
    parsed.hash = '';
    for (const k of [...parsed.searchParams.keys()]) {
      if (/^utm_|^fbclid$|^gclid$/i.test(k)) parsed.searchParams.delete(k);
    }
    urls.add(parsed.toString());
    if (urls.size >= 80) break; // 上限避免 prompt 爆 — 80 個 URL 足以涵蓋當日 article
  }
  return Array.from(urls);
}

// ── Web scrape helper (readability-based, for regular HTML pages) ─────────────
// 回傳 { text, links }:
//   • text  — Readability 抽出的純文字主體(原行為)
//   • links — host-aware 抽出的 article URL 陣列(2026-05-01 加,給 LLM 白名單用)
// 對 substituteVarsAsync 而言:把 text 塞進 prompt 取代 {{scrape:URL}},links 收進 outBag
async function scrapeUrl(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Use Readability to extract main content + 同時抽 link list
    const dom = new JSDOM(html, { url });
    const links = extractArticleLinks(dom.window.document, url);
    const reader = new Readability(dom.window.document, { charThreshold: 100 });
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 200) {
      // Readability got too little — likely JS-rendered, fall back to basic strip
      console.warn(`[Scheduled] scrapeUrl: readability returned thin content for ${url}, falling back to tag-strip`);
      const fallback = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 30000);
      return {
        text: `以下是從 ${url} 抓取的網頁內容（可能含部分噪音）：\n---\n${fallback}\n---`,
        links,
      };
    }

    const title = article.title ? `標題：${article.title}\n\n` : '';
    const byline = article.byline ? `作者：${article.byline}\n` : '';
    const excerpt = article.excerpt ? `摘要：${article.excerpt}\n\n` : '';
    const body = article.textContent.trim().slice(0, 40000);

    return {
      text: `以下是從 ${url} 抓取的網頁主要內容：\n---\n${title}${byline}${excerpt}${body}\n---`,
      links,
    };
  } catch (e) {
    return { text: `[無法爬取 ${url}: ${e.message}]`, links: [] };
  }
}

// ── Helpers for substitute pipeline ─────────────────────────────────────────
// 把抽出的白名單 link list 包成 prompt 區段,並 push 到 outBag.urlWhitelist 給後續 db_write enforce
function _buildWhitelistBlock(sourceUrl, links, outBag) {
  if (!links || !links.length) {
    console.warn(`[Scheduled] scrape: ${sourceUrl} extracted 0 candidate links — JS-rendered 或 host pattern 不匹配`);
    return `\n⚠️ 從 ${sourceUrl} 抽不到 article link 白名單(可能 JS 渲染 / pattern 不匹配),**該 source 直接輸出 \`\`\`json [] \`\`\` 跳過,不要憑記憶或想像補 URL**。\n`;
  }
  console.log(`[Scheduled] scrape: ${sourceUrl} extracted ${links.length} candidate article URLs`);
  if (outBag) {
    for (const u of links) outBag.urlWhitelist.push(u);
  }
  return `\n═══ 📋 從 ${sourceUrl} 抽出的候選 article URL 白名單(server enforces — 只能挑這份)═══\n`
    + links.map((u) => `- ${u}`).join('\n')
    + `\n═══ /白名單 ═══\n`
    + `\n⚠️ **JSON 輸出的 url 欄位必須是上方白名單裡的字串**(複製貼上,不可改任何字元)。\n`
    + `   不在白名單裡的 URL → server 會直接 drop 該筆,不寫入 DB。\n`
    + `   白名單若為空 = 該 source 沒抓到 article link → 直接輸出 \`\`\`json [] \`\`\` 跳過。\n`;
}

// 簡單的 concurrency-limited Promise.all,給 deep scrape 用(避免 N 個 URL 全並發打爆 site)
async function _parallelMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Variable substitution (async — supports {{fetch:URL}} / {{scrape:URL}}) ───
function substituteVars(template, taskName) {
  // sync-only version (kept for non-async callers)
  const now = twNow();
  const date = twDateStr(now);
  const weekday = '星期' + WEEKDAY_ZH[now.getDay()];
  return (template || '')
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{weekday\}\}/g, weekday)
    .replace(/\{\{task_name\}\}/g, taskName || '');
}

async function substituteVarsAsync(template, taskName, outBag) {
  const now = twNow();
  const date = twDateStr(now);
  const weekday = '星期' + WEEKDAY_ZH[now.getDay()];
  let result = (template || '')
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{weekday\}\}/g, weekday)
    .replace(/\{\{task_name\}\}/g, taskName || '');

  // outBag(可選 mutable object)— 把跨階段的副資訊收集起來給 caller。目前只用於:
  //   • urlWhitelist:scrape 過程 host-aware 抽到的 article URL 陣列(給 LLM 當白名單 + db_write enforce)
  // caller 不傳 outBag 也沒關係,純 sync side effect 不影響主流程。
  if (outBag && !outBag.urlWhitelist) outBag.urlWhitelist = [];

  // Process all {{fetch:URL}} placeholders (API / JSON / RSS — unchanged)
  const fetchPattern = /\{\{fetch:(https?:\/\/[^}]+)\}\}/g;
  for (const m of [...result.matchAll(fetchPattern)]) {
    const url = m[1].trim();
    console.log(`[Scheduled] fetch: ${url}`);
    const content = await fetchUrl(url);
    result = result.replace(m[0], `\n以下是從 ${url} 即時抓取的網頁內容（請根據此資料回答）：\n---\n${content}\n---\n`);
  }

  // Process all {{scrape:URL}} placeholders (regular HTML pages via Readability)
  // 2026-05-01:scrapeUrl 同時回 link list,用 host-aware querySelectorAll('a[href]') 抽出
  // article URL 給 LLM 當白名單,從根本擋 LLM 編 URL 幻覺(原本只回 readability 純文字,
  // LLM 要從中推 URL → 100% 編)
  const scrapePattern = /\{\{scrape:(https?:\/\/[^}]+)\}\}/g;
  for (const m of [...result.matchAll(scrapePattern)]) {
    const url = m[1].trim();
    console.log(`[Scheduled] scrape: ${url}`);
    const { text: content, links } = await scrapeUrl(url);
    const whitelistBlock = _buildWhitelistBlock(url, links, outBag);
    result = result.replace(m[0], `\n${content}\n${whitelistBlock}`);
  }

  // Process {{scrape+:URL}} placeholders (DEEP scrape):跟 {{scrape:}} 同流程,**額外**對
  // 白名單前 N 個 URL 各自 fetch + Readability,把 N 個 article 真內文也塞進 prompt。
  // 用途:SMM / MoneyDJ / PGM 評論這種「list 頁有 link 但無內文」的 source — 沒 deep fetch
  // LLM 只能從 list 文字摘要腦補假 content(URL 對但內容跟真 article 不符)
  // N 預設 15,可用 {{scrape+:URL:N=20}} 覆寫(future);現階段固定 15
  const scrapePlusPattern = /\{\{scrape\+:(https?:\/\/[^}]+)\}\}/g;
  for (const m of [...result.matchAll(scrapePlusPattern)]) {
    const url = m[1].trim();
    console.log(`[Scheduled] scrape+: ${url} (deep fetch articles)`);
    const { text: content, links } = await scrapeUrl(url);
    const N = 15;
    const limited = (links || []).slice(0, N);
    const whitelistBlock = _buildWhitelistBlock(url, limited, outBag);

    let articlesBlock = '';
    if (limited.length) {
      console.log(`[Scheduled] scrape+: deep-fetching ${limited.length} articles in parallel (concurrency 5)`);
      const t0 = Date.now();
      const articles = await _parallelMap(limited, 5, async (articleUrl) => {
        try {
          const { text: body } = await scrapeUrl(articleUrl);
          return { url: articleUrl, body };
        } catch (e) {
          return { url: articleUrl, body: `[fetch 失敗: ${e.message}]` };
        }
      });
      const dt = Date.now() - t0;
      console.log(`[Scheduled] scrape+: deep fetch done in ${dt}ms`);

      articlesBlock = `\n═══ 📰 ${limited.length} 個 article 完整內文(server deep-fetched)═══\n\n`
        + articles.map((a, i) =>
            `--- [${i + 1}] URL: ${a.url} ---\n${(a.body || '').slice(0, 8000)}\n`
          ).join('\n')
        + `\n═══ /article 完整內文 ═══\n`
        + `\n⚠️ **JSON 輸出的 content 欄位請從上方對應 URL 的 article 內文擷取**(同篇 URL 配同篇 content)。\n`
        + `   不要從 list 頁摘要寫 content,也不要把不同 article 的內容混在一起。\n`;
    }
    result = result.replace(m[0], `\n${content}\n${whitelistBlock}${articlesBlock}`);
  }

  // {{news_seen:source[,source2]:lookback_days:limit}} — pm_news 過去 N 天該 source
  // 已抓過的 url 列表,讓 LLM 跳過避免重抓 + 浪費 token。
  // - source 可逗號分隔多個(WPIC,JohnsonMatthey)
  // - lookback_days 對齊 task 自己的 cutoff(7 / 60)
  // - limit 上限,避免 prompt 爆肥
  const newsSeenPattern = /\{\{news_seen:([^:}]+):(\d+):(\d+)\}\}/g;
  for (const m of [...result.matchAll(newsSeenPattern)]) {
    const sources = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const days    = Math.max(1, Math.min(365, parseInt(m[2], 10) || 7));
    const limit   = Math.max(10, Math.min(500, parseInt(m[3], 10) || 200));
    if (!sources.length) {
      result = result.replace(m[0], '');
      continue;
    }
    let listText = '';
    try {
      const db = require('../database-oracle').db;
      const placeholders = sources.map(() => '?').join(',');
      const rows = await db.prepare(`
        SELECT url FROM pm_news
         WHERE source IN (${placeholders})
           AND scraped_at > SYSDATE - ?
         ORDER BY scraped_at DESC
         FETCH FIRST ${limit} ROWS ONLY
      `).all(...sources, days);
      const urls = (rows || []).map(r => r.url || r.URL).filter(Boolean);
      if (urls.length) {
        listText = `\n═══ 已抓過的 URL(過去 ${days} 天,${urls.length} 筆,請跳過避免浪費 token)═══\n`
          + urls.map(u => `- ${u}`).join('\n')
          + `\n\n⚠️ 上面 RSS / list 頁的 article URL 如果出現在此清單,**直接跳過該篇**,只挑沒抓過的。\n`;
      } else {
        listText = `\n═══ 已抓過的 URL ═══\n(過去 ${days} 天 DB 尚無 ${sources.join('/')} 來源資料,所有抓到的都是新的)\n`;
      }
      console.log(`[Scheduled] news_seen sources=${sources.join(',')} days=${days} → ${urls.length} urls injected`);
    } catch (e) {
      console.warn(`[Scheduled] news_seen lookup failed (${sources.join(',')}):`, e.message);
      listText = `\n═══ 已抓過的 URL ═══\n(查詢失敗:${e.message},無法去重)\n`;
    }
    result = result.replace(m[0], listText);
  }

  // {{pm_current_prices}} — 11 金屬當日 latest price + day_change_pct,當作 LLM
  // 預測 anchor。沒這個 placeholder 時 LLM 會用訓練資料記憶的 2024 年金屬價亂飄,
  // 7 天 forecast 直接偏離當下實際價 50%+(實測:現價 4598 USD/oz 的 AU 預測 2465)。
  if (result.includes('{{pm_current_prices}}')) {
    let priceText = '';
    try {
      const db = require('../database-oracle').db;
      const rows = await db.prepare(`
        SELECT UPPER(metal_code) AS metal_code, price_usd, day_change_pct,
               TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date, source
        FROM pm_price_history p
        WHERE as_of_date = (
          SELECT MAX(as_of_date) FROM pm_price_history WHERE UPPER(metal_code) = UPPER(p.metal_code)
        )
        ORDER BY metal_code
      `).all();
      if (rows && rows.length) {
        const lines = rows.map(r => {
          const code = r.metal_code || r.METAL_CODE;
          const price = Number(r.price_usd ?? r.PRICE_USD);
          const chg = r.day_change_pct ?? r.DAY_CHANGE_PCT;
          const date = r.as_of_date || r.AS_OF_DATE;
          const src = r.source || r.SOURCE || '?';
          const chgStr = (chg == null) ? '—' : `${Number(chg) >= 0 ? '+' : ''}${Number(chg).toFixed(2)}%`;
          return `- ${code}: ${price.toLocaleString()} USD (${chgStr}, ${date}, ${src})`;
        });
        priceText = `\n═══ 當日 11 金屬實際報價(MUST be your forecast anchor)═══\n${lines.join('\n')}\n\n`
          + `⚠️ **forecast 必須以上面 price 為 base**,不准用訓練資料記憶的歷史金屬價。\n`
          + `   7 天 horizon 的 predicted_mean 通常落在 current_price ± 3-8%(極端事件 ±15%);\n`
          + `   超出 ±20% 的預測幾乎一定是你誤把舊資料當 anchor,請重新校準。\n`;
        console.log(`[Scheduled] pm_current_prices injected ${rows.length} metals`);
      } else {
        priceText = `\n═══ 當日金屬實際報價 ═══\n(pm_price_history 暫無資料,forecast 可填 null + confidence='low')\n`;
      }
    } catch (e) {
      console.warn(`[Scheduled] pm_current_prices lookup failed:`, e.message);
      priceText = `\n═══ 當日金屬實際報價 ═══\n(查詢失敗:${e.message})\n`;
    }
    result = result.replaceAll('{{pm_current_prices}}', priceText);
  }

  return result;
}

// ── Audit helper(每次 runTask 進入 / 退出都記到 scheduled_task_run_audits)──
// 為什麼:scheduled_task_runs 只在跑完才寫 + kubectl log 會被 rotate。出現
// 「paused 卻跑了」這種事件時無從追查觸發來源。這個 audit 表把所有進 runTask 的
// 呼叫都記下:force flag / status_at_entry / pod_host / caller_hint(誰呼叫的)。
// audit insert 失敗不影響主流程(warn log 就好,排程任務不能被 audit 拖死)。
async function _auditRunDecision(db, taskId, decision, info = {}) {
  try {
    await db.prepare(`
      INSERT INTO scheduled_task_run_audits
        (task_id, decision, force_flag, status_at_entry, pod_host, caller_hint)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      decision,
      info.force ? 'Y' : 'N',
      info.status || null,
      process.env.HOSTNAME || process.env.POD_NAME || null,
      (info.hint || '').slice(0, 500),
    );
  } catch (e) {
    console.warn(`[Scheduled] audit insert failed (task=${taskId}, decision=${decision}): ${e.message}`);
  }
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function withRetry(fn, maxAttempts) {
  let lastErr;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return { result: await fn(i), attempt: i };
    } catch (e) {
      lastErr = e;
      console.warn(`[Scheduled] Attempt ${i}/${maxAttempts} failed: ${e.message}`);
      if (i < maxAttempts) await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

// ── Core runner ───────────────────────────────────────────────────────────────
async function runTask(db, taskId, opts = {}) {
  // opts.force = true:run-now 手動觸發,繞過 status='active' 檢查,允許跑 paused 任務測試
  // opts.callerHint = string:呼叫來源(寫進 audit 給 debug,如 'cron'、'run-now:user=5'、pipeline node 等)
  const { force = false, callerHint = '' } = opts;
  const { generateTextSync, generateTitle } = require('./gemini');
  const { processGenerateBlocks } = require('./fileGenerator');
  const { sendMail } = require('./mailService');
  const { resolveToolRefs, hasToolRefs } = require('./promptResolver');
  const { runPipeline } = require('./pipelineRunner');
  const {
    getTemplateSchemaInstruction,
    parseJsonFromAiOutput,
    generateDocumentFromJson,
  } = require('./docTemplateService');

  // 註:多 pod 排程鎖原本只在 scheduleTask 的 cron handler 做(slot-based key, TTL 600s)。
  // 實務上看到 50 秒間隔 2 次 trigger(09:02+09:03)— 證明 cron handler lock 有繞過路徑
  // (Redis 短暫失敗降級、pod restart、其他 enqueue 路徑等),所以在 runTask 開頭加第二道
  // slot-based dedup 作為防線。force=true(admin Run Now)繞過。

  const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId);
  if (!task) {
    console.error(`[Scheduled] Task ${taskId} not found`);
    await _auditRunDecision(db, taskId, 'blocked_not_found', { force, hint: callerHint });
    return;
  }

  // Audit:每次進 runTask 都記一筆,事後追查觸發來源
  const _auditInfo = { force, status: task.status, hint: callerHint };
  await _auditRunDecision(db, task.id, 'entered', _auditInfo);

  // 防線:cron 觸發路徑下,只要 DB status 不是 active 就不跑
  if (!force && task.status !== 'active') {
    console.log(`[Scheduled] Task ${task.id} "${task.name}" status=${task.status}, skip execution`);
    await _auditRunDecision(db, task.id, 'blocked_status', _auditInfo);
    return;
  }

  // 防線 2(slot-based dedup,2026-05-19 加):
  // 對 daily / weekly / monthly schedule_type,同一個 slot 只允許跑一次。
  // 雙重保險:Redis SET NX EX(快)+ DB 查 scheduled_task_runs 近 5 分鐘 ok run(Redis 掛時保底)。
  // interval / multi_time / cron_raw 合法在同一 hour 內多次觸發,不擋。
  if (!force && ['daily', 'weekly', 'monthly'].includes(task.schedule_type)) {
    const lockKey = buildLockKey(task) + ':runonce';  // 跟 cron handler 的 key 不同,獨立判斷
    let dedupSkip = false;
    try {
      const { tryLock } = require('./redisClient');
      const acquired = await tryLock(lockKey, 1800);  // 30 分鐘 TTL,夠擋同 slot 重複
      if (!acquired) {
        console.log(`[Scheduled] Task ${task.id} "${task.name}" runonce lock ${lockKey} held, skip duplicate`);
        await _auditRunDecision(db, task.id, 'blocked_dedup_lock', _auditInfo);
        return;
      }
    } catch (e) {
      console.warn(`[Scheduled] runonce Redis lock failed (${e.message}) — fallback to DB dedup`);
    }
    // DB-based 防線:就算 Redis 失敗也擋(避免 50 秒內 2 次跑)
    try {
      const recent = await db.prepare(`
        SELECT id FROM scheduled_task_runs
        WHERE task_id = ?
          AND run_at >= SYSTIMESTAMP - NUMTODSINTERVAL(5, 'MINUTE')
          AND status = 'ok'
        FETCH FIRST 1 ROWS ONLY
      `).get(task.id);
      if (recent) {
        const rid = recent.id ?? recent.ID;
        console.log(`[Scheduled] Task ${task.id} "${task.name}" has recent ok run #${rid} (5min), skip duplicate`);
        dedupSkip = true;
      }
    } catch (e) {
      console.warn(`[Scheduled] runonce DB dedup query failed: ${e.message}`);
    }
    if (dedupSkip) {
      await _auditRunDecision(db, task.id, 'blocked_dedup_db', _auditInfo);
      return;
    }
  }

  // Check expiry
  if (task.expire_at && new Date(task.expire_at) < new Date()) {
    console.log(`[Scheduled] Task ${task.id} "${task.name}" expired, pausing`);
    await db.prepare(`UPDATE scheduled_tasks SET status='paused' WHERE id=?`).run(task.id);
    await _auditRunDecision(db, task.id, 'blocked_expired', _auditInfo);
    return;
  }
  // Check max_runs
  if (task.max_runs > 0 && task.run_count >= task.max_runs) {
    console.log(`[Scheduled] Task ${task.id} "${task.name}" reached max_runs, pausing`);
    await db.prepare(`UPDATE scheduled_tasks SET status='paused' WHERE id=?`).run(task.id);
    await _auditRunDecision(db, task.id, 'blocked_max_runs', _auditInfo);
    return;
  }
  // Phase 5 Track F-2: Token budget paused?(per-day,隔日 00:00 由 pmTokenBudgetService 解除)
  if (task.token_budget_paused_at || task.TOKEN_BUDGET_PAUSED_AT) {
    const pausedDate = new Date(task.token_budget_paused_at || task.TOKEN_BUDGET_PAUSED_AT).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (pausedDate === today) {
      console.log(`[Scheduled] Task ${task.id} "${task.name}" paused by token budget, skip until 00:00`);
      await _auditRunDecision(db, task.id, 'blocked_token_budget', _auditInfo);
      return;
    }
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(task.user_id);
  if (!user) { console.error(`[Scheduled] User ${task.user_id} not found`); return; }

  const UPLOAD_DIR = process.env.UPLOAD_DIR
    ? require('path').resolve(process.env.UPLOAD_DIR)
    : require('path').join(__dirname, '../uploads');

  const startMs = Date.now();
  let sessionId = null;
  let runStatus = 'ok';
  let runError = null;
  let responseText = '';
  let generatedFiles = [];
  let attemptNum = 1;
  let toolsUsed = { skills: [], kbs: [], mcp_tools: [], dify_kbs: [] };
  let pipelineLog = [];
  let failedNodes = [];  // pipeline 內失敗節點摘要(dashboard / skill / kb_write 等)
  // outBag 在 retry callback 內 mutate,但 pipeline 在 callback 外面也要拿,所以宣告在外面共用
  // (retry 重試時 substituteVarsAsync 會 reset outBag.urlWhitelist 為新 array,不會累積舊資料)
  const subBag = {};

  try {
    const { result, attempt } = await withRetry(async (tryNum) => {
      attemptNum = tryNum;

      // Resolve model API id(用統一 helper,alias miss 自動 fallback 預設 chat model 而非
      // 把 'pro' / 'flash' 字面傳給 Vertex 變 404)
      const { resolveTaskModel } = require('./llmDefaults');
      const apiModel = await resolveTaskModel(db, task.model, 'chat');

      // Render prompt variables (+ fetch any {{fetch:URL}} placeholders)
      // outBag 收集 substituteVarsAsync 階段的副資訊(目前只有 urlWhitelist),
      // 用於 db_write 階段 strict enforce LLM 給的 url 必須在白名單內。
      // retry 時清掉舊的累積值再讓 substituteVarsAsync 重填
      subBag.urlWhitelist = [];
      let renderedPrompt = await substituteVarsAsync(task.prompt, task.name, subBag);

      // 2026-05-01:Vertex 對 Gemini 3 系列 silent ignore urlContext tool
      // (Pro / Flash / 2.5 Pro 全部實測 groundingMetadata={},LLM 自己也說「沒給我內容」)
      // 改走 server-side white-list 路線(scrapeUrl 抽 <a href> + db_write enforce),
      // 不再嘗試掛 grounding tool。code 保留前一版 fallback 機制以防未來 Vertex 支援度上來。

      // ── {{template:id}} tag in prompt ─────────────────────────────────────
      // Extract template IDs from prompt, strip the tags, append JSON instruction
      const tplTagRe = /\{\{template:([^}]+)\}\}/g;
      const promptTemplateIds = [];
      renderedPrompt = renderedPrompt.replace(tplTagRe, (_, id) => { promptTemplateIds.push(id.trim()); return ''; }).trim();
      // Also honour task-level output_template_id field
      if (task.output_template_id && !promptTemplateIds.includes(task.output_template_id)) {
        promptTemplateIds.push(task.output_template_id);
      }
      // Append JSON schema instructions for each template
      for (const tid of promptTemplateIds) {
        const instr = await getTemplateSchemaInstruction(db, tid).catch(() => null);
        if (instr) renderedPrompt += instr;
      }

      // Resolve tool references {{skill:}}, {{kb:}}, {{mcp:}}, {{dify:}}
      if (hasToolRefs(renderedPrompt)) {
        const resolved = await resolveToolRefs(renderedPrompt, db, {
          userId: task.user_id,
          taskName: task.name,
        });
        renderedPrompt = resolved.resolvedText;
        toolsUsed = resolved.toolsUsed;
      }

      // Create session
      const sid = uuidv4();
      sessionId = sid;
      await db.prepare(
        `INSERT INTO chat_sessions (id, user_id, title, model, source) VALUES (?, ?, ?, ?, 'scheduled')`
      ).run(sid, task.user_id, task.name + ' — ' + twDateStr(), task.model);

      // Insert user message
      await db.prepare(
        `INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)`
      ).run(sid, renderedPrompt);

      // Call Gemini (non-streaming) — 純 prompt,不掛 grounding tool(Vertex Gemini 3 不支援)
      const { text, inputTokens, outputTokens } = await generateTextSync(apiModel, [], renderedPrompt);

      // Insert AI response
      await db.prepare(
        `INSERT INTO chat_messages (session_id, role, content, input_tokens, output_tokens) VALUES (?, 'assistant', ?, ?, ?)`
      ).run(sid, text, inputTokens, outputTokens);

      // Update token_usage (upsert pattern)
      const today = twDateStr();
      const DI = `TO_DATE(?, 'YYYY-MM-DD')`;
      const existing = await db.prepare(
        `SELECT id FROM token_usage WHERE user_id=? AND usage_date=${DI} AND model=?`
      ).get(task.user_id, today, task.model);
      if (existing) {
        await db.prepare(
          'UPDATE token_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+? WHERE id=?'
        ).run(inputTokens, outputTokens, existing.id);
      } else {
        await db.prepare(
          `INSERT INTO token_usage (user_id, usage_date, model, input_tokens, output_tokens) VALUES (?,${DI},?,?,?)`
        ).run(task.user_id, today, task.model, inputTokens, outputTokens);
      }

      // Update session title
      try {
        const title = await generateTitle(renderedPrompt, text);
        await db.prepare('UPDATE chat_sessions SET title=? WHERE id=?').run(title, sid);
      } catch (_) {}

      // Process file generation blocks
      let processableText = text;
      if (task.output_type === 'file' && task.filename_template) {
        // Override all generate block filenames with the task's filename template
        const renderedFilename = substituteVars(task.filename_template, task.name);
        processableText = text.replace(
          /```generate_(\w+):([^\n]+)/g,
          (_match, type) => '```generate_' + type + ':' + renderedFilename
        );
      } else {
        // Always substitute {{date}} / {{weekday}} / {{task_name}} in generate block filenames
        processableText = text.replace(
          /```generate_(\w+):([^\n]+)/g,
          (_match, type, fn) => '```generate_' + type + ':' + substituteVars(fn.trim(), task.name)
        );
      }
      // When template IDs are in play, skip free-form generate blocks to avoid
      // producing a duplicate default-styled file alongside the template output.
      if (promptTemplateIds.length === 0) {
        const blocks = await processGenerateBlocks(processableText, sid);
        generatedFiles = blocks.map(b => ({ filename: b.filename, publicUrl: b.publicUrl, filePath: b.filePath }));
      }

      // ── Template document generation ({{template:id}} or output_template_id) ─
      if (promptTemplateIds.length > 0) {
        const jsonData = parseJsonFromAiOutput(text);
        console.log(`[Scheduled] parseJsonFromAiOutput result: ${jsonData ? JSON.stringify(jsonData).slice(0,200) : 'null'}`);
        if (jsonData) {
          for (const tid of promptTemplateIds) {
            try {
              const tplFile = await generateDocumentFromJson(db, tid, jsonData, user);
              const renderedFilename = substituteVars(task.filename_template || tplFile.filename, task.name);
              generatedFiles.push({ filename: renderedFilename, publicUrl: tplFile.publicUrl, filePath: tplFile.filePath });
              console.log(`[Scheduled] Template ${tid} generated: ${tplFile.filename}`);
            } catch (e) {
              console.error(`[Scheduled] Template ${tid} generation failed:`, e.message, e.stack);
            }
          }
        } else {
          console.warn('[Scheduled] Template requested but AI output is not valid JSON, text snippet:', text.slice(0, 300));
        }
      }

      // ── Audio output: call TTS skill if file_type is mp3/wav ──────────────
      if (task.output_type === 'file' && (task.file_type === 'mp3' || task.file_type === 'wav')) {
        try {
          const FOXLINK_API = `http://127.0.0.1:${process.env.PORT || 3001}`;
          const SERVICE_KEY = process.env.SKILL_SERVICE_KEY || '';
          // Strip code blocks (generate_pdf/xlsx/... blocks) and excess whitespace before TTS
          const ttsText = text
            .replace(/```[\s\S]*?```/g, '')   // remove fenced code blocks
            .replace(/`[^`]+`/g, '')           // remove inline code
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, 4800);                   // Google TTS limit ~5000 bytes
          console.log(`[Scheduled] TTS text length: ${ttsText.length} chars`);
          const ttsRes = await fetch(`${FOXLINK_API}/api/skills/tts/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-service-key': SERVICE_KEY },
            body: JSON.stringify({ text: ttsText, user_id: task.user_id }),
            signal: AbortSignal.timeout(60000),
          });
          if (ttsRes.ok) {
            const ttsData = await ttsRes.json();
            const UPLOAD_DIR = process.env.UPLOAD_DIR
              ? require('path').resolve(process.env.UPLOAD_DIR)
              : require('path').join(__dirname, '../uploads');
            const audioFilename = substituteVars(task.filename_template || `{{task_name}}_{{date}}.mp3`, task.name);
            generatedFiles.push({
              filename: audioFilename,
              publicUrl: ttsData.audio_url,
              filePath: require('path').join(UPLOAD_DIR, 'generated', require('path').basename(ttsData.audio_url)),
            });
          } else {
            const errBody = await ttsRes.json().catch(() => ({}));
            console.error(`[Scheduled] TTS HTTP ${ttsRes.status}: ${errBody.error || ttsRes.statusText}`);
          }
        } catch (e) {
          console.error(`[Scheduled] TTS failed for task ${task.id}: ${e.message}`);
        }
      }

      return { text, inputTokens, outputTokens };
    }, 3);

    responseText = result.text;

    // Update session updated_at
    await db.prepare(`UPDATE chat_sessions SET updated_at=SYSTIMESTAMP WHERE id=?`).run(sessionId);

    // ── Pipeline execution ───────────────────────────────────────────────────
    let pipelineNodes = [];
    try { pipelineNodes = JSON.parse(task.pipeline_json || '[]'); } catch (_) {}
    if (pipelineNodes.length > 0) {
      console.log(`[Scheduled] Running pipeline (${pipelineNodes.length} nodes) for task ${task.id}`);
      try {
        // runId:pipeline 內節點(如 db_write)會把這個值寫進寫入 rows 的 meta_run_id,用於資料血緣
        // 用 startMs(epoch ms)當作 runId,唯一且可近似對應 scheduled_task_runs.run_at
        const runId = startMs;
        // urlWhitelist 從 substituteVarsAsync 帶過來給 db_write 做 strict enforce
        // (LLM 給的 url 必須出現在這份白名單,不在 = drop)
        // dedupe + JSON 字串化塞進 vars,給 pipelineDbWriter 用 url_whitelist_var: '__url_whitelist__' 引用
        const dedupedWl = subBag.urlWhitelist
          ? Array.from(new Set(subBag.urlWhitelist.filter(Boolean)))
          : [];
        const extraVars = dedupedWl.length
          ? { __url_whitelist__: JSON.stringify(dedupedWl) }
          : {};
        if (dedupedWl.length) {
          console.log(`[Scheduled] task=${task.id} "${task.name}" pipeline 啟用 url_whitelist enforcement (${dedupedWl.length} URLs)`);
        }
        const { generatedFiles: pFiles, nodeOutputs, log: pLog, failedNodes: pFailed } = await runPipeline(
          pipelineNodes,
          responseText,
          db,
          { userId: task.user_id, sessionId, taskName: task.name, user, runId, taskId: task.id, extraVars,
            // taskModel:dashboard node 沒指定自己 model_key 時 fallback 用(AI 設定 tab 選的 model)
            taskModel: task.model }
        );
        generatedFiles.push(...pFiles);
        pipelineLog = pLog;
        failedNodes = pFailed || [];
        console.log(`[Scheduled] Pipeline finished for task ${task.id}: log.length=${pipelineLog.length}, preview=${JSON.stringify(pipelineLog).slice(0, 500)}`);
        // Merge node outputs into response for email body
        // - 一般 AI 輸出(超過 10 字、不以 [ 起首)→ 直接附加
        // - db_write/kb_write 等系統節點輸出(以 [ 起首,如 [DB 寫入: 11 inserted...])→ 蒐集到「📥 資料落地摘要」段
        const normalOutputs = [];
        const systemSummaries = [];
        for (const v of Object.values(nodeOutputs)) {
          if (!v) continue;
          if (typeof v !== 'string') continue;
          if (v.startsWith('[') && v.length < 200) systemSummaries.push(v);
          else if (v.length > 10) normalOutputs.push(v);
        }
        const extras = [];
        if (normalOutputs.length) extras.push(normalOutputs.join('\n\n---\n\n'));
        if (systemSummaries.length) extras.push(`📥 **資料落地摘要**\n${systemSummaries.map(s => '• ' + s).join('\n')}`);
        if (extras.length) responseText = `${responseText}\n\n---\n\n${extras.join('\n\n')}`;
      } catch (e) {
        console.error(`[Scheduled] Pipeline error for task ${task.id}:`, e.message, e.stack);
        pipelineLog = [{ status: 'error', error: e.message }];
        failedNodes = [{ id: 'pipeline', type: 'pipeline', label: 'Pipeline 整體錯誤', error: e.message, required: true }];
      }
    }

  } catch (e) {
    runStatus = 'fail';
    runError = e.message;
    console.error(`[Scheduled] Task ${task.id} "${task.name}" failed after retries: ${e.message}`);
  }

  const durationMs = Date.now() - startMs;

  // ── Send email ──────────────────────────────────────────────────────────────
  let emailSentTo = null;
  try {
    const recipients = JSON.parse(task.recipients_json || '[]');
    // Always include the task owner's email
    if (user.email && !recipients.includes(user.email)) recipients.unshift(user.email);

    if (recipients.length > 0 && runStatus === 'ok') {
      // 失敗節點摘要 — 信件主旨加 ⚠️ 標記、body 開頭加紅字錯誤段
      const failPrefix = failedNodes.length > 0
        ? `⚠️ (${failedNodes.length} 節點失敗) `
        : '';
      const subject = failPrefix + substituteVars(task.email_subject || '排程任務執行完成：{{task_name}} ({{date}})', task.name);
      const bodyTemplate = task.email_body ||
        '您好，\n\n以下為 {{date}}（{{weekday}}）排程任務「{{task_name}}」的執行結果：\n\n{{ai_response}}\n\n如有附件請見附檔。\n\nCortex';
      // Build tools used summary for email
      const toolsSummary = (() => {
        const parts = [];
        if (toolsUsed.skills?.length) parts.push(`技能：${toolsUsed.skills.map(s => s.name).join('、')}`);
        if (toolsUsed.kbs?.length) parts.push(`知識庫：${toolsUsed.kbs.map(k => k.name).join('、')}`);
        if (toolsUsed.mcp_tools?.length) parts.push(`MCP：${toolsUsed.mcp_tools.join('、')}`);
        return parts.length > 0 ? `使用工具：${parts.join('；')}` : '';
      })();

      // Plain-text body(純文字 mail client fallback)
      let bodyText = substituteVars(bodyTemplate, task.name)
        .replace(/\{\{ai_response\}\}/g, stripMarkdownForEmail(responseText.slice(0, 4000)))
        .replace(/\{\{tools_used\}\}/g, toolsSummary);

      // HTML body — 用 markdown 直接 render 成漂亮 HTML(table / list / heading 都套 inline CSS)
      // user 收信端 99% 支援 HTML → 看到表格 + emoji + 樣式;不支援的用 text fallback
      const { mdToHtml } = require('./markdownToHtml');
      const aiResponseHtml = mdToHtml(responseText.slice(0, 20000));
      let bodyHtml = substituteVars(bodyTemplate, task.name)
        .replace(/\{\{ai_response\}\}/g, '__AI_RESPONSE_PLACEHOLDER__')
        .replace(/\{\{tools_used\}\}/g, toolsSummary);
      bodyHtml = bodyHtml
        .replace(/\n/g, '<br>')
        .replace(/(https?:\/\/[^\s<,()]+)/g, '<a href="$1" style="color:#2563eb">$1</a>')
        .replace('__AI_RESPONSE_PLACEHOLDER__', aiResponseHtml);

      // 失敗節點段:塞在 body 最開頭,讓使用者一打開就看到
      if (failedNodes.length > 0) {
        const failBlock = `⚠️ 本次執行有 ${failedNodes.length} 個節點失敗：\n`
          + failedNodes.map(f => `• 節點「${f.label}」(${f.type}) 失敗：${f.error}`).join('\n')
          + `\n\n下方為其他節點的產出 ↓\n\n──────────────────────────────\n\n`;
        bodyText = failBlock + bodyText;
        const failHtml = `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;margin-bottom:16px;color:#991b1b;font-family:'Microsoft JhengHei',sans-serif">`
          + `<strong>⚠️ 本次執行有 ${failedNodes.length} 個節點失敗</strong><br><br>`
          + failedNodes.map(f => `• 節點「${f.label}」(${f.type}) 失敗:${f.error}`).join('<br>')
          + `<br><br><small style="color:#7f1d1d">下方為其他節點的產出 ↓</small></div>`;
        bodyHtml = failHtml + bodyHtml;
      }

      // Build attachments from generated files
      const attachments = generatedFiles
        .filter(f => f.filePath)
        .map(f => ({ filename: f.filename, path: f.filePath })); // use clean filename (no timestamp prefix)

      const sent = await sendMail({
        to: recipients.join(','),
        subject,
        html: bodyHtml,
        text: bodyText,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      if (sent) emailSentTo = recipients.join(', ');
    }
  } catch (e) {
    console.error(`[Scheduled] Email failed for task ${task.id}: ${e.message}`);
  }

  // ── Write run record ────────────────────────────────────────────────────────
  await db.prepare(
    `INSERT INTO scheduled_task_runs
      (task_id, run_at, status, attempt, session_id, response_preview, generated_files_json, email_sent_to, error_msg, duration_ms, tools_used_json, pipeline_log_json, failed_nodes_json)
     VALUES (?, SYSTIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id,
    runStatus,
    attemptNum,
    sessionId,
    responseText.slice(0, 500) || null,
    JSON.stringify(generatedFiles.map(f => ({ filename: f.filename, publicUrl: f.publicUrl }))),
    emailSentTo,
    runError,
    durationMs,
    JSON.stringify(toolsUsed),
    pipelineLog.length > 0 ? JSON.stringify(pipelineLog) : null,
    failedNodes.length > 0 ? JSON.stringify(failedNodes) : null,
  );

  // ── Update task stats ───────────────────────────────────────────────────────
  await db.prepare(
    `UPDATE scheduled_tasks
     SET run_count=run_count+1, last_run_at=SYSTIMESTAMP, last_run_status=?, updated_at=SYSTIMESTAMP
     WHERE id=?`
  ).run(runStatus, task.id);

  console.log(`[Scheduled] Task ${task.id} "${task.name}" done — status=${runStatus} duration=${durationMs}ms`);

  // 最終 audit:'ran' = retry chain 過關有跑完 + 寫 run record;'error' = 全 retry 失敗(runStatus=fail)
  await _auditRunDecision(db, task.id, runStatus === 'fail' ? 'error' : 'ran', {
    force, status: task.status,
    hint: `${callerHint}|duration=${durationMs}ms${runError ? '|err=' + runError.slice(0, 100) : ''}`,
  });
}

// ── Cron management ───────────────────────────────────────────────────────────
// _cronJobs entry shape: { job: cron.ScheduledTask, expr: string }
// expr 存進來給 reconcileSchedules 用 — schedule 改了的話可以偵測並重新掛。
const _cronJobs = new Map();

// 是否為 scheduler pod。K8s 環境下 web pods 設 RUN_SCHEDULERS=false 變 no-op,
// 只有 scheduler 專用的 deployment(replicas=1)會實際掛 cron。
// 本機開發 / docker-compose 不設此 env → 預設 true,維持原本單機行為。
const IS_SCHEDULER_POD = process.env.RUN_SCHEDULERS !== 'false';

// 用「排程設計時間 + 當天日期」當 lock key,跨 pod 時鐘漂移仍能阻擋重複觸發。
// 不用 wall-clock minute(舊設計)是因為 enqueue 排隊延遲 + NTP drift 會讓不同 pod
// 算出不同 minute key,等於 lock 失效。Slot-based 不論幾點幾秒進來算的都是同一個 key。
function buildLockKey(task) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const pad = (n) => String(n).padStart(2, '0');

  if (['daily', 'weekly', 'monthly'].includes(task.schedule_type)) {
    return `sched_lock:${task.id}:${today}T${pad(task.schedule_hour ?? 8)}${pad(task.schedule_minute ?? 0)}`;
  }
  if (task.schedule_type === 'multi_time') {
    // multi_time 是整點觸發,當下 hour 就代表 slot
    return `sched_lock:${task.id}:${today}T${pad(now.getHours())}00`;
  }
  if (task.schedule_type === 'interval') {
    const n = Math.max(1, Math.min(23, Number(task.schedule_interval_hours || 4)));
    const bucket = Math.floor(now.getHours() / n) * n;
    return `sched_lock:${task.id}:${today}T${pad(bucket)}00`;
  }
  // cron_raw / 其他:fallback 到當下 hour:minute(精度跟 cron 觸發點對齊)
  return `sched_lock:${task.id}:${today}T${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function buildCronExpr(task) {
  const h = task.schedule_hour ?? 8;
  const m = task.schedule_minute ?? 0;
  switch (task.schedule_type) {
    case 'weekly':  return `${m} ${h} * * ${task.schedule_weekday ?? 1}`;
    case 'monthly': return `${m} ${h} ${task.schedule_monthday ?? 1} * *`;
    case 'interval': {
      // 每 N 小時(N: 1-23)。N=24 等於 daily,引導 user 用 daily 取代。
      const n = Math.max(1, Math.min(23, Number(task.schedule_interval_hours || 4)));
      return `0 */${n} * * *`;
    }
    case 'multi_time': {
      // 多時段。schedule_times_json: ["02:00","08:00","14:00","20:00"]
      let times = [];
      try { times = JSON.parse(task.schedule_times_json || '[]'); } catch (_) {}
      if (!Array.isArray(times) || !times.length) return `0 8 * * *`; // fallback
      const hours = times
        .map(t => String(t).split(':')[0])
        .filter(h => /^\d{1,2}$/.test(h))
        .map(h => Number(h))
        .filter(h => h >= 0 && h <= 23);
      if (!hours.length) return `0 8 * * *`;
      // node-cron 不支援單獨多分鐘,所以多時段都用 :00 整點觸發(實務上夠用)
      return `0 ${hours.join(',')} * * *`;
    }
    case 'cron_raw': {
      // Phase 4 14.5: admin 直接寫 cron expression(min hour day month weekday)
      // 例:'0 18 * * 1-5'(週一到週五 18:00)、'30 9 1 * *'(每月 1 號 09:30)
      // 'L' 表示月底:Oracle / node-cron 不直接支援 'L',user 想要要用 '0 18 28-31 * *' 加 day-check
      const expr = String(task.schedule_cron_expr || '').trim();
      if (!expr || !cron.validate(expr)) {
        console.warn(`[Scheduled] task ${task.id} cron_raw expression invalid: "${expr}", fallback to daily`);
        return `${m} ${h} * * *`;
      }
      return expr;
    }
    default:        return `${m} ${h} * * *`; // daily
  }
}

function scheduleTask(db, task) {
  // Web pods 不掛 cron — 由 scheduler pod 的 reconcile loop 統一處理。
  // Route handler 仍會呼叫此 fn,但這裡早 return,等 reconcile 拉 DB 同步即可。
  if (!IS_SCHEDULER_POD) return;

  const existing = _cronJobs.get(task.id);
  if (existing) {
    existing.job.stop();
    _cronJobs.delete(task.id);
  }
  if (task.status !== 'active') return;

  const expr = buildCronExpr(task);
  const job = cron.schedule(expr, async () => {
    // Scheduler pod 觸發點。fetch 最新 task,reconcile loop 最壞延遲 30s 才會同步
    // 暫停狀態到 in-memory cron,這層 latest check 把 race window 收緊到秒級。
    let latest;
    try {
      latest = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(task.id);
    } catch (e) {
      // DB 查不到最新狀態時保守 skip 這次 slot — 寧可漏跑也不要跑到已暫停的 task。
      // 之前 fallback 到 closure 的 task(status='active' 才會掛上 cron)會繞過暫停檢查。
      console.warn(`[Scheduled] cron handler fetch task ${task.id} failed, skipping this slot: ${e.message}`);
      return;
    }
    if (!latest || latest.status !== 'active') return;

    // 分散式鎖(slot-based + TTL 600s):scheduler 改成單 pod 後此 lock 主要作為保險 —
    // 萬一未來放寬 replicas / K8s restart 瞬間 overlap / cron handler 重複觸發都擋得住。
    const lockKey = buildLockKey(latest);
    try {
      const { tryLock } = require('./redisClient');
      const acquired = await tryLock(lockKey, 600);
      if (!acquired) {
        console.log(`[Scheduled] Task ${task.id} slot ${lockKey} held by another pod, skip`);
        return;
      }
    } catch (e) {
      console.warn(`[Scheduled] Redis lock failed (${e.message}) — 降級繼續執行(可能會重複)`);
    }

    console.log(`[Scheduled] Triggering task ${task.id} "${task.name}" (slot=${lockKey})`);
    enqueue(() => runTask(db, task.id, { callerHint: `cron:slot=${lockKey}` }));
  }, { timezone: 'Asia/Taipei' });

  _cronJobs.set(task.id, { job, expr });
  console.log(`[Scheduled] Task ${task.id} "${task.name}" scheduled: ${expr}`);
}

function unscheduleTask(taskId) {
  if (!IS_SCHEDULER_POD) return;
  const entry = _cronJobs.get(taskId);
  if (entry) {
    entry.job.stop();
    _cronJobs.delete(taskId);
    console.log(`[Scheduled] Task ${taskId} unscheduled`);
  }
}

// ── Reconcile loop(scheduler pod only)──────────────────────────────────────
// 用途:Web pods 透過 API 改 DB 後,scheduler pod 沒有直接通訊管道(沒走 Redis pub/sub),
// 因此每 30 秒重讀 DB 算 diff:DB 該跑 vs 記憶體實際掛的 → 新增/移除/重掛。
// 最壞延遲 30 秒,但保證最終一致。
async function reconcileSchedules(db) {
  let tasks;
  try {
    tasks = await db.prepare(`SELECT * FROM scheduled_tasks`).all();
  } catch (e) {
    console.warn(`[Scheduled] reconcile fetch failed: ${e.message}`);
    return;
  }

  const now = new Date();
  const wantedById = new Map();
  for (const t of tasks) {
    if (t.status !== 'active') continue;
    if (t.expire_at && new Date(t.expire_at) < now) continue;
    if (t.max_runs > 0 && t.run_count >= t.max_runs) continue;
    wantedById.set(t.id, t);
  }

  let added = 0, removed = 0, rescheduled = 0;

  // 1) 新增 / reschedule(expr 變了就重掛)
  for (const [id, task] of wantedById) {
    const existing = _cronJobs.get(id);
    const newExpr = buildCronExpr(task);
    if (!existing) {
      scheduleTask(db, task);
      added++;
    } else if (existing.expr !== newExpr) {
      scheduleTask(db, task);
      rescheduled++;
    }
  }

  // 2) 移除(已被刪除 / paused / 過期 / 達 max_runs)
  for (const id of [..._cronJobs.keys()]) {
    if (!wantedById.has(id)) {
      unscheduleTask(id);
      removed++;
    }
  }

  if (added || removed || rescheduled) {
    console.log(`[Scheduled] reconcile: +${added} -${removed} ~${rescheduled} (now ${_cronJobs.size} active cron jobs)`);
  }
}

/** Called on server start — load all active tasks from DB. */
async function initScheduler(db) {
  if (!IS_SCHEDULER_POD) {
    console.log('[Scheduled] RUN_SCHEDULERS=false → this pod will not mount cron jobs (web pod mode)');
    return;
  }
  try {
    const tasks = await db.prepare(`SELECT * FROM scheduled_tasks WHERE status='active'`).all();
    tasks.forEach(t => scheduleTask(db, t));
    console.log(`[Scheduled] Loaded ${tasks.length} active task(s) on scheduler pod`);
  } catch (e) {
    console.error('[Scheduled] initScheduler error:', e.message);
  }
  // 啟動 reconcile loop:30s 一輪同步 DB 跟記憶體,讓 web pods 的 PUT/toggle/DELETE
  // 在最壞 30 秒內反映到 cron mount 狀態。
  setInterval(() => {
    reconcileSchedules(db).catch(e => console.error('[Scheduled] reconcile error:', e.message));
  }, 30_000);
  console.log('[Scheduled] reconcile loop started (30s interval)');
}

module.exports = { initScheduler, scheduleTask, unscheduleTask, runTask, enqueue, substituteVarsAsync, reconcileSchedules };
