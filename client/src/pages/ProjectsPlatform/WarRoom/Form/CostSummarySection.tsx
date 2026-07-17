/**
 * CostSummarySection — §9.3 成本核算 headline(接真 run_result · 取代 demo)
 *
 * 對應 docs/cortex-bom-import-plan.md §9.3。讀 GET /bom/summary(各廠最新 run 的成本)→ 真實成本矩陣。
 * demo 專案(data_payload.factory_matrix)仍走 FactoryMatrixSection;真 BOM 專案走這裡。
 * 註:真實成本 / margin 之後依角色機密遮罩(S2 view_true_cost)。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { BarChart3, Crown, Loader2, RefreshCw } from 'lucide-react'

const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
const pct = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

export default function CostSummarySection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [factories, setFactories] = useState<any[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    try { const r = await api.get<{ factories: any[] }>(token, `/bom/summary?projectId=${projectId}`); setFactories(r.factories || []) }
    catch (e: any) { setErr(e.message); setFactories([]) }
  }
  useEffect(() => { if (token) load() }, [token, projectId])

  async function recompute() {
    setBusy(true); setErr('')
    try { await api.post(token, '/bom/compare', { projectId, force: true }); await load() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  if (factories === null) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入成本…</div>

  if (factories.length === 0) return (
    <div className="bg-cortex-bg/40 border border-cortex-line rounded-lg p-4 text-[12px]">
      <div className="font-bold text-cortex-ink mb-1">📊 成本核算</div>
      <div className="text-cortex-muted">此專案尚無成本模型。請至「📦 BOM / 材料」建立成本模型(選廠別範本)並匯入 BOM 計算,成本會在此彙總比較。</div>
    </div>
  )

  const anyRun = factories.some((f) => f.run_id)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-bold text-cortex-ink flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-cortex-teal" /> 成本核算 · 多廠彙總</div>
        <button onClick={recompute} disabled={busy} className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] border border-cortex-line rounded hover:bg-white disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 重新計算所有廠
        </button>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      <table className="w-full text-[12px]">
        <thead className="text-cortex-muted border-b border-cortex-line">
          <tr>
            <th className="text-left px-2 py-1">廠</th>
            <th className="text-right px-2 py-1">報價 Total</th>
            <th className="text-right px-2 py-1">內部真實</th>
            <th className="text-right px-2 py-1">MVA</th>
            <th className="text-right px-2 py-1">Margin</th>
          </tr>
        </thead>
        <tbody>
          {factories.map((f) => (
            <tr key={f.case_factory_id} className={`border-b border-cortex-line/40 ${f.isCheapest ? 'bg-cortex-cyan-bg/40 font-semibold' : ''}`}>
              <td className="px-2 py-1.5">
                {f.isCheapest && <Crown className="w-3 h-3 inline text-cortex-teal mr-1" />}
                {f.factory_code} <span className="text-cortex-muted text-[9px]">{f.costing_model}</span>
              </td>
              {f.run_id ? (
                <>
                  <td className="px-2 py-1.5 text-right font-mono">{money(f.total_quote_with_nre ?? f.total_quote_usd)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-cortex-muted">{money(f.total_true_with_nre ?? f.total_true_usd)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-cortex-muted">{money(f.mva_usd)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{money(f.margin_amount_usd)} · {pct(f.gross_margin_pct)}</td>
                </>
              ) : (
                <td colSpan={4} className="px-2 py-1.5 text-right text-cortex-muted text-[11px]">尚未計算</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!anyRun && <div className="text-[11px] text-cortex-muted">尚無計算結果 —— 至「BOM/材料」匯入並算成本,或按「重新計算所有廠」。</div>}
      {factories.some((f) => Number(f.nre_per_unit_quote_usd) > 0) && (
        <div className="text-[10px] text-cortex-teal">報價 Total 已含 NRE 每台攤提(AMORTIZED · 見「🔧 NRE 成本」tab)。</div>
      )}
      <div className="text-[10px] text-cortex-muted">真實成本 / margin 之後依角色機密遮罩(S2 view_true_cost)。</div>
    </div>
  )
}
