import { useState, useEffect, useRef } from 'react'
import { Search, FileText, FileSpreadsheet, File, X } from 'lucide-react'
import api from '../../lib/api'
import { DocTemplate } from '../../types'

interface Props {
  onSelect: (template: DocTemplate) => void
  onClose: () => void
}

function FormatIcon({ format }: { format: string }) {
  const cls = 'shrink-0'
  if (format === 'xlsx') return <FileSpreadsheet size={14} className={`${cls} text-green-600`} />
  if (format === 'pdf')  return <File size={14} className={`${cls} text-red-500`} />
  return <FileText size={14} className={`${cls} text-blue-600`} />
}

export default function TemplatePickerPopover({ onSelect, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [all, setAll] = useState<DocTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get('/doc-templates').then(({ data }) => setAll(data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const filtered = all.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description || '').toLowerCase().includes(search.toLowerCase())
  )

  const mine = filtered.filter(t => t.access_level === 'owner')
  const shared = filtered.filter(t => t.access_level === 'edit' || t.access_level === 'use')

  const Row = ({ t }: { t: DocTemplate }) => (
    <button
      onClick={() => onSelect(t)}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-blue-50 text-left"
    >
      <FormatIcon format={t.format} />
      <div className="flex-1 min-w-0">
        <div className="truncate">{t.name}</div>
        {t.creator_name && t.access_level !== 'owner' && (
          <div className="text-slate-400 truncate">by {t.creator_name}</div>
        )}
      </div>
      <span className="text-slate-400 shrink-0">{t.use_count}次</span>
    </button>
  )

  return (
    <div ref={ref} className="absolute bottom-full mb-2 left-0 w-72 bg-white border rounded-lg shadow-lg z-40 overflow-hidden">
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <Search size={13} className="text-slate-400" />
        <input
          autoFocus
          className="flex-1 text-xs outline-none"
          placeholder="搜尋範本..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button onClick={onClose}><X size={13} className="text-slate-400" /></button>
      </div>

      <div className="max-h-72 overflow-auto">
        {loading && <div className="text-xs text-slate-400 px-3 py-3">載入中...</div>}
        {!loading && filtered.length === 0 && (
          <div className="text-xs text-slate-400 px-3 py-3">找不到範本</div>
        )}

        {mine.length > 0 && (
          <>
            <div className="px-3 py-1 text-xs font-medium text-slate-500 bg-slate-50">我的範本</div>
            {mine.map(t => <Row key={t.id} t={t} />)}
          </>
        )}

        {shared.length > 0 && (
          <>
            <div className="px-3 py-1 text-xs font-medium text-slate-500 bg-slate-50">分享給我 / 公開</div>
            {shared.map(t => <Row key={t.id} t={t} />)}
          </>
        )}
      </div>

      <div className="border-t px-3 py-2">
        <a href="/templates" className="text-xs text-blue-500 hover:text-blue-700">管理範本 →</a>
      </div>
    </div>
  )
}
