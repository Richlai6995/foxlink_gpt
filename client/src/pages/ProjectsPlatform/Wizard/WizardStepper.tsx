/**
 * WizardStepper — 7 圓點 + 連接線進度條
 *
 * 對應 HTML demo renderWizard().stepperHtml
 */

import { Check } from 'lucide-react'

const STEPS = [
  { num: 1, label: '客戶來信' },
  { num: 2, label: '歷史參考' },
  { num: 3, label: '機密設定' },
  { num: 4, label: 'PM/Team' },
  { num: 5, label: '流程模板' },
  { num: 6, label: '重要緊急' },
  { num: 7, label: '確認啟動' },
] as const

type Props = {
  current: number
  onJump: (n: number) => void
}

export default function WizardStepper({ current, onJump }: Props) {
  return (
    <div className="flex items-start gap-0 px-4 py-4 border-b border-cortex-line bg-white">
      {STEPS.map((st, i) => {
        const isActive = current === st.num
        const isDone = current > st.num
        const isLast = i === STEPS.length - 1

        const circleClass = isActive
          ? 'bg-gradient-to-br from-cortex-cyan to-cortex-teal text-white border-2 border-cortex-cyan'
          : isDone
          ? 'bg-cortex-cyan text-white border-2 border-cortex-cyan'
          : 'bg-white text-cortex-muted border-2 border-cortex-line'

        const labelClass = isActive
          ? 'text-cortex-navy font-bold'
          : isDone
          ? 'text-cortex-teal font-semibold'
          : 'text-cortex-muted font-medium'

        return (
          <div key={st.num} className="flex items-start flex-1">
            <button
              onClick={() => onJump(st.num)}
              className="flex flex-col items-center gap-1 flex-shrink-0 w-20 cursor-pointer group"
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold font-mono transition-all ${circleClass} group-hover:scale-105`}
              >
                {isDone ? <Check size={14} strokeWidth={3} /> : st.num}
              </div>
              <div className={`text-[10px] mt-1 text-center leading-tight ${labelClass}`}>
                {st.label}
              </div>
            </button>
            {!isLast && (
              <div className={`flex-1 h-[2px] mt-4 -mx-2 ${current > st.num ? 'bg-cortex-cyan' : 'bg-cortex-line'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
