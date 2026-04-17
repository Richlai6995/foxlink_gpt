import { useEffect, useState } from 'react'
import { X, Search, AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Save, Languages } from 'lucide-react'
import api from '../../lib/api'
import type { ErpTool, ErpParam, ErpReturns } from './ErpToolsPanel'

interface OverloadPreview {
  overload: string | null
  routine_type: 'FUNCTION' | 'PROCEDURE'
  has_unsupported: boolean
  unsupported_list: string[]
  params: ErpParam[]
  returns: ErpReturns | null
  suggested_code: string
  metadata_hash: string
}

interface InspectResult {
  owner: string
  package_name: string | null
  object_name: string
  overloads: OverloadPreview[]
}

interface Props {
  tool: ErpTool | null
  allowedSchemas: string[]
  onClose: () => void
  onSaved: () => void
}

const SYSTEM_SOURCES = [
  { v: '', l: '(無)' },
  { v: 'system_user_email', l: '當前使用者 email' },
  { v: 'system_user_name', l: '當前使用者姓名' },
  { v: 'system_user_employee_id', l: '當前使用者工號' },
  { v: 'system_user_dept', l: '當前使用者部門' },
  { v: 'system_user_title', l: '當前使用者職稱' },
  { v: 'system_user_factory', l: '當前使用者廠區' },
  { v: 'system_date', l: '今天日期' },
  { v: 'system_datetime', l: '當下時間' },
]

