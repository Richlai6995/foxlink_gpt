import { useState, useEffect, useRef } from 'react'
import { Plus, MessageSquare, Trash2, Pencil, Check, ChevronDown, LogOut, Settings, Cpu, Zap, CalendarClock, HelpCircle, KeyRound, X, Eye, EyeOff, GitFork, Sparkles, Database, Menu, ChevronUp, BarChart3, Globe, FileText, GraduationCap, BookOpen, TicketCheck, PanelLeftClose, PanelLeft, SquarePen, UserCog, Star } from 'lucide-react'
import ImpersonateDialog from './ImpersonateDialog'
import ThemePicker from './ThemePicker'
import type { ChatSession, ModelType, LlmModel } from '../types'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type LangCode } from '../i18n'
import { useFeedbackNotifications } from '../hooks/useFeedbackNotifications'

interface Props {
  sessions: ChatSession[]
  currentSessionId: string | null
  model: ModelType
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onModelChange: (m: ModelType) => void
  reasoningEffort?: string
  onReasoningEffortChange?: (v: string) => void
  onRenameSession?: (id: string, title: string, titleZh: string, titleEn: string, titleVi: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

function groupSessions(sessions: ChatSession[], t: (k: string) => string) {
  const now = new Date()
  const today = now.toDateString()
  const yesterday = new Date(now.getTime() - 86400000).toDateString()
  const last7 = new Date(now.getTime() - 7 * 86400000)

  const groups: { label: string; items: ChatSession[] }[] = [
    { label: t('sidebar.today'), items: [] },
    { label: t('sidebar.yesterday'), items: [] },
    { label: t('sidebar.last7days'), items: [] },
    { label: t('sidebar.earlier'), items: [] },
  ]

  sessions.forEach((s) => {
    const d = new Date(s.updated_at)
    if (d.toDateString() === today) groups[0].items.push(s)
    else if (d.toDateString() === yesterday) groups[1].items.push(s)
    else if (d > last7) groups[2].items.push(s)
    else groups[3].items.push(s)
  })

  return groups.filter((g) => g.items.length > 0)
}

export default function Sidebar({
  sessions,
  currentSessionId,
  model,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  onRenameSession,
  collapsed,
  onToggleCollapse,
}: Props) {
  const { user, logout, isAdmin, canSchedule, canCreateKb, canUseDashboard, canAccessTrainingDev, setLanguage, impersonation, exitImpersonate, refreshImpersonation } = useAuth()
  const [showImpersonate, setShowImpersonate] = useState(false)
  const [exitingImp, setExitingImp] = useState(false)

  const handleExitImpersonate = async () => {
    if (exitingImp) return
    setExitingImp(true)
    try {
      await exitImpersonate()
    } catch (e: any) {
      const status = e?.response?.status
      const msg = e?.response?.data?.error
      // 前後端 state 不一致(server 已不在模擬,但前端按鈕還顯示):靜默修復,不嚇使用者
      if (status === 400 && typeof msg === 'string' && msg.includes('不在模擬中')) {
        await refreshImpersonation()
        setExitingImp(false)
        return
      }
      alert(msg || t('sidebar.impersonateExitFailed'))
      setExitingImp(false)
    }
  }
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { unreadCount: feedbackUnread } = useFeedbackNotifications()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [renamingSessions, setRenamingSessions] = useState<Set<string>>(new Set())
  const editInputRef = useRef<HTMLInputElement>(null)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [llmModels, setLlmModels] = useState<LlmModel[]>([])
  const [showMenu, setShowMenu] = useState(false)
  const [showLangMenu, setShowLangMenu] = useState(false)

  // Import share modal
  const [showImport, setShowImport] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    setImportError('')
    const m = importUrl.match(/\/share\/([a-f0-9-]+)/i)
    const token = m ? m[1] : importUrl.trim()
    if (!token) return setImportError(t('sidebar.importInvalidToken'))
    setImporting(true)
    try {
      const res = await api.post(`/share/${token}/fork`)
      setShowImport(false)
      setImportUrl('')
      navigate(`/chat?session=${res.data.sessionId}`)
    } catch (err: unknown) {
      setImportError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('sidebar.importError'))
    } finally {
      setImporting(false)
    }
  }

