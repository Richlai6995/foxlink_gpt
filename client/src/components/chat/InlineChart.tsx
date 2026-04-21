/**
 * InlineChart — Chat 訊息內嵌的 ECharts 圖表
 *
 * Phase 1:純前端 render bar / line / pie,無資料 / spec 異常時 graceful fallback。
 * 刻意與 dashboard/AiChart.tsx 解耦(見 docs/chat-inline-chart-plan.md §2)
 *
 * 測試:import DEMO_SPECS 可視覺驗證三種圖型
 */
import { useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Download, AlertTriangle, ChevronDown, ChevronUp, BarChart3, LineChart, PieChart, AreaChart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InlineChartSpec, InlineChartType, UserChartParam } from '../../types'
import PinChartButton from './PinChartButton'

const CHART_FONT = "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', 'Segoe UI', Arial, sans-serif"

const PALETTE = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#f0d062',
]

const BASE_OPTION = {
  backgroundColor: 'transparent',
  textStyle: { color: '#374151', fontFamily: CHART_FONT, fontSize: 12 },
  tooltip: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    textStyle: { color: '#374151' },
  },
  legend: { textStyle: { color: '#6b7280', fontSize: 11 }, top: 0 },
  grid: { left: 48, right: 16, top: 36, bottom: 32, containLabel: true },
}

interface Props {
  spec: InlineChartSpec
  height?: number
  /** Phase 5:讓使用者把 chart 釘選到「我的圖庫」。預設開啟,setting=false 可關 */
  enablePin?: boolean
  /** Phase 5:tool 來源元資料,讓 user_charts.source_* 可填(由 ChatPage 注入) */
  pinSource?: {
    type?: 'mcp' | 'erp' | 'skill' | 'self_kb' | 'dify' | 'chat_freeform'
    tool?: string
    tool_version?: string
    schema_hash?: string
    prompt?: string
    params?: UserChartParam[]
    session_id?: string
    message_id?: number
  }
}

// 哪些 type 之間可以 local 切換(資料結構相容,不用 reprompt LLM)
// pie/bar/line/area 都吃 (x_field, y_fields[0..n].field) 的 row 資料,可互換
// scatter 需要兩個數值欄,heatmap 需要 3 維,排除
const SWITCHABLE_TYPES: InlineChartType[] = ['bar', 'line', 'area', 'pie']
const TYPE_ICONS: Record<string, React.ElementType> = {
  bar: BarChart3,
  line: LineChart,
  area: AreaChart,
  pie: PieChart,
}

type ChartState =
  | { kind: 'ok'; option: Record<string, unknown> }
  | { kind: 'empty' }
  | { kind: 'unsupported'; type: string }
  | { kind: 'error'; reason: string }

