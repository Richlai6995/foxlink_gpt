import { useState } from 'react'
import { RotateCw, Square, Play } from 'lucide-react'
import api from '../../lib/api'

interface ContainerInfo {
  ID: string
  Names: string
  Image: string
  Status: string
  State: string
  Ports: string
  RunningFor: string
}

interface Props {
  containers: ContainerInfo[]
  loading: boolean
  onRefresh: () => void
  onViewLog?: (containerId: string) => void
}

export default function ContainerTable({ containers, loading, onRefresh, onViewLog }: Props) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const doAction = async (id: string, action: 'restart' | 'stop' | 'start') => {
    if (!confirm(`確定要 ${action} container ${id.slice(0, 12)}?`)) return
    setActionLoading(id)
    try {
      await api.post(`/monitor/containers/${id}/${action}`)
      onRefresh()
    } catch (e: unknown) {
      alert((e as Error).message || 'Failed')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) return <div className="animate-pulse h-32 bg-white border rounded-lg" />

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Docker Containers</span>
        <span className="text-xs text-slate-400">({containers.length})</span>
      </div>
      <div className="max-h-48 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Name</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Image</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Status</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Running</th>
              <th className="px-3 py-1.5 text-slate-500 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {containers.map(c => (
              <tr key={c.ID} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 font-mono">{c.Names}</td>
                <td className="px-3 py-1.5 text-slate-500 truncate max-w-[150px]" title={c.Image}>
                  {c.Image}
                </td>
                <td className={`px-3 py-1.5 ${c.State === 'running' ? 'text-green-600' : 'text-red-600'}`}>
                  {c.State}
                </td>
                <td className="px-3 py-1.5 text-slate-400">{c.RunningFor}</td>
                <td className="px-3 py-1.5 text-right">
                  <div className="flex gap-1 justify-end">
                    {onViewLog && (
                      <button
                        onClick={() => onViewLog(c.ID)}
                        className="text-blue-500 hover:text-blue-700 px-1"
                      >
                        Log
                      </button>
                    )}
                    <button
                      onClick={() => doAction(c.ID, 'restart')}
                      disabled={actionLoading === c.ID}
                      className="p-0.5 text-orange-500 hover:text-orange-700 disabled:opacity-50"
                      title="Restart"
                    >
                      <RotateCw size={12} />
                    </button>
                    {c.State === 'running' ? (
                      <button
                        onClick={() => doAction(c.ID, 'stop')}
                        disabled={actionLoading === c.ID}
                        className="p-0.5 text-red-500 hover:text-red-700 disabled:opacity-50"
                        title="Stop"
                      >
                        <Square size={12} />
                      </button>
                    ) : (
                      <button
                        onClick={() => doAction(c.ID, 'start')}
                        disabled={actionLoading === c.ID}
                        className="p-0.5 text-green-500 hover:text-green-700 disabled:opacity-50"
                        title="Start"
                      >
                        <Play size={12} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {containers.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-6">No containers</div>
        )}
      </div>
    </div>
  )
}
