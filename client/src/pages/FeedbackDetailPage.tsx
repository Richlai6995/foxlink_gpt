import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import { useFeedbackSocket } from '../hooks/useFeedbackSocket'
import {
  ArrowLeft, Send, Paperclip, Lock, Clock, User, Star,
  CheckCircle, RotateCcw, UserCheck, Download, X, Loader2,
  AlertTriangle, FileText, Image, Upload, Save, Trash2, Archive
} from 'lucide-react'
import FeedbackStatusBadge from '../components/feedback/FeedbackStatusBadge'
import FeedbackPriorityBadge from '../components/feedback/FeedbackPriorityBadge'
import FeedbackAIAnalysis from '../components/feedback/FeedbackAIAnalysis'
import TicketArchiveModal from '../components/feedback/admin/TicketArchiveModal'
import MicButton from '../components/MicButton'

interface Ticket {
  id: number
  ticket_no: string
  user_id: number
  subject: string
  description: string
  share_link: string
  status: string
  priority: string
  category_id: number
  category_name: string
  applicant_name: string
  applicant_dept: string
  applicant_employee_id: string
  applicant_email: string
  assigned_to: number
  assigned_name: string
  resolution_note: string
  satisfaction_rating: number
  satisfaction_comment: string
  sla_due_first_response: string
  sla_due_resolution: string
  first_response_at: string
  sla_breached: number
  ai_assisted: number
  ai_resolved: number
  source: string
  created_at: string
  updated_at: string
  resolved_at: string
  closed_at: string
}

interface Message {
  id: number
  sender_id: number
  sender_role: string
  sender_name: string
  content: string
  is_internal: number
  is_system: number
  created_at: string
}

interface Attachment {
  id: number
  file_name: string
  file_path: string
  file_size: number
  mime_type: string
  message_id: number
  created_at: string
}

