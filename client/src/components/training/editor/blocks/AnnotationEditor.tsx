/**
 * Phase 3A: AnnotationEditor — 標註圖層編輯器
 * 在 HotspotEditor 的截圖上顯示 annotations（①②③ 圈框箭頭文字），
 * 支援拖拉移動、調整大小、刪除、新增。
 */
import { useState, useRef, useCallback } from 'react'
import { Trash2, Plus, Move } from 'lucide-react'
import type { Annotation } from '../../blocks/AnnotationOverlay'

interface Props {
  annotations: Annotation[]
  onChange: (annotations: Annotation[]) => void
  imageRef: React.RefObject<HTMLImageElement | null>
}

export default function AnnotationEditor({ annotations, onChange, imageRef }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origCoords: any } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const toPct = useCallback((clientX: number, clientY: number) => {
    if (!imageRef.current) return { x: 0, y: 0 }
    const rect = imageRef.current.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100
    }
  }, [imageRef])

  const handleMouseDown = (e: React.MouseEvent, ann: Annotation) => {
    e.stopPropagation()
    setSelectedId(ann.id)
    const pt = toPct(e.clientX, e.clientY)
    setDragging({ id: ann.id, startX: pt.x, startY: pt.y, origCoords: { ...ann.coords } })
  }

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const pt = toPct(e.clientX, e.clientY)
    const dx = pt.x - dragging.startX
    const dy = pt.y - dragging.startY

    onChange(annotations.map(a => {
      if (a.id !== dragging.id) return a
      const orig = dragging.origCoords
      const newCoords = { ...a.coords }
      newCoords.x = orig.x + dx
      newCoords.y = orig.y + dy
      // For arrows, also move endpoint
      if (a.type === 'arrow' && orig.x2 !== undefined) {
        newCoords.x2 = orig.x2 + dx
        newCoords.y2 = orig.y2 + dy
      }
      return { ...a, coords: newCoords }
    }))
  }, [dragging, annotations, onChange, toPct])

  const handleMouseUp = () => setDragging(null)

  const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
    onChange(annotations.map(a => a.id === id ? { ...a, ...updates } : a))
  }

  const deleteAnnotation = (id: string) => {
    onChange(annotations.filter(a => a.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const selected = annotations.find(a => a.id === selectedId)

  return (
    <div className="space-y-2">
      {/* SVG overlay on image — rendered by parent via CSS absolute positioning */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        style={{ pointerEvents: 'all', cursor: dragging ? 'grabbing' : 'default', zIndex: 5 }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {annotations.map(a => {
          const isSelected = a.id === selectedId
          const handleStyle: React.CSSProperties = { cursor: 'grab' }

          switch (a.type) {
            case 'number':
              return (
                <g key={a.id} onMouseDown={e => handleMouseDown(e, a)} style={handleStyle}>
                  <circle cx={a.coords.x} cy={a.coords.y} r={isSelected ? 3 : 2.2}
                    fill={a.color || '#ef4444'} stroke={isSelected ? '#fff' : 'none'} strokeWidth="0.3" />
                  <text x={a.coords.x} y={a.coords.y} fill="#fff" fontSize="2" textAnchor="middle"
                    dominantBaseline="central" fontWeight="bold" style={{ pointerEvents: 'none' }}>
                    {a.stepNumber}
                  </text>
                  {a.label && (
                    <text x={a.coords.x + 3.5} y={a.coords.y + 0.5} fill={a.color || '#ef4444'} fontSize="1.6"
                      fontWeight="600" style={{ pointerEvents: 'none' }}>{a.label}</text>
                  )}
                </g>
              )
            case 'circle':
              return (
                <ellipse key={a.id} onMouseDown={e => handleMouseDown(e, a)} style={handleStyle}
                  cx={a.coords.x} cy={a.coords.y} rx={a.coords.rx || 5} ry={a.coords.ry || 5}
                  fill="none" stroke={a.color || '#ef4444'}
                  strokeWidth={isSelected ? 0.5 : 0.3} strokeDasharray={isSelected ? '1 0.5' : 'none'} />
              )
            case 'rect':
              return (
                <rect key={a.id} onMouseDown={e => handleMouseDown(e, a)} style={handleStyle}
                  x={a.coords.x} y={a.coords.y} width={a.coords.w || 10} height={a.coords.h || 5}
                  fill="none" stroke={a.color || '#22c55e'}
                  strokeWidth={isSelected ? 0.5 : 0.3} strokeDasharray={isSelected ? '1 0.5' : 'none'} />
              )
            case 'arrow':
              return (
                <line key={a.id} onMouseDown={e => handleMouseDown(e, a)} style={{ ...handleStyle, strokeWidth: 4 }}
                  x1={a.coords.x} y1={a.coords.y} x2={a.coords.x2 ?? a.coords.x + 10} y2={a.coords.y2 ?? a.coords.y}
                  stroke={a.color || '#3b82f6'} strokeWidth={isSelected ? 0.5 : 0.3} />
              )
            case 'text':
              return (
                <text key={a.id} onMouseDown={e => handleMouseDown(e, a)} style={handleStyle}
                  x={a.coords.x} y={a.coords.y} fill={a.color || '#eab308'} fontSize="2" fontWeight="600">
                  {a.label}
                </text>
              )
            default:
              return null
          }
        })}
      </svg>

      {/* Properties panel */}
      {selected && (
        <div className="border rounded-lg p-2 space-y-1.5" style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>
              <Move size={10} className="inline mr-1" />
              {selected.type === 'number' ? `步驟 ${selected.stepNumber}` : selected.type}
              {' '}— 拖拉移動
            </span>
            <button onClick={() => deleteAnnotation(selected.id)}
              className="text-red-400 hover:text-red-300 p-0.5">
              <Trash2 size={11} />
            </button>
          </div>

          {/* Label edit */}
          {(selected.type === 'number' || selected.type === 'text') && (
            <div>
              <label className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>標籤文字</label>
              <input value={selected.label || ''} onChange={e => updateAnnotation(selected.id, { label: e.target.value })}
                className="w-full border rounded px-2 py-0.5 text-[10px]"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
            </div>
          )}

          {/* Color */}
          <div className="flex items-center gap-1">
            <span className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>顏色:</span>
            {['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#ffffff'].map(c => (
              <button key={c} onClick={() => updateAnnotation(selected.id, { color: c })}
                className="w-4 h-4 rounded-full border transition"
                style={{
                  backgroundColor: c,
                  borderColor: selected.color === c ? '#fff' : 'transparent',
                  transform: selected.color === c ? 'scale(1.3)' : 'scale(1)'
                }} />
            ))}
          </div>
        </div>
      )}

      {/* Annotation list */}
      <div className="text-[9px] space-y-0.5" style={{ color: 'var(--t-text-dim)' }}>
        <div className="font-medium">標註 ({annotations.length})</div>
        {annotations.map(a => (
          <div key={a.id}
            className="flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer transition"
            style={{ backgroundColor: selectedId === a.id ? 'var(--t-accent-subtle)' : 'transparent' }}
            onClick={() => setSelectedId(a.id)}>
            <span style={{ color: a.color || '#ef4444' }}>
              {a.type === 'number' ? `① ${a.stepNumber}` : a.type === 'circle' ? '◯' : a.type === 'rect' ? '▭' : a.type === 'arrow' ? '→' : a.type === 'text' ? 'T' : '✎'}
            </span>
            <span className="truncate">{a.label || ''}</span>
            <button onClick={e => { e.stopPropagation(); deleteAnnotation(a.id) }}
              className="ml-auto text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100">
              <Trash2 size={8} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
