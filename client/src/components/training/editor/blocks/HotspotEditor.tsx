import { useState, useRef, useEffect, useCallback } from 'react'
import { Trash2, Upload, MousePointer, ClipboardPaste, Wand2 } from 'lucide-react'
import api from '../../../../lib/api'
import type { Block } from '../SlideEditor'
import LanguageImagePanel from './LanguageImagePanel'
import AnnotationEditor from './AnnotationEditor'

interface Region {
  id: string
  shape: 'rect' | 'circle'
  coords: { x: number; y: number; w: number; h: number }
  correct: boolean
  feedback: string
}

interface Props {
  block: Block
  onChange: (b: Block) => void
  courseId: number
  slideId?: number
  blockIdx?: number
}

type DragMode = null | 'draw' | 'move' | 'resize-br' | 'resize-bl' | 'resize-tr' | 'resize-tl'

export default function HotspotEditor({ block, onChange, courseId, slideId, blockIdx }: Props) {
  const [dragMode, setDragMode] = useState<DragMode>(null)
  const [showAnnotationLayer, setShowAnnotationLayer] = useState(true)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragRegionId, setDragRegionId] = useState<string | null>(null)
  const [dragOrigCoords, setDragOrigCoords] = useState<Region['coords'] | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const imgRef = useRef<HTMLDivElement>(null)
  const imgElRef = useRef<HTMLImageElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const regions: Region[] = block.regions || []

  const uploadImageFile = async (file: File | Blob, filename?: string) => {
    try {
      setUploading(true)
      const form = new FormData()
      form.append('file', file, filename || 'pasted_image.png')
      const res = await api.post(`/training/courses/${courseId}/upload`, form)
      onChange({ ...block, image: res.data.url })
    } catch (err) { console.error(err) }
    finally { setUploading(false) }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadImageFile(file, file.name)
  }

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (blob) uploadImageFile(blob, `paste_${Date.now()}.png`)
          return
        }
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [courseId])

  // Convert mouse event to % coords on the image
  const toPercent = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!imgRef.current) return { x: 0, y: 0 }
    const rect = imgRef.current.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start new draw if clicking empty area (not a region)
    const p = toPercent(e)
    setDragStart(p)
    setDragMode('draw')
  }

  const handleRegionMouseDown = (e: React.MouseEvent, regionId: string, mode: DragMode) => {
    e.stopPropagation()
    e.preventDefault()
    const p = toPercent(e)
    const region = regions.find(r => r.id === regionId)
    if (!region) return
    setDragMode(mode)
    setDragStart(p)
    setDragRegionId(regionId)
    setDragOrigCoords({ ...region.coords })
    setSelectedRegion(regionId)
  }

  useEffect(() => {
    if (!dragMode || !dragStart) return

    const handleMouseMove = (e: MouseEvent) => {
      const p = toPercent(e as any)
      const dx = p.x - dragStart.x
      const dy = p.y - dragStart.y

      if (dragMode === 'draw') {
        // Live preview handled by CSS — we'll create on mouseUp
        return
      }

      if (!dragRegionId || !dragOrigCoords) return
      const orig = dragOrigCoords

      let newCoords: Region['coords']
      if (dragMode === 'move') {
        newCoords = { x: orig.x + dx, y: orig.y + dy, w: orig.w, h: orig.h }
      } else if (dragMode === 'resize-br') {
        newCoords = { x: orig.x, y: orig.y, w: Math.max(2, orig.w + dx), h: Math.max(2, orig.h + dy) }
      } else if (dragMode === 'resize-bl') {
        newCoords = { x: orig.x + dx, y: orig.y, w: Math.max(2, orig.w - dx), h: Math.max(2, orig.h + dy) }
      } else if (dragMode === 'resize-tr') {
        newCoords = { x: orig.x, y: orig.y + dy, w: Math.max(2, orig.w + dx), h: Math.max(2, orig.h - dy) }
      } else if (dragMode === 'resize-tl') {
        newCoords = { x: orig.x + dx, y: orig.y + dy, w: Math.max(2, orig.w - dx), h: Math.max(2, orig.h - dy) }
      } else return

      onChange({
        ...block,
        regions: regions.map(r => r.id === dragRegionId ? { ...r, coords: newCoords } : r)
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (dragMode === 'draw' && dragStart) {
        const p = toPercent(e as any)
        const x1 = Math.min(dragStart.x, p.x), y1 = Math.min(dragStart.y, p.y)
        const w = Math.abs(p.x - dragStart.x), h = Math.abs(p.y - dragStart.y)
        if (w > 1.5 && h > 1.5) {
          const newRegion: Region = {
            id: `r${Date.now()}`,
            shape: 'rect',
            coords: { x: x1, y: y1, w, h },
            correct: true,
            feedback: ''
          }
          onChange({ ...block, regions: [...regions, newRegion] })
          setSelectedRegion(newRegion.id)
        }
      }
      setDragMode(null)
      setDragStart(null)
      setDragRegionId(null)
      setDragOrigCoords(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragMode, dragStart, dragRegionId, dragOrigCoords, regions, block])

  const updateRegion = (id: string, updates: Partial<Region>) => {
    onChange({ ...block, regions: regions.map(r => r.id === id ? { ...r, ...updates } : r) })
  }

  const removeRegion = (id: string) => {
    onChange({ ...block, regions: regions.filter(r => r.id !== id) })
    if (selectedRegion === id) setSelectedRegion(null)
  }

  // AI auto-detect regions
  const [aiLoading, setAiLoading] = useState(false)
  const aiAnalyze = async () => {
    if (!block.image) return
    try {
      setAiLoading(true)
      const res = await api.post('/training/ai/analyze-screenshot', {
        screenshot_url: block.image,
        context: block.instruction || ''
      })
      const data = res.data
      if (data.regions?.length > 0) {
        const newRegions: Region[] = data.regions.map((r: any, i: number) => ({
          id: `r${Date.now()}_${i}`,
          shape: 'rect' as const,
          coords: r.coords,
          correct: r.is_primary || false,
          feedback: r.is_primary
            ? `正確！這是「${r.label}」。`
            : `這是「${r.label}」(${r.type})，請找到正確的操作位置。`
        }))
        onChange({
          ...block,
          regions: [...regions, ...newRegions],
          instruction: block.instruction || data.instruction || ''
        })
      }
      if (data.instruction && !block.instruction) {
        onChange({ ...block, instruction: data.instruction })
      }
    } catch (e: any) {
      alert(e.response?.data?.error || 'AI 分析失敗')
    } finally { setAiLoading(false) }
  }

  const selected = regions.find(r => r.id === selectedRegion)

  // Resize handle style
  const handleStyle = (cursor: string): React.CSSProperties => ({
    position: 'absolute', width: 10, height: 10,
    background: 'var(--t-accent, #38bdf8)', borderRadius: 2, cursor,
    border: '1px solid rgba(255,255,255,0.5)', zIndex: 5
  })

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--t-text-secondary)' }}>
        <MousePointer size={14} className="text-red-400" /> 熱點互動 Block
      </h3>

      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>操作指引</label>
        <input
          value={block.instruction || ''}
          onChange={e => onChange({ ...block, instruction: e.target.value })}
          className="w-full border rounded px-3 py-1.5 text-xs focus:outline-none"
          style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
          placeholder="請點擊「新增訂單」按鈕"
        />
      </div>

      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>
          截圖（在圖片上拖拉繪製熱點區域，拖拉區域邊角可調整大小）
        </label>
        {block.image ? (
          <div
            ref={imgRef}
            className="relative border rounded-lg overflow-hidden cursor-crosshair select-none"
            style={{ borderColor: 'var(--t-border)' }}
            onMouseDown={handleMouseDown}
          >
            <img ref={imgElRef} src={block.image} alt="" className="w-full" draggable={false} />
            {regions.map(r => (
              <div
                key={r.id}
                className={`absolute border-2 rounded ${
                  r.correct ? 'border-green-500 bg-green-500/15' : 'border-red-500 bg-red-500/15'
                } ${selectedRegion === r.id ? 'ring-2 ring-sky-400' : ''}`}
                style={{
                  left: `${r.coords.x}%`, top: `${r.coords.y}%`,
                  width: `${r.coords.w}%`, height: `${r.coords.h}%`,
                  cursor: dragMode ? undefined : 'move'
                }}
                onMouseDown={e => handleRegionMouseDown(e, r.id, 'move')}
              >
                <span className="absolute -top-4 left-0 text-[8px] bg-black/70 px-1 rounded text-white whitespace-nowrap">
                  {r.correct ? '✓' : '✗'} {r.id}
                </span>
                {/* Resize handles (only for selected) */}
                {selectedRegion === r.id && (
                  <>
                    <div style={{ ...handleStyle('nw-resize'), top: -5, left: -5 }}
                      onMouseDown={e => handleRegionMouseDown(e, r.id, 'resize-tl')} />
                    <div style={{ ...handleStyle('ne-resize'), top: -5, right: -5 }}
                      onMouseDown={e => handleRegionMouseDown(e, r.id, 'resize-tr')} />
                    <div style={{ ...handleStyle('sw-resize'), bottom: -5, left: -5 }}
                      onMouseDown={e => handleRegionMouseDown(e, r.id, 'resize-bl')} />
                    <div style={{ ...handleStyle('se-resize'), bottom: -5, right: -5 }}
                      onMouseDown={e => handleRegionMouseDown(e, r.id, 'resize-br')} />
                  </>
                )}
              </div>
            ))}

            {/* Phase 3A: Annotation layer — toggle visible, drag to edit */}
            {showAnnotationLayer && block.annotations?.length > 0 && (
              <AnnotationEditor
                annotations={block.annotations}
                onChange={anns => onChange({ ...block, annotations: anns })}
                imageRef={imgElRef}
              />
            )}
          </div>
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed rounded-lg py-12 flex flex-col items-center cursor-pointer transition"
            style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}
          >
            <Upload size={24} className="mb-2" />
            <p className="text-xs">{uploading ? '上傳中...' : '點擊上傳系統截圖'}</p>
            <p className="text-[10px] mt-2 flex items-center gap-1 opacity-60">
              <ClipboardPaste size={11} /> 或直接 Ctrl+V 貼上剪貼簿截圖
            </p>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        {block.image && (
          <div className="flex items-center gap-3 mt-1">
            <button onClick={aiAnalyze} disabled={aiLoading}
              className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg transition disabled:opacity-50"
              style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
              <Wand2 size={12} /> {aiLoading ? 'AI 辨識中...' : 'AI 一鍵辨識'}
            </button>
            {block.annotations?.length > 0 && (
              <button onClick={() => setShowAnnotationLayer(!showAnnotationLayer)}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition"
                style={{
                  backgroundColor: showAnnotationLayer ? 'rgba(239,68,68,0.12)' : 'var(--t-bg-card)',
                  color: showAnnotationLayer ? '#ef4444' : 'var(--t-text-dim)',
                  border: `1px solid ${showAnnotationLayer ? 'rgba(239,68,68,0.3)' : 'var(--t-border)'}`
                }}
                title="切換截圖標註參考圖層">
                {showAnnotationLayer ? '🔴 標註可見' : '⚪ 標註隱藏'} ({block.annotations.length})
              </button>
            )}
            <button onClick={() => onChange({ ...block, image: '' })}
              className="text-[10px] text-red-400 hover:text-red-300">
              移除圖片
            </button>
          </div>
        )}
      </div>

      {/* Region list & editor */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>熱點區域 ({regions.length})</label>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {regions.map(r => (
              <div key={r.id}
                onClick={() => setSelectedRegion(r.id)}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition"
                style={{
                  backgroundColor: selectedRegion === r.id ? 'var(--t-accent-subtle)' : 'transparent',
                  color: 'var(--t-text-secondary)'
                }}
              >
                <span className={`w-2 h-2 rounded-full ${r.correct ? 'bg-green-500' : 'bg-red-500'}`} />
                <span>{r.id}</span>
                <span className="flex-1 truncate" style={{ color: 'var(--t-text-dim)' }}>{r.feedback || '(無回饋)'}</span>
                <button onClick={e => { e.stopPropagation(); removeRegion(r.id) }}
                  className="text-red-400 hover:text-red-300 opacity-60 hover:opacity-100">
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {selected && (
          <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--t-bg-inset)', border: '1px solid var(--t-border)' }}>
            <div className="text-xs font-medium" style={{ color: 'var(--t-text-secondary)' }}>編輯區域 {selected.id}</div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selected.correct}
                onChange={e => updateRegion(selected.id, { correct: e.target.checked })}
                className="rounded"
              />
              <span style={{ color: selected.correct ? 'var(--t-success, #4ade80)' : 'var(--t-danger, #f87171)' }}>
                {selected.correct ? '正確區域' : '錯誤區域'}
              </span>
            </label>
            <input
              value={selected.feedback}
              onChange={e => updateRegion(selected.id, { feedback: e.target.value })}
              className="w-full border rounded px-2 py-1 text-xs focus:outline-none"
              style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
              placeholder="點擊後的回饋文字"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>最大嘗試次數</label>
          <input type="number" value={block.max_attempts || 3}
            onChange={e => onChange({ ...block, max_attempts: Number(e.target.value) })}
            className="w-full border rounded px-2 py-1 text-xs"
            style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>錯幾次後顯示提示</label>
          <input type="number" value={block.show_hint_after || 2}
            onChange={e => onChange({ ...block, show_hint_after: Number(e.target.value) })}
            className="w-full border rounded px-2 py-1 text-xs"
            style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
        </div>
      </div>

      {/* Phase 3A-2: Language-specific base image management */}
      {slideId && (
        <LanguageImagePanel slideId={slideId} blockIndex={blockIdx ?? 0} currentImage={block.image} regions={block.regions || []} />
      )}
    </div>
  )
}
