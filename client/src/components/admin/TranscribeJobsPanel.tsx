import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, Loader2, Clock, RefreshCw, Mic, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'

interface TranscribeJob {
  id: string
  user_id: number
  session_id?: string
  audio_filename: string
  audio_size_mb?: number
  duration_sec?: number
  status: 'pending' | 'running' | 'done' | 'failed'
  segment_total: number
  segment_done: number
  transcript_chars?: number
  transcript_file?: string
  transcript_url?: string
  in_tokens_total?: number
  out_tokens_total?: number
  error_msg?: string
  recovery_count?: number
  created_at?: string
  completed_at?: string
  segments?: { idx: number; ok: boolean; marker?: string; attempts?: number; chars?: number; error?: string }[]
}

const STATUS_LABEL: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '等待中', color: 'text-slate-500 bg-slate-100', icon: <Clock size={11} /> },
  running: { label: '進行中', color: 'text-blue-600 bg-blue-50',  icon: <Loader2 size={11} className="animate-spin" /> },
  done:    { label: '完成',   color: 'text-green-700 bg-green-50', icon: <CheckCircle size={11} /> },
  failed:  { label: '失敗',   color: 'text-red-600 bg-red-50',     icon: <XCircle size={11} /> },
}

function _fmtDur(sec?: number): string {
  if (!sec || sec <= 0) return '-'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

export default function TranscribeJobsPanel() {
  const [jobs, setJobs] = useState<TranscribeJob[]>([])
  const [status, setStatus] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState<string | null>(null)

  const rerunSeg = async (jobId: string, segIdx: number) => {
    if (!confirm(`確定重轉第 ${segIdx + 1} 段?\n會重新切片、只重轉這一段,完成後更新逐字稿(其他段不動)。`)) return
    setRerunning(`${jobId}-${segIdx}`)
    try {
      await api.post(`/transcribe/jobs/${jobId}/rerun-segment`, { segIdx })
      await load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '重轉失敗')
    } finally {
      setRerunning(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { limit: '200' }
      if (status) params.status = status
      const res = await api.get('/transcribe/admin/jobs', { params })
      setJobs(res.data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])

  const counts = {
    all: jobs.length,
    pending: jobs.filter(j => j.status === 'pending').length,
    running: jobs.filter(j => j.status === 'running').length,
    done: jobs.filter(j => j.status === 'done').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Mic size={18} className="text-blue-500" />
          長音訊轉錄 Jobs
        </h2>
        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          重新載入
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: '',         label: `全部 (${counts.all})` },
          { id: 'pending',  label: `等待中 (${counts.pending})` },
          { id: 'running',  label: `進行中 (${counts.running})` },
          { id: 'done',     label: `完成 (${counts.done})` },
          { id: 'failed',   label: `失敗 (${counts.failed})` },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => setStatus(s.id)}
            className={`px-3 py-1 text-xs rounded-full border transition ${
              status === s.id
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Jobs table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="text-left px-4 py-2 font-medium">User</th>
              <th className="text-left px-4 py-2 font-medium">音訊檔</th>
              <th className="text-left px-4 py-2 font-medium">大小/時長</th>
              <th className="text-left px-4 py-2 font-medium">狀態</th>
              <th className="text-left px-4 py-2 font-medium">進度</th>
              <th className="text-left px-4 py-2 font-medium">字數</th>
              <th className="text-left px-4 py-2 font-medium">Token (in/out)</th>
              <th className="text-left px-4 py-2 font-medium">建立</th>
              <th className="px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center px-4 py-8 text-slate-400 text-sm">
                  {loading ? '載入中...' : '尚無資料'}
                </td>
              </tr>
            ) : (
              jobs.map(j => {
                const s = STATUS_LABEL[j.status] || { label: j.status, color: 'text-slate-500 bg-slate-100', icon: null }
                const pct = j.segment_total > 0 ? Math.round((j.segment_done / j.segment_total) * 100) : 0
                const isExpanded = expanded === j.id
                return (
                  <>
                    <tr key={j.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-700">user#{j.user_id}</td>
                      <td className="px-4 py-2 text-slate-700 truncate max-w-[200px]" title={j.audio_filename}>{j.audio_filename}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">
                        {j.audio_size_mb ? `${j.audio_size_mb.toFixed(1)}MB` : '-'} / {_fmtDur(j.duration_sec)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${s.color}`}>
                          {s.icon}
                          {s.label}
                          {(j.recovery_count || 0) > 0 && (
                            <span className="ml-1 text-amber-600">·R{j.recovery_count}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">
                        {j.segment_total > 0 ? `${j.segment_done}/${j.segment_total} (${pct}%)` : '-'}
                      </td>
                      <td className="px-4 py-2 text-slate-500 text-xs">
                        {(j.transcript_chars || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-slate-400 text-xs font-mono">
                        {(j.in_tokens_total || 0).toLocaleString()}/{(j.out_tokens_total || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{fmtTW(j.created_at)}</td>
                      <td className="px-2">
                        <button
                          onClick={() => setExpanded(isExpanded ? null : j.id)}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${j.id}-expand`} className="bg-slate-50">
                        <td colSpan={9} className="px-4 py-3 text-xs space-y-1">
                          <div><span className="text-slate-400">Job ID:</span> <span className="font-mono">{j.id}</span></div>
                          {j.session_id && <div><span className="text-slate-400">Session:</span> <span className="font-mono">{j.session_id}</span></div>}
                          {j.completed_at && <div><span className="text-slate-400">完成:</span> {fmtTW(j.completed_at)}</div>}
                          {j.transcript_file && j.status === 'done' && (
                            <div>
                              <span className="text-slate-400">逐字稿:</span>{' '}
                              <a href={j.transcript_url || `/uploads/generated/${j.transcript_file}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                {j.transcript_file}
                              </a>
                            </div>
                          )}
                          {j.error_msg && (
                            <div className="text-red-600 break-all"><span className="text-slate-400">錯誤:</span> {j.error_msg}</div>
                          )}
                          {Array.isArray(j.segments) && j.segments.length > 0 && (
                            <div className="pt-2">
                              <div className="text-slate-400 mb-1">分段(可單獨重轉):</div>
                              <div className="flex flex-wrap gap-1.5">
                                {j.segments.map(seg => {
                                  const canRerun = (j.status === 'done' || j.status === 'failed')
                                  const busy = rerunning === `${j.id}-${seg.idx}`
                                  return (
                                    <div
                                      key={seg.idx}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] ${
                                        seg.ok ? 'border-slate-200 bg-white text-slate-600' : 'border-red-200 bg-red-50 text-red-600'
                                      }`}
                                      title={seg.error || seg.marker || ''}
                                    >
                                      <span className="font-mono">#{seg.idx + 1}</span>
                                      <span className="text-slate-400">{seg.marker}</span>
                                      <span className="text-slate-400">{(seg.chars || 0).toLocaleString()}字</span>
                                      {!seg.ok && <span className="text-red-500">✗</span>}
                                      {canRerun && (
                                        <button
                                          onClick={() => rerunSeg(j.id, seg.idx)}
                                          disabled={busy}
                                          className="ml-0.5 inline-flex items-center text-blue-500 hover:text-blue-700 disabled:opacity-40"
                                          title="重轉此段"
                                        >
                                          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
                                        </button>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