export default function FeedbackDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation()
  const { isAdmin, user } = useAuth()
  const navigate = useNavigate()
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const msgTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [voicePreview, setVoicePreview] = useState('')

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)

  // Chat input
  const [msgContent, setMsgContent] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [msgFiles, setMsgFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)

  // Image lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Archive snapshot modal (admin only)
  const [showArchive, setShowArchive] = useState(false)

  // Draft editing
  const [draftSubject, setDraftSubject] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  const [draftShareLink, setDraftShareLink] = useState('')
  const [draftCategoryId, setDraftCategoryId] = useState('')
  const [draftPriority, setDraftPriority] = useState('medium')
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [draftSaving, setDraftSaving] = useState(false)
  const draftFileRef = useRef<HTMLInputElement>(null)

  // Resolve modal
  const [showResolve, setShowResolve] = useState(false)
  const [resolveNote, setResolveNote] = useState('')

  // Satisfaction modal
  const [showSatisfaction, setShowSatisfaction] = useState(false)
  const [rating, setRating] = useState(0)
  const [satisfactionComment, setSatisfactionComment] = useState('')

  const isOwner = ticket?.user_id === (user as any)?.id

  // WebSocket 即時連線
  const { typingUsers, lastEvent, sendTyping, sendStopTyping } = useFeedbackSocket(id ? Number(id) : undefined)

  const fetchAll = useCallback(async () => {
    if (!id) return
    try {
      const [tRes, mRes, aRes] = await Promise.all([
        api.get(`/feedback/tickets/${id}`),
        api.get(`/feedback/tickets/${id}/messages`),
        api.get(`/feedback/tickets/${id}/attachments`),
      ])
      setTicket(tRes.data)
      setMessages(mRes.data)
      setAttachments(aRes.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchAll() }, [fetchAll])

  // 草稿載入時填入編輯表單
  useEffect(() => {
    if (ticket && ticket.status === 'draft') {
      setDraftSubject(ticket.subject || '')
      setDraftDesc(ticket.description || '')
      setDraftShareLink(ticket.share_link || '')
      setDraftCategoryId(ticket.category_id ? String(ticket.category_id) : '')
      setDraftPriority(ticket.priority || 'medium')
    }
  }, [ticket])

  // 載入分類
  useEffect(() => {
    api.get(`/feedback/categories?lang=${i18n.language}`).then(r => setCategories(r.data)).catch(() => {})
  }, [i18n.language])

  // WebSocket 事件驅動更新（取代 polling）
  useEffect(() => {
    if (!lastEvent) return
    if (['new_message', 'status_changed', 'ticket_assigned'].includes(lastEvent.type)) {
      fetchAll()
    }
  }, [lastEvent, fetchAll])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!msgContent.trim() && msgFiles.length === 0) return
    setSending(true)
    try {
      const formData = new FormData()
      formData.append('content', msgContent.trim() || '(附件)')
      if (isInternal) formData.append('is_internal', 'true')
      msgFiles.forEach(f => formData.append('files', f))
      await api.post(`/feedback/tickets/${id}/messages`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMsgContent('')
      setMsgFiles([])
      setIsInternal(false)
      await fetchAll()
    } catch (e) {
      console.error(e)
    } finally {
      setSending(false)
    }
  }

  // Typing indicator
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleInputChange = (value: string) => {
    setMsgContent(value)
    if (id) {
      sendTyping(Number(id))
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => { if (id) sendStopTyping(Number(id)) }, 2000)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (id) sendStopTyping(Number(id))
      sendMessage()
    }
  }

  const renamePastedFile = (file: File, idx: number): File => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    const suffix = idx > 0 ? `_${idx}` : ''
    const m = (file.name || '').match(/\.[^.]+$/)
    const ext = m ? m[0] : (file.type.startsWith('image/') ? `.${file.type.split('/')[1].replace('jpeg', 'jpg')}` : '.bin')
    // image.png / Image.png / (empty) → paste_<stamp>
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
    setMsgFiles(prev => [...prev, ...pasted.map((f, i) => renamePastedFile(f, i))])
  }

  // 語音輸入：游標位置插入
  const insertVoiceText = useCallback((text: string) => {
    if (!text) return
    const ta = msgTextareaRef.current
    if (!ta) {
      setMsgContent((prev) => (prev ? prev + ' ' + text : text))
      return
    }
    const start = ta.selectionStart ?? msgContent.length
    const end = ta.selectionEnd ?? msgContent.length
    setMsgContent((prev) => prev.slice(0, start) + text + prev.slice(end))
    requestAnimationFrame(() => {
      try {
        ta.focus()
        const pos = start + text.length
        ta.selectionStart = ta.selectionEnd = pos
      } catch {}
    })
    setVoicePreview('')
  }, [msgContent.length])

  // Draft save / submit
  const handleDraftSave = async () => {
    if (!draftSubject.trim()) return
    setDraftSaving(true)
    try {
      await api.put(`/feedback/tickets/${id}`, {
        subject: draftSubject.trim(),
        description: draftDesc,
        share_link: draftShareLink,
        category_id: draftCategoryId ? Number(draftCategoryId) : null,
        priority: draftPriority,
      })
      // 上傳新附件
      if (draftFiles.length > 0) {
        const formData = new FormData()
        draftFiles.forEach(f => formData.append('files', f))
        await api.post(`/feedback/tickets/${id}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
        setDraftFiles([])
      }
      await fetchAll()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    } finally {
      setDraftSaving(false)
    }
  }

  const handleDraftSubmit = async () => {
    if (!draftSubject.trim()) return
    setDraftSaving(true)
    try {
      // 先存最新資料
      await api.put(`/feedback/tickets/${id}`, {
        subject: draftSubject.trim(),
        description: draftDesc,
        share_link: draftShareLink,
        category_id: draftCategoryId ? Number(draftCategoryId) : null,
        priority: draftPriority,
      })
      if (draftFiles.length > 0) {
        const formData = new FormData()
        draftFiles.forEach(f => formData.append('files', f))
        await api.post(`/feedback/tickets/${id}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
        setDraftFiles([])
      }
      // 送出
      await api.put(`/feedback/tickets/${id}/submit`)
      await fetchAll()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    } finally {
      setDraftSaving(false)
    }
  }

  const handleDraftPaste = (e: React.ClipboardEvent) => {
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
    setDraftFiles(prev => [...prev, ...pasted.map((f, i) => renamePastedFile(f, i))])
  }

  const handleAssign = async () => {
    try {
      await api.put(`/feedback/tickets/${id}/assign`)
      fetchAll()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const handleResolve = async () => {
    try {
      await api.put(`/feedback/tickets/${id}/resolve`, { note: resolveNote })
      setShowResolve(false)
      setResolveNote('')
      fetchAll()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const handleReopen = async () => {
    if (!confirm(t('feedback.confirmReopen'))) return
    try {
      await api.put(`/feedback/tickets/${id}/reopen`)
      fetchAll()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const handleSatisfaction = async () => {
    if (rating < 1) return
    try {
      await api.put(`/feedback/tickets/${id}/satisfaction`, { rating, comment: satisfactionComment })
      setShowSatisfaction(false)
      fetchAll()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const handleStatusChange = async (newStatus: string) => {
    try {
      await api.put(`/feedback/tickets/${id}/status`, { status: newStatus })
      fetchAll()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const formatDate = (d: string) => {
    if (!d) return '-'
    return new Date(d).toLocaleString('zh-TW')
  }

  const formatRelative = (d: string) => {
    if (!d) return '-'
    const diff = new Date(d).getTime() - Date.now()
    const hrs = Math.round(diff / 3600000)
    if (hrs < 0) return t('feedback.breached')
    if (hrs < 1) return `< 1h`
    return `${hrs}h`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-gray-400">
        {t('feedback.noTickets')}
      </div>
    )
  }

  const isDraft = ticket.status === 'draft'
  const canChat = !['closed', 'draft'].includes(ticket.status)
  const canResolve = ['processing', 'open', 'pending_user', 'reopened'].includes(ticket.status)
  const canReopen = ticket.status === 'resolved' && isOwner
  const canClose = ticket.status === 'resolved' && isAdmin

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-3 flex items-center gap-4 shrink-0">
        <button onClick={() => navigate('/feedback')} className="text-gray-400 hover:text-gray-900">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono">{ticket.ticket_no}</span>
            <FeedbackStatusBadge status={ticket.status} />
            <FeedbackPriorityBadge priority={ticket.priority} />
            {ticket.sla_breached === 1 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-red-500/20 text-red-400">
                <AlertTriangle size={10} /> SLA
              </span>
            )}
          </div>
          <h1 className="text-base font-semibold truncate mt-0.5">{ticket.subject}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && !ticket.assigned_to && !isDraft && (
            <button onClick={handleAssign} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition flex items-center gap-1">
              <UserCheck size={12} /> {t('feedback.assign')}
            </button>
          )}
          {isAdmin && !isDraft && ticket.status === 'processing' && (
            <button onClick={() => handleStatusChange('pending_user')} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white transition">
              {t('feedback.statusLabels.pending_user')}
            </button>
          )}
          {canResolve && (isAdmin || isOwner) && (
            <button onClick={() => setShowResolve(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1">
              <CheckCircle size={12} /> {t('feedback.resolve')}
            </button>
          )}
          {canReopen && (
            <button onClick={handleReopen} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-600 hover:bg-orange-700 text-white transition flex items-center gap-1">
              <RotateCcw size={12} /> {t('feedback.reopen')}
            </button>
          )}
          {canClose && (
            <button onClick={() => handleStatusChange('closed')} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-500 hover:bg-gray-600 text-white transition">
              {t('feedback.close')}
            </button>
          )}
          {isAdmin && !isDraft && (
            <button
              onClick={() => setShowArchive(true)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition"
              title={t('feedback.archiveTitle') || '歷史快照'}
            >
              <Archive size={14} />
            </button>
          )}
        </div>
      </div>
      {showArchive && ticket && (
        <TicketArchiveModal ticketId={ticket.id} onClose={() => setShowArchive(false)} />
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {/* Draft: 編輯表單 */}
            {isDraft && isOwner ? (
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 shadow-sm"
                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length > 0) setDraftFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]) }}
                onDragOver={e => e.preventDefault()}
                onPaste={handleDraftPaste}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('feedback.subject')} *</label>
                  <input value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('feedback.category')}</label>
                    <select value={draftCategoryId} onChange={e => setDraftCategoryId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900">
                      <option value="">--</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('feedback.priority')}</label>
                    <select value={draftPriority} onChange={e => setDraftPriority(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900">
                      <option value="low">{t('feedback.priorityLabels.low')}</option>
                      <option value="medium">{t('feedback.priorityLabels.medium')}</option>
                      <option value="high">{t('feedback.priorityLabels.high')}</option>
                      <option value="urgent">{t('feedback.priorityLabels.urgent')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('feedback.description')}</label>
                  <textarea value={draftDesc} onChange={e => setDraftDesc(e.target.value)} onPaste={handleDraftPaste}
                    onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length > 0) setDraftFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]) }}
                    onDragOver={e => e.preventDefault()}
                    rows={5} className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-y"
                    placeholder={t('feedback.description') + '（可拖放檔案或 Ctrl+V 貼圖）'} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('feedback.shareLink')}</label>
                  <input value={draftShareLink} onChange={e => setDraftShareLink(e.target.value)}
                    placeholder="https://..." className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                {/* 已上傳附件 */}
                {attachments.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('feedback.attachments')} ({attachments.length})</label>
                    <div className="flex flex-wrap gap-2">
                      {attachments.map(att => (
                        <div key={att.id} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600">
                          {att.mime_type?.startsWith('image/') ? <Image size={12} /> : <FileText size={12} />}
                          <span className="truncate max-w-[120px]">{att.file_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 新增附件 */}
                <div>
                  <button onClick={() => draftFileRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition">
                    <Upload size={14} /> {t('feedback.attachFiles')}
                  </button>
                  <input ref={draftFileRef} type="file" multiple className="hidden"
                    onChange={e => e.target.files && setDraftFiles(prev => [...prev, ...Array.from(e.target.files!)])} />
                  {draftFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {draftFiles.map((f, i) => (
                        <div key={i} className="relative group">
                          {f.type.startsWith('image/') ? (
                            <img src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                          ) : (
                            <div className="w-16 h-16 flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-[10px] text-gray-400 px-1 text-center">{f.name.slice(0, 12)}</div>
                          )}
                          <button onClick={() => setDraftFiles(prev => prev.filter((_, j) => j !== i))}
                            className="absolute -top-1 -right-1 bg-red-500 rounded-full w-4 h-4 flex items-center justify-center text-white text-[10px] opacity-0 group-hover:opacity-100 transition">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 操作按鈕 */}
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button onClick={handleDraftSave} disabled={draftSaving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition">
                    <Save size={14} /> {t('common.save')}
                  </button>
                  <button onClick={handleDraftSubmit} disabled={draftSaving || !draftSubject.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition">
                    {draftSaving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {t('feedback.submit')}
                  </button>
                </div>
              </div>
            ) : (
              /* 非草稿：唯讀顯示 */
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                  <User size={12} />
                  <span>{ticket.applicant_name}</span>
                  {ticket.applicant_dept && <span>({ticket.applicant_dept})</span>}
                  <span>·</span>
                  <Clock size={12} />
                  <span>{formatDate(ticket.created_at)}</span>
                </div>
                {ticket.description && (
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</div>
                )}
                {ticket.share_link && (
                  <a href={ticket.share_link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    {t('feedback.shareLink')}
                  </a>
                )}
              </div>
            )}

            {/* Messages */}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${
                msg.is_system ? 'justify-center' :
                msg.sender_role === 'applicant' ? 'justify-start' : 'justify-end'
              }`}>
                <div className={`relative group/msg rounded-xl px-4 py-2.5 ${
                  msg.is_system ? 'bg-gray-100 text-gray-500 text-center text-xs' :
                  msg.is_internal ? 'max-w-[70%] bg-amber-50 border border-amber-200' :
                  msg.sender_role === 'applicant' ? 'max-w-[70%] bg-gray-100 border border-gray-200' :
                  'max-w-[70%] bg-blue-50 border border-blue-200'
                }`}>
                  {/* 管理員可刪除自己的訊息 */}
                  {!msg.is_system && isAdmin && msg.sender_role === 'admin' && msg.sender_id === (user as any)?.id && (
                    <button
                      onClick={async () => {
                        if (!confirm('確認刪除這則訊息？')) return
                        try { await api.delete(`/feedback/messages/${msg.id}`); fetchAll() }
                        catch (e: any) { alert(e.response?.data?.error || 'Error') }
                      }}
                      className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 rounded-full w-6 h-6 flex items-center justify-center text-white opacity-0 group-hover/msg:opacity-100 transition shadow-lg"
                      title="刪除訊息"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  {!msg.is_system && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                      {msg.is_internal && <Lock size={10} className="text-amber-400" />}
                      <span className={msg.sender_role === 'admin' ? 'text-blue-400' : 'text-gray-400'}>
                        {msg.sender_name || msg.sender_role}
                      </span>
                      <span>{formatDate(msg.created_at)}</span>
                    </div>
                  )}
                  <div className="text-sm whitespace-pre-wrap text-gray-800">
                    {msg.content}
                  </div>
                  {/* Inline 附件（圖片 inline + 非圖片檔案連結） */}
                  {(() => {
                    const msgAtts = attachments.filter(a => a.message_id === msg.id)
                    if (msgAtts.length === 0) return null
                    const canDelete = (isAdmin || msg.sender_id === (user as any)?.id) && canChat
                    const handleDeleteAtt = async (attId: number) => {
                      if (!confirm('確認刪除此附件？')) return
                      try { await api.delete(`/feedback/attachments/${attId}`); fetchAll() } catch {}
                    }
                    return (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {msgAtts.map(att => (
                          <div key={att.id} className="relative group">
                            {att.mime_type?.startsWith('image/') ? (
                              <button onClick={() => setLightboxUrl(`/uploads/${att.file_path}`)}
                                className="block rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition">
                                <img src={`/uploads/${att.file_path}`} alt={att.file_name}
                                  className="max-w-[240px] max-h-[180px] object-cover" />
                              </button>
                            ) : (
                              <a href={`/uploads/${att.file_path}`} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 hover:text-blue-600 hover:border-blue-300 transition">
                                <FileText size={14} className="text-gray-400" />
                                <span className="truncate max-w-[150px]">{att.file_name}</span>
                                <Download size={12} className="text-gray-300" />
                              </a>
                            )}
                            {canDelete && (
                              <button onClick={() => handleDeleteAtt(att.id)}
                                className="absolute -top-1.5 -right-1.5 bg-red-500 rounded-full w-5 h-5 flex items-center justify-center text-white text-[10px] opacity-0 group-hover:opacity-100 transition shadow">×</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Typing Indicator */}
          {typingUsers.length > 0 && (
            <div className="px-6 py-1 text-xs text-gray-500 animate-pulse">
              {typingUsers.map(u => u.name).join(', ')} {t('feedback.statusLabels.processing')}...
            </div>
          )}

          {/* Chat Input */}
          {canChat && (
            <div className="border-t border-gray-200 bg-gray-50 px-6 py-3">
              {/* 檔案預覽（圖片縮圖 + 非圖片檔名） */}
              {msgFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {msgFiles.map((f, i) => (
                    <div key={i} className="relative group">
                      {f.type.startsWith('image/') ? (
                        <img src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                      ) : (
                        <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 h-16">
                          <FileText size={14} className="text-gray-400 shrink-0" />
                          <span className="truncate max-w-[80px]">{f.name}</span>
                        </div>
                      )}
                      <button onClick={() => setMsgFiles(prev => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 rounded-full w-4 h-4 flex items-center justify-center text-white text-[10px] opacity-0 group-hover:opacity-100 transition">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-3">
                <div className="flex-1 relative">
                  <textarea
                    ref={msgTextareaRef}
                    value={msgContent}
                    onChange={e => handleInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length > 0) setMsgFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]) }}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                    placeholder={t('feedback.typeMessage') + '（可拖放檔案或 Ctrl+V 貼圖）'}
                    rows={2}
                    className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
                  />
                  {voicePreview && (
                    <div className="mt-1 px-3 py-1 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 italic flex items-center gap-1.5">
                      <span className="text-blue-400">›</span>
                      <span className="truncate">{voicePreview}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-gray-100">
                    <MicButton
                      onTranscript={insertVoiceText}
                      onInterim={setVoicePreview}
                      maxDuration={180}
                      source="feedback"
                      size={16}
                      showInlineStatus={false}
                    />
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-900 transition"
                    title={t('feedback.attachFiles')}
                  >
                    <Paperclip size={16} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => e.target.files && setMsgFiles(prev => [...prev, ...Array.from(e.target.files!)])}
                  />
                  {isAdmin && (
                    <button
                      onClick={() => setIsInternal(!isInternal)}
                      className={`p-2 rounded-lg transition ${isInternal ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'}`}
                      title={t('feedback.internalNote')}
                    >
                      <Lock size={16} />
                    </button>
                  )}
                  <button
                    onClick={sendMessage}
                    disabled={sending || (!msgContent.trim() && msgFiles.length === 0)}
                    className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30 transition"
                  >
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
              </div>
              {isAdmin && isInternal && (
                <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                  <Lock size={10} /> {t('feedback.internalNote')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="w-80 border-l border-gray-200 bg-gray-50/50 overflow-y-auto shrink-0 hidden lg:block">
          <div className="p-4 space-y-5">
            {/* Details */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> {t('feedback.details')}
              </h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">{t('feedback.applicant')}</span>
                  <span className="font-medium text-gray-900 flex items-center gap-1">
                    <User size={12} className="text-blue-500" /> {ticket.applicant_name}
                  </span>
                </div>
                {ticket.applicant_dept && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">{t('feedback.department')}</span>
                    <span className="text-gray-600 bg-gray-100 px-2 py-0.5 rounded text-xs">{ticket.applicant_dept}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">{t('feedback.category')}</span>
                  <span className="text-purple-600 bg-purple-50 px-2 py-0.5 rounded text-xs font-medium">{ticket.category_name || '-'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">{t('feedback.assignedTo')}</span>
                  {ticket.assigned_name ? (
                    <span className="font-medium text-green-700 flex items-center gap-1">
                      <UserCheck size={12} className="text-green-500" /> {ticket.assigned_name}
                    </span>
                  ) : (
                    <span className="text-orange-400 text-xs italic">{t('feedback.statusLabels.open')}</span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">{t('feedback.createdAt')}</span>
                  <span className="text-gray-600 text-xs flex items-center gap-1">
                    <Clock size={10} className="text-gray-400" /> {formatDate(ticket.created_at)}
                  </span>
                </div>
                {ticket.resolved_at && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">{t('feedback.resolvedAt')}</span>
                    <span className="text-green-600 text-xs flex items-center gap-1">
                      <CheckCircle size={10} /> {formatDate(ticket.resolved_at)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* SLA */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {t('feedback.sla')}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">{t('feedback.firstResponse')}</span>
                  {ticket.first_response_at ? (
                    <span className="text-green-600 text-xs font-medium flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded">
                      <CheckCircle size={10} /> {t('feedback.onTrack')}
                    </span>
                  ) : ticket.sla_due_first_response ? (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${ticket.sla_breached ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                      {formatRelative(ticket.sla_due_first_response)}
                    </span>
                  ) : <span className="text-gray-300 text-xs">-</span>}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">{t('feedback.resolution')}</span>
                  {ticket.resolved_at ? (
                    <span className="text-green-600 text-xs font-medium flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded">
                      <CheckCircle size={10} /> {t('feedback.onTrack')}
                    </span>
                  ) : ticket.sla_due_resolution ? (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${ticket.sla_breached ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                      {formatRelative(ticket.sla_due_resolution)}
                    </span>
                  ) : <span className="text-gray-300 text-xs">-</span>}
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                {t('feedback.attachments')}
                <span className="ml-auto text-gray-400 font-normal">{attachments.length}</span>
              </h3>
              {attachments.length === 0 ? (
                <p className="text-xs text-gray-300 italic">無附件</p>
              ) : (
                <div className="space-y-1.5">
                  {attachments.map(att => {
                    const ext = att.file_name?.split('.').pop()?.toLowerCase() || ''
                    const isImage = att.mime_type?.startsWith('image/')
                    const isPdf = ext === 'pdf'
                    const isDoc = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)
                    const isZip = ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)
                    const iconColor = isImage ? 'text-pink-500' : isPdf ? 'text-red-500' : isDoc ? 'text-blue-500' : isZip ? 'text-amber-500' : 'text-gray-400'
                    const bgColor = isImage ? 'bg-pink-50' : isPdf ? 'bg-red-50' : isDoc ? 'bg-blue-50' : isZip ? 'bg-amber-50' : 'bg-gray-50'

                    return (
                      <div key={att.id} className={`flex items-center gap-2.5 text-xs p-2 rounded-lg ${bgColor} border border-gray-100`}>
                        <div className={`shrink-0 ${iconColor}`}>
                          {isImage ? <Image size={14} /> : <FileText size={14} />}
                        </div>
                        {isImage ? (
                          <button onClick={() => setLightboxUrl(`/uploads/${att.file_path}`)}
                            className="flex-1 min-w-0 text-left text-gray-700 hover:text-blue-600 truncate font-medium">
                            {att.file_name}
                          </button>
                        ) : (
                          <a href={`/uploads/${att.file_path}`} target="_blank" rel="noopener noreferrer"
                            className="flex-1 min-w-0 text-gray-700 hover:text-blue-600 truncate font-medium">
                            {att.file_name}
                          </a>
                        )}
                        <span className="text-gray-300 text-[10px] uppercase shrink-0">{ext}</span>
                        <a href={`/uploads/${att.file_path}`} download className="shrink-0 text-gray-400 hover:text-blue-600">
                          <Download size={12} />
                        </a>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* AI Analysis */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <FeedbackAIAnalysis ticketId={ticket.id} ticketStatus={ticket.status} />
            </div>

            {/* Satisfaction */}
            {(ticket.status === 'resolved' || ticket.status === 'closed') && (
              <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                <h3 className="text-xs font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> {t('feedback.satisfaction')}
                </h3>
                {ticket.satisfaction_rating ? (
                  <div>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Star key={i} size={18} className={i <= ticket.satisfaction_rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'} />
                      ))}
                      <span className="text-sm font-bold text-yellow-600 ml-2">{ticket.satisfaction_rating}/5</span>
                    </div>
                    {ticket.satisfaction_comment && (
                      <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg p-2 italic">"{ticket.satisfaction_comment}"</p>
                    )}
                  </div>
                ) : isOwner ? (
                  <button onClick={() => setShowSatisfaction(true)}
                    className="w-full py-2 rounded-lg text-xs font-medium bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200 transition">
                    {t('feedback.ratingPlaceholder')}
                  </button>
                ) : (
                  <p className="text-xs text-gray-300 italic">尚未評分</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resolve Modal */}
      {showResolve && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowResolve(false)}>
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{t('feedback.resolve')}</h3>
            <textarea
              value={resolveNote}
              onChange={e => setResolveNote(e.target.value)}
              placeholder={t('feedback.resolutionNote')}
              rows={4}
              className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowResolve(false)} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-600">
                {t('common.cancel')}
              </button>
              <button onClick={handleResolve} className="px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700">
                {t('feedback.resolve')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Satisfaction Modal */}
      {showSatisfaction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSatisfaction(false)}>
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{t('feedback.satisfactionRating')}</h3>
            <div className="flex items-center gap-2 mb-4 justify-center">
              {[1, 2, 3, 4, 5].map(i => (
                <button key={i} onClick={() => setRating(i)}>
                  <Star size={32} className={`transition ${i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 hover:text-gray-400'}`} />
                </button>
              ))}
            </div>
            <textarea
              value={satisfactionComment}
              onChange={e => setSatisfactionComment(e.target.value)}
              placeholder={t('feedback.satisfactionComment')}
              rows={3}
              className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowSatisfaction(false)} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-600">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSatisfaction}
                disabled={rating < 1}
                className="px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30"
              >
                {t('feedback.submit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8" onClick={() => setLightboxUrl(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <button onClick={() => setLightboxUrl(null)} className="absolute -top-3 -right-3 bg-white rounded-full p-1 shadow-lg hover:bg-gray-100">
              <X size={16} className="text-gray-600" />
            </button>
            <img src={lightboxUrl} alt="" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  )
}
