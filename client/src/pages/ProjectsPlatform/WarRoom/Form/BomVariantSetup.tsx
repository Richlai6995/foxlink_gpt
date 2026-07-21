/**
 * BomVariantSetup — 專案變異軸設定(B-3a:先定義,非臨時 LOV)
 *
 * 對應 docs/cortex-bom-source-excel-structure.md §3。
 * 結構軸(顏色 / 包裝方式)在此定義 + 值;import 只能填已定義的值,否則硬擋。
 * 國別 = case_factory(在 BomSection 頂部「試算廠別」管,不在此)。
 */

import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Plus, Trash2, Loader2, Layers } from 'lucide-react'

type Dim = { id: number; dimCode: string; dimName: string; values: { id: number; valueCode: string; valueName: string }[] }

export default function BomVariantSetup({ projectId, onChanged }: { projectId: number; onChanged?: () => void }) {
  const { token } = useAuth() as any
  const [dims, setDims] = useState<Dim[]>([])
  const [newDim, setNewDim] = useState('')
  const [newVal, setNewVal] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    try { const r = await api.get<{ dimensions: Dim[] }>(token, `/bom/project/${projectId}/dimensions`); setDims(r.dimensions || []) }
    catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { if (token && projectId) load() }, [token, projectId])

  const notify = () => { load(); onChanged?.() }
  async function run(fn: () => Promise<any>) { setBusy(true); setErr(''); try { await fn(); notify() } catch (e: any) { setErr(e.message) } finally { setBusy(false) } }

  const addDim = () => { if (!newDim.trim()) return; run(async () => { await api.post(token, `/bom/project/${projectId}/dimensions`, { dimCode: newDim.trim() }); setNewDim('') }) }
  const addVal = (dimId: number) => { const v = (newVal[dimId] || '').trim(); if (!v) return; run(async () => { await api.post(token, `/bom/project/${projectId}/dimensions/${dimId}/values`, { valueCode: v }); setNewVal((p) => ({ ...p, [dimId]: '' })) }) }
  const delDim = (dimId: number) => run(() => api.delete(token, `/bom/project/${projectId}/dimensions/${dimId}`))
  const delVal = (valueId: number) => run(() => api.delete(token, `/bom/project/${projectId}/values/${valueId}`))

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-cortex-muted">
        定義本專案的<b className="text-cortex-ink">結構變異軸</b>(顏色 / 包裝方式)+ 值。匯入含變異的 BOM 前需先定義,否則擋下。
        <span className="text-cortex-muted/70">（國別/廠別在上方「試算廠別」設定)</span>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}

      <div className="space-y-2">
        {dims.map((d) => (
          <div key={d.id} className="border border-cortex-line rounded-lg p-2 bg-white">
            <div className="flex items-center gap-2 mb-1.5">
              <Layers className="w-3.5 h-3.5 text-cortex-teal" />
              <span className="text-[12px] font-semibold text-cortex-ink">{d.dimName || d.dimCode}</span>
              <span className="text-[10px] text-cortex-muted">({d.values.length} 值)</span>
              <button onClick={() => delDim(d.id)} disabled={busy} title="刪維度" className="ml-auto p-0.5 text-cortex-muted hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {d.values.map((v) => (
                <span key={v.id} className="inline-flex items-center gap-1 text-[11px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-1.5 py-0.5">
                  {v.valueName || v.valueCode}
                  <button onClick={() => delVal(v.id)} disabled={busy} title="刪值" className="hover:text-red-500">×</button>
                </span>
              ))}
              <input value={newVal[d.id] || ''} onChange={(e) => setNewVal((p) => ({ ...p, [d.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addVal(d.id)} placeholder="新增值(如 Black)"
                className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-28" />
              <button onClick={() => addVal(d.id)} disabled={busy} className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 border border-cortex-line rounded hover:bg-cortex-bg disabled:opacity-40"><Plus className="w-3 h-3" />值</button>
            </div>
          </div>
        ))}
        {dims.length === 0 && <div className="text-[11px] text-cortex-muted italic">尚無變異軸。若此專案 BOM 不分顏色/包裝可略過;有的話先在下方新增。</div>}
      </div>

      <div className="flex items-center gap-1.5">
        <input value={newDim} onChange={(e) => setNewDim(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addDim()}
          placeholder="新增變異軸(如 顏色 / 包裝方式)" className="border border-cortex-line rounded px-2 py-1 text-[12px] w-52" />
        <button onClick={addDim} disabled={busy || !newDim.trim()} className="flex items-center gap-1 text-[12px] px-2.5 py-1 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} 新增軸
        </button>
      </div>
    </div>
  )
}
