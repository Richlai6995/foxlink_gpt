/**
 * InlineChart — Chat 訊息內嵌的 ECharts 圖表
 *
 * Phase 1:bar / line / pie + graceful fallback,解耦 dashboard/AiChart.tsx
 * Phase 4 :scatter / heatmap / radar / dataZoom
 * Phase 5 :PinChartButton(釘選至圖庫)+ PPTX 匯出
 * Phase 4c:ChartStyle 套用(palette / 字級 / 圖例 / 格線 / 數字格式 / dark mode / perType)
 *           側邊 Settings panel 即時調樣式,可「另存為模板」/「設為我的預設」
 *           套用優先序:spec.style > user default template > hardcoded
 */
import { useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  Download, AlertTriangle, ChevronDown, ChevronUp,
  BarChart3, LineChart, PieChart, AreaChart, FileText,
  Settings, Save, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InlineChartSpec, InlineChartType, ChartStyle, UserChartParam } from '../../types'
import PinChartButton from './PinChartButton'
import ChartStyleEditor from '../chart/ChartStyleEditor'
import { useChartStyleTemplates } from '../../hooks/useChartStyleTemplates'
import { exportChartsToPptx, getChartPngFromEcharts } from '../../lib/chartExport'
import {
  mergeChartStyle, getPaletteColors, resolveThemeColors,
  resolveLegendPlacement, makeValueFormatter, getPerTypeStyle,
  autoAxisLabel, makeAxisLabelTruncator,
  HARDCODED_STYLE, SWITCHABLE_TYPES,
} from '../../lib/chartStyle'

const CHART_FONT = "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', 'Segoe UI', Arial, sans-serif"

interface Props {
  spec: InlineChartSpec
  height?: number
  /** Phase 5:讓使用者把 chart 釘選到「我的圖庫」。預設開啟,setting=false 可關 */
  enablePin?: boolean
  /** Phase 4c:用於樣式模板編輯器預覽 — 隱藏整個工具列(⚙ / PPTX / PNG / 圖型切換),chart 純展示 */
  hideToolbar?: boolean
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

// ─────────────────────────────────────────────────────────────────────────────
// buildOption — spec + 最終 style → ECharts option
// ─────────────────────────────────────────────────────────────────────────────
function buildOption(spec: InlineChartSpec, style: ChartStyle): ChartState {
  const rows = spec.data
  if (!Array.isArray(rows) || rows.length === 0) return { kind: 'empty' }

  if (!spec.x_field || !Array.isArray(spec.y_fields) || spec.y_fields.length === 0) {
    return { kind: 'error', reason: 'missing x_field or y_fields' }
  }

  const theme = resolveThemeColors(style)
  const colors = getPaletteColors(style, spec.type)
  const fmtValue = makeValueFormatter(style)

  const xs = rows.map(r => r[spec.x_field] as string | number)
  const series = spec.y_fields.map((yf, i) => {
    const color = yf.color || colors[i % colors.length]
    const values = rows.map(r => {
      const v = r[yf.field]
      return typeof v === 'number' ? v : Number(v)
    })
    return { name: yf.name || yf.field, color, values }
  })

  const titleSize = style.common?.title_size ?? HARDCODED_STYLE.common.title_size!
  const axisSize = style.common?.axis_label_size ?? HARDCODED_STYLE.common.axis_label_size!
  const showGrid = style.common?.show_grid ?? true

  const titleOpt = spec.title
    ? { title: { text: spec.title, left: 'center', textStyle: { fontSize: titleSize, fontWeight: 600, color: theme.text } } }
    : {}
  const titleHeight = spec.title ? Math.round(titleSize * 2) : 0
  const legend = resolveLegendPlacement(style, theme, titleHeight)
  const gridTop = titleHeight + ((style.common?.legend_position ?? 'top') === 'top' ? 28 : 8)

  const baseOption: Record<string, unknown> = {
    backgroundColor: theme.bg,
    textStyle: { color: theme.text, fontFamily: CHART_FONT, fontSize: 12 },
    tooltip: {
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.text },
    },
  }

