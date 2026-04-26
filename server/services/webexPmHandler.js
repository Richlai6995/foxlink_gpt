'use strict';

/**
 * Webex PM Handler — Phase 5 Track C-1
 *
 * 檢測 Webex DM/Group msg 是否為 PM intent;若是 → 直接回 Adaptive Card,
 * 不進入一般 LLM chat 流程(節省 token + 即時回應 < 1 秒)。
 *
 * 整合點:[server/routes/webex.js](../routes/webex.js).handleWebexMessage
 *   在 session/auth 檢查後、進入 LLM 之前 call:
 *     const handled = await tryPmIntent({ msgText, lang, webex, roomId, message });
 *     if (handled) return;
 *
 * 也處理 Adaptive Card Submit action(message.attachmentActions) — 按 Forecast / What-if
 * 按鈕後 Webex 送 inputs.intent='pm_forecast' 等,本 handler 同樣 dispatch。
 */

const cards = require('./webexPmCards');

// 4 大貴金屬 + 7 個關聯金屬(對應 pmDashboardSeed)
const METAL_ALIASES = {
  // 貴金屬
  'au': 'Au', 'gold': 'Au', '金': 'Au', '黃金': 'Au', '金價': 'Au',
  'ag': 'Ag', 'silver': 'Ag', '銀': 'Ag', '銀價': 'Ag',
  'pt': 'Pt', 'platinum': 'Pt', '鉑': 'Pt',
  'pd': 'Pd', 'palladium': 'Pd', '鈀': 'Pd',
  // 基本金屬
  'cu': 'CU', 'copper': 'CU', '銅': 'CU',
  'al': 'AL', 'aluminum': 'AL', 'aluminium': 'AL', '鋁': 'AL',
  'ni': 'NI', 'nickel': 'NI', '鎳': 'NI',
  'zn': 'ZN', 'zinc': 'ZN', '鋅': 'ZN',
  'pb': 'PB', 'lead': 'PB', '鉛': 'PB',
  'sn': 'SN', 'tin': 'SN', '錫': 'SN',
};

function normalizeMetal(token) {
  if (!token) return null;
  const lower = String(token).trim().toLowerCase();
  return METAL_ALIASES[lower] || null;
}

/**
 * Detect intent from raw text。回 { type, params } 或 null(沒 intent → fall through)
 *
 * type:
 *   - help        — /pm help / pm 幫助
 *   - snapshot    — top 5 / 快照 / metals snapshot / 今日金價
 *   - forecast    — <metal> 預測 / forecast / 7 day / 7 天
 *   - whatif      — <metal> +N% / -N% / what if
 *   - latest      — <metal>(只給金屬代碼)→ 回單一 latest price
 */
function detectIntent(rawText) {
  if (!rawText) return null;
  const text = String(rawText).trim();
  const lower = text.toLowerCase();

  // 1. /pm help
  if (/^\/?pm\s+(help|幫助|說明|commands?)\b/i.test(text)) return { type: 'help' };

  // 2. snapshot / top 5 / 快照 / metals snapshot / 今日金價
  if (/(top\s*\d|snapshot|快照|今日.*(金|銅|貴金屬|價)|metals?.*today)/i.test(lower)) {
    return { type: 'snapshot' };
  }

  // 3. what-if (e.g. "銅 +10%", "what if Au -5%", "假設 銅 漲 10%")
  const whatifMatch = text.match(
    /(?:what\s*if\s+)?(\S{1,12}?)\s*([+-]?\s*\d+(?:\.\d+)?)\s*%/i
  );
  if (whatifMatch) {
    const metal = normalizeMetal(whatifMatch[1]);
    const delta = parseFloat(whatifMatch[2].replace(/\s/g, ''));
    if (metal && Number.isFinite(delta)) return { type: 'whatif', params: { metal, delta } };
  }
  // 中文「銅 漲 10%」「銅 跌 5%」
  const cnMatch = text.match(/(\S{1,8})\s*(漲|跌|加|減)\s*(\d+(?:\.\d+)?)\s*%/);
  if (cnMatch) {
    const metal = normalizeMetal(cnMatch[1]);
    const delta = parseFloat(cnMatch[3]) * (/(漲|加)/.test(cnMatch[2]) ? 1 : -1);
    if (metal && Number.isFinite(delta)) return { type: 'whatif', params: { metal, delta } };
  }

  // 4. forecast (e.g. "銅 預測", "Cu forecast", "黃金 7 天", "Au 7 day")
  const fcMatch = text.match(/(\S{1,12})\s*(?:預測|forecast|outlook|未來|7\s*[天日]|7\s*day)/i);
  if (fcMatch) {
    const metal = normalizeMetal(fcMatch[1]);
    if (metal) return { type: 'forecast', params: { metal } };
  }
  // 也接 "預測 銅" / "forecast Au"
  const fcMatch2 = text.match(/(?:預測|forecast)\s+(\S{1,12})/i);
  if (fcMatch2) {
    const metal = normalizeMetal(fcMatch2[1]);
    if (metal) return { type: 'forecast', params: { metal } };
  }

  // 5. 純金屬代碼 → latest price
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 || tokens.length === 2) {
    const metal = normalizeMetal(tokens[0]);
    if (metal) return { type: 'latest', params: { metal } };
  }

  return null;
}

