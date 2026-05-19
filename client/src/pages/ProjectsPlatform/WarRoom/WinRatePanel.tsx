/**
 * WinRatePanel — Sprint O · 贏單機率預測(spec §16.4 / Demo §8.5)
 *
 * Phase 3 MVP:規則式 + LLM 解讀,顯示 W/L probability + 主要因素 + 提升勝率建議
 */

import { useEffect, useState } from 'react'
import { X, TrendingUp, TrendingDown, Loader2, AlertTriangle, Trophy, Target, Activity, BookOpen } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type ProjectDetail } from '../api'

type Factor = { name: string; value: any; weight: number; direction: 'positive' | 'negative' }
type Prediction = {
  project_id: number
  win_rate_percent: number
  confidence: 'low' | 'mid' | 'high'
  backend: 'rule' | 'sklearn' | 'vertex'
  features: any
  factors: Factor[]
  similar_cases: number
  reasoning_md?: string | null
  _stub?: boolean
}

export default function WinRatePanel({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const { token } = useAuth() as any
  const [data, setData] = useState<Prediction | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.post<Prediction>(token, '/ai/win-rate-predict', { project_id: project.id })
      .then((r) => setData(r))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, token])

  const wr  = data?.win_rate_percent ?? 0
  const lr  = 100 - wr
  const ringColor =
    wr >= 70 ? 'text-cortex-green'   :
    wr >= 50 ? 'text-cortex-teal'    :
    wr >= 30 ? 'text-amber-500'      :
               'text-red-500'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-[920px] w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="bg-gradient-to-r from-cortex-navy to-purple-700 px-5 py-3.5 text-white flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cortex-cyan font-bold inline-flex items-center gap-1">
              <Trophy size={11} /> AI #17 贏單機率預測
            </div>
            <div className="text-base font-bold">spec §16.4 預測能力 C 層</div>
          </div>
          <button onClick={onClose} className="text-cortex-cyan-bg hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="text-center py-12 text-cortex-muted text-[13px]">
              <Loader2 size={20} className="inline animate-spin mr-1.5" />
              抽 features + 跑規則式 + LLM 解讀…
            </div>
          )}
          {err && (
            <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-3 text-[12px] text-red-700">
              <AlertTriangle size={11} className="inline -mt-px mr-1" /> {err}
            </div>
          )}

          {data && !loading && (
            <div className="grid grid-cols-[280px_1fr] gap-5">
              {/* Left: Win-rate ring */}
              <div className="text-center">
                <div className={`relative inline-block ${ringColor}`}>
                  <svg width="180" height="180" viewBox="0 0 180 180">
                    <circle cx="90" cy="90" r="74" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="14" />
                    <circle
                      cx="90" cy="90" r="74" fill="none"
                      stroke="currentColor" strokeWidth="14" strokeLinecap="round"
                      strokeDasharray={`${(wr / 100) * 465} 465`}
                      transform="rotate(-90 90 90)"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-[42px] font-extrabold leading-none">{wr}%</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-cortex-muted mt-1">WIN</div>
                  </div>
                </div>

                <div className="mt-3 inline-flex items-center gap-1.5 text-[11px]">
                  <span className={`px-1.5 py-0.5 rounded font-bold text-white ${
                    data.confidence === 'high' ? 'bg-cortex-green' :
                    data.confidence === 'mid'  ? 'bg-amber-500'    :
                                                  'bg-cortex-muted'
                  }`}>
                    {data.confidence === 'high' ? '高信心' : data.confidence === 'mid' ? '中信心' : '低信心'}
                  </span>
                  <span className="text-cortex-muted">based on {data.similar_cases} 歷史相似案</span>
                </div>

                <div className="mt-2 text-[10px] text-cortex-muted">
                  backend:<strong className="font-mono">{data.backend}</strong>
                  {data._stub && <span className="ml-1 text-amber-700 bg-cortex-amber-bg px-1 rounded">stub</span>}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-1.5 text-[11px]">
                  <div className="bg-cortex-green-bg/40 border border-cortex-green/30 rounded p-2">
                    <div className="text-[9px] text-cortex-green font-bold">WIN</div>
                    <div className="font-mono font-bold text-cortex-green text-[14px]">{wr}%</div>
                  </div>
                  <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-2">
                    <div className="text-[9px] text-red-600 font-bold">LOSS</div>
                    <div className="font-mono font-bold text-red-600 text-[14px]">{lr}%</div>
                  </div>
                </div>
              </div>

              {/* Right: factors + reasoning */}
              <div>
                {/* Features summary */}
                <div className="bg-cortex-bg/40 border border-cortex-line rounded p-3 mb-3">
                  <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-1.5 inline-flex items-center gap-1">
                    <Target size={11} /> 案件特徵
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                    {[
                      { k: 'customer', v: data.features?.customer },
                      { k: 'part_no', v: data.features?.part_no },
                      { k: 'quantity', v: data.features?.quantity },
                      { k: 'BU#', v: data.features?.bu_id },
                      { k: 'priority', v: data.features?.priority_score },
                      { k: 'season', v: data.features?.season_month + '月' },
                      { k: 'BU win rate', v: data.features?.bu_win_rate != null ? `${Math.round(data.features.bu_win_rate * 100)}%` : '—' },
                      { k: 'task done/total', v: `${data.features?.task_done || 0}/${data.features?.task_total || 0}` },
                    ].filter((x) => x.v != null).map(({ k, v }) => (
                      <div key={k} className="text-cortex-text">
                        <span className="text-cortex-muted text-[9px] mr-1">{k}:</span>
                        <span className="text-cortex-ink font-bold">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Factors */}
                <div className="mb-3">
                  <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-1.5 inline-flex items-center gap-1">
                    <Activity size={11} /> 影響因素
                  </div>
                  {data.factors.length === 0 ? (
                    <div className="text-[11px] text-cortex-muted italic">無強力因素 · 預測落在 base rate</div>
                  ) : (
                    <div className="space-y-1">
                      {data.factors.map((f, i) => (
                        <div key={i} className={`flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border ${
                          f.direction === 'positive'
                            ? 'bg-cortex-green-bg/40 border-cortex-green/30'
                            : 'bg-cortex-red-bg/40 border-red-200'
                        }`}>
                          {f.direction === 'positive'
                            ? <TrendingUp size={12} className="text-cortex-green" />
                            : <TrendingDown size={12} className="text-red-600" />}
                          <span className="flex-1 text-cortex-ink font-semibold">{f.name}</span>
                          <span className="font-mono text-cortex-text">{String(f.value)}</span>
                          <span className="text-[9px] font-mono text-cortex-muted">w={f.weight}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reasoning */}
                {data.reasoning_md && (
                  <div className="bg-gradient-to-br from-purple-50 to-cortex-cyan-bg/30 border border-purple-200 rounded p-3">
                    <div className="text-[10px] font-bold text-purple-700 uppercase tracking-widest mb-1.5 inline-flex items-center gap-1">
                      <BookOpen size={11} /> AI 解讀(Gemini Flash)
                    </div>
                    <div className="text-[12px] text-cortex-ink leading-relaxed whitespace-pre-wrap">
                      {data.reasoning_md}
                    </div>
                  </div>
                )}

                {!data.reasoning_md && data._stub && (
                  <div className="bg-cortex-amber-bg/40 border border-amber-200 rounded p-2 text-[11px] text-amber-800">
                    📌 Stub 模式 · 設 PROJECTS_PLATFORM_USE_LLM=true 看 LLM 解讀 + 提升勝率建議
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
