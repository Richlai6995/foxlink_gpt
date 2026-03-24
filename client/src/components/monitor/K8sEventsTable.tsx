import { useState, useCallback } from 'react'
import { Download } from 'lucide-react'

interface K8sEvent {
  metadata: { name: string; namespace: string; creationTimestamp: string }
  type: string
  reason: string
  message: string
  involvedObject: { kind: string; name: string }
  count: number
  lastTimestamp: string
}

interface Props {
  events: K8sEvent[]
  loading: boolean
}

export default function K8sEventsTable({ events, loading }: Props) {
  const [showWarningOnly, setShowWarningOnly] = useState(true)

  const filtered = showWarningOnly ? events.filter(e => e.type === 'Warning') : events

  const exportCsv = useCallback(() => {
    const BOM = '\uFEFF'
    const headers = ['Type', 'Namespace', 'Reason', 'Object', 'Message', 'Count', 'Last Seen']
    const rows = filtered.map(e => [
      e.type,
      e.metadata?.namespace || '',
      e.reason,
      `${e.involvedObject?.kind}/${e.involvedObject?.name}`,
      (e.message || '').replace(/"/g, '""'),
      String(e.count || ''),
      e.lastTimestamp ? new Date(e.lastTimestamp).toLocaleString() : '',
    ])
    const csv = BOM + [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `k8s_events_${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  if (loading) return <div className="animate-pulse h-32 bg-white border rounded-lg" />

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">K8s Events</span>
        <span className="text-xs text-slate-400">({filtered.length})</span>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition"
            title="匯出 CSV"
          >
            <Download size={13} />
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showWarningOnly}
              onChange={e => setShowWarningOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            Warning only
          </label>
        </div>
      </div>
      <div className="max-h-48 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Type</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Reason</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Object</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Message</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Count</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Last Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.slice(0, 100).map((e, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className={`px-3 py-1.5 font-medium ${e.type === 'Warning' ? 'text-red-600' : 'text-slate-400'}`}>
                  {e.type}
                </td>
                <td className="px-3 py-1.5 text-slate-600">{e.reason}</td>
                <td className="px-3 py-1.5 text-slate-500 font-mono text-[10px]">
                  {e.involvedObject?.kind}/{e.involvedObject?.name}
                </td>
                <td className="px-3 py-1.5 text-slate-600 truncate max-w-[300px]" title={e.message}>
                  {e.message}
                </td>
                <td className="px-3 py-1.5 text-slate-500">{e.count}</td>
                <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">
                  {e.lastTimestamp ? new Date(e.lastTimestamp).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-6">No events</div>
        )}
      </div>
    </div>
  )
}
