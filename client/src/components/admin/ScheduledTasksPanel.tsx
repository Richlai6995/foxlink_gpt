import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  CalendarClock, Plus, Play, Pause, Trash2, Edit2, History,
  RefreshCw, CheckCircle, XCircle, ChevronDown, ChevronUp,
  Clock, Mail, FileText, X, Save, TriangleAlert, Settings2,
  Zap, BookOpen, Wrench, GitBranch, LayoutTemplate,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import api from '../../lib/api'
import { fmtTW, fmtDateTW } from '../../lib/fmtTW'
import { useAuth } from '../../context/AuthContext'
import type { ScheduledTask, TaskRun, DocTemplate } from '../../types'
import PipelineTab, { type PipelineNode } from './PipelineTab'
import TemplatePickerPopover from '../templates/TemplatePickerPopover'

const FILE_TYPES = ['xlsx', 'docx', 'pdf', 'pptx', 'foxlink_pptx', 'txt', 'mp3']

interface ToolCatalog {
  skills: { id: number; name: string; icon: string; type: string; description?: string }[]
  kbs: { id: number; name: string; description?: string }[]
}
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 5, 10, 15, 20, 30, 45]

function scheduleLabel(task: ScheduledTask, t: TFunction) {
  const hh = String(task.schedule_hour).padStart(2, '0')
  const mm = String(task.schedule_minute).padStart(2, '0')
  const time = `${hh}:${mm}`
  const weekdays = t('scheduledTask.weekdaysShort', { returnObjects: true }) as string[]
  if (task.schedule_type === 'daily') return t('scheduledTask.scheduleLabel.daily', { time })
  if (task.schedule_type === 'weekly') return t('scheduledTask.scheduleLabel.weekly', { day: weekdays[task.schedule_weekday ?? 1], time })
  if (task.schedule_type === 'monthly') return t('scheduledTask.scheduleLabel.monthly', { day: task.schedule_monthday, time })
  if (task.schedule_type === 'interval') return t('scheduledTask.scheduleLabel.interval', { hours: (task as any).schedule_interval_hours || 4 })
  if (task.schedule_type === 'multi_time') {
    let times: string[] = []
    try { times = JSON.parse((task as any).schedule_times_json || '[]') } catch {}
    return t('scheduledTask.scheduleLabel.multi_time', { times: times.join(', ') || '—' })
  }
  return t('scheduledTask.scheduleLabel.monthly', { day: task.schedule_monthday, time })
}

const emptyForm = (t: TFunction): Partial<ScheduledTask> => ({
  name: '',
  schedule_type: 'daily',
  schedule_hour: 8,
  schedule_minute: 0,
  schedule_weekday: 1,
  schedule_monthday: 1,
  model: 'pro',
  prompt: '',
  output_type: 'text',
  file_type: 'docx',
  filename_template: '{{task_name}}_{{date}}.docx',
  recipients_json: '[]',
  email_subject: t('scheduledTask.emailDefault.subject', { tn: '{{task_name}}', d: '{{date}}' }),
  email_body: t('scheduledTask.emailDefault.body', {
    tn: '{{task_name}}',
    d: '{{date}}',
    wd: '{{weekday}}',
    ar: '{{ai_response}}',
  }),
  status: 'active',
  expire_at: '',
  max_runs: 0,
})

