'use strict';
/**
 * 金屬技術指標純 JS 計算 — server 端用於 AI TA 分析時餵 LLM context
 *
 * 邏輯對齊 client/src/lib/metalsIndicators.ts(同一套公式),client 算 chart 渲染,
 * server 算 LLM prompt 用。兩邊獨立沒共用 module(client TS / server JS)避免綁定。
 *
 * 全部 input close[]: number[](時序遞增,單位 USD/whatever 一致即可)→
 * 同長度 (number | null)[],null 表示尚未足夠樣本。
 */

/** 簡單移動平均 SMA */
function sma(close, period) {
  const out = new Array(close.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < close.length; i++) {
    sum += close[i];
    if (i >= period) sum -= close[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指數移動平均 EMA */
function ema(close, period) {
  const out = new Array(close.length).fill(null);
  if (period <= 0 || close.length === 0) return out;
  const k = 2 / (period + 1);
  let seedSum = 0;
  for (let i = 0; i < close.length; i++) {
    if (i < period) {
      seedSum += close[i];
      if (i === period - 1) out[i] = seedSum / period;
    } else {
      const prev = out[i - 1];
      out[i] = close[i] * k + prev * (1 - k);
    }
  }
  return out;
}

/** RSI(Wilder smoothing) */
function rsi(close, period = 14) {
  const out = new Array(close.length).fill(null);
  if (close.length <= period) return out;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = close[i] - close[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  for (let i = period + 1; i < close.length; i++) {
    const diff = close[i] - close[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  }
  return out;
}

/** MACD(12/26/9)— { macd, signal, histogram } 三條同長陣列 */
function macd(close, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fast = ema(close, fastPeriod);
  const slow = ema(close, slowPeriod);
  const macdLine = close.map((_, i) => {
    const f = fast[i], s = slow[i];
    return f != null && s != null ? f - s : null;
  });
  const macdValues = [];
  const macdIdx = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null) {
      macdValues.push(macdLine[i]);
      macdIdx.push(i);
    }
  }
  const signalRaw = ema(macdValues, signalPeriod);
  const signalLine = new Array(close.length).fill(null);
  for (let j = 0; j < signalRaw.length; j++) {
    if (signalRaw[j] != null) signalLine[macdIdx[j]] = signalRaw[j];
  }
  const histogram = close.map((_, i) => {
    const m = macdLine[i], s = signalLine[i];
    return m != null && s != null ? m - s : null;
  });
  return { macd: macdLine, signal: signalLine, histogram };
}

/** Bollinger Bands(period=20, stdDev=2)*/
function bollinger(close, period = 20, stdDev = 2) {
  const middle = sma(close, period);
  const upper = new Array(close.length).fill(null);
  const lower = new Array(close.length).fill(null);
  for (let i = period - 1; i < close.length; i++) {
    let sumSq = 0;
    const mean = middle[i];
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (close[j] - mean) ** 2;
    }
    const sd = Math.sqrt(sumSq / period);
    upper[i] = mean + stdDev * sd;
    lower[i] = mean - stdDev * sd;
  }
  return { upper, middle, lower };
}

/**
 * 一站式 — 給 LLM 餵 context 用。
 * 吃 prices = [{date, price}] + indicators array(可選 keys: MA20 / MA60 / MA120 / MA240 /
 * EMA20 / BOLL / RSI14 / MACD),回每個 indicator 的最新值 + 簡短狀態描述。
 *
 * 回:
 *   {
 *     latest: { date, close },
 *     stats: { high_30d, low_30d, high_period, low_period, mean_period, change_pct_period },
 *     indicators: {
 *       MA20: { latest, prevClose_vs_ma: 'above'|'below', cross: 'golden'|'death'|null },
 *       ...
 *     }
 *   }
 */
function buildLlmContext(prices, indicatorKeys) {
  if (!Array.isArray(prices) || prices.length === 0) {
    return { latest: null, stats: null, indicators: {}, error: 'no_data' };
  }
  const close = prices.map(p => Number(p.price)).filter(v => Number.isFinite(v));
  if (close.length === 0) {
    return { latest: null, stats: null, indicators: {}, error: 'no_numeric_close' };
  }
  const N = close.length;
  const latest = { date: prices[prices.length - 1].date, close: close[N - 1] };

  // 30 天區間統計(若 < 30 筆用整段)
  const last30 = close.slice(-30);
  const high_30d = Math.max(...last30);
  const low_30d = Math.min(...last30);

  const high_period = Math.max(...close);
  const low_period = Math.min(...close);
  const mean_period = close.reduce((a, b) => a + b, 0) / N;
  const change_pct_period = close[0] > 0
    ? ((close[N - 1] - close[0]) / close[0]) * 100
    : null;

  const indicators = {};
  const keys = new Set(indicatorKeys || []);

  const recordMA = (key, period) => {
    const arr = sma(close, period);
    const v = arr[N - 1];
    const prev = arr[N - 2];
    if (v == null) {
      indicators[key] = { status: 'insufficient_data', need: period, have: N };
      return;
    }
    const above = close[N - 1] > v ? 'above' : 'below';
    let cross = null;
    if (prev != null) {
      const wasAbove = close[N - 2] > prev;
      const nowAbove = close[N - 1] > v;
      if (!wasAbove && nowAbove) cross = 'breakup';
      if (wasAbove && !nowAbove) cross = 'breakdown';
    }
    indicators[key] = {
      latest: Number(v.toFixed(4)),
      close_vs_ma: above,
      cross_today: cross,
    };
  };
  if (keys.has('MA20')) recordMA('MA20', 20);
  if (keys.has('MA60')) recordMA('MA60', 60);
  if (keys.has('MA120')) recordMA('MA120', 120);
  if (keys.has('MA240')) recordMA('MA240', 240);

  if (keys.has('EMA20')) {
    const arr = ema(close, 20);
    const v = arr[N - 1];
    if (v == null) indicators.EMA20 = { status: 'insufficient_data', need: 20, have: N };
    else indicators.EMA20 = {
      latest: Number(v.toFixed(4)),
      close_vs_ma: close[N - 1] > v ? 'above' : 'below',
    };
  }

  if (keys.has('BOLL')) {
    const b = bollinger(close, 20, 2);
    const u = b.upper[N - 1], m = b.middle[N - 1], l = b.lower[N - 1];
    if (u == null) indicators.BOLL = { status: 'insufficient_data', need: 20, have: N };
    else {
      const c = close[N - 1];
      let position;
      if (c >= u) position = 'above_upper';        // 突破上軌(超買)
      else if (c <= l) position = 'below_lower';   // 跌破下軌(超賣)
      else if (c >= m) position = 'upper_half';
      else position = 'lower_half';
      indicators.BOLL = {
        upper: Number(u.toFixed(4)),
        middle: Number(m.toFixed(4)),
        lower: Number(l.toFixed(4)),
        close_position: position,
        bandwidth_pct: Number(((u - l) / m * 100).toFixed(2)),
      };
    }
  }

  if (keys.has('RSI14')) {
    const arr = rsi(close, 14);
    const v = arr[N - 1];
    if (v == null) indicators.RSI14 = { status: 'insufficient_data', need: 15, have: N };
    else {
      let zone;
      if (v >= 70) zone = 'overbought';
      else if (v <= 30) zone = 'oversold';
      else zone = 'neutral';
      indicators.RSI14 = { latest: Number(v.toFixed(2)), zone };
    }
  }

  if (keys.has('MACD')) {
    const m = macd(close);
    const mv = m.macd[N - 1], sv = m.signal[N - 1], hv = m.histogram[N - 1];
    const prevHv = m.histogram[N - 2];
    if (mv == null || sv == null) indicators.MACD = { status: 'insufficient_data', need: 35, have: N };
    else {
      let cross = null;
      if (prevHv != null) {
        if (prevHv <= 0 && hv > 0) cross = 'golden_cross';
        if (prevHv >= 0 && hv < 0) cross = 'death_cross';
      }
      indicators.MACD = {
        macd: Number(mv.toFixed(4)),
        signal: Number(sv.toFixed(4)),
        histogram: Number(hv.toFixed(4)),
        cross_today: cross,
        momentum: hv > 0 ? 'positive' : 'negative',
      };
    }
  }

  return {
    latest,
    stats: {
      high_30d: Number(high_30d.toFixed(4)),
      low_30d: Number(low_30d.toFixed(4)),
      high_period: Number(high_period.toFixed(4)),
      low_period: Number(low_period.toFixed(4)),
      mean_period: Number(mean_period.toFixed(4)),
      change_pct_period: change_pct_period != null ? Number(change_pct_period.toFixed(2)) : null,
      bars: N,
    },
    indicators,
  };
}

module.exports = { sma, ema, rsi, macd, bollinger, buildLlmContext };
