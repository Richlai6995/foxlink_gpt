/**
 * BomItemsPanel — 料件明細(R-3 · Oracle ERP BOM 樹狀)
 *
 * 層級:模組 tab(EE/ME/PKG)→ 半成品(名稱+料號 · collapse)→ 分類 → Item 主列 → 展開兩層:
 *   FLK 候選(選一為採用料號)→ 每顆 FLK 底下 Vendor/報價(選一為採用價)。
 * Rollup 基礎 = 採用料號(final_flk)底下的採用價(chosen);點別顆 FLK 的報價 = 一鍵換料+換價。
 * 主列可編輯:Item No / Description / Qty / Remark(存檔 batch);採用料號唯讀(展開層選)。
 * 效能:ItemRowComp = React.memo + stable callback。i18n 待補;true cost 遮罩留 S2。
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { ChevronRight, ChevronDown, Plus, Check, Loader2, Save, Pencil, Trash2, X } from 'lucide-react'

type ItemRow = {
  module_category: string; sub_assembly?: string; sub_assy_pn?: string; category: string; id: number; item_sequence: number
  item_no: string | null; qty: number | string; fpn: string | null; description: string | null; remark: string | null
  applied_price: number | null; extended: number | null; status: string; vendor_count: number; flk_count?: number
  effectivity?: { dim: string; value: string }[]
}
type EditField = 'item_no' | 'description' | 'qty' | 'remark'

const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(6)}` : '—')   // 單價 6 位
const pct = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')
const cellInput = 'w-full bg-transparent border border-transparent hover:border-cortex-line focus:border-cortex-teal focus:bg-white rounded px-1 py-0.5 text-[11px] outline-none'

export default function BomItemsPanel({ bomInstanceId, onChanged }: { bomInstanceId: number; onChanged?: () => void }) {
  const { token } = useAuth() as any
  const [items, setItems] = useState<ItemRow[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [dirty, setDirty] = useState<Set<number>>(new Set())
  const [tab, setTab] = useState<string>('ALL')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
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
      id: x.id, itemNo: x.item_no, description: x.description, qty: x.qty, remark: x.remark,
    }))
    if (!payload.length) return
    setSaving(true); setErr('')
    try {
      await api.put(token, '/bom/items/batch', { items: payload })
      await loadItems(); onChanged?.()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  // 模組 tabs(依資料出現的模組)+ 半成品 → 分類 分組(items 已按 display_order 排序)
  const modules = useMemo(() => Array.from(new Set(items.map((i) => i.module_category).filter(Boolean))), [items])
  const tree = useMemo(() => {
    const secs: { key: string; name: string; pn?: string; module: string; count: number; pending: number; cats: { name: string; items: ItemRow[] }[] }[] = []
    const secIdx: Record<string, number> = {}
    for (const it of items) {
      if (tab !== 'ALL' && it.module_category !== tab) continue
      const sk = `${it.module_category}||${it.sub_assembly || ''}`
      if (secIdx[sk] == null) { secIdx[sk] = secs.length; secs.push({ key: sk, name: it.sub_assembly || '(未分)', pn: it.sub_assy_pn, module: it.module_category, count: 0, pending: 0, cats: [] }) }
      const sec = secs[secIdx[sk]]
      sec.count += 1; if (it.status === 'pending') sec.pending += 1
      const lastCat = sec.cats[sec.cats.length - 1]
      if (!lastCat || lastCat.name !== (it.category || '一般')) sec.cats.push({ name: it.category || '一般', items: [it] })
      else lastCat.items.push(it)
    }
    return secs
  }, [items, tab])

  const pendingN = useMemo(() => items.filter((i) => i.status === 'pending').length, [items])
  const toggleSec = (key: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })

  return (
    <div className="border border-cortex-line rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-cortex-bg/60 border-b border-cortex-line flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="text-[12px] font-semibold text-cortex-ink">
            料件明細 · 採購詢價
            <span className="text-cortex-muted font-normal"> ({items.length} 筆{pendingN > 0 ? ` · ${pendingN} 待詢價` : ' · 全已詢價'})</span>
          </div>
          {/* 模組 tabs */}
          <div className="flex items-center gap-0.5">
            {['ALL', ...modules].map((m) => (
              <button key={m} onClick={() => setTab(m)}
                className={`text-[11px] px-2 py-0.5 rounded ${tab === m ? 'bg-cortex-navy text-white' : 'text-cortex-muted hover:bg-cortex-bg'}`}>
                {m === 'ALL' ? '全部' : m}
              </button>
            ))}
          </div>
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
        <table className="w-full text-[11px] min-w-[860px]">
          <thead className="text-cortex-muted bg-white border-b border-cortex-line">
            <tr>
              <th className="w-6 px-2 py-1"></th>
              <th className="text-left px-2 py-1 w-24">分類</th>
              <th className="text-left px-2 py-1 w-16">Item No</th>
              <th className="text-left px-2 py-1">Description</th>
              <th className="text-right px-2 py-1 w-12">Qty</th>
              <th className="text-left px-2 py-1 w-24">Remark</th>
              <th className="text-left px-2 py-1 w-32">採用料號</th>
              <th className="text-right px-2 py-1">採用價</th>
              <th className="text-center px-2 py-1">狀態</th>
              <th className="text-center px-2 py-1 w-8" title="FLK 候選 / 供應商">候/供</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((sec) => (
              <SectionGroup key={sec.key} sec={sec} collapsed={collapsed.has(sec.key)} onToggleSec={toggleSec}
                expanded={expanded} dirty={dirty} onToggle={onToggle} onEdit={onEdit} token={token} onChanged={onChangedRow} />
            ))}
          </tbody>
        </table>
      </div>
      {loading && <div className="px-3 py-2 text-[11px] text-cortex-muted"><Loader2 className="w-3 h-3 inline animate-spin" /> 載入中…</div>}
    </div>
  )
}

