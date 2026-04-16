import { useEffect, useState } from 'react'
import { X, RefreshCw, Filter, Clock, AlertTriangle, CheckCircle, Zap, User, Database } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'
import type { ErpTool } from './ErpToolsPanel'

interface AuditRow {
  id: number
  tool_id: number
  user_id: number | null
  session_id: string | null
  trigger_source: string
  access_mode: string
  input_json: string | null
  output_sample: string | null
  result_cache_key: string | null
  duration_ms: number
  rows_returned: number
  error_code: string | null
  error_message: string | null
  created_at: string
  tool_code?: string
  tool_name?: string
  tool_access_mode?: string
  user_name?: string
  user_display_name?: string
}

interface Props {
  tools: ErpTool[]
  onClose: () => void
  initialToolId?: number
}

const TRIGGER_LABELS: Record<string, { label: string; color: string }> = {
  llm_tool_call: { label: 'LLM 呼叫', color: 'bg-purple-100 text-purple-700' },
  manual_form:   { label: '手動觸發', color: 'bg-blue-100 text-blue-700' },
  inject:        { label: 'Inject',  color: 'bg-cyan-100 text-cyan-700' },
  test:          { label: '試跑',    color: 'bg-slate-100 text-slate-700' },
}

function safeParse(s: string | null): any {
  if (!s) return null
  try { return JSON.parse(s) } catch { return s }
}

export default function ErpToolAuditLogPanel({ tools, onClose, initialToolId }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filterToolId, setFilterToolId] = useState<number | null>(initialToolId ?? null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ limit: '200' })
      if (filterToolId) params.set('tool_id', String(filterToolId))
      const res = await api.get(`/erp-tools/audit-log/all?${params}`)
      setRows(res.data.map((r: any) => ({
        id: r.id || r.ID,
        tool_id: r.tool_id || r.TOOL_ID,
        user_id: r.user_id || r.USER_ID,
        session_id: r.session_id || r.SESSION_ID,
        trigger_source: r.trigger_source || r.TRIGGER_SOURCE,
        access_mode: r.access_mode || r.ACCESS_MODE,
        input_json: r.input_json || r.INPUT_JSON,
        output_sample: r.output_sample || r.OUTPUT_SAMPLE,
        result_cache_key: r.result_cache_key || r.RESULT_CACHE_KEY,
        duration_ms: r.duration_ms || r.DURATION_MS,
        rows_returned: r.rows_returned || r.ROWS_RETURNED,
        error_code: r.error_code || r.ERROR_CODE,
        error_message: r.error_message || r.ERROR_MESSAGE,
        created_at: r.created_at || r.CREATED_AT,
        tool_code: r.tool_code || r.TOOL_CODE,
        tool_name: r.tool_name || r.TOOL_NAME,
        tool_access_mode: r.tool_access_mode || r.TOOL_ACCESS_MODE,
        user_name: r.user_name || r.USER_NAME,
        user_display_name: r.user_display_name || r.USER_DISPLAY_NAME,
      })))
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterToolId])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Database size={15} /> ERP 執行歷史
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-1.5 hover:bg-slate-100 rounded" title="重新整理">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 py-2 border-b bg-slate-50 flex items-center gap-2 text-xs">
          <Filter size={12} className="text-slate-400" />
          <span className="text-slate-500">篩選工具:</span>
          <select value={filterToolId ?? ''} onChange={e => setFilterToolId(e.target.value ? Number(e.target.value) : null)}
            className="border border-slate-300 rounded px-2 py-1">
            <option value="">全部</option>
            {tools.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
          </select>
          <span className="ml-auto text-slate-400">{rows.length} 筆</span>
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 text-red-700 text-xs">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && rows.length === 0 ? (
            <div className="text-slate-400 text-sm py-12 text-center">載入中…</div>
          ) : rows.length === 0 ? (
            <div className="text-slate-400 text-sm py-12 text-center">尚無執行紀錄</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-100 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">時間</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">工具</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">來源</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">使用者</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600">耗時</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600">列數</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">狀態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const exp = expandedId === r.id
                  const trig = TRIGGER_LABELS[r.trigger_source] || { label: r.trigger_source, color: 'bg-slate-100 text-slate-600' }
                  return (
                    <>
                      <tr key={r.id}
                        onClick={() => setExpandedId(exp ? null : r.id)}
                        className="border-b hover:bg-slate-50 cursor-pointer">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">{fmtTW(r.created_at)}</td>
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{r.tool_name || '-'}</div>
                          <div className="font-mono text-[10px] text-slate-400">{r.tool_code}</div>
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${trig.color}`}>{trig.label}</span>
                          {r.access_mode === 'WRITE' && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700">WRITE</span>}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">{r.user_display_name || r.user_name || '-'}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-500">{r.duration_ms}ms</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-500">{r.rows_returned || '-'}</td>
                        <td className="px-3 py-1.5">
                          {r.error_code ? (
                            <span className="text-red-600 flex items-center gap-1">
                              <AlertTriangle size={11} /> {r.error_code}
                            </span>
                          ) : (
                            <span className="text-green-600 flex items-center gap-1">
                              <CheckCircle size={11} /> 成功
                            </span>
                          )}
                        </td>
                      </tr>
                      {exp && (
                        <tr key={`${r.id}-exp`}>
                          <td colSpan={7} className="px-3 py-2 bg-slate-50 border-b">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <div className="text-[10px] font-medium text-slate-500 mb-1">Input</div>
                                <pre className="bg-white border border-slate-200 rounded p-2 text-[11px] font-mono max-h-48 overflow-auto">
{JSON.stringify(safeParse(r.input_json), null, 2)}
                                </pre>
                              </div>
                              <div>
                                <div className="text-[10px] font-medium text-slate-500 mb-1">
                                  Output sample {r.result_cache_key && <span className="text-slate-400 font-normal">({r.result_cache_key})</span>}
                                </div>
                                <pre className="bg-white border border-slate-200 rounded p-2 text-[11px] font-mono max-h-48 overflow-auto">
{r.error_message ? r.error_message : JSON.stringify(safeParse(r.output_sample), null, 2)}
                                </pre>
                              </div>
                              {r.session_id && (
                                <div className="col-span-2 text-[10px] text-slate-400">session: {r.session_id}</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
