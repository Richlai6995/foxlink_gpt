/**
 * MarginSection — 📈 Margin Analysis(v0.16 原設計改寫)
 *
 * 對齊 demo renderFormMarginAnalysis:VIEW_TRUE_COST 閘(非 HOST 鎖)→ KPI 4 卡 →
 * 24-cell margin heatmap(列 = qty × pkg scenario;欄 = 廠 × 變體)→ Top Markup Items per PKG(各 top 5)。
 * 公式:margin_pct = (total_quote − total_true) / total_quote(含 NRE 攤提口徑,同矩陣 run 快取)。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Loader2, Lock, TrendingUp } from 'lucide-react'

const m4 = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
const pc = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')
const heat = (p: number | null | undefined) => {
  if (typeof p !== 'number') return { bg: '#F8FAFC', fg: '#CBD5E1' }
  if (p < 0) return { bg: '#FECACA', fg: '#B91C1C' }
  if (p < 0.05) return { bg: '#FEF3C7', fg: '#92400E' }
  if (p < 0.1) return { bg: '#CCFBF1', fg: '#0F766E' }
  if (p < 0.2) return { bg: '#5EEAD4', fg: '#134E4A' }
  return { bg: '#14B8A6', fg: '#FFFFFF' }
}

export default function MarginSection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [mx, setMx] = useState<any>(null)
  const [inst, setInst] = useState<number | null>(null)
  const [topByPkg, setTopByPkg] = useState<Record<string, any[]>>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) return
    api.get<any>(token, `/bom/project/${projectId}/matrix`).then(setMx).catch((e: any) => setErr(e.message))
    api.get<any>(token, `/bom/project/${projectId}/latest-instance`).then((i) => { if (i?.bomInstanceId) setInst(i.bomInstanceId) }).catch(() => {})
  }, [token, projectId])

  const dims = mx?.dimensions || []
  const colorDim = dims.find((d: any) => /顏色|COLOR/i.test(d.dimCode))
  const pkgDim = dims.find((d: any) => /包裝|PKG|PACK/i.test(d.dimCode))
  const colors: { id: number | null; code: string }[] = colorDim?.values?.length ? colorDim.values : [{ id: null, code: '' }]
  const pkgs: { id: number | null; code: string }[] = pkgDim?.values?.length ? pkgDim.values : [{ id: null, code: '' }]
  const qtys: { code: string; targetQty: number | null }[] = mx?.qtyScenarioDetails || [{ code: 'BASE', targetQty: null }]

  // per PKG top markup(有包裝維度才分組)
  useEffect(() => {
    if (!token || !inst || !mx) return
    const load = async () => {
      const out: Record<string, any[]> = {}
      for (const p of pkgs) {
        const q = p.id ? `&valueIds=${p.id}` : ''
        const r = await api.get<any>(token, `/bom/instances/${inst}/top-markup?limit=5${q}`).catch(() => null)
        out[p.code || 'ALL'] = r?.items || []
      }
      setTopByPkg(out)
    }
    load()
  }, [token, inst, mx])   // eslint-disable-line

  if (err) return <div className="text-[11px] text-red-600">{err}</div>
  if (!mx) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入 Margin…</div>

  const sigOf = (colorId: number | null, pkgId: number | null) => [colorId, pkgId].filter(Boolean).sort((a: any, b: any) => a - b).join(',')
  const cellOf = (cfId: number, colorId: number | null, pkgId: number | null, qty: string) => mx.cells?.[`${cfId}|${sigOf(colorId, pkgId)}|${qty}`]

  const allCells = Object.values(mx.cells || {}) as any[]
  const withMargin = allCells.filter((c) => typeof c.marginPct === 'number')
  const masked = allCells.length > 0 && withMargin.length === 0
  if (masked) return (
    <div className="p-6 text-center space-y-2">
      <Lock className="w-8 h-8 mx-auto text-cortex-muted" />
      <div className="text-[13px] font-bold text-cortex-ink">Margin Analysis 已鎖定</div>
      <div className="text-[11px] text-cortex-muted">需 VIEW_TRUE_COST(HOST/admin)。右上角切換視角後重試。</div>
    </div>
  )

  const pcts = withMargin.map((c) => c.marginPct)
  const kpi = pcts.length ? {
    max: Math.max(...pcts), min: Math.min(...pcts),
    avg: pcts.reduce((a, b) => a + b, 0) / pcts.length,
    avgUsd: withMargin.reduce((a, c) => a + (c.marginUsd || 0), 0) / withMargin.length,
  } : null

  // scenario 行 = qty × pkg;欄 = 廠 × 顏色
  const scenarios: { qty: string; qtyLabel: string; pkg: { id: number | null; code: string } }[] = []
  for (const q of qtys) for (const p of pkgs) scenarios.push({ qty: q.code, qtyLabel: q.targetQty ? `${q.code}(${q.targetQty >= 1000 ? Math.round(q.targetQty / 1000) + 'K' : q.targetQty})` : q.code, pkg: p })
  const cols: { cf: any; color: { id: number | null; code: string } }[] = []
  for (const f of mx.factories || []) for (const c of colors) cols.push({ cf: f, color: c })
  const totalCells = scenarios.length * cols.length

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Margin Analysis
          <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded">🔒 VIEW_TRUE_COST</span>
        </h3>
        <p className="text-[10px] text-cortex-muted mt-0.5">
          {totalCells} cells({scenarios.length} scenario × {cols.length} 廠×變體)· margin = (Quote − True) / Quote · 同矩陣 run 快取(含 NRE 攤提)
        </p>
      </div>

      {/* KPI 4 卡 */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['Max Margin %', pc(kpi.max), kpi.max >= 0.1 ? 'text-teal-700' : 'text-cortex-ink'],
            ['Min Margin %', pc(kpi.min), kpi.min < 0 ? 'text-red-600' : 'text-cortex-ink'],
            ['Avg Margin %', pc(kpi.avg), 'text-cortex-ink'],
            ['Avg Margin $', m4(kpi.avgUsd), 'text-cortex-ink'],
          ].map(([l, v, cls]: any) => (
            <div key={l} className="border border-cortex-line rounded-lg p-2 text-center">
              <div className="text-[9px] text-cortex-muted">{l}</div>
              <div className={`text-[16px] font-mono font-bold ${cls}`}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* margin heatmap:scenario 行 × 廠×變體 欄 */}
      <div className="border border-cortex-line rounded-lg overflow-hidden">
        <div className="px-3 py-1.5 text-[11px] font-bold text-cortex-ink bg-cortex-bg/40 border-b border-cortex-line">Margin Heatmap(Gross Margin %)</div>
        <div className="overflow-x-auto">
          <table className="text-[10px] min-w-full">
            <thead className="text-cortex-muted border-b border-cortex-line">
              <tr>
                <th className="text-left px-2 py-1.5 whitespace-nowrap">Scenario(Qty × PKG)\ 廠 × 變體</th>
                {cols.map((c, i) => (
                  <th key={i} className="text-center px-2 py-1.5 whitespace-nowrap">
                    {c.cf.factoryCode}{c.color.code ? <><br /><span className="font-normal text-[9px]">{c.color.code}</span></> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((sc, si) => (
                <tr key={si} className="border-b border-cortex-line/30">
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="font-mono font-bold text-cortex-ink">{sc.qtyLabel}</span>
                    {sc.pkg.code && <span className="ml-1 text-[9px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-1 py-0.5">{sc.pkg.code}</span>}
                  </td>
                  {cols.map((c, ci) => {
                    const cell = cellOf(c.cf.caseFactoryId, c.color.id, sc.pkg.id, sc.qty)
                    const h = heat(cell?.marginPct)
                    return (
                      <td key={ci} className="px-2 py-1.5 text-center font-mono font-bold" style={{ background: h.bg, color: h.fg }}
                        title={cell ? `total ${m4(cell.total)} · true ${m4(cell.totalTrue)} · margin ${m4(cell.marginUsd)}` : '未算(矩陣區補算)'}>
                        {cell ? pc(cell.marginPct) : '·'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-1.5 text-[9px] text-cortex-muted border-t border-cortex-line flex items-center gap-2 flex-wrap">
          色階:<span className="px-1.5 rounded" style={{ background: '#FECACA', color: '#B91C1C' }}>&lt;0 虧</span>
          <span className="px-1.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>0~5%</span>
          <span className="px-1.5 rounded" style={{ background: '#CCFBF1', color: '#0F766E' }}>5~10%</span>
          <span className="px-1.5 rounded" style={{ background: '#5EEAD4', color: '#134E4A' }}>10~20%</span>
          <span className="px-1.5 rounded" style={{ background: '#14B8A6', color: '#fff' }}>&gt;20%</span>
          <span className="ml-auto">缺格「·」到 🏭 多廠矩陣補算</span>
        </div>
      </div>

      {/* Top Markup Items per PKG */}
      <div className="grid md:grid-cols-2 gap-2.5">
        {pkgs.map((p) => {
          const items = topByPkg[p.code || 'ALL'] || []
          return (
            <div key={p.code || 'ALL'} className="border border-cortex-line rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 text-[11px] font-bold text-cortex-ink bg-cortex-bg/40 border-b border-cortex-line">
                Top Markup Items{p.code ? ` · ${p.code}` : ''}<span className="text-[9px] text-cortex-muted font-normal ml-1">(加價貢獻 top 5)</span>
              </div>
              {items.length ? (
                <table className="w-full text-[10px]">
                  <thead className="text-cortex-muted border-b border-cortex-line"><tr>
                    <th className="text-left px-2 py-1">Description</th>
                    <th className="text-right px-2 py-1">True</th><th className="text-right px-2 py-1">Quote</th>
                    <th className="text-right px-2 py-1">Mk%</th><th className="text-right px-2 py-1">加價/台</th>
                  </tr></thead>
                  <tbody>
                    {items.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-cortex-line/30">
                        <td className="px-2 py-1 max-w-[200px] truncate" title={r.description}>{r.description}<span className="text-cortex-muted ml-1 text-[8px]">{r.module_category}</span></td>
                        <td className="px-2 py-1 text-right font-mono text-cortex-muted">{m4(r.true_cost_usd)}</td>
                        <td className="px-2 py-1 text-right font-mono">{m4(r.quote_price)}</td>
                        <td className="px-2 py-1 text-right font-mono">{pc(r.markup_pct)}</td>
                        <td className="px-2 py-1 text-right font-mono text-cortex-teal font-bold">{m4(r.markup_ext)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-2.5 text-[10px] text-cortex-muted">此包裝無 markup 資料(true=quote 的假價 fixture 為空;真實雙價匯入後顯示加價主力料)。</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