  // X 軸標籤:auto 旋轉 + 全顯 + 截斷,解決長料號 / 多類別被 ECharts 吃掉的問題
  const userRotate = style.common?.axis_label_rotate
  const autoLabel = autoAxisLabel(xs)
  const xAxisRotate = userRotate === undefined || userRotate === 'auto'
    ? autoLabel.rotate
    : userRotate
  const xAxisInterval = (userRotate === undefined || userRotate === 'auto')
    ? autoLabel.interval
    : (userRotate === 0 ? 'auto' : 0)
  const maxChars = style.common?.axis_label_max_chars ?? 0
  const truncator = makeAxisLabelTruncator(maxChars)
  const xLabelExtraBottom = xAxisRotate === 0 ? 0 : Math.max(autoLabel.extraGridBottom, xAxisRotate >= 45 ? 36 : 20)

  const axisLabelStyle = { color: theme.subtext, fontSize: axisSize }
  const xAxisLabelStyle: Record<string, unknown> = {
    ...axisLabelStyle,
    rotate: xAxisRotate,
    interval: xAxisInterval,
    hideOverlap: true,
    ...(truncator ? { formatter: truncator } : {}),
  }
  const splitLineStyle = showGrid ? { lineStyle: { color: theme.grid } } : { show: false }
  const xAxisLine = { lineStyle: { color: theme.axisLine } }

  // dataZoom:rows > 30 自動掛(跟 Phase 4 一致)
  const needsZoom = rows.length > 30
  const dataZoom = needsZoom
    ? [
        { type: 'inside', start: 0, end: Math.min(100, Math.round((30 / rows.length) * 100)) },
        { type: 'slider', height: 18, bottom: 4, start: 0, end: Math.min(100, Math.round((30 / rows.length) * 100)) },
      ]
    : undefined
  const grid = {
    left: 48, right: 16, top: gridTop,
    // 32 是基底,needsZoom 再多 4 讓 slider 有空間,旋轉 label 再加 extraBottom
    bottom: (needsZoom ? 36 : 32) + xLabelExtraBottom,
    containLabel: true,
  }

