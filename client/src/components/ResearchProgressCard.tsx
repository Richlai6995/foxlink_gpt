import { useState, useEffect, useCallback } from 'react'
import {
  Search, CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp, Download,
} from 'lucide-react'
import api from '../lib/api'
import { fmtTW } from '../lib/fmtTW'
import type { ResearchJob } from '../types'

interface ResearchFile { name: string; url: string; type: string }

interface Props {
  jobId: string
}

const FORMAT_LABEL: Record<string, string> = {
  docx: 'Word', pdf: 'PDF', pptx: 'PPT', xlsx: 'Excel', txt: 'TXT',
}

export default function ResearchProgressCard({ jobId }: Props) {
  const [job,      setJob]      = useState<ResearchJob | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [files,    setFiles]    = useState<ResearchFile[]>([])

  const fetchJob = useCallback(async () => {
    try {
      const res = await api.get(`/research/jobs/${jobId}`)
      const j: ResearchJob = res.data
      setJob(j)
      if (j.result_files_json) {
        try { setFiles(JSON.parse(j.result_files_json)) } catch { /* ignore */ }
      }
    } catch { /* job may have been deleted */ }
  }, [jobId])

  useEffect(() => {
    fetchJob()
  }, [fetchJob])

  // Poll while running
  useEffect(() => {
    if (!job) return
    if (job.status === 'done' || job.status === 'failed') return
    const t = setTimeout(fetchJob, 3000)
    return () => clearTimeout(t)
  }, [job, fetchJob])

  if (!job) {
    return (
      <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-400">
        <Loader2 size={15} className="animate-spin" /> 載入研究資訊...
      </div>
    )
  }

  const pct = job.progress_total > 0
    ? Math.round((job.progress_step / job.progress_total) * 100)
    : 0

  const statusColor =
    job.status === 'done'    ? 'border-green-200 bg-green-50' :
    job.status === 'failed'  ? 'border-red-200 bg-red-50'     :
    'border-blue-200 bg-blue-50'

  return (
    <div className={`border rounded-xl overflow-hidden ${statusColor}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {job.status === 'done'    && <CheckCircle size={18} className="text-green-500 flex-shrink-0" />}
        {job.status === 'failed'  && <XCircle     size={18} className="text-red-500 flex-shrink-0" />}
        {(job.status === 'pending' || job.status === 'running') &&
          <Loader2 size={18} className="text-blue-500 animate-spin flex-shrink-0" />
        }

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            <Search size={13} className="inline mr-1 text-blue-500" />
            深度研究：{job.title || '研究中...'}
          </p>

          {(job.status === 'pending' || job.status === 'running') && (
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{job.progress_label || '準備中...'}</span>
                {job.progress_total > 0 && (
                  <span>{job.progress_step}/{job.progress_total}</span>
                )}
              </div>
              <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {job.status === 'done' && (
            <p className="text-xs text-green-600 mt-0.5">
              研究完成 · {fmtTW(job.completed_at)}
              {typeof job.actual_usd === 'number' && job.actual_usd > 0 && (
                <> · 成本 ${job.actual_usd.toFixed(3)}</>
              )}
            </p>
          )}

          {job.status === 'failed' && (
            <p className="text-xs text-red-500 mt-0.5 truncate">{job.error_msg || '發生錯誤'}</p>
          )}
        </div>

        {job.status === 'done' && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-slate-400 hover:text-slate-600 flex-shrink-0"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>

      {/* Expanded: summary + download links + token usage */}
      {job.status === 'done' && expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-green-100 pt-3">
          {/* Token / cost stats */}
          {(typeof job.actual_usd === 'number' || job.tokens_by_model_json) && (() => {
            let tbm: Record<string, { in: number; out: number }> = {}
            try { tbm = JSON.parse(job.tokens_by_model_json || '{}') } catch { /* ignore */ }
            const totalIn  = Object.values(tbm).reduce((s, t) => s + (t.in  || 0), 0)
            const totalOut = Object.values(tbm).reduce((s, t) => s + (t.out || 0), 0)
            return (
              <div className="bg-white/60 border border-green-200 rounded-lg px-3 py-2 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-600">
                  <span className="font-semibold">Token 統計</span>
                  {typeof job.actual_usd === 'number' && (
                    <span className="text-green-700 font-mono">
                      ${job.actual_usd.toFixed(4)}
                      {typeof job.estimated_usd === 'number' && job.estimated_usd > 0 && (
                        <span className="text-slate-400"> / 預估 ${job.estimated_usd.toFixed(2)}</span>
                      )}
                    </span>
                  )}
                </div>
                {totalIn + totalOut > 0 && (
                  <div className="text-slate-500 font-mono">
                    in: {totalIn.toLocaleString()} · out: {totalOut.toLocaleString()} · total: {(totalIn + totalOut).toLocaleString()}
                  </div>
                )}
                {Object.entries(tbm).map(([m, t]) => (
                  <div key={m} className="text-slate-400 font-mono pl-3">
                    {m}: in {(t.in || 0).toLocaleString()} / out {(t.out || 0).toLocaleString()}
                  </div>
                ))}
              </div>
            )
          })()}

          {job.result_summary && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">摘要</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {job.result_summary.slice(0, 300)}
                {(job.result_summary?.length ?? 0) > 300 && '...'}
              </p>
            </div>
          )}

          {files.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">下載報告</p>
              <div className="flex flex-wrap gap-2">
                {files.map((f) => (
                  <a
                    key={f.name}
                    href={f.url}
                    download={f.name}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-green-300 text-green-700 text-xs rounded-lg hover:bg-green-50 transition"
                  >
                    <Download size={12} />
                    {FORMAT_LABEL[f.type] || f.type.toUpperCase()}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
