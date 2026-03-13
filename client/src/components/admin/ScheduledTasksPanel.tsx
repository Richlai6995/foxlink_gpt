import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  CalendarClock, Plus, Play, Pause, Trash2, Edit2, History,
  RefreshCw, CheckCircle, XCircle, ChevronDown, ChevronUp,
  Clock, Mail, FileText, X, Save, TriangleAlert, Settings2,
  Zap, BookOpen, Wrench, GitBranch,
} from 'lucide-react'
import api from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import type { ScheduledTask, TaskRun } from '../../types'
import PipelineTab, { type PipelineNode } from './PipelineTab'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const FILE_TYPES = ['xlsx', 'docx', 'pdf', 'pptx', 'foxlink_pptx', 'txt', 'mp3']
const FILE_TYPE_LABELS: Record<string, string> = {
  xlsx: 'XLSX', docx: 'DOCX', pdf: 'PDF', pptx: 'PPTX',
  foxlink_pptx: 'Foxlink PPTX', txt: 'TXT', mp3: 'MP3 語音',
}

interface ToolCatalog {
  skills: { id: number; name: string; icon: string; type: string; description?: string }[]
  kbs: { id: number; name: string; description?: string }[]
}
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 5, 10, 15, 20, 30, 45]

function scheduleLabel(t: ScheduledTask) {
  const hh = String(t.schedule_hour).padStart(2, '0')
  const mm = String(t.schedule_minute).padStart(2, '0')
  const time = `${hh}:${mm}`
  if (t.schedule_type === 'daily') return `每天 ${time}`
  if (t.schedule_type === 'weekly') return `每週${WEEKDAYS[t.schedule_weekday ?? 1]} ${time}`
  return `每月 ${t.schedule_monthday} 日 ${time}`
}