/**
 * Detect intent from Adaptive Card Submit(message.attachmentActions 的 inputs)
 */
function detectIntentFromInputs(inputs) {
  if (!inputs || typeof inputs !== 'object') return null;
  const intent = String(inputs.intent || '').toLowerCase();
  if (intent === 'pm_forecast' && inputs.metal) {
    return { type: 'forecast', params: { metal: String(inputs.metal) } };
  }
  if (intent === 'pm_whatif' && inputs.metal && inputs.delta != null) {
    return { type: 'whatif', params: { metal: String(inputs.metal), delta: Number(inputs.delta) } };
  }
  if (intent === 'pm_snapshot') {
    return { type: 'snapshot' };
  }
  if (intent === 'pm_help') {
    return { type: 'help' };
  }
  return null;
}

/**
 * 主入口:嘗試處理 PM intent。回 boolean 表示是否處理了(true → caller return,不進 LLM)
 */
async function tryPmIntent({ msgText, lang, webex, roomId, intentOverride }) {
  const intent = intentOverride || detectIntent(msgText);
  if (!intent) return false;

  try {
    switch (intent.type) {
      case 'help':
        await sendCard(webex, roomId, lang, cards.buildPmHelpCard({ lang }));
        return true;
      case 'snapshot':
        await handleSnapshot({ webex, roomId, lang });
        return true;
      case 'latest':
        await handleLatest({ webex, roomId, lang, metal: intent.params.metal });
        return true;
      case 'forecast':
        await handleForecast({ webex, roomId, lang, metal: intent.params.metal });
        return true;
      case 'whatif':
        await handleWhatIf({ webex, roomId, lang, metal: intent.params.metal, delta: intent.params.delta });
        return true;
      default:
        return false;
    }
  } catch (e) {
    console.error('[WebexPM] intent handler error:', e.message);
    await webex.sendMessage(roomId, `⚠️ PM 查詢錯誤: ${e.message?.slice(0, 100)}`).catch(() => {});
    return true;  // 已 ack,不要 fall through 到 LLM
  }
}

async function sendCard(webex, roomId, lang, cardJson) {
  const fallback = lang.startsWith('zh') ? '此訊息含 Adaptive Card,請用 Webex 客戶端查看' : 'This message contains Adaptive Card; view in Webex client';
  await webex.sendCard(roomId, fallback, cardJson);
}

// ─── Handlers ──────────────────────────────────────────────────────────────

async function handleSnapshot({ webex, roomId, lang }) {
  const db = require('../database-oracle').db;
  const rows = await db.prepare(`
    SELECT metal_code, price_usd, day_change_pct,
           TO_CHAR(MAX(as_of_date) OVER (), 'YYYY-MM-DD') AS latest_date
    FROM (
      SELECT metal_code,
             FIRST_VALUE(price_usd) OVER (PARTITION BY metal_code ORDER BY as_of_date DESC) AS price_usd,
             FIRST_VALUE(day_change_pct) OVER (PARTITION BY metal_code ORDER BY as_of_date DESC) AS day_change_pct,
             as_of_date,
             ROW_NUMBER() OVER (PARTITION BY metal_code ORDER BY as_of_date DESC) AS rn
      FROM pm_price_history
      WHERE metal_code IN ('Au','Ag','Pt','Pd','CU','AL','NI','ZN')
        AND as_of_date >= TRUNC(SYSDATE) - 7
        AND price_usd IS NOT NULL
    )
    WHERE rn = 1
  `).all();

  if (!rows || rows.length === 0) {
    await webex.sendMessage(roomId, lang.startsWith('zh') ? '⚠️ 目前無金屬價格資料(可能是新環境)' : '⚠️ No metal price data available');
    return;
  }
  const asOfDate = rows[0].latest_date || rows[0].LATEST_DATE || new Date().toISOString().slice(0, 10);
  const card = cards.buildSnapshotCard({
    metals: rows.map(r => ({
      metal_code: r.metal_code || r.METAL_CODE,
      price_usd: r.price_usd ?? r.PRICE_USD,
      day_change_pct: r.day_change_pct ?? r.DAY_CHANGE_PCT,
    })),
    asOfDate,
    lang,
  });
  await sendCard(webex, roomId, lang, card);
}

