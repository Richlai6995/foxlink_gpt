import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { ArrowLeft, BookOpen, Calendar, CheckCircle2, Clock, Play } from 'lucide-react'

interface Assignment {
  id: number
  program_id: number
  course_id: number
  course_title: string
  course_description: string | null
  cover_image: string | null
  status: string
  due_date: string
  started_at: string | null
  completed_at: string | null
  score: number | null
  passed: number | null
  lesson_ids: number[] | null
}

interface ProgramDetail {
  id: number
  title: string
  description: string | null
  purpose: string | null
  start_date: string
  end_date: string
  assignments: Assignment[]
}

export default function ProgramView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [program, setProgram] = useState<ProgramDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadProgram() }, [id])

  const loadProgram = async () => {
    try {
      setLoading(true)
      const res = await api.get(`/training/classroom/programs/${id}`)
      setProgram(res.data)
    } catch (e) {
      console.error('Load program:', e)
    } finally {
      setLoading(false)
    }
  }

  const startAssignment = async (aid: number) => {
    try {
      await api.put(`/training/classroom/assignments/${aid}/start`)
      loadProgram()
    } catch (e) { console.error(e) }
  }

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString() : '—'

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">{t('training.loading')}</div>
  if (!program) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">{t('training.courseNotFound')}</div>

  const completed = program.assignments.filter(a => a.status === 'completed').length
  const total = program.assignments.length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => navigate('/training/classroom')} className="text-slate-400 hover:text-slate-600">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-lg font-bold text-slate-800">{program.title}</h1>
          </div>
          {program.purpose && (
            <p className="text-sm text-slate-500 ml-8">{program.purpose}</p>
          )}
          <div className="flex items-center gap-4 mt-2 ml-8 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Calendar size={12} /> {formatDate(program.start_date)} ~ {formatDate(program.end_date)}
            </span>
            <span className="flex items-center gap-1">
              <BookOpen size={12} /> {completed}/{total} {t('training.classroom.coursesCompleted')}
            </span>
          </div>
        </div>
      </div>

      {/* Course List */}
      <div className="max-w-4xl mx-auto p-6 space-y-3">
        {program.assignments.map(a => {
          const statusIcon = a.status === 'completed'
            ? <CheckCircle2 size={18} className="text-green-500" />
            : a.status === 'in_progress'
              ? <Clock size={18} className="text-blue-500" />
              : <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-300" />

          return (
            <div key={a.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 transition hover:shadow-sm ${
              a.status === 'completed' ? 'border-green-200' : 'border-slate-200'
            }`}>
              {statusIcon}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-slate-800">{a.course_title}</h3>
                {a.course_description && (
                  <p className="text-xs text-slate-400 line-clamp-1">{a.course_description}</p>
                )}
                {a.status === 'completed' && a.score !== null && (
                  <p className="text-xs text-green-600 mt-0.5">
                    {t('training.classroom.score')}: {a.score}
                    {a.passed !== null && (a.passed ? ' ✓' : ' ✗')}
                  </p>
                )}
              </div>
              <div>
                {a.status === 'completed' ? (
                  <span className="text-xs text-green-600 font-medium px-3 py-1.5 bg-green-50 rounded-lg">
                    {t('training.completed')}
                  </span>
                ) : a.status === 'in_progress' ? (
                  <button
                    onClick={() => {
                      const lessonParam = a.lesson_ids ? `&lesson_ids=${a.lesson_ids.join(',')}` : ''
                      navigate(`/training/classroom/course/${a.course_id}/learn?program_id=${program.id}&assignment_id=${a.id}${lessonParam}`)
                    }}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
                    <Play size={13} /> {t('training.continueLearning')}
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      await startAssignment(a.id)
                      const lessonParam = a.lesson_ids ? `&lesson_ids=${a.lesson_ids.join(',')}` : ''
                      navigate(`/training/classroom/course/${a.course_id}/learn?program_id=${program.id}&assignment_id=${a.id}${lessonParam}`)
                    }}
                    className="flex items-center gap-1.5 bg-slate-600 hover:bg-slate-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
                    <Play size={13} /> {t('training.startLearning')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
