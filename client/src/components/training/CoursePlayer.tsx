import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    loadCourseForPlayer()
  }, [id])

  const loadCourseForPlayer = async () => {
    try {
      const courseRes = await api.get(`/training/courses/${id}`)
      setCourse(courseRes.data)
      setLessons(courseRes.data.lessons || [])

      // Load all slides for all lessons
      const slides: Slide[] = []
      for (const lesson of courseRes.data.lessons || []) {
        const res = await api.get(`/training/lessons/${lesson.id}/slides`)
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

  // Auto-play audio
  useEffect(() => {
    if (currentSlide?.audio_url && audioRef.current && !audioMuted) {
      audioRef.current.src = currentSlide.audio_url
      audioRef.current.play().catch(() => {})
    }
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
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Top bar */}
      <div className="bg-slate-800/90 backdrop-blur border-b border-slate-700/50 px-4 py-2 flex items-center gap-3 shrink-0 z-10">
        <button onClick={() => navigate(`/training/course/${id}`)} className="text-slate-400 hover:text-slate-200">
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-medium truncate">{course.title}</span>
        {currentLesson && (
          <span className="text-xs text-slate-500">— {currentLesson.title}</span>
        )}
        <div className="flex-1" />
        <button onClick={() => setShowOutline(!showOutline)} className="text-slate-400 hover:text-slate-200" title="章節大綱">
          <List size={16} />
        </button>
        <button onClick={() => setAudioMuted(!audioMuted)} className="text-slate-400 hover:text-slate-200" title="音訊">
          {audioMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button onClick={() => setShowNotes(!showNotes)} className="text-slate-400 hover:text-slate-200" title="筆記">
          <BookmarkPlus size={16} />
        </button>
        <button onClick={() => setShowTutor(!showTutor)} className="text-slate-400 hover:text-sky-400" title="AI 助教">
          <MessageSquare size={16} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Outline sidebar */}
        {showOutline && (
          <div className="w-56 bg-slate-850 border-r border-slate-700 overflow-y-auto shrink-0 p-3">
            <h4 className="text-[10px] text-slate-500 font-semibold uppercase mb-2">章節大綱</h4>
            {lessons.map(lesson => {
              const lessonSlides = allSlides.filter(s => s.lesson_id === lesson.id)
              return (
                <div key={lesson.id} className="mb-2">
                  <div className="text-xs font-medium text-slate-300 mb-1">{lesson.title}</div>
                  {lessonSlides.map(slide => {
                    const idx = allSlides.indexOf(slide)
                    return (
                      <button key={slide.id}
                        onClick={() => { setCurrentIdx(idx); setShowOutline(false) }}
                        className={`w-full text-left text-[10px] px-2 py-1 rounded transition ${
                          idx === currentIdx ? 'bg-sky-600/20 text-sky-400' : 'text-slate-500 hover:bg-slate-800'
                        }`}
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
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-8">
          <div className="w-full max-w-4xl">
            <SlideRenderer slide={currentSlide} />
          </div>
        </div>

        {/* Notes panel */}
        {showNotes && (
          <div className="w-72 bg-slate-850 border-l border-slate-700 p-3 flex flex-col shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-400">筆記</h4>
              <button onClick={() => setShowNotes(false)} className="text-slate-500"><X size={14} /></button>
            </div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={6}
              className="w-full bg-slate-800 border border-slate-700 rounded text-xs px-2 py-1.5 resize-none focus:outline-none focus:border-sky-500 flex-1"
              placeholder="在此記錄筆記..."
            />
            <button onClick={saveNote} className="mt-2 text-xs bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded transition">
              儲存筆記
            </button>
          </div>
        )}

        {/* AI Tutor panel */}
        {showTutor && (
          <div className="w-80 bg-slate-850 border-l border-slate-700 flex flex-col shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
              <h4 className="text-xs font-semibold text-sky-400">AI 助教</h4>
              <button onClick={() => setShowTutor(false)} className="text-slate-500"><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {tutorMessages.length === 0 && (
                <p className="text-xs text-slate-600 text-center py-8">有問題嗎？隨時向 AI 助教提問！</p>
              )}
              {tutorMessages.map((msg, i) => (
                <div key={i} className={`text-xs rounded-lg px-3 py-2 ${
                  msg.role === 'user' ? 'bg-sky-600/20 text-sky-100 ml-4' : 'bg-slate-800 text-slate-300 mr-4'
                }`}>
                  {msg.content}
                </div>
              ))}
              {tutorLoading && <div className="text-xs text-slate-500 animate-pulse">思考中...</div>}
            </div>
            <div className="border-t border-slate-700 p-2 flex gap-2">
              <input
                value={tutorInput}
                onChange={e => setTutorInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendTutorMessage()}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-sky-500"
                placeholder="輸入問題..."
              />
              <button onClick={sendTutorMessage} disabled={tutorLoading}
                className="bg-sky-600 text-white px-2 py-1 rounded text-xs disabled:opacity-50">
                發送
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="bg-slate-800/90 backdrop-blur border-t border-slate-700/50 px-4 py-2 flex items-center gap-4 shrink-0">
        <button onClick={goPrev} disabled={currentIdx === 0}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-30">
          <ChevronLeft size={20} />
        </button>

        {/* Progress bar */}
        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-500 rounded-full transition-all duration-300"
            style={{ width: `${((currentIdx + 1) / allSlides.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-slate-500 w-16 text-center">
          {currentIdx + 1} / {allSlides.length}
        </span>

        <button onClick={goNext} disabled={currentIdx === allSlides.length - 1}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-30">
          <ChevronRight size={20} />
        </button>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  )
}
