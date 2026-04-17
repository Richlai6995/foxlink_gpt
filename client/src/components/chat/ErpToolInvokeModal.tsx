import { useEffect, useState } from 'react'
import { X, Play, ShieldAlert, AlertTriangle, CheckCircle, Clock, Eye, Sparkles, MessageSquare, Table2, FileJson } from 'lucide-react'
import api from '../../lib/api'
import type { ErpTool } from '../admin/ErpToolsPanel'

function resolvePresetClient(preset: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ds = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  switch (preset) {
    case 'today': return ds(now)
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate() - 1); return ds(d) }
    case 'tomorrow': { const d = new Date(now); d.setDate(d.getDate() + 1); return ds(d) }
    case 'this_week_start': { const d = new Date(now); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return ds(d) }
    case 'this_month_start': return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
    case 'last_month_start': { const d = new Date(now); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
    case 'this_year_start': return `${now.getFullYear()}-01-01`
    case 'last_year_start': return `${now.getFullYear() - 1}-01-01`
    case 'now': return `${ds(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    case 'current_year': return String(now.getFullYear())
    case 'current_month': return String(now.getMonth() + 1)
    case 'current_day': return String(now.getDate())
    default: return ''
  }
}

export type ResultMode = 'view' | 'ai_explain' | 'ask_with'

interface Props {
  tool: ErpTool
  sessionId: string | null
  onClose: () => void
  /** 使用者選了後處理方式 */
  onDone: (payload: {
    mode: ResultMode
    tool: ErpTool
    inputs: Record<string, any>
    result: any
    cache_key: string | null
  }) => void
}

export default function ErpToolInvokeModal({ tool, sessionId, onClose, onDone }: Props) {
  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [lovCache, setLovCache] = useState<Record<string, { value: string; label: string }[]>>({})
  const [lovLoading, setLovLoading] = useState<Record<string, boolean>>({})
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [cacheKey, setCacheKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmToken, setConfirmToken] = useState<string | null>(null)
  const [pendingSummary, setPendingSummary] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table')

  const inParams = tool.params.filter(p => p.in_out === 'IN' || p.in_out === 'IN/OUT')

  useEffect(() => {
    const init: Record<string, any> = {}
    for (const p of tool.params) {
      const cfg = (p as any).default_config
      if (cfg?.mode === 'preset') init[p.name] = resolvePresetClient(cfg.preset)
      else if (cfg?.mode === 'fixed' && cfg.fixed_value != null) init[p.name] = cfg.fixed_value
      else if (p.default_value != null) init[p.name] = p.default_value
    }
    setInputs(init)
    // 自動載入 system 類 LOV (已決定好的值)
    for (const p of inParams) {
      if (p.lov_config?.type === 'sql' || p.lov_config?.type === 'system' || p.lov_config?.type === 'erp_tool') {
        loadLov(p.name)
      }
    }
  }, [tool])

  const loadLov = async (paramName: string) => {
    setLovLoading(s => ({ ...s, [paramName]: true }))
    try {
      const res = await api.post(`/erp-tools/${tool.id}/lov/${paramName}`, {})
      setLovCache(s => ({ ...s, [paramName]: res.data.items || [] }))
      // system 類自動套入第一個選項
      if (res.data.type === 'system' && res.data.system_value !== null && res.data.system_value !== undefined) {
        setInputs(s => ({ ...s, [paramName]: res.data.system_value }))
      }
    } catch (e: any) {
      setError(`LOV 載入失敗 (${paramName}): ${e.response?.data?.error || e.message}`)
    } finally {
      setLovLoading(s => ({ ...s, [paramName]: false }))
    }
  }

  const execute = async (withConfirm: boolean = false) => {
    setError(null)
    setExecuting(true)
    try {
      const payload: any = {
        inputs,
        trigger_source: 'manual_form',
        session_id: sessionId,
        include_full: true,
      }
      if (withConfirm && confirmToken) payload.confirmation_token = confirmToken
      const res = await api.post(`/erp-tools/${tool.id}/execute`, payload)
      if (res.data.requires_confirmation) {
        setConfirmToken(res.data.confirmation_token)
        setPendingSummary(res.data.summary)
      } else {
        setResult(res.data.full_result ?? res.data.result)
        setCacheKey(res.data.cache_key || null)
        setConfirmToken(null)
        setPendingSummary(null)
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setExecuting(false)
    }
  }

  const sendBack = (mode: ResultMode) => {
    if (!result) return
    onDone({ mode, tool, inputs, result, cache_key: cacheKey })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[55] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
              <Play size={14} /> {tool.name}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${tool.access_mode === 'WRITE' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                {tool.access_mode}
              </span>
            </h3>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
              {tool.db_owner}.{tool.package_name ? `${tool.package_name}.` : ''}{tool.object_name}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {tool.access_mode === 'WRITE' && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <ShieldAlert size={12} /> 這是 WRITE 型工具,執行會實際修改 ERP 資料
            </div>
          )}

          {/* Inputs */}
          {inParams.length === 0 ? (
            <div className="text-xs text-slate-400">此工具無輸入參數</div>
          ) : (
            <div className="space-y-2">
              {inParams.map(p => (
                <div key={p.name} className="grid grid-cols-4 gap-2 items-start">
                  <label className="text-xs text-slate-600 pt-1.5">
                    <span className="font-mono">{p.name}</span>
                    {p.required && <span className="text-red-600 ml-0.5">*</span>}
                    <div className="text-[10px] text-slate-400">{p.data_type}{p.data_length ? `(${p.data_length})` : ''}</div>
                  </label>
                  <div className="col-span-3">
                    {p.lov_config?.type === 'static' ? (
                      <select value={inputs[p.name] ?? ''}
                        onChange={e => setInputs({ ...inputs, [p.name]: e.target.value })}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                        <option value="">-- 請選擇 --</option>
                        {p.lov_config.items.map((it: any, i: number) => (
                          <option key={i} value={it.value}>{it.label || it.value}</option>
                        ))}
                      </select>
                    ) : p.lov_config?.type && lovCache[p.name] ? (
                      <select value={inputs[p.name] ?? ''}
                        onChange={e => setInputs({ ...inputs, [p.name]: e.target.value })}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                        <option value="">-- 請選擇 ({lovCache[p.name].length}) --</option>
                        {lovCache[p.name].map((it, i) => (
                          <option key={i} value={it.value}>{it.label || it.value}</option>
                        ))}
                      </select>
                    ) : p.lov_config?.type ? (
                      <div className="flex gap-1">
                        <input value={inputs[p.name] ?? ''}
                          onChange={e => setInputs({ ...inputs, [p.name]: e.target.value })}
                          className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                          placeholder={p.ai_hint || ''} />
                        <button onClick={() => loadLov(p.name)} disabled={lovLoading[p.name]}
                          className="px-2 text-xs border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50">
                          {lovLoading[p.name] ? '…' : '載入'}
                        </button>
                      </div>
                    ) : (
                      <input value={inputs[p.name] ?? ''}
                        onChange={e => setInputs({ ...inputs, [p.name]: e.target.value })}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        placeholder={p.ai_hint || ''} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* WRITE confirm */}
          {pendingSummary && confirmToken && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert size={13} className="text-amber-700" />
                <span className="text-sm font-medium text-amber-800">需要確認</span>
              </div>
              <div className="text-xs text-amber-800 mb-2">{pendingSummary}</div>
              <div className="flex gap-2">
                <button onClick={() => { setConfirmToken(null); setPendingSummary(null) }}
                  className="px-3 py-1 text-xs border border-slate-300 rounded bg-white hover:bg-slate-50">取消</button>
                <button onClick={() => execute(true)} disabled={executing}
                  className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                  {executing ? '執行中…' : '確認執行'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={12} /> {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <section className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                  <CheckCircle size={13} className="text-green-600" /> 結果
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setViewMode('table')}
                    className={`text-xs px-2 py-0.5 rounded flex items-center gap-1 ${viewMode === 'table' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>
                    <Table2 size={10} /> Table
                  </button>
                  <button onClick={() => setViewMode('json')}
                    className={`text-xs px-2 py-0.5 rounded flex items-center gap-1 ${viewMode === 'json' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>
                    <FileJson size={10} /> JSON
                  </button>
                </div>
              </div>
              <ResultView data={result} viewMode={viewMode} />
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2 flex-wrap">
          {result ? (
            <>
              <button onClick={() => sendBack('view')}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded hover:bg-white flex items-center gap-1.5">
                <Eye size={12} /> 僅顯示結果
              </button>
              <button onClick={() => sendBack('ai_explain')}
                className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-1.5">
                <Sparkles size={12} /> 讓 AI 解釋
              </button>
              <button onClick={() => sendBack('ask_with')}
                className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded hover:bg-sky-700 flex items-center gap-1.5">
                <MessageSquare size={12} /> 以此提問
              </button>
              <button onClick={onClose}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded hover:bg-white">關閉</button>
            </>
          ) : (
            <>
              <button onClick={onClose}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-white">取消</button>
              <button onClick={() => execute(false)} disabled={executing || !!confirmToken}
                className="px-3 py-1.5 text-sm bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">
                <Play size={12} /> {executing ? '執行中…' : '執行'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultView({ data, viewMode }: { data: any; viewMode: 'table' | 'json' }) {
  if (!data) return <div className="text-xs text-slate-400">無資料</div>
  if (viewMode === 'json') {
    return (
      <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded overflow-auto max-h-80 font-mono">
        {JSON.stringify(data, null, 2)}
      </pre>
    )
  }
  const nodes: any[] = []
  if (data.function_return !== undefined) {
    nodes.push(
      <div key="ret" className="mb-2">
        <div className="text-[10px] font-medium text-slate-500 mb-0.5">Function 回傳</div>
        <div className="bg-slate-50 border rounded px-2 py-1 text-sm font-mono">{String(data.function_return ?? 'null')}</div>
      </div>
    )
  }
  if (data.params) {
    for (const [name, v] of Object.entries(data.params)) {
      if (v && typeof v === 'object' && Array.isArray((v as any).rows)) {
        const rows = (v as any).rows
        if (rows.length === 0) {
          nodes.push(<div key={name} className="text-xs text-slate-400 mb-2">{name}: 空</div>)
          continue
        }
        const cols = Object.keys(rows[0])
        nodes.push(
          <div key={name} className="mb-2">
            <div className="text-[10px] font-medium text-slate-500 mb-0.5">{name} ({(v as any).total_fetched} 列)</div>
            <div className="overflow-auto max-h-60 border rounded">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>{cols.map(c => <th key={c} className="px-2 py-1 text-left font-medium text-slate-600 border-b">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {cols.map(c => (
                        <td key={c} className="px-2 py-0.5 border-b border-slate-100 font-mono">
                          {r[c] === null || r[c] === undefined ? <span className="text-slate-400">null</span> : String(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      } else {
        nodes.push(
          <div key={name} className="mb-2">
            <div className="text-[10px] font-medium text-slate-500 mb-0.5 font-mono">{name}</div>
            <div className="bg-slate-50 border rounded px-2 py-1 text-xs font-mono whitespace-pre-wrap break-words">
              {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
            </div>
          </div>
        )
      }
    }
  }
  return <div>{nodes}</div>
}
