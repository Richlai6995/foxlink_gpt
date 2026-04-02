import { useState, useEffect } from 'react'
import api from '../../lib/api'
import { BarChart3, Users, BookOpen, Award, TrendingUp } from 'lucide-react'

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

export default function TrainingAdmin() {
  const [tab, setTab] = useState<'overview' | 'courses' | 'users'>('overview')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [courseReports, setCourseReports] = useState<CourseReport[]>([])
  const [userReports, setUserReports] = useState<UserReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [tab])

  const loadData = async () => {
    try {
      setLoading(true)
      if (tab === 'overview') {
        const res = await api.get('/training/admin/reports/overview')
        setOverview(res.data)
      } else if (tab === 'courses') {
        const res = await api.get('/training/admin/reports/by-course')
        setCourseReports(res.data)
      } else {
        const res = await api.get('/training/admin/reports/by-user')
        setUserReports(res.data)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[
          { key: 'overview', label: '總覽', icon: BarChart3 },
          { key: 'courses', label: '依課程', icon: BookOpen },
          { key: 'users', label: '依使用者', icon: Users },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              tab === t.key ? 'bg-sky-600/20 text-sky-400' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm py-8 text-center">載入中...</div>
      ) : tab === 'overview' && overview ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard icon={BookOpen} label="已發佈課程" value={overview.total_courses} color="text-sky-400" />
          <StatCard icon={Users} label="學習人數" value={overview.active_learners} color="text-green-400" />
          <StatCard icon={Award} label="完成次數" value={overview.completions} color="text-purple-400" />
          <StatCard icon={TrendingUp} label="平均分數" value={overview.avg_score} color="text-amber-400" />
          <StatCard icon={Award} label="通過率" value={`${overview.pass_rate}%`} color="text-emerald-400" />
        </div>
      ) : tab === 'courses' ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <th className="text-left py-2">課程</th>
              <th className="text-right py-2">學習人數</th>
              <th className="text-right py-2">完成數</th>
              <th className="text-right py-2">平均分數</th>
            </tr>
          </thead>
          <tbody>
            {courseReports.map(r => (
              <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                <td className="py-2 text-slate-200">{r.title}</td>
                <td className="py-2 text-right">{r.learners}</td>
                <td className="py-2 text-right">{r.completions}</td>
                <td className="py-2 text-right">{r.avg_score != null ? Math.round(r.avg_score) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <th className="text-left py-2">姓名</th>
              <th className="text-left py-2">工號</th>
              <th className="text-left py-2">部門</th>
              <th className="text-right py-2">已開始</th>
              <th className="text-right py-2">已完成</th>
              <th className="text-right py-2">平均分數</th>
            </tr>
          </thead>
          <tbody>
            {userReports.map(r => (
              <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                <td className="py-2 text-slate-200">{r.name}</td>
                <td className="py-2 text-slate-400">{r.employee_id}</td>
                <td className="py-2 text-slate-400">{r.dept_code}</td>
                <td className="py-2 text-right">{r.courses_started}</td>
                <td className="py-2 text-right">{r.courses_completed}</td>
                <td className="py-2 text-right">{r.avg_score != null ? Math.round(r.avg_score) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
      <Icon size={20} className={`${color} mx-auto mb-1.5`} />
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}
