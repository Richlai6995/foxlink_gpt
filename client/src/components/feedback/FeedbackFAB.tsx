import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { MessageSquarePlus, X, Send, Loader2, Paperclip, Plus, ExternalLink, Clock } from 'lucide-react'
import { useFeedbackNotifications } from '../../hooks/useFeedbackNotifications'

interface Category {
  id: number
  name: string
}

interface Notification {
  id: number
  ticket_id: number
  ticket_no: string
  subject: string
  type: string
  title: string
  message: string
  is_read: number
  created_at: string
}

function timeAgo(dateStr: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('feedback.fab.justNow')
  if (mins < 60) return t('feedback.fab.minsAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('feedback.fab.hrsAgo', { n: hrs })
  const days = Math.floor(hrs / 24)
  return t('feedback.fab.daysAgo', { n: days })
}

export default function FeedbackFAB() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { unreadCount, fetchCount } = useFeedbackNotifications()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'form'>('list') // default to list view

  // Notifications list
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loadingNotif, setLoadingNotif] = useState(false)

  // 可拖動 FAB
  const [fabPos, setFabPos] = useState({ x: 24, y: 100 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 })

  const handlePointerDown = (e: React.PointerEvent) => {
    if (open) return
    dragging.current = false
    dragStart.current = { x: e.clientX, y: e.clientY, startX: fabPos.x, startY: fabPos.y }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - dragStart.current.x
      const dy = ev.clientY - dragStart.current.y
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragging.current = true
      if (!dragging.current) return
      setFabPos({
        x: Math.max(8, Math.min(window.innerWidth - 52, dragStart.current.startX - dx)),
        y: Math.max(8, Math.min(window.innerHeight - 52, dragStart.current.startY - dy)),
      })
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const handleFabClick = () => {
    if (dragging.current) return
    if (open) {
      setOpen(false)
    } else {
      setOpen(true)
      setView('list')
      loadNotifications()
    }
  }

  const loadNotifications = async () => {
    setLoadingNotif(true)
    try {
      const { data } = await api.get('/feedback/notifications', { params: { unread_only: 'false', limit: 20 } })
      setNotifications(data.notifications || [])
    } catch {
      setNotifications([])
    } finally {
      setLoadingNotif(false)
    }
  }

  const handleNotifClick = async (n: Notification) => {
    // Mark as read
    if (!n.is_read) {
      try { await api.put('/feedback/notifications/read', { ids: [n.id] }) } catch {}
      fetchCount()
    }
    setOpen(false)
    navigate(`/feedback/${n.ticket_id}`)
  }

  // ── Form state ──
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [shareLink, setShareLink] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && view === 'form' && categories.length === 0) {
      api.get(`/feedback/categories?lang=${i18n.language}`).then(r => setCategories(r.data)).catch(() => {})
    }
  }, [open, view, categories.length, i18n.language])

  const renamePastedFile = (file: File, idx: number): File => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    const suffix = idx > 0 ? `_${idx}` : ''
    const m = (file.name || '').match(/\.[^.]+$/)
    const ext = m ? m[0] : (file.type.startsWith('image/') ? `.${file.type.split('/')[1].replace('jpeg', 'jpg')}` : '.bin')
    const baseRaw = (file.name || '').replace(/\.[^.]+$/, '').trim()
    const base = !baseRaw || /^image$/i.test(baseRaw) ? 'paste' : baseRaw
    return new File([file], `${base}_${stamp}${suffix}${ext}`, { type: file.type })
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const pasted: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const f = items[i].getAsFile()
        if (f) pasted.push(f)
      }
    }
    if (pasted.length === 0) return
    e.preventDefault()
    setFiles(prev => [...prev, ...pasted.map((f, i) => renamePastedFile(f, i))])
  }

  const buildFormData = (isDraft: boolean) => {
    const formData = new FormData()
    formData.append('subject', subject.trim())
    if (description) formData.append('description', description)
    if (categoryId) formData.append('category_id', categoryId)
    if (shareLink) formData.append('share_link', shareLink)
    formData.append('priority', 'medium')
    formData.append('source', 'fab')
    if (isDraft) formData.append('is_draft', 'true')
    files.forEach(f => formData.append('files', f))
    return formData
  }

  const resetForm = () => {
    setOpen(false); setSubject(''); setDescription(''); setFiles([]); setCategoryId(''); setShareLink(''); setError('')
  }

  const handleSaveDraft = async () => {
    if (!subject.trim()) { setError(t('feedback.subjectRequired')); return }
    setSubmitting(true); setError('')
    try {
      const { data } = await api.post('/feedback/tickets', buildFormData(true), { headers: { 'Content-Type': 'multipart/form-data' } })
      resetForm(); navigate(`/feedback/${data.id}`)
    } catch (e: any) { setError(e.response?.data?.error || 'Error') }
    finally { setSubmitting(false) }
  }

  const handleSubmit = async () => {
    if (!subject.trim()) { setError(t('feedback.subjectRequired')); return }
    setSubmitting(true); setError('')
    try {
      const { data } = await api.post('/feedback/tickets', buildFormData(false), { headers: { 'Content-Type': 'multipart/form-data' } })
      resetForm(); navigate(`/feedback/${data.id}`)
    } catch (e: any) { setError(e.response?.data?.error || 'Error') }
    finally { setSubmitting(false) }
  }

  const unreadNotifs = notifications.filter(n => !n.is_read)

  return (
    <>
      {/* FAB Button — 縮小低調版 */}
      <div className="fixed z-50 group" style={{ right: fabPos.x, bottom: fabPos.y }}>
        <button
          onPointerDown={handlePointerDown}
          onClick={handleFabClick}
          className="w-10 h-10 rounded-full bg-slate-500/60 hover:bg-slate-600/80 text-white shadow-md flex items-center justify-center transition cursor-grab active:cursor-grabbing touch-none select-none backdrop-blur-sm"
        >
          {open ? <X size={18} /> : <MessageSquarePlus size={18} />}
          {!open && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        {!open && unreadCount > 0 && (
          <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none">
            {unreadCount} {t('feedback.unread')}{t('feedback.notifications')}
          </div>
        )}
      </div>

      {/* Panel */}
      {open && (
        <div className="fixed z-50 w-80 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" style={{ right: fabPos.x, bottom: fabPos.y + 48 }}>
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/80 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">{t('feedback.title')}</h3>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition">
              <X size={15} />
            </button>
          </div>

          {view === 'list' ? (
            <>
              {/* Notifications / Pending list */}
              <div className="max-h-[50vh] overflow-y-auto">
                {loadingNotif ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={18} className="animate-spin text-gray-400" />
                  </div>
                ) : unreadNotifs.length > 0 ? (
                  <div>
                    <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-red-500">{t('feedback.fab.pendingReply')}</span>
                      <span className="bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1">{unreadNotifs.length}</span>
                    </div>
                    {unreadNotifs.map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleNotifClick(n)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 transition border-b border-gray-50 last:border-b-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                          <span className="text-xs font-medium text-gray-800 truncate flex-1">
                            #{n.ticket_no} {n.subject}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 pl-3.5">
                          <Clock size={10} className="text-gray-400" />
                          <span className="text-[10px] text-gray-400">{timeAgo(n.created_at, t)}</span>
                          <span className="text-[10px] text-gray-400 mx-0.5">·</span>
                          <span className="text-[10px] text-gray-500 truncate">{n.title}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-gray-400">{t('feedback.fab.noNotifications')}</div>
                )}
              </div>

              {/* Bottom actions */}
              <div className="px-3 py-2.5 border-t border-gray-100 space-y-1.5">
                <button
                  onClick={() => setView('form')}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 transition"
                >
                  <Plus size={14} />
                  {t('feedback.newTicket')}
                </button>
                <button
                  onClick={() => { setOpen(false); navigate('/feedback') }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-50 transition"
                >
                  <ExternalLink size={12} />
                  {t('feedback.myTickets')} →
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Form view */}
              <div className="p-3 space-y-2.5 max-h-[55vh] overflow-y-auto">
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={t('feedback.subject') + ' *'}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <select
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                >
                  <option value="">{t('feedback.category')}</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={t('feedback.description')}
                  rows={3}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
                />
                <input
                  type="url"
                  value={shareLink}
                  onChange={e => setShareLink(e.target.value)}
                  placeholder={t('feedback.shareLink') + ' (https://...)'}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <div className="flex items-center gap-2">
                  <button onClick={() => fileRef.current?.click()} className="text-gray-400 hover:text-gray-900">
                    <Paperclip size={14} />
                  </button>
                  <input ref={fileRef} type="file" multiple className="hidden" onChange={e => e.target.files && setFiles(prev => [...prev, ...Array.from(e.target.files!)])} />
                  {files.length > 0 && <span className="text-xs text-gray-500">{files.length} {t('feedback.fab.files')}</span>}
                </div>
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {files.map((f, i) => (
                      <div key={i} className="relative group">
                        {f.type.startsWith('image/') ? (
                          <img src={URL.createObjectURL(f)} alt="" className="w-12 h-12 object-cover rounded-lg border border-gray-200" />
                        ) : (
                          <div className="w-12 h-12 flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-[9px] text-gray-400 px-1 text-center">{f.name.slice(0, 10)}</div>
                        )}
                        <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          className="absolute -top-1 -right-1 bg-red-500 rounded-full w-3.5 h-3.5 flex items-center justify-center text-white text-[9px] opacity-0 group-hover:opacity-100 transition">×</button>
                      </div>
                    ))}
                  </div>
                )}
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <div className="px-3 py-2.5 border-t border-gray-100 flex justify-between items-center">
                <button onClick={() => setView('list')} className="text-xs text-gray-500 hover:text-blue-600">
                  ← {t('common.back')}
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={handleSaveDraft} disabled={submitting}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    {t('common.save')}
                  </button>
                  <button onClick={handleSubmit} disabled={submitting}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                    {t('feedback.submit')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
