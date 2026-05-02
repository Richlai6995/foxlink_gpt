import { useState, useEffect, useMemo, Fragment } from 'react'
import { Shield, RefreshCw, Download, AlertTriangle, CheckCircle2, Search } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'
import { useTranslation } from 'react-i18next'

type AuthAuditLog = {
  id: number
  user_id: number | null
  username: string | null
  event_type: string
  ip: string | null
  user_agent: string | null
  challenge_id: string | null
  success: number | null
  error_msg: string | null
  metadata: string | null
  created_at: string
  user_name?: string | null
  user_email?: string | null
  employee_id?: string | null
}

const EVENT_LABELS: Record<string, string> = {
  login_success_internal:               '✓ 內網登入',
  login_success_external_skip_mfa:      '✓ 外網(信任 IP)',
  login_success_external_mfa:           '✓ 外網 MFA',
  login_success_external_mfa_disabled:  '✓ 外網(MFA 關閉)',
  login_failed_credentials:             '✗ 帳密錯',
  login_failed_no_email:                '✗ 無 Email',
  login_failed_account_disabled:        '✗ 帳號失效',
  mfa_challenge_created:                '→ MFA DM 已送',
  mfa_dm_failed:                        '! DM 失敗',
  mfa_webex_person_not_found:           '! Webex 找不到 Email',
  mfa_verify_failed:                    '✗ OTP 錯',
  mfa_verify_too_many:                  '! OTP 多次失敗',
  mfa_resend:                           '↻ 重發 OTP',
  mfa_rate_limited:                     '! 速率限制',
  mfa_trusted_ip_added:                 '+ 信任 IP',
  trusted_ip_revoked_password_change:   '- 改密碼清信任 IP',
}

