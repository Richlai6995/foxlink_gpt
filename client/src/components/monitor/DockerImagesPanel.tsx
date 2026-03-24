import { useState } from 'react'
import { Package, Trash2 } from 'lucide-react'
import api from '../../lib/api'

interface DockerImage {
  Repository: string
  Tag: string
  ID: string
  Size: string
  CreatedAt: string
}

interface Props {
  images: DockerImage[]
  loading: boolean
  onRefresh: () => void
}

export default function DockerImagesPanel({ images, loading, onRefresh }: Props) {
  const [pruning, setPruning] = useState(false)

  const doPrune = async () => {
    if (!confirm('確定要清理無用的 Docker Images (dangling)?')) return
    setPruning(true)
    try {
      await api.post('/monitor/images/prune')
      onRefresh()
    } catch (e: unknown) {
      alert((e as Error).message || 'Prune failed')
    } finally {
      setPruning(false)
    }
  }

  const hasDangling = images.some(i => i.Repository === '<none>')

  if (loading) return <div className="animate-pulse h-32 bg-white border rounded-lg" />

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
        <Package size={14} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-700">Docker Images</span>
        <span className="text-xs text-slate-400">({images.length})</span>
        {hasDangling && (
          <button
            onClick={doPrune}
            disabled={pruning}
            className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            <Trash2 size={12} />
            {pruning ? '清理中...' : '清理無用 Image'}
          </button>
        )}
      </div>
      <div className="max-h-48 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Repository</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Tag</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Size</th>
              <th className="text-left px-3 py-1.5 text-slate-500 font-medium">ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {images.map(img => (
              <tr key={img.ID} className={`hover:bg-slate-50 ${img.Repository === '<none>' ? 'bg-orange-50' : ''}`}>
                <td className="px-3 py-1.5 font-mono">
                  {img.Repository}
                  {img.Repository === '<none>' && (
                    <span className="ml-1 text-orange-500 text-[10px]">dangling</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-500">{img.Tag}</td>
                <td className="px-3 py-1.5 text-slate-500">{img.Size}</td>
                <td className="px-3 py-1.5 text-slate-400 font-mono text-[10px]">{img.ID?.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {images.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-6">No images</div>
        )}
      </div>
    </div>
  )
}
