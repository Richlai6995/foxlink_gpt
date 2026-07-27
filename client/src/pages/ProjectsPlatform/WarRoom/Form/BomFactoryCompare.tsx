/**
 * BomFactoryCompare — 多廠矩陣(B-3d · 對齊 v0.12「多廠矩陣」+ Rival3 Unit Cost 表)
 *
 * 列 = 產品配置組合(顏色×包裝 cartesian);欄 = 廠別(case_factory)。
 * cell = 該 (配置, 廠) 的 total(讀 run 快取:bom_cs_run 以 (cf, config sig) 各留一筆 ready)。
 * 缺格 on-demand:「算」→ POST /compute(帶 valueIds · force)→ 落庫即快取。「算全部」逐格補。
 * 標記:👑 全域最便宜組合;每列(同配置)最便宜廠 teal 底。
 * 註:不同 costing_model total 不可直接比(UI 標示);單廠也顯示(單欄矩陣)。
 */

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { BarChart3, Loader2, Crown, Play, RefreshCw } from 'lucide-react'

type Cell = { runId: number; total: number; totalTrue: number; marginUsd: number; marginPct: number; computedAt?: string }
type Matrix = {
  factories: { caseFactoryId: number; factoryCode: string; costingModel: string }[]
  combos: { sig: string; valueIds: number[]; labels: { dim: string; value: string }[] }[]
  cells: Record<string, Cell>
}

const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
const comboLabel = (c: Matrix['combos'][0]) => (c.labels.length ? c.labels.map((l) => l.value).join(' · ') : '(無配置)')

