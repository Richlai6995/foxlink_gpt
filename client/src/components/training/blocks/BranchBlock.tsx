import { useState } from 'react'

export default function BranchBlock({ block }: { block: any }) {
  const [selected, setSelected] = useState<number | null>(null)
  const options: { text: string; is_best: boolean; target_slide_id: number | null }[] = block.options || []

  return (
    <div className="space-y-4">
      {block.image && <img src={block.image} alt="" className="max-w-full rounded-lg" />}
      {block.scenario && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="text-sm">{block.scenario}</p>
        </div>
      )}
      <div className="space-y-2">
        {options.map((opt, idx) => (
          <button key={idx}
            onClick={() => setSelected(idx)}
            className={`w-full text-left px-4 py-3 rounded-lg border transition ${
              selected === idx
                ? opt.is_best
                  ? 'border-green-500 bg-green-500/10 text-green-200'
                  : 'border-yellow-500 bg-yellow-500/10 text-yellow-200'
                : 'border-slate-700 bg-slate-800 hover:border-slate-600 text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">
                {String.fromCharCode(65 + idx)}
              </span>
              <span className="text-sm">{opt.text}</span>
              {selected === idx && opt.is_best && <span className="ml-auto text-green-400 text-xs font-medium">✓ 最佳選擇</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
