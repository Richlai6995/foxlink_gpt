/**
 * ProjectCard — 對齊 HTML demo .proj-card
 *
 * 主結構:
 *   ┌─────────────────────────────────┐
 *   │ ID · type · 🔒    [lifecycle pill]│   ← head
 *   │ 標題                              │
 *   │ 客戶 · $金額 · 📅 due             │   ← meta
 *   │ [pause / reopen / ai summary]    │   ← conditional banners
 *   │ P? ▓▓▓░ 70%        avatars       │   ← foot
 *   └─────────────────────────────────┘
 *
 * Sprint A:基本資料對 backend Project type;ai_summary / progress / sla / members count
 *   等需要 AI / 進度計算的欄位先用 fallback,Sprint C-F 補。
 */

import { User, DollarSign, Calendar, Lock, Pause, RotateCcw, Sparkles } from 'lucide-react'
import type { Project } from '../api'
import { LIFECYCLE_COLORS } from '../tokens'

type Props = {
  project: Project & {
    // Sprint A 用 mock,Sprint C-F 補
    customer?: string
    amount_display?: string  // "$182,500" or "Tier-A" or "▒▒▒"
    due?: string
    progress?: number
    priority?: number
    sla?: 'green' | 'amber' | 'red'
    pause_reason?: string | null
    note?: string | null
    ai_summary?: string | null
    members?: { initial: string }[]
    confidential?: boolean
  }
  onClick?: () => void
}

const TYPE_COLOR: Record<string, string> = {
  QUOTE:     'bg-cortex-cyan-bg text-cortex-teal border-cortex-cyan/30',
  GENERAL:   'bg-cortex-line text-cortex-text border-cortex-line',
  IT:        'bg-cortex-ocean-bg text-cortex-ocean border-blue-300',
  TRAINING:  'bg-amber-100 text-amber-700 border-amber-200',
}

const SLA_BG: Record<string, string> = {
  green: 'bg-cortex-green text-white',
  amber: 'bg-cortex-amber text-white',
  red:   'bg-cortex-red text-white',
}

export default function ProjectCard({ project: p, onClick }: Props) {
  const lc = LIFECYCLE_COLORS[p.lifecycle_status] || LIFECYCLE_COLORS.DRAFT
  const typeColor = TYPE_COLOR[p.type_code] || TYPE_COLOR.GENERAL
  const slaCls = SLA_BG[p.sla || 'green']
  const progress = Math.max(0, Math.min(100, p.progress ?? 0))
  const isConf = !!p.confidential
  const title = p.data_payload?.title || p.project_code

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg border ${
        isConf ? 'border-amber-300 ring-1 ring-amber-200/50' : 'border-cortex-line'
      } shadow-cortex-sm hover:shadow-cortex hover:-translate-y-px transition-all cursor-pointer p-4 flex flex-col gap-2.5`}
    >
      {/* Head */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="font-mono text-[12px] text-cortex-ocean font-semibold">{p.project_code}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${typeColor}`}>
            {p.type_code}
          </span>
          {isConf && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
              <Lock size={9} /> 機密
            </span>
          )}
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${lc.pill}`}>
          {lc.label}
        </span>
      </div>

      {/* Title */}
      <div className="text-[14px] font-semibold text-cortex-ink leading-snug line-clamp-2 min-h-[2.5rem]">
        {title}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[12px] text-cortex-muted flex-wrap">
        {p.customer && (
          <span className="inline-flex items-center gap-1">
            <User size={11} className="opacity-70" />
            <span className="text-cortex-text">{p.customer}</span>
          </span>
        )}
        {p.amount_display && (
          <span className="inline-flex items-center gap-1">
            <DollarSign size={11} className="opacity-70" />
            <span className="text-cortex-text font-medium">{p.amount_display}</span>
          </span>
        )}
        {p.due && (
          <span className="inline-flex items-center gap-1">
            <Calendar size={11} className="opacity-70" />
            <span className="font-mono">{p.due}</span>
          </span>
        )}
      </div>

      {/* Conditional banners */}
      {p.pause_reason && (
        <div className="text-[11px] text-amber-800 bg-cortex-amber-bg px-2 py-1 rounded flex items-center gap-1">
          <Pause size={11} /> {p.pause_reason}
        </div>
      )}
      {p.note && (
        <div className="text-[11px] text-red-800 bg-cortex-red-bg px-2 py-1 rounded flex items-center gap-1">
          <RotateCcw size={11} /> {p.note}
        </div>
      )}

      {/* AI SUMMARY(三處顯示之一:列表行下)*/}
      {p.ai_summary && (
        <div className="text-[11px] text-cortex-teal bg-gradient-to-b from-cortex-cyan-bg to-white px-2.5 py-1.5 rounded border-l-2 border-cortex-cyan flex gap-1.5 items-start">
          <span className="text-[9px] font-bold text-cortex-cyan bg-cortex-navy px-1 py-px rounded font-mono shrink-0 mt-px inline-flex items-center gap-0.5">
            <Sparkles size={8} /> AI
          </span>
          <span className="italic leading-snug">{p.ai_summary}</span>
        </div>
      )}

      {/* Foot */}
      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${slaCls}`}>
            P{p.priority ?? '-'}
          </span>
          <div className="flex-1 h-1.5 bg-cortex-line-2 rounded-full overflow-hidden min-w-[60px]">
            <div
              className="h-full bg-gradient-to-r from-cortex-cyan to-cortex-teal transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-cortex-muted font-semibold w-8 text-right">{progress}%</span>
        </div>
        <div className="flex -space-x-1.5">
          {(p.members || []).slice(0, 3).map((m, i) => (
            <div
              key={i}
              className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-cyan-400 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white"
            >
              {m.initial}
            </div>
          ))}
          {(p.members?.length ?? 0) > 3 && (
            <div className="w-6 h-6 rounded-full bg-slate-300 text-slate-700 text-[9px] font-bold flex items-center justify-center border-2 border-white">
              +{(p.members?.length ?? 0) - 3}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
