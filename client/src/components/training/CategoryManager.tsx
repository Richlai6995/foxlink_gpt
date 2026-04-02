import { useState, useEffect } from 'react'
import { Plus, Trash2, Pencil, Check, X, FolderTree, ChevronRight } from 'lucide-react'
import api from '../../lib/api'

interface Category {
  id: number
  parent_id: number | null
  name: string
  sort_order: number
}

interface Props {
  onClose: () => void
  onChanged?: () => void
}

export default function CategoryManager({ onClose, onChanged }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [newName, setNewName] = useState('')
  const [newParentId, setNewParentId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const res = await api.get('/training/categories')
      setCategories(res.data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const addCategory = async () => {
    if (!newName.trim()) return
    try {
      await api.post('/training/categories', { name: newName.trim(), parent_id: newParentId })
      setNewName('')
      setNewParentId(null)
      load()
      onChanged?.()
    } catch (e: any) {
      alert(e.response?.data?.error || '新增失敗')
    }
  }

  const saveEdit = async (id: number) => {
    if (!editName.trim()) return
    const cat = categories.find(c => c.id === id)
    try {
      await api.put(`/training/categories/${id}`, {
        name: editName.trim(),
        parent_id: cat?.parent_id,
        sort_order: cat?.sort_order || 0
      })
      setEditingId(null)
      load()
      onChanged?.()
    } catch (e) { console.error(e) }
  }

  const deleteCategory = async (id: number) => {
    if (!confirm('確定要刪除此分類？子分類會移到上層。')) return
    try {
      await api.delete(`/training/categories/${id}`)
      load()
      onChanged?.()
    } catch (e) { console.error(e) }
  }

  const roots = categories.filter(c => !c.parent_id)
  const children = (pid: number) => categories.filter(c => c.parent_id === pid)

  const renderCategory = (cat: Category, depth: number) => (
    <div key={cat.id}>
      <div className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-800 group`}
        style={{ paddingLeft: `${8 + depth * 20}px` }}>
        {depth > 0 && <ChevronRight size={10} className="text-slate-600" />}

        {editingId === cat.id ? (
          <>
            <input value={editName} onChange={e => setEditName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveEdit(cat.id)}
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-sky-500"
              autoFocus />
            <button onClick={() => saveEdit(cat.id)} className="text-green-400 hover:text-green-300"><Check size={12} /></button>
            <button onClick={() => setEditingId(null)} className="text-slate-500 hover:text-slate-300"><X size={12} /></button>
          </>
        ) : (
          <>
            <span className="flex-1 text-xs text-slate-300">{cat.name}</span>
            <button onClick={() => { setEditingId(cat.id); setEditName(cat.name) }}
              className="text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition">
              <Pencil size={11} />
            </button>
            <button onClick={() => deleteCategory(cat.id)}
              className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>
      {children(cat.id).map(child => renderCategory(child, depth + 1))}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-[420px] max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FolderTree size={14} className="text-sky-400" /> 課程分類管理
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-slate-500 text-xs text-center py-6">載入中...</div>
          ) : categories.length === 0 ? (
            <div className="text-slate-500 text-xs text-center py-6">尚未建立任何分類</div>
          ) : (
            roots.map(cat => renderCategory(cat, 0))
          )}
        </div>

        {/* Add new */}
        <div className="border-t border-slate-700 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCategory()}
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-sky-500"
              placeholder="新分類名稱"
            />
            <select
              value={newParentId || ''}
              onChange={e => setNewParentId(e.target.value ? Number(e.target.value) : null)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-[10px] w-28"
            >
              <option value="">頂層分類</option>
              {categories.filter(c => {
                // 最多 3 層：只允許選沒有 grandparent 的作為 parent
                if (!c.parent_id) return true
                const parent = categories.find(p => p.id === c.parent_id)
                return parent && !parent.parent_id
              }).map(c => (
                <option key={c.id} value={c.id}>{c.parent_id ? '　' : ''}{c.name}</option>
              ))}
            </select>
            <button onClick={addCategory} disabled={!newName.trim()}
              className="bg-sky-600 hover:bg-sky-500 text-white px-2.5 py-1.5 rounded text-xs disabled:opacity-40 transition">
              <Plus size={13} />
            </button>
          </div>
          <p className="text-[9px] text-slate-600">分類最多 3 層（大分類 → 中分類 → 小分類）</p>
        </div>
      </div>
    </div>
  )
}
