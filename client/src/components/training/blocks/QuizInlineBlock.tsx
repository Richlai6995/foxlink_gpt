import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

export default function QuizInlineBlock({ block }: { block: any }) {
  const questionType = block.question_type || 'single_choice'
  const options: { text: string; correct: boolean }[] = block.options || []
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [fillAnswer, setFillAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)

  const toggleOption = (idx: number) => {
    if (submitted) return
    if (questionType === 'single_choice') {
      setSelected(new Set([idx]))
    } else {
      const next = new Set(selected)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      setSelected(next)
    }
  }

  const submit = () => {
    setSubmitted(true)
    if (questionType === 'fill_blank') {
      const answers: string[] = block.correct_answers || []
      setIsCorrect(answers.some(a => a.toLowerCase().trim() === fillAnswer.toLowerCase().trim()))
    } else {
      const correctSet = new Set(options.map((o, i) => o.correct ? i : -1).filter(i => i >= 0))
      setIsCorrect(
        selected.size === correctSet.size &&
        [...selected].every(i => correctSet.has(i))
      )
    }
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
      <p className="text-sm font-medium">{block.question}</p>

      {(questionType === 'single_choice' || questionType === 'multi_choice') && (
        <div className="space-y-1.5">
          {options.map((opt, idx) => (
            <button key={idx} onClick={() => toggleOption(idx)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border transition ${
                submitted
                  ? opt.correct
                    ? 'border-green-500 bg-green-500/10'
                    : selected.has(idx)
                      ? 'border-red-500 bg-red-500/10'
                      : 'border-slate-700'
                  : selected.has(idx)
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] shrink-0 ${
                selected.has(idx) ? 'border-sky-400 bg-sky-400/20' : 'border-slate-600'
              }`}>
                {selected.has(idx) && '●'}
              </span>
              <span className="text-sm">{opt.text}</span>
              {submitted && opt.correct && <CheckCircle2 size={14} className="ml-auto text-green-400" />}
            </button>
          ))}
        </div>
      )}

      {questionType === 'fill_blank' && (
        <input
          value={fillAnswer}
          onChange={e => setFillAnswer(e.target.value)}
          disabled={submitted}
          className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500 disabled:opacity-60"
          placeholder="輸入答案..."
        />
      )}

      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={submitted}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50">
          {submitted ? '已作答' : '確認答案'}
        </button>
        {submitted && (
          <span className={`text-sm font-medium ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
            {isCorrect ? '✓ 正確' : '✗ 錯誤'}
          </span>
        )}
        {submitted && block.explanation && (
          <span className="text-xs text-slate-400">— {block.explanation}</span>
        )}
      </div>
      {block.points && <div className="text-[10px] text-slate-600">配分: {block.points} 分</div>}
    </div>
  )
}
