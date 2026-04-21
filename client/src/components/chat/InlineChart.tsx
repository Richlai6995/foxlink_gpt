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
import { Download, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InlineChartSpec } from '../../types'

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
          grid,
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
    case 'scatter':
    case 'heatmap':
      return { kind: 'unsupported', type: spec.type }
    default:
      return { kind: 'unsupported', type: String((spec as { type?: string }).type || 'unknown') }
  }
}

export default function InlineChart({ spec, height = 320 }: Props) {
  const { t } = useTranslation()
  const chartRef = useRef<ReactECharts>(null)
  const [showRawSpec, setShowRawSpec] = useState(false)

  const state = useMemo(() => {
    try {
      return buildOption(spec)
    } catch (e) {
      return { kind: 'error' as const, reason: e instanceof Error ? e.message : 'unknown' }
    }
  }, [spec])

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
      <button
        onClick={handleDownload}
        title={t('chart.inline.downloadPng', '下載 PNG')}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover/chart:opacity-100 transition p-1.5 rounded bg-white/90 border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-white"
      >
        <Download size={13} />
      </button>
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
