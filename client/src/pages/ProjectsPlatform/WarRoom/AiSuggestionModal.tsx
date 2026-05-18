/**
 * AiSuggestionModal — Sprint M-11 「✨ AI 建議」按鈕 modal
 *
 * 對應 spec §12.5 Form Surface 2 + #16 智慧定價建議
 *
 * 用法:
 *   <AiSuggestionModal
 *     project={project}
 *     field="amount"
 *     fieldLabel="報價金額"
 *     onAccept={(value) => ...}
 *     onClose={() => ...}
 *   />
 */

import { useEffect, useState } from 'react'
import { X, Sparkles, Loader2, CheckCircle2, AlertTriangle, BookOpen } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type ProjectDetail } from '../api'

type Props = {
  project: ProjectDetail
  field: string
  fieldLabel: string
  onAccept: (value: any) => void
  onClose: () => void
}

type Suggestion = {
  suggested_value: any
  confidence_percent: number
  reasoning: string
  references: { project_code: string; similarity_reason: string }[]
  historical_cases_count?: number
  llm_used?: boolean
  fallback_reason?: string
  _stub?: boolean
}

export default function AiSuggestionModal({ project, field, fieldLabel, onAccept, onClose }: Props) {
  const { token } = useAuth() as any
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Suggestion | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setErr(null)
    api.post<Suggestion>(token, '/ai/pricing-suggest', {
      project_id: project.id,
      field,
      context: project.data_payload || {},
    })
      .then((r) => setData(r))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [project.id, field, token])

  const confColor =
    !data ? 'text-cortex-muted' :
    data.confidence_percent >= 75 ? 'text-cortex-green' :
    data.confidence_percent >= 50 ? 'text-amber-600' :
    'text-red-600'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-[560px] w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-cortex-teal px-5 py-3.5 text-white flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cortex-cyan-bg font-bold inline-flex items-center gap-1">
              <Sparkles size={11} /> AI 智慧定價建議
            </div>
            <div className="text-base font-bold">{fieldLabel} <span className="font-mono text-[12px] text-cortex-cyan-bg ml-1">{field}</span></div>
          </div>
          <button onClick={onClose} className="text-cortex-cyan-bg hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5">
          {loading && (
            <div className="text-center py-8 text-cortex-muted text-[13px]">
              <Loader2 size={20} className="inline animate-spin mr-1.5" />
              AI 分析中 · 撈沉澱 KB 歷史相似案 + Gemini Flash 推理…
            </div>
          )}

          {err && (
            <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-3 text-[12px] text-red-700">
              <AlertTriangle size={11} className="inline -mt-px mr-1" />
              建議失敗:{err}
            </div>
          )}

          {data && !loading && (
            <>
              {/* 建議值 + confidence */}
              <div className="bg-gradient-to-br from-purple-50 to-cortex-cyan-bg/30 border border-purple-200 rounded-lg p-4 mb-3">
                <div className="text-[10px] font-bold text-purple-700 uppercase tracking-widest mb-1">
                  建議值
                </div>
                <div className="text-2xl font-bold text-cortex-navy font-mono mb-2">
                  {data.suggested_value === null || data.suggested_value === undefined
                    ? <span className="text-cortex-muted text-[14px]">無建議</span>
                    : String(data.suggested_value)}
                </div>
                <div className={`text-[11px] font-bold inline-flex items-center gap-1 ${confColor}`}>
                  信心 {data.confidence_percent}%
                  {data._stub && <span className="ml-2 text-amber-700 bg-cortex-amber-bg px-1.5 rounded text-[9px]">stub mock</span>}
                  {data.llm_used === false && !data._stub && (
                    <span className="ml-2 text-red-700 bg-cortex-red-bg/40 px-1.5 rounded text-[9px]">LLM 失敗 fallback</span>
                  )}
                </div>
              </div>

              {/* Reasoning */}
              <div className="mb-3">
                <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1">
                  推薦理由
                </div>
                <div className="text-[12px] text-cortex-ink leading-relaxed whitespace-pre-wrap bg-cortex-bg/40 border border-cortex-line rounded p-2.5">
                  {data.reasoning || '—'}
                </div>
              </div>

              {/* References */}
              {data.references?.length > 0 && (
                <div className="mb-3">
                  <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1 inline-flex items-center gap-1">
                    <BookOpen size={11} /> 引用 · {data.historical_cases_count ?? data.references.length} 個歷史相似案
                  </div>
                  <div className="space-y-1">
                    {data.references.map((r, i) => (
                      <div key={i} className="bg-white border border-cortex-line rounded px-2.5 py-1.5 text-[11px]">
                        <span className="font-mono text-cortex-ocean font-bold">{r.project_code}</span>
                        <span className="text-cortex-muted ml-2">— {r.similarity_reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.fallback_reason && (
                <div className="bg-cortex-amber-bg/40 border border-amber-200 rounded p-2 text-[11px] text-amber-800 mb-3">
                  <AlertTriangle size={10} className="inline -mt-px mr-1" />
                  LLM 失敗 → 走 stub mock · 原因:{data.fallback_reason}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-3 border-t border-cortex-line">
                <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-cortex-muted hover:text-cortex-ink">
                  拒絕
                </button>
                <button
                  onClick={() => onAccept(data.suggested_value)}
                  disabled={data.suggested_value === null || data.suggested_value === undefined}
                  className="px-4 py-1.5 text-[12px] font-bold rounded inline-flex items-center gap-1 bg-gradient-to-r from-purple-500 to-cortex-teal text-white disabled:opacity-40"
                >
                  <CheckCircle2 size={11} /> 採用此建議
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
