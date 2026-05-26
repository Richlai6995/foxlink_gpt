import { useState, useEffect, Fragment, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { Download, ChevronDown, ChevronRight, Users, CheckCircle2, XCircle, Clock, MinusCircle, Search, ChevronsLeft, ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon, ChevronsRight } from 'lucide-react'

interface CourseDetail {
  course_id: number; title: string
  browse_total: number; browse_viewed: number
  best_score: number; attempts: number
  last_score: number; last_attempt_at: string | null
  weighted: number; total_score: number; passed: boolean
  mandatory_complete?: boolean
  mandatory_browse_complete?: boolean
  mandatory_exam_complete?: boolean
  mandatory_exam_missing?: number
  mandatory_exam_total?: number
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
  mandatory_complete?: boolean
  mandatory_exam_total?: number
  mandatory_exam_missing?: number
}

interface ReportData {
  program_title: string; program_pass_score: number
  summary: { total: number; completed_browse: number; passed: number; not_started: number }
  pagination: { page: number; page_size: number; total: number; total_pages: number }
  users: UserReport[]
}

type SortKey = 'name' | 'employee_id' | 'browse_pct' | 'attempts' | 'last_score' | 'last_at' | 'passed' | 'started'
type SortDir = 'asc' | 'desc'
type FilterStatus = 'all' | 'passed' | 'in_progress' | 'not_started'

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
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const debounceRef = useRef<number | null>(null)

  // search debounce (400ms)— 邊打邊送會把 server 打爆
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      setSearch(searchInput)
      setPage(1) // 換搜尋字 → 回第一頁
    }, 400)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [searchInput])

  // 換 filter / sort → 回第一頁
  useEffect(() => { setPage(1) }, [filter, sortKey, sortDir, pageSize])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      status: filter,
      sort: sortKey,
      sort_dir: sortDir,
    })
    if (search.trim()) params.set('search', search.trim())
    api.get(`/training/programs/${programId}/report?${params.toString()}`)
      .then(r => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [programId, page, pageSize, filter, sortKey, sortDir, search])

  const handleExport = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams({ status: filter })
      if (search.trim()) params.set('search', search.trim())
      const res = await api.get(`/training/programs/${programId}/report/export?${params.toString()}`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `${data?.program_title || 'report'}_report.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (e) { console.error(e) }
    finally { setExporting(false) }
  }

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  const sortIcon = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''

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

  // 未及格時告訴 admin 為什麼:必修沒做完?還是分數不夠?
  const failReason = (u: UserReport): string | null => {
    if (u.program_passed) return null
    if (!u.exam_started) return null // 還沒考的人不顯示原因
    if (u.mandatory_complete === false) {
      // 從 courses 收集 incomplete 細節
      const bits: string[] = []
      for (const c of u.courses || []) {
        if (c.mandatory_complete === false) {
          const segs: string[] = []
          if (c.mandatory_browse_complete === false) segs.push(t('training.report.browseIncomplete') as string)
          if (c.mandatory_exam_complete === false && (c.mandatory_exam_missing || 0) > 0) {
            segs.push(t('training.report.examMissing', { n: c.mandatory_exam_missing }) as string)
          }
          if (segs.length > 0) bits.push(segs.join(' / '))
        }
      }
      return bits.length > 0 ? bits.join(', ') : (t('training.report.mandatoryIncomplete') as string)
    }
    return null
  }

  const toggleRow = (uid: number) => {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(uid) ? n.delete(uid) : n.add(uid)
      return n
    })
  }

  const filterBtn = (v: FilterStatus, label: string, cls: string) => (
    <button
      onClick={() => setFilter(v)}
      className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
        filter === v ? cls : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  )

  if (loading && !data) return <div className="text-center py-12 text-sm text-slate-400">{t('training.loading')}</div>
  if (!data) return null

  const rows = data.users
  const summary = data.summary
  const pg = data.pagination
  const inProgressCount = summary.total - summary.passed - summary.not_started

  return (
    <div className="space-y-4">
      {/* Summary + search bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-slate-700">{t('training.report.title')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {filterBtn('all', `${t('training.report.assigned')} ${summary.total}`, 'bg-blue-100 text-blue-700')}
          {filterBtn('passed', `${t('training.scoring.passed')} ${summary.passed}`, 'bg-green-100 text-green-700')}
          {filterBtn('in_progress', `${t('training.scoring.inProgress')} ${inProgressCount}`, 'bg-amber-100 text-amber-700')}
          {filterBtn('not_started', `${t('training.scoring.notStarted')} ${summary.not_started}`, 'bg-slate-200 text-slate-600')}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={t('training.report.searchPlaceholder') as string}
            className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg w-52 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button onClick={handleExport} disabled={exporting}
          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50">
          <Download size={13} /> {exporting ? '...' : t('training.report.exportExcel')}
        </button>
      </div>

      {/* User table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10 text-xs text-slate-500">
            {t('training.loading')}
          </div>
        )}
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
            {rows.map(u => {
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
                    <td className="px-3 py-2 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        {yesNo(u.program_passed, 'pass')}
                        {(() => {
                          const reason = failReason(u)
                          return reason
                            ? <span className="text-[10px] text-orange-500 whitespace-nowrap" title={reason}>{reason}</span>
                            : null
                        })()}
                      </div>
                    </td>
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
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-sm text-slate-400">{t('training.report.noData')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pg.total > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-600">
          <div>
            {t('training.report.paginationInfo', {
              from: (pg.page - 1) * pg.page_size + 1,
              to: Math.min(pg.page * pg.page_size, pg.total),
              total: pg.total,
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">{t('training.report.pageSize')}</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="border border-slate-300 rounded px-2 py-1 text-xs"
            >
              {[20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="flex items-center gap-0.5 ml-2">
              <button
                onClick={() => setPage(1)}
                disabled={pg.page <= 1}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
              ><ChevronsLeft size={14} /></button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={pg.page <= 1}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
              ><ChevronLeftIcon size={14} /></button>
              <span className="px-2 tabular-nums">
                {pg.page} / {pg.total_pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pg.total_pages, p + 1))}
                disabled={pg.page >= pg.total_pages}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
              ><ChevronRightIcon size={14} /></button>
              <button
                onClick={() => setPage(pg.total_pages)}
                disabled={pg.page >= pg.total_pages}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
              ><ChevronsRight size={14} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
