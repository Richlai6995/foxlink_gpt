/**
 * CleansheetPanel — Sprint M-12 三廠成本拆解 AI 分析
 *
 * 對應 spec §12.10.4 #12 Cleansheet 草稿
 *
 * UI:
 *   - 三廠 cost_breakdown 輸入欄(預設 VN/CN/IN)
 *   - 點「✨ AI 分析」→ 顯示推薦廠 + analysis_md + advantages / risks
 */

import { useState } from 'react'
import { X, Sparkles, Loader2, AlertTriangle, Trophy, ArrowRight, Award } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type ProjectDetail } from '../api'

type Factory = {
  code: string
  name: string
  cost_breakdown: {
    pcb?: number
    smt?: number
    assembly?: number
    test?: number
    tooling?: number
    overhead?: number
    total?: number
  }
}

type AnalysisResult = {
  totals?: { code: string; name: string; total: number }[]
  sorted_by_cost?: { code: string; name: string; total: number }[]
  cheapest?: string
  most_expensive?: string
  cost_delta?: number
  cost_delta_percent?: number
  component_winners?: Record<string, { winner: string; value: number; max_value: number }>
  recommended_factory?: string | null
  summary?: string
  analysis_md?: string
  advantages?: { factory: string; points: string[] }[]
  risks?: { factory: string; points: string[] }[]
  llm_used?: boolean
  fallback_reason?: string
  _stub?: boolean
}

const DEFAULT_FACTORIES: Factory[] = [
  { code: 'VN', name: '越南', cost_breakdown: { pcb: 1.20, smt: 0.80, assembly: 1.50, test: 0.30 } },
  { code: 'CN', name: '中國', cost_breakdown: { pcb: 1.10, smt: 0.90, assembly: 1.40, test: 0.35 } },
  { code: 'IN', name: '印度', cost_breakdown: { pcb: 1.35, smt: 0.75, assembly: 1.65, test: 0.40 } },
]

