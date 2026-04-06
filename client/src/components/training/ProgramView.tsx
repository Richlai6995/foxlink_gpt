import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { ArrowLeft, BookOpen, Calendar, CheckCircle2, Clock, Play, BarChart3, Lock } from 'lucide-react'
import ProgramScorePanel from './ProgramScorePanel'

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
  lesson_status?: { lesson_id: number; title: string; total: number; viewed: number; done: boolean; locked: boolean }[]
  exam_topics?: { id: number; title: string; total_score: number; time_limit_minutes: number }[]
}

interface ProgramDetail {
  id: number
  title: string
  description: string | null
  purpose: string | null
  start_date: string
  end_date: string
  sequential_lessons?: number
  assignments: Assignment[]
}

export default function ProgramView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [program, setProgram] = useState<ProgramDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'courses' | 'scores'>('courses')

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

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-4xl mx-auto flex gap-1">
          <button onClick={() => setActiveTab('courses')}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${activeTab === 'courses' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t('training.scoring.coursesTab')}
          </button>
          <button onClick={() => setActiveTab('scores')}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition flex items-center gap-1 ${activeTab === 'scores' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <BarChart3 size={12} /> {t('training.scoring.scoresTab')}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Scores tab */}
        {activeTab === 'scores' && (
          <ProgramScorePanel programId={Number(id)} />
        )}

        {/* Courses tab — card style */}
        {activeTab === 'courses' && (
          <div className="space-y-4">
        {program.assignments.map(a => {
          // For sequential mode: only allow unlocked lessons
          const unlockedLessonIds = a.lesson_status
            ? a.lesson_status.filter(l => !l.locked).map(l => l.lesson_id)
            : a.lesson_ids
          const buildLearnUrl = () => {
            const ids = unlockedLessonIds || a.lesson_ids
            const lessonParam = ids ? `&lesson_ids=${ids.join(',')}` : ''
            return `/training/classroom/course/${a.course_id}/learn?program_id=${program.id}&assignment_id=${a.id}${lessonParam}`
          }
          const browseTotal = a.lesson_status?.reduce((s, l) => s + l.total, 0) || 0
          const browseViewed = a.lesson_status?.reduce((s, l) => s + l.viewed, 0) || 0
          const browsePct = browseTotal > 0 ? Math.round(browseViewed / browseTotal * 100) : 0

          return (
            <div key={a.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Course header card */}
              <div className="p-5">
                <div className="flex gap-4">
                  {a.cover_image && (
                    <img src={a.cover_image.startsWith('/') ? a.cover_image : '/' + a.cover_image}
                      className="w-24 h-16 rounded-lg object-cover shrink-0" alt="" />
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-slate-800">{a.course_title}</h3>
                    {a.course_description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.course_description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        {browsePct === 100 ? <CheckCircle2 size={11} className="text-green-500" /> : <Clock size={11} className="text-blue-400" />}
                        {t('training.scoring.browse')}: {browseViewed}/{browseTotal} ({browsePct}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lessons (chapters) */}
              {a.lesson_status && a.lesson_status.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-3">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-2">{t('training.scoring.browseDetail')}</div>
                  <div className="space-y-1">
                    {a.lesson_status.map(ls => (
                      <div key={ls.lesson_id} className={`flex items-center gap-2 text-xs py-1 ${ls.locked ? 'opacity-40' : ''}`}>
                        {ls.locked ? <Lock size={12} className="text-slate-400" />
                          : ls.done ? <CheckCircle2 size={12} className="text-green-500" />
                          : <Clock size={12} className="text-blue-400" />}
                        <span className="flex-1 text-slate-700">{ls.title}</span>
                        <span className="text-slate-400 text-[11px]">{ls.viewed}/{ls.total}</span>
                        {ls.locked && <span className="text-[9px] text-orange-400">{t('training.scoring.locked')}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Exam topics */}
              {a.exam_topics && a.exam_topics.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-3">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-2">{t('training.scoring.examTopics')}</div>
                  <div className="space-y-1">
                    {a.exam_topics.map(et => (
                      <div key={et.id} className="flex items-center gap-2 text-xs py-1">
                        <BookOpen size={12} className="text-orange-400" />
                        <span className="flex-1 text-slate-700">{et.title}</span>
                        <span className="text-slate-400 text-[11px]">{et.total_score}{t('training.scoring.points')} · {et.time_limit_minutes}{t('training.program.editor.minutes')}</span>
                        <button onClick={() => navigate(`/training/classroom/course/${a.course_id}/learn?mode=test&examTopic=${et.id}&program_id=${program.id}&assignment_id=${a.id}`)}
                          className="text-[10px] bg-orange-500 hover:bg-orange-400 text-white px-2 py-0.5 rounded transition">
                          {t('training.scoring.startExam')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-center gap-3 bg-slate-50">
                <button onClick={() => navigate(buildLearnUrl())}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition">
                  <Play size={13} /> {browsePct > 0 ? t('training.continueLearning') : t('training.startLearning')}
                </button>
                {(!a.exam_topics || a.exam_topics.length === 0) && (
                  <button onClick={() => navigate(`/training/classroom/course/${a.course_id}/learn?mode=test&program_id=${program.id}&assignment_id=${a.id}`)}
                    className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg text-xs font-medium transition">
                    <Play size={13} /> {t('training.scoring.practiceExam')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
          </div>
        )}
      </div>
    </div>
  )
}
