import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, X, Info, CheckCircle, XCircle, Mic, AlertTriangle, Briefcase, Pause, Download, FileText } from 'lucide-react'
import api from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useAnnouncementSocket } from '../../hooks/useAnnouncementSocket'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Announcement } from './AnnouncementBanner'

const POLL_MS = 60_000
// 個人通知 polling 比公告快(轉錄完成希望即時看到)
const PERSONAL_POLL_MS = 20_000

interface UserNotification {
  id: number
  type: string
  title: string
  message?: string
  link_url?: string
  payload?: { sessionId?: string; jobId?: string; messageId?: number; transcriptFile?: string; chars?: number; segments?: number; error?: string } | null
  is_read: boolean
  is_dismissed: boolean
  created_at?: string
}

/**
 * 鈴鐺(放 ChatPage topbar 最右)
 *
 * 顯示兩類訊息:
 *   1. 個人通知(user_notifications)— 放上方,例如「音訊轉錄完成」「跳轉到對應 chat」
 *   2. 公告(announcements)— 放下方,跨組織訊息
 *
 * Badge = 兩者未讀加總
 */
export default function AnnouncementBell() {
  const { isAuthenticated } = useAuth()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<Announcement[]>([])
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // 收到新個人通知時短暫顯示 mini toast(3s)
  const prevUnreadRef = useRef<number>(0)
  const [showToast, setShowToast] = useState<UserNotification | null>(null)

  const fetchActive = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const lang = i18n.language || 'zh-TW'
      const { data } = await api.get<Announcement[]>('/announcements/active', { params: { lang } })
      setItems(data || [])
    } catch { /* ignore */ }
  }, [isAuthenticated, i18n.language])

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const { data } = await api.get<UserNotification[]>('/notifications', { params: { limit: 30 } })
      const list = data || []
      // 偵測未讀數增加 → 抓最新一條未讀 popup 3 秒
      const unreadNow = list.filter(n => !n.is_read && !n.is_dismissed).length
      if (unreadNow > prevUnreadRef.current && prevUnreadRef.current >= 0) {
        const newest = list.find(n => !n.is_read && !n.is_dismissed)
        if (newest && document.visibilityState === 'visible') {
          setShowToast(newest)
          setTimeout(() => setShowToast(null), 5000)
        }
      }
      prevUnreadRef.current = unreadNow
      setNotifications(list)
    } catch { /* ignore */ }
  }, [isAuthenticated])

  useEffect(() => {
    fetchActive()
    fetchNotifications()
    const t1 = setInterval(fetchActive, POLL_MS)
    const t2 = setInterval(fetchNotifications, PERSONAL_POLL_MS)
    // tab 切回前景 / 重新上線立即抓最新
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        fetchActive()
        fetchNotifications()
      }
    }
    const onOnline = () => { fetchActive(); fetchNotifications() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(t1)
      clearInterval(t2)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
    }
  }, [fetchActive, fetchNotifications])

  // socket.io push:admin 變動公告時即時 refetch(秒級)
  // 也 listen projects-platform 通知,收到即時 refetch user_notifications(不等 20s poll)
  useAnnouncementSocket(fetchActive, () => fetchNotifications())

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // 打開鈴鐺自動標記所有當前未讀為已讀(只清 badge,訊息仍留在清單)
  useEffect(() => {
    if (!open) return
    // 公告
    const annUnreadIds = items.filter(x => !x.is_read).map(x => x.id)
    if (annUnreadIds.length > 0) {
      api.post('/announcements/read', { ids: annUnreadIds })
        .then(() => setItems(prev => prev.map(x => annUnreadIds.includes(x.id) ? { ...x, is_read: true } : x)))
        .catch(() => {})
    }
    // 個人通知
    const notifUnreadIds = notifications.filter(x => !x.is_read).map(x => x.id)
    if (notifUnreadIds.length > 0) {
      api.post('/notifications/mark-read', { ids: notifUnreadIds })
        .then(() => setNotifications(prev => prev.map(x => notifUnreadIds.includes(x.id) ? { ...x, is_read: true } : x)))
        .catch(() => {})
    }
    // ESLint deps: 故意不放 items / notifications,避免每次 list 變就重打
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleAnnouncementDismiss = async (id: number) => {
    try {
      await api.post(`/announcements/${id}/dismiss`)
      setItems(prev => prev.filter(x => x.id !== id))
    } catch { /* ignore */ }
  }

  const handleNotificationDismiss = async (id: number) => {
    try {
      await api.post(`/notifications/${id}/dismiss`)
      setNotifications(prev => prev.filter(x => x.id !== id))
    } catch { /* ignore */ }
  }

  const handleNotificationClick = (notif: UserNotification) => {
    setOpen(false)
    // PDF docx 完成 → 直接觸發下載(link_url 是 /uploads/generated/*.docx 靜態檔)
    // 用 window.open 避免 React Router 把 /uploads/... 當前端路由失敗
    if (notif.type === 'pdf_docx_job_done' && notif.link_url) {
      window.open(notif.link_url, '_blank')
      return
    }
    // 優先 payload.sessionId(transcribe job 場景),其次 link_url
    const sessionId = notif.payload?.sessionId
    if (sessionId) {
      navigate(`/chat?session=${sessionId}`)
    } else if (notif.link_url) {
      navigate(notif.link_url)
    }
  }

  if (!isAuthenticated) return null

  // badge = 公告未讀 + 通知未讀
  const unreadAnn   = items.filter(x => !x.is_read).length
  const unreadNotif = notifications.filter(x => !x.is_read && !x.is_dismissed).length
  const unreadCount = unreadAnn + unreadNotif
  const totalCount  = items.length + notifications.filter(n => !n.is_dismissed).length

  const levelDot = (level: string) => ({
    critical: 'bg-red-500',
    warning:  'bg-amber-500',
    notice:   'bg-cyan-500',
    info:     'bg-slate-400',
  } as Record<string, string>)[level] || 'bg-slate-400'

  // 個人通知 type → 圖示
  const notifIcon = (type: string) => {
    if (type === 'transcribe_job_done') return <CheckCircle size={14} className="text-green-500" />
    if (type === 'transcribe_job_failed') return <XCircle size={14} className="text-red-500" />
    if (type === 'pdf_docx_job_done') return <FileText size={14} className="text-green-500" />
    if (type === 'pdf_docx_job_failed') return <XCircle size={14} className="text-red-500" />
    // projects-platform 通知(notificationEngine)
    if (type?.startsWith('proj_')) {
      if (type.includes('BLOCKER'))      return <AlertTriangle size={14} className="text-red-500" />
      if (type.includes('STAGE_GATE'))   return <CheckCircle size={14} className="text-amber-500" />
      if (type.includes('PAUSED'))       return <Pause size={14} className="text-slate-500" />
      if (type.includes('high_'))        return <AlertTriangle size={14} className="text-red-500" />
      return <Briefcase size={14} className="text-cyan-600" />
    }
    return <Mic size={14} className="text-blue-500" />
  }

  const visibleNotifications = notifications.filter(n => !n.is_dismissed)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-cyan-600 hover:bg-cyan-50 transition"
        title={t('announcement.bellTooltip')}
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Mini toast:收到新個人通知時短暫提示(3 秒)*/}
      {showToast && !open && (
        <div
          className="absolute right-0 top-9 w-80 bg-white rounded-xl border border-blue-300 shadow-2xl z-50 p-3 cursor-pointer hover:bg-blue-50 transition animate-[fadeIn_0.2s_ease-out]"
          onClick={() => {
            // PDF docx 完成 → 直接觸發下載,不走 SPA navigate
            if (showToast.type === 'pdf_docx_job_done' && showToast.link_url) {
              window.open(showToast.link_url, '_blank')
              setShowToast(null)
              return
            }
            const sessionId = showToast.payload?.sessionId
            if (sessionId) navigate(`/chat?session=${sessionId}`)
            else if (showToast.link_url) navigate(showToast.link_url)
            setShowToast(null)
          }}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">
              {showToast.type === 'transcribe_job_done' ? <CheckCircle size={16} className="text-green-500" /> :
               showToast.type === 'transcribe_job_failed' ? <XCircle size={16} className="text-red-500" /> :
               showToast.type === 'pdf_docx_job_done' ? <FileText size={16} className="text-green-500" /> :
               showToast.type === 'pdf_docx_job_failed' ? <XCircle size={16} className="text-red-500" /> :
               <Mic size={16} className="text-blue-500" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-800 break-words">{showToast.title}</div>
              {showToast.message && (
                <div className="text-xs text-slate-500 mt-0.5 break-words">{showToast.message}</div>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setShowToast(null) }}
              className="text-slate-300 hover:text-slate-600 flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-9 w-96 max-h-[70vh] bg-white rounded-xl border border-slate-200 shadow-2xl z-50 flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2 text-slate-700 text-sm font-medium">
              <Bell size={14} /> {t('announcement.bellListTitle')}
            </div>
            <span className="text-xs text-slate-500">
              {unreadCount > 0
                ? t('announcement.bellUnreadCount', { count: unreadCount })
                : `${totalCount}`}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* 個人通知 section(最上面)*/}
            {visibleNotifications.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50/50">
                  {t('transcribe_job.personal')}
                </div>
                {visibleNotifications.map(n => (
                  <div
                    key={`n-${n.id}`}
                    className={`px-4 py-3 border-b border-slate-100 hover:bg-blue-50/40 group cursor-pointer ${n.is_read ? 'opacity-70' : ''}`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex-shrink-0">{notifIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm mb-0.5 break-words ${n.is_read ? 'font-normal text-slate-600' : 'font-medium text-slate-800'}`}>
                          {n.title}
                        </div>
                        {n.message && (
                          <div className="text-xs text-slate-500 break-words prose prose-xs max-w-none [&_a]:text-blue-600 [&_a]:underline">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.message}</ReactMarkdown>
                          </div>
                        )}
                        {/* PDF 轉檔完成 → 明顯下載按鈕(對齊 transcribe job 的點卡片下載 UX,但更明顯) */}
                        {n.type === 'pdf_docx_job_done' && n.link_url && (
                          <a
                            href={n.link_url}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 mt-1.5 px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 font-medium"
                          >
                            <Download size={11} /> 下載 docx
                          </a>
                        )}
                        {n.created_at && (
                          <div className="text-[10px] text-slate-400 mt-1">
                            {new Date(n.created_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleNotificationDismiss(n.id) }}
                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-slate-600 transition flex-shrink-0"
                        title={t('announcement.dismiss')}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* 公告 section */}
            {items.length > 0 && (
              <>
                {visibleNotifications.length > 0 && (
                  <div className="px-4 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50/50">
                    {t('transcribe_job.announcements')}
                  </div>
                )}
                {items.map(a => (
                  <div key={`a-${a.id}`} className={`px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 group ${a.is_read ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${a.is_read ? 'bg-slate-300' : levelDot(a.level)}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm mb-1 break-words ${a.is_read ? 'font-normal text-slate-600' : 'font-medium text-slate-800'}`}>{a.title}</div>
                        {a.body && (
                          <div className="text-xs text-slate-600 prose prose-xs max-w-none break-words">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.body}</ReactMarkdown>
                          </div>
                        )}
                        {a.effective_to && (
                          <div className="text-[10px] text-slate-400 mt-1">
                            {t('announcement.validUntil', { time: new Date(a.effective_to).toLocaleString() })}
                          </div>
                        )}
                      </div>
                      {Number(a.dismissible) === 1 && (
                        <button
                          onClick={() => handleAnnouncementDismiss(a.id)}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-slate-600 transition flex-shrink-0"
                          title={t('announcement.dismiss')}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            {totalCount === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
                <Info size={28} className="opacity-40" />
                {t('announcement.bellEmpty')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
