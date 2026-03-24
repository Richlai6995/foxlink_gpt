import { Server, Container, Users, HardDrive, Cpu, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SummaryData {
  nodes: { total: number; ready: number }
  pods: { running: number; error: number; total: number }
  onlineUsers: number
  unresolvedAlerts: number
  host: {
    load_1m: number; load_5m: number; load_15m: number
    mem_total_mb: number; mem_used_mb: number
  } | null
  disks: Array<{ mount: string; use_pct: number; total_gb: number; used_gb: number }>
}

interface Props {
  data: SummaryData | null
  loading: boolean
}

export default function MonitorSummaryCards({ data, loading }: Props) {
  const { t } = useTranslation()
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg border p-3 animate-pulse h-20" />
        ))}
      </div>
    )
  }

  const cards = [
    {
      label: t('monitor.nodes', '節點'),
      value: `${data.nodes.ready}/${data.nodes.total}`,
      sub: 'Ready',
      icon: <Server size={18} />,
      color: data.nodes.ready === data.nodes.total ? 'text-green-600' : 'text-red-600',
    },
    {
      label: t('monitor.pods', 'Pods'),
      value: `${data.pods.running}`,
      sub: data.pods.error > 0 ? `${data.pods.error} Error` : `${data.pods.total} Total`,
      icon: <Container size={18} />,
      color: data.pods.error > 0 ? 'text-red-600' : 'text-green-600',
    },
    {
      label: t('monitor.onlineUsers', '線上人數'),
      value: String(data.onlineUsers),
      sub: '',
      icon: <Users size={18} />,
      color: 'text-blue-600',
    },
    {
      label: t('monitor.disk', '磁碟'),
      value: data.disks.length > 0 ? `${Math.max(...data.disks.map(d => d.use_pct))}%` : 'N/A',
      sub: data.disks.length > 0 ? `max of ${data.disks.length} mounts` : '',
      icon: <HardDrive size={18} />,
      color: data.disks.some(d => d.use_pct > 85) ? 'text-red-600' : 'text-green-600',
    },
    {
      label: 'CPU Load',
      value: data.host ? `${data.host.load_1m.toFixed(1)}` : 'N/A',
      sub: data.host ? `${data.host.load_5m.toFixed(1)} / ${data.host.load_15m.toFixed(1)}` : '',
      icon: <Cpu size={18} />,
      color: data.host && data.host.load_1m > 4 ? 'text-orange-600' : 'text-green-600',
    },
    {
      label: t('monitor.alerts', '告警'),
      value: String(data.unresolvedAlerts),
      sub: t('monitor.unresolved', '未解除'),
      icon: <AlertTriangle size={18} />,
      color: data.unresolvedAlerts > 0 ? 'text-red-600' : 'text-green-600',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      {cards.map((c, i) => (
        <div key={i} className="bg-white rounded-lg border border-slate-200 p-3 flex items-center gap-3">
          <div className={`${c.color} opacity-70`}>{c.icon}</div>
          <div>
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
            {c.sub && <div className="text-xs text-slate-400">{c.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
