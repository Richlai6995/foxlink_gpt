import { useState } from 'react'

interface Region {
  id: string
  shape: string
  coords: { x: number; y: number; w: number; h: number }
  correct: boolean
  feedback: string
}

export default function HotspotBlock({ block }: { block: any }) {
  const [attempts, setAttempts] = useState(0)
  const [feedback, setFeedback] = useState<{ text: string; correct: boolean } | null>(null)
  const [completed, setCompleted] = useState(false)
  const regions: Region[] = block.regions || []
  const maxAttempts = block.max_attempts || 3

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
      if (hit.correct) setCompleted(true)
    } else {
      setFeedback({ text: '沒有點到任何區域，請再試一次。', correct: false })
    }
  }

  return (
    <div className="space-y-3">
      {block.instruction && (
        <p className="text-sm font-medium text-sky-300">{block.instruction}</p>
      )}
      {block.image ? (
        <div className="relative cursor-crosshair select-none rounded-lg overflow-hidden border border-slate-700"
          onClick={handleClick}>
          <img src={block.image} alt="" className="w-full" draggable={false} />
          {/* Show correct region after completion */}
          {completed && regions.filter(r => r.correct).map(r => (
            <div key={r.id} className="absolute border-2 border-green-400 bg-green-400/20 rounded"
              style={{ left: `${r.coords.x}%`, top: `${r.coords.y}%`, width: `${r.coords.w}%`, height: `${r.coords.h}%` }} />
          ))}
          {/* Show hint after N attempts */}
          {!completed && attempts >= (block.show_hint_after || 2) && regions.filter(r => r.correct).map(r => (
            <div key={r.id} className="absolute border-2 border-yellow-400/50 border-dashed rounded animate-pulse"
              style={{ left: `${r.coords.x}%`, top: `${r.coords.y}%`, width: `${r.coords.w}%`, height: `${r.coords.h}%` }} />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center text-slate-600 border border-dashed border-slate-700 rounded-lg">圖片未設定</div>
      )}

      {feedback && (
        <div className={`text-sm px-4 py-2 rounded-lg ${feedback.correct ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
          {feedback.text}
        </div>
      )}
      <div className="text-[10px] text-slate-500">嘗試次數: {attempts}/{maxAttempts}</div>
    </div>
  )
}
