import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, CheckCircle } from 'lucide-react'
import api from '../../lib/api'

interface Alert {
  id: number
  alert_type: string
  severity: string
  resource_name: string
  message: string
  notified_at: string
  resolved_at: string | null
}

interface Props {
  alerts: Alert[]
  onRefresh: () => void
}

const severityColor: Record<string, string> = {
  emergency: 'bg-red-600',
  critical: 'bg-red-500',
  warning: 'bg-orange-500',
}

export default function AlertBanner({ alerts, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false)
  const unresolved = alerts.filter(a => !a.resolved_at)

  if (unresolved.length === 0) return null

  const resolveAlert = async (id: number) => {
    try {
      await api.post(`/monitor/alerts/${id}/resolve`)
      onRefresh()
    } catch {}
  }

  return (
    <div className="mb-4 rounded-lg overflow-hidden border border-red-300">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 hover:bg-red-100 transition"
      >
        <AlertTriangle size={16} />
        <span className="font-medium text-sm">
          {unresolved.length} 個未解除異常警示
        </span>
        {expanded ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
      </button>
      {expanded && (
        <div className="bg-white divide-y divide-slate-100 max-h-48 overflow-auto">
          {unresolved.map(a => (
            <div key={a.id} className="px-4 py-2 flex items-center gap-3 text-sm">
              <span className={`${severityColor[a.severity] || 'bg-slate-500'} text-white text-xs px-1.5 py-0.5 rounded uppercase`}>
                {a.severity}
              </span>
              <span className="text-slate-600 font-mono text-xs">{a.alert_type}</span>
              <span className="flex-1 text-slate-700 truncate">{a.message}</span>
              <span className="text-xs text-slate-400 whitespace-nowrap">
                {new Date(a.notified_at).toLocaleString()}
              </span>
              <button
                onClick={() => resolveAlert(a.id)}
                className="text-green-600 hover:text-green-800 p-1"
                title="標記已解除"
              >
                <CheckCircle size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
