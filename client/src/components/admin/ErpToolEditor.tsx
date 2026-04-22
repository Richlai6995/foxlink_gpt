import { useEffect, useState } from 'react'
import { X, Search, AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Save, Languages, Plus, Minus, Edit3 } from 'lucide-react'
import api from '../../lib/api'
import type { ErpTool, ErpParam, ErpReturns, AnswerOutputFormat } from './ErpToolsPanel'

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
  const [answerOutputFormat, setAnswerOutputFormat] = useState<AnswerOutputFormat | null>(
    (tool?.answer_output_format as AnswerOutputFormat) || null
  )
  const [routineType, setRoutineType] = useState<'FUNCTION' | 'PROCEDURE'>(tool?.routine_type || 'PROCEDURE')
  const [metadataHash, setMetadataHash] = useState<string | null>(tool?.metadata_hash || null)

  const [paramExpanded, setParamExpanded] = useState<Record<number, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translations, setTranslations] = useState<Record<string, any> | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadDiff, setReloadDiff] = useState<{
    drifted: boolean
    old_hash: string | null
    new_hash: string
    diff: {
      added: { name: string; in_out: string; data_type: string }[]
      removed: { name: string; in_out: string; data_type: string }[]
      changed: { name: string; diffs: string[] }[]
    }
    latest_params: ErpParam[]
    latest_returns: ErpReturns | null
  } | null>(null)
  const [applying, setApplying] = useState(false)

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
        answer_output_format: answerOutputFormat,
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

  const refreshMetadata = async () => {
    if (!isEdit || !tool) return
    setError(null)
    setRefreshing(true)
    try {
      const res = await api.post(`/erp-tools/${tool.id}/refresh-metadata`, {})
      setReloadDiff(res.data)
    } catch (e: any) {
      setError(e.response?.data?.error || '重抓 metadata 失敗')
    } finally {
      setRefreshing(false)
    }
  }

  const applyMetadata = async () => {
    if (!isEdit || !tool || !reloadDiff) return
    setApplying(true)
    setError(null)
    try {
      const res = await api.post(`/erp-tools/${tool.id}/refresh-metadata`, { apply: true })
      // 成功後把合併後的 params 套回本地 state(保留 user 在 editor 裡的未存改動會被蓋掉,這是合理的)
      if (res.data.merged_params) {
        setParams(res.data.merged_params)
      }
      if (res.data.latest_returns !== undefined) {
        setReturns(res.data.latest_returns)
      }
      setMetadataHash(res.data.new_hash)
      setReloadDiff(null)
    } catch (e: any) {
      setError(e.response?.data?.error || '套用失敗')
    } finally {
      setApplying(false)
    }
  }

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

          {/* Edit 模式:Metadata 同步 */}
          {isEdit && (
            <section className="border border-slate-200 rounded-lg p-3 bg-slate-50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-700">Metadata 同步</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    若 PROCEDURE 簽章已變更,按下「重抓 metadata」會重新從 Oracle 撈取參數定義,合併時會保留你已設的 ai_hint / LOV / 預設值 / inject / 可見鎖定等配置
                  </div>
                  {metadataHash && (
                    <div className="text-[10px] text-slate-400 font-mono mt-1">
                      目前 hash: {metadataHash.slice(0, 12)}…
                    </div>
                  )}
                </div>
                <button onClick={refreshMetadata} disabled={refreshing}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white text-slate-700 text-xs rounded hover:bg-slate-50 disabled:opacity-50">
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? '查詢中…' : '重抓 metadata'}
                </button>
              </div>
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

          {/* Answer Output Format — 僅 endpoint_mode === 'answer' 顯示 */}
          {form.endpoint_mode === 'answer' && (
            <AnswerOutputFormatEditor
              value={answerOutputFormat}
              onChange={setAnswerOutputFormat}
            />
          )}

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
                        {(p as any).visible === false && (
                          <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">隱藏</span>
                        )}
                        {(p as any).editable === false && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">🔒 鎖定</span>
                        )}
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
                          siblingParams={params.filter((_sp, i) => i !== idx && (_sp.in_out === 'IN' || _sp.in_out === 'IN/OUT')).map(sp => sp.name)}
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

      {/* 重抓 metadata diff 確認 */}
      {reloadDiff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h4 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
                <RefreshCw size={14} className="text-sky-600" />
                Metadata 變更比對
              </h4>
              <button onClick={() => setReloadDiff(null)} className="p-1 hover:bg-slate-100 rounded">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-xs">
              {!reloadDiff.drifted ? (
                <div className="text-center text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-4">
                  ✓ Metadata 無變動,目前定義已是最新
                </div>
              ) : (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-800">
                    ⚠ 偵測到 PROCEDURE 簽章已變更(hash: {reloadDiff.old_hash?.slice(0, 8)}… → {reloadDiff.new_hash.slice(0, 8)}…)
                  </div>

                  {reloadDiff.diff.added.length > 0 && (
                    <section>
                      <div className="text-xs font-medium text-green-700 mb-1 flex items-center gap-1">
                        <Plus size={11} /> 新增參數 ({reloadDiff.diff.added.length})
                      </div>
                      <div className="space-y-1">
                        {reloadDiff.diff.added.map(p => (
                          <div key={p.name} className="border border-green-200 bg-green-50 rounded px-2 py-1 font-mono">
                            <span className="font-bold">{p.name}</span>
                            <span className="text-slate-500 ml-2">{p.in_out} · {p.data_type}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {reloadDiff.diff.removed.length > 0 && (
                    <section>
                      <div className="text-xs font-medium text-red-700 mb-1 flex items-center gap-1">
                        <Minus size={11} /> 移除參數 ({reloadDiff.diff.removed.length})
                      </div>
                      <div className="space-y-1">
                        {reloadDiff.diff.removed.map(p => (
                          <div key={p.name} className="border border-red-200 bg-red-50 rounded px-2 py-1 font-mono">
                            <span className="font-bold line-through">{p.name}</span>
                            <span className="text-slate-500 ml-2">{p.in_out} · {p.data_type}</span>
                            <span className="text-red-600 ml-2 not-italic">(含你原本設定的 ai_hint / LOV 會一併刪除)</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {reloadDiff.diff.changed.length > 0 && (
                    <section>
                      <div className="text-xs font-medium text-amber-700 mb-1 flex items-center gap-1">
                        <Edit3 size={11} /> 型別/屬性變更 ({reloadDiff.diff.changed.length})
                      </div>
                      <div className="space-y-1">
                        {reloadDiff.diff.changed.map(c => (
                          <div key={c.name} className="border border-amber-200 bg-amber-50 rounded px-2 py-1">
                            <div className="font-mono font-bold">{c.name}</div>
                            <ul className="ml-4 list-disc text-amber-800 text-[11px]">
                              {c.diffs.map((d, i) => <li key={i}>{d}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2 mt-3">
                    套用後會保留:<span className="font-medium">ai_hint、LOV 設定、預設值、inject 設定、可見/鎖定狀態</span>;
                    並重新生成 tool_schema 同步給 proxy skill。套用後還需要在編輯視窗按「儲存」才會真正寫入關聯欄位(如 name/description)。
                  </div>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setReloadDiff(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-white">
                {reloadDiff.drifted ? '取消' : '關閉'}
              </button>
              {reloadDiff.drifted && (
                <button onClick={applyMetadata} disabled={applying}
                  className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5">
                  <RefreshCw size={12} />
                  {applying ? '套用中…' : '套用並合併'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const DATE_PRESETS = [
  { v: 'today',            l: '今天' },
  { v: 'yesterday',        l: '昨天' },
  { v: 'tomorrow',         l: '明天' },
  { v: 'this_week_start',  l: '本週一' },
  { v: 'this_month_start', l: '本月 1 日' },
  { v: 'last_month_start', l: '上月 1 日' },
  { v: 'this_year_start',  l: '今年 1 月 1 日' },
  { v: 'last_year_start',  l: '去年 1 月 1 日' },
  { v: 'now',              l: '當下日期時間' },
]

const NUMBER_PRESETS = [
  { v: 'current_year',  l: '今年（如 2026）' },
  { v: 'current_month', l: '當月（如 4）' },
  { v: 'current_day',   l: '當日（如 17）' },
]

const USER_PRESETS = [
  { v: 'system_user_id',            l: '當前使用者 ID' },
  { v: 'system_user_employee_id',   l: '當前使用者工號' },
  { v: 'system_user_name',          l: '當前使用者姓名' },
  { v: 'system_user_email',         l: '當前使用者 Email' },
  { v: 'system_user_dept',          l: '當前使用者部門' },
  { v: 'system_user_factory',       l: '當前使用者廠區' },
  { v: 'system_user_profit_center', l: '當前使用者利潤中心' },
]

function getPresetsForType(dataType: string) {
  const t = (dataType || '').toUpperCase()
  if (t === 'DATE' || t.startsWith('TIMESTAMP')) return [...DATE_PRESETS, ...USER_PRESETS]
  if (t === 'NUMBER' || t === 'INTEGER' || t === 'FLOAT' || t === 'PLS_INTEGER') return [...NUMBER_PRESETS, ...USER_PRESETS]
  return USER_PRESETS
}

function DefaultValueEditor({ param, onChange }: { param: ErpParam; onChange: (p: Partial<ErpParam>) => void }) {
  const cfg = (param as any).default_config || { mode: param.default_value ? 'fixed' : 'none' }
  const mode = cfg.mode || 'none'
  const presets = getPresetsForType(param.data_type)

  const setConfig = (patch: any) => {
    const next = { ...cfg, ...patch }
    onChange({ default_config: next } as any)
  }

  return (
    <div className="mt-0.5 space-y-1">
      <select value={mode}
        onChange={e => {
          const m = e.target.value
          if (m === 'none') { onChange({ default_config: { mode: 'none' }, default_value: null } as any) }
          else if (m === 'fixed') { setConfig({ mode: 'fixed', fixed_value: param.default_value || '' }) }
          else if (m === 'preset') { setConfig({ mode: 'preset', preset: presets[0]?.v || 'today' }) }
        }}
        className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
        <option value="none">無預設值</option>
        <option value="fixed">固定值</option>
        <option value="preset">動態預設</option>
      </select>

      {mode === 'fixed' && (
        <input value={cfg.fixed_value ?? param.default_value ?? ''}
          onChange={e => {
            setConfig({ fixed_value: e.target.value })
            onChange({ default_value: e.target.value || null })
          }}
          className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
          placeholder="輸入固定預設值" />
      )}

      {mode === 'preset' && (
        <select value={cfg.preset || ''}
          onChange={e => setConfig({ preset: e.target.value })}
          className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
          {presets.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
        </select>
      )}
    </div>
  )
}

function ParamDetailEditor({
  param, onChange, onLovChange, siblingParams = [],
}: {
  param: ErpParam
  onChange: (p: Partial<ErpParam>) => void
  onLovChange: (p: any) => void
  siblingParams?: string[]
}) {
  const lovType = param.lov_config?.type || 'none'
  const canInput = param.in_out === 'IN' || param.in_out === 'IN/OUT'
  const isVisible = (param as any).visible !== false
  const isEditable = (param as any).editable !== false

  return (
    <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 space-y-3">
      {/* 可見 / 可變更 */}
      {canInput && (
        <div className="flex gap-4 items-center border border-slate-200 rounded px-3 py-2 bg-white">
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={isVisible}
              onChange={e => onChange({ visible: e.target.checked } as any)} />
            使用者可看到
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={isEditable}
              onChange={e => onChange({ editable: e.target.checked } as any)} />
            使用者可變更
          </label>
          {!isVisible && (
            <span className="text-[10px] text-slate-500 ml-auto">隱藏：使用者看不到，LLM 也不知道，值由系統自動帶入</span>
          )}
          {isVisible && !isEditable && (
            <span className="text-[10px] text-amber-700 ml-auto">🔒 鎖定：使用者看得到但不能改，LLM 也無法變更</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500">
            顯示名稱(使用者看到的欄位 label)
            <span className="text-[10px] text-slate-400 ml-1">覆蓋 {param.name}</span>
          </label>
          <input value={(param as any).display_name || ''}
            onChange={e => onChange({ display_name: e.target.value || null } as any)}
            className="w-full border border-slate-300 rounded px-2 py-1 text-xs mt-0.5"
            placeholder={`如:組織代碼(留空則顯示 ${param.name})`} />
        </div>
        <div>
          <label className="text-xs text-slate-500">AI Hint(給 LLM 的參數說明)</label>
          <input value={param.ai_hint || ''} onChange={e => onChange({ ai_hint: e.target.value })}
            className="w-full border border-slate-300 rounded px-2 py-1 text-xs mt-0.5"
            placeholder="Oracle EBS 組織 ID,數字字串" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-slate-500">預設值{!isEditable && <span className="text-amber-700 ml-1">(鎖定值)</span>}</label>
          <DefaultValueEditor param={param} onChange={onChange} />
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
                  siblingParams={siblingParams}
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
                siblingParams={siblingParams}
              />
            )}

            {/* LLM 傳值模式:當是 sql/system/erp_tool 動態 LOV 才顯示(static 已有 enum) */}
            {(lovType === 'sql' || lovType === 'system' || lovType === 'erp_tool') && (
              <div className="mt-3 pt-2 border-t border-slate-200">
                <div className="text-xs font-medium text-slate-600 mb-1">LLM 傳值模式</div>
                <select
                  value={(param as any).llm_resolve_mode || 'value_only'}
                  onChange={e => onChange({ llm_resolve_mode: e.target.value as any } as any)}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                  <option value="value_only">原始值 — LLM 必須傳內部值(最嚴格)</option>
                  <option value="auto">自動 — value 或 label 都接受(推薦)</option>
                  <option value="label_only">可讀名稱 — 強制 LLM 傳 CODE/NAME</option>
                </select>
                <div className="text-[10px] text-slate-500 mt-1">
                  {((param as any).llm_resolve_mode || 'value_only') === 'auto' && '對話中 AI 可傳 "G0C" 或 "83",系統用 LOV 自動轉成內部 ID;找不到或多筆符合會 throw。'}
                  {(param as any).llm_resolve_mode === 'label_only' && '強制 AI 以可讀名稱提問,tool_schema description 會明確要求不要傳 ID。'}
                  {((param as any).llm_resolve_mode || 'value_only') === 'value_only' && '不轉換;LLM 必須精確傳出 value_col 對應的值,否則 FUNCTION 會失敗。'}
                </div>
              </div>
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

function ErpToolLovEditor({ lovConfig, onChange, siblingParams = [] }: { lovConfig: any; onChange: (patch: any) => void; siblingParams?: string[] }) {
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
                    {siblingParams.length > 0 && (
                      <optgroup label="其他參數(依賴另一欄)">
                        {siblingParams.map(pn => (
                          <option key={pn} value={`param:${pn}`}>param: {pn}</option>
                        ))}
                      </optgroup>
                    )}
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

/* ──────────────────────────────────────────────────────────
 * AnswerOutputFormatEditor — Answer 模式輸出解析設定
 * 讓 Admin 指定 FUNCTION 回傳 VARCHAR2 的分隔符、欄位名、圖表規格,
 * Server 依此 parse 並渲染 Markdown 表格 + 圖表,全程無 LLM。
 * ────────────────────────────────────────────────────────── */
function AnswerOutputFormatEditor({
  value, onChange,
}: {
  value: AnswerOutputFormat | null
  onChange: (v: AnswerOutputFormat | null) => void
}) {
  const enabled = !!value
  const cur: AnswerOutputFormat = value || {}
  const upd = (patch: Partial<AnswerOutputFormat>) => onChange({ ...(cur || {}), ...patch })
  const updChart = (patch: any) => onChange({ ...(cur || {}), chart: { ...(cur.chart || {}), ...patch } })

  return (
    <section className="border border-slate-200 rounded-lg p-3 bg-emerald-50/30">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-medium text-slate-700">輸出解析（Answer 模式專用）</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            設定後,後端會自動把 FUNCTION 的 VARCHAR2 回傳解析成 Markdown 表格 + 圖表,不需要 LLM 整理。
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input type="checkbox" checked={enabled}
            onChange={e => onChange(e.target.checked ? { col_separator: '/', row_separator: '\\n', columns: [], numeric_columns: [] } : null)} />
          啟用自動解析
        </label>
      </div>

      {enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] text-slate-500">欄位分隔符</label>
              <input value={cur.col_separator || '/'}
                onChange={e => upd({ col_separator: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono"
                placeholder="/" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">列分隔</label>
              <select value={cur.row_separator || '\\n'}
                onChange={e => upd({ row_separator: e.target.value })}
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                <option value="\n">換行 (\n)</option>
                <option value="space">空白</option>
                <option value="\t">Tab</option>
                <option value=",">逗號 (,)</option>
                <option value=";">分號 (;)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500">最多顯示列數</label>
              <input type="number" value={cur.max_rows ?? 200}
                onChange={e => upd({ max_rows: Number(e.target.value) })}
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
            </div>
            <label className="flex items-center gap-1 text-xs text-slate-700 pt-5">
              <input type="checkbox" checked={!!cur.skip_first_row}
                onChange={e => upd({ skip_first_row: e.target.checked })} />
              跳過第一列 (header)
            </label>
          </div>

          {/* 欄位名稱 */}
          <AnswerOutputColumnsEditor
            columns={cur.columns || []}
            numericColumns={cur.numeric_columns || []}
            onChange={(columns, numeric_columns) => upd({ columns, numeric_columns })}
          />

          {/* 圖表設定 */}
          <div className="border border-slate-200 rounded p-2 bg-white">
            <label className="flex items-center gap-1.5 text-xs text-slate-700 mb-2">
              <input type="checkbox" checked={!!cur.chart}
                onChange={e => onChange({ ...cur, chart: e.target.checked ? { type: 'bar' } : null })} />
              <span className="font-medium">附加圖表</span>
              <span className="text-slate-400 text-[10px]">(推薦:排名、時間序列類結果)</span>
            </label>
            {cur.chart && (
              <div className="grid grid-cols-4 gap-2 mt-1">
                <div>
                  <label className="text-[10px] text-slate-500">類型</label>
                  <select value={cur.chart.type || 'bar'}
                    onChange={e => updChart({ type: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                    <option value="bar">長條圖 bar</option>
                    <option value="line">折線圖 line</option>
                    <option value="pie">圓餅圖 pie</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">X 軸欄位</label>
                  <select value={cur.chart.x_column || ''}
                    onChange={e => updChart({ x_column: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                    <option value="">--</option>
                    {(cur.columns || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">Y 軸欄位(數字)</label>
                  <select value={cur.chart.y_column || ''}
                    onChange={e => updChart({ y_column: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs">
                    <option value="">--</option>
                    {(cur.columns || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">標題(選填)</label>
                  <input value={cur.chart.title || ''}
                    onChange={e => updChart({ title: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
                </div>
              </div>
            )}
          </div>

          {/* 範例提示 */}
          <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
            <div className="font-medium text-slate-600 mb-0.5">範例:</div>
            <div>PROCEDURE 回傳:<code className="bg-white px-1 rounded">202604/ANDOR/A2/5807-5056-037500/RMB/740809</code></div>
            <div>設定:分隔符 <code className="bg-white px-1 rounded">/</code>,欄位 <code className="bg-white px-1 rounded">年月, 專案, 類別, 料號, 幣別, 金額</code></div>
            <div>→ 自動渲染為 6 欄 Markdown 表格。若加圖表(X=料號, Y=金額) → 附長條圖。</div>
          </div>
        </div>
      )}
    </section>
  )
}

function AnswerOutputColumnsEditor({
  columns, numericColumns, onChange,
}: {
  columns: string[]
  numericColumns: string[]
  onChange: (cols: string[], numCols: string[]) => void
}) {
  const numSet = new Set(numericColumns)
  const add = () => onChange([...columns, ''], numericColumns)
  const del = (i: number) => {
    const nextCols = columns.filter((_, idx) => idx !== i)
    const dropped = columns[i]
    onChange(nextCols, numericColumns.filter(n => n !== dropped))
  }
  const updName = (i: number, v: string) => {
    const oldName = columns[i]
    const next = [...columns]; next[i] = v
    let nextNum = numericColumns
    if (numSet.has(oldName)) nextNum = nextNum.map(n => n === oldName ? v : n)
    onChange(next, nextNum)
  }
  const toggleNum = (col: string) => {
    if (!col) return
    if (numSet.has(col)) onChange(columns, numericColumns.filter(n => n !== col))
    else onChange(columns, [...numericColumns, col])
  }

  return (
    <div className="border border-slate-200 rounded p-2 bg-white">
      <div className="text-[10px] text-slate-500 mb-1 flex items-center justify-between">
        <span>欄位名稱(依序對應 parse 結果)</span>
        <button onClick={add} className="text-sky-600 hover:text-sky-700 text-xs">+ 新增欄位</button>
      </div>
      {columns.length === 0 && (
        <div className="text-[10px] text-slate-400 text-center py-2">尚未設定欄位,按「+ 新增欄位」開始</div>
      )}
      <div className="space-y-1">
        {columns.map((c, i) => (
          <div key={i} className="flex gap-1 items-center">
            <span className="text-[10px] text-slate-400 w-6 text-right">{i + 1}.</span>
            <input value={c} onChange={e => updName(i, e.target.value)}
              placeholder={`第 ${i + 1} 欄名稱(如:料號)`}
              className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs" />
            <label className="flex items-center gap-1 text-[11px] text-slate-700 px-2">
              <input type="checkbox" checked={numSet.has(c)} onChange={() => toggleNum(c)} />
              數字
            </label>
            <button onClick={() => del(i)} className="text-xs text-red-500 px-2">x</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function SqlBindsEditor({ binds, onChange, siblingParams = [] }: { binds: any[]; onChange: (b: any[]) => void; siblingParams?: string[] }) {
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
            {siblingParams.length > 0 && (
              <optgroup label="其他參數(依賴另一欄)">
                {siblingParams.map(pn => (
                  <option key={pn} value={`param:${pn}`}>param: {pn}</option>
                ))}
              </optgroup>
            )}
          </select>
          <button onClick={() => del(i)} className="text-xs text-red-500 px-2">x</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-sky-600 hover:text-sky-700">+ 新增 bind</button>
    </div>
  )
}