function buildOption(spec: InlineChartSpec): ChartState {
  const rows = spec.data
  if (!Array.isArray(rows) || rows.length === 0) return { kind: 'empty' }

  if (!spec.x_field || !Array.isArray(spec.y_fields) || spec.y_fields.length === 0) {
    return { kind: 'error', reason: 'missing x_field or y_fields' }
  }

  const xs = rows.map(r => r[spec.x_field] as string | number)
  const series = spec.y_fields.map((yf, i) => {
    const color = yf.color || PALETTE[i % PALETTE.length]
    const values = rows.map(r => {
      const v = r[yf.field]
      return typeof v === 'number' ? v : Number(v)
    })
    return { name: yf.name || yf.field, color, values }
  })

  const colors = series.map(s => s.color)

  const title = spec.title
    ? { title: { text: spec.title, left: 'center', textStyle: { fontSize: 13, fontWeight: 600 } } }
    : {}

  // 有 title 時下推 legend / grid
  const topOffset = spec.title ? 28 : 0
  const legend = { ...BASE_OPTION.legend, top: 24 + topOffset }
  const grid = { ...BASE_OPTION.grid, top: 56 + topOffset }

  // Phase 4:超過 30 點自動掛 dataZoom(slider 在底,inside 支援滾輪/拖曳)
  const needsZoom = rows.length > 30
  const dataZoom = needsZoom
    ? [
        { type: 'inside', start: 0, end: Math.min(100, Math.round((30 / rows.length) * 100)) },
        { type: 'slider', height: 18, bottom: 4, start: 0, end: Math.min(100, Math.round((30 / rows.length) * 100)) },
      ]
    : undefined
  const gridWithZoom = needsZoom ? { ...grid, bottom: 36 } : grid

  switch (spec.type) {
    case 'bar':
    case 'line':
    case 'area': {
      return {
        kind: 'ok',
        option: {
          ...BASE_OPTION,
          ...title,
          color: colors,
          legend,
          grid: gridWithZoom,
          dataZoom,
          xAxis: {
            type: 'category',
            data: xs,
            axisLabel: { color: '#6b7280', fontSize: 11 },
            axisLine: { lineStyle: { color: '#e5e7eb' } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: '#6b7280', fontSize: 11 },
            splitLine: { lineStyle: { color: '#f3f4f6' } },
          },
          tooltip: { ...BASE_OPTION.tooltip, trigger: 'axis' },
          series: series.map(s => ({
            name: s.name,
            type: spec.type === 'bar' ? 'bar' : 'line',
            data: s.values,
            smooth: spec.type === 'line',
            areaStyle: spec.type === 'area' ? { opacity: 0.25 } : undefined,
            itemStyle: { color: s.color, borderRadius: spec.type === 'bar' ? [4, 4, 0, 0] : undefined },
          })),
        },
      }
    }
    case 'pie': {
      const yf = spec.y_fields[0]
      const data = rows.map((r, i) => ({
        name: String(r[spec.x_field] ?? ''),
        value: Number(r[yf.field]) || 0,
        itemStyle: { color: PALETTE[i % PALETTE.length] },
      }))
      return {
        kind: 'ok',
        option: {
          ...BASE_OPTION,
          ...title,
          tooltip: { ...BASE_OPTION.tooltip, trigger: 'item' },
          legend: { ...legend, orient: 'vertical', left: 8, top: 'middle' },
          series: [{
            name: yf.name || yf.field,
            type: 'pie',
            radius: ['40%', '68%'],
            center: ['60%', '52%'],
            avoidLabelOverlap: true,
            label: { fontSize: 11 },
            data,
          }],
        },
      }
    }
    case 'scatter': {
      // x_field 為 X(數值或類別),y_fields[0..n].field 為 Y 數值;每組 y 一個 series
      // 若 x 是類別則 xAxis type=category,否則 type=value
      const xIsNumeric = xs.every(v => typeof v === 'number' || (!isNaN(Number(v)) && v !== ''))
      return {
        kind: 'ok',
        option: {
          ...BASE_OPTION,
          ...title,
          color: colors,
          legend,
          grid,
          xAxis: {
            type: xIsNumeric ? 'value' : 'category',
            data: xIsNumeric ? undefined : xs,
            axisLabel: { color: '#6b7280', fontSize: 11 },
            axisLine: { lineStyle: { color: '#e5e7eb' } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: '#6b7280', fontSize: 11 },
            splitLine: { lineStyle: { color: '#f3f4f6' } },
          },
          tooltip: { ...BASE_OPTION.tooltip, trigger: 'item' },
          series: series.map(s => ({
            name: s.name,
            type: 'scatter',
            symbolSize: 10,
            data: xIsNumeric
              ? rows.map(r => [Number(r[spec.x_field]), Number(r[spec.y_fields.find(yf => yf.field === s.name || yf.name === s.name)?.field || s.name])])
              : s.values,
            itemStyle: { color: s.color, opacity: 0.7 },
          })),
        },
      }
    }
    case 'heatmap': {
      // 需要 3 維資料:y_fields[0]=group(縱軸 category),y_fields[1]=value
      if (spec.y_fields.length < 2) return { kind: 'error', reason: 'heatmap 需要 2 個 y_fields(group + value)' }
      const groupField = spec.y_fields[0].field
      const valueField = spec.y_fields[1].field
      const ys = Array.from(new Set(rows.map(r => String(r[groupField] ?? ''))))
      const data = rows.map(r => [
        xs.indexOf(r[spec.x_field] as string | number),
        ys.indexOf(String(r[groupField] ?? '')),
        Number(r[valueField]) || 0,
      ])
      const values = data.map(d => d[2])
      const vMin = Math.min(...values, 0)
      const vMax = Math.max(...values, 1)
      return {
        kind: 'ok',
        option: {
          ...BASE_OPTION,
          ...title,
          tooltip: { ...BASE_OPTION.tooltip, position: 'top' },
          grid: { ...grid, height: '60%', top: 56 + topOffset },
          xAxis: { type: 'category', data: xs, axisLabel: { color: '#6b7280', fontSize: 11 }, splitArea: { show: true } },
          yAxis: { type: 'category', data: ys, axisLabel: { color: '#6b7280', fontSize: 11 }, splitArea: { show: true } },
          visualMap: {
            min: vMin, max: vMax, calculable: true, orient: 'horizontal',
            left: 'center', bottom: 4, textStyle: { fontSize: 10, color: '#6b7280' },
            inRange: { color: ['#e0f2fe', '#3b82f6', '#1e3a8a'] },
          },
          series: [{ name: spec.y_fields[1].name || valueField, type: 'heatmap', data, label: { show: false } }],
        },
      }
    }
    case 'radar': {
      // x_field 是 indicator name 欄,y_fields 各為一個 series
      // 自動算 max:每個 indicator 取所有 series 中該 indicator 的最大值 * 1.1
      const indicators = xs.map((label, i) => {
        const max = Math.max(...series.map(s => s.values[i] || 0)) * 1.1 || 100
        return { name: String(label), max }
      })
      return {
        kind: 'ok',
        option: {
          ...BASE_OPTION,
          ...title,
          color: colors,
          legend: { ...legend, top: 8 + topOffset },
          tooltip: { ...BASE_OPTION.tooltip, trigger: 'item' },
          radar: {
            indicator: indicators,
            center: ['50%', `${55 + (spec.title ? 5 : 0)}%`],
            radius: '60%',
            axisName: { color: '#6b7280', fontSize: 11 },
            splitLine: { lineStyle: { color: '#e5e7eb' } },
            splitArea: { areaStyle: { color: ['rgba(248,250,252,0.5)', 'rgba(241,245,249,0.5)'] } },
          },
          series: [{
            type: 'radar',
            data: series.map(s => ({
              name: s.name,
              value: s.values,
              itemStyle: { color: s.color },
              areaStyle: { color: s.color, opacity: 0.2 },
            })),
          }],
        },
      }
    }
    default:
      return { kind: 'unsupported', type: String((spec as { type?: string }).type || 'unknown') }
  }
}