  // Change password modal
  const [showChangePw, setShowChangePw] = useState(false)
  const [pwForm, setPwForm] = useState({ old: '', newPw: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')

  const isManualAccount = (user as any)?.creation_method !== 'ldap'

  const handleChangePw = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwForm.newPw !== pwForm.confirm) return setPwError(t('sidebar.passwordMismatch'))
    if (pwForm.newPw.length < 6) return setPwError(t('sidebar.passwordTooShort'))
    setPwLoading(true)
    setPwError('')
    setPwMsg('')
    try {
      await api.post('/auth/change-password', { old_password: pwForm.old, new_password: pwForm.newPw })
      setPwMsg(t('sidebar.passwordUpdated'))
      setPwForm({ old: '', newPw: '', confirm: '' })
    } catch (err: unknown) {
      setPwError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('sidebar.updateFailed'))
    } finally {
      setPwLoading(false)
    }
  }

  const closePwModal = () => {
    setShowChangePw(false)
    setPwForm({ old: '', newPw: '', confirm: '' })
    setPwMsg('')
    setPwError('')
  }

  useEffect(() => {
    api.get('/chat/models').then((r) => setLlmModels(r.data)).catch(() => { })
  }, [])

  const startRename = (s: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(s.id)
    setEditingTitle(sessionTitle(s) || s.title || '')
    setTimeout(() => editInputRef.current?.select(), 50)
  }

  const submitRename = async (id: string) => {
    const newTitle = editingTitle.trim()
    setEditingId(null)
    if (!newTitle) return
    const orig = sessions.find((s) => s.id === id)
    if (newTitle === sessionTitle(orig!)) return
    setRenamingSessions((prev) => new Set(prev).add(id))
    try {
      const { data } = await api.patch(`/chat/sessions/${id}/title`, { title: newTitle })
      onRenameSession?.(id, data.title, data.title_zh, data.title_en, data.title_vi)
    } catch (_) { /* ignore */ } finally {
      setRenamingSessions((prev) => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const handleLangChange = async (lang: LangCode) => {
    setShowLangMenu(false)
    await setLanguage(lang)
  }

  const currentModelInfo = llmModels.find((m) => m.key === model)
  const groups = groupSessions(sessions, t)

  const sessionTitle = (s: ChatSession) => {
    if (i18n.language === 'en') return s.title_en || s.title
    if (i18n.language === 'vi') return s.title_vi || s.title
    return s.title_zh || s.title
  }

  // Cycle language: zh-TW → en → vi → zh-TW
  const cycleLang = () => {
    const codes = SUPPORTED_LANGUAGES.map(l => l.code)
    const idx = codes.indexOf(i18n.language as LangCode)
    const next = codes[(idx + 1) % codes.length]
    handleLangChange(next as LangCode)
  }

  const langLabel = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language)?.label || i18n.language

  // ─── Collapsed icon rail ───
  if (collapsed) {
    return (
      <div data-region="sidebar" className="fixed inset-y-0 left-0 w-16 bg-slate-900 flex flex-col items-center border-r border-slate-800 z-30 py-3 gap-1 transition-all duration-300">
        {/* Toggle open */}
        <button
          onClick={onToggleCollapse}
          className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          title={t('sidebar.moreFeatures')}
        >
          <PanelLeft size={20} />
        </button>

        {/* New chat */}
        <button
          onClick={onNewChat}
          className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition mt-1"
          title={t('sidebar.newChat')}
        >
          <SquarePen size={20} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Language cycle */}
        <button
          onClick={cycleLang}
          className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          title={langLabel}
        >
          <Globe size={18} />
        </button>

        {/* User avatar */}
        <div
          className="w-8 h-8 bg-blue-700 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-default"
          title={user?.name || user?.username || ''}
        >
          {(user?.name || user?.username || '?').charAt(0).toUpperCase()}
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-red-400 transition"
          title={t('sidebar.logout')}
        >
          <LogOut size={18} />
        </button>
      </div>
    )
  }

  // ─── Expanded sidebar ───
  return (
    <div data-region="sidebar" className="fixed inset-y-0 left-0 w-72 bg-slate-900 flex flex-col border-r border-slate-800 z-30 transition-all duration-300">
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={onToggleCollapse}
            className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition flex-shrink-0"
            title="收合側邊欄"
          >
            <PanelLeftClose size={18} />
          </button>
          <img src="/favicon.png" alt="Cortex" className="w-8 h-8 object-contain flex-shrink-0" />
          <span className="text-white font-bold text-lg">Cortex</span>
        </div>

        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
        >
          <Plus size={16} />
          {t('sidebar.newChat')}
        </button>
      </div>

      {/* Model Selector */}
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="relative">
          <button
            onClick={() => setShowModelMenu((v) => !v)}
            className="w-full flex items-center justify-between bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs transition"
          >
            <div className="flex items-center gap-2">
              {model === 'flash' ? (
                <Zap size={14} className="text-yellow-400" />
              ) : (
                <Cpu size={14} className="text-blue-400" />
              )}
              <span>{currentModelInfo?.name || model}</span>
            </div>
            <ChevronDown size={14} />
          </button>

          {showModelMenu && llmModels.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden z-10 shadow-xl">
              {llmModels.map((m) => (
                <button
                  key={m.key}
                  onClick={() => { onModelChange(m.key); setShowModelMenu(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs transition hover:bg-slate-700 ${model === m.key
                    ? m.key === 'flash' ? 'text-yellow-400' : 'text-blue-400'
                    : 'text-slate-300'
                    }`}
                >
                  {m.key === 'flash' ? (
                    <Zap size={14} className="text-yellow-400 flex-shrink-0" />
                  ) : (
                    <Cpu size={14} className="text-blue-400 flex-shrink-0" />
                  )}
                  <div className="text-left">
                    <div className="font-medium">{m.name}</div>
                    {m.description && <div className="text-slate-500">{m.description}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reasoning Effort selector — Azure OpenAI GPT-5.x/o-series + Gemini 3.x(排除 image gen) */}
        {((currentModelInfo?.provider_type === 'azure_openai') ||
          (currentModelInfo?.provider_type === 'gemini'
            && /gemini-3/i.test(currentModelInfo?.api_model || '')
            && !currentModelInfo?.image_output
            && !/image/i.test(currentModelInfo?.api_model || ''))
        ) && onReasoningEffortChange && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 whitespace-nowrap">{t('sidebar.reasoning')}</span>
            <div className="flex gap-0.5 flex-1">
              {[
                { value: '', label: t('sidebar.reasoningDefault') },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Med' },
                { value: 'high', label: 'High' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onReasoningEffortChange(opt.value)}
                  className={`flex-1 text-[10px] py-0.5 rounded transition ${
                    (reasoningEffort || '') === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 ? (
          <p className="text-slate-600 text-xs text-center py-8">{t('sidebar.noHistory')}</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="text-slate-600 text-xs px-4 py-1 font-medium">{group.label}</p>
              {group.items.map((s) => (
                <div
                  key={s.id}
                  className={`relative mx-2 rounded-lg transition cursor-pointer ${currentSessionId === s.id
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => editingId !== s.id && onSelectSession(s.id)}
                >
                  <div className="flex items-center gap-1.5 px-3 py-2">
                    <MessageSquare size={14} className="flex-shrink-0 opacity-60 shrink-0" />
                    {editingId === s.id ? (
                      <input
                        ref={editInputRef}
                        className="flex-1 min-w-0 text-xs bg-slate-600 text-white rounded px-1.5 py-0.5 outline-none border border-blue-400"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitRename(s.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => submitRename(s.id)}
                        onClick={(e) => e.stopPropagation()}
                        maxLength={100}
                        autoFocus
                      />
                    ) : (
                      <span className="text-xs truncate flex-1 min-w-0">
                        {renamingSessions.has(s.id) ? '...' : (sessionTitle(s) || t('sidebar.newSession'))}
                      </span>
                    )}
                    {hoveredId === s.id && editingId !== s.id && (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={(e) => startRename(s, e)}
                          className="text-slate-500 hover:text-blue-400 transition p-0.5"
                          title="重命名"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id) }}
                          className="text-slate-500 hover:text-red-400 transition p-0.5"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                    {editingId === s.id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); submitRename(s.id) }}
                        className="text-blue-400 hover:text-blue-300 transition flex-shrink-0 p-0.5"
                      >
                        <Check size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-800 space-y-2">
        {/* More menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(v => !v)}
            className="w-full flex items-center gap-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 px-3 py-2 rounded-lg text-xs transition"
          >
            <Menu size={14} />
            <span className="flex-1 text-left">{t('sidebar.moreFeatures')}</span>
            {showMenu ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showMenu && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-2xl z-10">
              <button
                onClick={() => { setShowMenu(false); setShowImport(true); setImportError('') }}
                className="w-full flex items-center gap-2 text-slate-300 hover:bg-slate-700 px-3 py-2.5 text-xs transition"
              >
                <GitFork size={13} className="text-blue-400" />
                {t('sidebar.importShare')}
              </button>
              {isAdmin && (
                <button onClick={() => { setShowMenu(false); navigate('/admin') }}
                  className="w-full flex items-center gap-2 text-amber-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <Settings size={13} /> {t('sidebar.systemAdmin')}
                </button>
              )}
              {canSchedule && (
                <button onClick={() => { setShowMenu(false); navigate('/scheduled-tasks') }}
                  className="w-full flex items-center gap-2 text-cyan-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <CalendarClock size={13} /> {t('sidebar.scheduledTasks')}
                </button>
              )}
              <button onClick={() => { setShowMenu(false); navigate('/skills') }}
                className="w-full flex items-center gap-2 text-purple-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                <Sparkles size={13} /> {t('sidebar.skillMarket')}
              </button>
              {(canCreateKb || isAdmin) && (
                <button onClick={() => { setShowMenu(false); navigate('/kb') }}
                  className="w-full flex items-center gap-2 text-teal-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <Database size={13} /> {t('sidebar.kbMarket')}
                </button>
              )}
              {(canUseDashboard || isAdmin) && (
                <button onClick={() => { setShowMenu(false); navigate('/dashboard') }}
                  className="w-full flex items-center gap-2 text-orange-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <BarChart3 size={13} /> {t('sidebar.aiDashboard')}
                </button>
              )}
              <button onClick={() => { setShowMenu(false); navigate('/templates') }}
                className="w-full flex items-center gap-2 text-indigo-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                <FileText size={13} /> {t('tpl.sidebar')}
              </button>
              <button onClick={() => { setShowMenu(false); navigate('/my-charts') }}
                className="w-full flex items-center gap-2 text-amber-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                <Star size={13} /> {t('chart.library.sidebar', '我的圖庫')}
              </button>
              {canAccessTrainingDev && (
                <button onClick={() => { setShowMenu(false); navigate('/training/dev') }}
                  className="w-full flex items-center gap-2 text-sky-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <BookOpen size={13} /> {t('sidebar.trainingDev')}
                </button>
              )}
              <button onClick={() => { setShowMenu(false); navigate('/training/classroom') }}
                className="w-full flex items-center gap-2 text-cyan-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                <GraduationCap size={13} /> {t('sidebar.trainingClassroom')}
              </button>
              <button onClick={() => { setShowMenu(false); navigate('/feedback') }}
                className="w-full flex items-center gap-2 text-rose-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                <TicketCheck size={13} />
                <span className="flex-1 text-left">{t('sidebar.feedback')}</span>
                {feedbackUnread > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {feedbackUnread > 99 ? '99+' : feedbackUnread}
                  </span>
                )}
              </button>
              <button onClick={() => { setShowMenu(false); navigate('/help') }}
                className="w-full flex items-center gap-2 text-emerald-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                <HelpCircle size={13} /> {t('sidebar.helpDoc')}
              </button>
            </div>
          )}
        </div>

        {/* Language Switcher */}
        <div className="relative">
          <button
            onClick={() => setShowLangMenu(v => !v)}
            className="w-full flex items-center gap-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 px-3 py-2 rounded-lg text-xs transition"
          >
            <Globe size={14} />
            <span className="flex-1 text-left">{t('lang.switchLang')} — {SUPPORTED_LANGUAGES.find(l => l.code === i18n.language)?.label || i18n.language}</span>
            {showLangMenu ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showLangMenu && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-2xl z-10">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleLangChange(lang.code as LangCode)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs transition hover:bg-slate-700 ${i18n.language === lang.code ? 'text-blue-400 font-medium' : 'text-slate-300'}`}
                >
                  {lang.label}
                  {i18n.language === lang.code && <span className="ml-auto text-blue-400">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-700 rounded-full flex items-center justify-center text-white text-xs font-bold">
              {(user?.name || user?.username || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-slate-300 text-xs font-medium truncate max-w-[110px]">
                {user?.name || user?.username}
              </p>
              {user?.employee_id && (
                <p className="text-slate-600 text-xs">{user.employee_id}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemePicker title={t('sidebar.theme', '切換主題')} />
            {isAdmin && !impersonation && (
              <button
                onClick={() => setShowImpersonate(true)}
                title={t('sidebar.impersonate')}
                className="text-slate-500 hover:text-amber-400 transition"
              >
                <UserCog size={15} />
              </button>
            )}
            {impersonation && (
              <button
                onClick={handleExitImpersonate}
                disabled={exitingImp}
                title={t('sidebar.impersonateBanner', {
                  target: impersonation.target_name || impersonation.target_username,
                  origin: impersonation.original_username,
                })}
                className="text-amber-400 hover:text-amber-300 transition disabled:opacity-50 animate-pulse"
              >
                <LogOut size={15} />
              </button>
            )}
            <button
              onClick={() => setShowChangePw(true)}
              title={isManualAccount ? t('sidebar.changePassword') : t('sidebar.adPasswordNote')}
              className="text-slate-500 hover:text-yellow-400 transition"
            >
              <KeyRound size={15} />
            </button>
            <button
              onClick={logout}
              title={t('sidebar.logout')}
              className="text-slate-500 hover:text-red-400 transition"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Import Share Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-white font-semibold">
                <GitFork size={16} className="text-blue-400" />
                {t('sidebar.importShareTitle')}
              </div>
              <button onClick={() => setShowImport(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-slate-400 text-xs mb-4">{t('sidebar.importShareDesc')}</p>
            <form onSubmit={handleImport} className="space-y-3">
              <input
                type="text"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                placeholder={t('sidebar.importSharePlaceholder')}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition placeholder-slate-600"
                autoFocus
              />
              {importError && <p className="text-red-400 text-xs">{importError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowImport(false)} className="flex-1 py-2 rounded-lg text-slate-400 hover:text-white border border-white/10 text-sm transition">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={importing} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition">
                  {importing ? t('sidebar.importing') : t('sidebar.importBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showChangePw && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-white font-semibold">
                <KeyRound size={16} className="text-yellow-400" />
                {t('sidebar.changePwTitle')}
              </div>
              <button onClick={closePwModal} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            {!isManualAccount ? (
              <div className="space-y-3">
                <div className="bg-amber-500/20 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-sm">
                  {t('sidebar.adPwNote')}
                </div>
                <button type="button" onClick={closePwModal} className="w-full py-2 rounded-lg text-slate-400 hover:text-white border border-white/10 text-sm transition">
                  {t('common.close')}
                </button>
              </div>
            ) : pwMsg ? (
              <div className="bg-green-500/20 border border-green-500/30 rounded-xl px-4 py-3 text-green-300 text-sm mb-4">
                {pwMsg}
              </div>
            ) : null}
            {isManualAccount && <form onSubmit={handleChangePw} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">{t('sidebar.oldPassword')}</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwForm.old}
                  onChange={e => setPwForm(p => ({ ...p, old: e.target.value }))}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">{t('sidebar.newPassword')}</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pwForm.newPw}
                    onChange={e => setPwForm(p => ({ ...p, newPw: e.target.value }))}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 pr-10 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                    placeholder={t('sidebar.newPasswordPlaceholder')}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">{t('sidebar.confirmNewPassword')}</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwForm.confirm}
                  onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                  required
                />
              </div>
              {pwError && <p className="text-red-400 text-xs">{pwError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={closePwModal} className="flex-1 py-2 rounded-lg text-slate-400 hover:text-white border border-white/10 text-sm transition">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={pwLoading} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition">
                  {pwLoading ? t('sidebar.updating') : t('sidebar.confirmChange')}
                </button>
              </div>
            </form>}
          </div>
        </div>
      )}

      {showImpersonate && (
        <ImpersonateDialog onClose={() => setShowImpersonate(false)} />
      )}
    </div>
  )
}
