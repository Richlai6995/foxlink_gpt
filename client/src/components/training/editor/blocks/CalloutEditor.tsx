import type { Block } from '../SlideEditor'

const VARIANTS = [
  { value: 'tip', label: '提示', color: '#38bdf8' },
  { value: 'warning', label: '警告', color: '#fbbf24' },
  { value: 'note', label: '注意', color: '#a78bfa' },
  { value: 'important', label: '重要', color: '#f87171' },
]

interface Props {
  block: Block
  onChange: (b: Block) => void
}

export default function CalloutEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--t-text-secondary)' }}>提示框 Block</h3>

      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>類型</label>
        <div className="flex gap-2">
          {VARIANTS.map(v => (
            <button
              key={v.value}
              onClick={() => onChange({ ...block, variant: v.value })}
              className="px-3 py-1.5 rounded text-xs font-medium transition border"
              style={{
                borderColor: block.variant === v.value ? v.color : 'var(--t-border)',
                backgroundColor: block.variant === v.value ? v.color + '20' : 'transparent',
                color: block.variant === v.value ? v.color : 'var(--t-text-muted)'
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>內容</label>
        <textarea
          value={block.content || ''}
          onChange={e => onChange({ ...block, content: e.target.value })}
          rows={4}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-y"
          style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
          placeholder="提示內容..."
        />
      </div>
    </div>
  )
}
