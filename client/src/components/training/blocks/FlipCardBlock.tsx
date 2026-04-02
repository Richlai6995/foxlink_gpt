import { useState } from 'react'

interface Card { front: { text: string }; back: { text: string } }

export default function FlipCardBlock({ block }: { block: any }) {
  const cards: Card[] = block.cards || []
  const columns = block.columns || 2
  const [flipped, setFlipped] = useState<Set<number>>(new Set())

  const toggle = (idx: number) => {
    setFlipped(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {block.instruction && <p className="text-sm font-medium text-amber-300">{block.instruction}</p>}
      <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {cards.map((card, idx) => (
          <div key={idx} onClick={() => toggle(idx)}
            className="cursor-pointer perspective-1000" style={{ perspective: '1000px' }}>
            <div className={`relative transition-transform duration-500 preserve-3d ${flipped.has(idx) ? '[transform:rotateY(180deg)]' : ''}`}
              style={{ transformStyle: 'preserve-3d' }}>
              {/* Front */}
              <div className="bg-gradient-to-br from-amber-900/30 to-slate-800 border border-amber-500/20 rounded-xl p-6 min-h-[120px] flex items-center justify-center text-center backface-hidden"
                style={{ backfaceVisibility: 'hidden' }}>
                <p className="text-sm font-medium">{card.front.text}</p>
              </div>
              {/* Back */}
              <div className="absolute inset-0 bg-gradient-to-br from-sky-900/30 to-slate-800 border border-sky-500/20 rounded-xl p-6 min-h-[120px] flex items-center justify-center text-center [transform:rotateY(180deg)] backface-hidden"
                style={{ backfaceVisibility: 'hidden' }}>
                <p className="text-sm">{card.back.text}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