export default function ErpToolEditor({ tool, allowedSchemas, onClose, onSaved }: Props) {
  const isEdit = !!tool

  const [owner, setOwner] = useState(tool?.db_owner || allowedSchemas[0] || '')
  const [pkg, setPkg] = useState(tool?.package_name || '')
  const [objName, setObjName] = useState(tool?.object_name || '')

  const [inspecting, setInspecting] = useState(false)
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null)
  const [selectedOverload, setSelectedOverload] = useState<string | null>(tool?.overload || null)

  const [form, setForm] = useState({
    code: tool?.code || '',
    name: tool?.name || '',
    description: tool?.description || '',
    tags: (tool?.tags || []).join(', '),
    access_mode: (tool?.access_mode || 'READ_ONLY') as 'READ_ONLY' | 'WRITE',
    endpoint_mode: (tool as any)?.endpoint_mode || 'tool',
    allow_manual: tool ? !!tool.allow_manual : true,
    requires_approval: tool ? !!tool.requires_approval : false,
    max_rows_llm: tool?.max_rows_llm || 50,
    max_rows_ui: tool?.max_rows_ui || 1000,
    timeout_sec: tool?.timeout_sec || 30,
    enabled: tool ? !!tool.enabled : true,
    rate_limit_per_user: (tool as any)?.rate_limit_per_user ?? '',
    rate_limit_global: (tool as any)?.rate_limit_global ?? '',
    rate_limit_window: (tool as any)?.rate_limit_window || 'minute',
    allow_dry_run: tool ? ((tool as any)?.allow_dry_run !== 0) : true,
  })

  const [params, setParams] = useState<ErpParam[]>(tool?.params || [])
  const [returns, setReturns] = useState<ErpReturns | null>(tool?.returns || null)
  const [routineType, setRoutineType] = useState<'FUNCTION' | 'PROCEDURE'>(tool?.routine_type || 'PROCEDURE')
  const [metadataHash, setMetadataHash] = useState<string | null>(tool?.metadata_hash || null)

  const [paramExpanded, setParamExpanded] = useState<Record<number, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translations, setTranslations] = useState<Record<string, any> | null>(null)

  const inspect = async () => {
    setError(null)
    setInspecting(true)
    try {
      const res = await api.post('/erp-tools/inspect', {
        owner, package: pkg || null, name: objName,
      })
      setInspectResult(res.data)
      if (res.data.overloads.length === 1) {
        applyOverload(res.data.overloads[0])
      }
    } catch (e: any) {
      setError(e.response?.data?.error || '查詢失敗')
    } finally {
      setInspecting(false)
    }
  }

  const applyOverload = (ov: OverloadPreview) => {
    setSelectedOverload(ov.overload)
    setRoutineType(ov.routine_type)
    setParams(ov.params)
    setReturns(ov.returns)
    setMetadataHash(ov.metadata_hash)
    if (!form.code) setForm(f => ({ ...f, code: ov.suggested_code }))
    if (!form.name) setForm(f => ({ ...f, name: ov.suggested_code }))
  }

  const updateParam = (idx: number, patch: Partial<ErpParam>) => {
    setParams(ps => ps.map((p, i) => i === idx ? { ...p, ...patch } : p))
  }

  const updateLov = (idx: number, patch: any) => {
    setParams(ps => ps.map((p, i) => {
      if (i !== idx) return p
      return { ...p, lov_config: { ...(p.lov_config || {}), ...patch } }
    }))
  }

  const save = async () => {
    setError(null)
    if (!inspectResult && !isEdit) {
      setError('請先按「查詢 metadata」取得定義')
      return
    }
    if (!form.code || !form.name) {
      setError('code 與 name 必填')
      return
    }
    setSaving(true)
    try {
      const payload = {
        code: form.code,
        name: form.name,
        description: form.description,
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
        db_owner: inspectResult?.owner || tool?.db_owner || owner,
        package_name: inspectResult?.package_name ?? tool?.package_name ?? pkg ?? null,
        object_name: inspectResult?.object_name || tool?.object_name || objName,
        overload: selectedOverload,
        routine_type: routineType,
        metadata_hash: metadataHash,
        metadata_snapshot: inspectResult ? { owner: inspectResult.owner, package: inspectResult.package_name, name: inspectResult.object_name, overload: selectedOverload } : null,
        access_mode: form.access_mode,
        endpoint_mode: form.endpoint_mode,
        allow_llm_auto: form.endpoint_mode === 'tool',
        allow_manual: form.allow_manual,
        allow_inject: form.endpoint_mode === 'inject',
        requires_approval: form.requires_approval,
        params,
        returns,
        max_rows_llm: Number(form.max_rows_llm),
        max_rows_ui: Number(form.max_rows_ui),
        timeout_sec: Number(form.timeout_sec),
        enabled: form.enabled,
        rate_limit_per_user: form.rate_limit_per_user === '' ? null : Number(form.rate_limit_per_user),
        rate_limit_global:   form.rate_limit_global   === '' ? null : Number(form.rate_limit_global),
        rate_limit_window:   form.rate_limit_window,
        allow_dry_run:       form.allow_dry_run ? 1 : 0,
      }
      if (isEdit) {
        await api.put(`/erp-tools/${tool!.id}`, payload)
      } else {
        await api.post('/erp-tools', payload)
      }
      onSaved()
    } catch (e: any) {
      setError(e.response?.data?.error || '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (isEdit && tool) {
      // 編輯模式預設已載入;順手撈翻譯(如果有)
      api.get(`/erp-tools/${tool.id}`)
        .then(r => {
          if (r.data.translations) {
            const m: Record<string, any> = {}
            for (const t of r.data.translations) m[t.lang] = t
            setTranslations(m)
          }
        })
        .catch(() => {})
    }
  }, [isEdit, tool])

  const translate = async () => {
    if (!isEdit || !tool) {
      setError('請先儲存後再翻譯')
      return
    }
    setTranslating(true)
    setError(null)
    try {
      const res = await api.post(`/erp-tools/${tool.id}/translate`)
      setTranslations(res.data.translations || {})
    } catch (e: any) {
      setError(e.response?.data?.error || '翻譯失敗')
    } finally {
      setTranslating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">
            {isEdit ? '編輯 ERP 工具' : '新增 ERP 工具'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Metadata Inspect */}
          {!isEdit && (
            <section className="border border-slate-200 rounded-lg p-4 bg-slate-50">
              <div className="text-sm font-medium mb-2 text-slate-700">1. 輸入 ERP 物件並查詢定義</div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-500">Owner / Schema</label>
                  {allowedSchemas.length > 0 ? (
                    <select value={owner} onChange={e => setOwner(e.target.value)}
                      className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5">
                      {allowedSchemas.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input value={owner} onChange={e => setOwner(e.target.value.toUpperCase())}
                      className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5 font-mono"
                      placeholder="APPS" />
                  )}
                </div>
                <div>
                  <label className="text-xs text-slate-500">Package (選填)</label>
                  <input value={pkg} onChange={e => setPkg(e.target.value.toUpperCase())}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5 font-mono"
                    placeholder="HR_PKG" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Function / Procedure 名稱</label>
                  <input value={objName} onChange={e => setObjName(e.target.value.toUpperCase())}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5 font-mono"
                    placeholder="GET_EMP_INFO" />
                </div>
              </div>
              <button onClick={inspect} disabled={!owner || !objName || inspecting}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 text-white text-xs rounded hover:bg-slate-800 disabled:opacity-50">
                <Search size={13} />
                {inspecting ? '查詢中…' : '查詢 metadata'}
              </button>

              {inspectResult && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-slate-500">
                    找到 {inspectResult.overloads.length} 個簽章:
                  </div>
                  {inspectResult.overloads.map((ov, i) => (
                    <label key={i} className={`block border rounded p-2 cursor-pointer ${selectedOverload === ov.overload ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <div className="flex items-center gap-2">
                        <input type="radio" checked={selectedOverload === ov.overload}
                          onChange={() => applyOverload(ov)} />
                        <span className="text-xs font-medium">
                          {ov.overload ? `Overload ${ov.overload}` : '單一簽章'} — {ov.routine_type}
                        </span>
                        {ov.has_unsupported && (
                          <span className="text-[10px] text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 flex items-center gap-1">
                            <AlertTriangle size={10} /> 含不支援型別
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 font-mono">
                        {ov.params.length} 參數
                        {ov.returns && <> · 回傳 {ov.returns.data_type}</>}
                      </div>
                      {ov.has_unsupported && (
                        <div className="text-[10px] text-amber-700 mt-1">
                          {ov.unsupported_list.join(', ')}
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Basic info */}
          <section>
            <div className="text-sm font-medium mb-2 text-slate-700">基本資訊</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Code(LLM 呼叫識別字)</label>
                <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5 font-mono"
                  placeholder="erp_hr_get_emp_info" />
              </div>
              <div>
                <label className="text-xs text-slate-500">顯示名稱</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500">描述(給 LLM 與使用者看)</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5 resize-none" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500">Tags(逗號分隔,給 TAG router)</label>
                <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5"
                  placeholder="員工, 查詢, HR" />
              </div>
            </div>
          </section>

          {/* Security */}
          <section>
            <div className="text-sm font-medium mb-2 text-slate-700">安全與呼叫模式</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Access Mode</label>
                <select value={form.access_mode}
                  onChange={e => setForm({ ...form, access_mode: e.target.value as any })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5">
                  <option value="READ_ONLY">READ_ONLY(只讀)</option>
                  <option value="WRITE">WRITE(會修改資料)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={form.enabled}
                    onChange={e => setForm({ ...form, enabled: e.target.checked })} /> 啟用
                </label>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-slate-500 mb-1">回應模式</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: 'tool', l: '工具（Tool）', d: 'LLM 透過 function calling 自主決定呼叫' },
                    { v: 'inject', l: '注入（Inject）', d: '每輪對話前自動跑，結果塞 system prompt' },
                    { v: 'answer', l: '直達（Answer）', d: 'TAG 匹配後直接執行，結果直達使用者' },
                  ].map(m => (
                    <label key={m.v} className={`border rounded-lg p-2 cursor-pointer transition ${form.endpoint_mode === m.v ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="flex items-center gap-1.5">
                        <input type="radio" name="endpoint_mode" checked={form.endpoint_mode === m.v}
                          onChange={() => setForm({ ...form, endpoint_mode: m.v })} />
                        <span className="text-xs font-medium">{m.l}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 ml-5">{m.d}</div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={form.allow_manual}
                    onChange={e => setForm({ ...form, allow_manual: e.target.checked })} />
                  允許使用者手動觸發（🛢 按鈕，與回應模式獨立）
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={form.requires_approval}
                    onChange={e => setForm({ ...form, requires_approval: e.target.checked })} />
                  需 admin 審批（WRITE 建議開啟）
                </label>
              </div>
              {form.access_mode === 'WRITE' && form.endpoint_mode === 'tool' && (
                <div className="col-span-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  <AlertTriangle size={12} className="inline mr-1" />
                  WRITE 型工具模式：LLM 觸發時仍會要求使用者手動確認才實際執行
                </div>
              )}
              {form.endpoint_mode === 'inject' && (
                <div className="col-span-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
                  注入模式：所有 IN 參數必須設「固定值」或「系統值」，不能需要使用者輸入
                </div>
              )}
              {form.endpoint_mode === 'answer' && (
                <div className="col-span-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                  直達模式：TAG 匹配後自動執行，結果格式化為 Markdown 表格直接顯示，不經 LLM 生成
                </div>
              )}
            </div>
          </section>

          {/* Limits */}
          <section>
            <div className="text-sm font-medium mb-2 text-slate-700">限制</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-500">LLM 看到的最多列數</label>
                <input type="number" value={form.max_rows_llm}
                  onChange={e => setForm({ ...form, max_rows_llm: Number(e.target.value) })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5" />
              </div>
              <div>
                <label className="text-xs text-slate-500">UI 最多列數</label>
                <input type="number" value={form.max_rows_ui}
                  onChange={e => setForm({ ...form, max_rows_ui: Number(e.target.value) })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5" />
              </div>
              <div>
                <label className="text-xs text-slate-500">超時(秒)</label>
                <input type="number" value={form.timeout_sec}
                  onChange={e => setForm({ ...form, timeout_sec: Number(e.target.value) })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5" />
              </div>

              <div>
                <label className="text-xs text-slate-500">每使用者上限(留空=不限)</label>
                <input type="number" value={form.rate_limit_per_user}
                  onChange={e => setForm({ ...form, rate_limit_per_user: e.target.value as any })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5"
                  placeholder="次數" />
              </div>
              <div>
                <label className="text-xs text-slate-500">全域上限(留空=不限)</label>
                <input type="number" value={form.rate_limit_global}
                  onChange={e => setForm({ ...form, rate_limit_global: e.target.value as any })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5"
                  placeholder="次數" />
              </div>
              <div>
                <label className="text-xs text-slate-500">時窗</label>
                <select value={form.rate_limit_window}
                  onChange={e => setForm({ ...form, rate_limit_window: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-0.5">
                  <option value="minute">每分鐘</option>
                  <option value="hour">每小時</option>
                  <option value="day">每天</option>
                </select>
              </div>

              <div className="col-span-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={form.allow_dry_run}
                    onChange={e => setForm({ ...form, allow_dry_run: e.target.checked })} />
                  允許 Dry-run(WRITE 型預覽用:SAVEPOINT 執行後 ROLLBACK)
                </label>
              </div>
            </div>
          </section>

          {/* Parameters */}
          <section>
            <div className="text-sm font-medium mb-2 text-slate-700">
              參數 ({params.length})
              {routineType === 'FUNCTION' && returns && (
                <span className="ml-2 text-xs text-slate-500 font-normal">
                  回傳型別: <span className="font-mono">{returns.data_type}</span>
                </span>
              )}
            </div>
            {params.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded">
                無參數
              </div>
            ) : (
              <div className="space-y-1">
                {params.map((p, idx) => {
                  const expanded = paramExpanded[idx]
                  return (
                    <div key={idx} className="border border-slate-200 rounded">
                      <button
                        onClick={() => setParamExpanded(s => ({ ...s, [idx]: !s[idx] }))}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                      >
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <span className="font-mono text-xs font-medium">{p.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          p.in_out === 'IN' ? 'bg-blue-50 text-blue-700' :
                          p.in_out === 'OUT' ? 'bg-green-50 text-green-700' :
                          'bg-purple-50 text-purple-700'
                        }`}>{p.in_out}</span>
                        <span className="text-xs text-slate-500">{p.data_type}{p.data_length ? `(${p.data_length})` : ''}</span>
                        {p.required && <span className="text-[10px] text-red-600">*</span>}
                        {p.lov_config?.type && (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                            LOV: {p.lov_config.type}
                          </span>
                        )}
                      </button>
                      {expanded && (
                        <ParamDetailEditor
                          param={p}
                          onChange={patch => updateParam(idx, patch)}
                          onLovChange={patch => updateLov(idx, patch)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {translations && (
            <section className="border-t pt-3">
              <div className="text-sm font-medium mb-2 text-slate-700 flex items-center gap-2">
                <Languages size={13} /> 翻譯結果
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {['en', 'vi'].map(lang => {
                  const t = translations[lang]
                  if (!t) return null
                  return (
                    <div key={lang} className="border border-slate-200 rounded p-2 space-y-1">
                      <div className="font-medium text-slate-500">{lang.toUpperCase()}</div>
                      <div><span className="text-slate-400">name:</span> {t.name}</div>
                      <div><span className="text-slate-400">description:</span> {t.description}</div>
                      {t.params_labels && Object.keys(t.params_labels).length > 0 && (
                        <div>
                          <div className="text-slate-400">params:</div>
                          <div className="pl-2 space-y-0.5">
                            {Object.entries(t.params_labels).map(([k, v]) => (
                              <div key={k}><span className="font-mono text-slate-500">{k}:</span> {String(v)}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2">
          {isEdit && (
            <button onClick={translate} disabled={translating}
              className="mr-auto px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-white disabled:opacity-50 flex items-center gap-1.5 text-slate-700">
              <Languages size={13} />
              {translating ? '翻譯中…' : '翻譯 (en / vi)'}
            </button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-white">
            取消
          </button>
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 text-sm bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">
            <Save size={13} />
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ParamDetailEditor({
  param, onChange, onLovChange,
}: {
  param: ErpParam
  onChange: (p: Partial<ErpParam>) => void
  onLovChange: (p: any) => void
}) {
  const lovType = param.lov_config?.type || 'none'
  const canInput = param.in_out === 'IN' || param.in_out === 'IN/OUT'

  return (
    <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500">AI Hint(給 LLM 的參數說明)</label>
          <input value={param.ai_hint || ''} onChange={e => onChange({ ai_hint: e.target.value })}
            className="w-full border border-slate-300 rounded px-2 py-1 text-xs mt-0.5"
            placeholder="台灣員工工號,8 碼數字" />
        </div>
        <div>
          <label className="text-xs text-slate-500">預設值</label>
          <input value={param.default_value ?? ''}
            onChange={e => onChange({ default_value: e.target.value || null })}
            className="w-full border border-slate-300 rounded px-2 py-1 text-xs mt-0.5" />
        </div>
      </div>

      {canInput && (
        <>
          <div className="border-t pt-2">
            <div className="text-xs font-medium text-slate-600 mb-1">LOV 設定(下拉選單來源)</div>
            <select value={lovType}
              onChange={e => {
                const t = e.target.value
                if (t === 'none') onChange({ lov_config: null })
                else if (t === 'static') onChange({ lov_config: { type: 'static', items: [] } })
                else if (t === 'sql') onChange({ lov_config: { type: 'sql', sql: '', binds: [], value_col: 'V', label_col: 'L', cache_sec: 300 } })
                else if (t === 'system') onChange({ lov_config: { type: 'system', source: 'system_user_employee_id' } })
                else if (t === 'erp_tool') onChange({ lov_config: { type: 'erp_tool', tool_id: null, param_map: {}, value_col: 'V', label_col: 'L' } })
              }}
              className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="none">無(自由輸入)</option>
              <option value="static">靜態清單</option>
              <option value="sql">SQL 查詢</option>
              <option value="system">系統值</option>
              <option value="erp_tool">鏈式(呼叫另一個 ERP tool)</option>
            </select>

            {lovType === 'static' && (
              <StaticLovEditor
                items={param.lov_config?.items || []}
                onChange={items => onLovChange({ items })}
              />
            )}

            {lovType === 'sql' && (
              <div className="mt-2 space-y-2">
                <textarea value={param.lov_config?.sql || ''}
                  onChange={e => onLovChange({ sql: e.target.value })}
                  rows={3}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono"
                  placeholder="SELECT emp_no AS v, emp_name AS l FROM fl_employee WHERE factory=:factory AND status='A'" />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500">value_col</label>
                    <input value={param.lov_config?.value_col || 'V'}
                      onChange={e => onLovChange({ value_col: e.target.value })}
                      className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">label_col</label>
                    <input value={param.lov_config?.label_col || 'L'}
                      onChange={e => onLovChange({ label_col: e.target.value })}
                      className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">快取秒數</label>
                    <input type="number" value={param.lov_config?.cache_sec || 300}
                      onChange={e => onLovChange({ cache_sec: Number(e.target.value) })}
                      className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
                  </div>
                </div>
                <SqlBindsEditor
                  binds={param.lov_config?.binds || []}
                  onChange={binds => onLovChange({ binds })}
                />
              </div>
            )}

            {lovType === 'system' && (
              <select value={param.lov_config?.source || ''}
                onChange={e => onLovChange({ source: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs mt-2">
                {SYSTEM_SOURCES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            )}

            {lovType === 'erp_tool' && (
              <ErpToolLovEditor
                lovConfig={param.lov_config}
                onChange={(patch) => onLovChange(patch)}
              />
            )}
          </div>

          <div className="border-t pt-2">
            <div className="text-xs font-medium text-slate-600 mb-1">Inject 模式用(每輪對話自動帶值)</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500">固定值</label>
                <input value={param.inject_value ?? ''}
                  onChange={e => onChange({ inject_value: e.target.value || null })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">系統值來源</label>
                <select value={param.inject_source || ''}
                  onChange={e => onChange({ inject_source: e.target.value || null })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                  {SYSTEM_SOURCES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StaticLovEditor({ items, onChange }: { items: any[]; onChange: (items: any[]) => void }) {
  const add = () => onChange([...items, { value: '', label: '' }])
  const upd = (i: number, patch: any) => onChange(items.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  const del = (i: number) => onChange(items.filter((_, idx) => idx !== i))
  return (
    <div className="mt-2 space-y-1">
      {items.map((it, i) => (
        <div key={i} className="flex gap-1 items-center">
          <input value={it.value} onChange={e => upd(i, { value: e.target.value })}
            className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
            placeholder="value" />
          <input value={it.label} onChange={e => upd(i, { label: e.target.value })}
            className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
            placeholder="label" />
          <button onClick={() => del(i)} className="text-xs text-red-500 px-2">x</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-sky-600 hover:text-sky-700">+ 新增項目</button>
    </div>
  )
}

function ErpToolLovEditor({ lovConfig, onChange }: { lovConfig: any; onChange: (patch: any) => void }) {
  const [tools, setTools] = useState<any[]>([])
  const [selectedTool, setSelectedTool] = useState<any | null>(null)
  const paramMap = lovConfig?.param_map || {}

  useEffect(() => {
    api.get('/erp-tools').then(r => setTools(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (lovConfig?.tool_id && tools.length > 0) {
      setSelectedTool(tools.find(t => t.id === lovConfig.tool_id) || null)
    }
  }, [lovConfig?.tool_id, tools])

  const inParams = selectedTool?.params?.filter((p: any) => p.in_out === 'IN' || p.in_out === 'IN/OUT') || []

  const updateParam = (name: string, patch: any) => {
    const next = { ...paramMap }
    if (patch.mode === 'none') delete next[name]
    else if (patch.mode === 'fixed') next[name] = patch.value
    else if (patch.mode === 'system') next[name] = { source: patch.source }
    onChange({ param_map: next })
  }

  const getEntry = (name: string) => {
    const v = paramMap[name]
    if (v === undefined) return { mode: 'none' }
    if (v && typeof v === 'object' && v.source) return { mode: 'system', source: v.source }
    return { mode: 'fixed', value: v }
  }

  return (
    <div className="mt-2 space-y-2">
      <div>
        <label className="text-[10px] text-slate-500">來源 tool</label>
        <select value={lovConfig?.tool_id || ''} onChange={e => onChange({ tool_id: e.target.value ? Number(e.target.value) : null })}
          className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="">-- 選擇 --</option>
          {tools.filter((t: any) => t.access_mode === 'READ_ONLY').map((t: any) => (
            <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
          ))}
        </select>
      </div>

      {selectedTool && inParams.length > 0 && (
        <div className="border border-slate-200 rounded p-2 bg-white">
          <div className="text-[10px] text-slate-500 mb-1">來源 tool 輸入參數:</div>
          {inParams.map((p: any) => {
            const entry = getEntry(p.name) as any
            return (
              <div key={p.name} className="flex gap-1 items-center py-0.5">
                <span className="w-28 font-mono text-[11px] truncate" title={p.name}>{p.name}</span>
                <select value={entry.mode}
                  onChange={e => updateParam(p.name, { mode: e.target.value, source: 'system_user_employee_id', value: '' })}
                  className="border border-slate-300 rounded px-1 py-0.5 text-[11px]">
                  <option value="none">(不傳)</option>
                  <option value="fixed">固定值</option>
                  <option value="system">系統值</option>
                </select>
                {entry.mode === 'fixed' && (
                  <input value={entry.value ?? ''} onChange={e => updateParam(p.name, { mode: 'fixed', value: e.target.value })}
                    className="flex-1 border border-slate-300 rounded px-2 py-0.5 text-[11px]" placeholder="固定值" />
                )}
                {entry.mode === 'system' && (
                  <select value={entry.source} onChange={e => updateParam(p.name, { mode: 'system', source: e.target.value })}
                    className="flex-1 border border-slate-300 rounded px-1 py-0.5 text-[11px]">
                    {SYSTEM_SOURCES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-slate-500">cursor 參數(選填)</label>
          <input value={lovConfig?.cursor_param || ''} onChange={e => onChange({ cursor_param: e.target.value })}
            className="w-full border border-slate-300 rounded px-2 py-1 text-[11px] font-mono"
            placeholder="預設:第一個 OUT cursor" />
        </div>
        <div>
          <label className="text-[10px] text-slate-500">value_col</label>
          <input value={lovConfig?.value_col || 'V'} onChange={e => onChange({ value_col: e.target.value })}
            className="w-full border border-slate-300 rounded px-2 py-1 text-[11px] font-mono" />
        </div>
        <div>
          <label className="text-[10px] text-slate-500">label_col</label>
          <input value={lovConfig?.label_col || 'L'} onChange={e => onChange({ label_col: e.target.value })}
            className="w-full border border-slate-300 rounded px-2 py-1 text-[11px] font-mono" />
        </div>
      </div>
    </div>
  )
}

function SqlBindsEditor({ binds, onChange }: { binds: any[]; onChange: (b: any[]) => void }) {
  const add = () => onChange([...binds, { name: '', source: 'system_user_factory' }])
  const upd = (i: number, patch: any) => onChange(binds.map((b, idx) => idx === i ? { ...b, ...patch } : b))
  const del = (i: number) => onChange(binds.filter((_, idx) => idx !== i))
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-slate-500">SQL binds(用 :name 引用)</div>
      {binds.map((b, i) => (
        <div key={i} className="flex gap-1 items-center">
          <input value={b.name} onChange={e => upd(i, { name: e.target.value })}
            className="w-28 border border-slate-300 rounded px-2 py-1 text-xs font-mono"
            placeholder="bind name" />
          <select value={b.source} onChange={e => upd(i, { source: e.target.value })}
            className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs">
            {SYSTEM_SOURCES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
          <button onClick={() => del(i)} className="text-xs text-red-500 px-2">x</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-sky-600 hover:text-sky-700">+ 新增 bind</button>
    </div>
  )
}
