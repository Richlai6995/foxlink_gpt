/**
 * MarginSection — 📈 Margin Analysis(v0.16 plan #11)
 *
 * 讀矩陣 run 快取(配置×廠×量)→ KPI + margin heatmap;Top Markup 料件(tier markup 排序)。
 * S2:PARTICIPANT 的 cells margin 被 server 砍 → 顯鎖定卡(不需另設 gate)。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Loader2, Lock, TrendingUp } from 'lucide-react'

const m4 = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
const pc = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')
const heatClass = (p: number | null | undefined) => {
  if (typeof p !== 'number') return 'bg-cortex-bg text-cortex-muted'
  if (p < 0) return 'bg-red-100 text-red-700 font-bold'
  if (p < 0.05) return 'bg-amber-100 text-amber-700'
  if (p < 0.15) return 'bg-teal-50 text-teal-700'
  return 'bg-teal-200 text-teal-900 font-bold'
}

export default function MarginSection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [mx, setMx] = useState<any>(null)
  const [top, setTop] = useState<any[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) return
    api.get<any>(token, `/bom/project/${projectId}/matrix`).then(setMx).catch((e: any) => setErr(e.message))
    api.get<any>(token, `/bom/project/${projectId}/latest-instance`).then((i) => {
      if (i?.bomInstanceId) api.get<any>(token, `/bom/instances/${i.bomInstanceId}/top-markup?limit=10`).then((r) => setTop(r.items || [])).catch(() => {})
    }).catch(() => {})
  }, [token, projectId])

  if (err) return <div className="text-[11px] text-red-600">{err}</div>
  if (!mx) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入 Margin…</div>

  const qtys: string[] = mx.qtyScenarios || ['BASE']
  const cellsWithMargin = Object.values(mx.cells || {}).filter((c: any) => typeof c.marginPct === 'number')
  const masked = Object.keys(mx.cells || {}).length > 0 && cellsWithMargin.length === 0

  if (masked) return (
    <div className="p-6 text-center space-y-2">
      <Lock className="w-8 h-8 mx-auto text-cortex-muted" />
      <div className="text-[13px] font-bold text-cortex-ink">Margin Analysis 已鎖定</div>
      <div className="text-[11px] text-cortex-muted">需完整成本視角(HOST/admin)。右上角切換視角後重試。</div>
    </div>
  )

  const pcts = cellsWithMargin.map((c: any) => c.marginPct)
  const kpi = pcts.length ? {
    max: Math.max(...pcts), min: Math.min(...pcts),
    avg: pcts.reduce((a: number, b: number) => a + b, 0) / pcts.length,
    avgUsd: cellsWithMargin.reduce((a: number, c: any) => a + (c.marginUsd || 0), 0) / cellsWithMargin.length,
  } : null

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Margin Analysis
        <span className="text-[10px] text-cortex-muted font-normal">配置 × 廠 × 量 毛利熱圖 · Top Markup 料件(內部)</span>
      </h3>

      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[['Max Margin', pc(kpi.max)], ['Min Margin', pc(kpi.min)], ['Avg Margin', pc(kpi.avg)], ['Avg Margin $', m4(kpi.avgUsd)]].map(([l, v]) => (
            <div key={l as string} className="border border-cortex-line rounded-lg p-2 text-center">
              <div className="text-[9px] text-cortex-muted">{l}</div>
              <div className="text-[15px] font-mono font-bold text-cortex-ink">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* heatmap:每 qty 一塊(配置 rows × 廠 cols) */}
      {qtys.map((q) => {
        const has = mx.combos.some((c: any) => mx.factories.some((f: any) => mx.cells[`${f.caseFactoryId}|${c.sig}|${q}`]))
        if (!has) return null
        return (
          <div key={q} className="border border-cortex-line rounded-lg overflow-hidden">
            <div className="px-3 py-1.5 text-[11px] font-bold text-cortex-ink bg-cortex-bg/40 border-b border-cortex-line">量情境:{q}</div>
            <div className="overflow-x-auto">
              <table className="text-[10px] min-w-full">
                <thead className="text-cortex-muted border-b border-cortex-line"><tr>
                  <th className="text-left px-2 py-1">配置 \ 廠</th>
                  {mx.factories.map((f: any) => <th key={f.caseFactoryId} className="text-center px-2 py-1">{f.factoryCode}</th>)}
                </tr></thead>
                <tbody>
                  {mx.combos.map((c: any) => (
                    <tr key={c.sig || '__none'} className="border-b border-cortex-line/30">
                      <td className="px-2 py-1 whitespace-nowrap">
                        {c.labels.length ? c.labels.map((l: any, i: number) => <span key={i} className="text-[9px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-1 py-0.5 mr-1">{l.value}</span>) : <span className="text-cortex-muted">(無配置)</span>}
                      </td>
                      {mx.factories.map((f: any) => {
                        const cell = mx.cells[`${f.caseFactoryId}|${c.sig}|${q}`]
                        return (
                          <td key={f.caseFactoryId} className={`px-2 py-1.5 text-center font-mono ${heatClass(cell?.marginPct)}`}
                            title={cell ? `total ${m4(cell.total)} · margin ${m4(cell.marginUsd)}` : '未算'}>
                            {cell ? pc(cell.marginPct) : '·'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* Top Markup */}
      <div className="border border-cortex-line rounded-lg overflow-hidden">
        <div className="px-3 py-1.5 text-[11px] font-bold text-cortex-ink bg-cortex-bg/40 border-b border-cortex-line">Top Markup 料件(對客加價貢獻 高→低)</div>
        {top.length ? (
          <table className="w-full text-[10px]">
            <thead className="text-cortex-muted border-b border-cortex-line"><tr>
              <th className="text-left px-2 py-1">模組</th><th className="text-left px-2 py-1">Description</th>
              <th className="text-right px-2 py-1">Qty</th><th className="text-right px-2 py-1">True</th>
              <th className="text-right px-2 py-1">Quote</th><th className="text-right px-2 py-1">Markup%</th>
              <th className="text-right px-2 py-1">加價/台</th>
            </tr></thead>
            <tbody>
              {top.map((r: any, i: number) => (
                <tr key={i} className="border-b border-cortex-line/30">
                  <td className="px-2 py-1">{r.module_category}</td>
                  <td className="px-2 py-1 max-w-[280px] truncate" title={r.description}>{r.description}</td>
                  <td className="px-2 py-1 text-right font-mono">{r.qty}</td>
                  <td className="px-2 py-1 text-right font-mono text-cortex-muted">{m4(r.true_cost_usd)}</td>
                  <td className="px-2 py-1 text-right font-mono">{m4(r.quote_price)}</td>
                  <td className="px-2 py-1 text-right font-mono">{pc(r.markup_pct)}</td>
                  <td className="px-2 py-1 text-right font-mono text-cortex-teal font-bold">{m4(r.markup_ext)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-3 text-[10px] text-cortex-muted">無 markup 資料(fixture 假價 true=quote 時本表為空;真實案匯入雙價後這裡會列加價主力料)。</div>
        )}
      </div>
    </div>
  )
}