async function handleLatest({ webex, roomId, lang, metal }) {
  const db = require('../database-oracle').db;
  const row = await db.prepare(`
    SELECT metal_code, price_usd, day_change_pct, as_of_date, source
    FROM pm_price_history
    WHERE metal_code = ?
    ORDER BY as_of_date DESC
    FETCH FIRST 1 ROWS ONLY
  `).get(metal);
  if (!row) {
    await webex.sendMessage(roomId, lang.startsWith('zh') ? `⚠️ ${metal} 無資料` : `⚠️ No data for ${metal}`);
    return;
  }
  const card = cards.buildSnapshotCard({
    metals: [{
      metal_code: row.metal_code || row.METAL_CODE,
      price_usd: row.price_usd ?? row.PRICE_USD,
      day_change_pct: row.day_change_pct ?? row.DAY_CHANGE_PCT,
    }],
    asOfDate: String(row.as_of_date || row.AS_OF_DATE).slice(0, 10),
    lang,
  });
  await sendCard(webex, roomId, lang, card);
}

async function handleForecast({ webex, roomId, lang, metal }) {
  const db = require('../database-oracle').db;
  // 取最近一次 forecast(forecast_date 最大)的 7 筆 horizon
  const latestForecastDate = await db.prepare(`
    SELECT MAX(forecast_date) AS d FROM forecast_history
    WHERE entity_type='metal' AND entity_code=?
  `).get(metal);
  const fcDate = latestForecastDate?.d ?? latestForecastDate?.D;
  if (!fcDate) {
    await webex.sendMessage(roomId, lang.startsWith('zh') ? `⚠️ ${metal} 尚無預測資料` : `⚠️ No forecast for ${metal}`);
    return;
  }
  const rows = await db.prepare(`
    SELECT target_date, predicted_mean, predicted_lower, predicted_upper
    FROM forecast_history
    WHERE entity_type='metal' AND entity_code=? AND forecast_date=?
    ORDER BY target_date
    FETCH FIRST 7 ROWS ONLY
  `).all(metal, fcDate);

  // 取 current price
  const cur = await db.prepare(`
    SELECT price_usd FROM pm_price_history
    WHERE metal_code=? ORDER BY as_of_date DESC FETCH FIRST 1 ROWS ONLY
  `).get(metal);

  const card = cards.buildForecastCard({
    metal,
    forecastRows: rows,
    currentPrice: cur?.price_usd ?? cur?.PRICE_USD ?? null,
    lang,
  });
  await sendCard(webex, roomId, lang, card);
}

async function handleWhatIf({ webex, roomId, lang, metal, delta }) {
  const db = require('../database-oracle').db;
  const cur = await db.prepare(`
    SELECT price_usd FROM pm_price_history
    WHERE metal_code=? ORDER BY as_of_date DESC FETCH FIRST 1 ROWS ONLY
  `).get(metal);
  if (!cur) {
    await webex.sendMessage(roomId, lang.startsWith('zh') ? `⚠️ ${metal} 無資料` : `⚠️ No data for ${metal}`);
    return;
  }
  const currentPrice = Number(cur.price_usd ?? cur.PRICE_USD);
  const simulatedPrice = currentPrice * (1 + delta / 100);

  // 簡單 cost impact:檢查 pm_bom_metal 有沒有對應 metal 的 BOM,有的話算 sum impact
  let costImpact = null;
  try {
    const bom = await db.prepare(`
      SELECT SUM(metal_grams * ?) AS impact_g
      FROM pm_bom_metal
      WHERE UPPER(metal_code) = UPPER(?)
    `).get((simulatedPrice - currentPrice) / 1000, metal);  // gram → kg
    if (bom && (bom.impact_g != null || bom.IMPACT_G != null)) {
      const v = Number(bom.impact_g ?? bom.IMPACT_G);
      if (Number.isFinite(v)) {
        costImpact = `${(v / 1000).toFixed(2)} USD/unit (基於 BOM 全產品線)`;
      }
    }
  } catch { /* pm_bom_metal 可能不存在或為空 */ }

  const card = cards.buildWhatIfCard({
    metal, delta,
    currentPrice,
    simulatedPrice,
    costImpact,
    lang,
  });
  await sendCard(webex, roomId, lang, card);
}

module.exports = {
  detectIntent,
  detectIntentFromInputs,
  tryPmIntent,
};
