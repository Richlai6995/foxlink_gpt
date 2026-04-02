import { Plus, Trash2, GitBranch } from 'lucide-react'
import type { Block } from '../SlideEditor'

interface BranchOption {
  text: string
  target_slide_id: number | null
  is_best: boolean
}

interface Props {
  block: Block
  onChange: (b: Block) => void
}

export default function BranchEditor({ block, onChange }: Props) {
  const options: BranchOption[] = block.options || []

  const updateOption = (idx: number, field: string, value: any) => {
    const newOpts = options.map((o, i) => i === idx ? { ...o, [field]: value } : o)
    onChange({ ...block, options: newOpts })
  }

  const addOption = () => {
    onChange({ ...block, options: [...options, { text: '', target_slide_id: null, is_best: false }] })
  }

  const removeOption = (idx: number) => {
    onChange({ ...block, options: options.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <GitBranch size={14} className="text-green-400" /> 分支選擇 Block
      </h3>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">情境描述</label>
        <textarea
          value={block.scenario || ''}
          onChange={e => onChange({ ...block, scenario: e.target.value })}
          rows={3}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-y"
          placeholder="描述一個情境讓學員做選擇..."
        />
      </div>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">情境圖片 URL（選填）</label>
        <input
          value={block.image || ''}
          onChange={e => onChange({ ...block, image: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-sky-500"
          placeholder="/uploads/..."
        />
      </div>

      {/* Options */}
      <div>
        <label className="text-xs text-slate-400 font-medium mb-2 block">選項</label>
        {options.map((opt, idx) => (
          <div key={idx} className="bg-slate-800 border border-slate-700 rounded-lg p-3 mb-2 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                opt.is_best ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
              }`}>
                {String.fromCharCode(65 + idx)}
              </span>
              <input
                value={opt.text}
                onChange={e => updateOption(idx, 'text', e.target.value)}
                className="flex-1 bg-slate-850 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-500"
                placeholder={`選項 ${String.fromCharCode(65 + idx)}`}
              />
              <button onClick={() => removeOption(idx)} className="text-slate-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
            <div className="flex items-center gap-4 pl-8">
              <label className="flex items-center gap-1.5 text-[10px]">
                <input
                  type="checkbox"
                  checked={opt.is_best}
                  onChange={e => updateOption(idx, 'is_best', e.target.checked)}
                  className="rounded"
                />
                <span className={opt.is_best ? 'text-green-400' : 'text-slate-500'}>最佳選項</span>
              </label>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-500">跳轉投影片 ID:</span>
                <input
                  type="number"
                  value={opt.target_slide_id || ''}
                  onChange={e => updateOption(idx, 'target_slide_id', e.target.value ? Number(e.target.value) : null)}
                  className="w-20 bg-slate-850 border border-slate-700 rounded px-1.5 py-0.5 text-[10px]"
                  placeholder="留空=繼續"
                />
              </div>
            </div>
          </div>
        ))}

        <button onClick={addOption}
          className="w-full border border-dashed border-slate-700 rounded-lg py-2 text-xs text-slate-400 hover:text-green-400 hover:border-green-500 transition">
          <Plus size={12} className="inline mr-1" /> 新增選項
        </button>
      </div>
    </div>
  )
}
