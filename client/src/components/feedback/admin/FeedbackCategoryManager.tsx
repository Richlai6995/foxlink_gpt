import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../../lib/api'
import {
  Plus, Pencil, Trash2, Save, X, GripVertical, Loader2, Languages,
  // icon picker
  Monitor, Bot, BookOpen, Key, Lightbulb, HelpCircle, Database, Server,
  FileText, Image, Mail, Phone, Calendar, Clock, AlertTriangle, CheckCircle,
  Settings, Wrench, Bug, Package, Truck, ShoppingCart, CreditCard, DollarSign,
  Users, User, Shield, Lock, Cloud, Zap, Activity, BarChart, TrendingUp,
  Search, Filter, Tag, Bookmark, Star, Heart, Archive, Folder, Link,
  Wifi, Printer, Smartphone, Laptop, HardDrive, Globe, Map, Factory, Briefcase,
} from 'lucide-react'

const ICON_MAP: Record<string, any> = {
  monitor: Monitor, bot: Bot, 'book-open': BookOpen, key: Key, lightbulb: Lightbulb,
  'help-circle': HelpCircle, database: Database, server: Server,
  'file-text': FileText, image: Image, mail: Mail, phone: Phone,
  calendar: Calendar, clock: Clock, 'alert-triangle': AlertTriangle, 'check-circle': CheckCircle,
  settings: Settings, wrench: Wrench, bug: Bug, package: Package,
  truck: Truck, 'shopping-cart': ShoppingCart, 'credit-card': CreditCard, 'dollar-sign': DollarSign,
  users: Users, user: User, shield: Shield, lock: Lock,
  cloud: Cloud, zap: Zap, activity: Activity, 'bar-chart': BarChart, 'trending-up': TrendingUp,
  search: Search, filter: Filter, tag: Tag, bookmark: Bookmark,
  star: Star, heart: Heart, archive: Archive, folder: Folder, link: Link,
  wifi: Wifi, printer: Printer, smartphone: Smartphone, laptop: Laptop,
  'hard-drive': HardDrive, globe: Globe, map: Map, factory: Factory, briefcase: Briefcase,
}

const COMMON_ICONS = Object.keys(ICON_MAP)

interface Category {
  id: number
  name: string
  description: string
  icon: string
  sort_order: number
  is_active: number
  is_erp: number
}

