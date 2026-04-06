import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { ArrowLeft, BookOpen } from 'lucide-react'
import CourseList from '../components/training/CourseList'
import ProgramList from '../components/training/ProgramList'

type Tab = 'courses' | 'programs'

export default function TrainingDevArea() {
  const { t } = useTranslation()
  const { canEditTraining } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  // Derive active tab from URL
  const activeTab: Tab = location.pathname.includes('/programs') ? 'programs' : 'courses'

  const setTab = (tab: Tab) => {
    navigate(`/training/dev/${tab}`, { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header + Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-3 pt-3 pb-0">
          <button onClick={() => navigate('/chat')} className="text-slate-400 hover:text-slate-600 transition">
            <ArrowLeft size={20} />
          </button>
          <BookOpen size={20} className="text-blue-600" />
          <h1 className="text-lg font-bold text-slate-800">{t('sidebar.trainingDev')}</h1>
        </div>
        <div className="max-w-7xl mx-auto flex gap-1 mt-2">
          <button
            onClick={() => setTab('courses')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'courses'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {t('training.dev.coursesTab')}
          </button>
          <button
            onClick={() => setTab('programs')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === 'programs'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {t('training.dev.programsTab')}
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto">
        {activeTab === 'courses' ? (
          <CourseList editorMode />
        ) : (
          <ProgramList />
        )}
      </div>
    </div>
  )
}
