import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { Download, ChevronDown, ChevronUp, Users, CheckCircle2, Clock, AlertCircle } from 'lucide-react'

interface CourseDetail {
  course_id: number; title: string
  browse_total: number; browse_viewed: number
  best_score: number; attempts: number
  weighted: number; total_score: number; passed: boolean
}

interface UserReport {
  user_id: number; name: string; employee_id: string; dept_code: string
  browse_total: number; browse_viewed: number; browse_pct: number
  courses: CourseDetail[]
  program_total: number; program_max: number; program_passed: boolean; status: string
}

interface ReportData {
  program_title: string; program_pass_score: number
  summary: { total: number; completed_browse: number; passed: number; not_started: number }
  users: UserReport[]
}

export default function ProgramReport({ programId }: { programId: number }) {
  const { t } = useTranslation()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    api.get(`/training/programs/${programId}/report`)
      .then(r => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [programId])

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await api.get(`/training/programs/${programId}/report/export`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `${data?.program_title || 'report'}_report.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (e) { console.error(e) }
    finally { setExporting(false) }
  }

  if (loading) return <div className="text-center py-12 text-sm text-slate-400">{t('training.loading')}</div>
  if (!data) return null

  const statusIcon = (s: string) => {
    if (s === 'passed') return <CheckCircle2 size={14} className="text-green-500" />
    if (s === 'in_progress') return <Clock size={14} className="text-blue-500" />
    return <AlertCircle size={14} className="text-slate-300" />
  }

  const statusLabel = (s: string) => {
    if (s === 'passed') return t('training.scoring.passed')
    if (s === 'in_progress') return t('training.scoring.inProgress')
    return t('training.scoring.notStarted')
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-slate-700">{t('training.report.title')}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{t('training.report.assigned')}: {data.summary.total}</span>
          <span className="text-green-600">{t('training.scoring.passed')}: {data.summary.passed}</span>
          <span className="text-blue-600">{t('training.report.browseDone')}: {data.summary.completed_browse}</span>
          <span className="text-slate-400">{t('training.scoring.notStarted')}: {data.summary.not_started}</span>
        </div>
        <button onClick={handleExport} disabled={exporting}
          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50">
          <Download size={13} /> {exporting ? '...' : t('training.report.exportExcel')}
        </button>
      </div>

      {/* User table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_80px_80px_repeat(auto-fill,minmax(80px,1fr))_80px_70px] gap-2 px-4 py-2 bg-slate-50 text-[10px] font-semibold text-slate-500 uppercase border-b">
          <span>{t('training.report.name')}</span>
          <span>{t('training.report.employeeId')}</span>
          <span>{t('training.report.browse')}</span>
          {data.users[0]?.courses.map(c => (
            <span key={c.course_id} className="truncate" title={c.title}>{c.title}</span>
          ))}
          <span>{t('training.report.total')}</span>
          <span>{t('training.report.status')}</span>
        </div>

        {/* Rows */}
        {data.users.map(u => {
          const expanded = expandedUser === u.user_id
          return (
            <div key={u.user_id}>
              <div className="grid grid-cols-[1fr_80px_80px_repeat(auto-fill,minmax(80px,1fr))_80px_70px] gap-2 px-4 py-2.5 text-xs border-b border-slate-50 hover:bg-slate-50 cursor-pointer items-center"
                onClick={() => setExpandedUser(expanded ? null : u.user_id)}>
                <span className="font-medium text-slate-800 flex items-center gap-1">
                  {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {u.name}
                </span>
                <span className="text-slate-500">{u.employee_id || '—'}</span>
                <span className={u.browse_pct === 100 ? 'text-green-600' : 'text-slate-500'}>{u.browse_pct}%</span>
                {u.courses.map(c => (
                  <span key={c.course_id} className={c.passed ? 'text-green-600' : c.best_score > 0 ? 'text-orange-500' : 'text-slate-400'}>
                    {c.best_score > 0 ? `${c.weighted}/${c.total_score}` : '—'}
                  </span>
                ))}
                <span className={`font-medium ${u.program_passed ? 'text-green-600' : 'text-slate-600'}`}>
                  {u.program_total > 0 ? `${u.program_total}/${u.program_max}` : '—'}
                </span>
                <span className="flex items-center gap-1">{statusIcon(u.status)} {statusLabel(u.status)}</span>
              </div>

              {/* Expanded detail */}
              {expanded && (
                <div className="px-8 py-3 bg-slate-50 border-b text-xs space-y-2">
                  {u.courses.map(c => (
                    <div key={c.course_id} className="flex items-center gap-4">
                      <span className="font-medium text-slate-700 w-48 truncate">{c.title}</span>
                      <span className={`${c.browse_viewed >= c.browse_total ? 'text-green-600' : 'text-slate-500'}`}>
                        {t('training.scoring.browse')}: {c.browse_viewed}/{c.browse_total}
                      </span>
                      <span className={c.passed ? 'text-green-600' : c.best_score > 0 ? 'text-orange-500' : 'text-slate-400'}>
                        {t('training.scoring.exam')}: {c.best_score > 0 ? c.best_score : '—'}
                        {c.attempts > 0 && ` (${c.attempts}${t('training.report.times')})`}
                      </span>
                      <span className="text-slate-500">→ {c.weighted}/{c.total_score}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {data.users.length === 0 && (
          <div className="text-center py-8 text-sm text-slate-400">{t('training.report.noData')}</div>
        )}
      </div>
    </div>
  )
}
