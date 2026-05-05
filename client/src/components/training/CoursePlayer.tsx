import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { ArrowLeft, ChevronLeft, ChevronRight, Volume2, VolumeX, BookmarkPlus, MessageSquare, X, List, Clock, RotateCcw, ChevronDown, ChevronRight as ChevronR, Play, CheckCircle2, XCircle, Lock, Flag, AlertTriangle, ListOrdered } from 'lucide-react'
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

  // ─── Auto-play mode ───
  const [autoPlaying, setAutoPlaying] = useState(false)
  const autoPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Exam topic override ───
  const [examTopic, setExamTopic] = useState<ExamTopicConfig | null>(null)
  // ─── Program exam config override ───
  const [programExamConfig, setProgramExamConfig] = useState<any>(null)

  // ─── Exam state ───
  // chapter_overview: 章節列表 / running: 跑章節題目 / chapter_result: 該章節剛結束 / final_result: 全 attempt 結算
  const [examPhase, setExamPhase] = useState<'idle' | 'chapter_overview' | 'running' | 'chapter_result' | 'final_result'>('idle')
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

  // ─── Chapter mode state ───
  const [examOverview, setExamOverview] = useState<any>(null)
  const [currentChapterLessonId, setCurrentChapterLessonId] = useState<number | null>(null)
  const [chapterResultData, setChapterResultData] = useState<any>(null)  // { score, max_score, passed, finalized, final, next_suggested_lesson_id }
  const [finalizing, setFinalizing] = useState(false)

  // Chapter-scoped interactive indices (only slides of current chapter)
  const chapterInteractiveIndices = useMemo(() => {
    if (currentChapterLessonId == null) return interactiveIndices
    return interactiveIndices.filter(i => allSlides[i]?.lesson_id === currentChapterLessonId)
  }, [interactiveIndices, allSlides, currentChapterLessonId])

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
      // Filter by lesson_ids from URL (program course selection)
      const lessonIdsParam = new URLSearchParams(window.location.search).get('lesson_ids')
      if (lessonIdsParam) {
        const ids = lessonIdsParam.split(',').map(Number).filter(n => !isNaN(n))
        if (ids.length > 0) targetLessons = targetLessons.filter(l => ids.includes(l.id))
      }
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

      // Load program exam config if coming from a program
      const progIdParam = new URLSearchParams(window.location.search).get('program_id')
      if (progIdParam) {
        try {
          const pecRes = await api.get('/training/program-exam-config', { params: { program_id: progIdParam, course_id: courseId } })
          if (pecRes.data) setProgramExamConfig(pecRes.data)
        } catch {}
      }
    } catch (e) {
      console.error(e)
      onClose()
    }
  }

  // ─── Exam config helpers ───
  // Priority: programExamConfig (from program_courses) > examTopic > course settings
  const examConfig = programExamConfig || examTopic || course?.settings_json?.exam || {}
  const examTotalScore = examConfig.total_score || 100
  const examPassScore = programExamConfig?.pass_score || examTopic?.pass_score || course?.pass_score || 60
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

  // ─── Slide view tracking (Phase 5) ───
  const slideViewStartRef = useRef<number>(Date.now())
  const programIdParam = new URLSearchParams(window.location.search).get('program_id')

  useEffect(() => {
    const slideId = currentSlide?.id
    const lessonId = currentSlide?.lesson_id
    slideViewStartRef.current = Date.now()
    return () => {
      if (slideId) {
        const duration = Math.round((Date.now() - slideViewStartRef.current) / 1000)
        if (duration >= 1) {
          api.post(`/training/slides/${slideId}/view`, {
            course_id: courseId,
            lesson_id: lessonId,
            program_id: programIdParam ? Number(programIdParam) : null,
            duration_seconds: duration
          }).catch(() => {})
        }
      }
    }
  }, [currentIdx, currentSlide?.id, courseId])

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

  // ─── Auto-play: advance after audio ends or timeout ───
  useEffect(() => {
    if (!autoPlaying) return
    if (currentIdx >= allSlides.length - 1) { setAutoPlaying(false); return }

    const slide = allSlides[currentIdx]

    // Check if hotspot block manages its own audio (doesn't use audioRef)
    let hasHotspot = false
    try {
      const blocks = JSON.parse(slide?.content_json || '[]')
      hasHotspot = blocks.some((b: any) => b.type === 'hotspot')
    } catch {}

    if (hasHotspot) {
      // Hotspot slides: HotspotBlock auto-advances through steps and calls onAutoPlayDone when finished
      return
    }

    // If slide has audio → wait for it to end, then advance
    if (audioRef.current && slide?.audio_url && !audioMuted) {
      const audio = audioRef.current
      const onEnded = () => {
        autoPlayTimerRef.current = setTimeout(() => { goNext() }, 1500)
      }
      // If audio already ended (short clip), check immediately
      if (audio.ended && audio.src) {
        autoPlayTimerRef.current = setTimeout(() => { goNext() }, 1500)
      } else {
        audio.addEventListener('ended', onEnded, { once: true })
      }
      return () => {
        audio.removeEventListener('ended', onEnded)
        if (autoPlayTimerRef.current) { clearTimeout(autoPlayTimerRef.current); autoPlayTimerRef.current = null }
      }
    } else {
      // No audio → advance after 3 seconds
      autoPlayTimerRef.current = setTimeout(() => { goNext() }, 3000)
      return () => { if (autoPlayTimerRef.current) { clearTimeout(autoPlayTimerRef.current); autoPlayTimerRef.current = null } }
    }
  }, [autoPlaying, currentIdx, allSlides, audioMuted])

  // Stop auto-play on unmount
  useEffect(() => () => {
    if (autoPlayTimerRef.current) clearTimeout(autoPlayTimerRef.current)
  }, [])

  // Keyboard nav (learn mode only)
  useEffect(() => {
    if (examPhase === 'running' || examPhase === 'chapter_result' || examPhase === 'final_result') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIdx, allSlides.length, examPhase])

  // ─── Exam timer (per-chapter) ───
  useEffect(() => {
    if (examPhase === 'running' && examTimeLimitEnabled && currentChapterLessonId != null) {
      examTimerRef.current = setInterval(() => {
        setExamTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(examTimerRef.current!)
            // 章節 timer 到 → auto submit 章節(不論 examOvertimeAction,章節制下一定 auto)
            finishChapter(true)
            return 0
          }
          return prev - 1
        })
      }, 1000)
      return () => { if (examTimerRef.current) clearInterval(examTimerRef.current) }
    }
  }, [examPhase, examTimeLimitEnabled, currentChapterLessonId])

  // Switch to test mode → load chapter overview
  useEffect(() => {
    if (playerMode === 'test' && examPhase === 'idle' && allSlides.length > 0) {
      loadExamOverview()
    }
    if (playerMode === 'learn') {
      setExamPhase('idle')
      setCurrentChapterLessonId(null)
      setChapterResultData(null)
      if (examTimerRef.current) clearInterval(examTimerRef.current)
    }
  }, [playerMode, allSlides.length])

  // ─── Load chapter overview ───
  const loadExamOverview = async () => {
    try {
      const res = await api.get(`/training/courses/${courseId}/exam/overview`)
      setExamOverview(res.data)
      // 已 finalize → 直接進 final_result
      if (res.data?.attempt?.completed_at) {
        setExamPhase('final_result')
      } else {
        setExamPhase('chapter_overview')
      }
    } catch (e: any) {
      console.error('[CoursePlayer] exam overview:', e?.response?.data?.error || e?.message)
      // Fallback:overview 失敗(例如沒有任何 interactive 章節)→ 直接 idle
      setExamPhase('idle')
    }
  }

  // ─── Start a chapter ───
  const startChapterExam = async (lessonId: number) => {
    try {
      const res = await api.post(`/training/courses/${courseId}/exam/chapter/${lessonId}/start`)
      const data = res.data
      setExamResults([])
      examResultsRef.current = []
      setChapterResultData(null)
      setCurrentChapterLessonId(lessonId)
      // Server-side timer:用 chapter_remaining_seconds 顯示倒數
      const initialLeft = data.chapter_remaining_seconds ?? data.time_budget_seconds ?? (examTimeLimit * 60)
      setExamTimeLeft(initialLeft)
      setExamStartTime(Date.now())
      setExamPhase('running')
      // Jump to first interactive slide of this lesson
      const firstIdx = interactiveIndices.find(i => allSlides[i]?.lesson_id === lessonId)
      if (firstIdx !== undefined) setCurrentIdx(firstIdx)
    } catch (e: any) {
      alert(e?.response?.data?.error || t('training.examChapterStartFailed', '無法開始章節'))
      await loadExamOverview()
    }
  }

  // ─── Finish chapter (called when chapter's last interactive slide done OR timer up) ───
  const finishChapter = useCallback(async (auto = false) => {
    if (examTimerRef.current) clearInterval(examTimerRef.current)
    const results = [...examResultsRef.current]
    setExamResults(results)

    if (currentChapterLessonId == null) {
      console.warn('[CoursePlayer] finishChapter without currentChapterLessonId')
      return
    }

    // Aggregate score for THIS chapter only(用 chapterInteractiveIndices)
    let chapterScore = 0, chapterMax = 0
    const chapterSlideResults: any[] = []
    for (const idx of chapterInteractiveIndices) {
      const slide = allSlides[idx]
      if (!slide) continue
      const r = results.find(x => x.slideIndex === idx)
      if (r) {
        chapterScore += r.weightedScore
        chapterMax += r.weightedMax
        chapterSlideResults.push({
          slide_id: slide.id,
          score: r.weightedScore,
          max: r.weightedMax,
          block_type: r.blockType
        })
      } else {
        // 未完成的 slide → max 計入,score=0
        const w = getSlideWeight(slide.id, interactiveIndices.length)
        chapterMax += w
        chapterSlideResults.push({ slide_id: slide.id, score: 0, max: w, completed: false })
      }
    }

    try {
      const res = await api.post(
        `/training/courses/${courseId}/exam/chapter/${currentChapterLessonId}/submit`,
        { score: chapterScore, max_score: chapterMax, slide_results: chapterSlideResults }
      )
      setChapterResultData(res.data)
      if (res.data?.finalized) {
        setExamPhase('final_result')
      } else {
        setExamPhase('chapter_result')
      }
      void auto
    } catch (e: any) {
      console.error('[CoursePlayer] exam chapter submit:', e)
      alert(e?.response?.data?.error || t('training.examSubmitFailed', '提交失敗'))
    }
  }, [chapterInteractiveIndices, allSlides, currentChapterLessonId, getSlideWeight, interactiveIndices.length, courseId, t])

  // ─── Back to chapter overview ───
  const backToChapterOverview = async () => {
    setCurrentChapterLessonId(null)
    setChapterResultData(null)
    setExamResults([])
    examResultsRef.current = []
    setExpandedResult(null)
    if (examTimerRef.current) { clearInterval(examTimerRef.current); examTimerRef.current = null }
    await loadExamOverview()
  }

  // ─── Manual finalize ───
  const finalizeExam = async () => {
    if (!confirm(t('training.examFinalizeConfirm', '確定結束本次測驗?未做完的章節將以 0 分計算,且時間將被扣到上限。'))) return
    setFinalizing(true)
    try {
      await api.post(`/training/courses/${courseId}/exam/finalize`)
      await loadExamOverview()
    } catch (e: any) {
      alert(e?.response?.data?.error || t('training.examFinalizeFailed', '結算失敗'))
    } finally { setFinalizing(false) }
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
    // Mark interaction done for slide view tracking (both learn + test mode)
    api.put(`/training/slides/${slideId}/view/done`, {
      program_id: programIdParam ? Number(programIdParam) : null
    }).catch(() => {})

    // Learn mode: don't record scores at all
    if (playerMode !== 'test') return

    try {
      // Send weighted_max so server can compute weighted_score = ratio × weighted_max
      const weight = getSlideWeight(slideId, interactiveIndices.length)

      const res = await api.post(`/training/slides/${slideId}/interaction-result`, {
        ...result,
        player_mode: playerMode,
        session_id: sessionId || null,
        exam_topic_id: examTopic?.id || examTopicId || null,
        weighted_max: weight ?? undefined
      })

      if (playerMode === 'test' && examPhase === 'running' && res.data?.score !== undefined) {
        const rawScore = res.data.score
        const rawMax = res.data.max_score
        const ratio = rawMax > 0 ? rawScore / rawMax : 0
        const weightedScore = Math.round(ratio * (weight || rawMax))

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

        // Auto-advance to next interactive slide of CURRENT CHAPTER
        setTimeout(() => {
          const idxInChapter = chapterInteractiveIndices.indexOf(slideIdx)
          if (idxInChapter >= 0 && idxInChapter < chapterInteractiveIndices.length - 1) {
            setCurrentIdx(chapterInteractiveIndices[idxInChapter + 1])
          } else {
            // 該章節最後一題 → 結束本章節(不結束整個 attempt)
            finishChapter(false)
          }
        }, 2000)
      }
    } catch (e) {
      console.error('[CoursePlayer] interaction-result submit:', e)
    }
  }, [playerMode, sessionId, examPhase, interactiveIndices, chapterInteractiveIndices, allSlides, getSlideWeight, finishChapter, t])

  // Format seconds to mm:ss
  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  if (!course || allSlides.length === 0) {
    return <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Chapter Overview Screen — 章節列表 / 主按鈕 / 結束按鈕
  // ═══════════════════════════════════════════════════════════════════════════════
  if (examPhase === 'chapter_overview' && examOverview) {
    const ov = examOverview
    const isSequential = ov.course?.quiz_sequential
    const inProgressChapter = ov.chapters.find((c: any) => c.status === 'in_progress')
    const nextSuggested = ov.chapters.find((c: any) => c.lesson_id === ov.next_suggested_lesson_id)
    const primaryAction = inProgressChapter ?? nextSuggested ?? null
    const primaryLabel = inProgressChapter
      ? t('training.examResumeChapterX', '繼續章節:{{title}}', { title: inProgressChapter.title })
      : (nextSuggested ? t('training.examStartChapterX', '開始章節:{{title}}', { title: nextSuggested.title }) : '')

    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setPlayerMode('learn')} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-70">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--t-text)' }}>{course.title}</h1>
            {isSequential && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 flex items-center gap-1">
                <ListOrdered size={10} /> {t('training.quizSequentialBadge', '依序測驗')}
              </span>
            )}
          </div>

          <div className="rounded-xl p-5 space-y-3" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs" style={{ color: 'var(--t-text-dim)' }}>{t('training.quizTotalTime', '總時間')}</div>
                <div className="text-2xl font-mono font-bold" style={{ color: 'var(--t-text)' }}>
                  {ov.course.time_limit_minutes ? fmtTime(ov.remaining_seconds) : '∞'}
                  {ov.course.time_limit_minutes != null && (
                    <span className="text-xs font-normal ml-2" style={{ color: 'var(--t-text-dim)' }}>
                      / {ov.course.time_limit_minutes} {t('training.quizMinutes', '分')}
                    </span>
                  )}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--t-text-dim)' }}>
                  {t('training.quizTimeUsed', '已用 {{u}} 分', { u: Math.floor(ov.used_seconds / 60) })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs" style={{ color: 'var(--t-text-dim)' }}>{t('training.quizPassScore', '及格標準')}</div>
                <div className="text-lg font-semibold" style={{ color: 'var(--t-text)' }}>{ov.course.pass_score} {t('training.quizPointsUnit', '分')}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--t-text-dim)' }}>
                  {t('training.quizAttempt', '第 {{n}} 次測驗', { n: (ov.attempt?.attempt_number || ov.total_attempts + 1) })}
                </div>
              </div>
            </div>

            {primaryAction && (
              <button onClick={() => startChapterExam(primaryAction.lesson_id)}
                disabled={ov.course.time_limit_minutes != null && ov.remaining_seconds <= 0}
                className="w-full bg-orange-500 hover:bg-orange-400 px-4 py-3 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white">
                <Play size={16} /> {primaryLabel}
              </button>
            )}

            {ov.can_finalize && (
              <button onClick={finalizeExam} disabled={finalizing}
                className="w-full px-4 py-2 rounded-lg text-xs transition flex items-center justify-center gap-2"
                style={{ color: 'var(--t-text-muted)', border: '1px solid var(--t-border)' }}>
                <Flag size={12} /> {finalizing ? t('training.quizFinalizing', '結算中...') : t('training.quizFinalizeNow', '結束測驗,馬上結算')}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--t-text-dim)' }}>{t('training.quizChapterList', '章節列表')}</div>
              <div className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>{t('training.quizChapterHelp', '通過的章節會鎖住,未通過可重做')}</div>
            </div>
            {ov.chapters.map((c: any) => {
              const isPassed = c.passed
              const isFailed = (c.status === 'completed' || c.status === 'timeout') && !c.passed
              const isInProg = c.status === 'in_progress'
              const hasOther = inProgressChapter && inProgressChapter.lesson_id !== c.lesson_id
              const sequentialLocked = c.is_sequential_locked && !isInProg && !isPassed && !isFailed
              const lockedByOther = hasOther && !isPassed && !isFailed
              const isSuggested = c.is_suggested && !isInProg
              const percent = c.max_score && c.score != null ? Math.round((c.score / c.max_score) * 100) : null

              return (
                <div key={c.lesson_id} className={`rounded-xl p-4 flex items-center gap-3 ${
                  isInProg ? 'border-sky-500/50' :
                  isPassed ? 'border-green-500/30' :
                  isFailed ? 'border-amber-500/30' :
                  isSuggested ? 'border-orange-500/30' : ''
                }`} style={{ backgroundColor: 'var(--t-bg-card)', border: isInProg || isPassed || isFailed || isSuggested ? undefined : '1px solid var(--t-border)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {isPassed ? <CheckCircle2 size={16} className="text-green-400 shrink-0" /> :
                       isFailed ? <XCircle size={16} className="text-amber-400 shrink-0" /> :
                       isInProg ? <Clock size={16} className="text-sky-400 shrink-0 animate-pulse" /> :
                       (sequentialLocked || lockedByOther) ? <Lock size={16} className="shrink-0" style={{ color: 'var(--t-text-dim)' }} /> :
                       <Play size={16} className="shrink-0" style={{ color: 'var(--t-text-muted)' }} />}
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--t-text)' }}>{c.title}</div>
                      {isSuggested && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 shrink-0">
                          {t('training.quizSuggestedBadge', '建議下一章')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs mt-1 flex items-center gap-2 flex-wrap" style={{ color: 'var(--t-text-dim)' }}>
                      <span>{c.interactive_count} {t('training.quizItems', '題')}</span>
                      {(isPassed || isFailed) && c.score != null && (
                        <>
                          <span>·</span>
                          <span className={isPassed ? 'text-green-400' : 'text-amber-400'}>
                            {t('training.quizScored', '得分 {{s}}/{{m}} ({{p}}%)', { s: c.score, m: c.max_score, p: percent })}
                          </span>
                        </>
                      )}
                      {c.status === 'timeout' && (
                        <span className="text-amber-400 flex items-center gap-1"><AlertTriangle size={10} /> {t('training.quizChapterTimedOut', '已超時')}</span>
                      )}
                      {isInProg && <span className="text-sky-400">{t('training.quizChapterInProgress', '進行中(timer 持續扣)')}</span>}
                    </div>
                  </div>
                  <div>
                    {isPassed ? (
                      <button disabled className="text-xs px-3 py-1.5 rounded-lg bg-green-700/30 text-green-400 cursor-not-allowed">
                        {t('training.quizChapterPassedShort', '已通過')}
                      </button>
                    ) : lockedByOther ? (
                      <button disabled className="text-xs px-3 py-1.5 rounded-lg cursor-not-allowed" style={{ backgroundColor: 'var(--t-bg-inset)', color: 'var(--t-text-dim)' }}>
                        {t('training.quizChapterLocked', '其他章節進行中')}
                      </button>
                    ) : sequentialLocked ? (
                      <button disabled className="text-xs px-3 py-1.5 rounded-lg cursor-not-allowed" style={{ backgroundColor: 'var(--t-bg-inset)', color: 'var(--t-text-dim)' }}>
                        {t('training.quizSequentialLocked', '依序鎖定')}
                      </button>
                    ) : (
                      <button onClick={() => startChapterExam(c.lesson_id)}
                        disabled={ov.course.time_limit_minutes != null && ov.remaining_seconds <= 0}
                        className={`text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-white ${
                          isFailed ? 'bg-amber-600 hover:bg-amber-500' : 'bg-orange-500 hover:bg-orange-400'
                        }`}>
                        {isFailed && <RotateCcw size={11} />}
                        {isFailed ? t('training.quizRetryChapter', '重做') :
                         isInProg ? t('training.quizResumeChapter', '繼續') :
                         t('training.quizStartChapter', '開始')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {ov.course.time_limit_minutes != null && ov.remaining_seconds <= 0 && (
            <div className="rounded-lg p-4 text-sm flex items-center gap-2" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' }}>
              <AlertTriangle size={16} /> {t('training.quizTimeUp', '總測驗時間已用完')}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Chapter Result Screen — 單章節剛結束
  // ═══════════════════════════════════════════════════════════════════════════════
  if (examPhase === 'chapter_result' && chapterResultData) {
    const cr = chapterResultData
    const passed = cr.passed
    const percent = cr.max_score > 0 ? Math.round((cr.score / cr.max_score) * 100) : 0
    const nextId = cr.next_suggested_lesson_id
    const nextChapter = nextId != null ? examOverview?.chapters?.find((c: any) => c.lesson_id === nextId) : null

    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full rounded-2xl p-8 text-center space-y-4" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
          {passed ? (
            <CheckCircle2 size={48} className="mx-auto text-green-400" />
          ) : (
            <XCircle size={48} className="mx-auto text-amber-400" />
          )}
          <div className="text-2xl font-bold" style={{ color: 'var(--t-text)' }}>{t('training.quizChapterDone', '章節完成')}</div>
          <div className={`text-3xl font-bold ${passed ? 'text-green-400' : 'text-amber-400'}`}>
            {cr.score} <span className="text-base" style={{ color: 'var(--t-text-dim)' }}>/ {cr.max_score}</span>
          </div>
          <div className="text-xs" style={{ color: 'var(--t-text-dim)' }}>{t('training.quizChapterAccuracy', '正確率 {{p}}%', { p: percent })}</div>
          <div className={`text-xs font-semibold ${passed ? 'text-green-400' : 'text-amber-400'}`}>
            {passed ? t('training.quizChapterPassed', '✓ 章節通過') : t('training.quizChapterFailed', '✗ 章節未通過,可重做')}
          </div>
          {cr.timed_out && (
            <div className="text-xs text-amber-400 flex items-center justify-center gap-1">
              <AlertTriangle size={12} /> {t('training.quizChapterTimedOut', '本章節已超時')}
            </div>
          )}
          <div className="pt-3 space-y-2">
            {nextChapter ? (
              <button onClick={() => startChapterExam(nextChapter.lesson_id)}
                className="w-full bg-orange-500 hover:bg-orange-400 px-6 py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2 text-white">
                <Play size={14} /> {t('training.quizGoNextChapter', '繼續下一章:{{title}}', { title: nextChapter.title })}
              </button>
            ) : (
              <button onClick={backToChapterOverview}
                className="w-full bg-orange-500 hover:bg-orange-400 px-6 py-2 rounded-lg text-sm font-semibold transition text-white">
                {t('training.quizContinueOther', '回章節列表')}
              </button>
            )}
            <button onClick={backToChapterOverview}
              className="w-full px-4 py-2 rounded-lg text-xs transition"
              style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
              {t('training.quizPickAnother', '我要選別章')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Final Result Screen — attempt 全結算
  // ═══════════════════════════════════════════════════════════════════════════════
  if (examPhase === 'final_result' && examOverview?.attempt?.completed_at) {
    const a = examOverview.attempt
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full rounded-2xl p-8 text-center space-y-4" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
          <div className="text-5xl mb-2">{a.passed ? '🏆' : '📝'}</div>
          <div className={`text-3xl font-bold ${a.passed ? 'text-green-400' : 'text-red-400'}`}>
            {a.score} <span className="text-base" style={{ color: 'var(--t-text-dim)' }}>/ {a.total_points}</span>
          </div>
          <div className={`text-lg font-semibold ${a.passed ? 'text-green-400' : 'text-red-400'}`}>
            {a.passed ? t('training.quizPassed', '✓ 通過') : t('training.quizFailed', '✗ 未通過')}
          </div>
          <div className="text-xs" style={{ color: 'var(--t-text-dim)' }}>
            ({t('training.quizPassScore', '及格標準')}: {examOverview.course.pass_score})
          </div>
          <div className="flex gap-3 justify-center pt-4">
            <button onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg transition"
              style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
              {t('training.backToCourse', '返回課程')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // (Old per-attempt result screen removed — replaced by chapter_result + final_result above)

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

        {/* Auto-play button (learn mode only) */}
        {examPhase !== 'running' && playerMode === 'learn' && (
          <button
            onClick={() => setAutoPlaying(v => !v)}
            className={`flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg border font-medium transition ${
              autoPlaying ? 'bg-green-600 text-white border-green-600' : ''
            }`}
            style={autoPlaying ? {} : { borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}
            title={t('training.autoPlay')}
          >
            {autoPlaying ? '⏸' : '▶'} {t('training.autoPlay')}
          </button>
        )}

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
            <SlideRenderer slide={currentSlide} isLastSlide={currentIdx === allSlides.length - 1} playerMode={playerMode} audioMuted={audioMuted} autoPlay={autoPlaying}
              onInteractionComplete={handleInteractionComplete}
              onAutoPlayDone={() => {
                // Hotspot auto-play finished all steps → advance to next slide
                if (autoPlaying && currentIdx < allSlides.length - 1) {
                  autoPlayTimerRef.current = setTimeout(() => goNext(), 1500)
                }
              }} />
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
              <button onClick={() => finishChapter(false)}
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
  const fromEditor = searchParams.get('from') === 'editor'
  const fromClassroom = searchParams.get('program_id')
  const closeTarget = fromEditor ? `/training/dev/courses/${id}`
    : fromClassroom ? `/training/classroom/program/${fromClassroom}`
    : `/training/course/${id}`

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(closeTarget)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [id, closeTarget])

  if (!id) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)' }}>
      <CoursePlayerInner
        courseId={Number(id)}
        lessonId={searchParams.get('lessonId') ? Number(searchParams.get('lessonId')) : undefined}
        sessionId={sessionId}
        initialMode={initialMode}
        examTopicId={examTopicParam ? Number(examTopicParam) : undefined}
        lang={searchParams.get('lang') || undefined}
        onClose={() => navigate(closeTarget)}
      />
    </div>
  )
}
