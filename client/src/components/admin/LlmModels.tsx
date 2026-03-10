import { useState, useEffect } from 'react'
import { Cpu, Plus, Trash2, Pencil, Check, X, RefreshCw, ToggleLeft, ToggleRight, Eye, EyeOff, KeyRound, Zap, Loader2 } from 'lucide-react'
import type { LlmModel, LlmProviderType } from '../../types'
import api from '../../lib/api'

interface FormData extends Omit<LlmModel, 'id' | 'created_at' | 'has_api_key'> {
  api_key: string   // plaintext input only — never read back from server
}

const emptyForm = (provider: LlmProviderType = 'gemini'): FormData => ({
  key: '', name: '', api_model: '', description: '',
  is_active: 1, sort_order: 0, image_output: 0,
  provider_type: provider,
  api_key: '',
  endpoint_url: '', api_version: '2024-08-01-preview',
  deployment_name: '', base_model: '',
})

const PROVIDER_LABEL: Record<LlmProviderType, string> = {
  gemini:       'Google Gemini',
  azure_openai: 'Azure OpenAI',
}

// ── Model Form Dialog ─────────────────────────────────────────────────────────
interface ModelDialogProps {
  form: FormData
  isEdit: boolean
  hasApiKey: boolean
  onChange: (f: FormData) => void
  onSave: () => void
  onClose: () => void
  error: string
}

