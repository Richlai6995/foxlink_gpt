import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Globe, RefreshCw, Check, AlertTriangle, Loader2,
  Languages, Play, CheckCircle, XCircle, Square, Cpu,
  Pencil, X, Save, Clock,
} from 'lucide-react'
import api from '../../lib/api'
import { getIcon } from '../HelpBlockRenderer'

interface TransInfo {
  title: string
  sidebarLabel: string
  translatedAt: string | null
}

interface SectionStatus {
  id: string
  sectionType: string
  sortOrder: number
  icon: string
  iconColor: string
  lastModified: string
  translations: Record<string, TransInfo>
  linkedCourseId?: number | null
  linkedLessonId?: number | null
  linkedCourseTitle?: string | null
  linkedLessonTitle?: string | null
}

interface CourseOption {
  id: number
  title: string
  lessons?: { id: number; title: string }[]
}

interface LlmModelOption {
  key: string
  name: string
  api_model: string
  provider_type?: string
}

// SSE progress event from server
interface TranslationProgress {
  sectionId: string
  status: 'translating' | 'done' | 'error' | 'aborted' | 'pending'
  error?: string
  index: number
  total: number
  chunk?: number
  totalChunks?: number
}

const ALL_LANGS = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Tiếng Việt' },
]
const TARGET_LANGS = ALL_LANGS.filter(l => l.code !== 'zh-TW')

