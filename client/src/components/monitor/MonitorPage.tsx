import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Settings } from 'lucide-react'
import api from '../../lib/api'
import MonitorSummaryCards from './MonitorSummaryCards'
import AlertBanner from './AlertBanner'
import NodeStatusGrid from './NodeStatusGrid'
import PodTable from './PodTable'
import K8sEventsTable from './K8sEventsTable'
import HostMetricsPanel from './HostMetricsPanel'
import DiskUsagePanel from './DiskUsagePanel'
import OnlineUsersPanel from './OnlineUsersPanel'
import OnlineDeptChart from './OnlineDeptChart'
import ContainerTable from './ContainerTable'
import DockerImagesPanel from './DockerImagesPanel'
import HealthChecksPanel from './HealthChecksPanel'
import LogViewer from './LogViewer'
import DeployPanel from './DeployPanel'
import MetricsChart from './MetricsChart'
import MonitorSettingsModal from './MonitorSettingsModal'

export default function MonitorPage() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<ReturnType<typeof Object> | null>(null)
  const [alerts, setAlerts] = useState<ReturnType<typeof Array<Record<string, unknown>>>>([] as Record<string, unknown>[])
  const [nodeDetails, setNodeDetails] = useState<Record<string, unknown>[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pods, setPods] = useState<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [events, setEvents] = useState<any[]>([])
  const [hostMetrics, setHostMetrics] = useState<Record<string, unknown> | null>(null)
  const [processes, setProcesses] = useState<Record<string, unknown>[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [disks, setDisks] = useState<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [onlineUsers, setOnlineUsers] = useState<any>({ count: 0, users: [] })
  const [onlineHistory, setOnlineHistory] = useState<Record<string, unknown>[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [containers, setContainers] = useState<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [images, setImages] = useState<any[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [alertFilterDays, setAlertFilterDays] = useState(7)

  // Log viewer state
  const [logTarget, setLogTarget] = useState<{ type: 'pod' | 'container'; target: string } | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.allSettled([
        api.get('/monitor/summary'),
        api.get(`/monitor/alerts?resolved=false&days=${alertFilterDays}`),
        api.get('/monitor/nodes/detail'),
        api.get('/monitor/pods'),
        api.get('/monitor/events'),
        api.get('/monitor/host/current'),
        api.get('/monitor/host/processes'),
        api.get('/monitor/disk'),
        api.get('/monitor/online-users'),
        api.get('/monitor/online-users/history?hours=24'),
        api.get('/monitor/containers'),
        api.get('/monitor/images'),
      ])

      const get = (i: number) => results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<{ data: unknown }>).value.data : null

      setSummary(get(0))
      setAlerts((get(1) || []) as Record<string, unknown>[])
      setNodeDetails((get(2) || []) as Record<string, unknown>[])
      setPods((get(3) as { items?: unknown[] })?.items || [])
      setEvents((get(4) as { items?: unknown[] })?.items || [])
      setHostMetrics(get(5) as Record<string, unknown> | null)
      setProcesses((get(6) || []) as Record<string, unknown>[])
      setDisks((get(7) || []) as Record<string, unknown>[])
      setOnlineUsers(get(8) || { count: 0, users: [] })
      setOnlineHistory((get(9) || []) as Record<string, unknown>[])
      setContainers((get(10) || []) as Record<string, unknown>[])
      setImages((get(11) || []) as Record<string, unknown>[])
    } catch (e) {
      console.error('Monitor fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [alertFilterDays])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000) // Auto-refresh every 30s
    return () => clearInterval(interval)
  }, [fetchAll])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-slate-800">系統監控</h1>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="p-1.5 text-slate-400 hover:text-blue-600 disabled:animate-spin"
          title="重新整理"
        >
          <RefreshCw size={16} />
        </button>
        <div className="flex-1" />
        <DeployPanel onRefresh={fetchAll} />
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1.5 text-slate-400 hover:text-blue-600"
          title="設定"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Alert Banner */}
      <AlertBanner
        alerts={alerts as never[]}
        onRefresh={fetchAll}
        filterDays={alertFilterDays}
        onFilterDaysChange={setAlertFilterDays}
      />

      {/* Summary Cards */}
      <MonitorSummaryCards data={summary as never} loading={loading} />

      {/* Row 1: Nodes + Pods + Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div>
          <NodeStatusGrid nodes={nodeDetails as never[]} loading={loading} />
        </div>
        <div>
          <PodTable
            pods={pods}
            loading={loading}
            onViewLog={(ns, pod) => setLogTarget({ type: 'pod', target: `${ns}/${pod}` })}
          />
        </div>
        <div>
          <K8sEventsTable events={events} loading={loading} />
        </div>
      </div>

      {/* Row 2: Host Metrics + Disk + Online Users */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <HostMetricsPanel metrics={hostMetrics as never} processes={processes as never[]} loading={loading} />
        <DiskUsagePanel disks={disks} loading={loading} />
        <OnlineUsersPanel current={onlineUsers} history={onlineHistory as never[]} loading={loading} />
      </div>

      {/* Row 3: Online Dept Chart */}
      <OnlineDeptChart />

      {/* Row 4: Docker Containers + Images (hidden when no Docker socket) */}
      {(containers.length > 0 || images.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ContainerTable
            containers={containers}
            loading={loading}
            onRefresh={fetchAll}
            onViewLog={(id) => setLogTarget({ type: 'container', target: id })}
          />
          <DockerImagesPanel images={images} loading={loading} onRefresh={fetchAll} />
        </div>
      )}

      {/* Health Checks */}
      <HealthChecksPanel onRefresh={fetchAll} />

      {/* Metrics Chart */}
      <MetricsChart />

      {/* Log Viewer */}
      {logTarget && (
        <LogViewer
          type={logTarget.type}
          target={logTarget.target}
          onClose={() => setLogTarget(null)}
        />
      )}

      {/* Settings Modal */}
      <MonitorSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