function ModelDialog({ form, isEdit, hasApiKey, onChange, onSave, onClose, error }: ModelDialogProps) {
  const [showKey,    setShowKey]    = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const isAzure = form.provider_type === 'azure_openai'

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const res = await api.post('/admin/llm-models/test', {
        provider_type:   form.provider_type,
        api_key:         form.api_key || undefined,
        api_model:       form.api_model,
        endpoint_url:    form.endpoint_url,
        api_version:     form.api_version,
        deployment_name: form.deployment_name,
      })
      if (res.data.ok) {
        setTestResult({ ok: true, msg: `連線成功！回應：${res.data.reply}` })
      } else {
        setTestResult({ ok: false, msg: res.data.error || '測試失敗' })
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.response?.data?.error || e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-800 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold text-sm">{isEdit ? '編輯模型' : '新增模型'}</p>
            <p className="text-slate-400 text-xs mt-0.5">{PROVIDER_LABEL[form.provider_type || 'gemini']}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Provider type */}
          <div>
            <label className="label">供應商類型 *</label>
            <select
              value={form.provider_type}
              onChange={(e) => onChange({ ...emptyForm(e.target.value as LlmProviderType), key: form.key, name: form.name })}
              className="input w-full"
              disabled={isEdit}
            >
              <option value="gemini">Google Gemini</option>
              <option value="azure_openai">Azure OpenAI</option>
            </select>
          </div>

          {/* Common: key + name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Key * <span className="text-slate-400 font-normal">（唯一識別碼）</span></label>
              <input value={form.key} onChange={(e) => onChange({ ...form, key: e.target.value })}
                placeholder="pro / gpt4o-eus" className="input w-full" disabled={isEdit} />
            </div>
            <div>
              <label className="label">顯示名稱 *</label>
              <input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })}
                placeholder="Gemini Pro" className="input w-full" />
            </div>
          </div>

          {/* Gemini: api_model */}
          {!isAzure && (
            <div>
              <label className="label">API Model 字串 *</label>
              <input value={form.api_model || ''} onChange={(e) => onChange({ ...form, api_model: e.target.value })}
                placeholder="gemini-2.0-flash" className="input w-full font-mono text-sm" />
            </div>
          )}

          {/* Azure: deployment + endpoint + version + base model */}
          {isAzure && (<>
            <div>
              <label className="label">Deployment Name *</label>
              <input value={form.deployment_name || ''} onChange={(e) => onChange({ ...form, deployment_name: e.target.value, api_model: e.target.value })}
                placeholder="gpt-4o" className="input w-full font-mono text-sm" />
            </div>
            <div>
              <label className="label">API Endpoint URL *</label>
              <input value={form.endpoint_url || ''} onChange={(e) => onChange({ ...form, endpoint_url: e.target.value })}
                placeholder="https://fl-aoai-eus.openai.azure.com" className="input w-full font-mono text-sm" />
              <p className="text-xs text-slate-400 mt-0.5">只填 base URL，不含 /openai/deployments/...</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">API Version *</label>
                <input value={form.api_version || ''} onChange={(e) => onChange({ ...form, api_version: e.target.value })}
                  placeholder="2024-08-01-preview" className="input w-full font-mono text-sm" />
              </div>
              <div>
                <label className="label">Base Model <span className="text-slate-400 font-normal">（參考）</span></label>
                <input value={form.base_model || ''} onChange={(e) => onChange({ ...form, base_model: e.target.value })}
                  placeholder="gpt-4o" className="input w-full font-mono text-sm" />
              </div>
            </div>
          </>)}

          {/* API Key (both providers) */}
          <div>
            <label className="label flex items-center gap-1.5">
              <KeyRound size={12} />
              API Key {isEdit && hasApiKey && <span className="text-green-600 font-normal text-xs">（已設定，留空則保留原 key）</span>}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.api_key}
                onChange={(e) => onChange({ ...form, api_key: e.target.value })}
                placeholder={isEdit && hasApiKey ? '留空保留現有 key' : '輸入 API Key（加密存入 DB）'}
                className="input w-full pr-10 font-mono text-sm"
              />
              <button type="button" onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {!isAzure && (
              <p className="text-xs text-slate-400 mt-0.5">Gemini 可留空，自動使用 env GEMINI_API_KEY</p>
            )}
          </div>

          {/* Description + sort */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label">描述 <span className="text-slate-400 font-normal">（選填）</span></label>
              <input value={form.description || ''} onChange={(e) => onChange({ ...form, description: e.target.value })}
                placeholder="簡短描述" className="input w-full" />
            </div>
            <div>
              <label className="label">排序</label>
              <input type="number" value={form.sort_order ?? 0}
                onChange={(e) => onChange({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                className="input w-full" />
            </div>
          </div>

          {/* Image output (Gemini only) */}
          {!isAzure && (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input type="checkbox" checked={!!form.image_output}
                onChange={(e) => onChange({ ...form, image_output: e.target.checked ? 1 : 0 })}
                className="w-4 h-4 accent-purple-600" />
              啟用圖片輸出模式（gemini-*-image-preview）
            </label>
          )}
        </div>

        {testResult && (
          <div className={`mx-5 mb-1 px-3 py-2 rounded-lg text-xs ${testResult.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
            {testResult.msg}
          </div>
        )}
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} className="text-yellow-500" />}
            測試連線
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">取消</button>
            <button onClick={onSave} className="btn-primary flex items-center gap-1.5">
              <Check size={14} /> {isEdit ? '儲存' : '新增'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function LlmModelsPanel() {
  const [models,   setModels]   = useState<LlmModel[]>([])
  const [loading,  setLoading]  = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editModel, setEditModel] = useState<LlmModel | null>(null)
  const [form,     setForm]     = useState<FormData>(emptyForm())
  const [error,    setError]    = useState('')

  const load = async () => {
    setLoading(true)
    try { const res = await api.get('/admin/llm-models'); setModels(res.data) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => {
    setForm(emptyForm()); setError(''); setEditModel(null); setShowForm(true)
  }

  const openEdit = (m: LlmModel) => {
    setForm({
      key: m.key, name: m.name, api_model: m.api_model || '',
      description: m.description || '', is_active: m.is_active ?? 1,
      sort_order: m.sort_order ?? 0, image_output: m.image_output ?? 0,
      provider_type: m.provider_type || 'gemini',
      api_key: '',   // never pre-fill
      endpoint_url: m.endpoint_url || '', api_version: m.api_version || '2024-08-01-preview',
      deployment_name: m.deployment_name || '', base_model: m.base_model || '',
    })
    setError(''); setEditModel(m); setShowForm(true)
  }

  const handleSave = async () => {
    try {
      const payload = { ...form }
      if (!payload.api_key) delete (payload as Partial<FormData>).api_key
      if (editModel) {
        await api.put(`/admin/llm-models/${editModel.id}`, payload)
      } else {
        await api.post('/admin/llm-models', payload)
      }
      setShowForm(false); setError(''); load()
    } catch (e: any) {
      setError(e.response?.data?.error || '儲存失敗')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確定刪除此模型設定？')) return
    await api.delete(`/admin/llm-models/${id}`); load()
  }

  const toggleActive = async (m: LlmModel) => {
    await api.put(`/admin/llm-models/${m.id}`, {
      ...m, api_key: undefined, is_active: m.is_active ? 0 : 1,
    }); load()
  }

  const providerBadge = (pt: LlmProviderType | undefined) => {
    if (pt === 'azure_openai') return <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Azure</span>
    return <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Gemini</span>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Cpu size={20} className="text-blue-500" /> LLM 模型設定
        </h2>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新整理
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> 新增模型
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Key', '供應商', '顯示名稱', '模型 / Deployment', '描述', 'API Key', '排序', ''].map((h) => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {models.map((m) => (
              <tr key={m.id} className={`hover:bg-slate-50 transition ${!m.is_active ? 'opacity-50' : ''}`}>
                <td className="px-3 py-3">
                  <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{m.key}</code>
                </td>
                <td className="px-3 py-3">{providerBadge(m.provider_type)}</td>
                <td className="px-3 py-3 font-medium text-slate-700">{m.name}</td>
                <td className="px-3 py-3">
                  <code className="text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                    {m.provider_type === 'azure_openai' ? m.deployment_name : m.api_model}
                  </code>
                </td>
                <td className="px-3 py-3 text-slate-500 text-xs max-w-32 truncate">{m.description || '-'}</td>
                <td className="px-3 py-3 text-xs">
                  {m.has_api_key
                    ? <span className="text-green-600 flex items-center gap-1"><KeyRound size={11} />已設定</span>
                    : <span className="text-slate-400">使用 env</span>
                  }
                </td>
                <td className="px-3 py-3 text-slate-500">{m.sort_order ?? 0}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleActive(m)} title={m.is_active ? '停用' : '啟用'}
                      className={m.is_active ? 'text-green-500 hover:text-green-700' : 'text-slate-300 hover:text-green-500'}>
                      {m.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                    <button onClick={() => openEdit(m)} className="text-slate-400 hover:text-blue-600 transition">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(m.id!)} className="text-slate-400 hover:text-red-600 transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {models.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">尚未設定任何模型</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-4 bg-blue-50 rounded-xl text-xs text-slate-500 space-y-1">
        <p><strong className="text-slate-600">Gemini</strong>：API Key 可留空，自動使用 env <code>GEMINI_API_KEY</code>；填入後加密存 DB 優先使用</p>
        <p><strong className="text-slate-600">Azure OpenAI</strong>：Endpoint 填 base URL（如 <code>https://fl-aoai-eus.openai.azure.com</code>），SDK 會自動組合完整路徑</p>
        <p><strong className="text-slate-600">API Key</strong>：以 AES-256-GCM 加密存入 DB，Server 端解密使用，前端永遠不顯示明文</p>
      </div>

      {showForm && (
        <ModelDialog
          form={form}
          isEdit={!!editModel}
          hasApiKey={!!editModel?.has_api_key}
          onChange={setForm}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setError('') }}
          error={error}
        />
      )}
    </div>
  )
}
