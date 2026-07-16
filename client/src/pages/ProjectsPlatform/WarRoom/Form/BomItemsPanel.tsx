/**
 * BomItemsPanel — B-5b 採購 enrich UI(item 明細 + 逐料多 vendor 多 tier 報價 · 選 chosen)
 *
 * 對應 docs/cortex-bom-import-plan.md §10 B-5b。scoped 到一個 bom_instance。
 * 展開一筆料件 → 加 vendor / 加報價(true/quote 雙價)/ 選定 vendor → PENDING 轉已詢價。
 * enrich 後 onChanged() 通知父層(BomSection)重抓 rollup。
 * 註:true cost 欄位遮罩留 S2(view_true_cost);i18n 待補。
 */

import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { ChevronRight, ChevronDown, Plus, Check, Loader2 } from 'lucide-react'

type ItemRow = {
  module_category: string; category: string; id: number; item_sequence: number
  qty: number; fpn: string | null; description: string | null
  applied_price: number | null; extended: number | null; status: string; vendor_count: number
}

const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
const pct = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

export default function BomItemsPanel({ bomInstanceId, onChanged }: { bomInstanceId: number; onChanged?: () => void }) {
  const { token } = useAuth() as any
  const [items, setItems] = useState<ItemRow[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function loadItems() {
    setLoading(true); setErr('')
    try { const r = await api.get<{ items: ItemRow[] }>(token, `/bom/instances/${bomInstanceId}/items`); setItems(r.items || []) }
    catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { if (token && bomInstanceId) loadItems() }, [token, bomInstanceId])

  const pendingN = items.filter((i) => i.status === 'pending').length

  return (
    <div className="border border-cortex-line rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-cortex-bg/60 border-b border-cortex-line">
        <div className="text-[12px] font-semibold text-cortex-ink">
          料件明細 · 採購詢價
          <span className="text-cortex-muted font-normal"> ({items.length} 筆{pendingN > 0 ? ` · ${pendingN} 待詢價` : ' · 全已詢價'})</span>
        </div>
        <button onClick={loadItems} className="text-[11px] text-cortex-teal hover:underline">重新整理</button>
      </div>
      {err && <div className="px-3 py-2 text-[11px] text-red-600">{err}</div>}
      <table className="w-full text-[11px]">
        <thead className="text-cortex-muted bg-white border-b border-cortex-line">
          <tr>
            <th className="w-6 px-2 py-1"></th>
            <th className="text-left px-2 py-1">料件</th>
            <th className="text-right px-2 py-1">Qty</th>
            <th className="text-right px-2 py-1">採用價</th>
            <th className="text-center px-2 py-1">狀態</th>
            <th className="text-center px-2 py-1">供應商</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <ItemRowComp key={it.id} it={it} expanded={expanded === it.id}
              onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
              token={token} onChanged={() => { loadItems(); onChanged?.() }} />
          ))}
        </tbody>
      </table>
      {loading && <div className="px-3 py-2 text-[11px] text-cortex-muted"><Loader2 className="w-3 h-3 inline animate-spin" /> 載入中…</div>}
    </div>
  )
}

