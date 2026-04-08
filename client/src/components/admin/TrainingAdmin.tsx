import { useState, useEffect, useCallback } from 'react'
import api from '../../lib/api'
import { BarChart3, Users, BookOpen, Award, TrendingUp, FileText, ChevronDown, ChevronRight, CheckCircle2, XCircle, MinusCircle, Download, Filter, Search } from 'lucide-react'

interface Overview {
  total_courses: number
  active_learners: number
  completions: number
  avg_score: number
  pass_rate: number
}

interface CourseReport {
  id: number
  title: string
  learners: number
  completions: number
  avg_score: number | null
}

interface UserReport {
  id: number
  name: string
  employee_id: string
  dept_code: string
  courses_started: number
  courses_completed: number
  avg_score: number | null
}

interface UserDetail {
  user_id: number
  name: string
  employee_id: string
  status: 'passed' | 'failed' | 'not_attempted'
  best_score: number | null
  max_score: number | null
  last_completed: string | null
}

interface LessonReport {
  lesson_id: number
  title: string
  sort_order: number
  total_users: number
  passed: number
  failed: number
  not_attempted: number
  pass_rate: number
  users: UserDetail[]
}

interface HelpSection {
  section_id: string
  title: string
  sort_order: number
  linked_course_id: number
  linked_lesson_id: number
  selected: boolean
  total_users: number
  passed: number
  failed: number
  not_attempted: number
  pass_rate: number
}

interface HelpUserRow {
  user_id: number
  name: string
  employee_id: string
  dept_code: string
  dept_name: string
  profit_center: string
  profit_center_name: string
  org_section: string
  org_section_name: string
  org_group_name: string
  passed_count: number
  total_sections: number
  all_passed: boolean
  tested: boolean
  sections: Record<string, 'passed' | 'failed' | 'not_attempted'>
}

interface OrgOptions {
  depts: { code: string; name: string }[]
  profit_centers: { code: string; name: string }[]
  org_sections: { code: string; name: string }[]
  org_groups: string[]
}

type Tab = 'overview' | 'courses' | 'users' | 'lesson-completion' | 'help-completion'

