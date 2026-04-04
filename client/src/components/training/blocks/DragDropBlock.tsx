import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function DragDropBlock({ block }: { block: any }) {
  const { t } = useTranslation()
  const items: { id: string; content: string }[] = block.items || []
  const targets: { id: string; label: string; correct_item: string }[] = block.targets || []
  const mode = block.mode || 'ordering'
  const [userOrder, setUserOrder] = useState<string[]>(
    () => items.map(i => i.id).sort(() => Math.random() - 0.5)
  )
  const [placements, setPlacements] = useState<Record<string, string>>({})
  const [dragItem, setDragItem] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [correct, setCorrect] = useState(false)

  const handleDragStart = (id: string) => setDragItem(id)

  const handleDropOnTarget = (targetId: string) => {
    if (!dragItem) return
    setPlacements(prev => ({ ...prev, [targetId]: dragItem }))
    setDragItem(null)
  }

  const handleDropReorder = (dropIdx: number) => {
    if (!dragItem) return
    const fromIdx = userOrder.indexOf(dragItem)
    if (fromIdx === -1) return
    const newOrder = [...userOrder]
    newOrder.splice(fromIdx, 1)
    newOrder.splice(dropIdx, 0, dragItem)
    setUserOrder(newOrder)
    setDragItem(null)
  }

  const checkAnswer = () => {
    setChecked(true)
    if (mode === 'ordering') {
      setCorrect(userOrder.every((id, idx) => id === items[idx]?.id))
    } else {
      setCorrect(targets.every(t => placements[t.id] === t.correct_item))
    }
  }

  const itemById = (id: string) => items.find(i => i.id === id)

  return (
    <div className="space-y-3">
      {block.instruction && <p className="text-sm font-medium text-purple-300">{block.instruction}</p>}

      {mode === 'ordering' ? (
        /* Ordering mode */
        <div className="space-y-1.5">
          {userOrder.map((id, idx) => {
            const item = itemById(id)
            return (
              <div key={id}
                draggable
                onDragStart={() => handleDragStart(id)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => handleDropReorder(idx)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition ${
                  checked
                    ? (id === items[idx]?.id ? 'border-green-500 bg-green-500/10' : 'border-red-500 bg-red-500/10')
                    : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                }`}
              >
                <span className="text-xs text-slate-500 w-5">{idx + 1}.</span>
                <span className="text-sm">{item?.content || id}</span>
              </div>
            )
          })}
        </div>
      ) : (
        /* Matching mode */
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs text-slate-400 font-medium mb-2">{t('training.dragItems')}</h4>
            {items.filter(i => !Object.values(placements).includes(i.id)).map(item => (
              <div key={item.id}
                draggable
                onDragStart={() => handleDragStart(item.id)}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded mb-1.5 cursor-grab text-sm hover:border-purple-500 transition"
              >
                {item.content}
              </div>
            ))}
          </div>
          <div>
            <h4 className="text-xs text-slate-400 font-medium mb-2">{t('training.dropTargets')}</h4>
            {targets.map(target => (
              <div key={target.id}
                onDragOver={e => e.preventDefault()}
                onDrop={() => handleDropOnTarget(target.id)}
                className={`px-3 py-2 border-2 border-dashed rounded mb-1.5 min-h-[40px] transition ${
                  checked && placements[target.id]
                    ? (placements[target.id] === target.correct_item ? 'border-green-500 bg-green-500/10' : 'border-red-500 bg-red-500/10')
                    : placements[target.id] ? 'border-purple-500 bg-purple-500/10' : 'border-slate-600'
                }`}
              >
                <div className="text-[10px] text-slate-500 mb-0.5">{target.label}</div>
                {placements[target.id] && (
                  <div className="text-sm">{itemById(placements[target.id])?.content}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={checkAnswer} disabled={checked}
          className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50">
          {checked ? t('training.checked') : t('training.checkAnswer')}
        </button>
        {checked && (
          <span className={`text-sm font-medium ${correct ? 'text-green-400' : 'text-red-400'}`}>
            {correct ? (block.feedback_correct || t('training.correct')) : (block.feedback_incorrect || t('training.tryAgain'))}
          </span>
        )}
      </div>
    </div>
  )
}
