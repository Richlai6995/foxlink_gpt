import { Plus, Trash2 } from 'lucide-react'
import type { Block } from '../SlideEditor'

interface Props {
  block: Block
  onChange: (b: Block) => void
}

export default function StepsEditor({ block, onChange }: Props) {
  const items: { title: string; desc: string; image?: string }[] = block.items || []

  const update = (idx: number, field: string, value: string) => {
    const newItems = items.map((item, i) => i === idx ? { ...item, [field]: value } : item)
    onChange({ ...block, items: newItems })
  }

  const add = () => onChange({ ...block, items: [...items, { title: `步驟 ${items.length + 1}`, desc: '' }] })
  const remove = (idx: number) => onChange({ ...block, items: items.filter((_, i) => i !== idx) })

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--t-text-secondary)' }}>步驟 Block</h3>

      {items.map((item, idx) => (
        <div key={idx} className="border rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border)' }}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
              {idx + 1}
            </div>
            <input
              value={item.title}
              onChange={e => update(idx, 'title', e.target.value)}
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none px-2 py-0.5 rounded"
              style={{ color: 'var(--t-text)' }}
              placeholder="步驟標題"
            />
            <button onClick={() => remove(idx)} className="text-red-400 hover:text-red-300 opacity-60">
              <Trash2 size={12} />
            </button>
          </div>
          <textarea
            value={item.desc}
            onChange={e => update(idx, 'desc', e.target.value)}
            rows={2}
            className="w-full border rounded px-2 py-1.5 text-xs resize-none focus:outline-none"
            style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
            placeholder="步驟說明..."
          />
        </div>
      ))}

      <button onClick={add}
        className="w-full border border-dashed rounded-lg py-2 text-xs transition hover:opacity-80"
        style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
        <Plus size={12} className="inline mr-1" /> 新增步驟
      </button>
    </div>
  )
}
