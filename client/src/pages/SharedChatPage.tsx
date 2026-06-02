import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, Check, Download, Trash2, MessageSquarePlus } from 'lucide-react'
import api from '../lib/api'
import { copyText } from '../lib/clipboard'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import ChatWindow from '../components/ChatWindow'
import type { ChatMessage } from '../types'

interface ShareData {
  id: string
  title: string
  model: string
  created_at: string
  creator_name: string | null
  creator_username: string | null
  is_owner: boolean
  messages: Array<{
    id: number
    role: string
    content: string
    created_at: string
    files?: Array<{ name: string; type: string; url: string }>
    generated_files?: Array<{ type: string; filename: string; publicUrl: string }>
  }>
}

export default function SharedChatPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { t } = useTranslation()
  const [data, setData] = useState<ShareData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forking, setForking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    setError('')
    api
      .get(`/share/${token}`)
      .then((r) => setData(r.data))
      .catch((e) => {
        const msg = e?.response?.data?.error || t('share.loadFailed', '載入分享失敗')
        setError(msg)
      })
      .finally(() => setLoading(false))
  }, [token, t])

  const canDelete = !!data?.is_owner || isAdmin

  const handleFork = async () => {
    if (!token || forking) return
    setForking(true)
    try {
      const r = await api.post(`/share/${token}/fork`)
      navigate(`/chat?session=${r.data.sessionId}`)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(msg || t('share.importError', '匯入失敗'))
    } finally {
      setForking(false)
    }
  }

  const handleCopyLink = () => {
    if (!token) return
    copyText(`${window.location.origin}/share/${token}`).catch(() => {})
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const handleDelete = async () => {
    if (!token || deleting) return
    if (!window.confirm(t('share.deleteConfirm', '確定要刪除此分享連結?刪除後其他人將無法再透過此連結存取。'))) return
    setDeleting(true)
    try {
      await api.delete(`/share/${token}`)
      navigate('/chat')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(msg || t('share.deleteFailed', '刪除失敗'))
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-400">
        {t('share.loading', '載入中...')}
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 gap-4">
        <div className="text-slate-500 text-base">{error || t('share.notFound', '找不到分享或已被刪除')}</div>
        <button
          onClick={() => navigate('/chat')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
        >
          <ArrowLeft size={14} />
          {t('share.backToChat', '回到對話')}
        </button>
      </div>
    )
  }

  // Adapt server message shape to ChatMessage type for ChatWindow.
  // Filter out non-user/assistant rows (e.g. system) — ChatWindow doesn't render them.
  const messages: ChatMessage[] = data.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
    id: m.id,
    session_id: data.id,
    role: m.role as 'user' | 'assistant',
    content: m.content || '',
    files: m.files?.map((f) => ({
      name: f.name,
      type: (['image', 'audio', 'document'].includes(f.type) ? f.type : 'unknown') as 'image' | 'audio' | 'document' | 'unknown',
      url: f.url,
    })),
    generated_files: m.generated_files?.map((g) => ({
      type: g.type || 'file',
      filename: g.filename,
      publicUrl: g.publicUrl,
    })),
    created_at: m.created_at,
  }))

  const creatorLabel = data.creator_name || data.creator_username || '—'

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-4 py-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => navigate('/chat')}
          className="text-slate-500 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
          title={t('share.backToChat', '回到對話')}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-800 truncate">{data.title || t('share.untitled', '未命名對話')}</div>
          <div className="text-xs text-slate-400 truncate">
            {t('share.sharedBy', '分享自')} {creatorLabel} · {data.model || '—'} · {new Date(data.created_at).toLocaleString()}
          </div>
        </div>
        <button
          onClick={handleCopyLink}
          className="text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 text-sm flex items-center gap-1.5"
        >
          {linkCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          {linkCopied ? t('common.copied', '已複製') : t('share.copyLink', '複製連結')}
        </button>
        <button
          onClick={handleFork}
          disabled={forking}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5"
        >
          {forking ? <Download size={14} className="animate-pulse" /> : <MessageSquarePlus size={14} />}
          {forking ? t('share.importing', '匯入中...') : t('share.importToMine', '匯入到我的對話')}
        </button>
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-red-600 hover:bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50"
            title={t('share.deleteShare', '刪除分享')}
          >
            <Trash2 size={14} />
            {t('share.deleteShare', '刪除分享')}
          </button>
        )}
      </div>

      {/* Read-only notice */}
      <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700">
        {t('share.readOnlyNote', '此為唯讀分享快照,匯入後可在你自己的對話中延續。')}
      </div>

      {/* Messages */}
      <ChatWindow
        messages={messages}
        streaming={false}
        streamingContent=""
        onCopy={(txt) => {
          copyText(txt).catch(() => {})
        }}
      />
    </div>
  )
}
