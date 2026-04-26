import { useEffect, useState } from 'react'
import {
  Plus, RefreshCw, Trash2, Edit2, ChevronDown, ChevronRight,
  Plug, ToggleLeft, ToggleRight, AlertCircle, CheckCircle, Clock, Share2, Globe, ShieldCheck,
  KeyRound, Download, Copy, Check
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'
import TranslationFields, { type TranslationData } from '../common/TranslationFields'
import TagInput from '../common/TagInput'
import ShareModal from '../dashboard/ShareModal'

type TransportType = 'http-post' | 'http-sse' | 'streamable-http' | 'stdio' | 'auto'

interface McpServer {
  id: number
  name: string
  url: string | null
  api_key: string | null
  description: string | null
  is_active: number
  is_public: number
  public_approved: number
  send_user_token: number
  response_mode: 'inject' | 'answer' | null
  transport_type: TransportType | null
  command: string | null
  args_json: string | null
  env_json: string | null
  tools_json: string | null
  server_instructions: string | null
  last_synced_at: string | null
  created_at: string
  tags: string | null
  updated_at: string
  // tool-artifact-passthrough
  passthrough_enabled?: number
  passthrough_max_bytes?: number
  passthrough_mime_whitelist?: string | null
}

interface McpTool {
  name: string
  description?: string
  inputSchema?: object
}

interface McpCallLog {
  id: number
  tool_name: string
  arguments_json: string | null
  response_preview: string | null
  status: string
  error_msg: string | null
  duration_ms: number | null
  called_at: string
  user_name: string | null
  session_id: string | null
}

const TRANSPORT_TYPES: TransportType[] = ['http-post', 'http-sse', 'streamable-http', 'stdio', 'auto']

const emptyForm = {
  name: '', url: '', api_key: '', description: '', is_active: true, is_public: false,
  send_user_token: false,
  response_mode: 'inject' as 'inject' | 'answer',
  transport_type: 'http-post' as TransportType,
  command: '', args_json: '', env_json: '',
  // tool-artifact-passthrough
  passthrough_enabled: false,
  passthrough_max_kb: 500,        // UI 用 KB,送 server 時 *1024
  passthrough_md: true,
  passthrough_html: true,
}

export default function MCPServersPanel() {
  const { t, i18n } = useTranslation()

  const localName = (s: McpServer) => {
    if (i18n.language === 'en') return (s as any).name_en || s.name
    if (i18n.language === 'vi') return (s as any).name_vi || s.name
    return (s as any).name_zh || s.name
  }
  const localDesc = (s: McpServer) => {
    if (i18n.language === 'en') return (s as any).desc_en || s.description
    if (i18n.language === 'vi') return (s as any).desc_vi || s.description
    return (s as any).desc_zh || s.description
  }
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [trans, setTrans] = useState<TranslationData>({})
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncMsg, setSyncMsg] = useState<Record<number, string>>({})
  const [selectedLogServer, setSelectedLogServer] = useState<McpServer | null>(null)
  const [logs, setLogs] = useState<McpCallLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [shareServer, setShareServer] = useState<McpServer | null>(null)
  const [tags, setTags] = useState<string[]>([])

  // ── MCP User Identity (RS256 JWT) test tools ─────────────────────────────
  const [pubKeyBusy, setPubKeyBusy] = useState(false)
  const [pubKeyCopied, setPubKeyCopied] = useState(false)
  const [pubKeyErr, setPubKeyErr] = useState('')
  const [testTokenOpen, setTestTokenOpen] = useState(false)
  const [testForm, setTestForm] = useState({ email: '', name: '', sub: '', dept: '' })
  const [testTokenBusy, setTestTokenBusy] = useState(false)
  const [testTokenErr, setTestTokenErr] = useState('')
  const [testTokenResult, setTestTokenResult] = useState<{ token: string; jti: string; claims: any } | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)

  const downloadPublicKey = async () => {
    setPubKeyErr(''); setPubKeyBusy(true)
    try {
      const res = await api.get('/mcp-servers/public-key')
      const blob = new Blob([res.data.pem], { type: 'application/x-pem-file' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'foxlink-gpt-public.pem'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      setPubKeyErr(e.response?.data?.detail || e.response?.data?.error || t('mcp.form.publicKeyNotConfigured'))
    } finally { setPubKeyBusy(false) }
  }

  const copyPublicKey = async () => {
    setPubKeyErr('')
    try {
      const res = await api.get('/mcp-servers/public-key')
      await navigator.clipboard.writeText(res.data.pem)
      setPubKeyCopied(true)
      setTimeout(() => setPubKeyCopied(false), 2000)
    } catch (e: any) {
      setPubKeyErr(e.response?.data?.detail || e.response?.data?.error || t('mcp.form.publicKeyNotConfigured'))
    }
  }

  const openTestTokenModal = () => {
    setTestForm({ email: '', name: '', sub: '', dept: '' })
    setTestTokenResult(null)
    setTestTokenErr('')
    setTestTokenOpen(true)
  }

  const generateTestToken = async () => {
    setTestTokenErr(''); setTestTokenBusy(true); setTestTokenResult(null)
    try {
      const res = await api.post('/mcp-servers/test-token', testForm)
      setTestTokenResult(res.data)
    } catch (e: any) {
      const code = e.response?.data?.error
      if (code === 'MCP_JWT_PRIVATE_KEY_NOT_CONFIGURED') setTestTokenErr(t('mcp.form.privateKeyNotConfigured'))
      else setTestTokenErr(e.response?.data?.detail || e.response?.data?.error || e.message)
    } finally { setTestTokenBusy(false) }
  }

  const copyToken = async () => {
    if (!testTokenResult) return
    await navigator.clipboard.writeText(testTokenResult.token)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }

  const load = async () => {
    try {
      setLoading(true)
      const res = await api.get('/mcp-servers')
      setServers(res.data)
    } catch (e: any) {
      setError(e.response?.data?.error || t('mcp.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setTrans({})
    setTags([])
    setError('')
    setShowModal(true)
  }

  const openEdit = (s: McpServer) => {
    setEditing(s)
    const mimeList = (s.passthrough_mime_whitelist || 'text/html,text/markdown').split(',').map(m => m.trim().toLowerCase())
    setForm({
      name: s.name, url: s.url || '', api_key: s.api_key || '', description: s.description || '',
      is_active: !!s.is_active, is_public: !!s.is_public,
      send_user_token: !!s.send_user_token,
      response_mode: (s.response_mode as 'inject' | 'answer') || 'inject',
      transport_type: (s.transport_type as TransportType) || 'http-post',
      command: s.command || '', args_json: s.args_json || '', env_json: s.env_json || '',
      passthrough_enabled: !!s.passthrough_enabled,
      passthrough_max_kb: s.passthrough_max_bytes ? Math.max(1, Math.round(s.passthrough_max_bytes / 1024)) : 500,
      passthrough_md: mimeList.includes('text/markdown'),
      passthrough_html: mimeList.includes('text/html'),
    })
    setTrans({
      name_zh: (s as any).name_zh || null, name_en: (s as any).name_en || null, name_vi: (s as any).name_vi || null,
      desc_zh: (s as any).desc_zh || null, desc_en: (s as any).desc_en || null, desc_vi: (s as any).desc_vi || null,
    })
    setTags((() => { try { return JSON.parse(s.tags || '[]') } catch { return [] } })())
    setError('')
    setShowModal(true)
  }

  const save = async () => {
    if (!form.name.trim()) { setError(t('mcp.form.nameRequired')); return }
    if (form.transport_type !== 'stdio' && !form.url.trim()) { setError(t('mcp.form.urlRequired')); return }
    if (form.transport_type === 'stdio' && !form.command.trim()) { setError(t('mcp.form.commandRequired')); return }
    setSaving(true)
    setTranslating(true)
    setError('')
    try {
      const mimeList = [
        form.passthrough_md  ? 'text/markdown' : null,
        form.passthrough_html ? 'text/html'    : null,
      ].filter(Boolean).join(',') || 'text/html,text/markdown'
      const payload = {
        ...form,
        api_key: form.api_key || null,
        description: form.description || null,
        url: form.url || null,
        command: form.command || null,
        args_json: form.args_json || null,
        env_json: form.env_json || null,
        tags: tags,
        passthrough_enabled: form.passthrough_enabled,
        passthrough_max_bytes: Math.max(1024, Number(form.passthrough_max_kb) * 1024),
        passthrough_mime_whitelist: mimeList,
        ...trans,
      }
      let res: any
      if (editing) {
        res = await api.put(`/mcp-servers/${editing.id}`, payload)
      } else {
        res = await api.post('/mcp-servers', payload)
      }
      setTrans({
        name_zh: res.data.name_zh || null, name_en: res.data.name_en || null, name_vi: res.data.name_vi || null,
        desc_zh: res.data.desc_zh || null, desc_en: res.data.desc_en || null, desc_vi: res.data.desc_vi || null,
      })
      setShowModal(false)
      await load()
    } catch (e: any) {
      setError(e.response?.data?.error || t('mcp.saveFailed'))
    } finally {
      setSaving(false)
      setTranslating(false)
    }
  }

  const remove = async (s: McpServer) => {
    if (!confirm(t('mcp.deleteConfirm', { name: s.name }))) return
    try {
      await api.delete(`/mcp-servers/${s.id}`)
      await load()
      if (selectedLogServer?.id === s.id) setSelectedLogServer(null)
    } catch (e: any) {
      alert(e.response?.data?.error || t('mcp.deleteFailed'))
    }
  }

  const toggle = async (s: McpServer) => {
    try {
      await api.post(`/mcp-servers/${s.id}/toggle`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || t('mcp.operateFailed'))
    }
  }

  const sync = async (s: McpServer) => {
    setSyncingId(s.id)
    setSyncMsg(prev => ({ ...prev, [s.id]: '' }))
    try {
      const res = await api.post(`/mcp-servers/${s.id}/sync`)
      setSyncMsg(prev => ({ ...prev, [s.id]: t('mcp.syncSuccess', { count: res.data.tool_count }) }))
      await load()
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message || 'Unknown error'
      setSyncMsg(prev => ({ ...prev, [s.id]: t('mcp.syncFailed', { error: errMsg }) }))
    } finally {
      setSyncingId(null)
    }
  }

  const approve = async (s: McpServer) => {
    try {
      const res = await api.post(`/mcp-servers/${s.id}/approve`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || t('mcp.operateFailed'))
    }
  }

  const loadLogs = async (s: McpServer) => {
    setSelectedLogServer(s)
    setLogsLoading(true)
    try {
      const res = await api.get(`/mcp-servers/${s.id}/logs?limit=50`)
      setLogs(res.data)
    } catch (e: any) {
      setLogs([])
    } finally {
      setLogsLoading(false)
    }
  }

  const getTools = (s: McpServer): McpTool[] => {
    if (!s.tools_json) return []
    try { return JSON.parse(s.tools_json) } catch { return [] }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{t('mcp.title')}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{t('mcp.desc')}</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={15} /> {t('mcp.addServer')}
        </button>
      </div>

      {/* Server List */}
      {loading ? (
        <div className="text-slate-400 text-sm py-8 text-center">{t('common.loading')}</div>
      ) : servers.length === 0 ? (
        <div className="text-slate-400 text-sm py-12 text-center border-2 border-dashed border-slate-200 rounded-xl">
          <Plug size={32} className="mx-auto mb-3 text-slate-300" />
          {t('mcp.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map(s => {
            const tools = getTools(s)
            const expanded = expandedId === s.id
            return (
              <div key={s.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Card Header */}
                <div className="px-4 py-3 flex items-center gap-3">
                  {/* Expand toggle */}
                  <button onClick={() => setExpandedId(expanded ? null : s.id)} className="text-slate-400 hover:text-slate-600">
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  {/* Active indicator */}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.is_active ? 'bg-green-500' : 'bg-slate-300'}`} />

                  {/* Name & URL */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 text-sm flex items-center gap-2">
                      {localName(s)}
                      <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-normal">
                        {s.transport_type || 'http-post'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {s.transport_type === 'stdio' ? (s.command || '—') : (s.url || '—')}
                    </div>
                  </div>

                  {/* Tool count badge */}
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">
                    {t('mcp.toolCount', { count: tools.length })}
                  </span>

                  {/* 公開狀態 badge */}
                  {s.is_public === 1 && (
                    s.public_approved === 1
                      ? <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-medium"><Globe size={11} /> {t('mcp.public')}</span>
                      : <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-medium"><Globe size={11} /> {t('mcp.pendingApproval')}</span>
                  )}

                  {/* User Identity 認證啟用 badge */}
                  {s.send_user_token === 1 && (
                    <span
                      className="flex items-center gap-1 text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-medium"
                      title={t('mcp.form.sendUserTokenHint')}
                    >
                      <KeyRound size={11} /> X-User-Token
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => sync(s)}
                      disabled={syncingId === s.id}
                      title={t('mcp.syncTools')}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={syncingId === s.id ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={() => openEdit(s)} title={t('common.edit')} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
                      <Edit2 size={14} />
                    </button>
                    {s.is_public === 1 && (
                      <button
                        onClick={() => approve(s)}
                        title={s.public_approved ? t('mcp.revokeApproval') : t('mcp.approve')}
                        className={`p-1.5 rounded-lg transition ${s.public_approved ? 'text-green-600 hover:text-red-500 hover:bg-red-50' : 'text-amber-500 hover:text-green-600 hover:bg-green-50'}`}
                      >
                        <ShieldCheck size={14} />
                      </button>
                    )}
                    <button onClick={() => setShareServer(s)} title={t('mcp.shareSettings')} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
                      <Share2 size={14} />
                    </button>
                    <button onClick={() => toggle(s)} title={s.is_active ? t('common.disable') : t('common.enable')} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
                      {s.is_active ? <ToggleRight size={16} className="text-green-500" /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => remove(s)} title={t('common.delete')} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => loadLogs(s)}
                      className="px-2 py-1 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                    >
                      {t('mcp.callLogs')}
                    </button>
                  </div>
                </div>

                {/* Sync message */}
                {syncMsg[s.id] && (
                  <div className={`px-4 pb-2 text-xs ${syncMsg[s.id].startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                    {syncMsg[s.id]}
                  </div>
                )}

                {/* Expanded: tool list */}
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                    {s.last_synced_at && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
                        <Clock size={11} /> {t('mcp.lastSynced')}{fmtTW(s.last_synced_at)}
                      </div>
                    )}
                    {tools.length === 0 ? (
                      <div className="text-xs text-slate-400 italic">{t('mcp.noToolsSynced')}</div>
                    ) : (
                      <div className="space-y-1.5">
                        {tools.map((tool, i) => (
                          <div key={i} className="flex gap-2 text-xs">
                            <span className="font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0">{tool.name}</span>
                            <span className="text-slate-500">{tool.description || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(localDesc(s)) && <p className="text-xs text-slate-400 mt-2 border-t border-slate-200 pt-2">{localDesc(s)}</p>}
                    {s.server_instructions && (
                      <div className="mt-2 border-t border-slate-200 pt-2">
                        <div className="text-xs font-medium text-slate-600 mb-0.5">{t('mcp.serverInstructionsTitle')}</div>
                        <div className="text-[11px] text-slate-400 italic mb-1.5">{t('mcp.serverInstructionsHint')}</div>
                        <pre className="text-xs text-slate-600 bg-white border border-slate-200 rounded p-2 whitespace-pre-wrap max-h-48 overflow-auto">{s.server_instructions}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Call Logs Section */}
      {selectedLogServer && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-medium text-slate-700 text-sm">{t('mcp.logs.title', { name: selectedLogServer.name })}</div>
            <button onClick={() => setSelectedLogServer(null)} className="text-xs text-slate-400 hover:text-slate-600">{t('common.close')}</button>
          </div>
          {logsLoading ? (
            <div className="text-slate-400 text-sm py-6 text-center">{t('common.loading')}</div>
          ) : logs.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">{t('mcp.logs.empty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">{t('mcp.logs.time')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('mcp.logs.tool')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('mcp.logs.user')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('mcp.logs.status')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('mcp.logs.duration')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('mcp.logs.responsePreview')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtTW(log.called_at)}</td>
                      <td className="px-3 py-2 font-mono text-blue-700">{log.tool_name}</td>
                      <td className="px-3 py-2 text-slate-500">{log.user_name || '—'}</td>
                      <td className="px-3 py-2">
                        {log.status === 'ok'
                          ? <span className="flex items-center gap-1 text-green-600"><CheckCircle size={11} /> ok</span>
                          : <span className="flex items-center gap-1 text-red-500"><AlertCircle size={11} /> error</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{log.duration_ms != null ? `${log.duration_ms}ms` : '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-xs truncate">
                        {log.status === 'error' ? log.error_msg : (log.response_preview || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-6 pt-6 pb-2 shrink-0">
              <h3 className="text-base font-semibold text-slate-800">
                {editing ? t('mcp.form.editTitle') : t('mcp.form.addTitle')}
              </h3>
            </div>

            <div className="overflow-y-auto flex-1 px-6 pb-2">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.name')} *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder={t('mcp.form.namePlaceholder')}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Transport type */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.transportType')}</label>
                <select
                  value={form.transport_type}
                  onChange={e => setForm(p => ({ ...p, transport_type: e.target.value as TransportType }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TRANSPORT_TYPES.map(k => (
                    <option key={k} value={k}>{t(`mcp.transport.${k}`)}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-0.5">
                  {form.transport_type === 'auto' && t('mcp.form.transportAuto')}
                  {form.transport_type === 'http-post' && t('mcp.form.transportHttpPost')}
                  {form.transport_type === 'http-sse' && t('mcp.form.transportHttpSse')}
                  {form.transport_type === 'streamable-http' && t('mcp.form.transportStreamable')}
                  {form.transport_type === 'stdio' && t('mcp.form.transportStdio')}
                </p>
              </div>

              {/* stdio: command + args + env */}
              {form.transport_type === 'stdio' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.command')}</label>
                    <input
                      value={form.command}
                      onChange={e => setForm(p => ({ ...p, command: e.target.value }))}
                      placeholder='npx -y @modelcontextprotocol/server-filesystem /tmp'
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-slate-400 mt-0.5">{t('mcp.form.commandHint')}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.argsJson')}</label>
                    <input
                      value={form.args_json}
                      onChange={e => setForm(p => ({ ...p, args_json: e.target.value }))}
                      placeholder='["/workspace", "--verbose"]'
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.envJson')}</label>
                    <textarea
                      value={form.env_json}
                      onChange={e => setForm(p => ({ ...p, env_json: e.target.value }))}
                      placeholder={'{"API_KEY": "xxx", "DEBUG": "1"}'}
                      rows={2}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {t('mcp.form.url')} *
                    </label>
                    <input
                      value={form.url}
                      onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                      placeholder={form.transport_type === 'http-sse' ? 'https://your-server.com/sse' : 'https://your-mcp-server.com'}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.apiKey')}</label>
                    <input
                      type="password"
                      value={form.api_key}
                      onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))}
                      placeholder={t('mcp.form.apiKeyPlaceholder')}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.description')}</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.tags')}</label>
                <TagInput tags={tags} onChange={setTags} placeholder={t('mcp.form.tagsPlaceholder')} />
              </div>
              <TranslationFields
                data={trans}
                onChange={setTrans}
                translateUrl={editing ? `/mcp-servers/${editing.id}/translate` : undefined}
                hasDescription
                translating={translating}
              />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.responseMode')}</label>
                <div className="flex gap-2">
                  {(['inject', 'answer'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, response_mode: mode }))}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        form.response_mode === mode
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                      }`}
                    >
                      {mode === 'inject' ? t('mcp.form.modeInject') : t('mcp.form.modeAnswer')}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {form.response_mode === 'answer'
                    ? t('mcp.form.modeAnswerDesc')
                    : t('mcp.form.modeInjectDesc')}
                </p>
              </div>
              {/* ── tool-artifact-passthrough ─────────────────────────────── */}
              <div className="border border-amber-100 bg-amber-50/40 rounded-lg px-3 py-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.passthrough_enabled}
                    onChange={e => setForm(p => ({ ...p, passthrough_enabled: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm text-slate-800 font-medium">{t('chat.passthrough.enable')}</span>
                </label>
                <p className="text-xs text-slate-600">{t('chat.passthrough.desc')}</p>
                {form.passthrough_enabled && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">{t('chat.passthrough.maxBytes')}</label>
                      <input
                        type="number"
                        min={1}
                        max={10240}
                        value={form.passthrough_max_kb}
                        onChange={e => setForm(p => ({ ...p, passthrough_max_kb: Number(e.target.value) || 500 }))}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">{t('chat.passthrough.allowedMime')}</label>
                      <div className="flex gap-3 mt-1">
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={form.passthrough_md}   onChange={e => setForm(p => ({ ...p, passthrough_md:   e.target.checked }))} /> {t('chat.passthrough.mimeMd')}
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={form.passthrough_html} onChange={e => setForm(p => ({ ...p, passthrough_html: e.target.checked }))} /> {t('chat.passthrough.mimeHtml')}
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                {form.passthrough_enabled && (
                  <p className="text-xs text-amber-700 pt-1">⚠️ {t('chat.passthrough.noAuditWarn')}</p>
                )}
              </div>
              {/* ── 使用者身份認證（RS256 JWT X-User-Token） ─────────────────── */}
              <div className="border border-indigo-100 bg-indigo-50/50 rounded-lg px-3 py-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-900">
                  <KeyRound size={13} /> {t('mcp.form.userAuthTitle')}
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.send_user_token}
                    onChange={e => setForm(p => ({ ...p, send_user_token: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm text-slate-800 font-medium">{t('mcp.form.sendUserToken')}</span>
                </label>
                <p className="text-xs text-slate-600 leading-relaxed">{t('mcp.form.sendUserTokenHint')}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={downloadPublicKey}
                    disabled={pubKeyBusy}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded hover:bg-indigo-50 transition disabled:opacity-50"
                  >
                    <Download size={12} /> {t('mcp.form.downloadPublicKey')}
                  </button>
                  <button
                    type="button"
                    onClick={copyPublicKey}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded hover:bg-indigo-50 transition"
                  >
                    {pubKeyCopied ? <><Check size={12} /> {t('mcp.form.copied')}</> : <><Copy size={12} /> {t('mcp.form.copyPublicKey')}</>}
                  </button>
                  <button
                    type="button"
                    onClick={openTestTokenModal}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded hover:bg-indigo-50 transition"
                  >
                    <KeyRound size={12} /> {t('mcp.form.testToken')}
                  </button>
                </div>
                {pubKeyErr && <p className="text-xs text-red-600 mt-1">{pubKeyErr}</p>}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm text-slate-700">{t('mcp.form.enableOnCreate')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_public}
                  onChange={e => setForm(p => ({ ...p, is_public: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm text-slate-700 flex items-center gap-1.5">
                  <Globe size={13} className="text-green-600" />
                  {t('mcp.form.isPublic')}
                </span>
              </label>
            </div>

            {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            </div>{/* end overflow-y-auto */}

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 shrink-0">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                {t('common.cancel')}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareServer && (
        <ShareModal
          title={t('mcp.serverShare', { name: localName(shareServer) })}
          sharesUrl={`/mcp-servers/${shareServer.id}/access`}
          onClose={() => setShareServer(null)}
        />
      )}

      {/* Test Token Modal */}
      {testTokenOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-6 pt-6 pb-2 shrink-0 flex items-center gap-2">
              <KeyRound size={16} className="text-indigo-600" />
              <h3 className="text-base font-semibold text-slate-800">{t('mcp.form.testTokenTitle')}</h3>
            </div>
            <div className="overflow-y-auto flex-1 px-6 pb-2 space-y-3">
              <p className="text-xs text-slate-500">{t('mcp.form.testTokenDesc')}</p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.testEmail')} *</label>
                <input
                  value={testForm.email}
                  onChange={e => setTestForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="peter.wang@foxlink.com"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.testName')}</label>
                  <input
                    value={testForm.name}
                    onChange={e => setTestForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="王小明"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.testSub')}</label>
                  <input
                    value={testForm.sub}
                    onChange={e => setTestForm(p => ({ ...p, sub: e.target.value }))}
                    placeholder="12345"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.testDept')}</label>
                <input
                  value={testForm.dept}
                  onChange={e => setTestForm(p => ({ ...p, dept: e.target.value }))}
                  placeholder="IT-01"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="button"
                onClick={generateTestToken}
                disabled={testTokenBusy || !testForm.email}
                className="w-full px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {testTokenBusy ? <RefreshCw size={14} className="animate-spin" /> : <KeyRound size={14} />}
                {t('mcp.form.generate')}
              </button>

              {testTokenErr && <p className="text-xs text-red-600">{testTokenErr}</p>}

              {testTokenResult && (
                <div className="space-y-2 pt-1">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-600">{t('mcp.form.rawJwt')}</label>
                      <button
                        type="button"
                        onClick={copyToken}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                      >
                        {tokenCopied ? <><Check size={11} /> {t('mcp.form.copied')}</> : <><Copy size={11} /> {t('mcp.form.copyPublicKey').replace(/key/i, 'token')}</>}
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={testTokenResult.token}
                      rows={3}
                      className="w-full font-mono text-[10px] border border-slate-200 rounded px-2 py-1.5 bg-slate-50 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.decodedClaims')}</label>
                    <pre className="font-mono text-[11px] border border-slate-200 rounded px-2 py-1.5 bg-slate-50 overflow-x-auto">
{JSON.stringify(testTokenResult.claims, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 shrink-0">
              <button onClick={() => setTestTokenOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
