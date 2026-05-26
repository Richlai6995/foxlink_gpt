import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { BookOpen, CheckCircle2, Clock, ChevronDown, ChevronUp, FileText, Award, AlertCircle } from 'lucide-react'

interface LessonProgress {
  lesson_id: number
  title: string
  total: number
  viewed: number
  is_mandatory?: number
  lesson_weight?: number
  not_counted?: boolean
}

interface ExamHistory {
  attempt: number
  score: number
  max_score: number
  exam_at: string
  slides?: {
    slide_id: number; block_type: string
    score: number; max_score: number
    weighted_score: number; weighted_max: number
    steps_completed: number; total_steps: number; wrong_clicks: number
    score_breakdown: any; action_log: any[]
  }[]
}

interface CourseScore {
  course_id: number
  course_title: string
  total_score: number
  pass_score: number
  max_attempts: number
  only_count_mandatory?: boolean
  browse_progress: { total: number; viewed: number; pct: number; lessons: LessonProgress[] }
  // 必修完成度(2026-05-26 起與 admin 報表一致)
  mandatory_complete?: boolean
  mandatory_browse_complete?: boolean
  mandatory_browse_total?: number
  mandatory_browse_viewed?: number
  mandatory_exam_complete?: boolean
  mandatory_exam_total?: number
  mandatory_exam_missing?: number
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
  const [expandedSession, setExpandedSession] = useState<string | null>(null) // session_id

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
        // 必修未完成 hint(對齊 admin 報表)
        const mandatoryBits: string[] = []
        if (c.mandatory_browse_complete === false) mandatoryBits.push(t('training.scoring.browseIncomplete') as string)
        if (c.mandatory_exam_complete === false && (c.mandatory_exam_missing || 0) > 0) {
          mandatoryBits.push(t('training.scoring.examMissing', { n: c.mandatory_exam_missing }) as string)
        }
        const showIncompleteHint = mandatoryBits.length > 0

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
                {showIncompleteHint && (
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1 w-fit">
                    <AlertCircle size={11} className="shrink-0" />
                    <span>{t('training.scoring.mandatoryIncomplete')}: {mandatoryBits.join(' / ')}</span>
                  </div>
                )}
              </div>
              {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
            </div>

            {/* Expanded detail */}
            {expanded && (
              <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 space-y-3">
                {/* Lesson browse progress */}
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{t('training.scoring.browseDetail')}</div>
                  {c.browse_progress.lessons.map(l => {
                    const mandatory = (l.is_mandatory ?? 1) === 1
                    return (
                      <div key={l.lesson_id} className={`flex items-center gap-2 text-xs py-0.5 ${l.not_counted ? 'opacity-60' : 'text-slate-600'}`}>
                        {l.viewed >= l.total ? <CheckCircle2 size={11} className="text-green-500" /> : <Clock size={11} className="text-slate-400" />}
                        <span className="flex-1">{l.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                          mandatory ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {mandatory ? t('training.lessonMandatory') : t('training.lessonOptional')}
                        </span>
                        {l.not_counted && (
                          <span className="text-[9px] text-slate-400">{t('training.notCounted')}</span>
                        )}
                        <span className="text-slate-400">{l.viewed}/{l.total}</span>
                      </div>
                    )
                  })}
                </div>

                {/* Exam history with slide details */}
                {c.exam.history.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{t('training.scoring.examHistory')}</div>
                    <div className="space-y-2">
                      {c.exam.history.map((h, i) => {
                        const pct = h.max_score > 0 ? h.score / h.max_score * 100 : 0
                        const sessionKey = `${c.course_id}_${i}`
                        const isExpanded = expandedSession === sessionKey
                        return (
                          <div key={i} className="bg-white rounded-lg border border-slate-100 overflow-hidden">
                            <div className="flex items-center gap-3 text-xs text-slate-600 px-3 py-2 cursor-pointer hover:bg-slate-50"
                              onClick={() => setExpandedSession(isExpanded ? null : sessionKey)}>
                              <span className="font-medium w-8">#{h.attempt}</span>
                              <span className="text-slate-400 flex-1">{formatDate(h.exam_at)}</span>
                              <span className={`font-medium ${pct >= c.pass_score ? 'text-green-600' : 'text-red-500'}`}>
                                {h.score}/{h.max_score}
                              </span>
                              <span>{pct >= c.pass_score ? '✅' : '❌'}</span>
                              {isExpanded ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
                            </div>
                            {isExpanded && h.slides && h.slides.length > 0 && (
                              <div className="border-t border-slate-100 px-3 py-2 bg-slate-50 space-y-1.5">
                                {h.slides.map((s, si) => {
                                  const sPct = s.weighted_max > 0 ? s.weighted_score / s.weighted_max * 100 : 0
                                  const isFullScore = s.weighted_score >= s.weighted_max
                                  return (
                                    <div key={si} className="text-[11px]">
                                      <div className="flex items-center gap-2">
                                        <span className={isFullScore ? 'text-green-600' : sPct >= 80 ? 'text-orange-500' : 'text-red-500'}>
                                          {isFullScore ? '✅' : sPct >= 80 ? '⚠️' : '❌'}
                                        </span>
                                        <span className="text-slate-500">#{si + 1}</span>
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-200 text-slate-600">{s.block_type}</span>
                                        <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                          <div className={`h-full rounded-full ${isFullScore ? 'bg-green-500' : sPct >= 80 ? 'bg-orange-400' : 'bg-red-400'}`}
                                            style={{ width: `${sPct}%` }} />
                                        </div>
                                        <span className={`font-medium ${isFullScore ? 'text-green-600' : 'text-slate-600'}`}>
                                          {s.weighted_score}/{s.weighted_max}
                                        </span>
                                      </div>
                                      {/* Error details */}
                                      {!isFullScore && (
                                        <div className="ml-6 mt-0.5 text-[10px] text-slate-500 space-y-0.5">
                                          {s.steps_completed < s.total_steps && (
                                            <div>{t('training.scoring.stepsIncomplete')}: {s.steps_completed}/{s.total_steps}</div>
                                          )}
                                          {s.wrong_clicks > 0 && (
                                            <div>{t('training.scoring.wrongClicks')}: {s.wrong_clicks}</div>
                                          )}
                                          {s.action_log && s.action_log.filter((a: any) => !a.correct).map((a: any, ai: number) => (
                                            <div key={ai} className="text-red-400">
                                              ✗ {a.label || a.region_label || `${t('training.scoring.clickAt')} (${Math.round(a.x)}, ${Math.round(a.y)})`}
                                              {a.target_label && ` → ${t('training.scoring.shouldBe')} ${a.target_label}`}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
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
      {(() => {
        // 找未完成必修的課程,列出來給學員看為什麼沒及格
        const incompleteCourses = data.courses.filter(c => c.mandatory_complete === false)
        const scorePct = data.program_max > 0 ? (data.program_total / data.program_max) * 100 : 0
        const scoreUnder = !data.program_passed && incompleteCourses.length === 0 && scorePct < data.program_pass_score
        return (
          <div className={`rounded-xl p-4 border-2 ${data.program_passed ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center gap-4">
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
            {!data.program_passed && incompleteCourses.length > 0 && (
              <div className="mt-3 flex items-start gap-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium mb-0.5">{t('training.scoring.whyNotPassed')}</div>
                  <ul className="space-y-0.5">
                    {incompleteCourses.map(c => {
                      const bits: string[] = []
                      if (c.mandatory_browse_complete === false) bits.push(t('training.scoring.browseIncomplete') as string)
                      if (c.mandatory_exam_complete === false && (c.mandatory_exam_missing || 0) > 0) {
                        bits.push(t('training.scoring.examMissing', { n: c.mandatory_exam_missing }) as string)
                      }
                      return <li key={c.course_id}>• {c.course_title}: {bits.join(' / ') || t('training.scoring.mandatoryIncomplete')}</li>
                    })}
                  </ul>
                </div>
              </div>
            )}
            {scoreUnder && (
              <div className="mt-3 flex items-center gap-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{t('training.scoring.scoreUnderPass', { score: Math.round(scorePct), pass: data.program_pass_score })}</span>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
