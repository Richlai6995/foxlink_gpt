import { useState, useEffect, useRef, useCallback } from 'react'
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

export default function CoursePlayer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
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
  const [searchParams] = useSearchParams()
  const [playerMode, setPlayerMode] = useState<'learn' | 'test'>(searchParams.get('mode') === 'test' ? 'test' : 'learn')
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    loadCourseForPlayer()
  }, [id])

  // Phase 3A-2: Reload slides when language changes (swaps base images)
  useEffect(() => {
    if (course) loadCourseForPlayer()
  }, [i18n.language])

  const loadCourseForPlayer = async () => {
    try {
      const courseRes = await api.get(`/training/courses/${id}`)
      setCourse(courseRes.data)
      setLessons(courseRes.data.lessons || [])

      // Load all slides for all lessons (with language)
      // URL ?lang= overrides i18n language for preview
      const lang = searchParams.get('lang') || i18n.language
      const slides: Slide[] = []
      for (const lesson of courseRes.data.lessons || []) {
        const res = await api.get(`/training/lessons/${lesson.id}/slides`, { params: { lang } })
        slides.push(...res.data)
      }
      setAllSlides(slides)

      // Report progress
      api.post(`/training/courses/${id}/progress`, { status: 'in_progress' }).catch(() => {})
    } catch (e) {
      console.error(e)
      navigate('/training')
    }
  }

  const currentSlide = allSlides[currentIdx]
  const currentLesson = currentSlide ? lessons.find(l => l.id === currentSlide.lesson_id) : null

  // Auto-play slide audio (skip for hotspot slides — HotspotBlock manages its own audio)
  useEffect(() => {
    if (!currentSlide?.audio_url || !audioRef.current || audioMuted) return
    // Check if this is a hotspot slide — let HotspotBlock handle audio
    try {
      const blocks = JSON.parse(currentSlide.content_json || '[]')
      if (blocks.some((b: any) => b.type === 'hotspot')) return
    } catch {}
    audioRef.current.src = currentSlide.audio_url
    audioRef.current.play().catch(() => {})
  }, [currentIdx, currentSlide?.audio_url, audioMuted])

  const goNext = () => {
    if (currentIdx < allSlides.length - 1) setCurrentIdx(currentIdx + 1)
  }
  const goPrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1)
  }

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
      if (e.key === 'Escape') navigate(`/training/course/${id}`)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIdx, allSlides.length])

  // Save note
  const saveNote = async () => {
    if (!currentSlide || !noteText.trim()) return
    await api.post('/training/notes', {
      course_id: Number(id),
      slide_id: currentSlide.id,
      content: noteText,
      bookmarked: false
    }).catch(() => {})
  }

  // AI Tutor
  const sendTutorMessage = async () => {
    if (!tutorInput.trim() || tutorLoading) return
    const msg = tutorInput.trim()
    setTutorInput('')
    setTutorMessages(prev => [...prev, { role: 'user', content: msg }])
    try {
      setTutorLoading(true)
      const res = await api.post(`/training/courses/${id}/ai-tutor`, {
        message: msg,
        lesson_id: currentSlide?.lesson_id,
        slide_id: currentSlide?.id
      })
      setTutorMessages(prev => [...prev, { role: 'assistant', content: res.data.answer }])
    } catch {
      setTutorMessages(prev => [...prev, { role: 'assistant', content: '抱歉，AI 助教暫時無法回答。' }])
    } finally { setTutorLoading(false) }
  }

  if (!course || allSlides.length === 0) {
    return <div className="fixed inset-0 bg-slate-900 flex items-center justify-center text-slate-500">載入中...</div>
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)' }}>
      {/* Top bar */}
      <div className="backdrop-blur border-b px-4 py-2 flex items-center gap-3 shrink-0 z-10"
        style={{ backgroundColor: 'var(--t-bg-elevated)', borderColor: 'var(--t-border)' }}>
        <button onClick={() => navigate(`/training/course/${id}`)} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-70">
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
            📖 學習
          </button>
          <button onClick={() => setPlayerMode('test')}
            className="text-[10px] px-2.5 py-1 font-medium transition"
            style={{
              backgroundColor: playerMode === 'test' ? '#f59e0b' : 'transparent',
              color: playerMode === 'test' ? 'white' : 'var(--t-text-dim)'
            }}>
            📝 測驗
          </button>
        </div>
        <button onClick={() => setShowOutline(!showOutline)} style={{ color: showOutline ? 'var(--t-accent)' : 'var(--t-text-muted)' }} className="hover:opacity-70" title="章節大綱">
          <List size={16} />
        </button>
        <button onClick={() => setAudioMuted(!audioMuted)} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-70" title="音訊">
          {audioMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button onClick={() => setShowNotes(!showNotes)} style={{ color: showNotes ? 'var(--t-accent)' : 'var(--t-text-muted)' }} className="hover:opacity-70" title="筆記">
          <BookmarkPlus size={16} />
        </button>
        <button onClick={() => setShowTutor(!showTutor)} style={{ color: showTutor ? 'var(--t-accent)' : 'var(--t-text-muted)' }} className="hover:opacity-70" title="AI 助教">
          <MessageSquare size={16} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Outline sidebar */}
        {showOutline && (
          <div className="w-56 border-r overflow-y-auto shrink-0 p-3" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
            <h4 className="text-[10px] font-semibold uppercase mb-2" style={{ color: 'var(--t-text-dim)' }}>章節大綱</h4>
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
            <SlideRenderer slide={currentSlide} isLastSlide={currentIdx === allSlides.length - 1} playerMode={playerMode} />
          </div>
        </div>

        {/* Notes panel */}
        {showNotes && (
          <div className="w-72 border-l p-3 flex flex-col shrink-0" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold" style={{ color: 'var(--t-text-muted)' }}>筆記</h4>
              <button onClick={() => setShowNotes(false)} style={{ color: 'var(--t-text-dim)' }}><X size={14} /></button>
            </div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={6}
              className="w-full border rounded text-xs px-2 py-1.5 resize-none focus:outline-none flex-1"
              style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
              placeholder="在此記錄筆記..."
            />
            <button onClick={saveNote} className="mt-2 text-xs text-white px-3 py-1.5 rounded transition"
              style={{ backgroundColor: 'var(--t-accent-bg)' }}>
              儲存筆記
            </button>
          </div>
        )}

        {/* AI Tutor panel */}
        {showTutor && (
          <div className="w-80 border-l flex flex-col shrink-0" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--t-border)' }}>
              <h4 className="text-xs font-semibold" style={{ color: 'var(--t-accent)' }}>AI 助教</h4>
              <button onClick={() => setShowTutor(false)} style={{ color: 'var(--t-text-dim)' }}><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {tutorMessages.length === 0 && (
                <p className="text-xs text-center py-8" style={{ color: 'var(--t-text-dim)' }}>有問題嗎？隨時向 AI 助教提問！</p>
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
              {tutorLoading && <div className="text-xs animate-pulse" style={{ color: 'var(--t-text-dim)' }}>思考中...</div>}
            </div>
            <div className="border-t p-2 flex gap-2" style={{ borderColor: 'var(--t-border)' }}>
              <input
                value={tutorInput}
                onChange={e => setTutorInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendTutorMessage()}
                className="flex-1 border rounded px-2 py-1.5 text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder="輸入問題..."
              />
              <button onClick={sendTutorMessage} disabled={tutorLoading}
                className="text-white px-2 py-1 rounded text-xs disabled:opacity-50"
                style={{ backgroundColor: 'var(--t-accent-bg)' }}>
                發送
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

        {/* Progress bar */}
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${((currentIdx + 1) / allSlides.length) * 100}%`, backgroundColor: 'var(--t-accent)' }}
          />
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
    </div>
  )
}
