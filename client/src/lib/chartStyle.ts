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
    axis_label_rotate: 'auto',
    axis_label_max_chars: 0,
  },
  perType: {
    bar: {
      palette: 'inherit',
      border_radius: 4,
      single_series_multi_color: false,
      custom_bar_colors: [],
      shadow: false,
      opacity: 1,
      animation_style: 'grow',
      animation_stagger: false,
    },
    line: { palette: 'inherit', smooth: false, line_width: 2 },
    area: { palette: 'inherit', opacity: 0.25, smooth: true },
    pie: { palette: 'inherit', doughnut: true, radius_inner: 40, radius_outer: 68 },
    scatter: { palette: 'inherit', symbol_size: 10 },
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

/**
 * 依 x labels 自動算 axis rotate / interval / gridBottom。
 * 解決 ECharts 預設 interval='auto' 會吃掉擠不下的 label(例如長料號排名圖)。
 *
 * 規則:
 *  - 短 label(≤6 字)+ 少量(≤12):不轉,interval=auto(保留系統判斷)
 *  - 中 label(≤12 字):轉 30°,interval=0 全顯
 *  - 長 label:轉 45°
 *  - 超多(>30):轉 60°
 * grid.bottom 依角度加大,避免文字被裁切。
 */
export function autoAxisLabel(labels: Array<string | number>): {
  rotate: number
  interval: 0 | 'auto'
  extraGridBottom: number
} {
  const n = labels.length
  let maxLen = 0
  for (const l of labels) {
    const s = String(l ?? '')
    if (s.length > maxLen) maxLen = s.length
  }
  if (maxLen <= 6 && n <= 12) return { rotate: 0, interval: 'auto', extraGridBottom: 0 }
  if (maxLen <= 12 && n <= 20) return { rotate: 30, interval: 0, extraGridBottom: 24 }
  if (n > 30) return { rotate: 60, interval: 0, extraGridBottom: 48 }
  return { rotate: 45, interval: 0, extraGridBottom: 36 }
}

/**
 * 依 max_chars 截斷 label;保留 ECharts formatter 介面。
 * 回傳 undefined 代表不需截斷(讓 ECharts 用原值);截斷後完整文字仍在 tooltip 可看。
 */
export function makeAxisLabelTruncator(maxChars: number): ((v: string) => string) | undefined {
  if (!maxChars || maxChars <= 0) return undefined
  return (v: string) => {
    const s = String(v ?? '')
    return s.length > maxChars ? s.slice(0, maxChars) + '…' : s
  }
}

/**
 * 取得 style 使用的色盤陣列。
 * 優先序:perType[type].palette(若非 'inherit')→ common.palette → fallback blue
 * type 參數可空,空時僅看 common。
 */
export function getPaletteColors(style: ChartStyle, type?: InlineChartType): string[] {
  // 1. perType override
  if (type && style.perType) {
    const typed = (style.perType as Record<string, { palette?: ChartPaletteName | 'inherit' }>)[type]
    const typePalette = typed?.palette
    if (typePalette && typePalette !== 'inherit') {
      if (typePalette === 'custom') {
        // per-type 的 custom 目前復用 common.custom_colors(避免每型再塞一組)
        const c = style.common?.custom_colors || []
        if (c.length > 0) return c
        return PALETTES.blue
      }
      return PALETTES[typePalette] || PALETTES.blue
    }
  }
  // 2. common.palette
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
