import { useEffect, useState } from 'react'
import { X, Search, Database, ShieldAlert, Play, AlertTriangle } from 'lucide-react'
import api from '../../lib/api'
import type { ErpTool } from '../admin/ErpToolsPanel'

interface Props {
  onPick: (tool: ErpTool) => void
  onClose: () => void
}

export default function ErpToolPicker({ onPick, onClose }: Props) {
  const [tools, setTools] = useState<ErpTool[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    setLoading(true)
    api.get('/erp-tools/my/list')
      .then(r => setTools(r.data || []))
      .catch(e => setError(e.response?.data?.error || '載入失敗'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = q.trim()
    ? tools.filter(t =>
        t.name.toLowerCase().includes(q.toLowerCase()) ||
        t.code.toLowerCase().includes(q.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(q.toLowerCase())
      )
    : tools

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[55] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-4 py-2.5 border-b flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
            <Database size={14} /> 選擇 ERP 工具
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={15} />
          </button>
        </div>

        <div className="px-4 py-2 border-b">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="搜尋工具名稱 / code / 描述"
              className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-slate-400 text-sm py-8 text-center">載入中…</div>
          ) : error ? (
            <div className="m-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={12} /> {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-slate-400 text-sm py-10 text-center">
              {tools.length === 0 ? '您沒有可使用的 ERP 工具' : '無符合結果'}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map(t => (
                <button
                  key={t.id}
                  onClick={() => onPick(t)}
                  className="w-full text-left px-4 py-2.5 hover:bg-sky-50 transition"
                >
                  <div className="flex items-start gap-2">
                    <Play size={12} className="mt-1 text-sky-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-800">{t.name}</span>
                        <span className="font-mono text-[10px] text-slate-500">{t.code}</span>
                        {t.access_mode === 'WRITE' && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-50 text-red-700 border border-red-200 flex items-center gap-1">
                            <ShieldAlert size={9} /> WRITE
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.description}</div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
