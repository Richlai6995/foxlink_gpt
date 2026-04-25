/**
 * SpecialManualsPanel — Admin 「特殊說明書管理」面板
 *
 * 功能:
 *   - 列出所有 help_books(cortex 主書 + special books)
 *   - 新增 special book(code/name/icon)
 *   - 改 metadata(name / description / icon / sortOrder / isActive)
 *   - 開分享 modal(復用 HelpBookShareModal)
 *   - 全域「新建 special book 預設套用」分享範本管理(復用 ShareGranteePicker)
 *
 * 對應 routes:/api/help/admin/books/* + /api/help/admin/default-share/*
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Share2, Edit2, Trash2, Settings, X } from 'lucide-react'
import api from '../../lib/api'
import ShareGranteePicker from '../common/ShareGranteePicker'
import HelpBookShareModal from './HelpBookShareModal'
import type { GranteeSelection } from '../../types'

interface HelpBook {
  id: number
  code: string
  name: string
  description?: string | null
  icon?: string | null
  isSpecial: boolean
  isActive: boolean
  sortOrder: number
  createdAt?: string | null
  lastModified?: string | null
  sectionCount: number
  shareCount: number
}

interface DefaultShareEntry {
  id: number
  grantee_type: string
  grantee_id: string
  created_at?: string
}

export default function SpecialManualsPanel() {
  const { t } = useTranslation()
  const [books, setBooks] = useState<HelpBook[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<HelpBook | null>(null)
  const [shareTarget, setShareTarget] = useState<HelpBook | null>(null)
  const [showDefaults, setShowDefaults] = useState(false)

  const fetchBooks = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/help/admin/books')
      setBooks(Array.isArray(data) ? data : [])
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchBooks() }, [])

  const handleSoftDelete = async (b: HelpBook) => {
    if (b.code === 'cortex') return alert('cortex 主說明書不可停用')
    if (!window.confirm(t('help.specialManuals.deleteConfirm', `確定停用「${b.name}」?(可從 isActive=0 復原)`))) return
    try {
      await api.delete(`/help/admin/books/${b.id}`)
      await fetchBooks()
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    }
  }

  const handleReactivate = async (b: HelpBook) => {
    try {
      await api.patch(`/help/admin/books/${b.id}`, { isActive: 1 })
      await fetchBooks()
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            {t('help.specialManuals.title', '特殊說明書管理')}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {t('help.specialManuals.desc', '管理多本說明書 — Cortex 主說明書全員可讀,特殊說明書(如貴金屬平台)走分享授權')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowDefaults(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <Settings size={14} />
            {t('help.specialManuals.defaultShare', '預設分享範本')}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus size={14} />
            {t('help.specialManuals.newBook', '新增說明書')}
          </button>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">{t('help.specialManuals.code', '代碼')}</th>
              <th className="px-3 py-2 text-left">{t('help.specialManuals.name', '名稱')}</th>
              <th className="px-3 py-2 text-left">{t('help.specialManuals.type', '類型')}</th>
              <th className="px-3 py-2 text-right">{t('help.specialManuals.sections', '章節數')}</th>
              <th className="px-3 py-2 text-right">{t('help.specialManuals.shares', '分享數')}</th>
              <th className="px-3 py-2 text-right">{t('help.specialManuals.lastModified', '更新日期')}</th>
              <th className="px-3 py-2 text-right">{t('common.actions', '操作')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="text-center py-6 text-slate-400">{t('common.loading', '載入中...')}</td></tr>}
            {!loading && books.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-slate-400">{t('common.empty', '無資料')}</td></tr>
            )}
            {books.map(b => (
              <tr key={b.id} className={b.isActive ? '' : 'opacity-50'}>
                <td className="px-3 py-2 font-mono text-xs">{b.code}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{b.name}</div>
                  {b.description && <div className="text-xs text-slate-400 truncate max-w-xs">{b.description}</div>}
                </td>
                <td className="px-3 py-2">
                  {b.isSpecial ? (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                      {t('help.specialManuals.typeSpecial', '特殊(走分享)')}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                      {t('help.specialManuals.typeMain', '主說明書(全員)')}
                    </span>
                  )}
                  {!b.isActive && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-slate-200 text-slate-600">
                      {t('help.specialManuals.inactive', '已停用')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{b.sectionCount}</td>
                <td className="px-3 py-2 text-right">{b.isSpecial ? b.shareCount : '—'}</td>
                <td className="px-3 py-2 text-right text-xs text-slate-500">{b.lastModified || '—'}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    {b.isSpecial && (
                      <button
                        onClick={() => setShareTarget(b)}
                        title={t('help.specialManuals.shareBtn', '分享設定') as string}
                        className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Share2 size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => setEditTarget(b)}
                      title={t('common.edit', '編輯') as string}
                      className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
                    >
                      <Edit2 size={14} />
                    </button>
                    {b.code !== 'cortex' && (
                      b.isActive ? (
                        <button
                          onClick={() => handleSoftDelete(b)}
                          title={t('help.specialManuals.softDelete', '停用') as string}
                          className="p-1 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(b)}
                          title={t('help.specialManuals.reactivate', '啟用') as string}
                          className="px-2 py-0.5 text-xs rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
                        >
                          {t('help.specialManuals.reactivate', '啟用')}
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateBookModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchBooks() }}
        />
      )}

      {editTarget && (
        <EditBookModal
          book={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); fetchBooks() }}
        />
      )}

      {shareTarget && (
        <HelpBookShareModal
          book={{ id: shareTarget.id, code: shareTarget.code, name: shareTarget.name }}
          onClose={() => { setShareTarget(null); fetchBooks() }}
        />
      )}

      {showDefaults && (
        <DefaultShareModal onClose={() => setShowDefaults(false)} />
      )}
    </div>
  )
}

// ── Create new special book modal ───────────────────────────────────────────

function CreateBookModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('book_open_text')
  const [sortOrder, setSortOrder] = useState(100)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      alert(t('help.specialManuals.codeAndNameRequired', 'code 與 name 必填'))
      return
    }
    setSaving(true)
    try {
      await api.post('/help/admin/books', {
        code: code.trim(), name: name.trim(),
        description: description.trim() || null, icon, sortOrder, isSpecial: 1,
      })
      onCreated()
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[480px] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">{t('help.specialManuals.newBook', '新增說明書')}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label={t('help.specialManuals.code', '代碼') + ' *'}>
            <input
              value={code} onChange={e => setCode(e.target.value)}
              placeholder="precious-metals (a-z, 0-9, -)"
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">
              {t('help.specialManuals.codeHint', '建立後不可改,僅 a-z 0-9 連字號,長度 2-60')}
            </p>
          </Field>
          <Field label={t('help.specialManuals.name', '名稱') + ' *'}>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="貴金屬分析平台 使用說明書"
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label={t('help.specialManuals.descLabel', '說明')}>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('help.specialManuals.icon', 'Icon (lucide name)')}>
              <input
                value={icon} onChange={e => setIcon(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label={t('help.specialManuals.sortOrder', '排序')}>
              <input
                type="number"
                value={sortOrder} onChange={e => setSortOrder(Number(e.target.value || 0))}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm"
              />
            </Field>
          </div>
          <p className="text-xs text-slate-400 border-t pt-3">
            {t('help.specialManuals.createHint', '新建的特殊說明書會自動套用「預設分享範本」中的所有授權對象。')}
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600">{t('common.cancel', '取消')}</button>
          <button
            onClick={submit} disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '...' : t('common.create', '建立')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit existing book modal ────────────────────────────────────────────────

function EditBookModal({ book, onClose, onSaved }: { book: HelpBook; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(book.name)
  const [description, setDescription] = useState(book.description || '')
  const [icon, setIcon] = useState(book.icon || 'book_open_text')
  const [sortOrder, setSortOrder] = useState(book.sortOrder)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await api.patch(`/help/admin/books/${book.id}`, {
        name: name.trim(), description: description.trim() || null, icon, sortOrder,
      })
      onSaved()
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[480px] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">
            {t('common.edit', '編輯')} — <span className="font-mono text-xs">{book.code}</span>
          </span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label={t('help.specialManuals.name', '名稱')}>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm" />
          </Field>
          <Field label={t('help.specialManuals.descLabel', '說明')}>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('help.specialManuals.icon', 'Icon')}>
              <input value={icon} onChange={e => setIcon(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm" />
            </Field>
            <Field label={t('help.specialManuals.sortOrder', '排序')}>
              <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value || 0))}
                className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm" />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600">{t('common.cancel', '取消')}</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? '...' : t('common.save', '儲存')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Default share template modal(全域,新建 special book 時自動複製到該 book)──

function DefaultShareModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [list, setList] = useState<DefaultShareEntry[]>([])
  const [selected, setSelected] = useState<GranteeSelection | null>(null)
  const [shareType, setShareType] = useState<'view'>('view')
  const [adding, setAdding] = useState(false)

  const fetchList = async () => {
    try {
      const { data } = await api.get('/help/admin/default-share')
      setList(Array.isArray(data) ? data : [])
    } catch { /* ignore */ }
  }
  useEffect(() => { fetchList() }, [])

  const add = async () => {
    if (!selected) return
    setAdding(true)
    try {
      await api.post('/help/admin/default-share', {
        grantee_type: selected.type, grantee_id: selected.id,
      })
      setSelected(null)
      await fetchList()
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setAdding(false) }
  }

  const remove = async (id: number) => {
    if (!window.confirm(t('help.specialManuals.removeDefaultConfirm', '從預設範本移除?'))) return
    await api.delete(`/help/admin/default-share/${id}`)
    setList(list.filter(s => s.id !== id))
  }

  const iconFor = (type: string) => ({
    user: '👤', role: '👥', factory: '🏭',
    department: '🏢', cost_center: '💰', division: '🏭', org_group: '🌐',
  }[type] || '👥')

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[560px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">
            {t('help.specialManuals.defaultShareTitle', '預設分享範本(全域)')}
          </span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-5">
          <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded p-2">
            {t('help.specialManuals.defaultShareHelp',
              '在這裡設定的對象,將在新建特殊說明書時被自動複製為該書的分享授權。建立後即獨立 — 之後改範本不影響已建的書。')}
          </p>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">
              {t('help.share.addTarget', '新增分享對象')}
            </div>
            <ShareGranteePicker
              value={selected}
              onChange={setSelected}
              shareType={shareType}
              onShareTypeChange={(v) => setShareType(v as 'view')}
              shareTypeOptions={[{ value: 'view', label: t('help.share.permView', '可閱讀') }]}
              onAdd={add}
              adding={adding}
              orgsUrl="/kb/orgs"
            />
          </div>

          {list.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">
                {t('help.specialManuals.defaultEntries', '範本內容')}({list.length})
              </div>
              <div className="space-y-1">
                {list.map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-xs bg-slate-50 border rounded px-3 py-1.5">
                    <span>{iconFor(s.grantee_type)}</span>
                    <span className="flex-1 truncate font-mono">{s.grantee_id}</span>
                    <span className="text-slate-400 text-[10px]">{t(`grantee.type.${s.grantee_type}`)}</span>
                    <button onClick={() => remove(s.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 text-center py-4 border border-dashed rounded">
              {t('help.specialManuals.defaultEmpty', '範本為空 — 新建特殊說明書時不會自動套任何分享(僅 admin 可讀)')}
            </div>
          )}
        </div>
        <div className="flex justify-end px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600">{t('common.close', '關閉')}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-700 mb-1">{label}</div>
      {children}
    </label>
  )
}
