/**
 * AiChart — ECharts wrapper with configurable palette
 * Supports: bar, line, pie, scatter, radar, gauge
 */
import ReactECharts from 'echarts-for-react'
import { useRef } from 'react'
import type { AiChartDef, ChartColorPalette, YAxisDef, OverlayLine } from '../../types'
import { useTranslation } from 'react-i18next'

// Named palettes
const PALETTES: Record<ChartColorPalette, string[]> = {
  blue:   ['#118DFF', '#0093D5', '#12239E', '#005FB0', '#1B6EC2', '#00B7C3'],
  green:  ['#009E49', '#00B294', '#10893E', '#499900', '#00CC6A', '#38B000'],
  orange: ['#E66C37', '#D9B300', '#F5B300', '#D64550', '#E044A7', '#FF6B35'],
  purple: ['#744EC2', '#6B007B', '#8764B8', '#B4009E', '#C239B3', '#9B59B6'],
  teal:   ['#0099BC', '#038387', '#00B4D8', '#0096C7', '#00B7C3', '#48CAE4'],
}

// 高對比多色調色盤（預設）— 相鄰顏色色相差 >60°，避免相近
const DEFAULT_COLORS = [
  '#5470c6', // 藍
  '#91cc75', // 綠
  '#fac858', // 黃
  '#ee6666', // 紅
  '#73c0de', // 淺藍
  '#3ba272', // 深綠
  '#fc8452', // 橘
  '#9a60b4', // 紫
  '#ea7ccc', // 粉
  '#f0d062', // 金黃
]

function getColors(chartDef: AiChartDef): string[] {
  if (chartDef.colors?.length) return chartDef.colors
  if (chartDef.color_palette) return PALETTES[chartDef.color_palette] || DEFAULT_COLORS
  return DEFAULT_COLORS
}

interface Props {
  chartDef: AiChartDef
  rows: Record<string, unknown>[]
  columnLabels?: Record<string, string>
  height?: number | string   // 預設 320，傳 undefined 使用 '100%'
}

/** 解析 chart config 欄位名稱 → 實際 row 值
 *  支援: 直接匹配 / lowercase / 去掉表別名前綴 / column_labels reverse lookup / 前綴模糊比對 */
function resolveField(
  field: string | undefined,
  row: Record<string, unknown>,
  columnLabels: Record<string, string> = {}
): unknown {
  if (!field) return undefined
  if (field in row) return row[field]
  const lower = field.toLowerCase()
  if (lower in row) return row[lower]
  const bare = lower.replace(/^[a-z0-9_]+\./, '')
  if (bare in row) return row[bare]
  const desc = columnLabels[bare]
  if (desc) {
    if (desc in row) return row[desc]
    const descLower = desc.toLowerCase()
    if (descLower in row) return row[descLower]
  }
  const keys = Object.keys(row)
  const found = keys.find(k => k.toLowerCase() === bare)
  if (found) return row[found]
  // 模糊比對：row key 是 field 的前綴，或 field 是 row key 的前綴（欄位名稱改版容錯）
  const fuzzy = keys.find(k => {
    const kl = k.toLowerCase()
    return bare.startsWith(kl) || kl.startsWith(bare)
  })
  if (fuzzy) return row[fuzzy]
  return undefined
}

function mkGradient(color: string) {
  return {
    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [
      { offset: 0, color },
      { offset: 1, color: color + '30' },
    ],
  }
}

const BASE_OPTION = {
  backgroundColor: 'transparent',
  textStyle: { color: '#374151', fontFamily: 'inherit' },
  tooltip: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    textStyle: { color: '#374151' },
    trigger: 'axis',
  },
  legend: { textStyle: { color: '#6b7280' } },
  grid: { left: 60, right: 20, top: 40, bottom: 40, containLabel: true },
}

/** 依 sort_by / sort_order 排序 rows（不修改原陣列） */
function sortRows(
  rows: Record<string, unknown>[],
  sortBy: 'none' | 'x' | 'y' | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
  xField: string | undefined,
  yField: string | undefined,
  rf: (f: string | undefined, r: Record<string, unknown>) => unknown
): Record<string, unknown>[] {
  if (!sortBy || sortBy === 'none') return rows
  const dir = sortOrder === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (sortBy === 'y') {
      const av = Number(rf(yField, a) ?? 0)
      const bv = Number(rf(yField, b) ?? 0)
      return (av - bv) * dir
    }
    // sort_by === 'x': string-aware, handles YYYYMM / YYYY-MM-DD / plain text
    const ax = String(rf(xField, a) ?? '')
    const bx = String(rf(xField, b) ?? '')
    // numeric-prefixed strings (e.g. 202601 > 202512) → numeric compare
    const an = Number(ax), bn = Number(bx)
    if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir
    return ax.localeCompare(bx, 'zh-TW') * dir
  })
}

