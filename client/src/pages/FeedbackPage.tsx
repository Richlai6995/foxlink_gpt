import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import {
  Plus, Search, Filter, ChevronLeft, ChevronRight,
  Clock, User, Tag, AlertTriangle, CheckCircle, Loader2,
  MessageSquare, ArrowLeft
} from 'lucide-react'
import FeedbackStatusBadge from '../components/feedback/FeedbackStatusBadge'
import FeedbackPriorityBadge from '../components/feedback/FeedbackPriorityBadge'

interface Ticket {
  id: number
  ticket_no: string
  subject: string
  description: string
  status: string
  priority: string
  category_name: string
  category_icon: string
  applicant_name: string
  applicant_dept: string
  assigned_name: string
  created_at: string
  updated_at: string
  sla_breached: number
  last_message_content: string | null
  last_message_role: string | null
  last_message_is_internal: number | null
  last_message_at: string | null
  last_message_sender_name: string | null
  last_message_sender_username: string | null
}

interface Category {
  id: number
  name: string
  icon: string
}

const STATUS_OPTIONS = ['open', 'processing', 'pending_user', 'resolved', 'closed', 'reopened']
const PRIORITY_OPTIONS = ['urgent', 'high', 'medium', 'low']

export default function FeedbackPage() {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useAuth()
  const navigate = useNavigate()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<Category[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [myOnly, setMyOnly] = useState(!isAdmin)

  const limit = 20

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { page, limit, sort: 'created_at', order: 'desc' }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (priorityFilter) params.priority = priorityFilter
      if (categoryFilter) params.category_id = categoryFilter
      if (myOnly || !isAdmin) params.my = 'true'
      const { data } = await api.get('/feedback/tickets', { params })
      setTickets(data.tickets || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error('Failed to load tickets', e)
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter, priorityFilter, categoryFilter, myOnly, isAdmin])

  useEffect(() => {
    api.get(`/feedback/categories?lang=${i18n.language}`).then(r => setCategories(r.data)).catch(() => {})
  }, [i18n.language])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  // 進入頁面時標記所有通知已讀
  useEffect(() => {
    api.put('/feedback/notifications/read', {}).catch(() => {})
  }, [])

  const totalPages = Math.ceil(total / limit)

  const formatDate = (d: string) => {
    if (!d) return '-'
    return new Date(d).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const stripMarkdown = (s: string) =>
    s
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[*_`>#~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/chat')} className="text-gray-400 hover:text-gray-900 transition">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold">{t('feedback.title')}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {isAdmin && !myOnly ? t('feedback.allTickets') : t('feedback.myTickets')}
                {' '} ({total})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <button
                onClick={() => setMyOnly(!myOnly)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  myOnly ? 'bg-gray-200 text-gray-600' : 'bg-blue-600 text-white'
                }`}
              >
                {myOnly ? t('feedback.myTickets') : t('feedback.allTickets')}
              </button>
            )}
            <button
              onClick={() => navigate('/feedback/new')}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              <Plus size={16} /> {t('feedback.newTicket')}
            </button>
          </div>
        </div>

        {/* Quick Status Tabs */}
        <div className="mt-4 flex items-center gap-1 overflow-x-auto pb-1">
          {[
            { value: '', label: t('feedback.all') },
            { value: 'draft', label: t('feedback.statusLabels.draft') },
            { value: 'open', label: t('feedback.statusLabels.open') },
            { value: 'processing', label: t('feedback.statusLabels.processing') },
            { value: 'pending_user', label: t('feedback.statusLabels.pending_user') },
            { value: 'resolved', label: t('feedback.statusLabels.resolved') },
            { value: 'closed', label: t('feedback.statusLabels.closed') },
          ].map(s => (
            <button
              key={s.value}
              onClick={() => { setStatusFilter(s.value); setPage(1) }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
                statusFilter === s.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Search + Filter Bar */}
        <div className="mt-3 flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t('feedback.search')}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="w-full bg-white border border-gray-300 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition ${
              showFilters ? 'bg-blue-50 border-blue-500 text-blue-600' : 'bg-white border-gray-300 text-gray-600'
            }`}
          >
            <Filter size={14} /> {t('feedback.filter')}
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-3">
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            >
              <option value="">{t('feedback.status')}: {t('feedback.all')}</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{t(`feedback.statusLabels.${s}`)}</option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={e => { setPriorityFilter(e.target.value); setPage(1) }}
              className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            >
              <option value="">{t('feedback.priority')}: {t('feedback.all')}</option>
              {PRIORITY_OPTIONS.map(p => (
                <option key={p} value={p}>{t(`feedback.priorityLabels.${p}`)}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
              className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            >
              <option value="">{t('feedback.category')}: {t('feedback.all')}</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Ticket List */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <MessageSquare size={48} className="mx-auto mb-4 opacity-30" />
            <p>{t('feedback.noTickets')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map(ticket => (
              <div
                key={ticket.id}
                onClick={() => navigate(`/feedback/${ticket.id}`)}
                className="bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl p-4 cursor-pointer transition group shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-gray-400 font-mono">{ticket.ticket_no}</span>
                      <FeedbackStatusBadge status={ticket.status} />
                      <FeedbackPriorityBadge priority={ticket.priority} />
                      {ticket.sla_breached === 1 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-red-500/20 text-red-400">
                          <AlertTriangle size={10} /> {t('feedback.breached')}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-medium text-gray-900 group-hover:text-gray-900 truncate">
                      {ticket.subject}
                    </h3>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      {ticket.category_name && (
                        <span className="flex items-center gap-1">
                          <Tag size={11} /> {ticket.category_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <User size={11} /> {ticket.applicant_name}
                        {ticket.applicant_dept && ` (${ticket.applicant_dept})`}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} /> {formatDate(ticket.created_at)}
                      </span>
                      {ticket.assigned_name && (
                        <span className="flex items-center gap-1">
                          <CheckCircle size={11} /> {ticket.assigned_name}
                        </span>
                      )}
                    </div>
                    {ticket.last_message_content ? (
                      <div className="mt-2 flex items-start gap-2 px-2.5 py-1.5 bg-gray-50 border-l-2 border-blue-300 rounded text-xs">
                        <MessageSquare size={11} className="mt-0.5 text-blue-400 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5 text-[11px]">
                            <span className={`font-medium ${ticket.last_message_role === 'admin' ? 'text-blue-600' : 'text-gray-700'}`}>
                              {ticket.last_message_sender_name || (ticket.last_message_role === 'admin' ? t('feedback.senderAdmin') : t('feedback.senderUser'))}
                            </span>
                            {ticket.last_message_is_internal === 1 && (
                              <span className="px-1 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">
                                {t('feedback.internalNote')}
                              </span>
                            )}
                            <span className="text-gray-400">· {formatDate(ticket.last_message_at || '')}</span>
                          </div>
                          <p className="text-gray-600 line-clamp-1">
                            {stripMarkdown(ticket.last_message_content)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-gray-400 italic">
                        {t('feedback.noReplyYet')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-gray-500 px-3">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
