/**
 * MetalsChart — 金屬走勢圖
 *
 * - 時間區間 chip(近 10 年 / 1 年 / 6 月 / 3 月 / 1 月 / 自訂)
 * - 多金屬疊加(同 group 內,基本 / 貴金屬不能跨)
 * - 技術指標 toggle(MA20/60/120/240 / EMA20 / RSI14 / MACD / BOLL)— 預設全 off
 * - 副圖 RSI / MACD 自動切第二 grid,X 軸對齊主圖
 * - 多金屬 (>3 條主線) 自動 log scale 避 PB vs SN 量級擠壓
 */
import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Loader2 } from 'lucide-react'
import api from '../../lib/api'
import { buildIndicatorSeries, type IndicatorKey, type PricePoint } from '../../lib/metalsIndicators'

export interface MetalDef {
  code: string
  name: string
}

export type RangeKey = '10y' | '1y' | '6m' | '3m' | '1m' | 'custom'
const RANGE_DAYS: Record<Exclude<RangeKey, 'custom'>, number> = {
  '10y': 3650,
  '1y': 365,
  '6m': 180,
  '3m': 90,
  '1m': 30,
}

const RANGE_LABEL: Record<RangeKey, string> = {
  '10y': '近 10 年',
  '1y': '近 1 年',
  '6m': '近 6 月',
  '3m': '近 3 月',
  '1m': '近 1 月',
  'custom': '自訂',
}

const ALL_INDICATORS: { key: IndicatorKey; label: string; sub?: boolean }[] = [
  { key: 'MA20',   label: 'MA20' },
  { key: 'MA60',   label: 'MA60(季)' },
  { key: 'MA120',  label: 'MA120(半年)' },
  { key: 'MA240',  label: 'MA240(年)' },
  { key: 'EMA20',  label: 'EMA20' },
  { key: 'BOLL',   label: 'BOLL 布林' },
  { key: 'RSI14',  label: 'RSI(副圖)', sub: true },
  { key: 'MACD',   label: 'MACD(副圖)', sub: true },
]

const METAL_COLORS: Record<string, string> = {
  AU: '#eab308', AG: '#94a3b8', PT: '#0ea5e9', PD: '#a855f7', RH: '#f43f5e',
  CU: '#f97316', AL: '#64748b', NI: '#10b981', ZN: '#3b82f6', PB: '#71717a', SN: '#8b5cf6',
}

interface Props {
  title: string
  metals: MetalDef[]              // 全部可選金屬(同 group)
  primaryMetal: string            // 第一條主線
  onPrimaryChange: (code: string) => void
  /** 標題色帶 — 'lme'(黃) / 'precious'(綠) */
  theme?: 'lme' | 'precious'
}

