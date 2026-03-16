/**
 * AiChart — ECharts wrapper with configurable palette
 * Supports: bar, line, pie, scatter, radar, gauge
 */
import ReactECharts from 'echarts-for-react'
import type { AiChartDef, ChartColorPalette } from '../../types'
import { useTranslation } from 'react-i18next'

// Named palettes
const PALETTES: Record<ChartColorPalette, string[]> = {
  blue:   ['#118DFF', '#0093D5', '#12239E', '#005FB0', '#1B6EC2', '#00B7C3'],
  green:  ['#009E49', '#00B294', '#10893E', '#499900', '#00CC6A', '#38B000'],
  orange: ['#E66C37', '#D9B300', '#F5B300', '#D64550', '#E044A7', '#FF6B35'],
  purple: ['#744EC2', '#6B007B', '#8764B8', '#B4009E', '#C239B3', '#9B59B6'],
  teal:   ['#0099BC', '#038387', '#00B4D8', '#0096C7', '#00B7C3', '#48CAE4'],
}

// Power BI standard palette (default)
const DEFAULT_COLORS = [
  '#118DFF', '#12239E', '#E66C37', '#6B007B',
  '#E044A7', '#744EC2', '#D9B300', '#D64550',
  '#009E49', '#0093D5',
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
}

/** 解析 chart config 欄位名稱 → 實際 row 值
 *  支援: 直接匹配 / lowercase / 去掉表別名前綴 / 透過 column_labels reverse lookup */
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
  const found = Object.keys(row).find(k => k.toLowerCase() === bare)
  if (found) return row[found]
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
  toolbox: {
    feature: {
      saveAsImage: {
        title: '下載圖片',
        pixelRatio: 2,
        iconStyle: { borderColor: '#9ca3af' },
        emphasis: { iconStyle: { borderColor: '#3b82f6' } },
      },
    },
    right: 8,
    top: 4,
  },
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

