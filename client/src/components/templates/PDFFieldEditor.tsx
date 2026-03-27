/**
 * PDF Visual Field Editor
 * – pointer capture ensures drag never drops when cursor leaves SVG
 * – resize handles (8-point) on selected box
 * – move by dragging inside selected box
 * – X/Y/W/H editable numeric inputs
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { TemplateVariable, TemplateOverflow } from '../../types'

// ── pdfjs lazy init ──────────────────────────────────────────────────────────
let pdfjsLib: typeof import('pdfjs-dist') | null = null
async function getPdfjsLib() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url
    ).toString()
  }
  return pdfjsLib
}

// ── Types ────────────────────────────────────────────────────────────────────
interface PdfCell { page: number; x: number; y: number; width: number; height: number }
interface FieldRect { key: string; cell: PdfCell }

type ResizeHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'

type Drag =
  | { t: 'draw'; sx: number; sy: number; cx: number; cy: number }
  | { t: 'move';   key: string; sx: number; sy: number; cx: number; cy: number; origCell: PdfCell }
  | { t: 'resize'; key: string; handle: ResizeHandle; sx: number; sy: number; cx: number; cy: number; origCell: PdfCell }

interface Props {
  templateId: string
  variables: TemplateVariable[]
  onChange: (vars: TemplateVariable[]) => void
  readonly?: boolean
}

const OVERFLOW_OPTIONS: { value: TemplateOverflow; label: string }[] = [
  { value: 'wrap',      label: '折行' },
  { value: 'truncate',  label: '截斷' },
  { value: 'shrink',    label: '縮小字型' },
  { value: 'summarize', label: 'AI 摘要' },
]

const FIELD_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#84cc16','#f97316','#ec4899','#14b8a6',
]

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nw-resize', n: 'n-resize',  ne: 'ne-resize',
  e:  'e-resize',  se: 'se-resize', s:  's-resize',
  sw: 'sw-resize', w:  'w-resize',
}

const HS = 8 // resize handle size (px)

// ── helpers ──────────────────────────────────────────────────────────────────
function getFlatVars(variables: TemplateVariable[]): TemplateVariable[] {
  return variables.flatMap(v => v.type === 'loop' ? (v.children || []) : [v])
}
function colorForIdx(i: number) { return FIELD_COLORS[i % FIELD_COLORS.length] }

function canvasToPdf(cx: number, cy: number, cw: number, ch: number, scale: number): Omit<PdfCell, 'page'> {
  return {
    x: Math.max(0, cx) / scale,
    y: Math.max(0, cy) / scale,
    width:  Math.abs(cw) / scale,
    height: Math.abs(ch) / scale,
  }
}
function pdfToCanvas(cell: PdfCell, scale: number) {
  return { x: cell.x * scale, y: cell.y * scale, w: cell.width * scale, h: cell.height * scale }
}

function applyResize(cell: PdfCell, handle: ResizeHandle, dx: number, dy: number, scale: number): PdfCell {
  const dpx = dx / scale, dpy = dy / scale
  let { x, y, width, height } = cell
  if (handle.includes('w')) { x += dpx; width  -= dpx }
  if (handle.includes('e')) {           width  += dpx }
  if (handle.includes('n')) { y += dpy; height -= dpy }
  if (handle.includes('s')) {           height += dpy }
  return { ...cell, x: Math.max(0, x), y: Math.max(0, y), width: Math.max(4, width), height: Math.max(4, height) }
}

function resizeHandlePositions(rx: number, ry: number, rw: number, rh: number): { h: ResizeHandle; cx: number; cy: number }[] {
  return [
    { h: 'nw', cx: rx,        cy: ry        },
    { h: 'n',  cx: rx + rw/2, cy: ry        },
    { h: 'ne', cx: rx + rw,   cy: ry        },
    { h: 'e',  cx: rx + rw,   cy: ry + rh/2 },
    { h: 'se', cx: rx + rw,   cy: ry + rh   },
    { h: 's',  cx: rx + rw/2, cy: ry + rh   },
    { h: 'sw', cx: rx,        cy: ry + rh   },
    { h: 'w',  cx: rx,        cy: ry + rh/2 },
  ]
}

// ── component ─────────────────────────────────────────────────────────────────
export default function PDFFieldEditor({ templateId, variables, onChange, readonly }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const overlayRef    = useRef<SVGSVGElement>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)

  const [pdfDoc, setPdfDoc]       = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum]     = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [scale, setScale]         = useState(1.5)
  const [pageSize, setPageSize]   = useState({ w: 0, h: 0, ptW: 0, ptH: 0 })
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  const [drag, setDrag]             = useState<Drag | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [assignKey, setAssignKey]     = useState('')

  const flatVars = getFlatVars(variables)
  const fields: FieldRect[] = flatVars
    .filter(v => v.pdf_cell && v.pdf_cell.page === pageNum - 1)
    .map(v => ({ key: v.key, cell: v.pdf_cell! }))

  const fitWidth = useCallback(() => {
    if (!canvasAreaRef.current || !pageSize.ptW) return
    const containerW = canvasAreaRef.current.clientWidth - 24
    const newScale = Math.floor((containerW / pageSize.ptW) * 10) / 10
    setScale(Math.max(0.5, Math.min(5, newScale)))
  }, [pageSize.ptW])

  // ── Load PDF ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    ;(async () => {
      try {
        const lib   = await getPdfjsLib()
        const token = localStorage.getItem('token') || ''
        const doc   = await lib.getDocument({
          url: `/api/doc-templates/${templateId}/preview-file`,
          httpHeaders: { Authorization: `Bearer ${token}` },
        }).promise
        if (cancelled) return
        setPdfDoc(doc); setPageCount(doc.numPages); setPageNum(1); setLoading(false)
      } catch (e: unknown) {
        if (!cancelled) { setError('PDF 載入失敗: ' + (e instanceof Error ? e.message : String(e))); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [templateId])

  // ── Render page ───────────────────────────────────────────────────────────
  const renderPage = useCallback(async (doc: typeof pdfDoc, pn: number, sc: number) => {
    if (!doc || !canvasRef.current) return
    const page     = await doc.getPage(pn)
    const viewport = page.getViewport({ scale: sc })
    const canvas   = canvasRef.current
    canvas.width   = viewport.width
    canvas.height  = viewport.height
    setPageSize({ w: viewport.width, h: viewport.height, ptW: viewport.width / sc, ptH: viewport.height / sc })
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
  }, [])

  useEffect(() => { if (pdfDoc) renderPage(pdfDoc, pageNum, scale) }, [pdfDoc, pageNum, scale, renderPage])

  // ── Mutate helpers ────────────────────────────────────────────────────────
  const setCellForKey = useCallback((key: string, cell: PdfCell | undefined) => {
    const update = (vars: TemplateVariable[]): TemplateVariable[] =>
      vars.map(v => {
        if (v.key === key) return { ...v, pdf_cell: cell }
        if (v.children) return { ...v, children: update(v.children) }
        return v
      })
    onChange(update(variables))
  }, [variables, onChange])

  // ── Get SVG-relative pointer coords ──────────────────────────────────────
  const getSvgXY = (e: React.PointerEvent): { x: number; y: number } => {
    const r = overlayRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  // ── Pointer handlers on SVG (draw) ────────────────────────────────────────
  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readonly || !assignKey) return
    const { x, y } = getSvgXY(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ t: 'draw', sx: x, sy: y, cx: x, cy: y })
    setSelectedKey(null)
  }

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const { x, y } = getSvgXY(e)
    setDrag(d => d ? { ...d, cx: x, cy: y } : null)
  }

  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const d = drag
    setDrag(null)

    if (d.t === 'draw') {
      const cw = d.cx - d.sx, ch = d.cy - d.sy
      if (Math.abs(cw) < 5 || Math.abs(ch) < 5 || !assignKey) return
      const x = Math.min(d.sx, d.cx), y = Math.min(d.sy, d.cy)
      const cell: PdfCell = { ...canvasToPdf(x, y, Math.abs(cw), Math.abs(ch), scale), page: pageNum - 1 }
      setCellForKey(assignKey, cell)
      setSelectedKey(assignKey)

    } else if (d.t === 'move') {
      const dx = d.cx - d.sx, dy = d.cy - d.sy
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        setCellForKey(d.key, {
          ...d.origCell,
          x: Math.max(0, d.origCell.x + dx / scale),
          y: Math.max(0, d.origCell.y + dy / scale),
        })
      }

    } else if (d.t === 'resize') {
      setCellForKey(d.key, applyResize(d.origCell, d.handle, d.cx - d.sx, d.cy - d.sy, scale))
    }
  }

  // ── Pointer handlers on field rects (move) ────────────────────────────────
  const onFieldPointerDown = (e: React.PointerEvent, key: string, cell: PdfCell) => {
    if (readonly) return
    e.stopPropagation()
    const { x, y } = getSvgXY(e)
    overlayRef.current!.setPointerCapture(e.pointerId)
    setDrag({ t: 'move', key, sx: x, sy: y, cx: x, cy: y, origCell: { ...cell } })
    setSelectedKey(key)
    setAssignKey(key)
  }

  // ── Pointer handlers on resize handles ────────────────────────────────────
  const onHandlePointerDown = (e: React.PointerEvent, key: string, cell: PdfCell, handle: ResizeHandle) => {
    if (readonly) return
    e.stopPropagation()
    const { x, y } = getSvgXY(e)
    overlayRef.current!.setPointerCapture(e.pointerId)
    setDrag({ t: 'resize', key, handle, sx: x, sy: y, cx: x, cy: y, origCell: { ...cell } })
  }

  // ── Compute live preview rect ─────────────────────────────────────────────
  type Preview = { x: number; y: number; w: number; h: number; forKey?: string }
  const preview: Preview | null = (() => {
    if (!drag) return null
    if (drag.t === 'draw') {
      return { x: Math.min(drag.sx, drag.cx), y: Math.min(drag.sy, drag.cy), w: Math.abs(drag.cx - drag.sx), h: Math.abs(drag.cy - drag.sy) }
    }
    if (drag.t === 'move') {
      const r = pdfToCanvas(drag.origCell, scale)
      return { x: r.x + (drag.cx - drag.sx), y: r.y + (drag.cy - drag.sy), w: r.w, h: r.h, forKey: drag.key }
    }
    if (drag.t === 'resize') {
      const newCell = applyResize(drag.origCell, drag.handle, drag.cx - drag.sx, drag.cy - drag.sy, scale)
      const r = pdfToCanvas(newCell, scale)
      return { x: r.x, y: r.y, w: r.w, h: r.h, forKey: drag.key }
    }
    return null
  })()

  // ── Right-panel helpers ───────────────────────────────────────────────────
  const selectedVar = flatVars.find(v => v.key === selectedKey) || null
  const patchSelectedVar = (patch: Partial<TemplateVariable>) => {
    if (!selectedKey) return
    const update = (vars: TemplateVariable[]): TemplateVariable[] =>
      vars.map(v => {
        if (v.key === selectedKey) return { ...v, ...patch }
        if (v.children) return { ...v, children: update(v.children) }
        return v
      })
    onChange(update(variables))
  }
  const patchCell = (patch: Partial<PdfCell>) => {
    if (!selectedKey || !selectedVar?.pdf_cell) return
    setCellForKey(selectedKey, { ...selectedVar.pdf_cell, ...patch })
  }

  const unassigned = flatVars.filter(v => !v.pdf_cell)
  const assigned   = flatVars.filter(v => v.pdf_cell)

  // ── Canvas cursor ─────────────────────────────────────────────────────────
  const dragHandle = drag?.t === 'resize' ? HANDLE_CURSORS[drag.handle] : drag?.t === 'move' ? 'move' : undefined
  const canvasCursor = dragHandle ?? (assignKey && !readonly ? 'crosshair' : 'default')

  return (
    <div className="flex gap-3 h-[calc(100vh-280px)] min-h-[480px]">
      {/* ── Left: PDF canvas + SVG overlay ──────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-1">
            <button onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1} className="px-2 py-0.5 border rounded text-xs disabled:opacity-40">‹</button>
            <span className="text-xs px-1">{pageNum} / {pageCount}</span>
            <button onClick={() => setPageNum(p => Math.min(pageCount, p + 1))} disabled={pageNum >= pageCount} className="px-2 py-0.5 border rounded text-xs disabled:opacity-40">›</button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))} className="px-2 py-0.5 border rounded text-xs">−</button>
            <select
              className="text-xs border rounded px-1 py-0.5 w-20 text-center"
              value={scale}
              onChange={e => setScale(+e.target.value)}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5].map(v => (
                <option key={v} value={v}>{Math.round(v * 100)}%</option>
              ))}
              {![0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5].includes(scale) && (
                <option value={scale}>{Math.round(scale * 100)}%</option>
              )}
            </select>
            <button onClick={() => setScale(s => Math.min(5, +(s + 0.25).toFixed(2)))} className="px-2 py-0.5 border rounded text-xs">+</button>
            <button onClick={fitWidth} className="px-2 py-0.5 border rounded text-xs text-blue-600 hover:bg-blue-50" title="符合寬度">符合</button>
          </div>
          {!readonly && (
            <div className="flex items-center gap-1 ml-2">
              <span className="text-xs text-slate-500">點選變數後拖拉畫框:</span>
              <select
                className={`text-xs border rounded px-1.5 py-0.5 ${assignKey ? 'border-blue-500 text-blue-700' : ''}`}
                value={assignKey}
                onChange={e => setAssignKey(e.target.value)}
              >
                <option value="">— 選擇變數 —</option>
                {flatVars.map((v, i) => (
                  <option key={v.key} value={v.key} style={{ color: colorForIdx(i) }}>
                    {v.pdf_cell ? '✓ ' : ''}{v.label || v.key}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Canvas area */}
        <div ref={canvasAreaRef} className="flex-1 overflow-auto border rounded bg-slate-100 relative" style={{ cursor: canvasCursor }}>
          {loading && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 bg-white/80">載入中...</div>}
          {error   && <div className="absolute inset-0 flex items-center justify-center text-xs text-red-500 bg-white/80 p-4 text-center">{error}</div>}

          <div className="relative inline-block">
            <canvas ref={canvasRef} />

            <svg
              ref={overlayRef}
              className="absolute inset-0"
              style={{ width: pageSize.w, height: pageSize.h, cursor: canvasCursor, touchAction: 'none' }}
              onPointerDown={onSvgPointerDown}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerCancel={() => setDrag(null)}
            >
              {/* Existing field rects */}
              {fields.map((f) => {
                const r      = pdfToCanvas(f.cell, scale)
                const color  = colorForIdx(flatVars.findIndex(v => v.key === f.key))
                const isSel  = f.key === selectedKey
                const isDragging = drag && (drag.t === 'move' || drag.t === 'resize') && drag.key === f.key
                const opacity = isDragging ? 0.3 : 1

                return (
                  <g key={f.key} style={{ opacity }}>
                    {/* Main rect */}
                    <rect
                      x={r.x} y={r.y} width={r.w} height={r.h}
                      fill={color + '22'}
                      stroke={color}
                      strokeWidth={isSel ? 2 : 1}
                      strokeDasharray={isSel ? '' : '4 2'}
                      style={{ cursor: isSel ? 'move' : 'pointer' }}
                      onPointerDown={e => onFieldPointerDown(e, f.key, f.cell)}
                    />
                    {/* Label tag */}
                    <rect x={r.x} y={r.y - 14} width={Math.min(r.w, 120)} height={14} fill={color} rx={2} style={{ pointerEvents: 'none' }} />
                    <text x={r.x + 3} y={r.y - 3} fontSize={10} fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                      {(flatVars.find(v => v.key === f.key)?.label || f.key).slice(0, 14)}
                    </text>
                    {/* Delete button */}
                    {!readonly && isSel && (
                      <g
                        style={{ cursor: 'pointer' }}
                        onPointerDown={e => { e.stopPropagation(); setCellForKey(f.key, undefined); setSelectedKey(null) }}
                      >
                        <circle cx={r.x + r.w - 6} cy={r.y + 6} r={7} fill="#ef4444" />
                        <text x={r.x + r.w - 6} y={r.y + 10} textAnchor="middle" fontSize={11} fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}>✕</text>
                      </g>
                    )}
                    {/* Resize handles (only on selected, not during drag) */}
                    {!readonly && isSel && !isDragging && resizeHandlePositions(r.x, r.y, r.w, r.h).map(({ h, cx, cy }) => (
                      <rect
                        key={h}
                        x={cx - HS / 2} y={cy - HS / 2} width={HS} height={HS}
                        fill="white" stroke="#3b82f6" strokeWidth={1.5} rx={1}
                        style={{ cursor: HANDLE_CURSORS[h] }}
                        onPointerDown={e => onHandlePointerDown(e, f.key, f.cell, h)}
                      />
                    ))}
                  </g>
                )
              })}

              {/* Live drag preview */}
              {preview && (
                <rect
                  x={preview.x} y={preview.y} width={preview.w} height={preview.h}
                  fill="#3b82f633" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 2"
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </svg>
          </div>
        </div>
      </div>

      {/* ── Right: field list + selected field detail ────────────────────── */}
      <div className="w-64 flex flex-col gap-2 shrink-0 overflow-y-auto">
        {/* Progress */}
        <div className="text-[11px] text-slate-500 bg-slate-50 border rounded p-2">
          <div className="font-medium mb-1">欄位定位進度</div>
          <div className="text-green-600">{assigned.length} 已定位</div>
          {unassigned.length > 0 && (
            <div className="text-orange-500">{unassigned.length} 未定位：{unassigned.map(v => v.label || v.key).join('、')}</div>
          )}
        </div>

        {/* All fields mini list */}
        <div className="border rounded overflow-hidden text-[11px] max-h-64 overflow-y-auto">
          {flatVars.map((v, i) => (
            <div
              key={v.key}
              className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer border-b last:border-b-0 ${selectedKey === v.key ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              onClick={() => { setSelectedKey(v.key); setAssignKey(v.key) }}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: colorForIdx(i) }} />
              <span className="truncate flex-1">{v.label || v.key}</span>
              {v.pdf_cell ? <span className="text-green-500 shrink-0">✓</span> : <span className="text-slate-300 shrink-0">○</span>}
            </div>
          ))}
        </div>

        {/* Selected field detail */}
        {selectedVar && (
          <div className="border rounded p-2 text-[11px] space-y-2">
            <div className="font-medium text-slate-700 truncate">{selectedVar.label || selectedVar.key}</div>

            {selectedVar.pdf_cell ? (
              <>
                {/* Editable position/size */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  {([['x', 'X'], ['y', 'Y'], ['width', 'W'], ['height', 'H']] as const).map(([k, label]) => (
                    <div key={k} className="flex items-center gap-1">
                      <span className="text-slate-400 w-4 shrink-0">{label}</span>
                      <input
                        type="number" step="1" min={k === 'width' || k === 'height' ? 4 : 0}
                        className="w-0 flex-1 border rounded px-1 py-0.5 text-[10px]"
                        disabled={readonly}
                        value={Math.round(selectedVar.pdf_cell![k])}
                        onChange={e => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v)) patchCell({ [k]: Math.max(k === 'width' || k === 'height' ? 4 : 0, v) })
                        }}
                      />
                      <span className="text-slate-300 text-[9px] shrink-0">pt</span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400">頁: {selectedVar.pdf_cell.page + 1}</div>
              </>
            ) : (
              <div className="text-orange-500 text-[10px]">尚未定位，請在左側拖拉畫框</div>
            )}

            {/* Style overrides */}
            <div className="space-y-1.5 pt-1 border-t">
              <div className="text-slate-500 font-medium">樣式</div>
              <div className="flex items-center gap-1">
                <span className="w-12 text-slate-400">字型 pt</span>
                <input type="number" min={6} max={72} className="w-14 border rounded px-1 py-0.5 text-[11px]" disabled={readonly}
                  value={selectedVar.style?.override?.fontSize ?? selectedVar.style?.detected?.fontSize ?? ''}
                  onChange={e => patchSelectedVar({ style: { ...selectedVar.style, override: { ...selectedVar.style?.override, fontSize: e.target.value ? +e.target.value : undefined } } })}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-slate-400">
                  <input type="checkbox" disabled={readonly}
                    checked={!!(selectedVar.style?.override?.bold ?? selectedVar.style?.detected?.bold)}
                    onChange={e => patchSelectedVar({ style: { ...selectedVar.style, override: { ...selectedVar.style?.override, bold: e.target.checked || undefined } } })}
                  /> 粗
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  <input type="checkbox" disabled={readonly}
                    checked={!!(selectedVar.style?.override?.italic ?? selectedVar.style?.detected?.italic)}
                    onChange={e => patchSelectedVar({ style: { ...selectedVar.style, override: { ...selectedVar.style?.override, italic: e.target.checked || undefined } } })}
                  /> 斜
                </label>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-12 text-slate-400">顏色</span>
                <input type="color" className="w-7 h-5 border rounded" disabled={readonly}
                  value={selectedVar.style?.override?.color ?? selectedVar.style?.detected?.color ?? '#000000'}
                  onChange={e => patchSelectedVar({ style: { ...selectedVar.style, override: { ...selectedVar.style?.override, color: e.target.value } } })}
                />
              </div>
              <div>
                <span className="text-slate-400">溢位</span>
                <select className="mt-0.5 w-full border rounded px-1 py-0.5 text-[11px]" disabled={readonly}
                  value={selectedVar.style?.override?.overflow ?? selectedVar.style?.detected?.overflow ?? 'wrap'}
                  onChange={e => patchSelectedVar({ style: { ...selectedVar.style, override: { ...selectedVar.style?.override, overflow: e.target.value as TemplateOverflow } } })}
                >
                  {OVERFLOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
