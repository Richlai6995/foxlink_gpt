import { useState, useEffect } from 'react'
import { Cpu, Plus, Trash2, Pencil, Check, X, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'
import type { LlmModel } from '../../types'
import api from '../../lib/api'

type FormData = Omit<LlmModel, 'id' | 'created_at'>

const emptyForm = (): FormData => ({
  key: '',
  name: '',
  api_model: '',
  description: '',
  is_active: 1,
  sort_order: 0,
  image_output: 0,
})

// ── FormRow must be defined OUTSIDE parent to avoid focus loss on re-render ──
interface FormRowProps {
  form: FormData
  editId: number | null
  onChange: (f: FormData) => void
  onSave: () => void
  onCancel: () => void
}

function FormRow({ form, editId, onChange, onSave, onCancel }: FormRowProps) {
  return (
    <tr className="bg-blue-50">
      <td className="px-3 py-2">
        <input value={form.key} onChange={(e) => onChange({ ...form, key: e.target.value })}
          placeholder="pro / flash / gemini-2.5-pro" className="input py-1 text-xs w-full" disabled={editId != null} />
      </td>
      <td className="px-3 py-2">
        <input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="顯示名稱" className="input py-1 text-xs w-full" />
      </td>
      <td className="px-3 py-2">
        <input value={form.api_model} onChange={(e) => onChange({ ...form, api_model: e.target.value })}
          placeholder="gemini-3-pro-preview" className="input py-1 text-xs w-full font-mono" />
      </td>
      <td className="px-3 py-2">
        <input value={form.description || ''} onChange={(e) => onChange({ ...form, description: e.target.value })}
          placeholder="簡短描述（選填）" className="input py-1 text-xs w-full" />
      </td>
      <td className="px-3 py-2">
        <input type="number" value={form.sort_order ?? 0} onChange={(e) => onChange({ ...form, sort_order: parseInt(e.target.value) || 0 })}
          className="input py-1 text-xs w-16" />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={!!form.image_output}
          onChange={(e) => onChange({ ...form, image_output: e.target.checked ? 1 : 0 })}
          className="w-4 h-4 accent-purple-600"
          title="啟用圖片輸出模式"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-2 items-center">
          <button onClick={onSave} className="text-green-600 hover:text-green-800"><Check size={16} /></button>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
      </td>
    </tr>
  )
}

export default function LlmModelsPanel() {
  const [models, setModels] = useState<LlmModel[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin/llm-models')
      setModels(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const startAdd = () => {
    setForm(emptyForm())
    setError('')
    setEditId(null)
    setAdding(true)
  }

  const startEdit = (m: LlmModel) => {
    setForm({ key: m.key, name: m.name, api_model: m.api_model, description: m.description || '', is_active: m.is_active ?? 1, sort_order: m.sort_order ?? 0, image_output: m.image_output ?? 0 })
    setError('')
    setEditId(m.id!)
    setAdding(false)
  }

  const handleSave = async () => {
    if (!form.key.trim() || !form.name.trim() || !form.api_model.trim()) {
      setError('請填寫 Key、名稱及 API 模型字串')
      return
    }
    try {
      if (editId != null) {
        await api.put(`/admin/llm-models/${editId}`, form)
        setEditId(null)
      } else {
        await api.post('/admin/llm-models', form)
        setAdding(false)
      }
      setError('')
      load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || '儲存失敗'
      setError(msg)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確定刪除此模型設定？')) return
    await api.delete(`/admin/llm-models/${id}`)
    load()
  }

  const toggleActive = async (m: LlmModel) => {
    await api.put(`/admin/llm-models/${m.id}`, { ...m, is_active: m.is_active ? 0 : 1 })
    load()
  }

  const handleCancel = () => { setAdding(false); setEditId(null); setError('') }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Cpu size={20} className="text-blue-500" /> LLM 模型設定
        </h2>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新整理
          </button>
          <button onClick={startAdd} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> 新增模型
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Key', '顯示名稱', 'API Model 字串', '描述', '排序', '圖片輸出', ''].map((h) => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {adding && <FormRow form={form} editId={null} onChange={setForm} onSave={handleSave} onCancel={handleCancel} />}
            {models.map((m) =>
              editId === m.id ? (
                <FormRow key={m.id} form={form} editId={editId} onChange={setForm} onSave={handleSave} onCancel={handleCancel} />
              ) : (
                <tr key={m.id} className={`hover:bg-slate-50 transition ${!m.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-3">
                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{m.key}</code>
                  </td>
                  <td className="px-3 py-3 font-medium text-slate-700">{m.name}</td>
                  <td className="px-3 py-3">
                    <code className="text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{m.api_model}</code>
                  </td>
                  <td className="px-3 py-3 text-slate-500 text-xs">{m.description || '-'}</td>
                  <td className="px-3 py-3 text-slate-500">{m.sort_order ?? 0}</td>
                  <td className="px-3 py-3 text-center">
                    {m.image_output ? <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">圖片</span> : <span className="text-slate-300 text-xs">-</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleActive(m)} title={m.is_active ? '停用' : '啟用'}
                        className={m.is_active ? 'text-green-500 hover:text-green-700' : 'text-slate-300 hover:text-green-500'}>
                        {m.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>
                      <button onClick={() => startEdit(m)} className="text-slate-400 hover:text-blue-600 transition">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(m.id!)} className="text-slate-400 hover:text-red-600 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
            {models.length === 0 && !loading && !adding && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">尚未設定任何模型</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-4 bg-blue-50 rounded-xl text-xs text-slate-500 space-y-1">
        <p><strong className="text-slate-600">Key</strong>：前端識別用的簡稱（如 <code>pro</code>、<code>flash</code>），不可重複，儲存後不可修改</p>
        <p><strong className="text-slate-600">API Model 字串</strong>：傳給 Gemini API 的實際 model 名稱（如 <code>gemini-3-pro-preview</code>）</p>
        <p><strong className="text-slate-600">排序</strong>：數字小者排前，決定下拉選單順序</p>
        <p><strong className="text-slate-600">圖片輸出</strong>：勾選後，使用此模型時會啟用 <code>responseModalities: IMAGE</code>，適用於 <code>gemini-*-image-preview</code> 等圖片生成模型（非串流，按圖片張數計費）</p>
      </div>
    </div>
  )
}
