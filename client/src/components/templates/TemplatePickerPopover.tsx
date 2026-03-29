import { useState, useEffect, useRef } from 'react'
import { Search, FileText, FileSpreadsheet, File, X, GripVertical, Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
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

function applyTplOrder(items: DocTemplate[], order: string[]): DocTemplate[] {
  const map = new Map(items.map(i => [i.id, i]))
  const sorted = order.map(id => map.get(id)).filter(Boolean) as DocTemplate[]
  const rest = items.filter(i => !order.includes(i.id))
  return [...sorted, ...rest]
}
function reorderTpl<T>(arr: T[], from: number, to: number): T[] {
  const a = [...arr]; const [it] = a.splice(from, 1); a.splice(to, 0, it); return a
}

export default function TemplatePickerPopover({ onSelect, onClose }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const uid = (user as any)?.id ?? 'guest'
  const orderKey  = `fl_tpl_order_${uid}`
  const hiddenKey = `fl_tpl_hidden_${uid}`

  const [search,  setSearch]  = useState('')
  const [all,     setAll]     = useState<DocTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [order,   setOrder]   = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(orderKey) || '[]') } catch { return [] } })
  const [hidden,  setHidden]  = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]')) } catch { return new Set() } })
  const dragSrc = useRef<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get('/doc-templates').then(({ data }) => setAll(data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    localStorage.setItem(orderKey,  JSON.stringify(order))
    localStorage.setItem(hiddenKey, JSON.stringify([...hidden]))
  }, [order, hidden, orderKey, hiddenKey])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const base = applyTplOrder(all, order)
  const q = search.toLowerCase()
  const matchFn = (tp: DocTemplate) => !q || tp.name.toLowerCase().includes(q) || (tp.description || '').toLowerCase().includes(q)

  const Section = ({ label, items }: { label: string; items: DocTemplate[] }) => {
    const vis = items.filter(tp => !hidden.has(tp.id) && matchFn(tp))
    const hid = items.filter(tp =>  hidden.has(tp.id) && matchFn(tp))
    if (vis.length === 0 && hid.length === 0) return null
    return (
      <>
        <div className="px-3 py-1 text-xs font-medium text-slate-500 bg-slate-50">{label}</div>
        {vis.map(tp => (
          <div key={tp.id} draggable={!q}
            onDragStart={() => { dragSrc.current = tp.id }}
            onDragOver={e => e.preventDefault()}
            onDrop={() => {
              if (dragSrc.current == null || dragSrc.current === tp.id) return
              const ids = applyTplOrder(all, order).map(x => x.id)
              const f = ids.indexOf(dragSrc.current!); const tt = ids.indexOf(tp.id)
              if (f !== -1 && tt !== -1) setOrder(reorderTpl(ids, f, tt))
              dragSrc.current = null
            }}
            className="group flex items-center gap-1 hover:bg-blue-50"
          >
            {!q && <GripVertical size={13} className="text-slate-300 cursor-grab ml-2 flex-shrink-0" />}
            <button onClick={() => onSelect(tp)} className="flex-1 flex items-center gap-2 px-2 py-2 text-xs text-left min-w-0">
              <FormatIcon format={tp.format} />
              <div className="flex-1 min-w-0 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                <div className="whitespace-nowrap">{tp.name}</div>
                {tp.creator_name && tp.access_level !== 'owner' && (
                  <div className="text-slate-400 whitespace-nowrap">by {tp.creator_name}</div>
                )}
              </div>
              <span className="text-slate-400 shrink-0 ml-1">{t('tpl.picker.times', { count: tp.use_count })}</span>
            </button>
            <button
              onClick={() => setHidden(prev => { const n = new Set(prev); n.add(tp.id); return n })}
              className="mr-2 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 bg-blue-500 hover:bg-blue-700 text-white transition-all opacity-0 group-hover:opacity-100"
              title={t('tpl.picker.hide')}
            >
              <EyeOff size={9} />
            </button>
          </div>
        ))}
        {hid.length > 0 && (
          <>
            <div className="px-3 pt-1.5 pb-0.5 text-xs text-slate-400 border-t border-slate-100">{t('tpl.picker.hidden')} ({hid.length})</div>
            {hid.map(tp => (
              <div key={tp.id} className="group flex items-center gap-1 opacity-40 hover:opacity-70 transition px-3 py-1.5">
                <div className="flex-1 flex items-center gap-2 text-xs min-w-0">
                  <FormatIcon format={tp.format} />
                  <span className="whitespace-nowrap text-slate-700">{tp.name}</span>
                </div>
                <button
                  onClick={() => setHidden(prev => { const n = new Set(prev); n.delete(tp.id); return n })}
                  className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 bg-blue-500 hover:bg-blue-700 text-white transition-all"
                  title={t('tpl.picker.unhide')}
                >
                  <Eye size={9} />
                </button>
              </div>
            ))}
          </>
        )}
      </>
    )
  }

  const mine   = base.filter(tp => tp.access_level === 'owner')
  const shared = base.filter(tp => tp.access_level === 'edit' || tp.access_level === 'use')

  return (
    <div ref={ref} className="absolute bottom-full mb-2 left-0 w-[520px] bg-white border rounded-lg shadow-lg z-40 overflow-hidden">
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <Search size={13} className="text-slate-400" />
        <input autoFocus className="flex-1 text-xs outline-none" placeholder={t('tpl.picker.searchPlaceholder')}
          value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={onClose}><X size={13} className="text-slate-400" /></button>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {loading && <div className="text-xs text-slate-400 px-3 py-3">{t('tpl.picker.loading')}</div>}
        {!loading && mine.length === 0 && shared.length === 0 && (
          <div className="text-xs text-slate-400 px-3 py-3">{t('tpl.picker.noResults')}</div>
        )}
        <Section label={t('tpl.picker.myTemplates')} items={mine} />
        <Section label={t('tpl.picker.sharedTemplates')} items={shared} />
      </div>

      <div className="border-t px-3 py-2">
        <a href="/templates" className="text-xs text-blue-500 hover:text-blue-700">{t('tpl.picker.manageTemplates')}</a>
      </div>
    </div>
  )
}
