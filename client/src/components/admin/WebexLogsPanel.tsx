import { useState, useEffect } from 'react'
import { MessageSquare, RefreshCw, Download, Search, CheckCircle, XCircle, AlertTriangle, Shield, Ban, Plus, Trash2, Save, Scan } from 'lucide-react'
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
  status: 'ok' | 'not_found' | 'disabled' | 'bot_disabled' | 'domain_blocked'
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
  ok:             { label: '✅ 認證成功', cls: 'bg-green-100 text-green-700',  icon: <CheckCircle size={12} /> },
  not_found:      { label: '❌ 帳號不存在', cls: 'bg-red-100 text-red-700',    icon: <XCircle size={12} /> },
  disabled:       { label: '⛔ 帳號已停用', cls: 'bg-orange-100 text-orange-700', icon: <AlertTriangle size={12} /> },
  bot_disabled:   { label: '🔕 Bot 功能停用', cls: 'bg-slate-100 text-slate-600', icon: <AlertTriangle size={12} /> },
  domain_blocked: { label: '🚫 Domain 未授權', cls: 'bg-rose-100 text-rose-700', icon: <Ban size={12} /> },
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
            <option value="domain_blocked">🚫 Domain 未授權</option>
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

// ── Domain 白名單 Tab ─────────────────────────────────────────────────────────

function DomainWhitelistTab() {
  const [domains, setDomains] = useState<string[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin/webex-allowed-domains')
      setDomains(res.data.domains || [])
      setDirty(false)
    } catch (e: any) {
      setMsg({ type: 'err', text: '載入失敗：' + (e.response?.data?.error || e.message) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const addDomain = () => {
    const d = newDomain.trim().toLowerCase().replace(/^@+/, '')
    if (!d) return
    if (!DOMAIN_RE.test(d)) {
      setMsg({ type: 'err', text: `格式錯誤：${d}（正確範例：foxlink.com.tw）` })
      return
    }
    if (domains.includes(d)) {
      setMsg({ type: 'err', text: `已存在：${d}` })
      return
    }
    setDomains([...domains, d])
    setNewDomain('')
    setDirty(true)
    setMsg(null)
  }

  const removeDomain = (d: string) => {
    setDomains(domains.filter(x => x !== d))
    setDirty(true)
    setMsg(null)
  }

  const rescan = async () => {
    if (dirty) {
      if (!confirm('目前有未儲存的變更，重新掃描會先讀取 DB 最新白名單覆蓋本地變更，確定嗎？')) return
    }
    setScanning(true)
    try {
      const res = await api.post('/admin/webex-allowed-domains/rescan')
      const { added = [], total = 0 } = res.data || {}
      if (added.length === 0) {
        setMsg({ type: 'ok', text: `掃描完成，沒有新 domain（白名單共 ${total} 筆）` })
      } else {
        setMsg({ type: 'ok', text: `掃描完成，新增 ${added.length} 筆：${added.join(', ')}（白名單共 ${total} 筆）` })
      }
      await load()
    } catch (e: any) {
      setMsg({ type: 'err', text: '掃描失敗：' + (e.response?.data?.error || e.message) })
    } finally {
      setScanning(false)
    }
  }

  const save = async () => {
    if (domains.length === 0) {
      if (!confirm('白名單為空，將拒絕所有 Webex Bot 來源，確定嗎？')) return
    }
    setSaving(true)
    try {
      const res = await api.put('/admin/webex-allowed-domains', { domains })
      setDomains(res.data.domains || [])
      setDirty(false)
      setMsg({ type: 'ok', text: '已儲存' })
    } catch (e: any) {
      setMsg({ type: 'err', text: '儲存失敗：' + (e.response?.data?.error || e.message) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-800">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium mb-1">Domain 白名單機制</p>
            <ul className="list-disc pl-5 space-y-0.5 text-xs">
              <li>只有白名單 domain 的 email 才能通過 Webex Bot 認證，防止私人 Webex 帳號冒用。</li>
              <li><b>精確比對</b>：<code>foxlink.com.tw</code> 和 <code>foxlink.com</code> 需各自加入（不涵蓋子網域）。</li>
              <li><b>空白名單 = 全部拒絕</b>。清空後所有 Webex 訊息都會被擋。</li>
              <li>被擋的訊息會記錄在「認證紀錄」分頁，狀態為「🚫 Domain 未授權」。</li>
              <li><b>重啟自動掃描</b>：每次 server 重啟會自動掃描 users.email 的 domain 併入白名單（只加不刪，admin 手動加的保留；但 admin 移除的下次重啟會被補回）。</li>
            </ul>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`rounded-xl p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      <div className="bg-slate-50 rounded-xl p-4 mb-4">
        <label className="label">新增 Domain</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={newDomain}
            onChange={e => setNewDomain(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addDomain() }}
            placeholder="例如：foxlink.com.tw"
            className="input flex-1"
          />
          <button onClick={addDomain} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> 加入
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-1.5">格式：<code>domain.tld</code>，可省略 <code>@</code> 前綴</p>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
        <div className="bg-slate-100 px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-600">已授權 Domain（{domains.length}）</span>
          <button onClick={load} disabled={loading} className="btn-ghost text-xs">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {domains.length === 0 ? (
          <p className="text-center text-slate-400 py-8 text-sm">尚無授權 domain（目前會拒絕所有 Webex 訊息）</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {domains.map(d => (
              <li key={d} className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50">
                <span className="font-mono text-sm">@{d}</span>
                <button
                  onClick={() => removeDomain(d)}
                  className="text-red-500 hover:text-red-700 text-xs flex items-center gap-1"
                  title="移除"
                >
                  <Trash2 size={13} /> 移除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="btn-primary flex items-center gap-1.5"
        >
          <Save size={14} /> {saving ? '儲存中...' : '儲存變更'}
        </button>
        <button
          onClick={rescan}
          disabled={scanning}
          className="btn-ghost flex items-center gap-1.5"
          title="立即掃描 users.email 併入白名單（等同重啟時的行為）"
        >
          <Scan size={14} className={scanning ? 'animate-pulse' : ''} />
          {scanning ? '掃描中...' : '立即重新掃描'}
        </button>
        {dirty && <span className="text-xs text-amber-600">有未儲存的變更</span>}
      </div>
    </div>
  )
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function WebexLogsPanel() {
  const [tab, setTab] = useState<'auth' | 'audit' | 'domains'>('auth')

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
        <button
          onClick={() => setTab('domains')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'domains' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Domain 白名單
        </button>
      </div>

      {tab === 'auth' && <AuthLogsTab />}
      {tab === 'audit' && <WebexAuditTab />}
      {tab === 'domains' && <DomainWhitelistTab />}
    </div>
  )
}
