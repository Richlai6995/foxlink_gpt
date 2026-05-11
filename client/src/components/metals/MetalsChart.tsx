/**
 * MetalsChart — 金屬走勢圖
 *
 * - 時間區間 chip(近 10 年 / 1 年 / 6 月 / 3 月 / 1 月 / 自訂)
 * - 多金屬疊加(同 group 內,基本 / 貴金屬不能跨)
 * - 技術指標 toggle(MA20/60/120/240 / EMA20 / RSI14 / MACD / BOLL)— 預設全 off
 * - 副圖 RSI / MACD 自動切第二 grid,X 軸對齊主圖
 * - 多金屬 (>3 條主線) 自動 log scale 避 PB vs SN 量級擠壓
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Loader2, Maximize2, Minimize2, Sparkles, Minus, TrendingUp, Type, Trash2, MousePointer2, PencilLine } from 'lucide-react'
import api from '../../lib/api'
import { buildIndicatorSeries, type IndicatorKey, type PricePoint } from '../../lib/metalsIndicators'
import MetalsTAPanel from './MetalsTAPanel'

type DrawTool = 'none' | 'horizontal' | 'trendline' | 'text'

interface Annotation {
  id: number
  metal_code: string
  ann_type: 'horizontal' | 'trendline' | 'text'
  data: any
  color?: string
  note?: string
  created_at?: string
}

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

const ALL_INDICATORS: { key: IndicatorKey; label: string; minPts: number; sub?: boolean }[] = [
  { key: 'MA20',   label: 'MA20',         minPts: 20 },
  { key: 'MA60',   label: 'MA60(季)',     minPts: 60 },
  { key: 'MA120',  label: 'MA120(半年)',  minPts: 120 },
  { key: 'MA240',  label: 'MA240(年)',    minPts: 240 },
  { key: 'EMA20',  label: 'EMA20',        minPts: 20 },
  { key: 'BOLL',   label: 'BOLL 布林',    minPts: 20 },
  { key: 'RSI14',  label: 'RSI(副圖)',    minPts: 15, sub: true },
  { key: 'MACD',   label: 'MACD(副圖)',   minPts: 35, sub: true },
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
  /** 結束日期(YYYY-MM-DD)— chart 區間以這天為終點往回 days;空 = 今天 */
  viewDate?: string
}

