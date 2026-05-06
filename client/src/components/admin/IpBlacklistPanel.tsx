import { useState, useEffect, Fragment } from 'react'
import { Ban, Plus, RefreshCw, Trash2, AlertCircle, ChevronRight, ChevronDown, ShieldCheck, ShieldAlert, User as UserIcon } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'
import { useTranslation } from 'react-i18next'

type DetailsByUsername = {
  username: string | null
  user_db_id: number | null
  user_real_name: string | null
  user_role: string | null
  user_status: string | null
  attempt_count: number
  success_count: number
  first_attempt_at: string
  last_attempt_at: string
  event_types: string | null
}
type DetailsRecent = {
  id: number
  user_id: number | null
  username: string | null
  event_type: string
  success: number
  error_msg: string | null
  user_agent: string | null
  challenge_id: string | null
  metadata: string | null
  created_at: string
}
type Details = {
  ip: string
  window_hours: number
  summary: {
    total_attempts: number
    total_failures: number
    total_success: number
    distinct_usernames: number
    known_users: number
    unknown_users: number
  }
  by_username: DetailsByUsername[]
  recent_events: DetailsRecent[]
}

type BlacklistEntry = {
  id: number
  ip: string
  reason: string | null
  source: string  // manual / auto_failure / auto_ua
  created_by: number | null
  created_by_username: string | null
  created_by_name: string | null
  created_at: string
  expires_at: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  manual:       '手動',
  auto_failure: '自動 — 失敗達閾值',
  auto_ua:      '自動 — UA 命中',
}
const SOURCE_COLORS: Record<string, string> = {
  manual:       'bg-blue-100 text-blue-700',
  auto_failure: 'bg-red-100 text-red-700',
  auto_ua:      'bg-orange-100 text-orange-700',
}

