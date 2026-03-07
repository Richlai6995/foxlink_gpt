/**
 * AiChart — ECharts wrapper with Power BI palette
 * Supports: bar, line, pie, scatter, radar, gauge
 */
import ReactECharts from 'echarts-for-react'
import type { AiChartDef } from '../../types'

// Power BI standard palette
const PBI_COLORS = [
  '#118DFF', '#12239E', '#E66C37', '#6B007B',
  '#E044A7', '#744EC2', '#D9B300', '#D64550',
  '#009E49', '#0093D5',
]

interface Props {
  chartDef: AiChartDef
  rows: Record<string, unknown>[]
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
  },
  legend: { textStyle: { color: '#6b7280' } },
  grid: { left: 60, right: 20, top: 40, bottom: 40, containLabel: true },
}

export default function AiChart({ chartDef, rows }: Props) {
  const { type, title, x_field, y_field, label_field, value_field,
    horizontal, smooth, area, gradient, donut, show_label } = chartDef

  let option: object = {}

  if (type === 'bar') {
    const xData = rows.map(r => String(r[x_field || ''] ?? ''))
    const yData = rows.map(r => Number(r[y_field || ''] ?? 0))
    const color = gradient ? mkGradient(PBI_COLORS[0]) : PBI_COLORS[0]

    option = {
      ...BASE_OPTION,
      title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 } } : undefined,
      xAxis: horizontal
        ? { type: 'value', axisLine: { lineStyle: { color: '#e5e7eb' } }, splitLine: { lineStyle: { color: '#f3f4f6' } }, axisLabel: { color: '#6b7280' } }
        : { type: 'category', data: xData, axisLine: { lineStyle: { color: '#e5e7eb' } }, axisLabel: { color: '#6b7280', rotate: xData.length > 8 ? 30 : 0 } },
      yAxis: horizontal
        ? { type: 'category', data: xData, axisLabel: { color: '#6b7280' } }
        : { type: 'value', axisLine: { lineStyle: { color: '#e5e7eb' } }, splitLine: { lineStyle: { color: '#f3f4f6' } }, axisLabel: { color: '#6b7280' } },
      series: [{
        type: 'bar',
        data: yData,
        itemStyle: { color, borderRadius: [4, 4, 0, 0] },
        label: show_label ? { show: true, position: 'top', color: '#6b7280', fontSize: 11 } : { show: false },
        barMaxWidth: 48,
      }],
    }
  } else if (type === 'line') {
    const xData = rows.map(r => String(r[x_field || ''] ?? ''))
    const yData = rows.map(r => Number(r[y_field || ''] ?? 0))
    option = {
      ...BASE_OPTION,
      title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 } } : undefined,
      xAxis: { type: 'category', data: xData, axisLine: { lineStyle: { color: '#e5e7eb' } }, axisLabel: { color: '#6b7280', rotate: xData.length > 8 ? 30 : 0 } },
      yAxis: { type: 'value', axisLine: { lineStyle: { color: '#e5e7eb' } }, splitLine: { lineStyle: { color: '#f3f4f6' } }, axisLabel: { color: '#6b7280' } },
      series: [{
        type: 'line',
        data: yData,
        smooth: smooth ?? true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: PBI_COLORS[0], width: 2.5 },
        itemStyle: { color: PBI_COLORS[0] },
        areaStyle: area ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: PBI_COLORS[0] + '60' }, { offset: 1, color: PBI_COLORS[0] + '00' }] } } : undefined,
        label: show_label ? { show: true, color: '#6b7280', fontSize: 11 } : { show: false },
      }],
    }
  } else if (type === 'pie') {
    const pieData = rows.map((r, i) => ({
      name: String(r[label_field || ''] ?? `項目${i + 1}`),
      value: Number(r[value_field || ''] ?? 0),
      itemStyle: { color: PBI_COLORS[i % PBI_COLORS.length] },
    }))
    option = {
      ...BASE_OPTION,
      grid: undefined,
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
    const scatterData = rows.map(r => [Number(r[x_field || ''] ?? 0), Number(r[y_field || ''] ?? 0)])
    option = {
      ...BASE_OPTION,
      title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 } } : undefined,
      xAxis: { type: 'value', axisLine: { lineStyle: { color: '#e5e7eb' } }, splitLine: { lineStyle: { color: '#f3f4f6' } }, axisLabel: { color: '#6b7280' } },
      yAxis: { type: 'value', axisLine: { lineStyle: { color: '#e5e7eb' } }, splitLine: { lineStyle: { color: '#f3f4f6' } }, axisLabel: { color: '#6b7280' } },
      series: [{ type: 'scatter', data: scatterData, itemStyle: { color: PBI_COLORS[0], opacity: 0.8 }, symbolSize: 8 }],
    }
  } else if (type === 'gauge') {
    const val = rows.length > 0 ? Number(rows[0][value_field || ''] ?? 0) : 0
    option = {
      ...BASE_OPTION,
      grid: undefined,
      title: title ? { text: title, textStyle: { color: '#374151', fontSize: 13 }, left: 'center' } : undefined,
      series: [{
        type: 'gauge',
        data: [{ value: val, name: label_field || '' }],
        axisLine: { lineStyle: { width: 16, color: [[0.3, '#E66C37'], [0.7, '#D9B300'], [1, '#118DFF']] } },
        axisTick: { lineStyle: { color: '#d1d5db' } },
        splitLine: { lineStyle: { color: '#d1d5db' } },
        axisLabel: { color: '#64748b' },
        pointer: { itemStyle: { color: '#118DFF' } },
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
