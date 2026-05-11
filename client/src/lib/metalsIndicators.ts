/**
 * 金屬價格技術指標計算 — pure TS,無第三方 dep
 *
 * 全部吃 close[]: number[](時序遞增)→ 同長度 (number | null)[],null 表示尚未足夠樣本
 *
 * 規劃見 docs/metals-lite-plan.md §2.3
 */

/** 簡單移動平均 SMA */
export function sma(close: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null)
  if (period <= 0) return out
  let sum = 0
  for (let i = 0; i < close.length; i++) {
    sum += close[i]
    if (i >= period) sum -= close[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** 指數移動平均 EMA(default smoothing=2,即 (2/(N+1))) */
export function ema(close: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null)
  if (period <= 0 || close.length === 0) return out
  const k = 2 / (period + 1)
  // 用前 N 個的 SMA 當第一個 EMA seed
  let seedSum = 0
  for (let i = 0; i < close.length; i++) {
    if (i < period) {
      seedSum += close[i]
      if (i === period - 1) out[i] = seedSum / period
    } else {
      const prev = out[i - 1] as number
      out[i] = close[i] * k + prev * (1 - k)
    }
  }
  return out
}

/** RSI(Wilder smoothing) */
export function rsi(close: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null)
  if (close.length <= period) return out
  let gainSum = 0, lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = close[i] - close[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum += -diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss))
  for (let i = period + 1; i < close.length; i++) {
    const diff = close[i] - close[i - 1]
    const gain = diff >= 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss))
  }
  return out
}

/** MACD(default 12, 26, 9)— 回 macd / signal / histogram 同長陣列 */
export function macd(
  close: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const fast = ema(close, fastPeriod)
  const slow = ema(close, slowPeriod)
  const macdLine: (number | null)[] = close.map((_, i) => {
    const f = fast[i], s = slow[i]
    return f != null && s != null ? f - s : null
  })
  // signal = ema(macdLine, signalPeriod) — 但 macdLine 前面有 null,要 strip 計算
  const macdValues: number[] = []
  const macdIdx: number[] = []
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null) {
      macdValues.push(macdLine[i] as number)
      macdIdx.push(i)
    }
  }
  const signalRaw = ema(macdValues, signalPeriod)
  const signalLine: (number | null)[] = new Array(close.length).fill(null)
  for (let j = 0; j < signalRaw.length; j++) {
    const v = signalRaw[j]
    if (v != null) signalLine[macdIdx[j]] = v
  }
  const histogram: (number | null)[] = close.map((_, i) => {
    const m = macdLine[i], s = signalLine[i]
    return m != null && s != null ? m - s : null
  })
  return { macd: macdLine, signal: signalLine, histogram }
}

/** Bollinger Bands(default period=20, stdDevMultiplier=2)— 回 upper / middle / lower */
export function bollinger(
  close: number[],
  period = 20,
  stdDev = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = sma(close, period)
  const upper: (number | null)[] = new Array(close.length).fill(null)
  const lower: (number | null)[] = new Array(close.length).fill(null)
  for (let i = period - 1; i < close.length; i++) {
    let sumSq = 0
    const mean = middle[i] as number
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (close[j] - mean) ** 2
    }
    const sd = Math.sqrt(sumSq / period)
    upper[i] = mean + stdDev * sd
    lower[i] = mean - stdDev * sd
  }
  return { upper, middle, lower }
}

/**
 * 一站式 helper:吃 series(date+price),回 ECharts series 物件陣列
 * indicators: 要哪些 — MA20 / MA60 / MA120 / MA240 / EMA20 / RSI14 / MACD / BOLL
 */
export type IndicatorKey = 'MA20' | 'MA60' | 'MA120' | 'MA240' | 'EMA20' | 'RSI14' | 'MACD' | 'BOLL'

export interface PricePoint {
  date: string
  price: number
}

export interface IndicatorSeries {
  name: string
  type: 'line' | 'bar'
  data: [string, number | null][]
  yAxisIndex?: number
  smooth?: boolean
  symbol?: 'none' | 'circle'
  lineStyle?: { width?: number; type?: 'solid' | 'dashed'; color?: string }
  itemStyle?: { color?: string }
}

