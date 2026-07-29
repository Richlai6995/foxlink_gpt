/**
 * BomMetaCard — BOM 案級欄 + 採購策略總覽(v0.16 plan #4)
 *
 * 案級欄:ECN 版本 / 客供料(有無+明細)→ form.bom_meta;lock 狀態由 quote version 推導(唯讀 badge)。
 * 採購策略總覽:每料 chosen vendor + price 一覽(GET /instances/:id/sourcing)+ 單一來源風險計數。
 */

import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Loader2, ChevronDown, ChevronRight, ClipboardList } from 'lucide-react'

const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(6)}` : '—')

export function BomMetaCard({ projectId }: { projectId: number }) {
  const { token } = useAuth() as any
  const [vals, setVals] = useState<Record<string, string>>({})
  const [lock, setLock] = useState<'DRAFT' | 'SUBMITTED' | 'LOCKED'>('DRAFT')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!token) return
    api.get<any>(token, `/bom/form?projectId=${projectId}`).then((r) => setVals(r.form?.bom_meta || {})).catch(() => {})
    api.get<any>(token, `/bom/quote?projectId=${projectId}`).then((q) => {
      const vs = q?.versions || []
      setLock(vs.some((v: any) => v.status === 'APPROVED') ? 'LOCKED' : vs.some((v: any) => v.status === 'SUBMITTED') ? 'SUBMITTED' : 'DRAFT')
    }).catch(() => {})
  }, [token, projectId])
  const set = (k: string, v: string) => { setVals((p) => ({ ...p, [k]: v })); setDirty(true) }
  async function save() {
    setBusy(true); setMsg('')
    try {
      await api.put(token, '/bom/form/bom_meta', { projectId, fields: vals })
      setDirty(false); setMsg('✓'); window.dispatchEvent(new CustomEvent('cortex:form-refresh'))
      setTimeout(() => setMsg(''), 2000)
    } catch (e: any) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="border border-cortex-line rounded-lg p-2.5 flex items-end gap-3 flex-wrap text-[11px]">
      <span className={`px-2 py-1 rounded font-bold text-[10px] ${lock === 'LOCKED' ? 'bg-green-100 text-green-700' : lock === 'SUBMITTED' ? 'bg-amber-100 text-amber-700' : 'bg-cortex-line text-cortex-muted'}`}>
        {lock === 'LOCKED' ? '🔒 BOM LOCKED(已定版)' : lock === 'SUBMITTED' ? '⏳ 送審中' : '✏️ DRAFT'}
      </span>
      <label className="text-[10px] text-cortex-muted">ECN 版本<br />
        <input value={vals.ecn_version || ''} onChange={(e) => set('ecn_version', e.target.value)} placeholder="ECN-2026-04-A2"
          className="mt-0.5 border border-cortex-line rounded px-1.5 py-0.5 text-[11px] font-mono w-36" /></label>
      <label className="text-[10px] text-cortex-muted">客供料<br />
        <select value={vals.has_consign || ''} onChange={(e) => set('has_consign', e.target.value)}
          className="mt-0.5 border border-cortex-line rounded px-1.5 py-0.5 text-[11px] bg-white">
          <option value="">—</option><option value="無">無</option><option value="有">有</option>
        </select></label>
      {vals.has_consign === '有' && (
        <label className="text-[10px] text-cortex-muted flex-1 min-w-[220px]">客供料明細<br />
          <input value={vals.consign_list || ''} onChange={(e) => set('consign_list', e.target.value)} placeholder="客供 IC ×1(PMW3320)…"
            className="mt-0.5 w-full border border-cortex-line rounded px-1.5 py-0.5 text-[11px]" /></label>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        {msg && <span className={`text-[10px] ${msg === '✓' ? 'text-green-600' : 'text-red-600'}`}>{msg}</span>}
        <button onClick={save} disabled={busy || !dirty}
          className="px-2 py-1 bg-cortex-navy text-white rounded hover:opacity-90 disabled:opacity-40 text-[10px]">
          {busy ? <Loader2 className="w-3 h-3 inline animate-spin" /> : '存檔'}
        </button>
      </span>
    </div>
  )
}

export function SourcingOverview({ bomInstanceId }: { bomInstanceId: number }) {
  const { token } = useAuth() as any
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ count: number; singleSource: number; items: any[] } | null>(null)
  const [busy, setBusy] = useState(false)
  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (!data) {
      setBusy(true)
      try { setData(await api.get<any>(token, `/bom/instances/${bomInstanceId}/sourcing`)) } catch { /* noop */ } finally { setBusy(false) }
    }
  }
  return (
    <div className="border border-cortex-line rounded-lg overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-cortex-ink hover:bg-cortex-bg/50">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <ClipboardList className="w-4 h-4 text-cortex-teal" /> 採購策略總覽
        <span className="text-[10px] text-cortex-muted font-normal">每料採用 vendor / 單價 一覽 · 單一來源風險</span>
        {data && <span className="ml-auto text-[10px] font-mono text-cortex-muted">{data.count} 料 · 單一來源 {data.singleSource}</span>}
      </button>
      {open && (
        <div className="border-t border-cortex-line max-h-[400px] overflow-auto">
          {busy && <div className="p-3 text-[11px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入…</div>}
          {data && (
            <table className="w-full text-[10px]">
              <thead className="text-cortex-muted border-b border-cortex-line sticky top-0 bg-white"><tr>
                <th className="text-left px-2 py-1">模組</th><th className="text-left px-2 py-1">Item</th>
                <th className="text-left px-2 py-1">Description</th><th className="text-left px-2 py-1">採用料號</th>
                <th className="text-left px-2 py-1">Vendor</th><th className="text-left px-2 py-1">Mfg P/N</th>
                <th className="text-right px-2 py-1">單價</th><th className="text-right px-2 py-1">供應商數</th>
              </tr></thead>
              <tbody>
                {data.items.map((r: any, i: number) => (
                  <tr key={i} className={`border-b border-cortex-line/30 ${!r.price ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-2 py-1">{r.module_category}</td>
                    <td className="px-2 py-1 font-mono">{r.item_no || '—'}</td>
                    <td className="px-2 py-1 max-w-[240px] truncate" title={r.description}>{r.description}</td>
                    <td className="px-2 py-1 font-mono">{r.fpn || '—'}</td>
                    <td className="px-2 py-1">{r.vendor || (r.price ? '(價格未綁 vendor)' : '待詢價')}</td>
                    <td className="px-2 py-1 font-mono max-w-[130px] truncate" title={r.mfg_pn}>{r.mfg_pn || '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{money(r.price)}</td>
                    <td className={`px-2 py-1 text-right ${Number(r.vendor_count) === 1 ? 'text-amber-600 font-semibold' : ''}`}>{r.vendor_count}{Number(r.vendor_count) === 1 ? ' ⚠' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