export default function AiChart({ chartDef, rows, columnLabels = {} }: Props) {
  const { i18n } = useTranslation()
  const lang = i18n.language

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
  } = chartDef

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

  const legendConfig = show_legend !== false
    ? { textStyle: { color: '#6b7280' }, top: title ? 28 : 4 }
    : { show: false }

  const gridConfig = {
    left: 60, right: 20,
    top: show_legend !== false ? 56 : 40,
    bottom: 40,
    containLabel: true,
    show: show_grid,
    borderColor: '#f3f4f6',
  }

  const splitLineStyle = { lineStyle: { color: show_grid !== false ? '#f3f4f6' : 'transparent' } }

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
        const c = colors[si % colors.length]
        const data = xCategories.map(x => {
          const matched = displayRows.filter(r =>
            String(rf(x_field, r) ?? '') === x && String(rf(series_field, r) ?? '') === sv
          )
          return pivotAgg(matched)
        })
        if (chartType === 'line') return {
          name: sv, type: 'line', data,
          smooth: smooth ?? true, symbol: 'circle', symbolSize: 5,
          lineStyle: { color: c, width: 2 }, itemStyle: { color: c },
          areaStyle: area ? { color: c + '30' } : undefined,
          label: show_label ? { show: true, color: '#6b7280', fontSize: 10 } : { show: false },
        }
        return {
          name: sv, type: 'bar', data,
          itemStyle: { color: c, borderRadius: [3, 3, 0, 0] },
          label: show_label ? { show: true, position: 'top', color: '#6b7280', fontSize: 10 } : { show: false },
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
        const c = colors[si % colors.length]
        const data = xCategories.map(x => {
          const matched = displayRows.filter(r =>
            String(rf(x_field, r) ?? '') === x && String(rf(stack_field, r) ?? '') === stv
          )
          return pivotAgg(matched)
        })
        if (chartType === 'line') return {
          name: stv, type: 'line', stack: 'total', data,
          smooth: smooth ?? true, symbol: 'circle', symbolSize: 5,
          lineStyle: { color: c, width: 2 }, itemStyle: { color: c },
          areaStyle: { color: c + '50' },
          label: show_label ? { show: true, color: '#6b7280', fontSize: 10 } : { show: false },
        }
        return {
          name: stv, type: 'bar', stack: 'total', data,
          itemStyle: { color: c },
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
        const c = colors[(si * stackValues.length + sti) % colors.length]
        const data = xCategories.map(x => {
          const matched = displayRows.filter(r =>
            String(rf(x_field, r) ?? '') === x &&
            String(rf(series_field!, r) ?? '') === sv &&
            String(rf(stack_field!, r) ?? '') === stv
          )
          return pivotAgg(matched)
        })
        if (chartType === 'line') {
          seriesList.push({
            name: `${sv}·${stv}`, type: 'line', stack: sv, data,
            smooth: smooth ?? true, symbol: 'circle', symbolSize: 5,
            lineStyle: { color: c, width: 2 }, itemStyle: { color: c },
            areaStyle: { color: c + '50' },
            label: show_label ? { show: true, color: '#6b7280', fontSize: 10 } : { show: false },
          })
        } else {
          seriesList.push({
            name: `${sv}·${stv}`, type: 'bar', stack: sv, data,
            itemStyle: { color: c },
            label: show_label ? { show: true, position: 'inside', color: '#fff', fontSize: 10 } : { show: false },
            barMaxWidth: 60,
          })
        }
      })
    })
    return { xCategories, seriesList }
  }

  let option: object = {}

  if (type === 'bar') {
    const multi = buildMultiSeries('bar')
    if (multi) {
      const { xCategories, seriesList } = multi
      option = {
        ...BASE_OPTION,
        color: colors,
        legend: { ...legendConfig, type: 'scroll' },
        grid: gridConfig,
        title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 } } : undefined,
        xAxis: horizontal
          ? { type: 'value', name: x_axis_name, nameTextStyle: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e5e7eb' } }, ...splitLineStyle, axisLabel: { color: '#6b7280' } }
          : { type: 'category', name: x_axis_name, nameTextStyle: { color: '#6b7280' }, data: xCategories, axisLine: { lineStyle: { color: '#e5e7eb' } }, axisLabel: { color: '#6b7280', rotate: xCategories.length > 6 ? 30 : 0 } },
        yAxis: horizontal
          ? { type: 'category', name: y_axis_name, nameTextStyle: { color: '#6b7280' }, data: xCategories, axisLabel: { color: '#6b7280' } }
          : { type: 'value', name: y_axis_name, nameTextStyle: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e5e7eb' } }, ...splitLineStyle, axisLabel: { color: '#6b7280' } },
        series: seriesList,
      }
    } else {
      const xData = displayRows.map(r => String(rf(x_field, r) ?? ''))
      const yData = displayRows.map(r => Number(rf(y_field, r) ?? 0))
      const color = gradient ? mkGradient(primaryColor) : primaryColor
      option = {
        ...BASE_OPTION,
        color: colors,
        legend: legendConfig,
        grid: gridConfig,
        title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 } } : undefined,
        xAxis: horizontal
          ? { type: 'value', name: x_axis_name, nameTextStyle: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e5e7eb' } }, ...splitLineStyle, axisLabel: { color: '#6b7280' } }
          : { type: 'category', name: x_axis_name, nameTextStyle: { color: '#6b7280' }, data: xData, axisLine: { lineStyle: { color: '#e5e7eb' } }, axisLabel: { color: '#6b7280', rotate: xData.length > 8 ? 30 : 0 } },
        yAxis: horizontal
          ? { type: 'category', name: y_axis_name, nameTextStyle: { color: '#6b7280' }, data: xData, axisLabel: { color: '#6b7280' } }
          : { type: 'value', name: y_axis_name, nameTextStyle: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e5e7eb' } }, ...splitLineStyle, axisLabel: { color: '#6b7280' } },
        series: [{
          type: 'bar',
          data: yData,
          itemStyle: { color, borderRadius: [4, 4, 0, 0] },
          label: show_label ? { show: true, position: 'top', color: '#6b7280', fontSize: 11 } : { show: false },
          barMaxWidth: 48,
        }],
      }
    }
  } else if (type === 'line') {
    const multi = buildMultiSeries('line')
    if (multi) {
      const { xCategories, seriesList } = multi
      option = {
        ...BASE_OPTION,
        color: colors,
        legend: { ...legendConfig, type: 'scroll' },
        grid: gridConfig,
        title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 } } : undefined,
        xAxis: { type: 'category', name: x_axis_name, nameTextStyle: { color: '#6b7280' }, data: xCategories, axisLine: { lineStyle: { color: '#e5e7eb' } }, axisLabel: { color: '#6b7280', rotate: xCategories.length > 6 ? 30 : 0 } },
        yAxis: { type: 'value', name: y_axis_name, nameTextStyle: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e5e7eb' } }, ...splitLineStyle, axisLabel: { color: '#6b7280' } },
        series: seriesList,
      }
    } else {
      const xData = displayRows.map(r => String(rf(x_field, r) ?? ''))
      const yData = displayRows.map(r => Number(rf(y_field, r) ?? 0))
      option = {
        ...BASE_OPTION,
        color: colors,
        legend: legendConfig,
        grid: gridConfig,
        title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 } } : undefined,
        xAxis: { type: 'category', name: x_axis_name, nameTextStyle: { color: '#6b7280' }, data: xData, axisLine: { lineStyle: { color: '#e5e7eb' } }, axisLabel: { color: '#6b7280', rotate: xData.length > 8 ? 30 : 0 } },
        yAxis: { type: 'value', name: y_axis_name, nameTextStyle: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e5e7eb' } }, ...splitLineStyle, axisLabel: { color: '#6b7280' } },
        series: [{
          type: 'line',
          data: yData,
          smooth: smooth ?? true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: primaryColor, width: 2.5 },
          itemStyle: { color: primaryColor },
          areaStyle: area ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: primaryColor + '60' }, { offset: 1, color: primaryColor + '00' }] } } : undefined,
          label: show_label ? { show: true, color: '#6b7280', fontSize: 11 } : { show: false },
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
      color: colors,
      grid: undefined,
      legend: { ...legendConfig, type: 'scroll' },
      title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 }, left: 'center' } : undefined,
      series: [{
        type: 'pie',
        radius: donut ? ['40%', '70%'] : '65%',
        center: ['50%', '55%'],
        data: pieData,
        label: { color: '#6b7280', fontSize: 11 },
        labelLine: { lineStyle: { color: '#d1d5db' } },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
      }],
    }
  } else if (type === 'scatter') {
    const scatterData = displayRows.map(r => [Number(rf(x_field, r) ?? 0), Number(rf(y_field, r) ?? 0)])
    option = {
      ...BASE_OPTION,
      color: colors,
      legend: legendConfig,
      grid: gridConfig,
      title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 } } : undefined,
      xAxis: { type: 'value', name: x_axis_name, nameTextStyle: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e5e7eb' } }, ...splitLineStyle, axisLabel: { color: '#6b7280' } },
      yAxis: { type: 'value', name: y_axis_name, nameTextStyle: { color: '#6b7280' }, axisLine: { lineStyle: { color: '#e5e7eb' } }, ...splitLineStyle, axisLabel: { color: '#6b7280' } },
      series: [{ type: 'scatter', data: scatterData, itemStyle: { color: primaryColor, opacity: 0.8 }, symbolSize: 8 }],
    }
  } else if (type === 'gauge') {
    const val = displayRows.length > 0 ? Number(rf(value_field, displayRows[0]) ?? 0) : 0
    option = {
      ...BASE_OPTION,
      color: colors,
      grid: undefined,
      title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 }, left: 'center' } : undefined,
      series: [{
        type: 'gauge',
        data: [{ value: val, name: label_field || '' }],
        axisLine: { lineStyle: { width: 16, color: [[0.3, colors[2] || '#E66C37'], [0.7, colors[6] || '#D9B300'], [1, primaryColor]] } },
        axisTick: { lineStyle: { color: '#d1d5db' } },
        splitLine: { lineStyle: { color: '#d1d5db' } },
        axisLabel: { color: '#64748b' },
        pointer: { itemStyle: { color: primaryColor } },
        title: { color: '#6b7280' },
        detail: { color: '#111827', fontSize: 20, fontWeight: 'bold' },
      }],
    }
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: '100%' }}
      theme="light"
      opts={{ renderer: 'canvas' }}
    />
  )
}
