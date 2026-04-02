import { Plus, Trash2, RotateCcw } from 'lucide-react'
import type { Block } from '../SlideEditor'

interface Card {
  front: { text: string; image?: string | null }
  back: { text: string; image?: string | null }
}

interface Props {
  block: Block
  onChange: (b: Block) => void
}

export default function FlipCardEditor({ block, onChange }: Props) {
  const cards: Card[] = block.cards || []

  const updateCard = (idx: number, side: 'front' | 'back', field: string, value: string) => {
    const newCards = cards.map((c, i) =>
      i === idx ? { ...c, [side]: { ...c[side], [field]: value } } : c
    )
    onChange({ ...block, cards: newCards })
  }

  const addCard = () => {
    onChange({ ...block, cards: [...cards, { front: { text: '' }, back: { text: '' } }] })
  }

  const removeCard = (idx: number) => {
    onChange({ ...block, cards: cards.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <RotateCcw size={14} className="text-amber-400" /> 翻轉卡片 Block
      </h3>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">操作指引</label>
        <input
          value={block.instruction || ''}
          onChange={e => onChange({ ...block, instruction: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-sky-500"
          placeholder="點擊卡片翻轉查看答案"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">版面</label>
          <select value={block.layout || 'grid'}
            onChange={e => onChange({ ...block, layout: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs">
            <option value="grid">網格</option>
            <option value="carousel">輪播</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">欄數</label>
          <input type="number" min={1} max={4} value={block.columns || 2}
            onChange={e => onChange({ ...block, columns: Number(e.target.value) })}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs" />
        </div>
      </div>

      {/* Card list */}
      <div className="space-y-3">
        {cards.map((card, idx) => (
          <div key={idx} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-400">卡片 {idx + 1}</span>
              <button onClick={() => removeCard(idx)} className="text-slate-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">正面</label>
                <textarea
                  value={card.front.text}
                  onChange={e => updateCard(idx, 'front', 'text', e.target.value)}
                  rows={3}
                  className="w-full bg-slate-850 border border-slate-700 rounded px-2 py-1.5 text-xs resize-none focus:outline-none focus:border-sky-500"
                  placeholder="問題或提示..."
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">反面</label>
                <textarea
                  value={card.back.text}
                  onChange={e => updateCard(idx, 'back', 'text', e.target.value)}
                  rows={3}
                  className="w-full bg-slate-850 border border-slate-700 rounded px-2 py-1.5 text-xs resize-none focus:outline-none focus:border-sky-500"
                  placeholder="答案或說明..."
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addCard}
        className="w-full border border-dashed border-slate-700 rounded-lg py-2 text-xs text-slate-400 hover:text-amber-400 hover:border-amber-500 transition">
        <Plus size={12} className="inline mr-1" /> 新增卡片
      </button>
    </div>
  )
}