function SectionGroup({ sec, collapsed, onToggleSec, expanded, dirty, onToggle, onEdit, token, onChanged }: {
  sec: { key: string; name: string; pn?: string; module: string; count: number; pending: number; cats: { name: string; items: ItemRow[] }[] }
  collapsed: boolean; onToggleSec: (k: string) => void
  expanded: number | null; dirty: Set<number>
  onToggle: (id: number) => void; onEdit: (id: number, f: EditField, v: string) => void
  token: string; onChanged: () => void
}) {
  return (
    <>
      {/* 半成品 group header */}
      <tr className="bg-cortex-navy/5 border-b border-cortex-line cursor-pointer hover:bg-cortex-navy/10" onClick={() => onToggleSec(sec.key)}>
        <td colSpan={10} className="px-2 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-cortex-ink">
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {sec.name}
            {sec.pn && <span className="font-mono text-[10px] text-cortex-muted font-normal">{sec.pn}</span>}
            <span className="text-[9px] bg-cortex-bg border border-cortex-line rounded px-1 py-0.5 font-normal text-cortex-muted">{sec.module}</span>
            <span className="text-[10px] text-cortex-muted font-normal">{sec.count} 料{sec.pending > 0 ? ` · ⚠${sec.pending} 待詢價` : ''}</span>
          </span>
        </td>
      </tr>
      {!collapsed && sec.cats.map((cat, ci) => (
        <CatGroup key={`${sec.key}||${cat.name}||${ci}`} cat={cat} expanded={expanded} dirty={dirty} onToggle={onToggle} onEdit={onEdit} token={token} onChanged={onChanged} />
      ))}
    </>
  )
}

function CatGroup({ cat, expanded, dirty, onToggle, onEdit, token, onChanged }: {
  cat: { name: string; items: ItemRow[] }
  expanded: number | null; dirty: Set<number>
  onToggle: (id: number) => void; onEdit: (id: number, f: EditField, v: string) => void
  token: string; onChanged: () => void
}) {
  return (
    <>
      {cat.items.map((it, i) => (
        <ItemRowComp key={it.id} it={it} catName={i === 0 ? cat.name : ''}
          expanded={expanded === it.id} dirty={dirty.has(it.id)}
          onToggle={onToggle} onEdit={onEdit} token={token} onChanged={onChanged} />
      ))}
    </>
  )
}

