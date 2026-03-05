import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Square, AlertTriangle, Share2, Copy, Check, X, Sparkles, Search, Plus } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import ChatWindow from '../components/ChatWindow'
import MessageInput, { type MessageInputHandle } from '../components/MessageInput'
import type { ChatSession, ChatMessage, ModelType, GeneratedFile } from '../types'
import api from '../lib/api'
import { copyText } from '../lib/clipboard'

export default function ChatPage() {
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
          const res = await api.post('/chat/sessions', { model })
          const newSessionId: string = res.data.id
          setSessions(prev => [{
            id: newSessionId, title: '新對話', model,
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

  const handleNewChat = useCallback(async () => {
    try {
      const res = await api.post('/chat/sessions', { model })
      const newSession: ChatSession = {
        id: res.data.id,
        title: '新對話',
        model,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setSessions((prev) => [newSession, ...prev])
      setCurrentSessionId(res.data.id)
      setMessages([])
    } catch (e) {
      console.error('New chat error:', e)
    }
  }, [model])

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
          const res = await api.post('/chat/sessions', { model })
          sessionId = res.data.id
          const newSession: ChatSession = {
            id: res.data.id,
            title: '新對話',
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
                setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title: event.title } : s))
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
    [streaming, currentSessionId, model, loadSessions, pendingSkillIds]
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
        {/* Top bar */}
        <div className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-3">
          <span className="text-slate-600 text-sm font-medium truncate flex-1">
            {currentSessionId
              ? sessions.find((s) => s.id === currentSessionId)?.title || '對話中'
              : 'FOXLINK GPT'}
          </span>
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
                title="掛載 Skill"
              >
                <Sparkles size={13} />
                {sessionSkills.length > 0 ? `技能 (${sessionSkills.length})` : '技能'}
              </button>

              {/* Skill selection dropdown panel */}
              {showSkillPanel && (
                <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-50">
                  <div className="p-3 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Sparkles size={14} className="text-purple-500" />選擇技能</span>
                      <button onClick={() => setShowSkillPanel(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                    </div>
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={skillSearch} onChange={e => setSkillSearch(e.target.value)}
                        placeholder="搜尋技能..."
                        className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                    {allSkills
                      .filter(sk => !skillSearch || sk.name.includes(skillSearch) || (sk.description || '').includes(skillSearch))
                      .map(sk => {
                        const picked = pickedIds.has(sk.id)
                        return (
                          <button
                            key={sk.id}
                            onClick={() => togglePick(sk.id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition ${picked ? 'bg-purple-50 border border-purple-200' : 'hover:bg-slate-50 border border-transparent'
                              }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${picked ? 'bg-purple-600 border-purple-600' : 'border-slate-300'
                              }`}>
                              {picked && <Check size={10} className="text-white" />}
                            </div>
                            <span className="text-lg leading-none">{sk.icon}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-800 truncate">{sk.name}</p>
                              {sk.description && <p className="text-xs text-slate-400 truncate">{sk.description}</p>}
                            </div>
                            {sk.model_key && <span className="text-xs text-indigo-500 shrink-0">{sk.model_key}</span>}
                          </button>
                        )
                      })
                    }
                    {allSkills.length === 0 && (
                      <div className="text-center py-6 text-slate-400">
                        <Sparkles size={24} className="mx-auto mb-2 opacity-30" />
                        <p className="text-xs">尚無技能</p>
                        <a href="/skills" className="text-xs text-purple-500 hover:underline flex items-center justify-center gap-1 mt-1"><Plus size={10} />前往建立</a>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-xs text-slate-500">已選 {pickedIds.size} 項</span>
                    <div className="flex gap-2">
                      <button onClick={() => setShowSkillPanel(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
                      <button
                        onClick={saveSkills} disabled={skillSaving}
                        className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      >
                        {skillSaving ? '儲存中...' : '確認掛載'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          {/* Share button — only when a session is loaded and not streaming */}
          {currentSessionId && messages.length > 0 && !streaming && (
            <button
              onClick={handleShare}
              disabled={sharing}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded-lg px-2.5 py-1 transition disabled:opacity-50"
              title="分享對話"
            >
              <Share2 size={13} />
              {sharing ? '分享中...' : '分享'}
            </button>
          )}
          {streaming && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-blue-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                AI 回覆中...
              </span>
              <button
                onClick={() => abortRef.current?.()}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded-lg border border-red-200 transition"
                title="停止生成"
              >
                <Square size={10} fill="currentColor" />
                停止
              </button>
            </div>
          )}
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

        <MessageInput ref={messageInputRef} onSend={handleSend} disabled={streaming} />
      </div>

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
