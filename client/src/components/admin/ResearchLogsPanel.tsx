import { useState, useEffect, useCallback } from 'react'
import { Search, ChevronLeft, ChevronRight, Download, CheckCircle, XCircle, Loader2, Clock, Settings } from 'lucide-react'
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
  actual_usd: number | null
  estimated_usd: number | null
  tokens_by_model_json: string | null
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
      <ResearchSettingsSection />
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
                      <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
                        <span>格式：{j.output_formats || '—'}</span>
                        <span>網路搜尋：{j.use_web_search ? '是' : '否'}</span>
                        {typeof j.actual_usd === 'number' && j.actual_usd > 0 && (
                          <span className="font-mono text-slate-700">
                            成本 ${j.actual_usd.toFixed(4)}
                            {typeof j.estimated_usd === 'number' && j.estimated_usd > 0 && (
                              <span className="text-slate-400"> / 預估 ${j.estimated_usd.toFixed(2)}</span>
                            )}
                          </span>
                        )}
                      </div>
                      {j.tokens_by_model_json && (() => {
                        let tbm: Record<string, { in: number; out: number }> = {}
                        try { tbm = JSON.parse(j.tokens_by_model_json) } catch { return null }
                        const entries = Object.entries(tbm)
                        if (entries.length === 0) return null
                        const totalIn  = entries.reduce((s, [, t]) => s + (t?.in  || 0), 0)
                        const totalOut = entries.reduce((s, [, t]) => s + (t?.out || 0), 0)
                        return (
                          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs space-y-0.5">
                            <p className="font-semibold text-slate-600 mb-1">Token 統計</p>
                            <p className="font-mono text-slate-500">
                              total: in {totalIn.toLocaleString()} · out {totalOut.toLocaleString()} · 共 {(totalIn + totalOut).toLocaleString()}
                            </p>
                            {entries.map(([m, t]) => (
                              <p key={m} className="font-mono text-slate-400 pl-3">
                                {m}: in {(t?.in || 0).toLocaleString()} / out {(t?.out || 0).toLocaleString()}
                              </p>
                            ))}
                          </div>
                        )
                      })()}
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

// ─── Research 設定 Section ─────────────────────────────────────────────────
interface LlmModelOpt {
  key: string
  name: string
  api_model: string
  provider_type?: string
  image_output?: number
  is_active?: number
}

function ResearchSettingsSection() {
  const [models, setModels] = useState<LlmModelOpt[]>([])
  const [modelKey, setModelKey] = useState<string>('')
  const [effort, setEffort]     = useState<string>('high')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [err, setErr]           = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/admin/llm-models').then((r) => r.data as LlmModelOpt[]),
      api.get('/admin/settings/research').then((r) => r.data),
    ]).then(([ms, cfg]) => {
      const usable = ms.filter((m) => m.is_active && !m.image_output && m.provider_type === 'gemini')
      setModels(usable)
      setModelKey(cfg.model_key || '')
      setEffort(cfg.reasoning_effort || 'high')
    }).catch((e) => setErr(e.response?.data?.error || '載入設定失敗'))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false)
    try {
      await api.put('/admin/settings/research', {
        model_key: modelKey || null,
        reasoning_effort: effort || '',
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setErr(e.response?.data?.error || '儲存失敗')
    } finally { setSaving(false) }
  }

  if (loading) return null

  return (
    <details className="bg-white rounded-xl border border-slate-200 p-4" open>
      <summary className="cursor-pointer text-sm font-semibold text-slate-700 flex items-center gap-2">
        <Settings size={14} className="text-teal-500" />
        深度研究設定
        <span className="text-[11px] font-normal text-slate-400 ml-2">
          (model · 思考深度)
        </span>
      </summary>
      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">使用模型</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
            >
              <option value="">（使用預設 env GEMINI_MODEL_PRO）</option>
              {models.map((m) => (
                <option key={m.key} value={m.key}>{m.name} — {m.api_model}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">建議選高精度 model (e.g. Gemini 3.1 Pro)。</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">思考深度 (reasoning effort)</label>
            <div className="grid grid-cols-4 gap-1">
              {[
                { v: '', label: 'Default' },
                { v: 'low', label: 'Low' },
                { v: 'medium', label: 'Medium' },
                { v: 'high', label: 'High' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setEffort(opt.v)}
                  className={`text-xs py-1.5 rounded border transition ${
                    effort === opt.v
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Low=2048 / Medium=8192 / High=24576 thinking tokens。深度研究建議 <b>High</b>。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {saving ? '儲存中…' : '儲存設定'}
          </button>
          {saved && <span className="text-xs text-green-600">已儲存 ✓</span>}
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      </div>
    </details>
  )
}
