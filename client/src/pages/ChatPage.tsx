import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Square, AlertTriangle, Share2, Copy, Check, X, Sparkles, Search, Plus, Plug, Zap, Database, CheckCircle, BarChart3, ChevronDown, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Sidebar from '../components/Sidebar'
import ChatWindow from '../components/ChatWindow'
import MessageInput, { type MessageInputHandle } from '../components/MessageInput'
import ResearchModal from '../components/ResearchModal'
import type { ChatSession, ChatMessage, ModelType, GeneratedFile } from '../types'
import api from '../lib/api'
import { copyText } from '../lib/clipboard'
import { useAuth } from '../context/AuthContext'

export default function ChatPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()

  const localName = (item: any) => {
    if (i18n.language === 'en') return item.name_en || item.name
    if (i18n.language === 'vi') return item.name_vi || item.name
    return item.name_zh || item.name
  }
  const localDesc = (item: any) => {
    if (i18n.language === 'en') return item.desc_en || item.description
    if (i18n.language === 'vi') return item.desc_vi || item.description
    return item.desc_zh || item.description
  }
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [model, setModel] = useState<ModelType>(
    () => (localStorage.getItem('model') as ModelType) || 'pro'
  )
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingStatus, setStreamingStatus] = useState('')
  const abortRef = useRef<(() => void) | null>(null)
  const wasAbortedRef = useRef(false)
  const messageInputRef = useRef<MessageInputHandle>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)
  const dragSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Share modal state
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  // ── Deep Research state ────────────────────────────────────────────────────
  const [showResearchModal, setShowResearchModal] = useState(false)
  const [researchInitialQuestion, setResearchInitialQuestion] = useState('')
  const [researchInitialFiles,    setResearchInitialFiles]    = useState<File[]>([])
  const [researchBanner,   setResearchBanner]   = useState<{ id: string; title: string }[]>([])
  const seenResearchIds = useRef<Set<string>>(new Set())

  const canResearch = (user as any)?.effective_can_deep_research === true
  const { canUseDashboard, isAdmin } = useAuth()

  // ── AI 戰情快速入口 ─────────────────────────────────────────────────────────
  interface DashTopic { id: number; name: string; designs: { id: number; name: string }[] }
  const [dashTopics, setDashTopics] = useState<DashTopic[]>([])
  const [showDashPanel, setShowDashPanel] = useState(false)
  const dashPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!canUseDashboard && !isAdmin) return
    api.get('/dashboard/topics').then((r) => setDashTopics(r.data || [])).catch(() => {})
  }, [canUseDashboard, isAdmin])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dashPanelRef.current && !dashPanelRef.current.contains(e.target as Node)) setShowDashPanel(false)
    }
    if (showDashPanel) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDashPanel])

  // ── Skill panel state ──────────────────────────────────────────────────────
  interface Skill { id: number; name: string; icon: string; description: string; type: string; model_key?: string | null }
  const [sessionSkills, setSessionSkills] = useState<Skill[]>([])       // currently attached
  const [allSkills, setAllSkills] = useState<Skill[]>([])               // available to pick
  const [showSkillPanel, setShowSkillPanel] = useState(false)
  const [skillSearch, setSkillSearch] = useState('')
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set())    // draft selection
  const [skillSaving, setSkillSaving] = useState(false)
  const [pendingSkillIds, setPendingSkillIds] = useState<Set<number>>(new Set())
  const skillPanelRef = useRef<HTMLDivElement>(null)

  // ── Explicit tool selection panels ────────────────────────────────────────
  interface ToolItem { id: number | string; name: string; description: string | null; is_active?: number; chunk_count?: number }
  const [selectedMcpIds,  setSelectedMcpIds]  = useState<Set<number>>(new Set())
  const [selectedDifyIds, setSelectedDifyIds] = useState<Set<number>>(new Set())
  const [selectedKbIds,   setSelectedKbIds]   = useState<Set<string>>(new Set())
  const [showMcpPanel,    setShowMcpPanel]    = useState(false)
  const [showDifyPanel,   setShowDifyPanel]   = useState(false)
  const [showKbPanel,     setShowKbPanel]     = useState(false)
  const [allMcpServers,   setAllMcpServers]   = useState<ToolItem[]>([])
  const [allDifyKbs,      setAllDifyKbs]      = useState<ToolItem[]>([])
  const [allSelfKbs,      setAllSelfKbs]      = useState<ToolItem[]>([])
  const mcpPanelRef      = useRef<HTMLDivElement>(null)
  const difyPanelRef     = useRef<HTMLDivElement>(null)
  const kbPanelRef       = useRef<HTMLDivElement>(null)
  const researchPanelRef = useRef<HTMLDivElement>(null)

  const [researchJobs,       setResearchJobs]       = useState<any[]>([])
  const [showResearchPanel,  setShowResearchPanel]  = useState(false)
  const [editRerunJobId,     setEditRerunJobId]     = useState<string | null>(null)

  const openMcpPanel = useCallback(async () => {
    try { const r = await api.get('/mcp-servers'); setAllMcpServers((r.data || []).filter((s: any) => s.is_active)) } catch {}
    setShowMcpPanel(true); setShowDifyPanel(false); setShowKbPanel(false)
  }, [])
  const openDifyPanel = useCallback(async () => {
    try { const r = await api.get('/dify-kb'); setAllDifyKbs((r.data || []).filter((k: any) => k.is_active)) } catch {}
    setShowDifyPanel(true); setShowMcpPanel(false); setShowKbPanel(false)
  }, [])
  const openKbPanel = useCallback(async () => {
    try { const r = await api.get('/kb'); setAllSelfKbs((r.data || []).filter((k: any) => (k.chunk_count ?? 0) > 0)) } catch {}
    setShowKbPanel(true); setShowMcpPanel(false); setShowDifyPanel(false)
  }, [])

  // Close tool panels on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (mcpPanelRef.current      && !mcpPanelRef.current.contains(e.target as Node))      setShowMcpPanel(false)
      if (difyPanelRef.current     && !difyPanelRef.current.contains(e.target as Node))     setShowDifyPanel(false)
      if (kbPanelRef.current       && !kbPanelRef.current.contains(e.target as Node))       setShowKbPanel(false)
      if (researchPanelRef.current && !researchPanelRef.current.contains(e.target as Node)) setShowResearchPanel(false)
    }
    if (showMcpPanel || showDifyPanel || showKbPanel || showResearchPanel) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMcpPanel, showDifyPanel, showKbPanel, showResearchPanel])

  interface BudgetPeriod { limit: number; spent: number; remaining: number; exceeded: boolean }
  interface BudgetInfo { isAdmin: boolean; daily: BudgetPeriod | null; weekly: BudgetPeriod | null; monthly: BudgetPeriod | null }
  const [budget, setBudget] = useState<BudgetInfo | null>(null)

  const loadBudget = useCallback(async () => {
    try {
      const res = await api.get('/chat/budget', { validateStatus: (s) => (s >= 200 && s < 300) || s === 401 })
      if (res.status === 200) setBudget(res.data)
    } catch { }
  }, [])

  const resetDragState = useCallback(() => {
    dragCounter.current = 0
    setIsDraggingOver(false)
    if (dragSafetyTimer.current) {
      clearTimeout(dragSafetyTimer.current)
      dragSafetyTimer.current = null
    }
  }, [])

  const startSafetyTimer = useCallback(() => {
    if (dragSafetyTimer.current) clearTimeout(dragSafetyTimer.current)
    dragSafetyTimer.current = setTimeout(() => {
      console.log('[Drag] Safety timer fired — resetting overlay')
      resetDragState()
    }, 2000)
  }, [resetDragState])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      dragCounter.current++
      setIsDraggingOver(true)
      startSafetyTimer()
    }
  }, [startSafetyTimer])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current--
    if (dragCounter.current <= 0) {
      resetDragState()
    }
  }, [resetDragState])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (isDraggingOver) startSafetyTimer()
  }, [isDraggingOver, startSafetyTimer])

  const handlePageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    resetDragState()
    if (files.length > 0 && messageInputRef.current) {
      messageInputRef.current.addFiles(files)
    }
  }, [resetDragState])

  const loadSessions = useCallback(async () => {
    try {
      // validateStatus: treat 401 as non-error to prevent auto-logout on dev server restart
      const res = await api.get('/chat/sessions', { validateStatus: (s) => (s >= 200 && s < 300) || s === 401 })
      if (res.status === 200) setSessions(res.data)
    } catch (e) {
      console.error('Load sessions error:', e)
    }
  }, [])

  const loadSession = useCallback(async (id: string) => {
    try {
      const res = await api.get(`/chat/sessions/${id}`)
      setCurrentSessionId(id)
      setMessages(res.data.messages || [])
      const attached: Skill[] = res.data.skills || []
      setSessionSkills(attached)
      setPickedIds(new Set(attached.map((s: Skill) => s.id)))
      // Sync model selector to the session's model (important for image-gen sessions)
      if (res.data.session?.model) {
        setModel(res.data.session.model as ModelType)
      }
    } catch (e) {
      console.error('Load session error:', e)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadSessions()
    loadBudget()
  }, [loadSessions, loadBudget])

  const initialResearchLoad = useRef(true)
  // Poll all research jobs every 5 s (for top-bar panel + completion banner)
  useEffect(() => {
    if (!canResearch) return
    const poll = async () => {
      try {
        const res = await api.get('/research/jobs')
        const all: any[] = res.data || []
        setResearchJobs(all)
        if (initialResearchLoad.current) {
          // First load: mark all existing done jobs as seen so they don't trigger banner
          all.filter((j) => j.status === 'done').forEach((j) => seenResearchIds.current.add(j.id))
          initialResearchLoad.current = false
          return
        }
        // Banner: only newly completed jobs (not seen before)
        const done = all.filter((j) => j.status === 'done' && !seenResearchIds.current.has(j.id))
        if (done.length > 0) {
          done.forEach((j) => seenResearchIds.current.add(j.id))
          setResearchBanner((prev) => [...prev, ...done])
        }
      } catch { /* ignore */ }
    }
    poll()
    const t = setInterval(poll, 5000)
    return () => clearInterval(t)
  }, [canResearch])

  // Auto-select session from ?session= query param (e.g., after fork)
  useEffect(() => {
    const sessionParam = searchParams.get('session')
    if (sessionParam) {
      loadSession(sessionParam)
      loadSessions() // refresh sidebar so forked session appears
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams, loadSession, loadSessions])

  // Auto-mount skill from ?skillId= param (e.g., from Skill Market "use" button)
  useEffect(() => {
    const skillIdParam = searchParams.get('skillId')
    if (!skillIdParam) return
    setSearchParams({}, { replace: true })
      ; (async () => {
        try {
          // Create a new session
          const defaultTitle = t('sidebar.newChat')
          const res = await api.post('/chat/sessions', { model, title: defaultTitle })
          const newSessionId: string = res.data.id
          setSessions(prev => [{
            id: newSessionId, title: defaultTitle, model,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }, ...prev])
          setCurrentSessionId(newSessionId)
          setMessages([])
          // Mount the skill
          await api.put(`/chat/sessions/${newSessionId}/skills`, { skill_ids: [Number(skillIdParam)] })
          // Reload to get skill info
          const sessionRes = await api.get(`/chat/sessions/${newSessionId}`)
          const attached: Skill[] = sessionRes.data.skills || []
          setSessionSkills(attached)
          setPickedIds(new Set(attached.map((s: Skill) => s.id)))
          await loadSessions()
        } catch (e) {
          console.error('Auto-mount skill error:', e)
        }
      })()
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleShare = useCallback(async () => {
    if (!currentSessionId || sharing) return
    setSharing(true)
    try {
      const r = await api.post('/share', { sessionId: currentSessionId })
      setShareLink(`${window.location.origin}/share/${r.data.token}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      alert(err.response?.data?.error || '分享失敗')
    } finally {
      setSharing(false)
    }
  }, [currentSessionId, sharing])

  const handleCopyShareLink = () => {
    if (!shareLink) return
    copyText(shareLink).catch(() => { })
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  const handleNewChat = useCallback(() => {
    // Lazy session creation: don't touch the DB until the first message is sent.
    // This prevents empty sessions from cluttering the sidebar history.
    setCurrentSessionId(null)
    setMessages([])
    setPendingSkillIds(new Set())
  }, [])

  const handleSelectSession = useCallback(
    (id: string) => {
      if (id !== currentSessionId) {
        loadSession(id)
      }
    },
    [currentSessionId, loadSession]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (!confirm('確定要刪除這個對話嗎？')) return
      try {
        await api.delete(`/chat/sessions/${id}`)
        setSessions((prev) => prev.filter((s) => s.id !== id))
        if (currentSessionId === id) {
          setCurrentSessionId(null)
          setMessages([])
        }
      } catch (e) {
        console.error('Delete session error:', e)
      }
    },
    [currentSessionId]
  )

  const handleModelChange = useCallback((m: ModelType) => {
    setModel(m)
    localStorage.setItem('model', m)
  }, [])

  // ── Skill panel helpers ────────────────────────────────────────────────────
  const openSkillPanel = useCallback(async () => {
    try {
      const res = await api.get('/skills')
      setAllSkills(res.data)
    } catch { }
    setSkillSearch('')
    setShowSkillPanel(true)
  }, [])

  const saveSkills = useCallback(async () => {
    if (!currentSessionId) {
      // No session yet — store as pending, show in UI from allSkills
      setPendingSkillIds(new Set(pickedIds))
      const pending = allSkills.filter(s => pickedIds.has(s.id))
      setSessionSkills(pending)
      setShowSkillPanel(false)
      return
    }
    setSkillSaving(true)
    try {
      await api.put(`/chat/sessions/${currentSessionId}/skills`, { skill_ids: [...pickedIds] })
      const res = await api.get(`/chat/sessions/${currentSessionId}`)
      const attached: Skill[] = res.data.skills || []
      setSessionSkills(attached)
      setPickedIds(new Set(attached.map((s: Skill) => s.id)))
      setShowSkillPanel(false)
    } catch (e: any) {
      alert(e.response?.data?.error || '儲存失敗')
    } finally {
      setSkillSaving(false)
    }
  }, [currentSessionId, pickedIds, allSkills])

  const togglePick = (id: number) => setPickedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (skillPanelRef.current && !skillPanelRef.current.contains(e.target as Node)) {
        setShowSkillPanel(false)
      }
    }
    if (showSkillPanel) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSkillPanel])

  const handleSend = useCallback(
    async (message: string, files: File[]) => {
      if (streaming) return

      // Create session if none
      let sessionId = currentSessionId
      if (!sessionId) {
        try {
          const defaultTitle = t('sidebar.newChat')
          const res = await api.post('/chat/sessions', { model, title: defaultTitle })
          sessionId = res.data.id
          const newSession: ChatSession = {
            id: res.data.id,
            title: defaultTitle,
            model,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          setSessions((prev) => [newSession, ...prev])
          setCurrentSessionId(sessionId)
          // Apply pending skills to the new session
          if (pendingSkillIds.size > 0) {
            try {
              await api.put(`/chat/sessions/${sessionId}/skills`, { skill_ids: [...pendingSkillIds] })
              setPendingSkillIds(new Set())
            } catch { }
          }
        } catch (e) {
          console.error('Create session error:', e)
          return
        }
      }

      // Add user message to UI
      const userMsg: ChatMessage = {
        id: Date.now(),
        session_id: sessionId!,
        role: 'user',
        content: message,
        files: files.map((f) => ({ name: f.name, type: 'document' as const })),
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])
      setStreaming(true)
      setStreamingContent('')
      wasAbortedRef.current = false

      // Build FormData
      const formData = new FormData()
      formData.append('message', message)
      formData.append('model', model)
      files.forEach((f) => formData.append('files', f))
      // Explicit tool selection — always send even if empty (tells backend to skip auto-discover)
      formData.append('mcp_server_ids', JSON.stringify([...selectedMcpIds]))
      formData.append('dify_kb_ids',    JSON.stringify([...selectedDifyIds]))
      formData.append('self_kb_ids',    JSON.stringify([...selectedKbIds]))

      // ── AbortController 在 fetch 之前設好，停止按鈕可立即生效 ──
      const controller = new AbortController()
      abortRef.current = () => {
        wasAbortedRef.current = true
        controller.abort()
      }

      // SSE via fetch
      const token = localStorage.getItem('token')
      let accText = ''
      const generatedFiles: GeneratedFile[] = []
      const stripGenerateBlocks = (t: string) =>
        t.replace(/```generate_[a-z]+:[^\n]+\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()

      console.log('[SSE-DEBUG] fetch start', { sessionId, hasToken: !!token, signalAborted: controller.signal.aborted })
      const fetchT0 = Date.now()

      try {
        const response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          signal: controller.signal,
        })

        console.log('[SSE-DEBUG] response received', { status: response.status, ok: response.ok, elapsed: Date.now() - fetchT0 })

        if (!response.ok) {
          let errMsg = `HTTP ${response.status}`
          try {
            const body = await response.json()
            errMsg = body.error || errMsg
          } catch { }
          throw new Error(errMsg)
        }

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let streamDone = false
        let streamError = ''

        console.log('[SSE-DEBUG] reader created, starting read loop')

        while (!streamDone) {
          let readResult: { done: boolean; value?: Uint8Array }
          try {
            readResult = await reader.read()
          } catch (readErr) {
            console.log('[SSE-DEBUG] reader.read() threw:', readErr)
            // AbortError：controller.abort() 在讀取中被呼叫
            break
          }
          const { done, value } = readResult
          if (done || wasAbortedRef.current) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (event.type === 'chunk') {
                accText += event.content
                // 避免 O(n²): 串流中不跑完整 regex，只截去 generate block 起始點之後的內容
                const genIdx = accText.indexOf('```generate_')
                setStreamingContent(genIdx >= 0 ? accText.slice(0, genIdx).trimEnd() : accText)
                // 偵測到 generate block 時立即顯示等待提示，不等 server status event
                setStreamingStatus(genIdx >= 0 ? '正在產生文件，請稍候...' : '')
              } else if (event.type === 'status') {
                setStreamingStatus(event.message || '')
              } else if (event.type === 'title') {
                setSessions((prev) => prev.map((s) => s.id === sessionId ? {
                  ...s,
                  title:    event.title    || s.title,
                  title_zh: event.title_zh || s.title_zh,
                  title_en: event.title_en || s.title_en,
                  title_vi: event.title_vi || s.title_vi,
                } : s))
              } else if (event.type === 'generated_files') {
                generatedFiles.push(...event.files)
              } else if (event.type === 'error') {
                streamError = event.message || '發生錯誤'
                streamDone = true
                break
              } else if (event.type === 'done') {
                streamDone = true
                break
              }
            } catch (_) { }
          }
        }

        // Add AI message to UI
        const aiMsg: ChatMessage = {
          id: Date.now() + 1,
          session_id: sessionId!,
          role: 'assistant',
          content: streamError
            ? `⚠️ ${streamError}`
            : wasAbortedRef.current
              ? stripGenerateBlocks(accText) + (accText ? '\n\n*（已由使用者中止）*' : '（已中止）')
              : stripGenerateBlocks(accText),
          generated_files: generatedFiles.length > 0 ? generatedFiles : undefined,
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, aiMsg])

        // Update session title + budget (fire-and-forget — no await to avoid
        // an async gap between setMessages and the finally block's setStreaming(false),
        // which could cause React to process them in separate batches)
        loadSessions()
        loadBudget()
      } catch (e) {
        if (wasAbortedRef.current) {
          // 使用者主動中止（fetch 尚未開始就按停止）
          const aiMsg: ChatMessage = {
            id: Date.now() + 1,
            session_id: sessionId!,
            role: 'assistant',
            content: accText
              ? stripGenerateBlocks(accText) + '\n\n*（已由使用者中止）*'
              : '（已中止）',
            created_at: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, aiMsg])
        } else {
          console.error('Send error:', e)
          const errDetail = e instanceof Error ? e.message : String(e)
          const errMsg: ChatMessage = {
            id: Date.now() + 1,
            session_id: sessionId!,
            role: 'assistant',
            content: `⚠️ 發生錯誤：${errDetail}`,
            created_at: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, errMsg])
        }
      } finally {
        setStreaming(false)
        setStreamingContent('')
        setStreamingStatus('')
        abortRef.current = null
      }
    },
    [streaming, currentSessionId, model, loadSessions, pendingSkillIds, selectedMcpIds, selectedDifyIds, selectedKbIds]
  )

  const handleCopy = useCallback((text: string) => {
    copyText(text).catch(() => { })
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (!currentSessionId || messages.length < 2) return
    // Find last user message
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    // Remove last AI message and resend
    setMessages((prev) => prev.filter((m) => m.id !== prev[prev.length - 1].id))
    await handleSend(lastUser.content, [])
  }, [currentSessionId, messages, handleSend])

  return (
    <div
      className="flex h-screen bg-slate-50 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handlePageDrop}
    >
      {/* Drop overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-blue-500/10 border-4 border-dashed border-blue-400 rounded-none flex flex-col items-center justify-center pointer-events-none">
          <div className="bg-white/90 rounded-2xl px-8 py-6 shadow-xl flex flex-col items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            <p className="text-blue-600 text-lg font-semibold">放開以上傳檔案</p>
            <p className="text-slate-400 text-sm">支援 PDF、Word、Excel、PPT、圖片、音訊</p>
          </div>
        </div>
      )}

      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        model={model}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onModelChange={handleModelChange}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Research completion banner */}
        {researchBanner.length > 0 && (
          <div className="bg-green-600 text-white px-4 py-2 flex items-center gap-3 text-sm">
            <CheckCircle size={16} className="flex-shrink-0" />
            <span className="flex-1">
              {researchBanner.length === 1
                ? `深度研究完成：${researchBanner[0].title}`
                : `${researchBanner.length} 個深度研究已完成`
              }
            </span>
            <button
              onClick={() => setResearchBanner([])}
              className="hover:bg-green-700 rounded p-0.5 transition"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Top bar */}
        <div className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-3">
          <span className="text-slate-600 text-sm font-medium truncate flex-1">
            {currentSessionId
              ? sessions.find((s) => s.id === currentSessionId)?.title || t('chat.topbar.chatting')
              : 'FOXLINK GPT'}
          </span>
          {/* ── MCP button ── */}
          <div className="relative" ref={mcpPanelRef}>
            <button
              onClick={openMcpPanel}
              className={`inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1 transition ${selectedMcpIds.size > 0 ? 'text-cyan-600 border-cyan-300 bg-cyan-50 hover:bg-cyan-100' : 'text-slate-500 border-slate-200 hover:text-cyan-600 hover:border-cyan-300'}`}
              title={t('chat.topbar.mcp')}
            >
              <Plug size={13} />
              {selectedMcpIds.size > 0 ? t('chat.topbar.mcpCount', { count: selectedMcpIds.size }) : t('chat.topbar.mcp')}
            </button>
            {showMcpPanel && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-50">
                <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Plug size={14} className="text-cyan-500" />{t('chat.topbar.mcpPanelTitle')}</span>
                  <button onClick={() => setShowMcpPanel(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                </div>
                <div className="max-h-56 overflow-y-auto overflow-x-auto p-2 space-y-1">
                  {allMcpServers.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">{t('chat.topbar.mcpEmpty')}</div>
                  ) : allMcpServers.map(s => {
                    const picked = selectedMcpIds.has(s.id as number)
                    return (
                      <button key={s.id} onClick={() => setSelectedMcpIds(prev => { const n = new Set(prev); picked ? n.delete(s.id as number) : n.add(s.id as number); return n })}
                        className={`min-w-full w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition ${picked ? 'bg-cyan-50 border border-cyan-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${picked ? 'bg-cyan-600 border-cyan-600' : 'border-slate-300'}`}>
                          {picked && <Check size={10} className="text-white" />}
                        </div>
                        <div className="flex-shrink-0">
                          <p className="text-xs font-medium text-slate-800 whitespace-nowrap">{localName(s)}</p>
                          {localDesc(s) && <p className="text-xs text-slate-400 whitespace-nowrap">{localDesc(s)}</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="p-2 border-t border-slate-100 flex justify-between items-center">
                  <button onClick={() => setSelectedMcpIds(new Set())} className="text-xs text-slate-400 hover:text-red-500 px-2 py-1">{t('chat.topbar.clear')}</button>
                  <button onClick={() => setShowMcpPanel(false)} className="px-3 py-1.5 text-xs bg-cyan-600 text-white rounded-lg hover:bg-cyan-700">{t('chat.topbar.confirm')}</button>
                </div>
              </div>
            )}
          </div>

          {/* ── DIFY KB button ── */}
          <div className="relative" ref={difyPanelRef}>
            <button
              onClick={openDifyPanel}
              className={`inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1 transition ${selectedDifyIds.size > 0 ? 'text-amber-600 border-amber-300 bg-amber-50 hover:bg-amber-100' : 'text-slate-500 border-slate-200 hover:text-amber-600 hover:border-amber-300'}`}
              title={t('chat.topbar.dify')}
            >
              <Zap size={13} />
              {selectedDifyIds.size > 0 ? t('chat.topbar.difyCount', { count: selectedDifyIds.size }) : t('chat.topbar.dify')}
            </button>
            {showDifyPanel && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-50">
                <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Zap size={14} className="text-amber-500" />{t('chat.topbar.difyPanelTitle')}</span>
                  <button onClick={() => setShowDifyPanel(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                </div>
                <div className="max-h-56 overflow-y-auto overflow-x-auto p-2 space-y-1">
                  {allDifyKbs.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">{t('chat.topbar.difyEmpty')}</div>
                  ) : allDifyKbs.map(k => {
                    const picked = selectedDifyIds.has(k.id as number)
                    return (
                      <button key={k.id} onClick={() => setSelectedDifyIds(prev => { const n = new Set(prev); picked ? n.delete(k.id as number) : n.add(k.id as number); return n })}
                        className={`min-w-full w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition ${picked ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${picked ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                          {picked && <Check size={10} className="text-white" />}
                        </div>
                        <div className="flex-shrink-0">
                          <p className="text-xs font-medium text-slate-800 whitespace-nowrap">{localName(k)}</p>
                          {localDesc(k) && <p className="text-xs text-slate-400 whitespace-nowrap">{localDesc(k)}</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="p-2 border-t border-slate-100 flex justify-between items-center">
                  <button onClick={() => setSelectedDifyIds(new Set())} className="text-xs text-slate-400 hover:text-red-500 px-2 py-1">{t('chat.topbar.clear')}</button>
                  <button onClick={() => setShowDifyPanel(false)} className="px-3 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600">{t('chat.topbar.confirm')}</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Self-built KB button ── */}
          <div className="relative" ref={kbPanelRef}>
            <button
              onClick={openKbPanel}
              className={`inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1 transition ${selectedKbIds.size > 0 ? 'text-emerald-600 border-emerald-300 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-500 border-slate-200 hover:text-emerald-600 hover:border-emerald-300'}`}
              title={t('chat.topbar.kb')}
            >
              <Database size={13} />
              {selectedKbIds.size > 0 ? t('chat.topbar.kbCount', { count: selectedKbIds.size }) : t('chat.topbar.kb')}
            </button>
            {showKbPanel && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-50">
                <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Database size={14} className="text-emerald-500" />{t('chat.topbar.kbPanelTitle')}</span>
                  <button onClick={() => setShowKbPanel(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                </div>
                <div className="max-h-56 overflow-y-auto overflow-x-auto p-2 space-y-1">
                  {allSelfKbs.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">{t('chat.topbar.kbEmpty')}</div>
                  ) : allSelfKbs.map(k => {
                    const picked = selectedKbIds.has(String(k.id))
                    return (
                      <button key={k.id} onClick={() => setSelectedKbIds(prev => { const n = new Set(prev); picked ? n.delete(String(k.id)) : n.add(String(k.id)); return n })}
                        className={`min-w-full w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition ${picked ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${picked ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'}`}>
                          {picked && <Check size={10} className="text-white" />}
                        </div>
                        <div className="flex-shrink-0">
                          <p className="text-xs font-medium text-slate-800 whitespace-nowrap">{localName(k)}</p>
                          {localDesc(k) && <p className="text-xs text-slate-400 whitespace-nowrap">{localDesc(k)}</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="p-2 border-t border-slate-100 flex justify-between items-center">
                  <button onClick={() => setSelectedKbIds(new Set())} className="text-xs text-slate-400 hover:text-red-500 px-2 py-1">{t('chat.topbar.clear')}</button>
                  <button onClick={() => setShowKbPanel(false)} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">{t('chat.topbar.confirm')}</button>
                </div>
              </div>
            )}
          </div>

          {/* Skills button + badges */}
          <div className="flex items-center gap-1.5 relative" ref={skillPanelRef}>
              {/* Attached skill badges */}
              {sessionSkills.map(sk => (
                <span key={sk.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-purple-100 text-purple-700 border border-purple-200 rounded-full font-medium">
                  {sk.icon} {sk.name}
                </span>
              ))}
              <button
                onClick={openSkillPanel}
                className={`inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1 transition ${sessionSkills.length > 0
                  ? 'text-purple-600 border-purple-300 bg-purple-50 hover:bg-purple-100'
                  : 'text-slate-500 border-slate-200 hover:text-purple-600 hover:border-purple-300'
                  }`}
                title={t('chat.topbar.skills')}
              >
                <Sparkles size={13} />
                {sessionSkills.length > 0 ? t('chat.topbar.skillsCount', { count: sessionSkills.length }) : t('chat.topbar.skills')}
              </button>

              {/* Skill selection dropdown panel */}
              {showSkillPanel && (
                <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-50">
                  <div className="p-3 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Sparkles size={14} className="text-purple-500" />{t('chat.topbar.skillsPanelTitle')}</span>
                      <button onClick={() => setShowSkillPanel(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                    </div>
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={skillSearch} onChange={e => setSkillSearch(e.target.value)}
                        placeholder={t('chat.topbar.searchSkills')}
                        className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto overflow-x-auto p-2 space-y-1">
                    {allSkills
                      .filter(sk => !skillSearch || sk.name.includes(skillSearch) || (sk.description || '').includes(skillSearch))
                      .map(sk => {
                        const picked = pickedIds.has(sk.id)
                        return (
                          <button
                            key={sk.id}
                            onClick={() => togglePick(sk.id)}
                            className={`min-w-full w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition ${picked ? 'bg-purple-50 border border-purple-200' : 'hover:bg-slate-50 border border-transparent'
                              }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${picked ? 'bg-purple-600 border-purple-600' : 'border-slate-300'
                              }`}>
                              {picked && <Check size={10} className="text-white" />}
                            </div>
                            <span className="text-lg leading-none flex-shrink-0">{sk.icon}</span>
                            <div className="flex-shrink-0">
                              <p className="text-xs font-medium text-slate-800 whitespace-nowrap">{localName(sk)}</p>
                              {localDesc(sk) && <p className="text-xs text-slate-400 whitespace-nowrap">{localDesc(sk)}</p>}
                            </div>
                            {sk.model_key && <span className="text-xs text-indigo-500 flex-shrink-0 ml-2">{sk.model_key}</span>}
                          </button>
                        )
                      })
                    }
                    {allSkills.length === 0 && (
                      <div className="text-center py-6 text-slate-400">
                        <Sparkles size={24} className="mx-auto mb-2 opacity-30" />
                        <p className="text-xs">{t('chat.topbar.skillsEmpty')}</p>
                        <a href="/skills" className="text-xs text-purple-500 hover:underline flex items-center justify-center gap-1 mt-1"><Plus size={10} />{t('chat.topbar.createSkill')}</a>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-xs text-slate-500">{t('chat.topbar.selectedCount', { count: pickedIds.size })}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setShowSkillPanel(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">{t('common.cancel')}</button>
                      <button
                        onClick={saveSkills} disabled={skillSaving}
                        className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      >
                        {skillSaving ? t('common.saving') : t('chat.topbar.confirmMount')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          {/* ── AI 戰情快速入口 ── */}
          {(canUseDashboard || isAdmin) && (
            <div className="relative" ref={dashPanelRef}>
              <button
                onClick={() => setShowDashPanel((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1 transition text-slate-500 border-slate-200 hover:text-orange-600 hover:border-orange-300"
                title={t('chat.topbar.aiDashboard')}
              >
                <BarChart3 size={13} />
                {t('chat.topbar.aiDashboard')}
                <ChevronDown size={11} />
              </button>
              {showDashPanel && (
                <div className="absolute top-full right-0 mt-1 w-60 bg-white border border-slate-200 rounded-xl shadow-2xl z-50">
                  <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                      <BarChart3 size={14} className="text-orange-500" />{t('chat.topbar.dashPanelTitle')}
                    </span>
                    <button onClick={() => setShowDashPanel(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2 space-y-1">
                    <button
                      onClick={() => { setShowDashPanel(false); navigate('/dashboard') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-orange-600 font-medium rounded-lg hover:bg-orange-50 transition"
                    >
                      <BarChart3 size={13} /> {t('chat.topbar.aiDashHome')}
                    </button>
                    {dashTopics.length > 0 && <div className="border-t border-slate-100 my-1" />}
                    {dashTopics.map((topic) => (
                      <div key={topic.id}>
                        <div className="px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">{localName(topic)}</div>
                        {topic.designs.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => { setShowDashPanel(false); navigate(`/dashboard?topic=${topic.id}&design=${d.id}`) }}
                            className="w-full text-left px-4 py-1.5 text-xs text-slate-700 rounded-lg hover:bg-slate-50 transition truncate"
                          >
                            {localName(d)}
                          </button>
                        ))}
                      </div>
                    ))}
                    {dashTopics.length === 0 && (
                      <div className="text-center py-4 text-slate-400 text-xs">{t('chat.topbar.noDesigns')}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Share button — only when a session is loaded and not streaming */}
          {currentSessionId && messages.length > 0 && !streaming && (
            <button
              onClick={handleShare}
              disabled={sharing}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded-lg px-2.5 py-1 transition disabled:opacity-50"
              title={t('chat.topbar.share')}
            >
              <Share2 size={13} />
              {sharing ? t('chat.topbar.sharing') : t('chat.topbar.share')}
            </button>
          )}
          {streaming && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                {t('chat.topbar.aiReplying')}
              </span>
              <button
                onClick={() => abortRef.current?.()}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded-lg border border-red-200 transition"
                title={t('chat.topbar.stop')}
              >
                <Square size={10} fill="currentColor" />
                {t('chat.topbar.stop')}
              </button>
            </div>
          )}
          {/* Research jobs panel */}
          {canResearch && researchJobs.length > 0 && (() => {
            const running = researchJobs.filter((j) => j.status === 'pending' || j.status === 'running')
            return (
              <div className="relative" ref={researchPanelRef}>
                <button
                  onClick={() => setShowResearchPanel((v) => !v)}
                  className={`inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1 transition ${
                    running.length > 0
                      ? 'text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100'
                      : 'text-slate-500 border-slate-200 hover:text-blue-600 hover:border-blue-300'
                  }`}
                  title={t('chat.topbar.research')}
                >
                  {running.length > 0
                    ? <><Sparkles size={13} className="animate-pulse" />{t('chat.topbar.researchRunning', { count: running.length })}</>
                    : <><Search size={13} />{t('chat.topbar.research')}</>
                  }
                </button>
                {showResearchPanel && (
                  <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-50">
                    <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <Search size={14} className="text-blue-500" />{t('chat.topbar.research')}
                      </span>
                      <button onClick={() => setShowResearchPanel(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                    </div>
                    <div className="max-h-72 overflow-y-auto p-2 space-y-2">
                      {researchJobs.slice(0, 10).map((j) => {
                        const pct = j.progress_total > 0 ? Math.round((j.progress_step / j.progress_total) * 100) : 0
                        const isRunning = j.status === 'pending' || j.status === 'running'
                        return (
                          <div key={j.id} className={`rounded-xl border p-3 text-xs ${
                            j.status === 'done'   ? 'border-green-200 bg-green-50' :
                            j.status === 'failed' ? 'border-red-200 bg-red-50'    :
                            'border-blue-200 bg-blue-50'
                          }`}>
                            <div className="flex items-start gap-2">
                              {isRunning && <Sparkles size={13} className="text-blue-500 animate-pulse flex-shrink-0 mt-0.5" />}
                              {j.status === 'done'   && <CheckCircle size={13} className="text-green-500 flex-shrink-0 mt-0.5" />}
                              {j.status === 'failed' && <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />}
                              <div className="flex-1 min-w-0">

                                <p className="font-medium text-slate-800 truncate">{j.title || t('chat.topbar.researchJobRunning')}</p>
                                {isRunning && (
                                  <div className="mt-1.5 space-y-1">
                                    <p className="text-slate-500">{j.progress_label || t('chat.topbar.researchJobPreparing')}</p>
                                    <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                                    </div>
                                    {j.progress_total > 0 && <p className="text-slate-400">{t('chat.topbar.researchJobSteps', { step: j.progress_step, total: j.progress_total })}</p>}
                                  </div>
                                )}
                                {j.status === 'done' && (
                                  <div className="mt-1 space-y-1">
                                    <p className="text-green-600">{t('chat.topbar.researchJobDone', { time: j.completed_at?.slice(0, 16) })}</p>
                                    {j.result_files_json && (() => {
                                      try {
                                        const files: { name: string; url: string; type: string }[] = JSON.parse(j.result_files_json)
                                        return files.length > 0 ? (
                                          <div className="flex flex-wrap gap-1">
                                            {files.map((f) => (
                                              <a key={f.name} href={f.url} download={f.name}
                                                className="flex items-center gap-1 px-2 py-0.5 bg-white border border-green-300 text-green-700 rounded-lg hover:bg-green-50 transition"
                                              >
                                                ↓ {f.type.toUpperCase()}
                                              </a>
                                            ))}
                                          </div>
                                        ) : null
                                      } catch { return null }
                                    })()}
                                  </div>
                                )}
                                {j.status === 'failed' && <p className="text-red-500 mt-0.5 truncate">{j.error_msg || t('chat.topbar.researchJobFailed')}</p>}
                              </div>
                              {!isRunning && (
                                <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                                  {j.status === 'done' && (
                                    <button
                                      onClick={() => {
                                        setEditRerunJobId(j.id)
                                        setShowResearchPanel(false)
                                        setShowResearchModal(true)
                                      }}
                                      className="text-slate-300 hover:text-orange-400 transition"
                                      title={t('chat.topbar.researchJobRerun')}
                                    >
                                      <RefreshCw size={13} />
                                    </button>
                                  )}
                                  <button
                                    onClick={async () => {
                                      try { await api.delete(`/research/jobs/${j.id}`) } catch { /* ignore */ }
                                      setResearchJobs((prev) => prev.filter((x) => x.id !== j.id))
                                    }}
                                    className="text-slate-300 hover:text-red-400 transition"
                                    title={t('chat.topbar.researchJobDelete')}
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Budget indicator — show whenever any limit is configured */}
          {budget && !budget.isAdmin && (budget.daily || budget.weekly || budget.monthly) && (
            <div className="flex items-center gap-1.5">
              {budget.daily && (
                <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg border ${budget.daily.exceeded ? 'text-red-600 bg-red-50 border-red-200'
                  : budget.daily.remaining < budget.daily.limit * 0.2 ? 'text-amber-600 bg-amber-50 border-amber-200'
                    : 'text-slate-500 bg-slate-50 border-slate-200'
                  }`} title={`今日: $${budget.daily.spent.toFixed(4)} / $${budget.daily.limit}`}>
                  {budget.daily.exceeded && <AlertTriangle size={11} />}
                  日 ${budget.daily.spent.toFixed(3)}/$${budget.daily.limit}
                </div>
              )}
              {budget.weekly && (
                <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg border ${budget.weekly.exceeded ? 'text-red-600 bg-red-50 border-red-200'
                  : budget.weekly.remaining < budget.weekly.limit * 0.2 ? 'text-amber-600 bg-amber-50 border-amber-200'
                    : 'text-slate-500 bg-slate-50 border-slate-200'
                  }`} title={`本週: $${budget.weekly.spent.toFixed(4)} / $${budget.weekly.limit}`}>
                  {budget.weekly.exceeded && <AlertTriangle size={11} />}
                  週 ${budget.weekly.spent.toFixed(3)}/$${budget.weekly.limit}
                </div>
              )}
              {budget.monthly && (
                <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg border ${budget.monthly.exceeded ? 'text-red-600 bg-red-50 border-red-200'
                  : budget.monthly.remaining < budget.monthly.limit * 0.2 ? 'text-amber-600 bg-amber-50 border-amber-200'
                    : 'text-slate-500 bg-slate-50 border-slate-200'
                  }`} title={`本月: $${budget.monthly.spent.toFixed(4)} / $${budget.monthly.limit}`}>
                  {budget.monthly.exceeded && <AlertTriangle size={11} />}
                  月 ${budget.monthly.spent.toFixed(3)}/$${budget.monthly.limit}
                </div>
              )}
            </div>
          )}
        </div>

        <ChatWindow
          messages={messages}
          streaming={streaming}
          streamingContent={streamingContent}
          streamingStatus={streamingStatus}
          onCopy={handleCopy}
          onRegenerate={handleRegenerate}
        />

        <MessageInput
          ref={messageInputRef}
          onSend={handleSend}
          disabled={streaming}
          canResearch={canResearch}
          onResearch={() => {
            const q = messageInputRef.current?.getQuestion() || ''
            const f = messageInputRef.current?.getFiles() || []
            setResearchInitialQuestion(q)
            setResearchInitialFiles(f)
            setShowResearchModal(true)
          }}
        />
      </div>

      {/* Deep Research modal */}
      {showResearchModal && (
        <ResearchModal
          sessionId={currentSessionId}
          modelKey={model}
          initialQuestion={researchInitialQuestion}
          initialFiles={researchInitialFiles}
          editJobId={editRerunJobId || undefined}
          onClose={() => { setShowResearchModal(false); setEditRerunJobId(null) }}
          onJobCreated={async (jobId) => {
            seenResearchIds.current.add(jobId)
            let sid = currentSessionId
            // If no session, auto-create one so the progress card is visible
            if (!sid) {
              try {
                const res = await api.post('/chat/sessions', { model })
                sid = res.data.id
                const newSession: ChatSession = {
                  id: sid!, title: '深度研究', model,
                  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                }
                setSessions((prev) => [newSession, ...prev])
                setCurrentSessionId(sid)
                setMessages([])
              } catch { /* ignore */ }
            }
            if (sid) {
              const placeholder: ChatMessage = {
                id: Date.now(),
                session_id: sid,
                role: 'assistant',
                content: `__RESEARCH_JOB__:${jobId}`,
                created_at: new Date().toISOString(),
              }
              setMessages((prev) => [...prev, placeholder])
            }
          }}
        />
      )}

      {/* Share link modal */}
      {shareLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Share2 size={16} className="text-blue-600" />
                分享連結已建立
              </h3>
              <button
                onClick={() => { setShareLink(null); setShareCopied(false) }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">任何登入的使用者都可以透過此連結查看對話快照，並選擇繼續這段對話。</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareLink}
                className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-700 truncate"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={handleCopyShareLink}
                className="shrink-0 inline-flex items-center gap-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 transition"
              >
                {shareCopied ? <Check size={12} /> : <Copy size={12} />}
                {shareCopied ? '已複製' : '複製'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-3">此快照不會隨原始對話更新，是獨立的分享副本。</p>
          </div>
        </div>
      )}
    </div>
  )
}