  switch (spec.type) {
    case 'bar':
    case 'line':
    case 'area': {
      const barStyle = getPerTypeStyle(style, 'bar')
      const lineStyle = getPerTypeStyle(style, 'line')
      const areaStyle = getPerTypeStyle(style, 'area')

      // Bar 每支獨立色:單系列時可覆寫 series 整體 color,改用 data item 級
      const barMultiColor = spec.type === 'bar'
        && barStyle.single_series_multi_color === true
        && series.length === 1

      const customBarColors = Array.isArray(barStyle.custom_bar_colors) ? barStyle.custom_bar_colors.filter(Boolean) : []
      const resolveBarColor = (idx: number): string => {
        if (customBarColors.length > 0) return customBarColors[idx % customBarColors.length]
        return colors[idx % colors.length]
      }

      // Bar 動畫設定 → ECharts series.animation*
      const animStyle = barStyle.animation_style ?? 'grow'
      const animStagger = barStyle.animation_stagger === true
      const animMap: Record<string, { duration: number; easing: string }> = {
        none:   { duration: 0,    easing: 'linear' },
        grow:   { duration: 800,  easing: 'cubicOut' },
        fade:   { duration: 600,  easing: 'linear' },
        bounce: { duration: 1200, easing: 'elasticOut' },
      }
      const anim = animMap[animStyle] || animMap.grow

      // Bar 陰影 / 透明
      const barShadow = barStyle.shadow === true
      const barOpacity = typeof barStyle.opacity === 'number' ? barStyle.opacity : 1
      const borderRadius = barStyle.border_radius ?? 4

      const barItemStyleBase = (seriesColor: string) => ({
        color: seriesColor,
        opacity: barOpacity,
        borderRadius: [borderRadius, borderRadius, 0, 0] as [number, number, number, number],
        ...(barShadow ? {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.25)',
          shadowOffsetX: 0,
          shadowOffsetY: 3,
        } : {}),
      })

      return {
        kind: 'ok',
        option: {
          ...baseOption,
          ...titleOpt,
          color: barMultiColor && customBarColors.length === 0 ? undefined : colors,
          legend,
          grid,
          dataZoom,
          xAxis: { type: 'category', data: xs, axisLabel: xAxisLabelStyle, axisLine: xAxisLine },
          yAxis: { type: 'value', axisLabel: { ...axisLabelStyle, formatter: fmtValue }, splitLine: splitLineStyle },
          tooltip: { ...(baseOption.tooltip as object), trigger: 'axis', valueFormatter: fmtValue },
          series: series.map((s, seriesIdx) => {
            const baseSeries: Record<string, unknown> = {
              name: s.name,
              type: spec.type === 'bar' ? 'bar' : 'line',
              smooth: spec.type === 'line' ? lineStyle.smooth : (spec.type === 'area' ? areaStyle.smooth : false),
              lineStyle: spec.type !== 'bar' ? { width: lineStyle.line_width ?? 2 } : undefined,
              areaStyle: spec.type === 'area' ? { opacity: areaStyle.opacity ?? 0.25 } : undefined,
            }

            if (spec.type === 'bar') {
              Object.assign(baseSeries, {
                animationDuration: anim.duration,
                animationEasing: anim.easing,
                ...(animStagger && anim.duration > 0
                  ? { animationDelay: (idx: number) => idx * 60 }
                  : {}),
              })

              // Bar:單系列 + multi-color → 每個 data item 帶自己的 color
              if (barMultiColor || customBarColors.length > 0) {
                baseSeries.data = s.values.map((v, i) => ({
                  value: v,
                  itemStyle: barItemStyleBase(resolveBarColor(i)),
                }))
              } else {
                baseSeries.data = s.values
                baseSeries.itemStyle = barItemStyleBase(s.color)
              }
              // Bar fade 動畫:另外補 opacity 0→1(透過 animation 自然帶)
              if (animStyle === 'fade' && anim.duration > 0) {
                baseSeries.animation = true
              }
            } else {
              // line / area
              baseSeries.data = s.values
              baseSeries.itemStyle = { color: s.color }
            }

            return baseSeries
          }),
        },
      }
    }
    case 'pie': {
      const pieStyle = getPerTypeStyle(style, 'pie')
      const inner = pieStyle.doughnut ? (pieStyle.radius_inner ?? 40) : 0
      const outer = pieStyle.radius_outer ?? 68
      const yf = spec.y_fields[0]
      const data = rows.map((r, i) => ({
        name: String(r[spec.x_field] ?? ''),
        value: Number(r[yf.field]) || 0,
        itemStyle: { color: colors[i % colors.length] },
      }))
      return {
        kind: 'ok',
        option: {
          ...baseOption,
          ...titleOpt,
          tooltip: { ...(baseOption.tooltip as object), trigger: 'item', valueFormatter: fmtValue },
          legend: legend
            ? (style.common?.legend_position === 'right' || style.common?.legend_position === 'left'
              ? legend
              : { ...legend, orient: 'vertical', left: 8, top: 'middle' })
            : undefined,
          series: [{
            name: yf.name || yf.field,
            type: 'pie',
            radius: [`${inner}%`, `${outer}%`],
            center: ['60%', '52%'],
            avoidLabelOverlap: true,
            label: { fontSize: axisSize, color: theme.text },
            data,
          }],
        },
      }
    }
    case 'scatter': {
      const scatterStyle = getPerTypeStyle(style, 'scatter')
      const xIsNumeric = xs.every(v => typeof v === 'number' || (!isNaN(Number(v)) && v !== ''))
      return {
        kind: 'ok',
        option: {
          ...baseOption,
          ...titleOpt,
          color: colors,
          legend,
          grid,
          xAxis: {
            type: xIsNumeric ? 'value' : 'category',
            data: xIsNumeric ? undefined : xs,
            axisLabel: xIsNumeric ? { ...axisLabelStyle, formatter: fmtValue } : xAxisLabelStyle,
            axisLine: xAxisLine,
          },
          yAxis: { type: 'value', axisLabel: { ...axisLabelStyle, formatter: fmtValue }, splitLine: splitLineStyle },
          tooltip: { ...(baseOption.tooltip as object), trigger: 'item', valueFormatter: fmtValue },
          series: series.map(s => ({
            name: s.name,
            type: 'scatter',
            symbolSize: scatterStyle.symbol_size ?? 10,
            data: xIsNumeric
              ? rows.map(r => [
                  Number(r[spec.x_field]),
                  Number(r[spec.y_fields.find(yf => yf.field === s.name || yf.name === s.name)?.field || s.name]),
                ])
              : s.values,
            itemStyle: { color: s.color, opacity: 0.7 },
          })),
        },
      }
    }
    case 'heatmap': {
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
          ...baseOption,
          ...titleOpt,
          tooltip: { ...(baseOption.tooltip as object), position: 'top', valueFormatter: fmtValue },
          grid: { ...grid, height: '60%', top: gridTop + 8 },
          xAxis: { type: 'category', data: xs, axisLabel: xAxisLabelStyle, splitArea: { show: true } },
          yAxis: { type: 'category', data: ys, axisLabel: axisLabelStyle, splitArea: { show: true } },
          visualMap: {
            min: vMin, max: vMax, calculable: true, orient: 'horizontal',
            left: 'center', bottom: 4, textStyle: { fontSize: 10, color: theme.subtext },
            inRange: { color: ['#e0f2fe', '#3b82f6', '#1e3a8a'] },
          },
          series: [{ name: spec.y_fields[1].name || valueField, type: 'heatmap', data, label: { show: false } }],
        },
      }
    }
    case 'radar': {
      const indicators = xs.map((label, i) => {
        const max = Math.max(...series.map(s => s.values[i] || 0)) * 1.1 || 100
        return { name: String(label), max }
      })
      return {
        kind: 'ok',
        option: {
          ...baseOption,
          ...titleOpt,
          color: colors,
          legend: legend ? { ...legend, top: 8 + titleHeight } : undefined,
          tooltip: { ...(baseOption.tooltip as object), trigger: 'item', valueFormatter: fmtValue },
          radar: {
            indicator: indicators,
            center: ['50%', `${55 + (spec.title ? 5 : 0)}%`],
            radius: '60%',
            axisName: { color: theme.subtext, fontSize: axisSize },
            splitLine: { lineStyle: { color: theme.axisLine } },
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

export default function InlineChart({ spec, height = 320, enablePin = true, hideToolbar = false, pinSource }: Props) {
  const { t } = useTranslation()
  const chartRef = useRef<ReactECharts>(null)
  const [showRawSpec, setShowRawSpec] = useState(false)
  const [overrideType, setOverrideType] = useState<InlineChartType | null>(null)
  const [stylePanelOpen, setStylePanelOpen] = useState(false)
  // style override:spec.style > 使用者在 panel 改的 > default
  const [styleOverride, setStyleOverride] = useState<ChartStyle | null>(null)
  const [saveTmplOpen, setSaveTmplOpen] = useState(false)
  const [saveTmplName, setSaveTmplName] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)

  const { activeDefaultFor, mine, system, createTemplate, setDefault } = useChartStyleTemplates()

  const effectiveSpec = useMemo<InlineChartSpec>(
    () => (overrideType && overrideType !== spec.type ? { ...spec, type: overrideType } : spec),
    [spec, overrideType]
  )

  // 最終 style:activeDefaultFor(effectiveSpec.type) < spec.style < styleOverride
  // 切換圖型時 activeDefaultFor 會拿到該 type 的 default 模板 → 樣式自動跟著換
  const finalStyle = useMemo<ChartStyle>(() => {
    let s: ChartStyle = activeDefaultFor(effectiveSpec.type)
    if (spec.style) s = mergeChartStyle(s, spec.style)
    if (styleOverride) s = mergeChartStyle(s, styleOverride)
    return s
  }, [activeDefaultFor, effectiveSpec.type, spec.style, styleOverride])

  const state = useMemo(() => {
    try {
      return buildOption(effectiveSpec, finalStyle)
    } catch (e) {
      return { kind: 'error' as const, reason: e instanceof Error ? e.message : 'unknown' }
    }
  }, [effectiveSpec, finalStyle])

  const switchable = SWITCHABLE_TYPES.includes(spec.type as InlineChartType)
  const currentType = (overrideType || spec.type) as InlineChartType

  // 把 styleOverride(僅在 panel 編過才非 null)拼回 spec,供釘選 / 匯出
  const specWithStyle: InlineChartSpec = useMemo(
    () => (styleOverride ? { ...spec, style: mergeChartStyle(spec.style, styleOverride) } : spec),
    [spec, styleOverride]
  )

  const handleDownload = () => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const bgColor = finalStyle.common?.background === 'dark' ? '#1e293b' : '#ffffff'
    const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: bgColor })
    const a = document.createElement('a')
    a.href = url
    a.download = (spec.title || 'chart') + '.png'
    a.click()
  }

  const handleExportPptx = async () => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    try {
      const pngDataUrl = getChartPngFromEcharts(inst)
      await exportChartsToPptx([{
        title: spec.title || t('chart.inline.defaultTitle', '圖表'),
        pngDataUrl,
        spec: specWithStyle,
      }], (spec.title || 'chart') + '.pptx')
    } catch (e) {
      console.error('[InlineChart] pptx export failed:', e)
      alert(t('chart.inline.pptxFailed', 'PPTX 匯出失敗:') + (e instanceof Error ? e.message : 'unknown'))
    }
  }

  const handleApplyTemplate = (tmplId: number) => {
    const tmpl = [...mine, ...system].find(x => x.id === tmplId)
    if (!tmpl) return
    const s = typeof tmpl.style_json === 'string' ? JSON.parse(tmpl.style_json) : tmpl.style_json
    setStyleOverride(s)
  }

  const handleSaveAsTemplate = async () => {
    if (!saveTmplName.trim()) return
    setSaveBusy(true)
    try {
      const currentStyle = mergeChartStyle(activeDefaultFor(effectiveSpec.type), mergeChartStyle(spec.style, styleOverride || undefined))
      await createTemplate(saveTmplName.trim(), currentStyle)
      setSaveTmplOpen(false)
      setSaveTmplName('')
    } catch (e: any) {
      alert(t('chart.style.saveFailed', '儲存模板失敗:') + (e?.message || 'unknown'))
    } finally {
      setSaveBusy(false)
    }
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

  const isDark = finalStyle.common?.background === 'dark'

  return (
    <div className="my-3 relative flex gap-2">
      {/* Chart */}
      <div
        className={`flex-1 border rounded-lg overflow-hidden group/chart relative transition ${
          isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'
        }`}
      >
        <ReactECharts
          ref={chartRef}
          option={state.option}
          style={{ width: '100%', height }}
          notMerge
          lazyUpdate
        />
        {!hideToolbar && (
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/chart:opacity-100 transition flex items-center gap-1">
          {switchable && (
            <div className={`flex items-center border rounded p-0.5 gap-0.5 ${isDark ? 'bg-slate-800/90 border-slate-700' : 'bg-white/90 border-slate-200'}`}>
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
                        : isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={12} />
                  </button>
                )
              })}
            </div>
          )}
          <button
            onClick={() => setStylePanelOpen(v => !v)}
            title={t('chart.inline.styleEditor', '樣式設定')}
            className={`p-1.5 rounded border transition ${
              stylePanelOpen
                ? 'bg-sky-50 border-sky-300 text-sky-700'
                : isDark
                  ? 'bg-slate-800/90 border-slate-700 text-slate-300 hover:text-sky-400'
                  : 'bg-white/90 border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-white'
            }`}
          >
            <Settings size={13} />
          </button>
          {enablePin && <PinChartButton spec={specWithStyle} source={pinSource} />}
          <button
            onClick={handleExportPptx}
            title={t('chart.inline.exportPptx', '匯出 PPTX')}
            className={`p-1.5 rounded border transition ${
              isDark ? 'bg-slate-800/90 border-slate-700 text-slate-300 hover:text-orange-400' : 'bg-white/90 border-slate-200 text-slate-500 hover:text-orange-600 hover:bg-white'
            }`}
          >
            <FileText size={13} />
          </button>
          <button
            onClick={handleDownload}
            title={t('chart.inline.downloadPng', '下載 PNG')}
            className={`p-1.5 rounded border transition ${
              isDark ? 'bg-slate-800/90 border-slate-700 text-slate-300 hover:text-white' : 'bg-white/90 border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-white'
            }`}
          >
            <Download size={13} />
          </button>
        </div>
        )}
      </div>

      {/* Style Panel(右側彈出) */}
      {!hideToolbar && stylePanelOpen && (
        <div className="w-72 border border-slate-200 bg-white rounded-lg p-3 shadow-lg flex-shrink-0 max-h-[480px] overflow-y-auto">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
            <div className="text-xs font-semibold text-slate-700">{t('chart.style.title', '樣式設定')}</div>
            <button onClick={() => setStylePanelOpen(false)} className="text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          </div>

          {/* 套用模板 dropdown */}
          {(mine.length > 0 || system.length > 0) && (
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                {t('chart.style.applyTemplate', '套用模板')}
              </div>
              <select
                onChange={e => {
                  const id = Number(e.target.value)
                  if (id > 0) handleApplyTemplate(id)
                }}
                defaultValue=""
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs bg-white"
              >
                <option value="">— {t('chart.style.chooseTemplate', '選一個模板')} —</option>
                {mine.length > 0 && (
                  <optgroup label={t('chart.style.mineGroup', '我的')}>
                    {mine.map(tmpl => (
                      <option key={tmpl.id} value={tmpl.id}>
                        {tmpl.name}{tmpl.is_default === 1 ? ' ★' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {system.length > 0 && (
                  <optgroup label={t('chart.style.systemGroup', '系統')}>
                    {system.map(tmpl => (
                      <option key={tmpl.id} value={tmpl.id}>{tmpl.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {/* 樣式編輯 */}
          <ChartStyleEditor
            value={finalStyle}
            onChange={(next) => setStyleOverride(next)}
            compact
          />

          {/* 底部:另存為模板 */}
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
            {!saveTmplOpen ? (
              <>
                <button
                  onClick={() => setSaveTmplOpen(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-sky-700 bg-sky-50 hover:bg-sky-100 rounded border border-sky-200"
                >
                  <Save size={12} /> {t('chart.style.saveAsTemplate', '另存為模板')}
                </button>
                {styleOverride && (
                  <button
                    onClick={() => setStyleOverride(null)}
                    className="w-full text-xs text-slate-500 hover:text-slate-700 py-1"
                  >
                    {t('chart.style.reset', '重設為預設')}
                  </button>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <input
                  value={saveTmplName}
                  onChange={e => setSaveTmplName(e.target.value)}
                  placeholder={t('chart.style.templateName', '模板名稱')}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                  autoFocus
                />
                <div className="flex gap-1">
                  <button
                    onClick={handleSaveAsTemplate}
                    disabled={saveBusy || !saveTmplName.trim()}
                    className="flex-1 text-xs bg-sky-600 text-white rounded px-2 py-1 hover:bg-sky-700 disabled:opacity-50"
                  >
                    {saveBusy ? t('common.saving', '儲存中...') : t('common.save', '儲存')}
                  </button>
                  <button
                    onClick={() => { setSaveTmplOpen(false); setSaveTmplName('') }}
                    className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-50"
                  >
                    {t('common.cancel', '取消')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
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
