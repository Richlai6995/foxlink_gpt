import { useState } from 'react'
import AnnotationOverlay from './AnnotationOverlay'
import type { Annotation } from './AnnotationOverlay'

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
  const [zoomed, setZoomed] = useState(false)
  const allRegions: Region[] = block.regions || []
  // Only show correct regions as interactive targets — don't display AI-detected non-correct clutter
  const regions = allRegions.filter(r => r.correct)
  // Don't render SVG annotations if they're already burned into the image
  const annotations: Annotation[] = block.annotations_in_image ? [] : (block.annotations || [])
  const maxAttempts = block.max_attempts || 3
  const showHintAfter = block.show_hint_after || 2

  // Phase 3A-1: Use coordinate_system field if available; fallback to heuristic for old data
  const isPixelCoords = block.coordinate_system === 'pixel' ||
    (!block.coordinate_system && allRegions.some(r => r.coords.x > 100 || r.coords.y > 100))
  const imgDim = block.image_dimensions
  const imgW = isPixelCoords ? (imgDim?.w || Math.max(...allRegions.map(r => r.coords.x + (r.coords.w || 0)), 200) * 1.05) : 100
  const imgH = isPixelCoords ? (imgDim?.h || Math.max(...allRegions.map(r => r.coords.y + (r.coords.h || 0)), 200) * 1.05) : 100
  const toPercent = (r: Region['coords']) => {
    if (!isPixelCoords) return r
    return { x: r.x / imgW * 100, y: r.y / imgH * 100, w: r.w / imgW * 100, h: r.h / imgH * 100 }
  }

  const correctRegion = regions[0]

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (completed) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    // Check ALL regions (including non-correct) for hit detection
    const hit = allRegions.find(r => {
      const c = toPercent(r.coords)
      return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h
    })

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

  const showHints = !completed && attempts >= showHintAfter

  // Region overlay renderer (shared by normal + zoom view)
  const renderRegions = () => regions.map((r, idx) => {
    const isCorrect = r.correct
    const showThisHint = showHints && isCorrect
    const isCompleteCorrect = completed && isCorrect
    const c = toPercent(r.coords)
    return (
      <div key={r.id}>
        <div className="absolute transition-all duration-300" style={{
          left: `${c.x}%`, top: `${c.y}%`,
          width: `${c.w}%`, height: `${c.h}%`,
          border: isCompleteCorrect ? '3px solid #22c55e'
            : showThisHint ? '2px dashed #facc15'
            : showLabels && !completed ? '2px solid rgba(59,130,246,0.5)' : 'none',
          background: isCompleteCorrect ? 'rgba(34,197,94,0.15)'
            : showThisHint ? 'rgba(250,204,21,0.1)'
            : showLabels && !completed ? 'rgba(59,130,246,0.05)' : 'transparent',
          borderRadius: '4px', pointerEvents: 'none', zIndex: 2
        }}>
          {(showLabels || showThisHint || isCompleteCorrect) && r.label && (
            <div className="absolute -top-6 left-0 flex items-center gap-1 whitespace-nowrap" style={{ zIndex: 3 }}>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm" style={{
                backgroundColor: isCompleteCorrect ? '#22c55e' : isCorrect ? '#3b82f6' : '#64748b', color: 'white'
              }}>
                {isCorrect ? '👆' : `${idx + 1}`} {r.label}
              </span>
              {r.type && (
                <span className="text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: 'white' }}>{r.type}</span>
              )}
            </div>
          )}
          {showThisHint && <div className="absolute inset-0 rounded border-2 border-yellow-400 animate-pulse" />}
        </div>
        {showLabels && isCorrect && !completed && (
          <div className="absolute text-[9px] font-bold px-2 py-1 rounded-full shadow-lg animate-bounce" style={{
            left: `${c.x + c.w + 1}%`, top: `${c.y}%`,
            backgroundColor: '#ef4444', color: 'white', zIndex: 4
          }}>👆 點這裡</div>
        )}
      </div>
    )
  })

  return (
    <>
      <div className="flex gap-5">
        {/* LEFT: Screenshot — takes most width */}
        <div className="flex-1 min-w-0">
          {block.image ? (
            <div className="relative select-none rounded-lg overflow-hidden border"
              style={{ borderColor: 'var(--t-border)', cursor: completed ? 'default' : 'crosshair' }}
              onClick={handleClick}>
              <img src={block.image} alt="" className="w-full block" draggable={false} />

              {annotations.length > 0 && (
                <AnnotationOverlay annotations={annotations} visible={showLabels || completed} animateInterval={600} />
              )}

              {renderRegions()}

              {/* Zoom button */}
              <button
                className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs transition opacity-60 hover:opacity-100"
                style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                title="放大檢視"
                onClick={(e) => { e.stopPropagation(); setZoomed(true) }}
              >🔍</button>
            </div>
          ) : (
            <div className="py-16 text-center border border-dashed rounded-lg"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}>
              圖片未設定
            </div>
          )}
        </div>

        {/* RIGHT: Compact info panel */}
        <div className="w-56 shrink-0 flex flex-col gap-2.5 text-xs">
          {/* Instruction */}
          {block.instruction && (
            <div className="rounded-lg p-2.5 border" style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border)' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>?</span>
                <span className="text-[10px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>操作說明</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--t-text)' }}>{block.instruction}</p>
            </div>
          )}

          {/* Interactive task */}
          {correctRegion && !completed && (
            <div className="rounded-lg p-2.5 border-2" style={{ borderColor: 'var(--t-accent)', backgroundColor: 'var(--t-accent-subtle)' }}>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t-text-secondary)' }}>
                <span className="font-semibold" style={{ color: 'var(--t-accent)' }}>互動：</span>
                在左側截圖點擊正確位置
                {correctRegion.label && <span className="font-medium" style={{ color: 'var(--t-text)' }}>（{correctRegion.label}）</span>}
              </p>
            </div>
          )}

          {/* Completed */}
          {completed && (
            <div className="rounded-lg p-2.5 border flex items-center gap-2" style={{ borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)' }}>
              <span>✅</span>
              <span className="text-xs font-medium" style={{ color: '#22c55e' }}>操作完成</span>
            </div>
          )}

          {/* Feedback */}
          {feedback && (
            <div className="px-2.5 py-2 rounded-lg flex items-center gap-2 border" style={{
              backgroundColor: feedback.correct ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              borderColor: feedback.correct ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
              color: feedback.correct ? 'var(--t-success, #22c55e)' : 'var(--t-danger, #ef4444)'
            }}>
              <span>{feedback.correct ? '✅' : '❌'}</span>
              <span className="text-[11px]">{feedback.text}</span>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2">
            {!completed && regions.length > 0 && (
              <button onClick={() => setShowLabels(!showLabels)}
                className="text-[10px] px-2 py-0.5 rounded transition"
                style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
                {showLabels ? '隱藏標註' : '顯示標註'}
              </button>
            )}
            <span className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>
              嘗試: {attempts}/{maxAttempts}
            </span>
          </div>

          {/* Element list */}
          {(showLabels || completed) && regions.length > 0 && (
            <div className="rounded-lg p-2 border space-y-0.5" style={{ backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))', borderColor: 'var(--t-border)' }}>
              <div className="text-[9px] font-medium mb-1" style={{ color: 'var(--t-text-dim)' }}>畫面元素</div>
              {regions.map((r, idx) => (
                <div key={r.id} className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0"
                    style={{ backgroundColor: r.correct ? (completed ? '#22c55e' : '#3b82f6') : '#64748b', color: 'white' }}>
                    {idx + 1}
                  </span>
                  <span className="truncate" style={{ color: 'var(--t-text-secondary)' }}>{r.label || `元素 ${idx + 1}`}</span>
                  {r.type && <span className="text-[8px] px-0.5 rounded shrink-0" style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-text-dim)' }}>{r.type}</span>}
                  {r.correct && <span className="text-[8px] shrink-0" style={{ color: 'var(--t-accent)' }}>目標</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zoom overlay — full screen lightbox */}
      {zoomed && block.image && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setZoomed(false)}>
          <div className="relative max-w-[95vw] max-h-[95vh]" onClick={e => e.stopPropagation()}>
            <div className="relative select-none"
              style={{ cursor: completed ? 'default' : 'crosshair' }}
              onClick={handleClick}>
              <img src={block.image} alt="" className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg" draggable={false} />
              {annotations.length > 0 && (
                <AnnotationOverlay annotations={annotations} visible={showLabels || completed} animateInterval={600} />
              )}
              {renderRegions()}
            </div>
            <button
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm"
              style={{ backgroundColor: 'rgba(239,68,68,0.8)' }}
              onClick={() => setZoomed(false)}
              title="關閉"
            >✕</button>
            {/* Zoom mode feedback */}
            {feedback && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  backgroundColor: feedback.correct ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)',
                  color: 'white'
                }}>
                {feedback.correct ? '✅' : '❌'} {feedback.text}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
