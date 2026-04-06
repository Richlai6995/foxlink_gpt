import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import api from '../../lib/api'
import { Plus, Search, Calendar, Users, BookOpen, Play, Pause, RotateCcw, Trash2, ChevronRight, ClipboardList } from 'lucide-react'

interface Program {
  id: number
  title: string
  description: string | null
  purpose: string | null
  status: string
  start_date: string
  end_date: string
  created_by: number
  creator_name: string
  course_count: number
  target_user_count: number
  remind_before_days: number
  email_enabled: number
  created_at: string
  updated_at: string
}

type StatusFilter = '' | 'draft' | 'active' | 'paused' | 'completed' | 'archived'

export default function ProgramList() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const navigate = useNavigate()

  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [search, setSearch] = useState('')

  useEffect(() => { loadPrograms() }, [])

  const loadPrograms = async () => {
    try {
      setLoading(true)
      const res = await api.get('/training/programs')
      setPrograms(res.data)
    } catch (e) {
      console.error('Load programs:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (id: number, action: string, body?: any) => {
    try {
      if (action === 'delete') {
        if (!confirm(t('training.program.confirmDelete'))) return
        await api.delete(`/training/programs/${id}`)
      } else {
        await api.put(`/training/programs/${id}/${action}`, body)
      }
      loadPrograms()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const filtered = programs.filter(p => {
    if (statusFilter) { if (p.status !== statusFilter) return false }
    else { if (p.status === 'archived') return false } // default: hide archived
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    draft:     { label: t('training.program.statusDraft'),     color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' },
    active:    { label: t('training.program.statusActive'),    color: 'text-green-600',  bg: 'bg-green-50 border-green-200' },
    paused:    { label: t('training.program.statusPaused'),    color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
    completed: { label: t('training.program.statusCompleted'), color: 'text-slate-500',  bg: 'bg-slate-50 border-slate-200' },
    archived:  { label: t('training.program.statusArchived'),  color: 'text-slate-400',  bg: 'bg-slate-50 border-slate-300' },
  }

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString() : '—'

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList size={20} className="text-blue-600" />
        <h2 className="text-lg font-semibold text-slate-800">{t('training.program.title')}</h2>
        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('training.program.search')}
            className="border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
        >
          <option value="">{t('training.allStatus')}</option>
          <option value="draft">{t('training.program.statusDraft')}</option>
          <option value="active">{t('training.program.statusActive')}</option>
          <option value="paused">{t('training.program.statusPaused')}</option>
          <option value="completed">{t('training.program.statusCompleted')}</option>
          <option value="archived">{t('training.program.statusArchived')}</option>
        </select>

        {/* New program */}
        <button
          onClick={() => navigate('/training/dev/programs/new')}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
        >
          <Plus size={14} /> {t('training.program.create')}
        </button>
      </div>

      {/* Program List */}
      {loading ? (
        <div className="text-center text-slate-400 py-20">{t('training.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-400 py-20">
          <ClipboardList size={48} className="mx-auto mb-4 text-slate-300" />
          <p className="text-sm">{t('training.program.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(prog => {
            const sc = statusConfig[prog.status] || statusConfig.draft
            return (
              <div key={prog.id}
                className={`border rounded-xl p-4 hover:shadow-md transition cursor-pointer ${sc.bg}`}
                onClick={() => navigate(`/training/dev/programs/${prog.id}`)}
              >
                <div className="flex items-start gap-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-slate-800 truncate">{prog.title}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${sc.color} bg-white/80`}>
                        {sc.label}
                      </span>
                    </div>
                    {prog.purpose && (
                      <p className="text-xs text-slate-500 line-clamp-1 mb-2">{prog.purpose}</p>
                    )}
                    <div className="flex items-center gap-4 text-[11px] text-slate-500">
                      <span>{prog.creator_name}</span>
                      <span>{formatDate(prog.created_at)}</span>
                      <span className="flex items-center gap-1">
                        <Calendar size={11} /> {formatDate(prog.start_date)} ~ {formatDate(prog.end_date)}
                      </span>
                      <span className="flex items-center gap-1">
                        <BookOpen size={11} /> {prog.course_count} {t('training.program.courses')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users size={11} /> {prog.target_user_count} {t('training.program.users')}
                      </span>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {prog.status === 'draft' && (
                      <button onClick={() => handleAction(prog.id, 'activate')}
                        className="text-green-600 hover:bg-green-100 p-1.5 rounded-lg transition" title={t('training.program.activate')}>
                        <Play size={14} />
                      </button>
                    )}
                    {prog.status === 'active' && (
                      <button onClick={() => handleAction(prog.id, 'pause')}
                        className="text-orange-600 hover:bg-orange-100 p-1.5 rounded-lg transition" title={t('training.program.pause')}>
                        <Pause size={14} />
                      </button>
                    )}
                    {prog.status === 'paused' && (
                      <button onClick={() => handleAction(prog.id, 'resume')}
                        className="text-green-600 hover:bg-green-100 p-1.5 rounded-lg transition" title={t('training.program.resume')}>
                        <Play size={14} />
                      </button>
                    )}
                    {prog.status === 'completed' && (
                      <button onClick={() => {
                        const sd = prompt(t('training.program.newStartDate'), new Date().toISOString().slice(0,10))
                        const ed = prompt(t('training.program.newEndDate'))
                        if (sd && ed) handleAction(prog.id, 'reactivate', { start_date: sd, end_date: ed })
                      }}
                        className="text-blue-600 hover:bg-blue-100 p-1.5 rounded-lg transition" title={t('training.program.reactivate')}>
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {prog.status === 'archived' && (
                      <button onClick={() => handleAction(prog.id, 'unarchive')}
                        className="text-green-600 hover:bg-green-100 p-1.5 rounded-lg transition" title={t('training.unarchive')}>
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {prog.status !== 'archived' && (
                      <button onClick={async () => {
                        if (!confirm(t('training.confirmArchive'))) return
                        handleAction(prog.id, 'archive')
                      }}
                        className="text-slate-400 hover:bg-slate-100 p-1.5 rounded-lg transition" title={t('training.archive')}>
                        <Trash2 size={14} className="rotate-45" />
                      </button>
                    )}
                    {(prog.status === 'draft' || prog.status === 'completed' || prog.status === 'archived') && (
                      <button onClick={() => handleAction(prog.id, 'delete')}
                        className="text-red-400 hover:bg-red-100 p-1.5 rounded-lg transition" title={t('training.program.delete')}>
                        <Trash2 size={14} />
                      </button>
                    )}
                    <ChevronRight size={14} className="text-slate-400 ml-1" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