export default function AuthAuditLogsPanel() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<AuthAuditLog[]>([])
  const [eventTypes, setEventTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    endDate:   new Date().toISOString().split('T')[0],
    eventType: '',
    ip: '',
    userSearch: '',
    success: '',
    scope: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate)   params.set('endDate',   filters.endDate)
      if (filters.eventType) params.set('eventType', filters.eventType)
      if (filters.ip.trim()) params.set('ip',        filters.ip.trim())
      if (filters.userSearch.trim()) params.set('userSearch', filters.userSearch.trim())
      if (filters.success)   params.set('success',   filters.success)
      if (filters.scope)     params.set('scope',     filters.scope)
      const res = await api.get(`/admin/auth-audit-logs?${params}`)
      setLogs(res.data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const loadEventTypes = async () => {
    try {
      const res = await api.get('/admin/auth-audit-logs/event-types')
      setEventTypes(res.data || [])
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => { load(); loadEventTypes() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const failed = logs.filter(l => l.success === 0).length
    const mfa    = logs.filter(l => l.event_type.startsWith('mfa_')).length
    const ext    = logs.filter(l => l.event_type.startsWith('login_success_external')).length
    return { total: logs.length, failed, mfa, ext }
  }, [logs])

  const exportCsv = () => {
    const header = '時間,事件,使用者,工號,Email,IP,Success,Error,Challenge,User-Agent'
    const lines = logs.map(l => [
      fmtTW(l.created_at),
      l.event_type,
      l.user_name || l.username || '',
      l.employee_id || '',
      l.user_email || '',
      l.ip || '',
      l.success === 1 ? 'Y' : (l.success === 0 ? 'N' : ''),
      `"${(l.error_msg || '').replace(/"/g, '""')}"`,
      l.challenge_id || '',
      `"${(l.user_agent || '').replace(/"/g, '""')}"`,
    ].join(','))
    const csv = '﻿' + [header, ...lines].join('\n')  // BOM for Excel UTF-8
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `auth-audit-${filters.startDate}_to_${filters.endDate}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="text-amber-500" size={20} />
          <h2 className="text-lg font-semibold">{t('admin.authAudit.title', '認證稽核 log')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {t('common.refresh', '重新整理')}
          </button>
          <button onClick={exportCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg transition">
            <Download size={14} />
            CSV
          </button>
        </div>
      </div>

      {/* 統計 */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500">總筆數</div>
          <div className="text-2xl font-bold text-slate-800">{stats.total}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500">失敗</div>
          <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500">MFA 流程</div>
          <div className="text-2xl font-bold text-blue-600">{stats.mfa}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500">外網成功</div>
          <div className="text-2xl font-bold text-emerald-600">{stats.ext}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">開始日期</span>
            <input type="date" value={filters.startDate}
                   onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                   className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">結束日期</span>
            <input type="date" value={filters.endDate}
                   onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                   className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">事件類型</span>
            <select value={filters.eventType}
                    onChange={e => setFilters({ ...filters, eventType: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="">— 全部 —</option>
              {eventTypes.map(et => (
                <option key={et} value={et}>{EVENT_LABELS[et] || et}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">範圍</span>
            <select value={filters.scope}
                    onChange={e => setFilters({ ...filters, scope: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="">— 全部 —</option>
              <option value="external">僅外網 / MFA</option>
              <option value="mfa">僅 MFA 事件</option>
              <option value="failure">僅失敗</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">IP(完整匹配)</span>
            <input type="text" value={filters.ip}
                   onChange={e => setFilters({ ...filters, ip: e.target.value })}
                   placeholder="如 1.2.3.4"
                   className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">使用者(姓名/帳號/工號/Email)</span>
            <input type="text" value={filters.userSearch}
                   onChange={e => setFilters({ ...filters, userSearch: e.target.value })}
                   className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">成功 / 失敗</span>
            <select value={filters.success}
                    onChange={e => setFilters({ ...filters, success: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="">— 不限 —</option>
              <option value="1">僅成功</option>
              <option value="0">僅失敗</option>
            </select>
          </label>
          <div className="flex items-end">
            <button onClick={load} disabled={loading}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
              <Search size={14} />
              查詢
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">時間</th>
                <th className="px-3 py-2 text-left">事件</th>
                <th className="px-3 py-2 text-left">使用者</th>
                <th className="px-3 py-2 text-left">IP</th>
                <th className="px-3 py-2 text-left">結果</th>
                <th className="px-3 py-2 text-left">錯誤訊息</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center py-6 text-slate-400">載入中...</td></tr>
              )}
              {!loading && logs.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-slate-400">無紀錄</td></tr>
              )}
              {!loading && logs.map(l => {
                const isOpen = expanded === l.id
                const eventLabel = EVENT_LABELS[l.event_type] || l.event_type
                return (
                  <Fragment key={l.id}>
                    <tr
                        className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${l.success === 0 ? 'bg-red-50/40' : ''}`}
                        onClick={() => setExpanded(isOpen ? null : l.id)}>
                      <td className="px-3 py-2 text-slate-600 font-mono text-xs">{fmtTW(l.created_at)}</td>
                      <td className="px-3 py-2">{eventLabel}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {l.user_name || l.username || '—'}
                        {l.employee_id && <span className="text-xs text-slate-400 ml-1">({l.employee_id})</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{l.ip || '—'}</td>
                      <td className="px-3 py-2">
                        {l.success === 1 && <CheckCircle2 size={14} className="text-emerald-500" />}
                        {l.success === 0 && <AlertTriangle size={14} className="text-red-500" />}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs truncate max-w-[280px]">{l.error_msg || ''}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={6} className="px-4 py-3 text-xs text-slate-700 space-y-1">
                          <div><strong>Email:</strong> {l.user_email || '—'}</div>
                          <div><strong>Challenge:</strong> <code className="font-mono">{l.challenge_id || '—'}</code></div>
                          <div><strong>User-Agent:</strong> <span className="text-slate-500">{l.user_agent || '—'}</span></div>
                          {l.metadata && (
                            <div><strong>Metadata:</strong>
                              <pre className="mt-1 bg-white border border-slate-200 rounded p-2 overflow-x-auto">
                                {(() => {
                                  try { return JSON.stringify(JSON.parse(l.metadata), null, 2) }
                                  catch { return l.metadata }
                                })()}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {logs.length === 500 && (
          <div className="px-3 py-2 text-xs text-amber-600 bg-amber-50 border-t border-amber-200">
            顯示 500 筆上限,如需更早資料請縮小日期範圍
          </div>
        )}
      </div>
    </div>
  )
}
