import { Cpu, HardDrive, Wifi, Clock } from 'lucide-react'

interface HostMetrics {
  load_1m: number; load_5m: number; load_15m: number
  mem_total_mb: number; mem_used_mb: number; mem_cached_mb: number; swap_used_mb: number
  net_rx_mb: number; net_tx_mb: number
  disk_read_mb: number; disk_write_mb: number
  uptime_sec: number
}

interface Process {
  user: string; pid: string; cpu: number; mem: number; command: string
}

interface Props {
  metrics: HostMetrics | null
  processes: Process[]
  loading: boolean
}

function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`
}

function formatMB(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export default function HostMetricsPanel({ metrics, processes, loading }: Props) {
  if (loading) return <div className="animate-pulse h-36 bg-white border rounded-lg" />
  if (!metrics) return <div className="text-sm text-slate-400">無主機指標資料</div>

  const memPct = metrics.mem_total_mb > 0
    ? Math.round((metrics.mem_used_mb / metrics.mem_total_mb) * 100)
    : 0

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="text-sm font-medium text-slate-700">主機系統指標</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-blue-500" />
          <div>
            <div className="text-slate-500">CPU Load</div>
            <div className="font-mono font-bold">
              {metrics.load_1m.toFixed(2)} / {metrics.load_5m.toFixed(2)} / {metrics.load_15m.toFixed(2)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HardDrive size={14} className="text-green-500" />
          <div>
            <div className="text-slate-500">Memory</div>
            <div className="font-mono font-bold">
              {formatMB(metrics.mem_used_mb)} / {formatMB(metrics.mem_total_mb)}
              <span className={`ml-1 ${memPct > 85 ? 'text-red-600' : ''}`}>({memPct}%)</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Wifi size={14} className="text-purple-500" />
          <div>
            <div className="text-slate-500">Network I/O</div>
            <div className="font-mono font-bold">
              ↓{formatMB(metrics.net_rx_mb)} ↑{formatMB(metrics.net_tx_mb)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-orange-500" />
          <div>
            <div className="text-slate-500">Uptime</div>
            <div className="font-mono font-bold">{formatUptime(metrics.uptime_sec)}</div>
          </div>
        </div>
      </div>
      {metrics.swap_used_mb > 0 && (
        <div className="text-xs text-orange-600">Swap: {formatMB(metrics.swap_used_mb)} used</div>
      )}

      {processes.length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-1">Top Processes by CPU</div>
          <div className="max-h-36 overflow-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-400">
                  <th className="text-left px-1 py-0.5">PID</th>
                  <th className="text-left px-1 py-0.5">User</th>
                  <th className="text-right px-1 py-0.5">CPU%</th>
                  <th className="text-right px-1 py-0.5">MEM%</th>
                  <th className="text-left px-1 py-0.5">Command</th>
                </tr>
              </thead>
              <tbody>
                {processes.slice(0, 10).map((p, i) => (
                  <tr key={i} className="border-t border-slate-50">
                    <td className="px-1 py-0.5 font-mono">{p.pid}</td>
                    <td className="px-1 py-0.5">{p.user}</td>
                    <td className={`px-1 py-0.5 text-right font-mono ${p.cpu > 50 ? 'text-red-600' : ''}`}>
                      {p.cpu.toFixed(1)}
                    </td>
                    <td className="px-1 py-0.5 text-right font-mono">{p.mem.toFixed(1)}</td>
                    <td className="px-1 py-0.5 truncate max-w-[200px] font-mono" title={p.command}>
                      {p.command}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
