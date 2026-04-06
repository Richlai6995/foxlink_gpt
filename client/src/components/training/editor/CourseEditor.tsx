import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../../lib/api'
import { ArrowLeft, Save, Plus, GripVertical, Trash2, Eye, Upload, ChevronDown, ChevronRight, Settings, FileText, Play, FolderTree, Camera, Images, Download, Loader2, Copy } from 'lucide-react'
import SlideEditor from './SlideEditor'
import CategoryManager from '../CategoryManager'
import BatchImport from './BatchImport'
import RecordingPanel from './RecordingPanel'
import InteractionReport from '../InteractionReport'
import CoverCropModal from './CoverCropModal'
import CourseShareTab from './CourseShareTab'

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
  settings_json?: Record<string, any>
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
  const { t } = useTranslation()
  const isNew = !id

  const [course, setCourse] = useState<Course>({
    title: '', description: '', category_id: null,
    pass_score: 60, max_attempts: null, time_limit_minutes: null
  })
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null)
  const [activeTab, setActiveTab] = useState<'info' | 'lessons' | 'quiz' | 'examTopics' | 'translate' | 'share' | 'settings' | 'reports'>('info')
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null)
  const [lessonSlides, setLessonSlides] = useState<Record<number, Slide[]>>({})
  const [editingSlideId, setEditingSlideId] = useState<number | null>(null)
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [showBatchImport, setShowBatchImport] = useState<number | null>(null) // lessonId
  const [showRecording, setShowRecording] = useState(() => {
    return !!sessionStorage.getItem('training_auto_start')
  })
  const [translating, setTranslating] = useState<string | null>(null)
  const [translateStatus, setTranslateStatus] = useState<any>(null)
  const [translateProgress, setTranslateProgress] = useState<{ step: string; current: number; total: number; slides_done?: number; slides_total?: number } | null>(null)
  const [showPublishCheck, setShowPublishCheck] = useState(false)
  const [publishChecks, setPublishChecks] = useState<{ key: string; pass: boolean; detail: string; optional?: boolean }[]>([])
  const [canPublish, setCanPublish] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [coursePermission, setCoursePermission] = useState<string>('owner') // owner|admin|develop|view

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
      let settingsObj = {}
      if (c.settings_json) { try { settingsObj = typeof c.settings_json === 'string' ? JSON.parse(c.settings_json) : c.settings_json } catch {} }
      setCourse({
        id: c.id, title: c.title, description: c.description || '',
        category_id: c.category_id, pass_score: c.pass_score,
        max_attempts: c.max_attempts, time_limit_minutes: c.time_limit_minutes,
        status: c.status, cover_image: c.cover_image,
        settings_json: settingsObj
      })
      setLessons(c.lessons || [])
      if (c.permission) setCoursePermission(c.permission)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const loadSlides = async (lessonId: number, autoSelect = false) => {
    if (lessonSlides[lessonId]) {
      if (autoSelect && lessonSlides[lessonId].length > 0) {
        setEditingSlideId(lessonSlides[lessonId][0].id)
      }
      return
    }
    try {
      const res = await api.get(`/training/lessons/${lessonId}/slides`)
      setLessonSlides(prev => ({ ...prev, [lessonId]: res.data }))
      if (autoSelect && res.data.length > 0) {
        setEditingSlideId(res.data[0].id)
      }
    } catch (e) { console.error(e) }
  }

  const saveCourse = async () => {
    if (!course.title.trim()) return
    try {
      setSaving(true)
      if (isNew) {
        const res = await api.post('/training/courses', course)
        navigate(`/training/dev/courses/${res.data.id}`, { replace: true })
      } else {
        await api.put(`/training/courses/${id}`, course)
      }
    } catch (e: any) {
      alert(e.response?.data?.error || t('training.saveFailed'))
    } finally { setSaving(false) }
  }

  const addLesson = async () => {
    if (!id) return
    try {
      const res = await api.post(`/training/courses/${id}/lessons`, {
        title: t('training.lessonN', { n: lessons.length + 1 }),
        lesson_type: 'slides'
      })
      setLessons([...lessons, res.data])
    } catch (e) { console.error(e) }
  }

  const deleteLesson = async (lessonId: number) => {
    if (!confirm(t('training.confirmDeleteLesson'))) return
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

  const openPublishCheck = async () => {
    if (!id) return
    try {
      const res = await api.get(`/training/courses/${id}/publish-check`)
      setPublishChecks(res.data.checks || [])
      setCanPublish(res.data.can_publish)
      setShowPublishCheck(true)
    } catch (e) { console.error(e) }
  }

  const confirmPublish = async () => {
    if (!id) return
    try {
      setPublishing(true)
      await api.post(`/training/courses/${id}/publish`, { force: true })
      setCourse(prev => ({ ...prev, status: 'published' }))
      setShowPublishCheck(false)
    } catch (e: any) {
      alert(e.response?.data?.error || t('training.publishFailed'))
    } finally { setPublishing(false) }
  }

  const unpublishCourse = async () => {
    if (!id || !confirm(t('training.confirmUnpublish'))) return
    try {
      await api.post(`/training/courses/${id}/unpublish`)
      setCourse(prev => ({ ...prev, status: 'draft' }))
    } catch (e) { console.error(e) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>

  // Permission-based UI control
  // owner/admin/develop = full edit; view = readonly preview
  const canEditThis = ['owner', 'admin', 'develop'].includes(coursePermission)
  const isViewOnly = coursePermission === 'view'

  // Tabs: view-only users can only access info, lessons (readonly), and navigate to learn/quiz for preview
  // Disabled tabs for view-only: settings, reports, share
  const disabledTabs = isViewOnly ? ['settings', 'reports', 'share'] as const : []

  const allTabs: { key: 'info' | 'lessons' | 'quiz' | 'examTopics' | 'translate' | 'share' | 'reports' | 'settings'; label: string; icon: typeof FileText; disabled?: boolean }[] = [
    { key: 'info', label: t('training.tabInfo'), icon: FileText },
    { key: 'lessons', label: t('training.tabLessons'), icon: Play },
    { key: 'quiz', label: t('training.tabQuiz'), icon: FileText },
    { key: 'examTopics', label: t('training.tabExamTopics'), icon: FileText },
    { key: 'translate', label: t('training.tabTranslate'), icon: FileText },
    { key: 'share', label: t('training.tabShare'), icon: FileText, disabled: isViewOnly },
    { key: 'reports', label: t('training.tabReports'), icon: FileText },
    { key: 'settings', label: t('training.tabSettings'), icon: Settings, disabled: isViewOnly },
  ]
  const tabs = allTabs

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur border-b" style={{ backgroundColor: 'color-mix(in srgb, var(--t-bg) 95%, transparent)', borderColor: 'var(--t-border-subtle)' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(isNew ? '/training/dev/courses' : `/training/dev/courses`)} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-80">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-semibold truncate">
            {isNew ? t('training.newCourse') : course.title || t('training.editCourse')}
          </h1>
          {course.status && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              course.status === 'published' ? 'bg-green-500/20 text-green-400' :
              course.status === 'draft' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-slate-500/20 text-slate-400'
            }`}>
              {course.status === 'draft' ? t('training.draft') : course.status === 'published' ? t('training.published') : t('training.archived')}
            </span>
          )}
          <div className="flex-1" />
          {/* Preview: navigate to learn/test */}
          {!isNew && (
            <button onClick={() => navigate(`/training/course/${id}/learn?from=editor`)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition hover:opacity-80"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-accent)' }}>
              <Eye size={13} /> {t('training.preview')}
            </button>
          )}
          {!isNew && canEditThis && (
            <button onClick={async () => {
              if (!confirm(t('training.confirmDeleteCourse'))) return
              try {
                await api.delete(`/training/courses/${id}`)
                navigate('/training/dev/courses')
              } catch (e: any) { alert(e.response?.data?.error || t('training.deleteFailed')) }
            }}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1.5 rounded-lg transition">
              <Trash2 size={13} /> {t('training.delete')}
            </button>
          )}
          {!isNew && canEditThis && (
            <button onClick={() => setShowRecording(true)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition hover:opacity-80"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-accent)' }}>
              <Camera size={13} /> {t('training.aiRecording')}
            </button>
          )}
          {!isNew && canEditThis && (
            <ExportButton courseId={Number(id)} />
          )}
          {!isNew && canEditThis && (
            <button onClick={() => {
              const token = localStorage.getItem('token')
              window.open(`/api/training/courses/${id}/export-package?token=${token}`, '_blank')
            }}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition hover:opacity-80"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}
              title={t('training.exportPackage')}>
              <Download size={13} /> {t('training.exportPackage')}
            </button>
          )}
          {!isNew && canEditThis && course.status === 'draft' && (
            <button onClick={openPublishCheck}
              className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg transition">
              {t('training.publishCourse')}
            </button>
          )}
          {!isNew && canEditThis && course.status === 'published' && (
            <button onClick={unpublishCourse}
              className="text-xs bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1.5 rounded-lg transition">
              {t('training.unpublishCourse')}
            </button>
          )}
          {canEditThis && (
            <button onClick={saveCourse} disabled={saving}
              className="flex items-center gap-1.5 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50"
              style={{ backgroundColor: 'var(--t-accent-bg)' }}>
              <Save size={14} /> {saving ? t('training.saving') : t('training.save')}
            </button>
          )}
        </div>

        {/* Tabs */}
        {!isNew && (
          <div className="max-w-5xl mx-auto px-4 flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => !tab.disabled && setActiveTab(tab.key)}
                disabled={tab.disabled}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition ${
                  tab.disabled
                    ? 'border-transparent text-slate-600 opacity-40 cursor-not-allowed'
                    : activeTab === tab.key
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
          <div className={`space-y-4 max-w-2xl ${isViewOnly ? 'pointer-events-none opacity-70' : ''}`}>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-muted)' }}>{t('training.courseTitle')}</label>
              <input
                value={course.title}
                onChange={e => setCourse({ ...course, title: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder={t('training.courseTitlePlaceholder')}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-muted)' }}>{t('training.description')}</label>
              <textarea
                value={course.description}
                onChange={e => setCourse({ ...course, description: e.target.value })}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder={t('training.descriptionPlaceholder')}
              />
            </div>
            {/* Cover Image */}
            {!isNew && (
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-muted)' }}>封面圖片</label>
                <div className="flex items-start gap-3">
                  <div className="relative w-40 h-24 rounded-lg border overflow-hidden group"
                    style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))' }}>
                    {course.cover_image ? (
                      <>
                        <img src={course.cover_image.startsWith('/') ? course.cover_image : '/' + course.cover_image}
                          alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                          <label className="p-1.5 rounded-full bg-white/20 text-white hover:bg-white/30 cursor-pointer" title="更換封面">
                            <Upload size={14} />
                            <input type="file" accept="image/*" className="hidden" onChange={e => {
                              if (e.target.files?.[0]) setCoverCropFile(e.target.files[0])
                              e.target.value = ''
                            }} />
                          </label>
                          <button onClick={async () => {
                            if (!confirm('確定移除封面圖片？')) return
                            try {
                              await api.post(`/training/courses/${id}/cover`, new FormData())
                              setCourse({ ...course, cover_image: null })
                            } catch {}
                          }}
                            className="p-1.5 rounded-full bg-white/20 text-white hover:bg-red-500/50" title="移除封面">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer transition hover:opacity-80"
                        style={{ color: 'var(--t-text-dim)' }}>
                        <Images size={20} className="mb-1 opacity-40" />
                        <span className="text-[10px]">上傳封面</span>
                        <input type="file" accept="image/*" className="hidden" onChange={e => {
                          if (e.target.files?.[0]) setCoverCropFile(e.target.files[0])
                          e.target.value = ''
                        }} />
                      </label>
                    )}
                  </div>
                  <span className="text-[10px] mt-1" style={{ color: 'var(--t-text-dim)' }}>
                    選擇圖片後可調整可見範圍
                  </span>
                </div>
              </div>
            )}

            {/* Cover crop modal */}
            {coverCropFile && (
              <CoverCropModal
                imageFile={coverCropFile}
                onConfirm={async (blob) => {
                  const form = new FormData()
                  form.append('cover', blob, 'cover.jpg')
                  try {
                    const res = await api.post(`/training/courses/${id}/cover`, form)
                    setCourse(prev => ({ ...prev, cover_image: res.data.cover_image }))
                  } catch (err: any) { alert(err.response?.data?.error || '上傳失敗') }
                  setCoverCropFile(null)
                }}
                onClose={() => setCoverCropFile(null)}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 mb-1 flex items-center gap-2">
                  {t('training.category')}
                  <button onClick={() => setShowCategoryManager(true)}
                    className="text-[10px] text-sky-500 hover:text-sky-400 transition flex items-center gap-0.5">
                    <FolderTree size={10} /> {t('training.categoryManage')}
                  </button>
                </label>
                <select
                  value={course.category_id || ''}
                  onChange={e => setCourse({ ...course, category_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                >
                  <option value="">{t('training.uncategorized')}</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.parent_id ? '　' : ''}{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {isNew && (
              <div className="pt-4">
                <button onClick={saveCourse} disabled={saving || !course.title.trim()}
                  className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50">
                  <Plus size={16} /> {t('training.createCourse')}
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
                    if (nextExpanded) loadSlides(lesson.id, true)
                  }}
                >
                  {canEditThis && <GripVertical size={14} className="text-slate-600 cursor-grab" />}
                  <div className="w-6 h-6 rounded bg-sky-600/20 flex items-center justify-center text-sky-400 text-xs font-semibold">
                    {i + 1}
                  </div>
                  {canEditThis ? (
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
                  ) : (
                    <span className="flex-1 text-sm font-medium px-2 py-0.5">{lesson.title}</span>
                  )}
                  {canEditThis ? (
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
                      <option value="slides">{t('training.slides')}</option>
                      <option value="video">{t('training.video')}</option>
                      <option value="simulation">{t('training.simulation')}</option>
                    </select>
                  ) : (
                    <span className="text-[10px] rounded px-2 py-1 bg-slate-700">{lesson.lesson_type}</span>
                  )}
                  {canEditThis && (
                    <button onClick={e => { e.stopPropagation(); deleteLesson(lesson.id) }}
                      className="text-slate-500 hover:text-red-400 transition">
                      <Trash2 size={14} />
                    </button>
                  )}
                  {expandedLesson === lesson.id ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                </div>

                {/* Expanded: slides list — drag to reorder */}
                {expandedLesson === lesson.id && (
                  <div className="border-t border-slate-700/50 bg-slate-850 px-4 py-3 space-y-1">
                    {(lessonSlides[lesson.id] || []).map((slide, si) => {
                      const slides = lessonSlides[lesson.id] || []
                      return (
                      <div key={slide.id}
                        draggable={canEditThis}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                          ;(e.currentTarget as HTMLElement).dataset.dragIdx = String(si)
                        }}
                        onDragEnd={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          ;(e.currentTarget as HTMLElement).style.borderTop = '2px solid var(--t-accent, #3b82f6)'
                        }}
                        onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.borderTop = '' }}
                        onDrop={async (e) => {
                          e.preventDefault()
                          ;(e.currentTarget as HTMLElement).style.borderTop = ''
                          const fromEl = document.querySelector('[data-drag-idx]') as HTMLElement
                          const fromIdx = fromEl ? Number(fromEl.dataset.dragIdx) : -1
                          if (fromEl) delete fromEl.dataset.dragIdx
                          if (fromIdx < 0 || fromIdx === si) return
                          const newSlides = [...slides]
                          const [moved] = newSlides.splice(fromIdx, 1)
                          newSlides.splice(si, 0, moved)
                          setLessonSlides(prev => ({ ...prev, [lesson.id]: newSlides }))
                          const order = newSlides.map((s, idx) => ({ id: s.id, sort_order: idx + 1 }))
                          api.put(`/training/lessons/${lesson.id}/slides/reorder`, { order }).catch(console.error)
                        }}
                        className="flex items-center gap-2 rounded px-2 py-2 text-xs cursor-pointer transition group"
                        style={{ backgroundColor: 'var(--t-bg-card)' }}
                        onClick={() => setEditingSlideId(slide.id)}
                      >
                        {/* Drag handle */}
                        {canEditThis && <GripVertical size={12} className="shrink-0 cursor-grab text-slate-400 opacity-40 group-hover:opacity-100 transition"
                          onMouseDown={e => e.stopPropagation()} />}
                        <span style={{ color: 'var(--t-text-dim)' }} className="w-5 text-center">{si + 1}.</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${
                          slide.slide_type === 'hotspot' ? 'bg-red-500/20 text-red-400' :
                          slide.slide_type === 'dragdrop' ? 'bg-purple-500/20 text-purple-400' :
                          slide.slide_type === 'flipcard' ? 'bg-amber-500/20 text-amber-400' :
                          slide.slide_type === 'branch' ? 'bg-green-500/20 text-green-400' :
                          slide.slide_type === 'quiz_inline' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-slate-600/30 text-slate-400'
                        }`}>
                          {slide.slide_type}
                        </span>
                        <span className="flex-1 truncate" style={{ color: 'var(--t-text-secondary)' }}>
                          {(() => {
                            try {
                              const blocks = JSON.parse(slide.content_json || '[]')
                              const b = blocks[0]
                              return b?.instruction?.slice(0, 50) || b?.content?.slice(0, 50) || b?.text?.slice(0, 50) || t('training.emptySlide')
                            } catch { return t('training.emptySlide') }
                          })()}
                        </span>
                        {slide.audio_url && <span className="text-sky-400 text-[9px]">🔊</span>}
                        {canEditThis && (
                          <button
                            className="shrink-0 hover:text-sky-400 transition opacity-0 group-hover:opacity-100"
                            style={{ color: 'var(--t-text-dim)' }}
                            title={t('training.duplicateSlide')}
                            onClick={async (e) => {
                              e.stopPropagation()
                              try {
                                const res = await api.post(`/training/slides/${slide.id}/duplicate`)
                                if (res.data.ok) {
                                  const updated = await api.get(`/training/lessons/${lesson.id}/slides`)
                                  setLessonSlides(prev => ({ ...prev, [lesson.id]: updated.data }))
                                  setEditingSlideId(res.data.id)
                                }
                              } catch (err) { console.error(err) }
                            }}
                          >
                            <Copy size={11} />
                          </button>
                        )}
                        {canEditThis && (
                          <button
                            className="shrink-0 hover:text-red-400 transition opacity-0 group-hover:opacity-100"
                            style={{ color: 'var(--t-text-dim)' }}
                            title={t('training.deleteSlide')}
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (!confirm(t('training.confirmDeleteSlide'))) return
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
                        )}
                      </div>
                      )
                    })}
                    {canEditThis && (
                      <>
                        <button
                          onClick={() => addSlide(lesson.id)}
                          className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-sky-400 border border-dashed border-slate-700 rounded-lg py-2 transition"
                        >
                          <Plus size={12} /> {t('training.addSlide')}
                        </button>
                        <button
                          onClick={() => setShowBatchImport(lesson.id)}
                          className="w-full flex items-center justify-center gap-1.5 text-xs border border-dashed rounded-lg py-2 transition hover:opacity-80"
                          style={{ borderColor: 'var(--t-border)', color: 'var(--t-accent)' }}
                        >
                          <Images size={12} /> {t('training.batchImport')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}

            {canEditThis && (
              <button
                onClick={addLesson}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-slate-400 hover:text-sky-400 border border-dashed border-slate-700 rounded-lg py-3 transition"
              >
                <Plus size={16} /> {t('training.addLesson')}
              </button>
            )}
          </div>
        )}

        {/* Quiz Tab Placeholder */}
        {activeTab === 'quiz' && !isNew && (
          <div className="text-center text-slate-500 py-20">
            <FileText size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">{t('training.quizManagement')}</p>
          </div>
        )}

        {/* Translate Tab */}
        {activeTab === 'translate' && !isNew && (
          <div className="max-w-2xl space-y-4">
            <p className="text-xs" style={{ color: 'var(--t-text-dim)' }}>
              {t('training.translateDesc')}
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
                          setTranslateProgress(null)
                          // Use fetch + SSE to track progress
                          const token = localStorage.getItem('token')
                          const resp = await fetch(`/api/training/courses/${id}/translate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ target_lang: lang })
                          })
                          const reader = resp.body?.getReader()
                          const decoder = new TextDecoder()
                          let buf = ''
                          while (reader) {
                            const { done, value } = await reader.read()
                            if (done) break
                            buf += decoder.decode(value, { stream: true })
                            const lines = buf.split('\n')
                            buf = lines.pop() || ''
                            for (const line of lines) {
                              if (!line.startsWith('data: ')) continue
                              try {
                                const evt = JSON.parse(line.slice(6))
                                if (evt.type === 'progress') setTranslateProgress(evt)
                                if (evt.type === 'done') {
                                  setTranslateProgress(null)
                                  const statusRes = await api.get(`/training/courses/${id}/translate/status`)
                                  setTranslateStatus(statusRes.data)
                                }
                                if (evt.type === 'error') throw new Error(evt.error)
                              } catch {}
                            }
                          }
                        } catch (e: any) {
                          alert(e.message || t('training.translateFailed'))
                        } finally { setTranslating(null); setTranslateProgress(null) }
                      }}
                      disabled={!!translating}
                      className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      style={{ backgroundColor: 'var(--t-accent-bg)' }}
                    >
                      {translating === lang ? t('training.translating') : status?.course_translated ? t('training.retranslate') : t('training.aiTranslate')}
                    </button>
                  </div>

                  {/* Live progress during translation */}
                  {translating === lang && translateProgress && (
                    <div className="text-xs space-y-1.5 p-2 rounded-lg" style={{ backgroundColor: 'var(--t-accent-subtle)' }}>
                      <div className="flex items-center gap-2" style={{ color: 'var(--t-accent)' }}>
                        <span className="animate-spin text-[10px]">⏳</span>
                        <span>{translateProgress.step}</span>
                      </div>
                      <div className="flex items-center gap-2" style={{ color: 'var(--t-text-muted)' }}>
                        <span>{translateProgress.current}/{translateProgress.total}</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
                          <div className="h-full rounded-full transition-all" style={{
                            backgroundColor: 'var(--t-accent)',
                            width: `${translateProgress.total > 0 ? (translateProgress.current / translateProgress.total) * 100 : 0}%`
                          }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Status after translation */}
                  {status && !translating && (
                    <div className="text-xs space-y-1" style={{ color: 'var(--t-text-muted)' }}>
                      <div className="flex items-center gap-2">
                        <span>{t('training.courseTranslated')}{status.course_translated ? '✅' : '❌'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>{t('training.slidesTranslated')}{status.slides_translated}/{status.slides_total}</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
                          <div className="h-full rounded-full" style={{
                            backgroundColor: status.slides_translated === status.slides_total ? '#22c55e' : 'var(--t-accent)',
                            width: `${status.slides_total > 0 ? (status.slides_translated / status.slides_total) * 100 : 0}%`
                          }} />
                        </div>
                      </div>
                      {status.last_translated && (
                        <div style={{ color: 'var(--t-text-dim)' }}>
                          {t('training.lastTranslated')}{new Date(status.last_translated).toLocaleString('zh-TW')}
                        </div>
                      )}
                      {status.course_translated && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          <button
                            onClick={() => navigate(`/training/course/${id}/learn?lang=${lang}`)}
                            className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg transition text-white"
                            style={{ backgroundColor: 'var(--t-accent-bg)' }}
                          >
                            📖 {t('training.previewLearn', { lang: langName })}
                          </button>
                          <button
                            onClick={() => navigate(`/training/course/${id}/learn?lang=${lang}&mode=test`)}
                            className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg transition text-white"
                            style={{ backgroundColor: '#f59e0b' }}
                          >
                            📝 {t('training.previewTest', { lang: langName })}
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                setTranslating(lang)
                                setTranslateProgress({ step: t('training.generateLangAudio', { lang: langName }) + '...', current: 0, total: 1 })
                                await api.post(`/training/courses/${id}/generate-lang-tts`, { target_lang: lang }, { timeout: 120000 })
                                setTranslateProgress(null)
                                alert(t('training.langAudioComplete', { lang: langName }))
                              } catch (e: any) { alert(e.response?.data?.error || t('training.langAudioFailed')) }
                              finally { setTranslating(null); setTranslateProgress(null) }
                            }}
                            disabled={!!translating}
                            className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                            style={{ backgroundColor: '#22c55e', color: 'white' }}
                          >
                            🔊 {t('training.generateLangAudio', { lang: langName })}
                          </button>
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
                {t('training.loading')}
              </button>
            )}
          </div>
        )}

        {/* Exam Topics Tab */}
        {activeTab === 'examTopics' && !isNew && id && (
          <ExamTopicsManager courseId={Number(id)} lessons={lessons} examDefaults={course.settings_json?.exam} passScore={course.pass_score} />
        )}

        {/* Reports Tab */}
        {activeTab === 'share' && !isNew && id && (
          <CourseShareTab courseId={Number(id)} />
        )}

        {activeTab === 'reports' && !isNew && id && (
          <InteractionReport courseId={Number(id)} />
        )}

        {/* Settings Tab Placeholder */}
        {activeTab === 'settings' && !isNew && (
          <>
            {/* TTS Voice Settings */}
            <div className="rounded-xl p-5 mb-4" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
              <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--t-text)' }}>{t('training.ttsSettings')}</h3>
              <p className="text-[10px] mb-3" style={{ color: 'var(--t-text-dim)' }}>{t('training.ttsSettingsDesc')}</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>{t('training.voice')}</label>
                  <div className="flex gap-1">
                    {(['female', 'male'] as const).map(g => (
                      <button key={g}
                        onClick={() => setCourse({ ...course, settings_json: { ...(course.settings_json || {}), tts_voice_gender: g } })}
                        className="flex-1 text-[11px] py-1.5 rounded transition font-medium"
                        style={{
                          backgroundColor: (course.settings_json?.tts_voice_gender || 'female') === g ? 'var(--t-accent-subtle)' : 'transparent',
                          color: (course.settings_json?.tts_voice_gender || 'female') === g ? 'var(--t-accent)' : 'var(--t-text-dim)',
                          border: `1px solid ${(course.settings_json?.tts_voice_gender || 'female') === g ? 'var(--t-accent)' : 'var(--t-border)'}`
                        }}>
                        {g === 'female' ? t('training.voiceFemale') : t('training.voiceMale')}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>{t('training.speed')}</label>
                  <div className="flex gap-1">
                    {[{ v: 0.85, l: t('training.speedSlow') }, { v: 1.0, l: t('training.speedNormal') }, { v: 1.15, l: t('training.speedFast') }].map(s => (
                      <button key={s.v}
                        onClick={() => setCourse({ ...course, settings_json: { ...(course.settings_json || {}), tts_speed: s.v } })}
                        className="flex-1 text-[11px] py-1.5 rounded transition font-medium"
                        style={{
                          backgroundColor: (course.settings_json?.tts_speed || 1.0) === s.v ? 'var(--t-accent-subtle)' : 'transparent',
                          color: (course.settings_json?.tts_speed || 1.0) === s.v ? 'var(--t-accent)' : 'var(--t-text-dim)',
                          border: `1px solid ${(course.settings_json?.tts_speed || 1.0) === s.v ? 'var(--t-accent)' : 'var(--t-border)'}`
                        }}>
                        {s.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>{t('training.pitch')}</label>
                  <input type="range" min={-5} max={5} step={1}
                    value={course.settings_json?.tts_pitch || 0}
                    onChange={e => setCourse({ ...course, settings_json: { ...(course.settings_json || {}), tts_pitch: Number(e.target.value) } })}
                    className="w-full" />
                  <div className="flex justify-between text-[9px]" style={{ color: 'var(--t-text-dim)' }}>
                    <span>{t('training.pitchLow')}</span><span>{course.settings_json?.tts_pitch || 0}</span><span>{t('training.pitchHigh')}</span>
                  </div>
                </div>
              </div>
              <button onClick={saveCourse} disabled={saving}
                className="mt-3 flex items-center gap-1 text-xs font-medium px-4 py-1.5 rounded-lg transition disabled:opacity-50 text-white"
                style={{ backgroundColor: 'var(--t-accent-bg)' }}>
                <Save size={13} /> {saving ? t('training.saving') : t('training.saveSettings')}
              </button>
            </div>
            {/* Exam Settings */}
            <div className="rounded-xl p-5 mb-4" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
              <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--t-text)' }}>{t('training.examSettings')}</h3>
              <p className="text-[10px] mb-4" style={{ color: 'var(--t-text-dim)' }}>{t('training.examSettingsDesc')}</p>

              {(() => {
                const exam = course.settings_json?.exam || {};
                const updateExam = (val: any) => {
                  setCourse({ ...course, settings_json: { ...(course.settings_json || {}), exam: { ...exam, ...val } } });
                };

                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <label className="text-[10px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>{t('training.totalScore')}</label>
                        <input type="number" min={10} max={1000} value={exam.total_score || 100}
                          onChange={e => updateExam({ total_score: Number(e.target.value) })}
                          className="w-full border rounded px-2 py-1.5 text-xs"
                          style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
                      </div>
                      <div>
                        <label className="text-[10px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>{t('training.passScore')}</label>
                        <input type="number" min={0} max={1000} value={course.pass_score || 60}
                          onChange={e => setCourse({ ...course, pass_score: Number(e.target.value) })}
                          className="w-full border rounded px-2 py-1.5 text-xs"
                          style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
                      </div>
                      <div>
                        <label className="text-[10px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>{t('training.timeLimitMin')}</label>
                        <div className="flex items-center gap-2">
                          <input type="number" min={1} max={180} value={exam.time_limit_minutes || 10}
                            disabled={exam.time_limit_enabled === false}
                            onChange={e => updateExam({ time_limit_minutes: Number(e.target.value) })}
                            className="w-full border rounded px-2 py-1.5 text-xs disabled:opacity-40"
                            style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
                        </div>
                      </div>
                      <div className="flex flex-col justify-end gap-1.5">
                        <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--t-text)' }}>
                          <input type="checkbox" checked={exam.time_limit_enabled !== false}
                            onChange={e => updateExam({ time_limit_enabled: e.target.checked })}
                            className="rounded" />
                          {t('training.enableTimeLimit')}
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] block mb-1" style={{ color: 'var(--t-text-dim)' }}>{t('training.overtimeAction')}</label>
                        <div className="flex gap-1">
                          {([
                            { v: 'auto_submit', l: t('training.autoSubmit') },
                            { v: 'warn_continue', l: t('training.warnContinue') }
                          ] as const).map(opt => (
                            <button key={opt.v}
                              onClick={() => updateExam({ overtime_action: opt.v })}
                              className="flex-1 text-[11px] py-1.5 rounded transition font-medium"
                              style={{
                                backgroundColor: (exam.overtime_action || 'auto_submit') === opt.v ? 'var(--t-accent-subtle)' : 'transparent',
                                color: (exam.overtime_action || 'auto_submit') === opt.v ? 'var(--t-accent)' : 'var(--t-text-dim)',
                                border: `1px solid ${(exam.overtime_action || 'auto_submit') === opt.v ? 'var(--t-accent)' : 'var(--t-border)'}`
                              }}>
                              {opt.l}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] block mb-1" style={{ color: 'var(--t-text-dim)' }}>{t('training.scoringMode')}</label>
                        <div className="flex gap-1">
                          {([
                            { v: 'even', l: t('training.evenDistribution') },
                            { v: 'custom', l: t('training.customWeights') }
                          ] as const).map(opt => (
                            <button key={opt.v}
                              onClick={() => updateExam({ scoring_mode: opt.v })}
                              className="flex-1 text-[11px] py-1.5 rounded transition font-medium"
                              style={{
                                backgroundColor: (exam.scoring_mode || 'even') === opt.v ? 'var(--t-accent-subtle)' : 'transparent',
                                color: (exam.scoring_mode || 'even') === opt.v ? 'var(--t-accent)' : 'var(--t-text-dim)',
                                border: `1px solid ${(exam.scoring_mode || 'even') === opt.v ? 'var(--t-accent)' : 'var(--t-border)'}`
                              }}>
                              {opt.l}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {(exam.scoring_mode === 'custom') && (
                      <div className="text-[10px] px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--t-bg-inset)', color: 'var(--t-text-dim)' }}>
                        {t('training.customWeightsHint')}
                      </div>
                    )}
                  </div>
                );
              })()}

              <button onClick={saveCourse} disabled={saving}
                className="mt-4 flex items-center gap-1 text-xs font-medium px-4 py-1.5 rounded-lg transition disabled:opacity-50 text-white"
                style={{ backgroundColor: 'var(--t-accent-bg)' }}>
                <Save size={13} /> {saving ? t('training.saving') : t('training.saveSettings')}
              </button>
            </div>

            <TrainingAISettings />
          </>
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
          slideList={expandedLesson ? (lessonSlides[expandedLesson] || []) : []}
          onSlideChange={(sid) => setEditingSlideId(sid)}
          onClose={() => setEditingSlideId(null)}
          readOnly={isViewOnly}
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

      {/* Publish Checklist Modal */}
      {showPublishCheck && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowPublishCheck(false)}>
          <div className="rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}
            style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--t-text)' }}>{t('training.publishChecklist')}</h2>
            <div className="space-y-2 mb-5">
              {publishChecks.map(check => (
                <div key={check.key} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{ backgroundColor: check.pass ? 'rgba(34,197,94,0.08)' : check.optional ? 'rgba(234,179,8,0.08)' : 'rgba(239,68,68,0.08)' }}>
                  <span className="text-lg">{check.pass ? '\u2705' : check.optional ? '\u26a0\ufe0f' : '\u274c'}</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--t-text)' }}>
                      {t(`training.check_${check.key}`)}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>{check.detail}</div>
                  </div>
                  {check.optional && <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">{t('training.optional')}</span>}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowPublishCheck(false)}
                className="px-4 py-2 text-xs rounded-lg transition"
                style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
                {t('training.cancel')}
              </button>
              <button onClick={confirmPublish} disabled={!canPublish || publishing}
                className="px-4 py-2 text-xs font-medium text-white rounded-lg transition disabled:opacity-40 bg-green-600 hover:bg-green-500">
                {publishing ? t('training.publishing') : t('training.confirmPublish')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Training AI Settings — 辨識模型 + 翻譯模型設定
// ═══════════════════════════════════════════════════════════════════════════════

function TrainingAISettings() {
  const { t } = useTranslation()
  const [models, setModels] = useState<{ id: number; display_name: string; api_model: string }[]>([])
  const [analyzeModel, setAnalyzeModel] = useState('')
  const [translateModel, setTranslateModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/training/ai/models'),
      api.get('/training/ai/settings')
    ]).then(([modelsRes, settingsRes]) => {
      setModels(modelsRes.data || [])
      setAnalyzeModel(settingsRes.data?.training_analyze_model || '')
      setTranslateModel(settingsRes.data?.training_translate_model || '')
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const save = async () => {
    try {
      setSaving(true)
      await api.put('/training/ai/settings', {
        training_analyze_model: analyzeModel,
        training_translate_model: translateModel
      })
    } catch (e: any) {
      alert(e.response?.data?.error || t('training.saveFailed'))
    } finally { setSaving(false) }
  }

  if (!loaded) return <div className="py-12 text-center text-xs" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--t-text)' }}>{t('training.aiModelSettings')}</h3>
        <p className="text-xs" style={{ color: 'var(--t-text-dim)' }}>
          {t('training.aiModelSettingsDesc')}
        </p>
      </div>

      {/* Analyze model */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{ color: 'var(--t-text-secondary)' }}>
          {t('training.screenshotModel')}
        </label>
        <p className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>
          {t('training.screenshotModelDesc')}
        </p>
        <select value={analyzeModel} onChange={e => setAnalyzeModel(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}>
          <option value="">{t('training.autoSelect')}</option>
          {models.map(m => (
            <option key={m.id} value={m.api_model}>{m.display_name || m.api_model}</option>
          ))}
        </select>
      </div>

      {/* Translate model */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{ color: 'var(--t-text-secondary)' }}>
          {t('training.translateModel')}
        </label>
        <p className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>
          {t('training.translateModelDesc')}
        </p>
        <select value={translateModel} onChange={e => setTranslateModel(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}>
          <option value="">{t('training.autoSelect')}</option>
          {models.map(m => (
            <option key={m.id} value={m.api_model}>{m.display_name || m.api_model}</option>
          ))}
        </select>
      </div>

      <button onClick={save} disabled={saving}
        className="flex items-center gap-1.5 text-xs text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
        style={{ backgroundColor: 'var(--t-accent-bg)' }}>
        <Save size={13} /> {saving ? t('training.saving') : t('training.saveSettings')}
      </button>

      {/* Model comparison info */}
      <div className="rounded-lg p-3 border text-[11px] space-y-1" style={{ backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))', borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}>
        <div className="font-medium mb-1.5" style={{ color: 'var(--t-text-muted)' }}>模型比較參考</div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
          <span className="font-medium" style={{ color: 'var(--t-text-secondary)' }}>模型</span>
          <span className="font-medium" style={{ color: 'var(--t-text-secondary)' }}>速度</span>
          <span className="font-medium" style={{ color: 'var(--t-text-secondary)' }}>精度</span>
          <span>Flash</span><span>快 (~3 秒/張)</span><span>一般</span>
          <span>Pro</span><span>慢 (~8 秒/張)</span><span>高</span>
        </div>
        <div className="mt-1.5">建議：大量截圖用 Flash、複雜 ERP 用 Pro、有標註的截圖 Flash 就夠</div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2F: HTML5 Export Button
// ═══════════════════════════════════════════════════════════════════════════════

function ExportButton({ courseId }: { courseId: number }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [langs, setLangs] = useState<string[]>(['zh-TW'])
  const [includeQuiz, setIncludeQuiz] = useState(true)
  const [includeAudio, setIncludeAudio] = useState(true)
  const [includeAnnotations, setIncludeAnnotations] = useState(true)

  const doExport = async () => {
    try {
      setExporting(true)
      const res = await api.post(`/training/courses/${courseId}/export`, {
        languages: langs,
        include_quiz: includeQuiz,
        include_audio: includeAudio,
        include_annotations: includeAnnotations
      }, { timeout: 120000 })

      if (res.data.download_url) {
        const a = document.createElement('a')
        a.href = res.data.download_url
        a.download = res.data.filename || 'course.html'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setOpen(false)
      }
    } catch (e: any) {
      alert(e.response?.data?.error || t('training.exportFailed'))
    } finally { setExporting(false) }
  }

  const toggleLang = (l: string) => {
    setLangs(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition hover:opacity-80"
        style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
        <Download size={13} /> {t('training.export')}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border shadow-lg z-50 p-3 space-y-3"
          style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border)' }}>
          <div className="text-xs font-semibold" style={{ color: 'var(--t-text)' }}>{t('training.exportTitle')}</div>
          <p className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>
            {t('training.exportDesc')}
          </p>

          {/* Language selection */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium" style={{ color: 'var(--t-text-muted)' }}>{t('training.includeLangs')}</div>
            {[
              { code: 'zh-TW', label: t('training.zhTW'), flag: '🇹🇼' },
              { code: 'en', label: 'English', flag: '🇺🇸' },
              { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
            ].map(l => (
              <label key={l.code} className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--t-text-secondary)' }}>
                <input type="checkbox" checked={langs.includes(l.code)} onChange={() => toggleLang(l.code)}
                  disabled={l.code === 'zh-TW'} className="rounded" />
                <span>{l.flag} {l.label}</span>
              </label>
            ))}
          </div>

          {/* Options */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium" style={{ color: 'var(--t-text-muted)' }}>{t('training.exportOptions')}</div>
            <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--t-text-secondary)' }}>
              <input type="checkbox" checked={includeQuiz} onChange={() => setIncludeQuiz(!includeQuiz)} className="rounded" />
              {t('training.includeQuiz')}
            </label>
            <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--t-text-secondary)' }}>
              <input type="checkbox" checked={includeAudio} onChange={() => setIncludeAudio(!includeAudio)} className="rounded" />
              {t('training.includeAudio')}
            </label>
            <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--t-text-secondary)' }}>
              <input type="checkbox" checked={includeAnnotations} onChange={() => setIncludeAnnotations(!includeAnnotations)} className="rounded" />
              {t('training.includeAnnotations')}
            </label>
          </div>

          <button onClick={doExport} disabled={exporting || langs.length === 0}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-white py-2 rounded-lg transition disabled:opacity-50"
            style={{ backgroundColor: 'var(--t-accent-bg)' }}>
            {exporting ? <><Loader2 size={12} className="animate-spin" /> {t('training.exporting')}</> : <><Download size={12} /> {t('training.exportHtml5')}</>}
          </button>

          <button onClick={() => setOpen(false)} className="w-full text-[10px] py-1" style={{ color: 'var(--t-text-dim)' }}>
            {t('training.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ExamTopicsManager
// ═══════════════════════════════════════════════════════════════════════════════

function ExamTopicsManager({ courseId, lessons, examDefaults, passScore }: {
  courseId: number
  lessons: { id: number; title: string }[]
  examDefaults?: any
  passScore?: number
}) {
  const { t } = useTranslation()
  const [topics, setTopics] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null) // null=closed, {}=new, {id:...}=edit
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadTopics() }, [courseId])

  const loadTopics = async () => {
    try {
      setLoading(true)
      const res = await api.get(`/training/courses/${courseId}/exam-topics`)
      setTopics(res.data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const openNew = () => {
    const defaults = examDefaults || {}
    setEditing({
      title: '', description: '',
      lesson_ids: lessons.map(l => l.id),
      total_score: defaults.total_score || 100,
      pass_score: passScore || 60,
      time_limit_minutes: defaults.time_limit_minutes || 10,
      time_limit_enabled: defaults.time_limit_enabled !== false,
      overtime_action: defaults.overtime_action || 'auto_submit',
      scoring_mode: 'even',
    })
  }

  const openEdit = (topic: any) => {
    setEditing({
      ...topic,
      lesson_ids: (topic.lessons || []).map((l: any) => l.lesson_id),
      time_limit_enabled: topic.time_limit_enabled !== 0,
    })
  }

  const saveTopic = async () => {
    if (!editing?.title?.trim()) return
    setSaving(true)
    try {
      if (editing.id) {
        await api.put(`/training/exam-topics/${editing.id}`, editing)
      } else {
        await api.post(`/training/courses/${courseId}/exam-topics`, editing)
      }
      setEditing(null)
      loadTopics()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    } finally { setSaving(false) }
  }

  const deleteTopic = async (id: number) => {
    if (!confirm(t('training.confirmDeleteExamTopic'))) return
    try {
      await api.delete(`/training/exam-topics/${id}`)
      loadTopics()
    } catch (e) { console.error(e) }
  }

  if (loading) return <div className="text-center py-8" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--t-text)' }}>{t('training.examTopicManagement')}</h3>
          <p className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>{t('training.examTopicDesc')}</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1 text-xs font-medium text-white px-3 py-1.5 rounded-lg transition"
          style={{ backgroundColor: 'var(--t-accent-bg)' }}>
          + {t('training.addExamTopic')}
        </button>
      </div>

      {topics.length === 0 && !editing && (
        <div className="text-center py-12" style={{ color: 'var(--t-text-dim)' }}>
          <p className="text-sm">{t('training.noExamTopics')}</p>
        </div>
      )}

      <div className="space-y-3">
        {topics.map(topic => (
          <div key={topic.id} className="rounded-xl p-4" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium" style={{ color: 'var(--t-text)' }}>{topic.title}</div>
                <div className="text-[10px] mt-0.5 flex gap-3" style={{ color: 'var(--t-text-dim)' }}>
                  <span>{t('training.examTotalScore')}: {topic.total_score}</span>
                  <span>{t('training.passScore')}: {topic.pass_score}</span>
                  <span>⏱ {topic.time_limit_enabled ? `${topic.time_limit_minutes} min` : t('training.noTimeLimit')}</span>
                  <span>{(topic.lessons || []).length} {t('training.chaptersIncluded')}</span>
                </div>
                {topic.lessons?.length > 0 && (
                  <div className="text-[9px] mt-1 flex flex-wrap gap-1">
                    {topic.lessons.map((l: any) => (
                      <span key={l.lesson_id} className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
                        {l.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => openEdit(topic)} className="text-xs px-2 py-1 rounded transition hover:opacity-80"
                style={{ color: 'var(--t-accent)', border: '1px solid var(--t-border)' }}>
                {t('training.edit')}
              </button>
              <button onClick={() => deleteTopic(topic.id)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1">
                {t('training.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit/Create Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setEditing(null)}>
          <div className="rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[80vh] overflow-y-auto"
            style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--t-text)' }}>
              {editing.id ? t('training.editExamTopic') : t('training.addExamTopic')}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>{t('training.examTopicTitle')}</label>
                <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-xs"
                  style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
              </div>

              <div>
                <label className="text-[10px] block mb-1" style={{ color: 'var(--t-text-dim)' }}>{t('training.includedChapters')}</label>
                <div className="space-y-1">
                  {lessons.map(l => (
                    <label key={l.id} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--t-text)' }}>
                      <input type="checkbox"
                        checked={(editing.lesson_ids || []).includes(l.id)}
                        onChange={e => {
                          const ids = [...(editing.lesson_ids || [])]
                          if (e.target.checked) ids.push(l.id)
                          else ids.splice(ids.indexOf(l.id), 1)
                          setEditing({ ...editing, lesson_ids: ids })
                        }}
                        className="rounded" />
                      {l.title}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>{t('training.totalScore')}</label>
                  <input type="number" min={10} max={1000} value={editing.total_score || 100}
                    onChange={e => setEditing({ ...editing, total_score: Number(e.target.value) })}
                    className="w-full border rounded px-2 py-1.5 text-xs"
                    style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
                </div>
                <div>
                  <label className="text-[10px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>{t('training.passScore')}</label>
                  <input type="number" min={0} max={1000} value={editing.pass_score || 60}
                    onChange={e => setEditing({ ...editing, pass_score: Number(e.target.value) })}
                    className="w-full border rounded px-2 py-1.5 text-xs"
                    style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
                </div>
                <div>
                  <label className="text-[10px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>{t('training.timeLimitMin')}</label>
                  <input type="number" min={1} max={180} value={editing.time_limit_minutes || 10}
                    onChange={e => setEditing({ ...editing, time_limit_minutes: Number(e.target.value) })}
                    className="w-full border rounded px-2 py-1.5 text-xs"
                    style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--t-text)' }}>
                  <input type="checkbox" checked={editing.time_limit_enabled !== false}
                    onChange={e => setEditing({ ...editing, time_limit_enabled: e.target.checked })}
                    className="rounded" />
                  {t('training.enableTimeLimit')}
                </label>
                <div className="flex gap-1">
                  {[{ v: 'auto_submit', l: t('training.autoSubmit') }, { v: 'warn_continue', l: t('training.warnContinue') }].map(opt => (
                    <button key={opt.v}
                      onClick={() => setEditing({ ...editing, overtime_action: opt.v })}
                      className="text-[10px] px-2 py-1 rounded transition"
                      style={{
                        backgroundColor: (editing.overtime_action || 'auto_submit') === opt.v ? 'var(--t-accent-subtle)' : 'transparent',
                        color: (editing.overtime_action || 'auto_submit') === opt.v ? 'var(--t-accent)' : 'var(--t-text-dim)',
                        border: `1px solid ${(editing.overtime_action || 'auto_submit') === opt.v ? 'var(--t-accent)' : 'var(--t-border)'}`
                      }}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-xs rounded-lg"
                style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
                {t('training.cancel')}
              </button>
              <button onClick={saveTopic} disabled={saving || !editing.title?.trim()}
                className="px-4 py-2 text-xs font-medium text-white rounded-lg transition disabled:opacity-40"
                style={{ backgroundColor: 'var(--t-accent-bg)' }}>
                {saving ? '...' : t('training.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
