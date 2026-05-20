import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { Download, ChevronDown, ChevronRight, Users, CheckCircle2, XCircle, Clock, MinusCircle } from 'lucide-react'

interface CourseDetail {
  course_id: number; title: string
  browse_total: number; browse_viewed: number
  best_score: number; attempts: number
  last_score: number; last_attempt_at: string | null
  weighted: number; total_score: number; passed: boolean
}

interface UserReport {
  user_id: number; name: string; employee_id: string; dept_code: string
  browse_total: number; browse_viewed: number; browse_pct: number
  courses: CourseDetail[]
  program_total: number; program_max: number; program_passed: boolean; status: string
  last_score: number; last_score_max: number
  last_attempt_at: string | null
  total_attempts: number
  exam_started: boolean
}

interface ReportData {
  program_title: string; program_pass_score: number
  summary: { total: number; completed_browse: number; passed: number; not_started: number }
  users: UserReport[]
}

type SortKey = 'name' | 'employee_id' | 'browse_pct' | 'attempts' | 'last_score' | 'last_at' | 'passed' | 'started'
type SortDir = 'asc' | 'desc'

const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ProgramReport({ programId }: { programId: number }) {
  const { t } = useTranslation()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filter, setFilter] = useState<'all' | 'passed' | 'in_progress' | 'not_started'>('all')

  useEffect(() => {
    setLoading(true)
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

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  const sortIcon = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''

  const filtered = data.users.filter(u => filter === 'all' || u.status === filter)
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (x: number | string, y: number | string) =>
      x < y ? -dir : x > y ? dir : 0
    switch (sortKey) {
      case 'name': return cmp(a.name || '', b.name || '')
      case 'employee_id': return cmp(a.employee_id || '', b.employee_id || '')
      case 'browse_pct': return cmp(a.browse_pct, b.browse_pct)
      case 'attempts': return cmp(a.total_attempts, b.total_attempts)
      case 'last_score': {
        const ax = a.last_score_max > 0 ? a.last_score / a.last_score_max : -1
        const bx = b.last_score_max > 0 ? b.last_score / b.last_score_max : -1
        return cmp(ax, bx)
      }
      case 'last_at': return cmp(a.last_attempt_at || '', b.last_attempt_at || '')
      case 'passed': return cmp(a.program_passed ? 1 : 0, b.program_passed ? 1 : 0)
      case 'started': return cmp(a.exam_started ? 1 : 0, b.exam_started ? 1 : 0)
    }
  })

  const yesNo = (v: boolean, kind: 'pass' | 'start') => {
    if (kind === 'pass') {
      return v
        ? <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 size={14} />{t('training.scoring.passed')}</span>
        : <span className="inline-flex items-center gap-1 text-slate-400"><XCircle size={14} />{t('training.scoring.notPassed')}</span>
    }
    return v
      ? <span className="inline-flex items-center gap-1 text-blue-600"><Clock size={14} />{t('training.report.started')}</span>
      : <span className="inline-flex items-center gap-1 text-slate-400"><MinusCircle size={14} />{t('training.report.notStarted')}</span>
  }

  const toggleRow = (uid: number) => {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(uid) ? n.delete(uid) : n.add(uid)
      return n
    })
  }

  const filterBtn = (v: typeof filter, label: string, cls: string) => (
    <button
      onClick={() => setFilter(v)}
      className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
        filter === v ? cls : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-slate-700">{t('training.report.title')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {filterBtn('all', `${t('training.report.assigned')} ${data.summary.total}`, 'bg-blue-100 text-blue-700')}
          {filterBtn('passed', `${t('training.scoring.passed')} ${data.summary.passed}`, 'bg-green-100 text-green-700')}
          {filterBtn('in_progress', `${t('training.scoring.inProgress')} ${data.summary.total - data.summary.passed - data.summary.not_started}`, 'bg-amber-100 text-amber-700')}
          {filterBtn('not_started', `${t('training.scoring.notStarted')} ${data.summary.not_started}`, 'bg-slate-200 text-slate-600')}
        </div>
        <div className="flex-1" />
        <button onClick={handleExport} disabled={exporting}
          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50">
          <Download size={13} /> {exporting ? '...' : t('training.report.exportExcel')}
        </button>
      </div>

      {/* User table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left font-semibold cursor-pointer select-none" onClick={() => toggleSort('name')}>
                {t('training.report.name')} {sortIcon('name')}
              </th>
              <th className="px-3 py-2 text-left font-semibold cursor-pointer select-none" onClick={() => toggleSort('employee_id')}>
                {t('training.report.employeeId')} {sortIcon('employee_id')}
              </th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer select-none" onClick={() => toggleSort('started')}>
                {t('training.report.examStarted')} {sortIcon('started')}
              </th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer select-none" onClick={() => toggleSort('browse_pct')}>
                {t('training.report.browseProgress')} {sortIcon('browse_pct')}
              </th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer select-none" onClick={() => toggleSort('attempts')}>
                {t('training.report.attemptCount')} {sortIcon('attempts')}
              </th>
              <th className="px-3 py-2 text-right font-semibold cursor-pointer select-none" onClick={() => toggleSort('last_score')}>
                {t('training.report.lastScore')} {sortIcon('last_score')}
              </th>
              <th className="px-3 py-2 text-left font-semibold cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('last_at')}>
                {t('training.report.lastAttemptAt')} {sortIcon('last_at')}
              </th>
              <th className="px-3 py-2 text-center font-semibold cursor-pointer select-none" onClick={() => toggleSort('passed')}>
                {t('training.report.passResult')} {sortIcon('passed')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(u => {
              const isOpen = expanded.has(u.user_id)
              const hasDetail = u.courses.length > 1
              const lastPct = u.last_score_max > 0 ? Math.round(u.last_score / u.last_score_max * 100) : 0
              return (
                <Fragment key={u.user_id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-2 text-center">
                      {hasDetail ? (
                        <button onClick={() => toggleRow(u.user_id)} className="text-slate-400 hover:text-slate-700">
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{u.name}</td>
                    <td className="px-3 py-2 text-slate-500">{u.employee_id || '—'}</td>
                    <td className="px-3 py-2 text-right">{yesNo(u.exam_started, 'start')}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${u.browse_pct === 100 ? 'text-green-600' : u.browse_pct > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                      {u.browse_pct}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{u.total_attempts || '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                      !u.exam_started ? 'text-slate-400'
                        : lastPct >= data.program_pass_score ? 'text-green-600'
                        : 'text-orange-500'
                    }`}>
                      {u.exam_started ? `${u.last_score}/${u.last_score_max}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(u.last_attempt_at)}</td>
                    <td className="px-3 py-2 text-center">{yesNo(u.program_passed, 'pass')}</td>
                  </tr>
                  {hasDetail && isOpen && (
                    <tr className="bg-slate-50">
                      <td />
                      <td colSpan={8} className="px-3 py-2">
                        <div className="space-y-1.5">
                          {u.courses.map(c => (
                            <div key={c.course_id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr] gap-3 text-[11px] text-slate-600">
                              <span className="font-medium text-slate-700 truncate" title={c.title}>{c.title}</span>
                              <span className={c.browse_viewed >= c.browse_total ? 'text-green-600' : 'text-slate-500'}>
                                {t('training.report.browse')}: {c.browse_viewed}/{c.browse_total}
                              </span>
                              <span className="text-slate-500">
                                {t('training.report.attemptCount')}: {c.attempts}
                              </span>
                              <span className={c.passed ? 'text-green-600' : c.last_score > 0 ? 'text-orange-500' : 'text-slate-400'}>
                                {t('training.report.lastScore')}: {c.attempts > 0 ? `${c.last_score}/${c.total_score}` : '—'}
                              </span>
                              <span className="text-slate-500 whitespace-nowrap">
                                {fmtDate(c.last_attempt_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-sm text-slate-400">{t('training.report.noData')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
