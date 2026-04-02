import { Plus, Trash2, CheckCircle2 } from 'lucide-react'
import type { Block } from '../SlideEditor'

interface QuizOption {
  text: string
  correct: boolean
}

interface Props {
  block: Block
  onChange: (b: Block) => void
}

const QUESTION_TYPES = [
  { value: 'single_choice', label: '單選題' },
  { value: 'multi_choice', label: '多選題' },
  { value: 'fill_blank', label: '填空題' },
]

export default function QuizInlineEditor({ block, onChange }: Props) {
  const options: QuizOption[] = block.options || []
  const questionType = block.question_type || 'single_choice'

  const updateOption = (idx: number, field: string, value: any) => {
    let newOpts = options.map((o, i) => i === idx ? { ...o, [field]: value } : o)
    // For single_choice, only one correct
    if (field === 'correct' && value === true && questionType === 'single_choice') {
      newOpts = newOpts.map((o, i) => ({ ...o, correct: i === idx }))
    }
    onChange({ ...block, options: newOpts })
  }

  const addOption = () => {
    onChange({ ...block, options: [...options, { text: '', correct: false }] })
  }

  const removeOption = (idx: number) => {
    onChange({ ...block, options: options.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <CheckCircle2 size={14} className="text-blue-400" /> 內嵌測驗 Block
      </h3>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">題型</label>
        <div className="flex gap-2">
          {QUESTION_TYPES.map(qt => (
            <button key={qt.value}
              onClick={() => onChange({ ...block, question_type: qt.value })}
              className={`px-3 py-1.5 rounded text-xs transition ${
                questionType === qt.value ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {qt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">題目</label>
        <textarea
          value={block.question || ''}
          onChange={e => onChange({ ...block, question: e.target.value })}
          rows={2}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-y"
          placeholder="請問以下哪個選項是正確的？"
        />
      </div>

      {/* Options (for choice types) */}
      {(questionType === 'single_choice' || questionType === 'multi_choice') && (
        <div>
          <label className="text-xs text-slate-400 font-medium mb-2 block">選項</label>
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-1.5">
              <button
                onClick={() => updateOption(idx, 'correct', !opt.correct)}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition ${
                  opt.correct
                    ? 'border-green-400 bg-green-400/20 text-green-400'
                    : 'border-slate-600 text-transparent hover:border-slate-400'
                }`}
              >
                {opt.correct && <CheckCircle2 size={12} />}
              </button>
              <input
                value={opt.text}
                onChange={e => updateOption(idx, 'text', e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-sky-500"
                placeholder={`選項 ${String.fromCharCode(65 + idx)}`}
              />
              <button onClick={() => removeOption(idx)} className="text-slate-500 hover:text-red-400">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button onClick={addOption}
            className="text-[10px] text-sky-400 hover:text-sky-300 mt-1">
            <Plus size={10} className="inline" /> 新增選項
          </button>
        </div>
      )}

      {/* Fill blank */}
      {questionType === 'fill_blank' && (
        <div>
          <label className="text-xs text-slate-500 mb-1 block">正確答案（可多個，以逗號分隔）</label>
          <input
            value={(block.correct_answers || []).join(', ')}
            onChange={e => onChange({ ...block, correct_answers: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-sky-500"
            placeholder="答案1, 答案2"
          />
        </div>
      )}

      <div>
        <label className="text-xs text-slate-500 mb-1 block">答案解析</label>
        <textarea
          value={block.explanation || ''}
          onChange={e => onChange({ ...block, explanation: e.target.value })}
          rows={2}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-500 resize-y"
          placeholder="解釋為什麼這是正確答案..."
        />
      </div>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">配分</label>
        <input type="number" value={block.points || 10}
          onChange={e => onChange({ ...block, points: Number(e.target.value) })}
          className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs" />
      </div>
    </div>
  )
}
