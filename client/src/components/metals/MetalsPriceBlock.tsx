/**
 * MetalsPriceBlock — 左欄報價卡片(基本金屬 / 貴金屬各一個)
 * 每張卡顯示:metal_code / 中文名 / USD 價 / 日 % / 週 % / 月 %
 */
import { Loader2 } from 'lucide-react'
import { useMemo } from 'react'

interface PriceRow {
  metal_code: string
  metal_name?: string
  group: string
  price_usd: number | null
  as_of_date?: string
  source?: string
  day_change_pct?: number | null
  week_change_pct?: number | null
  month_change_pct?: number | null
}

interface Props {
  title: string
  rows: PriceRow[]
  metalsAllowed: string[]   // 該 block 該顯示哪些金屬代碼
  loading: boolean
  selectedCode: string
  onSelect: (code: string) => void
  focusedSet?: Set<string>  // user 偏好;若空 = 顯示全部
  /** 標題色帶配色 — 'lme'(黃) / 'precious'(綠) */
  theme?: 'lme' | 'precious'
}

export default function MetalsPriceBlock({ title, rows, metalsAllowed, loading, selectedCode, onSelect, focusedSet, theme = 'lme' }: Props) {
  // 把 rows index by metal_code,以保證 metalsAllowed 順序
  const visible = useMemo(() => {
    const byCode = new Map<string, PriceRow>()
    for (const r of rows) byCode.set(String(r.metal_code).toUpperCase(), r)
    const filtered = metalsAllowed.filter(c => !focusedSet || focusedSet.size === 0 || focusedSet.has(c))
    return filtered.map(c => byCode.get(c) || {
      metal_code: c, group: title, price_usd: null,
      day_change_pct: null, week_change_pct: null, month_change_pct: null,
    } as PriceRow)
  }, [rows, metalsAllowed, focusedSet, title])

  const headerCls = theme === 'precious'
    ? 'bg-gradient-to-r from-emerald-100 to-green-50 border-emerald-200 text-emerald-900'
    : 'bg-gradient-to-r from-amber-100 to-yellow-50 border-amber-200 text-amber-900'

  return (
    <div className="bg-white border rounded-lg overflow-hidden">
      <div className={`flex items-center justify-between px-3 py-1.5 border-b ${headerCls}`}>
        <h3 className="text-sm font-bold">{title}</h3>
        {loading && <Loader2 size={14} className="animate-spin opacity-50" />}
      </div>
      <div className="p-2 space-y-1.5">
        {visible.length === 0 && (
          <div className="text-xs text-slate-400 py-3 text-center">(偏好設定中無此分類金屬)</div>
        )}
        {visible.map(r => {
          const code = String(r.metal_code).toUpperCase()
          const isSelected = code === selectedCode
          const noData = r.price_usd == null || !Number.isFinite(Number(r.price_usd))
          return (
            <button
              key={code}
              onClick={() => onSelect(code)}
              className={`w-full text-left px-2 py-1.5 rounded border transition ${
                isSelected
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              } ${noData ? 'opacity-50' : ''}`}
              title={`${code} 資料日期 ${r.as_of_date || '—'}${r.source ? ' / ' + r.source : ''}`}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono font-bold text-sm text-slate-800">{code}</span>
                <span className="text-[11px] text-slate-500">{r.metal_name || ''}</span>
                <span className="ml-auto font-mono text-sm text-slate-700">
                  {noData ? '—' : Number(r.price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
              {!noData && (
                <div className="flex items-center justify-between mt-0.5 text-[11px]">
                  <span className="text-slate-400">D / W / M</span>
                  <div className="flex items-center gap-2 font-mono">
                    <ChangePct value={r.day_change_pct ?? null} />
                    <ChangePct value={r.week_change_pct ?? null} />
                    <ChangePct value={r.month_change_pct ?? null} />
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ChangePct({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-slate-300">—</span>
  const cls = value > 0 ? 'text-emerald-600' : value < 0 ? 'text-red-600' : 'text-slate-400'
  return <span className={cls}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>
}
