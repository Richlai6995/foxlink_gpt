import { useState } from 'react'
import { ShieldAlert, X, Play, AlertTriangle } from 'lucide-react'
import api from '../../lib/api'

export interface PendingErpConfirm {
  tool_id: number
  tool_code: string
  confirmation_token: string
  summary: string
  args?: Record<string, any>
}

interface Props {
  pending: PendingErpConfirm | null
  sessionId: string | null
  onClose: () => void
  /**
   * 使用者確認後執行完成的回呼。呼叫端可用來把結果灌回對話流。
   */
  onExecuted: (payload: {
    tool_id: number
    tool_code: string
    result: any
    duration_ms: number
    rows_returned: number
  }) => void
}

export default function ErpConfirmDialog({ pending, sessionId, onClose, onExecuted }: Props) {
  const [reason, setReason] = useState('')
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!pending) return null

  const confirm = async () => {
    setError(null)
    setExecuting(true)
    try {
      const res = await api.post(`/erp-tools/${pending.tool_id}/execute`, {
        inputs: pending.args || {},
        trigger_source: 'llm_tool_call',
        confirmation_token: pending.confirmation_token,
        session_id: sessionId,
        include_full: true,
      })
      onExecuted({
        tool_id: pending.tool_id,
        tool_code: pending.tool_code,
        result: res.data.full_result ?? res.data.result,
        duration_ms: res.data.duration_ms,
        rows_returned: res.data.rows_returned,
      })
      onClose()
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || '執行失敗')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-3 border-b bg-red-50 flex items-center justify-between">
          <h3 className="font-semibold text-red-800 flex items-center gap-2">
            <ShieldAlert size={16} /> ERP 寫入操作確認
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-red-100 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {pending.summary || '此操作會修改 ERP 資料,請確認後再執行'}
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">工具</div>
            <div className="text-sm font-mono text-slate-700">{pending.tool_code}</div>
          </div>

          {pending.args && Object.keys(pending.args).length > 0 && (
            <div>
              <div className="text-xs text-slate-500 mb-1">參數</div>
              <pre className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-mono overflow-auto">
{JSON.stringify(pending.args, null, 2)}
              </pre>
            </div>
          )}

          <div>
            <div className="text-xs text-slate-500 mb-1">執行原因(選填,進 audit log)</div>
            <input value={reason} onChange={e => setReason(e.target.value)}
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              placeholder="例如:依工單 WO12345 調整料號狀態" />
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={12} /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t flex justify-end gap-2">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white hover:bg-slate-50">
            取消
          </button>
          <button onClick={confirm} disabled={executing}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
            <Play size={12} />
            {executing ? '執行中…' : '確認執行'}
          </button>
        </div>
      </div>
    </div>
  )
}
