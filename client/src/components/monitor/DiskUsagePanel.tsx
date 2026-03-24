import { HardDrive, AlertTriangle, CheckCircle } from 'lucide-react'

interface DiskInfo {
  device: string
  mount: string
  total: string
  used: string
  available: string
  use_pct: number
  inode_pct: number
  is_mounted: boolean
}

interface Props {
  disks: DiskInfo[]
  loading: boolean
}

export default function DiskUsagePanel({ disks, loading }: Props) {
  if (loading) return <div className="animate-pulse h-32 bg-white border rounded-lg" />

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
        <HardDrive size={14} /> 磁碟 / NAS 掛載
      </div>
      {disks.length === 0 && (
        <div className="text-xs text-slate-400">無磁碟資料（僅 Linux 可用）</div>
      )}
      <div className="space-y-2">
        {disks.map((d, i) => {
          const barColor = !d.is_mounted ? 'bg-red-500'
            : d.use_pct > 90 ? 'bg-red-500'
            : d.use_pct > 75 ? 'bg-orange-500'
            : 'bg-blue-500'

          return (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-slate-700 font-medium">{d.mount}</span>
                {d.is_mounted
                  ? <CheckCircle size={12} className="text-green-500" />
                  : <AlertTriangle size={12} className="text-red-500" />}
                {!d.is_mounted && (
                  <span className="text-red-600 font-bold text-[10px]">未掛載!</span>
                )}
                <span className="ml-auto text-slate-400">
                  {d.is_mounted ? `${d.used} / ${d.total}` : '-'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor} rounded-full transition-all`}
                    style={{ width: `${Math.min(d.use_pct, 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-mono w-10 text-right ${d.use_pct > 85 ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                  {d.use_pct}%
                </span>
              </div>
              {d.inode_pct > 50 && (
                <div className="text-[10px] text-orange-600">inode: {d.inode_pct}%</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
