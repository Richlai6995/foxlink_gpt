import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, AlertCircle, Info, Megaphone, X, ChevronRight } from 'lucide-react'
import api from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface Announcement {
  id: number
  level: 'info' | 'notice' | 'warning' | 'critical'
  title: string
  body?: string | null
  dismissible: number | boolean
  effective_to?: string | null
  created_at?: string
  is_read?: boolean
}

const POLL_MS = 60_000  // 60 秒輪詢一次

// level → 顏色 / icon。critical 紅、warning 橘、notice 藍、info 灰(info 走鈴鐺不走 banner)
const LEVEL_STYLE = {
  critical: { bg: 'bg-red-600',     text: 'text-white',         icon: AlertTriangle, hoverX: 'hover:bg-red-700' },
  warning:  { bg: 'bg-amber-500',   text: 'text-white',         icon: AlertCircle,   hoverX: 'hover:bg-amber-600' },
  notice:   { bg: 'bg-cyan-600',    text: 'text-white',         icon: Megaphone,     hoverX: 'hover:bg-cyan-700' },
  info:     { bg: 'bg-slate-500',   text: 'text-white',         icon: Info,          hoverX: 'hover:bg-slate-600' },
} as const

/**
 * 全站頂部公告 banner
 *
 * 顯示策略:
 *   - critical/warning/notice 三級顯示為 banner(info 級走鈴鐺,這裡不渲染)
 *   - 同一時間只顯示「最高重要度」的最新一則,其他用 ChevronRight 切換
 *   - dismissible=0 時不顯示 X 按鈕(critical 強制顯示)
 *   - dismiss 後呼叫後端 /dismiss,該 user 該則永不再現
 *
 * Mount 在 App.tsx,登入後才會抓
 */
export default function AnnouncementBanner() {
  const { isAuthenticated } = useAuth()
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<Announcement[]>([])
  const [idx, setIdx] = useState(0)
  const [expanded, setExpanded] = useState(false)

  const fetchActive = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const lang = i18n.language || 'zh-TW'
      const { data } = await api.get<Announcement[]>('/announcements/active', { params: { lang } })
      // 過濾掉 info 級(走鈴鐺)
      const banners = (data || []).filter(x => x.level !== 'info')
      setItems(banners)
      setIdx(0)
    } catch {
      // 401/network 都靜默,interceptor 會處理 401
    }
  }, [isAuthenticated, i18n.language])

  useEffect(() => {
    fetchActive()
    const t = setInterval(fetchActive, POLL_MS)
    // tab 從背景切回前景立即抓一次(setInterval 在背景會被 throttle)
    const onVis = () => { if (document.visibilityState === 'visible') fetchActive() }
    document.addEventListener('visibilitychange', onVis)
    // 重新連線時也抓一次(離線→上線常見)
    const onOnline = () => fetchActive()
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
    }
  }, [fetchActive])

  if (!isAuthenticated || items.length === 0) return null

  const current = items[Math.min(idx, items.length - 1)]
  const style = LEVEL_STYLE[current.level] || LEVEL_STYLE.notice
  const Icon = style.icon
  const dismissible = Number(current.dismissible) === 1

  const handleDismiss = async () => {
    try {
      await api.post(`/announcements/${current.id}/dismiss`)
      const next = items.filter(x => x.id !== current.id)
      setItems(next)
      setIdx(0)
      setExpanded(false)
    } catch {
      // ignore
    }
  }

  const handleNext = () => {
    setIdx(i => (i + 1) % items.length)
    setExpanded(false)
  }

  return (
    <div className={`${style.bg} ${style.text} text-sm shadow-sm`}>
      <div className="px-4 py-2 flex items-center gap-3">
        <Icon size={16} className="flex-shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="font-medium truncate">{current.title}</span>
          {current.body && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs underline opacity-80 hover:opacity-100 flex-shrink-0"
            >
              {expanded ? t('announcement.collapse') : t('announcement.expand')}
            </button>
          )}
        </div>
        {items.length > 1 && (
          <button
            onClick={handleNext}
            className={`text-xs px-2 py-0.5 rounded ${style.hoverX} flex items-center gap-1 flex-shrink-0`}
            title={t('announcement.next')}
          >
            {idx + 1}/{items.length} <ChevronRight size={12} />
          </button>
        )}
        {dismissible && (
          <button
            onClick={handleDismiss}
            className={`${style.hoverX} rounded p-0.5 transition flex-shrink-0`}
            title={t('announcement.dismiss')}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {expanded && current.body && (
        <div className="px-4 pb-3 -mt-1 text-xs/relaxed prose prose-sm prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.body}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
