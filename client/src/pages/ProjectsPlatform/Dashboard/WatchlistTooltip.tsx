/**
 * WatchlistTooltip — ⭐ Status SUMMARY 三處之三:Watchlist hover 完整摘要
 *
 * 對齊 PPT slide 14
 *   "等客戶 Q&A 回覆,後段 BOM 提供已 ready"
 *   🔵 進度:Stage 3, BOM 預先做
 *   🟡 風險:客戶 5 天沒回, SLA 80%
 *   🟢 待辦:BPM 主動 follow up
 */

import { useEffect, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type StatusSummary } from '../api'

export default function WatchlistTooltip({ projectId }: { projectId: number }) {
  const { token } = useAuth() as any
  const [summary, setSummary] = useState<StatusSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get<{ summary: StatusSummary }>(token, `/dashboard/summary/${projectId}`)
      .then((r) => { if (!cancelled) { setSummary(r.summary); setErr(null) } })
      .catch((e) => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, token])

  return (
    <div className="absolute top-full right-0 mt-1 z-30 w-[380px] bg-gradient-to-br from-cortex-navy to-cortex-teal text-white rounded-lg shadow-cortex-lg border border-white/10 p-4 pointer-events-none">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Sparkles size={12} className="text-cortex-cyan" />
        <span className="text-[10px] font-bold text-cortex-cyan tracking-widest">⭐ STATUS SUMMARY · AI #21</span>
        {summary?._mock && <span className="ml-auto text-[9px] text-cortex-cyan/60">(mock,Sprint F 接 LLM)</span>}
      </div>

      {loading && (
        <div className="text-[11px] text-cortex-cyan-bg flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> 摘要產生中…
        </div>
      )}

      {err && (
        <div className="text-[11px] text-red-300">⚠ {err}</div>
      )}

      {summary && (
        <>
          <div className="text-[13px] font-bold italic text-white mb-3 leading-snug">
            {summary.one_liner}
          </div>

          <SummaryRow icon="🔵" label="進度" color="bg-cortex-cyan/15 border-cortex-cyan text-cortex-cyan-bg">
            {summary.progress}
          </SummaryRow>
          <SummaryRow icon="🟡" label="風險" color="bg-cortex-amber/15 border-cortex-amber text-amber-100">
            {summary.risk}
          </SummaryRow>
          <SummaryRow icon="🟢" label="待辦 (24h)" color="bg-cortex-green/15 border-cortex-green text-green-100">
            {summary.todo}
          </SummaryRow>

          <div className="text-[9px] text-white/40 italic mt-3 leading-relaxed">
            由 AI 跨 7 channel + Form + Tasks 自動生成 · cache 30 min · 三處顯示之三(Watchlist hover)
          </div>
        </>
      )}
    </div>
  )
}

function SummaryRow({ icon, label, color, children }: { icon: string; label: string; color: string; children: React.ReactNode }) {
  return (
    <div className={`border-l-2 px-2.5 py-1.5 rounded-r mb-1.5 ${color}`}>
      <div className="text-[10px] font-bold tracking-widest mb-0.5">{icon} {label}</div>
      <div className="text-[11px] leading-relaxed">{children}</div>
    </div>
  )
}