// ── MultiTimeEditor ─ 多時段編輯器(chip 式可加可刪)────────────────────────
function MultiTimeEditor({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  const times: string[] = (() => {
    try { return JSON.parse(value || '[]') } catch { return [] }
  })()
  const [newTime, setNewTime] = useState('08:00')
  const addTime = () => {
    if (!/^\d{2}:\d{2}$/.test(newTime)) return
    if (times.includes(newTime)) return
    const sorted = [...times, newTime].sort()
    onChange(JSON.stringify(sorted))
  }
  const removeTime = (tm: string) => {
    onChange(JSON.stringify(times.filter(x => x !== tm)))
  }
  return (
    <div>
      <label className="label">{t('scheduledTask.form.multiTime')}</label>
      <div className="flex gap-2 items-center mb-2">
        <input type="time" className="input" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
        <button type="button" className="btn-secondary text-sm"
          onClick={addTime}
          disabled={times.length >= 12}>
          {t('scheduledTask.form.addTime')}
        </button>
      </div>
      <div className="flex gap-2 flex-wrap">
        {times.length === 0 && <span className="text-sm text-slate-400">{t('scheduledTask.form.multiTimeEmpty')}</span>}
        {times.map((tm) => (
          <span key={tm} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-50 border border-cyan-200 text-sm">
            {tm}
            <button type="button" className="text-cyan-500 hover:text-rose-500" onClick={() => removeTime(tm)}>×</button>
          </span>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-1">{t('scheduledTask.form.multiTimeHint')}</p>
    </div>
  )
}

// ── SchedulePreview ─ 顯示下 5 次執行時間預估 ─────────────────────────────────
function SchedulePreview({ form }: { form: Partial<ScheduledTask> }) {
  const { t } = useTranslation()
  const next = predictNextRuns(form, 5)
  if (!next.length) return null
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <div className="text-xs text-slate-500 mb-1">{t('scheduledTask.form.nextRunsTitle')}</div>
      <ul className="text-xs text-slate-700 space-y-0.5">
        {next.map((d, i) => (
          <li key={i}>{i + 1}. {d}</li>
        ))}
      </ul>
    </div>
  )
}

function predictNextRuns(form: Partial<ScheduledTask>, count: number): string[] {
  // 簡單預估,純 JS 不依賴 cron-parser
  const now = new Date()
  const fmt = (d: Date) => {
    const wd = ['日','一','二','三','四','五','六'][d.getDay()]
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      ' (週' + wd + ') ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }

  const results: Date[] = []
  const t = form.schedule_type
  const h = Number(form.schedule_hour ?? 8)
  const m = Number(form.schedule_minute ?? 0)

  if (t === 'daily') {
    for (let i = 0; results.length < count && i < 30; i++) {
      const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(h, m, 0, 0)
      if (d > now) results.push(d)
    }
  } else if (t === 'weekly') {
    const wd = Number(form.schedule_weekday ?? 1)
    for (let i = 0; results.length < count && i < 60; i++) {
      const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(h, m, 0, 0)
      if (d.getDay() === wd && d > now) results.push(d)
    }
  } else if (t === 'monthly') {
    const md = Number(form.schedule_monthday ?? 1)
    for (let i = 0; results.length < count && i < 365; i++) {
      const d = new Date(now); d.setDate(1); d.setMonth(now.getMonth() + Math.floor(i / 30)); d.setDate(md); d.setHours(h, m, 0, 0)
      if (d > now && !results.find(r => r.getTime() === d.getTime())) results.push(d)
    }
  } else if (t === 'interval') {
    const intervalH = Number((form as any).schedule_interval_hours || 4)
    if (intervalH < 1 || intervalH > 23) return []
    // 從 00:00 整點起算,每 intervalH 小時一次
    let d = new Date(now); d.setMinutes(0, 0, 0)
    while (d <= now) d.setHours(d.getHours() + 1)
    while (results.length < count && d.getTime() < now.getTime() + 7 * 86400000) {
      if (d.getHours() % intervalH === 0) results.push(new Date(d))
      d.setHours(d.getHours() + 1)
    }
  } else if (t === 'multi_time') {
    let times: string[] = []
    try { times = JSON.parse((form as any).schedule_times_json || '[]') } catch { return [] }
    if (!times.length) return []
    for (let i = 0; results.length < count && i < 30; i++) {
      for (const tm of times) {
        if (results.length >= count) break
        const [hh, mm] = tm.split(':').map(Number)
        const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(hh, mm, 0, 0)
        if (d > now) results.push(d)
      }
    }
    results.sort((a, b) => a.getTime() - b.getTime())
  }

  return results.slice(0, count).map(fmt)
}

// ── TaskFormModal ─────────────────────────────────────────────────────────────
function TaskFormModal({
  task,
  models,
  onClose,
  onSaved,
}: {
  task: Partial<ScheduledTask> | null
  models: { key: string; name: string }[]
  onClose: () => void
  onSaved: (t: ScheduledTask) => void
}) {
  const { t, i18n } = useTranslation()
  const isEdit = !!task?.id
  const [form, setForm] = useState<Partial<ScheduledTask>>(() => task ?? emptyForm(t))
  const [section, setSection] = useState<'basic' | 'schedule' | 'ai' | 'tools' | 'pipeline' | 'email'>('basic')
  const [pipelineNodes, setPipelineNodes] = useState<PipelineNode[]>(() => {
    try { return JSON.parse((task as any)?.pipeline_json || '[]') } catch { return [] }
  })
  const [mcpServers, setMcpServers] = useState<{ id: number; name: string; tools_json?: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [outputTemplate, setOutputTemplate] = useState<DocTemplate | null>(null)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [recipientInput, setRecipientInput] = useState('')
  const [catalog, setCatalog] = useState<ToolCatalog>({ skills: [], kbs: [] })
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [ac, setAc] = useState<{ show: boolean; trigger: string; query: string; idx: number }>(
    { show: false, trigger: '', query: '', idx: 0 }
  )

  // Autocomplete items derived from catalog + current filter
  const acItems = useMemo(() => {
    const q = ac.query.toLowerCase()
    const skills = ac.trigger === '{{kb:'
      ? []
      : catalog.skills
          .filter((sk) => !q || sk.name.toLowerCase().includes(q))
          .map((sk) => ({ type: 'skill' as const, id: sk.id, name: sk.name, icon: sk.icon || '⚡', desc: sk.description }))
    const kbs = ac.trigger === '{{skill:'
      ? []
      : catalog.kbs
          .filter((kb) => !q || kb.name.toLowerCase().includes(q))
          .map((kb) => ({ type: 'kb' as const, id: kb.id, name: kb.name, icon: '📖', desc: kb.description }))
    return [...skills, ...kbs]
  }, [ac.query, ac.trigger, catalog])

  // When models load and current model not in list, pick first available
  useEffect(() => {
    if (models.length > 0 && !models.find((m) => m.key === form.model)) {
      setForm((p) => ({ ...p, model: models[0].key }))
    }
  }, [models])

  // Load tool catalog (re-fetch when language changes so skill/KB names are localized)
  useEffect(() => {
    api.get('/scheduled-tasks/tools-catalog', { params: { lang: i18n.language } })
      .then((r) => setCatalog(r.data))
      .catch((e) => console.error('[tools-catalog]', e?.response?.data?.error || e?.message))
  }, [i18n.language])

  // Load MCP servers (for pipeline MCP nodes)
  useEffect(() => {
    api.get('/mcp-servers')
      .then((r) => setMcpServers(r.data || []))
      .catch(() => {})
  }, [])

  // Load template info when editing an existing task that has output_template_id
  useEffect(() => {
    if (task?.output_template_id) {
      api.get('/doc-templates')
        .then((r) => {
          const found = (r.data?.items || r.data || []).find((t: DocTemplate) => t.id === task.output_template_id)
          if (found) setOutputTemplate(found)
        })
        .catch(() => {})
    }
  }, [task?.output_template_id])

  const set = (k: keyof ScheduledTask, v: unknown) =>
    setForm((p) => ({ ...p, [k]: v }))

  const recipients: string[] = (() => {
    try { return JSON.parse(form.recipients_json || '[]') } catch { return [] }
  })()

  const addRecipient = () => {
    const email = recipientInput.trim()
    if (!email || recipients.includes(email)) return
    set('recipients_json', JSON.stringify([...recipients, email]))
    setRecipientInput('')
  }

  const removeRecipient = (email: string) =>
    set('recipients_json', JSON.stringify(recipients.filter((e) => e !== email)))

  const save = async () => {
    if (!form.name?.trim()) { setError(t('scheduledTask.form.nameRequired')); return }
    if (!form.prompt?.trim()) { setError(t('scheduledTask.form.promptRequired')); return }

    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        recipients_json: recipients,
        max_runs: Number(form.max_runs ?? 0),
        expire_at: form.expire_at || null,
        pipeline_json: pipelineNodes.length > 0 ? pipelineNodes : null,
      }
      const res = isEdit
        ? await api.put(`/scheduled-tasks/${task!.id}`, payload)
        : await api.post('/scheduled-tasks', payload)
      onSaved(res.data)
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } }; message?: string }
      const status = err.response?.status
      const msg = err.response?.data?.error || err.message || t('scheduledTask.saveFailed')
      setError(status ? `[${status}] ${msg}` : msg)
    } finally {
      setSaving(false)
    }
  }

  // Autocomplete: detect trigger on prompt change
  const onPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    set('prompt', val)
    const beforeCursor = val.slice(0, e.target.selectionStart)
    const skillMatch = beforeCursor.match(/\{\{skill:([^}\s]*)$/)
    const kbMatch = beforeCursor.match(/\{\{kb:([^}\s]*)$/)
    // slash trigger: / not preceded by : or another slash (avoids URLs)
    const slashMatch = beforeCursor.match(/(?:^|[\s\n,;(])\/(\S*)$/)
    if (skillMatch) {
      setAc({ show: true, trigger: '{{skill:', query: skillMatch[1], idx: 0 })
    } else if (kbMatch) {
      setAc({ show: true, trigger: '{{kb:', query: kbMatch[1], idx: 0 })
    } else if (slashMatch) {
      setAc({ show: true, trigger: '/', query: slashMatch[1], idx: 0 })
    } else {
      setAc((p) => ({ ...p, show: false }))
    }
  }

  // Autocomplete: keyboard navigation
  const onPromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!ac.show || acItems.length === 0) return
    if (e.key === 'Escape') { setAc((p) => ({ ...p, show: false })); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setAc((p) => ({ ...p, idx: Math.min(p.idx + 1, acItems.length - 1) })) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAc((p) => ({ ...p, idx: Math.max(p.idx - 1, 0) })) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acSelect(acItems[ac.idx]) }
  }

  // Autocomplete: select an item and insert syntax
  const acSelect = (item: { type: 'skill' | 'kb'; name: string }) => {
    const ta = promptRef.current
    if (!ta) return
    const val = ta.value
    const cursor = ta.selectionStart
    const beforeCursor = val.slice(0, cursor)
    const replacement = item.type === 'skill' ? `{{skill:${item.name}}}` : `{{kb:${item.name}}}`
    let triggerRe: RegExp
    if (ac.trigger === '/') triggerRe = /\/\S*$/
    else if (ac.trigger === '{{skill:') triggerRe = /\{\{skill:[^}\s]*$/
    else triggerRe = /\{\{kb:[^}\s]*$/
    const newBefore = beforeCursor.replace(triggerRe, replacement)
    const newVal = newBefore + val.slice(cursor)
    set('prompt', newVal)
    setAc((p) => ({ ...p, show: false }))
    const pos = newBefore.length
    setTimeout(() => { ta.focus(); ta.setSelectionRange(pos, pos) }, 10)
  }

  // Insert tool ref syntax at cursor position in prompt textarea
  const insertToolRef = (syntax: string) => {
    const ta = promptRef.current
    if (!ta) { set('prompt', (form.prompt || '') + syntax); return }
    const start = ta.selectionStart ?? (form.prompt || '').length
    const end = ta.selectionEnd ?? start
    const before = (form.prompt || '').slice(0, start)
    const after = (form.prompt || '').slice(end)
    set('prompt', before + syntax + after)
    // Restore focus + cursor
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + syntax.length, start + syntax.length)
    }, 10)
  }

  const sectionBtns: { id: typeof section; label: string; badge?: number }[] = [
    { id: 'basic', label: t('scheduledTask.sections.basic') },
    { id: 'schedule', label: t('scheduledTask.sections.schedule') },
    { id: 'ai', label: t('scheduledTask.sections.ai') },
    { id: 'tools', label: t('scheduledTask.sections.tools') },
    { id: 'pipeline', label: t('scheduledTask.sections.pipeline'), badge: pipelineNodes.length || undefined },
    { id: 'email', label: t('scheduledTask.sections.email') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <CalendarClock size={18} className="text-blue-500" />
            {isEdit ? t('scheduledTask.editTask') : t('scheduledTask.addTask')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-slate-200 px-6 gap-1 pt-1">
          {sectionBtns.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition flex items-center gap-1 ${
                section === s.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {s.id === 'pipeline' && <GitBranch size={12} />}
              {s.label}
              {s.badge ? (
                <span className="ml-0.5 text-[10px] bg-blue-500 text-white rounded-full px-1.5 py-0 leading-4">
                  {s.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* ── Basic ── */}
          {section === 'basic' && (
            <>
              <div>
                <label className="label">{t('scheduledTask.form.taskName')}</label>
                <input className="input w-full" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder={t('scheduledTask.form.taskNamePlaceholder')} />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label">{t('scheduledTask.form.statusLabel')}</label>
                  <select className="input w-full" value={form.status ?? 'active'} onChange={(e) => set('status', e.target.value)}>
                    <option value="active">{t('scheduledTask.form.statusActive')}</option>
                    <option value="paused">{t('scheduledTask.form.statusPaused')}</option>
                    <option value="draft">{t('scheduledTask.form.statusDraft')}</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="label">{t('scheduledTask.form.expireAt')}</label>
                  <input type="date" className="input w-full" value={form.expire_at ?? ''} onChange={(e) => set('expire_at', e.target.value)} />
                </div>
                <div className="w-28">
                  <label className="label">{t('scheduledTask.form.maxRuns')}</label>
                  <input type="number" min={0} className="input w-full" value={form.max_runs ?? 0} onChange={(e) => set('max_runs', Number(e.target.value))} />
                  <p className="text-xs text-slate-400 mt-0.5">{t('scheduledTask.form.maxRunsHint')}</p>
                </div>
              </div>
            </>
          )}

          {/* ── Schedule ── */}
          {section === 'schedule' && (
            <>
              <div>
                <label className="label">{t('scheduledTask.form.frequency')}</label>
                <div className="flex gap-3 flex-wrap">
                  {(['daily', 'weekly', 'monthly', 'interval', 'multi_time'] as const).map((v) => (
                    <label key={v} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input type="radio" checked={form.schedule_type === v} onChange={() => set('schedule_type', v)} />
                      {{
                        daily: t('scheduledTask.form.freqDaily'),
                        weekly: t('scheduledTask.form.freqWeekly'),
                        monthly: t('scheduledTask.form.freqMonthly'),
                        interval: t('scheduledTask.form.freqInterval'),
                        multi_time: t('scheduledTask.form.freqMultiTime'),
                      }[v]}
                    </label>
                  ))}
                </div>
              </div>

              {/* daily / weekly / monthly:單一時點 */}
              {(form.schedule_type === 'daily' || form.schedule_type === 'weekly' || form.schedule_type === 'monthly') && (
                <div className="flex gap-3 flex-wrap">
                  <div>
                    <label className="label">{t('scheduledTask.form.executeTime')}</label>
                    <div className="flex gap-1 items-center">
                      <select className="input" value={form.schedule_hour ?? 8} onChange={(e) => set('schedule_hour', Number(e.target.value))}>
                        {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
                      </select>
                      <span className="text-slate-500">:</span>
                      <select className="input" value={form.schedule_minute ?? 0} onChange={(e) => set('schedule_minute', Number(e.target.value))}>
                        {MINUTES.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                      </select>
                    </div>
                  </div>
                  {form.schedule_type === 'weekly' && (
                    <div>
                      <label className="label">{t('scheduledTask.form.weekday')}</label>
                      <select className="input" value={form.schedule_weekday ?? 1} onChange={(e) => set('schedule_weekday', Number(e.target.value))}>
                        {(t('scheduledTask.weekdaysShort', { returnObjects: true }) as string[]).map((d, i) => (
                          <option key={i} value={i}>{t('scheduledTask.form.weekdayPrefix')}{d}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {form.schedule_type === 'monthly' && (
                    <div>
                      <label className="label">{t('scheduledTask.form.monthDay')}</label>
                      <input type="number" min={1} max={28} className="input w-20" value={form.schedule_monthday ?? 1} onChange={(e) => set('schedule_monthday', Number(e.target.value))} />
                    </div>
                  )}
                </div>
              )}

              {/* interval:每 N 小時 */}
              {form.schedule_type === 'interval' && (
                <div>
                  <label className="label">{t('scheduledTask.form.intervalHours')}</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500">{t('scheduledTask.form.intervalEvery')}</span>
                    <input type="number" min={1} max={23} className="input w-20"
                      value={(form as any).schedule_interval_hours ?? 4}
                      onChange={(e) => set('schedule_interval_hours' as any, Number(e.target.value))} />
                    <span className="text-sm text-slate-500">{t('scheduledTask.form.hour')}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{t('scheduledTask.form.intervalHint')}</p>
                </div>
              )}

              {/* multi_time:多時段 */}
              {form.schedule_type === 'multi_time' && (
                <MultiTimeEditor
                  value={(form as any).schedule_times_json}
                  onChange={(v) => set('schedule_times_json' as any, v)}
                />
              )}

              {/* 下次執行預估 */}
              <SchedulePreview form={form} />
            </>
          )}

          {/* ── AI ── */}
          {section === 'ai' && (
            <>
              <div>
                <label className="label">{t('scheduledTask.form.model')}</label>
                <select className="input w-full" value={form.model ?? 'pro'} onChange={(e) => set('model', e.target.value)}>
                  {models.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Prompt *</label>
                <div className="relative">
                  <textarea
                    ref={promptRef}
                    className="input w-full h-36 resize-y font-mono text-xs"
                    value={form.prompt ?? ''}
                    onChange={onPromptChange}
                    onKeyDown={onPromptKeyDown}
                    onBlur={() => setTimeout(() => setAc((p) => ({ ...p, show: false })), 150)}
                    placeholder={t('scheduledTask.promptPlaceholderExample', { d: '{{date}}', tn: '{{task_name}}' })}
                  />
                  {ac.show && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-full max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                      <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-100 flex items-center justify-between">
                        <span>
                          {ac.trigger === '/'
                            ? t('scheduledTask.ac.selectSkillOrKb')
                            : ac.trigger === '{{skill:'
                            ? t('scheduledTask.ac.selectSkill')
                            : t('scheduledTask.ac.selectKb')}
                          {ac.query && <> — {t('scheduledTask.ac.filterLabel')}<span className="text-blue-500">{ac.query}</span></>}
                        </span>
                        <span className="text-slate-300">↑↓ Enter Esc</span>
                      </div>
                      {acItems.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-slate-400 text-center">
                          {ac.query ? t('scheduledTask.ac.noMatch', { query: ac.query }) : t('scheduledTask.ac.noTools') }
                        </p>
                      ) : acItems.map((item, i) => (
                        <button
                          key={`${item.type}-${item.id}`}
                          onMouseDown={(e) => { e.preventDefault(); acSelect(item) }}
                          className={`w-full text-left flex items-center gap-2.5 px-3 py-2 transition ${
                            i === ac.idx ? 'bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className="text-base shrink-0">{item.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{item.name}</p>
                            {item.desc && <p className="text-xs text-slate-400 truncate">{item.desc}</p>}
                          </div>
                          <span className={`text-xs shrink-0 px-1.5 py-0.5 rounded-full font-medium ${
                            item.type === 'skill' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {item.type === 'skill' ? t('scheduledTask.ac.skillBadge') : t('scheduledTask.ac.kbBadge')}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {t('scheduledTask.promptHint')}
                </p>
              </div>
              <div>
                <label className="label">{t('scheduledTask.form.outputType')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input type="radio" checked={form.output_type === 'text'} onChange={() => set('output_type', 'text')} />
                    {t('scheduledTask.form.outputText')}
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input type="radio" checked={form.output_type === 'file'} onChange={() => set('output_type', 'file')} />
                    {t('scheduledTask.form.outputFile')}
                  </label>
                </div>
              </div>
              {form.output_type === 'file' && (
                <div className="flex gap-3">
                  <div>
                    <label className="label">{t('scheduledTask.form.fileFormat')}</label>
                    <select className="input" value={form.file_type ?? 'docx'} onChange={(e) => {
                      set('file_type', e.target.value)
                      const ext = e.target.value
                      set('filename_template', `{{task_name}}_{{date}}.${ext}`)
                    }}>
                      {FILE_TYPES.map((ft) => <option key={ft} value={ft}>{ft === 'mp3' ? t('scheduledTask.mp3Label') : ft.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="label">{t('scheduledTask.form.filenameTemplate')}</label>
                    <input className="input w-full" value={form.filename_template ?? ''} onChange={(e) => set('filename_template', e.target.value)} placeholder="{{task_name}}_{{date}}.docx" />
                  </div>
                </div>
              )}
              {form.output_type === 'file' && form.file_type === 'mp3' && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  {t('scheduledTask.form.mp3Note')}
                </p>
              )}
              {/* ── Output template picker ── */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <LayoutTemplate size={13} className="text-indigo-500" /> {t('scheduledTask.outputTemplate.label')}
                </label>
                {outputTemplate ? (
                  <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">
                    <LayoutTemplate size={13} />
                    <span className="flex-1 font-medium">{outputTemplate.name}</span>
                    <span className="text-indigo-400">{outputTemplate.format.toUpperCase()}</span>
                    <button onClick={() => { setOutputTemplate(null); set('output_template_id', null) }}
                      className="ml-1 text-indigo-400 hover:text-red-500"><X size={12} /></button>
                  </div>
                ) : (
                  <div className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(v => !v)}
                      className="flex items-center gap-1.5 text-xs border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition"
                    >
                      <LayoutTemplate size={13} /> {t('scheduledTask.outputTemplate.select')}
                    </button>
                    {showTemplatePicker && (
                      <TemplatePickerPopover
                        onSelect={(tpl) => {
                          setOutputTemplate(tpl)
                          set('output_template_id', tpl.id)
                          setShowTemplatePicker(false)
                        }}
                        onClose={() => setShowTemplatePicker(false)}
                      />
                    )}
                  </div>
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  {t('scheduledTask.outputTemplate.helpPrefix')} <code className="bg-slate-100 px-1 rounded">{'{{template:id}}'}</code> {t('scheduledTask.outputTemplate.helpSuffix')}
                </p>
              </div>
            </>
          )}

          {/* ── Tools ── */}
          {section === 'tools' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                {t('scheduledTask.tools.hint')}
              </p>

              {/* Skills */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <Zap size={13} className="text-amber-500" /> {t('scheduledTask.tools.availableSkills')}
                </label>
                {catalog.skills.length === 0 ? (
                  <p className="text-xs text-slate-400">{t('scheduledTask.tools.noSkills')}</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {catalog.skills.map((sk) => (
                      <div key={sk.id} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-blue-300 transition">
                        <span className="text-base">{sk.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{sk.name}</p>
                          {sk.description && <p className="text-xs text-slate-400 truncate">{sk.description}</p>}
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">{sk.type}</span>
                        <button
                          onClick={() => insertToolRef(`{{skill:${sk.name}}}`)}
                          className="shrink-0 text-xs px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition"
                        >
                          {t('scheduledTask.tools.insert')}
                        </button>
                        <button
                          onClick={() => insertToolRef(`{{skill:${sk.name} input=""}}`)}
                          className="shrink-0 text-xs px-2 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 transition"
                          title={t('scheduledTask.tools.withParams')}
                        >
                          {t('scheduledTask.tools.withParams')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Knowledge Bases */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <BookOpen size={13} className="text-blue-500" /> {t('scheduledTask.tools.availableKbs')}
                </label>
                {catalog.kbs.length === 0 ? (
                  <p className="text-xs text-slate-400">{t('scheduledTask.tools.noKbs')}</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {catalog.kbs.map((kb) => (
                      <div key={kb.id} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-blue-300 transition">
                        <BookOpen size={14} className="text-blue-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{kb.name}</p>
                          {kb.description && <p className="text-xs text-slate-400 truncate">{kb.description}</p>}
                        </div>
                        <button
                          onClick={() => insertToolRef(`{{kb:${kb.name}}}`)}
                          className="shrink-0 text-xs px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition"
                        >
                          {t('scheduledTask.tools.insert')}
                        </button>
                        <button
                          onClick={() => insertToolRef(`{{kb:${kb.name} query=""}}`)}
                          className="shrink-0 text-xs px-2 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 transition"
                          title={t('scheduledTask.tools.withQuery')}
                        >
                          {t('scheduledTask.tools.withQuery')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Syntax Reference */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1">
                  <Wrench size={12} /> {t('scheduledTask.tools.syntaxTitle')}
                </p>
                <div className="space-y-1 text-xs font-mono text-slate-600">
                  <p><span className="text-amber-600">{'{{skill:name}}'}</span> — {t('scheduledTask.tools.syntaxSkill')}</p>
                  <p><span className="text-amber-600">{'{{skill:name input="text"}}'}</span> — {t('scheduledTask.tools.syntaxSkillInput')}</p>
                  <p><span className="text-blue-600">{'{{kb:name}}'}</span> — {t('scheduledTask.tools.syntaxKb')}</p>
                  <p><span className="text-blue-600">{'{{kb:name query="keyword"}}'}</span> — {t('scheduledTask.tools.syntaxKbQuery')}</p>
                  <p><span className="text-slate-400">{'{{mcp:toolName}}'}</span> — {t('scheduledTask.tools.syntaxMcp')}</p>
                  <p><span className="text-slate-400">{'{{dify:name}}'}</span> — {t('scheduledTask.tools.syntaxDify')}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Pipeline ── */}
          {section === 'pipeline' && (
            <PipelineTab
              nodes={pipelineNodes}
              onChange={setPipelineNodes}
              catalog={catalog}
              mcpServers={mcpServers}
              taskName={form.name}
              taskId={isEdit && task ? task.id : undefined}
            />
          )}

          {/* ── Email ── */}
          {section === 'email' && (
            <>
              <div>
                <label className="label">{t('scheduledTask.form.recipients')}</label>
                <div className="flex gap-2 mb-2">
                  <input
                    className="input flex-1"
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRecipient())}
                    placeholder={t('scheduledTask.form.recipientPlaceholder')}
                  />
                  <button className="btn-primary" onClick={addRecipient}>{t('scheduledTask.form.addRecipient')}</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recipients.map((r) => (
                    <span key={r} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
                      {r}
                      <button onClick={() => removeRecipient(r)}><X size={10} /></button>
                    </span>
                  ))}
                  {recipients.length === 0 && <p className="text-xs text-slate-400">{t('scheduledTask.form.noExtraRecipients')}</p>}
                </div>
              </div>
              <div>
                <label className="label">{t('scheduledTask.form.emailSubject')}</label>
                <input className="input w-full" value={form.email_subject ?? ''} onChange={(e) => set('email_subject', e.target.value)} />
              </div>
              <div>
                <label className="label">{t('scheduledTask.form.emailBody')}</label>
                <textarea className="input w-full h-36 resize-y" value={form.email_body ?? ''} onChange={(e) => set('email_body', e.target.value)} />
                <p className="text-xs text-slate-400 mt-1">{t('scheduledTask.form.toolsUsedHint')}</p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {error && (
          <div className="mx-6 mb-2 text-sm text-red-600 flex items-center gap-1">
            <TriangleAlert size={14} /> {error}
          </div>
        )}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="btn-ghost">{t('common.cancel')}</button>
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5">
            <Save size={14} /> {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RunDetailModal ────────────────────────────────────────────────────────────
function RunDetailModal({ run, onClose }: { run: TaskRun; onClose: () => void }) {
  const { t } = useTranslation()
  const [fullText, setFullText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!run.session_id) { setFullText(run.response_preview || ''); return }
    setLoading(true)
    api.get(`/chat/sessions/${run.session_id}`)
      .then((r) => {
        const msgs: { role: string; content: string }[] = r.data.messages || []
        const aiMsg = msgs.filter(m => m.role === 'assistant').pop()
        setFullText(aiMsg?.content || run.response_preview || '')
      })
      .catch(() => setFullText(run.response_preview || ''))
      .finally(() => setLoading(false))
  }, [run.session_id, run.response_preview])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-semibold text-slate-800 text-sm">{t('scheduledTask.runDetail.title')} — {fmtTW(run.run_at)}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-5 flex-1 text-sm text-slate-700 whitespace-pre-wrap">
          {loading ? t('common.loading') : (fullText || t('scheduledTask.runDetail.noContent'))}
        </div>
      </div>
    </div>
  )
}

// ── HistoryRow ────────────────────────────────────────────────────────────────
function HistoryRow({ taskId }: { taskId: number }) {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<TaskRun[]>([])
  const [loading, setLoading] = useState(true)
  const [detailRun, setDetailRun] = useState<TaskRun | null>(null)

  useEffect(() => {
    api.get(`/scheduled-tasks/${taskId}/history?limit=10`)
      .then((r) => setRuns(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [taskId])

  if (loading) return <div className="py-3 px-6 text-sm text-slate-400">{t('common.loading')}</div>
  if (runs.length === 0) return <div className="py-3 px-6 text-sm text-slate-400">{t('scheduledTask.noHistory')}</div>

  return (
    <>
    {detailRun && <RunDetailModal run={detailRun} onClose={() => setDetailRun(null)} />}
    <div className="px-6 pb-4">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-100">
            <th className="text-left py-1.5 pr-3 font-medium">{t('scheduledTask.historyCol.time')}</th>
            <th className="text-left py-1.5 pr-3 font-medium">{t('scheduledTask.historyCol.status')}</th>
            <th className="text-left py-1.5 pr-3 font-medium">{t('scheduledTask.historyCol.attempt')}</th>
            <th className="text-left py-1.5 pr-3 font-medium">{t('scheduledTask.historyCol.duration')}</th>
            <th className="text-left py-1.5 pr-3 font-medium">{t('scheduledTask.historyCol.tools')}</th>
            <th className="text-left py-1.5 pr-3 font-medium">{t('scheduledTask.historyCol.email')}</th>
            <th className="text-left py-1.5 font-medium">{t('scheduledTask.historyCol.preview')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const files: { filename: string; publicUrl: string }[] = (() => {
              try { return JSON.parse((r as any).generated_files_json || '[]') } catch { return [] }
            })()
            const toolsUsed: { skills?: {name:string}[]; kbs?: {name:string}[] } = (() => {
              try { return JSON.parse((r as any).tools_used_json || '{}') } catch { return {} }
            })()
            const toolNames = [
              ...(toolsUsed.skills?.map(s => s.name) || []),
              ...(toolsUsed.kbs?.map(k => k.name) || []),
            ]
            return (
              <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">{fmtTW(r.run_at)}</td>
                <td className="py-1.5 pr-3">
                  {r.status === 'ok'
                    ? <span className="flex items-center gap-1 text-green-600"><CheckCircle size={12} /> {t('scheduledTask.runOk')}</span>
                    : <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> {t('scheduledTask.runFail')}</span>}
                </td>
                <td className="py-1.5 pr-3 text-slate-500">{r.attempt}/3</td>
                <td className="py-1.5 pr-3 text-slate-500">{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
                <td className="py-1.5 pr-3">
                  {toolNames.length > 0
                    ? <div className="flex flex-col gap-0.5">
                        {toolNames.map(n => (
                          <span key={n} className="inline-flex items-center gap-0.5 text-amber-600 text-xs">
                            <Zap size={9} /> {n}
                          </span>
                        ))}
                      </div>
                    : <span className="text-slate-300">-</span>}
                </td>
                <td className="py-1.5 pr-3">
                  {r.email_sent_to
                    ? <span className="flex items-center gap-0.5 text-blue-500"><Mail size={11} /> {t('scheduledTask.emailSent')}</span>
                    : <span className="text-slate-300">-</span>}
                </td>
                <td className="py-1.5 max-w-xs">
                  {r.status === 'fail'
                    ? <span className="text-red-500">{r.error_msg?.slice(0, 80)}</span>
                    : (
                      <button onClick={() => setDetailRun(r)}
                        className="text-left text-slate-600 line-clamp-2 hover:text-blue-600 hover:underline cursor-pointer w-full">
                        {r.response_preview || t('scheduledTask.runDetail.viewFull')}
                      </button>
                    )}
                  <div className="flex flex-col gap-1 mt-1">
                    {files.map((f) => {
                      const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(f.filename)
                      if (isAudio) return (
                        <div key={f.publicUrl} className="flex flex-col gap-0.5">
                          <span className="text-slate-500 text-xs flex items-center gap-1"><FileText size={10} />{f.filename}</span>
                          <audio controls src={f.publicUrl} className="h-7 w-48" />
                        </div>
                      )
                      return (
                        <a key={f.publicUrl} href={f.publicUrl} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-blue-500 hover:underline">
                          <FileText size={10} /> {f.filename}
                        </a>
                      )
                    })}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}

// ── GlobalSettings ─────────────────────────────────────────────────────────
function GlobalSettings() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(true)
  const [maxPerUser, setMaxPerUser] = useState(10)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.get('/admin/settings/scheduled-tasks').then((r) => {
      setEnabled(r.data.enabled)
      setMaxPerUser(r.data.max_per_user)
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/admin/settings/scheduled-tasks', { enabled, max_per_user: maxPerUser })
      setDirty(false)
      setMsg(t('scheduledTask.saved'))
      setTimeout(() => setMsg(''), 2000)
    } catch {
      setMsg(t('scheduledTask.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5 flex flex-wrap items-center gap-5">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <Settings2 size={15} className="text-blue-500" /> {t('scheduledTask.globalSettings')}
      </div>
      {/* Global toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <div
          onClick={() => { setEnabled((v) => !v); setDirty(true) }}
          className={`w-10 h-5 rounded-full transition-colors relative ${enabled ? 'bg-blue-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </div>
        <span className="text-sm text-slate-700">{t('scheduledTask.enableSchedule')}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {enabled ? t('scheduledTask.scheduleOpen') : t('scheduledTask.scheduleClosed')}
        </span>
      </label>
      {/* Max per user */}
      <label className="flex items-center gap-2 text-sm text-slate-700">
        {t('scheduledTask.maxPerUser')}
        <input
          type="number"
          min={1}
          max={100}
          value={maxPerUser}
          onChange={(e) => { setMaxPerUser(parseInt(e.target.value) || 1); setDirty(true) }}
          className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-center"
        />
        {t('scheduledTask.tasksUnit')}
      </label>
      {/* Save */}
      <button
        onClick={save}
        disabled={!dirty || saving}
        className={`ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition
          ${dirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
      >
        <Save size={13} /> {saving ? t('common.saving') : t('scheduledTask.saveSettings')}
      </button>
      {msg && <span className="text-xs text-blue-500">{msg}</span>}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function ScheduledTasksPanel() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [models, setModels] = useState<{ key: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [formTask, setFormTask] = useState<Partial<ScheduledTask> | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set())

  // Load models independently — don't let tasks 403 kill the model list
  useEffect(() => {
    api.get('/chat/models').then((r) => setModels(r.data)).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const tr = await api.get('/scheduled-tasks')
      setTasks(tr.data)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } }).response?.data?.error
      setMsg(err || t('scheduledTask.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const errMsg = (e: unknown) => {
    const err = e as { response?: { status?: number; data?: { error?: string } }; message?: string }
    const status = err.response?.status
    const msg = err.response?.data?.error || err.message || t('common.unknownError')
    return status ? `[${status}] ${msg}` : msg
  }

  const toggle = async (task: ScheduledTask) => {
    try {
      const r = await api.post(`/scheduled-tasks/${task.id}/toggle`)
      setTasks((p) => p.map((x) => x.id === task.id ? { ...x, status: r.data.status } : x))
      flash(t('scheduledTask.toggleEnabled', {
        status: r.data.status === 'active' ? t('scheduledTask.enabled') : t('scheduledTask.paused'),
        name: task.name,
      }))
    } catch (e) { flash(errMsg(e)) }
  }

  const runNow = async (task: ScheduledTask) => {
    if (runningIds.has(task.id)) return
    const prevRunAt = task.last_run_at
    const prevStatus = task.status
    setRunningIds((prev) => new Set(prev).add(task.id))
    try {
      await api.post(`/scheduled-tasks/${task.id}/run-now`)
      flash(t('scheduledTask.runningTask', { name: task.name }))
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        if (attempts > 90) { // 3 min timeout
          clearInterval(poll)
          setRunningIds((prev) => { const s = new Set(prev); s.delete(task.id); return s })
          flash(t('scheduledTask.runTimeout'))
          return
        }
        try {
          const r = await api.get('/scheduled-tasks')
          const updated = (r.data as ScheduledTask[]).find((x) => x.id === task.id)
          // Detect: last_run_at changed (normal completion) OR status changed (e.g. auto-paused)
          const done = updated && (
            updated.last_run_at !== prevRunAt ||
            updated.status !== prevStatus
          )
          if (done) {
            clearInterval(poll)
            setRunningIds((prev) => { const s = new Set(prev); s.delete(task.id); return s })
            setTasks(r.data)
            flash(updated!.last_run_status === 'ok'
              ? t('scheduledTask.runComplete', { name: task.name })
              : t('scheduledTask.runFailed', { name: task.name }))
            // Refresh history if already expanded
            if (expanded === task.id) {
              setExpanded(null)
              setTimeout(() => setExpanded(task.id), 100)
            }
          }
        } catch { /* ignore poll errors */ }
      }, 2000)
    } catch (e) {
      setRunningIds((prev) => { const s = new Set(prev); s.delete(task.id); return s })
      flash(errMsg(e))
    }
  }

  const del = async (task: ScheduledTask) => {
    if (!confirm(t('scheduledTask.deleteConfirm', { name: task.name }))) return
    try {
      await api.delete(`/scheduled-tasks/${task.id}`)
      setTasks((p) => p.filter((x) => x.id !== task.id))
      flash(t('scheduledTask.deleted'))
    } catch (e) { flash(errMsg(e)) }
  }

  const onSaved = (saved: ScheduledTask) => {
    setTasks((p) => {
      const idx = p.findIndex((x) => x.id === saved.id)
      return idx >= 0 ? p.map((x) => x.id === saved.id ? saved : x) : [saved, ...p]
    })
    setFormTask(null)
    flash(t('scheduledTask.taskSaved', { name: saved.name }))
  }

  return (
    <div>
      {/* Global Settings (admin only) */}
      {isAdmin && <GlobalSettings />}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <CalendarClock size={20} className="text-blue-500" /> {t('scheduledTask.title')}
        </h2>
        <div className="flex gap-2">
          {msg && <span className="text-sm text-blue-600 self-center">{msg}</span>}
          <button onClick={() => load()} disabled={loading} className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('common.refresh')}
          </button>
          <button onClick={() => setFormTask(emptyForm(t))} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> {t('scheduledTask.addTask')}
          </button>
        </div>
      </div>

      {/* Table */}
      {tasks.length === 0 && !loading ? (
        <p className="text-center text-slate-400 py-12 text-sm">{t('scheduledTask.noTasks')}</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600 w-8"></th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('scheduledTask.cols.taskName')}</th>
                {isAdmin && <th className="text-left px-4 py-3 font-medium text-slate-600">{t('scheduledTask.cols.executor')}</th>}
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('scheduledTask.cols.schedule')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('scheduledTask.cols.lastRun')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('scheduledTask.cols.expireAt')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('scheduledTask.cols.runCount')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('scheduledTask.cols.status')}</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">{t('scheduledTask.cols.action')}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <React.Fragment key={task.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpanded(expanded === task.id ? null : task.id)}
                        className="text-slate-400 hover:text-blue-500 transition"
                      >
                        {expanded === task.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{task.name}</p>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        {task.user_name
                          ? <><p className="text-sm text-slate-700">{task.user_name}</p>
                              {task.username && <p className="text-xs text-slate-400">{task.username}</p>}</>
                          : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-slate-600">
                      <span className="flex items-center gap-1">
                        <Clock size={12} className="text-slate-400" />
                        {scheduleLabel(task, t)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {task.last_run_at ? (
                        <span className="flex items-center gap-1">
                          {task.last_run_status === 'ok'
                            ? <CheckCircle size={13} className="text-green-500" />
                            : <XCircle size={13} className="text-red-500" />}
                          <span className="text-slate-600">{fmtTW(task.last_run_at)}</span>
                        </span>
                      ) : (
                        <span className="text-slate-300">{t('scheduledTask.notYetRun')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {task.expire_at ? fmtDateTW(task.expire_at) : <span className="text-slate-300">{t('scheduledTask.noExpiry')}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {task.run_count}{task.max_runs > 0 ? ` / ${task.max_runs}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      {runningIds.has(task.id) ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                          <RefreshCw size={10} className="animate-spin" /> {t('scheduledTask.running')}
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          task.status === 'active' ? 'bg-green-100 text-green-700' :
                          task.status === 'paused' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {task.status === 'active'
                            ? t('scheduledTask.enabled')
                            : task.status === 'paused'
                            ? t('scheduledTask.paused')
                            : t('scheduledTask.draft')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title={runningIds.has(task.id) ? t('scheduledTask.running') : t('scheduledTask.runNow')}
                          onClick={() => runNow(task)}
                          disabled={runningIds.has(task.id)}
                          className={`p-1.5 rounded transition ${
                            runningIds.has(task.id)
                              ? 'text-green-500 cursor-not-allowed'
                              : 'hover:bg-green-50 text-slate-400 hover:text-green-600'
                          }`}
                        >
                          {runningIds.has(task.id)
                            ? <RefreshCw size={14} className="animate-spin" />
                            : <Play size={14} />}
                        </button>
                        <button
                          title={task.status === 'active' ? t('scheduledTask.pause') : t('scheduledTask.resume')}
                          onClick={() => toggle(task)}
                          className="p-1.5 rounded hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition">
                          {task.status === 'active' ? <Pause size={14} /> : <Play size={14} className="text-green-500" />}
                        </button>
                        <button
                          title={t('scheduledTask.history')}
                          onClick={() => setExpanded(expanded === task.id ? null : task.id)}
                          className="p-1.5 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition">
                          <History size={14} />
                        </button>
                        <button
                          title={t('common.edit')}
                          onClick={() => setFormTask(task)}
                          className="p-1.5 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition">
                          <Edit2 size={14} />
                        </button>
                        <button
                          title={t('common.delete')}
                          onClick={() => del(task)}
                          className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === task.id && (
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <td colSpan={isAdmin ? 9 : 8} className="px-0">
                        <div className="px-4 py-2 text-xs font-medium text-slate-500 flex items-center gap-1 border-b border-slate-100">
                          <History size={12} /> {t('scheduledTask.historyTitle')}
                        </div>
                        <HistoryRow taskId={task.id} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form Modal */}
      {formTask !== null && (
        <TaskFormModal
          task={formTask}
          models={models}
          onClose={() => setFormTask(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
