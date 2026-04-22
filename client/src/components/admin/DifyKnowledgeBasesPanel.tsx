import { useEffect, useState } from 'react'
import {
  Plus, Trash2, Edit2, ChevronDown, ChevronRight,
  ToggleLeft, ToggleRight, AlertCircle, CheckCircle, Zap, Clock, Share2, Globe, ShieldCheck,
  Plug, Database
} from 'lucide-react'
import { fmtTW } from '../../lib/fmtTW'
import api from '../../lib/api'
import TranslationFields, { type TranslationData } from '../common/TranslationFields'
import TagInput from '../common/TagInput'
import ShareModal from '../dashboard/ShareModal'
import ErpToolsPanel from './ErpToolsPanel'

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface ApiConnector {
  id: number
  name: string
  api_server: string
  api_key: string
  api_key_masked: string
  description: string | null
  is_active: number
  is_public: number
  public_approved: number
  sort_order: number
  connector_type: string
  http_method: string
  content_type: string
  auth_type: string
  auth_header_name: string | null
  auth_query_param_name: string | null
  auth_config: string | null
  request_headers: string | null
  request_body_template: string | null
  input_params: string | null
  response_type: string
  response_extract: string | null
  response_template: string | null
  empty_message: string | null
  error_mapping: string | null
  email_domain_fallback: number
  response_mode: 'inject' | 'answer' | null
  created_at: string
  updated_at: string
}

interface InputParam {
  name: string
  label: string
  type: 'string' | 'number' | 'date' | 'enum' | 'boolean'
  required: boolean
  source: string
  fixed_value?: string
  default_value?: string
  enum_options?: { value: string; label: string }[]
  extract_pattern?: string
  extract_hint?: string
  validation?: { min_length?: number; max_length?: number; pattern?: string; error_message?: string }
  param_location: 'body' | 'query' | 'path' | 'header'
  description?: string
}

interface CallLog {
  id: number; query_preview: string | null; response_preview: string | null
  status: string; error_msg: string | null; duration_ms: number | null
  called_at: string; user_name: string | null
}

/* ── Source Options ─────────────────────────────────────────────────────────── */
const SOURCE_OPTIONS = [
  { value: 'fixed', label: '固定值' },
  { value: 'user_input', label: '使用者輸入' },
  { value: 'system_user_email', label: '登入者 Email' },
  { value: 'system_user_name', label: '登入者姓名' },
  { value: 'system_user_employee_id', label: '登入者工號' },
  { value: 'system_user_dept', label: '登入者部門' },
  { value: 'system_user_title', label: '登入者職稱' },
  { value: 'system_user_id', label: '使用者 ID' },
  { value: 'system_date', label: '系統日期 (YYYY-MM-DD)' },
  { value: 'system_datetime', label: '系統日期時間' },
  { value: 'system_timestamp', label: 'Unix Timestamp' },
  { value: 'system_year', label: '系統年份' },
  { value: 'system_month', label: '系統月份' },
]

