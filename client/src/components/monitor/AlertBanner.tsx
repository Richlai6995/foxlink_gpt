import { useState, useRef, useEffect, useCallback } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, CheckCircle, BellOff, Bot, X, CheckCheck, Download } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'
import ReactMarkdown from 'react-markdown'

interface Alert {
  id: number
  alert_type: string
  severity: string
  resource_name: string
  message: string
  notified_at: string
  resolved_at: string | null
  snoozed_until: string | null
}

interface Props {
  alerts: Alert[]
  onRefresh: () => void
  filterDays: number
  onFilterDaysChange: (d: number) => void
}

const severityColor: Record<string, string> = {
  emergency: 'bg-red-600',
  critical: 'bg-red-500',
  warning: 'bg-orange-500',
}

export default function AlertBanner({ alerts, onRefresh, filterDays, onFilterDaysChange }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [diagnosing, setDiagnosing] = useState<number | null>(null)
  const [diagResult, setDiagResult] = useState('')
  const [diagLoading, setDiagLoading] = useState(false)
  const diagRef = useRef<HTMLDivElement>(null)

  const now = new Date()
  const unresolved = alerts.filter(a => {
    if (a.resolved_at) return false
    // Hide snoozed alerts
    if (a.snoozed_until && new Date(a.snoozed_until) > now) return false
    return true
  })

  const resolveAlert = async (id: number) => {
    try {
      await api.post(`/monitor/alerts/${id}/resolve`)
      onRefresh()
    } catch {}
  }

  const resolveAll = async () => {
    if (!confirm(`確定要解除全部 ${unresolved.length} 個告警？`)) return
    try {
      await api.post('/monitor/alerts/resolve-all')
      onRefresh()
    } catch {}
  }

  const snoozeAlert = async (id: number, days: number) => {
    try {
      await api.post(`/monitor/alerts/${id}/snooze`, { days })
      onRefresh()
    } catch {}
  }

  const diagnoseAlert = useCallback(async (id: number) => {
    setDiagnosing(id)
    setDiagResult('')
    setDiagLoading(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/monitor/alerts/${id}/diagnose`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) throw new Error('Diagnose failed')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No reader')

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.done) break
            if (data.error) {
              setDiagResult(prev => prev + `\n\n**Error:** ${data.error}`)
              break
            }
            if (data.text) {
              setDiagResult(prev => prev + data.text)
            }
          } catch {}
        }
      }
    } catch (e) {
      setDiagResult(`診斷失敗: ${(e as Error).message}`)
    } finally {
      setDiagLoading(false)
    }
  }, [])

  useEffect(() => {
    if (diagnosing && diagRef.current) {
      diagRef.current.scrollTop = diagRef.current.scrollHeight
    }
  }, [diagResult, diagnosing])

  const exportCsv = useCallback(() => {
    const BOM = '\uFEFF'
    const headers = ['嚴重度', '類型', '資源', '訊息', '時間', '狀態']
    const rows = unresolved.map(a => [
      a.severity,
      a.alert_type,
      a.resource_name,
      (a.message || '').replace(/"/g, '""'),
      fmtTW(a.notified_at),
      a.resolved_at ? '已解除' : '未解除',
    ])
    const csv = BOM + [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alerts_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [unresolved])

  if (unresolved.length === 0 && !diagnosing) return null

  return (
    <>
      <div className="mb-4 rounded-lg overflow-hidden border border-red-300">
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 flex-1 text-red-700 hover:text-red-800"
          >
            <AlertTriangle size={16} />
            <span className="font-medium text-sm">
              {unresolved.length} 個未解除異常警示
            </span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <div className="flex items-center gap-2">
            <select
              value={filterDays}
              onChange={e => onFilterDaysChange(Number(e.target.value))}
              className="text-xs border rounded px-1.5 py-1 bg-white"
              title="顯示天數"
            >
              <option value={1}>1 天</option>
              <option value={3}>3 天</option>
              <option value={7}>7 天</option>
              <option value={14}>14 天</option>
              <option value={30}>30 天</option>
            </select>
            <button onClick={exportCsv} className="p-1 text-red-400 hover:text-red-600" title="匯出 CSV">
              <Download size={14} />
            </button>
            {unresolved.length > 0 && (
              <button onClick={resolveAll} className="p-1 text-green-600 hover:text-green-800" title="全部解除">
                <CheckCheck size={14} />
              </button>
            )}
          </div>
        </div>
        {expanded && (
          <div className="bg-white divide-y divide-slate-100 max-h-64 overflow-auto">
            {unresolved.map(a => (
              <div key={a.id} className="px-4 py-2 flex items-center gap-2 text-sm">
                <span className={`${severityColor[a.severity] || 'bg-slate-500'} text-white text-[10px] px-1.5 py-0.5 rounded uppercase font-medium`}>
                  {a.severity}
                </span>
                <span className="text-slate-500 font-mono text-xs">{a.alert_type}</span>
                <span className="flex-1 text-slate-700 truncate text-xs" title={a.message}>{a.message}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  {fmtTW(a.notified_at)}
                </span>
                <button
                  onClick={() => diagnoseAlert(a.id)}
                  className="p-1 text-blue-500 hover:text-blue-700"
                  title="AI 診斷"
                >
                  <Bot size={13} />
                </button>
                <button
                  onClick={() => snoozeAlert(a.id, 7)}
                  className="p-1 text-orange-400 hover:text-orange-600"
                  title="靜音 7 天"
                >
                  <BellOff size={13} />
                </button>
                <button
                  onClick={() => resolveAlert(a.id)}
                  className="p-1 text-green-600 hover:text-green-800"
                  title="標記已解除"
                >
                  <CheckCircle size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Diagnose Modal */}
      {diagnosing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => { setDiagnosing(null); setDiagResult('') }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-blue-500" />
                <span className="font-semibold text-sm text-slate-700">AI 故障診斷</span>
                {diagLoading && (
                  <span className="flex items-center gap-1 text-[10px] text-blue-500">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                    分析中...
                  </span>
                )}
              </div>
              <button onClick={() => { setDiagnosing(null); setDiagResult('') }} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div ref={diagRef} className="flex-1 overflow-auto p-5 min-h-0">
              {diagResult ? (
                <div className="prose prose-sm max-w-none prose-pre:bg-slate-900 prose-pre:text-slate-100">
                  <ReactMarkdown>{diagResult}</ReactMarkdown>
                </div>
              ) : (
                <div className="text-center text-slate-400 py-12">
                  {diagLoading ? '正在收集 K8s 資訊並分析...' : '等待診斷結果...'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