export default function CleansheetPanel({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const { token } = useAuth() as any
  const [factories, setFactories] = useState<Factory[]>(DEFAULT_FACTORIES)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dp = (project.data_payload as any) || {}

  const updateBreakdown = (i: number, key: keyof Factory['cost_breakdown'], val: string) => {
    const v = val === '' ? undefined : Number(val)
    setFactories((arr) => arr.map((f, idx) => idx === i
      ? { ...f, cost_breakdown: { ...f.cost_breakdown, [key]: v as any } }
      : f))
  }

  const analyze = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.post<AnalysisResult>(token, '/ai/cleansheet-analyze', {
        project_id: project.id,
        factories,
        target: {
          quantity: dp.quantity,
          due_date: dp.dueDate || dp.due_date,
          customer: dp.customer,
        },
      })
      setResult(r)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-[920px] w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-cortex-navy to-cortex-teal px-5 py-3.5 text-white flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cortex-cyan font-bold inline-flex items-center gap-1">
              <Sparkles size={11} /> AI #12 Cleansheet 三廠成本分析
            </div>
            <div className="text-base font-bold">三廠成本拆解 + 對比說明</div>
          </div>
          <button onClick={onClose} className="text-cortex-cyan-bg hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Factory inputs */}
          <div className="bg-cortex-bg/40 border border-cortex-line rounded-lg p-3 mb-3">
            <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-2">
              三廠 cost_breakdown(USD / pcs)
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-cortex-muted">
                  <th className="text-left py-1 px-1">廠</th>
                  <th className="text-right py-1 px-1">PCB</th>
                  <th className="text-right py-1 px-1">SMT</th>
                  <th className="text-right py-1 px-1">組裝</th>
                  <th className="text-right py-1 px-1">測試</th>
                  <th className="text-right py-1 px-1">總 (計算)</th>
                </tr>
              </thead>
              <tbody>
                {factories.map((f, i) => {
                  const total = ((f.cost_breakdown.pcb || 0) + (f.cost_breakdown.smt || 0) +
                                 (f.cost_breakdown.assembly || 0) + (f.cost_breakdown.test || 0))
                  return (
                    <tr key={f.code} className="border-t border-cortex-line/50">
                      <td className="py-1 px-1 font-bold text-cortex-ink">
                        <span className="inline-block w-8 font-mono">{f.code}</span>
                        {f.name}
                      </td>
                      {(['pcb', 'smt', 'assembly', 'test'] as const).map((k) => (
                        <td key={k} className="py-1 px-1">
                          <input
                            type="number"
                            step="0.01"
                            value={f.cost_breakdown[k] ?? ''}
                            onChange={(e) => updateBreakdown(i, k, e.target.value)}
                            className="w-16 px-1 py-0.5 border border-cortex-line rounded text-right font-mono"
                          />
                        </td>
                      ))}
                      <td className="py-1 px-1 text-right font-mono font-bold text-cortex-ocean">
                        {total.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Target context */}
          <div className="text-[11px] text-cortex-muted mb-3">
            <span className="font-bold text-cortex-ink">目標:</span>
            <span className="ml-1 font-mono">quantity={dp.quantity || '—'} · due_date={dp.dueDate || dp.due_date || '—'} · customer={dp.customer || '—'}</span>
          </div>

          {/* Analyze button */}
          {!result && (
            <button
              onClick={analyze}
              disabled={loading}
              className="px-4 py-2 text-[13px] font-bold rounded inline-flex items-center gap-1.5 bg-gradient-to-r from-cortex-navy to-cortex-teal text-white disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? '分析中…' : '✨ AI 分析'}
            </button>
          )}

          {err && (
            <div className="mt-3 bg-cortex-red-bg/40 border border-red-200 rounded p-2 text-[11px] text-red-700">
              <AlertTriangle size={11} className="inline -mt-px mr-1" /> {err}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              {/* Recommended */}
              <div className="bg-gradient-to-br from-cortex-cyan-bg to-purple-50 border border-cortex-cyan/40 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy size={18} className="text-cortex-amber" />
                  <span className="text-[10px] font-bold text-cortex-teal uppercase tracking-widest">推薦廠</span>
                  {result._stub && <span className="text-[9px] text-amber-700 bg-cortex-amber-bg px-1.5 py-0.5 rounded font-bold">stub mock</span>}
                </div>
                <div className="text-2xl font-bold text-cortex-navy">
                  {result.recommended_factory
                    ? <>🏭 {factories.find((f) => f.code === result.recommended_factory)?.name || result.recommended_factory}({result.recommended_factory})</>
                    : '—'}
                </div>
                {result.summary && (
                  <div className="text-[12px] text-cortex-text mt-2 leading-relaxed">{result.summary}</div>
                )}
              </div>

              {/* Cost diff */}
              {result.sorted_by_cost && (
                <div className="bg-white border border-cortex-line rounded-lg p-3">
                  <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">
                    總成本排序 · cheapest → most expensive
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {result.sorted_by_cost.map((t, i) => (
                      <span
                        key={t.code}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded font-mono text-[12px] ${
                          i === 0 ? 'bg-cortex-green-bg text-cortex-green font-bold' :
                          i === result.sorted_by_cost!.length - 1 ? 'bg-cortex-red-bg/40 text-red-700' :
                          'bg-cortex-line-2 text-cortex-text'
                        }`}
                      >
                        {i === 0 && <Award size={10} />}
                        {t.code} {t.total.toFixed(2)}
                        {i < result.sorted_by_cost!.length - 1 && <ArrowRight size={10} className="ml-1 text-cortex-muted" />}
                      </span>
                    ))}
                    {result.cost_delta_percent != null && (
                      <span className="ml-auto text-[11px] text-cortex-muted">
                        差 <strong className="text-cortex-ocean">{result.cost_delta_percent.toFixed(1)}%</strong>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Component winners */}
              {result.component_winners && Object.keys(result.component_winners).length > 0 && (
                <div className="bg-white border border-cortex-line rounded-lg p-3">
                  <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">
                    各成本項目最低廠
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(result.component_winners).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-[11px]">
                        <span className="text-cortex-muted w-16">{k}</span>
                        <span className="bg-cortex-cyan-bg text-cortex-teal px-1.5 py-0.5 rounded font-mono font-bold">{v.winner}</span>
                        <span className="font-mono text-cortex-ocean">{v.value}</span>
                        <span className="text-cortex-muted">最高 {v.max_value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Analysis markdown */}
              {result.analysis_md && (
                <div className="bg-cortex-bg/40 border border-cortex-line rounded-lg p-4">
                  <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">
                    AI 分析
                  </div>
                  <div className="text-[12px] text-cortex-ink leading-relaxed whitespace-pre-wrap">
                    {result.analysis_md}
                  </div>
                </div>
              )}

              {/* Advantages / risks */}
              {(result.advantages?.length || result.risks?.length) && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-cortex-green-bg/40 border border-cortex-green/30 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-cortex-green uppercase tracking-widest mb-1">✅ 優勢</div>
                    {result.advantages?.map((a, i) => (
                      <div key={i} className="text-[11px] mb-1">
                        <span className="font-mono font-bold text-cortex-ink">{a.factory}:</span>
                        <ul className="list-disc pl-5 text-cortex-text">
                          {a.points.map((p, j) => <li key={j}>{p}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <div className="bg-cortex-amber-bg/40 border border-amber-300 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-1">⚠ 風險</div>
                    {result.risks?.map((r, i) => (
                      <div key={i} className="text-[11px] mb-1">
                        <span className="font-mono font-bold text-cortex-ink">{r.factory}:</span>
                        <ul className="list-disc pl-5 text-cortex-text">
                          {r.points.map((p, j) => <li key={j}>{p}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => { setResult(null) }}
                className="text-[11px] text-cortex-ocean hover:underline"
              >
                ↻ 重新分析
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