export default function HelpTranslationPanel() {
  const { t } = useTranslation()
  const [sections, setSections] = useState<SectionStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set())
  const [batchLang, setBatchLang] = useState<string>('en')
  const [batchTranslating, setBatchTranslating] = useState(false)
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string }>>({})

  // SSE progress tracking
  const [progressMap, setProgressMap] = useState<Record<string, TranslationProgress>>({})
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  // Track which section IDs + lang are in the current batch (for "waiting" display)
  const [batchQueueKeys, setBatchQueueKeys] = useState<Set<string>>(new Set())

  // Single section translating
  const [translating, setTranslating] = useState<Record<string, boolean>>({})

  // Model selection
  const [models, setModels] = useState<LlmModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('flash')

  // Abort support
  const batchJobIdRef = useRef<string | null>(null)
  const singleJobIdRef = useRef<Record<string, string>>({})
  const knownErrorsRef = useRef<Set<string>>(new Set())

  // Course linking
  const [courses, setCourses] = useState<CourseOption[]>([])
  const [linkingSection, setLinkingSection] = useState<string | null>(null)
  const [linkCourseId, setLinkCourseId] = useState<number | null>(null)
  const [linkLessonId, setLinkLessonId] = useState<number | null>(null)
  const [linkLessons, setLinkLessons] = useState<{ id: number; title: string }[]>([])
  const [linkSaving, setLinkSaving] = useState(false)

  // Edit modal
  const [editModal, setEditModal] = useState<{
    sectionId: string
    lang: string
    title: string
    sidebarLabel: string
    blocksJson: string
  } | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/help/admin/status')
      const list = Array.isArray(res.data) ? res.data : (res.data?.sections ?? [])
      setSections(list)
    } catch (err) {
      console.error('Failed to fetch help status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchModels = useCallback(async () => {
    try {
      const res = await api.get('/admin/llm-models')
      const chatModels = (res.data as LlmModelOption[]).filter(
        (m: any) => m.is_active && (!m.model_role || m.model_role === 'chat')
      )
      setModels(chatModels)
      if (chatModels.length > 0 && !chatModels.find(m => m.key === selectedModel)) {
        setSelectedModel(chatModels[0].key)
      }
    } catch (err) {
      console.error('Failed to fetch models:', err)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchModels()
    // Fetch courses for linking
    api.get('/training/courses', { params: { my_only: '1' } })
      .then(res => setCourses(res.data))
      .catch(() => {})
  }, [fetchStatus, fetchModels])

  function isOutdated(section: SectionStatus, lang: string): boolean {
    const trans = section.translations[lang]
    if (!trans?.translatedAt) return true
    return trans.translatedAt < section.lastModified
  }

  function countOutdated(lang: string): number {
    return sections.filter(s => s.sectionType === 'user' && isOutdated(s, lang)).length
  }

  function genJobId() {
    return `help-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  async function handleSeed() {
    try {
      setSeeding(true)
      await api.post('/help/admin/seed')
      await fetchStatus()
    } catch (err) {
      console.error('Seed failed:', err)
    } finally {
      setSeeding(false)
    }
  }

  // ── Polling-based translate (shared for single & batch) ─────────────────────

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ACTIVE_JOB_KEY = 'help_translate_active_job'

  function saveActiveJob(jobId: string, targetLang: string, sectionIds: string[]) {
    sessionStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, targetLang, sectionIds }))
  }

  function clearActiveJob() {
    sessionStorage.removeItem(ACTIVE_JOB_KEY)
  }

  /**
   * Poll translation progress via DB status (multi-pod safe).
   * Checks isOutdated() from help_translations table — works regardless of which pod
   * handles the request. Falls back to in-memory progress endpoint every 4th poll
   * for error detection.
   */
  function startPolling(jobId: string, targetLang: string, sectionIds: string[], onDone: () => void) {
    if (pollingRef.current) clearInterval(pollingRef.current)

    const queueKeys = new Set(sectionIds.map(id => `${id}-${targetLang}`))
    setBatchQueueKeys(queueKeys)
    setBatchTranslating(true)
    knownErrorsRef.current = new Set()

    let lastDoneCount = 0
    let lastChangeTime = Date.now()
    let pollCount = 0
    const STALL_TIMEOUT = 5 * 60 * 1000 // 5 min without new completions → give up

    const poll = setInterval(async () => {
      pollCount++
      try {
        // Primary: check DB status (reliable across all pods)
        const res = await api.get('/help/admin/status')
        const allSections: SectionStatus[] = Array.isArray(res.data)
          ? res.data
          : (res.data?.sections ?? [])
        setSections(allSections)

        const newProgress: Record<string, TranslationProgress> = {}
        const newResults: Record<string, { ok: boolean; error?: string }> = {}
        let doneCount = 0
        let foundCurrent = false

        for (let i = 0; i < sectionIds.length; i++) {
          const secId = sectionIds[i]
          const key = `${secId}-${targetLang}`
          const sec = allSections.find(s => s.id === secId)
          const stillOutdated = !sec || isOutdated(sec, targetLang)
          const hasError = knownErrorsRef.current.has(secId)

          if (!stillOutdated) {
            // Section is now up-to-date in DB → translation succeeded
            doneCount++
            newProgress[key] = { sectionId: secId, status: 'done', index: i, total: sectionIds.length }
            newResults[key] = { ok: true }
          } else if (hasError) {
            // Known error from in-memory check
            doneCount++
            newProgress[key] = { sectionId: secId, status: 'error' as any, index: i, total: sectionIds.length }
          } else if (!foundCurrent) {
            // First still-outdated section → currently being translated
            foundCurrent = true
            newProgress[key] = { sectionId: secId, status: 'translating', index: i, total: sectionIds.length }
          } else {
            // After current → waiting
            newProgress[key] = { sectionId: secId, status: 'pending', index: i, total: sectionIds.length }
          }
        }

        setProgressMap(prev => ({ ...prev, ...newProgress }))
        setResults(prev => ({ ...prev, ...newResults }))
        setBatchProgress({ current: doneCount, total: sectionIds.length })

        // Track stall
        if (doneCount > lastDoneCount) {
          lastDoneCount = doneCount
          lastChangeTime = Date.now()
        }

        // All sections accounted for → done
        if (doneCount === sectionIds.length) {
          clearInterval(poll)
          pollingRef.current = null
          clearActiveJob()
          onDone()
          return
        }

        // Every 4th poll (~10s): best-effort check in-memory progress for errors / job done
        if (pollCount % 4 === 0) {
          try {
            const pRes = await api.get(`/help/admin/translate/progress/${jobId}`)
            if (pRes.data.found) {
              for (const [secId, info] of Object.entries(pRes.data.sections as Record<string, any>)) {
                if (info.status === 'error') {
                  knownErrorsRef.current.add(secId)
                  const key = `${secId}-${targetLang}`
                  setResults(prev => ({ ...prev, [key]: { ok: false, error: info.error || 'Error' } }))
                }
              }
              if (pRes.data.done) {
                clearInterval(poll)
                pollingRef.current = null
                clearActiveJob()
                onDone()
                return
              }
            }
          } catch { /* best-effort, ignore cross-pod failures */ }
        }

        // Stall detection: no new completions for 5 minutes
        if (Date.now() - lastChangeTime > STALL_TIMEOUT) {
          console.warn('[HelpTranslation] Stall detected after 5 min, stopping')
          clearInterval(poll)
          pollingRef.current = null
          clearActiveJob()
          onDone()
        }
      } catch (err) {
        console.error('[HelpTranslation] Poll error:', err)
      }
    }, 2500)

    pollingRef.current = poll
  }

  async function startTranslateJob(
    sectionIds: string[],
    targetLang: string,
    jobId: string,
    onDone: () => void,
  ) {
    saveActiveJob(jobId, targetLang, sectionIds)

    // Set UI state immediately (before await) so button changes right away
    const queueKeys = new Set(sectionIds.map(id => `${id}-${targetLang}`))
    setBatchQueueKeys(queueKeys)
    setBatchTranslating(true)

    try {
      // Await POST so server registers the job before we start polling
      await api.post('/help/admin/translate', {
        sectionIds,
        targetLang,
        modelKey: selectedModel,
        jobId,
      })
    } catch (err) {
      console.error('Failed to start translate job:', err)
      clearActiveJob()
      setBatchTranslating(false)
      setBatchProgress(null)
      setBatchQueueKeys(new Set())
      onDone()
      return
    }

    // Server has registered the job; start polling
    startPolling(jobId, targetLang, sectionIds, onDone)
  }

  // On mount: resume polling if there's an active job from a previous visit
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(ACTIVE_JOB_KEY)
      if (!saved) return
      const { jobId, targetLang, sectionIds } = JSON.parse(saved)
      if (!jobId) return
      console.log(`[HelpTranslation] Resuming polling for job ${jobId}`)
      batchJobIdRef.current = jobId
      startPolling(jobId, targetLang, sectionIds, () => {
        setBatchTranslating(false)
        setBatchProgress(null)
        setBatchQueueKeys(new Set())
        batchJobIdRef.current = null
        fetchStatus()
      })
    } catch { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling on unmount (but don't clear sessionStorage — job continues on server)
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // ── Single section translate ─────────────────────────────────────────────────

  function handleTranslate(sectionId: string, lang: string) {
    const key = `${sectionId}-${lang}`
    const jobId = genJobId()
    singleJobIdRef.current[key] = jobId
    setTranslating(prev => ({ ...prev, [key]: true }))
    setResults(prev => { const n = { ...prev }; delete n[key]; return n })

    startTranslateJob([sectionId], lang, jobId, () => {
      setTranslating(prev => ({ ...prev, [key]: false }))
      delete singleJobIdRef.current[key]
      fetchStatus()
    })
  }

  async function handleAbortSingle(sectionId: string, lang: string) {
    const key = `${sectionId}-${lang}`
    const jobId = singleJobIdRef.current[key]
    if (jobId) {
      await api.post('/help/admin/translate/abort', { jobId }).catch(() => {})
    }
  }

  // ── Batch translate ──────────────────────────────────────────────────────────

  function handleBatchTranslate() {
    const ids = sections
      .filter(s => s.sectionType === 'user' && selectedSections.has(s.id) && isOutdated(s, batchLang))
      .map(s => s.id)
    if (ids.length === 0) return

    const jobId = genJobId()
    batchJobIdRef.current = jobId
    setBatchProgress({ current: 0, total: ids.length })
    // Clear old progress/results for these sections
    const queueKeys = new Set(ids.map(id => `${id}-${batchLang}`))
    setProgressMap(prev => {
      const n = { ...prev }
      for (const k of queueKeys) delete n[k]
      return n
    })
    setResults(prev => {
      const n = { ...prev }
      for (const k of queueKeys) delete n[k]
      return n
    })

    startTranslateJob(ids, batchLang, jobId, () => {
      setBatchTranslating(false)
      setBatchProgress(null)
      setBatchQueueKeys(new Set())
      batchJobIdRef.current = null
      setSelectedSections(new Set())
      fetchStatus()
    })
  }

  async function handleAbortBatch() {
    const jobId = batchJobIdRef.current
    if (jobId) {
      await api.post('/help/admin/translate/abort', { jobId }).catch(() => {})
      clearActiveJob()
    }
  }

  function selectAllOutdated(lang: string) {
    const ids = sections
      .filter(s => s.sectionType === 'user' && isOutdated(s, lang))
      .map(s => s.id)
    setSelectedSections(new Set(ids))
    setBatchLang(lang)
  }

  // ── Edit modal helpers ───────────────────────────────────────────────────────

  async function openEditModal(sectionId: string, lang: string) {
    try {
      const res = await api.get(`/help/admin/sections/${sectionId}`)
      const data = res.data
      const trans = data.translations?.[lang]
      setEditModal({
        sectionId,
        lang,
        title: trans?.title || '',
        sidebarLabel: trans?.sidebarLabel || '',
        blocksJson: trans?.blocks ? JSON.stringify(trans.blocks, null, 2) : '[]',
      })
    } catch (err) {
      console.error('Failed to load section for edit:', err)
    }
  }

  async function handleEditSave() {
    if (!editModal) return
    const { sectionId, lang, title, sidebarLabel, blocksJson } = editModal

    let blocks: any[]
    try {
      blocks = JSON.parse(blocksJson)
    } catch {
      alert('blocks JSON 格式錯誤')
      return
    }

    // Override warning: if translation was done by LLM, warn about overwrite
    const section = sections.find(s => s.id === sectionId)
    if (lang !== 'zh-TW' && section?.translations[lang]?.translatedAt) {
      if (!confirm(`此段落已有 ${lang} 翻譯 (${section.translations[lang].translatedAt})，手動編輯將覆蓋 LLM 翻譯。確定儲存？`)) {
        return
      }
    }

    try {
      setEditSaving(true)
      await api.put(`/help/admin/sections/${sectionId}/translations/${lang}`, {
        title,
        sidebarLabel,
        blocks,
      })
      setEditModal(null)
      await fetchStatus()
    } catch (err) {
      console.error('Edit save failed:', err)
      alert('儲存失敗')
    } finally {
      setEditSaving(false)
    }
  }

  const userSections = sections.filter(s => s.sectionType === 'user')
  const currentModelName = models.find(m => m.key === selectedModel)?.name || selectedModel

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-500" size={24} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Languages size={22} className="text-blue-500" />
          <h2 className="text-lg font-bold text-slate-800">說明文件翻譯管理</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-700 transition disabled:opacity-50"
          >
            {seeding ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {seeding ? '匯入中...' : '重新匯入 zh-TW 種子資料'}
          </button>
          <button
            onClick={fetchStatus}
            className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-700 transition"
          >
            <RefreshCw size={14} />
            重新整理
          </button>
        </div>
      </div>

      {/* Model selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Cpu size={16} className="text-indigo-500" />
          <span className="font-medium">翻譯模型</span>
        </div>
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white min-w-[200px]"
        >
          {models.map(m => (
            <option key={m.key} value={m.key}>
              {m.name} ({m.api_model})
            </option>
          ))}
          {models.length === 0 && (
            <option value="flash">Gemini Flash (預設)</option>
          )}
        </select>
        <span className="text-xs text-slate-400">
          翻譯時使用的 LLM 模型，建議用 Flash 類以節省成本
        </span>
      </div>

      {/* Language summary cards */}
      <div className="grid grid-cols-2 gap-4">
        {TARGET_LANGS.map(lang => {
          const outdated = countOutdated(lang.code)
          const total = userSections.length
          const translated = total - outdated
          return (
            <div key={lang.code} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Globe size={16} className="text-blue-500" />
                  <span className="font-semibold text-slate-700">{lang.label}</span>
                </div>
                <button
                  onClick={() => selectAllOutdated(lang.code)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                  disabled={outdated === 0}
                >
                  選取全部過期段落 ({outdated})
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-100 rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full transition-all"
                    style={{ width: `${total > 0 ? (translated / total) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm text-slate-500">{translated}/{total}</span>
              </div>
              {outdated > 0 && (
                <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  {outdated} 個段落需要更新翻譯
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Batch action bar */}
      {selectedSections.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-blue-700 flex items-center gap-2 flex-wrap">
              <span>已選取 <strong>{selectedSections.size}</strong> 個段落</span>
              <span>·</span>
              <span>語言：</span>
              <select
                value={batchLang}
                onChange={e => setBatchLang(e.target.value)}
                className="px-2 py-1 border border-blue-300 rounded-lg text-sm bg-white"
              >
                {TARGET_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <span>·</span>
              <span>模型：<strong>{currentModelName}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedSections(new Set())}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
              >
                取消選取
              </button>
              {batchTranslating ? (
                <button
                  onClick={handleAbortBatch}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition"
                >
                  <Square size={14} />
                  終止翻譯
                </button>
              ) : (
                <button
                  onClick={handleBatchTranslate}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition"
                >
                  <Play size={14} />
                  批次翻譯
                </button>
              )}
            </div>
          </div>
          {/* Batch progress bar */}
          {batchTranslating && batchProgress && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-blue-600 mb-1">
                <span>翻譯進度</span>
                <span>{batchProgress.current} / {batchProgress.total}</span>
              </div>
              <div className="bg-blue-100 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section list */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="w-8 px-3 py-3">
                <input
                  type="checkbox"
                  checked={selectedSections.size === userSections.length && userSections.length > 0}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedSections(new Set(userSections.map(s => s.id)))
                    } else {
                      setSelectedSections(new Set())
                    }
                  }}
                  className="rounded"
                />
              </th>
              <th className="text-left px-3 py-3 font-semibold text-slate-600">段落</th>
              <th className="text-center px-3 py-3 font-semibold text-slate-600">zh-TW 修改日期</th>
              {TARGET_LANGS.map(l => (
                <th key={l.code} className="text-center px-3 py-3 font-semibold text-slate-600">
                  {l.label}
                </th>
              ))}
              <th className="text-center px-3 py-3 font-semibold text-slate-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {userSections.map(section => (
              <tr key={section.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selectedSections.has(section.id)}
                    onChange={e => {
                      const next = new Set(selectedSections)
                      if (e.target.checked) next.add(section.id)
                      else next.delete(section.id)
                      setSelectedSections(next)
                    }}
                    className="rounded"
                  />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`${section.iconColor} flex-shrink-0`}>
                      {getIcon(section.icon, 'sm')}
                    </span>
                    <div className="flex-1">
                      <div className="font-medium text-slate-700">
                        {section.translations['zh-TW']?.title || section.id}
                      </div>
                      <div className="text-xs text-slate-400">{section.id}</div>
                      {/* Course Link badge or edit */}
                      {linkingSection === section.id ? (
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          <select value={linkCourseId || ''} onChange={async e => {
                            const cid = e.target.value ? Number(e.target.value) : null
                            setLinkCourseId(cid)
                            setLinkLessonId(null)
                            if (cid) {
                              try {
                                const res = await api.get(`/training/courses/${cid}`)
                                setLinkLessons(res.data.lessons || [])
                              } catch { setLinkLessons([]) }
                            } else { setLinkLessons([]) }
                          }} className="text-[11px] border rounded px-1.5 py-0.5 max-w-[160px]">
                            <option value="">-- 無 --</option>
                            {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                          </select>
                          {linkCourseId && linkLessons.length > 0 && (
                            <select value={linkLessonId || ''} onChange={e => setLinkLessonId(e.target.value ? Number(e.target.value) : null)}
                              className="text-[11px] border rounded px-1.5 py-0.5 max-w-[140px]">
                              <option value="">全部章節</option>
                              {linkLessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                            </select>
                          )}
                          <button onClick={async () => {
                            setLinkSaving(true)
                            try {
                              await api.put(`/help/admin/sections/${section.id}/link`, { linked_course_id: linkCourseId, linked_lesson_id: linkLessonId })
                              await fetchStatus()
                              setLinkingSection(null)
                            } catch (e) { console.error(e) }
                            finally { setLinkSaving(false) }
                          }} disabled={linkSaving} className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded hover:bg-blue-600 disabled:opacity-50">
                            {linkSaving ? '...' : '儲存'}
                          </button>
                          <button onClick={() => setLinkingSection(null)} className="text-[10px] text-slate-400 hover:text-slate-600">取消</button>
                        </div>
                      ) : (
                        <button onClick={() => {
                          setLinkingSection(section.id)
                          setLinkCourseId(section.linkedCourseId || null)
                          setLinkLessonId(section.linkedLessonId || null)
                          if (section.linkedCourseId) {
                            api.get(`/training/courses/${section.linkedCourseId}`).then(res => setLinkLessons(res.data.lessons || [])).catch(() => setLinkLessons([]))
                          }
                        }} className="mt-1 text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-0.5 text-left"
                          title={section.linkedCourseId ? `#${section.linkedCourseId}${section.linkedLessonId ? ` / #${section.linkedLessonId}` : ''}` : ''}
                        >
                          🎓 {section.linkedCourseId
                            ? (section.linkedCourseTitle
                                ? `${section.linkedCourseTitle}${section.linkedLessonTitle ? ` › ${section.linkedLessonTitle}` : ''}`
                                : `已綁定 #${section.linkedCourseId}`)
                            : '綁定教材'}
                        </button>
                      )}
                    </div>
                  </div>
                </td>
                <td className="text-center px-3 py-3 text-slate-500 font-mono text-xs">
                  {section.lastModified}
                </td>
                {TARGET_LANGS.map(lang => {
                  const trans = section.translations[lang.code]
                  const outdated = isOutdated(section, lang.code)
                  const key = `${section.id}-${lang.code}`
                  const result = results[key]
                  const isTranslating = translating[key]
                  const progress = progressMap[key]
                  const inQueue = batchQueueKeys.has(key)
                  const pStatus = typeof progress?.status === 'string' ? progress.status : ''
                  // Determine display state
                  const isActive = isTranslating || pStatus === 'translating'
                  const isDone = pStatus === 'done' || result?.ok === true
                  const isFailed = pStatus.startsWith('error') || pStatus === 'aborted' || result?.ok === false
                  const isWaiting = inQueue && !isActive && !isDone && !isFailed && (pStatus === '' || pStatus === 'pending')

                  return (
                    <td key={lang.code} className="text-center px-3 py-3">
                      {isActive ? (() => {
                        const ch = progress?.chunk ?? 0
                        const tc = progress?.totalChunks ?? 1
                        const pct = tc > 1 ? Math.round((ch / tc) * 100) : null
                        return (
                        <div className="flex flex-col items-center gap-1 min-w-[80px]">
                          <div className="flex items-center gap-1">
                            <Loader2 size={13} className="animate-spin text-blue-500" />
                            <span className="text-xs text-blue-500">
                              翻譯中{pct !== null ? ` ${pct}%` : ''}
                            </span>
                            <button
                              onClick={() => handleAbortSingle(section.id, lang.code)}
                              className="text-red-400 hover:text-red-600 ml-0.5"
                              title="終止"
                            >
                              <Square size={10} />
                            </button>
                          </div>
                          {pct !== null && (
                            <div className="w-full bg-blue-100 rounded-full h-1.5">
                              <div
                                className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </div>
                        )
                      })() : isWaiting ? (
                        <div className="flex items-center justify-center gap-1">
                          <Clock size={13} className="text-slate-400 animate-pulse" />
                          <span className="text-xs text-slate-400">等待中</span>
                        </div>
                      ) : isDone ? (
                        <div className="flex items-center justify-center gap-1">
                          <CheckCircle size={14} className="text-green-500" />
                          <span className="text-xs text-green-600 font-semibold">完成</span>
                        </div>
                      ) : isFailed ? (
                        <div className="flex items-center justify-center gap-1" title={result?.error || pStatus}>
                          <XCircle size={14} className="text-red-500" />
                          <span className="text-xs text-red-500">
                            {result?.error === 'Aborted' || pStatus === 'aborted' ? '已終止' : '失敗'}
                          </span>
                        </div>
                      ) : !trans?.translatedAt ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : outdated ? (
                        <div className="flex items-center justify-center gap-1">
                          <AlertTriangle size={12} className="text-amber-500" />
                          <span className="text-xs text-amber-600 font-mono">{trans.translatedAt}</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <CheckCircle size={12} className="text-green-500" />
                          <span className="text-xs text-green-600 font-mono">{trans.translatedAt}</span>
                        </div>
                      )}
                    </td>
                  )
                })}
                <td className="text-center px-3 py-3">
                  <div className="flex items-center justify-center gap-1">
                    {/* Edit button */}
                    <button
                      onClick={() => openEditModal(section.id, 'zh-TW')}
                      className="p-1 text-slate-400 hover:text-blue-600 rounded transition"
                      title="編輯"
                    >
                      <Pencil size={13} />
                    </button>
                    {/* Translate buttons per lang */}
                    {TARGET_LANGS.map(lang => {
                      const key = `${section.id}-${lang.code}`
                      const outdated = isOutdated(section, lang.code)
                      return outdated ? (
                        <button
                          key={lang.code}
                          onClick={() => handleTranslate(section.id, lang.code)}
                          disabled={!!translating[key]}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs transition disabled:opacity-50"
                          title={`翻譯為 ${lang.label}`}
                        >
                          {translating[key] ? '...' : lang.code.toUpperCase()}
                        </button>
                      ) : (
                        <span key={lang.code} className="px-2 py-1 text-xs text-green-600">
                          <Check size={12} />
                        </span>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {userSections.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Globe size={32} className="mx-auto mb-3 opacity-50" />
            <p>尚未匯入說明文件資料</p>
            <p className="text-xs mt-1">請點選「重新匯入 zh-TW 種子資料」按鈕</p>
          </div>
        )}
      </div>

      {/* ── Edit Modal ──────────────────────────────────────────────────────── */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <Pencil size={18} className="text-blue-500" />
                <h3 className="text-base font-bold text-slate-800">
                  編輯翻譯 — {editModal.sectionId}
                </h3>
                {/* Lang tabs */}
                <div className="flex gap-1 ml-4">
                  {ALL_LANGS.map(l => (
                    <button
                      key={l.code}
                      onClick={() => openEditModal(editModal.sectionId, l.code)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                        editModal.lang === l.code
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {editModal.lang === 'zh-TW' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  編輯 zh-TW 內容將自動更新修改日期，en/vi 翻譯將標記為過期
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">標題 (title)</label>
                <input
                  type="text"
                  value={editModal.title}
                  onChange={e => setEditModal({ ...editModal, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">側邊欄標籤 (sidebarLabel)</label>
                <input
                  type="text"
                  value={editModal.sidebarLabel}
                  onChange={e => setEditModal({ ...editModal, sidebarLabel: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  區塊內容 (blocks JSON)
                </label>
                <textarea
                  value={editModal.blocksJson}
                  onChange={e => setEditModal({ ...editModal, blocksJson: e.target.value })}
                  rows={20}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono leading-5"
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <button
                onClick={() => setEditModal(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
              >
                取消
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition disabled:opacity-50"
              >
                {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                儲存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
