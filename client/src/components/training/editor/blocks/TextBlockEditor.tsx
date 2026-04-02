import type { Block } from '../SlideEditor'

interface Props {
  block: Block
  onChange: (b: Block) => void
}

export default function TextBlockEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--t-text-secondary)' }}>文字 Block</h3>
      <p className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>支援 Markdown 格式：**粗體**、*斜體*、# 標題、- 列表、| 表格</p>
      <textarea
        value={block.content || ''}
        onChange={e => onChange({ ...block, content: e.target.value })}
        rows={16}
        className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none resize-y"
        style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
        placeholder="# 標題\n\n內容文字..."
      />
    </div>
  )
}
