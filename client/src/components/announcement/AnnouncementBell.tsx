import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, X, Info } from 'lucide-react'
import api from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Announcement } from './AnnouncementBanner'

const POLL_MS = 60_000

/**
 * 鈴鐺(放 ChatPage topbar 最右)
 *
 * 只顯示 info 級公告(其他級已在頂部 banner 顯示);
 * 但下拉清單會顯示「全部當前可見且未 dismiss 的公告」(包含 banner 那些),
 * 讓 user 之後想回看可以打開鈴鐺。
 *
 * Badge 數字 = 全部當前可見公告數
 */
export default function AnnouncementBell() {
  const { isAuthenticated } = useAuth()
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<Announcement[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const fetchActive = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const lang = i18n.language || 'zh-TW'
      const { data } = await api.get<Announcement[]>('/announcements/active', { params: { lang } })
      setItems(data || [])
    } catch { /* ignore */ }
  }, [isAuthenticated, i18n.language])

  useEffect(() => {
    fetchActive()
    const t = setInterval(fetchActive, POLL_MS)
    return () => clearInterval(t)
  }, [fetchActive])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // 打開鈴鐺自動標記所有當前未讀為已讀(只清 badge,公告仍留在清單)
  useEffect(() => {
    if (!open) return
    const unreadIds = items.filter(x => !x.is_read).map(x => x.id)
    if (unreadIds.length === 0) return
    api.post('/announcements/read', { ids: unreadIds })
      .then(() => {
        // 樂觀更新:本地直接標 read,不重打 list 避免閃爍
        setItems(prev => prev.map(x => unreadIds.includes(x.id) ? { ...x, is_read: true } : x))
      })
      .catch(() => { /* 失敗不擋 UI */ })
  }, [open, items])

  const handleDismiss = async (id: number) => {
    try {
      await api.post(`/announcements/${id}/dismiss`)
      setItems(prev => prev.filter(x => x.id !== id))
    } catch { /* ignore */ }
  }

  if (!isAuthenticated) return null

  // badge 只算未讀的;清單仍顯示全部(已讀的視覺淡化)
  const unreadCount = items.filter(x => !x.is_read).length
  const totalCount = items.length
  const levelDot = (level: string) => ({
    critical: 'bg-red-500',
    warning:  'bg-amber-500',
    notice:   'bg-cyan-500',
    info:     'bg-slate-400',
  } as Record<string, string>)[level] || 'bg-slate-400'

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
            {totalCount === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
                <Info size={28} className="opacity-40" />
                {t('announcement.bellEmpty')}
              </div>
            ) : (
              items.map(a => (
                <div key={a.id} className={`px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 group ${a.is_read ? 'opacity-60' : ''}`}>
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
                        onClick={() => handleDismiss(a.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-slate-600 transition flex-shrink-0"
                        title={t('announcement.dismiss')}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
