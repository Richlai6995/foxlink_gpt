/**
 * PDF Visual Field Editor
 * Renders the original PDF template and lets users draw rectangles
 * to define the position of each variable's fill area (pdf_cell).
 *
 * Coordinate system:
 *   PDF native: origin bottom-left, units = points (pt, 1/72 inch)
 *   Canvas:     origin top-left,    units = px
 *   Stored pdf_cell: PDF points (origin top-left for easier mental model)
 *   → at render time y_canvas = (pageH_pt - pdf_y - pdf_h) * scale
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

interface FieldRect {
  key: string        // variable key
  cell: PdfCell
}

interface DrawState {
  startX: number; startY: number   // canvas coords
  currentX: number; currentY: number
}

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

// ── Flatten variables (no loop parents — use children) ──────────────────────
function getFlatVars(variables: TemplateVariable[]): TemplateVariable[] {
  return variables.flatMap(v => v.type === 'loop' ? (v.children || []) : [v])
}

function colorForIdx(i: number) { return FIELD_COLORS[i % FIELD_COLORS.length] }

// ── canvas coords → PDF pt (top-left origin) ─────────────────────────────────
function canvasToPdf(
  cx: number, cy: number, cw: number, ch: number,
  pageH_pt: number, scale: number
): PdfCell {
  // Clamp to positive
  const x = Math.max(0, cx) / scale
  const y = Math.max(0, cy) / scale
  const w = Math.abs(cw) / scale
  const h = Math.abs(ch) / scale
  // Convert top-left origin y to bottom-left PDF y (for pdf-lib overlay)
  // We store as top-left for visual editor simplicity; service converts when drawing
  return { page: 0, x, y, width: w, height: h }
}

// ── PDF pt (top-left) → canvas rect ─────────────────────────────────────────
function pdfToCanvas(cell: PdfCell, scale: number) {
  return {
    x: cell.x * scale,
    y: cell.y * scale,
    w: cell.width * scale,
    h: cell.height * scale,
  }
}

export default function PDFFieldEditor({ templateId, variables, onChange, readonly }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<SVGSVGElement>(null)

  const [pdfDoc, setPdfDoc]       = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum]     = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [scale, setScale]         = useState(1.3)
  const [pageSize, setPageSize]   = useState({ w: 0, h: 0, ptW: 0, ptH: 0 })
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  // Fields: derived from variables' pdf_cell on current page
  const flatVars  = getFlatVars(variables)
  const fields: FieldRect[] = flatVars
    .filter(v => v.pdf_cell && v.pdf_cell.page === pageNum - 1)
    .map(v => ({ key: v.key, cell: v.pdf_cell! }))

  const [drawing, setDrawing] = useState<DrawState | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [assignKey, setAssignKey]     = useState('')   // variable to assign when drawing

  // ── Load PDF ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    ;(async () => {
      try {
        const lib = await getPdfjsLib()
        const token = localStorage.getItem('token') || ''
        const task = lib.getDocument({
          url: `/api/doc-templates/${templateId}/preview-file`,
          httpHeaders: { Authorization: `Bearer ${token}` },
        })
        const doc = await task.promise
        if (cancelled) return
        setPdfDoc(doc)
        setPageCount(doc.numPages)
        setPageNum(1)
        setLoading(false)
      } catch (e: unknown) {
        if (!cancelled) {
          setError('PDF 載入失敗: ' + (e instanceof Error ? e.message : String(e)))
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [templateId])

  // ── Render page to canvas ─────────────────────────────────────────────────
  const renderPage = useCallback(async (doc: typeof pdfDoc, pn: number, sc: number) => {
    if (!doc || !canvasRef.current) return
    const page     = await doc.getPage(pn)
    const viewport = page.getViewport({ scale: sc })
    const canvas   = canvasRef.current
    canvas.width   = viewport.width
    canvas.height  = viewport.height
    setPageSize({ w: viewport.width, h: viewport.height, ptW: viewport.width / sc, ptH: viewport.height / sc })
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise
  }, [])

  useEffect(() => {
    if (pdfDoc) renderPage(pdfDoc, pageNum, scale)
  }, [pdfDoc, pageNum, scale, renderPage])

  // ── Update variable's pdf_cell ────────────────────────────────────────────
  const setCellForKey = (key: string, cell: PdfCell | undefined) => {
    const update = (vars: TemplateVariable[]): TemplateVariable[] =>
      vars.map(v => {
        if (v.key === key) return { ...v, pdf_cell: cell }
        if (v.children) return { ...v, children: update(v.children) }
        return v
      })
    onChange(update(variables))
  }

  // ── Mouse draw handlers ────────────────────────────────────────────────────
  const svgRect = () => overlayRef.current?.getBoundingClientRect()

  const onMouseDown = (e: React.MouseEvent) => {
    if (readonly || !assignKey) return
    const r = svgRect()!
    setDrawing({ startX: e.clientX - r.left, startY: e.clientY - r.top, currentX: e.clientX - r.left, currentY: e.clientY - r.top })
    setSelectedKey(null)
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const r = svgRect()!
    setDrawing(d => d ? { ...d, currentX: e.clientX - r.left, currentY: e.clientY - r.top } : null)
  }
  const onMouseUp = () => {
    if (!drawing || !assignKey) { setDrawing(null); return }
    const { startX, startY, currentX, currentY } = drawing
    const cw = currentX - startX
    const ch = currentY - startY
    if (Math.abs(cw) < 8 || Math.abs(ch) < 8) { setDrawing(null); return }

    // Normalise (handle negative drag)
    const x = Math.min(startX, currentX)
    const y = Math.min(startY, currentY)
    const w = Math.abs(cw)
    const h = Math.abs(ch)

    const cell = canvasToPdf(x, y, w, h, pageSize.ptH, scale)
    cell.page = pageNum - 1
    setCellForKey(assignKey, cell)
    setSelectedKey(assignKey)
    setDrawing(null)
  }

  // ── Currently selected variable (for right panel) ─────────────────────────
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

  // ── Rendering preview rect for in-progress draw ───────────────────────────
  const drawPreview = drawing ? {
    x: Math.min(drawing.startX, drawing.currentX),
    y: Math.min(drawing.startY, drawing.currentY),
    w: Math.abs(drawing.currentX - drawing.startX),
    h: Math.abs(drawing.currentY - drawing.startY),
  } : null

  // ── Unassigned variable keys ───────────────────────────────────────────────
  const unassigned = flatVars.filter(v => !v.pdf_cell)
  const assigned   = flatVars.filter(v => v.pdf_cell)

  return (
    <div className="flex gap-3 h-[560px]">
      {/* ── Left: PDF canvas + SVG overlay ────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-1">
            <button onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1} className="px-2 py-0.5 border rounded text-xs disabled:opacity-40">‹</button>
            <span className="text-xs px-1">{pageNum} / {pageCount}</span>
            <button onClick={() => setPageNum(p => Math.min(pageCount, p + 1))} disabled={pageNum >= pageCount} className="px-2 py-0.5 border rounded text-xs disabled:opacity-40">›</button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1)))} className="px-2 py-0.5 border rounded text-xs">−</button>
            <span className="text-xs w-10 text-center">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(s => Math.min(3, +(s + 0.2).toFixed(1)))} className="px-2 py-0.5 border rounded text-xs">+</button>
          </div>
          {/* Assign target selector */}
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
        <div className="flex-1 overflow-auto border rounded bg-slate-100 relative" style={{ cursor: assignKey && !readonly ? 'crosshair' : 'default' }}>
          {loading && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 bg-white/80">載入中...</div>}
          {error   && <div className="absolute inset-0 flex items-center justify-center text-xs text-red-500 bg-white/80 p-4 text-center">{error}</div>}

          <div className="relative inline-block">
            <canvas ref={canvasRef} />

            {/* SVG overlay for field rects */}
            <svg
              ref={overlayRef}
              className="absolute inset-0 pointer-events-auto"
              style={{ width: pageSize.w, height: pageSize.h }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            >
              {/* Existing field rects */}
              {fields.map((f, i) => {
                const r = pdfToCanvas(f.cell, scale)
                const color = colorForIdx(flatVars.findIndex(v => v.key === f.key))
                const isSelected = f.key === selectedKey
                return (
                  <g key={f.key} onClick={() => { setSelectedKey(f.key); setAssignKey(f.key) }} style={{ cursor: 'pointer' }}>
                    <rect
                      x={r.x} y={r.y} width={r.w} height={r.h}
                      fill={color + '22'}
                      stroke={color}
                      strokeWidth={isSelected ? 2 : 1}
                      strokeDasharray={isSelected ? '' : '4 2'}
                    />
                    <rect x={r.x} y={r.y - 14} width={Math.min(r.w, 120)} height={14} fill={color} rx={2} />
                    <text x={r.x + 3} y={r.y - 3} fontSize={10} fill="white" style={{ userSelect: 'none' }}>
                      {(flatVars.find(v => v.key === f.key)?.label || f.key).slice(0, 14)}
                    </text>
                    {/* Delete button */}
                    {!readonly && isSelected && (
                      <g onClick={e => { e.stopPropagation(); setCellForKey(f.key, undefined); setSelectedKey(null) }}>
                        <circle cx={r.x + r.w - 6} cy={r.y + 6} r={7} fill="#ef4444" />
                        <text x={r.x + r.w - 6} y={r.y + 10} textAnchor="middle" fontSize={11} fill="white" style={{ userSelect: 'none' }}>✕</text>
                      </g>
                    )}
                  </g>
                )
              })}

              {/* In-progress draw rect */}
              {drawPreview && (
                <rect
                  x={drawPreview.x} y={drawPreview.y}
                  width={drawPreview.w} height={drawPreview.h}
                  fill="#3b82f633" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 2"
                />
              )}
            </svg>
          </div>
        </div>
      </div>

      {/* ── Right: field list + selected field detail ─────────────────────── */}
      <div className="w-56 flex flex-col gap-2 shrink-0 overflow-y-auto">
        {/* Progress */}
        <div className="text-[11px] text-slate-500 bg-slate-50 border rounded p-2">
          <div className="font-medium mb-1">欄位定位進度</div>
          <div className="text-green-600">{assigned.length} 已定位</div>
          {unassigned.length > 0 && (
            <div className="text-orange-500">{unassigned.length} 未定位：{unassigned.map(v => v.label || v.key).join('、')}</div>
          )}
        </div>

        {/* All fields mini list */}
        <div className="border rounded overflow-hidden text-[11px]">
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
              <div className="text-[10px] text-slate-400 space-y-0.5">
                <div>X: {selectedVar.pdf_cell.x.toFixed(1)} pt</div>
                <div>Y: {selectedVar.pdf_cell.y.toFixed(1)} pt</div>
                <div>W: {selectedVar.pdf_cell.width.toFixed(1)} pt</div>
                <div>H: {selectedVar.pdf_cell.height.toFixed(1)} pt</div>
                <div>頁: {selectedVar.pdf_cell.page + 1}</div>
              </div>
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
