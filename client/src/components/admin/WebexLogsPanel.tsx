import { useState, useEffect } from 'react'
import { MessageSquare, RefreshCw, Download, Search, CheckCircle, XCircle, AlertTriangle, Shield } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthLog {
  id: number
  raw_email: string
  norm_email: string
  user_id: number | null
  user_name: string | null
  username: string | null
  status: 'ok' | 'not_found' | 'disabled' | 'bot_disabled'
  room_type: 'direct' | 'group'
  room_id: string
  msg_text: string | null
  created_at: string
}

interface AuditLog {
  id: number
  session_id: string
  content: string
  has_sensitive: number
  sensitive_keywords: string | null
  source: string | null
  created_at: string
  username: string
  name: string
  employee_id: string | null
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  ok:           { label: '✅ 認證成功', cls: 'bg-green-100 text-green-700',  icon: <CheckCircle size={12} /> },
  not_found:    { label: '❌ 帳號不存在', cls: 'bg-red-100 text-red-700',    icon: <XCircle size={12} /> },
  disabled:     { label: '⛔ 帳號已停用', cls: 'bg-orange-100 text-orange-700', icon: <AlertTriangle size={12} /> },
  bot_disabled: { label: '🔕 Bot 功能停用', cls: 'bg-slate-100 text-slate-600', icon: <AlertTriangle size={12} /> },
}

// ── Auth Logs Tab ─────────────────────────────────────────────────────────────

