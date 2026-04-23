/**
 * chartStyle — 把 ChartStyle 設定轉成 ECharts options 的 merge helper
 *
 * 套用優先序(應在 render 層算好最終 style 再呼叫):
 *   spec.style (LLM / 使用者 override) > user default template > system default > HARDCODED
 *
 * 詳見 docs/chat-inline-chart-plan.md §Phase 4c 樣式模板
 */
import type { ChartStyle, ChartPaletteName, InlineChartType } from '../types'

// 5 組預設 palette(與 戰情室 AiChart 對齊)
export const PALETTES: Record<Exclude<ChartPaletteName, 'custom'>, string[]> = {
  blue:   ['#118DFF', '#0093D5', '#12239E', '#005FB0', '#1B6EC2', '#00B7C3'],
  green:  ['#009E49', '#00B294', '#10893E', '#499900', '#00CC6A', '#38B000'],
  warm:   ['#E66C37', '#D9B300', '#F5B300', '#D64550', '#E044A7', '#FF6B35'],
  purple: ['#744EC2', '#6B007B', '#8764B8', '#B4009E', '#C239B3', '#9B59B6'],
  teal:   ['#0099BC', '#038387', '#00B4D8', '#0096C7', '#00B7C3', '#48CAE4'],
}

// HARDCODED 預設 — 無使用者 default template / 無系統預設時的 fallback
export const HARDCODED_STYLE: Required<ChartStyle> = {
  version: 1,
  common: {
    palette: 'blue',
    custom_colors: [],
    title_size: 13,
    axis_label_size: 11,
    legend_position: 'top',
    legend_size: 11,
    show_grid: true,
    number_format: 'plain',
    decimal_places: 0,
    background: 'light',
  },
  perType: {
    bar: {
      border_radius: 4,
      single_series_multi_color: false,
      custom_bar_colors: [],
      shadow: false,
      opacity: 1,
      animation_style: 'grow',
      animation_stagger: false,
    },
    line: { smooth: false, line_width: 2 },
    area: { opacity: 0.25, smooth: true },
    pie: { doughnut: true, radius_inner: 40, radius_outer: 68 },
    scatter: { symbol_size: 10 },
  },
}

/** 深合併 ChartStyle — 後者覆寫前者 */
export function mergeChartStyle(base: ChartStyle | undefined, override: ChartStyle | undefined): ChartStyle {
  if (!base && !override) return HARDCODED_STYLE
  if (!override) return base as ChartStyle
  if (!base) return override
  return {
    version: override.version ?? base.version,
    common: { ...base.common, ...override.common },
    perType: {
      ...(base.perType || {}),
      ...(override.perType || {}),
      ...Object.fromEntries(
        Object.entries(override.perType || {}).map(([k, v]) => [
          k,
          { ...((base.perType as any)?.[k] || {}), ...(v || {}) },
        ])
      ),
    },
  }
}

/** 取得 style 使用的色盤陣列 */
export function getPaletteColors(style: ChartStyle): string[] {
  const c = style.common || {}
  if (c.palette === 'custom' && Array.isArray(c.custom_colors) && c.custom_colors.length > 0) {
    return c.custom_colors
  }
  const name = (c.palette || 'blue') as Exclude<ChartPaletteName, 'custom'>
  return PALETTES[name] || PALETTES.blue
}

/** 數字格式化器 — 套在 axis / tooltip */
export function makeValueFormatter(style: ChartStyle): (v: unknown) => string {
  const c = style.common || {}
  const decimals = c.decimal_places ?? 0
  return (v: unknown) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return String(v ?? '')
    switch (c.number_format) {
      case 'percent':
        return (n * 100).toFixed(decimals) + '%'
      case 'thousand':
        return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      case 'plain':
      default:
        return decimals > 0 ? n.toFixed(decimals) : String(n)
    }
  }
}

/** 依背景模式回傳配色 token(讓 ECharts option 用) */
export function resolveThemeColors(style: ChartStyle): {
  bg: string
  text: string
  subtext: string
  grid: string
  axisLine: string
  tooltipBg: string
  tooltipBorder: string
  cardBorder: string
} {
  const dark = style.common?.background === 'dark'
  return dark
    ? {
        bg: '#1e293b',
        text: '#e2e8f0',
        subtext: '#94a3b8',
        grid: '#334155',
        axisLine: '#475569',
        tooltipBg: '#0f172a',
        tooltipBorder: '#334155',
        cardBorder: '#334155',
      }
    : {
        bg: '#ffffff',
        text: '#374151',
        subtext: '#6b7280',
        grid: '#f3f4f6',
        axisLine: '#e5e7eb',
        tooltipBg: '#ffffff',
        tooltipBorder: '#e5e7eb',
        cardBorder: '#e2e8f0',
      }
}

/** legend 位置 → ECharts legend options */
export function resolveLegendPlacement(
  style: ChartStyle,
  themeColors: ReturnType<typeof resolveThemeColors>,
  titleHeight: number,
): Record<string, unknown> | undefined {
  const c = style.common || {}
  const pos = c.legend_position || 'top'
  if (pos === 'none') return undefined
  const base = {
    textStyle: { color: themeColors.subtext, fontSize: c.legend_size ?? 11 },
  }
  switch (pos) {
    case 'bottom': return { ...base, bottom: 4 }
    case 'left':   return { ...base, orient: 'vertical', left: 8, top: 'middle' }
    case 'right':  return { ...base, orient: 'vertical', right: 8, top: 'middle' }
    case 'top':
    default:       return { ...base, top: titleHeight }
  }
}

/** 取圖型相關的 perType 設定(帶 fallback) */
export function getPerTypeStyle<T extends keyof NonNullable<ChartStyle['perType']>>(
  style: ChartStyle,
  type: T,
): NonNullable<NonNullable<ChartStyle['perType']>[T]> {
  const override = (style.perType as any)?.[type] || {}
  const hard = (HARDCODED_STYLE.perType as any)[type] || {}
  return { ...hard, ...override }
}

/** 快速判斷一個 spec type 是否為可切換的 4 型(bar/line/area/pie) */
export const SWITCHABLE_TYPES: InlineChartType[] = ['bar', 'line', 'area', 'pie']