export default function MetalsChart({ title, metals, primaryMetal, onPrimaryChange, theme = 'lme' }: Props) {
  const [overlay, setOverlay] = useState<string[]>([])  // 疊加金屬(最多 1-2 個)
  const [range, setRange] = useState<RangeKey>('6m')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [indicators, setIndicators] = useState<IndicatorKey[]>([])

  // points: { metalCode → PricePoint[] }
  const [seriesByMetal, setSeriesByMetal] = useState<Record<string, PricePoint[]>>({})
  const [loading, setLoading] = useState(false)

  const days = useMemo(() => {
    if (range === 'custom') {
      if (!customFrom || !customTo) return 90
      const d = (new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000
      return Math.max(1, Math.round(d))
    }
    return RANGE_DAYS[range as Exclude<RangeKey, 'custom'>]
  }, [range, customFrom, customTo])

  // 抓所有要畫的金屬資料
  useEffect(() => {
    const wanted = [primaryMetal, ...overlay]
    if (wanted.length === 0) return
    setLoading(true)
    Promise.all(wanted.map(code =>
      api.get('/metals/prices/timeseries', { params: { metal: code, days } })
        .then(r => [code, (r.data || []) as PricePoint[]] as const)
        .catch(() => [code, []] as const)
    )).then(results => {
      const byMetal: Record<string, PricePoint[]> = {}
      for (const [code, pts] of results) byMetal[code] = pts
      setSeriesByMetal(byMetal)
    }).finally(() => setLoading(false))
  }, [primaryMetal, overlay.join(','), days])

  const toggleIndicator = (k: IndicatorKey) => {
    setIndicators(indicators.includes(k) ? indicators.filter(x => x !== k) : [...indicators, k])
  }

  const toggleOverlay = (code: string) => {
    if (code === primaryMetal) return
    if (overlay.includes(code)) setOverlay(overlay.filter(c => c !== code))
    else if (overlay.length < 2) setOverlay([...overlay, code])  // 最多疊 2 條
  }

  // 算指標(只對 primary)
  const primaryPoints = seriesByMetal[primaryMetal] || []
  const { mainSeries: indMain, subSeries: indSub } = useMemo(
    () => buildIndicatorSeries(primaryPoints, indicators),
    [primaryPoints, indicators.join(',')]
  )

  const hasSub = indSub.length > 0
  const totalLines = 1 + overlay.length
  const useLogScale = totalLines >= 3  // 多金屬時自動 log scale

  // ECharts option
  const option = useMemo(() => {
    const allMetals = [primaryMetal, ...overlay]
    const mainColor = METAL_COLORS[primaryMetal] || '#3b82f6'

    // 主金屬 series
    const mainPriceSeries: any[] = [{
      name: primaryMetal,
      type: 'line',
      data: primaryPoints.map(p => [p.date, p.price]),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 2, color: mainColor },
      itemStyle: { color: mainColor },
      yAxisIndex: 0,
    }]
    // overlay
    for (const code of overlay) {
      const pts = seriesByMetal[code] || []
      const c = METAL_COLORS[code] || '#94a3b8'
      mainPriceSeries.push({
        name: code,
        type: 'line',
        data: pts.map(p => [p.date, p.price]),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5, color: c },
        itemStyle: { color: c },
        yAxisIndex: 0,
      })
    }
    // 主圖技術指標
    for (const s of indMain) mainPriceSeries.push({ ...s, yAxisIndex: 0 })
    // 副圖技術指標(yAxisIndex 1)
    const subSeriesArr: any[] = indSub.map(s => ({ ...s }))

    const grids = hasSub
      ? [
          { left: 60, right: 30, top: 30, height: '60%' },
          { left: 60, right: 30, top: '72%', height: '20%' },
        ]
      : [{ left: 60, right: 30, top: 30, bottom: 60 }]

    const xAxes = hasSub
      ? [
          { type: 'time', gridIndex: 0, axisLabel: { fontSize: 10 } },
          { type: 'time', gridIndex: 1, axisLabel: { fontSize: 10 } },
        ]
      : [{ type: 'time', axisLabel: { fontSize: 10 } }]

    const yAxes: any[] = hasSub
      ? [
          { type: useLogScale ? 'log' : 'value', gridIndex: 0, scale: true, axisLabel: { fontSize: 10, formatter: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) } },
          { type: 'value', gridIndex: 1, scale: true, axisLabel: { fontSize: 10 } },
        ]
      : [{ type: useLogScale ? 'log' : 'value', scale: true, axisLabel: { fontSize: 10, formatter: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) } }]

    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: '#475569' } },
      },
      legend: {
        top: 0,
        textStyle: { fontSize: 11 },
      },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      dataZoom: [
        { type: 'inside', xAxisIndex: hasSub ? [0, 1] : [0], start: 0, end: 100 },
        { type: 'slider', xAxisIndex: hasSub ? [0, 1] : [0], height: 16, bottom: 6 },
      ],
      series: [...mainPriceSeries, ...subSeriesArr],
    }
  }, [primaryMetal, overlay.join(','), seriesByMetal, indMain, indSub, useLogScale, hasSub])

  const headerCls = theme === 'precious'
    ? 'bg-gradient-to-r from-emerald-100 to-green-50 border-emerald-200 text-emerald-900'
    : 'bg-gradient-to-r from-amber-100 to-yellow-50 border-amber-200 text-amber-900'

  const primaryBtnCls = theme === 'precious' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'

  return (
    <div className="bg-white border rounded-lg flex flex-col overflow-hidden">
      {/* 標題色帶 + 金屬選擇 */}
      <div className={`px-3 py-1.5 border-b ${headerCls} flex items-center gap-2 flex-wrap`}>
        <h3 className="text-sm font-bold">{title}</h3>
        <div className="flex items-center gap-1 flex-wrap ml-2">
          {metals.map(m => (
            <button
              key={m.code}
              onClick={() => onPrimaryChange(m.code)}
              className={`px-2 py-0.5 text-xs rounded font-mono ${
                m.code === primaryMetal
                  ? primaryBtnCls
                  : overlay.includes(m.code)
                    ? 'bg-white/80 text-slate-700 border border-slate-300'
                    : 'bg-white/60 text-slate-600 hover:bg-white border border-transparent'
              }`}
              title={`${m.code} ${m.name}(右鍵疊加比較)`}
              onContextMenu={(e) => { e.preventDefault(); toggleOverlay(m.code) }}
            >{m.code}</button>
          ))}
        </div>
        <span className="text-[10px] opacity-70 ml-auto">右鍵 = 疊加比較(最多 2 條)</span>
      </div>
      <div className="p-2 flex-1 flex flex-col">

      {/* 時間區間 + indicator toggle */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="flex items-center gap-1 flex-wrap">
          {(['10y', '1y', '6m', '3m', '1m', 'custom'] as RangeKey[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-xs rounded ${
                r === range ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >{RANGE_LABEL[r]}</button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-1 text-xs">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="border rounded px-1 py-0.5 text-xs" />
            <span className="text-slate-400">→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="border rounded px-1 py-0.5 text-xs" />
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {ALL_INDICATORS.map(ind => (
            <label
              key={ind.key}
              className={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded cursor-pointer ${
                indicators.includes(ind.key)
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-slate-500 hover:bg-slate-50 border border-transparent'
              }`}
            >
              <input
                type="checkbox"
                checked={indicators.includes(ind.key)}
                onChange={() => toggleIndicator(ind.key)}
                className="scale-90"
              />
              {ind.label}
            </label>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative" style={{ height: hasSub ? 360 : 280 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
            <Loader2 className="animate-spin text-slate-400" size={20} />
          </div>
        )}
        {primaryPoints.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full text-sm text-slate-400">
            無 {primaryMetal} 資料(該區間無報價)
          </div>
        ) : (
          <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge={true} />
        )}
      </div>
      </div>
    </div>
  )
}
