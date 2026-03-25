import { useEffect, useState } from 'react'
import {
  Plus, RefreshCw, Trash2, Edit2, ChevronDown, ChevronRight,
  Plug, ToggleLeft, ToggleRight, AlertCircle, CheckCircle, Clock, Share2, Globe, ShieldCheck
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
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
  response_mode: 'inject' | 'answer' | null
  transport_type: TransportType | null
  command: string | null
  args_json: string | null
  env_json: string | null
  tools_json: string | null
  last_synced_at: string | null
  created_at: string
  tags: string | null
  updated_at: string
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

const TRANSPORT_LABELS: Record<TransportType, string> = {
  'http-post': 'HTTP POST（標準）',
  'http-sse': 'HTTP SSE（雙通道）',
  'streamable-http': 'Streamable HTTP（MCP 2025）',
  'stdio': 'stdio（本地指令）',
  'auto': '自動偵測',
}

const emptyForm = {
  name: '', url: '', api_key: '', description: '', is_active: true, is_public: false,
  response_mode: 'inject' as 'inject' | 'answer',
  transport_type: 'http-post' as TransportType,
  command: '', args_json: '', env_json: '',
}

export default function MCPServersPanel() {
  const { t } = useTranslation()
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
    setForm({
      name: s.name, url: s.url || '', api_key: s.api_key || '', description: s.description || '',
      is_active: !!s.is_active, is_public: !!s.is_public,
      response_mode: (s.response_mode as 'inject' | 'answer') || 'inject',
      transport_type: (s.transport_type as TransportType) || 'http-post',
      command: s.command || '', args_json: s.args_json || '', env_json: s.env_json || '',
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
    if (!form.name.trim()) { setError('名稱為必填'); return }
    if (form.transport_type !== 'stdio' && !form.url.trim()) { setError('URL 為必填（非 stdio 模式）'); return }
    if (form.transport_type === 'stdio' && !form.command.trim()) { setError('stdio 模式需填寫指令'); return }
    setSaving(true)
    setTranslating(true)
    setError('')
    try {
      const payload = {
        ...form,
        api_key: form.api_key || null,
        description: form.description || null,
        url: form.url || null,
        command: form.command || null,
        args_json: form.args_json || null,
        env_json: form.env_json || null,
        tags: tags,
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
      setSyncMsg(prev => ({ ...prev, [s.id]: `✗ ${e.response?.data?.error || t('mcp.syncFailed')}` }))
    } finally {
      setSyncingId(null)
    }
  }

  const approve = async (s: McpServer) => {
    try {
      const res = await api.post(`/mcp-servers/${s.id}/approve`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || '操作失敗')
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
                      {s.name}
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
                      ? <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-medium"><Globe size={11} /> 公開</span>
                      : <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-medium"><Globe size={11} /> 待核准</span>
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
                        title={s.public_approved ? '取消核准公開' : '核准公開'}
                        className={`p-1.5 rounded-lg transition ${s.public_approved ? 'text-green-600 hover:text-red-500 hover:bg-red-50' : 'text-amber-500 hover:text-green-600 hover:bg-green-50'}`}
                      >
                        <ShieldCheck size={14} />
                      </button>
                    )}
                    <button onClick={() => setShareServer(s)} title="共享設定" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
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
                        <Clock size={11} /> {t('mcp.lastSynced')}：{s.last_synced_at}
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
                    {s.description && <p className="text-xs text-slate-400 mt-2 border-t border-slate-200 pt-2">{s.description}</p>}
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
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{log.called_at}</td>
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
                <label className="block text-xs font-medium text-slate-600 mb-1">傳輸方式 *</label>
                <select
                  value={form.transport_type}
                  onChange={e => setForm(p => ({ ...p, transport_type: e.target.value as TransportType }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {(Object.keys(TRANSPORT_LABELS) as TransportType[]).map(k => (
                    <option key={k} value={k}>{TRANSPORT_LABELS[k]}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-0.5">
                  {form.transport_type === 'auto' && '依序嘗試各種方式並自動記住成功的傳輸類型'}
                  {form.transport_type === 'http-post' && '直接 POST JSON-RPC 到 URL（最通用）'}
                  {form.transport_type === 'http-sse' && 'GET /sse 建立 SSE 連線，POST /message 送出請求（舊式 MCP）'}
                  {form.transport_type === 'streamable-http' && '單一 POST 端點，回應可為 JSON 或 SSE（MCP 2025 規範）'}
                  {form.transport_type === 'stdio' && '啟動本地子程序，透過 stdin/stdout 通訊（本地端 MCP）'}
                </p>
              </div>

              {/* stdio: command + args + env */}
              {form.transport_type === 'stdio' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">指令 (Command) *</label>
                    <input
                      value={form.command}
                      onChange={e => setForm(p => ({ ...p, command: e.target.value }))}
                      placeholder='npx -y @modelcontextprotocol/server-filesystem /tmp'
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-slate-400 mt-0.5">完整指令，引號包住含空格的參數</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">額外參數 (JSON array，選填)</label>
                    <input
                      value={form.args_json}
                      onChange={e => setForm(p => ({ ...p, args_json: e.target.value }))}
                      placeholder='["/workspace", "--verbose"]'
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">環境變數 (JSON object，選填)</label>
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
                <label className="block text-xs font-medium text-slate-600 mb-1">標籤 (Tags)</label>
                <TagInput tags={tags} onChange={setTags} placeholder="輸入標籤後按 Enter" />
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
                  公開（需 Admin 核准後所有使用者可見）
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
          title={`MCP 伺服器 — ${shareServer.name}`}
          sharesUrl={`/mcp-servers/${shareServer.id}/access`}
          onClose={() => setShareServer(null)}
        />
      )}
    </div>
  )
}
