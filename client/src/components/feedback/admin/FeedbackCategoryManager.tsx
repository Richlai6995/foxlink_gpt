import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../../lib/api'
import { Plus, Pencil, Trash2, Save, X, GripVertical, Loader2 } from 'lucide-react'

interface Category {
  id: number
  name: string
  description: string
  icon: string
  sort_order: number
  is_active: number
}

export default function FeedbackCategoryManager() {
  const { t } = useTranslation()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', description: '', icon: '', sort_order: 0 })
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const { data } = await api.get('/feedback/admin/categories')
      setCategories(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      await api.post('/feedback/admin/categories', form)
      setShowAdd(false)
      setForm({ name: '', description: '', icon: '', sort_order: 0 })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
    setSaving(false)
  }

  const handleUpdate = async (id: number) => {
    setSaving(true)
    try {
      await api.put(`/feedback/admin/categories/${id}`, form)
      setEditingId(null)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確認刪除此分類？')) return
    try {
      await api.delete(`/feedback/admin/categories/${id}`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const handleToggle = async (cat: Category) => {
    try {
      await api.put(`/feedback/admin/categories/${cat.id}`, { is_active: cat.is_active ? false : true })
      await load()
    } catch {}
  }

  const startEdit = (cat: Category) => {
    setEditingId(cat.id)
    setForm({ name: cat.name, description: cat.description || '', icon: cat.icon || '', sort_order: cat.sort_order || 0 })
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{t('feedback.admin.categoryManagement')}</h3>
        <button onClick={() => { setShowAdd(true); setForm({ name: '', description: '', icon: '', sort_order: categories.length }) }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700">
          <Plus size={12} /> {t('common.add')}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="名稱 *"
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
            <input value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="Icon (lucide)"
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
          </div>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="描述"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 text-gray-600">
              {t('common.cancel')}
            </button>
            <button onClick={handleAdd} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-blue-600 text-white">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {t('common.save')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-1">
        {categories.map(cat => (
          <div key={cat.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition ${
            cat.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-50'
          }`}>
            <GripVertical size={14} className="text-gray-300 shrink-0" />

            {editingId === cat.id ? (
              <div className="flex-1 flex items-center gap-2">
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="flex-1 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900" />
                <input value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="icon"
                  className="w-24 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900" />
                <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })}
                  className="w-16 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900" />
                <button onClick={() => handleUpdate(cat.id)} disabled={saving}
                  className="p-1 text-green-400 hover:text-green-300"><Save size={14} /></button>
                <button onClick={() => setEditingId(null)}
                  className="p-1 text-gray-400 hover:text-gray-900"><X size={14} /></button>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{cat.name}</span>
                    {cat.icon && <span className="text-xs text-gray-400">({cat.icon})</span>}
                    <span className="text-[10px] text-gray-300">#{cat.sort_order}</span>
                  </div>
                  {cat.description && <p className="text-xs text-gray-400 truncate">{cat.description}</p>}
                </div>
                <button onClick={() => handleToggle(cat)} className={`text-xs px-2 py-0.5 rounded ${
                  cat.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'
                }`}>
                  {cat.is_active ? t('common.enabled') : t('common.disabled')}
                </button>
                <button onClick={() => startEdit(cat)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(cat.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
