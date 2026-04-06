import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { GraduationCap, BookOpen, Calendar, CheckCircle2, Clock, Play, ArrowLeft } from 'lucide-react'

interface ProgramStats {
  total: number
  completed: number
  in_progress: number
  pending: number
}

interface MyProgram {
  id: number
  title: string
  description: string | null
  purpose: string | null
  status: string
  start_date: string
  end_date: string
  stats: ProgramStats
}

export default function TrainingClassroom() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [programs, setPrograms] = useState<MyProgram[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadPrograms() }, [])

  const loadPrograms = async () => {
    try {
      setLoading(true)
      const res = await api.get('/training/classroom/my-programs')
      setPrograms(res.data)
    } catch (e) {
      console.error('Load classroom:', e)
    } finally {
      setLoading(false)
    }
  }

  const active = programs.filter(p => p.status === 'active')
  const completed = programs.filter(p => p.status !== 'active')
  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString() : '—'

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/chat')} className="text-slate-400 hover:text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <GraduationCap className="text-cyan-600" size={24} />
          <h1 className="text-xl font-bold text-slate-800">{t('training.classroom.title')}</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {loading ? (
          <div className="text-center text-slate-400 py-20">{t('training.loading')}</div>
        ) : programs.length === 0 ? (
          <div className="text-center text-slate-400 py-20">
            <GraduationCap size={48} className="mx-auto mb-4 text-slate-300" />
            <p className="text-sm">{t('training.classroom.empty')}</p>
          </div>
        ) : (
          <>
            {/* Active Programs */}
            {active.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
                  <Play size={14} className="text-green-500" /> {t('training.classroom.activeSection')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {active.map(prog => (
                    <ProgramCard key={prog.id} program={prog} navigate={navigate} t={t} formatDate={formatDate} />
                  ))}
                </div>
              </section>
            )}

            {/* Completed Programs */}
            {completed.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-slate-400" /> {t('training.classroom.completedSection')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {completed.map(prog => (
                    <ProgramCard key={prog.id} program={prog} navigate={navigate} t={t} formatDate={formatDate} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ProgramCard({ program: prog, navigate, t, formatDate }: {
  program: MyProgram
  navigate: (path: string) => void
  t: (key: string) => string
  formatDate: (d: string) => string
}) {
  const { stats } = prog
  const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
  const isAllDone = stats.total > 0 && stats.completed === stats.total
  const daysLeft = prog.end_date ? Math.ceil((new Date(prog.end_date).getTime() - Date.now()) / 86400000) : null

  return (
    <div
      onClick={() => navigate(`/training/classroom/program/${prog.id}`)}
      className={`border rounded-xl p-4 cursor-pointer transition hover:shadow-md ${
        isAllDone ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 truncate">{prog.title}</h3>
          {prog.purpose && (
            <p className="text-xs text-slate-500 line-clamp-2 mt-1">{prog.purpose}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Calendar size={11} /> {formatDate(prog.end_date)}
              {daysLeft !== null && daysLeft > 0 && daysLeft <= 7 && (
                <span className="text-orange-500 font-medium"> ({daysLeft}{t('training.classroom.daysLeft')})</span>
              )}
              {daysLeft !== null && daysLeft <= 0 && prog.status === 'active' && (
                <span className="text-red-500 font-medium"> ({t('training.classroom.overdue')})</span>
              )}
            </span>
            <span className="flex items-center gap-1">
              <BookOpen size={11} /> {stats.completed}/{stats.total} {t('training.classroom.coursesCompleted')}
            </span>
          </div>
        </div>

        {/* Progress circle */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none"
                stroke={isAllDone ? '#22c55e' : '#3b82f6'}
                strokeWidth="3" strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round" />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${
              isAllDone ? 'text-green-600' : 'text-blue-600'
            }`}>{pct}%</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${isAllDone ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-2 text-right">
        <span className={`text-xs font-medium ${isAllDone ? 'text-green-600' : 'text-blue-600'}`}>
          {isAllDone ? t('training.classroom.allCompleted') : stats.in_progress > 0 ? t('training.continueLearning') : t('training.startLearning')}
        </span>
      </div>
    </div>
  )
}
