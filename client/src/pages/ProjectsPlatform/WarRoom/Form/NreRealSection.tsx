/**
 * NreRealSection — Track N NRE 一次性工程費(接真 bom_nre_item · 取代 demo)
 *
 * 對應 docs/cortex-bom-import-plan.md §8。project 層 · 雙價 true/quote。
 * 模式:SEPARATE(單獨報,不進單價)/ AMORTIZED(Σ NRE / 分攤基數 → 每台攤提)。
 * 註:true 成本之後依角色機密遮罩(S2 view_true_cost)。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Plus, Trash2, Loader2, Wrench } from 'lucide-react'

const money = (v: any) => (typeof v === 'number' ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—')
const CATS = ['BUILD', 'EMC', 'DEV_LABOR', 'RELIABILITY', 'MTE_FIXTURE', 'TOOLING', 'TRAVEL', 'DVE', 'OTHER']

export default function NreRealSection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [nc, setNc] = useState('OTHER'); const [nd, setNd] = useState(''); const [nq, setNq] = useState('1')
  const [nt, setNt] = useState(''); const [nqt, setNqt] = useState('')
  const [amortQty, setAmortQty] = useState('')

  async function load() { try { const d = await api.get<any>(token, `/bom/nre?projectId=${projectId}`); setData(d); setAmortQty(d?.config?.nreAmortizeQty ? String(d.config.nreAmortizeQty) : '') } catch (e: any) { setErr(e.message) } }
  useEffect(() => { if (token) load() }, [token, projectId])

  async function addItem() {
    if (!nd) { setErr('填項目描述'); return }
    setBusy(true); setErr('')
    try {
      await api.post(token, '/bom/nre/item', { projectId, category: nc, description: nd, qty: Number(nq) || 1, unitPriceTrue: nt ? Number(nt) : null, unitPriceQuote: nqt ? Number(nqt) : null })
      setNd(''); setNt(''); setNqt(''); await load()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function delItem(id: number) { setBusy(true); setErr(''); try { await api.delete(token, `/bom/nre/item/${id}`); await load() } catch (e: any) { setErr(e.message) } finally { setBusy(false) } }
  // v0.16 #7:議價後單價 inline 存('' = 還原未議價)
  const [negEdit, setNegEdit] = useState<Record<number, string>>({})
  async function saveNeg(id: number) {
    const v = negEdit[id]
    if (v === undefined) return
    setBusy(true); setErr('')
    try {
      await api.put(token, `/bom/nre/item/${id}`, { unitPriceNegotiated: v === '' ? '' : Number(v) })
      setNegEdit((p) => { const n = { ...p }; delete n[id]; return n })
      await load(); window.dispatchEvent(new CustomEvent('cortex:form-refresh'))
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function saveConfig(mode: string) {
    setBusy(true); setErr('')
    try { await api.put(token, '/bom/nre/config', { projectId, nreMode: mode, nreAmortizeQty: amortQty ? Number(amortQty) : null, amortizeSide: 'quote' }); await load() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!data) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入 NRE…</div>
  const r = data.rollup, cfg = data.config, am = data.amortized
  const isAmort = cfg?.nreMode === 'AMORTIZED'

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2"><Wrench className="w-4 h-4" /> NRE 一次性工程費</h3>
        <p className="text-[12px] text-cortex-muted mt-0.5">Build / EMC / Dev Labor / Reliability / MTE 治具 / Tooling…。可單獨報,或分攤進產品單價。</p>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}

      {/* 模式 */}
      <div className="flex items-center gap-2 flex-wrap bg-cortex-bg/40 border border-cortex-line rounded-lg p-2.5 text-[12px]">
        <span className="font-semibold text-cortex-ink">報價方式:</span>
        <button onClick={() => saveConfig('SEPARATE')} disabled={busy}
          className={`px-2.5 py-1 rounded ${!isAmort ? 'bg-cortex-teal text-white' : 'border border-cortex-line'}`}>單獨報(SEPARATE)</button>
        <button onClick={() => saveConfig('AMORTIZED')} disabled={busy}
          className={`px-2.5 py-1 rounded ${isAmort ? 'bg-cortex-teal text-white' : 'border border-cortex-line'}`}>攤入單價(AMORTIZED)</button>
        <span className="text-cortex-muted">分攤基數(台):</span>
        <input value={amortQty} onChange={(e) => setAmortQty(e.target.value)} onBlur={() => saveConfig(cfg?.nreMode || 'SEPARATE')} placeholder="418000" className="border border-cortex-line rounded px-2 py-0.5 text-[12px] w-24" />
        {isAmort && am?.nrePerUnit > 0 && <span className="text-cortex-teal font-semibold">每台攤提 +{money(am.nrePerUnit)}</span>}
      </div>

      {/* 明細 */}
      <table className="w-full text-[11px]">
        <thead className="text-cortex-muted border-b border-cortex-line">
          <tr>
            <th className="text-left px-2 py-1">類別</th><th className="text-left px-2 py-1">項目</th>
            <th className="text-right px-2 py-1">Qty</th>
            <th className="text-right px-2 py-1">原始(quote)</th>
            <th className="text-right px-2 py-1">議價後 / 單價</th>
            <th className="text-right px-2 py-1">議價後小計</th>
            <th className="text-right px-2 py-1">成本(true)</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {(r?.items || []).map((it: any) => (
            <tr key={it.id} className="border-b border-cortex-line/40">
              <td className="px-2 py-1"><span className="text-[9px] bg-cortex-line text-cortex-muted px-1.5 py-0.5 rounded">{it.category}</span></td>
              <td className="px-2 py-1">{it.description}</td>
              <td className="px-2 py-1 text-right font-mono">{it.qty}</td>
              <td className="px-2 py-1 text-right font-mono">{money(it.sub_total_quote)}</td>
              <td className="px-2 py-1 text-right">
                <input
                  value={negEdit[it.id] !== undefined ? negEdit[it.id] : (it.unit_price_negotiated ?? '')}
                  onChange={(e) => setNegEdit((p) => ({ ...p, [it.id]: e.target.value }))}
                  onBlur={() => saveNeg(it.id)} placeholder="未議價"
                  className={`w-20 border rounded px-1.5 py-0.5 text-right font-mono text-[11px] ${it.unit_price_negotiated != null ? 'border-cortex-teal bg-cortex-cyan-bg/30' : 'border-cortex-line'}`} />
              </td>
              <td className="px-2 py-1 text-right font-mono">
                {money(it.sub_total_eff)}
                {it.unit_price_negotiated != null && Number(it.sub_total_quote) > 0 && (
                  <span className="text-[9px] text-green-700 ml-1">↓{Math.round((1 - Number(it.sub_total_eff) / Number(it.sub_total_quote)) * 100)}%</span>
                )}
              </td>
              <td className="px-2 py-1 text-right font-mono text-cortex-muted">{money(it.sub_total_true)}</td>
              <td className="px-2 py-1 text-center"><button onClick={() => delItem(it.id)} disabled={busy} className="text-red-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button></td>
            </tr>
          ))}
          {(r?.items || []).length === 0 && <tr><td colSpan={8} className="px-2 py-3 text-center text-cortex-muted">尚無 NRE 項目,下方新增。</td></tr>}
        </tbody>
        {(r?.items || []).length > 0 && (
          <tfoot>
            <tr className="font-bold text-cortex-ink border-t-2 border-cortex-line">
              <td className="px-2 py-1.5" colSpan={3}>NRE 合計</td>
              <td className="px-2 py-1.5 text-right font-mono text-cortex-muted">{money(r.totalQuoteOriginal)}</td>
              <td className="px-2 py-1.5 text-right text-[10px] text-green-700">
                {r.reductionUsd > 0 ? `↓ ${money(r.reductionUsd)}(${(r.reductionPct * 100).toFixed(1)}%)` : '—'}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-cortex-teal">{money(r.totalQuote)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-cortex-muted">{money(r.totalTrue)}</td>
              <td></td>
            </tr>
            <tr className="text-[10px] text-cortex-muted">
              <td colSpan={8} className="px-2 pb-1 text-right">定版 / 攤提以「議價後」合計為準 · NRE margin(收費 − 成本):{money(r.marginUsd)}{r.marginUsd < 0 && '（少收 · 由單價 margin 補回）'}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* 新增 */}
      <div className="flex items-end gap-1.5 flex-wrap bg-white border border-cortex-line rounded p-2 text-[11px]">
        <label className="text-[10px] text-cortex-muted">類別<br /><select value={nc} onChange={(e) => setNc(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px]">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="text-[10px] text-cortex-muted flex-1 min-w-[140px]">項目描述<br /><input value={nd} onChange={(e) => setNd(e.target.value)} placeholder="e.g. Tooling" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-full" /></label>
        <label className="text-[10px] text-cortex-muted">Qty<br /><input value={nq} onChange={(e) => setNq(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-12" /></label>
        <label className="text-[10px] text-cortex-muted">對客(quote)<br /><input value={nqt} onChange={(e) => setNqt(e.target.value)} placeholder="3000" className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-20" /></label>
        <label className="text-[10px] text-cortex-muted">成本(true)<br /><input value={nt} onChange={(e) => setNt(e.target.value)} placeholder="2401" className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-20" /></label>
        <button onClick={addItem} disabled={busy} className="flex items-center gap-1 px-2 py-1 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40"><Plus className="w-3 h-3" />加項目</button>
      </div>
      <div className="text-[10px] text-cortex-muted">true 成本 / margin 之後依角色機密遮罩(S2 view_true_cost)。</div>
    </div>
  )
}
