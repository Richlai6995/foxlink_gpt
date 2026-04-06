import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import UserPicker from '../common/UserPicker'
import ProgramReport from './ProgramReport'
import {
  ArrowLeft, Save, Play, BookOpen, Users, Plus, X, Trash2,
  GripVertical, Calendar, Mail, Bell, ChevronUp, ChevronDown, BarChart3
} from 'lucide-react'

type GranteeType = 'public' | 'user' | 'role' | 'department' | 'cost_center' | 'division' | 'org_group'

interface ProgramCourse {
  id?: number
  course_id: number
  course_title: string
  sort_order: number
  is_required: number
  lesson_ids: number[] | null
  lessons?: { id: number; title: string }[]
  exam_config?: {
    total_score?: number
    pass_score?: number
    time_limit_minutes?: number
    time_limit_enabled?: boolean
    overtime_action?: string
    max_attempts?: number
    lesson_weights?: Record<string, number>
  }
}

interface ProgramTarget {
  id?: number
  target_type: string
  target_id: string
  target_label?: string // display name
}

interface Program {
  id?: number
  title: string
  description: string
  purpose: string
  start_date: string
  program_pass_score: number
  sequential_lessons: number
  end_date: string
  remind_before_days: number
  email_enabled: number
  notify_overdue: number
  status?: string
}

interface AvailableCourse {
  id: number
  title: string
  status: string
}

const GRANTEE_KEYS: GranteeType[] = ['public', 'user', 'role', 'department', 'cost_center', 'division', 'org_group']

