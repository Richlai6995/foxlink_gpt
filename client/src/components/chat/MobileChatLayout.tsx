// Mobile chat layout — PR-2 v1
// 簡化原則:文字對話 + sessions drawer + 基本 model picker;
// 進階工具(MCP/KB/Skill/ERP/Research/Templates)留到後續再做
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Drawer } from 'vaul'
import {
  Menu, Plus, Square, MessageSquare, Trash2, ChevronDown,
  LogOut, Globe, Sparkles, Settings, Paperclip, X,
  FileText, Image as ImageIcon, Music,
} from 'lucide-react'
import { buildAcceptAttr } from '../../lib/uploadFileTypes'
import api from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { useAuth } from '../../context/AuthContext'
import { useStreamHealth } from '../../hooks/useStreamHealth'
import i18n, { SUPPORTED_LANGUAGES, type LangCode } from '../../i18n'
import type { ChatSession, ChatMessage, LlmModel, ModelType, GeneratedFile } from '../../types'

const ChatWindow = lazy(() => import('../ChatWindow'))

function localTitle(s: ChatSession, lang: string): string {
  if (lang === 'en') return s.title_en || s.title || ''
  if (lang === 'vi') return s.title_vi || s.title || ''
  return s.title_zh || s.title || ''
}

export default function MobileChatLayout() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [model, setModel] = useState<ModelType>(
    () => (localStorage.getItem('model') as ModelType) || ''
  )
  const [availableModels, setAvailableModels] = useState<LlmModel[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingStatus, setStreamingStatus] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showLang, setShowLang] = useState(false)

  const [inputText, setInputText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const wasAbortedRef = useRef(false)
  const wasStallAbortedRef = useRef(false)
  const lastUserMessageRef = useRef<{ text: string; files: File[] } | null>(null)

  // ── SSE health(visibilitychange / offline)
  const handleStreamAbort = useCallback(() => {
    wasStallAbortedRef.current = true
    if (abortRef.current) {
      try { abortRef.current() } catch {}
    }
  }, [])
  const { stallReason, noteChunk, clearStall } = useStreamHealth({ streaming, onAbort: handleStreamAbort })

  // ── load sessions
  const loadSessions = useCallback(async () => {
    try {
      const r = await api.get('/chat/sessions')
      setSessions(r.data || [])
    } catch (e) {
      console.error('loadSessions', e)
    }
  }, [])

  // ── load models
  useEffect(() => {
    api.get('/chat/models').then((r) => {
      const ms: LlmModel[] = r.data || []
      const chatOnly = ms.filter((m) => !m.model_role || m.model_role === 'chat')
      setAvailableModels(chatOnly)
      const localKey = localStorage.getItem('model') || ''
      if (!chatOnly.some((m) => m.key === localKey) && chatOnly[0]) {
        setModel(chatOnly[0].key as ModelType)
        localStorage.setItem('model', chatOnly[0].key)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // ── load messages when session changes(API 回 { session, messages, skills, ... })
  useEffect(() => {
    if (!currentSessionId) { setMessages([]); return }
    api.get(`/chat/sessions/${currentSessionId}`).then((r) => {
      setMessages(r.data?.messages || [])
    }).catch((e) => {
      console.error('load session messages', e)
      setMessages([])
    })
  }, [currentSessionId])

  // ── new chat
  const handleNewChat = useCallback(() => {
    setCurrentSessionId(null)
    setMessages([])
    setDrawerOpen(false)
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  // ── pick session
  const handlePickSession = useCallback((id: string) => {
    setCurrentSessionId(id)
    setDrawerOpen(false)
  }, [])

  // ── delete session
  const handleDeleteSession = useCallback(async (id: string) => {
    if (!confirm('確定刪除這個對話?')) return
    try {
      await api.delete(`/chat/sessions/${id}`)
      setSessions((p) => p.filter((s) => s.id !== id))
      if (currentSessionId === id) {
        setCurrentSessionId(null)
        setMessages([])
      }
    } catch (e) {
      console.error('delete session', e)
    }
  }, [currentSessionId])

  // ── change model
  const handleModelChange = useCallback((key: string) => {
    setModel(key as ModelType)
    localStorage.setItem('model', key)
    setModelPickerOpen(false)
  }, [])

  // ── send message (SSE via XHR,支援多檔上傳)
  const handleSend = useCallback(async (text: string, files: File[] = []) => {
    if (streaming) return
    if (!text.trim() && files.length === 0) return
    lastUserMessageRef.current = { text, files }
    wasStallAbortedRef.current = false
    wasAbortedRef.current = false
    clearStall()

    let sessionId = currentSessionId
    if (!sessionId) {
      try {
        const res = await api.post('/chat/sessions', { model, title: '新對話' })
        sessionId = res.data.id
        const newSession: ChatSession = {
          id: res.data.id,
          title: '新對話',
          model,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setSessions((p) => [newSession, ...p])
        setCurrentSessionId(sessionId)
      } catch (e) {
        console.error('create session', e)
        return
      }
    }

    const userMsg: ChatMessage = {
      id: Date.now(),
      session_id: sessionId!,
      role: 'user',
      content: text,
      files: files.map((f) => ({ name: f.name, type: 'document' as const })),
      created_at: new Date().toISOString(),
    }
    setMessages((p) => [...p, userMsg])
    setInputText('')
    setAttachments([])
    setStreaming(true)
    setStreamingContent('')
    setStreamingStatus('')

    const formData = new FormData()
    formData.append('message', text)
    formData.append('model', model)
    // 多檔附件 — 走桌機相同的 multipart 路徑
    files.forEach((f) => formData.append('files', f))
    // 預設不啟用任何工具(mobile v1 純對話)
    formData.append('mcp_server_ids', '[]')
    formData.append('dify_kb_ids', '[]')
    formData.append('self_kb_ids', '[]')
    formData.append('erp_tool_ids', '[]')
    formData.append('hidden_mcp_ids', '[]')
    formData.append('hidden_dify_ids', '[]')
    formData.append('hidden_self_kb_ids', '[]')
    formData.append('hidden_skill_ids', '[]')
    formData.append('hidden_erp_ids', '[]')

    const token = localStorage.getItem('token')
    let accText = ''
    const generatedFiles: GeneratedFile[] = []
    let streamDone = false
    let streamError = ''

    const stripGenerateBlocks = (s: string) =>
      s.replace(/```generate_[a-z]+:[^\n]+\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/chat/sessions/${sessionId}/messages`, true)
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.setRequestHeader('X-Lang', i18n.language || 'zh-TW')

        abortRef.current = () => {
          wasAbortedRef.current = true
          try { xhr.abort() } catch {}
        }

        let lastIdx = 0
        let buffer = ''
        const processDelta = () => {
          if (streamDone) return
          const delta = xhr.responseText.slice(lastIdx)
          lastIdx = xhr.responseText.length
          buffer += delta
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6))
              if (ev.type === 'chunk') {
                accText += ev.content
                const genIdx = accText.indexOf('```generate_')
                setStreamingContent(genIdx >= 0 ? accText.slice(0, genIdx).trimEnd() : accText)
                setStreamingStatus(genIdx >= 0 ? '正在產生文件…' : '')
              } else if (ev.type === 'status') {
                setStreamingStatus(ev.message || '')
              } else if (ev.type === 'title') {
                setSessions((p) => p.map((s) => s.id === sessionId ? {
                  ...s,
                  title: ev.title || s.title,
                  title_zh: ev.title_zh || s.title_zh,
                  title_en: ev.title_en || s.title_en,
                  title_vi: ev.title_vi || s.title_vi,
                } : s))
              } else if (ev.type === 'generated_files') {
                generatedFiles.push(...ev.files)
              } else if (ev.type === 'error') {
                streamError = ev.message || '發生錯誤'
                streamDone = true
                return
              } else if (ev.type === 'done') {
                streamDone = true
                return
              }
            } catch {}
          }
        }

        xhr.onprogress = () => { noteChunk(); processDelta() }
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            let msg = `HTTP ${xhr.status}`
            try { const b = JSON.parse(xhr.responseText); msg = b.error || msg } catch {}
            reject(new Error(msg)); return
          }
          processDelta()
          resolve()
        }
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.onabort = () => resolve()
        xhr.send(formData)
      })

      const stalled = wasStallAbortedRef.current
      const aiMsg: ChatMessage = {
        id: Date.now() + 1,
        session_id: sessionId!,
        role: 'assistant',
        content: streamError
          ? `⚠️ ${streamError}`
          : stalled
            ? stripGenerateBlocks(accText) + (accText ? '\n\n*(連線中斷,可點上方 banner 重發)*' : '(連線中斷)')
            : wasAbortedRef.current
              ? stripGenerateBlocks(accText) + (accText ? '\n\n*(已中止)*' : '(已中止)')
              : stripGenerateBlocks(accText),
        generated_files: generatedFiles.length > 0 ? generatedFiles : undefined,
        created_at: new Date().toISOString(),
      }
      setMessages((p) => [...p, aiMsg])
      loadSessions()
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      const errMsg: ChatMessage = {
        id: Date.now() + 1,
        session_id: sessionId!,
        role: 'assistant',
        content: wasStallAbortedRef.current
          ? (accText ? stripGenerateBlocks(accText) + '\n\n*(連線中斷)*' : '(連線中斷)')
          : `⚠️ 發生錯誤:${detail}`,
        created_at: new Date().toISOString(),
      }
      setMessages((p) => [...p, errMsg])
    } finally {
      setStreaming(false)
      setStreamingContent('')
      setStreamingStatus('')
      abortRef.current = null
    }
  }, [streaming, currentSessionId, model, loadSessions, noteChunk, clearStall])

  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current()
  }, [])

  const handleResendAfterStall = useCallback(() => {
    const last = lastUserMessageRef.current
    if (!last) { clearStall(); return }
    clearStall()
    void handleSend(last.text, last.files)
  }, [handleSend, clearStall])

  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (selected.length === 0) return
    setAttachments((p) => [...p, ...selected])
    // reset input value 讓重複選同一檔也能 re-fire
    e.target.value = ''
  }, [])

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((p) => p.filter((_, i) => i !== idx))
  }, [])

  function fileIcon(f: File) {
    if (f.type.startsWith('image/')) return <ImageIcon size={14} className="text-blue-500" />
    if (f.type.startsWith('audio/')) return <Music size={14} className="text-purple-500" />
    return <FileText size={14} className="text-slate-500" />
  }

  const handleCopy = useCallback((s: string) => { copyText(s).catch(() => {}) }, [])

  const currentModelName = availableModels.find((m) => m.key === model)?.name || model || '選擇模型'
  const currentTitle = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
      ? localTitle(sessions.find((s) => s.id === currentSessionId)!, i18n.language)
      : '對話中'
    : 'Cortex'

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-50 overflow-hidden">
      {/* Topbar */}
      <header className="flex items-center gap-2 px-3 h-14 bg-white border-b border-slate-200 pt-safe">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="開啟對話列表"
          className="w-11 h-11 -ml-1 flex items-center justify-center rounded-lg hover:bg-slate-100 active:bg-slate-200 text-slate-700"
        >
          <Menu size={20} />
        </button>
        <button
          onClick={() => setModelPickerOpen(true)}
          className="flex-1 min-w-0 flex flex-col items-start gap-0 px-2 py-1 rounded-lg hover:bg-slate-50 active:bg-slate-100"
        >
          <span className="text-sm font-medium text-slate-800 truncate w-full text-left">{currentTitle}</span>
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-0.5 truncate max-w-full">
            <Sparkles size={10} className="text-blue-500 flex-shrink-0" /> {currentModelName} <ChevronDown size={10} />
          </span>
        </button>
        <button
          onClick={handleNewChat}
          aria-label="新對話"
          className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-slate-100 active:bg-slate-200 text-slate-700"
        >
          <Plus size={20} />
        </button>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="選單"
          className="w-11 h-11 -mr-1 flex items-center justify-center rounded-lg hover:bg-slate-100 active:bg-slate-200 text-slate-700"
        >
          <Settings size={18} />
        </button>
      </header>

      {/* SSE stall banner */}
      {stallReason && lastUserMessageRef.current && (
        <div className="bg-red-50 border-b border-red-200 px-3 py-2 flex items-center gap-2 text-xs text-red-800">
          <span className="flex-1">{stallReason === 'offline' ? '網路中斷' : '連線中斷或長時間沒回應'}</span>
          <button onClick={handleResendAfterStall} className="text-white bg-red-600 rounded px-2 py-1 font-medium">重發</button>
          <button onClick={clearStall} className="text-red-400 px-1">✕</button>
        </div>
      )}

      {/* Chat area — flex column,min-h-0 才能讓 ChatWindow overflow-y-auto 正確 scroll */}
      <main className="flex-1 min-h-0 flex flex-col">
        {!currentSessionId && messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
              <Sparkles size={28} className="text-blue-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">開始新對話</h2>
            <p className="text-sm text-slate-500">
              你好 {(user as any)?.name || (user as any)?.username},直接在下方輸入訊息開始
            </p>
          </div>
        ) : (
          <Suspense fallback={<div className="p-4 text-sm text-slate-400">Loading…</div>}>
            <ChatWindow
              messages={messages}
              streaming={streaming}
              streamingContent={streamingContent}
              streamingStatus={streamingStatus}
              onCopy={handleCopy}
              sessionId={currentSessionId}
            />
          </Suspense>
        )}
      </main>

      {/* Input bar */}
      <div className="border-t border-slate-200 bg-white px-2 py-2 pb-safe">
        {/* 附件預覽 chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 px-1">
            {attachments.map((f, i) => (
              <div
                key={i}
                className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-full pl-2 pr-1 py-1 text-xs text-slate-700 max-w-[200px]"
              >
                {fileIcon(f)}
                <span className="truncate">{f.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  aria-label="移除"
                  className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-500"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={buildAcceptAttr()}
            onChange={handleFilePick}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming}
            aria-label="附加檔案"
            className="w-11 h-11 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 flex-shrink-0"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSend(inputText, attachments)
              }
            }}
            placeholder="輸入訊息…"
            rows={1}
            className="flex-1 resize-none border border-slate-200 rounded-2xl px-4 py-3 max-h-32 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
            style={{ minHeight: '44px' }}
          />
          {streaming ? (
            <button
              onClick={handleStop}
              aria-label="停止"
              className="w-11 h-11 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white flex-shrink-0"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => handleSend(inputText, attachments)}
              disabled={!inputText.trim() && attachments.length === 0}
              aria-label="送出"
              className="w-11 h-11 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white flex-shrink-0"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Sessions Drawer (vaul,左滑) ── */}
      <Drawer.Root direction="left" open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <Drawer.Content className="fixed inset-y-0 left-0 w-[85%] max-w-sm bg-white z-50 flex flex-col pt-safe pb-safe">
            <Drawer.Title className="sr-only">對話列表</Drawer.Title>
            <div className="flex items-center gap-2 px-4 h-14 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-800 flex-1">對話</span>
              <button
                onClick={() => { handleNewChat() }}
                className="text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 inline-flex items-center gap-1"
              >
                <Plus size={12} /> 新對話
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {sessions.length === 0 ? (
                <p className="px-4 py-6 text-xs text-slate-400 text-center">還沒有對話紀錄</p>
              ) : (
                sessions.map((s) => {
                  const active = s.id === currentSessionId
                  return (
                    <div
                      key={s.id}
                      className={`mx-2 px-3 py-2.5 rounded-lg flex items-center gap-2 group ${
                        active ? 'bg-blue-50' : 'hover:bg-slate-50 active:bg-slate-100'
                      }`}
                    >
                      <button
                        onClick={() => handlePickSession(s.id)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <MessageSquare size={14} className={active ? 'text-blue-600' : 'text-slate-400'} />
                          <span className={`text-sm truncate ${active ? 'text-blue-800 font-medium' : 'text-slate-700'}`}>
                            {localTitle(s, i18n.language)}
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={() => handleDeleteSession(s.id)}
                        aria-label="刪除"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
            <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <div className="truncate">{(user as any)?.name || (user as any)?.username}</div>
              <div className="truncate text-slate-400">{(user as any)?.email || ''}</div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* ── Model picker bottom sheet(vaul) ── */}
      <Drawer.Root open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl flex flex-col max-h-[80vh] pb-safe">
            <Drawer.Title className="sr-only">選擇模型</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2" />
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800">選擇模型</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {availableModels.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">沒有可用模型</p>
              ) : (
                availableModels.map((m) => {
                  const active = m.key === model
                  return (
                    <button
                      key={m.key}
                      onClick={() => handleModelChange(m.key)}
                      className={`w-full text-left px-3 py-3 rounded-lg flex items-start gap-3 ${
                        active ? 'bg-blue-50' : 'hover:bg-slate-50 active:bg-slate-100'
                      }`}
                    >
                      <Sparkles size={16} className={`mt-0.5 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${active ? 'text-blue-800' : 'text-slate-800'}`}>{m.name}</p>
                        {m.description && <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* ── 設定選單 bottom sheet ── */}
      <Drawer.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl pb-safe">
            <Drawer.Title className="sr-only">選單</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2" />
            <div className="p-2">
              <button
                onClick={() => { setShowLang(true); setMenuOpen(false) }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <Globe size={18} className="text-slate-500" />
                <span className="flex-1 text-sm text-slate-800">語言</span>
                <span className="text-xs text-slate-500">
                  {SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)?.label || i18n.language}
                </span>
              </button>
              <button
                onClick={() => { setMenuOpen(false); navigate('/help') }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <Settings size={18} className="text-slate-500" />
                <span className="flex-1 text-sm text-slate-800">說明</span>
              </button>
              <div className="my-1 h-px bg-slate-200" />
              <button
                onClick={() => { setMenuOpen(false); logout() }}
                className="w-full px-3 py-3 rounded-lg hover:bg-red-50 active:bg-red-100 flex items-center gap-3 text-left"
              >
                <LogOut size={18} className="text-red-500" />
                <span className="flex-1 text-sm text-red-600">登出</span>
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* 語言選擇(疊在設定選單上) */}
      <Drawer.Root open={showLang} onOpenChange={setShowLang}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl pb-safe">
            <Drawer.Title className="sr-only">選擇語言</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2" />
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800">語言</p>
            </div>
            <div className="p-2">
              {SUPPORTED_LANGUAGES.map((l) => {
                const active = i18n.language === l.code
                return (
                  <button
                    key={l.code}
                    onClick={() => {
                      i18n.changeLanguage(l.code as LangCode)
                      localStorage.setItem('preferred_language', l.code)
                      setShowLang(false)
                    }}
                    className={`w-full px-3 py-3 rounded-lg flex items-center gap-3 text-left ${
                      active ? 'bg-blue-50' : 'hover:bg-slate-50 active:bg-slate-100'
                    }`}
                  >
                    <Globe size={16} className={active ? 'text-blue-600' : 'text-slate-400'} />
                    <span className={`flex-1 text-sm ${active ? 'text-blue-800 font-medium' : 'text-slate-800'}`}>
                      {l.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* unused i18n key for ts not to complain */}
      <span className="hidden">{t('common.cancel')}</span>
    </div>
  )
}
