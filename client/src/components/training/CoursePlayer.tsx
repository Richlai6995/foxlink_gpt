import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { ArrowLeft, ChevronLeft, ChevronRight, Volume2, VolumeX, BookmarkPlus, MessageSquare, X, List } from 'lucide-react'
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

// ═══════════════════════════════════════════════════════════════════════════════
// CoursePlayerInner — shared core (used by route wrapper AND HelpTrainingPlayer)
// ═══════════════════════════════════════════════════════════════════════════════

interface CoursePlayerInnerProps {
  courseId: number
  lessonId?: number | null      // filter to specific lesson
  lang?: string                 // override i18n language
  sessionId?: string            // interaction session tracking
  skipAccessCheck?: boolean     // help=1 bypass
  onClose: () => void           // close handler (navigate vs modal close)
  initialMode?: 'learn' | 'test'
}

export function CoursePlayerInner({ courseId, lessonId, lang: langProp, sessionId, skipAccessCheck, onClose, initialMode = 'learn' }: CoursePlayerInnerProps) {
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
  const [scoreToast, setScoreToast] = useState<{ score: number; max: number } | null>(null)

  const lang = langProp || i18n.language

  useEffect(() => { loadCourseForPlayer() }, [courseId, lang])

  const loadCourseForPlayer = async () => {
    try {
      const params: any = { lang }
      if (skipAccessCheck) params.help = '1'
      const courseRes = await api.get(`/training/courses/${courseId}`, { params })
      setCourse(courseRes.data)

      // Filter to specific lesson if requested
      const courseLessons: Lesson[] = courseRes.data.lessons || []
      const targetLessons = lessonId ? courseLessons.filter(l => l.id === lessonId) : courseLessons
      setLessons(targetLessons)

      const slides: Slide[] = []
      for (const lesson of targetLessons) {
        const res = await api.get(`/training/lessons/${lesson.id}/slides`, { params: { lang } })
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

  const currentSlide = allSlides[currentIdx]
  const currentLesson = currentSlide ? lessons.find(l => l.id === currentSlide.lesson_id) : null

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIdx, allSlides.length])

  const saveNote = async () => {
    if (!currentSlide || !noteText.trim()) return
    await api.post('/training/notes', {
      course_id: courseId,
      slide_id: currentSlide.id,
      content: noteText,
      bookmarked: false
    }).catch(() => {})
  }

  const sendTutorMessage = async () => {
    if (!tutorInput.trim() || tutorLoading) return
    const msg = tutorInput.trim()
    setTutorInput('')
    setTutorMessages(prev => [...prev, { role: 'user', content: msg }])
    try {
      setTutorLoading(true)
      const res = await api.post(`/training/courses/${courseId}/ai-tutor`, {
        message: msg,
        lesson_id: currentSlide?.lesson_id,
        slide_id: currentSlide?.id
      })
      setTutorMessages(prev => [...prev, { role: 'assistant', content: res.data.answer }])
    } catch {
      setTutorMessages(prev => [...prev, { role: 'assistant', content: t('training.aiTutorError') }])
    } finally { setTutorLoading(false) }
  }

  const handleInteractionComplete = useCallback(async (slideId: number, result: any) => {
    try {
      const res = await api.post(`/training/slides/${slideId}/interaction-result`, {
        ...result,
        player_mode: playerMode,
        session_id: sessionId || null
      })
      if (res.data?.score !== undefined) {
        setScoreToast({ score: res.data.score, max: res.data.max_score })
        setTimeout(() => setScoreToast(null), 4000)
      }
    } catch (e) {
      console.error('[CoursePlayer] interaction-result submit:', e)
    }
  }, [playerMode, sessionId])

  if (!course || allSlides.length === 0) {
    return <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>
  }

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
        <div className="flex items-center rounded-lg overflow-hidden border" style={{ borderColor: 'var(--t-border)' }}>
          <button onClick={() => setPlayerMode('learn')}
            className="text-[10px] px-2.5 py-1 font-medium transition"
            style={{
              backgroundColor: playerMode === 'learn' ? 'var(--t-accent-bg, #3b82f6)' : 'transparent',
              color: playerMode === 'learn' ? 'white' : 'var(--t-text-dim)'
            }}>
            📖 {t('training.learn')}
          </button>
          <button onClick={() => setPlayerMode('test')}
            className="text-[10px] px-2.5 py-1 font-medium transition"
            style={{
              backgroundColor: playerMode === 'test' ? '#f59e0b' : 'transparent',
              color: playerMode === 'test' ? 'white' : 'var(--t-text-dim)'
            }}>
            📝 {t('training.test')}
          </button>
        </div>
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
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Outline sidebar */}
        {showOutline && (
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
        {showNotes && (
          <div className="w-72 border-l p-3 flex flex-col shrink-0" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold" style={{ color: 'var(--t-text-muted)' }}>{t('training.notes')}</h4>
              <button onClick={() => setShowNotes(false)} style={{ color: 'var(--t-text-dim)' }}><X size={14} /></button>
            </div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={6}
              className="w-full border rounded text-xs px-2 py-1.5 resize-none focus:outline-none flex-1"
              style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
              placeholder={t('training.notesPlaceholder')}
            />
            <button onClick={saveNote} className="mt-2 text-xs text-white px-3 py-1.5 rounded transition"
              style={{ backgroundColor: 'var(--t-accent-bg)' }}>
              {t('training.saveNotes')}
            </button>
          </div>
        )}

        {/* AI Tutor panel */}
        {showTutor && (
          <div className="w-80 border-l flex flex-col shrink-0" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--t-border)' }}>
              <h4 className="text-xs font-semibold" style={{ color: 'var(--t-accent)' }}>{t('training.aiTutor')}</h4>
              <button onClick={() => setShowTutor(false)} style={{ color: 'var(--t-text-dim)' }}><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {tutorMessages.length === 0 && (
                <p className="text-xs text-center py-8" style={{ color: 'var(--t-text-dim)' }}>{t('training.aiTutorEmpty')}</p>
              )}
              {tutorMessages.map((msg, i) => (
                <div key={i} className={`text-xs rounded-lg px-3 py-2 ${msg.role === 'user' ? 'ml-4' : 'mr-4'}`}
                  style={{
                    backgroundColor: msg.role === 'user' ? 'var(--t-accent-subtle)' : 'var(--t-bg-card)',
                    color: 'var(--t-text-secondary)'
                  }}>
                  {msg.content}
                </div>
              ))}
              {tutorLoading && <div className="text-xs animate-pulse" style={{ color: 'var(--t-text-dim)' }}>{t('training.aiThinking')}</div>}
            </div>
            <div className="border-t p-2 flex gap-2" style={{ borderColor: 'var(--t-border)' }}>
              <input
                value={tutorInput}
                onChange={e => setTutorInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendTutorMessage()}
                className="flex-1 border rounded px-2 py-1.5 text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder={t('training.inputQuestion')}
              />
              <button onClick={sendTutorMessage} disabled={tutorLoading}
                className="text-white px-2 py-1 rounded text-xs disabled:opacity-50"
                style={{ backgroundColor: 'var(--t-accent-bg)' }}>
                {t('training.send')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="backdrop-blur border-t px-4 py-2 flex items-center gap-4 shrink-0"
        style={{ backgroundColor: 'var(--t-bg-elevated)', borderColor: 'var(--t-border)' }}>
        <button onClick={goPrev} disabled={currentIdx === 0}
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
        <button onClick={goNext} disabled={currentIdx === allSlides.length - 1}
          className="disabled:opacity-30 hover:opacity-70" style={{ color: 'var(--t-text-muted)' }}>
          <ChevronRight size={20} />
        </button>
      </div>

      <audio ref={audioRef} className="hidden" />

      {scoreToast && (
        <div className="fixed top-20 right-6 z-[60] animate-fade-in-down bg-slate-800 border border-sky-500/30 rounded-xl px-5 py-3 shadow-lg">
          <div className="text-xs text-slate-400 mb-1">{t('training.interactionScore')}</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--t-accent)' }}>
            {scoreToast.score} <span className="text-sm text-slate-500">/ {scoreToast.max}</span>
          </div>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CoursePlayer — route wrapper (/training/course/:id/learn)
// ═══════════════════════════════════════════════════════════════════════════════

export default function CoursePlayer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionId = useMemo(() => crypto.randomUUID(), [id])
  const initialMode = searchParams.get('mode') === 'test' ? 'test' as const : 'learn' as const

  // ESC handler for route-based player
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
        lang={searchParams.get('lang') || undefined}
        onClose={() => navigate(`/training/course/${id}`)}
      />
    </div>
  )
}
