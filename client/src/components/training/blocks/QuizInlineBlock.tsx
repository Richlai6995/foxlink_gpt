import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'

interface QuizInlineResult {
  block_type: string
  block_index: number
  player_mode: string
  question_type: string
  user_answer: any
  correct_answer: any
  points: number
  total_time_seconds: number
}

export default function QuizInlineBlock({ block, blockIndex = 0, playerMode = 'learn', onInteractionComplete }: {
  block: any
  blockIndex?: number
  playerMode?: string
  onInteractionComplete?: (result: QuizInlineResult) => void
}) {
  const { t } = useTranslation()
  const questionType = block.question_type || 'single_choice'
  const options: { text: string; correct: boolean }[] = block.options || []
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [fillAnswer, setFillAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const startTimeRef = useRef<number>(Date.now())

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
    let correct = false
    if (questionType === 'fill_blank') {
      const answers: string[] = block.correct_answers || []
      correct = answers.some(a => a.toLowerCase().trim() === fillAnswer.toLowerCase().trim())
    } else {
      const correctSet = new Set(options.map((o, i) => o.correct ? i : -1).filter(i => i >= 0))
      correct = selected.size === correctSet.size && [...selected].every(i => correctSet.has(i))
    }
    setIsCorrect(correct)

    // Fire interaction complete
    const totalTime = Math.round((Date.now() - startTimeRef.current) / 1000)
    const qType = questionType === 'single_choice' ? 'single' : questionType === 'multi_choice' ? 'multi' : 'fill_blank'
    const userAnswer = questionType === 'fill_blank' ? fillAnswer : [...selected]
    const correctAnswer = questionType === 'fill_blank'
      ? (block.correct_answers || [])
      : options.map((o, i) => o.correct ? i : -1).filter(i => i >= 0)
    onInteractionComplete?.({
      block_type: 'quiz_inline',
      block_index: blockIndex,
      player_mode: playerMode,
      question_type: qType,
      user_answer: userAnswer,
      correct_answer: correctAnswer,
      points: block.points || 10,
      total_time_seconds: totalTime
    })
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
          placeholder={t('training.inputAnswer')}
        />
      )}

      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={submitted}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50">
          {submitted ? t('training.answered') : t('training.confirmAnswer')}
        </button>
        {submitted && (
          <span className={`text-sm font-medium ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>
            {isCorrect ? t('training.answerCorrect') : t('training.answerWrong')}
          </span>
        )}
        {submitted && block.explanation && (
          <span className="text-xs text-slate-400">— {block.explanation}</span>
        )}
      </div>
      {block.points && <div className="text-[10px] text-slate-600">{t('training.points')} {block.points}</div>}
    </div>
  )
}
