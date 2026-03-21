import { useState, useRef, useEffect, useCallback } from 'react'
import {
  X, Search, GripVertical, Plus, Trash2, ChevronRight,
  Globe, Database, Loader2, CheckCircle, AlertCircle,
  Server, ChevronDown, ChevronUp, BookOpen, Paperclip,
  FileText, Image, Music, File as FileIcon, History,
  Lightbulb, Wifi, WifiOff, Clock, BarChart2, Bookmark, BookmarkCheck,
} from 'lucide-react'
import api from '../lib/api'
import { useTranslation } from 'react-i18next'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AttachedFile { name: string; path: string; mime_type: string; size?: number }

interface SubQuestion {
  id: number
  question: string
  hint?: string
  files?: AttachedFile[]      // uploaded per-SQ files
  use_web_search?: boolean
  self_kb_ids?: number[]
  dify_kb_ids?: number[]
  mcp_server_ids?: number[]
}
interface Plan {
  title: string
  objective: string
  language: string
  sub_questions: SubQuestion[]
}
interface LocalizedItem { name: string; name_zh?: string; name_en?: string; name_vi?: string }
interface KbOption   extends LocalizedItem { id: number; chunk_count?: number }
interface McpOption  extends LocalizedItem { id: number; tools_count?: number }
interface PrevJob    { id: string; title: string; completed_at: string }
interface DashboardDesignOption { id: number; name: string; description?: string; topic_name: string }
interface Resources  {
  self_kbs: KbOption[]
  dify_kbs: KbOption[]
  mcp_servers: McpOption[]
  prev_jobs: PrevJob[]
  dashboard_designs: DashboardDesignOption[]
}
interface TopicBinding {
  self_kb_ids: number[]
  dify_kb_ids: number[]
  mcp_server_ids: number[]
  dashboard_design_ids: number[]
}
interface ResearchTemplate {
  id: string
  title: string
  question?: string
  plan_json?: string
  kb_config_json?: string
  global_files_json?: string
  output_formats?: string
  model_key?: string
  created_at: string
  updated_at: string
}
interface StreamingSection { id: number; question: string; answer: string; done: boolean }

