import { useState, useRef, useEffect, useCallback } from 'react'
import { Trash2, Upload, MousePointer, Pen, ClipboardPaste, Wand2, Plus, GripVertical, RefreshCw, Volume2, Loader2, Sparkles } from 'lucide-react'
import api from '../../../../lib/api'
import type { Block } from '../SlideEditor'
import LanguageImagePanel from './LanguageImagePanel'
import AnnotationOverlay from '../../blocks/AnnotationOverlay'
import VoiceInput from './VoiceInput'

interface Region {
  id: string
  shape: 'rect' | 'circle'
  coords: { x: number; y: number; w: number; h: number }
  correct: boolean
  feedback: string
  label?: string
}

interface Props {
  block: Block
  onChange: (b: Block) => void
  courseId: number
  slideId?: number
  blockIdx?: number
}

type DragMode = null | 'draw' | 'move' | 'resize-br' | 'resize-bl' | 'resize-tr' | 'resize-tl'
type EditorMode = 'select' | 'draw'

export default function HotspotEditor({ block, onChange, courseId, slideId, blockIdx }: Props) {
  const [editorMode, setEditorMode] = useState<EditorMode>('select')
  const [dragMode, setDragMode] = useState<DragMode>(null)
  const [showAnnotationLayer, setShowAnnotationLayer] = useState(true)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragRegionId, setDragRegionId] = useState<string | null>(null)
  const [dragOrigCoords, setDragOrigCoords] = useState<Region['coords'] | null>(null)
  const [drawPreview, setDrawPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const imgRef = useRef<HTMLDivElement>(null)
  const imgElRef = useRef<HTMLImageElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const replaceFileRef = useRef<HTMLInputElement>(null)

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
    const p = toPercent(e)
    if (editorMode === 'draw') {
      // Draw mode: always start drawing a new region
      setDragStart(p)
      setDragMode('draw')
      setDrawPreview(null)
    }
    // Select mode: clicking empty area deselects
    // (region clicks handled by handleRegionMouseDown)
    if (editorMode === 'select') {
      setSelectedRegion(null)
    }
  }

  const handleRegionMouseDown = (e: React.MouseEvent, regionId: string, mode: DragMode) => {
    e.stopPropagation()
    e.preventDefault()
    if (editorMode === 'draw') return // don't interact with regions in draw mode
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
        // Live preview for drawing
        const x1 = Math.min(dragStart.x, p.x), y1 = Math.min(dragStart.y, p.y)
        const w = Math.abs(p.x - dragStart.x), h = Math.abs(p.y - dragStart.y)
        setDrawPreview({ x: x1, y: y1, w, h })
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
        setDrawPreview(null)
        // Auto-switch back to select mode after drawing
        setEditorMode('select')
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

  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // Add a default region at center of image
  const addRegionAtCenter = () => {
    const newRegion: Region = {
      id: `r${Date.now()}`,
      shape: 'rect',
      coords: { x: 35, y: 35, w: 30, h: 15 },
      correct: true,
      feedback: ''
    }
    onChange({ ...block, regions: [...regions, newRegion] })
    setSelectedRegion(newRegion.id)
  }

  // AI auto-detect regions
  const [aiLoading, setAiLoading] = useState(false)
  const [ttsLoading, setTtsLoading] = useState<string | null>(null)
  const [narrationLoading, setNarrationLoading] = useState(false)
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
          label: r.label || '',
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
          截圖
        </label>
        {block.image ? (
          <>
            {/* Mode toggle toolbar */}
            <div className="flex items-center gap-1 mb-1.5">
              <button
                onClick={() => setEditorMode('select')}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition font-medium"
                style={{
                  backgroundColor: editorMode === 'select' ? 'var(--t-accent-subtle)' : 'transparent',
                  color: editorMode === 'select' ? 'var(--t-accent)' : 'var(--t-text-dim)',
                  border: `1px solid ${editorMode === 'select' ? 'var(--t-accent)' : 'var(--t-border)'}`
                }}
                title="選取模式：點擊/拖移/調整已有區域"
              >
                <MousePointer size={12} /> 選取
              </button>
              <button
                onClick={() => setEditorMode('draw')}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition font-medium"
                style={{
                  backgroundColor: editorMode === 'draw' ? 'rgba(34,197,94,0.12)' : 'transparent',
                  color: editorMode === 'draw' ? '#22c55e' : 'var(--t-text-dim)',
                  border: `1px solid ${editorMode === 'draw' ? '#22c55e' : 'var(--t-border)'}`
                }}
                title="繪製模式：在圖上拖拉畫新區域"
              >
                <Pen size={12} /> 繪製
              </button>
              <div className="flex-1" />
              <button onClick={addRegionAtCenter}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition"
                style={{ color: 'var(--t-accent)', border: '1px solid var(--t-border)' }}
                title="在圖片中央新增一個區域"
              >
                <Plus size={11} /> 新增區域
              </button>
            </div>

            <div
              ref={imgRef}
              className="relative border rounded-lg overflow-hidden select-none"
              style={{
                borderColor: editorMode === 'draw' ? '#22c55e' : 'var(--t-border)',
                cursor: editorMode === 'draw' ? 'crosshair' : 'default'
              }}
              onMouseDown={handleMouseDown}
            >
              <img ref={imgElRef} src={block.image} alt="" className="w-full" draggable={false} />

              {/* Existing regions */}
              {regions.map(r => (
                <div
                  key={r.id}
                  className={`absolute border-2 rounded ${
                    r.correct ? 'border-green-500 bg-green-500/15' : 'border-red-500 bg-red-500/15'
                  } ${selectedRegion === r.id ? 'ring-2 ring-sky-400' : ''}`}
                  style={{
                    left: `${r.coords.x}%`, top: `${r.coords.y}%`,
                    width: `${r.coords.w}%`, height: `${r.coords.h}%`,
                    cursor: editorMode === 'select' ? (dragMode ? undefined : 'move') : 'crosshair',
                    pointerEvents: editorMode === 'draw' ? 'none' : 'auto'
                  }}
                  onMouseDown={e => handleRegionMouseDown(e, r.id, 'move')}
                >
                  <span className="absolute -top-5 left-0 text-[9px] bg-black/70 px-1.5 py-0.5 rounded text-white whitespace-nowrap">
                    {r.correct ? '✓' : '✗'} {r.label || r.id}
                  </span>
                  {/* Resize handles (only for selected in select mode) */}
                  {editorMode === 'select' && selectedRegion === r.id && (
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

              {/* Draw preview rectangle */}
              {dragMode === 'draw' && drawPreview && drawPreview.w > 0.5 && drawPreview.h > 0.5 && (
                <div
                  className="absolute border-2 border-dashed border-sky-400 bg-sky-400/10 rounded pointer-events-none"
                  style={{
                    left: `${drawPreview.x}%`, top: `${drawPreview.y}%`,
                    width: `${drawPreview.w}%`, height: `${drawPreview.h}%`
                  }}
                />
              )}

              {/* Phase 3A: Annotation layer — read-only display, pointerEvents none so regions can be dragged */}
              {showAnnotationLayer && block.annotations?.length > 0 && (
                <AnnotationOverlay annotations={block.annotations} visible={true} />
              )}
            </div>
          </>
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
        <input ref={replaceFileRef} type="file" accept="image/*" className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            await uploadImageFile(file, file.name)
            // regions, annotations, feedback 等全部保留，只換 image
            if (replaceFileRef.current) replaceFileRef.current.value = ''
          }}
        />
        {block.image && (
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <button onClick={aiAnalyze} disabled={aiLoading}
              className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg transition disabled:opacity-50"
              style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
              <Wand2 size={12} /> {aiLoading ? 'AI 辨識中...' : 'AI 一鍵辨識'}
            </button>
            <button onClick={() => replaceFileRef.current?.click()} disabled={uploading}
              className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg transition disabled:opacity-50"
              style={{ color: 'var(--t-text-secondary)', border: '1px solid var(--t-border)' }}>
              <RefreshCw size={12} /> {uploading ? '上傳中...' : '抽換底圖'}
            </button>
            <button onClick={() => setShowAnnotationLayer(!showAnnotationLayer)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition"
              style={{
                backgroundColor: showAnnotationLayer ? 'rgba(239,68,68,0.12)' : 'var(--t-bg-card)',
                color: showAnnotationLayer ? '#ef4444' : 'var(--t-text-dim)',
                border: `1px solid ${showAnnotationLayer ? 'rgba(239,68,68,0.3)' : 'var(--t-border)'}`
              }}
              title="切換截圖標註參考圖層">
              {showAnnotationLayer ? '🔴 標註可見' : '⚪ 標註隱藏'}
              {block.annotations?.length > 0 ? ` (${block.annotations.length})` : ''}
            </button>
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
            {regions.map((r, idx) => (
              <div key={r.id}
                draggable
                onDragStart={e => {
                  setDragFromIdx(idx)
                  e.dataTransfer.effectAllowed = 'move'
                  ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                }}
                onDragEnd={e => {
                  ;(e.currentTarget as HTMLElement).style.opacity = '1'
                  setDragFromIdx(null)
                  setDragOverIdx(null)
                }}
                onDragOver={e => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverIdx(idx)
                }}
                onDragLeave={() => { if (dragOverIdx === idx) setDragOverIdx(null) }}
                onDrop={e => {
                  e.preventDefault()
                  setDragOverIdx(null)
                  if (dragFromIdx === null || dragFromIdx === idx) return
                  const newRegions = [...regions]
                  const [moved] = newRegions.splice(dragFromIdx, 1)
                  newRegions.splice(idx, 0, moved)
                  onChange({ ...block, regions: newRegions })
                  setDragFromIdx(null)
                }}
                onClick={() => setSelectedRegion(r.id)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs cursor-pointer transition"
                style={{
                  backgroundColor: selectedRegion === r.id ? 'var(--t-accent-subtle)' : 'transparent',
                  color: 'var(--t-text-secondary)',
                  borderTop: dragOverIdx === idx && dragFromIdx !== null && dragFromIdx !== idx ? '2px solid var(--t-accent, #3b82f6)' : '2px solid transparent'
                }}
              >
                <GripVertical size={12} className="shrink-0 cursor-grab opacity-40 hover:opacity-100 transition" style={{ color: 'var(--t-text-dim)' }} />
                <span className={`w-2 h-2 rounded-full shrink-0 ${r.correct ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="font-medium shrink-0">{r.label || r.id}</span>
                <span className="flex-1 truncate" style={{ color: 'var(--t-text-dim)' }}>{r.feedback || '(無回饋)'}</span>
                <button onClick={e => { e.stopPropagation(); removeRegion(r.id) }}
                  className="text-red-400 hover:text-red-300 opacity-60 hover:opacity-100 shrink-0">
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
            {regions.length === 0 && (
              <div className="text-[10px] py-3 text-center" style={{ color: 'var(--t-text-dim)' }}>
                尚無互動區域。使用繪製模式或 AI 辨識來新增。
              </div>
            )}
          </div>
        </div>

        {selected && (
          <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--t-bg-inset)', border: '1px solid var(--t-border)' }}>
            <div className="text-xs font-medium" style={{ color: 'var(--t-text-secondary)' }}>編輯區域 {selected.id}</div>
            <div>
              <label className="text-[10px] mb-0.5 block" style={{ color: 'var(--t-text-dim)' }}>標籤名稱</label>
              <input
                value={selected.label || ''}
                onChange={e => updateRegion(selected.id, { label: e.target.value })}
                className="w-full border rounded px-2 py-1 text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder="例：帳號欄位、送出按鈕"
              />
            </div>
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
            <div>
              <label className="text-[10px] mb-0.5 block" style={{ color: 'var(--t-text-dim)' }}>回饋文字</label>
              <input
                value={selected.feedback}
                onChange={e => updateRegion(selected.id, { feedback: e.target.value })}
                className="w-full border rounded px-2 py-1 text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                placeholder="點擊後的回饋文字"
              />
            </div>
          </div>
        )}
      </div>

      {/* Interaction mode + settings */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>互動模式</label>
          <div className="flex gap-1">
            <button
              onClick={() => onChange({ ...block, interaction_mode: 'guided' })}
              className="flex-1 text-[10px] py-1 rounded transition font-medium"
              style={{
                backgroundColor: (block.interaction_mode || 'guided') === 'guided' ? 'var(--t-accent-subtle)' : 'transparent',
                color: (block.interaction_mode || 'guided') === 'guided' ? 'var(--t-accent)' : 'var(--t-text-dim)',
                border: `1px solid ${(block.interaction_mode || 'guided') === 'guided' ? 'var(--t-accent)' : 'var(--t-border)'}`
              }}>
              🎯 導引
            </button>
            <button
              onClick={() => onChange({ ...block, interaction_mode: 'explore' })}
              className="flex-1 text-[10px] py-1 rounded transition font-medium"
              style={{
                backgroundColor: block.interaction_mode === 'explore' ? 'rgba(168,85,247,0.12)' : 'transparent',
                color: block.interaction_mode === 'explore' ? '#a855f7' : 'var(--t-text-dim)',
                border: `1px solid ${block.interaction_mode === 'explore' ? '#a855f7' : 'var(--t-border)'}`
              }}>
              🔍 探索
            </button>
          </div>
        </div>
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

      {/* ═══ Voice Narration Panel ═══ */}
      {slideId && regions.filter(r => r.correct).length > 0 && (
        <div className="border rounded-lg p-3 space-y-3" style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))' }}>
          <div className="flex items-center gap-2">
            <Volume2 size={12} style={{ color: 'var(--t-accent)' }} />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>語音導覽</span>
          </div>

          {/* Editor context */}
          <div>
            <label className="text-[10px] mb-0.5 block" style={{ color: 'var(--t-text-dim)' }}>
              💬 補充說明（AI 生成腳本時會參考）
            </label>
            <textarea
              value={block.editor_context || ''}
              onChange={e => onChange({ ...block, editor_context: e.target.value })}
              rows={2}
              className="w-full border rounded text-xs px-2 py-1.5 resize-none focus:outline-none"
              style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
              placeholder="例：本系統為正崴集團企業智慧對話平台，新進員工首次登入需向 IT 申請帳號..."
            />
          </div>

          {/* AI Generate button */}
          <button
            onClick={async () => {
              try {
                setNarrationLoading(true)
                const res = await api.post(`/training/slides/${slideId}/generate-narration`, {
                  block_index: blockIdx ?? 0,
                  editor_context: block.editor_context || ''
                }, { timeout: 60000 })
                const data = res.data
                const updatedRegions = [...regions]
                if (data.regions?.length > 0) {
                  for (const aiR of data.regions) {
                    const match = updatedRegions.find(r => r.id === aiR.id) ||
                      updatedRegions.filter(r => r.correct)[data.regions.indexOf(aiR)]
                    if (match) {
                      if (aiR.narration) (match as any).narration = aiR.narration
                      if (aiR.test_hint) (match as any).test_hint = aiR.test_hint
                      if (aiR.explore_desc) (match as any).explore_desc = aiR.explore_desc
                      if (aiR.feedback_correct) match.feedback = aiR.feedback_correct
                      if (aiR.feedback_wrong) (match as any).feedback_wrong = aiR.feedback_wrong
                    }
                  }
                }
                const newBlock = {
                  ...block, regions: updatedRegions,
                  slide_narration: data.slide_narration || block.slide_narration || '',
                  slide_narration_test: data.slide_narration_test || '',
                  slide_narration_explore: data.slide_narration_explore || '',
                  completion_message: data.completion_message || ''
                }
                onChange(newBlock)

                // ── Auto TTS: generate all audio files ──
                setTtsLoading('batch')
                try {
                  // 1. Slide-level intro narrations (3 modes)
                  const introFields = [
                    { text: 'slide_narration', audio: 'slide_narration_audio', id: 'intro_guided' },
                    { text: 'slide_narration_test', audio: 'slide_narration_test_audio', id: 'intro_test' },
                    { text: 'slide_narration_explore', audio: 'slide_narration_explore_audio', id: 'intro_explore' },
                  ]
                  for (const f of introFields) {
                    if ((newBlock as any)[f.text]) {
                      try {
                        const ttsRes = await api.post(`/training/slides/${slideId}/region-tts`, {
                          block_index: blockIdx ?? 0, region_id: f.id, text: (newBlock as any)[f.text]
                        })
                        ;(newBlock as any)[f.audio] = ttsRes.data.audio_url
                      } catch {}
                    }
                  }

                  // 2. Per-region audio (narration + test_hint + explore_desc)
                  const pairs = [
                    { textField: 'narration', audioField: 'audio_url', prefix: '' },
                    { textField: 'test_hint', audioField: 'test_audio_url', prefix: 'test_hint_' },
                    { textField: 'explore_desc', audioField: 'explore_audio_url', prefix: 'explore_desc_' },
                  ]
                  for (const r of newBlock.regions.filter((r: any) => r.correct)) {
                    for (const p of pairs) {
                      if ((r as any)[p.textField]) {
                        try {
                          const ttsRes = await api.post(`/training/slides/${slideId}/region-tts`, {
                            block_index: blockIdx ?? 0, region_id: `${p.prefix}${r.id}`, text: (r as any)[p.textField]
                          })
                          ;(r as any)[p.audioField] = ttsRes.data.audio_url
                        } catch {}
                      }
                    }
                  }
                  onChange({ ...newBlock })
                } catch {}
                finally { setTtsLoading(null) }
              } catch (e: any) { alert(e.response?.data?.error || 'AI 生成失敗') }
              finally { setNarrationLoading(false) }
            }}
            disabled={narrationLoading || ttsLoading === 'batch'}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium px-3 py-2 rounded-lg transition disabled:opacity-50"
            style={{ backgroundColor: 'rgba(168,85,247,0.12)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}
          >
            {narrationLoading || ttsLoading === 'batch' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {narrationLoading ? 'AI 腳本生成中...' : ttsLoading === 'batch' ? 'TTS 語音生成中...' : '✨ AI 生成全套導覽腳本 + 語音'}
          </button>

          {/* 3-mode slide intro narration */}
          {(block.slide_narration || block.slide_narration_test || block.slide_narration_explore) && (
            <div className="rounded p-2 space-y-1.5" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
              <label className="text-[10px] font-medium block" style={{ color: 'var(--t-text-secondary)' }}>📢 前導語音</label>
              {[
                { key: 'slide_narration', audioKey: 'slide_narration_audio', icon: '🎯', label: '導引', color: 'var(--t-accent)', ttsId: 'intro_guided' },
                { key: 'slide_narration_test', audioKey: 'slide_narration_test_audio', icon: '📝', label: '測驗', color: '#f59e0b', ttsId: 'intro_test' },
                { key: 'slide_narration_explore', audioKey: 'slide_narration_explore_audio', icon: '🔍', label: '探索', color: '#a855f7', ttsId: 'intro_explore' },
              ].map(m => (
                <div key={m.key}>
                  <label className="text-[9px]" style={{ color: m.color }}>{m.icon} {m.label}模式</label>
                  <textarea value={block[m.key] || ''} onChange={e => onChange({ ...block, [m.key]: e.target.value })}
                    rows={1} className="w-full border rounded text-[10px] px-2 py-0.5 resize-none focus:outline-none"
                    style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
                  {slideId && (
                    <VoiceInput text={block[m.key] || ''} audioUrl={block[m.audioKey] || null}
                      slideId={slideId} regionId={m.ttsId}
                      onAudioChange={(url: string | null) => onChange({ ...block, [m.audioKey]: url })} />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Completion message */}
          {block.completion_message && (
            <div>
              <label className="text-[10px] mb-0.5 block" style={{ color: 'var(--t-text-dim)' }}>🎉 完成訊息</label>
              <input value={block.completion_message || ''} onChange={e => onChange({ ...block, completion_message: e.target.value })}
                className="w-full border rounded px-2 py-1 text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
            </div>
          )}

          {/* Per-region narration summary */}
          <div className="space-y-2">
            <label className="text-[10px] block" style={{ color: 'var(--t-text-dim)' }}>步驟導覽（{regions.filter(r => r.correct).length} 步）</label>
            {regions.filter(r => r.correct).map((r, idx) => (
              <div key={r.id} className="rounded p-2 space-y-1.5" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                <div className="text-[10px] font-medium flex items-center gap-1.5" style={{ color: 'var(--t-text-secondary)' }}>
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{ backgroundColor: 'var(--t-accent)', color: 'white' }}>{idx + 1}</span>
                  {r.label || r.id}
                </div>
                {[
                  { field: 'narration', audioField: 'audio_url', icon: '📖', label: '學習導引', ph: '學習模式語音導引...', ttsPrefix: '' },
                  { field: 'test_hint', audioField: 'test_audio_url', icon: '📝', label: '測驗提示', ph: '測驗模式鼓勵提示...', ttsPrefix: 'test_hint_' },
                  { field: 'explore_desc', audioField: 'explore_audio_url', icon: '🔍', label: '探索說明', ph: '探索模式元素說明...', ttsPrefix: 'explore_desc_' },
                ].map(m => (
                  <div key={m.field}>
                    <label className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>{m.icon} {m.label}</label>
                    <input value={(r as any)[m.field] || ''}
                      onChange={e => updateRegion(r.id, { [m.field]: e.target.value } as any)}
                      className="w-full border rounded px-2 py-0.5 text-[10px] focus:outline-none"
                      style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                      placeholder={m.ph} />
                    {slideId && (
                      <VoiceInput text={(r as any)[m.field] || ''} audioUrl={(r as any)[m.audioField] || null}
                        slideId={slideId} regionId={`${m.ttsPrefix}${r.id}`}
                        onAudioChange={(url: string | null) => updateRegion(r.id, { [m.audioField]: url } as any)} />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Batch TTS */}
          <button
            onClick={async () => {
              const correctRegs = regions.filter(r => r.correct)
              const pairs = [
                { textField: 'narration', audioField: 'audio_url', prefix: '' },
                { textField: 'test_hint', audioField: 'test_audio_url', prefix: 'test_hint_' },
                { textField: 'explore_desc', audioField: 'explore_audio_url', prefix: 'explore_desc_' },
              ]
              const hasPending = correctRegs.some((r: any) => pairs.some(p => r[p.textField] && !r[p.audioField]))
              if (!hasPending) return alert('所有語音已生成完畢')
              setTtsLoading('batch')
              try {
                for (const r of correctRegs) {
                  for (const p of pairs) {
                    if ((r as any)[p.textField] && !(r as any)[p.audioField]) {
                      const res = await api.post(`/training/slides/${slideId}/region-tts`, {
                        block_index: blockIdx ?? 0, region_id: `${p.prefix}${r.id}`, text: (r as any)[p.textField]
                      })
                      updateRegion(r.id, { [p.audioField]: res.data.audio_url } as any)
                    }
                  }
                }
              } catch (e: any) { alert(e.response?.data?.error || 'TTS 批次生成失敗') }
              finally { setTtsLoading(null) }
            }}
            disabled={ttsLoading === 'batch'}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50"
            style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}
          >
            {ttsLoading === 'batch' ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
            🔊 一鍵生成所有語音（學習 + 測驗）
          </button>
        </div>
      )}

      {/* Phase 3A-2: Language-specific base image management */}
      {slideId && (
        <LanguageImagePanel slideId={slideId} blockIndex={blockIdx ?? 0} currentImage={block.image} regions={block.regions || []} />
      )}
    </div>
  )
}
