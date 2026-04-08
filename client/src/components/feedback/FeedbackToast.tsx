import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useFeedbackSocket } from '../../hooks/useFeedbackSocket'
import { TicketCheck, X } from 'lucide-react'

interface Toast {
  id: number
  title: string
  message: string
  ticketId?: number
}

let toastSeq = 0

/**
 * 全站浮動通知 — 管理員收到新工單/新訊息時右上角彈出 toast
 * 5 秒自動消失，點擊跳轉到工單詳情
 */
export default function FeedbackToast() {
  const { isAdmin } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [toasts, setToasts] = useState<Toast[]>([])

  // 全局 socket（不綁定特定工單）
  const { lastEvent } = useFeedbackSocket()

  const addToast = useCallback((title: string, message: string, ticketId?: number) => {
    const id = ++toastSeq
    setToasts(prev => [...prev.slice(-4), { id, title, message, ticketId }]) // 最多 5 個
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  useEffect(() => {
    if (!isAdmin || !lastEvent) return
    const { type, data } = lastEvent

    if (type === 'new_ticket' && data?.ticket) {
      addToast(
        t('feedback.title'),
        `${data.ticket.applicant_name}: ${data.ticket.subject}`,
        data.ticket.id,
      )
    }
    if (type === 'new_message' && data?.message) {
      const msg = data.message
      if (msg.sender_role === 'applicant') {
        addToast(
          t('feedback.chat'),
          `${msg.sender_name || 'User'}: ${(msg.content || '').slice(0, 80)}`,
          msg.ticket_id,
        )
      }
    }
  }, [lastEvent, isAdmin, addToast, t])

  const handleClick = (toast: Toast) => {
    if (toast.ticketId) navigate(`/feedback/${toast.ticketId}`)
    setToasts(prev => prev.filter(t => t.id !== toast.id))
  }

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 w-80">
      {toasts.map(toast => (
        <div
          key={toast.id}
          onClick={() => handleClick(toast)}
          className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 cursor-pointer hover:shadow-xl transition-all animate-slide-in flex items-start gap-3"
        >
          <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
            <TicketCheck size={16} className="text-rose-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">{toast.title}</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">{toast.message}</p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); setToasts(prev => prev.filter(t => t.id !== toast.id)) }}
            className="text-gray-300 hover:text-gray-500 shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