const emptyForm = (): Partial<ScheduledTask> => ({
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
  email_subject: '排程任務執行完成：{{task_name}} ({{date}})',
  email_body:
    '您好，\n\n以下為 {{date}}（{{weekday}}）排程任務「{{task_name}}」的執行結果：\n\n{{ai_response}}\n\n如有附件請見附檔。\n\nFOXLINK GPT',
  status: 'active',
  expire_at: '',
  max_runs: 0,
})

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
  const isEdit = !!task?.id
  const [form, setForm] = useState<Partial<ScheduledTask>>(task ?? emptyForm())
  const [section, setSection] = useState<'basic' | 'schedule' | 'ai' | 'tools' | 'pipeline' | 'email'>('basic')
  const [pipelineNodes, setPipelineNodes] = useState<PipelineNode[]>(() => {
    try { return JSON.parse((task as any)?.pipeline_json || '[]') } catch { return [] }
  })
  const [mcpServers, setMcpServers] = useState<{ id: number; name: string; tools_json?: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
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

  // Load tool catalog
  useEffect(() => {
    api.get('/scheduled-tasks/tools-catalog')
      .then((r) => setCatalog(r.data))
      .catch((e) => console.error('[tools-catalog]', e?.response?.data?.error || e?.message))
  }, [])

  // Load MCP servers (for pipeline MCP nodes)
  useEffect(() => {
    api.get('/mcp-servers')
      .then((r) => setMcpServers(r.data || []))
      .catch(() => {})
  }, [])

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
    if (!form.name?.trim()) { setError('請填寫任務名稱'); return }
    if (!form.prompt?.trim()) { setError('請填寫 Prompt'); return }
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
      const msg = err.response?.data?.error || err.message || '儲存失敗'
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
    { id: 'basic', label: '基本設定' },
    { id: 'schedule', label: '排程' },
    { id: 'ai', label: 'AI 設定' },
    { id: 'tools', label: '工具引用' },
    { id: 'pipeline', label: 'Pipeline', badge: pipelineNodes.length || undefined },
    { id: 'email', label: '郵件通知' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <CalendarClock size={18} className="text-blue-500" />
            {isEdit ? '編輯排程任務' : '新增排程任務'}
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
                <label className="label">任務名稱 *</label>
                <input className="input w-full" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. 週報分析" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label">狀態</label>
                  <select className="input w-full" value={form.status ?? 'active'} onChange={(e) => set('status', e.target.value)}>
                    <option value="active">啟用</option>
                    <option value="paused">暫停</option>
                    <option value="draft">草稿</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="label">到期日（選填）</label>
                  <input type="date" className="input w-full" value={form.expire_at ?? ''} onChange={(e) => set('expire_at', e.target.value)} />
                </div>
                <div className="w-28">
                  <label className="label">最大執行次數</label>
                  <input type="number" min={0} className="input w-full" value={form.max_runs ?? 0} onChange={(e) => set('max_runs', Number(e.target.value))} />
                  <p className="text-xs text-slate-400 mt-0.5">0 = 不限</p>
                </div>
              </div>
            </>
          )}

          {/* ── Schedule ── */}
          {section === 'schedule' && (
            <>
              <div>
                <label className="label">頻率</label>
                <div className="flex gap-3">
                  {(['daily', 'weekly', 'monthly'] as const).map((v) => (
                    <label key={v} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input type="radio" checked={form.schedule_type === v} onChange={() => set('schedule_type', v)} />
                      {{ daily: '每天', weekly: '每週', monthly: '每月' }[v]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 flex-wrap">
                <div>
                  <label className="label">執行時間</label>
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
                    <label className="label">星期</label>
                    <select className="input" value={form.schedule_weekday ?? 1} onChange={(e) => set('schedule_weekday', Number(e.target.value))}>
                      {WEEKDAYS.map((d, i) => <option key={i} value={i}>星期{d}</option>)}
                    </select>
                  </div>
                )}
                {form.schedule_type === 'monthly' && (
                  <div>
                    <label className="label">每月幾號</label>
                    <input type="number" min={1} max={28} className="input w-20" value={form.schedule_monthday ?? 1} onChange={(e) => set('schedule_monthday', Number(e.target.value))} />
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── AI ── */}
          {section === 'ai' && (
            <>
              <div>
                <label className="label">模型</label>
                <select className="input w-full" value={form.model ?? 'pro'} onChange={(e) => set('model', e.target.value)}>
                  {models.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">
                  Prompt *（支援變數：{'{{date}}'} {'{{weekday}}'} {'{{task_name}}'}；
                  工具引用：{'{{skill:名稱}}'}{'{{kb:名稱}}'}；
                  網頁爬取：{'{{fetch:URL}}'}）
                </label>
                <div className="relative">
                  <textarea
                    ref={promptRef}
                    className="input w-full h-36 resize-y font-mono text-xs"
                    value={form.prompt ?? ''}
                    onChange={onPromptChange}
                    onKeyDown={onPromptKeyDown}
                    onBlur={() => setTimeout(() => setAc((p) => ({ ...p, show: false })), 150)}
                    placeholder={`例：今天是 {{date}}，先查詢知識庫：\n{{kb:月報知識庫 query="{{task_name}}"}}\n請根據以上內容撰寫摘要報告。`}
                  />
                  {ac.show && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-full max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                      <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-100 flex items-center justify-between">
                        <span>
                          {ac.trigger === '/' ? '/ 選擇技能 / 知識庫' : ac.trigger === '{{skill:' ? '選擇技能' : '選擇知識庫'}
                          {ac.query && <> — 篩選：<span className="text-blue-500">{ac.query}</span></>}
                        </span>
                        <span className="text-slate-300">↑↓ Enter Esc</span>
                      </div>
                      {acItems.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-slate-400 text-center">
                          {ac.query ? `無符合「${ac.query}」的工具` : '尚無可用技能或知識庫'}
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
                            {item.type === 'skill' ? '技能' : '知識庫'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  輸入 <code className="bg-slate-100 px-1 rounded">/</code> 快速選擇工具，或前往「工具引用」頁簽插入語法。
                </p>
              </div>
              <div>
                <label className="label">輸出類型</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input type="radio" checked={form.output_type === 'text'} onChange={() => set('output_type', 'text')} />
                    純文字（不生成附件）
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input type="radio" checked={form.output_type === 'file'} onChange={() => set('output_type', 'file')} />
                    生成檔案
                  </label>
                </div>
              </div>
              {form.output_type === 'file' && (
                <div className="flex gap-3">
                  <div>
                    <label className="label">檔案格式</label>
                    <select className="input" value={form.file_type ?? 'docx'} onChange={(e) => {
                      set('file_type', e.target.value)
                      const ext = e.target.value
                      set('filename_template', `{{task_name}}_{{date}}.${ext}`)
                    }}>
                      {FILE_TYPES.map((t) => <option key={t} value={t}>{FILE_TYPE_LABELS[t] || t.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="label">檔名範本</label>
                    <input className="input w-full" value={form.filename_template ?? ''} onChange={(e) => set('filename_template', e.target.value)} placeholder="{{task_name}}_{{date}}.docx" />
                  </div>
                </div>
              )}
              {form.output_type === 'file' && form.file_type === 'mp3' && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  MP3 語音：AI 回應內容會自動透過 TTS 技能轉為語音檔。需先在管理後台設定 TTS 模型（model_role=tts）。
                </p>
              )}
            </>
          )}

          {/* ── Tools ── */}
          {section === 'tools' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                點擊「插入」將語法加入 Prompt（光標位置）。技能/知識庫在執行時會自動被呼叫並將結果注入 Prompt 中，再一起傳給 AI 分析。
              </p>

              {/* Skills */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <Zap size={13} className="text-amber-500" /> 可用技能
                </label>
                {catalog.skills.length === 0 ? (
                  <p className="text-xs text-slate-400">尚無可用技能</p>
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
                          插入
                        </button>
                        <button
                          onClick={() => insertToolRef(`{{skill:${sk.name} input=""}}`)}
                          className="shrink-0 text-xs px-2 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 transition"
                          title="帶 input 參數"
                        >
                          帶參數
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Knowledge Bases */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <BookOpen size={13} className="text-blue-500" /> 可用知識庫
                </label>
                {catalog.kbs.length === 0 ? (
                  <p className="text-xs text-slate-400">尚無可用知識庫</p>
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
                          插入
                        </button>
                        <button
                          onClick={() => insertToolRef(`{{kb:${kb.name} query=""}}`)}
                          className="shrink-0 text-xs px-2 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 transition"
                          title="帶查詢參數"
                        >
                          帶查詢
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Syntax Reference */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1">
                  <Wrench size={12} /> 語法說明
                </p>
                <div className="space-y-1 text-xs font-mono text-slate-600">
                  <p><span className="text-amber-600">{'{{skill:名稱}}'}</span> — 執行技能，以任務名稱為輸入</p>
                  <p><span className="text-amber-600">{'{{skill:名稱 input="文字"}}'}</span> — 執行技能，指定輸入文字</p>
                  <p><span className="text-blue-600">{'{{kb:名稱}}'}</span> — 查詢知識庫，以任務名稱為查詢詞</p>
                  <p><span className="text-blue-600">{'{{kb:名稱 query="查詢詞"}}'}</span> — 查詢知識庫，指定查詢詞</p>
                  <p><span className="text-slate-400">{'{{mcp:工具名}}'}</span> — MCP 工具（待支援）</p>
                  <p><span className="text-slate-400">{'{{dify:名稱}}'}</span> — Dify 知識庫（待支援）</p>
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
            />
          )}

          {/* ── Email ── */}
          {section === 'email' && (
            <>
              <div>
                <label className="label">收件人（任務擁有者的信箱會自動加入）</label>
                <div className="flex gap-2 mb-2">
                  <input
                    className="input flex-1"
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRecipient())}
                    placeholder="輸入 Email 後按 Enter"
                  />
                  <button className="btn-primary" onClick={addRecipient}>加入</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recipients.map((r) => (
                    <span key={r} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
                      {r}
                      <button onClick={() => removeRecipient(r)}><X size={10} /></button>
                    </span>
                  ))}
                  {recipients.length === 0 && <p className="text-xs text-slate-400">未設定額外收件人，僅寄給帳號信箱</p>}
                </div>
              </div>
              <div>
                <label className="label">郵件主旨（支援 {'{{date}}'} {'{{weekday}}'} {'{{task_name}}'}）</label>
                <input className="input w-full" value={form.email_subject ?? ''} onChange={(e) => set('email_subject', e.target.value)} />
              </div>
              <div>
                <label className="label">郵件內文（支援以上變數 + {'{{ai_response}}'} {'{{tools_used}}'}）</label>
                <textarea className="input w-full h-36 resize-y" value={form.email_body ?? ''} onChange={(e) => set('email_body', e.target.value)} />
                <p className="text-xs text-slate-400 mt-1">{'{{tools_used}}'} 會展開為本次呼叫的技能/知識庫清單</p>
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
          <button onClick={onClose} className="btn-ghost">取消</button>
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5">
            <Save size={14} /> {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── HistoryRow ────────────────────────────────────────────────────────────────
function HistoryRow({ taskId }: { taskId: number }) {
  const [runs, setRuns] = useState<TaskRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/scheduled-tasks/${taskId}/history?limit=10`)
      .then((r) => setRuns(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [taskId])

  if (loading) return <div className="py-3 px-6 text-sm text-slate-400">載入中...</div>
  if (runs.length === 0) return <div className="py-3 px-6 text-sm text-slate-400">尚無執行紀錄</div>

  return (
    <div className="px-6 pb-4">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-100">
            <th className="text-left py-1.5 pr-3 font-medium">時間</th>
            <th className="text-left py-1.5 pr-3 font-medium">狀態</th>
            <th className="text-left py-1.5 pr-3 font-medium">嘗試</th>
            <th className="text-left py-1.5 pr-3 font-medium">耗時</th>
            <th className="text-left py-1.5 pr-3 font-medium">工具</th>
            <th className="text-left py-1.5 pr-3 font-medium">郵件</th>
            <th className="text-left py-1.5 font-medium">AI 回應預覽</th>
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
                <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">{r.run_at?.slice(0, 16)}</td>
                <td className="py-1.5 pr-3">
                  {r.status === 'ok'
                    ? <span className="flex items-center gap-1 text-green-600"><CheckCircle size={12} /> 成功</span>
                    : <span className="flex items-center gap-1 text-red-500"><XCircle size={12} /> 失敗</span>}
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
                    ? <span className="flex items-center gap-0.5 text-blue-500"><Mail size={11} /> 已寄</span>
                    : <span className="text-slate-300">-</span>}
                </td>
                <td className="py-1.5 max-w-xs">
                  {r.status === 'fail'
                    ? <span className="text-red-500">{r.error_msg?.slice(0, 80)}</span>
                    : <span className="text-slate-600 line-clamp-2">{r.response_preview}</span>}
                  {files.map((f) => (
                    <a key={f.publicUrl} href={f.publicUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-blue-500 hover:underline mt-0.5">
                      <FileText size={10} /> {f.filename}
                    </a>
                  ))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── GlobalSettings ─────────────────────────────────────────────────────────
function GlobalSettings() {
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
      setMsg('已儲存')
      setTimeout(() => setMsg(''), 2000)
    } catch {
      setMsg('儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5 flex flex-wrap items-center gap-5">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <Settings2 size={15} className="text-blue-500" /> 全域設定
      </div>
      {/* Global toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <div
          onClick={() => { setEnabled((v) => !v); setDirty(true) }}
          className={`w-10 h-5 rounded-full transition-colors relative ${enabled ? 'bg-blue-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </div>
        <span className="text-sm text-slate-700">開放排程功能</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {enabled ? '已開放' : '已關閉'}
        </span>
      </label>
      {/* Max per user */}
      <label className="flex items-center gap-2 text-sm text-slate-700">
        每人上限
        <input
          type="number"
          min={1}
          max={100}
          value={maxPerUser}
          onChange={(e) => { setMaxPerUser(parseInt(e.target.value) || 1); setDirty(true) }}
          className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-center"
        />
        個任務
      </label>
      {/* Save */}
      <button
        onClick={save}
        disabled={!dirty || saving}
        className={`ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition
          ${dirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
      >
        <Save size={13} /> {saving ? '儲存中…' : '儲存設定'}
      </button>
      {msg && <span className="text-xs text-blue-500">{msg}</span>}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function ScheduledTasksPanel() {
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
      setMsg(err || '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const errMsg = (e: unknown) => {
    const err = e as { response?: { status?: number; data?: { error?: string } }; message?: string }
    const status = err.response?.status
    const msg = err.response?.data?.error || err.message || '未知錯誤'
    return status ? `[${status}] ${msg}` : msg
  }

  const toggle = async (t: ScheduledTask) => {
    try {
      const r = await api.post(`/scheduled-tasks/${t.id}/toggle`)
      setTasks((p) => p.map((x) => x.id === t.id ? { ...x, status: r.data.status } : x))
      flash(`已${r.data.status === 'active' ? '啟用' : '暫停'}任務「${t.name}」`)
    } catch (e) { flash(errMsg(e)) }
  }

  const runNow = async (t: ScheduledTask) => {
    if (runningIds.has(t.id)) return
    const prevRunAt = t.last_run_at
    const prevStatus = t.status
    setRunningIds((prev) => new Set(prev).add(t.id))
    try {
      await api.post(`/scheduled-tasks/${t.id}/run-now`)
      flash(`任務「${t.name}」執行中...`)
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        if (attempts > 90) { // 3 min timeout
          clearInterval(poll)
          setRunningIds((prev) => { const s = new Set(prev); s.delete(t.id); return s })
          flash('執行逾時，請手動重新整理查看結果')
          return
        }
        try {
          const r = await api.get('/scheduled-tasks')
          const updated = (r.data as ScheduledTask[]).find((x) => x.id === t.id)
          // Detect: last_run_at changed (normal completion) OR status changed (e.g. auto-paused)
          const done = updated && (
            updated.last_run_at !== prevRunAt ||
            updated.status !== prevStatus
          )
          if (done) {
            clearInterval(poll)
            setRunningIds((prev) => { const s = new Set(prev); s.delete(t.id); return s })
            setTasks(r.data)
            flash(updated!.last_run_status === 'ok'
              ? `✓ 任務「${t.name}」執行完成`
              : `✗ 任務「${t.name}」執行失敗，請查看歷史紀錄`)
            // Refresh history if already expanded
            if (expanded === t.id) {
              setExpanded(null)
              setTimeout(() => setExpanded(t.id), 100)
            }
          }
        } catch { /* ignore poll errors */ }
      }, 2000)
    } catch (e) {
      setRunningIds((prev) => { const s = new Set(prev); s.delete(t.id); return s })
      flash(errMsg(e))
    }
  }

  const del = async (t: ScheduledTask) => {
    if (!confirm(`確定刪除任務「${t.name}」及所有歷史紀錄？`)) return
    try {
      await api.delete(`/scheduled-tasks/${t.id}`)
      setTasks((p) => p.filter((x) => x.id !== t.id))
      flash('已刪除')
    } catch (e) { flash(errMsg(e)) }
  }

  const onSaved = (saved: ScheduledTask) => {
    setTasks((p) => {
      const idx = p.findIndex((x) => x.id === saved.id)
      return idx >= 0 ? p.map((x) => x.id === saved.id ? saved : x) : [saved, ...p]
    })
    setFormTask(null)
    flash(`任務「${saved.name}」已儲存`)
  }

  return (
    <div>
      {/* Global Settings (admin only) */}
      {isAdmin && <GlobalSettings />}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <CalendarClock size={20} className="text-blue-500" /> 排程任務
        </h2>
        <div className="flex gap-2">
          {msg && <span className="text-sm text-blue-600 self-center">{msg}</span>}
          <button onClick={() => load()} disabled={loading} className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新整理
          </button>
          <button onClick={() => setFormTask(emptyForm())} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> 新增任務
          </button>
        </div>
      </div>

      {/* Table */}
      {tasks.length === 0 && !loading ? (
        <p className="text-center text-slate-400 py-12 text-sm">尚無排程任務</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600 w-8"></th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">任務名稱</th>
                {isAdmin && <th className="text-left px-4 py-3 font-medium text-slate-600">執行人</th>}
                <th className="text-left px-4 py-3 font-medium text-slate-600">排程</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">上次執行</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">到期日</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">執行次數</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">狀態</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <React.Fragment key={t.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                        className="text-slate-400 hover:text-blue-500 transition"
                      >
                        {expanded === t.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{t.name}</p>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        {t.user_name
                          ? <><p className="text-sm text-slate-700">{t.user_name}</p>
                              {t.username && <p className="text-xs text-slate-400">{t.username}</p>}</>
                          : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-slate-600">
                      <span className="flex items-center gap-1">
                        <Clock size={12} className="text-slate-400" />
                        {scheduleLabel(t)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {t.last_run_at ? (
                        <span className="flex items-center gap-1">
                          {t.last_run_status === 'ok'
                            ? <CheckCircle size={13} className="text-green-500" />
                            : <XCircle size={13} className="text-red-500" />}
                          <span className="text-slate-600">{t.last_run_at.slice(0, 16)}</span>
                        </span>
                      ) : (
                        <span className="text-slate-300">尚未執行</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {t.expire_at ? t.expire_at.slice(0, 10) : <span className="text-slate-300">不限</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {t.run_count}{t.max_runs > 0 ? ` / ${t.max_runs}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      {runningIds.has(t.id) ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                          <RefreshCw size={10} className="animate-spin" /> 執行中
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          t.status === 'active' ? 'bg-green-100 text-green-700' :
                          t.status === 'paused' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {t.status === 'active' ? '啟用中' : t.status === 'paused' ? '已暫停' : '草稿'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title={runningIds.has(t.id) ? '執行中...' : '立即執行'}
                          onClick={() => runNow(t)}
                          disabled={runningIds.has(t.id)}
                          className={`p-1.5 rounded transition ${
                            runningIds.has(t.id)
                              ? 'text-green-500 cursor-not-allowed'
                              : 'hover:bg-green-50 text-slate-400 hover:text-green-600'
                          }`}
                        >
                          {runningIds.has(t.id)
                            ? <RefreshCw size={14} className="animate-spin" />
                            : <Play size={14} />}
                        </button>
                        <button title={t.status === 'active' ? '暫停' : '啟用'} onClick={() => toggle(t)}
                          className="p-1.5 rounded hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition">
                          {t.status === 'active' ? <Pause size={14} /> : <Play size={14} className="text-green-500" />}
                        </button>
                        <button title="歷史紀錄" onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                          className="p-1.5 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition">
                          <History size={14} />
                        </button>
                        <button title="編輯" onClick={() => setFormTask(t)}
                          className="p-1.5 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition">
                          <Edit2 size={14} />
                        </button>
                        <button title="刪除" onClick={() => del(t)}
                          className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === t.id && (
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <td colSpan={isAdmin ? 9 : 8} className="px-0">
                        <div className="px-4 py-2 text-xs font-medium text-slate-500 flex items-center gap-1 border-b border-slate-100">
                          <History size={12} /> 執行歷史（最近 10 筆）
                        </div>
                        <HistoryRow taskId={t.id} />
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
