import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../../lib/api'
import { ArrowLeft, Save, Plus, GripVertical, Trash2, Eye, Upload, ChevronDown, ChevronRight, Settings, FileText, Play, FolderTree, Camera, Images } from 'lucide-react'
import SlideEditor from './SlideEditor'
import CategoryManager from '../CategoryManager'
import BatchImport from './BatchImport'
import RecordingPanel from './RecordingPanel'

interface Course {
  id?: number
  title: string
  description: string
  category_id: number | null
  pass_score: number
  max_attempts: number | null
  time_limit_minutes: number | null
  status?: string
  cover_image?: string | null
}

interface Lesson {
  id: number
  title: string
  sort_order: number
  lesson_type: string
}

interface Category {
  id: number
  parent_id: number | null
  name: string
}

interface Slide {
  id: number
  slide_type: string
  content_json: string
  notes: string | null
  audio_url: string | null
  sort_order: number
}

export default function CourseEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id

  const [course, setCourse] = useState<Course>({
    title: '', description: '', category_id: null,
    pass_score: 60, max_attempts: null, time_limit_minutes: null
  })
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'lessons' | 'quiz' | 'translate' | 'settings'>('info')
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null)
  const [lessonSlides, setLessonSlides] = useState<Record<number, Slide[]>>({})
  const [editingSlideId, setEditingSlideId] = useState<number | null>(null)
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [showBatchImport, setShowBatchImport] = useState<number | null>(null) // lessonId
  const [showRecording, setShowRecording] = useState(() => {
    // Auto-open recording panel after page reload
    return !!sessionStorage.getItem('training_auto_start')
  })

  useEffect(() => {
    loadCategories()
    if (!isNew) loadCourse()
  }, [id])

  const loadCategories = async () => {
    try {
      const res = await api.get('/training/categories')
      setCategories(res.data)
    } catch (e) { console.error(e) }
  }

  const loadCourse = async () => {
    try {
      const res = await api.get(`/training/courses/${id}`)
      const c = res.data
      setCourse({
        id: c.id, title: c.title, description: c.description || '',
        category_id: c.category_id, pass_score: c.pass_score,
        max_attempts: c.max_attempts, time_limit_minutes: c.time_limit_minutes,
        status: c.status, cover_image: c.cover_image
      })
      setLessons(c.lessons || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const loadSlides = async (lessonId: number) => {
    if (lessonSlides[lessonId]) return
    try {
      const res = await api.get(`/training/lessons/${lessonId}/slides`)
      setLessonSlides(prev => ({ ...prev, [lessonId]: res.data }))
    } catch (e) { console.error(e) }
  }

  const saveCourse = async () => {
    if (!course.title.trim()) return
    try {
      setSaving(true)
      if (isNew) {
        const res = await api.post('/training/courses', course)
        navigate(`/training/editor/${res.data.id}`, { replace: true })
      } else {
        await api.put(`/training/courses/${id}`, course)
      }
    } catch (e: any) {
      alert(e.response?.data?.error || '儲存失敗')
    } finally { setSaving(false) }
  }

  const addLesson = async () => {
    if (!id) return
    try {
      const res = await api.post(`/training/courses/${id}/lessons`, {
        title: `章節 ${lessons.length + 1}`,
        lesson_type: 'slides'
      })
      setLessons([...lessons, res.data])
    } catch (e) { console.error(e) }
  }

  const deleteLesson = async (lessonId: number) => {
    if (!confirm('確定要刪除此章節？所有投影片將一併刪除。')) return
    try {
      await api.delete(`/training/lessons/${lessonId}`)
      setLessons(lessons.filter(l => l.id !== lessonId))
    } catch (e) { console.error(e) }
  }

  const addSlide = async (lessonId: number) => {
    try {
      const res = await api.post(`/training/lessons/${lessonId}/slides`, {
        slide_type: 'content',
        content_json: [{ type: 'text', content: '# 新投影片\n\n在此編輯內容...' }]
      })
      setLessonSlides(prev => ({
        ...prev,
        [lessonId]: [...(prev[lessonId] || []), res.data]
      }))
    } catch (e) { console.error(e) }
  }

  const publishCourse = async () => {
    if (!id) return
    try {
      await api.post(`/training/courses/${id}/publish`)
      setCourse(prev => ({ ...prev, status: 'published' }))
    } catch (e) { console.error(e) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text-dim)' }}>載入中...</div>

  const [translating, setTranslating] = useState<string | null>(null)
  const [translateStatus, setTranslateStatus] = useState<any>(null)

  const tabs = [
    { key: 'info', label: '基本資訊', icon: FileText },
    { key: 'lessons', label: '章節管理', icon: Play },
    { key: 'quiz', label: '題庫', icon: FileText },
    { key: 'translate', label: '翻譯', icon: FileText },
    { key: 'settings', label: '設定', icon: Settings },
  ] as const

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur border-b" style={{ backgroundColor: 'color-mix(in srgb, var(--t-bg) 95%, transparent)', borderColor: 'var(--t-border-subtle)' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/training/editor')} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-80">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-semibold truncate">
            {isNew ? '新增課程' : course.title || '編輯課程'}
          </h1>
          {course.status && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              course.status === 'published' ? 'bg-green-500/20 text-green-400' :
              course.status === 'draft' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-slate-500/20 text-slate-400'
            }`}>
              {course.status === 'draft' ? '草稿' : course.status === 'published' ? '已發佈' : '已封存'}
            </span>
          )}
          <div className="flex-1" />
          {!isNew && (
            <button onClick={async () => {
              if (!confirm('確定要刪除此課程？此操作無法復原，所有章節、投影片、題目都會一併刪除。')) return
              try {
                await api.delete(`/training/courses/${id}`)
                navigate('/training/editor')
              } catch (e: any) { alert(e.response?.data?.error || '刪除失敗') }
            }}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1.5 rounded-lg transition">
              <Trash2 size={13} /> 刪除
            </button>
          )}
          {!isNew && (
            <button onClick={() => setShowRecording(true)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition hover:opacity-80"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-accent)' }}>
              <Camera size={13} /> AI 錄製
            </button>
          )}
          {!isNew && course.status === 'draft' && (
            <button onClick={publishCourse}
              className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg transition">
              發佈課程
            </button>
          )}
          <button onClick={saveCourse} disabled={saving}
            className="flex items-center gap-1.5 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50"
            style={{ backgroundColor: 'var(--t-accent-bg)' }}>
            <Save size={14} /> {saving ? '儲存中...' : '儲存'}
          </button>
        </div>

        {/* Tabs */}
        {!isNew && (
          <div className="max-w-5xl mx-auto px-4 flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition ${
                  activeTab === tab.key
                    ? 'border-sky-500 text-sky-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Info Tab / New Course Form */}
        {(activeTab === 'info' || isNew) && (
          <div className="space-y-4 max-w-2xl">
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-muted)' }}>課程標題 *</label>
              <input
                value={course.title}
                onChange={e => setCourse({ ...course, title: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder="輸入課程標題"
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-muted)' }}>描述</label>
              <textarea
                value={course.description}
                onChange={e => setCourse({ ...course, description: e.target.value })}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder="課程描述..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 mb-1 flex items-center gap-2">
                  分類
                  <button onClick={() => setShowCategoryManager(true)}
                    className="text-[10px] text-sky-500 hover:text-sky-400 transition flex items-center gap-0.5">
                    <FolderTree size={10} /> 管理分類
                  </button>
                </label>
                <select
                  value={course.category_id || ''}
                  onChange={e => setCourse({ ...course, category_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                >
                  <option value="">未分類</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.parent_id ? '　' : ''}{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-muted)' }}>及格分數</label>
                <input
                  type="number"
                  value={course.pass_score}
                  onChange={e => setCourse({ ...course, pass_score: Number(e.target.value) })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                />
              </div>
            </div>

            {isNew && (
              <div className="pt-4">
                <button onClick={saveCourse} disabled={saving || !course.title.trim()}
                  className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50">
                  <Plus size={16} /> 建立課程
                </button>
              </div>
            )}
          </div>
        )}

        {/* Lessons Tab */}
        {activeTab === 'lessons' && !isNew && (
          <div className="space-y-3">
            {lessons.map((lesson, i) => (
              <div key={lesson.id} className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border-subtle)' }}>
                <div
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-750"
                  onClick={() => {
                    const nextExpanded = expandedLesson === lesson.id ? null : lesson.id
                    setExpandedLesson(nextExpanded)
                    if (nextExpanded) loadSlides(lesson.id)
                  }}
                >
                  <GripVertical size={14} className="text-slate-600 cursor-grab" />
                  <div className="w-6 h-6 rounded bg-sky-600/20 flex items-center justify-center text-sky-400 text-xs font-semibold">
                    {i + 1}
                  </div>
                  <input
                    value={lesson.title}
                    onChange={e => {
                      setLessons(lessons.map(l => l.id === lesson.id ? { ...l, title: e.target.value } : l))
                    }}
                    onBlur={() => {
                      api.put(`/training/lessons/${lesson.id}`, lesson).catch(console.error)
                    }}
                    onClick={e => e.stopPropagation()}
                    className="flex-1 bg-transparent text-sm font-medium focus:outline-none focus:bg-slate-700/50 px-2 py-0.5 rounded"
                  />
                  <select
                    value={lesson.lesson_type}
                    onChange={e => {
                      const updated = { ...lesson, lesson_type: e.target.value }
                      setLessons(lessons.map(l => l.id === lesson.id ? updated : l))
                      api.put(`/training/lessons/${lesson.id}`, updated).catch(console.error)
                    }}
                    onClick={e => e.stopPropagation()}
                    className="bg-slate-700 border-none text-[10px] rounded px-2 py-1"
                  >
                    <option value="slides">投影片</option>
                    <option value="video">影片</option>
                    <option value="simulation">操作模擬</option>
                  </select>
                  <button onClick={e => { e.stopPropagation(); deleteLesson(lesson.id) }}
                    className="text-slate-500 hover:text-red-400 transition">
                    <Trash2 size={14} />
                  </button>
                  {expandedLesson === lesson.id ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                </div>

                {/* Expanded: slides list */}
                {expandedLesson === lesson.id && (
                  <div className="border-t border-slate-700/50 bg-slate-850 px-4 py-3 space-y-2">
                    {(lessonSlides[lesson.id] || []).map((slide, si) => (
                      <div key={slide.id}
                        className="flex items-center gap-2 bg-slate-800 rounded px-3 py-2 text-xs cursor-pointer hover:bg-slate-750 transition"
                        onClick={() => setEditingSlideId(slide.id)}
                      >
                        <span className="text-slate-500 w-5">{si + 1}.</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                          slide.slide_type === 'hotspot' ? 'bg-red-500/20 text-red-400' :
                          slide.slide_type === 'dragdrop' ? 'bg-purple-500/20 text-purple-400' :
                          slide.slide_type === 'flipcard' ? 'bg-amber-500/20 text-amber-400' :
                          slide.slide_type === 'branch' ? 'bg-green-500/20 text-green-400' :
                          slide.slide_type === 'quiz_inline' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-slate-600/30 text-slate-400'
                        }`}>
                          {slide.slide_type}
                        </span>
                        <span className="flex-1 text-slate-300 truncate">
                          {(() => {
                            try {
                              const blocks = JSON.parse(slide.content_json || '[]')
                              return blocks[0]?.content?.slice(0, 50) || blocks[0]?.text?.slice(0, 50) || '(空投影片)'
                            } catch { return '(空投影片)' }
                          })()}
                        </span>
                        {slide.audio_url && <span className="text-sky-400 text-[9px]">🔊</span>}
                        <button
                          className="text-slate-600 hover:text-red-400 transition shrink-0"
                          title="刪除投影片"
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (!confirm('確定要刪除此投影片？')) return
                            try {
                              await api.delete(`/training/slides/${slide.id}`)
                              setLessonSlides(prev => ({
                                ...prev,
                                [lesson.id]: (prev[lesson.id] || []).filter(s => s.id !== slide.id)
                              }))
                            } catch (err) { console.error(err) }
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addSlide(lesson.id)}
                      className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-sky-400 border border-dashed border-slate-700 rounded-lg py-2 transition"
                    >
                      <Plus size={12} /> 新增投影片
                    </button>
                    <button
                      onClick={() => setShowBatchImport(lesson.id)}
                      className="w-full flex items-center justify-center gap-1.5 text-xs border border-dashed rounded-lg py-2 transition hover:opacity-80"
                      style={{ borderColor: 'var(--t-border)', color: 'var(--t-accent)' }}
                    >
                      <Images size={12} /> 批次匯入截圖 (AI 辨識)
                    </button>
                  </div>
                )}
              </div>
            ))}

            <button
              onClick={addLesson}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-slate-400 hover:text-sky-400 border border-dashed border-slate-700 rounded-lg py-3 transition"
            >
              <Plus size={16} /> 新增章節
            </button>
          </div>
        )}

        {/* Quiz Tab Placeholder */}
        {activeTab === 'quiz' && !isNew && (
          <div className="text-center text-slate-500 py-20">
            <FileText size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">題庫管理（開發中）</p>
          </div>
        )}

        {/* Translate Tab */}
        {activeTab === 'translate' && !isNew && (
          <div className="max-w-2xl space-y-4">
            <p className="text-xs" style={{ color: 'var(--t-text-dim)' }}>
              將課程內容（標題、說明、投影片、題目）翻譯成其他語言。使用 AI 自動翻譯，翻譯後可手動編輯。
            </p>

            {/* Translation actions */}
            {['en', 'vi'].map(lang => {
              const langName = lang === 'en' ? 'English' : 'Tiếng Việt'
              const langFlag = lang === 'en' ? '🇺🇸' : '🇻🇳'
              const status = translateStatus?.[lang]

              return (
                <div key={lang} className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-card)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{langFlag}</span>
                      <span className="text-sm font-medium" style={{ color: 'var(--t-text)' }}>{langName}</span>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          setTranslating(lang)
                          await api.post(`/training/courses/${id}/translate`, { target_lang: lang }, { timeout: 300000 })
                          // Refresh status
                          const statusRes = await api.get(`/training/courses/${id}/translate/status`)
                          setTranslateStatus(statusRes.data)
                          alert(`${langName} 翻譯完成！`)
                        } catch (e: any) {
                          alert(e.response?.data?.error || '翻譯失敗')
                        } finally { setTranslating(null) }
                      }}
                      disabled={translating === lang}
                      className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      style={{ backgroundColor: 'var(--t-accent-bg)' }}
                    >
                      {translating === lang ? '翻譯中...' : status?.course_translated ? '重新翻譯' : 'AI 翻譯'}
                    </button>
                  </div>

                  {status && (
                    <div className="text-xs space-y-1" style={{ color: 'var(--t-text-muted)' }}>
                      <div className="flex items-center gap-2">
                        <span>課程標題：{status.course_translated ? '✅' : '❌'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>投影片：{status.slides_translated}/{status.slides_total}</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
                          <div className="h-full rounded-full" style={{
                            backgroundColor: status.slides_translated === status.slides_total ? '#22c55e' : 'var(--t-accent)',
                            width: `${status.slides_total > 0 ? (status.slides_translated / status.slides_total) * 100 : 0}%`
                          }} />
                        </div>
                      </div>
                      {status.last_translated && (
                        <div style={{ color: 'var(--t-text-dim)' }}>
                          上次翻譯：{new Date(status.last_translated).toLocaleString('zh-TW')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Load translation status on tab open */}
            {!translateStatus && (
              <button
                onClick={async () => {
                  try {
                    const res = await api.get(`/training/courses/${id}/translate/status`)
                    setTranslateStatus(res.data)
                  } catch {}
                }}
                className="text-xs px-3 py-1.5 rounded-lg transition"
                style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}
              >
                載入翻譯狀態
              </button>
            )}
          </div>
        )}

        {/* Settings Tab Placeholder */}
        {activeTab === 'settings' && !isNew && (
          <div className="text-center text-slate-500 py-20">
            <Settings size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">課程設定（開發中）</p>
          </div>
        )}
      </div>

      {/* Category Manager */}
      {showCategoryManager && (
        <CategoryManager
          onClose={() => setShowCategoryManager(false)}
          onChanged={() => loadCategories()}
        />
      )}

      {/* Slide Editor Overlay */}
      {editingSlideId && id && (
        <SlideEditor
          slideId={editingSlideId}
          courseId={Number(id)}
          onClose={() => setEditingSlideId(null)}
          onSaved={() => {
            if (expandedLesson) {
              setLessonSlides(prev => ({ ...prev, [expandedLesson]: [] }))
              api.get(`/training/lessons/${expandedLesson}/slides`).then(res => {
                setLessonSlides(prev => ({ ...prev, [expandedLesson!]: res.data }))
              })
            }
          }}
        />
      )}

      {/* Batch Import */}
      {showBatchImport && id && (
        <BatchImport
          courseId={Number(id)}
          lessonId={showBatchImport}
          onComplete={() => {
            if (showBatchImport) {
              setLessonSlides(prev => ({ ...prev, [showBatchImport]: [] }))
              api.get(`/training/lessons/${showBatchImport}/slides`).then(res => {
                setLessonSlides(prev => ({ ...prev, [showBatchImport!]: res.data }))
              })
            }
          }}
          onClose={() => setShowBatchImport(null)}
        />
      )}

      {/* AI Recording Panel */}
      {showRecording && id && (
        <RecordingPanel
          courseId={Number(id)}
          lessonId={expandedLesson}
          onComplete={(result) => {
            setShowRecording(false)
            loadCourse()
          }}
          onClose={() => setShowRecording(false)}
        />
      )}
    </div>
  )
}