export default function IpBlacklistPanel() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<BlacklistEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [activeOnly, setActiveOnly] = useState(true)
  const [source, setSource] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newIp, setNewIp] = useState('')
  const [newReason, setNewReason] = useState('')
  const [newTtl, setNewTtl] = useState('')  // 空 = 永久,否則小時數
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  // Details expansion(per ip)
  const [expandedIp, setExpandedIp] = useState<string | null>(null)
  const [detailsCache, setDetailsCache] = useState<Record<string, Details>>({})
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null)
  const [detailsHours, setDetailsHours] = useState(24)

  const toggleExpand = async (ip: string) => {
    if (expandedIp === ip) { setExpandedIp(null); return }
    setExpandedIp(ip)
    if (!detailsCache[ip]) {
      setLoadingDetails(ip)
      try {
        const res = await api.get(`/admin/ip-blacklist/${encodeURIComponent(ip)}/details?hours=${detailsHours}`)
        setDetailsCache(prev => ({ ...prev, [ip]: res.data }))
      } catch (e: any) {
        console.error('details load failed', e)
      } finally {
        setLoadingDetails(null)
      }
    }
  }

  const reloadDetails = async (ip: string) => {
    setLoadingDetails(ip)
    try {
      const res = await api.get(`/admin/ip-blacklist/${encodeURIComponent(ip)}/details?hours=${detailsHours}`)
      setDetailsCache(prev => ({ ...prev, [ip]: res.data }))
    } finally {
      setLoadingDetails(null)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeOnly) params.set('activeOnly', '1')
      if (source) params.set('source', source)
      const res = await api.get(`/admin/ip-blacklist?${params}`)
      setRows(res.data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [activeOnly, source]) // eslint-disable-line

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setAdding(true)
    try {
      await api.post('/admin/ip-blacklist', {
        ip: newIp.trim(),
        reason: newReason.trim() || null,
        ttlHours: newTtl.trim() ? Number(newTtl) : null,
      })
      setNewIp(''); setNewReason(''); setNewTtl('')
      setShowAdd(false)
      load()
    } catch (e: any) {
      setErr(e?.response?.data?.error || '新增失敗')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (ip: string) => {
    if (!confirm(`確認從黑名單移除 ${ip}?`)) return
    try {
      await api.delete(`/admin/ip-blacklist/${encodeURIComponent(ip)}`)
      load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '移除失敗')
    }
  }

  const isExpired = (expiresAt: string | null) =>
    expiresAt && new Date(expiresAt) <= new Date()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ban className="text-red-500" size={20} />
          <h2 className="text-lg font-semibold">{t('admin.ipBlacklist.title', 'IP 黑名單')}</h2>
          <span className="text-xs text-slate-400">
            {t('admin.ipBlacklist.subtitle', '外網 anti-bot,內網 IP 不會被擋')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {t('common.refresh', '重新整理')}
          </button>
          <button onClick={() => setShowAdd(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">
            <Plus size={14} />
            手動新增
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={activeOnly}
                 onChange={e => setActiveOnly(e.target.checked)} />
          只顯示生效中
        </label>
        <label className="text-sm flex items-center gap-2">
          來源:
          <select value={source} onChange={e => setSource(e.target.value)}
                  className="border border-slate-300 rounded px-2 py-1 text-sm">
            <option value="">— 全部 —</option>
            <option value="manual">手動</option>
            <option value="auto_failure">自動 — 失敗達閾值</option>
            <option value="auto_ua">自動 — UA 命中</option>
          </select>
        </label>
        <span className="text-xs text-slate-400 ml-auto">{rows.length} 筆</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left w-6"></th>
                <th className="px-3 py-2 text-left">IP</th>
                <th className="px-3 py-2 text-left">來源</th>
                <th className="px-3 py-2 text-left">原因</th>
                <th className="px-3 py-2 text-left">建立人</th>
                <th className="px-3 py-2 text-left">建立時間</th>
                <th className="px-3 py-2 text-left">到期</th>
                <th className="px-3 py-2 text-right">動作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center py-6 text-slate-400">載入中...</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="text-center py-6 text-slate-400">無紀錄</td></tr>
              )}
              {!loading && rows.map(r => {
                const expired = isExpired(r.expires_at)
                const isExpanded = expandedIp === r.ip
                const details = detailsCache[r.ip]
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-t border-slate-100 hover:bg-slate-50 ${expired ? 'opacity-50' : ''}`}>
                      <td className="px-2 py-2">
                        <button onClick={() => toggleExpand(r.ip)}
                                className="text-slate-500 hover:text-blue-600"
                                title={isExpanded ? '收起' : '查看登入嘗試詳情'}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.ip}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded ${SOURCE_COLORS[r.source] || 'bg-slate-100 text-slate-600'}`}>
                          {SOURCE_LABELS[r.source] || r.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 text-xs max-w-md truncate" title={r.reason || ''}>{r.reason || '—'}</td>
                      <td className="px-3 py-2 text-slate-700 text-xs">
                        {r.created_by ? (r.created_by_name || r.created_by_username || `id=${r.created_by}`) : <span className="text-slate-400">系統</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600 font-mono text-xs">{fmtTW(r.created_at)}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.expires_at
                          ? <span className={expired ? 'text-slate-400' : 'text-slate-600'}>
                              {fmtTW(r.expires_at)} {expired && '(已過期)'}
                            </span>
                          : <span className="text-red-600 font-medium">永久</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => handleRemove(r.ip)}
                                className="text-red-600 hover:text-red-800 text-xs flex items-center gap-1 ml-auto">
                          <Trash2 size={12} />
                          移除
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50 border-t border-slate-100">
                        <td colSpan={8} className="px-4 py-3">
                          {loadingDetails === r.ip && !details ? (
                            <div className="text-slate-500 text-xs py-2">載入中...</div>
                          ) : details ? (
                            <DetailsView
                              details={details}
                              hours={detailsHours}
                              onChangeHours={(h) => { setDetailsHours(h); reloadDetails(r.ip) }}
                              onReload={() => reloadDetails(r.ip)}
                              loading={loadingDetails === r.ip}
                            />
                          ) : (
                            <div className="text-slate-500 text-xs">無資料</div>
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
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">手動新增 IP 黑名單</h3>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">IP</label>
                <input type="text" value={newIp} onChange={e => setNewIp(e.target.value)}
                       placeholder="如 1.2.3.4"
                       required
                       className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">原因(選填)</label>
                <input type="text" value={newReason} onChange={e => setNewReason(e.target.value)}
                       placeholder="如 滲透測試 / 已通報"
                       className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">有效時間(小時,留空 = 永久)</label>
                <input type="number" value={newTtl} onChange={e => setNewTtl(e.target.value)}
                       placeholder="24"
                       min="1"
                       className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              {err && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-sm">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {err}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setShowAdd(false); setErr('') }}
                        className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition">
                  取消
                </button>
                <button type="submit" disabled={adding}
                        className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition">
                  {adding ? '新增中...' : '新增'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Details 子元件:某 IP 過去 N 小時的登入嘗試詳情 ─────────────────

const EVENT_LABELS: Record<string, string> = {
  login_success_internal: '✓ 成功(內網)',
  login_success_external_mfa: '✓ 成功(MFA)',
  login_success_external_skip_mfa: '✓ 成功(信任 IP)',
  login_success_external_skip_mfa_device: '✓ 成功(信任裝置)',
  login_success_external_mfa_disabled: '✓ 成功(MFA 關閉)',
  login_failed_credentials: '✗ 帳密錯誤',
  login_failed_no_email: '✗ 無 Email',
  login_failed_admin_external: '✗ admin 外網',
  login_failed_account_disabled: '✗ 帳號停用',
  mfa_challenge_created: 'MFA 發送 OTP',
  mfa_dm_failed: 'MFA DM 失敗',
  mfa_webex_person_not_found: 'MFA 找不到 Webex',
  mfa_verify_failed: 'MFA 驗證錯',
  mfa_verify_too_many: 'MFA 5 次錯',
  mfa_resend: 'MFA 重發',
  mfa_rate_limited: 'MFA 限流',
  mfa_trusted_ip_added: '加信任 IP',
  mfa_trusted_device_added: '加信任裝置',
  device_revoked_user: '使用者移除裝置',
  device_revoked_admin: 'admin 移除裝置',
  trusted_ip_revoked_password_change: '改密碼清空',
  forgot_password_rate_limited: 'forgot 限流',
}

function DetailsView({
  details, hours, onChangeHours, onReload, loading,
}: {
  details: Details
  hours: number
  onChangeHours: (h: number) => void
  onReload: () => void
  loading: boolean
}) {
  const s = details.summary
  // 判斷恢復建議:
  //   有任何 user_db_id != null 命中 admin role → 顯示「⚠️ 試 admin 帳號 = 攻擊」
  //   distinct_usernames > 5 且全部 unknown → bot scan
  //   distinct_usernames === 1 且 known → 員工誤觸機率高
  const triedAdminAccount = details.by_username.some(u => u.user_role === 'admin')
  const isBotScan         = s.distinct_usernames > 5 && s.known_users === 0
  const isLikelyEmployee  = s.distinct_usernames === 1 && s.known_users === 1

  return (
    <div className="space-y-3">
      {/* Summary + 判斷建議 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <span className="text-slate-500">過去</span>
          <select value={hours} onChange={e => onChangeHours(Number(e.target.value))}
                  className="border border-slate-300 rounded px-2 py-1">
            <option value={1}>1 小時</option>
            <option value={6}>6 小時</option>
            <option value={24}>24 小時</option>
            <option value={72}>3 天</option>
            <option value={168}>7 天</option>
          </select>
          <button onClick={onReload} disabled={loading}
                  className="text-blue-600 hover:text-blue-800 disabled:opacity-50">
            <RefreshCw size={12} className={`inline ${loading ? 'animate-spin' : ''}`} /> 重新載入
          </button>
        </div>
        <div className="text-xs text-slate-600 flex gap-3 flex-wrap">
          <span>嘗試 <strong>{s.total_attempts}</strong> 次</span>
          <span className="text-red-600">失敗 <strong>{s.total_failures}</strong></span>
          <span className="text-emerald-600">成功 <strong>{s.total_success}</strong></span>
          <span>用了 <strong>{s.distinct_usernames}</strong> 個帳號</span>
          <span className="text-emerald-700">已知 {s.known_users}</span>
          <span className="text-red-600">不存在 {s.unknown_users}</span>
        </div>
      </div>

      {/* 判斷建議 banner */}
      {(triedAdminAccount || isBotScan || isLikelyEmployee) && (
        <div className={`rounded-lg p-2.5 text-xs flex items-start gap-2 ${
          triedAdminAccount || isBotScan ? 'bg-red-50 border border-red-200 text-red-700'
            : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
        }`}>
          {triedAdminAccount || isBotScan
            ? <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            : <ShieldCheck size={14} className="mt-0.5 shrink-0" />}
          <div>
            {triedAdminAccount && <div><strong>⚠️ 試過 admin 帳號</strong> — 高度可疑,**強烈不建議恢復**</div>}
            {isBotScan && <div><strong>⚠️ 用 {s.distinct_usernames} 個不存在帳號掃描</strong> — bot 攻擊特徵,**不建議恢復**</div>}
            {isLikelyEmployee && !triedAdminAccount && !isBotScan && (
              <div><strong>✓ 只試一個已知員工帳號</strong> — 員工誤觸密碼機率高,可考慮恢復後通知該員工。
                建議跟員工確認後再移除。</div>
            )}
          </div>
        </div>
      )}

      {/* Per-username 表 */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-2 py-1.5 text-left">嘗試帳號</th>
              <th className="px-2 py-1.5 text-left">員工資訊</th>
              <th className="px-2 py-1.5 text-right">次數</th>
              <th className="px-2 py-1.5 text-left">事件</th>
              <th className="px-2 py-1.5 text-left">最後一次</th>
            </tr>
          </thead>
          <tbody>
            {details.by_username.length === 0 && (
              <tr><td colSpan={5} className="text-center py-3 text-slate-400">無紀錄</td></tr>
            )}
            {details.by_username.map((u, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-2 py-1.5 font-mono">
                  {u.username || <span className="text-slate-400">(空)</span>}
                  {u.user_db_id == null && u.username && (
                    <span className="ml-1 text-[10px] text-red-500">(不存在)</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {u.user_db_id ? (
                    <span className="flex items-center gap-1 text-emerald-700">
                      <UserIcon size={11} />
                      {u.user_real_name || '(無名)'}
                      {u.user_role === 'admin' && (
                        <span className="text-[10px] bg-red-100 text-red-700 px-1 rounded">admin</span>
                      )}
                      {u.user_status && u.user_status !== 'active' && (
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-1 rounded">{u.user_status}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-400 italic">— 系統內無此帳號</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  <span className="text-red-600">{Number(u.attempt_count) - Number(u.success_count)}</span>
                  {Number(u.success_count) > 0 && (
                    <span className="text-emerald-600 ml-1">+{u.success_count}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-slate-600 text-[11px] max-w-[200px] truncate" title={u.event_types || ''}>
                  {(u.event_types || '').split(',').map(e => e.trim()).filter(Boolean)
                    .map(e => EVENT_LABELS[e] || e).join(' · ')}
                </td>
                <td className="px-2 py-1.5 font-mono text-slate-600 text-[11px]">{fmtTW(u.last_attempt_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent timeline(最近 50 筆,折疊用 details) */}
      <details className="bg-white border border-slate-200 rounded-lg">
        <summary className="px-3 py-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50">
          📜 最近事件時間軸({details.recent_events.length} 筆,含 User-Agent)
        </summary>
        <div className="border-t border-slate-100 max-h-72 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-slate-600">
                <th className="px-2 py-1 text-left">時間</th>
                <th className="px-2 py-1 text-left">帳號</th>
                <th className="px-2 py-1 text-left">事件</th>
                <th className="px-2 py-1 text-left">UA</th>
              </tr>
            </thead>
            <tbody>
              {details.recent_events.map(e => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-mono text-slate-600">{fmtTW(e.created_at)}</td>
                  <td className="px-2 py-1 font-mono">{e.username || '—'}</td>
                  <td className={`px-2 py-1 ${e.success ? 'text-emerald-700' : 'text-red-600'}`}>
                    {EVENT_LABELS[e.event_type] || e.event_type}
                    {e.error_msg && <span className="text-slate-500 ml-1">({e.error_msg})</span>}
                  </td>
                  <td className="px-2 py-1 text-slate-500 max-w-[300px] truncate" title={e.user_agent || ''}>
                    {e.user_agent || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