export default function AiChart({ chartDef, rows, columnLabels = {}, height = 320 }: Props) {
  const { i18n } = useTranslation()
  const lang = i18n.language
  const chartRef = useRef<ReactECharts>(null)

  const pickLang = (zh: string | undefined, en: string | undefined, vi: string | undefined) => {
    if (lang === 'en' && en) return en
    if (lang === 'vi' && vi) return vi
    return zh
  }

  const {
    type, x_field, y_field, label_field, value_field,
    horizontal, smooth, area, gradient, donut, show_label,
    show_legend, show_grid,
    sort_by, sort_order, min_value, limit,
    series_field, stack_field, agg_fn,
    y_axes, shadow, overlay_lines,
    series_colors,
    axis_label_color, axis_label_size, axis_label_bold,
    axis_line_color, data_label_color, data_label_size, data_label_bold,
    legend_color, legend_size, legend_bold, title_color, title_size, title_bold,
    title_left, title_top, legend_left, legend_top, legend_orient,
    grid_line_color,
  } = chartDef

  // ── 樣式變數（有設定優先，否則用預設值）──────────────────────────────────────
  const sAxisLabel   = axis_label_color  || '#6b7280'
  const sAxisLabelSz = axis_label_size   || 11
  const sAxisLabelW  = axis_label_bold   ? 'bold' : 'normal'
  const sAxisLine    = axis_line_color   || '#e5e7eb'
  const sDataLabel   = data_label_color  || '#6b7280'
  const sDataLabelSz = data_label_size   || 11
  const sDataLabelW  = data_label_bold   ? 'bold' : 'normal'
  const sLegend      = legend_color      || '#6b7280'
  const sLegendSz    = legend_size       || 12
  const sLegendW     = legend_bold       ? 'bold' : 'normal'
  const sTitle       = title_color       || '#374151'
  const sTitleSz     = title_size        || 13
  const sTitleW      = title_bold        ? 'bold' : 'normal'
  const sGridLine   = grid_line_color   || (show_grid !== false ? '#f3f4f6' : 'transparent')

  // 解析 series_colors：若是 JSON string 就 parse，否則直接用
  const seriesColorMap: Record<string, string> = (() => {
    if (!series_colors) return {}
    if (typeof series_colors === 'string') { try { return JSON.parse(series_colors) } catch { return {} } }
    return series_colors
  })()

  const title = pickLang(chartDef.title, chartDef.title_en, chartDef.title_vi)
  const x_axis_name = pickLang(chartDef.x_axis_name, chartDef.x_axis_name_en, chartDef.x_axis_name_vi)
  const y_axis_name = pickLang(chartDef.y_axis_name, chartDef.y_axis_name_en, chartDef.y_axis_name_vi)

  const colors = getColors(chartDef)
  const primaryColor = colors[0]

  const rf = (field: string | undefined, row: Record<string, unknown>) =>
    resolveField(field, row, columnLabels)

  const sortedRows = sortRows(rows, sort_by, sort_order, x_field, y_field, rf)

  // Display-time filters (applied after sorting)
  // min_value 使用嚴格大於（> min_value），設為 0 可排除零值
  const filteredRows = (min_value !== undefined && min_value !== null)
    ? sortedRows.filter(r => {
        const field = type === 'pie' ? value_field : y_field
        return Number(rf(field, r) ?? 0) > (min_value as number)
      })
    : sortedRows

  // Apply display limit:
  // - pie: sort by value desc then take top-N
  // - bar/line/scatter: slice first N (order already from sortedRows)
  const displayRows = (() => {
    if (type === 'pie' && limit && limit > 0 && filteredRows.length > limit) {
      return [...filteredRows]
        .sort((a, b) => Number(rf(value_field, b) ?? 0) - Number(rf(value_field, a) ?? 0))
        .slice(0, limit)
    }
    if (type !== 'pie' && type !== 'gauge' && limit && limit > 0 && filteredRows.length > limit) {
      return filteredRows.slice(0, limit)
    }
    return filteredRows
  })()

  // 圖例：位置由使用者設定，預設在標題下方或頂端
  const defaultLegendTop = title ? 28 : 4
  const legendConfig = show_legend !== false
    ? {
        show: true,
        textStyle: { color: sLegend, fontSize: sLegendSz, fontWeight: sLegendW },
        orient: legend_orient || 'horizontal',
        left:  legend_left  ?? 'center',
        top:   legend_top   ?? defaultLegendTop,
      }
    : { show: false }

  // grid top：若圖例/標題都在頂端則留空間，若圖例移到底部/左右就不需要
  const legendAtTop = show_legend !== false && (!legend_top || legend_top === 'top' || Number(legend_top) < 80)
  const titleAtTop  = !!title && (!title_top || title_top === 'top' || Number(title_top) < 40)
  const gridTop = (titleAtTop && legendAtTop) ? 60 : titleAtTop ? 40 : legendAtTop ? 36 : 20

  const gridConfig = {
    left: 60, right: 20,
    top: gridTop,
    bottom: 40,
    containLabel: true,
    show: show_grid,
    borderColor: sGridLine,
  }

  const splitLineStyle = { lineStyle: { color: sGridLine } }

  // 軸 style 共用片段
  const axisLabelStyle = { color: sAxisLabel, fontSize: sAxisLabelSz, fontWeight: sAxisLabelW }
  const axisLineStyle  = { lineStyle: { color: sAxisLine } }
  const nameTextStyle  = { color: sAxisLabel, fontSize: sAxisLabelSz, fontWeight: sAxisLabelW }
  const dataLabelStyle = show_label
    ? { show: true, color: sDataLabel, fontSize: sDataLabelSz, fontWeight: sDataLabelW }
    : { show: false }
  const dataLabelTop = show_label
    ? { show: true, position: 'top' as const, color: sDataLabel, fontSize: sDataLabelSz, fontWeight: sDataLabelW }
    : { show: false }
  const dataLabelInside = show_label
    ? { show: true, position: 'inside' as const, color: sDataLabel, fontSize: sDataLabelSz, fontWeight: sDataLabelW }
    : { show: false }
  const titleStyle = (t: string | undefined) => t
    ? {
        text: t,
        left:  title_left ?? 'auto',
        top:   title_top  ?? 'auto',
        textStyle: { color: sTitle, fontSize: sTitleSz, fontWeight: sTitleW },
      }
    : undefined

  // ── Multi-dimension pivot helpers ──────────────────────────────────────────
  function pivotAgg(matchRows: Record<string, unknown>[]): number {
    if (!matchRows.length) return 0
    const vals = matchRows.map(r => Number(rf(y_field, r) ?? 0))
    switch (agg_fn) {
      case 'COUNT': return matchRows.length
      case 'AVG':   return vals.reduce((a, b) => a + b, 0) / vals.length
      case 'MAX':   return Math.max(...vals)
      case 'MIN':   return Math.min(...vals)
      case 'COUNT_DISTINCT': return new Set(vals).size
      default:      return vals.reduce((a, b) => a + b, 0)  // SUM
    }
  }

  /** 單 series — 依 x_field group by 後套 agg_fn（確保切換 agg 有效果） */
  function buildSingleSeriesData(): { xData: string[]; yData: number[] } {
    if (!x_field) {
      return {
        xData: displayRows.map(r => String(rf(x_field, r) ?? '')),
        yData: displayRows.map(r => Number(rf(y_field, r) ?? 0)),
      }
    }
    const xSet = new Map<string, true>()
    for (const r of displayRows) xSet.set(String(rf(x_field, r) ?? ''), true)
    const xData = [...xSet.keys()]
    const yData = xData.map(x => {
      const matched = displayRows.filter(r => String(rf(x_field, r) ?? '') === x)
      return pivotAgg(matched)
    })
    return { xData, yData }
  }

  /** 從 displayRows pivot 出多 series ECharts series 陣列 (bar / line) */
  function buildMultiSeries(chartType: 'bar' | 'line'): { xCategories: string[]; seriesList: object[] } | null {
    if (!series_field && !stack_field) return null

    // 收集 x 軸所有唯一值（依出現順序）
    const xSet = new Map<string, true>()
    for (const r of displayRows) xSet.set(String(rf(x_field, r) ?? ''), true)
    const xCategories = [...xSet.keys()]

    if (series_field && !stack_field) {
      // 僅分組（並排）
      const seriesSet = new Map<string, true>()
      for (const r of displayRows) seriesSet.set(String(rf(series_field, r) ?? ''), true)
      const seriesValues = [...seriesSet.keys()]

      const seriesList = seriesValues.map((sv, si) => {
        const c = seriesColorMap[sv] || colors[si % colors.length]
        const data = xCategories.map(x => {
          const matched = displayRows.filter(r =>
            String(rf(x_field, r) ?? '') === x && String(rf(series_field, r) ?? '') === sv
          )
          return pivotAgg(matched)
        })
        const shadowStyle = shadow ? { shadowBlur: 8, shadowColor: c + '80', shadowOffsetY: 2 } : {}
        if (chartType === 'line') return {
          name: sv, type: 'line', data,
          smooth: smooth ?? true, symbol: 'circle', symbolSize: 5,
          lineStyle: { color: c, width: 2 }, itemStyle: { color: c, ...shadowStyle },
          areaStyle: area ? { color: c + '30' } : undefined,
          label: dataLabelStyle,
        }
        const itemColor = gradient ? mkGradient(c) : c
        return {
          name: sv, type: 'bar', data,
          itemStyle: { color: itemColor, borderRadius: [3, 3, 0, 0], ...shadowStyle },
          label: dataLabelTop,
          barMaxWidth: 40,
        }
      })
      return { xCategories, seriesList }
    }

    if (!series_field && stack_field) {
      // 僅堆疊（全部 stack 在一起）
      const stackSet = new Map<string, true>()
      for (const r of displayRows) stackSet.set(String(rf(stack_field, r) ?? ''), true)
      const stackValues = [...stackSet.keys()]

      const seriesList = stackValues.map((stv, si) => {
        const c = seriesColorMap[stv] || colors[si % colors.length]
        const data = xCategories.map(x => {
          const matched = displayRows.filter(r =>
            String(rf(x_field, r) ?? '') === x && String(rf(stack_field, r) ?? '') === stv
          )
          return pivotAgg(matched)
        })
        const shadowStyle = shadow ? { shadowBlur: 8, shadowColor: c + '80', shadowOffsetY: 2 } : {}
        if (chartType === 'line') return {
          name: stv, type: 'line', stack: 'total', data,
          smooth: smooth ?? true, symbol: 'circle', symbolSize: 5,
          lineStyle: { color: c, width: 2 }, itemStyle: { color: c, ...shadowStyle },
          areaStyle: { color: c + '50' },
          label: dataLabelStyle,
        }
        const itemColor = gradient ? mkGradient(c) : c
        return {
          name: stv, type: 'bar', stack: 'total', data,
          itemStyle: { color: itemColor, ...shadowStyle },
          label: show_label ? { show: true, position: 'inside', color: '#fff', fontSize: 10 } : { show: false },
          barMaxWidth: 60,
        }
      })
      return { xCategories, seriesList }
    }

    // 分組 + 堆疊（series 並排，stack 在每個 series 內疊色）
    const seriesSet = new Map<string, true>()
    const stackSet = new Map<string, true>()
    for (const r of displayRows) {
      seriesSet.set(String(rf(series_field!, r) ?? ''), true)
      stackSet.set(String(rf(stack_field!, r) ?? ''), true)
    }
    const seriesValues = [...seriesSet.keys()]
    const stackValues = [...stackSet.keys()]

    const seriesList: object[] = []
    seriesValues.forEach((sv, si) => {
      stackValues.forEach((stv, sti) => {
        const _key = stackValues.length > 1 ? `${sv}·${stv}` : sv
        const c = seriesColorMap[_key] || seriesColorMap[sv] || colors[(si * stackValues.length + sti) % colors.length]
        const data = xCategories.map(x => {
          const matched = displayRows.filter(r =>
            String(rf(x_field, r) ?? '') === x &&
            String(rf(series_field!, r) ?? '') === sv &&
            String(rf(stack_field!, r) ?? '') === stv
          )
          return pivotAgg(matched)
        })
        const shadowStyle = shadow ? { shadowBlur: 8, shadowColor: c + '80', shadowOffsetY: 2 } : {}
        if (chartType === 'line') {
          seriesList.push({
            name: `${sv}·${stv}`, type: 'line', stack: sv, data,
            smooth: smooth ?? true, symbol: 'circle', symbolSize: 5,
            lineStyle: { color: c, width: 2 }, itemStyle: { color: c, ...shadowStyle },
            areaStyle: { color: c + '50' },
            label: dataLabelStyle,
          })
        } else {
          const itemColor = gradient ? mkGradient(c) : c
          seriesList.push({
            name: `${sv}·${stv}`, type: 'bar', stack: sv, data,
            itemStyle: { color: itemColor, ...shadowStyle },
            label: show_label ? { show: true, position: 'inside', color: '#fff', fontSize: 10 } : { show: false },
            barMaxWidth: 60,
          })
        }
      })
    })
    return { xCategories, seriesList }
  }

  /** 疊加折線 (Option C)：在分組 bar 上疊加全域折線 */
  function buildOverlayLineSeries(xCategories: string[]): { series: object[]; hasRightAxis: boolean } {
    if (!overlay_lines?.length) return { series: [], hasRightAxis: false }
    const hasRightAxis = overlay_lines.some(ol => ol.use_right_axis)
    const series = overlay_lines.map((ol: OverlayLine, idx: number) => {
      const c = ol.color || colors[(idx + 4) % colors.length]
      const data = xCategories.map(x => {
        const matched = displayRows.filter(r => String(rf(x_field, r) ?? '') === x)
        const vals = matched.map(r => Number(rf(ol.field, r) ?? 0))
        switch (ol.agg) {
          case 'COUNT':          return matched.length
          case 'AVG':            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
          case 'MAX':            return vals.length ? Math.max(...vals) : 0
          case 'MIN':            return vals.length ? Math.min(...vals) : 0
          case 'COUNT_DISTINCT': return new Set(vals).size
          default:               return vals.reduce((a, b) => a + b, 0)
        }
      })
      return {
        name: ol.label || ol.field,
        type: 'line',
        yAxisIndex: ol.use_right_axis ? 1 : 0,
        data,
        smooth: ol.smooth ?? false,
        symbol: 'circle', symbolSize: 5,
        lineStyle: { color: c, width: 2, type: ol.dashed ? 'dashed' : 'solid' },
        itemStyle: { color: c },
        label: dataLabelStyle,
      }
    })
    return { series, hasRightAxis }
  }

  /** 複數 Y 軸 (Method B)：每個 YAxisDef 對應一條 series */
  function buildYAxesSeries(): {
    xCategories: string[]
    seriesList: object[]
    hasRightAxis: boolean
  } | null {
    if (!y_axes || y_axes.length === 0) return null

    const xSet = new Map<string, true>()
    for (const r of displayRows) xSet.set(String(rf(x_field, r) ?? ''), true)
    const xCategories = [...xSet.keys()]

    const hasRightAxis = y_axes.some(ax => ax.use_right_axis)

    function aggVals(ax: YAxisDef, xVal: string): number {
      const matched = displayRows.filter(r => String(rf(x_field, r) ?? '') === xVal)
      const vals = matched.map(r => Number(rf(ax.field, r) ?? 0))
      if (!matched.length) return 0
      switch (ax.agg) {
        case 'COUNT':          return matched.length
        case 'AVG':            return vals.reduce((a, b) => a + b, 0) / vals.length
        case 'MAX':            return Math.max(...vals)
        case 'MIN':            return Math.min(...vals)
        case 'COUNT_DISTINCT': return new Set(vals).size
        default:               return vals.reduce((a, b) => a + b, 0) // SUM
      }
    }

    const seriesList = y_axes.map((ax, idx) => {
      const c = ax.color || colors[idx % colors.length]
      const data = xCategories.map(x => aggVals(ax, x))
      const yAxisIndex = ax.use_right_axis ? 1 : 0
      // per-axis 優先，沒設定則 fallback 到全域 shadow/gradient
      const useShadow = ax.shadow ?? shadow
      const useGradient = ax.gradient ?? gradient
      const shadowStyle = useShadow ? { shadowBlur: 8, shadowColor: c + '80', shadowOffsetY: 2 } : {}
      const seriesName = ax.label || ax.field

      if (ax.chart_type === 'line') {
        return {
          name: seriesName, type: 'line', data, yAxisIndex,
          smooth: ax.smooth ?? smooth ?? false,
          symbol: 'circle', symbolSize: 5,
          lineStyle: { color: c, width: 2 },
          itemStyle: { color: c, ...shadowStyle },
          areaStyle: (ax.area ?? area) ? { color: c + '30' } : undefined,
          label: dataLabelStyle,
        }
      }
      // bar
      const itemColor = useGradient ? mkGradient(c) : c
      const stackGroup = ax.stack ? 'yAxesStack' : undefined
      return {
        name: seriesName, type: 'bar', data, yAxisIndex,
        stack: stackGroup,
        barWidth: ax.bar_width,
        barGap: ax.overlap ? '-100%' : undefined,
        z: ax.overlap ? (idx + 1) * 2 : undefined,
        itemStyle: { color: itemColor, borderRadius: stackGroup ? [0, 0, 0, 0] : [4, 4, 0, 0], ...shadowStyle },
        label: stackGroup
          ? { show: show_label, position: 'inside' as const, color: '#fff', fontSize: sDataLabelSz }
          : dataLabelTop,
        barMaxWidth: ax.bar_width ? undefined : 48,
      }
    })

    return { xCategories, seriesList, hasRightAxis }
  }

  let option: object = {}

  const yAxesResult = buildYAxesSeries()

  if ((type === 'bar' || type === 'line') && yAxesResult) {
    // ── 複數 Y 軸模式 (Method B) ──────────────────────────────────────────────
    const { xCategories, seriesList, hasRightAxis } = yAxesResult
    const leftAxis = { type: 'value', name: y_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle }
    const rightAxis = { type: 'value', position: 'right', nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle }
    option = {
      ...BASE_OPTION,
      backgroundColor: chartDef.chart_bg_color || 'transparent',
      color: colors,
      legend: { ...legendConfig, type: 'scroll' },
      grid: { ...gridConfig, right: hasRightAxis ? 60 : 20 },
      title: titleStyle(title),
      xAxis: { type: 'category', name: x_axis_name, nameTextStyle, data: xCategories, axisLine: axisLineStyle, axisLabel: { ...axisLabelStyle, rotate: xCategories.length > 6 ? 30 : 0 } },
      yAxis: hasRightAxis ? [leftAxis, rightAxis] : leftAxis,
      series: seriesList,
    }
  } else if (type === 'bar') {
    const multi = buildMultiSeries('bar')
    if (multi) {
      const { xCategories, seriesList } = multi
      const overlay = buildOverlayLineSeries(xCategories)
      const hasRightAxis = overlay.hasRightAxis
      const leftAxis = { type: 'value', name: y_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle }
      const rightAxis = { type: 'value', position: 'right', nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle }
      option = {
        ...BASE_OPTION,
        backgroundColor: chartDef.chart_bg_color || 'transparent',
        color: colors,
        legend: { ...legendConfig, type: 'scroll' },
        grid: { ...gridConfig, right: hasRightAxis ? 60 : 20 },
        title: titleStyle(title),
        xAxis: horizontal
          ? { type: 'value', name: x_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle }
          : { type: 'category', name: x_axis_name, nameTextStyle, data: xCategories, axisLine: axisLineStyle, axisLabel: { ...axisLabelStyle, rotate: xCategories.length > 6 ? 30 : 0 } },
        yAxis: horizontal
          ? { type: 'category', name: y_axis_name, nameTextStyle, data: xCategories, axisLabel: axisLabelStyle }
          : hasRightAxis ? [leftAxis, rightAxis] : leftAxis,
        series: [...seriesList, ...overlay.series],
      }
    } else {
      const { xData, yData } = buildSingleSeriesData()
      const color = gradient ? mkGradient(primaryColor) : primaryColor
      const shadowStyle = shadow ? { shadowBlur: 8, shadowColor: primaryColor + '80', shadowOffsetY: 2 } : {}
      option = {
        ...BASE_OPTION,
        backgroundColor: chartDef.chart_bg_color || 'transparent',
        color: colors,
        legend: legendConfig,
        grid: gridConfig,
        title: titleStyle(title),
        xAxis: horizontal
          ? { type: 'value', name: x_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle }
          : { type: 'category', name: x_axis_name, nameTextStyle, data: xData, axisLine: axisLineStyle, axisLabel: { ...axisLabelStyle, rotate: xData.length > 8 ? 30 : 0 } },
        yAxis: horizontal
          ? { type: 'category', name: y_axis_name, nameTextStyle, data: xData, axisLabel: axisLabelStyle }
          : { type: 'value', name: y_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle },
        series: [{
          type: 'bar',
          data: yData,
          itemStyle: { color, borderRadius: [4, 4, 0, 0], ...shadowStyle },
          label: dataLabelTop,
          barMaxWidth: 48,
        }],
      }
    }
  } else if (type === 'line') {
    const multi = buildMultiSeries('line')
    if (multi) {
      const { xCategories, seriesList } = multi
      const overlay = buildOverlayLineSeries(xCategories)
      const hasRightAxis = overlay.hasRightAxis
      const leftAxis = { type: 'value', name: y_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle }
      const rightAxis = { type: 'value', position: 'right', nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle }
      option = {
        ...BASE_OPTION,
        backgroundColor: chartDef.chart_bg_color || 'transparent',
        color: colors,
        legend: { ...legendConfig, type: 'scroll' },
        grid: { ...gridConfig, right: hasRightAxis ? 60 : 20 },
        title: titleStyle(title),
        xAxis: { type: 'category', name: x_axis_name, nameTextStyle, data: xCategories, axisLine: axisLineStyle, axisLabel: { ...axisLabelStyle, rotate: xCategories.length > 6 ? 30 : 0 } },
        yAxis: hasRightAxis ? [leftAxis, rightAxis] : leftAxis,
        series: [...seriesList, ...overlay.series],
      }
    } else {
      const { xData, yData } = buildSingleSeriesData()
      const shadowStyle = shadow ? { shadowBlur: 8, shadowColor: primaryColor + '80', shadowOffsetY: 2 } : {}
      option = {
        ...BASE_OPTION,
        backgroundColor: chartDef.chart_bg_color || 'transparent',
        color: colors,
        legend: legendConfig,
        grid: gridConfig,
        title: titleStyle(title),
        xAxis: { type: 'category', name: x_axis_name, nameTextStyle, data: xData, axisLine: axisLineStyle, axisLabel: { ...axisLabelStyle, rotate: xData.length > 8 ? 30 : 0 } },
        yAxis: { type: 'value', name: y_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle },
        series: [{
          type: 'line',
          data: yData,
          smooth: smooth ?? true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: primaryColor, width: 2.5 },
          itemStyle: { color: primaryColor, ...shadowStyle },
          areaStyle: area ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: primaryColor + '60' }, { offset: 1, color: primaryColor + '00' }] } } : undefined,
          label: dataLabelStyle,
        }],
      }
    }
  } else if (type === 'pie') {
    const pieData = displayRows.map((r, i) => ({
      name: String(rf(label_field, r) ?? `項目${i + 1}`),
      value: Number(rf(value_field, r) ?? 0),
      itemStyle: { color: colors[i % colors.length] },
    }))
    option = {
      ...BASE_OPTION,
      backgroundColor: chartDef.chart_bg_color || 'transparent',
      color: colors,
      grid: undefined,
      legend: { ...legendConfig, type: 'scroll' },
      title: titleStyle(title),
      series: [{
        type: 'pie',
        radius: donut ? ['40%', '70%'] : '65%',
        center: ['50%', '55%'],
        data: pieData,
        label: { color: sDataLabel, fontSize: sDataLabelSz },
        labelLine: { lineStyle: { color: sAxisLine } },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
      }],
    }
  } else if (type === 'scatter') {
    const scatterData = displayRows.map(r => [Number(rf(x_field, r) ?? 0), Number(rf(y_field, r) ?? 0)])
    option = {
      ...BASE_OPTION,
      backgroundColor: chartDef.chart_bg_color || 'transparent',
      color: colors,
      legend: legendConfig,
      grid: gridConfig,
      title: titleStyle(title),
      xAxis: { type: 'value', name: x_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle },
      yAxis: { type: 'value', name: y_axis_name, nameTextStyle, axisLine: axisLineStyle, ...splitLineStyle, axisLabel: axisLabelStyle },
      series: [{ type: 'scatter', data: scatterData, itemStyle: { color: primaryColor, opacity: 0.8 }, symbolSize: 8 }],
    }
  } else if (type === 'gauge') {
    const val = displayRows.length > 0 ? Number(rf(value_field, displayRows[0]) ?? 0) : 0
    option = {
      ...BASE_OPTION,
      backgroundColor: chartDef.chart_bg_color || 'transparent',
      color: colors,
      grid: undefined,
      title: titleStyle(title),
      series: [{
        type: 'gauge',
        data: [{ value: val, name: label_field || '' }],
        axisLine: { lineStyle: { width: 16, color: [[0.3, colors[2] || '#E66C37'], [0.7, colors[6] || '#D9B300'], [1, primaryColor]] } },
        axisTick: { lineStyle: { color: sAxisLine } },
        splitLine: { lineStyle: { color: sAxisLine } },
        axisLabel: { color: sAxisLabel, fontSize: sAxisLabelSz },
        pointer: { itemStyle: { color: primaryColor } },
        title: { color: sLegend },
        detail: { color: sTitle, fontSize: 20, fontWeight: 'bold' },
      }],
    }
  }

  function handleDownload() {
    const instance = chartRef.current?.getEchartsInstance?.()
    if (!instance) return
    // SVG renderer: 用 SVG → Canvas 轉換產生 PNG
    const dom = instance.getDom()
    const svgEl = dom?.querySelector('svg')
    if (svgEl) {
      const PRINT_BG = '#ffffff'
      const PRINT_TEXT = '#111111'
      const PRINT_AXIS = '#444444'
      // 套用白底黑字到 SVG clone
      const clone = svgEl.cloneNode(true) as SVGElement
      clone.style.backgroundColor = PRINT_BG
      // ECharts SVG 第一個子節點一定是背景 rect（含 px 尺寸），直接改白
      const firstRect = clone.querySelector('rect')
      if (firstRect) firstRect.setAttribute('fill', PRINT_BG)
      // 同時把 SVG 根節點的 style/fill 也清掉
      clone.setAttribute('style', `background:${PRINT_BG}`)
      clone.querySelectorAll('text').forEach(el => {
        const col = el.getAttribute('fill') || ''
        if (!col || col === 'none' || col === 'transparent') return
        // 淺色文字改黑
        el.setAttribute('fill', PRINT_TEXT)
      })
      clone.querySelectorAll('line, path').forEach(el => {
        const s = el.getAttribute('stroke') || ''
        if (s && s !== 'none' && s !== 'transparent') el.setAttribute('stroke', PRINT_AXIS)
      })
      const svgStr = new XMLSerializer().serializeToString(clone)
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      const W = svgEl.clientWidth || 800
      const H = svgEl.clientHeight || 400
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ratio = window.devicePixelRatio || 2
        canvas.width = W * ratio; canvas.height = H * ratio
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = PRINT_BG; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.scale(ratio, ratio); ctx.drawImage(img, 0, 0, W, H)
        URL.revokeObjectURL(url)
        const a = document.createElement('a')
        a.href = canvas.toDataURL('image/png')
        a.download = `${chartDef.title || 'chart'}.png`
        a.click()
      }
      img.src = url
      return
    }
    // fallback: canvas renderer path

    const PRINT_TEXT  = '#111111'
    const PRINT_LINE  = '#444444'
    const PRINT_SPLIT = '#cccccc'
    const PRINT_BG    = '#ffffff'

    // Temporarily apply print theme
    instance.setOption({
      backgroundColor: PRINT_BG,
      textStyle: { color: PRINT_TEXT },
      legend: [{ textStyle: { color: PRINT_TEXT } }],
      title: [{ textStyle: { color: PRINT_TEXT } }],
      xAxis: (instance.getOption().xAxis as object[] | undefined)?.map((ax: object) => ({
        ...ax,
        axisLabel: { color: PRINT_TEXT },
        nameTextStyle: { color: PRINT_TEXT },
        axisLine: { show: true, lineStyle: { color: PRINT_LINE } },
        axisTick: { lineStyle: { color: PRINT_LINE } },
      })),
      yAxis: (instance.getOption().yAxis as object[] | undefined)?.map((ax: object) => ({
        ...ax,
        axisLabel: { color: PRINT_TEXT },
        nameTextStyle: { color: PRINT_TEXT },
        axisLine: { show: true, lineStyle: { color: PRINT_LINE } },
        axisTick: { lineStyle: { color: PRINT_LINE } },
        splitLine: { lineStyle: { color: PRINT_SPLIT } },
      })),
    })

    // Give ECharts one frame to re-render, then capture
    requestAnimationFrame(() => {
      const url = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: PRINT_BG })
      // Restore original option
      instance.setOption({ ...option, backgroundColor: chartDef.chart_bg_color || 'transparent' }, { notMerge: true })

      const title = chartDef.title || 'chart'
      const a = document.createElement('a')
      a.href = url
      a.download = `${title}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    })
  }

  // 偵測 y_axes 中失效的欄位（第一筆 row 解析不到的）
  const invalidFields = y_axes && displayRows.length > 0
    ? y_axes.filter(ax => rf(ax.field, displayRows[0]) === undefined).map(ax => ax.label || ax.field)
    : []

  return (
    <div style={{ position: 'relative', width: '100%', height: height === undefined ? '100%' : height }}>
      {invalidFields.length > 0 && (
        <div style={{
          position: 'absolute', top: 8, left: 8, right: 40, zIndex: 10,
          background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6,
          padding: '4px 10px', fontSize: 11, color: '#92400e',
        }}>
          ⚠ 以下 Y 軸欄位在目前查詢結果中找不到（欄位名稱可能已變更，請在 Tableau 模式重新拖曳）：
          {' '}<strong>{invalidFields.join('、')}</strong>
        </div>
      )}
      <ReactECharts
        ref={chartRef}
        option={option}
        notMerge
        style={{ height: '100%', width: '100%' }}
        theme="light"
        opts={{ renderer: 'svg' }}
      />
      {/* 白底黑字下載按鈕 */}
      <button
        onClick={handleDownload}
        title="下載圖片（白底黑字）"
        style={{
          position: 'absolute', top: 4, right: 8,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: '2px 4px',
          borderRadius: 4,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#3b82f6')}
        onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
      >
        ⬇
      </button>
    </div>
  )
}