export default function TrainingAdmin() {
  const [tab, setTab] = useState<Tab>('overview')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [courseReports, setCourseReports] = useState<CourseReport[]>([])
  const [userReports, setUserReports] = useState<UserReport[]>([])
  const [loading, setLoading] = useState(true)

  // Lesson completion
  const [courseList, setCourseList] = useState<{ id: number; title: string }[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null)
  const [lessonReport, setLessonReport] = useState<{ course_title: string; pass_score: number; total_target_users: number; lessons: LessonReport[] } | null>(null)
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null)

  // Help completion
  const [helpSections, setHelpSections] = useState<HelpSection[]>([])
  const [helpUsers, setHelpUsers] = useState<HelpUserRow[]>([])
  const [helpSummary, setHelpSummary] = useState({ total: 0, all_passed: 0, some_tested: 0, not_tested: 0 })
  const [helpOrgOptions, setHelpOrgOptions] = useState<OrgOptions>({ depts: [], profit_centers: [], org_sections: [], org_groups: [] })
  const [helpSelectedSections, setHelpSelectedSections] = useState<Set<string>>(new Set())
  const [helpInitialized, setHelpInitialized] = useState(false)
  const [helpFilterDept, setHelpFilterDept] = useState('')
  const [helpFilterPC, setHelpFilterPC] = useState('')
  const [helpFilterOrgSec, setHelpFilterOrgSec] = useState('')
  const [helpFilterOrgGrp, setHelpFilterOrgGrp] = useState('')
  const [helpSearch, setHelpSearch] = useState('')

  useEffect(() => { loadData() }, [tab, selectedCourseId])

  const loadData = async () => {
    try {
      setLoading(true)
      if (tab === 'overview') {
        const res = await api.get('/training/admin/reports/overview')
        setOverview(res.data)
      } else if (tab === 'courses') {
        const res = await api.get('/training/admin/reports/by-course')
        setCourseReports(res.data)
      } else if (tab === 'users') {
        const res = await api.get('/training/admin/reports/by-user')
        setUserReports(res.data)
      } else if (tab === 'lesson-completion') {
        if (!courseList.length) {
          const res = await api.get('/training/admin/reports/by-course')
          setCourseReports(res.data)
          setCourseList(res.data.map((c: CourseReport) => ({ id: c.id, title: c.title })))
          if (res.data.length > 0 && !selectedCourseId) setSelectedCourseId(res.data[0].id)
        }
        if (selectedCourseId) {
          const res = await api.get('/training/lesson-completion-report', { params: { course_id: selectedCourseId } })
          setLessonReport(res.data)
        }
      } else if (tab === 'help-completion') {
        if (!helpInitialized) {
          // First load: get all sections, select all
          const res = await api.get('/training/help-completion-report')
          setHelpSections(res.data.sections || [])
          setHelpUsers(res.data.users || [])
          setHelpSummary(res.data.summary || { total: 0, all_passed: 0, some_tested: 0, not_tested: 0 })
          setHelpOrgOptions(res.data.org_options || { depts: [], profit_centers: [], org_sections: [], org_groups: [] })
          const allIds = new Set((res.data.sections || []).map((s: HelpSection) => s.section_id))
          setHelpSelectedSections(allIds)
          setHelpInitialized(true)
        }
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const loadHelpReport = useCallback(async (sectionIds?: Set<string>) => {
    try {
      setLoading(true)
      const params: any = {}
      const ids = sectionIds || helpSelectedSections
      if (ids.size > 0 && ids.size < helpSections.length) {
        params.section_ids = [...ids].join(',')
      }
      if (helpFilterDept) params.dept_code = helpFilterDept
      if (helpFilterPC) params.profit_center = helpFilterPC
      if (helpFilterOrgSec) params.org_section = helpFilterOrgSec
      if (helpFilterOrgGrp) params.org_group_name = helpFilterOrgGrp
      const res = await api.get('/training/help-completion-report', { params })
      setHelpSections(res.data.sections || [])
      setHelpUsers(res.data.users || [])
      setHelpSummary(res.data.summary || { total: 0, all_passed: 0, some_tested: 0, not_tested: 0 })
      if (!helpInitialized) setHelpOrgOptions(res.data.org_options || { depts: [], profit_centers: [], org_sections: [], org_groups: [] })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [helpSelectedSections, helpFilterDept, helpFilterPC, helpFilterOrgSec, helpFilterOrgGrp, helpSections.length, helpInitialized])

  const toggleSection = (id: string) => {
    const next = new Set(helpSelectedSections)
    next.has(id) ? next.delete(id) : next.add(id)
    setHelpSelectedSections(next)
  }

  const applyHelpFilters = () => loadHelpReport()

  const exportCsv = () => {
    const selectedSecs = helpSections.filter(s => helpSelectedSections.has(s.section_id))
    const headers = ['姓名', '工號', '部門代碼', '部門名稱', '利潤中心', '組織段', '組別',
      ...selectedSecs.map(s => s.title), '通過數', '應通過數', '全部通過']
    const rows = filteredHelpUsers.map(u => [
      u.name, u.employee_id || '', u.dept_code || '', u.dept_name || '',
      u.profit_center_name || u.profit_center || '', u.org_section_name || u.org_section || '', u.org_group_name || '',
      ...selectedSecs.map(s => {
        const st = u.sections[s.section_id]
        return st === 'passed' ? '通過' : st === 'failed' ? '未通過' : '未作答'
      }),
      String(u.passed_count), String(u.total_sections), u.all_passed ? '是' : '否',
    ])
    const bom = '\uFEFF'
    const csv = bom + [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `使用手冊完成率_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // Filter help users by search text
  const filteredHelpUsers = helpSearch
    ? helpUsers.filter(u => u.name?.includes(helpSearch) || u.employee_id?.includes(helpSearch) || u.dept_name?.includes(helpSearch))
    : helpUsers

  const statusBadge = (status: string) => {
    if (status === 'passed') return <span className="inline-flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 size={12} /> 通過</span>
    if (status === 'failed') return <span className="inline-flex items-center gap-1 text-red-500 font-medium"><XCircle size={12} /> 未通過</span>
    return <span className="inline-flex items-center gap-1 text-slate-400"><MinusCircle size={12} /> 未作答</span>
  }

  const passRateBar = (rate: number) => (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{
          width: `${rate}%`,
          backgroundColor: rate >= 80 ? '#16a34a' : rate >= 50 ? '#d97706' : '#dc2626'
        }} />
      </div>
      <span className="text-xs font-mono w-10 text-right font-semibold" style={{ color: rate >= 80 ? '#16a34a' : rate >= 50 ? '#d97706' : '#dc2626' }}>{rate}%</span>
    </div>
  )

  const renderUserTable = (users: UserDetail[]) => (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-200 text-slate-500">
          <th className="text-left py-2 pl-8 font-medium">姓名</th>
          <th className="text-left py-2 font-medium">工號</th>
          <th className="text-center py-2 font-medium">狀態</th>
          <th className="text-right py-2 font-medium">最高分</th>
          <th className="text-right py-2 pr-4 font-medium">完成時間</th>
        </tr>
      </thead>
      <tbody>
        {users.map(u => (
          <tr key={u.user_id} className="border-b border-slate-100 hover:bg-sky-50/50 transition">
            <td className="py-2 pl-8 text-slate-700 font-medium">{u.name}</td>
            <td className="py-2 text-slate-500">{u.employee_id}</td>
            <td className="py-2 text-center">{statusBadge(u.status)}</td>
            <td className="py-2 text-right text-slate-700 font-mono">
              {u.best_score != null ? `${u.best_score}/${u.max_score}` : '-'}
            </td>
            <td className="py-2 text-right pr-4 text-slate-400">
              {u.last_completed ? new Date(u.last_completed).toLocaleDateString('zh-TW') : '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'overview', label: '總覽', icon: BarChart3 },
          { key: 'courses', label: '依課程', icon: BookOpen },
          { key: 'users', label: '依使用者', icon: Users },
          { key: 'lesson-completion', label: '章節完成率', icon: Award },
          { key: 'help-completion', label: '使用手冊完成率', icon: FileText },
        ] as { key: Tab; label: string; icon: any }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition shadow-sm ${
              tab === t.key
                ? 'bg-sky-600 text-white shadow-sky-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
            }`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm py-12 text-center">載入中...</div>

      ) : tab === 'overview' && overview ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard icon={BookOpen} label="已發佈課程" value={overview.total_courses} color="text-sky-600" bg="bg-sky-50" />
          <StatCard icon={Users} label="學習人數" value={overview.active_learners} color="text-emerald-600" bg="bg-emerald-50" />
          <StatCard icon={Award} label="完成次數" value={overview.completions} color="text-violet-600" bg="bg-violet-50" />
          <StatCard icon={TrendingUp} label="平均分數" value={overview.avg_score} color="text-amber-600" bg="bg-amber-50" />
          <StatCard icon={Award} label="通過率" value={`${overview.pass_rate}%`} color="text-emerald-600" bg="bg-emerald-50" />
        </div>

      ) : tab === 'courses' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs">
                <th className="text-left py-3 px-4 font-semibold">課程</th>
                <th className="text-right py-3 px-4 font-semibold">學習人數</th>
                <th className="text-right py-3 px-4 font-semibold">完成數</th>
                <th className="text-right py-3 px-4 font-semibold">平均分數</th>
              </tr>
            </thead>
            <tbody>
              {courseReports.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-sky-50/40 transition">
                  <td className="py-3 px-4 text-slate-700 font-medium">{r.title}</td>
                  <td className="py-3 px-4 text-right text-slate-600">{r.learners}</td>
                  <td className="py-3 px-4 text-right text-slate-600">{r.completions}</td>
                  <td className="py-3 px-4 text-right text-slate-600 font-mono">{r.avg_score != null ? Math.round(r.avg_score) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      ) : tab === 'users' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs">
                <th className="text-left py-3 px-4 font-semibold">姓名</th>
                <th className="text-left py-3 px-4 font-semibold">工號</th>
                <th className="text-left py-3 px-4 font-semibold">部門</th>
                <th className="text-right py-3 px-4 font-semibold">已開始</th>
                <th className="text-right py-3 px-4 font-semibold">已完成</th>
                <th className="text-right py-3 px-4 font-semibold">平均分數</th>
              </tr>
            </thead>
            <tbody>
              {userReports.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-sky-50/40 transition">
                  <td className="py-3 px-4 text-slate-700 font-medium">{r.name}</td>
                  <td className="py-3 px-4 text-slate-500">{r.employee_id}</td>
                  <td className="py-3 px-4 text-slate-500">{r.dept_code}</td>
                  <td className="py-3 px-4 text-right text-slate-600">{r.courses_started}</td>
                  <td className="py-3 px-4 text-right text-slate-600">{r.courses_completed}</td>
                  <td className="py-3 px-4 text-right text-slate-600 font-mono">{r.avg_score != null ? Math.round(r.avg_score) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      ) : tab === 'lesson-completion' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
            <label className="text-xs text-slate-500 font-medium">選擇課程：</label>
            <select
              value={selectedCourseId || ''}
              onChange={e => { setSelectedCourseId(Number(e.target.value)); setExpandedLesson(null) }}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            >
              {courseList.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            {lessonReport && (
              <span className="text-xs text-slate-400 ml-auto">
                及格: <strong className="text-slate-600">{lessonReport.pass_score}分</strong> ｜ 應完成: <strong className="text-slate-600">{lessonReport.total_target_users}人</strong>
              </span>
            )}
          </div>

          {lessonReport && lessonReport.lessons.map(l => (
            <div key={l.lesson_id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <button
                onClick={() => setExpandedLesson(expandedLesson === l.lesson_id ? null : l.lesson_id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition text-left"
              >
                {expandedLesson === l.lesson_id
                  ? <ChevronDown size={14} className="text-slate-400" />
                  : <ChevronRight size={14} className="text-slate-400" />}
                <span className="text-sm text-slate-700 font-semibold flex-1">{l.title}</span>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-emerald-600 font-medium">{l.passed} 通過</span>
                  <span className="text-red-500 font-medium">{l.failed} 未通過</span>
                  <span className="text-slate-400">{l.not_attempted} 未作答</span>
                  <div className="w-28">{passRateBar(l.pass_rate)}</div>
                </div>
              </button>
              {expandedLesson === l.lesson_id && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-2 py-2">
                  {renderUserTable(l.users)}
                </div>
              )}
            </div>
          ))}

          {lessonReport && lessonReport.lessons.length === 0 && (
            <div className="text-slate-400 text-sm py-12 text-center bg-white rounded-xl border border-slate-200">此課程尚無章節測驗紀錄</div>
          )}
        </div>

      ) : tab === 'help-completion' ? (
        <div className="space-y-4">
          {/* Section checkboxes */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText size={14} className="text-sky-600" />
              <span className="text-xs font-semibold text-slate-700">選擇章節</span>
              <button onClick={() => setHelpSelectedSections(new Set(helpSections.map(s => s.section_id)))}
                className="text-[10px] text-sky-600 hover:underline ml-2">全選</button>
              <button onClick={() => setHelpSelectedSections(new Set())}
                className="text-[10px] text-slate-400 hover:underline">清除</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {helpSections.map(s => (
                <label key={s.section_id}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition border ${
                    helpSelectedSections.has(s.section_id)
                      ? 'bg-sky-50 border-sky-300 text-sky-700'
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}>
                  <input type="checkbox" className="w-3.5 h-3.5 rounded accent-sky-600"
                    checked={helpSelectedSections.has(s.section_id)}
                    onChange={() => toggleSection(s.section_id)} />
                  {s.title}
                  <span className="text-[10px] ml-1 font-mono" style={{ color: s.pass_rate >= 80 ? '#16a34a' : s.pass_rate >= 50 ? '#d97706' : '#dc2626' }}>
                    {s.pass_rate}%
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Org filters */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={14} className="text-slate-500" />
              <span className="text-xs font-semibold text-slate-700">組織篩選</span>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              {helpOrgOptions.depts.length > 0 && (
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">部門</label>
                  <select value={helpFilterDept} onChange={e => setHelpFilterDept(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-400 min-w-[120px]">
                    <option value="">全部</option>
                    {helpOrgOptions.depts.map(d => <option key={d.code} value={d.code}>{d.name || d.code}</option>)}
                  </select>
                </div>
              )}
              {helpOrgOptions.profit_centers.length > 0 && (
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">利潤中心</label>
                  <select value={helpFilterPC} onChange={e => setHelpFilterPC(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-400 min-w-[120px]">
                    <option value="">全部</option>
                    {helpOrgOptions.profit_centers.map(d => <option key={d.code} value={d.code}>{d.name || d.code}</option>)}
                  </select>
                </div>
              )}
              {helpOrgOptions.org_sections.length > 0 && (
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">組織段</label>
                  <select value={helpFilterOrgSec} onChange={e => setHelpFilterOrgSec(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-400 min-w-[120px]">
                    <option value="">全部</option>
                    {helpOrgOptions.org_sections.map(d => <option key={d.code} value={d.code}>{d.name || d.code}</option>)}
                  </select>
                </div>
              )}
              {helpOrgOptions.org_groups.length > 0 && (
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">組別</label>
                  <select value={helpFilterOrgGrp} onChange={e => setHelpFilterOrgGrp(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-400 min-w-[120px]">
                    <option value="">全部</option>
                    {helpOrgOptions.org_groups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              )}
              <button onClick={applyHelpFilters}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 text-white hover:bg-sky-700 transition shadow-sm">
                <Search size={12} /> 查詢
              </button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Users} label="篩選人數" value={helpSummary.total} color="text-sky-600" bg="bg-sky-50" />
            <StatCard icon={CheckCircle2} label="全部通過" value={helpSummary.all_passed} color="text-emerald-600" bg="bg-emerald-50" />
            <StatCard icon={Award} label="已測驗" value={helpSummary.some_tested} color="text-amber-600" bg="bg-amber-50" />
            <StatCard icon={MinusCircle} label="未測驗" value={helpSummary.not_tested} color="text-slate-500" bg="bg-slate-50" />
          </div>

          {/* User table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              <div className="relative flex-1 max-w-xs">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="搜尋姓名、工號、部門..." value={helpSearch} onChange={e => setHelpSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-sky-400 text-slate-700" />
              </div>
              <span className="text-xs text-slate-400 ml-auto">共 {filteredHelpUsers.length} 人</span>
              <button onClick={exportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition">
                <Download size={12} /> 匯出 CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="text-left py-2.5 px-3 font-semibold sticky left-0 bg-slate-50 z-10">姓名</th>
                    <th className="text-left py-2.5 px-3 font-semibold">工號</th>
                    <th className="text-left py-2.5 px-3 font-semibold">部門</th>
                    <th className="text-center py-2.5 px-3 font-semibold">通過數</th>
                    {helpSections.filter(s => helpSelectedSections.has(s.section_id)).map(s => (
                      <th key={s.section_id} className="text-center py-2.5 px-2 font-semibold whitespace-nowrap max-w-[100px]" title={s.title}>
                        <span className="block truncate text-[10px]">{s.title}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredHelpUsers.map(u => {
                    const selectedSecs = helpSections.filter(s => helpSelectedSections.has(s.section_id))
                    return (
                      <tr key={u.user_id} className="border-b border-slate-100 hover:bg-sky-50/40 transition">
                        <td className="py-2 px-3 text-slate-700 font-medium sticky left-0 bg-white z-10">{u.name}</td>
                        <td className="py-2 px-3 text-slate-500">{u.employee_id}</td>
                        <td className="py-2 px-3 text-slate-500">{u.dept_name || u.dept_code || '-'}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-mono font-semibold ${u.all_passed ? 'text-emerald-600' : u.passed_count > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                            {u.passed_count}/{u.total_sections}
                          </span>
                        </td>
                        {selectedSecs.map(s => {
                          const st = u.sections[s.section_id]
                          return (
                            <td key={s.section_id} className="py-2 px-2 text-center">
                              {st === 'passed' ? <CheckCircle2 size={14} className="text-emerald-500 mx-auto" /> :
                               st === 'failed' ? <XCircle size={14} className="text-red-400 mx-auto" /> :
                               <span className="text-slate-300">-</span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {filteredHelpUsers.length === 0 && (
              <div className="text-slate-400 text-sm py-12 text-center">無符合條件的資料</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color, bg }: { icon: any; label: string; value: any; color: string; bg: string }) {
  return (
    <div className={`${bg} border border-slate-200 rounded-xl p-5 text-center shadow-sm`}>
      <Icon size={22} className={`${color} mx-auto mb-2`} />
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1 font-medium">{label}</div>
    </div>
  )
}