export default function BomFactoryCompare({ projectId, bomInstanceId, factoryCount }: { projectId: number; bomInstanceId?: number | null; factoryCount: number }) {
  const { token } = useAuth() as any
  const [mx, setMx] = useState<Matrix | null>(null)
  const [busyCell, setBusyCell] = useState<string | null>(null)   // "cf|sig" 計算中
  const [busyAll, setBusyAll] = useState(false)
  const [progress, setProgress] = useState('')
  const [ok, setOk] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    try { setMx(await api.get<Matrix>(token, `/bom/project/${projectId}/matrix`)) }
    catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { if (token && projectId) load() }, [token, projectId])

  async function computeCell(cfId: number, combo: Matrix['combos'][0]) {
    if (!bomInstanceId) { setErr('先匯入 BOM 才能試算'); return }
    setBusyCell(`${cfId}|${combo.sig}`); setErr('')
    try {
      await api.post(token, '/bom/compute', { caseFactoryId: cfId, bomInstanceId, valueIds: combo.valueIds, force: true })
      await load()
    } catch (e: any) { setErr(e.message) } finally { setBusyCell(null) }
  }

  // 一鍵算全格:缺格模式只補缺;recomputeAll=true 全格重算(改價後刷新快取)
  async function computeAll(recomputeAll = false) {
    if (!mx) { setErr('矩陣尚未載入,請按重新整理'); return }
    if (!bomInstanceId) { setErr('此專案尚未匯入 BOM,無法試算'); return }
    setBusyAll(true); setErr(''); setOk('')
    const targets: { cfId: number; combo: Matrix['combos'][0] }[] = []
    for (const c of mx.combos) for (const f of mx.factories) {
      if (recomputeAll || !mx.cells[`${f.caseFactoryId}|${c.sig}`]) targets.push({ cfId: f.caseFactoryId, combo: c })
    }
    let done = 0, fails = 0, firstErr = ''
    for (const m of targets) {
      setProgress(`${++done}/${targets.length}`)
      try { await api.post(token, '/bom/compute', { caseFactoryId: m.cfId, bomInstanceId, valueIds: m.combo.valueIds, force: true }) }
      catch (e: any) { fails += 1; if (!firstErr) firstErr = e?.message || String(e) }   // 單格失敗不中斷,但要浮出
    }
    setProgress(''); setBusyAll(false); await load()
    if (fails) setErr(`${fails}/${targets.length} 格計算失敗:${firstErr}${/401|unauthor|token/i.test(firstErr) ? '(登入逾期 → 請重新登入後再試)' : ''}`)
    else setOk(`✓ 已${recomputeAll ? '重算' : '補算'} ${targets.length} 格(數字若相同代表資料未變)`)
  }

  // 全域最便宜 + 每列最便宜
  const marks = useMemo(() => {
    if (!mx) return { globalKey: null as string | null, rowMin: {} as Record<string, number> }
    let globalKey: string | null = null; let globalMin = Infinity
    const rowMin: Record<string, number> = {}
    for (const c of mx.combos) {
      let rmin = Infinity
      for (const f of mx.factories) {
        const cell = mx.cells[`${f.caseFactoryId}|${c.sig}`]
        if (cell && cell.total < rmin) rmin = cell.total
        if (cell && cell.total < globalMin) { globalMin = cell.total; globalKey = `${f.caseFactoryId}|${c.sig}` }
      }
      rowMin[c.sig] = rmin
    }
    return { globalKey, rowMin }
  }, [mx])

  if (factoryCount < 1) return null
  const missingN = mx ? mx.combos.length * mx.factories.length - Object.keys(mx.cells).filter((k) => mx.cells[k]).length : 0
  const mixedModel = mx && mx.factories.some((f) => mx.factories.some((g) => g.costingModel !== f.costingModel))

  return (
    <div className="border border-cortex-line rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] font-semibold text-cortex-ink flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-cortex-teal" /> 多廠矩陣
          <span className="text-cortex-muted font-normal">(配置 {mx?.combos.length ?? '…'} × 廠 {mx?.factories.length ?? factoryCount})</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 常駐:缺格 → 補缺;全齊 → 全格重算(改價後刷新)。一鍵 = 各配置×各廠「分開」各算一價 */}
          <button onClick={() => computeAll(missingN === 0)} disabled={busyAll || !bomInstanceId || !mx}
            title={!bomInstanceId ? '此專案尚未匯入 BOM(無法試算)' : (missingN > 0 ? '補算缺格' : '全格重算(改價後刷新)')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cortex-navy text-white text-[12px] rounded hover:opacity-90 disabled:opacity-40">
            {busyAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {busyAll && progress ? `計算中 ${progress}` : (missingN > 0 ? `算全部(缺 ${missingN} 格)` : '重算全部')}
          </button>
          {!bomInstanceId && <span className="text-[10px] text-amber-700">先匯入 BOM 才能試算</span>}
          <button onClick={load} title="重新整理" className="p-1 text-cortex-muted hover:text-cortex-teal"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {err && <div className="text-[11px] text-red-600 break-all">{err}</div>}
      {ok && <div className="text-[11px] text-green-700">{ok}</div>}

      {mx && (
        <div className="overflow-x-auto">
          <table className="text-[11px] min-w-full">
            <thead className="text-cortex-muted border-b border-cortex-line">
              <tr>
                <th className="text-left px-2 py-1 whitespace-nowrap">配置 \ 廠別</th>
                {mx.factories.map((f) => (
                  <th key={f.caseFactoryId} className="text-right px-2 py-1 whitespace-nowrap">
                    {f.factoryCode} <span className="text-[9px] font-normal">{f.costingModel === 'FULL_MVA' ? 'FULL' : 'SIMP'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mx.combos.map((c) => (
                <tr key={c.sig || '__none'} className="border-b border-cortex-line/40">
                  <td className="px-2 py-1 whitespace-nowrap">
                    {c.labels.length
                      ? c.labels.map((l, i) => <span key={i} className="text-[9px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-1 py-0.5 mr-1">{l.value}</span>)
                      : <span className="text-cortex-muted">(無配置)</span>}
                  </td>
                  {mx.factories.map((f) => {
                    const key = `${f.caseFactoryId}|${c.sig}`
                    const cell = mx.cells[key]
                    const isRowMin = cell && mx.factories.length > 1 && cell.total === marks.rowMin[c.sig]
                    const isGlobal = key === marks.globalKey
                    return (
                      <td key={key} className={`px-2 py-1 text-right font-mono whitespace-nowrap ${isRowMin ? 'bg-cortex-cyan-bg/50 font-semibold' : ''}`}>
                        {cell ? (
                          <span title={`true ${money(cell.totalTrue)} · margin ${money(cell.marginUsd)} · run#${cell.runId}`}>
                            {isGlobal && <Crown className="w-3 h-3 inline text-amber-500 mr-0.5" />}
                            {money(cell.total)}
                          </span>
                        ) : busyCell === key ? (
                          <Loader2 className="w-3 h-3 inline animate-spin text-cortex-muted" />
                        ) : (
                          <button onClick={() => computeCell(f.caseFactoryId, c)} disabled={!!busyCell || busyAll || !bomInstanceId}
                            className="text-[10px] text-cortex-teal hover:underline disabled:opacity-40">算</button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-cortex-muted">
        👑 全域最便宜 · teal 底 = 該配置最便宜廠 · cell 為該組合最近一次試算(改價後重算該格)· 待詢價料件僅計已詢價
        {mixedModel ? ' · ⚠️ 不同成本模型 total 不可直接比' : ''}
      </div>
    </div>
  )
}
