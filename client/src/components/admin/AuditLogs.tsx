import { useState, useEffect } from 'react'
import { Shield, AlertTriangle, RefreshCw, Download, Search, MessageSquare, Monitor } from 'lucide-react'
import type { AuditLog } from '../../types'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'
import { useTranslation } from 'react-i18next'

export default function AuditLogs() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    sensitive: '',
    source: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)
      if (filters.sensitive) params.set('sensitive', filters.sensitive)
      if (filters.source) params.set('source', filters.source)
      const res = await api.get(`/admin/audit-logs?${params}`)
      setLogs(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const displayedLogs = keyword.trim()
    ? logs.filter((l) => l.content?.toLowerCase().includes(keyword.toLowerCase()))
    : logs

  const sensitiveCount = displayedLogs.filter((l) => l.has_sensitive).length

  const exportCsv = () => {
    const header = '時間,來源,使用者,工號,是否敏感,敏感詞,對話內容'
    const lines = displayedLogs.map((l) => {
      const kws = JSON.parse(l.sensitive_keywords || '[]').join(';')
      const content = `"${(l.content || '').replace(/"/g, '""')}"`
      return [
        fmtTW(l.created_at),
        l.source === 'webex' ? 'Webex' : 'Web',
        l.name || l.username,
        l.employee_id || '',
        l.has_sensitive ? '是' : '否',
        kws,
        content,
      ].join(',')
    })
    const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${filters.startDate}-to-${filters.endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Shield size={20} className="text-blue-500" /> {t('audit.title')}
        </h2>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={displayedLogs.length === 0} className="btn-ghost flex items-center gap-1.5">
            <Download size={14} /> {t('audit.exportCsv')}
          </button>
          <button onClick={load} disabled={loading} className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('audit.refresh')}
          </button>
        </div>
      </div>

      {sensitiveCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-red-700 text-sm">
          <AlertTriangle size={16} />
          {t('audit.sensitiveAlert', { count: sensitiveCount })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 bg-slate-50 rounded-xl p-4">
        <div>
          <label className="label">{t('audit.startDate')}</label>
          <input type="date" value={filters.startDate} onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))} className="input" />
        </div>
        <div>
          <label className="label">{t('audit.endDate')}</label>
          <input type="date" value={filters.endDate} onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))} className="input" />
        </div>
        <div>
          <label className="label">{t('audit.type')}</label>
          <select value={filters.sensitive} onChange={(e) => setFilters((p) => ({ ...p, sensitive: e.target.value }))} className="input">
            <option value="">{t('audit.typeAll')}</option>
            <option value="1">{t('audit.typeSensitive')}</option>
          </select>
        </div>
        <div>
          <label className="label">來源</label>
          <select value={filters.source} onChange={(e) => setFilters((p) => ({ ...p, source: e.target.value }))} className="input">
            <option value="">全部</option>
            <option value="webex">Webex Bot</option>
            <option value="web">Web UI</option>
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={load} className="btn-primary">{t('audit.query')}</button>
        </div>
      </div>

      {/* Keyword search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t('audit.contentSearch')}
          className="input pl-8 w-full"
        />
      </div>

      {/* Logs */}
      <div className="space-y-2">
        {displayedLogs.map((l) => (
          <div
            key={l.id}
            className={`bg-white border rounded-xl overflow-hidden ${l.has_sensitive ? 'border-red-200' : 'border-slate-200'}`}
          >
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => setExpanded(expanded === l.id ? null : l.id)}
            >
              {l.has_sensitive ? (
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
              ) : (
                <Shield size={14} className="text-slate-400 flex-shrink-0" />
              )}
              <span className="text-sm font-medium text-slate-700">{l.name || l.username}</span>
              {l.employee_id && <span className="text-xs text-slate-400">{l.employee_id}</span>}
              <span className="text-xs text-slate-400">{fmtTW(l.created_at)}</span>
              {l.source === 'webex' ? (
                <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  <MessageSquare size={10} /> Webex
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  <Monitor size={10} /> Web
                </span>
              )}
              {l.has_sensitive ? (
                <span className="ml-auto text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {t('audit.sensitive', { keywords: JSON.parse(l.sensitive_keywords || '[]').join(', ') })}
                </span>
              ) : (
                <span className="ml-auto text-xs text-slate-300">正常</span>
              )}
            </div>
            {expanded === l.id && (
              <div className="px-4 pb-3 border-t border-slate-100">
                <p className="text-xs text-slate-500 mt-2 mb-1">{t('audit.conversationContent')}</p>
                <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {l.content}
                </p>
              </div>
            )}
          </div>
        ))}
        {displayedLogs.length === 0 && !loading && (
          <p className="text-center text-slate-400 py-8 text-sm">查無資料</p>
        )}
      </div>
    </div>
  )
}
