import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { ArrowLeft, ChevronLeft, ChevronRight, Volume2, VolumeX, BookmarkPlus, MessageSquare, X, List, Clock, RotateCcw, ChevronDown, ChevronRight as ChevronR } from 'lucide-react'
import SlideRenderer from './SlideRenderer'

interface Slide {
  id: number
  lesson_id: number
  slide_type: string
  content_json: string
  audio_url: string | null
  notes: string | null
  sort_order: number
}

interface Lesson {
  id: number
  title: string
  sort_order: number
  lesson_type: string
}

// Scorable block types
const SCORABLE_TYPES = new Set(['hotspot', 'dragdrop', 'quiz_inline'])

function hasScorableBlock(slide: Slide): boolean {
  try {
    const blocks = JSON.parse(slide.content_json || '[]')
    return blocks.some((b: any) => SCORABLE_TYPES.has(b.type))
  } catch { return false }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exam result per slide
// ═══════════════════════════════════════════════════════════════════════════════
interface SlideResult {
  slideId: number
  slideIndex: number
  rawScore: number
  rawMax: number
  weightedScore: number
  weightedMax: number
  actionLog?: any[]
  scoreBreakdown?: any
  blockType?: string
  completed: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// CoursePlayerInner — shared core
// ═══════════════════════════════════════════════════════════════════════════════

interface ExamTopicConfig {
  id: number
  title: string
  total_score: number
  pass_score: number
  time_limit_minutes: number
  time_limit_enabled: number
  overtime_action: string
  scoring_mode: string
  custom_weights: Record<string, number>
  lessons: { lesson_id: number }[]
}

interface CoursePlayerInnerProps {
  courseId: number
  lessonId?: number | null
  lang?: string
  sessionId?: string
  skipAccessCheck?: boolean
  onClose: () => void
  initialMode?: 'learn' | 'test'
  examTopicId?: number | null   // if set, use exam topic config instead of course settings
}

export function CoursePlayerInner({ courseId, lessonId, lang: langProp, sessionId, skipAccessCheck, onClose, initialMode = 'learn', examTopicId }: CoursePlayerInnerProps) {
  const { t, i18n } = useTranslation()
  const [course, setCourse] = useState<any>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [allSlides, setAllSlides] = useState<Slide[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [audioMuted, setAudioMuted] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [showTutor, setShowTutor] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [tutorMessages, setTutorMessages] = useState<{ role: string; content: string }[]>([])
  const [tutorInput, setTutorInput] = useState('')
  const [tutorLoading, setTutorLoading] = useState(false)
  const [playerMode, setPlayerMode] = useState<'learn' | 'test'>(initialMode)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [scoreToast, setScoreToast] = useState<{ score: number; max: number; label: string } | null>(null)

  // ─── Exam topic override ───
  const [examTopic, setExamTopic] = useState<ExamTopicConfig | null>(null)

  // ─── Exam state ───
  const [examPhase, setExamPhase] = useState<'idle' | 'start' | 'running' | 'result'>('idle')
  const [examTimeLeft, setExamTimeLeft] = useState(0)
  const [examStartTime, setExamStartTime] = useState(0)
  const [examResults, setExamResults] = useState<SlideResult[]>([])
  const [expandedResult, setExpandedResult] = useState<number | null>(null)
  const examTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const examResultsRef = useRef<SlideResult[]>([])
  // Interactive slide indices (for test mode auto-advance)
  const interactiveIndices = useMemo(() =>
    allSlides.map((s, i) => hasScorableBlock(s) ? i : -1).filter(i => i >= 0)
  , [allSlides])

  const lang = langProp || i18n.language

  useEffect(() => { loadCourseForPlayer() }, [courseId, lang])

  const loadCourseForPlayer = async () => {
    try {
      const params: any = { lang }
      if (skipAccessCheck) params.help = '1'
      const courseRes = await api.get(`/training/courses/${courseId}`, { params })
      setCourse(courseRes.data)

      // Load exam topic if specified
      let topicLessonIds: number[] | null = null
      if (examTopicId) {
        try {
          const topicsRes = await api.get(`/training/courses/${courseId}/exam-topics`, { params: skipAccessCheck ? { help: '1' } : {} })
          const topic = (topicsRes.data as ExamTopicConfig[]).find(t => t.id === examTopicId)
          if (topic) {
            setExamTopic(topic)
            topicLessonIds = topic.lessons.map(l => l.lesson_id)
          }
        } catch {}
      }

      const courseLessons: Lesson[] = courseRes.data.lessons || []
      let targetLessons = lessonId ? courseLessons.filter(l => l.id === lessonId) : courseLessons
      // Filter by exam topic lessons
      if (topicLessonIds) {
        targetLessons = targetLessons.filter(l => topicLessonIds!.includes(l.id))
      }
      setLessons(targetLessons)

      const slides: Slide[] = []
      for (const lesson of targetLessons) {
        const slideParams: any = { lang }
        if (skipAccessCheck) slideParams.help = '1'
        const res = await api.get(`/training/lessons/${lesson.id}/slides`, { params: slideParams })
        slides.push(...res.data)
      }
      setAllSlides(slides)
      setCurrentIdx(0)

      api.post(`/training/courses/${courseId}/progress`, { status: 'in_progress' }).catch(() => {})
    } catch (e) {
      console.error(e)
      onClose()
    }
  }

  // ─── Exam config helpers (exam topic overrides course defaults) ───
  const examConfig = examTopic || course?.settings_json?.exam || {}
  const examTotalScore = examConfig.total_score || 100
  const examPassScore = examTopic?.pass_score || course?.pass_score || 60
  const examTimeLimit = examConfig.time_limit_minutes || 10
  const examTimeLimitEnabled = examConfig.time_limit_enabled !== false && examConfig.time_limit_enabled !== 0
  const examOvertimeAction = examConfig.overtime_action || 'auto_submit'
  const examScoringMode = examConfig.scoring_mode || 'even'
  const examCustomWeights = (typeof examConfig.custom_weights === 'string' ? JSON.parse(examConfig.custom_weights || '{}') : examConfig.custom_weights) || {}

  // Calculate per-slide weight
  const getSlideWeight = useCallback((slideId: number, interactiveCount: number) => {
    if (examScoringMode === 'custom' && examCustomWeights[`slide_${slideId}`] !== undefined) {
      return examCustomWeights[`slide_${slideId}`]
    }
    return interactiveCount > 0 ? Math.round(examTotalScore / interactiveCount) : 0
  }, [examScoringMode, examCustomWeights, examTotalScore])

  const currentSlide = allSlides[currentIdx]
  const currentLesson = currentSlide ? lessons.find(l => l.id === currentSlide.lesson_id) : null

  // Auto-play audio
  useEffect(() => {
    if (!currentSlide?.audio_url || !audioRef.current || audioMuted) return
    try {
      const blocks = JSON.parse(currentSlide.content_json || '[]')
      if (blocks.some((b: any) => b.type === 'hotspot')) return
    } catch {}
    audioRef.current.src = currentSlide.audio_url
    audioRef.current.play().catch(() => {})
  }, [currentIdx, currentSlide?.audio_url, audioMuted])

  const goNext = () => { if (currentIdx < allSlides.length - 1) setCurrentIdx(currentIdx + 1) }
  const goPrev = () => { if (currentIdx > 0) setCurrentIdx(currentIdx - 1) }

  // Keyboard nav (learn mode only)
  useEffect(() => {
    if (examPhase === 'running' || examPhase === 'result') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIdx, allSlides.length, examPhase])

  // ─── Exam timer ───
  useEffect(() => {
    if (examPhase === 'running' && examTimeLimitEnabled) {
      examTimerRef.current = setInterval(() => {
        setExamTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(examTimerRef.current!)
            if (examOvertimeAction === 'auto_submit') {
              finishExam()
            }
            return 0
          }
          return prev - 1
        })
      }, 1000)
      return () => { if (examTimerRef.current) clearInterval(examTimerRef.current) }
    }
  }, [examPhase, examTimeLimitEnabled])

  // Switch to test mode → show start screen
  useEffect(() => {
    if (playerMode === 'test' && examPhase === 'idle' && allSlides.length > 0) {
      setExamPhase('start')
    }
    if (playerMode === 'learn') {
      setExamPhase('idle')
      if (examTimerRef.current) clearInterval(examTimerRef.current)
    }
  }, [playerMode, allSlides.length])

  // ─── Start exam ───
  const startExam = () => {
    setExamResults([])
    examResultsRef.current = []
    setExamStartTime(Date.now())
    setExamTimeLeft(examTimeLimit * 60)
    setExamPhase('running')
    // Jump to first interactive slide
    if (interactiveIndices.length > 0) {
      setCurrentIdx(interactiveIndices[0])
    }
  }

  // ─── Finish exam ───
  const finishExam = useCallback(() => {
    if (examTimerRef.current) clearInterval(examTimerRef.current)
    setExamPhase('result')
    setExamResults([...examResultsRef.current])
  }, [])

  // ─── Restart exam ───
  const restartExam = () => {
    setExamResults([])
    examResultsRef.current = []
    setExpandedResult(null)
    setExamPhase('start')
  }

  // Notes
  const saveNote = async () => {
    if (!currentSlide || !noteText.trim()) return
    await api.post('/training/notes', { course_id: courseId, slide_id: currentSlide.id, content: noteText, bookmarked: false }).catch(() => {})
  }

  // AI Tutor
  const sendTutorMessage = async () => {
    if (!tutorInput.trim() || tutorLoading) return
    const msg = tutorInput.trim()
    setTutorInput('')
    setTutorMessages(prev => [...prev, { role: 'user', content: msg }])
    try {
      setTutorLoading(true)
      const res = await api.post(`/training/courses/${courseId}/ai-tutor`, { message: msg, lesson_id: currentSlide?.lesson_id, slide_id: currentSlide?.id })
      setTutorMessages(prev => [...prev, { role: 'assistant', content: res.data.answer }])
    } catch {
      setTutorMessages(prev => [...prev, { role: 'assistant', content: t('training.aiTutorError') }])
    } finally { setTutorLoading(false) }
  }

  // ─── Interaction complete handler ───
  const handleInteractionComplete = useCallback(async (slideId: number, result: any) => {
    try {
      const res = await api.post(`/training/slides/${slideId}/interaction-result`, {
        ...result,
        player_mode: playerMode,
        session_id: sessionId || null,
        exam_topic_id: examTopic?.id || examTopicId || null
      })

      if (playerMode === 'test' && examPhase === 'running' && res.data?.score !== undefined) {
        const rawScore = res.data.score
        const rawMax = res.data.max_score
        const ratio = rawMax > 0 ? rawScore / rawMax : 0
        const weight = getSlideWeight(slideId, interactiveIndices.length)
        const weightedScore = Math.round(ratio * weight)

        // Find which interactive question # this is
        const slideIdx = allSlides.findIndex(s => s.id === slideId)
        const questionNum = interactiveIndices.indexOf(slideIdx) + 1

        const sr: SlideResult = {
          slideId, slideIndex: slideIdx,
          rawScore, rawMax,
          weightedScore, weightedMax: weight,
          actionLog: result.action_log,
          scoreBreakdown: res.data.score_breakdown,
          blockType: result.block_type,
          completed: true
        }
        examResultsRef.current = [...examResultsRef.current, sr]

        // Toast with weighted score
        setScoreToast({ score: weightedScore, max: weight, label: `${t('training.examQuestion')} ${questionNum}` })
        setTimeout(() => setScoreToast(null), 3000)

        // Auto-advance to next interactive slide after delay
        setTimeout(() => {
          const currentInteractiveIdx = interactiveIndices.indexOf(slideIdx)
          if (currentInteractiveIdx < interactiveIndices.length - 1) {
            setCurrentIdx(interactiveIndices[currentInteractiveIdx + 1])
          } else {
            // All done
            finishExam()
          }
        }, 2000)
      } else if (playerMode === 'learn') {
        // Learn mode: no toast, just record
      }
    } catch (e) {
      console.error('[CoursePlayer] interaction-result submit:', e)
    }
  }, [playerMode, sessionId, examPhase, interactiveIndices, allSlides, getSlideWeight, finishExam, t])

  // Format seconds to mm:ss
  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  if (!course || allSlides.length === 0) {
    return <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Exam Start Screen
  // ═══════════════════════════════════════════════════════════════════════════════
  if (examPhase === 'start') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
          <div className="text-4xl mb-4">📝</div>
          <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--t-text)' }}>{examTopic?.title || course.title}</h2>
          {examTopic && <p className="text-xs mb-2" style={{ color: 'var(--t-text-dim)' }}>{course.title}</p>}
          <div className="space-y-2 mb-6 text-sm" style={{ color: 'var(--t-text-secondary)' }}>
            <p>📊 {t('training.examTotalScore')}: <strong>{examTotalScore} {t('training.examPoints')}</strong></p>
            <p>📋 {t('training.examQuestionCount')}: <strong>{interactiveIndices.length} {t('training.examQuestions')}</strong></p>
            {examTimeLimitEnabled && (
              <p>⏱ {t('training.examTimeLimit')}: <strong>{examTimeLimit} {t('training.examMinutes')}</strong></p>
            )}
            <p>✅ {t('training.examPassScore')}: <strong>{examPassScore} {t('training.examPoints')}</strong></p>
          </div>
          <div className="text-xs mb-6 px-4 py-3 rounded-lg text-left space-y-1" style={{ backgroundColor: 'var(--t-bg-inset)', color: 'var(--t-text-dim)' }}>
            <p>• {t('training.examHint1')}</p>
            <p>• {t('training.examHint2')}</p>
            {examTimeLimitEnabled && <p>• {examOvertimeAction === 'auto_submit' ? t('training.examHint3Auto') : t('training.examHint3Warn')}</p>}
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={() => setPlayerMode('learn')} className="px-4 py-2 text-xs rounded-lg transition"
              style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
              {t('training.backToLearn')}
            </button>
            <button onClick={startExam}
              className="px-6 py-2 text-sm font-medium text-white rounded-lg transition bg-orange-500 hover:bg-orange-400">
              ▶ {t('training.startExam')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Exam Result Screen
  // ═══════════════════════════════════════════════════════════════════════════════
  if (examPhase === 'result') {
    const totalWeighted = examResults.reduce((s, r) => s + r.weightedScore, 0)
    const totalWeightedMax = examResults.reduce((s, r) => s + r.weightedMax, 0)
    // Fill in missing slides (not completed = 0)
    const allResultsMap = new Map(examResults.map(r => [r.slideIndex, r]))
    const fullResults: SlideResult[] = interactiveIndices.map((idx, i) => {
      const existing = allResultsMap.get(idx)
      if (existing) return existing
      return {
        slideId: allSlides[idx].id, slideIndex: idx,
        rawScore: 0, rawMax: 0, weightedScore: 0,
        weightedMax: getSlideWeight(allSlides[idx].id, interactiveIndices.length),
        completed: false, blockType: 'unknown'
      }
    })
    const totalFinalMax = fullResults.reduce((s, r) => s + r.weightedMax, 0)
    const passed = totalWeighted >= examPassScore
    const elapsedSec = Math.round((Date.now() - examStartTime) / 1000)

    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg mx-auto">
          {/* Summary */}
          <div className="rounded-2xl p-6 text-center mb-6" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
            <div className="text-5xl mb-2">{passed ? '🏆' : '📝'}</div>
            <div className="text-3xl font-bold mb-1" style={{ color: passed ? '#22c55e' : '#ef4444' }}>
              {totalWeighted} / {totalFinalMax}
            </div>
            <div className="text-sm mb-3" style={{ color: 'var(--t-text-dim)' }}>
              ⏱ {fmtTime(elapsedSec)} / {examTimeLimitEnabled ? fmtTime(examTimeLimit * 60) : '∞'}
            </div>
            <span className={`text-xs font-medium px-3 py-1 rounded-full ${passed ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {passed ? `✅ ${t('training.examPassed')}` : `❌ ${t('training.examFailed')}`}
              {` (${t('training.examPassScore')}: ${examPassScore})`}
            </span>
          </div>

          {/* Per-slide results */}
          <div className="space-y-2">
            {fullResults.map((r, i) => {
              const pct = r.weightedMax > 0 ? Math.round((r.weightedScore / r.weightedMax) * 100) : 0
              const isFull = pct === 100
              const isZero = pct === 0
              const isExpanded = expandedResult === i

              return (
                <div key={i} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--t-border)' }}>
                  <button onClick={() => setExpandedResult(isExpanded ? null : i)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition hover:opacity-90"
                    style={{ backgroundColor: 'var(--t-bg-card)' }}>
                    <span className="text-lg">{isFull ? '✅' : isZero ? '❌' : '⚠️'}</span>
                    <span className="text-xs font-medium flex-1" style={{ color: 'var(--t-text)' }}>
                      #{i + 1} {r.blockType && <span className="text-[10px] px-1 py-0.5 rounded bg-sky-500/15 text-sky-400 ml-1">{r.blockType}</span>}
                    </span>
                    <div className="w-24 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
                      <div className="h-full rounded-full" style={{
                        width: `${pct}%`,
                        backgroundColor: isFull ? '#22c55e' : isZero ? '#ef4444' : '#f59e0b'
                      }} />
                    </div>
                    <span className="text-sm font-bold min-w-[50px] text-right" style={{
                      color: isFull ? '#22c55e' : isZero ? '#ef4444' : '#f59e0b'
                    }}>
                      {r.weightedScore}/{r.weightedMax}
                    </span>
                    {!isFull && <span style={{ color: 'var(--t-text-dim)' }}>{isExpanded ? <ChevronDown size={14} /> : <ChevronR size={14} />}</span>}
                  </button>

                  {/* Error analysis */}
                  {isExpanded && !isFull && (
                    <div className="px-4 pb-3 text-xs space-y-2" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text-secondary)' }}>
                      {!r.completed && (
                        <p className="text-red-400">⏱ {t('training.examNotCompleted')}</p>
                      )}
                      {r.blockType === 'hotspot' && r.actionLog && (
                        <>
                          <p>{t('training.examAnalysisSteps')}: {r.scoreBreakdown?.steps?.detail || '-'}</p>
                          <p>{t('training.examAnalysisWrong')}: {r.scoreBreakdown?.efficiency?.detail || '-'}</p>
                          <div className="mt-1 space-y-0.5">
                            {(r.actionLog as any[]).filter(a => !a.correct).slice(0, 5).map((a, j) => (
                              <p key={j} className="text-red-300">
                                ❌ {t('training.examClickedAt')} ({a.click_coords?.x?.toFixed(0)}, {a.click_coords?.y?.toFixed(0)})
                                {a.region_id ? ` → ${a.region_id}` : ` → ${t('training.examMissed')}`}
                              </p>
                            ))}
                          </div>
                        </>
                      )}
                      {r.blockType === 'dragdrop' && r.scoreBreakdown && (
                        <p>{t('training.examCorrectCount')}: {r.scoreBreakdown.correct_positions?.detail || r.scoreBreakdown.correct_matches?.detail || '-'}</p>
                      )}
                      {r.blockType === 'quiz_inline' && r.scoreBreakdown && (
                        <p>{r.scoreBreakdown.correct ? `✅ ${t('training.answerCorrect')}` : `❌ ${t('training.answerWrong')}`}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex justify-center gap-3 mt-6">
            <button onClick={restartExam}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition bg-orange-500 hover:bg-orange-400 text-white">
              <RotateCcw size={13} /> {t('training.retakeExam')}
            </button>
            <button onClick={onClose}
              className="px-4 py-2 text-xs rounded-lg transition"
              style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
              {t('training.backToCourse')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Normal player / Exam running
  // ═══════════════════════════════════════════════════════════════════════════════
  return (
    <>
      {/* Top bar */}
      <div className="backdrop-blur border-b px-4 py-2 flex items-center gap-3 shrink-0 z-10"
        style={{ backgroundColor: 'var(--t-bg-elevated)', borderColor: 'var(--t-border)' }}>
        <button onClick={onClose} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-70">
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-medium truncate" style={{ color: 'var(--t-text)' }}>{course.title}</span>
        {currentLesson && (
          <span className="text-xs" style={{ color: 'var(--t-text-dim)' }}>— {currentLesson.title}</span>
        )}
        <div className="flex-1" />

        {/* Countdown timer (exam running) */}
        {examPhase === 'running' && examTimeLimitEnabled && (
          <div className={`flex items-center gap-1 text-sm font-mono font-bold px-2 py-0.5 rounded ${examTimeLeft < 120 ? 'text-red-400 animate-pulse' : ''}`}
            style={{ color: examTimeLeft >= 120 ? 'var(--t-accent)' : undefined }}>
            <Clock size={14} /> {fmtTime(examTimeLeft)}
          </div>
        )}

        {/* Mode toggle (disabled during exam) */}
        <div className="flex items-center rounded-lg overflow-hidden border" style={{ borderColor: 'var(--t-border)' }}>
          <button onClick={() => { if (examPhase !== 'running') setPlayerMode('learn') }}
            disabled={examPhase === 'running'}
            className="text-[10px] px-2.5 py-1 font-medium transition disabled:opacity-50"
            style={{
              backgroundColor: playerMode === 'learn' ? 'var(--t-accent-bg, #3b82f6)' : 'transparent',
              color: playerMode === 'learn' ? 'white' : 'var(--t-text-dim)'
            }}>
            📖 {t('training.learn')}
          </button>
          <button onClick={() => { if (examPhase !== 'running') setPlayerMode('test') }}
            disabled={examPhase === 'running'}
            className="text-[10px] px-2.5 py-1 font-medium transition disabled:opacity-50"
            style={{
              backgroundColor: playerMode === 'test' ? '#f59e0b' : 'transparent',
              color: playerMode === 'test' ? 'white' : 'var(--t-text-dim)'
            }}>
            📝 {t('training.test')}
          </button>
        </div>
        {examPhase !== 'running' && (
          <>
            <button onClick={() => setShowOutline(!showOutline)} style={{ color: showOutline ? 'var(--t-accent)' : 'var(--t-text-muted)' }} className="hover:opacity-70" title={t('training.outline')}>
              <List size={16} />
            </button>
            <button onClick={() => setAudioMuted(!audioMuted)} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-70" title={t('training.audio')}>
              {audioMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <button onClick={() => setShowNotes(!showNotes)} style={{ color: showNotes ? 'var(--t-accent)' : 'var(--t-text-muted)' }} className="hover:opacity-70" title={t('training.notes')}>
              <BookmarkPlus size={16} />
            </button>
            <button onClick={() => setShowTutor(!showTutor)} style={{ color: showTutor ? 'var(--t-accent)' : 'var(--t-text-muted)' }} className="hover:opacity-70" title={t('training.aiTutor')}>
              <MessageSquare size={16} />
            </button>
          </>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Outline sidebar */}
        {showOutline && examPhase !== 'running' && (
          <div className="w-56 border-r overflow-y-auto shrink-0 p-3" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
            <h4 className="text-[10px] font-semibold uppercase mb-2" style={{ color: 'var(--t-text-dim)' }}>{t('training.outline')}</h4>
            {lessons.map(lesson => {
              const lessonSlides = allSlides.filter(s => s.lesson_id === lesson.id)
              return (
                <div key={lesson.id} className="mb-2">
                  <div className="text-xs font-medium mb-1" style={{ color: 'var(--t-text)' }}>{lesson.title}</div>
                  {lessonSlides.map(slide => {
                    const idx = allSlides.indexOf(slide)
                    return (
                      <button key={slide.id}
                        onClick={() => { setCurrentIdx(idx); setShowOutline(false) }}
                        className="w-full text-left text-[10px] px-2 py-1 rounded transition"
                        style={{
                          backgroundColor: idx === currentIdx ? 'var(--t-accent-subtle)' : 'transparent',
                          color: idx === currentIdx ? 'var(--t-accent)' : 'var(--t-text-dim)'
                        }}
                      >
                        {idx + 1}. {slide.slide_type}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* Slide content */}
        <div className="flex-1 overflow-y-auto flex items-start justify-center px-6 py-4" style={{ backgroundColor: 'var(--t-bg)' }}>
          <div className="w-full max-w-7xl">
            <SlideRenderer slide={currentSlide} isLastSlide={currentIdx === allSlides.length - 1} playerMode={playerMode} audioMuted={audioMuted} onInteractionComplete={handleInteractionComplete} />
          </div>
        </div>

        {/* Notes panel */}
        {showNotes && examPhase !== 'running' && (
          <div className="w-72 border-l p-3 flex flex-col shrink-0" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold" style={{ color: 'var(--t-text-muted)' }}>{t('training.notes')}</h4>
              <button onClick={() => setShowNotes(false)} style={{ color: 'var(--t-text-dim)' }}><X size={14} /></button>
            </div>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={6}
              className="w-full border rounded text-xs px-2 py-1.5 resize-none focus:outline-none flex-1"
              style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
              placeholder={t('training.notesPlaceholder')} />
            <button onClick={saveNote} className="mt-2 text-xs text-white px-3 py-1.5 rounded transition"
              style={{ backgroundColor: 'var(--t-accent-bg)' }}>{t('training.saveNotes')}</button>
          </div>
        )}

        {/* AI Tutor panel */}
        {showTutor && examPhase !== 'running' && (
          <div className="w-80 border-l flex flex-col shrink-0" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--t-border)' }}>
              <h4 className="text-xs font-semibold" style={{ color: 'var(--t-accent)' }}>{t('training.aiTutor')}</h4>
              <button onClick={() => setShowTutor(false)} style={{ color: 'var(--t-text-dim)' }}><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {tutorMessages.length === 0 && <p className="text-xs text-center py-8" style={{ color: 'var(--t-text-dim)' }}>{t('training.aiTutorEmpty')}</p>}
              {tutorMessages.map((msg, i) => (
                <div key={i} className={`text-xs rounded-lg px-3 py-2 ${msg.role === 'user' ? 'ml-4' : 'mr-4'}`}
                  style={{ backgroundColor: msg.role === 'user' ? 'var(--t-accent-subtle)' : 'var(--t-bg-card)', color: 'var(--t-text-secondary)' }}>
                  {msg.content}
                </div>
              ))}
              {tutorLoading && <div className="text-xs animate-pulse" style={{ color: 'var(--t-text-dim)' }}>{t('training.aiThinking')}</div>}
            </div>
            <div className="border-t p-2 flex gap-2" style={{ borderColor: 'var(--t-border)' }}>
              <input value={tutorInput} onChange={e => setTutorInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendTutorMessage()}
                className="flex-1 border rounded px-2 py-1.5 text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder={t('training.inputQuestion')} />
              <button onClick={sendTutorMessage} disabled={tutorLoading}
                className="text-white px-2 py-1 rounded text-xs disabled:opacity-50"
                style={{ backgroundColor: 'var(--t-accent-bg)' }}>{t('training.send')}</button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="backdrop-blur border-t px-4 py-2 flex items-center gap-4 shrink-0"
        style={{ backgroundColor: 'var(--t-bg-elevated)', borderColor: 'var(--t-border)' }}>
        <button onClick={goPrev} disabled={currentIdx === 0 || examPhase === 'running'}
          className="disabled:opacity-30 hover:opacity-70" style={{ color: 'var(--t-text-muted)' }}>
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${((currentIdx + 1) / allSlides.length) * 100}%`, backgroundColor: 'var(--t-accent)' }} />
        </div>
        <span className="text-xs w-16 text-center" style={{ color: 'var(--t-text-dim)' }}>
          {currentIdx + 1} / {allSlides.length}
        </span>
        <button onClick={goNext} disabled={currentIdx === allSlides.length - 1 || examPhase === 'running'}
          className="disabled:opacity-30 hover:opacity-70" style={{ color: 'var(--t-text-muted)' }}>
          <ChevronRight size={20} />
        </button>
      </div>

      <audio ref={audioRef} className="hidden" />

      {/* Score toast */}
      {scoreToast && (
        <div className="fixed top-20 right-6 z-[60] animate-fade-in-down bg-slate-800 border border-sky-500/30 rounded-xl px-5 py-3 shadow-lg">
          <div className="text-xs text-slate-400 mb-1">{scoreToast.label || t('training.interactionScore')}</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--t-accent)' }}>
            {scoreToast.score} <span className="text-sm text-slate-500">/ {scoreToast.max}</span>
          </div>
        </div>
      )}

      {/* Overtime warning modal */}
      {examPhase === 'running' && examTimeLimitEnabled && examTimeLeft === 0 && examOvertimeAction === 'warn_continue' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-xl p-6 max-w-sm text-center" style={{ backgroundColor: 'var(--t-bg-card)' }}>
            <div className="text-3xl mb-2">⏱</div>
            <p className="text-sm font-medium mb-4" style={{ color: 'var(--t-text)' }}>{t('training.examTimeUp')}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={finishExam}
                className="px-4 py-2 text-xs font-medium text-white rounded-lg bg-red-500 hover:bg-red-400">
                {t('training.examSubmitNow')}
              </button>
              <button onClick={() => setExamTimeLeft(-1)}
                className="px-4 py-2 text-xs rounded-lg"
                style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
                {t('training.examContinue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CoursePlayer — route wrapper
// ═══════════════════════════════════════════════════════════════════════════════

export default function CoursePlayer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const examTopicParam = searchParams.get('examTopic')
  const sessionId = useMemo(() => crypto.randomUUID(), [id, examTopicParam])
  const initialMode = searchParams.get('mode') === 'test' ? 'test' as const : 'learn' as const

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(`/training/course/${id}`)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [id])

  if (!id) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)' }}>
      <CoursePlayerInner
        courseId={Number(id)}
        sessionId={sessionId}
        initialMode={initialMode}
        examTopicId={examTopicParam ? Number(examTopicParam) : undefined}
        lang={searchParams.get('lang') || undefined}
        onClose={() => navigate(`/training/course/${id}`)}
      />
    </div>
  )
}
