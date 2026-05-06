import { useState, useEffect, useCallback } from 'react'
import api from '../lib/api'

export function useFeedbackNotifications() {
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchCount = useCallback(async () => {
    try {
      const { data } = await api.get('/feedback/notifications', { params: { unread_only: 'true', limit: 1 } })
      setUnreadCount(data.unread_count || 0)
    } catch {}
  }, [])

  useEffect(() => {
    fetchCount()
    const interval = setInterval(fetchCount, 30000) // 30s polling for badge count
    // tab 切回前景 / 重新上線立即抓(背景 setInterval 會被 throttle)
    const onVis = () => { if (document.visibilityState === 'visible') fetchCount() }
    const onOnline = () => fetchCount()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
    }
  }, [fetchCount])

  const markAllRead = useCallback(async () => {
    try {
      await api.put('/feedback/notifications/read', {})
      setUnreadCount(0)
    } catch {}
  }, [])

  return { unreadCount, fetchCount, markAllRead }
}
