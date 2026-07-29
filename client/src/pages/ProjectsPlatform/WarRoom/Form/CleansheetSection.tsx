/**
 * CleansheetSection — 🧮 Cleansheet (MVA) 檢視(v0.16 plan #9)
 *
 * component × process 矩陣(run cells pivot)+ baseline bar + KPI 卡 + cell hover 顯公式(step trace)。
 * 整包內部成本結構 → server 403 gate(HOST/admin);PARTICIPANT 顯示鎖定訊息。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Loader2, Lock, Calculator } from 'lucide-react'

const m4 = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(4)}` : '—')
const COMP_LABEL: Record<string, string> = {
  DL_CPU: 'DL 直接人力', IDL_CPU: 'IDL 間接人力', EQUIP_MRO: '設備 MRO', EQUIP_DEPR: '設備折舊',
  IND_MAT: '間接材料', FACILITY: '廠房', FREIGHT: '運費', VAT: 'VAT', LOSS: 'Loss',
}
const COMP_GROUP: Record<string, string> = {
  DL_CPU: 'LABOR', IDL_CPU: 'LABOR', EQUIP_MRO: 'EQUIPMENT', EQUIP_DEPR: 'EQUIPMENT',
  IND_MAT: 'OTHERS', FACILITY: 'FACILITY', FREIGHT: 'OTHERS', VAT: 'OTHERS', LOSS: 'OTHERS',
}

type CaseRow = { case_factory_id: number; factory_code: string; costing_model: string }

export default function CleansheetSection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [cases, setCases] = useState<CaseRow[]>([])
  const [activeCf, setActiveCf] = useState<number | ''>('')
  const [qtys, setQtys] = useState<string[]>(['BASE'])
  const [qty, setQty] = useState('BASE')
  const [data, setData] = useState<any>(null)
  const [locked, setLocked] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) return
    api.get<{ cases: CaseRow[] }>(token, `/bom/cases?projectId=${projectId}`).then((r) => {
      setCases(r.cases || [])
      if (r.cases?.length) setActiveCf((p) => p || r.cases[0].case_factory_id)
    }).catch(() => {})
    api.get<any>(token, `/bom/project/${projectId}/matrix`).then((m) => {
      if (m?.qtyScenarios?.length) setQtys(m.qtyScenarios)
    }).catch(() => {})
  }, [token, projectId])

  useEffect(() => {
    if (!token || !activeCf) return
    setData(null); setErr(''); setLocked(false)
    api.get<any>(token, `/bom/case/${activeCf}/cleansheet?qty=${qty}`)
      .then(setData)
      .catch((e: any) => { if (/403|視角/.test(e.message)) setLocked(true); else setErr(e.message) })
  }, [token, activeCf, qty])

  if (locked) return (
    <div className="p-6 text-center space-y-2">
      <Lock className="w-8 h-8 mx-auto text-cortex-muted" />
      <div className="text-[13px] font-bold text-cortex-ink">Cleansheet 已鎖定</div>
      <div className="text-[11px] text-cortex-muted">內部成本結構需完整成本視角(HOST/admin)。右上角切換視角後重試。</div>
    </div>
  )

  const mx = data?.matrix
  const bl = data?.baseline
  const kpi = data?.kpi
  const rowSum = (co: string) => (mx ? mx.processes.reduce((a: number, p: string) => a + (mx.cells[co]?.[p]?.v || 0), 0) : 0)
  const colSum = (pr: string) => (mx ? mx.components.reduce((a: number, c: string) => a + (mx.cells[c]?.[pr]?.v || 0), 0) : 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2"><Calculator className="w-4 h-4" /> Cleansheet (MVA)
          <span className="text-[10px] text-cortex-muted font-normal">cost component × 製程 · 加工成本結構(內部)</span>
        </h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          {cases.map((c) => (
            <button key={c.case_factory_id} onClick={() => setActiveCf(c.case_factory_id)}
              className={`px-2.5 py-1 rounded text-[11px] border ${activeCf === c.case_factory_id ? 'bg-cortex-navy text-white border-cortex-navy' : 'bg-white border-cortex-line text-cortex-muted'}`}>
              {c.factory_code} <span className="text-[8px]">{c.costing_model === 'FULL_MVA' ? 'FULL' : 'SIMP'}</span>
            </button>
          ))}
          {qtys.length > 1 && qtys.map((q) => (
            <button key={q} onClick={() => setQty(q)}
              className={`px-1.5 py-0.5 rounded text-[10px] border ${qty === q ? 'bg-cortex-teal text-white border-cortex-teal' : 'bg-white border-cortex-line text-cortex-muted'}`}>{q}</button>
          ))}
        </div>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      {!data && !err && <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入 Cleansheet…</div>}

      {/* Baseline bar */}
      {data && (
        <div className="flex items-center gap-3 flex-wrap text-[10px] bg-cortex-bg/40 border border-cortex-line rounded p-2">
          <span className="font-bold text-cortex-ink text-[11px]">Baseline</span>
          {bl ? (
            <>
              <span>版本 <b className="font-mono">{bl.versionLabel || '—'}</b></span>
              <span>DL 時薪 <b className="font-mono">${Number(bl.dlWagePerHr || 0).toFixed(2)}</b></span>
              <span>SG&A <b className="font-mono">{Number(bl.sgaPct || 0)}%</b></span>
              <span>Profit <b className="font-mono">{Number(bl.profitPct || 0)}%</b></span>
              {bl.vatPct != null && <span>VAT <b className="font-mono">{Number(bl.vatPct)}%</b></span>}
              {bl.annualDemand != null && <span>預設年量 <b className="font-mono">{Number(bl.annualDemand).toLocaleString('en-US')}</b></span>}
            </>
          ) : <span className="text-cortex-muted">(此廠未綁 baseline)</span>}
          {data.runId && <span className="ml-auto text-cortex-muted">run#{data.runId} · {data.qty}</span>}
        </div>
      )}

      {/* KPI 卡 */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['MVA Total', kpi.mvaTotal, 'text-cortex-teal'],
            ['SG&A + Profit', (kpi.sga || 0) + (kpi.profit || 0), 'text-cortex-ink'],
            ['SMT 段 MVA', kpi.smtMva, 'text-cortex-ink'],
            ['組裝段 MVA', kpi.assyMva, 'text-cortex-ink'],
          ].map(([label, v, cls]: any) => (
            <div key={label} className="border border-cortex-line rounded-lg p-2 text-center">
              <div className="text-[9px] text-cortex-muted">{label}</div>
              <div className={`text-[15px] font-mono font-bold ${cls}`}>{m4(v)}</div>
            </div>
          ))}
        </div>
      )}

      {/* component × process 矩陣 */}
      {mx ? (
        <div className="overflow-x-auto border border-cortex-line rounded-lg">
          <table className="text-[10px] min-w-full">
            <thead className="text-cortex-muted border-b border-cortex-line bg-cortex-bg/40">
              <tr>
                <th className="text-left px-2 py-1 sticky left-0 bg-cortex-bg/90">Cost Component \ 製程</th>
                {mx.processes.map((p: string) => <th key={p} className="text-right px-2 py-1 whitespace-nowrap font-mono">{p}</th>)}
                <th className="text-right px-2 py-1 font-bold">Σ</th>
              </tr>
            </thead>
            <tbody>
              {mx.components.map((co: string) => (
                <tr key={co} className="border-b border-cortex-line/30">
                  <td className="px-2 py-1 whitespace-nowrap sticky left-0 bg-white">
                    <span className={`text-[8px] px-1 rounded mr-1 ${COMP_GROUP[co] === 'LABOR' ? 'bg-blue-50 text-blue-700' : COMP_GROUP[co] === 'EQUIPMENT' ? 'bg-purple-50 text-purple-700' : COMP_GROUP[co] === 'FACILITY' ? 'bg-amber-50 text-amber-700' : 'bg-cortex-bg text-cortex-muted'}`}>{COMP_GROUP[co] || ''}</span>
                    {COMP_LABEL[co] || co}
                  </td>
                  {mx.processes.map((pr: string) => {
                    const cell = mx.cells[co]?.[pr]
                    return (
                      <td key={pr} className={`px-2 py-1 text-right font-mono ${cell?.v ? '' : 'text-cortex-line'}`}
                        title={cell?.formula || undefined}>
                        {cell?.v ? m4(cell.v) : '·'}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1 text-right font-mono font-bold">{m4(rowSum(co))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-cortex-line font-bold">
                <td className="px-2 py-1 sticky left-0 bg-white">Σ per 製程</td>
                {mx.processes.map((pr: string) => <td key={pr} className="px-2 py-1 text-right font-mono">{m4(colSum(pr))}</td>)}
                <td className="px-2 py-1 text-right font-mono text-cortex-teal">{m4(kpi?.mvaTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : data && (
        <div className="text-[11px] text-cortex-muted">此廠 / 量情境尚無試算 run —— 至「📦 BOM / 材料」按 ④ 算成本後回來看。</div>
      )}

      {/* Roll-up */}
      {kpi && (
        <div className="flex items-center gap-2 flex-wrap text-[11px] bg-cortex-cyan-bg/40 border border-cortex-teal/30 rounded p-2 font-mono">
          <span>材料 {m4(kpi.material)}</span><span>＋</span>
          <span className="text-cortex-teal font-bold">MVA {m4(kpi.mvaTotal)}</span><span>＋</span>
          <span>SG&A {m4(kpi.sga)}</span><span>＋</span>
          <span>Profit {m4(kpi.profit)}</span><span>=</span>
          <span className="font-bold">TC/unit {m4(kpi.total)}</span>
        </div>
      )}
      <div className="text-[10px] text-cortex-muted">cell hover 顯示計算公式(step trace)· 參數維護走「📦 BOM / 材料」的成本模型匯入/匯出</div>
    </div>
  )
}
