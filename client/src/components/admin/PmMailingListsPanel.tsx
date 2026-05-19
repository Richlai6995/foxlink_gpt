/**
 * PmMailingListsPanel — PM 報告寄信用的收件清單管理(全採購共用)
 *
 * 採購在 PM 平台 → 週/月報 → 寄信時下拉選用既有 list。
 * 此 panel 提供 list CRUD + 收件人新增/刪除。
 */
import { useEffect, useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Mail, Plus, Trash2, RefreshCw, ChevronDown, ChevronUp, X, Edit3, Power } from 'lucide-react'
import api from '../../lib/api'

interface MailingList {
  id: number
  name: string
  description?: string | null
  is_active: number
  creation_date: string
  created_by?: number | null
  creator_name?: string | null
  recipient_count: number
}

interface Recipient {
  id: number
  email: string
  display_name?: string | null
  creation_date: string
}

export default function PmMailingListsPanel() {
  const { t } = useTranslation()
  const [lists, setLists] = useState<MailingList[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [recipients, setRecipients] = useState<Record<number, Recipient[]>>({})
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<MailingList | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/pm/briefing/mailing-lists')
      setLists(r.data?.lists || [])
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const loadRecipients = async (listId: number) => {
    try {
      const r = await api.get(`/pm/briefing/mailing-lists/${listId}`)
      setRecipients(p => ({ ...p, [listId]: r.data?.recipients || [] }))
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    }
  }

  const toggleExpand = (id: number) => {
    if (expanded === id) {
      setExpanded(null)
    } else {
      setExpanded(id)
      if (!recipients[id]) loadRecipients(id)
    }
  }

  const toggleActive = async (l: MailingList) => {
    try {
      await api.put(`/pm/briefing/mailing-lists/${l.id}`, { is_active: l.is_active ? 0 : 1 })
      await load()
    } catch (e: any) { alert(e?.response?.data?.error || e.message) }
  }

  const removeList = async (l: MailingList) => {
    if (!confirm(`確定刪除「${l.name}」?(${l.recipient_count} 個收件人會一起刪)`)) return
    try {
      await api.delete(`/pm/briefing/mailing-lists/${l.id}`)
      await load()
    } catch (e: any) { alert(e?.response?.data?.error || e.message) }
  }

  const removeRecipient = async (listId: number, recipientId: number) => {
    try {
      await api.delete(`/pm/briefing/mailing-lists/${listId}/recipients/${recipientId}`)
      await loadRecipients(listId)
      await load()  // 重抓 recipient_count
    } catch (e: any) { alert(e?.response?.data?.error || e.message) }
  }

  return (
    <div className="space-y-3">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Mail size={18} className="text-blue-500" />
            PM 報告寄信清單
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            管理採購在 PM 平台「週/月報 → 寄信」時可選的收件清單(全採購共用)。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus size={12} /> 新增清單
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 disabled:opacity-40">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 重新整理
          </button>
        </div>
      </header>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-8"></th>
              <th className="px-3 py-2 text-left font-medium">清單名稱</th>
              <th className="px-3 py-2 text-left font-medium">說明</th>
              <th className="px-3 py-2 text-center font-medium">收件人數</th>
              <th className="px-3 py-2 text-left font-medium">建立者</th>
              <th className="px-3 py-2 text-center font-medium">狀態</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {lists.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                {loading ? '載入中…' : '尚無清單,點右上「+ 新增清單」建立。'}
              </td></tr>
            )}
            {lists.map(l => (
              <Fragment key={l.id}>
                <tr className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => toggleExpand(l.id)} className="text-slate-400 hover:text-slate-700">
                      {expanded === l.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-700">{l.name}</td>
                  <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{l.description || '—'}</td>
                  <td className="px-3 py-2 text-center text-slate-600 font-mono">{l.recipient_count}</td>
                  <td className="px-3 py-2 text-slate-500 text-[11px]">{l.creator_name || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => toggleActive(l)}
                      className={`p-1 rounded ${l.is_active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                      title={l.is_active ? '已啟用 — 點擊停用' : '已停用 — 點擊啟用'}>
                      <Power size={13} />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditTarget(l)} className="p-1 text-slate-400 hover:text-blue-600" title="編輯">
                      <Edit3 size={13} />
                    </button>
                    <button onClick={() => removeList(l)} className="p-1 text-slate-400 hover:text-rose-500" title="刪除">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
                {expanded === l.id && (
                  <tr className="bg-slate-50/50">
                    <td colSpan={7} className="px-4 py-3">
                      <RecipientsManager
                        listId={l.id}
                        recipients={recipients[l.id] || []}
                        onChanged={() => { loadRecipients(l.id); load() }}
                        onRemove={(rid) => removeRecipient(l.id, rid)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <ListEditorModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load() }}
        />
      )}
      {editTarget && (
        <ListEditorModal
          mode="edit"
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load() }}
        />
      )}
    </div>
  )
}

// ── 收件人管理(展開列用) ─────────────────────────────────────────────────
function RecipientsManager({ listId, recipients, onChanged, onRemove }: {
  listId: number
  recipients: Recipient[]
  onChanged: () => void
  onRemove: (rid: number) => void
}) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adding, setAdding] = useState(false)

  const add = async () => {
    if (!email.trim()) return
    setAdding(true)
    try {
      await api.post(`/pm/briefing/mailing-lists/${listId}/recipients`, {
        email: email.trim(),
        display_name: displayName.trim() || null,
      })
      setEmail('')
      setDisplayName('')
      onChanged()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setAdding(false) }
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-500">收件人(共 {recipients.length})</div>
      <div className="flex items-center gap-1.5 text-xs">
        <input className="input flex-1" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="email@example.com" type="email"
          onKeyDown={e => e.key === 'Enter' && add()} />
        <input className="input w-40" value={displayName} onChange={e => setDisplayName(e.target.value)}
          placeholder="顯示名稱(選填)"
          onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={adding || !email.trim()}
          className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
          + 加入
        </button>
      </div>
      {recipients.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic">尚無收件人</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {recipients.map(r => (
            <div key={r.id} className="flex items-center gap-1 bg-white border border-slate-200 rounded px-2 py-1 text-[11px]">
              <span className="text-slate-700">{r.email}</span>
              {r.display_name && <span className="text-slate-400">({r.display_name})</span>}
              <button onClick={() => onRemove(r.id)} className="ml-1 text-slate-300 hover:text-rose-500">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── List 新增/編輯 Modal ─────────────────────────────────────────────────
function ListEditorModal({ mode, initial, onClose, onSaved }: {
  mode: 'create' | 'edit'
  initial?: MailingList
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [bulkEmails, setBulkEmails] = useState('')  // create mode 一次塞多個 email
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) { alert('清單名稱必填'); return }
    setSaving(true)
    try {
      if (mode === 'create') {
        // 解析 bulkEmails(換行或逗號分隔)
        const recipients = bulkEmails
          .split(/[\n,;]+/)
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => {
            // 支援「Display Name <email@x.com>」格式
            const m = s.match(/^(.+?)\s*<(.+?)>$/)
            return m ? { display_name: m[1].trim(), email: m[2].trim() } : { email: s }
          })
        await api.post('/pm/briefing/mailing-lists', {
          name: name.trim(),
          description: description.trim() || null,
          recipients,
        })
      } else if (initial?.id) {
        await api.put(`/pm/briefing/mailing-lists/${initial.id}`, {
          name: name.trim(),
          description: description.trim() || null,
        })
      }
      onSaved()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Mail size={16} className="text-blue-500" />
            {mode === 'create' ? '新增收件清單' : '編輯清單'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3 text-xs">
          <div>
            <label className="block text-slate-600 mb-1">清單名稱 *</label>
            <input className="input w-full" value={name} onChange={e => setName(e.target.value)}
              placeholder="例:採購主管群、事業單位 A、全公司金屬通報" />
          </div>
          <div>
            <label className="block text-slate-600 mb-1">說明</label>
            <input className="input w-full" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="(選填)說明此清單用途" />
          </div>
          {mode === 'create' && (
            <div>
              <label className="block text-slate-600 mb-1">收件人 emails(每行一個,可選後續再加)</label>
              <textarea className="input w-full h-32 font-mono" value={bulkEmails} onChange={e => setBulkEmails(e.target.value)}
                placeholder="cynthia_lin@foxlink.com&#10;Ann Wang <ann_wang@foxlink.com>&#10;sabrina_su@foxlink.com" />
              <p className="text-[10px] text-slate-400 mt-1">
                換行/逗號分隔。支援「顯示名稱 &lt;email&gt;」格式。
              </p>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-4 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button onClick={save} disabled={saving || !name.trim()}
            className="text-xs px-4 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {saving ? '儲存中…' : (mode === 'create' ? '建立' : '更新')}
          </button>
        </div>
      </div>
    </div>
  )
}
