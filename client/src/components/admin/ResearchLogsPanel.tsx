import { useState, useEffect, useCallback } from 'react'
import { Search, ChevronLeft, ChevronRight, Download, CheckCircle, XCircle, Loader2, Clock } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'

interface ResearchJob {
  id: string
  title: string
  question: string
  status: string
  output_formats: string
  use_web_search: number
  error_msg: string | null
  result_files_json: string | null
  created_at: string
  completed_at: string | null
  user_id: number
  username: string
  user_name: string
  employee_id: string | null
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: '等待中', color: 'text-slate-500 bg-slate-100' },
  running: { label: '進行中', color: 'text-blue-600 bg-blue-50' },
  done:    { label: '完成',   color: 'text-green-700 bg-green-50' },
  failed:  { label: '失敗',   color: 'text-red-600 bg-red-50' },
}

const PAGE_SIZE = 20

export default function ResearchLogsPanel() {
  const [jobs,    setJobs]    = useState<ResearchJob[]>([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(0)
  const [search,  setSearch]  = useState('')
  const [status,  setStatus]  = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      }
      if (search.trim()) params.search = search.trim()
      if (status) params.status = status
      const res = await api.get('/research/admin/jobs', { params })
      setJobs(res.data.jobs || [])
      setTotal(res.data.total || 0)
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [page, search, status])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">深度研究紀錄</h2>
        <span className="text-sm text-slate-500">共 {total} 筆</span>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder="搜尋標題或問題..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0) }}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">全部狀態</option>
          <option value="pending">等待中</option>
          <option value="running">進行中</option>
          <option value="done">完成</option>
          <option value="failed">失敗</option>
        </select>
        <button onClick={() => load()} className="px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition">
          重新整理
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">使用者</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">研究主題</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">狀態</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">建立時間</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">完成時間</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">
                <Loader2 size={20} className="animate-spin inline mr-2" />載入中...
              </td></tr>
            )}
            {!loading && jobs.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">無紀錄</td></tr>
            )}
            {!loading && jobs.map((j) => {
              const st = STATUS_LABEL[j.status] || { label: j.status, color: 'text-slate-500 bg-slate-100' }
              const isExpanded = expanded === j.id
              return [
                <tr key={j.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : j.id)}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{j.user_name || j.username}</p>
                    <p className="text-xs text-slate-400">{j.employee_id || j.username}</p>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="truncate text-slate-700">{j.title || '(無標題)'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
                      {j.status === 'running' && <Loader2 size={11} className="animate-spin" />}
                      {j.status === 'done'    && <CheckCircle size={11} />}
                      {j.status === 'failed'  && <XCircle size={11} />}
                      {j.status === 'pending' && <Clock size={11} />}
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtTW(j.created_at)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtTW(j.completed_at) || '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{isExpanded ? '▲' : '▼'}</td>
                </tr>,
                isExpanded && (
                  <tr key={`${j.id}-detail`} className="bg-slate-50">
                    <td colSpan={6} className="px-4 pb-4 pt-2 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-1">完整研究問題</p>
                        <p className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                          {j.question || '(無)'}
                        </p>
                      </div>
                      <div className="flex gap-4 text-xs text-slate-500">
                        <span>格式：{j.output_formats || '—'}</span>
                        <span>網路搜尋：{j.use_web_search ? '是' : '否'}</span>
                      </div>
                      {j.error_msg && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                          錯誤：{j.error_msg}
                        </div>
                      )}
                      {j.result_files_json && (() => {
                        try {
                          const files: { name: string; url: string; type: string }[] = JSON.parse(j.result_files_json)
                          return files.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {files.map((f) => (
                                <a key={f.name} href={f.url} download={f.name}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-green-300 text-green-700 text-xs rounded-lg hover:bg-green-50 transition"
                                >
                                  <Download size={12} /> {f.type.toUpperCase()} 報告
                                </a>
                              ))}
                            </div>
                          ) : null
                        } catch { return null }
                      })()}
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">第 {page + 1} / {totalPages} 頁</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition"
            >
              <ChevronLeft size={14} /> 上一頁
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition"
            >
              下一頁 <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
