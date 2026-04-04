import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { Plus, Search, ArrowLeft, FolderTree, BookOpen, Clock, CheckCircle2, ChevronRight, Filter, Settings, Trash2 } from 'lucide-react'
import CategoryManager from './CategoryManager'
import ThemePicker from './ThemePicker'

interface Course {
  id: number
  title: string
  description: string
  cover_image: string | null
  category_id: number | null
  category_name: string | null
  created_by: number
  creator_name: string
  status: string
  is_public: number
  pass_score: number
  created_at: string
  updated_at: string
  my_progress: { status: string; completed_at: string | null } | null
}

interface Category {
  id: number
  parent_id: number | null
  name: string
  sort_order: number
}

export default function CourseList({ editorMode = false }: { editorMode?: boolean }) {
  const { user, isAdmin, canEditTraining: canEdit } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [courses, setCourses] = useState<Course[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')

  const [showCategoryManager, setShowCategoryManager] = useState(false)

  useEffect(() => {
    loadData()
  }, [selectedCategory, statusFilter])

  const loadData = async () => {
    try {
      setLoading(true)
      const params: any = {}
      if (editorMode) params.my_only = '1'
      if (selectedCategory) params.category_id = selectedCategory
      if (statusFilter) params.status = statusFilter
      if (search) params.search = search

      const [coursesRes, catsRes] = await Promise.all([
        api.get('/training/courses', { params }),
        api.get('/training/categories')
      ])
      setCourses(coursesRes.data)
      setCategories(catsRes.data)
    } catch (e) {
      console.error('Load training data:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadData()
  }

  // Build category tree for sidebar
  const rootCategories = categories.filter(c => !c.parent_id)
  const getChildren = (parentId: number) => categories.filter(c => c.parent_id === parentId)

  const statusColors: Record<string, string> = {
    draft: 'bg-yellow-500/20 text-yellow-400',
    published: 'bg-green-500/20 text-green-400',
    archived: 'bg-slate-500/20 text-slate-400',
  }

  const progressIcon = (progress: Course['my_progress']) => {
    if (!progress) return <BookOpen size={14} className="text-slate-500" />
    if (progress.status === 'completed') return <CheckCircle2 size={14} className="text-green-400" />
    return <Clock size={14} className="text-blue-400" />
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur border-b" style={{ backgroundColor: 'color-mix(in srgb, var(--t-bg) 95%, transparent)', borderColor: 'var(--t-border-subtle)' }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/chat')} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-80 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen size={20} style={{ color: 'var(--t-accent)' }} />
            {editorMode ? t('training.myMaterials') : t('sidebar.training')}
          </h1>
          <div className="flex-1" />

          {/* Search */}
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--t-text-dim)' }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('training.searchCourses')}
                className="border rounded-lg pl-8 pr-3 py-1.5 text-xs w-48 focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
              />
            </div>
          </form>

          {/* Status filter */}
          {editorMode && (
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="border rounded-lg px-2 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
            >
              <option value="">{t('training.allStatus')}</option>
              <option value="draft">{t('training.draft')}</option>
              <option value="published">{t('training.published')}</option>
              <option value="archived">{t('training.archived')}</option>
            </select>
          )}

          {canEdit && (
            <button
              onClick={() => navigate('/training/editor/new')}
              className="flex items-center gap-1.5 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
              style={{ backgroundColor: 'var(--t-accent-bg)' }}
            >
              <Plus size={14} /> {t('training.addCourse')}
            </button>
          )}

          {!editorMode && canEdit && (
            <button
              onClick={() => navigate('/training/editor')}
              className="flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-xs font-medium transition hover:opacity-80"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-secondary)' }}
            >
              {t('training.myMaterials')}
            </button>
          )}
          {editorMode && (
            <button
              onClick={() => navigate('/training')}
              className="flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-xs font-medium transition hover:opacity-80"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-secondary)' }}
            >
              {t('training.courseList')}
            </button>
          )}

          <ThemePicker />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* Category Sidebar */}
        {(categories.length > 0 || canEdit) && (
          <div className="w-48 shrink-0">
            <div className="sticky top-16">
              <h3 className="text-xs font-semibold uppercase mb-2 flex items-center gap-1.5" style={{ color: 'var(--t-text-muted)' }}>
                <FolderTree size={12} /> {t('training.category')}
                {canEdit && (
                  <button onClick={() => setShowCategoryManager(true)}
                    className="ml-auto flex items-center gap-1 hover:opacity-80 transition" style={{ color: 'var(--t-text-dim)' }} title={t('training.categoryManage')}>
                    <Settings size={11} /> <span className="text-[9px]">{t('training.manage')}</span>
                  </button>
                )}
              </h3>
              <button
                onClick={() => setSelectedCategory(null)}
                className="w-full text-left text-xs px-2 py-1.5 rounded transition"
                style={{
                  backgroundColor: !selectedCategory ? 'var(--t-accent-subtle)' : 'transparent',
                  color: !selectedCategory ? 'var(--t-accent)' : 'var(--t-text-muted)'
                }}
              >
                {t('training.allCourses')}
              </button>
              {rootCategories.map(cat => (
                <div key={cat.id}>
                  <button
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`w-full text-left text-xs px-2 py-1.5 rounded transition ${
                      selectedCategory === cat.id ? 'bg-sky-600/20 text-sky-400' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {cat.name}
                  </button>
                  {getChildren(cat.id).map(child => (
                    <button
                      key={child.id}
                      onClick={() => setSelectedCategory(child.id)}
                      className={`w-full text-left text-xs px-2 py-1.5 pl-5 rounded transition ${
                        selectedCategory === child.id ? 'bg-sky-600/20 text-sky-400' : 'text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {child.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Course Grid */}
        <div className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-500 text-sm">{t('training.loading')}</div>
          ) : courses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <BookOpen size={48} className="mb-3 opacity-50" />
              <p className="text-sm">{editorMode ? t('training.noMaterials') : t('training.noCourses')}</p>
              {canEdit && editorMode && (
                <button
                  onClick={() => navigate('/training/editor/new')}
                  className="mt-4 flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm transition"
                >
                  <Plus size={16} /> {t('training.createFirst')}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {courses.map(course => (
                <div
                  key={course.id}
                  onClick={() => editorMode ? navigate(`/training/editor/${course.id}`) : navigate(`/training/course/${course.id}`)}
                  className="border rounded-xl overflow-hidden cursor-pointer transition group"
                  style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border-subtle)', boxShadow: 'var(--t-shadow)' }}
                >
                  {/* Cover */}
                  <div className="h-32 flex items-center justify-center relative" style={{ background: 'var(--t-gradient-cover)' }}>
                    {course.cover_image ? (
                      <img src={course.cover_image.startsWith('/') ? course.cover_image : '/' + course.cover_image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <BookOpen size={32} style={{ color: 'var(--t-accent)', opacity: 0.3 }} />
                    )}
                    {editorMode && (
                      <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{
                          backgroundColor: course.status === 'draft' ? 'var(--t-status-draft-bg)' : 'var(--t-status-published-bg)',
                          color: course.status === 'draft' ? 'var(--t-status-draft-text)' : 'var(--t-status-published-text)'
                        }}>
                        {course.status === 'draft' ? t('training.draft') : course.status === 'published' ? t('training.published') : t('training.archived')}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <h3 className="text-sm font-medium truncate transition" style={{ color: 'var(--t-text)' }}>
                      {course.title}
                    </h3>
                    {course.description && (
                      <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--t-text-muted)' }}>{course.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: 'var(--t-text-dim)' }}>
                      {course.category_name && (
                        <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--t-accent-subtle)' }}>{course.category_name}</span>
                      )}
                      <span>{course.creator_name}</span>
                      {!editorMode && (
                        <span className="ml-auto flex items-center gap-1">
                          {progressIcon(course.my_progress)}
                          {course.my_progress?.status === 'completed' ? t('training.completed') :
                           course.my_progress?.status === 'in_progress' ? t('training.inProgress') : t('training.notStarted')}
                        </span>
                      )}
                      {editorMode && (
                        <button
                          className="ml-auto text-red-400/60 hover:text-red-400 transition p-0.5"
                          title={t('training.deleteCourse')}
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (!confirm(t('training.confirmDelete', { title: course.title }))) return
                            try {
                              await api.delete(`/training/courses/${course.id}`)
                              loadData()
                            } catch (err: any) { alert(err.response?.data?.error || t('training.deleteFailed')) }
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCategoryManager && (
        <CategoryManager
          onClose={() => setShowCategoryManager(false)}
          onChanged={() => loadData()}
        />
      )}
    </div>
  )
}