const INDICATOR_COLORS: Record<IndicatorKey, string> = {
  MA20: '#3b82f6',   // blue
  MA60: '#8b5cf6',   // violet  (季線)
  MA120: '#f59e0b',  // amber   (半年線)
  MA240: '#ef4444',  // red     (年線)
  EMA20: '#10b981',  // emerald
  RSI14: '#f97316',  // orange
  MACD: '#06b6d4',   // cyan
  BOLL: '#94a3b8',   // slate
}

export function buildIndicatorSeries(
  points: PricePoint[],
  indicators: IndicatorKey[],
): { mainSeries: IndicatorSeries[]; subSeries: IndicatorSeries[] } {
  const close = points.map(p => p.price)
  const dates = points.map(p => p.date)
  const mainSeries: IndicatorSeries[] = []
  const subSeries: IndicatorSeries[] = []

  const zip = (vals: (number | null)[]): [string, number | null][] =>
    vals.map((v, i) => [dates[i], v])

  // 重要:每個 line series 必須同時設 lineStyle.color + itemStyle.color
  // 只設 lineStyle.color → legend 圖示用 ECharts 預設 palette 不會跟線一致(2026-05-11 bug)
  const lineSeries = (
    name: string,
    data: [string, number | null][],
    color: string,
    opts: { width?: number; dashed?: boolean; yAxisIndex?: number; smooth?: boolean } = {},
  ): IndicatorSeries => ({
    name,
    type: 'line',
    data,
    smooth: opts.smooth !== false,
    symbol: 'none',
    yAxisIndex: opts.yAxisIndex,
    lineStyle: { width: opts.width ?? 1.2, type: opts.dashed ? 'dashed' : 'solid', color },
    itemStyle: { color },  // 同色 → legend marker 與線一致
  })

  for (const ind of indicators) {
    if (ind === 'MA20') mainSeries.push(lineSeries('MA20', zip(sma(close, 20)), INDICATOR_COLORS.MA20))
    if (ind === 'MA60') mainSeries.push(lineSeries('MA60(季)', zip(sma(close, 60)), INDICATOR_COLORS.MA60))
    if (ind === 'MA120') mainSeries.push(lineSeries('MA120(半年)', zip(sma(close, 120)), INDICATOR_COLORS.MA120))
    if (ind === 'MA240') mainSeries.push(lineSeries('MA240(年)', zip(sma(close, 240)), INDICATOR_COLORS.MA240))
    if (ind === 'EMA20') mainSeries.push(lineSeries('EMA20', zip(ema(close, 20)), INDICATOR_COLORS.EMA20, { dashed: true }))
    if (ind === 'BOLL') {
      const b = bollinger(close, 20, 2)
      mainSeries.push(lineSeries('BOLL 上', zip(b.upper), INDICATOR_COLORS.BOLL, { width: 1, dashed: true }))
      mainSeries.push(lineSeries('BOLL 中', zip(b.middle), INDICATOR_COLORS.BOLL, { width: 1 }))
      mainSeries.push(lineSeries('BOLL 下', zip(b.lower), INDICATOR_COLORS.BOLL, { width: 1, dashed: true }))
    }
    if (ind === 'RSI14') subSeries.push(lineSeries('RSI14', zip(rsi(close, 14)), INDICATOR_COLORS.RSI14, { width: 1.5, yAxisIndex: 1 }))
    if (ind === 'MACD') {
      const m = macd(close)
      subSeries.push(lineSeries('MACD', zip(m.macd), INDICATOR_COLORS.MACD, { yAxisIndex: 1, smooth: false }))
      subSeries.push(lineSeries('Signal', zip(m.signal), '#f43f5e', { yAxisIndex: 1, dashed: true, smooth: false }))
      // histogram 用 bar(itemStyle.color 已是 bar 的填色,不用 lineStyle)
      subSeries.push({
        name: 'Hist', type: 'bar', data: zip(m.histogram), yAxisIndex: 1,
        itemStyle: { color: '#a3a3a3' },
      })
    }
  }
  return { mainSeries, subSeries }
}
