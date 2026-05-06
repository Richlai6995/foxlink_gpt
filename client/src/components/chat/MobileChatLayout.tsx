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
  Zap, LayoutTemplate, BarChart3, MessageSquarePlus,
  HelpCircle, Database, Share2, Copy, Check,
} from 'lucide-react'
import { buildAcceptAttr } from '../../lib/uploadFileTypes'
import ErpToolPicker from './ErpToolPicker'
import ErpToolInvokeModal, { type ResultMode } from './ErpToolInvokeModal'
import type { ErpTool } from '../admin/ErpToolsPanel'
import api from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { useAuth } from '../../context/AuthContext'
import { useStreamHealth } from '../../hooks/useStreamHealth'
import { useAdminOverride } from '../../context/AdminOverrideContext'
import { useFeedbackNotifications } from '../../hooks/useFeedbackNotifications'
import i18n, { SUPPORTED_LANGUAGES, type LangCode } from '../../i18n'
import type { ChatSession, ChatMessage, LlmModel, ModelType, GeneratedFile } from '../../types'
import MicButton from '../MicButton'

interface SkillItem {
  id: number
  name: string
  name_zh?: string
  name_en?: string
  name_vi?: string
  description?: string
  desc_zh?: string
  desc_en?: string
  desc_vi?: string
  icon?: string
  type?: string
  prompt_variables?: string
}

const ChatWindow = lazy(() => import('../ChatWindow'))

function localTitle(s: ChatSession, lang: string): string {
  if (lang === 'en') return s.title_en || s.title || ''
  if (lang === 'vi') return s.title_vi || s.title || ''
  return s.title_zh || s.title || ''
}