// React.memo:只有本列 it/expanded/dirty 變才重繪
const ItemRowComp = memo(function ItemRowComp({ it, catName, expanded, dirty, onToggle, onEdit, token, onChanged }: {
  it: ItemRow; catName: string; expanded: boolean; dirty: boolean
  onToggle: (id: number) => void; onEdit: (id: number, f: EditField, v: string) => void
  token: string; onChanged: () => void
}) {
  return (
    <>
      <tr className={`border-b border-cortex-line/40 ${it.status === 'pending' ? 'bg-amber-50/50' : ''} ${dirty ? 'ring-1 ring-inset ring-cortex-teal/30' : ''}`}>
        <td className="px-2 py-1 text-cortex-muted cursor-pointer hover:text-cortex-teal" onClick={() => onToggle(it.id)}>
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </td>
        <td className="px-2 py-1 text-[10px] text-cortex-muted border-r border-cortex-line/40">{catName}</td>
        <td className="px-2 py-1"><input value={it.item_no ?? ''} onChange={(e) => onEdit(it.id, 'item_no', e.target.value)} className={cellInput} /></td>
        <td className="px-2 py-1">
          <div className="flex items-center gap-1">
            <input value={it.description ?? ''} onChange={(e) => onEdit(it.id, 'description', e.target.value)} className={cellInput} />
            {it.effectivity && it.effectivity.length > 0 && it.effectivity.map((e, i) => (
              <span key={i} className="text-[9px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded whitespace-nowrap shrink-0">{e.dim}:{e.value}</span>
            ))}
          </div>
        </td>
        <td className="px-2 py-1"><input value={String(it.qty ?? '')} onChange={(e) => onEdit(it.id, 'qty', e.target.value)} className={`${cellInput} text-right font-mono`} /></td>
        <td className="px-2 py-1"><input value={it.remark ?? ''} onChange={(e) => onEdit(it.id, 'remark', e.target.value)} placeholder="—" className={cellInput} /></td>
        <td className="px-2 py-1 font-mono text-[10px] text-cortex-ink" title="採用料號(展開選/換)">{it.fpn || <span className="text-cortex-muted/70">(未定料號)</span>}</td>
        <td className="px-2 py-1 text-right font-mono">{money(it.applied_price)}</td>
        <td className="px-2 py-1 text-center">
          {it.status === 'priced'
            ? <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded whitespace-nowrap">已詢價</span>
            : <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap">待詢價</span>}
        </td>
        <td className="px-2 py-1 text-center font-mono text-[10px]">{it.flk_count ?? 1}/{it.vendor_count}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="px-3 py-2 bg-cortex-bg/30 border-b border-cortex-line">
            <ItemEnrich itemId={it.id} token={token} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  )
})

/* ── 展開層:FLK 候選(選採用料號)→ 每顆 FLK 的 Vendor/報價(選採用價)── */
function ItemEnrich({ itemId, token, onChanged }: { itemId: number; token: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // per-FLK 新增 vendor / 報價 表單(掛在展開的那顆 FLK)
  const [formFlk, setFormFlk] = useState<number | null>(null)
  const [vName, setVName] = useState(''); const [vPn, setVPn] = useState('')
  const [pMfg, setPMfg] = useState<number | ''>(''); const [pCur, setPCur] = useState('USD')
  const [pTrue, setPTrue] = useState(''); const [pFx, setPFx] = useState('1'); const [pQuote, setPQuote] = useState('')
  // 編輯既有報價
  const [editSnap, setEditSnap] = useState<number | null>(null)
  const [eVendor, setEVendor] = useState(''); const [eMfgPn, setEMfgPn] = useState(''); const [eCur, setECur] = useState('USD')
  const [eTrue, setETrue] = useState(''); const [eFx, setEFx] = useState('1'); const [eQuote, setEQuote] = useState('')
  // 加 FLK 候選
  const [showAddFlk, setShowAddFlk] = useState(false)
  const [nFpn, setNFpn] = useState(''); const [nDesc, setNDesc] = useState('')

  async function load() { try { setDetail(await api.get(token, `/bom/items/${itemId}/detail`)) } catch (e: any) { setErr(e.message) } }
  useEffect(() => { load() }, [itemId])

  async function act(fn: () => Promise<any>) { setBusy(true); setErr(''); try { await fn(); await load(); onChanged() } catch (e: any) { setErr(e.message) } finally { setBusy(false) } }

  const chooseFlk = (flkId: number) => act(() => api.put(token, `/bom/items/${itemId}/choose-flk`, { flkId }))
  const choose = (snapshotId: number) => act(() => api.put(token, `/bom/items/${itemId}/choose`, { snapshotId }))   // 換價(跨 FLK 自動換料)
  const delPrice = (snapshotId: number) => { if (!confirm('刪除這筆報價?')) return; act(() => api.delete(token, `/bom/items/${itemId}/price/${snapshotId}`)) }
  const addFlk = () => { if (!nFpn && !nDesc) { setErr('填 FLK 料號或描述'); return } act(async () => { await api.post(token, `/bom/items/${itemId}/flk`, { fpn: nFpn, desc: nDesc }); setNFpn(''); setNDesc(''); setShowAddFlk(false) }) }
  const addVendor = (flkId: number) => { if (!vName && !vPn) { setErr('填供應商或 Mfg P/N'); return } act(async () => { await api.post(token, `/bom/items/${itemId}/vendor`, { vendor: vName, mfgPn: vPn, flkId }); setVName(''); setVPn('') }) }
  const addPrice = (flkId: number) => {
    if (!pQuote) { setErr('請填報價 quote(USD)'); return }
    act(async () => {
      await api.post(token, `/bom/items/${itemId}/price`, {
        mfgId: pMfg || null, flkId, sourceCurrency: pCur,
        tiers: [{ sourceCurrency: pCur, trueCostSource: pTrue ? Number(pTrue) : null, fxRate: Number(pFx) || 1, quotePrice: Number(pQuote), isChosen: true }],
      })
      setPTrue(''); setPQuote('')
    })
  }
  function startEdit(s: any, t: any, mfg: any) {
    setEditSnap(Number(s.id)); setErr('')
    setEVendor(mfg?.manufacturer_name || ''); setEMfgPn(mfg?.mfg_part_number || '')
    setECur(t?.source_currency || 'USD'); setETrue(t?.true_cost_source != null ? String(t.true_cost_source) : '')
    setEFx(t?.fx_rate != null ? String(t.fx_rate) : '1'); setEQuote(t?.quote_price_usd != null ? String(t.quote_price_usd) : '')
  }
  const saveEdit = (snapshotId: number) => act(async () => {
    await api.put(token, `/bom/items/${itemId}/price/${snapshotId}`, {
      vendor: eVendor, mfgPn: eMfgPn, sourceCurrency: eCur,
      trueCostSource: eTrue === '' ? null : Number(eTrue), fxRate: Number(eFx) || 1, quotePrice: eQuote === '' ? null : Number(eQuote),
    })
    setEditSnap(null)
  })

  if (!detail) return <div className="text-[11px] text-cortex-muted"><Loader2 className="w-3 h-3 inline animate-spin" /> 載入…</div>

  return (
    <div className="space-y-2">
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      <div className="text-[10px] text-cortex-muted">
        一 BOM 料號 → 多顆 <b>FLK 候選料號</b> → 每顆多組 Vendor/報價。Rollup = <b>採用料號</b>底下的<b>採用價</b>;點別顆候選的報價 = 一鍵換料+換價。
      </div>

      {(detail.flks || []).map((f: any) => {
        const isFinal = Number(f.is_final) === 1
        const showForm = formFlk === Number(f.id)
        return (
          <div key={f.id ?? 'legacy'} className={`rounded border ${isFinal ? 'border-cortex-teal bg-cortex-cyan-bg/20' : 'border-cortex-line bg-white'}`}>
            {/* FLK 候選列(選採用料號) */}
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button onClick={() => f.id && chooseFlk(Number(f.id))} disabled={busy || isFinal || !f.id} title="選為採用料號"
                className={`flex items-center gap-1 shrink-0 rounded px-1 py-0.5 ${isFinal ? 'cursor-default' : 'cursor-pointer hover:bg-cortex-cyan-bg'}`}>
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isFinal ? 'bg-cortex-teal border-cortex-teal' : 'border-cortex-muted'}`}>
                  {isFinal && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                <span className={`text-[9px] whitespace-nowrap ${isFinal ? 'text-cortex-teal font-semibold' : 'text-cortex-muted'}`}>{isFinal ? '採用料號' : '選採用'}</span>
              </button>
              <span className="font-mono text-[11px] text-cortex-ink shrink-0">{f.flk_part_number || '(未定料號)'}</span>
              <span className="text-[11px] text-cortex-muted truncate flex-1">{f.description || ''}</span>
              <button onClick={() => { setFormFlk(showForm ? null : Number(f.id)); setErr('') }} disabled={busy}
                className="shrink-0 text-[10px] text-cortex-teal hover:underline">{showForm ? '收合' : '＋供應商/報價'}</button>
            </div>

            {/* 這顆 FLK 的報價列(選採用價) */}
            <div className="px-2 pb-1.5 space-y-1">
              {(f.snapshots || []).map((s: any) => {
                const t = (s.tiers || []).find((x: any) => Number(x.is_chosen) === 1) || (s.tiers || [])[0]
                const mfg = (f.mfgs || []).find((m: any) => Number(m.id) === Number(s.bom_item_mfg_id))
                const chosen = Number(s.is_chosen) === 1
                const editing = editSnap === Number(s.id)
                return (
                  <div key={s.id} className={`rounded border text-[11px] ${chosen ? 'border-cortex-teal bg-cortex-cyan-bg/40' : 'border-cortex-line/60 bg-white'}`}>
                    <div className="flex items-center gap-2 px-2 py-1">
                      <button onClick={() => choose(s.id)} disabled={busy || chosen} title={chosen ? '採用中' : '選為採用價(跨候選自動換料)'}
                        className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${chosen ? 'bg-cortex-teal border-cortex-teal cursor-default' : 'border-cortex-muted hover:border-cortex-teal'}`}>
                        {chosen && <Check className="w-2 h-2 text-white" />}
                      </button>
                      <span className="flex-1 truncate">{mfg?.manufacturer_name || mfg?.mfg_part_number || '(未指定供應商)'}{mfg?.mfg_part_number && mfg?.manufacturer_name ? ` / ${mfg.mfg_part_number}` : ''}</span>
                      <span className="font-mono">quote {money(s.applied_price_usd)}</span>
                      {t && <span className="font-mono text-cortex-muted">true {money(t.true_cost_usd)} · mk {pct(t.markup_pct)}</span>}
                      <button onClick={() => (editing ? setEditSnap(null) : startEdit(s, t, mfg))} disabled={busy} title="編輯"
                        className="shrink-0 p-0.5 text-cortex-muted hover:text-cortex-teal">{editing ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}</button>
                      <button onClick={() => delPrice(s.id)} disabled={busy} title="刪除"
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
              {(f.snapshots || []).length === 0 && <div className="text-[10px] text-cortex-muted italic px-1">此候選尚無報價</div>}

              {/* per-FLK 新增供應商 / 報價 */}
              {showForm && (
                <div className="space-y-1.5 border-t border-cortex-line/60 pt-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="供應商" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-28" />
                    <input value={vPn} onChange={(e) => setVPn(e.target.value)} placeholder="Mfg P/N" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-28 font-mono" />
                    <button onClick={() => addVendor(Number(f.id))} disabled={busy} className="flex items-center gap-1 text-[11px] px-2 py-0.5 border border-cortex-line rounded hover:bg-white disabled:opacity-40"><Plus className="w-3 h-3" />加供應商</button>
                  </div>
                  <div className="flex items-end gap-1.5 flex-wrap bg-white border border-cortex-line rounded p-2">
                    <label className="text-[10px] text-cortex-muted">供應商<br />
                      <select value={pMfg} onChange={(e) => setPMfg(e.target.value ? Number(e.target.value) : '')} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-28">
                        <option value="">(未指定)</option>
                        {(f.mfgs || []).map((m: any) => <option key={m.id} value={m.id}>{m.manufacturer_name || m.mfg_part_number || `#${m.id}`}</option>)}
                      </select>
                    </label>
                    <label className="text-[10px] text-cortex-muted">幣別<br /><input value={pCur} onChange={(e) => setPCur(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-14" /></label>
                    <label className="text-[10px] text-cortex-muted">true(原幣)<br /><input value={pTrue} onChange={(e) => setPTrue(e.target.value)} placeholder="1.42" className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-16 font-mono" /></label>
                    <label className="text-[10px] text-cortex-muted">fx<br /><input value={pFx} onChange={(e) => setPFx(e.target.value)} className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-12 font-mono" /></label>
                    <label className="text-[10px] text-cortex-muted">quote(USD)<br /><input value={pQuote} onChange={(e) => setPQuote(e.target.value)} placeholder="0.30" className="border border-cortex-line rounded px-1 py-0.5 text-[11px] w-20 font-mono" /></label>
                    <button onClick={() => addPrice(Number(f.id))} disabled={busy} className="flex items-center gap-1 text-[11px] px-2 py-1 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40"><Plus className="w-3 h-3" />加報價</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* 加 FLK 候選 */}
      {showAddFlk ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input value={nFpn} onChange={(e) => setNFpn(e.target.value)} placeholder="FLK 料號(如 07CA-…)" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-40 font-mono" autoFocus />
          <input value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder="描述(選填)" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-52" />
          <button onClick={addFlk} disabled={busy} className="flex items-center gap-1 text-[11px] px-2 py-0.5 bg-cortex-navy text-white rounded hover:opacity-90 disabled:opacity-40"><Plus className="w-3 h-3" />加入候選</button>
          <button onClick={() => setShowAddFlk(false)} className="text-[11px] text-cortex-muted hover:underline">取消</button>
        </div>
      ) : (
        <button onClick={() => setShowAddFlk(true)} disabled={busy} className="flex items-center gap-1 text-[11px] px-2 py-0.5 border border-dashed border-cortex-line rounded text-cortex-muted hover:text-cortex-teal hover:border-cortex-teal disabled:opacity-40">
          <Plus className="w-3 h-3" />加 FLK 候選料號
        </button>
      )}
    </div>
  )
}
