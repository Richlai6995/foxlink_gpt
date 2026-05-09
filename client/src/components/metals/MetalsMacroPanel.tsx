/**
 * MetalsMacroPanel — 宏觀數據(DXY / EURUSD / TWDUSD / FED / UST10Y / VIX / WTI 等)
 *
 * 改版(2026-05-10):
 *   - 一列一項(原本兩欄,user 反饋擠壓)
 *   - 加 ? icon hover/click 顯示名詞解釋
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, HelpCircle } from 'lucide-react'
import api from '../../lib/api'

interface MacroRow {
  indicator_code: string
  indicator_name?: string
  value: number
  unit?: string
  as_of_date?: string
  day_change_pct?: number | null
}

// 各指標的解釋(中文)— 採購視角
const MACRO_GLOSSARY: Record<string, string> = {
  DXY: '美元指數 — 衡量美元相對 6 種主要貨幣(歐元/日圓/英鎊等)的強弱。DXY 漲 → 美元走強 → 通常壓抑黃金/銅等以美元計價的大宗商品。',
  EURUSD: '歐元兌美元匯率 — 全球流動性最大的外匯對。歐元升 = 美元弱 = 大宗商品有支撐。',
  TWDUSD: '美元兌新台幣匯率 — 影響台廠進口貴金屬的台幣成本。匯率漲 → 進口成本變高。',
  FED_FUNDS: '聯邦基金利率 — Fed 訂的銀行間隔夜拆借利率。利率高 → 持有黃金的機會成本高 → 通常壓抑黃金;但若 Fed 是因抗通膨而升息,黃金避險屬性反而支撐。',
  UST10Y: '美國 10 年期公債殖利率 — 全球避險資金成本指標。殖利率漲 → 持有不生息資產(黃金)成本高 → 黃金易跌。',
  VIX: '恐慌指數 — 標普 500 隱含波動率,> 30 代表市場恐慌。VIX 飆通常黃金避險買盤湧入。',
  WTI: '西德州中質原油期貨 — 反映全球工業需求景氣。WTI 強 → 經濟熱 → 工業金屬(銅/鎳/鋁)有支撐。',
}

interface Props {
  viewDate?: string  // 'YYYY-MM-DD'
}

export default function MetalsMacroPanel({ viewDate }: Props) {
  const [rows, setRows] = useState<MacroRow[]>([])
  const [loading, setLoading] = useState(false)
  const [openCode, setOpenCode] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (viewDate) params.as_of = viewDate
    api.get('/metals/macro', { params }).then(r => setRows(r.data || [])).finally(() => setLoading(false))
  }, [viewDate])

  // 點 popover 外面 close
  useEffect(() => {
    if (!openCode) return
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenCode(null)
      }
    }
    setTimeout(() => document.addEventListener('click', onClick), 0)
    return () => document.removeEventListener('click', onClick)
  }, [openCode])

  return (
    <div className="bg-white border rounded-lg overflow-hidden">
      {/* 標題色帶(配合 user 設計圖的黃底)*/}
      <div className="bg-gradient-to-r from-amber-100 to-yellow-50 border-b border-amber-200 px-3 py-1.5 flex items-center gap-2">
        <span className="text-sm font-bold text-amber-900">📈 宏觀數據(當日最新)</span>
        {loading && <Loader2 size={12} className="animate-spin text-slate-400" />}
      </div>

      {rows.length === 0 && !loading ? (
        <div className="text-xs text-slate-400 py-3 px-3 text-center">暫無宏觀資料</div>
      ) : (
        <div className="divide-y">
          {rows.map(r => {
            const desc = MACRO_GLOSSARY[r.indicator_code]
            const isOpen = openCode === r.indicator_code
            return (
              <div key={r.indicator_code} className="relative px-3 py-1.5 hover:bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs text-slate-800 min-w-[68px]">{r.indicator_code}</span>
                  {r.indicator_name && (
                    <span className="text-[11px] text-slate-500 truncate flex-1">{r.indicator_name}</span>
                  )}
                  <span className="font-mono text-sm text-slate-700 tabular-nums">
                    {Number.isFinite(r.value) ? r.value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                  </span>
                  {r.day_change_pct != null && Number.isFinite(r.day_change_pct) && (
                    <span className={`text-[11px] font-medium tabular-nums w-[52px] text-right ${
                      r.day_change_pct > 0 ? 'text-emerald-600' : r.day_change_pct < 0 ? 'text-red-600' : 'text-slate-400'
                    }`}>
                      {r.day_change_pct > 0 ? '+' : ''}{r.day_change_pct.toFixed(2)}%
                    </span>
                  )}
                  {desc && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenCode(isOpen ? null : r.indicator_code) }}
                      className={`p-0.5 rounded ${isOpen ? 'text-amber-600 bg-amber-50' : 'text-slate-300 hover:text-amber-600 hover:bg-amber-50'}`}
                      title="點看名詞解釋"
                    >
                      <HelpCircle size={13} />
                    </button>
                  )}
                </div>
                {isOpen && desc && (
                  <div
                    ref={popoverRef}
                    className="absolute right-2 top-9 z-20 w-[280px] bg-white border border-amber-300 rounded-lg shadow-lg p-3 text-[11px] leading-relaxed text-slate-700"
                  >
                    <div className="font-bold text-amber-700 mb-1">{r.indicator_code} — {r.indicator_name || ''}</div>
                    <div>{desc}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
