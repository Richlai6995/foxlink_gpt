import { useState } from 'react'

interface Region {
  id: string
  shape: string
  coords: { x: number; y: number; w: number; h: number }
  correct: boolean
  feedback: string
  label?: string
  type?: string
}

export default function HotspotBlock({ block }: { block: any }) {
  const [attempts, setAttempts] = useState(0)
  const [feedback, setFeedback] = useState<{ text: string; correct: boolean } | null>(null)
  const [completed, setCompleted] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const regions: Region[] = block.regions || []
  const maxAttempts = block.max_attempts || 3
  const showHintAfter = block.show_hint_after || 2

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (completed) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    const hit = regions.find(r =>
      x >= r.coords.x && x <= r.coords.x + r.coords.w &&
      y >= r.coords.y && y <= r.coords.y + r.coords.h
    )

    setAttempts(prev => prev + 1)

    if (hit) {
      setFeedback({ text: hit.feedback || (hit.correct ? '正確！' : '再試一次'), correct: hit.correct })
      if (hit.correct) {
        setCompleted(true)
        setShowLabels(true)
      }
    } else {
      setFeedback({ text: '沒有點到任何區域，請再試一次。', correct: false })
    }
  }

  // After N wrong attempts, show hints
  const showHints = !completed && attempts >= showHintAfter

  return (
    <div className="space-y-3">
      {/* Instruction */}
      {block.instruction && (
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center text-sky-400 text-xs font-bold shrink-0">?</div>
          <p className="text-sm font-medium" style={{ color: 'var(--t-text)' }}>{block.instruction}</p>
        </div>
      )}

      {/* Screenshot with interactive regions */}
      {block.image ? (
        <div className="relative select-none rounded-lg overflow-hidden border"
          style={{ borderColor: 'var(--t-border)', cursor: completed ? 'default' : 'crosshair' }}
          onClick={handleClick}>
          <img src={block.image} alt="" className="w-full" draggable={false} />

          {/* Region overlays — visible labels + borders */}
          {regions.map((r, idx) => {
            const isCorrect = r.correct
            const showThisHint = showHints && isCorrect
            const isCompleteCorrect = completed && isCorrect

            return (
              <div key={r.id}>
                {/* Region border — always visible for correct after complete, hint mode, or labels mode */}
                <div
                  className="absolute transition-all duration-300"
                  style={{
                    left: `${r.coords.x}%`, top: `${r.coords.y}%`,
                    width: `${r.coords.w}%`, height: `${r.coords.h}%`,
                    border: isCompleteCorrect ? '3px solid #22c55e'
                      : showThisHint ? '2px dashed #facc15'
                      : showLabels && !completed ? '2px solid rgba(59,130,246,0.5)'
                      : 'none',
                    background: isCompleteCorrect ? 'rgba(34,197,94,0.15)'
                      : showThisHint ? 'rgba(250,204,21,0.1)'
                      : showLabels && !completed ? 'rgba(59,130,246,0.05)'
                      : 'transparent',
                    borderRadius: '4px',
                    pointerEvents: 'none',
                    zIndex: 2
                  }}
                >
                  {/* Label tag — numbered badge with element name */}
                  {(showLabels || showThisHint || isCompleteCorrect) && r.label && (
                    <div
                      className="absolute -top-6 left-0 flex items-center gap-1 whitespace-nowrap"
                      style={{ zIndex: 3 }}
                    >
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm"
                        style={{
                          backgroundColor: isCompleteCorrect ? '#22c55e'
                            : isCorrect ? '#3b82f6'
                            : '#64748b',
                          color: 'white'
                        }}>
                        {isCorrect ? '👆' : `${idx + 1}`} {r.label}
                      </span>
                      {r.type && (
                        <span className="text-[8px] px-1 py-0.5 rounded"
                          style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: 'white' }}>
                          {r.type}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Pulse animation for hint */}
                  {showThisHint && (
                    <div className="absolute inset-0 rounded border-2 border-yellow-400 animate-pulse" />
                  )}
                </div>

                {/* Connecting line + step number for correct region (when showing labels) */}
                {showLabels && isCorrect && !completed && (
                  <div className="absolute text-[9px] font-bold px-2 py-1 rounded-full shadow-lg animate-bounce"
                    style={{
                      left: `${r.coords.x + r.coords.w + 1}%`,
                      top: `${r.coords.y}%`,
                      backgroundColor: '#ef4444',
                      color: 'white',
                      zIndex: 4
                    }}>
                    👆 點這裡
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="py-16 text-center border border-dashed rounded-lg"
          style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}>
          圖片未設定
        </div>
      )}

      {/* Toggle labels button */}
      {!completed && regions.length > 0 && (
        <button onClick={() => setShowLabels(!showLabels)}
          className="text-[10px] px-2 py-1 rounded transition"
          style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
          {showLabels ? '🙈 隱藏標註（自己找）' : '👁 顯示標註'}
        </button>
      )}

      {/* Feedback */}
      {feedback && (
        <div className={`text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 ${
          feedback.correct ? 'bg-green-500/15 text-green-300 border border-green-500/30'
          : 'bg-red-500/15 text-red-300 border border-red-500/30'
        }`}>
          <span className="text-lg">{feedback.correct ? '✅' : '❌'}</span>
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Attempt counter */}
      <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--t-text-dim)' }}>
        <span>嘗試次數: {attempts}/{maxAttempts}</span>
        {completed && <span className="text-green-400 font-medium">✓ 操作完成</span>}
        {!completed && attempts >= maxAttempts && <span className="text-red-400">已達最大嘗試次數</span>}
      </div>
    </div>
  )
}