export default function ProgramEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()

  const granteeLabel = (type: string) => t(`training.grantee.${type}`) || type

  const [program, setProgram] = useState<Program>({
    title: '', description: '', purpose: '',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '',
    program_pass_score: 60, sequential_lessons: 0,
    remind_before_days: 3, email_enabled: 1, notify_overdue: 1,
  })
  const [courses, setCourses] = useState<ProgramCourse[]>([])
  const [targets, setTargets] = useState<ProgramTarget[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [sendNotification, setSendNotification] = useState(true)
  const [editorTab, setEditorTab] = useState<'settings' | 'report'>('settings')

  // Course picker
  const [showCoursePicker, setShowCoursePicker] = useState(false)
  const [availableCourses, setAvailableCourses] = useState<AvailableCourse[]>([])
  const [courseSearch, setCourseSearch] = useState('')

  // Target picker
  const [targetType, setTargetType] = useState<GranteeType>('user')
  const [targetSearch, setTargetSearch] = useState('')
  const [showTargetDropdown, setShowTargetDropdown] = useState(false)
  const [targetOptions, setTargetOptions] = useState<{ id: string; name: string; sub?: string }[]>([])
  const [selectedTarget, setSelectedTarget] = useState<{ id: string; name: string } | null>(null)
  const [userPickerDisplay, setUserPickerDisplay] = useState('')
  const [orgs, setOrgs] = useState<any>(null)
  const targetDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isNew) loadProgram()
    api.get('/dashboard/orgs').then(r => setOrgs(r.data)).catch(() => {})
  }, [])

  const loadProgram = async () => {
    try {
      setLoading(true)
      const res = await api.get(`/training/programs/${id}`)
      const p = res.data
      setProgram({
        id: p.id, title: p.title, description: p.description || '',
        purpose: p.purpose || '',
        start_date: p.start_date ? new Date(p.start_date).toISOString().slice(0, 10) : '',
        end_date: p.end_date ? new Date(p.end_date).toISOString().slice(0, 10) : '',
        program_pass_score: p.program_pass_score ?? 60,
        sequential_lessons: p.sequential_lessons ?? 0,
        remind_before_days: p.remind_before_days ?? 3,
        email_enabled: p.email_enabled ?? 1,
        notify_overdue: p.notify_overdue ?? 1,
        status: p.status,
      })
      setCourses(p.courses || [])
      setTargets(p.targets || [])
    } catch (e) {
      console.error('Load program:', e)
    } finally {
      setLoading(false)
    }
  }

  // Load available courses for picker
  const loadAvailableCourses = async () => {
    try {
      const res = await api.get('/training/courses', {
        params: { my_only: '1', lang: i18n.language }
      })
      setAvailableCourses(res.data)
      setShowCoursePicker(true)
    } catch (e) { console.error(e) }
  }

  // Outside click to close target dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (targetDropdownRef.current && !targetDropdownRef.current.contains(e.target as Node)) {
        setShowTargetDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Build target options
  const buildTargetOptions = (searchVal: string) => {
    if (targetType === 'user' || targetType === 'public') return
    const s = searchVal.toLowerCase()
    if (targetType === 'role') {
      api.get('/roles').then(r => {
        const filtered = (r.data || []).filter((rl: any) =>
          !searchVal || rl.name.toLowerCase().includes(s))
        setTargetOptions(filtered.map((rl: any) => ({ id: String(rl.id), name: rl.name })))
      }).catch(() => {})
    } else if (targetType === 'department') {
      setTargetOptions((orgs?.depts || []).filter((d: any) =>
        !searchVal || d.code.toLowerCase().includes(s) || (d.name || '').toLowerCase().includes(s))
        .map((d: any) => ({ id: d.code, name: d.name || d.code, sub: d.code })))
    } else if (targetType === 'cost_center') {
      setTargetOptions((orgs?.profit_centers || []).filter((d: any) =>
        !searchVal || d.code.toLowerCase().includes(s) || (d.name || '').toLowerCase().includes(s))
        .map((d: any) => ({ id: d.code, name: d.name || d.code, sub: d.code })))
    } else if (targetType === 'division') {
      setTargetOptions((orgs?.org_sections || []).filter((d: any) =>
        !searchVal || d.code.toLowerCase().includes(s) || (d.name || '').toLowerCase().includes(s))
        .map((d: any) => ({ id: d.code, name: d.name || d.code, sub: d.code })))
    } else if (targetType === 'org_group') {
      setTargetOptions((orgs?.org_groups || []).filter((d: any) =>
        !searchVal || d.name.toLowerCase().includes(s))
        .map((d: any) => ({ id: d.name, name: d.name })))
    }
  }

  // Rebuild options when type changes
  useEffect(() => {
    if (targetType !== 'user' && targetType !== 'public') {
      buildTargetOptions('')
    }
  }, [targetType, orgs])

  const handleTargetSearchChange = (val: string) => {
    setTargetSearch(val)
    setSelectedTarget(null)
    setShowTargetDropdown(true)
    buildTargetOptions(val)
  }

  const handleTargetSelect = (opt: { id: string; name: string; sub?: string }) => {
    setSelectedTarget(opt)
    setTargetSearch(opt.sub ? `${opt.name} (${opt.sub})` : opt.name)
    setShowTargetDropdown(false)
  }

  // Save program
  const handleSave = async () => {
    if (!program.title.trim()) return alert(t('training.program.editor.titleRequired'))
    if (!program.start_date || !program.end_date) return alert(t('training.program.editor.dateRequired'))
    try {
      setSaving(true)
      let progId = id ? Number(id) : 0
      if (isNew) {
        const res = await api.post('/training/programs', program)
        progId = res.data.id
        // Save courses & targets
        for (const c of courses) {
          const res2 = await api.post(`/training/programs/${progId}/courses`, {
            course_id: c.course_id, is_required: c.is_required, lesson_ids: c.lesson_ids
          })
          // Save exam_config if set
          if (c.exam_config && Object.keys(c.exam_config).length > 0) {
            await api.put(`/training/programs/${progId}/courses/${res2.data.id}/lessons`, {
              lesson_ids: c.lesson_ids, exam_config: c.exam_config
            })
          }
        }
        for (const t of targets) {
          await api.post(`/training/programs/${progId}/targets`, {
            target_type: t.target_type, target_id: t.target_id
          })
        }
        navigate(`/training/dev/programs/${progId}`, { replace: true })
      } else {
        await api.put(`/training/programs/${progId}`, program)
      }
      alert(t('training.program.editor.saved'))
      loadProgram()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    } finally {
      setSaving(false)
    }
  }

  // Activate
  const handleActivate = async () => {
    if (courses.length === 0) return alert(t('training.program.editor.noCourses'))
    if (targets.length === 0) return alert(t('training.program.editor.noTargets'))
    if (!confirm(t('training.program.editor.confirmActivate'))) return
    try {
      // Save first
      if (!isNew) await api.put(`/training/programs/${id}`, program)
      const res = await api.post(`/training/programs/${id}/activate`, {
        send_notification: sendNotification
      })
      alert(`${t('training.program.editor.activated')}\n${t('training.program.users')}: ${res.data.users}, ${t('training.program.courses')}: ${res.data.courses}`)
      loadProgram()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  // Add course to program (server-side if editing, local if new)
  const addCourse = async (course: AvailableCourse) => {
    if (courses.some(c => c.course_id === course.id)) return
    const newCourse: ProgramCourse = {
      course_id: course.id, course_title: course.title,
      sort_order: courses.length + 1, is_required: 1,
    }
    if (!isNew && id) {
      try {
        const res = await api.post(`/training/programs/${id}/courses`, {
          course_id: course.id, is_required: 1
        })
        newCourse.id = res.data.id
      } catch (e: any) { alert(e.response?.data?.error || 'Error'); return }
    }
    setCourses([...courses, newCourse])
  }

  const removeCourse = async (idx: number) => {
    const c = courses[idx]
    if (!isNew && c.id) {
      try { await api.delete(`/training/programs/${id}/courses/${c.id}`) } catch (e) { return }
    }
    setCourses(courses.filter((_, i) => i !== idx))
  }

  // Add target
  const addTarget = async () => {
    if (targetType === 'public') {
      if (targets.some(t => t.target_type === 'public')) return
      const newTarget: ProgramTarget = { target_type: 'public', target_id: 'all', target_label: t('training.grantee.public') }
      if (!isNew && id) {
        try {
          const res = await api.post(`/training/programs/${id}/targets`, { target_type: 'public', target_id: 'all' })
          newTarget.id = res.data.id
        } catch (e) { return }
      }
      setTargets([...targets, newTarget])
      return
    }
    if (!selectedTarget) return
    if (targets.some(t => t.target_type === targetType && t.target_id === selectedTarget.id)) return

    const label = selectedTarget.name + (selectedTarget.id !== selectedTarget.name ? ` (${selectedTarget.id})` : '')
    const newTarget: ProgramTarget = {
      target_type: targetType, target_id: selectedTarget.id,
      target_label: label,
    }
    if (!isNew && id) {
      try {
        const res = await api.post(`/training/programs/${id}/targets`, {
          target_type: targetType, target_id: selectedTarget.id
        })
        newTarget.id = res.data.id
      } catch (e) { return }
    }
    setTargets([...targets, newTarget])
    setSelectedTarget(null)
    setTargetSearch('')
    setShowTargetDropdown(false)
    setUserPickerDisplay('')
  }

  const removeTarget = async (idx: number) => {
    const t = targets[idx]
    if (!isNew && t.id) {
      try { await api.delete(`/training/programs/${id}/targets/${t.id}`) } catch (e) { return }
    }
    setTargets(targets.filter((_, i) => i !== idx))
  }

  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400">{t('training.loading')}</div>

  const isDraft = !program.status || program.status === 'draft'
  const isActive = program.status === 'active' || program.status === 'paused'
  const isEditable = true // 所有狀態都可以編輯（下架後改 draft 再修改）

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/training/dev/programs')} className="text-slate-400 hover:text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-semibold text-slate-800">
            {isNew ? t('training.program.editor.createTitle') : program.title}
          </h1>
          {program.status && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              program.status === 'active' ? 'bg-green-100 text-green-700' :
              program.status === 'paused' ? 'bg-orange-100 text-orange-700' :
              program.status === 'completed' ? 'bg-slate-100 text-slate-500' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {t(`training.program.status${program.status.charAt(0).toUpperCase() + program.status.slice(1)}`)}
            </span>
          )}
          <div className="flex-1" />
          {isEditable && (
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50">
              <Save size={14} /> {saving ? '...' : t('training.program.editor.save')}
            </button>
          )}
          {isDraft && !isNew && (
            <button onClick={handleActivate}
              className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
              <Play size={14} /> {t('training.program.activate')}
            </button>
          )}
          {isActive && !isNew && (
            <button onClick={async () => {
              if (!confirm(t('training.program.editor.confirmDeactivate'))) return
              try {
                await api.put(`/training/programs/${id}/deactivate`)
                alert(t('training.program.editor.deactivated'))
                loadProgram()
              } catch (e: any) { alert(e.response?.data?.error || 'Error') }
            }}
              className="flex items-center gap-1.5 bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
              {t('training.program.editor.deactivate')}
            </button>
          )}
        </div>
      </div>

      {/* Tab bar (settings / report) */}
      {!isNew && (
        <div className="bg-white border-b border-slate-200 px-6">
          <div className="max-w-4xl mx-auto flex gap-1">
            <button onClick={() => setEditorTab('settings')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${editorTab === 'settings' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t('training.program.editor.settingsTab')}
            </button>
            <button onClick={() => setEditorTab('report')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition flex items-center gap-1 ${editorTab === 'report' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <BarChart3 size={12} /> {t('training.report.title')}
            </button>
          </div>
        </div>
      )}

      {/* Report tab */}
      {editorTab === 'report' && !isNew && id && (
        <div className="max-w-6xl mx-auto p-6">
          <ProgramReport programId={Number(id)} />
        </div>
      )}

      {/* Settings tab */}
      {(editorTab === 'settings' || isNew) && (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Basic Info */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">{t('training.program.editor.basicInfo')}</h2>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('training.program.editor.titleLabel')}</label>
            <input value={program.title} onChange={e => setProgram({ ...program, title: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              disabled={!isEditable} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('training.program.editor.purpose')}</label>
            <textarea value={program.purpose} onChange={e => setProgram({ ...program, purpose: e.target.value })}
              rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              disabled={!isEditable} />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-slate-500 mb-1 block">{t('training.program.editor.startDate')}</label>
              <input type="date" value={program.start_date}
                onChange={e => setProgram({ ...program, start_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" disabled={!isEditable} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-500 mb-1 block">{t('training.program.editor.endDate')}</label>
              <input type="date" value={program.end_date}
                onChange={e => setProgram({ ...program, end_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" disabled={!isEditable} />
            </div>
          </div>
        </section>

        {/* Courses */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={16} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-700">{t('training.program.editor.coursesSection')}</h2>
            <div className="flex-1" />
            {isEditable && (
              <button onClick={loadAvailableCourses}
                className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition">
                <Plus size={13} /> {t('training.program.editor.addCourse')}
              </button>
            )}
          </div>
          {courses.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">{t('training.program.editor.noCourseYet')}</p>
          ) : (
            <div className="space-y-2">
              {courses.map((c, idx) => (
                <ProgramCourseCard key={c.course_id} course={c} idx={idx}
                  isEditable={isEditable} isNew={isNew} programId={id}
                  onUpdate={(updated) => { const arr = [...courses]; arr[idx] = updated; setCourses(arr) }}
                  onRemove={() => removeCourse(idx)}
                  t={t} />
              ))}
            </div>
          )}
        </section>

        {/* Targets */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-green-600" />
            <h2 className="text-sm font-semibold text-slate-700">{t('training.program.editor.targetsSection')}</h2>
          </div>
          {isEditable && (
            <div className="flex gap-2 mb-3">
              <select value={targetType}
                onChange={e => { setTargetType(e.target.value as GranteeType); setTargetSearch(''); setSelectedTarget(null); setUserPickerDisplay(''); setShowTargetDropdown(false) }}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
                {GRANTEE_KEYS.map(k => (
                  <option key={k} value={k}>{granteeLabel(k)}</option>
                ))}
              </select>

              {targetType === 'public' ? (
                <button onClick={addTarget}
                  className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-500 transition">
                  <Plus size={13} /> {t('training.program.editor.addTarget')}
                </button>
              ) : targetType === 'user' ? (
                <div className="flex-1 flex gap-2">
                  <div className="flex-1">
                    <UserPicker
                      value={selectedTarget?.id || ''}
                      display={userPickerDisplay}
                      onChange={(id: string, disp: string) => {
                        setSelectedTarget(id ? { id, name: disp } : null)
                        setUserPickerDisplay(disp)
                      }}
                      placeholder={t('training.program.editor.searchUser')}
                      apiUrl="/training/users-list"
                    />
                  </div>
                  <button onClick={addTarget} disabled={!selectedTarget}
                    className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-500 transition disabled:opacity-50">
                    <Plus size={13} />
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex gap-2 relative" ref={targetDropdownRef}>
                  <input value={targetSearch}
                    onChange={e => handleTargetSearchChange(e.target.value)}
                    onFocus={() => { if (!selectedTarget) setShowTargetDropdown(true) }}
                    placeholder={t('training.program.editor.searchTarget')}
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  {showTargetDropdown && !selectedTarget && targetOptions.length > 0 && (
                    <div className="absolute top-full left-0 right-12 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                      {targetOptions.map(opt => (
                        <button key={opt.id} onClick={() => handleTargetSelect(opt)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2">
                          <span className="font-medium">{opt.name}</span>
                          {opt.sub && <span className="text-slate-400">{opt.sub}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={addTarget} disabled={!selectedTarget}
                    className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-500 transition disabled:opacity-50">
                    <Plus size={13} />
                  </button>
                </div>
              )}
            </div>
          )}
          {targets.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">{t('training.program.editor.noTargetYet')}</p>
          ) : (
            <div className="space-y-1">
              {targets.map((tgt, idx) => (
                <div key={`${tgt.target_type}-${tgt.target_id}`}
                  className="flex items-center gap-2 border border-slate-100 rounded-lg px-3 py-2 bg-slate-50">
                  <Users size={14} className="text-green-500" />
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">
                    {granteeLabel(tgt.target_type)}
                  </span>
                  <span className="text-sm flex-1">{tgt.target_label || tgt.target_id}</span>
                  {isEditable && (
                    <button onClick={() => removeTarget(idx)} className="text-red-400 hover:text-red-600 p-1">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Exam Settings */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-purple-600" />
            <h2 className="text-sm font-semibold text-slate-700">{t('training.program.editor.examSection')}</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>{t('training.program.editor.programPassScore')}</span>
              <input type="number" min={0} max={100} value={program.program_pass_score}
                onChange={e => setProgram({ ...program, program_pass_score: Number(e.target.value) })}
                className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-center" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={program.sequential_lessons === 1}
              onChange={e => setProgram({ ...program, sequential_lessons: e.target.checked ? 1 : 0 })}
              className="w-4 h-4 rounded" />
            {t('training.program.editor.sequentialLessons')}
          </label>
        </section>

        {/* Notification Settings */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-amber-600" />
            <h2 className="text-sm font-semibold text-slate-700">{t('training.program.editor.notificationSection')}</h2>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={sendNotification} onChange={e => setSendNotification(e.target.checked)}
              className="w-4 h-4 rounded" />
            {t('training.program.editor.sendNotificationOnActivate')}
          </label>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>{t('training.program.editor.remindBefore')}</span>
            <input type="number" min={0} value={program.remind_before_days}
              onChange={e => setProgram({ ...program, remind_before_days: Number(e.target.value) })}
              className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-center" />
            <span>{t('training.program.editor.remindDays')}</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={program.notify_overdue === 1}
              onChange={e => setProgram({ ...program, notify_overdue: e.target.checked ? 1 : 0 })}
              className="w-4 h-4 rounded" />
            {t('training.program.editor.notifyOverdue')}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={program.email_enabled === 1}
              onChange={e => setProgram({ ...program, email_enabled: e.target.checked ? 1 : 0 })}
              className="w-4 h-4 rounded" />
            {t('training.program.editor.emailEnabled')}
          </label>
        </section>
      </div>
      )}

      {/* Course Picker Modal */}
      {showCoursePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-slate-800">{t('training.program.editor.selectCourse')}</h3>
              <button onClick={() => setShowCoursePicker(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="px-5 py-3 border-b">
              <input value={courseSearch} onChange={e => setCourseSearch(e.target.value)}
                placeholder={t('training.searchCourses')}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {availableCourses
                .filter(c => !courseSearch || c.title.toLowerCase().includes(courseSearch.toLowerCase()))
                .map(c => {
                  const added = courses.some(pc => pc.course_id === c.id)
                  return (
                    <button key={c.id} onClick={() => { if (!added) addCourse(c) }}
                      disabled={added}
                      className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2 transition ${
                        added ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-50'
                      }`}>
                      <BookOpen size={14} className="text-blue-500" />
                      <span className="text-sm flex-1">{c.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        c.status === 'published' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'
                      }`}>{c.status}</span>
                      {added && <span className="text-[10px] text-slate-400">{t('training.program.editor.alreadyAdded')}</span>}
                    </button>
                  )
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Course card with expandable lesson checkboxes ────────────────────────────
function ProgramCourseCard({ course, idx, isEditable, isNew, programId, onUpdate, onRemove, t }: {
  course: ProgramCourse; idx: number; isEditable: boolean; isNew: boolean; programId?: string
  onUpdate: (c: ProgramCourse) => void; onRemove: () => void; t: (k: string) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const [lessons, setLessons] = useState<{ id: number; title: string }[]>(course.lessons || [])
  const [loadingLessons, setLoadingLessons] = useState(false)
  const ec = course.exam_config || {}

  const updateExamConfig = (patch: Record<string, any>) => {
    const updated = { ...ec, ...patch }
    onUpdate({ ...course, exam_config: updated })
    if (!isNew && course.id && programId) {
      api.put(`/training/programs/${programId}/courses/${course.id}/lessons`, {
        lesson_ids: course.lesson_ids,
        exam_config: updated
      }).catch(console.error)
    }
  }

  const loadLessons = async () => {
    if (lessons.length > 0) { setExpanded(true); return }
    setLoadingLessons(true)
    try {
      const res = await api.get(`/training/courses/${course.course_id}`)
      const ls = (res.data.lessons || []).map((l: any) => ({ id: l.id, title: l.title }))
      setLessons(ls)
      onUpdate({ ...course, lessons: ls })
    } catch (e) { console.error(e) }
    finally { setLoadingLessons(false); setExpanded(true) }
  }

  const selectedIds = course.lesson_ids || []
  const allSelected = selectedIds.length === 0 // null = all

  const toggleLesson = async (lessonId: number) => {
    let newIds: number[]
    if (allSelected) {
      // Currently "all" → switch to all-except-this-one
      newIds = lessons.filter(l => l.id !== lessonId).map(l => l.id)
    } else if (selectedIds.includes(lessonId)) {
      newIds = selectedIds.filter(id => id !== lessonId)
    } else {
      newIds = [...selectedIds, lessonId]
    }
    // If all are selected → set null (= all)
    const finalIds = newIds.length === lessons.length ? null : newIds
    onUpdate({ ...course, lesson_ids: finalIds })
    // Save to backend if editing existing program
    if (!isNew && course.id && programId) {
      try {
        await api.put(`/training/programs/${programId}/courses/${course.id}/lessons`, {
          lesson_ids: finalIds
        })
      } catch (e) { console.error(e) }
    }
  }

  const toggleAll = async () => {
    const finalIds = allSelected ? [] : null // toggle between all and none
    onUpdate({ ...course, lesson_ids: finalIds })
    if (!isNew && course.id && programId) {
      try {
        await api.put(`/training/programs/${programId}/courses/${course.id}/lessons`, {
          lesson_ids: finalIds
        })
      } catch (e) { console.error(e) }
    }
  }

  const isLessonSelected = (lessonId: number) => allSelected || selectedIds.includes(lessonId)
  const selectedCount = allSelected ? lessons.length : selectedIds.length

  return (
    <div className="border border-slate-100 rounded-lg bg-slate-50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <GripVertical size={14} className="text-slate-300" />
        <BookOpen size={14} className="text-blue-500" />
        <button onClick={() => expanded ? setExpanded(false) : loadLessons()}
          className="text-sm flex-1 text-left flex items-center gap-1 hover:text-blue-600 transition">
          {course.course_title}
          {lessons.length > 0 && (
            <span className="text-[10px] text-slate-400 ml-1">
              ({selectedCount}/{lessons.length} {t('training.program.editor.lessonsSelected')})
            </span>
          )}
          {loadingLessons ? <span className="text-[10px] text-slate-400">...</span>
            : expanded ? <ChevronUp size={12} className="text-slate-400" />
            : <ChevronDown size={12} className="text-slate-400" />}
        </button>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" checked={course.is_required === 1}
            onChange={e => onUpdate({ ...course, is_required: e.target.checked ? 1 : 0 })}
            disabled={!isEditable}
            className="w-3.5 h-3.5 rounded" />
          {t('training.program.editor.required')}
        </label>
        {isEditable && (
          <button onClick={onRemove} className="text-red-400 hover:text-red-600 p-1">
            <X size={14} />
          </button>
        )}
      </div>
      {expanded && lessons.length > 0 && (
        <div className="border-t border-slate-200 px-3 py-2 bg-white space-y-1">
          <label className="flex items-center gap-2 text-xs text-slate-600 pb-1 border-b border-slate-100 mb-1">
            <input type="checkbox" checked={allSelected} onChange={toggleAll}
              disabled={!isEditable} className="w-3.5 h-3.5 rounded" />
            <span className="font-medium">{t('training.program.editor.allLessons')}</span>
          </label>
          {lessons.map(l => {
            const lw = ec.lesson_weights?.[`lesson_${l.id}`]
            return (
              <div key={l.id} className="flex items-center gap-2 text-xs text-slate-600 pl-4">
                <input type="checkbox" checked={isLessonSelected(l.id)}
                  onChange={() => toggleLesson(l.id)}
                  disabled={!isEditable || allSelected}
                  className="w-3.5 h-3.5 rounded" />
                <span className="flex-1">{l.title}</span>
                {isLessonSelected(l.id) && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400">{t('training.program.editor.lessonScore')}</span>
                    <input type="number" min={0} value={lw ?? ''}
                      placeholder={String(Math.round((ec.total_score || 100) / selectedCount))}
                      onChange={e => {
                        const val = e.target.value ? Number(e.target.value) : undefined
                        const weights = { ...(ec.lesson_weights || {}) }
                        if (val !== undefined) weights[`lesson_${l.id}`] = val
                        else delete weights[`lesson_${l.id}`]
                        updateExamConfig({ lesson_weights: weights })
                      }}
                      disabled={!isEditable}
                      className="w-12 border border-slate-200 rounded px-1 py-0.5 text-[11px] text-center" />
                  </div>
                )}
              </div>
            )
          })}

          {/* Exam config row */}
          <div className="flex items-center gap-3 pt-2 mt-2 border-t border-slate-100 text-[11px] text-slate-500 flex-wrap">
            <div className="flex items-center gap-1">
              <span>{t('training.program.editor.courseScore')}</span>
              <input type="number" min={0} value={ec.total_score ?? 100}
                onChange={e => updateExamConfig({ total_score: Number(e.target.value) })}
                disabled={!isEditable}
                className="w-14 border border-slate-200 rounded px-1 py-0.5 text-center" />
            </div>
            <div className="flex items-center gap-1">
              <span>{t('training.program.editor.coursePassScore')}</span>
              <input type="number" min={0} max={100} value={ec.pass_score ?? 60}
                onChange={e => updateExamConfig({ pass_score: Number(e.target.value) })}
                disabled={!isEditable}
                className="w-12 border border-slate-200 rounded px-1 py-0.5 text-center" />
              <span>%</span>
            </div>
            <div className="flex items-center gap-1">
              <span>{t('training.program.editor.timeLimit')}</span>
              <input type="number" min={0} value={ec.time_limit_minutes ?? 10}
                onChange={e => updateExamConfig({ time_limit_minutes: Number(e.target.value) })}
                disabled={!isEditable}
                className="w-12 border border-slate-200 rounded px-1 py-0.5 text-center" />
              <span>{t('training.program.editor.minutes')}</span>
            </div>
            <div className="flex items-center gap-1">
              <span>{t('training.program.editor.maxAttempts')}</span>
              <input type="number" min={0} value={ec.max_attempts ?? 0}
                onChange={e => updateExamConfig({ max_attempts: Number(e.target.value) })}
                disabled={!isEditable}
                className="w-12 border border-slate-200 rounded px-1 py-0.5 text-center" />
              <span className="text-[9px]">(0={t('training.program.editor.unlimited')})</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
