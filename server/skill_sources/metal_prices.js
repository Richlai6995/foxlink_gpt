'use strict';
/**
 * 金屬報價查詢 (Metal Prices Fetcher)
 * -----------------------------------------------------------------------------
 * 以免費、無需 API key 的資料源抓取主要工業金屬 / 貴金屬即時價格。
 *
 * 為什麼這樣挑資料源:
 *   - lme.com  ── Cloudflare + 付費 API 生意,硬爬只會拿 403,放棄
 *   - smm.cn   ── 阿里雲盾 + 會員制,非付費抓不到即時價,放棄
 *   - gold-api.com  ── XAU/XAG/XPT/XPD 免費 JSON, 無 key, 最穩
 *   - Yahoo Finance ── COMEX 期貨 (HG=F 銅等) JSON, 公開, 無 key
 *   - Westmetall    ── 靜態 HTML, 每日 LME 結算價 + 庫存, 當作 Yahoo 的 fallback
 *
 * 輸出 markdown 表 (USD 計價) → 回給 LLM 當 system_prompt, 讓 LLM 自行加
 * 台幣換算、中文翻譯或加工成採購週報。
 *
 * 預期 body:
 *   { metals?: string[], user_message?: string, ...其他上下文 }
 */

const GOLD_API = 'https://api.gold-api.com/price/';                                  // XAU/XAG/XPT/XPD
const YAHOO    = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const WESTMETALL = 'https://www.westmetall.com/en/markdaten.php';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── util: fetch with timeout ────────────────────────────────────────────────
async function fetchWithTimeout(url, { timeout = 8000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json,text/html,*/*', ...headers },
    });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

// ─── gold-api.com (金銀鉑鈀) ─────────────────────────────────────────────────
async function fetchGoldApi(symbol) {
  try {
    const r = await fetchWithTimeout(GOLD_API + symbol, { timeout: 6000 });
    if (!r.ok) return { error: `gold-api ${symbol} status ${r.status}` };
    const j = await r.json();
    if (typeof j.price !== 'number') return { error: `gold-api ${symbol} no price` };
    return { price: j.price, currency: 'USD', source: 'gold-api.com', ts: j.updatedAt || null };
  } catch (e) { return { error: `gold-api ${symbol}: ${e.message}` }; }
}

// ─── Yahoo Finance (COMEX/LME 期貨) ─────────────────────────────────────────
async function fetchYahoo(symbol) {
  try {
    const url = `${YAHOO}${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const r = await fetchWithTimeout(url, { timeout: 8000 });
    if (!r.ok) return { error: `yahoo ${symbol} status ${r.status}` };
    const j = await r.json();
    const m = j?.chart?.result?.[0]?.meta;
    if (!m?.regularMarketPrice) return { error: `yahoo ${symbol} no meta` };
    const prev = m.chartPreviousClose ?? m.previousClose ?? null;
    return {
      price: m.regularMarketPrice,
      prev,
      change: prev != null ? m.regularMarketPrice - prev : null,
      pct: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null,
      currency: m.currency || 'USD',
      source: `Yahoo ${symbol}`,
      ts: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    };
  } catch (e) { return { error: `yahoo ${symbol}: ${e.message}` }; }
}

// ─── Westmetall (LME 基本金屬 fallback + 庫存) ─────────────────────────────
// 解析他們的 HTML table。網站結構偶爾微調,regex 放寬一點,抓不到就當無資料。
async function fetchWestmetall() {
  try {
    const r = await fetchWithTimeout(WESTMETALL, {
      timeout: 10000,
      headers: { 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en;q=0.9' },
    });
    if (!r.ok) return { error: `westmetall status ${r.status}` };
    const html = await r.text();

    // Westmetall 頁面每個金屬有獨立 block, 我們只要當日 settlement + stock。
    // 抓 "MetalName ... USD ... XXX,XXX" 這樣鬆的 pattern, 未命中就 null。
    const grab = (label) => {
      const re = new RegExp(
        `${label}[\\s\\S]{0,2000}?USD[\\s\\S]{0,400}?([\\d,]+(?:\\.\\d+)?)` +
        `[\\s\\S]{0,2000}?stock[\\s\\S]{0,200}?([\\d,]+)`,
        'i',
      );
      const m = html.match(re);
      if (!m) return null;
      return {
        price: parseFloat(m[1].replace(/,/g, '')),
        stock: parseInt(m[2].replace(/,/g, ''), 10),
      };
    };

    return {
      copper:    grab('Copper'),
      aluminum:  grab('Aluminium'),
      nickel:    grab('Nickel'),
      tin:       grab('Tin'),
      zinc:      grab('Zinc'),
      lead:      grab('Lead'),
      source: 'westmetall.com',
    };
  } catch (e) { return { error: `westmetall: ${e.message}` }; }
}

// ─── formatters ─────────────────────────────────────────────────────────────
const fmt = (n, digits = 2) =>
  (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';

const fmtPct = (x) => {
  if (typeof x !== 'number' || !isFinite(x)) return '—';
  const s = x >= 0 ? '+' : '';
  return `${s}${x.toFixed(2)}%`;
};

// lb → ton (Yahoo COMEX 銅是 USD/lb, 轉 USD/metric ton 方便比較)
const LB_PER_MT = 2204.62;

// ─── main handler ───────────────────────────────────────────────────────────
module.exports = async function handler(body) {
  const wanted = Array.isArray(body.metals) && body.metals.length
    ? new Set(body.metals.map(s => String(s).toLowerCase()))
    : null;
  const want = (k) => !wanted || wanted.has(k);

  // 並行所有資料源, 互不阻塞
  const [
    gold, silver, platinum, palladium,      // gold-api
    cuYahoo, alYahoo, niYahoo, snYahoo,     // yahoo (期貨)
    wm,                                      // westmetall (fallback)
  ] = await Promise.all([
    want('gold')      ? fetchGoldApi('XAU') : Promise.resolve(null),
    want('silver')    ? fetchGoldApi('XAG') : Promise.resolve(null),
    want('platinum')  ? fetchGoldApi('XPT') : Promise.resolve(null),
    want('palladium') ? fetchGoldApi('XPD') : Promise.resolve(null),
    want('copper')    ? fetchYahoo('HG=F')  : Promise.resolve(null),
    want('aluminum')  ? fetchYahoo('ALI=F') : Promise.resolve(null),
    want('nickel')    ? fetchYahoo('LN=F')  : Promise.resolve(null),   // LME Nickel Yahoo
    want('tin')       ? fetchYahoo('SN=F')  : Promise.resolve(null),   // 可能無, fallback westmetall
    (want('copper') || want('aluminum') || want('nickel') || want('tin'))
      ? fetchWestmetall() : Promise.resolve(null),
  ]);

  // 基本金屬: Yahoo 為主, Westmetall 補漏
  const pickBase = (yahoo, wmKey, unitLabel) => {
    if (yahoo && !yahoo.error && typeof yahoo.price === 'number') {
      // HG=F 單位是 USD/lb, 我們同時顯示 per lb 與換算 per ton
      return { ...yahoo, unit: unitLabel };
    }
    if (wm && !wm.error && wm[wmKey]) {
      return {
        price: wm[wmKey].price,
        stock: wm[wmKey].stock,
        currency: 'USD',
        source: wm.source,
        unit: 'USD/ton',
      };
    }
    return null;
  };

  const copper    = want('copper')    ? pickBase(cuYahoo, 'copper',   'USD/lb')  : null;
  const aluminum  = want('aluminum')  ? pickBase(alYahoo, 'aluminum', 'USD/ton') : null;
  const nickel    = want('nickel')    ? pickBase(niYahoo, 'nickel',   'USD/ton') : null;
  const tin       = want('tin')       ? pickBase(snYahoo, 'tin',      'USD/ton') : null;

  // Rhodium: 免費源真的沒有, 告訴用戶要付費 API (metalpriceapi/metals-dev)
  const rhodium   = want('rhodium')
    ? { error: 'Rhodium 免費資料源不可得 (建議接 metalpriceapi.com 付費 key)', unit: 'USD/oz' }
    : null;

  // 組 markdown 表
  const today = new Date().toISOString().slice(0, 10);
  const row = (name, d, unitFallback) => {
    if (!d || d.error) {
      const reason = d?.error ? ` (${d.error.slice(0, 40)})` : '';
      return `| ${name} | 暫無數據${reason} | ${unitFallback} | — |`;
    }
    const unit = d.unit || unitFallback;
    const pct  = fmtPct(d.pct);
    const extra = d.stock != null ? ` / 庫存 ${fmt(d.stock, 0)} 噸` : '';
    // 銅特別: 同步顯示 USD/ton 換算
    let priceCol = fmt(d.price, 2);
    if (name.startsWith('銅') && unit === 'USD/lb') {
      priceCol = `${fmt(d.price, 4)} (≈ ${fmt(d.price * LB_PER_MT, 0)}/ton)`;
    }
    return `| ${name} | ${priceCol}${extra} | ${unit} | ${pct} |`;
  };

  const table = [
    `## 📊 全球主要金屬即時報價 (USD, ${today})`,
    '',
    '資料源: gold-api.com (貴金屬) · Yahoo Finance 期貨 (基本金屬) · Westmetall (LME fallback)',
    '',
    '| 金屬 | 最新報價 | 計價單位 | 漲跌幅 |',
    '| ---- | -------- | :------: | -----: |',
    ...[
      ['銅 (Copper)',     copper,    'USD/lb'],
      ['鋁 (Aluminum)',   aluminum,  'USD/ton'],
      ['鎳 (Nickel)',     nickel,    'USD/ton'],
      ['錫 (Tin)',        tin,       'USD/ton'],
      ['金 (Gold)',       gold,      'USD/oz'],
      ['銀 (Silver)',     silver,    'USD/oz'],
      ['鉑 (Platinum)',   platinum,  'USD/oz'],
      ['鈀 (Palladium)',  palladium, 'USD/oz'],
      ['銠 (Rhodium)',    rhodium,   'USD/oz'],
    ]
      .filter(([, d]) => d !== null)
      .map(([n, d, u]) => row(n, d, u)),
    '',
    '_註:貴金屬為現貨價 (spot),基本金屬為 COMEX/LME 近月期貨結算價。_',
    '_單位說明:oz = 金衡盎司(31.1035 g);ton = 公噸(1,000 kg);lb = 磅(0.4536 kg)。_',
    '',
  ].join('\n');

  // 把結構化資料也回傳,方便 LLM 做台幣換算 / 繪圖 / 下游加工
  return {
    system_prompt: table,
    data: {
      as_of: today,
      prices: { copper, aluminum, nickel, tin, gold, silver, platinum, palladium, rhodium },
    },
  };
};