interface Props {
  sessionId: string | null
  modelKey?: string           // current session's model key — passed to research job
  initialQuestion?: string
  initialFiles?: File[]
  editJobId?: string          // edit & rerun mode: open an existing job
  onClose: () => void
  onJobCreated: (jobId: string) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const FORMAT_OPTIONS = [
  { value: 'docx', label: 'Word' },
  { value: 'pdf',  label: 'PDF'  },
  { value: 'pptx', label: 'PPT'  },
  { value: 'xlsx', label: 'Excel'},
]

const emptyBinding = (): TopicBinding => ({ self_kb_ids: [], dify_kb_ids: [], mcp_server_ids: [], dashboard_design_ids: [] })
function toggleId(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/'))  return <Image size={12} className="text-blue-400" />
  if (mime.startsWith('audio/'))  return <Music size={12} className="text-purple-400" />
  if (mime.includes('pdf'))       return <FileText size={12} className="text-red-400" />
  return <FileIcon size={12} className="text-slate-400" />
}

function formatBytes(b?: number) {
  if (!b) return ''
  if (b < 1024) return `${b}B`
  if (b < 1048576) return `${(b / 1024).toFixed(0)}KB`
  return `${(b / 1048576).toFixed(1)}MB`
}

// ── ResourceSelect ────────────────────────────────────────────────────────────

function ResourceSelect({ label, icon, options, selected, onChange, colorClass }: {
  label: string
  icon: React.ReactNode
  options: { id: number; name: string; sub?: string }[]
  selected: number[]
  onChange: (ids: number[]) => void
  colorClass: string
}) {
  if (!options.length) return null
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">{icon} {label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt.id)
          return (
            <button key={opt.id} onClick={() => onChange(toggleId(selected, opt.id))}
              className={`px-2.5 py-1 text-xs rounded-full border transition ${active ? `${colorClass} text-white border-transparent` : 'text-slate-600 border-slate-200 hover:border-slate-400 bg-white'}`}
              title={opt.sub}>
              {opt.name}{opt.sub && <span className="ml-1 opacity-70">{opt.sub}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── FileAttachArea ─────────────────────────────────────────────────────────────

function FileAttachArea({ pendingFiles, onAdd, onRemove, uploadedFiles, onRemoveUploaded, label }: {
  pendingFiles: File[]
  onAdd: (files: File[]) => void
  onRemove: (idx: number) => void
  uploadedFiles?: AttachedFile[]
  onRemoveUploaded?: (idx: number) => void
  label: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    onAdd(Array.from(e.dataTransfer.files).filter((f) => !f.type.startsWith('video/')))
  }
  const allEmpty = !pendingFiles.length && !(uploadedFiles?.length)
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
        <Paperclip size={11} /> {label}
      </p>
      {allEmpty ? (
        <div
          onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="border border-dashed border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-400 text-center cursor-pointer hover:border-blue-400 hover:text-blue-500 transition"
        >
          + Drag or click to attach files
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {(uploadedFiles || []).map((f, i) => (
            <span key={`up-${i}`} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs bg-blue-50 border border-blue-200 rounded-full text-blue-700">
              {fileIcon(f.mime_type)} {f.name.slice(0, 20)}{f.name.length > 20 ? '…' : ''}
              {onRemoveUploaded && (
                <button onClick={() => onRemoveUploaded(i)} className="text-blue-400 hover:text-red-500 ml-0.5"><X size={10} /></button>
              )}
            </span>
          ))}
          {pendingFiles.map((f, i) => (
            <span key={`pend-${i}`} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs bg-amber-50 border border-amber-200 rounded-full text-amber-700">
              {fileIcon(f.type)} {f.name.slice(0, 20)}{f.name.length > 20 ? '…' : ''} {formatBytes(f.size)}
              <button onClick={() => onRemove(i)} className="text-amber-400 hover:text-red-500 ml-0.5"><X size={10} /></button>
            </span>
          ))}
          <button onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1 pl-2 pr-2 py-0.5 text-xs border border-dashed border-slate-300 rounded-full text-slate-400 hover:text-blue-500 hover:border-blue-400 transition">
            <Plus size={10} />
          </button>
        </div>
      )}
      <input ref={inputRef} type="file" multiple className="hidden"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp"
        onChange={(e) => { onAdd(Array.from(e.target.files || []).filter((f) => !f.type.startsWith('video/'))); e.target.value = '' }} />
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ResearchModal({ sessionId, modelKey, initialQuestion = '', initialFiles = [], editJobId, onClose, onJobCreated }: Props) {
  const { t, i18n } = useTranslation()

  const localName = (item: LocalizedItem) => {
    if (i18n.language === 'en') return item.name_en || item.name
    if (i18n.language === 'vi') return item.name_vi || item.name
    return item.name_zh || item.name
  }

  // ── Step 1 state ──────────────────────────────────────────────────────────
  const [question,       setQuestion]       = useState(initialQuestion)
  const [depth,          setDepth]          = useState(5)
  const [formats,        setFormats]        = useState<string[]>(['docx'])
  const [generating,     setGenerating]     = useState(false)
  const [genError,       setGenError]       = useState('')

  // Global files
  const [globalPending,  setGlobalPending]  = useState<File[]>(initialFiles)
  const [globalUploaded, setGlobalUploaded] = useState<AttachedFile[]>([])

  // Previous research refs
  const [refJobIds,      setRefJobIds]      = useState<string[]>([])

  // Auto-suggest KB
  const [suggestedKbIds, setSuggestedKbIds] = useState<number[]>([])
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resources
  const [resources,    setResources]    = useState<Resources>({ self_kbs: [], dify_kbs: [], mcp_servers: [], prev_jobs: [], dashboard_designs: [] })
  const [resLoading,   setResLoading]   = useState(true)

  // 我的研究（templates）
  const [templates,       setTemplates]       = useState<ResearchTemplate[]>([])
  const [tmplDropOpen,    setTmplDropOpen]     = useState(false)
  const [savingTemplate,  setSavingTemplate]   = useState(false)
  const [saveTemplName,   setSaveTemplName]    = useState('')
  const [saveTemplOpen,   setSaveTemplOpen]    = useState(false)

  // Task-level binding
  const [taskBinding,  setTaskBinding]  = useState<TopicBinding>(emptyBinding())

  // ── Step 2 state ──────────────────────────────────────────────────────────
  const [plan,         setPlan]         = useState<Plan | null>(null)
  const [hasKb,        setHasKb]        = useState(false)
  const [starting,     setStarting]     = useState(false)
  const [startError,   setStartError]   = useState('')
  const [topicBindings, setTopicBindings] = useState<Record<number, TopicBinding>>({})
  const [expandedTopics, setExpandedTopics] = useState<Set<number>>(new Set())
  // Per-SQ hint + files + web
  const [sqHints,      setSqHints]      = useState<Record<number, string>>({})
  const [sqPending,    setSqPending]    = useState<Record<number, File[]>>({})
  const [sqUploaded,   setSqUploaded]   = useState<Record<number, AttachedFile[]>>({})
  const [sqWeb,        setSqWeb]        = useState<Record<number, boolean>>({})

  // ── Step 3 state ──────────────────────────────────────────────────────────
  const [jobId,        setJobId]        = useState<string | null>(null)
  const [streamSections, setStreamSections] = useState<StreamingSection[]>([])
  const [jobStatus,    setJobStatus]    = useState<string>('pending')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Edit mode state ────────────────────────────────────────────────────────
  const editMode = !!editJobId
  const [editJobLoading,   setEditJobLoading]   = useState(editMode)
  const [rerunIds,         setRerunIds]         = useState<Set<number>>(new Set())
  const [existingSections, setExistingSections] = useState<StreamingSection[]>([])
  // 是否更動過整體 KB / 全局附件設定（dirty = 需要覆蓋 job 的原始設定）
  const [rerunKbDirty,     setRerunKbDirty]     = useState(false)
  const [rerunKbExpanded,  setRerunKbExpanded]  = useState(false)

  const step = jobId ? 3 : (plan || editMode) ? 2 : 1

  // Drag-to-sort
  const dragIdx  = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  // ── Load resources ────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/research/accessible-resources')
      .then((r) => setResources({ dashboard_designs: [], ...r.data }))
      .catch(() => {})
      .finally(() => setResLoading(false))
  }, [])

  // ── Load templates ────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/research/templates').then((r) => setTemplates(r.data)).catch(() => {})
  }, [])

  // ── Load template into Step 1 ─────────────────────────────────────────────
  const loadTemplate = (tmpl: ResearchTemplate) => {
    try {
      if (tmpl.question) setQuestion(tmpl.question)
      if (tmpl.output_formats) setFormats(tmpl.output_formats.split(',').filter(Boolean))
      if (tmpl.plan_json) {
        const p: Plan = JSON.parse(tmpl.plan_json)
        setPlan(p)
        const init: Record<number, TopicBinding> = {}
        p.sub_questions?.forEach((sq: SubQuestion) => { init[sq.id] = emptyBinding() })
        setTopicBindings(init)
      }
      if (tmpl.kb_config_json) {
        const kbc = JSON.parse(tmpl.kb_config_json)
        if (kbc.task) setTaskBinding({ ...emptyBinding(), ...kbc.task })
      }
    } catch (_) {}
    setTmplDropOpen(false)
  }

  // ── Save template ─────────────────────────────────────────────────────────
  const handleSaveTemplate = async () => {
    if (!saveTemplName.trim() || !plan) return
    setSavingTemplate(true)
    try {
      const kbConfig = { task: taskBinding, topics: Object.fromEntries(
        Object.entries(topicBindings).filter(([, b]) =>
          b.self_kb_ids.length || b.dify_kb_ids.length || b.mcp_server_ids.length || b.dashboard_design_ids?.length
        )
      )}
      await api.post('/research/templates', {
        title: saveTemplName.trim(),
        question,
        plan_json: plan,
        kb_config_json: kbConfig,
        output_formats: formats.join(','),
        model_key: modelKey || null,
      })
      const r = await api.get('/research/templates')
      setTemplates(r.data)
      setSaveTemplOpen(false)
      setSaveTemplName('')
    } catch (_) {} finally {
      setSavingTemplate(false)
    }
  }

  const handleDeleteTemplate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.delete(`/research/templates/${id}`)
      setTemplates((prev) => prev.filter((t) => t.id !== id))
    } catch (_) {}
  }

  // ── Load existing job in edit mode ────────────────────────────────────────
  useEffect(() => {
    if (!editJobId) return
    api.get(`/research/jobs/${editJobId}`)
      .then((r) => {
        const j = r.data
        try {
          const p: Plan = JSON.parse(j.plan_json || '{}')
          setPlan(p)
          setHasKb(false)
          const init: Record<number, TopicBinding> = {}
          p.sub_questions?.forEach((sq: SubQuestion) => { init[sq.id] = emptyBinding() })
          setTopicBindings(init)
        } catch (_) {}
        if (j.sections_json) {
          try { setExistingSections(JSON.parse(j.sections_json)) } catch (_) {}
        }
      })
      .catch(() => {})
      .finally(() => setEditJobLoading(false))
  }, [editJobId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-suggest KB on question change ────────────────────────────────────
  useEffect(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (!question.trim() || question.length < 5) { setSuggestedKbIds([]); return }
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await api.get('/research/suggest-kbs', { params: { q: question } })
        setSuggestedKbIds(res.data.kb_ids || [])
        // Auto-select suggested KBs if user hasn't manually set any
        if (res.data.kb_ids?.length && !taskBinding.self_kb_ids.length) {
          setTaskBinding((p) => ({ ...p, self_kb_ids: res.data.kb_ids }))
        }
      } catch (_) {}
    }, 1000)
  }, [question]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Streaming poll while job running ─────────────────────────────────────
  useEffect(() => {
    if (!jobId) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/research/jobs/${jobId}`)
        const j = res.data
        setJobStatus(j.status)
        if (j.sections_json) {
          try { setStreamSections(JSON.parse(j.sections_json)) } catch (_) {}
        }
        if (j.status === 'done' || j.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch (_) {}
    }, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [jobId])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const moveItem = (from: number, to: number) => {
    if (!plan || from === to) return
    const sqs = [...plan.sub_questions]
    const [item] = sqs.splice(from, 1)
    sqs.splice(to, 0, item)
    setPlan({ ...plan, sub_questions: sqs })
  }

  const toggleFormat = (fmt: string) =>
    setFormats((prev) => prev.includes(fmt) ? (prev.length > 1 ? prev.filter((f) => f !== fmt) : prev) : [...prev, fmt])

  const toggleTopicExpand = (sqId: number) =>
    setExpandedTopics((prev) => { const n = new Set(prev); n.has(sqId) ? n.delete(sqId) : n.add(sqId); return n })

  const hasAnyResource = resources.self_kbs.length + resources.dify_kbs.length + resources.mcp_servers.length + resources.dashboard_designs.length > 0

  const bindingSummary = (binding: TopicBinding) => {
    const parts: string[] = []
    if (binding.self_kb_ids.length) parts.push(`${binding.self_kb_ids.length}KB`)
    if (binding.dify_kb_ids.length) parts.push(`${binding.dify_kb_ids.length}Dify`)
    if (binding.mcp_server_ids.length) parts.push(`${binding.mcp_server_ids.length}MCP`)
    if (binding.dashboard_design_ids?.length) parts.push(`${binding.dashboard_design_ids.length}戰情`)
    return parts.join('+')
  }

  // ── Upload files helper ───────────────────────────────────────────────────
  const uploadFiles = useCallback(async (files: File[]): Promise<AttachedFile[]> => {
    if (!files.length) return []
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    const res = await api.post('/research/upload-files', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return res.data as AttachedFile[]
  }, [])

  // ── Step 1: generate plan ─────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!question.trim()) { setGenError(t('research.errorEmpty')); return }
    setGenerating(true); setGenError('')
    try {
      const res = await api.post('/research/plan', { question: question.trim(), depth })
      setPlan(res.data.plan)
      setHasKb(res.data.has_kb)
      const init: Record<number, TopicBinding> = {}
      res.data.plan.sub_questions.forEach((sq: SubQuestion) => { init[sq.id] = emptyBinding() })
      setTopicBindings(init)
    } catch (e: any) {
      setGenError(e.response?.data?.error || t('research.errorGenFail'))
    } finally {
      setGenerating(false)
    }
  }

  // ── Step 2: start / rerun ─────────────────────────────────────────────────
  const handleStart = async () => {
    if (!plan) return
    if (editMode && rerunIds.size === 0) { setStartError(t('research.errorNoRerun')); return }
    setStarting(true); setStartError('')
    try {
      if (editMode && editJobId) {
        // ── RERUN MODE ─────────────────────────────────────────────────────
        // Upload global pending files
        let allGlobalUploaded = [...globalUploaded]
        if (globalPending.length) {
          const newUploaded = await uploadFiles(globalPending)
          allGlobalUploaded = [...allGlobalUploaded, ...newUploaded]
          setGlobalUploaded(allGlobalUploaded)
          setGlobalPending([])
        }

        // Upload per-SQ pending files for rerun IDs
        const sq_overrides = await Promise.all(
          plan.sub_questions
            .filter((sq) => rerunIds.has(sq.id))
            .map(async (sq) => {
              const pending = sqPending[sq.id] || []
              let uploaded  = sqUploaded[sq.id] || []
              if (pending.length) {
                const newUp = await uploadFiles(pending)
                uploaded = [...uploaded, ...newUp]
                setSqUploaded((p) => ({ ...p, [sq.id]: uploaded }))
                setSqPending((p) => ({ ...p, [sq.id]: [] }))
              }
              return {
                id:             sq.id,
                question:       sq.question,
                hint:           sqHints[sq.id] || undefined,
                files:          uploaded.length ? uploaded : undefined,
                use_web_search: sqWeb[sq.id] !== undefined ? sqWeb[sq.id] : undefined,
              }
            })
        )

        // 整體 KB 設定：有任何變動就覆蓋（送明確 config，不送 null，避免後端誤判為舊資料而搜尋全部KB）
        const kb_config = rerunKbDirty
          ? { task: taskBinding, topics: {} }
          : undefined

        await api.post(`/research/jobs/${editJobId}/rerun-sections`, {
          section_ids:  Array.from(rerunIds),
          sq_overrides,
          kb_config,
          global_files: rerunKbDirty ? allGlobalUploaded : undefined,
          title:        plan.title     || undefined,
          objective:    plan.objective || undefined,
        })
        // Merge rerunning sections into existing for display
        const mergedSections = [...existingSections]
        rerunIds.forEach((id) => {
          const sq = plan.sub_questions.find((s) => s.id === id)
          if (!sq) return
          const idx = mergedSections.findIndex((s) => s.id === id)
          const entry: StreamingSection = { id, question: sq.question, answer: '', done: false }
          if (idx >= 0) mergedSections[idx] = entry
          else mergedSections.push(entry)
        })
        setStreamSections(mergedSections)
        setJobId(editJobId)
        onJobCreated(editJobId)
      } else {
        // ── NEW JOB MODE ───────────────────────────────────────────────────
        let allGlobalUploaded = [...globalUploaded]
        if (globalPending.length) {
          const newUploaded = await uploadFiles(globalPending)
          allGlobalUploaded = [...allGlobalUploaded, ...newUploaded]
          setGlobalUploaded(allGlobalUploaded)
          setGlobalPending([])
        }

        const updatedSqs = await Promise.all(plan.sub_questions.map(async (sq) => {
          const pending = sqPending[sq.id] || []
          let uploaded  = sqUploaded[sq.id] || []
          if (pending.length) {
            const newUp = await uploadFiles(pending)
            uploaded = [...uploaded, ...newUp]
            setSqUploaded((p) => ({ ...p, [sq.id]: uploaded }))
            setSqPending((p) => ({ ...p, [sq.id]: [] }))
          }
          return {
            ...sq,
            hint:           sqHints[sq.id] || undefined,
            files:          uploaded.length ? uploaded : undefined,
            use_web_search: sqWeb[sq.id] !== undefined ? sqWeb[sq.id] : undefined,
            ...(topicBindings[sq.id] || {}),
          }
        }))
        const finalPlan = { ...plan, sub_questions: updatedSqs }

        const topicsConfig: Record<string, TopicBinding> = {}
        for (const [sqId, bind] of Object.entries(topicBindings)) {
          if (bind.self_kb_ids.length || bind.dify_kb_ids.length || bind.mcp_server_ids.length)
            topicsConfig[sqId] = bind
        }
        const kb_config = { task: taskBinding, topics: topicsConfig }

        const res = await api.post('/research/jobs', {
          question:       question.trim(),
          plan:           finalPlan,
          session_id:     sessionId,
          model_key:      modelKey,
          output_formats: formats.join(','),
          use_web_search: !hasKb && !kb_config && !allGlobalUploaded.length,
          kb_config,
          global_files:   allGlobalUploaded,
          ref_job_ids:    refJobIds,
        })
        setJobId(res.data.id)
        onJobCreated(res.data.id)
      }
    } catch (e: any) {
      setStartError(e.response?.data?.error || t('research.errorStartFail'))
    } finally {
      setStarting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Search size={18} className="text-blue-500" />
            <span className="font-semibold text-slate-800">{t('research.title')}</span>
            <span className="text-xs text-slate-400 ml-1">
              {step === 1 && t('research.stepQuestion')}
              {step === 2 && (editMode ? t('research.stepEditRerun') : t('research.stepPlan'))}
              {step === 3 && t('research.stepStarted')}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">

          {/* ── Step 1 ───────────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">

              {/* Question */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700">{t('research.questionLabel')}</label>
                  {templates.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setTmplDropOpen((p) => !p)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600 transition bg-white"
                      >
                        <Bookmark size={11} /> 我的研究
                        <ChevronDown size={10} />
                      </button>
                      {tmplDropOpen && (
                        <>
                        <div className="fixed inset-0 z-40" onClick={() => setTmplDropOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                          <div className="max-h-56 overflow-y-auto">
                            {templates.map((tmpl) => (
                              <div key={tmpl.id}
                                onClick={() => loadTemplate(tmpl)}
                                className="flex items-center justify-between px-3 py-2 hover:bg-blue-50 cursor-pointer group border-b border-slate-100 last:border-0">
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-slate-700 truncate">{tmpl.title}</p>
                                  <p className="text-[10px] text-slate-400">{tmpl.updated_at}</p>
                                </div>
                                <button
                                  onClick={(e) => handleDeleteTemplate(tmpl.id, e)}
                                  className="ml-2 p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <textarea
                  value={question} onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate() }}
                  rows={3} placeholder={t('research.questionPlaceholder')}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Global file attachment */}
              <FileAttachArea
                pendingFiles={globalPending}
                onAdd={(files) => setGlobalPending((p) => [...p, ...files])}
                onRemove={(i) => setGlobalPending((p) => p.filter((_, j) => j !== i))}
                uploadedFiles={globalUploaded}
                onRemoveUploaded={(i) => setGlobalUploaded((p) => p.filter((_, j) => j !== i))}
                label={t('research.globalFilesLabel')}
              />

              {/* Depth */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('research.depthLabel')}<span className="text-blue-600 font-semibold">{depth} {t('research.depthUnit')}</span>
                </label>
                <input type="range" min={2} max={12} value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="w-full accent-blue-600" />
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>{t('research.depthFast')}</span>
                  <span>{t('research.depthNormal')}</span>
                  <span>{t('research.depthDeep')}</span>
                  <span>{t('research.depthFull')}</span>
                </div>
              </div>

              {/* Output format */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">{t('research.outputFormat')}</label>
                <div className="flex flex-wrap gap-2">
                  {FORMAT_OPTIONS.map((opt) => (
                    <button key={opt.value} onClick={() => toggleFormat(opt.value)}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition ${formats.includes(opt.value) ? 'bg-blue-600 text-white border-blue-600' : 'text-slate-600 border-slate-300 hover:border-blue-400'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Task-level resources + auto-suggest */}
              {!resLoading && hasAnyResource && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">{t('research.taskSourceTitle')}</p>
                    {suggestedKbIds.length > 0 && (
                      <span className="text-xs text-amber-600 flex items-center gap-1">
                        <Lightbulb size={11} />{t('research.autoSuggestLabel')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{t('research.taskSourceHint')}</p>
                  <ResourceSelect
                    label={t('research.selfKbLabel')} icon={<Database size={11} />}
                    options={resources.self_kbs.map((k) => ({
                      id: k.id, name: localName(k),
                      sub: k.chunk_count ? t('research.chunksSuffix', { n: k.chunk_count }) : undefined,
                    }))}
                    selected={taskBinding.self_kb_ids}
                    onChange={(ids) => setTaskBinding((p) => ({ ...p, self_kb_ids: ids }))}
                    colorClass="bg-blue-600"
                  />
                  <ResourceSelect
                    label={t('research.difyKbLabel')} icon={<BookOpen size={11} />}
                    options={resources.dify_kbs.map((k) => ({ id: k.id, name: localName(k) }))}
                    selected={taskBinding.dify_kb_ids}
                    onChange={(ids) => setTaskBinding((p) => ({ ...p, dify_kb_ids: ids }))}
                    colorClass="bg-violet-600"
                  />
                  <ResourceSelect
                    label={t('research.mcpLabel')} icon={<Server size={11} />}
                    options={resources.mcp_servers.map((m) => ({
                      id: m.id, name: localName(m),
                      sub: m.tools_count ? t('research.toolsSuffix', { n: m.tools_count }) : undefined,
                    }))}
                    selected={taskBinding.mcp_server_ids}
                    onChange={(ids) => setTaskBinding((p) => ({ ...p, mcp_server_ids: ids }))}
                    colorClass="bg-emerald-600"
                  />
                  <ResourceSelect
                    label="AI 戰情" icon={<BarChart2 size={11} />}
                    options={resources.dashboard_designs.map((d) => ({
                      id: d.id, name: d.name, sub: d.topic_name,
                    }))}
                    selected={taskBinding.dashboard_design_ids ?? []}
                    onChange={(ids) => setTaskBinding((p) => ({ ...p, dashboard_design_ids: ids }))}
                    colorClass="bg-orange-500"
                  />
                </div>
              )}

              {/* Previous research refs */}
              {resources.prev_jobs.length > 0 && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
                  <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    <History size={14} className="text-indigo-500" />
                    {t('research.prevResearchLabel')}
                  </p>
                  <p className="text-xs text-slate-400">{t('research.prevResearchHint')}</p>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {resources.prev_jobs.map((j) => {
                      const selected = refJobIds.includes(j.id)
                      return (
                        <button key={j.id} onClick={() => setRefJobIds((p) => p.includes(j.id) ? p.filter((x) => x !== j.id) : [...p, j.id])}
                          className={`px-2.5 py-1 text-xs rounded-full border transition flex items-center gap-1 ${selected ? 'bg-indigo-600 text-white border-transparent' : 'text-slate-600 border-slate-200 hover:border-indigo-400 bg-white'}`}>
                          <Clock size={9} />
                          <span className="max-w-[160px] truncate">{j.title}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {genError && (
                <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle size={14} /> {genError}
                </div>
              )}
            </div>
          )}

          {/* ── Edit mode loading ────────────────────────────────────────── */}
          {step === 2 && editMode && editJobLoading && (
            <div className="flex items-center justify-center py-12 gap-3 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">{t('research.editLoading')}</span>
            </div>
          )}

          {/* ── Step 2 ───────────────────────────────────────────────────── */}
          {step === 2 && plan && !editJobLoading && (
            <div className="space-y-4">
              {/* Plan summary — edit mode 可直接編輯 title / objective */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
                <p className="text-xs text-slate-500 uppercase tracking-wide">{t('research.planTitle')}</p>
                {editMode ? (
                  <>
                    <input
                      value={plan.title}
                      onChange={e => setPlan(p => p ? { ...p, title: e.target.value } : p)}
                      className="w-full text-base font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="研究主題"
                    />
                    <textarea
                      value={plan.objective}
                      onChange={e => setPlan(p => p ? { ...p, objective: e.target.value } : p)}
                      rows={2}
                      className="w-full text-sm text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="研究方向 / 目標（選填）"
                    />
                  </>
                ) : (
                  <>
                    <p className="text-base font-semibold text-slate-800">{plan.title}</p>
                    <p className="text-sm text-slate-500">{plan.objective}</p>
                  </>
                )}
              </div>

              {/* ── Edit mode：整體設定覆蓋（全局附件 + Task KB）────────────── */}
              {editMode && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition text-left"
                    onClick={() => setRerunKbExpanded(p => !p)}
                  >
                    <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
                      <Database size={14} className="text-blue-500" />
                      整體設定（全局附件 / 資料來源）
                      {rerunKbDirty && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">已修改</span>}
                    </span>
                    {rerunKbExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                  </button>

                  {rerunKbExpanded && (
                    <div className="p-4 space-y-4 border-t border-slate-100">
                      <p className="text-xs text-slate-400">修改後將覆蓋原研究的全局設定，僅影響本次重新研究的子問題。</p>

                      {/* 全局附件 */}
                      <FileAttachArea
                        pendingFiles={globalPending}
                        onAdd={(files) => { setGlobalPending(p => [...p, ...files]); setRerunKbDirty(true) }}
                        onRemove={(i) => setGlobalPending(p => p.filter((_, j) => j !== i))}
                        uploadedFiles={globalUploaded}
                        onRemoveUploaded={(i) => { setGlobalUploaded(p => p.filter((_, j) => j !== i)); setRerunKbDirty(true) }}
                        label={t('research.globalFilesLabel')}
                      />

                      {/* Task-level KB */}
                      {!resLoading && hasAnyResource && (
                        <div className="space-y-2">
                          <ResourceSelect
                            label={t('research.selfKbLabel')} icon={<Database size={11} />}
                            options={resources.self_kbs.map((k) => ({ id: k.id, name: localName(k), sub: k.chunk_count ? t('research.chunksSuffix', { n: k.chunk_count }) : undefined }))}
                            selected={taskBinding.self_kb_ids}
                            onChange={(ids) => { setTaskBinding((p) => ({ ...p, self_kb_ids: ids })); setRerunKbDirty(true) }}
                            colorClass="bg-blue-600"
                          />
                          <ResourceSelect
                            label={t('research.difyKbLabel')} icon={<BookOpen size={11} />}
                            options={resources.dify_kbs.map((k) => ({ id: k.id, name: localName(k) }))}
                            selected={taskBinding.dify_kb_ids}
                            onChange={(ids) => { setTaskBinding((p) => ({ ...p, dify_kb_ids: ids })); setRerunKbDirty(true) }}
                            colorClass="bg-violet-600"
                          />
                          <ResourceSelect
                            label={t('research.mcpLabel')} icon={<Server size={11} />}
                            options={resources.mcp_servers.map((m) => ({ id: m.id, name: localName(m) }))}
                            selected={taskBinding.mcp_server_ids}
                            onChange={(ids) => { setTaskBinding((p) => ({ ...p, mcp_server_ids: ids })); setRerunKbDirty(true) }}
                            colorClass="bg-emerald-600"
                          />
                          <ResourceSelect
                            label="AI 戰情" icon={<BarChart2 size={11} />}
                            options={resources.dashboard_designs.map((d) => ({ id: d.id, name: d.name, sub: d.topic_name }))}
                            selected={taskBinding.dashboard_design_ids ?? []}
                            onChange={(ids) => { setTaskBinding((p) => ({ ...p, dashboard_design_ids: ids })); setRerunKbDirty(true) }}
                            colorClass="bg-orange-500"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Global files & sources summary */}
              <div className="flex flex-wrap gap-2">
                {(globalUploaded.length + globalPending.length) > 0 && (
                  <div className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">
                    <Paperclip size={11} />
                    {t('research.globalFilesSummary', { n: globalUploaded.length + globalPending.length })}
                  </div>
                )}
                {refJobIds.length > 0 && (
                  <div className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700">
                    <History size={11} />
                    {t('research.prevRefSummary', { n: refJobIds.length })}
                  </div>
                )}
                {bindingSummary(taskBinding) && (
                  <div className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700">
                    <Database size={11} />
                    {t('research.taskBindingSummary', { summary: bindingSummary(taskBinding) })}
                  </div>
                )}
                {!bindingSummary(taskBinding) && !globalUploaded.length && !globalPending.length && (
                  <div className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg ${hasKb ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-blue-50 border border-blue-200 text-blue-700'}`}>
                    {hasKb ? <><Database size={11} />{t('research.usingKb')}</> : <><Globe size={11} />{t('research.usingWeb')}</>}
                  </div>
                )}
              </div>

              {/* Sub-questions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-700">{t('research.subQuestionsLabel')}</p>
                  {plan.sub_questions.length < 12 && (
                    <button
                      onClick={() => {
                        const newId = Date.now()
                        setPlan({ ...plan, sub_questions: [...plan.sub_questions, { id: newId, question: '' }] })
                        setTopicBindings((p) => ({ ...p, [newId]: emptyBinding() }))
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                      <Plus size={13} /> {t('research.addSubQuestion')}
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {plan.sub_questions.map((sq, i) => {
                    const topicBind   = topicBindings[sq.id] || emptyBinding()
                    const summary     = bindingSummary(topicBind)
                    const expanded    = expandedTopics.has(sq.id)
                    const sqFileCount = (sqPending[sq.id]?.length || 0) + (sqUploaded[sq.id]?.length || 0)
                    const isRerun     = editMode && rerunIds.has(sq.id)
                    const existingSec = editMode ? existingSections.find((s) => s.id === sq.id) : null

                    return (
                      <div key={sq.id} draggable={!editMode}
                        onDragStart={() => { if (!editMode) dragIdx.current = i }}
                        onDragOver={(e) => { e.preventDefault(); if (!editMode) setDragOver(i) }}
                        onDrop={() => { if (!editMode && dragIdx.current !== null) { moveItem(dragIdx.current, i); dragIdx.current = null; setDragOver(null) } }}
                        onDragEnd={() => { dragIdx.current = null; setDragOver(null) }}
                        className={`border rounded-xl transition ${
                          editMode
                            ? isRerun
                              ? 'border-orange-300 bg-orange-50'
                              : 'border-slate-200 bg-white opacity-70'
                            : dragOver === i ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'
                        }`}>

                        {/* SQ header row */}
                        <div className="flex items-start gap-2 p-3">
                          {!editMode && <GripVertical size={16} className="text-slate-300 mt-0.5 cursor-grab flex-shrink-0" />}
                          <span className="text-xs font-semibold text-blue-500 mt-0.5 w-5 flex-shrink-0">{i + 1}</span>
                          <input
                            value={sq.question}
                            onChange={(e) => {
                              if (editMode && !isRerun) return
                              const sqs = [...plan.sub_questions]
                              sqs[i] = { ...sqs[i], question: e.target.value }
                              setPlan({ ...plan, sub_questions: sqs })
                            }}
                            readOnly={editMode && !isRerun}
                            className={`flex-1 text-sm text-slate-700 outline-none bg-transparent ${editMode && !isRerun ? 'cursor-default' : ''}`}
                          />
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {/* Edit mode: rerun toggle */}
                            {editMode && (
                              <button
                                title={isRerun ? t('research.sqKeepOld') : t('research.sqMarkRerun')}
                                onClick={() => setRerunIds((prev) => {
                                  const n = new Set(prev)
                                  n.has(sq.id) ? n.delete(sq.id) : n.add(sq.id)
                                  return n
                                })}
                                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition ${
                                  isRerun ? 'bg-orange-500 text-white border-transparent' : 'border-slate-200 text-slate-400 hover:border-orange-400 hover:text-orange-500'
                                }`}>
                                {isRerun ? '↺ 重跑' : '保留'}
                              </button>
                            )}
                            {!editMode && (
                              <>
                                {/* Web toggle */}
                                <button
                                  title={t('research.sqWebToggle')}
                                  onClick={() => setSqWeb((p) => ({ ...p, [sq.id]: !p[sq.id] }))}
                                  className={`p-1 rounded transition ${sqWeb[sq.id] ? 'text-blue-500' : 'text-slate-300 hover:text-slate-500'}`}>
                                  {sqWeb[sq.id] ? <Wifi size={13} /> : <WifiOff size={13} />}
                                </button>
                                {/* Source + expand */}
                                <button onClick={() => toggleTopicExpand(sq.id)}
                                  className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition ${(summary || sqFileCount) ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-slate-200 text-slate-400 hover:text-slate-600'}`}>
                                  <Database size={10} />
                                  {summary || (sqFileCount ? `${sqFileCount}f` : t('research.sourceBtn'))}
                                  {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                </button>
                                {plan.sub_questions.length > 2 && (
                                  <button onClick={() => {
                                    setPlan({ ...plan, sub_questions: plan.sub_questions.filter((_, j) => j !== i) })
                                    setTopicBindings((p) => { const n = { ...p }; delete n[sq.id]; return n })
                                  }} className="text-slate-300 hover:text-red-400"><Trash2 size={14} /></button>
                                )}
                              </>
                            )}
                            {/* Edit mode rerun: also show expand for hint/files */}
                            {editMode && isRerun && (
                              <button onClick={() => toggleTopicExpand(sq.id)}
                                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition ${expanded ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-slate-200 text-slate-400 hover:text-slate-600'}`}>
                                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Edit mode: existing answer preview (when NOT rerun) */}
                        {editMode && !isRerun && existingSec?.answer && (
                          <div className="px-4 pb-3">
                            <p className="text-xs text-slate-400 line-clamp-2 whitespace-pre-wrap">
                              {existingSec.answer.slice(0, 200)}{existingSec.answer.length > 200 ? '…' : ''}
                            </p>
                          </div>
                        )}

                        {/* Expanded: hint + files + KB binding */}
                        {expanded && (isRerun || !editMode) && (
                          <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50 rounded-b-xl">
                            {/* Hint */}
                            <div>
                              <label className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
                                <Lightbulb size={11} /> {t('research.sqHintLabel')}
                              </label>
                              <input
                                value={sqHints[sq.id] || ''}
                                onChange={(e) => setSqHints((p) => ({ ...p, [sq.id]: e.target.value }))}
                                placeholder={t('research.sqHintPlaceholder')}
                                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </div>

                            {/* Per-SQ file attachment */}
                            <FileAttachArea
                              pendingFiles={sqPending[sq.id] || []}
                              onAdd={(files) => setSqPending((p) => ({ ...p, [sq.id]: [...(p[sq.id] || []), ...files] }))}
                              onRemove={(fi) => setSqPending((p) => ({ ...p, [sq.id]: (p[sq.id] || []).filter((_, j) => j !== fi) }))}
                              uploadedFiles={sqUploaded[sq.id]}
                              onRemoveUploaded={(fi) => setSqUploaded((p) => ({ ...p, [sq.id]: (p[sq.id] || []).filter((_, j) => j !== fi) }))}
                              label={t('research.sqFilesLabel')}
                            />

                            {/* KB/Dify/MCP per SQ */}
                            {hasAnyResource && (
                              <>
                                <p className="text-xs text-slate-400">{t('research.topicSourceLabel')}</p>
                                <ResourceSelect label={t('research.selfKbLabel')} icon={<Database size={11} />}
                                  options={resources.self_kbs.map((k) => ({ id: k.id, name: localName(k) }))}
                                  selected={topicBind.self_kb_ids}
                                  onChange={(ids) => setTopicBindings((p) => ({ ...p, [sq.id]: { ...topicBind, self_kb_ids: ids } }))}
                                  colorClass="bg-blue-600" />
                                <ResourceSelect label={t('research.difyKbLabel')} icon={<BookOpen size={11} />}
                                  options={resources.dify_kbs.map((k) => ({ id: k.id, name: localName(k) }))}
                                  selected={topicBind.dify_kb_ids}
                                  onChange={(ids) => setTopicBindings((p) => ({ ...p, [sq.id]: { ...topicBind, dify_kb_ids: ids } }))}
                                  colorClass="bg-violet-600" />
                                <ResourceSelect label={t('research.mcpLabel')} icon={<Server size={11} />}
                                  options={resources.mcp_servers.map((m) => ({ id: m.id, name: localName(m) }))}
                                  selected={topicBind.mcp_server_ids}
                                  onChange={(ids) => setTopicBindings((p) => ({ ...p, [sq.id]: { ...topicBind, mcp_server_ids: ids } }))}
                                  colorClass="bg-emerald-600" />
                                <ResourceSelect label="AI 戰情" icon={<BarChart2 size={11} />}
                                  options={resources.dashboard_designs.map((d) => ({ id: d.id, name: d.name, sub: d.topic_name }))}
                                  selected={topicBind.dashboard_design_ids ?? []}
                                  onChange={(ids) => setTopicBindings((p) => ({ ...p, [sq.id]: { ...topicBind, dashboard_design_ids: ids } }))}
                                  colorClass="bg-orange-500" />
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {startError && (
                <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle size={14} /> {startError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: streaming preview ─────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 py-2">
                {jobStatus === 'done'
                  ? <CheckCircle size={22} className="text-green-500 flex-shrink-0" />
                  : jobStatus === 'failed'
                    ? <AlertCircle size={22} className="text-red-500 flex-shrink-0" />
                    : <Loader2 size={22} className="animate-spin text-blue-500 flex-shrink-0" />
                }
                <div>
                  <p className="text-base font-semibold text-slate-800">
                    {jobStatus === 'done'   ? t('research.successTitle')
                     : jobStatus === 'failed' ? t('research.failedTitle')
                     : t('research.progressTitle')}
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {jobStatus === 'done' ? t('research.successMsg1') : t('research.progressHint')}
                  </p>
                </div>
              </div>

              {/* Streaming sections */}
              {streamSections.length > 0 && (
                <div className="space-y-2">
                  {streamSections.map((sec, i) => (
                    <div key={sec.id || i} className={`border rounded-xl transition ${sec.done ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="flex items-center gap-2 px-4 py-2">
                        {sec.done
                          ? <CheckCircle size={13} className="text-green-500 flex-shrink-0" />
                          : <Loader2 size={13} className="animate-spin text-blue-400 flex-shrink-0" />}
                        <span className="text-xs font-medium text-slate-700 truncate">{sec.question}</span>
                      </div>
                      {sec.done && sec.answer && (
                        <div className="px-4 pb-3">
                          <p className="text-xs text-slate-500 line-clamp-3 whitespace-pre-wrap">{sec.answer.slice(0, 300)}{sec.answer.length > 300 ? '…' : ''}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {jobStatus === 'done' && (
                <p className="text-sm text-slate-500">{t('research.successMsg2')}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
          {step === 1 && (
            <>
              <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">{t('research.cancel')}</button>
              <button onClick={handleGenerate} disabled={generating || !question.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition">
                {generating
                  ? <><Loader2 size={15} className="animate-spin" /> {t('research.generating')}</>
                  : <>{t('research.generateBtn')} <ChevronRight size={15} /></>}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              {editMode
                ? <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">{t('research.cancel')}</button>
                : <button onClick={() => setPlan(null)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">{t('research.backBtn')}</button>
              }
              <div className="flex items-center gap-3">
                {editMode && rerunIds.size > 0 && (
                  <span className="text-xs text-orange-600">{t('research.rerunCount', { n: rerunIds.size })}</span>
                )}
                {/* 存為我的研究 */}
                {!editMode && plan && (
                  <div className="relative">
                    <button
                      onClick={() => { setSaveTemplName(plan.title || ''); setSaveTemplOpen((p) => !p) }}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600 transition"
                      title="存為我的研究">
                      <BookmarkCheck size={13} />
                    </button>
                    {saveTemplOpen && (
                      <div className="absolute bottom-full right-0 mb-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-50 space-y-2">
                        <p className="text-xs font-medium text-slate-600">存為我的研究</p>
                        <input
                          value={saveTemplName}
                          onChange={(e) => setSaveTemplName(e.target.value)}
                          placeholder="輸入名稱"
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTemplate() }}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button onClick={handleSaveTemplate} disabled={savingTemplate || !saveTemplName.trim()}
                            className="flex-1 text-xs py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
                            {savingTemplate ? '儲存中...' : '儲存'}
                          </button>
                          <button onClick={() => setSaveTemplOpen(false)}
                            className="px-2 text-xs text-slate-400 hover:text-slate-600">取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={handleStart}
                  disabled={starting || !plan || (!editMode && plan.sub_questions.some((sq) => !sq.question.trim())) || (editMode && rerunIds.size === 0)}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition">
                  {starting
                    ? <><Loader2 size={15} className="animate-spin" /> {t('research.starting')}</>
                    : editMode
                      ? <>{t('research.rerunBtn')} <ChevronRight size={15} /></>
                      : <>{t('research.startBtn')} <ChevronRight size={15} /></>
                  }
                </button>
              </div>
            </>
          )}
          {step === 3 && (
            <button onClick={onClose}
              className="ml-auto px-5 py-2 bg-slate-100 text-slate-700 text-sm rounded-xl hover:bg-slate-200 transition">
              {t('research.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