export default function MobileChatLayout() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const { overrideTools, isOverrideTool } = useAdminOverride()
  const { unreadCount: feedbackUnread } = useFeedbackNotifications()
  const navigate = useNavigate()

  // 多語名稱 / 描述(對齊桌機 localName / localDesc)
  const localName = (item: any): string => {
    if (i18n.language === 'en') return item.name_en || item.name
    if (i18n.language === 'vi') return item.name_vi || item.name
    return item.name_zh || item.name
  }
  const localDesc = (item: any): string => {
    if (i18n.language === 'en') return item.desc_en || item.description || ''
    if (i18n.language === 'vi') return item.desc_vi || item.description || ''
    return item.desc_zh || item.description || ''
  }

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
  const [plusOpen, setPlusOpen] = useState(false)
  const [erpPickerOpen, setErpPickerOpen] = useState(false)
  const [erpInvoking, setErpInvoking] = useState<ErpTool | null>(null)
  const [erpPendingContext, setErpPendingContext] = useState<string | null>(null)

  // Share session
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  // ── Tools picker(MCP / KB / DIFY / Skills 四 tab,checkbox 多選)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsTab, setToolsTab] = useState<'mcp' | 'kb' | 'dify' | 'skill'>('mcp')
  const [allMcpServers, setAllMcpServers] = useState<any[]>([])
  const [allSelfKbs, setAllSelfKbs] = useState<any[]>([])
  const [allDifyKbs, setAllDifyKbs] = useState<any[]>([])
  const [allSkills, setAllSkills] = useState<SkillItem[]>([])
  const [selectedMcpIds, setSelectedMcpIds] = useState<Set<number>>(new Set())
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set())
  const [selectedDifyIds, setSelectedDifyIds] = useState<Set<number>>(new Set())
  // Skills 是 session-scoped — picked = 該 session 上已綁定;pending = 還沒 session 時暫存
  const [pickedSkillIds, setPickedSkillIds] = useState<Set<number>>(new Set())
  const [pendingSkillIds, setPendingSkillIds] = useState<Set<number>>(new Set())
  const [skillSaving, setSkillSaving] = useState(false)
  // 技能參數(prompt_variables):skillId → values map
  const [skillVarValues, setSkillVarValues] = useState<Record<number, Record<string, any>>>({})
  const [skillVarSheet, setSkillVarSheet] = useState<{ skillId: number; skillName: string; variables: any[]; values: Record<string, any> } | null>(null)
  const totalToolsSelected = selectedMcpIds.size + selectedKbIds.size + selectedDifyIds.size + pickedSkillIds.size

  // 對齊桌機:authorized + admin override(localStorage 預設好的測試模式工具)合併
  const loadTools = useCallback(async () => {
    try {
      const [mcp, kb, dify, skills] = await Promise.all([
        api.get('/mcp-servers/my').catch(() => ({ data: [] })),
        api.get('/kb').catch(() => ({ data: [] })),
        api.get('/dify-kb/my').catch(() => ({ data: [] })),
        api.get('/skills').catch(() => ({ data: [] })),
      ])

      const mcpAuthorized = mcp.data || []
      const mcpOverrides = overrideTools
        .filter(t => t.type === 'mcp' && !mcpAuthorized.some((a: any) => String(a.id) === String(t.id)))
        .map(t => ({ id: Number(t.id), name: t.name, name_zh: t.name_zh, name_en: t.name_en, name_vi: t.name_vi, description: t.description, desc_zh: t.desc_zh, desc_en: t.desc_en, desc_vi: t.desc_vi, _isOverride: true }))
      setAllMcpServers([...mcpAuthorized, ...mcpOverrides])

      const kbAuthorized = (kb.data || []).filter((k: any) => (k.chunk_count ?? 0) > 0)
      const kbOverrides = overrideTools
        .filter(t => t.type === 'kb' && !kbAuthorized.some((a: any) => String(a.id) === String(t.id)))
        .map(t => ({ id: t.id, name: t.name, name_zh: t.name_zh, name_en: t.name_en, name_vi: t.name_vi, description: t.description, desc_zh: t.desc_zh, desc_en: t.desc_en, desc_vi: t.desc_vi, chunk_count: 1, _isOverride: true }))
      setAllSelfKbs([...kbAuthorized, ...kbOverrides])

      const difyAuthorized = dify.data || []
      const difyOverrides = overrideTools
        .filter(t => t.type === 'dify' && !difyAuthorized.some((a: any) => String(a.id) === String(t.id)))
        .map(t => ({ id: Number(t.id), name: t.name, name_zh: t.name_zh, name_en: t.name_en, name_vi: t.name_vi, description: t.description, desc_zh: t.desc_zh, desc_en: t.desc_en, desc_vi: t.desc_vi, _isOverride: true }))
      setAllDifyKbs([...difyAuthorized, ...difyOverrides])

      // 過濾 erp_proc 代理(走獨立 ERP 按鈕)
      const skillAuthorized = (skills.data || []).filter((s: any) => s.type !== 'erp_proc')
      const skillOverrides = overrideTools
        .filter(t => t.type === 'skill' && !skillAuthorized.some((a: any) => String(a.id) === String(t.id)))
        .map(t => ({ id: Number(t.id), name: t.name, name_zh: t.name_zh, name_en: t.name_en, name_vi: t.name_vi, description: t.description, desc_zh: t.desc_zh, desc_en: t.desc_en, desc_vi: t.desc_vi, icon: t.icon || '🔧', type: t.skill_type || 'prompt', _isOverride: true }))
      setAllSkills([...skillAuthorized, ...skillOverrides])
    } catch {}
  }, [overrideTools])
  const openTools = useCallback(() => { void loadTools(); setToolsOpen(true) }, [loadTools])

  // Pure mode toggle — 純對話(不引用任何工具),持久化到 localStorage 與桌機共用
  const [pureMode, setPureMode] = useState<boolean>(
    () => localStorage.getItem('chat:pureMode') === '1'
  )

  // 本月 token 消耗 — 顯示在 menu sheet
  const [monthSpent, setMonthSpent] = useState<number | null>(null)
  const togglePureMode = useCallback(() => {
    setPureMode((prev) => {
      const next = !prev
      localStorage.setItem('chat:pureMode', next ? '1' : '0')
      return next
    })
  }, [])

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

  // 載入 budget(本月消耗)— 開啟 menu 時抓最新
  const loadMonthSpent = useCallback(() => {
    api.get('/chat/budget').then((r) => {
      const m = r.data?.monthly?.spent
      if (typeof m === 'number') setMonthSpent(m)
      else setMonthSpent(0)
    }).catch(() => {})
  }, [])
  useEffect(() => { loadMonthSpent() }, [loadMonthSpent])
  useEffect(() => { if (menuOpen) loadMonthSpent() }, [menuOpen, loadMonthSpent])

  // ── load messages when session changes(API 回 { session, messages, skills, ... })
  useEffect(() => {
    if (!currentSessionId) {
      setMessages([])
      setPickedSkillIds(pendingSkillIds) // 切回新對話時保留 pending skills
      return
    }
    api.get(`/chat/sessions/${currentSessionId}`).then((r) => {
      setMessages(r.data?.messages || [])
      // 載入該 session 已綁定的 skills + tools 上次選擇
      const skillIds = new Set<number>((r.data?.skills || []).map((s: any) => Number(s.id)))
      setPickedSkillIds(skillIds)
      // 從 used* 還原工具選擇(server 在 GET session 回傳 usedMcpIds 等)
      if (Array.isArray(r.data?.usedMcpIds))  setSelectedMcpIds(new Set(r.data.usedMcpIds.map(Number)))
      if (Array.isArray(r.data?.usedDifyIds)) setSelectedDifyIds(new Set(r.data.usedDifyIds.map(Number)))
      if (Array.isArray(r.data?.usedKbIds))   setSelectedKbIds(new Set(r.data.usedKbIds.map(String)))
    }).catch((e) => {
      console.error('load session messages', e)
      setMessages([])
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!confirm(t('mobile.chat.deleteConfirm'))) return
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
  }, [currentSessionId, t])

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
        const defaultTitle = t('mobile.chat.newChatDefaultTitle')
        const res = await api.post('/chat/sessions', { model, title: defaultTitle })
        sessionId = res.data.id
        const newSession: ChatSession = {
          id: res.data.id,
          title: defaultTitle,
          model,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setSessions((p) => [newSession, ...p])
        setCurrentSessionId(sessionId)
        // 把 pending skills(新對話前已挑的)套用到剛建好的 session
        if (pendingSkillIds.size > 0) {
          try {
            const payload: any = { skill_ids: [...pendingSkillIds] }
            const varsToSend: Record<number, Record<string, any>> = {}
            for (const sid of pendingSkillIds) {
              if (skillVarValues[sid]) varsToSend[sid] = skillVarValues[sid]
            }
            if (Object.keys(varsToSend).length > 0) payload.skill_variables = varsToSend
            await api.put(`/chat/sessions/${sessionId}/skills`, payload)
            setPickedSkillIds(new Set(pendingSkillIds))
            setPendingSkillIds(new Set())
          } catch {}
        }
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
    // 工具選擇:有選才明確送(讓 server skip auto-discover);沒選就不送(server 自動依權限挑)
    if (selectedMcpIds.size > 0) formData.append('mcp_server_ids', JSON.stringify([...selectedMcpIds]))
    if (selectedDifyIds.size > 0) formData.append('dify_kb_ids', JSON.stringify([...selectedDifyIds]))
    if (selectedKbIds.size > 0) formData.append('self_kb_ids', JSON.stringify([...selectedKbIds]))
    if (pureMode) formData.append('pure_mode', 'true')

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
                setStreamingStatus(genIdx >= 0 ? t('mobile.chat.fileGenerating') : '')
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
      const stallNotice = t('mobile.stall.abortedNotice')
      const stallShort = t('mobile.stall.abortedShort')
      const aiMsg: ChatMessage = {
        id: Date.now() + 1,
        session_id: sessionId!,
        role: 'assistant',
        content: streamError
          ? `⚠️ ${streamError}`
          : stalled
            ? stripGenerateBlocks(accText) + (accText ? `\n\n*${stallNotice}*` : stallShort)
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
          ? (accText ? stripGenerateBlocks(accText) + `\n\n*${t('mobile.stall.abortedShort')}*` : t('mobile.stall.abortedShort'))
          : `⚠️ ${detail}`,
        created_at: new Date().toISOString(),
      }
      setMessages((p) => [...p, errMsg])
    } finally {
      setStreaming(false)
      setStreamingContent('')
      setStreamingStatus('')
      abortRef.current = null
    }
  }, [streaming, currentSessionId, model, loadSessions, noteChunk, clearStall, t, pureMode, selectedMcpIds, selectedDifyIds, selectedKbIds, pendingSkillIds, skillVarValues])

  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current()
  }, [])

  // 建立分享連結 — 同桌機 POST /share { sessionId }
  const handleShareSession = useCallback(async () => {
    if (!currentSessionId || sharing) return
    setSharing(true)
    try {
      const r = await api.post('/share', { sessionId: currentSessionId })
      setShareLink(`${window.location.origin}/share/${r.data.token}`)
    } catch (e: any) {
      alert(e.response?.data?.error || '分享失敗')
    } finally {
      setSharing(false)
    }
  }, [currentSessionId, sharing])

  const handleCopyShareLink = useCallback(() => {
    if (!shareLink) return
    copyText(shareLink).catch(() => {})
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }, [shareLink])

  // 切 skill checkbox — 若 ON + 有 prompt_variables → 開參數 sheet 先填,確定才加入 picked
  const toggleSkill = useCallback((id: number) => {
    const turnOn = !pickedSkillIds.has(id)
    if (turnOn) {
      const sk = allSkills.find((s) => s.id === id)
      const rawVars = sk?.prompt_variables
      if (sk && rawVars && rawVars !== '[]') {
        try {
          const vars = JSON.parse(rawVars)
          if (Array.isArray(vars) && vars.length > 0) {
            setSkillVarSheet({
              skillId: id,
              skillName: localName(sk),
              variables: vars,
              values: skillVarValues[id] || {},
            })
            return // 等 modal 確定才實際 add
          }
        } catch {}
      }
    }
    // 一般 toggle
    if (currentSessionId) {
      setPickedSkillIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    } else {
      setPendingSkillIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
      setPickedSkillIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    }
    // 取消選取時順便清掉 saved values
    if (!turnOn) {
      setSkillVarValues(prev => { const n = { ...prev }; delete n[id]; return n })
    }
  }, [currentSessionId, pickedSkillIds, allSkills, skillVarValues])

  // 確認 skill var 參數 — 寫入 skillVarValues + 加入 pickedSkillIds
  const confirmSkillVars = useCallback(() => {
    if (!skillVarSheet) return
    const { skillId, variables, values } = skillVarSheet
    // 必填驗證
    const missing = variables.filter((v: any) => v.required && !values[v.name] && values[v.name] !== false && values[v.name] !== 0).map((v: any) => v.label || v.name)
    if (missing.length > 0) {
      alert(`必填:${missing.join('、')}`)
      return
    }
    setSkillVarValues(prev => ({ ...prev, [skillId]: values }))
    if (currentSessionId) {
      setPickedSkillIds(prev => new Set(prev).add(skillId))
    } else {
      setPendingSkillIds(prev => new Set(prev).add(skillId))
      setPickedSkillIds(prev => new Set(prev).add(skillId))
    }
    setSkillVarSheet(null)
  }, [skillVarSheet, currentSessionId])

  // 完成工具選擇 — 若有 session,把 skill 列表 + var 一起 PUT
  const confirmTools = useCallback(async () => {
    if (currentSessionId) {
      setSkillSaving(true)
      try {
        const payload: any = { skill_ids: [...pickedSkillIds] }
        // 只送有填參數的 skill var(避免覆蓋 server 端已存的)
        const varsToSend: Record<number, Record<string, any>> = {}
        for (const sid of pickedSkillIds) {
          if (skillVarValues[sid]) varsToSend[sid] = skillVarValues[sid]
        }
        if (Object.keys(varsToSend).length > 0) payload.skill_variables = varsToSend
        await api.put(`/chat/sessions/${currentSessionId}/skills`, payload)
      } catch (e: any) {
        alert(e.response?.data?.error || t('common.unknownError'))
      } finally {
        setSkillSaving(false)
      }
    }
    setToolsOpen(false)
  }, [currentSessionId, pickedSkillIds, skillVarValues, t])

  // 包一層 send,把 ERP pending context 拼到 message 前面
  const handleSendWithErp = useCallback((text: string, files: File[] = []) => {
    if (erpPendingContext) {
      const combined = `${erpPendingContext}\n\n${text}`
      setErpPendingContext(null)
      void handleSend(combined, files)
    } else {
      void handleSend(text, files)
    }
  }, [erpPendingContext, handleSend])

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

  const currentModelName = availableModels.find((m) => m.key === model)?.name || model || t('mobile.chat.selectModel')
  const currentTitle = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
      ? localTitle(sessions.find((s) => s.id === currentSessionId)!, i18n.language)
      : t('mobile.chat.chatting')
    : 'Cortex'

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-50 overflow-hidden">
      {/* Topbar */}
      <header className="flex items-center gap-2 px-3 h-14 bg-white border-b border-slate-200 pt-safe">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label={t('mobile.chat.openSidebar')}
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
          aria-label={t('mobile.chat.newChat')}
          className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-slate-100 active:bg-slate-200 text-slate-700"
        >
          <Plus size={20} />
        </button>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label={t('mobile.chat.menuLabel')}
          className="relative w-11 h-11 -mr-1 flex items-center justify-center rounded-lg hover:bg-slate-100 active:bg-slate-200 text-slate-700"
        >
          <Settings size={18} />
          {feedbackUnread > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-[10px] text-white font-medium flex items-center justify-center">
              {feedbackUnread > 99 ? '99+' : feedbackUnread}
            </span>
          )}
        </button>
      </header>

      {/* SSE stall banner */}
      {stallReason && lastUserMessageRef.current && (
        <div className="bg-red-50 border-b border-red-200 px-3 py-2 flex items-center gap-2 text-xs text-red-800">
          <span className="flex-1">{stallReason === 'offline' ? t('mobile.stall.offline') : t('mobile.stall.background')}</span>
          <button onClick={handleResendAfterStall} className="text-white bg-red-600 rounded px-2 py-1 font-medium">{t('mobile.stall.resend')}</button>
          <button onClick={clearStall} className="text-red-400 px-1" aria-label={t('common.close')}>✕</button>
        </div>
      )}

      {/* Chat area — flex column,min-h-0 才能讓 ChatWindow overflow-y-auto 正確 scroll */}
      <main className="flex-1 min-h-0 flex flex-col">
        {!currentSessionId && messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
              <Sparkles size={28} className="text-blue-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">{t('mobile.chat.welcomeTitle')}</h2>
            <p className="text-sm text-slate-500">
              {t('mobile.chat.welcomeHint', { name: (user as any)?.name || (user as any)?.username || '' })}
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
              onFeedback={(content: string) => {
                const desc = (content || '').slice(0, 500)
                const params = new URLSearchParams({
                  source: 'chat_page',
                  source_session_id: currentSessionId || '',
                  description: `AI 回覆內容:\n${desc}`,
                  category_id: '',
                })
                navigate(`/feedback/new?${params.toString()}`)
              }}
            />
          </Suspense>
        )}
      </main>

      {/* Input bar */}
      <div className="border-t border-slate-200 bg-white px-2 py-2 pb-safe">
        {/* ERP context chip(ask_with 模式) */}
        {erpPendingContext && (
          <div className="mx-1 mb-1.5 px-3 py-1.5 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-800 flex items-center gap-2">
            <Database size={12} className="flex-shrink-0" />
            <span className="flex-1 truncate">已附加 ERP 查詢結果,下一則訊息會帶上</span>
            <button onClick={() => setErpPendingContext(null)} className="text-sky-500 flex-shrink-0">
              <X size={12} />
            </button>
          </div>
        )}

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
                  aria-label={t('mobile.chat.remove')}
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
            onClick={() => setPlusOpen(true)}
            disabled={streaming}
            aria-label={t('mobile.chat.attachFile')}
            className="w-11 h-11 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 flex-shrink-0"
          >
            <Plus size={20} />
          </button>
          <MicButton
            source="chat"
            disabled={streaming}
            size={18}
            className="w-11 h-11 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 flex-shrink-0"
            onTranscript={(text) => {
              if (!text) return
              setInputText((prev) => {
                const sep = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
                return prev + sep + text
              })
              // 聚焦回 textarea 方便繼續編輯
              setTimeout(() => inputRef.current?.focus(), 50)
            }}
          />
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSendWithErp(inputText, attachments)
              }
            }}
            placeholder={t('mobile.chat.inputPlaceholder')}
            rows={1}
            className="flex-1 resize-none border border-slate-200 rounded-2xl px-4 py-3 max-h-32 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
            style={{ minHeight: '44px' }}
          />
          {streaming ? (
            <button
              onClick={handleStop}
              aria-label={t('mobile.chat.stop')}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white flex-shrink-0"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => handleSendWithErp(inputText, attachments)}
              disabled={!inputText.trim() && attachments.length === 0 && !erpPendingContext}
              aria-label={t('mobile.chat.send')}
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
            <Drawer.Title className="sr-only">{t('mobile.chat.sessions')}</Drawer.Title>
            <div className="flex items-center gap-2 px-4 h-14 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-800 flex-1">{t('mobile.chat.sessions')}</span>
              <button
                onClick={() => { handleNewChat() }}
                className="text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 inline-flex items-center gap-1"
              >
                <Plus size={12} /> {t('mobile.chat.newChat')}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {sessions.length === 0 ? (
                <p className="px-4 py-6 text-xs text-slate-400 text-center">{t('mobile.chat.noSessions')}</p>
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
                        aria-label={t('common.delete')}
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
            <Drawer.Title className="sr-only">{t('mobile.chat.selectModel')}</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2" />
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800">{t('mobile.chat.selectModel')}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {availableModels.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">{t('mobile.chat.noModels')}</p>
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
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl pb-safe max-h-[80vh] flex flex-col">
            <Drawer.Title className="sr-only">{t('mobile.chat.menuLabel')}</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
            <div className="overflow-y-auto p-2">
              {/* 本月 token 消耗 */}
              <div className="px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-100 flex items-center gap-3 mb-1.5">
                <Sparkles size={16} className="text-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-blue-700">{t('tokenStats.monthSpent')}</div>
                  <div className="text-base font-semibold text-blue-900 font-mono">
                    {monthSpent != null ? `$${monthSpent.toFixed(4)}` : '—'}
                    <span className="text-[11px] text-blue-500 font-normal ml-1">USD</span>
                  </div>
                </div>
              </div>

              {/* Pure mode toggle */}
              <button
                onClick={() => { togglePureMode() }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <MessageSquare size={18} className={pureMode ? 'text-amber-600' : 'text-slate-500'} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800">{t('mobile.menu.pureMode')}</div>
                  <div className="text-[11px] text-slate-500 truncate">{t('mobile.menu.pureModeDesc')}</div>
                </div>
                <span
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition ${pureMode ? 'bg-amber-500' : 'bg-slate-300'}`}
                  aria-pressed={pureMode}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${pureMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </span>
              </button>

              <div className="my-1 h-px bg-slate-200" />

              {/* Feature navigation */}
              {currentSessionId && (
                <button
                  onClick={() => { setMenuOpen(false); void handleShareSession() }}
                  disabled={sharing}
                  className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left disabled:opacity-50"
                >
                  <Share2 size={18} className="text-blue-500" />
                  <span className="flex-1 text-sm text-slate-800">{sharing ? '建立中…' : '分享當前對話'}</span>
                </button>
              )}

              <button
                onClick={() => { setMenuOpen(false); navigate('/skills') }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <Zap size={18} className="text-blue-500" />
                <span className="flex-1 text-sm text-slate-800">{t('mobile.menu.skillMarket')}</span>
              </button>
              <button
                onClick={() => { setMenuOpen(false); navigate('/templates') }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <LayoutTemplate size={18} className="text-violet-500" />
                <span className="flex-1 text-sm text-slate-800">{t('mobile.menu.templates')}</span>
              </button>
              <button
                onClick={() => { setMenuOpen(false); navigate('/my-charts') }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <BarChart3 size={18} className="text-emerald-500" />
                <span className="flex-1 text-sm text-slate-800">{t('mobile.menu.myCharts')}</span>
              </button>
              <button
                onClick={() => { setMenuOpen(false); navigate('/feedback') }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <MessageSquarePlus size={18} className="text-rose-500" />
                <span className="flex-1 text-sm text-slate-800">{t('mobile.menu.feedback')}</span>
                {feedbackUnread > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-medium">{feedbackUnread > 99 ? '99+' : feedbackUnread}</span>
                )}
              </button>

              <div className="my-1 h-px bg-slate-200" />

              {/* Settings */}
              <button
                onClick={() => { setShowLang(true); setMenuOpen(false) }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <Globe size={18} className="text-slate-500" />
                <span className="flex-1 text-sm text-slate-800">{t('mobile.menu.language')}</span>
                <span className="text-xs text-slate-500">
                  {SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)?.label || i18n.language}
                </span>
              </button>
              <button
                onClick={() => { setMenuOpen(false); navigate('/help') }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <HelpCircle size={18} className="text-slate-500" />
                <span className="flex-1 text-sm text-slate-800">{t('mobile.menu.help')}</span>
              </button>

              <div className="my-1 h-px bg-slate-200" />

              <button
                onClick={() => { setMenuOpen(false); logout() }}
                className="w-full px-3 py-3 rounded-lg hover:bg-red-50 active:bg-red-100 flex items-center gap-3 text-left"
              >
                <LogOut size={18} className="text-red-500" />
                <span className="flex-1 text-sm text-red-600">{t('mobile.unsupported.logout')}</span>
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
            <Drawer.Title className="sr-only">{t('mobile.menu.language')}</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2" />
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800">{t('mobile.menu.language')}</p>
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

      {/* ── Plus action sheet:上傳檔案 / ERP 工具 ── */}
      <Drawer.Root open={plusOpen} onOpenChange={setPlusOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl pb-safe">
            <Drawer.Title className="sr-only">{t('mobile.chat.attachFile')}</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2" />
            <div className="p-2">
              <button
                onClick={() => { setPlusOpen(false); fileInputRef.current?.click() }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <Paperclip size={18} className="text-blue-500" />
                <span className="flex-1 text-sm text-slate-800">{t('mobile.chat.attachFile')}</span>
              </button>
              <button
                onClick={() => { setPlusOpen(false); openTools() }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <Zap size={18} className="text-cyan-500" />
                <span className="flex-1 text-sm text-slate-800">工具(MCP / KB / API 連接器)</span>
                {totalToolsSelected > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 font-medium">{totalToolsSelected}</span>
                )}
              </button>
              <button
                onClick={() => { setPlusOpen(false); setErpPickerOpen(true) }}
                className="w-full px-3 py-3 rounded-lg hover:bg-slate-50 active:bg-slate-100 flex items-center gap-3 text-left"
              >
                <Database size={18} className="text-amber-500" />
                <span className="flex-1 text-sm text-slate-800">ERP 工具</span>
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* ── Tools picker bottom sheet:MCP / KB / DIFY 三 tab ── */}
      <Drawer.Root open={toolsOpen} onOpenChange={setToolsOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl pb-safe max-h-[85vh] flex flex-col">
            <Drawer.Title className="sr-only">工具選擇</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2 flex-shrink-0" />

            {/* Tabs(橫向 scroll 避擠)*/}
            <div className="px-2 pt-3 pb-2 border-b border-slate-100 flex gap-1 flex-shrink-0 overflow-x-auto">
              {[
                { key: 'mcp' as const,   label: 'MCP',         count: selectedMcpIds.size,  badge: 'bg-cyan-100 text-cyan-700' },
                { key: 'kb' as const,    label: '知識庫',       count: selectedKbIds.size,   badge: 'bg-blue-100 text-blue-700' },
                { key: 'dify' as const,  label: 'API',         count: selectedDifyIds.size, badge: 'bg-amber-100 text-amber-700' },
                { key: 'skill' as const, label: '技能',         count: pickedSkillIds.size,  badge: 'bg-purple-100 text-purple-700' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setToolsTab(tab.key)}
                  className={`flex-1 min-w-[64px] px-2 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                    toolsTab === tab.key ? 'bg-slate-100 text-slate-800' : 'text-slate-500 active:bg-slate-50'
                  }`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tab.badge}`}>{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2">
              {toolsTab === 'mcp' && (
                allMcpServers.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">沒有可用 MCP</p>
                ) : (
                  allMcpServers.map((s: any) => {
                    const picked = selectedMcpIds.has(s.id)
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedMcpIds(prev => { const n = new Set(prev); picked ? n.delete(s.id) : n.add(s.id); return n })}
                        className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left ${picked ? 'bg-cyan-50' : 'active:bg-slate-100'}`}
                      >
                        <span className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${picked ? 'bg-cyan-500 border-cyan-500' : 'border-slate-300'}`}>
                          {picked && <span className="text-white text-xs leading-none">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${picked ? 'text-cyan-800' : 'text-slate-800'}`}>
                            {localName(s)}
                            {isOverrideTool('mcp', s.id) && <span className="ml-1 text-[10px] text-orange-500">⚗</span>}
                          </p>
                          {localDesc(s) && <p className="text-xs text-slate-500 truncate">{localDesc(s)}</p>}
                        </div>
                      </button>
                    )
                  })
                )
              )}
              {toolsTab === 'kb' && (
                allSelfKbs.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">沒有可用知識庫</p>
                ) : (
                  allSelfKbs.map((k: any) => {
                    const id = String(k.id)
                    const picked = selectedKbIds.has(id)
                    return (
                      <button
                        key={id}
                        onClick={() => setSelectedKbIds(prev => { const n = new Set(prev); picked ? n.delete(id) : n.add(id); return n })}
                        className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left ${picked ? 'bg-blue-50' : 'active:bg-slate-100'}`}
                      >
                        <span className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${picked ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                          {picked && <span className="text-white text-xs leading-none">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${picked ? 'text-blue-800' : 'text-slate-800'}`}>
                            {localName(k)}
                            {isOverrideTool('kb', id) && <span className="ml-1 text-[10px] text-orange-500">⚗</span>}
                          </p>
                          {localDesc(k) && <p className="text-xs text-slate-500 truncate">{localDesc(k)}</p>}
                        </div>
                      </button>
                    )
                  })
                )
              )}
              {toolsTab === 'dify' && (
                allDifyKbs.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">沒有可用 API 連接器</p>
                ) : (
                  allDifyKbs.map((d: any) => {
                    const picked = selectedDifyIds.has(d.id)
                    return (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDifyIds(prev => { const n = new Set(prev); picked ? n.delete(d.id) : n.add(d.id); return n })}
                        className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left ${picked ? 'bg-amber-50' : 'active:bg-slate-100'}`}
                      >
                        <span className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${picked ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                          {picked && <span className="text-white text-xs leading-none">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${picked ? 'text-amber-800' : 'text-slate-800'}`}>
                            {localName(d)}
                            {isOverrideTool('dify', d.id) && <span className="ml-1 text-[10px] text-orange-500">⚗</span>}
                          </p>
                          {localDesc(d) && <p className="text-xs text-slate-500 truncate">{localDesc(d)}</p>}
                        </div>
                      </button>
                    )
                  })
                )
              )}
              {toolsTab === 'skill' && (
                allSkills.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">沒有可用技能</p>
                ) : (
                  allSkills.map((s) => {
                    const picked = pickedSkillIds.has(s.id)
                    const hasVars = s.prompt_variables && s.prompt_variables !== '[]'
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSkill(s.id)}
                        className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left ${picked ? 'bg-purple-50' : 'active:bg-slate-100'}`}
                      >
                        <span className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${picked ? 'bg-purple-500 border-purple-500' : 'border-slate-300'}`}>
                          {picked && <span className="text-white text-xs leading-none">✓</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${picked ? 'text-purple-800' : 'text-slate-800'}`}>
                            <span className="mr-1">{s.icon || '🔧'}</span>
                            {localName(s)}
                            {isOverrideTool('skill', s.id) && <span className="ml-1 text-[10px] text-orange-500">⚗</span>}
                            {hasVars && <span className="ml-1 text-[10px] text-amber-600 font-medium">需參數</span>}
                          </p>
                          {localDesc(s) && <p className="text-xs text-slate-500 truncate">{localDesc(s)}</p>}
                        </div>
                      </button>
                    )
                  })
                )
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 p-3 flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  setSelectedMcpIds(new Set())
                  setSelectedKbIds(new Set())
                  setSelectedDifyIds(new Set())
                  setPickedSkillIds(new Set())
                  setPendingSkillIds(new Set())
                }}
                className="flex-1 py-2.5 text-sm text-slate-600 rounded-lg active:bg-slate-100"
              >
                清空
              </button>
              <button
                onClick={confirmTools}
                disabled={skillSaving}
                className="flex-1 py-2.5 text-sm text-white bg-blue-600 rounded-lg active:bg-blue-700 disabled:opacity-50"
              >
                {skillSaving ? '儲存中…' : `完成${totalToolsSelected > 0 ? `(已選 ${totalToolsSelected})` : ''}`}
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* ERP 工具選擇 — 桌機 modal,在手機上 max-w-md 居中也 OK */}
      {erpPickerOpen && (
        <ErpToolPicker
          onPick={(tool) => { setErpPickerOpen(false); setErpInvoking(tool) }}
          onClose={() => setErpPickerOpen(false)}
        />
      )}

      {/* 分享連結 sheet */}
      <Drawer.Root open={!!shareLink} onOpenChange={(o) => { if (!o) { setShareLink(null); setShareCopied(false) } }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[55]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] bg-white rounded-t-2xl pb-safe">
            <Drawer.Title className="sr-only">分享連結</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
            <div className="px-4 pt-3 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <Share2 size={18} className="text-blue-600" />
                <p className="text-sm font-semibold text-slate-800">分享連結已建立</p>
              </div>
              <p className="text-xs text-slate-500 mb-3 leading-5">
                任何登入的使用者都可以透過此連結查看對話快照,並選擇繼續這段對話。<br />
                此快照不會隨原始對話更新,是獨立的分享副本。
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareLink || ''}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-3 bg-slate-50 text-slate-700 truncate min-w-0"
                />
                <button
                  onClick={handleCopyShareLink}
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs text-white bg-blue-600 active:bg-blue-700 rounded-lg px-3 py-3 font-medium"
                >
                  {shareCopied ? <Check size={14} /> : <Copy size={14} />}
                  {shareCopied ? '已複製' : '複製'}
                </button>
              </div>
              {/* native share API(若手機支援) */}
              {typeof navigator !== 'undefined' && (navigator as any).share && (
                <button
                  onClick={() => (navigator as any).share({ title: 'Cortex 對話分享', url: shareLink })}
                  className="w-full mt-3 py-3 text-sm text-blue-600 border border-blue-200 active:bg-blue-50 rounded-lg inline-flex items-center justify-center gap-2"
                >
                  <Share2 size={14} /> 用系統分享面板
                </button>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Skill 參數填寫 sheet */}
      <Drawer.Root open={!!skillVarSheet} onOpenChange={(o) => { if (!o) setSkillVarSheet(null) }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[55]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] bg-white rounded-t-2xl pb-safe max-h-[90vh] flex flex-col">
            <Drawer.Title className="sr-only">技能參數</Drawer.Title>
            <div className="mx-auto w-10 h-1 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
            {skillVarSheet && (
              <>
                <div className="px-4 pt-2 pb-3 border-b border-slate-100 flex-shrink-0">
                  <p className="text-sm font-semibold text-slate-800">
                    技能 <span className="text-purple-600">「{skillVarSheet.skillName}」</span>— 輸入參數
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {skillVarSheet.variables.map((v: any) => (
                    <div key={v.name}>
                      <label className="block text-xs text-slate-500 mb-1">
                        {v.label || v.name} {v.required && <span className="text-red-400">*</span>}
                      </label>
                      {v.type === 'select' ? (
                        <select
                          value={skillVarSheet.values[v.name] ?? v.default ?? ''}
                          onChange={(e) => setSkillVarSheet(prev => prev ? { ...prev, values: { ...prev.values, [v.name]: e.target.value } } : null)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-3 text-sm bg-white focus:outline-none focus:border-purple-400"
                        >
                          <option value="">請選擇</option>
                          {(v.options || []).map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : v.type === 'textarea' ? (
                        <textarea
                          value={skillVarSheet.values[v.name] ?? ''}
                          onChange={(e) => setSkillVarSheet(prev => prev ? { ...prev, values: { ...prev.values, [v.name]: e.target.value } } : null)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm h-24 resize-y focus:outline-none focus:border-purple-400"
                          placeholder={v.placeholder}
                        />
                      ) : v.type === 'checkbox' ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!skillVarSheet.values[v.name]}
                            onChange={(e) => setSkillVarSheet(prev => prev ? { ...prev, values: { ...prev.values, [v.name]: e.target.checked } } : null)}
                            className="w-5 h-5"
                          />
                          <span className="text-sm text-slate-700">{v.placeholder || (v.label || v.name)}</span>
                        </label>
                      ) : (
                        <input
                          type={v.type === 'number' ? 'number' : v.type === 'date' ? 'date' : 'text'}
                          value={skillVarSheet.values[v.name] ?? ''}
                          onChange={(e) => setSkillVarSheet(prev => prev ? { ...prev, values: { ...prev.values, [v.name]: e.target.value } } : null)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-purple-400"
                          placeholder={v.placeholder}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-100 p-3 flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setSkillVarSheet(null)}
                    className="flex-1 py-2.5 text-sm text-slate-600 rounded-lg active:bg-slate-100"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={confirmSkillVars}
                    className="flex-1 py-2.5 text-sm text-white bg-purple-600 rounded-lg active:bg-purple-700"
                  >
                    確定
                  </button>
                </div>
              </>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* ERP 工具參數填寫 + 執行 */}
      {erpInvoking && (
        <ErpToolInvokeModal
          tool={erpInvoking}
          sessionId={currentSessionId || null}
          onClose={() => setErpInvoking(null)}
          onDone={({ mode, tool, inputs, result, cache_key }: { mode: ResultMode; tool: ErpTool; inputs: Record<string, any>; result: any; cache_key: string | null }) => {
            setErpInvoking(null)
            const resultJson = '```json\n' + JSON.stringify(result, null, 2).slice(0, 8000) + '\n```'
            const inputsJson = Object.keys(inputs || {}).length
              ? '\n參數:\n```json\n' + JSON.stringify(inputs, null, 2) + '\n```'
              : ''

            if (mode === 'view') {
              if (!currentSessionId) return
              const content = `**ERP 工具結果:${tool.name}** (\`${tool.code}\`)${inputsJson}\n\n結果:\n${resultJson}${cache_key ? `\n\n_完整結果 key: \`${cache_key}\`_` : ''}`
              setMessages((prev) => [...prev, {
                id: Date.now(),
                session_id: currentSessionId,
                role: 'assistant',
                content,
                created_at: new Date().toISOString(),
              } as ChatMessage])
            } else if (mode === 'ai_explain') {
              const msg = `我剛才呼叫了 ERP 工具「${tool.name}」(${tool.code})${inputsJson}\n\n結果:\n${resultJson}\n\n請用繁體中文解釋這份資料的含義。`
              void handleSend(msg, [])
            } else if (mode === 'ask_with') {
              const ctx = `[參考資料] ERP 工具 ${tool.code} 的執行結果:${inputsJson}\n${resultJson}`
              setErpPendingContext(ctx)
            }
          }}
        />
      )}
    </div>
  )
}
