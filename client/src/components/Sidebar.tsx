import { useState, useEffect } from 'react'
import { Plus, MessageSquare, Trash2, ChevronDown, LogOut, Settings, Cpu, Zap, CalendarClock, HelpCircle, KeyRound, X, Eye, EyeOff, GitFork, Sparkles, Database, Menu, ChevronUp, BarChart3 } from 'lucide-react'
import type { ChatSession, ModelType, LlmModel } from '../types'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

interface Props {
  sessions: ChatSession[]
  currentSessionId: string | null
  model: ModelType
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onModelChange: (m: ModelType) => void
}

function groupSessions(sessions: ChatSession[]) {
  const now = new Date()
  const today = now.toDateString()
  const yesterday = new Date(now.getTime() - 86400000).toDateString()
  const last7 = new Date(now.getTime() - 7 * 86400000)

  const groups: { label: string; items: ChatSession[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '過去 7 天', items: [] },
    { label: '更早', items: [] },
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
}: Props) {
  const { user, logout, isAdmin, canSchedule, canCreateKb, canUseDashboard } = useAuth()
  const navigate = useNavigate()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [llmModels, setLlmModels] = useState<LlmModel[]>([])
  const [showMenu, setShowMenu] = useState(false)

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
    if (!token) return setImportError('請輸入有效的分享連結或 token')
    setImporting(true)
    try {
      const res = await api.post(`/share/${token}/fork`)
      setShowImport(false)
      setImportUrl('')
      navigate(`/chat?session=${res.data.sessionId}`)
    } catch (err: unknown) {
      setImportError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '匯入失敗，請確認連結是否正確')
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
    if (pwForm.newPw !== pwForm.confirm) return setPwError('兩次密碼不一致')
    if (pwForm.newPw.length < 6) return setPwError('新密碼至少 6 個字元')
    setPwLoading(true)
    setPwError('')
    setPwMsg('')
    try {
      await api.post('/auth/change-password', { old_password: pwForm.old, new_password: pwForm.newPw })
      setPwMsg('密碼已成功更新')
      setPwForm({ old: '', newPw: '', confirm: '' })
    } catch (err: unknown) {
      setPwError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '更新失敗')
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

  const currentModelInfo = llmModels.find((m) => m.key === model)
  const groups = groupSessions(sessions)

  return (
    <div className="w-72 bg-slate-900 flex flex-col h-full border-r border-slate-800">
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <img src="/favicon.png" alt="FOXLINK GPT" className="w-8 h-8 object-contain flex-shrink-0" />
          <span className="text-white font-bold text-lg">FOXLINK GPT</span>
        </div>

        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
        >
          <Plus size={16} />
          新對話
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
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 ? (
          <p className="text-slate-600 text-xs text-center py-8">還沒有對話紀錄</p>
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
                  onClick={() => onSelectSession(s.id)}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <MessageSquare size={14} className="flex-shrink-0 opacity-60" />
                    <span className="text-xs truncate flex-1">{s.title || '新對話'}</span>
                    {hoveredId === s.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteSession(s.id)
                        }}
                        className="text-slate-500 hover:text-red-400 transition flex-shrink-0"
                      >
                        <Trash2 size={13} />
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
            <span className="flex-1 text-left">更多功能</span>
            {showMenu ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showMenu && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-2xl z-10">
              <button
                onClick={() => { setShowMenu(false); setShowImport(true); setImportError('') }}
                className="w-full flex items-center gap-2 text-slate-300 hover:bg-slate-700 px-3 py-2.5 text-xs transition"
              >
                <GitFork size={13} className="text-blue-400" />
                匯入分享對話
              </button>
              {isAdmin && (
                <button onClick={() => { setShowMenu(false); navigate('/admin') }}
                  className="w-full flex items-center gap-2 text-amber-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <Settings size={13} /> 系統管理
                </button>
              )}
              {canSchedule && (
                <button onClick={() => { setShowMenu(false); navigate('/scheduled-tasks') }}
                  className="w-full flex items-center gap-2 text-cyan-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <CalendarClock size={13} /> 排程任務
                </button>
              )}
              <button onClick={() => { setShowMenu(false); navigate('/skills') }}
                className="w-full flex items-center gap-2 text-purple-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                <Sparkles size={13} /> 技能市集
              </button>
              {(canCreateKb || isAdmin) && (
                <button onClick={() => { setShowMenu(false); navigate('/kb') }}
                  className="w-full flex items-center gap-2 text-teal-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <Database size={13} /> 知識庫市集
                </button>
              )}
              {(canUseDashboard || isAdmin) && (
                <button onClick={() => { setShowMenu(false); navigate('/dashboard') }}
                  className="w-full flex items-center gap-2 text-orange-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                  <BarChart3 size={13} /> AI 戰情
                </button>
              )}
              <button onClick={() => { setShowMenu(false); navigate('/help') }}
                className="w-full flex items-center gap-2 text-emerald-400 hover:bg-slate-700 px-3 py-2.5 text-xs transition font-medium">
                <HelpCircle size={13} /> 使用說明書
              </button>
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
            <button
              onClick={() => setShowChangePw(true)}
              title={isManualAccount ? '變更密碼' : 'AD 網域帳號密碼管理'}
              className="text-slate-500 hover:text-yellow-400 transition"
            >
              <KeyRound size={15} />
            </button>
            <button
              onClick={logout}
              title="登出"
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
                匯入分享對話
              </div>
              <button onClick={() => setShowImport(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-slate-400 text-xs mb-4">貼上收到的分享連結，系統將複製一份對話到您的帳號。</p>
            <form onSubmit={handleImport} className="space-y-3">
              <input
                type="text"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                placeholder="貼上分享連結或 token"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition placeholder-slate-600"
                autoFocus
              />
              {importError && <p className="text-red-400 text-xs">{importError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowImport(false)} className="flex-1 py-2 rounded-lg text-slate-400 hover:text-white border border-white/10 text-sm transition">
                  取消
                </button>
                <button type="submit" disabled={importing} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition">
                  {importing ? '匯入中...' : '匯入'}
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
                變更密碼
              </div>
              <button onClick={closePwModal} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            {!isManualAccount ? (
              <div className="space-y-3">
                <div className="bg-amber-500/20 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-sm">
                  本系統無法進行AD密碼變更，請由AD管理介面進行密碼變更。
                </div>
                <button type="button" onClick={closePwModal} className="w-full py-2 rounded-lg text-slate-400 hover:text-white border border-white/10 text-sm transition">
                  關閉
                </button>
              </div>
            ) : pwMsg ? (
              <div className="bg-green-500/20 border border-green-500/30 rounded-xl px-4 py-3 text-green-300 text-sm mb-4">
                {pwMsg}
              </div>
            ) : null}
            {isManualAccount && <form onSubmit={handleChangePw} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">舊密碼</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwForm.old}
                  onChange={e => setPwForm(p => ({ ...p, old: e.target.value }))}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">新密碼</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pwForm.newPw}
                    onChange={e => setPwForm(p => ({ ...p, newPw: e.target.value }))}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 pr-10 text-white text-sm focus:outline-none focus:border-blue-500 transition"
                    placeholder="至少 6 個字元"
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
                <label className="block text-xs font-medium text-slate-400 mb-1">確認新密碼</label>
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
                  取消
                </button>
                <button type="submit" disabled={pwLoading} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition">
                  {pwLoading ? '更新中...' : '確認變更'}
                </button>
              </div>
            </form>}
          </div>
        </div>
      )}
    </div>
  )
}
