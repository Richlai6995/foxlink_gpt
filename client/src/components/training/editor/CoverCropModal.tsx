/**
 * CoverCropModal — 封面圖片裁切工具
 * 16:9 比例裁切框，支援拖拉平移 + 縮放，canvas 輸出裁切結果。
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Check, ZoomIn, ZoomOut, Move } from 'lucide-react'

interface Props {
  imageFile: File
  onConfirm: (croppedBlob: Blob) => void
  onClose: () => void
}

const ASPECT = 16 / 9
const PREVIEW_W = 640
const PREVIEW_H = PREVIEW_W / ASPECT // 360

export default function CoverCropModal({ imageFile, onConfirm, onClose }: Props) {
  const [imgSrc, setImgSrc] = useState('')
  const [naturalW, setNaturalW] = useState(0)
  const [naturalH, setNaturalH] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [offsetX, setOffsetX] = useState(0) // in px relative to preview
  const [offsetY, setOffsetY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, ox: 0, oy: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Load image
  useEffect(() => {
    const url = URL.createObjectURL(imageFile)
    setImgSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setNaturalW(img.naturalWidth)
    setNaturalH(img.naturalHeight)

    // Calculate initial zoom to contain full image (fit inside 16:9 preview)
    const scaleX = PREVIEW_W / img.naturalWidth
    const scaleY = PREVIEW_H / img.naturalHeight
    const containZoom = Math.min(scaleX, scaleY)
    setZoom(containZoom)

    // Center the image
    const scaledW = img.naturalWidth * containZoom
    const scaledH = img.naturalHeight * containZoom
    setOffsetX((PREVIEW_W - scaledW) / 2)
    setOffsetY((PREVIEW_H - scaledH) / 2)
  }

  // Clamp offsets — when image is smaller than preview, center it; when larger, keep edges inside
  const clampOffsets = useCallback((ox: number, oy: number, z: number) => {
    const scaledW = naturalW * z
    const scaledH = naturalH * z
    let x: number, y: number
    if (scaledW <= PREVIEW_W) {
      x = (PREVIEW_W - scaledW) / 2 // center horizontally
    } else {
      x = Math.min(0, Math.max(PREVIEW_W - scaledW, ox))
    }
    if (scaledH <= PREVIEW_H) {
      y = (PREVIEW_H - scaledH) / 2 // center vertically
    } else {
      y = Math.min(0, Math.max(PREVIEW_H - scaledH, oy))
    }
    return { x, y }
  }, [naturalW, naturalH])

  // Drag handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    const clamped = clampOffsets(dragStart.ox + dx, dragStart.oy + dy, zoom)
    setOffsetX(clamped.x)
    setOffsetY(clamped.y)
  }

  const handlePointerUp = () => setDragging(false)

  // Zoom
  const handleZoom = (newZoom: number) => {
    // Allow zooming down to 30% of contain fit, so user can shrink the image well below the frame
    const containFit = Math.min(PREVIEW_W / naturalW, PREVIEW_H / naturalH)
    const minZoom = Math.min(containFit * 0.3, containFit)
    const z = Math.max(minZoom, Math.min(5, newZoom))

    // Keep center point stable
    const centerX = (PREVIEW_W / 2 - offsetX) / zoom
    const centerY = (PREVIEW_H / 2 - offsetY) / zoom
    const newOx = PREVIEW_W / 2 - centerX * z
    const newOy = PREVIEW_H / 2 - centerY * z
    const clamped = clampOffsets(newOx, newOy, z)

    setZoom(z)
    setOffsetX(clamped.x)
    setOffsetY(clamped.y)
  }

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    handleZoom(zoom + delta)
  }

  // Confirm: render to canvas and export
  const handleConfirm = () => {
    const canvas = canvasRef.current
    if (!canvas || !imgRef.current) return

    // Output resolution: use natural proportions, max 1280px wide
    const outW = Math.min(1280, PREVIEW_W * 2)
    const outH = outW / ASPECT
    canvas.width = outW
    canvas.height = outH

    const ctx = canvas.getContext('2d')!
    const scale = outW / PREVIEW_W

    // Fill white background (for contain mode when image doesn't cover full area)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)

    // Draw image at the correct position and scale
    const drawX = offsetX * scale
    const drawY = offsetY * scale
    const drawW = naturalW * zoom * scale
    const drawH = naturalH * zoom * scale
    ctx.drawImage(imgRef.current, drawX, drawY, drawW, drawH)

    canvas.toBlob(blob => {
      if (blob) onConfirm(blob)
    }, 'image/jpeg', 0.9)
  }

  const containFitR = naturalW > 0 ? Math.min(PREVIEW_W / naturalW, PREVIEW_H / naturalH) : 1
  const minZoom = containFitR * 0.3

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center">
      <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl max-w-[720px] w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Move size={14} className="text-blue-400" /> 調整封面可見範圍
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div className="p-4">
          <div
            className="relative mx-auto overflow-hidden rounded-lg border-2 border-blue-500/50"
            style={{ width: PREVIEW_W, height: PREVIEW_H, cursor: dragging ? 'grabbing' : 'grab' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
          >
            {imgSrc && (
              <img
                ref={imgRef}
                src={imgSrc}
                alt=""
                className="absolute select-none"
                draggable={false}
                style={{
                  left: offsetX,
                  top: offsetY,
                  width: naturalW * zoom,
                  height: naturalH * zoom,
                  maxWidth: 'none',
                }}
                onLoad={handleImgLoad}
              />
            )}
            {/* Grid overlay */}
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
              backgroundSize: `${PREVIEW_W / 3}px ${PREVIEW_H / 3}px`,
            }} />
          </div>

          {/* Zoom controls */}
          <div className="flex items-center justify-center gap-3 mt-3">
            <button onClick={() => handleZoom(zoom - 0.1)}
              className="p-1.5 rounded text-gray-300 hover:bg-gray-700 transition">
              <ZoomOut size={16} />
            </button>
            <input type="range" min={minZoom} max={Math.max(containFitR * 3, 2)} step={0.01}
              value={zoom} onChange={e => handleZoom(Number(e.target.value))}
              className="w-48 accent-blue-500" />
            <button onClick={() => handleZoom(zoom + 0.1)}
              className="p-1.5 rounded text-gray-300 hover:bg-gray-700 transition">
              <ZoomIn size={16} />
            </button>
            <span className="text-[10px] text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="text-center text-[10px] text-gray-500 mt-1">
            拖拉調整位置 | 滾輪或滑桿縮放
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-700">
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-300 hover:bg-gray-700 rounded transition">
            取消
          </button>
          <button onClick={handleConfirm}
            className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition flex items-center gap-1">
            <Check size={14} /> 確認裁切
          </button>
        </div>
      </div>

      {/* Hidden canvas for export */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