export default function InlineChart({ spec, height = 320, enablePin = true, pinSource }: Props) {
  const { t } = useTranslation()
  const chartRef = useRef<ReactECharts>(null)
  const [showRawSpec, setShowRawSpec] = useState(false)
  // 本地圖型切換:不影響後端存的 spec,純 client 視覺切換
  const [overrideType, setOverrideType] = useState<InlineChartType | null>(null)

  const effectiveSpec = useMemo<InlineChartSpec>(
    () => (overrideType && overrideType !== spec.type ? { ...spec, type: overrideType } : spec),
    [spec, overrideType]
  )

  const state = useMemo(() => {
    try {
      return buildOption(effectiveSpec)
    } catch (e) {
      return { kind: 'error' as const, reason: e instanceof Error ? e.message : 'unknown' }
    }
  }, [effectiveSpec])

  // 切換選單只在 4 種互通 type 之間出現;原始 type 不在此清單就不顯示
  const switchable = SWITCHABLE_TYPES.includes(spec.type as InlineChartType)
  const currentType = (overrideType || spec.type) as InlineChartType

  const handleDownload = () => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
    const a = document.createElement('a')
    a.href = url
    a.download = (spec.title || 'chart') + '.png'
    a.click()
  }

  if (state.kind !== 'ok') {
    return (
      <div className="my-3 border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-800">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle size={14} />
          {state.kind === 'empty' && t('chart.inline.empty', '圖表暫無資料')}
          {state.kind === 'unsupported' && t('chart.inline.unsupported', '不支援的圖表類型:') + ' ' + state.type}
          {state.kind === 'error' && t('chart.inline.error', '圖表資料異常:') + ' ' + state.reason}
        </div>
        <button
          onClick={() => setShowRawSpec(v => !v)}
          className="mt-1 text-amber-700 hover:text-amber-900 flex items-center gap-1"
        >
          {showRawSpec ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {t('chart.inline.showRaw', '顯示原始 spec')}
        </button>
        {showRawSpec && (
          <pre className="mt-2 p-2 bg-white border border-amber-100 rounded text-[10px] overflow-auto max-h-40">
            {JSON.stringify(spec, null, 2)}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="my-3 border border-slate-200 bg-white rounded-lg overflow-hidden group/chart relative">
      <ReactECharts
        ref={chartRef}
        option={state.option}
        style={{ width: '100%', height }}
        notMerge
        lazyUpdate
      />
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/chart:opacity-100 transition flex items-center gap-1">
        {switchable && (
          <div className="flex items-center bg-white/90 border border-slate-200 rounded p-0.5 gap-0.5">
            {SWITCHABLE_TYPES.map((tp) => {
              const Icon = TYPE_ICONS[tp]
              const active = currentType === tp
              return (
                <button
                  key={tp}
                  onClick={() => setOverrideType(tp === spec.type ? null : tp)}
                  title={t(`chart.inline.switchTo.${tp}`, tp)}
                  className={`p-1 rounded transition ${
                    active
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={12} />
                </button>
              )
            })}
          </div>
        )}
        {enablePin && <PinChartButton spec={spec} source={pinSource} />}
        <button
          onClick={handleDownload}
          title={t('chart.inline.downloadPng', '下載 PNG')}
          className="p-1.5 rounded bg-white/90 border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-white"
        >
          <Download size={13} />
        </button>
      </div>
    </div>
  )
}

// ───────────────────────── Demo specs(Phase 1 視覺驗證用) ─────────────────────────
export const DEMO_SPECS: InlineChartSpec[] = [
  {
    type: 'bar',
    title: '2026 Q1 各廠區產量',
    x_field: 'site',
    y_fields: [{ field: 'output', name: '產量(千台)', color: '#5470c6' }],
    data: [
      { site: '龜山', output: 12.5 },
      { site: '林口', output: 9.8 },
      { site: '平鎮', output: 14.2 },
      { site: '昆山', output: 18.6 },
      { site: '越南', output: 7.3 },
    ],
  },
  {
    type: 'line',
    title: '近 6 個月訂單趨勢',
    x_field: 'month',
    y_fields: [
      { field: 'orders', name: '訂單數' },
      { field: 'returns', name: '退貨數' },
    ],
    data: [
      { month: '2025-11', orders: 820, returns: 32 },
      { month: '2025-12', orders: 932, returns: 41 },
      { month: '2026-01', orders: 901, returns: 38 },
      { month: '2026-02', orders: 1034, returns: 45 },
      { month: '2026-03', orders: 1190, returns: 52 },
      { month: '2026-04', orders: 1260, returns: 48 },
    ],
  },
  {
    type: 'pie',
    title: '產品類別佔比',
    x_field: 'category',
    y_fields: [{ field: 'share' }],
    data: [
      { category: '連接器', share: 42 },
      { category: '線材', share: 28 },
      { category: '模組', share: 18 },
      { category: '天線', share: 8 },
      { category: '其他', share: 4 },
    ],
  },
]
