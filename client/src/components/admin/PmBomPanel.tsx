import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Upload, Download, Plus, Edit3, Trash2, RefreshCw, X, BarChart3 } from 'lucide-react'
import api from '../../lib/api'

interface BomRow {
  id: number
  product_code: string
  product_name?: string
  product_line?: string
  metal_code: string
  content_gram: number
  content_unit: string
  monthly_volume?: number
  content_source?: string
  valid_from: string
  valid_to?: string | null
  notes?: string
}

interface MetalSummary {
  metal_code: string
  product_count: number
  total_monthly_grams: number
  product_line_count: number
}

export default function PmBomPanel() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<BomRow[]>([])
  const [summary, setSummary] = useState<MetalSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [filterProduct, setFilterProduct] = useState('')
  const [filterMetal, setFilterMetal] = useState('')
  const [filterLine, setFilterLine] = useState('')
  const [editing, setEditing] = useState<BomRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [uploadResult, setUploadResult] = useState<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterProduct) params.set('product_code', filterProduct)
      if (filterMetal) params.set('metal_code', filterMetal)
      if (filterLine) params.set('product_line', filterLine)
      const [r, s] = await Promise.all([
        api.get(`/pm-bom?${params}`),
        api.get('/pm-bom/summary'),
      ])
      setRows(r.data || [])
      setSummary(s.data || [])
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const remove = async (r: BomRow) => {
    if (!confirm(`刪除 ${r.product_code} / ${r.metal_code}?`)) return
    try {
      await api.delete(`/pm-bom/${r.id}`)
      load()
    } catch (e: any) { alert(e?.response?.data?.error || e.message) }
  }

  const uploadCsv = async (mode: 'insert' | 'upsert') => {
    const f = fileRef.current?.files?.[0]
    if (!f) { alert('請選 CSV 檔'); return }
    const fd = new FormData()
    fd.append('file', f)
    fd.append('mode', mode)
    setUploadResult(null)
    try {
      const r = await api.post('/pm-bom/upload-csv', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setUploadResult(r.data)
      load()
    } catch (e: any) {
      setUploadResult({ error: e?.response?.data?.error || e.message })
    }
  }

  const exportCsv = async () => {
    try {
      const r = await api.get('/pm-bom/export-csv', { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `pm_bom_metal_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { alert(e?.response?.data?.error || e.message) }
  }

  return (
    <div className="space-y-3">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Database size={18} className="text-amber-600" />
            BOM 金屬含量管理
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            維護產品 → 金屬含量 mapping(克數 / 月用量),供 <code className="bg-slate-100 px-1">pm_what_if_cost_impact</code> Skill 算成本衝擊。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700">
            <Plus size={12} /> 新增單筆
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600">
            <Download size={12} /> 匯出 CSV
          </button>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {/* Summary */}
      {summary.length > 0 && (
        <div className="border border-slate-200 rounded-lg p-3 bg-amber-50/50">
          <div className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1.5">
            <BarChart3 size={13} className="text-amber-600" /> 各金屬使用統計(月)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {summary.map(s => (
              <div key={s.metal_code} className="bg-white border border-slate-200 rounded p-2 text-xs">
                <div className="font-bold text-amber-700">{s.metal_code}</div>
                <div className="text-slate-600">{s.product_count} 個產品 / {s.product_line_count} 個產線</div>
                <div className="text-slate-500 mt-1">月總用量:<span className="font-mono">{Number(s.total_monthly_grams || 0).toLocaleString()}</span> g</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CSV upload */}
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
        <div className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1.5">
          <Upload size={13} className="text-slate-600" /> 批次匯入 CSV
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="text-xs" />
          <button onClick={() => uploadCsv('upsert')} className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">UPSERT 匯入</button>
          <button onClick={() => uploadCsv('insert')} className="text-xs px-3 py-1 rounded border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600">INSERT 匯入</button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">
          欄位:<code>product_code, product_name, product_line, metal_code, content_gram, monthly_volume, content_source, valid_from, notes</code>。
          UPSERT = 同 (product_code, metal_code, valid_from) 已有則更新,沒有則新增;INSERT = 重複跳過。
        </p>
        {uploadResult && (
          <pre className="mt-2 text-[10px] font-mono bg-white border border-slate-200 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(uploadResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 text-xs">
        <input type="text" className="input flex-1" placeholder="篩選 product_code…" value={filterProduct} onChange={e => setFilterProduct(e.target.value)} />
        <input type="text" className="input w-24" placeholder="metal_code" value={filterMetal} onChange={e => setFilterMetal(e.target.value)} />
        <input type="text" className="input w-32" placeholder="product_line" value={filterLine} onChange={e => setFilterLine(e.target.value)} />
        <button onClick={load} className="text-xs px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300">套用</button>
        <span className="text-slate-400 ml-auto">共 {rows.length} 筆</span>
      </div>

      {/* Rows table */}
      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left font-medium">product_code</th>
              <th className="px-2 py-2 text-left font-medium">product_name</th>
              <th className="px-2 py-2 text-left font-medium">product_line</th>
              <th className="px-2 py-2 text-left font-medium">metal</th>
              <th className="px-2 py-2 text-right font-medium">含量 (g)</th>
              <th className="px-2 py-2 text-right font-medium">月用量</th>
              <th className="px-2 py-2 text-left font-medium">source</th>
              <th className="px-2 py-2 text-left font-medium">valid_from</th>
              <th className="px-2 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">{loading ? '載入中…' : '尚無 BOM 資料。請新增單筆或上傳 CSV。'}</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-2 py-1.5 font-mono text-slate-700">{r.product_code}</td>
                <td className="px-2 py-1.5 text-slate-600 max-w-xs truncate">{r.product_name || '—'}</td>
                <td className="px-2 py-1.5 text-slate-600">{r.product_line || '—'}</td>
                <td className="px-2 py-1.5"><span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{r.metal_code}</span></td>
                <td className="px-2 py-1.5 text-right font-mono">{Number(r.content_gram).toFixed(3)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-500">{r.monthly_volume?.toLocaleString() || '—'}</td>
                <td className="px-2 py-1.5 text-slate-400 text-[10px]">{r.content_source || '—'}</td>
                <td className="px-2 py-1.5 text-slate-400 text-[10px]">{r.valid_from?.slice(0, 10)}</td>
                <td className="px-2 py-1.5 text-right">
                  <button onClick={() => setEditing(r)} className="p-1 text-slate-400 hover:text-blue-600"><Edit3 size={12} /></button>
                  <button onClick={() => remove(r)} className="p-1 text-slate-400 hover:text-rose-500"><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Editor modal */}
      {(creating || editing) && (
        <BomEditor
          mode={creating ? 'create' : 'edit'}
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}

      <p className="text-[10px] text-slate-400">
        BOM 資料會被 <code className="bg-slate-100 px-1">pm_what_if_cost_impact</code> Skill 用 — chat 時提問「銅漲 10% 對我們有什麼影響?」LLM 會自動撈本表 + 算成本衝擊 + 給採購建議。
      </p>
    </div>
  )
}

function BomEditor({ mode, initial, onClose, onSaved }: {
  mode: 'create' | 'edit'; initial: BomRow | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<any>(() => initial || {
    product_code: '',
    product_name: '',
    product_line: '',
    metal_code: '',
    content_gram: '',
    content_unit: 'g',
    monthly_volume: '',
    content_source: 'manual',
    valid_from: new Date().toISOString().slice(0, 10),
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k: string, v: any) => setForm({ ...form, [k]: v })

  const save = async () => {
    if (!form.product_code?.trim() || !form.metal_code?.trim() || form.content_gram === '') {
      alert('product_code / metal_code / content_gram 必填')
      return
    }
    setSaving(true)
    try {
      if (mode === 'edit' && initial) await api.put(`/pm-bom/${initial.id}`, form)
      else await api.post('/pm-bom', form)
      onSaved()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{mode === 'create' ? '新增 BOM' : '編輯 BOM'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-slate-600 mb-1">product_code *</label>
              <input className="input w-full font-mono" value={form.product_code} disabled={mode === 'edit'} onChange={e => set('product_code', e.target.value)} /></div>
            <div><label className="block text-slate-600 mb-1">metal_code *</label>
              <input className="input w-full font-mono" value={form.metal_code} disabled={mode === 'edit'} onChange={e => set('metal_code', e.target.value.toUpperCase())} placeholder="CU/AL/AU…" /></div>
          </div>
          <div><label className="block text-slate-600 mb-1">product_name</label>
            <input className="input w-full" value={form.product_name || ''} onChange={e => set('product_name', e.target.value)} /></div>
          <div><label className="block text-slate-600 mb-1">product_line</label>
            <input className="input w-full" value={form.product_line || ''} onChange={e => set('product_line', e.target.value)} placeholder="Connector / Cable / …" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-slate-600 mb-1">content_gram *</label>
              <input type="number" step="any" className="input w-full" value={form.content_gram} onChange={e => set('content_gram', e.target.value)} /></div>
            <div><label className="block text-slate-600 mb-1">monthly_volume(產品數)</label>
              <input type="number" className="input w-full" value={form.monthly_volume || ''} onChange={e => set('monthly_volume', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-slate-600 mb-1">content_source</label>
              <input className="input w-full" value={form.content_source || ''} onChange={e => set('content_source', e.target.value)} placeholder="ERP / 供應商 SDS / 量測" /></div>
            <div><label className="block text-slate-600 mb-1">valid_from</label>
              <input type="date" className="input w-full" value={form.valid_from} disabled={mode === 'edit'} onChange={e => set('valid_from', e.target.value)} /></div>
          </div>
          {mode === 'edit' && (
            <div><label className="block text-slate-600 mb-1">valid_to(空 = 現行有效)</label>
              <input type="date" className="input w-full" value={form.valid_to || ''} onChange={e => set('valid_to', e.target.value)} /></div>
          )}
          <div><label className="block text-slate-600 mb-1">notes</label>
            <input className="input w-full" value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">取消</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-xs rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">
            {saving ? '儲存中…' : (mode === 'create' ? '建立' : '更新')}
          </button>
        </div>
      </div>
    </div>
  )
}
