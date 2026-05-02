import { useState, useEffect } from 'react'
import { Ban, Plus, RefreshCw, Trash2, AlertCircle } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'
import { useTranslation } from 'react-i18next'

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
                <tr><td colSpan={7} className="text-center py-6 text-slate-400">載入中...</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-6 text-slate-400">無紀錄</td></tr>
              )}
              {!loading && rows.map(r => {
                const expired = isExpired(r.expires_at)
                return (
                  <tr key={r.id} className={`border-t border-slate-100 hover:bg-slate-50 ${expired ? 'opacity-50' : ''}`}>
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
