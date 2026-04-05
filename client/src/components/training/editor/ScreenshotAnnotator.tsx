/**
 * ScreenshotAnnotator — 截圖標註工具（全螢幕 Modal）
 *
 * 功能與 Chrome Extension content.js 的 startAnnotationMode() 對齊：
 * 7 種標註工具（編號/圈/框/箭頭/文字/手繪/馬賽克），百分比座標系統 (0-100)。
 * 用途：
 *   1. 手動貼上圖片（Oracle ERP Java Applet 等無法瀏覽器截圖的場景）事後標註
 *   2. Extension 截圖事後修改標註
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { X, Undo2, Redo2, Check, MousePointer2, Minus, RotateCcw } from 'lucide-react'
import type { Annotation } from '../blocks/AnnotationOverlay'

type Tool = 'number' | 'circle' | 'rect' | 'arrow' | 'text' | 'freehand' | 'mosaic'

interface Props {
  imageUrl: string
  annotations: Annotation[]
  stepNumber?: number
  lang?: string
  onSave: (annotations: Annotation[], meta?: { stepNumber?: number; lang?: string }) => void
  onClose: () => void
}

const TOOLS: { key: Tool; icon: string; label: string }[] = [
  { key: 'number', icon: '①', label: '步驟編號' },
  { key: 'circle', icon: '◯', label: '圓圈' },
  { key: 'rect', icon: '▭', label: '矩形' },
  { key: 'arrow', icon: '→', label: '箭頭' },
  { key: 'text', icon: 'T', label: '文字' },
  { key: 'freehand', icon: '✎', label: '手繪' },
  { key: 'mosaic', icon: '▦', label: '馬賽克' },
]

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#ffffff']
const STROKE_WIDTHS = [2, 3, 4, 6]
const FONT_SIZES = [1.2, 1.6, 2, 2.5, 3]

let idCounter = 0
const genId = () => `ann_${Date.now()}_${++idCounter}`

export default function ScreenshotAnnotator({ imageUrl, annotations: initial, stepNumber: initStepNum, lang: initLang, onSave, onClose }: Props) {
  const [annots, setAnnots] = useState<Annotation[]>(() => initial?.map(a => ({ ...a })) || [])
  const [metaStepNumber, setMetaStepNumber] = useState(initStepNum || 1)
  const [metaLang, setMetaLang] = useState(initLang || 'zh-TW')
  const [undoStack, setUndoStack] = useState<Annotation[][]>([])
  const [redoStack, setRedoStack] = useState<Annotation[][]>([])
  const [tool, setTool] = useState<Tool>('number')
  const [color, setColor] = useState('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [fontSize, setFontSize] = useState(2)
  const [manualNextStep, setManualNextStep] = useState<number | null>(null) // null = auto

  // Auto-compute next step from current annotations
  const autoNextStep = useMemo(() => {
    const nums = annots.filter(a => a.type === 'number').map(a => a.stepNumber || 0)
    return nums.length > 0 ? Math.max(...nums) + 1 : 1
  }, [annots])
  const nextStep = manualNextStep ?? autoNextStep

  // Image aspect ratio for circle compensation (preserveAspectRatio="none" distorts circles)
  const [imgAspect, setImgAspect] = useState(1) // width / height

  // Drawing state
  const [drawing, setDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)
  const [freehandPoints, setFreehandPoints] = useState<{ x: number; y: number }[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origCoords: any } | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Convert client coords to percentage (0-100)
  const toPct = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    }
  }, [])

  // Aspect-ratio compensated circle radii (makes circles appear round despite preserveAspectRatio="none")
  const circleR = useCallback((baseR: number) => {
    // viewBox is 100x100 mapped to imgWidth x imgHeight
    // To appear round: rx * (imgW/100) == ry * (imgH/100)  →  rx = ry * (imgH/imgW) = ry / aspect
    return { rx: baseR / imgAspect, ry: baseR }
  }, [imgAspect])

  // Push state for undo
  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-30), annots.map(a => ({ ...a, coords: { ...a.coords } }))])
    setRedoStack([])
  }, [annots])

  const undo = useCallback(() => {
    if (undoStack.length === 0) return
    setRedoStack(prev => [...prev, annots.map(a => ({ ...a, coords: { ...a.coords } }))])
    setAnnots(undoStack[undoStack.length - 1])
    setUndoStack(prev => prev.slice(0, -1))
  }, [undoStack, annots])

  const redo = useCallback(() => {
    if (redoStack.length === 0) return
    setUndoStack(prev => [...prev, annots.map(a => ({ ...a, coords: { ...a.coords } }))])
    setAnnots(redoStack[redoStack.length - 1])
    setRedoStack(prev => prev.slice(0, -1))
  }, [redoStack, annots])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (textInput) { setTextInput(null); setTextValue(''); return }
        onClose()
        return
      }
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo() }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo() }
      if (e.key === 'Delete' && selectedId) {
        pushUndo()
        setAnnots(prev => prev.filter(a => a.id !== selectedId))
        setSelectedId(null)
      }
      // Tool shortcuts 1-7
      const num = parseInt(e.key)
      if (num >= 1 && num <= 7 && !e.ctrlKey && !e.altKey && !textInput) {
        setTool(TOOLS[num - 1].key)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo, selectedId, textInput, onClose, pushUndo])

  // Update selected annotation helper
  const updateSelected = useCallback((updates: Partial<Annotation>) => {
    if (!selectedId) return
    setAnnots(prev => prev.map(a => a.id === selectedId ? { ...a, ...updates } : a))
  }, [selectedId])

  // ---------- Mouse handlers ----------

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const pt = toPct(e.clientX, e.clientY)

    // Text tool: show input popup
    if (tool === 'text') {
      setTextInput(pt)
      setTextValue('')
      return
    }

    // Number tool: place immediately
    if (tool === 'number') {
      pushUndo()
      const ann: Annotation = {
        id: genId(), type: 'number',
        coords: { x: pt.x, y: pt.y },
        color, stepNumber: nextStep,
        label: '',
      }
      setAnnots(prev => [...prev, ann])
      // If manual was set, advance it; otherwise auto will recalculate
      if (manualNextStep !== null) setManualNextStep(manualNextStep + 1)
      setSelectedId(ann.id)
      return
    }

    setDrawing(true)
    setDrawStart(pt)
    setDrawCurrent(pt)
    if (tool === 'freehand') setFreehandPoints([pt])
    setSelectedId(null)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawing || !drawStart) return
    const pt = toPct(e.clientX, e.clientY)
    setDrawCurrent(pt)
    if (tool === 'freehand') setFreehandPoints(prev => [...prev, pt])
  }

  const handlePointerUp = () => {
    if (!drawing || !drawStart || !drawCurrent) { setDrawing(false); return }

    pushUndo()
    const s = drawStart, c = drawCurrent
    let ann: Annotation | null = null

    switch (tool) {
      case 'circle': {
        const cx = (s.x + c.x) / 2, cy = (s.y + c.y) / 2
        const rx = Math.abs(c.x - s.x) / 2, ry = Math.abs(c.y - s.y) / 2
        if (rx < 0.5 && ry < 0.5) break
        ann = { id: genId(), type: 'circle', coords: { x: cx, y: cy, rx, ry }, color, strokeWidth }
        break
      }
      case 'rect': {
        const x = Math.min(s.x, c.x), y = Math.min(s.y, c.y)
        const w = Math.abs(c.x - s.x), h = Math.abs(c.y - s.y)
        if (w < 0.5 && h < 0.5) break
        ann = { id: genId(), type: 'rect', coords: { x, y, w, h }, color, strokeWidth }
        break
      }
      case 'arrow': {
        const dist = Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2)
        if (dist < 1) break
        ann = { id: genId(), type: 'arrow', coords: { x: s.x, y: s.y, x2: c.x, y2: c.y }, color, strokeWidth }
        break
      }
      case 'freehand': {
        if (freehandPoints.length < 3) break
        ann = { id: genId(), type: 'freehand', coords: { x: freehandPoints[0].x, y: freehandPoints[0].y, points: freehandPoints }, color, strokeWidth }
        break
      }
      case 'mosaic': {
        const x = Math.min(s.x, c.x), y = Math.min(s.y, c.y)
        const w = Math.abs(c.x - s.x), h = Math.abs(c.y - s.y)
        if (w < 0.5 && h < 0.5) break
        ann = { id: genId(), type: 'mosaic', coords: { x, y, w, h }, color: '#94a3b8' }
        break
      }
    }

    if (ann) {
      setAnnots(prev => [...prev, ann!])
      setSelectedId(ann.id)
    }

    setDrawing(false)
    setDrawStart(null)
    setDrawCurrent(null)
    setFreehandPoints([])
  }

  // Text confirm
  const confirmText = () => {
    if (!textInput || !textValue.trim()) { setTextInput(null); setTextValue(''); return }
    pushUndo()
    const ann: Annotation = {
      id: genId(), type: 'text',
      coords: { x: textInput.x, y: textInput.y },
      color, label: textValue.trim(), strokeWidth: fontSize,
    }
    setAnnots(prev => [...prev, ann])
    setSelectedId(ann.id)
    setTextInput(null)
    setTextValue('')
  }

  // Drag existing annotation
  const startDrag = (e: React.PointerEvent, ann: Annotation) => {
    e.stopPropagation()
    const pt = toPct(e.clientX, e.clientY)
    setSelectedId(ann.id)
    setDragging({ id: ann.id, startX: pt.x, startY: pt.y, origCoords: { ...ann.coords } })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const handleDragMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const pt = toPct(e.clientX, e.clientY)
    const dx = pt.x - dragging.startX, dy = pt.y - dragging.startY
    setAnnots(prev => prev.map(a => {
      if (a.id !== dragging.id) return a
      const orig = dragging.origCoords
      const newCoords = { ...a.coords, x: orig.x + dx, y: orig.y + dy }
      if (a.type === 'arrow' && orig.x2 !== undefined) {
        newCoords.x2 = orig.x2 + dx
        newCoords.y2 = orig.y2 + dy
      }
      if (a.type === 'freehand' && orig.points) {
        newCoords.points = orig.points.map((p: any) => ({ x: p.x + dx, y: p.y + dy }))
      }
      return { ...a, coords: newCoords }
    }))
  }

  const handleDragEnd = () => {
    if (dragging) pushUndo()
    setDragging(null)
  }

  // Delete selected
  const deleteSelected = () => {
    if (!selectedId) return
    pushUndo()
    setAnnots(prev => prev.filter(a => a.id !== selectedId))
    setSelectedId(null)
  }

  const selectedAnn = annots.find(a => a.id === selectedId)

  // ---------- Render helpers ----------

  const renderDrawingPreview = () => {
    if (!drawing || !drawStart || !drawCurrent) return null
    const s = drawStart, c = drawCurrent

    switch (tool) {
      case 'circle': {
        const cx = (s.x + c.x) / 2, cy = (s.y + c.y) / 2
        return <ellipse cx={cx} cy={cy} rx={Math.abs(c.x - s.x) / 2} ry={Math.abs(c.y - s.y) / 2}
          fill="none" stroke={color} strokeWidth={strokeWidth / 10} strokeDasharray="0.5 0.3" opacity={0.7} />
      }
      case 'rect':
        return <rect x={Math.min(s.x, c.x)} y={Math.min(s.y, c.y)}
          width={Math.abs(c.x - s.x)} height={Math.abs(c.y - s.y)}
          fill="none" stroke={color} strokeWidth={strokeWidth / 10} strokeDasharray="0.5 0.3" opacity={0.7} />
      case 'arrow':
        return <line x1={s.x} y1={s.y} x2={c.x} y2={c.y}
          stroke={color} strokeWidth={strokeWidth / 10} opacity={0.7} markerEnd="url(#preview-arrow)" />
      case 'freehand': {
        if (freehandPoints.length < 2) return null
        const d = freehandPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        return <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth / 10} strokeLinecap="round" opacity={0.7} />
      }
      case 'mosaic':
        return <rect x={Math.min(s.x, c.x)} y={Math.min(s.y, c.y)}
          width={Math.abs(c.x - s.x)} height={Math.abs(c.y - s.y)}
          fill="url(#mosaic-pattern)" opacity={0.5} strokeDasharray="0.5 0.3" stroke="#fff" strokeWidth={0.15} />
    }
    return null
  }

  const renderAnnotation = (a: Annotation) => {
    const isSelected = a.id === selectedId
    const sw = ((a.strokeWidth || 3) / 3) * 0.3
    const selDash = isSelected ? '0.8 0.4' : undefined
    const cursor = 'grab'

    switch (a.type) {
      case 'number': {
        // Use aspect-ratio compensated ellipse so it appears as a circle
        const baseR = 1.4
        const { rx, ry } = circleR(baseR)
        const selRx = isSelected ? rx * 1.25 : rx
        const selRy = isSelected ? ry * 1.25 : ry
        const numFontSize = Math.min(rx, ry) * 1.3
        return (
          <g key={a.id} onPointerDown={e => startDrag(e, a)} style={{ cursor }}>
            <ellipse cx={a.coords.x} cy={a.coords.y} rx={selRx} ry={selRy}
              fill={a.color || '#ef4444'} stroke={isSelected ? '#fff' : '#0003'} strokeWidth={0.15} />
            <text x={a.coords.x} y={a.coords.y} fill="#fff" fontSize={numFontSize} textAnchor="middle"
              dominantBaseline="central" fontWeight="bold" fontFamily="sans-serif"
              style={{ pointerEvents: 'none' }}>{a.stepNumber}</text>
            {a.label && <text x={a.coords.x + rx + 1} y={a.coords.y + 0.3} fill={a.color || '#ef4444'}
              fontSize="1.4" fontWeight="600" fontFamily="sans-serif" stroke="#000" strokeWidth="0.08"
              paintOrder="stroke" style={{ pointerEvents: 'none' }}>{a.label}</text>}
          </g>
        )
      }
      case 'circle':
        return <ellipse key={a.id} onPointerDown={e => startDrag(e, a)} style={{ cursor }}
          cx={a.coords.x} cy={a.coords.y} rx={a.coords.rx || 5} ry={a.coords.ry || 5}
          fill="none" stroke={a.color || '#ef4444'} strokeWidth={sw}
          strokeDasharray={selDash} />
      case 'rect':
        return <rect key={a.id} onPointerDown={e => startDrag(e, a)} style={{ cursor }}
          x={a.coords.x} y={a.coords.y} width={a.coords.w || 10} height={a.coords.h || 5}
          fill="none" stroke={a.color || '#22c55e'} strokeWidth={sw}
          strokeDasharray={selDash} />
      case 'arrow':
        return (
          <g key={a.id} style={{ color: a.color || '#3b82f6' }}>
            <line onPointerDown={e => startDrag(e, a)} style={{ cursor }}
              x1={a.coords.x} y1={a.coords.y} x2={a.coords.x2 ?? a.coords.x + 10} y2={a.coords.y2 ?? a.coords.y}
              stroke={a.color || '#3b82f6'} strokeWidth={sw} markerEnd="url(#annot-arrowhead)"
              strokeDasharray={selDash} />
            {a.label && <text
              x={((a.coords.x + (a.coords.x2 ?? a.coords.x + 10)) / 2)}
              y={((a.coords.y + (a.coords.y2 ?? a.coords.y)) / 2) - 1}
              fill={a.color || '#3b82f6'} fontSize="1.4" textAnchor="middle" fontWeight="600"
              fontFamily="sans-serif" stroke="#000" strokeWidth="0.08" paintOrder="stroke"
              style={{ pointerEvents: 'none' }}>{a.label}</text>}
          </g>
        )
      case 'text': {
        const fs = a.strokeWidth || 2 // reuse strokeWidth as fontSize for text
        return <text key={a.id} onPointerDown={e => startDrag(e, a)} style={{ cursor }}
          x={a.coords.x} y={a.coords.y} fill={a.color || '#eab308'} fontSize={fs} fontWeight="600"
          fontFamily="sans-serif" stroke="#000" strokeWidth="0.1" paintOrder="stroke"
          textDecoration={isSelected ? 'underline' : undefined}>{a.label}</text>
      }
      case 'freehand': {
        if (!a.coords.points?.length) return null
        const d = a.coords.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        return <path key={a.id} onPointerDown={e => startDrag(e, a)} style={{ cursor }}
          d={d} fill="none" stroke={a.color || '#ef4444'} strokeWidth={sw}
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={selDash} />
      }
      case 'mosaic':
        return <rect key={a.id} onPointerDown={e => startDrag(e, a)} style={{ cursor }}
          x={a.coords.x} y={a.coords.y} width={a.coords.w || 10} height={a.coords.h || 5}
          fill="url(#mosaic-pattern)" opacity={0.9}
          stroke={isSelected ? '#fff' : 'none'} strokeWidth={0.2} strokeDasharray={selDash} />
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col" ref={containerRef}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/95 border-b border-gray-700 shrink-0 flex-wrap">
        {/* Tools */}
        <div className="flex items-center gap-0.5 bg-gray-800 rounded-lg p-0.5">
          {TOOLS.map((t, i) => (
            <button key={t.key}
              onClick={() => setTool(t.key)}
              className={`px-2.5 py-1.5 rounded-md text-sm font-medium transition ${
                tool === t.key ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
              title={`${t.label} (${i + 1})`}>
              {t.icon}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-gray-700" />

        {/* Number tool: step number control */}
        {tool === 'number' && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400">下一個:</span>
              <input type="number" min={1} value={nextStep}
                onChange={e => setManualNextStep(Math.max(1, Number(e.target.value)))}
                className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-12 text-center"
                onClick={e => e.stopPropagation()} />
              <button onClick={() => setManualNextStep(null)}
                className="p-1 rounded text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition"
                title="重設為自動編號（目前最大+1）">
                <RotateCcw size={12} />
              </button>
            </div>
            <div className="w-px h-6 bg-gray-700" />
          </>
        )}

        {/* Colors */}
        <div className="flex items-center gap-1">
          {COLORS.map(c => (
            <button key={c} onClick={() => {
              setColor(c)
              // Also update selected annotation color
              if (selectedId) updateSelected({ color: c })
            }}
              className="w-5 h-5 rounded-full border-2 transition"
              style={{
                backgroundColor: c,
                borderColor: color === c ? '#fff' : 'transparent',
                transform: color === c ? 'scale(1.2)' : 'scale(1)',
                boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #666' : undefined,
              }} />
          ))}
        </div>

        <div className="w-px h-6 bg-gray-700" />

        {/* Stroke width (for drawing tools) */}
        {tool !== 'number' && tool !== 'text' && (
          <>
            <div className="flex items-center gap-1">
              {STROKE_WIDTHS.map(w => (
                <button key={w} onClick={() => setStrokeWidth(w)}
                  className={`w-6 h-6 flex items-center justify-center rounded transition ${
                    strokeWidth === w ? 'bg-gray-600' : 'hover:bg-gray-700'
                  }`}
                  title={`線寬 ${w}`}>
                  <Minus size={w * 3} className="text-gray-300" />
                </button>
              ))}
            </div>
            <div className="w-px h-6 bg-gray-700" />
          </>
        )}

        {/* Font size (for text tool) */}
        {tool === 'text' && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400">字級:</span>
              {FONT_SIZES.map(fs => (
                <button key={fs} onClick={() => setFontSize(fs)}
                  className={`px-1.5 py-0.5 rounded text-xs transition ${
                    fontSize === fs ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}>
                  {fs <= 1.2 ? 'XS' : fs <= 1.6 ? 'S' : fs <= 2 ? 'M' : fs <= 2.5 ? 'L' : 'XL'}
                </button>
              ))}
            </div>
            <div className="w-px h-6 bg-gray-700" />
          </>
        )}

        {/* Undo / Redo */}
        <button onClick={undo} disabled={undoStack.length === 0}
          className="p-1.5 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-30 transition" title="復原 (Ctrl+Z)">
          <Undo2 size={16} />
        </button>
        <button onClick={redo} disabled={redoStack.length === 0}
          className="p-1.5 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-30 transition" title="重做 (Ctrl+Y)">
          <Redo2 size={16} />
        </button>

        <div className="w-px h-6 bg-gray-700" />

        {/* Delete selected */}
        {selectedId && (
          <button onClick={deleteSelected}
            className="px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 rounded transition">
            刪除選取 (Del)
          </button>
        )}

        {/* Selected annotation properties panel */}
        {selectedAnn && (
          <div className="flex items-center gap-2 ml-1 px-2 py-1 bg-gray-800/80 rounded-lg border border-gray-700">
            {/* Type label */}
            <span className="text-[10px] text-gray-500">
              {selectedAnn.type === 'number' ? `#${selectedAnn.stepNumber}` : selectedAnn.type}
            </span>

            {/* Step number (for number type) */}
            {selectedAnn.type === 'number' && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400">編號:</span>
                <input type="number" min={1} value={selectedAnn.stepNumber || 1}
                  onChange={e => updateSelected({ stepNumber: Math.max(1, Number(e.target.value)) })}
                  className="bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-white w-10 text-center"
                  onClick={e => e.stopPropagation()} />
              </div>
            )}

            {/* Label (for number, text, arrow) */}
            {(selectedAnn.type === 'number' || selectedAnn.type === 'text' || selectedAnn.type === 'arrow') && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400">
                  {selectedAnn.type === 'text' ? '內容:' : '標籤:'}
                </span>
                <input value={selectedAnn.label || ''} onChange={e => updateSelected({ label: e.target.value })}
                  className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-28"
                  placeholder={selectedAnn.type === 'text' ? '文字內容...' : '標籤...'}
                  onClick={e => e.stopPropagation()} />
              </div>
            )}

            {/* Font size (for text type) */}
            {selectedAnn.type === 'text' && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400">大小:</span>
                <select value={selectedAnn.strokeWidth || 2}
                  onChange={e => updateSelected({ strokeWidth: Number(e.target.value) })}
                  className="bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-white">
                  {FONT_SIZES.map(fs => (
                    <option key={fs} value={fs}>
                      {fs <= 1.2 ? 'XS' : fs <= 1.6 ? 'S' : fs <= 2 ? 'M' : fs <= 2.5 ? 'L' : 'XL'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Color indicator + sync */}
            <div className="flex items-center gap-0.5">
              <span className="text-[10px] text-gray-400">色:</span>
              {COLORS.map(c => (
                <button key={c} onClick={() => updateSelected({ color: c })}
                  className="w-3.5 h-3.5 rounded-full border transition"
                  style={{
                    backgroundColor: c,
                    borderColor: selectedAnn.color === c ? '#fff' : 'transparent',
                    boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #666' : undefined,
                  }} />
              ))}
            </div>
          </div>
        )}

        <div className="flex-1" />

        {/* Step number + Language */}
        <div className="flex items-center gap-2 px-2 py-1 bg-gray-800/80 rounded-lg border border-gray-700">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400">步驟:</span>
            <input type="number" min={1} value={metaStepNumber}
              onChange={e => setMetaStepNumber(Math.max(1, Number(e.target.value)))}
              className="bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-white w-10 text-center" />
          </div>
          <div className="flex items-center gap-1">
            {(['zh-TW', 'en', 'vi'] as const).map(l => (
              <button key={l} onClick={() => setMetaLang(l)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${
                  metaLang === l ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                }`}>
                {l === 'zh-TW' ? '🇹🇼 中' : l === 'en' ? '🇺🇸 EN' : '🇻🇳 VI'}
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <span className="text-[10px] text-gray-500">{annots.length} 個標註</span>

        <div className="w-px h-6 bg-gray-700" />

        {/* Save / Cancel */}
        <button onClick={onClose}
          className="px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 rounded transition">
          取消
        </button>
        <button onClick={() => onSave(annots, { stepNumber: metaStepNumber, lang: metaLang })}
          className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition flex items-center gap-1">
          <Check size={14} /> 確認儲存
        </button>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        <div className="relative max-w-full max-h-full"
          style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}>
          <img src={imageUrl} alt="" className="max-w-[90vw] max-h-[85vh] rounded select-none"
            draggable={false} style={{ display: 'block' }}
            onLoad={e => {
              const img = e.target as HTMLImageElement
              // Track aspect ratio for circle compensation
              setImgAspect(img.naturalWidth / img.naturalHeight)
              if (svgRef.current) {
                svgRef.current.style.width = img.clientWidth + 'px'
                svgRef.current.style.height = img.clientHeight + 'px'
              }
            }} />

          {/* SVG overlay */}
          <svg ref={svgRef}
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ pointerEvents: 'all' }}
            onPointerDown={handlePointerDown}
            onPointerMove={e => { handlePointerMove(e); handleDragMove(e) }}
            onPointerUp={() => { handlePointerUp(); handleDragEnd() }}
          >
            <defs>
              <marker id="annot-arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
              </marker>
              <marker id="preview-arrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill={color} />
              </marker>
              <pattern id="mosaic-pattern" x="0" y="0" width="2" height="2" patternUnits="userSpaceOnUse">
                <rect width="1" height="1" fill="#94a3b8" opacity="0.8" />
                <rect x="1" y="1" width="1" height="1" fill="#64748b" opacity="0.8" />
                <rect x="1" width="1" height="1" fill="#cbd5e1" opacity="0.6" />
                <rect y="1" width="1" height="1" fill="#475569" opacity="0.6" />
              </pattern>
            </defs>

            {/* Existing annotations */}
            {annots.map(renderAnnotation)}

            {/* Drawing preview */}
            {renderDrawingPreview()}
          </svg>

          {/* Text input popup */}
          {textInput && (
            <div className="absolute z-10" style={{
              left: `${textInput.x}%`,
              top: `${textInput.y}%`,
              transform: 'translate(-4px, -12px)',
            }}>
              <div className="flex items-center gap-1 bg-gray-900 rounded-lg shadow-lg border border-gray-600 p-1">
                <input autoFocus value={textValue} onChange={e => setTextValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') confirmText()
                    if (e.key === 'Escape') { setTextInput(null); setTextValue('') }
                    e.stopPropagation()
                  }}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white w-40"
                  placeholder="輸入文字..." />
                <button onClick={confirmText}
                  className="p-1 rounded bg-blue-600 text-white hover:bg-blue-500">
                  <Check size={14} />
                </button>
                <button onClick={() => { setTextInput(null); setTextValue('') }}
                  className="p-1 rounded text-gray-400 hover:bg-gray-700">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom hint */}
      <div className="px-4 py-1.5 bg-gray-900/95 border-t border-gray-700 text-[10px] text-gray-500 flex items-center gap-4 shrink-0">
        <span><MousePointer2 size={10} className="inline" /> 點擊/拖拉畫標註</span>
        <span>拖拉已有標註可移動</span>
        <span>Delete 刪除選取</span>
        <span>Ctrl+Z 復原 | Ctrl+Y 重做</span>
        <span>Esc 取消</span>
      </div>
    </div>
  )
}
