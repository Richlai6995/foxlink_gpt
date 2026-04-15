/**
 * granteeFormat — 分享 grantee 顯示格式與搜尋比對的共用邏輯
 *
 * 見 docs/factory-share-layer-plan.md §3.2
 * 規則：部門/利潤中心/事業處/廠區 一律顯示 "{code} {name}"，
 *      搜尋可比對 code 或 name；role/org_group 只有 name。
 */
import type { GranteeType, GranteeLovOption } from '../../types'

// 哪些 type 的選項顯示 "{code} {name}"（code 為 monospace）
const CODED_TYPES: GranteeType[] = ['factory', 'department', 'cost_center', 'division']

export function hasCode(type: GranteeType): boolean {
  return CODED_TYPES.includes(type)
}

/**
 * 把 grantee 的 code + name 組成顯示字串
 * - coded types: "{code} {name}"
 * - role / org_group: "{name}"
 * - user: 呼叫端用 UserPicker，不走此 helper
 */
export function formatGranteeLabel(type: GranteeType, code: string | null | undefined, name: string | null | undefined): string {
  const n = (name || '').trim()
  const c = (code || '').trim()
  if (hasCode(type)) {
    if (c && n) return `${c} ${n}`
    return c || n || ''
  }
  return n || c || ''
}

/**
 * 模糊比對 — code / name 其中之一 includes 關鍵字 (case-insensitive)
 */
export function matchesSearch(
  type: GranteeType,
  code: string | null | undefined,
  name: string | null | undefined,
  query: string,
): boolean {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  const c = (code || '').toLowerCase()
  const n = (name || '').toLowerCase()
  if (hasCode(type)) return c.includes(q) || n.includes(q)
  return n.includes(q)
}

/**
 * 過濾 + 排序候選清單
 * 優先序：code 前綴 > name 前綴 > code 包含 > name 包含
 */
export function filterAndRank(
  type: GranteeType,
  options: GranteeLovOption[],
  query: string,
  limit = 50,
): GranteeLovOption[] {
  const q = (query || '').trim().toLowerCase()
  if (!q) return options.slice(0, limit)

  const scored = options
    .map(o => {
      const c = (o.code || '').toLowerCase()
      const n = (o.name || '').toLowerCase()
      let score = -1
      if (hasCode(type) && c.startsWith(q)) score = 100
      else if (n.startsWith(q)) score = 90
      else if (hasCode(type) && c.includes(q)) score = 50
      else if (n.includes(q)) score = 40
      return { o, score }
    })
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map(x => x.o)
}

/**
 * Highlight 搜尋字（給 Combobox 候選列表用）— 回傳 [before, match, after]
 */
export function splitForHighlight(text: string, query: string): [string, string, string] {
  const t = text || ''
  const q = (query || '').trim()
  if (!q) return [t, '', '']
  const lower = t.toLowerCase()
  const i = lower.indexOf(q.toLowerCase())
  if (i < 0) return [t, '', '']
  return [t.slice(0, i), t.slice(i, i + q.length), t.slice(i + q.length)]
}