function ItemRowComp({ it, expanded, onToggle, token, onChanged }: {
  it: ItemRow; expanded: boolean; onToggle: () => void; token: string; onChanged: () => void
}) {
  return (
    <>
      <tr className={`border-b border-cortex-line/40 cursor-pointer hover:bg-cortex-bg/40 ${it.status === 'pending' ? 'bg-amber-50/50' : ''}`} onClick={onToggle}>
        <td className="px-2 py-1 text-cortex-muted">{expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</td>
        <td className="px-2 py-1"><span className="text-cortex-muted">{it.module_category}</span> · {it.description || it.fpn || `#${it.id}`}</td>
        <td className="px-2 py-1 text-right font-mono">{it.qty}</td>
        <td className="px-2 py-1 text-right font-mono">{money(it.applied_price)}</td>
        <td className="px-2 py-1 text-center">
          {it.status === 'priced'
            ? <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">已詢價</span>
            : <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">待詢價</span>}
        </td>
        <td className="px-2 py-1 text-center font-mono">{it.vendor_count}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="px-3 py-2 bg-cortex-bg/30 border-b border-cortex-line">
            <ItemEnrich itemId={it.id} token={token} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  )
}

function ItemEnrich({ itemId, token, onChanged }: { itemId: number; token: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [vName, setVName] = useState(''); const [vPn, setVPn] = useState('')
  const [pMfg, setPMfg] = useState<number | ''>(''); const [pCur, setPCur] = useState('USD')
  const [pTrue, setPTrue] = useState(''); const [pFx, setPFx] = useState('1'); const [pQuote, setPQuote] = useState('')

  async function load() { try { setDetail(await api.get(token, `/bom/items/${itemId}/detail`)) } catch (e: any) { setErr(e.message) } }
  useEffect(() => { load() }, [itemId])

  async function addVendor() {
    if (!vName && !vPn) { setErr('填供應商或 Mfg P/N'); return }
    setBusy(true); setErr('')
    try { await api.post(token, `/bom/items/${itemId}/vendor`, { vendor: vName, mfgPn: vPn }); setVName(''); setVPn(''); await load(); onChanged() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function addPrice() {
    if (!pQuote) { setErr('請填報價 quote(USD)'); return }
    setBusy(true); setErr('')
    try {
      await api.post(token, `/bom/items/${itemId}/price`, {
        mfgId: pMfg || null, sourceCurrency: pCur,
        tiers: [{ sourceCurrency: pCur, trueCostSource: pTrue ? Number(pTrue) : null, fxRate: Number(pFx) || 1, quotePrice: Number(pQuote), isChosen: true }],
      })
      setPTrue(''); setPQuote(''); await load(); onChanged()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function choose(snapshotId: number) {
    setBusy(true); setErr('')
    try { await api.put(token, `/bom/items/${itemId}/choose`, { snapshotId }); await load(); onChanged() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!detail) return <div className="text-[11px] text-cortex-muted"><Loader2 className="w-3 h-3 inline animate-spin" /> 載入…</div>
  const priced = (detail.snapshots || []).filter((s: any) => s.strategy_used !== 'PENDING')

  return (
    <div className="space-y-2">
      {err && <div className="text-[11px] text-red-600">{err}</div>}

      {/* 供應商報價(選一為採用價) */}
      <div>
        <div className="text-[10px] font-semibold text-cortex-muted uppercase mb-1">供應商報價(選一為採用價)</div>
        {priced.length === 0 && <div className="text-[11px] text-cortex-muted mb-1">尚無報價,下方新增報價。</div>}
        <div className="space-y-1">
          {priced.map((s: any) => {
            const t = (s.tiers || []).find((x: any) => Number(x.is_chosen) === 1) || (s.tiers || [])[0]
            const mfg = (detail.mfgs || []).find((m: any) => Number(m.id) === Number(s.bom_item_mfg_id))
            const chosen = Number(s.is_chosen) === 1
            return (
              <div key={s.id} className={`flex items-center gap-2 text-[11px] px-2 py-1 rounded border ${chosen ? 'border-cortex-teal bg-cortex-cyan-bg/40' : 'border-cortex-line bg-white'}`}>
                <button onClick={() => choose(s.id)} disabled={busy || chosen} title="選為採用價"
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${chosen ? 'bg-cortex-teal border-cortex-teal' : 'border-cortex-muted hover:border-cortex-teal'}`}>
                  {chosen && <Check className="w-2.5 h-2.5 text-white" />}
                </button>
                <span className="flex-1 truncate">{mfg?.manufacturer_name || mfg?.mfg_part_number || '(未指定供應商)'}</span>
                <span className="font-mono">quote {money(s.applied_price_usd)}</span>
                {t && <span className="font-mono text-cortex-muted">true {money(t.true_cost_usd)} · mk {pct(t.markup_pct)}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* 加供應商 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="供應商" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-28" />
        <input value={vPn} onChange={(e) => setVPn(e.target.value)} placeholder="Mfg P/N" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-28" />
        <button onClick={addVendor} disabled={busy} className="flex items-center gap-1 text-[11px] px-2 py-0.5 border border-cortex-line rounded hover:bg-white disabled:opacity-40"><Plus className="w-3 h-3" />加供應商</button>
      </div>

      {/* 加報價(true/quote 雙價) */}
      <div className="flex items-end gap-1.5 flex-wrap bg-white border border-cortex-line rounded p-2">
        <label className="text-[10px] text-cortex-muted">供應商<br />
          <select value={pMfg} onChange={(e) => setPMfg(e.target.value ? Number(e.target.value) : '')} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-28">
            <option value="">(未指定)</option>
            {(detail.mfgs || []).map((m: any) => <option key={m.id} value={m.id}>{m.manufacturer_name || m.mfg_part_number || `#${m.id}`}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-cortex-muted">幣別<br /><input value={pCur} onChange={(e) => setPCur(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-14" /></label>
        <label className="text-[10px] text-cortex-muted">true(原幣)<br /><input value={pTrue} onChange={(e) => setPTrue(e.target.value)} placeholder="1.42" className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-16" /></label>
        <label className="text-[10px] text-cortex-muted">fx<br /><input value={pFx} onChange={(e) => setPFx(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-12" /></label>
        <label className="text-[10px] text-cortex-muted">quote(USD)<br /><input value={pQuote} onChange={(e) => setPQuote(e.target.value)} placeholder="0.30" className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-16" /></label>
        <button onClick={addPrice} disabled={busy} className="flex items-center gap-1 text-[11px] px-2 py-1 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40"><Plus className="w-3 h-3" />加報價</button>
      </div>
    </div>
  )
}
