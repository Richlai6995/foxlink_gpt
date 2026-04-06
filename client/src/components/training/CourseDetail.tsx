import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import api from '../../lib/api'
import { ArrowLeft, BookOpen, Play, FileText, Clock, CheckCircle2, Lock, ChevronRight } from 'lucide-react'
// ThemePicker is in CourseList only

interface CourseDetail {
  id: number
  title: string
  description: string
  cover_image: string | null
  status: string
  pass_score: number
  max_attempts: number | null
  time_limit_minutes: number | null
  creator_name: string
  category_name: string | null
  permission: string
  lessons: { id: number; title: string; sort_order: number; lesson_type: string }[]
  quiz_count: number
}

export default function CourseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<any[]>([])
  const [examTopics, setExamTopics] = useState<any[]>([])
  const [examHistory, setExamHistory] = useState<any[]>([])

  useEffect(() => {
    if (!id) return
    loadCourse()
  }, [id])

  const loadCourse = async () => {
    try {
      const [courseRes, progressRes, topicsRes, historyRes] = await Promise.all([
        api.get(`/training/courses/${id}`, { params: { lang: i18n.language } }),
        api.get(`/training/courses/${id}/my-progress`),
        api.get(`/training/courses/${id}/exam-topics`).catch(() => ({ data: [] })),
        api.get(`/training/courses/${id}/my-interaction-history`).catch(() => ({ data: { sessions: [] } }))
      ])
      setCourse(courseRes.data)
      setProgress(progressRes.data)
      setExamTopics(topicsRes.data || [])
      setExamHistory(historyRes.data?.sessions || [])
    } catch (e: any) {
      if (e.response?.status === 403) navigate('/training')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">{t('training.loading')}</div>
  if (!course) return <div className="min-h-screen flex items-center justify-center">{t('training.courseNotFound')}</div>

  const lessonProgress = (lessonId: number) => progress.find(p => p.lesson_id === lessonId)
  const canEdit = ['owner', 'admin', 'develop'].includes(course.permission)

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur border-b" style={{ backgroundColor: 'color-mix(in srgb, var(--t-bg) 95%, transparent)', borderColor: 'var(--t-border-subtle)' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => {
            // Smart back: if came from player, go to course list instead of creating a loop
            const canGoBack = window.history.length > 2
            if (canGoBack) {
              // Check if previous URL was learn/quiz to avoid loop
              navigate('/training')
            } else {
              navigate('/training')
            }
          }} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-80">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-semibold truncate">{course.title}</h1>
          <div className="flex-1" />
          {canEdit && (
            <button
              onClick={() => navigate(`/training/dev/courses/${id}`)}
              className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg transition"
            >
              {t('training.editCourse')}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Course Info */}
        <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border-subtle)', boxShadow: 'var(--t-shadow)' }}>
          <div className="flex gap-6">
            <div className="w-48 h-32 rounded-lg bg-gradient-to-br from-sky-900/40 to-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
              {course.cover_image ? (
                <img src={course.cover_image.startsWith('/') ? course.cover_image : '/' + course.cover_image} alt="" className="w-full h-full object-cover" />
              ) : (
                <BookOpen size={40} className="text-sky-500/30" />
              )}
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold">{course.title}</h2>
              {course.description && <p className="text-sm text-slate-400 mt-2">{course.description}</p>}
              <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                <span>{course.creator_name}</span>
                {course.category_name && <span className="bg-slate-700 px-2 py-0.5 rounded">{course.category_name}</span>}
                <span>{course.lessons.length} {t('training.chapters')}</span>
                {course.quiz_count > 0 && <span>{course.quiz_count} {t('training.quizCount')}</span>}
                {course.pass_score > 0 && <span>{t('training.passScore')} {course.pass_score} 分</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Lessons */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">{t('training.courseChapters')}</h3>
          {course.lessons.map((lesson, i) => {
            const lp = lessonProgress(lesson.id)
            return (
              <div
                key={lesson.id}
                className="border rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer transition hover:opacity-90"
                style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border-subtle)' }}
                onClick={() => {
                  // TODO: navigate to player
                }}
              >
                <div className="w-8 h-8 rounded-full bg-sky-600/20 flex items-center justify-center text-sky-400 text-xs font-semibold">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{lesson.title}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {lesson.lesson_type === 'slides' ? t('training.slides') :
                     lesson.lesson_type === 'video' ? t('training.video') :
                     lesson.lesson_type === 'simulation' ? t('training.simulation') : lesson.lesson_type}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {lp?.status === 'completed' ? (
                    <CheckCircle2 size={16} className="text-green-400" />
                  ) : lp?.status === 'in_progress' ? (
                    <Clock size={16} className="text-blue-400" />
                  ) : null}
                  <ChevronRight size={16} className="text-slate-500" />
                </div>
              </div>
            )
          })}
        </div>

      </div>

      {/* Exam Topics */}
      {examTopics.length > 0 && (
        <div className="mt-6 rounded-xl p-4" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--t-text)' }}>📝 {t('training.examTopicList')}</h3>
          <div className="space-y-2">
            {examTopics.map((topic: any) => (
              <div key={topic.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition hover:opacity-90"
                style={{ backgroundColor: 'var(--t-bg)', border: '1px solid var(--t-border)' }}>
                <div className="flex-1">
                  <div className="text-xs font-medium" style={{ color: 'var(--t-text)' }}>{topic.title}</div>
                  <div className="text-[10px] flex gap-2 mt-0.5" style={{ color: 'var(--t-text-dim)' }}>
                    <span>{topic.total_score} {t('training.examPoints')}</span>
                    <span>⏱ {topic.time_limit_enabled ? `${topic.time_limit_minutes} min` : '∞'}</span>
                    <span>{(topic.lessons || []).length} {t('training.chaptersIncluded')}</span>
                  </div>
                </div>
                <button onClick={() => navigate(`/training/course/${id}/learn?mode=test&examTopic=${topic.id}`)}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-white transition"
                  style={{ backgroundColor: '#f59e0b' }}>
                  <Play size={12} /> {t('training.startExam')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Exam History */}
      {examHistory.length > 0 && (
        <div className="mt-6 rounded-xl p-4" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--t-text)' }}>📊 {t('training.myExamHistory')}</h3>
          <div className="space-y-1.5">
            {examHistory.map((s: any, idx: number) => {
              const pct = s.total_max > 0 ? Math.round((s.total_score / s.total_max) * 100) : 0
              return (
                <div key={s.session_id} className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs"
                  style={{ backgroundColor: 'var(--t-bg)', border: '1px solid var(--t-border)' }}>
                  <span style={{ color: 'var(--t-text-dim)' }}>#{examHistory.length - idx}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px]" style={{
                    backgroundColor: s.player_mode === 'test' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                    color: s.player_mode === 'test' ? '#f59e0b' : '#3b82f6'
                  }}>{s.player_mode === 'test' ? '📝' : '📖'} {s.player_mode}</span>
                  {s.exam_topic_title && <span style={{ color: 'var(--t-text)' }}>{s.exam_topic_title}</span>}
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                  <span className="font-bold min-w-[50px] text-right" style={{ color: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444' }}>
                    {s.total_score}/{s.total_max}
                  </span>
                  <span style={{ color: 'var(--t-text-dim)' }}>{s.total_time}s</span>
                  <span className="min-w-[120px] text-right" style={{ color: 'var(--t-text-dim)' }}>
                    {s.started_at ? new Date(s.started_at).toLocaleString() : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Start / Continue button — sticky bottom */}
      <div className="sticky bottom-0 z-10 py-4 flex justify-center gap-3"
        style={{ background: 'linear-gradient(transparent, var(--t-bg) 30%)' }}>
        <button
          onClick={() => navigate(`/training/course/${id}/learn`)}
          className="flex items-center gap-2 text-white px-10 py-3 rounded-xl text-sm font-semibold transition shadow-lg"
          style={{ backgroundColor: 'var(--t-accent-bg)', boxShadow: '0 4px 14px rgba(37,99,235,0.3)' }}
        >
          <Play size={18} />
          {progress.some(p => p.status === 'in_progress') ? `📖 ${t('training.continueLearning')}` : `📖 ${t('training.startLearning')}`}
        </button>
        <button
          onClick={() => navigate(`/training/course/${id}/learn?mode=test`)}
          className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold transition shadow-lg"
          style={{ backgroundColor: '#f59e0b', color: 'white', boxShadow: '0 4px 14px rgba(245,158,11,0.3)' }}
        >
          <Play size={18} />
          📝 {t('training.practiceTest')}
        </button>
      </div>
    </div>
  )
}
