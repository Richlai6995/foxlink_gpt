/**
 * FactoryMatrixV07 — 🏭 多廠成本矩陣(v0.7 三維度 · 照 v0.12/v0.16 原設計)
 *
 * Toggle bar(Qty / PKG / Show True / Show Margin)+ 三張 KPI 卡(最便宜組合 / MVA SPREAD / 年量影響)
 * + Excel 式主表:欄 = 廠(Made In X · Option A/B/C),列 = MVA / Material per 變體 / SG&A+Profit /
 * Total per 變體(紅底 · ★ 最便宜)/(Show True → True 列 / Show Margin → Gross Margin 列)。
 * 資料 = /matrix run 快取(cf|sig|qty);缺格 on-demand 算。S2:true/margin 被 server 砍 → toggle 鎖。
 */

import { useEffect, useMemo, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Loader2, Crown, Play, RefreshCw, Lock, FileSpreadsheet } from 'lucide-react'

const m3 = (v: any) => (typeof v === 'number' ? `US$ ${v.toFixed(3)}` : '—')
const pc = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')
const kfmt = (n: number | null) => (n ? (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)) : '')
const FACTORY_NAME: Record<string, string> = { CN: 'China', VN: 'Vietnam', TW: 'Taiwan', TH: 'Thailand', MY: 'Malaysia', IN: 'India', MX: 'Mexico' }
const OPTION = ['A', 'B', 'C', 'D', 'E', 'F']
const FACTORY_HEAD: Record<string, string> = { CN: 'bg-blue-50 text-blue-800 border-blue-200', VN: 'bg-orange-50 text-orange-800 border-orange-200', TW: 'bg-green-50 text-green-800 border-green-200' }

type Cell = { runId: number; total: number; totalTrue?: number | null; marginUsd?: number | null; marginPct?: number | null; material?: number; materialTrue?: number; mva?: number; sga?: number; profit?: number; nreQuote?: number }

