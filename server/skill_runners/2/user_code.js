// user_code.js
// 從使用者訊息中抽出股票代號，呼叫 Yahoo Finance 查詢台股即時價格
const axios = require('axios');

module.exports = async function handler(body) {
  const { user_message } = body;

  // 抽出 4-6 位數字股票代號（例：2330、00878、006208）
  const codes = [...new Set((user_message.match(/\b\d{4,6}\b/g) || []))];

  if (codes.length === 0) {
    // 沒偵測到代號，不 inject，讓 Gemini 自行回應
    return { system_prompt: '' };
  }

  const results = await Promise.allSettled(
    codes.map(code => fetchStock(code))
  );

  const lines = results
    .map((r, i) => r.status === 'fulfilled' ? r.value : `${codes[i]}: 查詢失敗`)
    .filter(Boolean);

  if (lines.length === 0) {
    return { system_prompt: '（股價查詢無結果）' };
  }

  return {
    system_prompt: `以下是從 Yahoo Finance 取得的即時股價資料，請根據這些數據回答使用者問題：\n\n${lines.join('\n')}`
  };
};

async function fetchStock(code) {
  const symbol = `${code}.TW`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;

  const res = await axios.get(url, {
    timeout: 5000,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
    params: {
      interval: '1d',
      range: '1d',
    }
  });

  const meta = res.data?.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose;
  const change = price - prev;
  const pct = ((change / prev) * 100).toFixed(2);
  const arrow = change >= 0 ? '▲' : '▼';
  const name = meta.longName || meta.shortName || code;

  return `${code} ${name}：${price} 元  ${arrow}${Math.abs(change).toFixed(2)} (${pct}%)  開盤:${meta.regularMarketOpen}  最高:${meta.regularMarketDayHigh}  最低:${meta.regularMarketDayLow}  成交量:${(meta.regularMarketVolume/1000).toFixed(0)}張`;
}