interface TransMap {
  [catId: number]: { [lang: string]: { name: string; description?: string } }
}

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const Ico = value && ICON_MAP[value] ? ICON_MAP[value] : null
  const filtered = search ? COMMON_ICONS.filter(n => n.includes(search.toLowerCase())) : COMMON_ICONS

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 flex items-center gap-2 hover:border-blue-400">
        {Ico ? <Ico size={16} className="text-gray-700" /> : <span className="text-gray-400">🎨</span>}
        <span className="flex-1 text-left text-gray-700">{value || 'Icon (lucide)'}</span>
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋或直接輸入..."
            className="w-full mb-2 bg-white border border-gray-200 rounded px-2 py-1.5 text-sm" />
          <div className="grid grid-cols-8 gap-1 max-h-56 overflow-y-auto">
            <button type="button" onClick={() => { onChange(''); setOpen(false) }}
              className={`aspect-square flex items-center justify-center rounded hover:bg-gray-100 ${!value ? 'bg-blue-50 ring-1 ring-blue-300' : ''}`} title="無 icon">
              <X size={14} className="text-gray-400" />
            </button>
            {filtered.map(name => {
              const I = ICON_MAP[name]
              return (
                <button key={name} type="button" onClick={() => { onChange(name); setOpen(false) }}
                  title={name}
                  className={`aspect-square flex items-center justify-center rounded hover:bg-blue-50 ${value === name ? 'bg-blue-100 ring-1 ring-blue-400' : ''}`}>
                  <I size={16} className="text-gray-700" />
                </button>
              )
            })}
          </div>
          {search && !filtered.includes(search.toLowerCase()) && (
            <button type="button" onClick={() => { onChange(search); setOpen(false) }}
              className="w-full mt-2 text-xs text-blue-600 hover:underline">
              使用自訂名稱: "{search}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function FeedbackCategoryManager() {
  const { t } = useTranslation()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', description: '', icon: '', sort_order: 0, is_erp: false })
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [translations, setTranslations] = useState<TransMap>({})
  const [translatingId, setTranslatingId] = useState<number | 'all' | null>(null)

  // Drag state
  const dragId = useRef<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)

  const load = async () => {
    try {
      const [catRes, transRes] = await Promise.all([
        api.get('/feedback/admin/categories'),
        api.get('/feedback/admin/categories/translations')
      ])
      setCategories(catRes.data)
      setTranslations(transRes.data)
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
      setForm({ name: '', description: '', icon: '', sort_order: 0, is_erp: false })
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
    setForm({
      name: cat.name,
      description: cat.description || '',
      icon: cat.icon || '',
      sort_order: cat.sort_order || 0,
      is_erp: !!cat.is_erp,
    })
  }

  const handleTranslate = async (id: number | 'all') => {
    setTranslatingId(id)
    try {
      await api.post(`/feedback/admin/categories/${id}/translate`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || '翻譯失敗')
    }
    setTranslatingId(null)
  }

  const hasTranslation = (catId: number) => {
    const t = translations[catId]
    return t && t.en?.name && t.vi?.name
  }

  const handleDragStart = (id: number) => { dragId.current = id }
  const handleDragOver = (e: React.DragEvent, overId: number) => {
    e.preventDefault()
    if (dragOverId !== overId) setDragOverId(overId)
  }
  const handleDragEnd = () => { dragId.current = null; setDragOverId(null) }
  const handleDrop = async (targetId: number) => {
    const srcId = dragId.current
    dragId.current = null
    setDragOverId(null)
    if (!srcId || srcId === targetId) return
    const srcIdx = categories.findIndex(c => c.id === srcId)
    const tgtIdx = categories.findIndex(c => c.id === targetId)
    if (srcIdx === -1 || tgtIdx === -1) return
    const next = [...categories]
    const [moved] = next.splice(srcIdx, 1)
    next.splice(tgtIdx, 0, moved)
    setCategories(next) // optimistic
    try {
      await api.put('/feedback/admin/categories/reorder', { ids: next.map(c => c.id) })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || '排序失敗')
      await load()
    }
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{t('feedback.admin.categoryManagement')}</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => handleTranslate('all')} disabled={translatingId !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200 disabled:opacity-50">
            {translatingId === 'all' ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
            {t('common.translateAll', '全部翻譯')}
          </button>
          <button onClick={() => { setShowAdd(true); setForm({ name: '', description: '', icon: '', sort_order: (categories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 1), is_erp: false }) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700">
            <Plus size={12} /> {t('common.add')}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="名稱 *"
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
            <IconPicker value={form.icon} onChange={v => setForm({ ...form, icon: v })} />
          </div>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="描述"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900" />
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.is_erp} onChange={e => setForm({ ...form, is_erp: e.target.checked })} />
            <span>ERP 分類（工單通知專送 ERP 管理員群組 + ERP 獨立 KB）</span>
          </label>
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
        {categories.map(cat => {
          const Ico = cat.icon && ICON_MAP[cat.icon] ? ICON_MAP[cat.icon] : null
          const isDragOver = dragOverId === cat.id
          return (
            <div key={cat.id}
              draggable={editingId !== cat.id}
              onDragStart={() => handleDragStart(cat.id)}
              onDragOver={e => handleDragOver(e, cat.id)}
              onDragLeave={() => setDragOverId(null)}
              onDrop={() => handleDrop(cat.id)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition ${
                cat.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-50'
              } ${isDragOver ? 'ring-2 ring-blue-400 border-blue-300' : ''}`}>
              <GripVertical size={14} className="text-gray-300 shrink-0 cursor-grab active:cursor-grabbing" />

              {editingId === cat.id ? (
                <div className="flex-1 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                      className="flex-1 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900" />
                    <div className="w-48">
                      <IconPicker value={form.icon} onChange={v => setForm({ ...form, icon: v })} />
                    </div>
                    <button onClick={() => handleUpdate(cat.id)} disabled={saving}
                      className="p-1 text-green-600 hover:text-green-700"><Save size={14} /></button>
                    <button onClick={() => setEditingId(null)}
                      className="p-1 text-gray-400 hover:text-gray-900"><X size={14} /></button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={form.is_erp} onChange={e => setForm({ ...form, is_erp: e.target.checked })} />
                    <span>ERP 分類</span>
                  </label>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {Ico && <Ico size={14} className="text-gray-500 shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{cat.name}</span>
                        {cat.icon && <span className="text-xs text-gray-400">({cat.icon})</span>}
                        <span className="text-[10px] text-gray-300">#{cat.sort_order}</span>
                        {cat.is_erp ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-200 font-semibold">ERP</span>
                        ) : null}
                        {translations[cat.id]?.en?.name
                          ? <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-500">EN</span>
                          : <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-300">EN</span>}
                        {translations[cat.id]?.vi?.name
                          ? <span className="text-[9px] px-1 py-0.5 rounded bg-green-50 text-green-500">VI</span>
                          : <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-300">VI</span>}
                      </div>
                      {cat.description && <p className="text-xs text-gray-400 truncate">{cat.description}</p>}
                    </div>
                  </div>
                  <button onClick={() => handleToggle(cat)} className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                    cat.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {cat.is_active ? t('common.enabled') : t('common.disabled')}
                  </button>
                  <button onClick={() => handleTranslate(cat.id)} disabled={translatingId !== null}
                    title={hasTranslation(cat.id) ? '重新翻譯' : '翻譯'}
                    className={`p-1 transition ${hasTranslation(cat.id) ? 'text-purple-400 hover:text-purple-600' : 'text-gray-300 hover:text-purple-500'}`}>
                    {translatingId === cat.id ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                  </button>
                  <button onClick={() => startEdit(cat)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(cat.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
