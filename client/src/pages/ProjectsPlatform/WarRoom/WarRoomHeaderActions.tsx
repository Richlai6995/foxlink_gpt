/**
 * WarRoomHeaderActions — Stage Gate / Lifecycle 切換
 *
 * 對齊:
 *   - Stage Gate 業務確認(PPT slide 16 + Demo §3)
 *   - Lifecycle 5-state(DRAFT/ACTIVE/PAUSED/CLOSED/REOPENED)
 *
 * UI:
 *   - 若當前 stage READY_FOR_GATE 或 ACTIVE+gate_required → 紅琥珀「✓ 進入下一 Stage」按鈕
 *   - Lifecycle 下拉:依當前 lifecycle 列出合法轉換(spec §10)
 */

import { useState } from 'react'
import { ChevronDown, Gavel, Loader2 } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type ProjectDetail } from '../api'
import { TOKENS } from '../tokens'

const LIFECYCLE_TRANSITIONS: Record<string, { to: string; label: string }[]> = {
  DRAFT:    [{ to: 'ACTIVE', label: '啟動 → ACTIVE' }],
  ACTIVE:   [{ to: 'PAUSED', label: '暫停 → PAUSED' }, { to: 'CLOSED', label: '結案 → CLOSED' }],
  PAUSED:   [{ to: 'ACTIVE', label: '恢復 → ACTIVE' }, { to: 'CLOSED', label: '結案 → CLOSED' }],
  CLOSED:   [{ to: 'REOPENED', label: '重啟 → REOPENED' }],
  REOPENED: [{ to: 'ACTIVE', label: '回到 ACTIVE' }],
}

type Props = {
  project: ProjectDetail
  onChanged: () => void
}

export default function WarRoomHeaderActions({ project, onChanged }: Props) {
  const { token } = useAuth() as any
  const [busy, setBusy] = useState(false)
  const [lcOpen, setLcOpen] = useState(false)

  // 找當前 stage(ACTIVE 或 READY_FOR_GATE)— Stage Gate 按鈕用
  const activeStage =
    project.stages.find((s) => s.status === 'READY_FOR_GATE') ||
    project.stages.find((s) => s.status === 'ACTIVE')

  const isGate = activeStage && (
    activeStage.status === 'READY_FOR_GATE' ||
    Number(activeStage.gate_required) === 1
  )

  const advanceStage = async () => {
    if (!activeStage) return
    const notes = prompt(
      `確認進入下一 Stage(${activeStage.stage_code} → ?)\n\n備註(可空):`,
    )
    if (notes === null) return
    setBusy(true)
    try {
      await api.post(token, `/projects/${project.id}/stages/${activeStage.id}/advance`, { notes })
      onChanged()
    } catch (e: any) {
      alert('推進失敗:' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const changeLifecycle = async (toStatus: string) => {
    const reason = (toStatus === 'PAUSED' || toStatus === 'CLOSED' || toStatus === 'REOPENED')
      ? prompt(`${toStatus} 的原因(可空):`) ?? undefined
      : undefined
    if (reason === undefined && (toStatus === 'PAUSED' || toStatus === 'CLOSED' || toStatus === 'REOPENED')) return
    setBusy(true)
    setLcOpen(false)
    try {
      await api.post(token, `/projects/${project.id}/lifecycle`, { to_status: toStatus, reason })
      onChanged()
    } catch (e: any) {
      alert('Lifecycle 變更失敗:' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const transitions = LIFECYCLE_TRANSITIONS[project.lifecycle_status] || []

  return (
    <div className="flex items-center gap-2 ml-2">
      {/* Stage Gate 按鈕(只在有 active stage 時顯示)*/}
      {activeStage && (
        <button
          onClick={advanceStage}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold rounded transition hover:brightness-110 disabled:opacity-50"
          style={
            isGate
              ? { background: TOKENS.amber, color: '#fff' }
              : { background: TOKENS.cyan, color: TOKENS.navy }
          }
          title={`推進 stage ${activeStage.stage_code}(下一 stage 自動啟動 SLA)`}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Gavel size={11} />}
          {isGate ? '⚖ 業務確認 → 下一 Stage' : '推進 Stage'}
        </button>
      )}

      {/* Lifecycle dropdown */}
      {transitions.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setLcOpen((v) => !v)}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border transition hover:brightness-95 disabled:opacity-50"
            style={{ background: '#fff', borderColor: TOKENS.line, color: TOKENS.text }}
          >
            生命週期
            <ChevronDown size={11} />
          </button>
          {lcOpen && (
            <div
              className="absolute right-0 top-[110%] z-30 min-w-[180px] rounded shadow-cortex-lg overflow-hidden border"
              style={{ background: '#fff', borderColor: TOKENS.line }}
            >
              {transitions.map((t) => (
                <button
                  key={t.to}
                  onClick={() => changeLifecycle(t.to)}
                  className="w-full text-left px-3 py-2 text-[12px] transition hover:bg-cortex-bg"
                  style={{ color: TOKENS.text, background: '#fff' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
