/**
 * Phase 3B: LanguageImagePanel — 多語底圖管理 + 獨立 Region 管理
 * 每個語言可以擁有完全獨立的 region 集合，或繼承主語言。
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Trash2, Globe, Save, Maximize2, X, Copy, Plus, MousePointer, Pen, RotateCcw, Sparkles, Volume2, Loader2, ImagePlus, Columns, Rows, Eye, RefreshCw } from 'lucide-react'
import api from '../../../../lib/api'
import VoiceInput from './VoiceInput'

interface Region {
  id: string
  shape?: 'rect' | 'circle'
  coords: { x: number; y: number; w: number; h: number }
  correct?: boolean
  feedback?: string
  label?: string
  [key: string]: any
}

interface Props {
  slideId: number
  blockIndex: number
  currentImage?: string
  regions?: Region[]
}

const LANGS = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
]

type ModalDragMode = null | 'draw' | 'move' | 'resize'
type ModalEditorMode = 'select' | 'draw'

export default function LanguageImagePanel({ slideId, blockIndex, currentImage, regions = [] }: Props) {
  const [overrides, setOverrides] = useState<Record<string, any>>({})
  const [activeLang, setActiveLang] = useState('en')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Independent language regions: { "en": { "0": [...regions] }, "vi": { "0": [...] } }
  const [langRegions, setLangRegions] = useState<Record<string, Record<string, Region[]>>>({})
  // Translated block data: { "en": { "0": { regions: [...], intro: {...} } } }
  const [translatedBlocks, setTranslatedBlocks] = useState<Record<string, Record<string, any>>>({})
  const [copyDropdown, setCopyDropdown] = useState(false)
  const [narrationLoading, setNarrationLoading] = useState(false)
  const [ttsLoading, setTtsLoading] = useState<string | null>(null)
  const [voiceMode, setVoiceMode] = useState<'all' | 'guided' | 'test' | 'explore'>('all')
  // Language-specific intro narrations stored in langRegions[lang]._intro
  const [langIntro, setLangIntro] = useState<Record<string, any>>({})
  const [editModal, setEditModal] = useState(false)
  const [modalMode, setModalMode] = useState<ModalEditorMode>('select')
  const [modalSelected, setModalSelected] = useState<string | null>(null)
  const [drawPreview, setDrawPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dragging, setDragging] = useState<{
    mode: ModalDragMode; id?: string;
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number
  } | null>(null)
  const modalImgRef = useRef<HTMLImageElement>(null)
  const [dragOverPreview, setDragOverPreview] = useState(false)
  const [dragOverModal, setDragOverModal] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Composite dialog state
  const [compositeOpen, setCompositeOpen] = useState(false)
  const [compLeft, setCompLeft] = useState<string | null>(null)   // data URL or server URL
  const [compRight, setCompRight] = useState<string | null>(null)
  const [compDirection, setCompDirection] = useState<'horizontal' | 'vertical'>('horizontal')
  const [compGap, setCompGap] = useState(4)
  const [compPreview, setCompPreview] = useState<string | null>(null)
  const [compUploading, setCompUploading] = useState(false)
  const compLeftInputRef = useRef<HTMLInputElement>(null)
  const compRightInputRef = useRef<HTMLInputElement>(null)
  const modalAudioRef = useRef<HTMLAudioElement>(null)
  const [diffMode, setDiffMode] = useState(false)
  // Bulk coords transform
  const [coordsOffsetX, setCoordsOffsetX] = useState(0)
  const [coordsOffsetY, setCoordsOffsetY] = useState(0)
  const [coordsScale, setCoordsScale] = useState(100)

  // Legacy region overrides (backward compat)
  const [regionOverrides, setRegionOverrides] = useState<Record<string, Record<string, any>>>({})

  useEffect(() => {
    // Load image overrides + legacy region overrides
    api.get(`/training/slides/${slideId}/lang-images`).then(res => {
      const data = res.data || {}
      setOverrides(data)
      const rOvr: Record<string, Record<string, any>> = {}
      for (const [lang, val] of Object.entries(data)) {
        if ((val as any)?.region_overrides) rOvr[lang] = (val as any).region_overrides
      }
      setRegionOverrides(rOvr)
    }).catch(() => {})

    // Load independent language regions + intro + translated blocks
    api.get(`/training/slides/${slideId}/lang-regions`).then(res => {
      const data = res.data || {}
      const { _translated, ...langData } = data
      setLangRegions(langData)
      setTranslatedBlocks(_translated || {})
      // Extract _intro per language
      const intros: Record<string, any> = {}
      for (const [lang, val] of Object.entries(langData)) {
        if ((val as any)?._intro) intros[lang] = (val as any)._intro
      }
      setLangIntro(intros)
    }).catch(() => {})
  }, [slideId])

  const langImage = overrides[activeLang]?.[String(blockIndex)]

  const handleUpload = useCallback(async (file: File) => {
    try {
      setUploading(true)
      const form = new FormData()
      form.append('file', file)
      form.append('lang', activeLang)
      form.append('block_index', String(blockIndex))
      const res = await api.post(`/training/slides/${slideId}/lang-image`, form)
      setOverrides(prev => ({ ...prev, [activeLang]: res.data.overrides }))
    } catch (e: any) { alert(e.response?.data?.error || '上傳失敗') }
    finally { setUploading(false) }
  }, [activeLang, blockIndex, slideId])

  const handleDelete = async () => {
    if (!confirm('確定刪除此語言底圖？')) return
    try {
      await api.delete(`/training/slides/${slideId}/lang-image`, {
        data: { lang: activeLang, block_index: String(blockIndex) }
      })
      setOverrides(prev => {
        const copy = { ...prev }
        if (copy[activeLang]) { delete copy[activeLang][String(blockIndex)] }
        return copy
      })
    } catch {}
  }

  // --- Drag & drop / clipboard paste ---
  const onDropFile = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    setDragOverPreview(false); setDragOverModal(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) handleUpload(file)
  }, [handleUpload])

  const onDragOverFile = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
  }, [])

  // --- Composite helpers ---
  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(file) })

  const loadImg = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = reject; img.src = src })

  const onCompSlotFile = useCallback(async (file: File, slot: 'left' | 'right') => {
    if (!file.type.startsWith('image/')) return
    const url = await fileToDataUrl(file)
    if (slot === 'left') setCompLeft(url)
    else setCompRight(url)
    setCompPreview(null)
  }, [])

  // Paste listener — active when modal or composite dialog is open.
  // ⚠️ Uses capture phase + stopImmediatePropagation to BLOCK the HotspotEditor's
  // global paste listener from running, otherwise a Ctrl+V inside the lang-image
  // modal would ALSO overwrite the master block.image (leaking VI image onto ZH).
  useEffect(() => {
    if (!editModal && !compositeOpen) return
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (!file) continue
          e.preventDefault()
          e.stopImmediatePropagation() // block HotspotEditor's paste from overwriting master image
          if (compositeOpen) {
            onCompSlotFile(file, compRight ? 'left' : 'right')
          } else {
            handleUpload(file)
          }
          return
        }
      }
    }
    // capture=true ensures we run BEFORE any bubble-phase listeners registered
    // by parents like HotspotEditor (which listens in bubble phase).
    document.addEventListener('paste', handler, true)
    return () => document.removeEventListener('paste', handler, true)
  }, [editModal, compositeOpen, handleUpload, onCompSlotFile, compRight])

  const openComposite = useCallback(() => {
    setCompLeft(langImage || currentImage || null)
    setCompRight(null)
    setCompPreview(null)
    setCompDirection('horizontal')
    setCompGap(4)
    setCompositeOpen(true)
  }, [langImage, currentImage])

  const generateComposite = useCallback(async () => {
    if (!compLeft || !compRight) return
    try {
      const [imgL, imgR] = await Promise.all([loadImg(compLeft), loadImg(compRight)])
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const gap = compGap

      if (compDirection === 'horizontal') {
        const targetH = Math.min(imgL.naturalHeight, imgR.naturalHeight)
        const scaleL = targetH / imgL.naturalHeight
        const scaleR = targetH / imgR.naturalHeight
        const wL = imgL.naturalWidth * scaleL
        const wR = imgR.naturalWidth * scaleR
        canvas.width = Math.round(wL + gap + wR)
        canvas.height = Math.round(targetH)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(imgL, 0, 0, wL, targetH)
        ctx.drawImage(imgR, wL + gap, 0, wR, targetH)
      } else {
        const targetW = Math.min(imgL.naturalWidth, imgR.naturalWidth)
        const scaleL = targetW / imgL.naturalWidth
        const scaleR = targetW / imgR.naturalWidth
        const hL = imgL.naturalHeight * scaleL
        const hR = imgR.naturalHeight * scaleR
        canvas.width = Math.round(targetW)
        canvas.height = Math.round(hL + gap + hR)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(imgL, 0, 0, targetW, hL)
        ctx.drawImage(imgR, 0, hL + gap, targetW, hR)
      }
      setCompPreview(canvas.toDataURL('image/png'))
    } catch { alert('圖片載入失敗，請確認圖片是否可存取') }
  }, [compLeft, compRight, compDirection, compGap])

  const confirmComposite = useCallback(async () => {
    if (!compPreview) return
    try {
      setCompUploading(true)
      const res = await fetch(compPreview)
      const blob = await res.blob()
      const file = new File([blob], `composite_${activeLang}_${Date.now()}.png`, { type: 'image/png' })
      await handleUpload(file)
      setCompositeOpen(false)
    } catch (e: any) { alert('合成上傳失敗') }
    finally { setCompUploading(false) }
  }, [compPreview, activeLang, handleUpload])

  // --- Independent regions helpers ---
  const hasIndependentRegions = !!(langRegions[activeLang]?.[String(blockIndex)])
  const independentRegions: Region[] = langRegions[activeLang]?.[String(blockIndex)] || []

  const translatedBlock = translatedBlocks[activeLang]?.[String(blockIndex)]
  const hasTranslation = !!(translatedBlock?.regions?.length)

  const getDisplayRegions = (): Region[] => {
    if (hasIndependentRegions) return independentRegions
    // Translated regions take priority in inherit mode
    if (hasTranslation) return translatedBlock.regions
    // Fallback: main regions with legacy coordinate overrides
    const ovr = regionOverrides[activeLang] || {}
    return regions.map(r => ({
      ...r,
      coords: ovr[r.id] ? { ...r.coords, ...ovr[r.id] } : r.coords
    }))
  }

  const createIndependentRegions = () => {
    let seedRegions: Region[]
    let seedIntro: any = null

    if (hasTranslation) {
      // Seed from translated content (English text + audio URLs)
      seedRegions = translatedBlock.regions.map((r: any) => ({ ...r }))
      seedIntro = translatedBlock.intro || null
    } else {
      // Fallback: copy from main language (zh-TW)
      seedRegions = regions.map(r => ({ ...r }))
    }

    setLangRegions(prev => ({
      ...prev,
      [activeLang]: { ...(prev[activeLang] || {}), [String(blockIndex)]: seedRegions }
    }))
    if (seedIntro) {
      setLangIntro(prev => ({
        ...prev,
        [activeLang]: { ...(prev[activeLang] || {}), ...seedIntro }
      }))
    }
  }

  const copyFromLanguage = (sourceLang: string) => {
    let source: Region[]
    if (sourceLang === 'main') {
      source = regions.map(r => ({ ...r }))
    } else {
      source = (langRegions[sourceLang]?.[String(blockIndex)] || regions).map(r => ({ ...r }))
    }
    setLangRegions(prev => ({
      ...prev,
      [activeLang]: { ...(prev[activeLang] || {}), [String(blockIndex)]: source }
    }))
  }

  const revertToInherit = async () => {
    if (!confirm('確定移除此語言的獨立區域？將回到繼承主語言。')) return
    try {
      await api.delete(`/training/slides/${slideId}/lang-regions`, {
        data: { lang: activeLang, block_index: blockIndex }
      })
      setLangRegions(prev => {
        const copy = { ...prev }
        if (copy[activeLang]) { delete copy[activeLang][String(blockIndex)] }
        return copy
      })
    } catch (e: any) { alert(e.response?.data?.error || '操作失敗') }
  }

  const saveIndependentRegions = async () => {
    try {
      setSaving(true)
      await api.put(`/training/slides/${slideId}/lang-regions`, {
        lang: activeLang,
        block_index: blockIndex,
        regions: langRegions[activeLang]?.[String(blockIndex)] || [],
        _intro: langIntro[activeLang] || undefined
      })
    } catch (e: any) { alert(e.response?.data?.error || '儲存失敗') }
    finally { setSaving(false) }
  }

  // Generate TTS for a single text field and return audio URL
  const genSingleTts = useCallback(async (text: string, regionId: string): Promise<string | null> => {
    if (!text) return null
    try {
      const r = await api.post(`/training/slides/${slideId}/region-tts`, {
        block_index: blockIndex, region_id: regionId, text, language: activeLang
      })
      return r.data.audio_url
    } catch { return null }
  }, [slideId, blockIndex, activeLang])

  // Update an intro field + optionally regenerate TTS
  const updateIntroField = useCallback((field: string, value: string) => {
    setLangIntro(prev => ({
      ...prev,
      [activeLang]: { ...(prev[activeLang] || {}), [field]: value }
    }))
  }, [activeLang])

  // Update a region in the independent set
  const updateLangRegion = (regionId: string, updates: Partial<Region>) => {
    setLangRegions(prev => {
      const key = String(blockIndex)
      const current = prev[activeLang]?.[key] || []
      return {
        ...prev,
        [activeLang]: {
          ...(prev[activeLang] || {}),
          [key]: current.map(r => r.id === regionId ? { ...r, ...updates } : r)
        }
      }
    })
  }

  const removeLangRegion = (regionId: string) => {
    setLangRegions(prev => {
      const key = String(blockIndex)
      const current = prev[activeLang]?.[key] || []
      return {
        ...prev,
        [activeLang]: {
          ...(prev[activeLang] || {}),
          [key]: current.filter(r => r.id !== regionId)
        }
      }
    })
    if (modalSelected === regionId) setModalSelected(null)
  }

  const addLangRegionAtCenter = () => {
    const newRegion: Region = {
      id: `r${Date.now()}`,
      shape: 'rect',
      coords: { x: 35, y: 35, w: 30, h: 15 },
      correct: true,
      feedback: ''
    }
    setLangRegions(prev => {
      const key = String(blockIndex)
      const current = prev[activeLang]?.[key] || []
      return {
        ...prev,
        [activeLang]: { ...(prev[activeLang] || {}), [key]: [...current, newRegion] }
      }
    })
    setModalSelected(newRegion.id)
  }

  // ---- Modal drag/draw ----
  const toPct = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!modalImgRef.current) return { x: 0, y: 0 }
    const rect = modalImgRef.current.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 }
  }, [])

  const handleModalMouseDown = (e: React.MouseEvent) => {
    if (modalMode === 'draw') {
      const pt = toPct(e)
      setDragging({ mode: 'draw', startX: pt.x, startY: pt.y, origX: pt.x, origY: pt.y, origW: 0, origH: 0 })
      setDrawPreview(null)
    } else {
      setModalSelected(null)
    }
  }

  const startRegionDrag = (e: React.MouseEvent, r: Region, mode: 'move' | 'resize') => {
    if (modalMode !== 'select') return
    e.preventDefault(); e.stopPropagation()
    const pt = toPct(e)
    const regs = hasIndependentRegions ? independentRegions : getDisplayRegions()
    const eff = regs.find(er => er.id === r.id)
    if (!eff) return
    setDragging({
      mode, id: r.id,
      startX: pt.x, startY: pt.y,
      origX: eff.coords.x, origY: eff.coords.y,
      origW: eff.coords.w, origH: eff.coords.h
    })
    setModalSelected(r.id)
  }

  const onModalMove = (e: React.MouseEvent) => {
    if (!dragging) return
    const pt = toPct(e)
    const dx = pt.x - dragging.startX
    const dy = pt.y - dragging.startY

    if (dragging.mode === 'draw') {
      const x1 = Math.min(dragging.startX, pt.x), y1 = Math.min(dragging.startY, pt.y)
      setDrawPreview({ x: x1, y: y1, w: Math.abs(dx), h: Math.abs(dy) })
      return
    }

    if (!dragging.id) return

    // Auto-promote to independent regions if still inheriting
    if (!hasIndependentRegions) {
      createIndependentRegions()
    }

    if (dragging.mode === 'move') {
      updateLangRegion(dragging.id, {
        coords: { x: dragging.origX + dx, y: dragging.origY + dy, w: dragging.origW, h: dragging.origH }
      })
    } else if (dragging.mode === 'resize') {
      updateLangRegion(dragging.id, {
        coords: {
          x: dragging.origX, y: dragging.origY,
          w: Math.max(2, dragging.origW + dx),
          h: Math.max(2, dragging.origH + dy)
        }
      })
    }
  }

  const onModalUp = (e: React.MouseEvent) => {
    if (dragging?.mode === 'draw') {
      const pt = toPct(e)
      const x1 = Math.min(dragging.startX, pt.x), y1 = Math.min(dragging.startY, pt.y)
      const w = Math.abs(pt.x - dragging.startX), h = Math.abs(pt.y - dragging.startY)
      if (w > 1.5 && h > 1.5) {
        if (!hasIndependentRegions) createIndependentRegions()
        const newRegion: Region = {
          id: `r${Date.now()}`,
          shape: 'rect',
          coords: { x: x1, y: y1, w, h },
          correct: true,
          feedback: ''
        }
        setLangRegions(prev => {
          const key = String(blockIndex)
          const current = prev[activeLang]?.[key] || []
          return {
            ...prev,
            [activeLang]: { ...(prev[activeLang] || {}), [key]: [...current, newRegion] }
          }
        })
        setModalSelected(newRegion.id)
      }
      setDrawPreview(null)
      setModalMode('select')
    }
    setDragging(null)
  }

  const displayRegions = getDisplayRegions()
  const modalRegions = hasIndependentRegions ? independentRegions : displayRegions
  const selectedModalRegion = modalRegions.find(r => r.id === modalSelected)

  return (
    <>
      <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))' }}>
        <div className="flex items-center gap-2">
          <Globe size={12} style={{ color: 'var(--t-accent)' }} />
          <span className="text-[11px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>多語底圖 & 互動區域</span>
          <div className="flex gap-1 ml-auto">
            {LANGS.map(l => {
              const tb = translatedBlocks[l.code]?.[String(blockIndex)]
              const hasT = !!(tb?.regions?.length)
              const hasAudio = !!(tb?.intro?.slide_narration_audio)
              const hasIndep = !!(langRegions[l.code]?.[String(blockIndex)])
              return (
                <button key={l.code} onClick={() => { setActiveLang(l.code); setModalSelected(null) }}
                  className="text-[10px] px-2 py-0.5 rounded transition flex items-center gap-0.5"
                  style={{
                    backgroundColor: activeLang === l.code ? 'var(--t-accent-bg)' : 'var(--t-bg-card)',
                    color: activeLang === l.code ? 'white' : 'var(--t-text-dim)',
                    border: `1px solid ${activeLang === l.code ? 'var(--t-accent)' : 'var(--t-border)'}`
                  }}>
                  {l.flag} {l.code.toUpperCase()}
                  {hasIndep ? ' ★' : hasT ? ' ✓' : ''}
                  {hasAudio ? ' 🔊' : ''}
                </button>
              )
            })}
          </div>
        </div>

        {/* Target language preview — single column with drag & drop */}
        <div
          className="relative"
          onDragOver={e => { onDragOverFile(e); setDragOverPreview(true) }}
          onDragLeave={() => setDragOverPreview(false)}
          onDrop={onDropFile}
        >
          {langImage ? (
            <div className="relative group">
              <img src={langImage} alt="" className="w-full rounded border cursor-pointer"
                style={{ borderColor: 'var(--t-accent)', maxHeight: '200px', objectFit: 'contain' }}
                onClick={() => setEditModal(true)} title="點擊放大編輯互動區域" />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/30 rounded pointer-events-none">
                <span className="text-white text-xs font-medium flex items-center gap-1"><Maximize2 size={14} /> 編輯區域</span>
              </div>
              <button onClick={handleDelete}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                title="刪除此語言底圖">
                <Trash2 size={10} />
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {currentImage && (
                <div className="relative">
                  <img src={currentImage} alt="" className="w-full rounded border opacity-40" style={{ borderColor: 'var(--t-border)', maxHeight: '200px', objectFit: 'contain' }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] px-2 py-1 rounded bg-black/60 text-white">繼承主語言圖片</span>
                  </div>
                </div>
              )}
              <label className="h-14 flex flex-col items-center justify-center rounded border-2 border-dashed cursor-pointer transition hover:opacity-80"
                style={{ borderColor: 'var(--t-accent)', color: 'var(--t-accent)' }}>
                <Upload size={16} />
                <span className="text-[10px] mt-0.5">{uploading ? '上傳中...' : '上傳獨立底圖（拖拉或點擊）'}</span>
                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]) }} />
              </label>
            </div>
          )}
          {/* Drag overlay */}
          {dragOverPreview && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded border-2 border-dashed pointer-events-none"
              style={{ borderColor: 'var(--t-accent)', backgroundColor: 'rgba(59,130,246,0.15)' }}>
              <span className="text-sm font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white shadow">放開以抽換底圖</span>
            </div>
          )}
        </div>

        {/* Region status */}
        <div className="rounded p-2" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
          <div className="flex items-center gap-2 text-[10px]">
            {hasIndependentRegions ? (
              <>
                <span style={{ color: '#22c55e' }}>✅ 獨立區域 ({independentRegions.length} 個)</span>
                <div className="flex-1" />
                <button onClick={() => setEditModal(true)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded transition"
                  style={{ color: 'var(--t-accent)', border: '1px solid var(--t-border)' }}>
                  <Maximize2 size={10} /> 編輯
                </button>
                <button onClick={saveIndependentRegions} disabled={saving}
                  className="flex items-center gap-1 px-2 py-0.5 rounded transition text-white disabled:opacity-50"
                  style={{ backgroundColor: '#22c55e' }}>
                  <Save size={10} /> {saving ? '...' : '儲存'}
                </button>
                {hasTranslation && (
                  <button
                    onClick={async () => {
                      if (!confirm('將用最新翻譯覆蓋文字和語音，座標保持不變。確定？')) return
                      try {
                        setSaving(true)
                        const res = await api.post(`/training/slides/${slideId}/reseed-lang-regions`, {
                          lang: activeLang, block_index: blockIndex
                        })
                        const data = res.data.regions_json || {}
                        setLangRegions(prev => ({ ...prev, [activeLang]: data }))
                        if (data._intro) setLangIntro(prev => ({ ...prev, [activeLang]: data._intro }))
                      } catch (e: any) { alert(e.response?.data?.error || '同步失敗') }
                      finally { setSaving(false) }
                    }}
                    disabled={saving}
                    className="flex items-center gap-1 px-2 py-0.5 rounded transition disabled:opacity-50"
                    style={{ color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
                    <RefreshCw size={10} /> 從翻譯結果同步
                  </button>
                )}
                <button onClick={revertToInherit}
                  className="flex items-center gap-1 px-2 py-0.5 rounded transition text-orange-400"
                  style={{ border: '1px solid var(--t-border)' }}>
                  <RotateCcw size={10} /> 回到繼承
                </button>
              </>
            ) : (
              <>
                <span style={{ color: 'var(--t-text-dim)' }}>
                  {hasTranslation ? '🌐' : '📋'} {hasTranslation ? `翻譯結果 (${translatedBlock.regions.length} 個區域)` : `繼承主語言 (${regions.length} 個區域)`}
                </span>
                <div className="flex-1" />
                <button onClick={createIndependentRegions}
                  className="flex items-center gap-1 px-2 py-0.5 rounded transition"
                  style={{ color: 'var(--t-accent)', border: '1px solid var(--t-accent)' }}>
                  <Copy size={10} /> {hasTranslation ? '建立獨立區域(使用翻譯結果)' : '建立獨立區域(從主語言複製)'}
                </button>
                <div className="relative">
                  <button onClick={() => setCopyDropdown(!copyDropdown)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded transition"
                    style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
                    從其他語言複製 ▾
                  </button>
                  {copyDropdown && (
                    <>
                      <div className="fixed inset-0 z-[9]" onClick={() => setCopyDropdown(false)} />
                      <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border rounded shadow-lg z-10 min-w-[120px]"
                        style={{ borderColor: 'var(--t-border)' }}>
                        <button onClick={() => { copyFromLanguage('main'); setCopyDropdown(false) }}
                          className="block w-full text-left px-3 py-1.5 text-[10px] hover:bg-gray-100 dark:hover:bg-gray-700"
                          style={{ color: 'var(--t-text)' }}>
                          🇹🇼 主語言
                        </button>
                        {LANGS.filter(l => l.code !== activeLang).map(l => (
                          <button key={l.code} onClick={() => { copyFromLanguage(l.code); setCopyDropdown(false) }}
                            className="block w-full text-left px-3 py-1.5 text-[10px] hover:bg-gray-100 dark:hover:bg-gray-700"
                            style={{ color: 'var(--t-text)' }}>
                            {l.flag} {l.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <p className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>
          {hasIndependentRegions
            ? '此語言擁有獨立的互動區域。點「編輯」可在大圖上新增/刪除/調整區域。'
            : hasTranslation
              ? '已有翻譯結果。點「建立獨立區域」會帶入翻譯文字和語音，您只需調整框的位置。'
              : '點「建立獨立區域」可為此語言建立獨立的互動區域集合（從主語言複製為起點）。'}
          {translatedBlocks[activeLang]?._translated_at && (
            <span className="ml-1" style={{ color: 'var(--t-text-dim)' }}>
              · 翻譯: {translatedBlocks[activeLang]._translated_at}
            </span>
          )}
        </p>

        {/* ═══ Translated voice preview (readonly, inherit mode) ═══ */}
        {!hasIndependentRegions && hasTranslation && (
          <div className="border-t pt-2 mt-2 space-y-2" style={{ borderColor: 'var(--t-border)' }}>
            <div className="flex items-center gap-2">
              <Volume2 size={10} style={{ color: '#22c55e' }} />
              <span className="text-[10px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>
                {LANGS.find(l => l.code === activeLang)?.flag} {activeLang.toUpperCase()} 語音導覽（翻譯結果預覽）
              </span>
            </div>
            <p className="text-[8px]" style={{ color: 'var(--t-text-dim)' }}>
              唯讀預覽。需調整框位置？先「建立獨立區域」。
            </p>
            {/* Translated intro preview */}
            {translatedBlock.intro && (
              <div className="text-[9px] space-y-1.5 rounded p-1.5" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                {[
                  { key: 'slide_narration', audioKey: 'slide_narration_audio', icon: '🎯', label: '導引' },
                  { key: 'slide_narration_test', audioKey: 'slide_narration_test_audio', icon: '📝', label: '測驗' },
                  { key: 'slide_narration_explore', audioKey: 'slide_narration_explore_audio', icon: '🔍', label: '探索' },
                ].map(m => translatedBlock.intro[m.key] && (
                  <div key={m.key} className="space-y-0.5">
                    <span style={{ color: 'var(--t-text-dim)' }}>{m.icon} {m.label}</span>
                    <div className="text-[9px] rounded px-1.5 py-1 opacity-80" style={{ backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}>
                      {translatedBlock.intro[m.key]}
                    </div>
                    {translatedBlock.intro[m.audioKey] && <audio src={translatedBlock.intro[m.audioKey]} controls className="w-full h-5" style={{ maxHeight: '20px' }} />}
                  </div>
                ))}
              </div>
            )}
            {/* Translated per-region preview */}
            {translatedBlock.regions.filter((r: any) => r.correct).map((r: any, idx: number) => (
              <div key={r.id} className="text-[9px] rounded p-1.5 space-y-1" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                <span className="font-medium" style={{ color: 'var(--t-text-secondary)' }}>{idx + 1}. {r.label || r.id}</span>
                {[
                  { field: 'narration', audioField: 'audio_url', icon: '📖', label: '導引' },
                  { field: 'test_hint', audioField: 'test_audio_url', icon: '📝', label: '測驗' },
                  { field: 'explore_desc', audioField: 'explore_audio_url', icon: '🔍', label: '探索' },
                ].map(m => r[m.field] && (
                  <div key={m.field} className="space-y-0.5">
                    <span style={{ color: 'var(--t-text-dim)' }}>{m.icon} {m.label}</span>
                    <div className="text-[9px] rounded px-1.5 py-0.5 opacity-80" style={{ backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}>
                      {r[m.field]}
                    </div>
                    {r[m.audioField] && <audio src={r[m.audioField]} controls className="w-full h-5" style={{ maxHeight: '20px' }} />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ═══ Voice editing for independent regions ═══ */}
        {hasIndependentRegions && (
          <div className="border-t pt-2 mt-2 space-y-2" style={{ borderColor: 'var(--t-border)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <Volume2 size={10} style={{ color: 'var(--t-accent)' }} />
              <span className="text-[10px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>
                {LANGS.find(l => l.code === activeLang)?.flag} {activeLang.toUpperCase()} 語音導覽
              </span>
              {/* Mode filter tabs */}
              <div className="flex gap-0.5 ml-1">
                {([
                  { key: 'all', label: '全部' },
                  { key: 'guided', label: '🎯 導引' },
                  { key: 'test', label: '📝 測驗' },
                  { key: 'explore', label: '🔍 探索' },
                ] as const).map(m => (
                  <button key={m.key} onClick={() => setVoiceMode(m.key)}
                    className="text-[8px] px-1.5 py-0.5 rounded transition"
                    style={{
                      backgroundColor: voiceMode === m.key ? 'var(--t-accent-subtle)' : 'transparent',
                      color: voiceMode === m.key ? 'var(--t-accent)' : 'var(--t-text-dim)',
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <button
                onClick={async () => {
                  try {
                    setNarrationLoading(true)
                    // 1. AI generate narration for this language
                    const res = await api.post(`/training/slides/${slideId}/generate-narration`, {
                      block_index: blockIndex, lang: activeLang,
                      editor_context: ''
                    }, { timeout: 60000 })
                    const data = res.data
                    // Fill region narration fields
                    const key = String(blockIndex)
                    const updatedRegs = [...(langRegions[activeLang]?.[key] || [])]
                    if (data.regions?.length > 0) {
                      for (const aiR of data.regions) {
                        const match = updatedRegs.find(r => r.id === aiR.id) || updatedRegs.filter(r => r.correct)[data.regions.indexOf(aiR)]
                        if (match) {
                          if (aiR.narration) match.narration = aiR.narration
                          if (aiR.test_hint) match.test_hint = aiR.test_hint
                          if (aiR.explore_desc) match.explore_desc = aiR.explore_desc
                          if (aiR.feedback_correct) match.feedback = aiR.feedback_correct
                          if (aiR.feedback_wrong) match.feedback_wrong = aiR.feedback_wrong
                        }
                      }
                    }
                    setLangRegions(prev => ({ ...prev, [activeLang]: { ...(prev[activeLang] || {}), [key]: updatedRegs } }))
                    // Fill intro
                    const newIntro = {
                      slide_narration: data.slide_narration || '',
                      slide_narration_test: data.slide_narration_test || '',
                      slide_narration_explore: data.slide_narration_explore || '',
                      completion_message: data.completion_message || ''
                    }
                    setLangIntro(prev => ({ ...prev, [activeLang]: { ...(prev[activeLang] || {}), ...newIntro } }))

                    // 2. Auto TTS all
                    setTtsLoading('batch')
                    const genTts = async (text: string, regionId: string) => {
                      if (!text) return null
                      try {
                        const r = await api.post(`/training/slides/${slideId}/region-tts`, {
                          block_index: blockIndex, region_id: regionId, text, language: activeLang
                        })
                        return r.data.audio_url
                      } catch { return null }
                    }
                    // Intro TTS
                    for (const f of [
                      { text: 'slide_narration', audio: 'slide_narration_audio', id: 'intro_guided' },
                      { text: 'slide_narration_test', audio: 'slide_narration_test_audio', id: 'intro_test' },
                      { text: 'slide_narration_explore', audio: 'slide_narration_explore_audio', id: 'intro_explore' },
                    ]) {
                      if ((newIntro as any)[f.text]) {
                        const url = await genTts((newIntro as any)[f.text], `${activeLang}_${f.id}`)
                        if (url) (newIntro as any)[f.audio] = url
                      }
                    }
                    // Region TTS
                    for (const r of updatedRegs.filter(r => r.correct)) {
                      for (const p of [
                        { text: 'narration', audio: 'audio_url' },
                        { text: 'test_hint', audio: 'test_audio_url' },
                        { text: 'explore_desc', audio: 'explore_audio_url' },
                      ]) {
                        if (r[p.text]) {
                          const url = await genTts(r[p.text], `${activeLang}_${p.text}_${r.id}`)
                          if (url) r[p.audio] = url
                        }
                      }
                    }
                    // Save all
                    setLangRegions(prev => ({ ...prev, [activeLang]: { ...(prev[activeLang] || {}), [key]: updatedRegs } }))
                    setLangIntro(prev => ({ ...prev, [activeLang]: { ...(prev[activeLang] || {}), ...newIntro } }))
                    // Persist to server
                    await api.put(`/training/slides/${slideId}/lang-regions`, {
                      lang: activeLang, block_index: blockIndex,
                      regions: updatedRegs, _intro: { ...(langIntro[activeLang] || {}), ...newIntro }
                    })
                  } catch (e: any) { alert(e.response?.data?.error || 'AI 生成失敗') }
                  finally { setNarrationLoading(false); setTtsLoading(null) }
                }}
                disabled={narrationLoading || ttsLoading === 'batch'}
                className="flex items-center gap-1 text-[9px] font-medium px-2 py-0.5 rounded-lg transition disabled:opacity-50"
                style={{ backgroundColor: 'rgba(168,85,247,0.12)', color: '#a855f7' }}
              >
                {narrationLoading ? <Loader2 size={9} className="animate-spin" /> : ttsLoading === 'batch' ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
                {narrationLoading ? 'AI...' : ttsLoading === 'batch' ? 'TTS...' : '✨ AI 生成語音'}
              </button>
            </div>

            {/* Intro narration — editable */}
            {langIntro[activeLang] && (
              <div className="text-[9px] space-y-1.5 rounded p-1.5" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                {[
                  { key: 'slide_narration', audioKey: 'slide_narration_audio', icon: '🎯', label: '導引', ttsId: 'intro_guided', mode: 'guided' as const },
                  { key: 'slide_narration_test', audioKey: 'slide_narration_test_audio', icon: '📝', label: '測驗', ttsId: 'intro_test', mode: 'test' as const },
                  { key: 'slide_narration_explore', audioKey: 'slide_narration_explore_audio', icon: '🔍', label: '探索', ttsId: 'intro_explore', mode: 'explore' as const },
                ].filter(m => voiceMode === 'all' || voiceMode === m.mode).map(m => langIntro[activeLang]?.[m.key] && (
                  <div key={m.key} className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <span style={{ color: 'var(--t-text-dim)' }}>{m.icon} {m.label}</span>
                      <div className="flex-1" />
                      <button
                        onClick={async () => {
                          setTtsLoading(m.key)
                          const url = await genSingleTts(langIntro[activeLang][m.key], `${activeLang}_${m.ttsId}`)
                          if (url) updateIntroField(m.audioKey, url)
                          setTtsLoading(null)
                        }}
                        disabled={!!ttsLoading}
                        className="flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded transition disabled:opacity-40"
                        style={{ color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
                        {ttsLoading === m.key ? <Loader2 size={8} className="animate-spin" /> : <RefreshCw size={8} />}
                        TTS
                      </button>
                    </div>
                    <textarea
                      value={langIntro[activeLang][m.key] || ''}
                      onChange={e => updateIntroField(m.key, e.target.value)}
                      rows={2}
                      className="w-full text-[9px] rounded px-1.5 py-1 resize-y focus:outline-none"
                      style={{ backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}
                    />
                    {langIntro[activeLang]?.[m.audioKey] && <audio src={langIntro[activeLang][m.audioKey]} controls className="w-full h-5" style={{ maxHeight: '20px' }} />}
                  </div>
                ))}
              </div>
            )}

            {/* Per-region voice — editable */}
            {independentRegions.filter(r => r.correct).map((r, idx) => (
              <div key={r.id} className="text-[9px] rounded p-1.5 space-y-1" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                <div className="flex items-center gap-1">
                  <span className="font-medium" style={{ color: 'var(--t-text-secondary)' }}>{idx + 1}. {r.label || r.id}</span>
                </div>
                {[
                  { field: 'narration', audioField: 'audio_url', icon: '📖', label: '導引', mode: 'guided' as const },
                  { field: 'test_hint', audioField: 'test_audio_url', icon: '📝', label: '測驗', mode: 'test' as const },
                  { field: 'explore_desc', audioField: 'explore_audio_url', icon: '🔍', label: '探索', mode: 'explore' as const },
                ].filter(m => voiceMode === 'all' || voiceMode === m.mode).map(m => (
                  <div key={m.field} className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <span style={{ color: 'var(--t-text-dim)' }}>{m.icon} {m.label}</span>
                      <div className="flex-1" />
                      {r[m.field] && (
                        <button
                          onClick={async () => {
                            const ttsKey = `${r.id}_${m.field}`
                            setTtsLoading(ttsKey)
                            const url = await genSingleTts(r[m.field], `${activeLang}_${m.field}_${r.id}`)
                            if (url) updateLangRegion(r.id, { [m.audioField]: url })
                            setTtsLoading(null)
                          }}
                          disabled={!!ttsLoading}
                          className="flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded transition disabled:opacity-40"
                          style={{ color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
                          {ttsLoading === `${r.id}_${m.field}` ? <Loader2 size={8} className="animate-spin" /> : <RefreshCw size={8} />}
                          TTS
                        </button>
                      )}
                    </div>
                    <textarea
                      value={r[m.field] || ''}
                      onChange={e => updateLangRegion(r.id, { [m.field]: e.target.value })}
                      rows={1}
                      className="w-full text-[9px] rounded px-1.5 py-0.5 resize-y focus:outline-none"
                      style={{ backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}
                      placeholder={`${m.label}文字...`}
                    />
                    {r[m.audioField] && <audio src={r[m.audioField]} controls className="w-full h-5" style={{ maxHeight: '20px' }} />}
                  </div>
                ))}
                {!r.audio_url && !r.narration && <div style={{ color: '#f59e0b' }}>⚠ 無語音</div>}
              </div>
            ))}
          </div>
        )}

        {/* ═══ Diff mode: zh-TW vs translated/independent ═══ */}
        {(hasTranslation || hasIndependentRegions) && (
          <div className="border-t pt-1 mt-1" style={{ borderColor: 'var(--t-border)' }}>
            <button onClick={() => setDiffMode(!diffMode)}
              className="text-[9px] px-2 py-0.5 rounded transition flex items-center gap-1"
              style={{ color: diffMode ? 'var(--t-accent)' : 'var(--t-text-dim)', border: `1px solid ${diffMode ? 'var(--t-accent)' : 'var(--t-border)'}` }}>
              <Eye size={9} /> {diffMode ? '收合 Diff' : '📊 Diff 模式'}
            </button>
            {diffMode && (
              <div className="mt-1.5 space-y-1 text-[9px]">
                <div className="grid grid-cols-2 gap-1 font-semibold mb-1" style={{ color: 'var(--t-text-muted)' }}>
                  <span>🇹🇼 主語言 (zh-TW)</span>
                  <span>{LANGS.find(l => l.code === activeLang)?.flag} {activeLang.toUpperCase()} {hasIndependentRegions ? '(獨立)' : '(翻譯)'}</span>
                </div>
                {/* Intro diff */}
                {(() => {
                  const zhIntro = regions[0] || {} as any // main block's intro fields live on the block itself
                  const tgtIntro = hasIndependentRegions ? (langIntro[activeLang] || {}) : (translatedBlock?.intro || {})
                  const fields = [
                    { key: 'slide_narration', label: '🎯 導引 Intro' },
                    { key: 'slide_narration_test', label: '📝 測驗 Intro' },
                    { key: 'slide_narration_explore', label: '🔍 探索 Intro' },
                  ]
                  return fields.map(f => {
                    // intro fields are on the parent block, accessed via regions prop's parent
                    // For diff, we need to get zh-TW intro from the block itself — pass through props or use regions[0]
                    // Actually the zh-TW intro is NOT in regions — it's on the hotspot block
                    // We don't have direct access here. Skip intro diff for now, only do region text diff.
                    return null
                  })
                })()}
                {/* Per-region diff */}
                {regions.filter(r => r.correct).map((zhR, idx) => {
                  const tgtR = hasIndependentRegions
                    ? independentRegions.find(r => r.id === zhR.id)
                    : translatedBlock?.regions?.find((r: any) => r.id === zhR.id)
                  return (
                    <div key={zhR.id} className="rounded p-1" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                      <div className="font-medium mb-0.5" style={{ color: 'var(--t-text-secondary)' }}>{idx + 1}. {zhR.label || zhR.id}</div>
                      {[
                        { field: 'narration', icon: '📖' },
                        { field: 'test_hint', icon: '📝' },
                        { field: 'explore_desc', icon: '🔍' },
                        { field: 'feedback', icon: '✅' },
                      ].map(f => {
                        const zhVal = zhR[f.field] || ''
                        const tgtVal = tgtR?.[f.field] || ''
                        if (!zhVal && !tgtVal) return null
                        return (
                          <div key={f.field} className="grid grid-cols-2 gap-1 mb-0.5">
                            <div className="rounded px-1 py-0.5" style={{ backgroundColor: 'rgba(59,130,246,0.06)', color: 'var(--t-text)' }}>
                              <span style={{ color: 'var(--t-text-dim)' }}>{f.icon}</span> {zhVal || <span className="italic opacity-40">—</span>}
                            </div>
                            <div className="rounded px-1 py-0.5" style={{
                              backgroundColor: tgtVal && tgtVal !== zhVal ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)',
                              color: 'var(--t-text)'
                            }}>
                              {tgtVal || <span className="italic opacity-40" style={{ color: '#ef4444' }}>未翻譯</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ Full-screen modal for region editing ═══ */}
      {editModal && (langImage || currentImage) && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setEditModal(false)}>
          <div className="relative w-[92vw] max-h-[92vh] flex flex-col rounded-xl p-3 shadow-2xl"
            style={{ backgroundColor: 'var(--t-bg-elevated)', border: '1px solid var(--t-border)' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: 'var(--t-text)' }}>
                {LANGS.find(l => l.code === activeLang)?.flag} {activeLang.toUpperCase()} — 互動區域編輯
              </span>
              <span className="text-[10px]" style={{ color: 'var(--t-text-muted)' }}>
                {modalRegions.length} 個區域
                {hasIndependentRegions ? ' · 獨立' : ' · 繼承（唯讀）'}
              </span>

              {/* Mode toggle (only for independent) */}
              {hasIndependentRegions && (
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={() => setModalMode('select')}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition"
                    style={{
                      backgroundColor: modalMode === 'select' ? 'var(--t-accent-subtle)' : 'transparent',
                      color: modalMode === 'select' ? 'var(--t-accent)' : 'var(--t-text-muted)',
                      border: `1px solid ${modalMode === 'select' ? 'var(--t-accent)' : 'var(--t-border)'}`
                    }}>
                    <MousePointer size={10} /> 選取
                  </button>
                  <button onClick={() => setModalMode('draw')}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition"
                    style={{
                      backgroundColor: modalMode === 'draw' ? 'rgba(34,197,94,0.15)' : 'transparent',
                      color: modalMode === 'draw' ? '#22c55e' : 'var(--t-text-muted)',
                      border: `1px solid ${modalMode === 'draw' ? '#22c55e' : 'var(--t-border)'}`
                    }}>
                    <Pen size={10} /> 繪製
                  </button>
                  <button onClick={addLangRegionAtCenter}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition"
                    style={{ color: 'var(--t-text-muted)', border: '1px solid var(--t-border)' }}>
                    <Plus size={10} /> 新增
                  </button>
                </div>
              )}

              <div className="flex-1" />

              {/* 併排合成 button */}
              <button onClick={openComposite}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition"
                style={{ color: '#a78bfa', border: '1px solid #a78bfa' }}>
                <Columns size={12} /> 併排合成
              </button>

              {/* 抽換底圖 button */}
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition"
                style={{ color: 'var(--t-text-muted)', border: '1px solid var(--t-border)' }}
                disabled={uploading}>
                <ImagePlus size={12} /> {uploading ? '上傳中...' : '抽換底圖'}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = '' }} />

              {hasIndependentRegions && (
                <button onClick={e => { e.stopPropagation(); saveIndependentRegions() }} disabled={saving}
                  className="flex items-center gap-1 text-xs text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                  style={{ backgroundColor: '#22c55e' }}>
                  <Save size={12} /> {saving ? '儲存中...' : '儲存'}
                </button>
              )}
              <button onClick={() => setEditModal(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition"
                style={{ color: 'var(--t-text-muted)' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--t-bg-card-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                <X size={18} />
              </button>
            </div>

            {/* Bulk coords transform (only for independent) */}
            {hasIndependentRegions && (
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px]" style={{ color: 'var(--t-text-muted)' }}>整體座標調整:</span>
                <label className="text-[10px] flex items-center gap-1" style={{ color: 'var(--t-text-muted)' }}>
                  X偏移
                  <input type="number" value={coordsOffsetX} onChange={e => setCoordsOffsetX(Number(e.target.value))}
                    className="w-14 text-[10px] px-1 py-0.5 rounded text-center"
                    style={{ backgroundColor: 'var(--t-bg-input)', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}
                    step={1} />%
                </label>
                <label className="text-[10px] flex items-center gap-1" style={{ color: 'var(--t-text-muted)' }}>
                  Y偏移
                  <input type="number" value={coordsOffsetY} onChange={e => setCoordsOffsetY(Number(e.target.value))}
                    className="w-14 text-[10px] px-1 py-0.5 rounded text-center"
                    style={{ backgroundColor: 'var(--t-bg-input)', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}
                    step={1} />%
                </label>
                <label className="text-[10px] flex items-center gap-1" style={{ color: 'var(--t-text-muted)' }}>
                  縮放
                  <input type="number" value={coordsScale} onChange={e => setCoordsScale(Number(e.target.value))}
                    className="w-16 text-[10px] px-1 py-0.5 rounded text-center"
                    style={{ backgroundColor: 'var(--t-bg-input)', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}
                    step={5} min={10} max={500} />%
                </label>
                <button
                  onClick={() => {
                    if (coordsOffsetX === 0 && coordsOffsetY === 0 && coordsScale === 100) return
                    const key = String(blockIndex)
                    const scale = coordsScale / 100
                    setLangRegions(prev => {
                      const current = prev[activeLang]?.[key] || []
                      return {
                        ...prev,
                        [activeLang]: {
                          ...(prev[activeLang] || {}),
                          [key]: current.map(r => ({
                            ...r,
                            coords: {
                              x: r.coords.x + coordsOffsetX,
                              y: r.coords.y + coordsOffsetY,
                              w: r.coords.w * scale,
                              h: r.coords.h * scale,
                            }
                          }))
                        }
                      }
                    })
                    setCoordsOffsetX(0); setCoordsOffsetY(0); setCoordsScale(100)
                  }}
                  className="text-[10px] px-2 py-0.5 rounded transition"
                  style={{ color: 'var(--t-accent)', border: '1px solid var(--t-accent)' }}
                  disabled={coordsOffsetX === 0 && coordsOffsetY === 0 && coordsScale === 100}>
                  套用
                </button>
              </div>
            )}

            {/* Hidden audio for region click preview */}
            <audio ref={modalAudioRef} className="hidden" />

            <div className="flex gap-3" style={{ maxHeight: '85vh' }}>
              {/* Image + draggable regions */}
              <div className="flex-1 overflow-auto rounded-lg relative"
                onDragOver={e => { onDragOverFile(e); setDragOverModal(true) }}
                onDragLeave={e => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragOverModal(false) }}
                onDrop={onDropFile}>
                <div className="relative w-full"
                  style={{ cursor: modalMode === 'draw' && hasIndependentRegions ? 'crosshair' : (dragging ? 'grabbing' : 'default') }}
                  onMouseDown={handleModalMouseDown}
                  onMouseMove={onModalMove}
                  onMouseUp={onModalUp}
                  onMouseLeave={() => { setDragging(null); setDrawPreview(null) }}>
                <img ref={modalImgRef} src={langImage || currentImage} alt="" className="w-full block" draggable={false} />

                {modalRegions.map(r => {
                  const isActive = dragging?.id === r.id
                  const isSelected = modalSelected === r.id
                  return (
                    <div key={r.id}
                      className="absolute border-2 rounded transition-shadow"
                      style={{
                        left: `${r.coords.x}%`, top: `${r.coords.y}%`,
                        width: `${r.coords.w}%`, height: `${r.coords.h}%`,
                        borderColor: isActive ? '#facc15' : isSelected ? '#38bdf8' : (r.correct ? '#22c55e' : '#ef4444'),
                        background: isActive ? 'rgba(250,204,21,0.15)' : isSelected ? 'rgba(56,189,248,0.15)' : (r.correct ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'),
                        cursor: modalMode === 'select' && hasIndependentRegions ? 'grab' : (modalMode === 'draw' ? 'crosshair' : 'default'),
                        pointerEvents: modalMode === 'draw' ? 'none' : 'auto',
                        boxShadow: isActive || isSelected ? `0 0 0 3px ${isActive ? 'rgba(250,204,21,0.4)' : 'rgba(56,189,248,0.3)'}` : 'none'
                      }}
                      onMouseDown={e => { e.stopPropagation(); startRegionDrag(e, r, 'move') }}
                      onClick={e => {
                        e.stopPropagation(); setModalSelected(r.id)
                        // Auto-play region audio on click
                        if (r.audio_url && modalAudioRef.current) {
                          modalAudioRef.current.src = r.audio_url
                          modalAudioRef.current.play().catch(() => {})
                        }
                      }}
                      title={r.narration ? `${r.label || r.id}\n${r.narration.slice(0, 80)}${r.narration.length > 80 ? '...' : ''}` : r.label || r.id}>
                      {/* Label */}
                      <span className="absolute -top-5 left-0 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap"
                        style={{
                          backgroundColor: isSelected ? '#38bdf8' : (r.correct ? '#22c55e' : '#ef4444'),
                          color: '#fff'
                        }}>
                        {r.correct ? '✓' : '✗'} {r.label || r.id}
                      </span>
                      {/* Resize handle — bottom-right */}
                      {hasIndependentRegions && modalMode === 'select' && (
                        <div
                          className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-sm"
                          style={{ backgroundColor: isSelected ? '#38bdf8' : '#22c55e', cursor: 'nwse-resize', border: '1px solid white' }}
                          onMouseDown={e => { e.stopPropagation(); startRegionDrag(e, r, 'resize') }}
                          title="拖拉調整大小"
                        />
                      )}
                    </div>
                  )
                })}

                {/* Draw preview */}
                {dragging?.mode === 'draw' && drawPreview && drawPreview.w > 0.5 && drawPreview.h > 0.5 && (
                  <div className="absolute border-2 border-dashed border-sky-400 bg-sky-400/10 rounded pointer-events-none"
                    style={{ left: `${drawPreview.x}%`, top: `${drawPreview.y}%`, width: `${drawPreview.w}%`, height: `${drawPreview.h}%` }} />
                )}
                </div>{/* close relative wrapper */}
                {/* Modal drag overlay */}
                {dragOverModal && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg pointer-events-none"
                    style={{ border: '3px dashed #3b82f6', backgroundColor: 'rgba(59,130,246,0.18)' }}>
                    <span className="text-base font-semibold px-4 py-2 rounded-xl bg-blue-600 text-white shadow-lg">放開以抽換底圖</span>
                  </div>
                )}
              </div>{/* close overflow container */}

              {/* Right panel: region properties (only for independent) */}
              {hasIndependentRegions && (
                <div className="w-64 shrink-0 flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: '85vh' }}>
                  {/* Region list */}
                  <div className="rounded-lg p-2 space-y-1" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                    <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--t-text-muted)' }}>區域列表 ({independentRegions.length})</div>
                    {independentRegions.map(r => (
                      <div key={r.id}
                        onClick={() => setModalSelected(r.id)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] cursor-pointer transition"
                        style={{
                          backgroundColor: modalSelected === r.id ? 'var(--t-accent-subtle)' : 'transparent',
                          color: 'var(--t-text)'
                        }}>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${r.correct ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="truncate flex-1">{r.label || r.id}</span>
                        <button onClick={e => { e.stopPropagation(); removeLangRegion(r.id) }}
                          className="text-red-400 hover:text-red-300 opacity-60 hover:opacity-100 shrink-0">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                    {independentRegions.length === 0 && (
                      <div className="text-[10px] py-2 text-center" style={{ color: 'var(--t-text-dim)' }}>尚無區域</div>
                    )}
                  </div>

                  {/* Selected region properties */}
                  {selectedModalRegion && (
                    <div className="rounded-lg p-2 space-y-2" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                      <div className="text-[10px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>編輯：{selectedModalRegion.label || selectedModalRegion.id}</div>
                      <div>
                        <label className="text-[9px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>標籤名稱</label>
                        <input value={selectedModalRegion.label || ''}
                          onChange={e => updateLangRegion(selectedModalRegion.id, { label: e.target.value })}
                          className="w-full rounded px-2 py-1 text-[10px] focus:outline-none"
                          style={{ backgroundColor: 'var(--t-bg-input)', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}
                          placeholder="例：帳號、密碼" />
                      </div>
                      <label className="flex items-center gap-2 text-[10px]">
                        <input type="checkbox" checked={selectedModalRegion.correct || false}
                          onChange={e => updateLangRegion(selectedModalRegion.id, { correct: e.target.checked })}
                          className="rounded" />
                        <span style={{ color: selectedModalRegion.correct ? '#16a34a' : '#dc2626' }}>
                          {selectedModalRegion.correct ? '正確區域' : '錯誤區域'}
                        </span>
                      </label>
                      <div>
                        <label className="text-[9px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>回饋文字</label>
                        <input value={selectedModalRegion.feedback || ''}
                          onChange={e => updateLangRegion(selectedModalRegion.id, { feedback: e.target.value })}
                          className="w-full rounded px-2 py-1 text-[10px] focus:outline-none"
                          style={{ backgroundColor: 'var(--t-bg-input)', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}
                          placeholder="點擊後的回饋文字" />
                      </div>

                      {/* Narration / Test Hint / Explore Desc + VoiceInput */}
                      {selectedModalRegion.correct && [
                        { field: 'narration', audioField: 'audio_url', icon: '📖', label: '學習導引', ph: '語音導引文字...' },
                        { field: 'test_hint', audioField: 'test_audio_url', icon: '📝', label: '測驗提示', ph: '提示文字...' },
                        { field: 'explore_desc', audioField: 'explore_audio_url', icon: '🔍', label: '探索說明', ph: '說明文字...' },
                      ].map(m => (
                        <div key={m.field}>
                          <label className="text-[9px] block mb-0.5" style={{ color: 'var(--t-text-dim)' }}>{m.icon} {m.label}</label>
                          <input value={selectedModalRegion[m.field] || ''}
                            onChange={e => updateLangRegion(selectedModalRegion.id, { [m.field]: e.target.value })}
                            className="w-full rounded px-2 py-1 text-[10px] focus:outline-none"
                            style={{ backgroundColor: 'var(--t-bg-input)', border: '1px solid var(--t-border)', color: 'var(--t-text)' }}
                            placeholder={m.ph} />
                          <VoiceInput
                            text={selectedModalRegion[m.field] || ''}
                            audioUrl={selectedModalRegion[m.audioField] || null}
                            slideId={slideId}
                            regionId={`${activeLang}_${m.field === 'narration' ? '' : m.field + '_'}${selectedModalRegion.id}`}
                            language={activeLang}
                            onAudioChange={(url: string | null) => updateLangRegion(selectedModalRegion.id, { [m.audioField]: url })}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Footer hint */}
            <div className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--t-text-dim)' }}>
              💡 拖拉圖片到畫面上 或 Ctrl+V 貼上剪貼簿圖片 可直接抽換底圖
            </div>
          </div>
        </div>
      )}
      {/* ═══ Composite Dialog ═══ */}
      {compositeOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setCompositeOpen(false)}>
          <div className="w-[80vw] max-w-[900px] max-h-[90vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
            style={{ backgroundColor: 'var(--t-bg-elevated)', border: '1px solid var(--t-border)' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid var(--t-border)' }}>
              <Columns size={16} style={{ color: '#a78bfa' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--t-text)' }}>併排合成底圖</span>
              <span className="text-[10px]" style={{ color: 'var(--t-text-muted)' }}>將兩張圖片合成為一張底稿</span>
              <div className="flex-1" />
              <button onClick={() => setCompositeOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center transition"
                style={{ color: 'var(--t-text-muted)' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--t-bg-card-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Two image slots */}
              <div className={`grid gap-4 ${compDirection === 'horizontal' ? 'grid-cols-2' : 'grid-cols-1 max-w-md mx-auto'}`}>
                {/* Left slot */}
                {(['left', 'right'] as const).map(slot => {
                  const img = slot === 'left' ? compLeft : compRight
                  const label = slot === 'left' ? '圖片 A（左/上）' : '圖片 B（右/下）'
                  return (
                    <div key={slot}
                      className="rounded-xl border-2 border-dashed transition min-h-[160px] flex flex-col items-center justify-center relative"
                      style={{ borderColor: img ? '#a78bfa' : 'var(--t-border)', backgroundColor: img ? 'rgba(167,139,250,0.06)' : 'var(--t-bg-inset)' }}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                      onDrop={e => {
                        e.preventDefault(); e.stopPropagation()
                        const file = e.dataTransfer.files?.[0]
                        if (file) onCompSlotFile(file, slot)
                      }}>
                      {img ? (
                        <div className="relative w-full p-2 group">
                          <img src={img} alt="" className="w-full max-h-[250px] object-contain rounded-lg" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/40 rounded-lg m-2">
                            <button onClick={() => (slot === 'left' ? compLeftInputRef : compRightInputRef).current?.click()}
                              className="text-white text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500">
                              重新選擇
                            </button>
                          </div>
                          <div className="text-[9px] text-center mt-1" style={{ color: 'var(--t-text-muted)' }}>{label}</div>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center gap-2 cursor-pointer py-6 w-full"
                          onClick={() => (slot === 'left' ? compLeftInputRef : compRightInputRef).current?.click()}>
                          <Upload size={24} style={{ color: 'var(--t-text-dim)' }} />
                          <span className="text-xs" style={{ color: 'var(--t-text-muted)' }}>{label}</span>
                          <span className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>點擊選擇、拖拉或貼上</span>
                        </label>
                      )}
                      <input ref={slot === 'left' ? compLeftInputRef : compRightInputRef}
                        type="file" accept="image/*" className="hidden"
                        onChange={e => { if (e.target.files?.[0]) onCompSlotFile(e.target.files[0], slot); e.target.value = '' }} />
                    </div>
                  )
                })}
              </div>

              {/* Options row */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: 'var(--t-text-muted)' }}>排列：</span>
                  <button onClick={() => { setCompDirection('horizontal'); setCompPreview(null) }}
                    className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg transition"
                    style={{
                      backgroundColor: compDirection === 'horizontal' ? 'rgba(139,92,246,0.15)' : 'transparent',
                      color: compDirection === 'horizontal' ? '#a78bfa' : 'var(--t-text-muted)',
                      border: `1px solid ${compDirection === 'horizontal' ? '#a78bfa' : 'var(--t-border)'}`
                    }}>
                    <Columns size={11} /> 左右並排
                  </button>
                  <button onClick={() => { setCompDirection('vertical'); setCompPreview(null) }}
                    className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg transition"
                    style={{
                      backgroundColor: compDirection === 'vertical' ? 'rgba(139,92,246,0.15)' : 'transparent',
                      color: compDirection === 'vertical' ? '#a78bfa' : 'var(--t-text-muted)',
                      border: `1px solid ${compDirection === 'vertical' ? '#a78bfa' : 'var(--t-border)'}`
                    }}>
                    <Rows size={11} /> 上下並排
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: 'var(--t-text-muted)' }}>間距：</span>
                  {[0, 4, 8, 16].map(g => (
                    <button key={g} onClick={() => { setCompGap(g); setCompPreview(null) }}
                      className="text-[10px] px-2 py-0.5 rounded transition"
                      style={{
                        backgroundColor: compGap === g ? 'rgba(139,92,246,0.15)' : 'transparent',
                        color: compGap === g ? '#a78bfa' : 'var(--t-text-muted)',
                        border: `1px solid ${compGap === g ? '#a78bfa' : 'var(--t-border)'}`
                      }}>
                      {g}px
                    </button>
                  ))}
                </div>
                <div className="flex-1" />
                <button onClick={generateComposite}
                  disabled={!compLeft || !compRight}
                  className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg transition disabled:opacity-30"
                  style={{ backgroundColor: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid #a78bfa' }}>
                  <Eye size={13} /> 預覽合成
                </button>
              </div>

              {/* Preview */}
              {compPreview && (
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>合成預覽：</div>
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--t-border)' }}>
                    <img src={compPreview} alt="composite preview" className="w-full max-h-[350px] object-contain bg-white" />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: '1px solid var(--t-border)' }}>
              <span className="text-[10px] flex-1" style={{ color: 'var(--t-text-dim)' }}>
                ⚠ 合成後會替換目前的 {activeLang.toUpperCase()} 底圖，既有互動區域座標可能需要重新調整
              </span>
              <button onClick={() => setCompositeOpen(false)}
                className="text-xs px-4 py-1.5 rounded-lg transition"
                style={{ color: 'var(--t-text-muted)', border: '1px solid var(--t-border)' }}>
                取消
              </button>
              <button onClick={confirmComposite}
                disabled={!compPreview || compUploading}
                className="flex items-center gap-1.5 text-xs text-white px-4 py-1.5 rounded-lg transition disabled:opacity-40"
                style={{ backgroundColor: '#7c3aed' }}>
                <Save size={13} /> {compUploading ? '上傳中...' : '確認合成並套用'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
