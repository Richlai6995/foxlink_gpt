/**
 * BomFactoryCompare — FM 多廠成本對比(factory_matrix MVP · 報價平台核心賣點)
 *
 * 對應 docs/cortex-bom-import-plan.md §16 MVP。同一份 BOM 在專案多廠各算一次 → 比報價/真實/margin → 標最便宜。
 * 只在專案有 ≥2 個 case_factory 時顯示。後端 POST /bom/compare(算每廠 · run 各自落庫)。
 * 註:不同 costing_model(FULL vs SIMPLIFIED)total 不可直接比 · UI 標示 model。
 */

import { useState } from 'react'
import { api, ApiError } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { BarChart3, Loader2, Crown } from 'lucide-react'

const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
const pct = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

export default function BomFactoryCompare({ projectId, bomInstanceId, factoryCount }: { projectId: number; bomInstanceId?: number | null; factoryCount: number }) {
  const { token } = useAuth() as any
  const [rows, setRows] = useState<any[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [gate, setGate] = useState(false)
  const [err, setErr] = useState('')

  async function doCompare(force = false) {
    setBusy(true); setErr(''); setGate(false)
    try {
      const r = await api.post(token, '/bom/compare', { projectId, ...(bomInstanceId ? { bomInstanceId } : {}), ...(force ? { force: true } : {}) })
      setRows(r.factories || [])
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) setGate(true)
      else setErr(e.message)
    } finally { setBusy(false) }
  }

  if (factoryCount < 2) return null

  return (
    <div className="border border-cortex-line rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-cortex-ink flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-cortex-teal" /> 多廠成本比較 <span className="text-cortex-muted font-normal">({factoryCount} 廠)</span>
        </div>
        <button onClick={() => doCompare()} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cortex-navy text-white text-[12px] rounded hover:opacity-90 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />} 比較所有廠
        </button>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      {gate && (
        <div className="text-[11px] text-amber-700">有未詢價料件,材料不完整。
          <button onClick={() => doCompare(true)} className="ml-1 underline font-semibold">強制比較(僅已詢價材料)</button>
        </div>
      )}
      {rows && (
        <table className="w-full text-[11px]">
          <thead className="text-cortex-muted border-b border-cortex-line">
            <tr>
              <th className="text-left px-2 py-1">廠</th>
              <th className="text-right px-2 py-1">報價 Total</th>
              <th className="text-right px-2 py-1">真實</th>
              <th className="text-right px-2 py-1">MVA</th>
              <th className="text-right px-2 py-1">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.caseFactoryId} className={`border-b border-cortex-line/40 ${f.isCheapest ? 'bg-cortex-cyan-bg/40 font-semibold' : ''}`}>
                <td className="px-2 py-1">
                  {f.isCheapest && <Crown className="w-3 h-3 inline text-cortex-teal mr-1" />}
                  {f.factoryCode} <span className="text-cortex-muted text-[9px]">{f.costingModel}</span>
                </td>
                <td className="px-2 py-1 text-right font-mono">{f.error ? <span className="text-red-500">{f.error}</span> : money(f.total)}</td>
                <td className="px-2 py-1 text-right font-mono text-cortex-muted">{money(f.totalTrue)}</td>
                <td className="px-2 py-1 text-right font-mono text-cortex-muted">{money(f.mva)}</td>
                <td className="px-2 py-1 text-right font-mono">{typeof f.marginUsd === 'number' ? `${money(f.marginUsd)} · ${pct(f.marginPct)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows && rows.some((f) => f.costingModel && rows.some((g) => g.costingModel && g.costingModel !== f.costingModel)) && (
        <div className="text-[10px] text-cortex-muted">⚠️ 不同成本模型(FULL vs SIMPLIFIED)total 不可直接比,僅供參考。</div>
      )}
    </div>
  )
}