const AUTH_OPTIONS = [
  { value: 'none', label: '無認證' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api_key_header', label: 'API Key (Header)' },
  { value: 'api_key_query', label: 'API Key (Query)' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'oauth2_client', label: 'OAuth 2.0 Client Credentials' },
  { value: 'custom', label: '自定義 Headers' },
]

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const emptyParam: InputParam = {
  name: '', label: '', type: 'string', required: false,
  source: 'user_input', param_location: 'body',
}

/* ── Component ─────────────────────────────────────────────────────────────── */
export default function DifyKnowledgeBasesPanel() {
  const [kbs, setKbs] = useState<ApiConnector[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<ApiConnector | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [trans, setTrans] = useState<TranslationData>({})
  const [translating, setTranslating] = useState(false)
  const [testMsg, setTestMsg] = useState<Record<number, { ok: boolean; text: string }>>({})
  const [selectedLogKb, setSelectedLogKb] = useState<ApiConnector | null>(null)
  const [shareKb, setShareKb] = useState<ApiConnector | null>(null)
  const [logs, setLogs] = useState<CallLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [testQuery, setTestQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [activeTab, setActiveTab] = useState<'basic' | 'params' | 'response'>('basic')

  // ── Form State ──
  const [form, setForm] = useState({
    name: '', api_server: '', api_key: '', description: '',
    is_active: true, is_public: false, sort_order: 0,
    connector_type: 'dify' as string,
    http_method: 'POST', content_type: 'application/json',
    auth_type: 'bearer', auth_header_name: '', auth_query_param_name: '',
    auth_config: '',
    request_headers: '', request_body_template: '',
    response_type: 'json', response_extract: '', response_template: '',
    empty_message: '', error_mapping: '',
    email_domain_fallback: false,
    response_mode: 'inject' as 'inject' | 'answer',
  })
  const [inputParams, setInputParams] = useState<InputParam[]>([])
  const [editingParamIdx, setEditingParamIdx] = useState<number | null>(null)
  const [testParams, setTestParams] = useState<Record<string, string>>({})

  const safeJson = (val: any): any => {
    if (!val) return null
    if (typeof val === 'object') return val
    try { return JSON.parse(val) } catch { return null }
  }

  const load = async () => {
    try {
      setLoading(true)
      const res = await api.get('/dify-kb')
      setKbs(res.data)
    } catch (e: any) {
      setError(e.response?.data?.error || '載入失敗')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({
      name: '', api_server: '', api_key: '', description: '',
      is_active: true, is_public: false, sort_order: 0,
      connector_type: 'dify', http_method: 'POST', content_type: 'application/json',
      auth_type: 'bearer', auth_header_name: '', auth_query_param_name: '',
      auth_config: '', request_headers: '', request_body_template: '',
      response_type: 'json', response_extract: '', response_template: '',
      empty_message: '', error_mapping: '',
      email_domain_fallback: false,
      response_mode: 'inject',
    })
    setInputParams([])
    setTags([])
    setTrans({})
    setActiveTab('basic')
    setError('')
    setShowModal(true)
  }

  const openEdit = (kb: ApiConnector) => {
    setEditing(kb)
    const ip = safeJson(kb.input_params)
    setForm({
      name: kb.name, api_server: kb.api_server, api_key: '',
      description: kb.description || '',
      is_active: !!kb.is_active, is_public: !!kb.is_public, sort_order: kb.sort_order,
      connector_type: kb.connector_type || 'dify',
      http_method: kb.http_method || 'POST',
      content_type: kb.content_type || 'application/json',
      auth_type: kb.auth_type || 'bearer',
      auth_header_name: kb.auth_header_name || '',
      auth_query_param_name: kb.auth_query_param_name || '',
      auth_config: typeof kb.auth_config === 'object' ? JSON.stringify(kb.auth_config, null, 2) : (kb.auth_config || ''),
      request_headers: typeof kb.request_headers === 'object' ? JSON.stringify(kb.request_headers, null, 2) : (kb.request_headers || ''),
      request_body_template: typeof kb.request_body_template === 'object' ? JSON.stringify(kb.request_body_template, null, 2) : (kb.request_body_template || ''),
      response_type: kb.response_type || 'json',
      response_extract: kb.response_extract || '',
      response_template: kb.response_template || '',
      empty_message: kb.empty_message || '',
      error_mapping: typeof kb.error_mapping === 'object' ? JSON.stringify(kb.error_mapping, null, 2) : (kb.error_mapping || ''),
      email_domain_fallback: !!kb.email_domain_fallback,
      response_mode: (kb.response_mode === 'answer' ? 'answer' : 'inject') as 'inject' | 'answer',
    })
    setInputParams(Array.isArray(ip) ? ip : [])
    setTags((() => {
      try {
        const raw = (kb as any).tags
        if (Array.isArray(raw)) return raw
        return JSON.parse(raw || '[]')
      } catch { return [] }
    })())
    setTrans({
      name_zh: (kb as any).name_zh || null, name_en: (kb as any).name_en || null, name_vi: (kb as any).name_vi || null,
      desc_zh: (kb as any).desc_zh || null, desc_en: (kb as any).desc_en || null, desc_vi: (kb as any).desc_vi || null,
    })
    setActiveTab('basic')
    setError('')
    setShowModal(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.api_server.trim()) {
      setError('名稱和 API URL 為必填'); return
    }
    if (form.connector_type === 'dify' && !editing && !form.api_key.trim()) {
      setError('DIFY 類型新增時 API Key 為必填'); return
    }
    setSaving(true); setTranslating(true); setError('')
    try {
      const payload: any = {
        name: form.name, api_server: form.api_server,
        description: form.description || null,
        is_active: form.is_active, is_public: form.is_public, sort_order: form.sort_order,
        tags, ...trans,
        connector_type: form.connector_type,
        http_method: form.http_method, content_type: form.content_type,
        auth_type: form.auth_type,
        auth_header_name: form.auth_header_name || null,
        auth_query_param_name: form.auth_query_param_name || null,
        auth_config: form.auth_config ? tryParseJson(form.auth_config) : null,
        request_headers: form.request_headers ? tryParseJson(form.request_headers) : null,
        request_body_template: form.request_body_template || null,
        input_params: inputParams.length > 0 ? inputParams : null,
        response_type: form.response_type,
        response_extract: form.response_extract || null,
        response_template: form.response_template || null,
        empty_message: form.empty_message || null,
        error_mapping: form.error_mapping ? tryParseJson(form.error_mapping) : null,
        email_domain_fallback: form.email_domain_fallback,
        response_mode: form.response_mode,
      }
      if (form.api_key.trim()) payload.api_key = form.api_key.trim()
      if (editing) {
        await api.put(`/dify-kb/${editing.id}`, payload)
      } else {
        await api.post('/dify-kb', payload)
      }
      setShowModal(false); await load()
    } catch (e: any) {
      setError(e.response?.data?.error || '儲存失敗')
    } finally { setSaving(false); setTranslating(false) }
  }

  const remove = async (kb: ApiConnector) => {
    if (!confirm(`確定刪除「${kb.name}」？相關呼叫記錄也會一併刪除。`)) return
    try {
      await api.delete(`/dify-kb/${kb.id}`); await load()
      if (selectedLogKb?.id === kb.id) setSelectedLogKb(null)
    } catch (e: any) { alert(e.response?.data?.error || '刪除失敗') }
  }

  const toggle = async (kb: ApiConnector) => {
    try { await api.post(`/dify-kb/${kb.id}/toggle`); await load() }
    catch (e: any) { alert(e.response?.data?.error || '操作失敗') }
  }

  const test = async (kb: ApiConnector) => {
    setTestingId(kb.id)
    setTestMsg(prev => ({ ...prev, [kb.id]: { ok: false, text: '' } }))
    try {
      const res = await api.post(`/dify-kb/${kb.id}/test`, {
        query: testQuery.trim() || undefined,
        test_params: testParams,
      })
      setTestMsg(prev => ({
        ...prev,
        [kb.id]: { ok: true, text: `✓ 連線成功 (${res.data.duration_ms}ms)\n${res.data.answer?.slice(0, 300) || ''}` }
      }))
    } catch (e: any) {
      setTestMsg(prev => ({
        ...prev,
        [kb.id]: { ok: false, text: `✗ ${e.response?.data?.error || '連線失敗'}` }
      }))
    } finally { setTestingId(null) }
  }

  const approve = async (kb: ApiConnector) => {
    try { await api.post(`/dify-kb/${kb.id}/approve`); await load() }
    catch (e: any) { alert(e.response?.data?.error || '操作失敗') }
  }

  const loadLogs = async (kb: ApiConnector) => {
    setSelectedLogKb(kb); setLogsLoading(true)
    try {
      const res = await api.get(`/dify-kb/${kb.id}/logs?limit=50`); setLogs(res.data)
    } catch { setLogs([]) } finally { setLogsLoading(false) }
  }

  const filteredKbs = filterType === 'all' ? kbs
    : kbs.filter(kb => (kb.connector_type || 'dify') === filterType)

  const connLabel = (type: string) => type === 'rest_api' ? 'REST API' : 'DIFY'

  /* ── Input Param helpers ── */
  const addParam = () => {
    setInputParams(prev => [...prev, { ...emptyParam }])
    setEditingParamIdx(inputParams.length)
  }
  const removeParam = (idx: number) => {
    setInputParams(prev => prev.filter((_, i) => i !== idx))
    setEditingParamIdx(null)
  }
  const updateParam = (idx: number, updates: Partial<InputParam>) => {
    setInputParams(prev => prev.map((p, i) => i === idx ? { ...p, ...updates } : p))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">API 連接器管理</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            管理 API 連接器（DIFY 知識庫與外部 REST API），AI 對話時自動查詢並整合回答
          </p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
          <Plus size={15} /> 新增連接器
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { v: 'all', l: '全部' },
          { v: 'dify', l: 'DIFY' },
          { v: 'rest_api', l: 'REST API' },
          { v: 'erp_proc', l: 'ERP Procedure' },
        ].map(f => (
          <button key={f.v} onClick={() => setFilterType(f.v)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition ${filterType === f.v
              ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
              : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            {f.l} {f.v === 'all' || f.v === 'erp_proc' ? '' : `(${kbs.filter(k => (k.connector_type || 'dify') === f.v).length})`}
            {f.v === 'all' ? `(${kbs.length})` : ''}
          </button>
        ))}
      </div>

      {filterType === 'erp_proc' ? <ErpToolsPanel /> : (
      <>
      {/* Test controls */}
      <div className="flex gap-2 items-center">
        <input value={testQuery} onChange={e => setTestQuery(e.target.value)}
          placeholder="測試查詢語句（留空使用預設）"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-xs text-slate-400 shrink-0">↑ 測試 DIFY 時使用</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-slate-400 text-sm py-8 text-center">載入中...</div>
      ) : filteredKbs.length === 0 ? (
        <div className="text-slate-400 text-sm py-12 text-center border-2 border-dashed border-slate-200 rounded-xl">
          <Plug size={32} className="mx-auto mb-3 text-slate-300" />
          尚未設定任何 API 連接器
        </div>
      ) : (
        <div className="space-y-3">
          {filteredKbs.map(kb => {
            const expanded = expandedId === kb.id
            const msg = testMsg[kb.id]
            const ct = kb.connector_type || 'dify'
            const params: InputParam[] = safeJson(kb.input_params) || []
            const userInputParams = params.filter(p => p.source === 'user_input')
            return (
              <div key={kb.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3">
                  <button onClick={() => setExpandedId(expanded ? null : kb.id)} className="text-slate-400 hover:text-slate-600">
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${kb.is_active ? 'bg-green-500' : 'bg-slate-300'}`} />
                  {ct === 'dify'
                    ? <Database size={14} className="text-purple-500 shrink-0" />
                    : <Plug size={14} className="text-orange-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 text-sm">{kb.name}</div>
                    <div className="text-xs text-slate-400 truncate">
                      {ct === 'dify' ? kb.api_server : `${kb.http_method || 'POST'} ${kb.api_server}`}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ct === 'dify' ? 'bg-purple-50 text-purple-600' : 'bg-orange-50 text-orange-600'}`}>
                    {connLabel(ct)}
                  </span>
                  <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full font-medium">
                    #{kb.sort_order}
                  </span>
                  {kb.is_public === 1 && (
                    kb.public_approved === 1
                      ? <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-green-50 text-green-700 rounded-full font-medium"><Globe size={11} /> 公開</span>
                      : <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-medium"><Globe size={11} /> 待核准</span>
                  )}
                  <div className="flex items-center gap-1">
                    <button onClick={() => test(kb)} disabled={testingId === kb.id} title="測試連線"
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:opacity-50 flex items-center gap-1 text-xs">
                      <Zap size={13} className={testingId === kb.id ? 'animate-pulse' : ''} />
                      {testingId === kb.id ? '測試中' : '測試'}
                    </button>
                    <button onClick={() => openEdit(kb)} title="編輯" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"><Edit2 size={14} /></button>
                    {kb.is_public === 1 && (
                      <button onClick={() => approve(kb)} title={kb.public_approved ? '取消核准' : '核准公開'}
                        className={`p-1.5 rounded-lg transition ${kb.public_approved ? 'text-green-600 hover:text-red-500 hover:bg-red-50' : 'text-amber-500 hover:text-green-600 hover:bg-green-50'}`}>
                        <ShieldCheck size={14} />
                      </button>
                    )}
                    <button onClick={() => setShareKb(kb)} title="共享設定" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"><Share2 size={14} /></button>
                    <button onClick={() => toggle(kb)} title={kb.is_active ? '停用' : '啟用'} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
                      {kb.is_active ? <ToggleRight size={16} className="text-green-500" /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => remove(kb)} title="刪除" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"><Trash2 size={14} /></button>
                    <button onClick={() => loadLogs(kb)} className="px-2 py-1 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">記錄</button>
                  </div>
                </div>

                {/* Test params for REST API — show ALL params (system + user_input) so admin can override */}
                {expanded && ct === 'rest_api' && params.length > 0 && (
                  <div className="px-4 pb-2 flex flex-wrap gap-2 items-end">
                    {params.filter(p => p.source !== 'fixed').map(p => {
                      const isSystem = p.source !== 'user_input'
                      const hint = isSystem ? SOURCE_OPTIONS.find(o => o.value === p.source)?.label || p.source : ''
                      return (
                        <div key={p.name} className="flex flex-col">
                          <label className="text-xs text-slate-500">
                            {p.label || p.name}
                            {isSystem && <span className="ml-1 text-blue-400" title={`系統: ${hint}`}>⚙</span>}
                            {p.default_value ? ` (預設: ${p.default_value})` : ''}
                          </label>
                          <input value={testParams[p.name] || ''} onChange={e => setTestParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                            placeholder={isSystem ? `自動: ${hint}` : (p.default_value || p.name)}
                            className={`border rounded px-2 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-blue-400 ${isSystem ? 'border-blue-200 bg-blue-50/30' : 'border-slate-300'}`} />
                        </div>
                      )
                    })}
                  </div>
                )}

                {msg && msg.text && (
                  <div className={`px-4 pb-2 text-xs whitespace-pre-wrap ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>
                    {msg.text}
                  </div>
                )}

                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
                    <div className="flex gap-2 text-xs">
                      <span className="font-medium text-slate-500 w-24">類型</span>
                      <span className="text-slate-700">{connLabel(ct)}</span>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <span className="font-medium text-slate-500 w-24">API URL</span>
                      <span className="font-mono text-slate-700 break-all">{kb.api_server}</span>
                    </div>
                    {ct === 'rest_api' && (
                      <>
                        <div className="flex gap-2 text-xs">
                          <span className="font-medium text-slate-500 w-24">HTTP Method</span>
                          <span className="text-slate-700">{kb.http_method || 'POST'}</span>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <span className="font-medium text-slate-500 w-24">認證方式</span>
                          <span className="text-slate-700">{AUTH_OPTIONS.find(a => a.value === kb.auth_type)?.label || kb.auth_type}</span>
                        </div>
                      </>
                    )}
                    <div className="flex gap-2 text-xs">
                      <span className="font-medium text-slate-500 w-24">API Key</span>
                      <span className="font-mono text-slate-400">{kb.api_key_masked || '(無)'}</span>
                    </div>
                    {kb.description && (
                      <div className="flex gap-2 text-xs">
                        <span className="font-medium text-slate-500 w-24">描述</span>
                        <span className="text-slate-600">{kb.description}</span>
                      </div>
                    )}
                    {params.length > 0 && (
                      <div className="text-xs">
                        <span className="font-medium text-slate-500">輸入參數：</span>
                        <span className="text-slate-600">{params.map(p => `${p.name}(${SOURCE_OPTIONS.find(s => s.value === p.source)?.label || p.source})`).join(', ')}</span>
                      </div>
                    )}
                    <div className="flex gap-2 text-xs text-slate-400">
                      <Clock size={11} className="mt-0.5" /> 更新：{fmtTW(kb.updated_at)}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Call Logs */}
      {selectedLogKb && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-medium text-slate-700 text-sm">「{selectedLogKb.name}」呼叫記錄（最近 50 筆）</div>
            <button onClick={() => setSelectedLogKb(null)} className="text-xs text-slate-400 hover:text-slate-600">關閉</button>
          </div>
          {logsLoading ? (
            <div className="text-slate-400 text-sm py-6 text-center">載入中...</div>
          ) : logs.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">尚無呼叫記錄</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-slate-500">
                  <th className="px-3 py-2 text-left font-medium">時間</th>
                  <th className="px-3 py-2 text-left font-medium">使用者</th>
                  <th className="px-3 py-2 text-left font-medium">狀態</th>
                  <th className="px-3 py-2 text-left font-medium">耗時</th>
                  <th className="px-3 py-2 text-left font-medium">查詢</th>
                  <th className="px-3 py-2 text-left font-medium">回應預覽</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{log.called_at}</td>
                      <td className="px-3 py-2 text-slate-500">{log.user_name || '—'}</td>
                      <td className="px-3 py-2">
                        {log.status === 'ok'
                          ? <span className="flex items-center gap-1 text-green-600"><CheckCircle size={11} /> ok</span>
                          : <span className="flex items-center gap-1 text-red-500"><AlertCircle size={11} /> error</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{log.duration_ms != null ? `${log.duration_ms}ms` : '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[160px] truncate">{log.query_preview || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{log.status === 'error' ? log.error_msg : (log.response_preview || '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Edit/Add Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="px-6 pt-5 pb-0 shrink-0">
              <h3 className="text-base font-semibold text-slate-800">
                {editing ? '編輯 API 連接器' : '新增 API 連接器'}
              </h3>
              {/* Tabs */}
              <div className="flex gap-1 mt-3 border-b border-slate-200">
                {([
                  { k: 'basic', l: '基本設定' },
                  { k: 'params', l: '輸入參數' },
                  { k: 'response', l: '回應設定' },
                ] as const).map(t => (
                  <button key={t.k} onClick={() => setActiveTab(t.k)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === t.k
                      ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                    {t.l}
                    {t.k === 'params' && inputParams.length > 0 && (
                      <span className="ml-1 text-xs bg-blue-100 text-blue-600 px-1.5 rounded-full">{inputParams.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4">
              {/* ── Tab: Basic ── */}
              {activeTab === 'basic' && (
                <div className="space-y-3">
                  {/* Connector Type */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">連接器類型 *</label>
                    <div className="flex gap-3">
                      {[
                        { v: 'dify', l: 'DIFY', icon: <Database size={14} className="text-purple-500" /> },
                        { v: 'rest_api', l: 'REST API', icon: <Plug size={14} className="text-orange-500" /> },
                      ].map(opt => (
                        <label key={opt.v} className={`flex items-center gap-2 px-4 py-2.5 border rounded-lg cursor-pointer transition ${form.connector_type === opt.v ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                          <input type="radio" name="ct" value={opt.v} checked={form.connector_type === opt.v}
                            onChange={() => setForm(p => ({
                              ...p, connector_type: opt.v,
                              auth_type: opt.v === 'dify' ? 'bearer' : p.auth_type,
                              api_server: opt.v === 'dify' && !p.api_server ? 'https://fldify-api.foxlink.com.tw/v1' : p.api_server,
                            }))}
                            className="accent-blue-600" />
                          {opt.icon}
                          <span className="text-sm text-slate-700">{opt.l}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">名稱 *</label>
                    <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="例：AF 簽核進度查詢"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-600 mb-1">API URL *</label>
                      <input value={form.api_server} onChange={e => setForm(p => ({ ...p, api_server: e.target.value }))}
                        placeholder="https://api.example.com/endpoint"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    {form.connector_type === 'rest_api' && (
                      <div className="w-28">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
                        <select value={form.http_method} onChange={e => setForm(p => ({ ...p, http_method: e.target.value }))}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                          {HTTP_METHODS.map(m => <option key={m}>{m}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {form.connector_type === 'rest_api' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Content-Type</label>
                      <select value={form.content_type} onChange={e => setForm(p => ({ ...p, content_type: e.target.value }))}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="application/json">application/json</option>
                        <option value="application/xml">application/xml</option>
                        <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                        <option value="text/plain">text/plain</option>
                      </select>
                    </div>
                  )}

                  {/* Auth */}
                  <div className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/50">
                    <label className="block text-xs font-medium text-slate-600">認證方式</label>
                    <select value={form.auth_type} onChange={e => setForm(p => ({ ...p, auth_type: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                      {AUTH_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>

                    {form.auth_type !== 'none' && form.auth_type !== 'custom' && (
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">
                          {form.auth_type === 'basic' ? 'username:password' : 'API Key'} {editing ? '（留空保持不變）' : ''}
                        </label>
                        <input type="password" value={form.api_key}
                          onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))}
                          placeholder={editing ? '留空表示不修改' : form.auth_type === 'basic' ? 'user:pass' : 'your-api-key'}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    )}

                    {form.auth_type === 'api_key_header' && (
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Header 名稱 *</label>
                        <input value={form.auth_header_name}
                          onChange={e => setForm(p => ({ ...p, auth_header_name: e.target.value }))}
                          placeholder="例：FOX_WEBSERVICE_API_KEY"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    )}

                    {form.auth_type === 'api_key_query' && (
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Query 參數名稱 *</label>
                        <input value={form.auth_query_param_name}
                          onChange={e => setForm(p => ({ ...p, auth_query_param_name: e.target.value }))}
                          placeholder="例：api_key"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    )}

                    {form.auth_type === 'oauth2_client' && (
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">OAuth2 設定 (JSON)</label>
                        <textarea value={form.auth_config} rows={5}
                          onChange={e => setForm(p => ({ ...p, auth_config: e.target.value }))}
                          placeholder='{"token_url":"","client_id":"","client_secret":"","scope":"","token_cache_seconds":3600}'
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      描述（告訴 AI 此工具的用途，方便 AI 判斷呼叫時機）
                    </label>
                    <textarea value={form.description} rows={3}
                      onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="例：查詢 AgentFlow 簽核進度，可查詢已簽文件清單"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  </div>

                  {form.connector_type === 'rest_api' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">自定義 Headers (JSON)</label>
                        <textarea value={form.request_headers} rows={3}
                          onChange={e => setForm(p => ({ ...p, request_headers: e.target.value }))}
                          placeholder='{"Content-Type": "application/json"}'
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Request Body Template <span className="font-normal text-slate-400">(用 {'{{param}}'} 作為佔位符)</span>
                        </label>
                        <textarea value={form.request_body_template} rows={5}
                          onChange={e => setForm(p => ({ ...p, request_body_template: e.target.value }))}
                          placeholder={'{\n  "email": "{{email}}",\n  "days": "{{days}}"\n}'}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs text-slate-500 mb-1">標籤 (Tags)</label>
                    <TagInput tags={tags} onChange={setTags} placeholder="輸入標籤後按 Enter" />
                  </div>
                  <TranslationFields data={trans} onChange={setTrans}
                    translateUrl={editing ? `/dify-kb/${editing.id}/translate` : undefined}
                    hasDescription translating={translating} />
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-600 mb-1">排序順序</label>
                      <input type="number" value={form.sort_order}
                        onChange={e => setForm(p => ({ ...p, sort_order: parseInt(e.target.value) || 0 }))}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded accent-blue-600" />
                        <span className="text-sm text-slate-700">啟用</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.is_public} onChange={e => setForm(p => ({ ...p, is_public: e.target.checked }))} className="rounded accent-blue-600" />
                        <span className="text-sm text-slate-700 flex items-center gap-1"><Globe size={12} className="text-green-600" /> 公開</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer" title="啟用後，當 Email 參數查無結果時，自動嘗試 foxlink.com ↔ foxlink.com.tw 互換重試">
                        <input type="checkbox" checked={form.email_domain_fallback} onChange={e => setForm(p => ({ ...p, email_domain_fallback: e.target.checked }))} className="rounded accent-blue-600" />
                        <span className="text-sm text-slate-700">Email 域名自動重試</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tab: Input Params ── */}
              {activeTab === 'params' && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 mb-2">
                    定義此 API 需要的輸入參數。<code className="bg-slate-100 px-1 rounded">system_*</code> 參數自動注入，<code className="bg-slate-100 px-1 rounded">user_input</code> 由 AI 從對話中提取。
                  </div>
                  {inputParams.length === 0 && (
                    <div className="text-slate-400 text-sm py-6 text-center border-2 border-dashed border-slate-200 rounded-lg">
                      尚未定義輸入參數
                    </div>
                  )}
                  {inputParams.map((p, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                      {/* Summary row */}
                      <div className="px-3 py-2 bg-slate-50 flex items-center gap-2 cursor-pointer"
                        onClick={() => setEditingParamIdx(editingParamIdx === idx ? null : idx)}>
                        <ChevronRight size={14} className={`text-slate-400 transition ${editingParamIdx === idx ? 'rotate-90' : ''}`} />
                        <code className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{p.name || '(未命名)'}</code>
                        <span className="text-xs text-slate-500">{SOURCE_OPTIONS.find(s => s.value === p.source)?.label || p.source}</span>
                        {p.required && <span className="text-xs text-red-400">必填</span>}
                        <span className="text-xs text-slate-400">{p.param_location}</span>
                        <div className="flex-1" />
                        <button onClick={e => { e.stopPropagation(); removeParam(idx) }}
                          className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                      {/* Detail */}
                      {editingParamIdx === idx && (
                        <div className="px-3 py-3 space-y-2 bg-white">
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-slate-500 mb-0.5">參數名稱 *</label>
                              <input value={p.name} onChange={e => updateParam(idx, { name: e.target.value })}
                                placeholder="email" className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono" />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-0.5">顯示名稱</label>
                              <input value={p.label} onChange={e => updateParam(idx, { label: e.target.value })}
                                placeholder="Email" className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-0.5">類型</label>
                              <select value={p.type} onChange={e => updateParam(idx, { type: e.target.value as any })}
                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                <option value="string">String</option>
                                <option value="number">Number</option>
                                <option value="date">Date</option>
                                <option value="enum">Enum</option>
                                <option value="boolean">Boolean</option>
                              </select>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-slate-500 mb-0.5">值來源 *</label>
                              <select value={p.source} onChange={e => updateParam(idx, { source: e.target.value })}
                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                {SOURCE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-0.5">參數位置</label>
                              <select value={p.param_location} onChange={e => updateParam(idx, { param_location: e.target.value as any })}
                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                <option value="body">Body</option>
                                <option value="query">Query</option>
                                <option value="path">Path</option>
                                <option value="header">Header</option>
                              </select>
                            </div>
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 cursor-pointer pb-1.5">
                                <input type="checkbox" checked={p.required} onChange={e => updateParam(idx, { required: e.target.checked })} className="rounded accent-blue-600" />
                                <span className="text-xs text-slate-700">必填</span>
                              </label>
                            </div>
                          </div>
                          {p.source === 'fixed' && (
                            <div>
                              <label className="block text-xs text-slate-500 mb-0.5">固定值</label>
                              <input value={p.fixed_value || ''} onChange={e => updateParam(idx, { fixed_value: e.target.value })}
                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            </div>
                          )}
                          {p.source === 'user_input' && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-slate-500 mb-0.5">預設值</label>
                                <input value={p.default_value || ''} onChange={e => updateParam(idx, { default_value: e.target.value })}
                                  placeholder="AI 提取不到時使用"
                                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-0.5">提取 Regex</label>
                                <input value={p.extract_pattern || ''} onChange={e => updateParam(idx, { extract_pattern: e.target.value })}
                                  placeholder={'(\\d+)\\s*天'}
                                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              </div>
                            </div>
                          )}
                          {p.type === 'enum' && (
                            <div>
                              <label className="block text-xs text-slate-500 mb-0.5">
                                選項 (JSON: [{'{"value":"a","label":"A"}'}])
                              </label>
                              <input value={JSON.stringify(p.enum_options || [])}
                                onChange={e => { try { updateParam(idx, { enum_options: JSON.parse(e.target.value) }) } catch {} }}
                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            </div>
                          )}
                          <div>
                            <label className="block text-xs text-slate-500 mb-0.5">參數說明</label>
                            <input value={p.description || ''} onChange={e => updateParam(idx, { description: e.target.value })}
                              placeholder="此參數的用途說明（也會作為 AI 的提示）"
                              className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  <button onClick={addParam}
                    className="w-full py-2 text-sm text-blue-600 border-2 border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition">
                    <Plus size={14} className="inline mr-1" /> 新增參數
                  </button>
                </div>
              )}

              {/* ── Tab: Response ── */}
              {activeTab === 'response' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">回應模式</label>
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
                          {mode === 'inject' ? 'Inject (補充 Prompt)' : 'Answer (直接回答)'}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {form.response_mode === 'answer'
                        ? 'API 結果 (套用下方模板後) 直接輸出給使用者,不經 LLM 整理 — 避免 LLM 加註額外意見。'
                        : 'API 結果餵回 LLM,由 LLM 整合後回答 (可能附加說明或建議)。'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">回應類型</label>
                    <select value={form.response_type} onChange={e => setForm(p => ({ ...p, response_type: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="json">JSON</option>
                      <option value="text">Text</option>
                      <option value="xml">XML</option>
                      <option value="auto">Auto</option>
                    </select>
                  </div>
                  {(form.response_type === 'json' || form.response_type === 'auto') && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        JSON 提取路徑 <span className="font-normal text-slate-400">(如 data.answer 或 data[0].name)</span>
                      </label>
                      <input value={form.response_extract} onChange={e => setForm(p => ({ ...p, response_extract: e.target.value }))}
                        placeholder="data.answer"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      回應格式模板 <span className="font-normal text-slate-400">(支援 Markdown，用 {'{{response}}'} 代表回應)</span>
                    </label>
                    <textarea value={form.response_template} rows={4}
                      onChange={e => setForm(p => ({ ...p, response_template: e.target.value }))}
                      placeholder={'查詢結果：\n---\n{{response}}\n\n資料來源：外部 API\n查詢時間：{{system_datetime}}'}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">空回應提示</label>
                    <input value={form.empty_message} onChange={e => setForm(p => ({ ...p, empty_message: e.target.value }))}
                      placeholder="查無資料"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      錯誤訊息對照 (JSON) <span className="font-normal text-slate-400">{'{"401":"認證失敗","404":"查無資料"}'}</span>
                    </label>
                    <textarea value={form.error_mapping} rows={3}
                      onChange={e => setForm(p => ({ ...p, error_mapping: e.target.value }))}
                      placeholder='{"401": "API 認證失敗，請聯繫管理員", "500": "外部服務異常"}'
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  </div>
                </div>
              )}

              {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 shrink-0">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">取消</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                {saving ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareKb && (
        <ShareModal title={`API 連接器 — ${shareKb.name}`}
          sharesUrl={`/dify-kb/${shareKb.id}/access`}
          onClose={() => setShareKb(null)} />
      )}
      </>
      )}
    </div>
  )
}

function tryParseJson(s: string) {
  try { return JSON.parse(s) } catch { return s }
}
