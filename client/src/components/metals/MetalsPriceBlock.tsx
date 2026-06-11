/**
 * MetalsPriceBlock — 左欄報價(基本金屬 / 貴金屬 各一個)
 * 每張卡 = 一橫排:metal_code  中文名  USD 價格  D% W% M%
 *
 * 改版(2026-05-10):從兩行(主價/D-W-M)壓成一行,讓 11 個金屬不會擠
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
  week_baseline_date?: string | null    // 2026-05-25: W% baseline 日期(上週末交易日)
  month_baseline_date?: string | null   // 2026-05-25: M% baseline 日期(上月末交易日)
}

interface Props {
  title: string
  rows: PriceRow[]
  metalsAllowed: string[]
  loading: boolean
  selectedCode: string
  onSelect: (code: string) => void
  focusedSet?: Set<string>
  theme?: 'lme' | 'precious'
}

export default function MetalsPriceBlock({ title, rows, metalsAllowed, loading, selectedCode, onSelect, focusedSet, theme = 'lme' }: Props) {
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

      {/* 欄位標題小提示 — 基本金屬 USD/Ton,貴金屬 USD/Troy Oz */}
      <div className="grid items-center gap-0.5 px-1.5 py-1 text-[9px] text-slate-400 border-b bg-slate-50/50"
        style={{ gridTemplateColumns: '34px minmax(0,1fr) 56px 34px 42px 42px 42px' }}>
        <span>代碼</span>
        <span></span>
        <span className="text-right">{theme === 'precious' ? 'USD/Troy Oz' : 'USD/Ton'}</span>
        <span className="text-right text-[8px]">日期</span>
        <span className="text-right">D%</span>
        <span className="text-right">W%</span>
        <span className="text-right">M%</span>
      </div>

      <div>
        {visible.length === 0 && (
          <div className="text-xs text-slate-400 py-3 px-3 text-center">(偏好設定中無此分類金屬)</div>
        )}
        {visible.map(r => {
          const code = String(r.metal_code).toUpperCase()
          const isSelected = code === selectedCode
          const noData = r.price_usd == null || !Number.isFinite(Number(r.price_usd))
          return (
            <button
              key={code}
              onClick={() => onSelect(code)}
              className={`w-full grid items-center gap-0.5 px-1.5 py-1.5 text-xs border-b last:border-b-0 transition ${
                isSelected ? (theme === 'precious' ? 'bg-emerald-50' : 'bg-amber-50') : 'hover:bg-slate-50'
              } ${noData ? 'opacity-50' : ''}`}
              style={{ gridTemplateColumns: '34px minmax(0,1fr) 56px 34px 42px 42px 42px' }}
              title={`${code} ${r.source ? '來源: ' + r.source : ''}`}
            >
              <span className="font-mono font-bold text-slate-800 text-left">{code}</span>
              <span className="text-[11px] text-slate-500 text-left truncate">{r.metal_name || ''}</span>
              <span className="font-mono text-slate-700 text-right tabular-nums">
                {noData ? '—' : Number(r.price_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              {/* 2026-06-11: 資料日期直接顯示在價格旁(原本只在 hover tooltip),避免採購誤會切日期看不到當天 row */}
              <span className="text-[9px] text-slate-400 text-right tabular-nums">
                {noData || !r.as_of_date ? '—' : (() => {
                  const m = r.as_of_date.match(/^\d{4}-(\d{2})-(\d{2})$/)
                  return m ? `${Number(m[1])}/${Number(m[2])}` : r.as_of_date
                })()}
              </span>
              <ChangePct
                value={r.day_change_pct ?? null}
                tooltip={`今日 vs 前一交易日`}
              />
              <ChangePct
                value={r.week_change_pct ?? null}
                tooltip={r.week_baseline_date ? `最新 vs 7 天前 (${r.week_baseline_date})` : '最新 vs 7 天前'}
              />
              <ChangePct
                value={r.month_change_pct ?? null}
                tooltip={r.month_baseline_date ? `最新 vs 30 天前 (${r.month_baseline_date})` : '最新 vs 30 天前'}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ChangePct({ value, tooltip }: { value: number | null; tooltip?: string }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-slate-300 text-right tabular-nums" title={tooltip}>—</span>
  }
  const cls = value > 0 ? 'text-emerald-600' : value < 0 ? 'text-red-600' : 'text-slate-400'
  return (
    <span className={`${cls} text-right tabular-nums font-medium`} title={tooltip}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}
