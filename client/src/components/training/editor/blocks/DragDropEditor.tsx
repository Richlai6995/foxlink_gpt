import { Plus, Trash2, Move } from 'lucide-react'
import type { Block } from '../SlideEditor'

interface Props {
  block: Block
  onChange: (b: Block) => void
}

export default function DragDropEditor({ block, onChange }: Props) {
  const items: { id: string; content: string }[] = block.items || []
  const targets: { id: string; label: string; correct_item: string }[] = block.targets || []

  const addItem = () => {
    const id = `i${Date.now()}`
    onChange({ ...block, items: [...items, { id, content: '' }] })
  }

  const addTarget = () => {
    const id = `t${Date.now()}`
    onChange({ ...block, targets: [...targets, { id, label: '', correct_item: '' }] })
  }

  const updateItem = (idx: number, content: string) => {
    onChange({ ...block, items: items.map((it, i) => i === idx ? { ...it, content } : it) })
  }

  const updateTarget = (idx: number, field: string, value: string) => {
    onChange({ ...block, targets: targets.map((t, i) => i === idx ? { ...t, [field]: value } : t) })
  }

  const removeItem = (idx: number) => onChange({ ...block, items: items.filter((_, i) => i !== idx) })
  const removeTarget = (idx: number) => onChange({ ...block, targets: targets.filter((_, i) => i !== idx) })

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <Move size={14} className="text-purple-400" /> 拖放互動 Block
      </h3>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">模式</label>
        <div className="flex gap-2">
          {(['matching', 'ordering', 'categorize'] as const).map(m => (
            <button key={m} onClick={() => onChange({ ...block, mode: m })}
              className={`px-3 py-1.5 rounded text-xs transition ${
                block.mode === m ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {m === 'matching' ? '配對' : m === 'ordering' ? '排序' : '分類'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">操作指引</label>
        <input
          value={block.instruction || ''}
          onChange={e => onChange({ ...block, instruction: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-sky-500"
          placeholder="請將項目拖放到正確位置"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Draggable items */}
        <div>
          <label className="text-xs text-slate-400 font-medium mb-2 block">拖放項目</label>
          {items.map((item, idx) => (
            <div key={item.id} className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] text-slate-600 w-4">{item.id}</span>
              <input
                value={item.content}
                onChange={e => updateItem(idx, e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-500"
                placeholder={`項目 ${idx + 1}`}
              />
              <button onClick={() => removeItem(idx)} className="text-slate-500 hover:text-red-400">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button onClick={addItem}
            className="text-[10px] text-sky-400 hover:text-sky-300 mt-1">
            <Plus size={10} className="inline" /> 新增項目
          </button>
        </div>

        {/* Target zones (for matching mode) */}
        {block.mode !== 'ordering' && (
          <div>
            <label className="text-xs text-slate-400 font-medium mb-2 block">目標區域</label>
            {targets.map((target, idx) => (
              <div key={target.id} className="space-y-1 mb-2 bg-slate-800 rounded p-2">
                <input
                  value={target.label}
                  onChange={e => updateTarget(idx, 'label', e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-500"
                  placeholder="區域名稱"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={target.correct_item}
                    onChange={e => updateTarget(idx, 'correct_item', e.target.value)}
                    className="flex-1 bg-slate-850 border border-slate-700 rounded px-2 py-1 text-[10px]"
                  >
                    <option value="">-- 正確項目 --</option>
                    {items.map(it => (
                      <option key={it.id} value={it.id}>{it.content || it.id}</option>
                    ))}
                  </select>
                  <button onClick={() => removeTarget(idx)} className="text-slate-500 hover:text-red-400">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            <button onClick={addTarget}
              className="text-[10px] text-sky-400 hover:text-sky-300 mt-1">
              <Plus size={10} className="inline" /> 新增目標區域
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">正確回饋</label>
          <input value={block.feedback_correct || ''} onChange={e => onChange({ ...block, feedback_correct: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-500" />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">錯誤回饋</label>
          <input value={block.feedback_incorrect || ''} onChange={e => onChange({ ...block, feedback_incorrect: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-500" />
        </div>
      </div>
    </div>
  )
}