export default function FactoryMatrixV07({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [mx, setMx] = useState<any>(null)
  const [qty, setQty] = useState('BASE')
  const [pkgId, setPkgId] = useState<number | 0>(0)
  const [showTrue, setShowTrue] = useState(false)
  const [showMargin, setShowMargin] = useState(false)
  const [busyCell, setBusyCell] = useState('')
  const [busyAll, setBusyAll] = useState(false)
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    try { setMx(await api.get<any>(token, `/bom/project/${projectId}/matrix`)) }
    catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { if (token) load() }, [token, projectId])   // eslint-disable-line

  const dims = mx?.dimensions || []
  const colorDim = dims.find((d: any) => /顏色|COLOR/i.test(d.dimCode))
  const pkgDim = dims.find((d: any) => /包裝|PKG|PACK/i.test(d.dimCode))
  const colors: { id: number | null; code: string }[] = colorDim?.values?.length ? colorDim.values : [{ id: null, code: '' }]
  const pkgs: { id: number; code: string }[] = pkgDim?.values || []
  useEffect(() => { if (pkgs.length && !pkgId) setPkgId(pkgs[0].id) }, [mx])   // eslint-disable-line

  const qtyDetail = (mx?.qtyScenarioDetails || []).find((d: any) => d.code === qty)
  const annualQty = qtyDetail?.targetQty || Number((project.data_payload as any)?.quantity) || null

  const sigOf = (colorId: number | null) => [colorId, pkgs.length ? pkgId : null].filter(Boolean).sort((a: any, b: any) => a - b).join(',')
  const cellOf = (cfId: number, colorId: number | null): Cell | undefined => mx?.cells?.[`${cfId}|${sigOf(colorId)}|${qty}`]

  // 切片統計(KPI + 缺格)
  const stats = useMemo(() => {
    if (!mx) return null
    const entries: { cf: any; color: any; cell: Cell }[] = []
    let missing = 0
    for (const f of mx.factories) for (const c of colors) {
      const cell = cellOf(f.caseFactoryId, c.id)
      if (cell) entries.push({ cf: f, color: c, cell }); else missing += 1
    }
    if (!entries.length) return { entries, missing, cheapest: null, mvaSpread: null, annualImpact: null, maxTotal: null }
    const sorted = [...entries].sort((a, b) => a.cell.total - b.cell.total)
    const cheapest = sorted[0], most = sorted[sorted.length - 1]
    const mvas = mx.factories.map((f: any) => cellOf(f.caseFactoryId, colors[0].id)?.mva).filter((v: any) => typeof v === 'number')
    return {
      entries, missing,
      cheapest, maxTotal: most.cell.total,
      savePct: most.cell.total > 0 ? (most.cell.total - cheapest.cell.total) / most.cell.total : 0,
      mvaSpread: mvas.length > 1 ? Math.max(...mvas) - Math.min(...mvas) : null,
      annualImpact: annualQty ? (most.cell.total - cheapest.cell.total) * annualQty : null,
    }
  }, [mx, qty, pkgId, colors.length])   // eslint-disable-line

  const hasTrue = !!stats?.entries?.some((e) => typeof e.cell.totalTrue === 'number' && e.cell.totalTrue !== e.cell.total) || !!stats?.entries?.some((e) => typeof e.cell.marginUsd === 'number')
  const masked = !!mx && Object.keys(mx.cells || {}).length > 0 && !Object.values(mx.cells).some((c: any) => typeof c.marginPct === 'number')

  async function computeOne(cfId: number, colorId: number | null) {
    const key = `${cfId}|${colorId}`
    setBusyCell(key); setErr('')
    try {
      const valueIds = [colorId, pkgs.length ? pkgId : null].filter(Boolean)
      await api.post(token, '/bom/compute', { caseFactoryId: cfId, valueIds, qtyScenarioCode: qty, force: true })
      await load()
      setTimeout(() => window.dispatchEvent(new CustomEvent('cortex:stage-refresh')), 600)
    } catch (e: any) { setErr(e.message) } finally { setBusyCell('') }
  }
  async function computeAll() {
    if (!mx) return
    setBusyAll(true); setErr('')
    const targets: { cfId: number; colorId: number | null }[] = []
    for (const f of mx.factories) for (const c of colors) if (!cellOf(f.caseFactoryId, c.id)) targets.push({ cfId: f.caseFactoryId, colorId: c.id })
    let done = 0, fails = 0, firstErr = ''
    for (const t of targets) {
      setProgress(`${++done}/${targets.length}`)
      try { await api.post(token, '/bom/compute', { caseFactoryId: t.cfId, valueIds: [t.colorId, pkgs.length ? pkgId : null].filter(Boolean), qtyScenarioCode: qty, force: true }) }
      catch (e: any) { fails += 1; if (!firstErr) firstErr = e?.message || String(e) }
    }
    setProgress(''); setBusyAll(false); await load()
    if (fails) setErr(`${fails}/${targets.length} 格計算失敗:${firstErr}`)
  }

  async function exportExcel() {
    try {
      const res = await fetch(`/api/projects/bom/project/${projectId}/matrix-excel?qty=${qty}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`匯出失敗 HTTP ${res.status}`)
      const cd = res.headers.get('content-disposition') || ''
      const m = cd.match(/filename="?([^";]+)"?/)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = m ? decodeURIComponent(m[1]) : 'rfq-cost.xlsx'; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setErr(e.message) }
  }

  if (!mx) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入矩陣…{err && <span className="text-red-600 ml-2">{err}</span>}</div>
  if (!mx.factories.length) return <div className="p-4 text-center text-cortex-muted text-[12px] italic">尚未建立試算廠別 —— 至「📦 BOM / 材料」＋廠別。</div>

  const totalCells = mx.factories.length * colors.length * (mx.qtyScenarios?.length || 1) * Math.max(pkgs.length, 1)
  const goto = (id: string) => window.dispatchEvent(new CustomEvent('cortex:goto-section', { detail: id }))
  const rowLabelCls = 'px-3 py-1.5 text-right font-medium text-cortex-ink whitespace-nowrap bg-cortex-bg/30'

  return (
    <div className="space-y-3">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink">🏭 多廠成本矩陣 <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded align-middle">v0.7 三維度</span></h3>
          <p className="text-[11px] text-cortex-muted mt-0.5">
            {mx.factories.length} 廠 × {colors.length} variants × {mx.qtyScenarios?.length || 1} qty × {Math.max(pkgs.length, 1)} pkg = {totalCells} cells · True vs Quote
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <button onClick={() => goto('cleansheet')} className="text-cortex-teal hover:underline">📊 看 Cleansheet 詳</button>
          <button onClick={() => goto('margin')} className="text-cortex-teal hover:underline">📈 Margin Analysis</button>
          <button onClick={exportExcel} className="flex items-center gap-1 text-cortex-teal hover:underline"><FileSpreadsheet className="w-3.5 h-3.5" /> 匯出 RFQ Cost Excel</button>
        </div>
      </div>

      {/* toggle bar */}
      <div className="border border-cortex-line rounded-lg p-2.5 flex items-center gap-4 flex-wrap text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="font-bold text-cortex-ink">Qty:</span>
          {(mx.qtyScenarioDetails || [{ code: 'BASE', targetQty: null }]).map((d: any) => (
            <button key={d.code} onClick={() => setQty(d.code)}
              className={`px-2.5 py-1 rounded-full border ${qty === d.code ? 'bg-cortex-navy text-white border-cortex-navy' : 'bg-white border-cortex-line text-cortex-muted hover:border-cortex-navy'}`}>
              {d.code === 'BASE' ? '基準量' : d.code === 'LOW' ? '低批量' : d.code === 'HIGH' ? '高批量' : d.code}{d.targetQty ? `(${kfmt(d.targetQty)})` : ''}
            </button>
          ))}
        </span>
        {pkgs.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="font-bold text-cortex-ink">PKG:</span>
            {pkgs.map((p) => (
              <button key={p.id} onClick={() => setPkgId(p.id)}
                className={`px-2.5 py-1 rounded-full border ${pkgId === p.id ? 'bg-cortex-teal text-white border-cortex-teal' : 'bg-white border-cortex-line text-cortex-muted hover:border-cortex-teal'}`}>{p.code}</button>
            ))}
          </span>
        )}
        <label className={`flex items-center gap-1 ml-auto ${masked ? 'opacity-50' : 'cursor-pointer'}`} title={masked ? '需完整成本視角(HOST/admin)' : ''}>
          <input type="checkbox" checked={showTrue && !masked} disabled={masked} onChange={(e) => setShowTrue(e.target.checked)} />
          {masked && <Lock className="w-3 h-3" />} Show True Cost
        </label>
        <label className={`flex items-center gap-1 ${masked ? 'opacity-50' : 'cursor-pointer'}`} title={masked ? '需完整成本視角(HOST/admin)' : ''}>
          <input type="checkbox" checked={showMargin && !masked} disabled={masked} onChange={(e) => setShowMargin(e.target.checked)} />
          {masked && <Lock className="w-3 h-3" />} <span className="text-red-500">Show Margin %</span>
        </label>
      </div>
      {err && <div className="text-[11px] text-red-600 break-all">{err}</div>}

      {/* KPI 卡 */}
      {stats?.cheapest && (
        <div className="grid md:grid-cols-3 gap-2">
          <div className="border border-green-300 bg-green-50/60 rounded-lg p-2.5">
            <div className="text-[9px] text-green-700 font-bold">🏆 最便宜組合(QUOTE)</div>
            <div className="text-[16px] font-bold text-green-800 font-mono">
              {stats.cheapest.cf.factoryCode}{stats.cheapest.color.code ? ` · ${stats.cheapest.color.code} ver.` : ''}
            </div>
            <div className="text-[10px] text-green-700">{m3(stats.cheapest.cell.total)} / unit{stats.savePct ? ` · 比最貴省 ${(stats.savePct * 100).toFixed(1)}%` : ''}</div>
          </div>
          <div className="border border-cortex-line bg-white rounded-lg p-2.5">
            <div className="text-[9px] text-cortex-muted font-bold">三廠 MVA SPREAD</div>
            <div className="text-[16px] font-bold text-cortex-ink font-mono">{stats.mvaSpread != null ? `$${stats.mvaSpread.toFixed(3)}` : '—'}</div>
            <div className="text-[10px] text-cortex-muted">
              {mx.factories.map((f: any) => ({ f, v: cellOf(f.caseFactoryId, colors[0].id)?.mva })).filter((x: any) => typeof x.v === 'number')
                .sort((a: any, b: any) => b.v - a.v).map((x: any) => x.f.factoryCode).join(' > ') || '—'} · {qty} scenario
            </div>
          </div>
          <div className="border border-amber-300 bg-amber-50/60 rounded-lg p-2.5">
            <div className="text-[9px] text-amber-700 font-bold">年量影響 {masked ? '' : '💰'}</div>
            <div className="text-[16px] font-bold text-amber-800 font-mono">{stats.annualImpact != null ? `+$${Math.round(stats.annualImpact).toLocaleString('en-US')}` : '—'}</div>
            <div className="text-[10px] text-amber-700">/ yr · {annualQty ? `${annualQty.toLocaleString('en-US')} 年量` : '未設年量'} · 最便宜 vs 最貴</div>
          </div>
        </div>
      )}

      {/* 主表:欄=廠 · 列=成本組成 × 變體 */}
      <div className="text-[10px] text-cortex-muted flex items-center gap-2">
        成本矩陣 · {qty === 'BASE' ? '基準量' : qty} × {pkgs.find((p) => p.id === pkgId)?.code || '(無包裝軸)'} · {(showTrue || showMargin) && !masked ? 'TRUE + QUOTE' : 'QUOTE ONLY'} {masked && <Lock className="w-3 h-3" />}
        {stats && stats.missing > 0 && (
          <button onClick={computeAll} disabled={busyAll}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 bg-cortex-navy text-white rounded text-[10px] disabled:opacity-40">
            {busyAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}{busyAll && progress ? `計算中 ${progress}` : `算缺格(${stats.missing})`}
          </button>
        )}
        <button onClick={load} title="重新整理" className={`${stats && stats.missing > 0 ? '' : 'ml-auto'} p-0.5 text-cortex-muted hover:text-cortex-teal`}><RefreshCw className="w-3 h-3" /></button>
      </div>
      <div className="overflow-x-auto border border-cortex-line rounded-lg">
        <table className="min-w-full text-[11px]">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left align-bottom bg-indigo-600 text-white rounded-tl">
                <div className="text-[12px] font-bold">{pkgs.find((p) => p.id === pkgId)?.code || '全配置'}</div>
                <div className="text-[9px] font-normal opacity-80">{annualQty ? `${annualQty.toLocaleString('en-US')} pcs/yr` : ''}</div>
              </th>
              {mx.factories.map((f: any, i: number) => (
                <th key={f.caseFactoryId} className={`px-3 py-2 text-center border-b-2 ${FACTORY_HEAD[f.factoryCode] || 'bg-cortex-bg text-cortex-ink border-cortex-line'}`}>
                  <div className="text-[12px] font-bold">Made In {FACTORY_NAME[f.factoryCode] || f.factoryCode}</div>
                  <div className="text-[9px] italic opacity-80">Option {OPTION[i] || i + 1} · {f.costingModel === 'FULL_MVA' ? 'FULL MVA' : 'SIMPLIFIED'}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* MVA */}
            <tr className="border-b border-cortex-line/40">
              <td className={rowLabelCls}>MVA</td>
              {mx.factories.map((f: any) => {
                const cell = cellOf(f.caseFactoryId, colors[0].id)
                return <td key={f.caseFactoryId} className="px-3 py-1.5 text-right font-mono">{cell ? m3(cell.mva) : '—'}</td>
              })}
            </tr>
            {/* Material per color */}
            {colors.map((c) => (
              <tr key={`mat-${c.id}`} className="border-b border-cortex-line/40">
                <td className={rowLabelCls}>Material (Quote){c.code ? `: ${c.code} ver.` : ''}</td>
                {mx.factories.map((f: any) => {
                  const cell = cellOf(f.caseFactoryId, c.id)
                  return <td key={f.caseFactoryId} className="px-3 py-1.5 text-right font-mono">{cell ? m3(cell.material) : '—'}</td>
                })}
              </tr>
            ))}
            {showTrue && !masked && colors.map((c) => (
              <tr key={`matt-${c.id}`} className="border-b border-cortex-line/40 bg-cortex-bg/20">
                <td className={`${rowLabelCls} text-cortex-muted`}>Material (True){c.code ? `: ${c.code} ver.` : ''} 🔒</td>
                {mx.factories.map((f: any) => {
                  const cell = cellOf(f.caseFactoryId, c.id)
                  return <td key={f.caseFactoryId} className="px-3 py-1.5 text-right font-mono text-cortex-muted">{cell ? m3(cell.materialTrue) : '—'}</td>
                })}
              </tr>
            ))}
            {/* SGA+Profit */}
            <tr className="border-b border-cortex-line/40">
              <td className={rowLabelCls}>SG&A + Profit</td>
              {mx.factories.map((f: any) => {
                const cell = cellOf(f.caseFactoryId, colors[0].id)
                return <td key={f.caseFactoryId} className="px-3 py-1.5 text-right font-mono">{cell ? m3((cell.sga || 0) + (cell.profit || 0)) : '—'}</td>
              })}
            </tr>
            {/* NRE 攤提(有才顯) */}
            {stats?.entries?.some((e) => (e.cell.nreQuote || 0) > 0) && (
              <tr className="border-b border-cortex-line/40">
                <td className={rowLabelCls}>NRE 攤提</td>
                {mx.factories.map((f: any) => {
                  const cell = cellOf(f.caseFactoryId, colors[0].id)
                  return <td key={f.caseFactoryId} className="px-3 py-1.5 text-right font-mono">{cell ? m3(cell.nreQuote || 0) : '—'}</td>
                })}
              </tr>
            )}
            {/* Total per color(紅底 · ★ 最便宜) */}
            {colors.map((c) => (
              <tr key={`tot-${c.id}`} className="border-b-2 border-red-200 bg-red-50/60">
                <td className={`${rowLabelCls} !bg-red-50 text-red-800 font-bold`}>Total Cost (Quote){c.code ? `: ${c.code} ver.` : ''}</td>
                {mx.factories.map((f: any) => {
                  const cell = cellOf(f.caseFactoryId, c.id)
                  const isCheapest = cell && stats?.cheapest && stats.cheapest.cf.caseFactoryId === f.caseFactoryId && stats.cheapest.color.id === c.id
                  const key = `${f.caseFactoryId}|${c.id}`
                  return (
                    <td key={f.caseFactoryId} className={`px-3 py-1.5 text-right font-mono font-bold ${isCheapest ? 'bg-yellow-100 text-yellow-900' : 'text-red-800'}`}>
                      {cell ? (
                        <span title={`run#${cell.runId}`}>{isCheapest && <Crown className="w-3 h-3 inline text-amber-500 mr-0.5" />}{m3(cell.total)}</span>
                      ) : busyCell === key ? <Loader2 className="w-3 h-3 inline animate-spin" /> : (
                        <button onClick={() => computeOne(f.caseFactoryId, c.id)} disabled={!!busyCell || busyAll}
                          className="text-[10px] text-cortex-teal hover:underline font-normal disabled:opacity-40">算</button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {showTrue && !masked && colors.map((c) => (
              <tr key={`tott-${c.id}`} className="border-b border-cortex-line/40 bg-cortex-bg/20">
                <td className={`${rowLabelCls} text-cortex-muted`}>Total (True){c.code ? `: ${c.code} ver.` : ''} 🔒</td>
                {mx.factories.map((f: any) => {
                  const cell = cellOf(f.caseFactoryId, c.id)
                  return <td key={f.caseFactoryId} className="px-3 py-1.5 text-right font-mono text-cortex-muted">{cell ? m3(cell.totalTrue) : '—'}</td>
                })}
              </tr>
            ))}
            {showMargin && !masked && colors.map((c) => (
              <tr key={`mg-${c.id}`} className="border-b border-cortex-line/40">
                <td className={`${rowLabelCls} text-red-600`}>Gross Margin %{c.code ? `: ${c.code} ver.` : ''} 🔒</td>
                {mx.factories.map((f: any) => {
                  const cell = cellOf(f.caseFactoryId, c.id)
                  const p = cell?.marginPct
                  return (
                    <td key={f.caseFactoryId} className={`px-3 py-1.5 text-right font-mono font-bold ${typeof p === 'number' ? (p < 0 ? 'bg-red-100 text-red-700' : p < 0.05 ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-700') : ''}`}>
                      {cell ? pc(p) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-cortex-muted">
        👑 = 當前切片(qty × pkg)最便宜 · MVA / SG&A+Profit 取 {colors[0]?.code || '單'} 配置 run 值 · 切 Qty/PKG 換整張切片 · 缺格按「算」即時補
      </div>
    </div>
  )
}
