import { useState, useEffect } from 'react'
import { Cpu, Plus, Trash2, Pencil, Check, X, RefreshCw, ToggleLeft, ToggleRight, Eye, EyeOff, KeyRound, Zap, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LlmModel, LlmProviderType, LlmModelRole } from '../../types'
import api from '../../lib/api'

interface FormData extends Omit<LlmModel, 'id' | 'created_at' | 'has_api_key' | 'has_extra_config'> {
  api_key: string
  // OCI credential fields (plaintext, never stored directly)
  oci_user: string
  oci_fingerprint: string
  oci_tenancy: string
  oci_region: string
  oci_compartment_id: string
  oci_private_key: string
}

const emptyForm = (provider: LlmProviderType = 'gemini'): FormData => ({
  key: '', name: '', api_model: '', description: '',
  is_active: 1, sort_order: 0, image_output: 0,
  provider_type: provider,
  model_role: 'chat',
  api_key: '',
  endpoint_url: '', api_version: '2024-08-01-preview',
  deployment_name: '', base_model: '',
  oci_user: '', oci_fingerprint: '', oci_tenancy: '',
  oci_region: 'ap-tokyo-1', oci_compartment_id: '', oci_private_key: '',
})

const PROVIDER_LABEL: Record<LlmProviderType, string> = {
  gemini:       'Google Gemini',
  azure_openai: 'Azure OpenAI',
  oci:          'Oracle Cloud (OCI)',
  cohere:       'Cohere',
}

// ── Model Form Dialog ─────────────────────────────────────────────────────────
interface ModelDialogProps {
  form: FormData
  editId?: number
  isEdit: boolean
  hasApiKey: boolean
  hasExtraConfig: boolean
  onChange: (f: FormData) => void
  onSave: () => void
  onClose: () => void
  error: string
}

