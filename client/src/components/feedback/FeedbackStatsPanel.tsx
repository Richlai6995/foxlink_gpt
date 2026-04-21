import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { BarChart3, Clock, CheckCircle, AlertTriangle, Star, Bot, Download, Loader2 } from 'lucide-react'
import { useFeedbackConfig } from '../../hooks/useFeedbackConfig'

interface Stats {
  statusDist: { status: string; cnt: number }[]
  priorityDist: { priority: string; cnt: number }[]
  categoryDist: { category_name: string; cnt: number }[]
  summary: {
    total: number
    ai_resolved_count: number
    sla_breached_count: number
    avg_satisfaction: number
  }
}

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6', processing: '#eab308', pending_user: '#a855f7',
  resolved: '#22c55e', closed: '#64748b', reopened: '#f97316',
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#64748b',
}

export default function FeedbackStatsPanel() {
  const { t } = useTranslation()
  const { features } = useFeedbackConfig()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    loadStats()
  }, [dateFrom, dateTo])

  const loadStats = async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const { data } = await api.get('/feedback/admin/stats', { params })
      setStats(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const params: any = {}
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const response = await api.get('/feedback/admin/export', { params, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `feedback_export_${Date.now()}.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setExporting(false)
    }
  }

  const total = stats?.summary?.total || 0
  const maxStatusCnt = Math.max(...(stats?.statusDist?.map(s => Number(s.cnt)) || [1]))
  const maxPriorityCnt = Math.max(...(stats?.priorityDist?.map(s => Number(s.cnt)) || [1]))
  const maxCatCnt = Math.max(...(stats?.categoryDist?.map(s => Number(s.cnt)) || [1]))

  return (
    <div className="space-y-6">
      {/* Date Filter + Export */}
      <div className="flex items-center gap-3 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900" />
        <span className="text-gray-400">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900" />
        <button onClick={handleExport} disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-600 border border-green-200 hover:bg-green-100">
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {t('feedback.export')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
      ) : stats ? (
        <>
          {/* Summary Cards */}
          <div className={`grid grid-cols-2 gap-3 ${features.sla ? 'lg:grid-cols-5' : 'lg:grid-cols-3'}`}>
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="text-2xl font-bold text-gray-900">{total}</div>
              <div className="text-xs text-gray-500 mt-1">{t('feedback.allTickets')}</div>
            </div>
            {features.sla && (
              <>
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                  <div className="text-2xl font-bold text-green-400">
                    {total > 0 ? Math.round((1 - (stats.summary.sla_breached_count || 0) / total) * 100) : 0}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><CheckCircle size={10} /> SLA {t('feedback.onTrack')}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                  <div className="text-2xl font-bold text-red-400">{stats.summary.sla_breached_count || 0}</div>
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><AlertTriangle size={10} /> {t('feedback.breached')}</div>
                </div>
              </>
            )}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="text-2xl font-bold text-blue-400">{stats.summary.ai_resolved_count || 0}</div>
              <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Bot size={10} /> AI {t('feedback.resolve')}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="text-2xl font-bold text-yellow-400 flex items-center gap-1">
                <Star size={18} className="fill-yellow-400" /> {stats.summary.avg_satisfaction || '-'}
              </div>
              <div className="text-xs text-gray-500 mt-1">{t('feedback.satisfaction')}</div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Status Distribution */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <h4 className="text-xs font-semibold text-gray-500 mb-3">{t('feedback.status')}</h4>
              <div className="space-y-2">
                {stats.statusDist.map(s => (
                  <div key={s.status} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16 shrink-0">{t(`feedback.statusLabels.${s.status}`, s.status)}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${(Number(s.cnt) / maxStatusCnt) * 100}%`,
                        backgroundColor: STATUS_COLORS[s.status] || '#64748b'
                      }} />
                    </div>
                    <span className="text-xs text-gray-700 w-8 text-right">{s.cnt}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Priority Distribution */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <h4 className="text-xs font-semibold text-gray-500 mb-3">{t('feedback.priority')}</h4>
              <div className="space-y-2">
                {stats.priorityDist.map(s => (
                  <div key={s.priority} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-12 shrink-0">{t(`feedback.priorityLabels.${s.priority}`, s.priority)}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${(Number(s.cnt) / maxPriorityCnt) * 100}%`,
                        backgroundColor: PRIORITY_COLORS[s.priority] || '#64748b'
                      }} />
                    </div>
                    <span className="text-xs text-gray-700 w-8 text-right">{s.cnt}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Category Distribution */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <h4 className="text-xs font-semibold text-gray-500 mb-3">{t('feedback.category')}</h4>
              <div className="space-y-2">
                {stats.categoryDist.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-20 shrink-0 truncate">{s.category_name || '-'}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div className="h-full rounded-full bg-teal-500 transition-all" style={{
                        width: `${(Number(s.cnt) / maxCatCnt) * 100}%`,
                      }} />
                    </div>
                    <span className="text-xs text-gray-700 w-8 text-right">{s.cnt}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
