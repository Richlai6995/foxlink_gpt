import { useState, useEffect } from 'react'
import { BookOpen, Check, X, Clock, Globe, Lock, RefreshCw, FileText, Layers } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'

interface KbRequest {
  id: string
  name: string
  description: string | null
  public_status: string
  is_public: number
  chunk_count: number
  doc_count: number
  total_size_bytes: number
  created_at: string
  updated_at: string
  creator_username: string
  creator_name: string
  creator_emp: string | null
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function KbAdminPanel() {
  const [rows, setRows] = useState<KbRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'public' | 'private'>('pending')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const q = filter !== 'all' ? `?status=${filter}` : ''
      const res = await api.get(`/admin/kb-public-requests${q}`)
      setRows(Array.isArray(res.data) ? res.data : [])
    } catch (e: any) {
      setMsg(e.response?.data?.error || '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filter])

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id + action)
    setMsg('')
    try {
      await api.put(`/admin/kb-public-requests/${id}`, { action })
      setMsg(action === 'approve' ? '已核准公開' : '已退回為私有')
      load()
    } catch (e: any) {
      setMsg(e.response?.data?.error || '操作失敗')
    } finally {
      setBusy(null)
    }
  }

  const statusBadge = (status: string, isPublic: number) => {
    if (isPublic === 1 || status === 'public')
      return <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium"><Globe size={10} />已公開</span>
    if (status === 'pending')
      return <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-medium"><Clock size={10} />審核中</span>
    return <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full font-medium"><Lock size={10} />私有</span>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800">知識庫管理</h2>
        <div className="flex gap-2 items-center">
          {msg && <span className="text-xs text-blue-600">{msg}</span>}
          <button onClick={load} className="btn-ghost flex items-center gap-1.5 text-sm">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新整理
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
        {(['pending', 'all', 'public', 'private'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${filter === f ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {f === 'pending' ? '待審核' : f === 'all' ? '全部' : f === 'public' ? '已公開' : '私有'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">載入中...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl">
          <BookOpen size={32} className="mx-auto mb-2 text-slate-300" />
          <p className="text-slate-400 text-sm">{filter === 'pending' ? '目前沒有待審核的申請' : '查無資料'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">知識庫名稱</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">建立者</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">狀態</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">文件 / 分塊</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">大小</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">更新時間</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{r.name}</div>
                      {r.description && (
                        <div className="text-xs text-slate-400 max-w-xs truncate">{r.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{r.creator_name}</div>
                      <div className="text-xs text-slate-400">{r.creator_username}{r.creator_emp ? ` · ${r.creator_emp}` : ''}</div>
                    </td>
                    <td className="px-4 py-3">{statusBadge(r.public_status, r.is_public)}</td>
                    <td className="px-4 py-3 text-slate-500">
                      <span className="flex items-center gap-2">
                        <span className="flex items-center gap-1"><FileText size={11} />{r.doc_count}</span>
                        <span className="flex items-center gap-1"><Layers size={11} />{r.chunk_count}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatBytes(r.total_size_bytes)}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmtTW(r.updated_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {r.public_status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleAction(r.id, 'approve')}
                              disabled={!!busy}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                            >
                              <Check size={12} /> 核准
                            </button>
                            <button
                              onClick={() => handleAction(r.id, 'reject')}
                              disabled={!!busy}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition disabled:opacity-50"
                            >
                              <X size={12} /> 退回
                            </button>
                          </>
                        )}
                        {r.public_status === 'public' && (
                          <button
                            onClick={() => handleAction(r.id, 'reject')}
                            disabled={!!busy}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition disabled:opacity-50"
                          >
                            <Lock size={12} /> 撤回公開
                          </button>
                        )}
                        {(r.public_status === 'private' || !r.public_status) && (
                          <button
                            onClick={() => handleAction(r.id, 'approve')}
                            disabled={!!busy}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition disabled:opacity-50"
                          >
                            <Globe size={12} /> 強制公開
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