function AuthLogsTab() {
  const [logs, setLogs] = useState<AuthLog[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    status: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (filters.startDate) p.set('startDate', filters.startDate)
      if (filters.endDate) p.set('endDate', filters.endDate)
      if (filters.status) p.set('status', filters.status)
      const res = await api.get(`/admin/webex-auth-logs?${p}`)
      setLogs(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const displayed = keyword.trim()
    ? logs.filter(l =>
        l.raw_email?.toLowerCase().includes(keyword.toLowerCase()) ||
        l.user_name?.toLowerCase().includes(keyword.toLowerCase()) ||
        l.username?.toLowerCase().includes(keyword.toLowerCase())
      )
    : logs

  const exportCsv = () => {
    const header = '時間,原始Email,正規化Email,使用者姓名,帳號,結果,房間類型,訊息預覽'
    const lines = displayed.map(l => [
      fmtTW(l.created_at),
      l.raw_email,
      l.norm_email,
      l.user_name || '',
      l.username || '',
      STATUS_LABEL[l.status]?.label || l.status,
      l.room_type === 'direct' ? 'DM' : '群組',
      `"${(l.msg_text || '').replace(/"/g, '""')}"`,
    ].join(','))
    const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `webex-auth-logs-${filters.startDate}-to-${filters.endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const failCount = displayed.filter(l => l.status !== 'ok').length

  return (
    <div>
      {failCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-red-700 text-sm">
          <AlertTriangle size={16} />
          {failCount} 筆認證失敗（帳號不存在 / 停用），請確認 email 對應是否正確。
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 bg-slate-50 rounded-xl p-4">
        <div>
          <label className="label">開始日期</label>
          <input type="date" value={filters.startDate}
            onChange={e => setFilters(p => ({ ...p, startDate: e.target.value }))} className="input" />
        </div>
        <div>
          <label className="label">結束日期</label>
          <input type="date" value={filters.endDate}
            onChange={e => setFilters(p => ({ ...p, endDate: e.target.value }))} className="input" />
        </div>
        <div>
          <label className="label">結果篩選</label>
          <select value={filters.status}
            onChange={e => setFilters(p => ({ ...p, status: e.target.value }))} className="input">
            <option value="">全部</option>
            <option value="ok">✅ 認證成功</option>
            <option value="not_found">❌ 帳號不存在</option>
            <option value="disabled">⛔ 帳號已停用</option>
            <option value="bot_disabled">🔕 Bot 功能停用</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button onClick={load} className="btn-primary">查詢</button>
          <button onClick={exportCsv} disabled={displayed.length === 0} className="btn-ghost flex items-center gap-1.5">
            <Download size={14} /> 匯出 CSV
          </button>
          <button onClick={load} disabled={loading} className="btn-ghost">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
          placeholder="搜尋 email / 使用者姓名..." className="input pl-8 w-full" />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              {['時間', '原始 Email', '正規化 Email', '對應使用者', '認證結果', '房間類型', '訊息預覽'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map(l => {
              const badge = STATUS_LABEL[l.status] || { label: l.status, cls: 'bg-slate-100 text-slate-600', icon: null }
              return (
                <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtTW(l.created_at)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{l.raw_email}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{l.norm_email}</td>
                  <td className="px-4 py-2.5">
                    {l.user_name
                      ? <span>{l.user_name} <span className="text-slate-400 text-xs">({l.username})</span></span>
                      : <span className="text-slate-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${l.room_type === 'direct' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                      {l.room_type === 'direct' ? 'DM' : '群組'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">{l.msg_text || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {displayed.length === 0 && !loading && (
          <p className="text-center text-slate-400 py-8 text-sm">查無資料</p>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-2">共 {displayed.length} 筆</p>
    </div>
  )
}

// ── Webex Audit Logs Tab ──────────────────────────────────────────────────────

function WebexAuditTab() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    sensitive: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (filters.startDate) p.set('startDate', filters.startDate)
      if (filters.endDate) p.set('endDate', filters.endDate)
      if (filters.sensitive) p.set('sensitive', filters.sensitive)
      p.set('source', 'webex')
      const res = await api.get(`/admin/audit-logs?${p}`)
      setLogs(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const displayed = keyword.trim()
    ? logs.filter(l => l.content?.toLowerCase().includes(keyword.toLowerCase()))
    : logs

  const sensitiveCount = displayed.filter(l => l.has_sensitive).length

  const exportCsv = () => {
    const header = '時間,使用者,工號,是否敏感,敏感詞,對話內容'
    const lines = displayed.map(l => {
      const kws = JSON.parse(l.sensitive_keywords || '[]').join(';')
      return [
        fmtTW(l.created_at),
        l.name || l.username,
        l.employee_id || '',
        l.has_sensitive ? '是' : '否',
        kws,
        `"${(l.content || '').replace(/"/g, '""')}"`,
      ].join(',')
    })
    const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `webex-audit-${filters.startDate}-to-${filters.endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {sensitiveCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-red-700 text-sm">
          <AlertTriangle size={16} />
          {sensitiveCount} 筆包含敏感詞
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4 bg-slate-50 rounded-xl p-4">
        <div>
          <label className="label">開始日期</label>
          <input type="date" value={filters.startDate}
            onChange={e => setFilters(p => ({ ...p, startDate: e.target.value }))} className="input" />
        </div>
        <div>
          <label className="label">結束日期</label>
          <input type="date" value={filters.endDate}
            onChange={e => setFilters(p => ({ ...p, endDate: e.target.value }))} className="input" />
        </div>
        <div>
          <label className="label">類型</label>
          <select value={filters.sensitive}
            onChange={e => setFilters(p => ({ ...p, sensitive: e.target.value }))} className="input">
            <option value="">全部</option>
            <option value="1">僅敏感詞</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button onClick={load} className="btn-primary">查詢</button>
          <button onClick={exportCsv} disabled={displayed.length === 0} className="btn-ghost flex items-center gap-1.5">
            <Download size={14} /> 匯出 CSV
          </button>
          <button onClick={load} disabled={loading} className="btn-ghost">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
          placeholder="搜尋對話內容..." className="input pl-8 w-full" />
      </div>

      <div className="space-y-2">
        {displayed.map(l => (
          <div key={l.id}
            className={`bg-white border rounded-xl overflow-hidden ${l.has_sensitive ? 'border-red-200' : 'border-slate-200'}`}>
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => setExpanded(expanded === l.id ? null : l.id)}
            >
              {l.has_sensitive
                ? <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                : <Shield size={14} className="text-slate-400 flex-shrink-0" />
              }
              <span className="text-sm font-medium text-slate-700">{l.name || l.username}</span>
              {l.employee_id && <span className="text-xs text-slate-400">{l.employee_id}</span>}
              <span className="text-xs text-slate-400">{fmtTW(l.created_at)}</span>
              {l.has_sensitive
                ? <span className="ml-auto text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                    敏感詞：{JSON.parse(l.sensitive_keywords || '[]').join(', ')}
                  </span>
                : <span className="ml-auto text-xs text-slate-300">正常</span>
              }
            </div>
            {expanded === l.id && (
              <div className="px-4 pb-3 border-t border-slate-100">
                <p className="text-xs text-slate-500 mt-2 mb-1">對話內容</p>
                <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {l.content}
                </p>
              </div>
            )}
          </div>
        ))}
        {displayed.length === 0 && !loading && (
          <p className="text-center text-slate-400 py-8 text-sm">查無資料</p>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-2">共 {displayed.length} 筆</p>
    </div>
  )
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function WebexLogsPanel() {
  const [tab, setTab] = useState<'auth' | 'audit'>('auth')

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <MessageSquare size={20} className="text-green-500" />
        <h2 className="text-lg font-semibold text-slate-800">Webex Bot 日誌</h2>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6 w-fit">
        <button
          onClick={() => setTab('auth')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'auth' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          認證紀錄（Email 對應）
        </button>
        <button
          onClick={() => setTab('audit')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'audit' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          對話稽核
        </button>
      </div>

      {tab === 'auth' ? <AuthLogsTab /> : <WebexAuditTab />}
    </div>
  )
}
