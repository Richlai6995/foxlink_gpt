/**
 * dynamicDate — 動態日期 token 定義與 runtime 解析
 *
 * Token 格式：
 *   @today / @yesterday / @this_week / @this_month /
 *   @last_month / @this_year / @last_7d / @last_14d / @last_Nd /
 *   @last_2w / @last_Nw / @last_3m / @last_Nm
 */

export interface DynamicDateToken {
  token: string          // e.g. '@today', '@last_Nd'
  label_zh: string
  label_en: string
  label_vi: string
  is_range: boolean      // true → resolves to 'start|end', false → single date
  has_n?: boolean        // true → token 中的 N 需要使用者輸入
  n_unit?: 'd' | 'w' | 'm'  // 天/週/月
}

export const DYNAMIC_DATE_TOKENS: DynamicDateToken[] = [
  {
    token: '@today',
    label_zh: '今天',      label_en: 'Today',        label_vi: 'Hôm nay',
    is_range: false,
  },
  {
    token: '@yesterday',
    label_zh: '昨天',      label_en: 'Yesterday',    label_vi: 'Hôm qua',
    is_range: false,
  },
  {
    token: '@this_week',
    label_zh: '本週',      label_en: 'This Week',    label_vi: 'Tuần này',
    is_range: true,
  },
  {
    token: '@this_month',
    label_zh: '本月',      label_en: 'This Month',   label_vi: 'Tháng này',
    is_range: true,
  },
  {
    token: '@last_month',
    label_zh: '上個月',    label_en: 'Last Month',   label_vi: 'Tháng trước',
    is_range: true,
  },
  {
    token: '@this_year',
    label_zh: '今年',      label_en: 'This Year',    label_vi: 'Năm nay',
    is_range: true,
  },
  {
    token: '@last_Nd',
    label_zh: '最近 N 天', label_en: 'Last N Days',  label_vi: 'N ngày qua',
    is_range: true, has_n: true, n_unit: 'd',
  },
  {
    token: '@last_Nw',
    label_zh: '最近 N 週', label_en: 'Last N Weeks', label_vi: 'N tuần qua',
    is_range: true, has_n: true, n_unit: 'w',
  },
  {
    token: '@last_Nm',
    label_zh: '最近 N 個月', label_en: 'Last N Months', label_vi: 'N tháng qua',
    is_range: true, has_n: true, n_unit: 'm',
  },
]

/** 取得 token 定義 */
export function getTokenDef(token: string): DynamicDateToken | undefined {
  // has_n tokens: @last_7d / @last_2w / @last_3m → match @last_Nd / @last_Nw / @last_Nm
  if (/^@last_\d+d$/.test(token)) return DYNAMIC_DATE_TOKENS.find(t => t.token === '@last_Nd')
  if (/^@last_\d+w$/.test(token)) return DYNAMIC_DATE_TOKENS.find(t => t.token === '@last_Nw')
  if (/^@last_\d+m$/.test(token)) return DYNAMIC_DATE_TOKENS.find(t => t.token === '@last_Nm')
  return DYNAMIC_DATE_TOKENS.find(t => t.token === token)
}

/** 從有 N 的 token 取出 N 值 (e.g. '@last_14d' → 14) */
export function extractN(token: string): number {
  const m = token.match(/^@last_(\d+)[dwm]$/)
  return m ? parseInt(m[1]) : 7
}

/** 將有 N 的 base token + n → 實際 token (e.g. '@last_Nd' + 14 → '@last_14d') */
export function buildNToken(baseToken: string, n: number): string {
  return baseToken.replace('N', String(n))
}

const fmt = (d: Date): string => d.toISOString().split('T')[0]

/**
 * 解析 token → 實際日期字串
 * - 單日期：'YYYY-MM-DD'
 * - 日期範圍：'YYYY-MM-DD|YYYY-MM-DD'
 */
export function resolveDynamicDate(token: string): string {
  if (!token.startsWith('@')) return token  // 不是 token，原值回傳

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (token === '@today') return fmt(today)

  if (token === '@yesterday') {
    const d = new Date(today); d.setDate(d.getDate() - 1)
    return fmt(d)
  }

  if (token === '@this_week') {
    const day = today.getDay() === 0 ? 7 : today.getDay()  // 週一=1
    const mon = new Date(today); mon.setDate(today.getDate() - day + 1)
    return `${fmt(mon)}|${fmt(today)}`
  }

  if (token === '@this_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    return `${fmt(start)}|${fmt(today)}`
  }

  if (token === '@last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end   = new Date(today.getFullYear(), today.getMonth(), 0)
    return `${fmt(start)}|${fmt(end)}`
  }

  if (token === '@this_year') {
    const start = new Date(today.getFullYear(), 0, 1)
    return `${fmt(start)}|${fmt(today)}`
  }

  // @last_Nd
  const nd = token.match(/^@last_(\d+)d$/)
  if (nd) {
    const n = parseInt(nd[1])
    const start = new Date(today); start.setDate(start.getDate() - n + 1)
    return `${fmt(start)}|${fmt(today)}`
  }

  // @last_Nw
  const nw = token.match(/^@last_(\d+)w$/)
  if (nw) {
    const n = parseInt(nw[1])
    const start = new Date(today); start.setDate(start.getDate() - n * 7 + 1)
    return `${fmt(start)}|${fmt(today)}`
  }

  // @last_Nm
  const nm = token.match(/^@last_(\d+)m$/)
  if (nm) {
    const n = parseInt(nm[1])
    const start = new Date(today.getFullYear(), today.getMonth() - n + 1, 1)
    return `${fmt(start)}|${fmt(today)}`
  }

  return token  // 未知 token 原值回傳
}

/**
 * 將 token 解析成顯示用的中文字串（不同於儲存的 YYYY-MM-DD 格式）
 * 用在 tile header 顯示「本月」而非「2026-03-01 到 2026-03-15」
 */
export function tokenDisplayLabel(token: string, lang: 'zh' | 'en' | 'vi' = 'zh'): string {
  const def = getTokenDef(token)
  if (!def) return token
  const base = lang === 'en' ? def.label_en : lang === 'vi' ? def.label_vi : def.label_zh
  if (def.has_n) {
    const n = extractN(token)
    return base.replace('N', String(n))
  }
  return base
}

/** 判斷值是否為動態日期 token */
export function isDynamicToken(val: string): boolean {
  return typeof val === 'string' && val.startsWith('@')
}
