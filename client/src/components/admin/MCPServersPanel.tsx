import { useEffect, useState } from 'react'
import {
  Plus, RefreshCw, Trash2, Edit2, ChevronDown, ChevronRight,
  Plug, ToggleLeft, ToggleRight, AlertCircle, CheckCircle, Clock
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'

interface McpServer {
  id: number
  name: string
  url: string
  api_key: string | null
  description: string | null
  is_active: number
  response_mode: 'inject' | 'answer' | null
  tools_json: string | null
  last_synced_at: string | null
  created_at: string
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

const emptyForm = { name: '', url: '', api_key: '', description: '', is_active: true, response_mode: 'inject' as 'inject' | 'answer' }

export default function MCPServersPanel() {
  const { t } = useTranslation()
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncMsg, setSyncMsg] = useState<Record<number, string>>({})
  const [selectedLogServer, setSelectedLogServer] = useState<McpServer | null>(null)
  const [logs, setLogs] = useState<McpCallLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

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
    setError('')
    setShowModal(true)
  }

  const openEdit = (s: McpServer) => {
    setEditing(s)
    setForm({ name: s.name, url: s.url, api_key: s.api_key || '', description: s.description || '', is_active: !!s.is_active, response_mode: (s.response_mode as 'inject' | 'answer') || 'inject' })
    setError('')
    setShowModal(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) { setError(t('mcp.nameUrlRequired')); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, api_key: form.api_key || null, description: form.description || null, response_mode: form.response_mode }
      if (editing) {
        await api.put(`/mcp-servers/${editing.id}`, payload)
      } else {
        await api.post('/mcp-servers', payload)
      }
      setShowModal(false)
      await load()
    } catch (e: any) {
      setError(e.response?.data?.error || t('mcp.saveFailed'))
    } finally {
      setSaving(false)
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
                    <div className="font-medium text-slate-800 text-sm">{s.name}</div>
                    <div className="text-xs text-slate-400 truncate">{s.url}</div>
                  </div>

                  {/* Tool count badge */}
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">
                    {t('mcp.toolCount', { count: tools.length })}
                  </span>

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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-4">
              {editing ? t('mcp.form.editTitle') : t('mcp.form.addTitle')}
            </h3>

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
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('mcp.form.url')} *</label>
                <input
                  value={form.url}
                  onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                  placeholder="https://your-mcp-server.com"
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
            </div>

            {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

            <div className="flex justify-end gap-2 mt-5">
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
    </div>
  )
}
