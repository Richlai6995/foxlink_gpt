/**
 * StageRibbon — 戰情會議室頂部 8-stage 進度條
 *
 * 對應 HTML demo 戰情會議室頂部 ribbon + spec 對齊 OIBG RFQ 8-stage flow
 *
 * 視覺:每個 stage 是一個梯形/箭頭格,顯示
 *   - PENDING:灰底
 *   - ACTIVE:cyan 漸層底(當前)
 *   - READY_FOR_GATE:琥珀色閃(等業務確認)
 *   - DONE:深綠
 *   - SKIPPED:dashed grey
 * 標 ⚖ 為 Stage Gate(業務確認制)
 */

import { CheckCircle2, AlertTriangle, Lock as Gavel } from 'lucide-react'
import type { Stage } from '../api'

const STATUS_STYLE: Record<
  string,
  { bg: string; text: string; ring?: string; pulse?: boolean }
> = {
  PENDING:        { bg: 'bg-cortex-line-2',          text: 'text-cortex-muted' },
  ACTIVE:         { bg: 'bg-gradient-to-r from-cortex-cyan/20 to-cortex-teal/30 border border-cortex-cyan', text: 'text-cortex-navy font-bold', ring: 'ring-2 ring-cortex-cyan/40' },
  READY_FOR_GATE: { bg: 'bg-cortex-amber-bg border-2 border-cortex-amber', text: 'text-amber-900 font-bold', pulse: true },
  DONE:           { bg: 'bg-cortex-green/15 border border-cortex-green/40', text: 'text-cortex-green font-semibold' },
  SKIPPED:        { bg: 'bg-cortex-line-2 border border-dashed border-cortex-line', text: 'text-cortex-muted line-through' },
}

const STAGE_NAME_FALLBACK: Record<string, string> = {
  RECEIVE_RFQ:      '收 RFQ',
  Q_AND_A_COLLECT:  'Q&A 收集',
  Q_AND_A_FEEDBACK: 'Q&A 回客戶',
  BOM_PROVIDE:      'BOM 提供',
  PARALLEL_COLLECT: '並行 Collect',
  BOM_COST_REVIEW:  'BOM Cost',
  RFQ_COST_REVIEW:  'RFQ Cost',
  SUBMIT_QUOTE:     'Submit Final',
}

type Props = {
  stages: Stage[]
  onStageClick?: (s: Stage) => void
}

export default function StageRibbon({ stages, onStageClick }: Props) {
  if (!stages || stages.length === 0) {
    return (
      <div className="px-4 py-3 bg-white border-b border-cortex-line text-sm text-cortex-muted">
        無 stage 資料
      </div>
    )
  }

  return (
    <div className="bg-white border-b border-cortex-line px-4 py-3">
      <div className="flex items-stretch gap-1.5 overflow-x-auto">
        {stages.map((s, i) => {
          const style = STATUS_STYLE[s.status] || STATUS_STYLE.PENDING
          const name = parseI18n(s as any) || STAGE_NAME_FALLBACK[s.stage_code] || s.stage_code
          const isGate = Number(s.gate_required) === 1
          return (
            <button
              key={s.id}
              onClick={() => onStageClick?.(s)}
              className={`relative flex-1 min-w-[110px] px-2.5 py-2 rounded text-left transition ${style.bg} ${style.text} ${style.ring || ''} ${style.pulse ? 'animate-pulse' : ''} hover:brightness-95`}
              title={`${s.stage_code} · ${s.status}${s.sla_hours ? ` · SLA ${s.sla_hours}h` : ''}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-mono opacity-70">#{i + 1}</span>
                {s.status === 'DONE' && <CheckCircle2 size={11} className="text-cortex-green" />}
                {s.status === 'READY_FOR_GATE' && <AlertTriangle size={11} className="text-cortex-amber" />}
                {isGate && (
                  <span className="text-[9px] font-bold px-1 py-px rounded bg-cortex-amber-bg text-amber-700 border border-amber-300" title="Stage Gate · 業務確認制">
                    <Gavel size={9} className="inline -mt-px" /> GATE
                  </span>
                )}
              </div>
              <div className="text-[12px] font-semibold mt-1 leading-tight">{name}</div>
              {s.sla_hours && (
                <div className="text-[10px] opacity-60 mt-0.5">SLA {s.sla_hours}h</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function parseI18n(stage: any): string | null {
  const raw = stage?.stage_name_i18n
  if (!raw) return null
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    return obj['zh-TW'] || obj.zhTW || obj.en || null
  } catch {
    return null
  }
}
