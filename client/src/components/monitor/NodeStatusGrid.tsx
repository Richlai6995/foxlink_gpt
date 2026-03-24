import { Server, CheckCircle, XCircle } from 'lucide-react'

interface NodeDetail {
  name: string
  status: string
  role: string
  allocatable: { cpu: string; memory: string }
  requests: { cpu: string; memory: string }
  cpuReqPct: number
  memReqPct: number
  podCount: number
  error?: string
}

interface Props {
  nodes: NodeDetail[]
  loading: boolean
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const color = value > 90 ? 'bg-red-500' : value > 70 ? 'bg-orange-500' : 'bg-blue-500'
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-mono">{value}%</span>
      </div>
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  )
}

export default function NodeStatusGrid({ nodes, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white border rounded-lg p-4 animate-pulse h-36" />
        ))}
      </div>
    )
  }

  if (nodes.length === 0) {
    return <div className="text-sm text-slate-400">kubectl 無法連線或沒有節點資料</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {nodes.map(node => (
        <div key={node.name} className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Server size={14} className="text-slate-400" />
            <span className="font-medium text-sm">{node.name}</span>
            <span className="text-xs text-slate-400 ml-auto">{node.role}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {node.status === 'Ready'
              ? <CheckCircle size={13} className="text-green-500" />
              : <XCircle size={13} className="text-red-500" />}
            <span className={`text-xs font-medium ${node.status === 'Ready' ? 'text-green-600' : 'text-red-600'}`}>
              {node.status}
            </span>
            <span className="text-xs text-slate-400 ml-auto">{node.podCount} pods</span>
          </div>
          {!node.error && (
            <div className="space-y-1.5 pt-1">
              <ProgressBar value={node.cpuReqPct} label="CPU Request" />
              <ProgressBar value={node.memReqPct} label="Memory Request" />
            </div>
          )}
          {node.error && <div className="text-xs text-red-500">{node.error}</div>}
        </div>
      ))}
    </div>
  )
}
