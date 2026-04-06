import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { BookOpen, CheckCircle2, Clock, ChevronDown, ChevronUp, FileText, Award } from 'lucide-react'

interface LessonProgress {
  lesson_id: number
  title: string
  total: number
  viewed: number
}

interface ExamHistory {
  attempt: number
  score: number
  max_score: number
  exam_at: string
}

interface CourseScore {
  course_id: number
  course_title: string
  total_score: number
  pass_score: number
  max_attempts: number
  browse_progress: { total: number; viewed: number; pct: number; lessons: LessonProgress[] }
  exam: {
    best_score: number; best_max: number
    attempts: number; max_attempts: number
    passed: boolean; weighted_score: number
    history: ExamHistory[]
  }
}

interface ScoreData {
  courses: CourseScore[]
  program_total: number
  program_max: number
  program_pass_score: number
  program_passed: boolean
}

export default function ProgramScorePanel({ programId }: { programId: number }) {
  const { t } = useTranslation()
  const [data, setData] = useState<ScoreData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedCourse, setExpandedCourse] = useState<number | null>(null)

  useEffect(() => {
    api.get(`/training/classroom/programs/${programId}/my-scores`)
      .then(r => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [programId])

  if (loading) return <div className="text-center py-8 text-sm text-slate-400">{t('training.loading')}</div>
  if (!data) return null

  const formatDate = (d: string) => d ? new Date(d).toLocaleString() : '—'

  return (
    <div className="space-y-4">
      {/* Per-course breakdown */}
      {data.courses.map(c => {
        const browsePct = c.browse_progress.pct
        const browseComplete = browsePct === 100
        const hasExam = c.exam.attempts > 0
        const expanded = expandedCourse === c.course_id

        return (
          <div key={c.course_id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Course header */}
            <div className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => setExpandedCourse(expanded ? null : c.course_id)}>
              <BookOpen size={16} className="text-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800">{c.course_title}</div>
                <div className="flex items-center gap-4 mt-1 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    {browseComplete ? <CheckCircle2 size={11} className="text-green-500" /> : <Clock size={11} className="text-blue-500" />}
                    {t('training.scoring.browse')}: {c.browse_progress.viewed}/{c.browse_progress.total} ({browsePct}%)
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText size={11} />
                    {t('training.scoring.exam')}: {hasExam ? `${c.exam.best_score}/${c.exam.best_max}` : '—'}
                    {hasExam && (c.exam.passed
                      ? <span className="text-green-600 font-medium ml-1">→ {c.exam.weighted_score}/{c.total_score}</span>
                      : <span className="text-red-500 font-medium ml-1">✗</span>
                    )}
                  </span>
                  {c.exam.max_attempts > 0 && (
                    <span>{t('training.scoring.attempts')}: {c.exam.attempts}/{c.exam.max_attempts}</span>
                  )}
                </div>
              </div>
              {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
            </div>

            {/* Expanded detail */}
            {expanded && (
              <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 space-y-3">
                {/* Lesson browse progress */}
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{t('training.scoring.browseDetail')}</div>
                  {c.browse_progress.lessons.map(l => (
                    <div key={l.lesson_id} className="flex items-center gap-2 text-xs text-slate-600 py-0.5">
                      {l.viewed >= l.total ? <CheckCircle2 size={11} className="text-green-500" /> : <Clock size={11} className="text-slate-400" />}
                      <span className="flex-1">{l.title}</span>
                      <span className="text-slate-400">{l.viewed}/{l.total}</span>
                    </div>
                  ))}
                </div>

                {/* Exam history */}
                {c.exam.history.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{t('training.scoring.examHistory')}</div>
                    <div className="space-y-1">
                      {c.exam.history.map((h, i) => {
                        const pct = h.max_score > 0 ? h.score / h.max_score * 100 : 0
                        return (
                          <div key={i} className="flex items-center gap-3 text-xs text-slate-600 bg-white px-3 py-1.5 rounded border border-slate-100">
                            <span className="font-medium w-8">#{h.attempt}</span>
                            <span className="text-slate-400 flex-1">{formatDate(h.exam_at)}</span>
                            <span className={`font-medium ${pct >= c.pass_score ? 'text-green-600' : 'text-red-500'}`}>
                              {h.score}/{h.max_score}
                            </span>
                            <span>{pct >= c.pass_score ? '✅' : '❌'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Program total */}
      <div className={`rounded-xl p-4 flex items-center gap-4 border-2 ${data.program_passed ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-200'}`}>
        <Award size={24} className={data.program_passed ? 'text-green-600' : 'text-slate-400'} />
        <div className="flex-1">
          <div className="text-sm font-bold text-slate-800">
            {t('training.scoring.programTotal')}: {data.program_total}/{data.program_max}
          </div>
          <div className="text-xs text-slate-500">
            {t('training.scoring.passLine')}: {data.program_pass_score}
          </div>
        </div>
        <span className={`text-sm font-bold px-3 py-1 rounded-full ${data.program_passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
          {data.program_passed ? t('training.scoring.passed') : t('training.scoring.notPassed')}
        </span>
      </div>
    </div>
  )
}
