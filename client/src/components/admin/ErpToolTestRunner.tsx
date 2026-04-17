import { useEffect, useState } from 'react'
import { X, Play, AlertTriangle, ShieldAlert, CheckCircle, Clock, RotateCcw } from 'lucide-react'
import api from '../../lib/api'
import type { ErpTool } from './ErpToolsPanel'

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

interface Props {
  tool: ErpTool
  onClose: () => void
}

export default function ErpToolTestRunner({ tool, onClose }: Props) {
  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [lovCache, setLovCache] = useState<Record<string, { value: string; label: string }[]>>({})
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmToken, setConfirmToken] = useState<string | null>(null)
  const [pendingSummary, setPendingSummary] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table')

  // 預設值（固定值 + 動態 preset 前端解析）
  useEffect(() => {
    const init: Record<string, any> = {}
    for (const p of tool.params) {
      const cfg = (p as any).default_config
      if (cfg?.mode === 'preset') {
        init[p.name] = resolvePresetClient(cfg.preset)
      } else if (cfg?.mode === 'fixed' && cfg.fixed_value != null) {
        init[p.name] = cfg.fixed_value
      } else if (p.default_value != null) {
        init[p.name] = p.default_value
      }
    }
    setInputs(init)
  }, [tool])

  const loadLov = async (paramName: string) => {
    try {
      const res = await api.post(`/erp-tools/${tool.id}/lov/${paramName}`, {})
      setLovCache(s => ({ ...s, [paramName]: res.data.items || [] }))
    } catch (e: any) {
      setError(`LOV 載入失敗 (${paramName}): ${e.response?.data?.error || e.message}`)
    }
  }

  const execute = async (withConfirm: boolean = false, dryRun: boolean = false) => {
    setError(null)
    setExecuting(true)
    try {
      const payload: any = {
        inputs,
        trigger_source: 'test',
        include_full: true,
        dry_run: dryRun,
      }
      if (withConfirm && confirmToken) {
        payload.confirmation_token = confirmToken
      }
      const res = await api.post(`/erp-tools/${tool.id}/execute`, payload)
      if (res.data.requires_confirmation) {
        setConfirmToken(res.data.confirmation_token)
        setPendingSummary(res.data.summary)
      } else {
        setResult(res.data)
        setConfirmToken(null)
        setPendingSummary(null)
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setExecuting(false)
    }
  }

  const inParams = tool.params.filter(p => p.in_out === 'IN' || p.in_out === 'IN/OUT')

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <Play size={15} /> 試跑:{tool.name}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${tool.access_mode === 'WRITE' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                {tool.access_mode}
              </span>
            </h3>
            <div className="text-xs text-slate-500 font-mono mt-0.5">
              {tool.db_owner}.{tool.package_name ? `${tool.package_name}.` : ''}{tool.object_name}
              {tool.overload ? ` (overload ${tool.overload})` : ''}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {tool.access_mode === 'WRITE' && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <ShieldAlert size={13} />
              這是 WRITE 型工具,執行會實際修改 ERP 資料
            </div>
          )}

          {/* Inputs */}
          <section>
            <div className="text-sm font-medium mb-2 text-slate-700">參數</div>
            {inParams.length === 0 ? (
              <div className="text-xs text-slate-400">無輸入參數</div>
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
                      ) : p.lov_config?.type === 'sql' || p.lov_config?.type === 'system' ? (
                        <div>
                          {!lovCache[p.name] ? (
                            <button onClick={() => loadLov(p.name)}
                              className="text-xs text-sky-600 hover:text-sky-700 underline mb-1">
                              載入 LOV 選項
                            </button>
                          ) : null}
                          {lovCache[p.name] ? (
                            <select value={inputs[p.name] ?? ''}
                              onChange={e => setInputs({ ...inputs, [p.name]: e.target.value })}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                              <option value="">-- 請選擇 ({lovCache[p.name].length} 筆) --</option>
                              {lovCache[p.name].map((it, i) => (
                                <option key={i} value={it.value}>{it.label || it.value}</option>
                              ))}
                            </select>
                          ) : (
                            <input value={inputs[p.name] ?? ''}
                              onChange={e => setInputs({ ...inputs, [p.name]: e.target.value })}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                              placeholder="尚未載入 LOV,可直接輸入" />
                          )}
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
          </section>

          {/* Confirm dialog */}
          {pendingSummary && confirmToken && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert size={14} className="text-amber-700" />
                <span className="text-sm font-medium text-amber-800">需要確認</span>
              </div>
              <div className="text-xs text-amber-800 mb-3">{pendingSummary}</div>
              <div className="flex gap-2">
                <button onClick={() => { setConfirmToken(null); setPendingSummary(null) }}
                  className="px-3 py-1 text-xs border border-slate-300 rounded bg-white hover:bg-slate-50">
                  取消
                </button>
                <button onClick={() => execute(true)} disabled={executing}
                  className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                  {executing ? '執行中…' : '確認執行'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <section className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-600" /> 執行結果
                  {result.dry_run && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 border border-amber-200">
                      DRY-RUN · 已 rollback
                    </span>
                  )}
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock size={10} /> {result.duration_ms}ms
                  </span>
                  {result.rows_returned > 0 && (
                    <span className="text-xs text-slate-500">· {result.rows_returned} 列</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setViewMode('table')}
                    className={`text-xs px-2 py-0.5 rounded ${viewMode === 'table' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>
                    Table
                  </button>
                  <button onClick={() => setViewMode('json')}
                    className={`text-xs px-2 py-0.5 rounded ${viewMode === 'json' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>
                    JSON
                  </button>
                </div>
              </div>
              <ResultView data={result.full_result || result.result} viewMode={viewMode} />
              {result.cache_key && (
                <div className="text-[10px] text-slate-400 mt-2 font-mono">
                  完整結果快取:{result.cache_key}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-white">
            關閉
          </button>
          {tool.access_mode === 'WRITE' && (
            <button onClick={() => execute(false, true)} disabled={executing || !!confirmToken}
              className="px-3 py-1.5 text-sm border border-amber-400 text-amber-700 bg-amber-50 rounded hover:bg-amber-100 disabled:opacity-50 flex items-center gap-1.5"
              title="SAVEPOINT 執行後 ROLLBACK,不實際套用">
              <RotateCcw size={13} />
              {executing ? '執行中…' : 'Dry-run(不套用)'}
            </button>
          )}
          <button onClick={() => execute(false, false)} disabled={executing || !!confirmToken}
            className="px-3 py-1.5 text-sm bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">
            <Play size={13} />
            {executing ? '執行中…' : '執行'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResultView({ data, viewMode }: { data: any; viewMode: 'table' | 'json' }) {
  if (!data) return <div className="text-xs text-slate-400">無資料</div>

  if (viewMode === 'json') {
    return (
      <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded overflow-auto max-h-96 font-mono">
        {JSON.stringify(data, null, 2)}
      </pre>
    )
  }

  // Table view
  const nodes: JSX.Element[] = []

  if (data.function_return !== undefined) {
    nodes.push(
      <div key="ret" className="mb-3">
        <div className="text-xs font-medium text-slate-600 mb-1">Function 回傳值</div>
        <div className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-sm font-mono">
          {data.function_return === null ? <span className="text-slate-400">null</span> : String(data.function_return)}
        </div>
      </div>
    )
  }

  if (data.params) {
    for (const [name, v] of Object.entries(data.params)) {
      nodes.push(<ParamResultView key={name} name={name} value={v} />)
    }
  }

  return <div>{nodes}</div>
}

function ParamResultView({ name, value }: { name: string; value: any }) {
  if (value === null || value === undefined) {
    return (
      <div className="mb-3">
        <div className="text-xs font-medium text-slate-600 mb-1 font-mono">{name}</div>
        <div className="text-xs text-slate-400">null</div>
      </div>
    )
  }

  if (typeof value === 'object' && Array.isArray(value.rows)) {
    const rows = value.rows as any[]
    if (rows.length === 0) {
      return (
        <div className="mb-3">
          <div className="text-xs font-medium text-slate-600 mb-1 font-mono">{name} (cursor)</div>
          <div className="text-xs text-slate-400">空</div>
        </div>
      )
    }
    const cols = Object.keys(rows[0])
    return (
      <div className="mb-3">
        <div className="text-xs font-medium text-slate-600 mb-1 font-mono flex items-center gap-2">
          {name} (cursor)
          <span className="text-[10px] text-slate-500 font-normal">
            {value.total_fetched || rows.length} 列
            {value.truncated_ui && <span className="text-amber-600 ml-1">(UI 已截斷)</span>}
          </span>
        </div>
        <div className="overflow-auto max-h-64 border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 sticky top-0">
              <tr>{cols.map(c => <th key={c} className="px-2 py-1 text-left font-medium text-slate-600 border-b">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  {cols.map(c => (
                    <td key={c} className="px-2 py-1 border-b border-slate-100 font-mono text-[11px]">
                      {r[c] === null || r[c] === undefined
                        ? <span className="text-slate-400">null</span>
                        : String(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-slate-600 mb-1 font-mono">{name}</div>
      <div className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-mono whitespace-pre-wrap break-words">
        {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
      </div>
    </div>
  )
}