function ModelDialog({ form, editId, isEdit, hasApiKey, hasExtraConfig, onChange, onSave, onClose, error }: ModelDialogProps) {
  const { t } = useTranslation()
  const [showKey,    setShowKey]    = useState(false)
  const [showPKey,   setShowPKey]   = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const isAzure  = form.provider_type === 'azure_openai'
  const isOci    = form.provider_type === 'oci'
  const isCohere = form.provider_type === 'cohere'

  const MODEL_ROLE_LABEL: Record<LlmModelRole, string> = {
    chat:      t('llm.roles.chat'),
    embedding: t('llm.roles.embedding'),
    rerank:    t('llm.roles.rerank'),
    tts:       t('llm.roles.tts'),
    stt:       t('llm.roles.stt'),
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const res = await api.post('/admin/llm-models/test', {
        id:              editId || undefined,
        provider_type:   form.provider_type,
        model_role:      form.model_role,
        api_key:         form.api_key || undefined,
        api_model:       form.api_model,
        endpoint_url:    form.endpoint_url,
        api_version:     form.api_version,
        deployment_name: form.deployment_name,
        oci_user:           form.oci_user || undefined,
        oci_fingerprint:    form.oci_fingerprint || undefined,
        oci_tenancy:        form.oci_tenancy || undefined,
        oci_region:         form.oci_region || undefined,
        oci_compartment_id: form.oci_compartment_id || undefined,
        oci_private_key:    form.oci_private_key || undefined,
      })
      if (res.data.ok) {
        setTestResult({ ok: true, msg: t('llm.testOk', { reply: res.data.reply }) })
      } else {
        setTestResult({ ok: false, msg: res.data.error || t('llm.testFailed') })
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
            <p className="text-white font-semibold text-sm">{isEdit ? t('llm.form.editTitle') : t('llm.form.addTitle')}</p>
            <p className="text-slate-400 text-xs mt-0.5">{PROVIDER_LABEL[form.provider_type || 'gemini']}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Provider type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('llm.form.providerType')} *</label>
              <select
                value={form.provider_type}
                onChange={(e) => onChange({ ...emptyForm(e.target.value as LlmProviderType), key: form.key, name: form.name })}
                className="input w-full"
                disabled={isEdit}
              >
                <option value="gemini">Google Gemini</option>
                <option value="azure_openai">Azure OpenAI</option>
                <option value="oci">Oracle Cloud (OCI)</option>
                <option value="cohere">Cohere</option>
              </select>
            </div>
            <div>
              <label className="label">{t('llm.form.modelRole')} *</label>
              <select
                value={form.model_role || 'chat'}
                onChange={(e) => onChange({ ...form, model_role: e.target.value as LlmModelRole })}
                className="input w-full"
              >
                <option value="chat">{MODEL_ROLE_LABEL.chat}</option>
                <option value="embedding">{MODEL_ROLE_LABEL.embedding}</option>
                <option value="rerank">{MODEL_ROLE_LABEL.rerank}</option>
                <option value="tts">{MODEL_ROLE_LABEL.tts}</option>
                <option value="stt">{MODEL_ROLE_LABEL.stt}</option>
              </select>
            </div>
          </div>

          {/* Common: key + name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('llm.form.key')} * <span className="text-slate-400 font-normal">（{t('llm.form.keyDesc')}）</span></label>
              <input value={form.key} onChange={(e) => onChange({ ...form, key: e.target.value })}
                placeholder="pro / gpt4o-eus" className="input w-full" disabled={isEdit} />
            </div>
            <div>
              <label className="label">{t('llm.form.displayName')} *</label>
              <input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })}
                placeholder="Gemini Pro" className="input w-full" />
            </div>
          </div>

          {/* Gemini / OCI: api_model */}
          {!isAzure && (
            <div>
              <label className="label">{t('llm.form.apiModel')} *</label>
              <input value={form.api_model || ''} onChange={(e) => onChange({ ...form, api_model: e.target.value })}
                placeholder={isOci ? 'cohere.rerank-multilingual-v3.0 / cohere.embed-multilingual-v3.0' : isCohere ? 'rerank-multilingual-v3 / embed-multilingual-v3' : 'gemini-2.0-flash'}
                className="input w-full font-mono text-sm" />
              {isOci && <p className="text-xs text-slate-400 mt-0.5">{t('llm.form.ociModelNote')}</p>}
              {isCohere && <p className="text-xs text-slate-400 mt-0.5">{t('llm.form.cohereModelNote')}</p>}
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
              <p className="text-xs text-slate-400 mt-0.5">{t('llm.form.azureEndpointNote')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">API Version *</label>
                <input value={form.api_version || ''} onChange={(e) => onChange({ ...form, api_version: e.target.value })}
                  placeholder="2024-08-01-preview" className="input w-full font-mono text-sm" />
              </div>
              <div>
                <label className="label">Base Model <span className="text-slate-400 font-normal">（{t('llm.form.reference')}）</span></label>
                <input value={form.base_model || ''} onChange={(e) => onChange({ ...form, base_model: e.target.value })}
                  placeholder="gpt-4o" className="input w-full font-mono text-sm" />
              </div>
            </div>
          </>)}

          {/* OCI Credentials */}
          {isOci && (<>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              {t('llm.form.ociEncryptNote')}
              {isEdit && hasExtraConfig && ' ' + t('llm.form.ociKeepNote')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">User OCID *</label>
                <input value={form.oci_user} onChange={(e) => onChange({ ...form, oci_user: e.target.value })}
                  placeholder={isEdit && hasExtraConfig ? t('llm.form.keepExisting') : 'ocid1.user.oc1..xxx'}
                  className="input w-full font-mono text-xs" />
              </div>
              <div>
                <label className="label">Tenancy OCID *</label>
                <input value={form.oci_tenancy} onChange={(e) => onChange({ ...form, oci_tenancy: e.target.value })}
                  placeholder={isEdit && hasExtraConfig ? t('llm.form.keepExisting') : 'ocid1.tenancy.oc1..xxx'}
                  className="input w-full font-mono text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Fingerprint *</label>
                <input value={form.oci_fingerprint} onChange={(e) => onChange({ ...form, oci_fingerprint: e.target.value })}
                  placeholder={isEdit && hasExtraConfig ? t('llm.form.keepExisting') : '8f:5b:a3:b6:...'}
                  className="input w-full font-mono text-xs" />
              </div>
              <div>
                <label className="label">Region</label>
                <input value={form.oci_region} onChange={(e) => onChange({ ...form, oci_region: e.target.value })}
                  placeholder="ap-tokyo-1" className="input w-full font-mono text-xs" />
              </div>
            </div>
            <div>
              <label className="label">Compartment ID <span className="text-slate-400 font-normal">（{t('llm.form.compartmentNote')}）</span></label>
              <input value={form.oci_compartment_id} onChange={(e) => onChange({ ...form, oci_compartment_id: e.target.value })}
                placeholder={t('llm.form.compartmentPlaceholder')} className="input w-full font-mono text-xs" />
            </div>
            <div>
              <label className="label flex items-center gap-1.5">
                <KeyRound size={12} /> Private Key (PEM) *
                {isEdit && hasExtraConfig && <span className="text-green-600 font-normal text-xs">（{t('llm.form.keySet')}，{t('llm.form.keepIfBlank')}）</span>}
              </label>
              <div className="relative">
                <textarea
                  rows={4}
                  value={showPKey ? form.oci_private_key : (form.oci_private_key ? '••••••••••••••••' : '')}
                  onChange={(e) => onChange({ ...form, oci_private_key: e.target.value })}
                  onFocus={() => setShowPKey(true)}
                  placeholder={isEdit && hasExtraConfig ? t('llm.form.keepPrivateKey') : t('llm.form.pastePem')}
                  className="input w-full font-mono text-xs pr-10 resize-none"
                />
                <button type="button" onClick={() => setShowPKey((v) => !v)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
                  {showPKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </>)}

          {/* API Key (Gemini / Azure only) */}
          {!isOci && (
            <div>
              <label className="label flex items-center gap-1.5">
                <KeyRound size={12} />
                API Key {isEdit && hasApiKey && <span className="text-green-600 font-normal text-xs">（{t('llm.keySet')}，{t('llm.form.keepIfBlank')}）</span>}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={form.api_key}
                  onChange={(e) => onChange({ ...form, api_key: e.target.value })}
                  placeholder={isEdit && hasApiKey ? t('llm.form.keepExistingKey') : t('llm.form.enterApiKey')}
                  className="input w-full pr-10 font-mono text-sm"
                />
                <button type="button" onClick={() => setShowKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {!isAzure && !isCohere && (
                <p className="text-xs text-slate-400 mt-0.5">{t('llm.useEnv')}</p>
              )}
            </div>
          )}

          {/* Description + sort */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label">{t('llm.form.description')} <span className="text-slate-400 font-normal">（{t('llm.form.optional')}）</span></label>
              <input value={form.description || ''} onChange={(e) => onChange({ ...form, description: e.target.value })}
                placeholder={t('llm.form.descriptionPlaceholder')} className="input w-full" />
            </div>
            <div>
              <label className="label">{t('llm.form.sortOrder')}</label>
              <input type="number" value={form.sort_order ?? 0}
                onChange={(e) => onChange({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                className="input w-full" />
            </div>
          </div>

          {/* Image output (Gemini only) */}
          {!isAzure && !isOci && (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input type="checkbox" checked={!!form.image_output}
                onChange={(e) => onChange({ ...form, image_output: e.target.checked ? 1 : 0 })}
                className="w-4 h-4 accent-purple-600" />
              {t('llm.form.imageOutput')}
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
            {t('llm.testConnection')}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">{t('common.cancel')}</button>
            <button onClick={onSave} className="btn-primary flex items-center gap-1.5">
              <Check size={14} /> {isEdit ? t('common.save') : t('common.add')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function LlmModelsPanel() {
  const { t } = useTranslation()
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
      model_role: m.model_role || 'chat',
      api_key: '',   // never pre-fill
      endpoint_url: m.endpoint_url || '', api_version: m.api_version || '2024-08-01-preview',
      deployment_name: m.deployment_name || '', base_model: m.base_model || '',
      // OCI: always blank on load — server never returns plaintext creds
      oci_user: '', oci_fingerprint: '', oci_tenancy: '',
      oci_region: 'ap-tokyo-1', oci_compartment_id: '', oci_private_key: '',
    })
    setError(''); setEditModel(m); setShowForm(true)
  }

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = { ...form }
      if (!payload.api_key) delete payload.api_key
      // Strip blank OCI fields — server keeps existing if not provided
      if (form.provider_type === 'oci') {
        if (!form.oci_private_key?.trim()) {
          delete payload.oci_private_key
          delete payload.oci_user
          delete payload.oci_fingerprint
          delete payload.oci_tenancy
          delete payload.oci_compartment_id
        }
      }
      if (editModel) {
        await api.put(`/admin/llm-models/${editModel.id}`, payload)
      } else {
        await api.post('/admin/llm-models', payload)
      }
      setShowForm(false); setError(''); load()
    } catch (e: any) {
      setError(e.response?.data?.error || t('llm.saveFailed'))
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('llm.deleteConfirm'))) return
    await api.delete(`/admin/llm-models/${id}`); load()
  }

  const toggleActive = async (m: LlmModel) => {
    await api.put(`/admin/llm-models/${m.id}`, {
      ...m, api_key: undefined, is_active: m.is_active ? 0 : 1,
    }); load()
  }

  const providerBadge = (pt: LlmProviderType | undefined) => {
    if (pt === 'azure_openai') return <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Azure</span>
    if (pt === 'oci')    return <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">OCI</span>
    if (pt === 'cohere') return <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-medium">Cohere</span>
    return <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Gemini</span>
  }

  const roleBadge = (role: string | undefined) => {
    if (role === 'embedding') return <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">Embed</span>
    if (role === 'rerank')    return <span className="text-xs bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded font-medium">Rerank</span>
    if (role === 'tts')       return <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-medium">TTS</span>
    if (role === 'stt')       return <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">STT</span>
    return null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Cpu size={20} className="text-blue-500" /> {t('llm.title')}
        </h2>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('common.refresh')}
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} /> {t('llm.addModel')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {[t('llm.cols.key'), t('llm.cols.provider'), t('llm.cols.role'), t('llm.cols.name'), t('llm.cols.model'), t('llm.cols.description'), t('llm.cols.apiKey'), t('llm.cols.sort'), ''].map((h) => (
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
                <td className="px-3 py-3">{roleBadge(m.model_role)}</td>
                <td className="px-3 py-3 font-medium text-slate-700">{m.name}</td>
                <td className="px-3 py-3">
                  <code className="text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                    {m.provider_type === 'azure_openai' ? m.deployment_name : m.api_model}
                  </code>
                </td>
                <td className="px-3 py-3 text-slate-500 text-xs max-w-32 truncate">{m.description || '-'}</td>
                <td className="px-3 py-3 text-xs">
                  {m.provider_type === 'oci'
                    ? (m.has_extra_config
                        ? <span className="text-orange-600 flex items-center gap-1"><KeyRound size={11} />{t('llm.ociSet')}</span>
                        : <span className="text-red-400">{t('llm.keyNotSet')}</span>)
                    : (m.has_api_key
                        ? <span className="text-green-600 flex items-center gap-1"><KeyRound size={11} />{t('llm.keySet')}</span>
                        : <span className="text-slate-400">{t('llm.useEnv')}</span>)
                  }
                </td>
                <td className="px-3 py-3 text-slate-500">{m.sort_order ?? 0}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleActive(m)} title={m.is_active ? t('common.disable') : t('common.enable')}
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
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-sm">{t('llm.noModels')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-4 bg-blue-50 rounded-xl text-xs text-slate-500 space-y-1">
        {t('llm.notes', { returnObjects: true }) instanceof Array
          ? (t('llm.notes', { returnObjects: true }) as string[]).map((note, i) => <p key={i}>{note}</p>)
          : null}
      </div>

      {showForm && (
        <ModelDialog
          form={form}
          editId={editModel?.id}
          isEdit={!!editModel}
          hasApiKey={!!editModel?.has_api_key}
          hasExtraConfig={!!editModel?.has_extra_config}
          onChange={setForm}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setError('') }}
          error={error}
        />
      )}
    </div>
  )
}
