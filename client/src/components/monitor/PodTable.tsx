import { useState, useMemo } from 'react'
import { ChevronDown, Maximize2, X } from 'lucide-react'

interface PodItem {
  metadata: { name: string; namespace: string; creationTimestamp: string }
  status: {
    phase: string
    containerStatuses?: Array<{
      name: string; ready: boolean; restartCount: number; image: string
      state?: Record<string, unknown>
    }>
  }
  spec?: { nodeName?: string }
}

interface Props {
  pods: PodItem[]
  loading: boolean
  onViewLog?: (ns: string, pod: string) => void
}

const phaseColor: Record<string, string> = {
  Running: 'text-green-600',
  Succeeded: 'text-slate-400',
  Pending: 'text-orange-500',
  Failed: 'text-red-600',
  Unknown: 'text-slate-500',
}

export default function PodTable({ pods, loading, onViewLog }: Props) {
  const [nsFilter, setNsFilter] = useState<string>('')
  const [showModal, setShowModal] = useState(false)

  const namespaces = useMemo(() => {
    const s = new Set(pods.map(p => p.metadata.namespace))
    return Array.from(s).sort()
  }, [pods])

  const filtered = useMemo(() => {
    if (!nsFilter) return pods
    return pods.filter(p => p.metadata.namespace === nsFilter)
  }, [pods, nsFilter])

  if (loading) return <div className="animate-pulse h-32 bg-white border rounded-lg" />

  const nsSelect = (
    <div className="relative">
      <select
        value={nsFilter}
        onChange={e => setNsFilter(e.target.value)}
        className="text-xs border rounded px-2 py-1 pr-6 appearance-none bg-white"
      >
        <option value="">All Namespaces</option>
        {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  )

  const renderTable = (maxH?: string) => (
    <div className={`${maxH || 'max-h-64'} overflow-auto`}>
      <table className="w-full text-xs">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Namespace</th>
            <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Pod</th>
            <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Status</th>
            <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Restarts</th>
            <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Node</th>
            <th className="px-3 py-1.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {filtered.map(p => {
            const restarts = (p.status.containerStatuses || []).reduce((a, c) => a + (c.restartCount || 0), 0)
            return (
              <tr key={`${p.metadata.namespace}/${p.metadata.name}`} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 text-slate-500">{p.metadata.namespace}</td>
                <td className="px-3 py-1.5 font-mono truncate max-w-[200px]" title={p.metadata.name}>{p.metadata.name}</td>
                <td className={`px-3 py-1.5 font-medium ${phaseColor[p.status.phase] || ''}`}>
                  {p.status.phase}
                </td>
                <td className={`px-3 py-1.5 ${restarts > 5 ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                  {restarts}
                </td>
                <td className="px-3 py-1.5 text-slate-500">{p.spec?.nodeName || '-'}</td>
                <td className="px-3 py-1.5">
                  {onViewLog && (
                    <button
                      onClick={() => onViewLog(p.metadata.namespace, p.metadata.name)}
                      className="text-blue-500 hover:text-blue-700 text-xs"
                    >
                      Log
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {filtered.length === 0 && (
        <div className="text-center text-slate-400 text-xs py-6">No pods</div>
      )}
    </div>
  )

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">K8s Pods</span>
          <span className="text-xs text-slate-400">({filtered.length})</span>
          <div className="ml-auto flex items-center gap-2">
            {nsSelect}
            <button
              onClick={() => setShowModal(true)}
              className="p-1 text-slate-400 hover:text-blue-600"
              title="展開完整清單"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
        {renderTable('max-h-48')}
      </div>

      {/* Full modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">K8s Pods</span>
                <span className="text-sm text-slate-400">({filtered.length})</span>
              </div>
              <div className="flex items-center gap-2">
                {nsSelect}
                <button onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X size={16} />
                </button>
              </div>
            </div>
            {renderTable('flex-1')}
          </div>
        </div>
      )}
    </>
  )
}
