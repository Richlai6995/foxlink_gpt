/**
 * BomItemsPanel — 料件明細(主列可編輯 + 採購 enrich)
 *
 * 主列(可編輯 · 存檔存回 DB):Item No / Description / Foxlink P/N / Qty / Remark
 *   排序 半成品 Sub-Assembly → 模組 Module → Item No(後端 ORDER BY)。
 * 半成品 / 模組 / 採用價 / 狀態 / 供應商:唯讀。
 * 下一階(展開一筆):多 vendor 多 tier 報價(true/quote 雙價)→ 一料號可對多單價/多供應商(B-5b)。
 * 存檔:改過的列 → PUT /bom/items/batch。enrich 後 onChanged() 通知父層重抓 rollup。
 * 效能:ItemRowComp = React.memo + stable callback → 編輯只重繪該列。
 * 註:true cost 遮罩留 S2;i18n 待補。
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { ChevronRight, ChevronDown, Plus, Check, Loader2, Save, Pencil, Trash2, X } from 'lucide-react'

type ItemRow = {
  module_category: string; sub_assembly?: string; category: string; id: number; item_sequence: number
  item_no: string | null; qty: number | string; fpn: string | null; description: string | null; remark: string | null
  applied_price: number | null; extended: number | null; status: string; vendor_count: number
  effectivity?: { dim: string; value: string }[]
}
type EditField = 'item_no' | 'description' | 'fpn' | 'qty' | 'remark'

const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(6)}` : '—')   // 單價到小數 6 位(#1)
const pct = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

export default function BomItemsPanel({ bomInstanceId, onChanged }: { bomInstanceId: number; onChanged?: () => void }) {
  const { token } = useAuth() as any
  const [items, setItems] = useState<ItemRow[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [dirty, setDirty] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function loadItems() {
    setLoading(true); setErr('')
    try {
      const r = await api.get<{ items: ItemRow[] }>(token, `/bom/instances/${bomInstanceId}/items`)
      setItems(r.items || []); setDirty(new Set())
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { if (token && bomInstanceId) loadItems() }, [token, bomInstanceId])

  const onToggle = useCallback((id: number) => setExpanded((cur) => (cur === id ? null : id)), [])
  const onEdit = useCallback((id: number, field: EditField, val: string) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, [field]: val } : x)))
    setDirty((prev) => { const n = new Set(prev); n.add(id); return n })
  }, [])
  const onChangedRow = useCallback(() => { loadItems(); onChanged?.() }, [bomInstanceId, token]) // eslint-disable-line

  async function saveAll() {
    const payload = items.filter((x) => dirty.has(x.id)).map((x) => ({
      id: x.id, itemNo: x.item_no, description: x.description, fpn: x.fpn, qty: x.qty, remark: x.remark,
    }))
    if (!payload.length) return
    setSaving(true); setErr('')
    try {
      await api.put<{ updated: number }>(token, '/bom/items/batch', { items: payload })
      await loadItems()          // 重載(qty 改動 → extended 重算 · dirty 清空)
      onChanged?.()              // 通知父層重抓 rollup(qty 影響材料成本)
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const pendingN = useMemo(() => items.filter((i) => i.status === 'pending').length, [items])

  return (
    <div className="border border-cortex-line rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-cortex-bg/60 border-b border-cortex-line">
        <div className="text-[12px] font-semibold text-cortex-ink">
          料件明細 · 採購詢價
          <span className="text-cortex-muted font-normal"> ({items.length} 筆{pendingN > 0 ? ` · ${pendingN} 待詢價` : ' · 全已詢價'})</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={saveAll} disabled={saving || dirty.size === 0}
            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded ${dirty.size > 0 ? 'bg-cortex-teal text-white hover:opacity-90' : 'bg-cortex-bg text-cortex-muted'} disabled:opacity-50`}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            存檔{dirty.size > 0 ? ` (${dirty.size})` : ''}
          </button>
          <button onClick={loadItems} className="text-[11px] text-cortex-teal hover:underline">重新整理</button>
        </div>
      </div>
      {err && <div className="px-3 py-2 text-[11px] text-red-600">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] min-w-[820px]">
          <thead className="text-cortex-muted bg-white border-b border-cortex-line">
            <tr>
              <th className="w-6 px-2 py-1"></th>
              <th className="text-left px-2 py-1">半成品</th>
              <th className="text-left px-2 py-1">模組</th>
              <th className="text-left px-2 py-1 w-16">Item No</th>
              <th className="text-left px-2 py-1">Description</th>
              <th className="text-left px-2 py-1 w-32">Foxlink P/N</th>
              <th className="text-right px-2 py-1 w-14">Qty</th>
              <th className="text-left px-2 py-1 w-28">Remark</th>
              <th className="text-right px-2 py-1">採用價</th>
              <th className="text-center px-2 py-1">狀態</th>
              <th className="text-center px-2 py-1">供</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <ItemRowComp key={it.id} it={it} expanded={expanded === it.id} dirty={dirty.has(it.id)}
                onToggle={onToggle} onEdit={onEdit} token={token} onChanged={onChangedRow} />
            ))}
          </tbody>
        </table>
      </div>
      {loading && <div className="px-3 py-2 text-[11px] text-cortex-muted"><Loader2 className="w-3 h-3 inline animate-spin" /> 載入中…</div>}
    </div>
  )
}

const cellInput = 'w-full bg-transparent border border-transparent hover:border-cortex-line focus:border-cortex-teal focus:bg-white rounded px-1 py-0.5 text-[11px] outline-none'

// React.memo：只有本列的 it / expanded / dirty 變才重繪(避免 212 列全重繪 · onToggle/onEdit 為 stable callback)
const ItemRowComp = memo(function ItemRowComp({ it, expanded, dirty, onToggle, onEdit, token, onChanged }: {
  it: ItemRow; expanded: boolean; dirty: boolean
  onToggle: (id: number) => void; onEdit: (id: number, f: EditField, v: string) => void
  token: string; onChanged: () => void
}) {
  return (
    <>
      <tr className={`border-b border-cortex-line/40 ${it.status === 'pending' ? 'bg-amber-50/50' : ''} ${dirty ? 'ring-1 ring-inset ring-cortex-teal/30' : ''}`}>
        <td className="px-2 py-1 text-cortex-muted cursor-pointer hover:text-cortex-teal" onClick={() => onToggle(it.id)}>
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </td>
        <td className="px-2 py-1 whitespace-nowrap">
          {it.sub_assembly && <span className="text-[9px] bg-cortex-cyan-bg text-cortex-teal px-1 py-0.5 rounded">{it.sub_assembly}</span>}
          {it.effectivity && it.effectivity.length > 0
            ? it.effectivity.map((e, i) => <span key={i} className="ml-1 text-[9px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded">{e.dim}:{e.value}</span>)
            : <span className="ml-1 text-[9px] text-cortex-muted/70">共用</span>}
        </td>
        <td className="px-2 py-1 text-cortex-muted">{it.module_category}</td>
        <td className="px-2 py-1"><input value={it.item_no ?? ''} onChange={(e) => onEdit(it.id, 'item_no', e.target.value)} className={cellInput} /></td>
        <td className="px-2 py-1"><input value={it.description ?? ''} onChange={(e) => onEdit(it.id, 'description', e.target.value)} className={cellInput} /></td>
        <td className="px-2 py-1"><input value={it.fpn ?? ''} onChange={(e) => onEdit(it.id, 'fpn', e.target.value)} className={`${cellInput} font-mono`} /></td>
        <td className="px-2 py-1"><input value={String(it.qty ?? '')} onChange={(e) => onEdit(it.id, 'qty', e.target.value)} className={`${cellInput} text-right font-mono`} /></td>
        <td className="px-2 py-1"><input value={it.remark ?? ''} onChange={(e) => onEdit(it.id, 'remark', e.target.value)} placeholder="—" className={cellInput} /></td>
        <td className="px-2 py-1 text-right font-mono">{money(it.applied_price)}</td>
        <td className="px-2 py-1 text-center">
          {it.status === 'priced'
            ? <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded whitespace-nowrap">已詢價</span>
            : <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap">待詢價</span>}
        </td>
        <td className="px-2 py-1 text-center font-mono">{it.vendor_count}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={11} className="px-3 py-2 bg-cortex-bg/30 border-b border-cortex-line">
            <ItemEnrich itemId={it.id} token={token} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  )
})

function ItemEnrich({ itemId, token, onChanged }: { itemId: number; token: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [vName, setVName] = useState(''); const [vPn, setVPn] = useState('')
  const [pMfg, setPMfg] = useState<number | ''>(''); const [pCur, setPCur] = useState('USD')
  const [pTrue, setPTrue] = useState(''); const [pFx, setPFx] = useState('1'); const [pQuote, setPQuote] = useState('')
  // 編輯既有報價
  const [editSnap, setEditSnap] = useState<number | null>(null)
  const [eVendor, setEVendor] = useState(''); const [eMfgPn, setEMfgPn] = useState(''); const [eCur, setECur] = useState('USD')
  const [eTrue, setETrue] = useState(''); const [eFx, setEFx] = useState('1'); const [eQuote, setEQuote] = useState('')

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
  function startEdit(s: any, t: any, mfg: any) {
    setEditSnap(Number(s.id)); setErr('')
    setEVendor(mfg?.manufacturer_name || ''); setEMfgPn(mfg?.mfg_part_number || '')
    setECur(t?.source_currency || 'USD'); setETrue(t?.true_cost_source != null ? String(t.true_cost_source) : '')
    setEFx(t?.fx_rate != null ? String(t.fx_rate) : '1'); setEQuote(t?.quote_price_usd != null ? String(t.quote_price_usd) : '')
  }
  async function saveEdit(snapshotId: number) {
    setBusy(true); setErr('')
    try {
      await api.put(token, `/bom/items/${itemId}/price/${snapshotId}`, {
        vendor: eVendor, mfgPn: eMfgPn, sourceCurrency: eCur,
        trueCostSource: eTrue === '' ? null : Number(eTrue), fxRate: Number(eFx) || 1, quotePrice: eQuote === '' ? null : Number(eQuote),
      })
      setEditSnap(null); await load(); onChanged()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function delPrice(snapshotId: number) {
    if (!confirm('刪除這筆報價?')) return
    setBusy(true); setErr('')
    try { await api.delete(token, `/bom/items/${itemId}/price/${snapshotId}`); setEditSnap(null); await load(); onChanged() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!detail) return <div className="text-[11px] text-cortex-muted"><Loader2 className="w-3 h-3 inline animate-spin" /> 載入…</div>
  const priced = (detail.snapshots || []).filter((s: any) => s.strategy_used !== 'PENDING')

  return (
    <div className="space-y-2">
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      <div className="text-[10px] text-cortex-muted">一料號可對多供應商 / 多單價 · 選一為採用價(進 rollup)</div>

      {/* 供應商報價(選一為採用價) */}
      <div>
        <div className="text-[10px] font-semibold text-cortex-muted uppercase mb-1">供應商報價(選一為採用價)</div>
        {priced.length === 0 && <div className="text-[11px] text-cortex-muted mb-1">尚無報價,下方新增報價。</div>}
        <div className="space-y-1">
          {priced.map((s: any) => {
            const t = (s.tiers || []).find((x: any) => Number(x.is_chosen) === 1) || (s.tiers || [])[0]
            const mfg = (detail.mfgs || []).find((m: any) => Number(m.id) === Number(s.bom_item_mfg_id))
            const chosen = Number(s.is_chosen) === 1
            const editing = editSnap === Number(s.id)
            return (
              <div key={s.id} className={`text-[11px] rounded border ${chosen ? 'border-cortex-teal bg-cortex-cyan-bg/40' : 'border-cortex-line bg-white'}`}>
                <div className="flex items-center gap-2 px-2 py-1">
                  <button onClick={() => choose(s.id)} disabled={chosen} title="選為 rollup 採用價"
                    className={`flex items-center gap-1 shrink-0 rounded px-1 py-0.5 ${chosen ? 'cursor-default' : 'cursor-pointer hover:bg-cortex-cyan-bg'}`}>
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${chosen ? 'bg-cortex-teal border-cortex-teal' : 'border-cortex-muted'}`}>
                      {chosen && <Check className="w-2.5 h-2.5 text-white" />}
                    </span>
                    <span className={`text-[9px] whitespace-nowrap ${chosen ? 'text-cortex-teal font-semibold' : 'text-cortex-muted'}`}>{chosen ? '採用中' : '選採用'}</span>
                  </button>
                  <span className="flex-1 truncate">{mfg?.manufacturer_name || mfg?.mfg_part_number || '(未指定供應商)'}</span>
                  <span className="font-mono">quote {money(s.applied_price_usd)}</span>
                  {t && <span className="font-mono text-cortex-muted">true {money(t.true_cost_usd)} · mk {pct(t.markup_pct)}</span>}
                  <button onClick={() => (editing ? setEditSnap(null) : startEdit(s, t, mfg))} disabled={busy} title="編輯這筆"
                    className="shrink-0 p-0.5 text-cortex-muted hover:text-cortex-teal">{editing ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}</button>
                  <button onClick={() => delPrice(s.id)} disabled={busy} title="刪除這筆"
                    className="shrink-0 p-0.5 text-cortex-muted hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                </div>
                {editing && (
                  <div className="flex items-end gap-1.5 flex-wrap border-t border-cortex-line/60 px-2 py-1.5 bg-cortex-bg/40">
                    <label className="text-[10px] text-cortex-muted">供應商<br /><input value={eVendor} onChange={(e) => setEVendor(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-28" /></label>
                    <label className="text-[10px] text-cortex-muted">Mfg P/N<br /><input value={eMfgPn} onChange={(e) => setEMfgPn(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-28 font-mono" /></label>
                    <label className="text-[10px] text-cortex-muted">幣別<br /><input value={eCur} onChange={(e) => setECur(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-12" /></label>
                    <label className="text-[10px] text-cortex-muted">true(原幣)<br /><input value={eTrue} onChange={(e) => setETrue(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-16 font-mono" /></label>
                    <label className="text-[10px] text-cortex-muted">fx<br /><input value={eFx} onChange={(e) => setEFx(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-12 font-mono" /></label>
                    <label className="text-[10px] text-cortex-muted">quote(USD)<br /><input value={eQuote} onChange={(e) => setEQuote(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-20 font-mono" /></label>
                    <button onClick={() => saveEdit(s.id)} disabled={busy} className="flex items-center gap-1 text-[11px] px-2 py-1 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40"><Save className="w-3 h-3" />存</button>
                  </div>
                )}
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