export default function MetalsChart({ title, metals, primaryMetal, onPrimaryChange, theme = 'lme', viewDate }: Props) {
  const [overlay, setOverlay] = useState<string[]>([])  // 疊加金屬(最多 1-2 個)
  const [range, setRange] = useState<RangeKey>('6m')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [indicators, setIndicators] = useState<IndicatorKey[]>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showTA, setShowTA] = useState(false)
  // 標註工具列預設收起,點筆 icon 才展開 — 一般 user 不常用,展開會壓縮 indicator 列空間
  const [showAnnotationToolbar, setShowAnnotationToolbar] = useState(false)

  // ─── 標註(annotations)─────────────────────────────────────────────
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeTool, setActiveTool] = useState<DrawTool>('none')
  const [trendlineFirst, setTrendlineFirst] = useState<[string, number] | null>(null)
  const chartRef = useRef<any>(null)
  // 用 ref 保留最新 state,供 zr.on('click') 內部 closure 讀
  const activeToolRef = useRef<DrawTool>(activeTool)
  const trendlineFirstRef = useRef<[string, number] | null>(null)
  useEffect(() => { activeToolRef.current = activeTool }, [activeTool])
  useEffect(() => { trendlineFirstRef.current = trendlineFirst }, [trendlineFirst])

  // 載 annotations(換金屬時 reload)
  const reloadAnnotations = useCallback(async () => {
    if (!primaryMetal) return
    try {
      const r = await api.get('/metals/annotations', { params: { metal: primaryMetal } })
      setAnnotations(r.data?.rows || [])
    } catch (e) {
      console.warn('[MetalsChart] reloadAnnotations 失敗:', e)
    }
  }, [primaryMetal])
  useEffect(() => { reloadAnnotations() }, [reloadAnnotations])

  const addAnnotation = async (annType: Annotation['ann_type'], data: any, color?: string) => {
    try {
      await api.post('/metals/annotations', { metal: primaryMetal, ann_type: annType, data, color })
      await reloadAnnotations()
    } catch (e: any) {
      alert('儲存標註失敗:' + (e?.response?.data?.error || e?.message))
    }
  }
  const deleteAnnotation = async (id: number) => {
    try {
      await api.delete(`/metals/annotations/${id}`)
      await reloadAnnotations()
    } catch (e) { console.warn('刪除失敗', e) }
  }
  const updateAnnotation = async (id: number, data: any, color?: string, note?: string) => {
    try {
      await api.put(`/metals/annotations/${id}`, { data, color, note })
      await reloadAnnotations()
    } catch (e: any) {
      alert('更新失敗:' + (e?.response?.data?.error || e?.message))
    }
  }
  const [editingAnn, setEditingAnn] = useState<Annotation | null>(null)
  const clearAllAnnotations = async () => {
    if (!confirm(`清除 ${primaryMetal} 的所有標註?(無法復原)`)) return
    try {
      await api.delete('/metals/annotations', { params: { metal: primaryMetal } })
      await reloadAnnotations()
    } catch (e: any) { alert('清除失敗:' + e?.message) }
  }

  // chart 點擊處理:依當前 tool 把畫面座標轉成 data 座標,然後存
  const onChartReady = useCallback((chart: any) => {
    chartRef.current = chart
    const zr = chart.getZr?.()
    if (!zr) return
    const handler = (ev: any) => {
      const tool = activeToolRef.current
      if (tool === 'none') return
      const offsetX = ev.offsetX
      const offsetY = ev.offsetY
      // 只在主圖 grid (gridIndex 0) 區域內才接 click
      const coord = chart.convertFromPixel({ gridIndex: 0 }, [offsetX, offsetY])
      if (!coord || !Number.isFinite(coord[1])) return
      const xTime = coord[0]
      const yValue = coord[1]
      // xTime 是 timestamp(time axis),轉 YYYY-MM-DD
      const date = new Date(xTime).toISOString().slice(0, 10)

      if (tool === 'horizontal') {
        addAnnotation('horizontal', { y: Number(yValue.toFixed(4)) })
        setActiveTool('none')
      } else if (tool === 'text') {
        const text = window.prompt('輸入標註文字')
        if (text && text.trim()) {
          addAnnotation('text', { at: [date, Number(yValue.toFixed(4))], text: text.trim() })
        }
        setActiveTool('none')
      } else if (tool === 'trendline') {
        const first = trendlineFirstRef.current
        if (!first) {
          setTrendlineFirst([date, Number(yValue.toFixed(4))])
        } else {
          addAnnotation('trendline', { p1: first, p2: [date, Number(yValue.toFixed(4))] })
          setTrendlineFirst(null)
          setActiveTool('none')
        }
      }
    }
    zr.on('click', handler)
    // cleanup 在 chart re-mount 時 ECharts 自己處理 zr;不額外 off
  }, [primaryMetal])  // primaryMetal 變 → addAnnotation closure 也要更新

  // ESC 退出全螢幕 / 取消畫圖
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (activeToolRef.current !== 'none') {
        setActiveTool('none')
        setTrendlineFirst(null)
      } else if (isFullscreen) {
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen])

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
    const params: Record<string, any> = { days }
    if (viewDate) params.end_date = viewDate
    Promise.all(wanted.map(code =>
      api.get('/metals/prices/timeseries', { params: { ...params, metal: code } })
        .then(r => {
          const pts = (r.data || []) as PricePoint[]
          if (pts.length === 0) console.warn(`[MetalsChart] ${code} timeseries 回 0 筆 (days=${days}, end=${viewDate || 'today'})`)
          return [code, pts] as const
        })
        .catch(err => {
          // JSON.stringify 確保 error message 不會在 console 顯示成 'Object'
          const status = err?.response?.status
          const body = err?.response?.data
          const bodyStr = body ? JSON.stringify(body) : (err?.message || String(err))
          console.error(`[MetalsChart] ${code} timeseries 失敗: status=${status} body=${bodyStr}`)
          return [code, []] as const
        })
    )).then(results => {
      const byMetal: Record<string, PricePoint[]> = {}
      for (const [code, pts] of results) byMetal[code] = pts
      setSeriesByMetal(byMetal)
    }).finally(() => setLoading(false))
  }, [primaryMetal, overlay.join(','), days, viewDate])

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

  // X 軸時間範圍鎖定:[end - days, end]
  // 不論 DB 資料多寡,切換時間區間都看得到 X 軸 scale 變化(否則 ECharts 會 auto-fit 資料)
  const { xAxisMin, xAxisMax } = useMemo(() => {
    const endDate = viewDate && /^\d{4}-\d{2}-\d{2}$/.test(viewDate)
      ? new Date(viewDate + 'T23:59:59')
      : new Date()
    const max = endDate.getTime()
    const min = max - days * 86400000
    return { xAxisMin: min, xAxisMax: max }
  }, [days, viewDate])

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
    // 主圖技術指標(grid 0)
    for (const s of indMain) mainPriceSeries.push({ ...s, xAxisIndex: 0, yAxisIndex: 0 })
    // 副圖技術指標(grid 1)— xAxisIndex 跟 yAxisIndex 都必須是 1,
    // 否則 series 跨兩個 grid,ECharts reset 時讀 axis.type 會炸 'Cannot read of undefined'
    const subSeriesArr: any[] = indSub.map(s => ({ ...s, xAxisIndex: 1, yAxisIndex: 1 }))

    // ─── 標註(horizontal / trendline / text)→ markLine + markPoint ───
    // 每個標註用獨立 silent series 攜帶,避免互相干擾
    for (const ann of annotations) {
      if (ann.ann_type === 'horizontal') {
        const y = ann.data?.y
        if (!Number.isFinite(y)) continue
        const lw = Number(ann.data?.lineWidth) || 1.2
        mainPriceSeries.push({
          type: 'line', data: [], silent: true, xAxisIndex: 0, yAxisIndex: 0,
          markLine: {
            symbol: 'none', silent: false,
            data: [{ yAxis: y, name: `H#${ann.id}` }],
            label: { formatter: ann.note || y.toFixed(2), position: 'insideEndTop', fontSize: 10 },
            lineStyle: { color: ann.color || '#f59e0b', width: lw, type: 'dashed' },
          },
        })
      } else if (ann.ann_type === 'trendline') {
        const p1 = ann.data?.p1
        const p2 = ann.data?.p2
        if (!Array.isArray(p1) || !Array.isArray(p2)) continue
        const lw = Number(ann.data?.lineWidth) || 1.5
        mainPriceSeries.push({
          type: 'line', data: [], silent: true, xAxisIndex: 0, yAxisIndex: 0,
          markLine: {
            symbol: 'none', silent: false,
            data: [[
              { coord: [p1[0], p1[1]], name: `T#${ann.id}` },
              { coord: [p2[0], p2[1]] },
            ]],
            label: { show: false },
            lineStyle: { color: ann.color || '#3b82f6', width: lw },
          },
        })
      } else if (ann.ann_type === 'text') {
        const at = ann.data?.at
        const text = ann.data?.text || ''
        const fontSize = Number(ann.data?.fontSize) || 12
        const textColor = ann.data?.textColor || '#ffffff'
        const bgColor = ann.color || '#10b981'
        if (!Array.isArray(at) || !text) continue
        // 估算文字框尺寸:中英混合每字約 fontSize × 1 寬,左右各留 8px 內距;
        // 高度 fontSize × 1.6 + 8px 內距。讓文字真的進得去(原本 pin 太小看不到)
        const charWidthApprox = text.split('').reduce((sum, c) => sum + (/[一-鿿＀-￿]/.test(c) ? fontSize : fontSize * 0.6), 0)
        const boxW = Math.max(charWidthApprox + 16, 32)
        const boxH = fontSize * 1.6 + 8
        mainPriceSeries.push({
          type: 'line', data: [], silent: true, xAxisIndex: 0, yAxisIndex: 0,
          markPoint: {
            symbol: 'roundRect',
            symbolSize: [boxW, boxH],
            symbolKeepAspect: false,
            silent: false,
            data: [{ coord: [at[0], at[1]], name: `X#${ann.id}` }],
            label: {
              show: true,
              formatter: text,
              fontSize,
              color: textColor,
              fontWeight: 'bold',
            },
            itemStyle: {
              color: bgColor,
              borderColor: '#ffffff',
              borderWidth: 1,
              shadowBlur: 4,
              shadowColor: 'rgba(0,0,0,0.2)',
            },
          },
        })
      }
    }

    // 趨勢線繪製中:第一點已點下,顯示一個小 dot 提示
    if (trendlineFirst && activeTool === 'trendline') {
      mainPriceSeries.push({
        type: 'scatter', data: [[trendlineFirst[0], trendlineFirst[1]]], silent: true,
        xAxisIndex: 0, yAxisIndex: 0, symbolSize: 10,
        itemStyle: { color: '#3b82f6', borderColor: '#fff', borderWidth: 2 },
        z: 100,
      })
    }

    const grids = hasSub
      ? [
          { left: 60, right: 30, top: 30, height: '60%' },
          { left: 60, right: 30, top: '72%', height: '20%' },
        ]
      : [{ left: 60, right: 30, top: 30, bottom: 60 }]

    const xAxes = hasSub
      ? [
          { type: 'time', gridIndex: 0, min: xAxisMin, max: xAxisMax, axisLabel: { fontSize: 10 } },
          { type: 'time', gridIndex: 1, min: xAxisMin, max: xAxisMax, axisLabel: { fontSize: 10 } },
        ]
      : [{ type: 'time', min: xAxisMin, max: xAxisMax, axisLabel: { fontSize: 10 } }]

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
  }, [primaryMetal, overlay.join(','), seriesByMetal, indMain, indSub, useLogScale, hasSub, xAxisMin, xAxisMax, annotations, trendlineFirst, activeTool])

  const headerCls = theme === 'precious'
    ? 'bg-gradient-to-r from-emerald-100 to-green-50 border-emerald-200 text-emerald-900'
    : 'bg-gradient-to-r from-amber-100 to-yellow-50 border-amber-200 text-amber-900'

  const primaryBtnCls = theme === 'precious' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'

  const wrapperCls = isFullscreen
    ? 'fixed inset-0 z-50 bg-white flex flex-col overflow-hidden shadow-2xl'
    : 'bg-white border rounded-lg flex flex-col overflow-hidden'

  return (
    <div className={wrapperCls}>
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
        <span
          className="text-[10px] opacity-80 ml-2 px-1.5 py-0.5 rounded bg-white/60"
          title={`DB 內 ${primaryMetal} 在此區間共 ${primaryPoints.length} 筆`}
        >
          {primaryPoints.length} 筆 / {days} 天
        </span>
        <span className="text-[10px] opacity-70 ml-auto">右鍵 = 疊加比較(最多 2 條)</span>
        <button
          onClick={() => setShowTA(true)}
          className="ml-1 flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-violet-500 hover:bg-violet-600 text-white shadow-sm"
          title="用當前 chart 配置產 AI 技術分析摘要"
        >
          <Sparkles size={11} /> AI TA
        </button>
        <button
          onClick={() => setIsFullscreen(v => !v)}
          className="ml-1 p-1 rounded hover:bg-white/60 text-slate-700"
          title={isFullscreen ? '退出全螢幕(Esc)' : '全螢幕展開'}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
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
        {/* 標註工具列 toggle — 預設收起,展開後第二列才出現 */}
        <button
          onClick={() => setShowAnnotationToolbar(v => !v)}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border ${
            showAnnotationToolbar || annotations.length > 0
              ? 'bg-amber-50 text-amber-700 border-amber-300'
              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
          }`}
          title={showAnnotationToolbar ? '收起標註工具' : '展開標註工具(水平線/趨勢線/文字)'}
        >
          <PencilLine size={11} />
          {annotations.length > 0 && <span className="font-mono">{annotations.length}</span>}
        </button>
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {ALL_INDICATORS.map(ind => {
            const enough = primaryPoints.length >= ind.minPts
            const checked = indicators.includes(ind.key)
            return (
              <label
                key={ind.key}
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded ${enough ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'} ${
                  checked
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-slate-500 hover:bg-slate-50 border border-transparent'
                }`}
                title={enough ? '' : `需要至少 ${ind.minPts} 筆資料(目前 ${primaryPoints.length} 筆)`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!enough}
                  onChange={() => enough && toggleIndicator(ind.key)}
                  className="scale-90"
                />
                {ind.label}
                {!enough && <span className="text-[9px] text-slate-400">(資料不足)</span>}
              </label>
            )
          })}
        </div>
      </div>

      {/* Drawing tools toolbar — 預設收起,點筆 icon 才展開 */}
      {showAnnotationToolbar && (
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-slate-50 text-[10px] text-slate-500 flex-wrap">
        <span className="font-medium text-slate-600 mr-1">標註:</span>
        <ToolBtn active={activeTool === 'none'} onClick={() => { setActiveTool('none'); setTrendlineFirst(null) }} icon={<MousePointer2 size={11} />} label="選取" />
        <ToolBtn active={activeTool === 'horizontal'} onClick={() => setActiveTool(activeTool === 'horizontal' ? 'none' : 'horizontal')} icon={<Minus size={11} />} label="水平線" />
        <ToolBtn
          active={activeTool === 'trendline'}
          onClick={() => {
            const next = activeTool === 'trendline' ? 'none' : 'trendline'
            setActiveTool(next)
            if (next !== 'trendline') setTrendlineFirst(null)
          }}
          icon={<TrendingUp size={11} />}
          label={`趨勢線${trendlineFirst ? '(再點第 2 點)' : ''}`}
        />
        <ToolBtn active={activeTool === 'text'} onClick={() => setActiveTool(activeTool === 'text' ? 'none' : 'text')} icon={<Type size={11} />} label="文字" />
        {annotations.length > 0 && (
          <>
            <span className="ml-2 text-slate-400">|</span>
            <span className="text-slate-600">已有 <b>{annotations.length}</b> 個</span>
            <AnnotationsDropdown annotations={annotations} onDelete={deleteAnnotation} onEdit={setEditingAnn} />
            <button
              onClick={clearAllAnnotations}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
              title="清除所有標註"
            ><Trash2 size={11} /> 清除全部</button>
          </>
        )}
        {activeTool !== 'none' && (
          <span className="ml-auto text-amber-600">
            {activeTool === 'horizontal' && '👆 點 chart 任一處放水平線'}
            {activeTool === 'text' && '👆 點 chart 任一處放文字'}
            {activeTool === 'trendline' && !trendlineFirst && '👆 點 chart 第 1 點'}
            {activeTool === 'trendline' && trendlineFirst && '👆 再點第 2 點完成連線(Esc 取消)'}
          </span>
        )}
      </div>
      )}

      {/* Chart — fullscreen 時 flex-1 撐滿剩餘空間,否則固定高 */}
      <div
        className={`relative ${isFullscreen ? 'flex-1 min-h-0' : ''}`}
        style={isFullscreen ? undefined : { height: hasSub ? 360 : 280 }}
      >
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
          // key 變化強制 re-mount,確保 fullscreen 切換時 ECharts 重新算 layout
          <ReactECharts
            key={isFullscreen ? 'fs' : 'norm'}
            option={option}
            style={{ height: '100%', width: '100%', cursor: activeTool !== 'none' ? 'crosshair' : 'default' }}
            notMerge={true}
            onChartReady={onChartReady}
          />
        )}
      </div>
      </div>

      {/* AI TA drawer */}
      <MetalsTAPanel
        isOpen={showTA}
        onClose={() => setShowTA(false)}
        metal={primaryMetal}
        days={days}
        viewDate={viewDate}
        indicators={indicators}
      />

      {/* 編輯標註 modal */}
      {editingAnn && (
        <AnnotationEditModal
          annotation={editingAnn}
          onClose={() => setEditingAnn(null)}
          onSave={async (data, color, note) => {
            await updateAnnotation(editingAnn.id, data, color, note)
            setEditingAnn(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Annotation 編輯 modal ────────────────────────────────────────────────────
function AnnotationEditModal({
  annotation, onClose, onSave,
}: {
  annotation: Annotation
  onClose: () => void
  onSave: (data: any, color?: string, note?: string) => Promise<void>
}) {
  const initData = annotation.data || {}
  const [color, setColor] = useState(annotation.color || (
    annotation.ann_type === 'horizontal' ? '#f59e0b'
    : annotation.ann_type === 'trendline' ? '#3b82f6'
    : '#10b981'
  ))
  const [note, setNote] = useState(annotation.note || '')
  // 各 type 專屬欄位
  const [y, setY] = useState<number>(Number(initData.y) || 0)
  const [p1Date, setP1Date] = useState<string>(initData.p1?.[0] || '')
  const [p1Y, setP1Y] = useState<number>(Number(initData.p1?.[1]) || 0)
  const [p2Date, setP2Date] = useState<string>(initData.p2?.[0] || '')
  const [p2Y, setP2Y] = useState<number>(Number(initData.p2?.[1]) || 0)
  const [lineWidth, setLineWidth] = useState<number>(Number(initData.lineWidth) || (annotation.ann_type === 'trendline' ? 1.5 : 1.2))
  const [text, setText] = useState<string>(initData.text || '')
  const [textDate, setTextDate] = useState<string>(initData.at?.[0] || '')
  const [textY, setTextY] = useState<number>(Number(initData.at?.[1]) || 0)
  const [fontSize, setFontSize] = useState<number>(Number(initData.fontSize) || 12)
  const [textColor, setTextColor] = useState(initData.textColor || '#ffffff')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      let data: any
      if (annotation.ann_type === 'horizontal') {
        if (!Number.isFinite(y)) { alert('y 必須是數字'); setSaving(false); return }
        data = { y, lineWidth }
      } else if (annotation.ann_type === 'trendline') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p1Date) || !/^\d{4}-\d{2}-\d{2}$/.test(p2Date)) {
          alert('日期格式必須 YYYY-MM-DD'); setSaving(false); return
        }
        data = { p1: [p1Date, p1Y], p2: [p2Date, p2Y], lineWidth }
      } else if (annotation.ann_type === 'text') {
        if (!text.trim()) { alert('文字內容不可空'); setSaving(false); return }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(textDate)) { alert('日期格式必須 YYYY-MM-DD'); setSaving(false); return }
        data = { at: [textDate, textY], text: text.trim(), fontSize, textColor }
      } else {
        data = annotation.data
      }
      await onSave(data, color, note)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-4 w-[400px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Type size={14} className="text-slate-700" />
          <span className="font-semibold text-sm">
            編輯{annotation.ann_type === 'horizontal' ? '水平線' : annotation.ann_type === 'trendline' ? '趨勢線' : '文字標註'}
          </span>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="space-y-3 text-xs">
          {/* HORIZONTAL */}
          {annotation.ann_type === 'horizontal' && (
            <>
              <FormRow label="價位(USD)">
                <input
                  type="number" step="any"
                  value={y} onChange={e => setY(Number(e.target.value))}
                  className="w-full border rounded px-2 py-1 font-mono"
                />
              </FormRow>
              <FormRow label="說明文字(顯示在線旁)">
                <input
                  type="text" value={note} maxLength={200}
                  onChange={e => setNote(e.target.value)}
                  placeholder="例如:成本警戒線"
                  className="w-full border rounded px-2 py-1"
                />
              </FormRow>
            </>
          )}

          {/* TRENDLINE */}
          {annotation.ann_type === 'trendline' && (
            <>
              <FormRow label="第 1 點 日期">
                <input type="date" value={p1Date} onChange={e => setP1Date(e.target.value)} className="w-full border rounded px-2 py-1 font-mono" />
              </FormRow>
              <FormRow label="第 1 點 價位">
                <input type="number" step="any" value={p1Y} onChange={e => setP1Y(Number(e.target.value))} className="w-full border rounded px-2 py-1 font-mono" />
              </FormRow>
              <FormRow label="第 2 點 日期">
                <input type="date" value={p2Date} onChange={e => setP2Date(e.target.value)} className="w-full border rounded px-2 py-1 font-mono" />
              </FormRow>
              <FormRow label="第 2 點 價位">
                <input type="number" step="any" value={p2Y} onChange={e => setP2Y(Number(e.target.value))} className="w-full border rounded px-2 py-1 font-mono" />
              </FormRow>
            </>
          )}

          {/* TEXT */}
          {annotation.ann_type === 'text' && (
            <>
              <FormRow label="文字內容">
                <input type="text" value={text} maxLength={100} onChange={e => setText(e.target.value)} className="w-full border rounded px-2 py-1" />
              </FormRow>
              <FormRow label="日期">
                <input type="date" value={textDate} onChange={e => setTextDate(e.target.value)} className="w-full border rounded px-2 py-1 font-mono" />
              </FormRow>
              <FormRow label="價位 Y">
                <input type="number" step="any" value={textY} onChange={e => setTextY(Number(e.target.value))} className="w-full border rounded px-2 py-1 font-mono" />
              </FormRow>
              <FormRow label="字級">
                <input type="range" min={9} max={24} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full" />
                <span className="ml-2 font-mono text-slate-600">{fontSize}px</span>
              </FormRow>
              <FormRow label="文字色">
                <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} className="w-12 h-7" />
              </FormRow>
            </>
          )}

          {/* 線 / 字 共用色 + 線寬 */}
          <FormRow label={annotation.ann_type === 'text' ? '背景色' : '線色'}>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-12 h-7" />
          </FormRow>
          {(annotation.ann_type === 'horizontal' || annotation.ann_type === 'trendline') && (
            <FormRow label="線寬">
              <input type="range" min={0.5} max={5} step={0.5} value={lineWidth} onChange={e => setLineWidth(Number(e.target.value))} className="w-full" />
              <span className="ml-2 font-mono text-slate-600">{lineWidth}px</span>
            </FormRow>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
          <button onClick={onClose} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded">取消</button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >{saving ? '儲存中…' : '儲存'}</button>
        </div>
      </div>
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-slate-600 w-24 flex-shrink-0">{label}</label>
      <div className="flex-1 flex items-center">{children}</div>
    </div>
  )
}

// ─── 標註工具列按鈕 ──────────────────────────────────────────────────────────
function ToolBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ${
        active ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
      }`}
    >
      {icon} {label}
    </button>
  )
}

// ─── 標註管理 dropdown ─────────────────────────────────────────────────────
function AnnotationsDropdown({
  annotations, onDelete, onEdit,
}: {
  annotations: Annotation[]
  onDelete: (id: number) => void
  onEdit: (ann: Annotation) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    setTimeout(() => document.addEventListener('click', handler), 0)
    return () => document.removeEventListener('click', handler)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
      >📋 列表</button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg p-2 z-30 w-[300px] max-h-[320px] overflow-y-auto">
          <div className="text-[10px] text-slate-500 mb-1">{annotations.length} 個標註(點 ✏️ 編輯)</div>
          {annotations.map(ann => {
            let desc = ''
            if (ann.ann_type === 'horizontal') desc = `H 線 @ ${ann.data?.y?.toFixed(2)}`
            else if (ann.ann_type === 'trendline') desc = `趨勢 ${ann.data?.p1?.[0]?.slice(5)} → ${ann.data?.p2?.[0]?.slice(5)}`
            else if (ann.ann_type === 'text') desc = `「${(ann.data?.text || '').slice(0, 14)}」@ ${ann.data?.at?.[0]?.slice(5)}`
            const swatch = ann.color || (ann.ann_type === 'horizontal' ? '#f59e0b' : ann.ann_type === 'trendline' ? '#3b82f6' : '#10b981')
            return (
              <div key={ann.id} className="flex items-center gap-1 text-[11px] py-1 border-b last:border-b-0">
                <span className="inline-block w-2.5 h-2.5 rounded-sm border border-slate-300" style={{ background: swatch }} />
                <span className="flex-1 truncate" title={desc}>{desc}</span>
                <span className="text-slate-400 text-[9px]">{ann.created_at?.slice(5) || ''}</span>
                <button
                  onClick={() => { onEdit(ann); setOpen(false) }}
                  className="text-blue-500 hover:text-blue-700 px-1"
                  title="編輯內容/顏色/大小"
                >✏️</button>
                <button
                  onClick={() => { onDelete(ann.id); setOpen(false) }}
                  className="text-rose-500 hover:text-rose-700 px-1"
                  title="刪除"
                ><Trash2 size={10} /></button>
              </div>
            )
          })}
          {annotations.length === 0 && <div className="text-[10px] text-slate-400 py-2 text-center">尚無標註</div>}
        </div>
      )}
    </div>
  )
}
