import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, CheckCircle, XCircle, Loader2, Download, X } from 'lucide-react'
import api from '../lib/api'
import { fmtTW } from '../lib/fmtTW'

interface TranscribeJob {
  id: string
  user_id: number
  session_id?: string
  message_id?: number
  audio_filename: string
  audio_size_mb?: number
  duration_sec?: number
  status: 'pending' | 'running' | 'done' | 'failed'
  segment_total: number
  segment_done: number
  segments?: Array<{ idx: number; ok: boolean; marker?: string; attempts?: number; chars?: number; error?: string }> | null
  transcript_chars: number
  transcript_file?: string
  transcript_url?: string
  in_tokens_total?: number
  out_tokens_total?: number
  error_msg?: string
  recovery_count?: number
  created_at?: string
  completed_at?: string
}

interface Props {
  jobId: string
}

function _fmtDur(sec?: number): string {
  if (!sec || sec <= 0) return ''
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export default function TranscribeProgressCard({ jobId }: Props) {
  const { t } = useTranslation()
  const [job, setJob] = useState<TranscribeJob | null>(null)
  const [canceling, setCanceling] = useState(false)

  const handleCancel = async () => {
    if (!confirm(t('transcribe_job.cancelConfirm'))) return
    setCanceling(true)
    try {
      await api.post(`/transcribe/jobs/${jobId}/cancel`)
      // 立刻 fetch 拿到最新 failed status
      const res = await api.get(`/transcribe/jobs/${jobId}`)
      setJob(res.data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || '取消失敗'
      alert(msg)
    } finally {
      setCanceling(false)
    }
  }

  const fetchJob = useCallback(async () => {
    try {
      const res = await api.get(`/transcribe/jobs/${jobId}`)
      setJob(res.data)
    } catch { /* job 可能被刪 */ }
  }, [jobId])

  useEffect(() => { fetchJob() }, [fetchJob])

  // Poll while running(同 ResearchProgressCard 的 3s pattern)
  useEffect(() => {
    if (!job) return
    if (job.status === 'done' || job.status === 'failed') return
    const t = setTimeout(fetchJob, 3000)
    return () => clearTimeout(t)
  }, [job, fetchJob])

  if (!job) {
    return (
      <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-400">
        <Loader2 size={15} className="animate-spin" /> {t('transcribe_job.loading')}
      </div>
    )
  }

  const pct = job.segment_total > 0
    ? Math.round((job.segment_done / job.segment_total) * 100)
    : 0

  const statusColor =
    job.status === 'done'   ? 'border-green-200 bg-green-50' :
    job.status === 'failed' ? 'border-red-200 bg-red-50' :
                              'border-blue-200 bg-blue-50'

  const subtitle = job.status === 'done'
    ? t('transcribe_job.done', { time: fmtTW(job.completed_at), chars: (job.transcript_chars || 0).toLocaleString(), total: job.segment_total })
    : job.status === 'failed'
    ? (job.error_msg || t('transcribe_job.failed'))
    : (job.segment_total > 0
        ? t('transcribe_job.running', { done: job.segment_done, total: job.segment_total, chars: (job.transcript_chars || 0).toLocaleString() })
        : t('transcribe_job.preparing'))

  return (
    <div className={`border rounded-xl overflow-hidden ${statusColor}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {job.status === 'done'   && <CheckCircle size={18} className="text-green-500 flex-shrink-0" />}
        {job.status === 'failed' && <XCircle     size={18} className="text-red-500 flex-shrink-0" />}
        {(job.status === 'pending' || job.status === 'running') &&
          <Loader2 size={18} className="text-blue-500 animate-spin flex-shrink-0" />
        }

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            <Mic size={13} className="inline mr-1 text-blue-500" />
            {t('transcribe_job.title')}:{job.audio_filename}
            {job.duration_sec ? <span className="text-xs text-slate-400 font-normal ml-2">· {_fmtDur(job.duration_sec)}</span> : null}
            {job.audio_size_mb ? <span className="text-xs text-slate-400 font-normal ml-2">· {job.audio_size_mb.toFixed(1)}MB</span> : null}
          </p>

          <p className={`text-xs mt-0.5 truncate ${
            job.status === 'done' ? 'text-green-600' :
            job.status === 'failed' ? 'text-red-500' :
            'text-slate-500'
          }`}>
            {subtitle}
            {job.recovery_count && job.recovery_count > 0 ? (
              <span className="text-amber-600 ml-2">({t('transcribe_job.recovery', { count: job.recovery_count })})</span>
            ) : null}
          </p>

          {(job.status === 'pending' || job.status === 'running') && job.segment_total > 0 && (
            <div className="mt-1.5 h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>

        {job.status === 'done' && job.transcript_url && (
          <a
            href={job.transcript_url}
            download={job.transcript_file}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-green-300 text-green-700 text-xs rounded-lg hover:bg-green-50 transition flex-shrink-0"
            title={job.transcript_file}
          >
            <Download size={12} />
            {t('transcribe_job.download')}
          </a>
        )}

        {(job.status === 'pending' || job.status === 'running') && (
          <button
            onClick={handleCancel}
            disabled={canceling}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs rounded-lg hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition flex-shrink-0 disabled:opacity-50"
            title={t('transcribe_job.cancel')}
          >
            <X size={12} />
            {canceling ? t('transcribe_job.canceling') : t('transcribe_job.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
