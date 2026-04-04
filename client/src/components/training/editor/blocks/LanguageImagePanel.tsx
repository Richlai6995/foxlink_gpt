/**
 * Phase 3B: LanguageImagePanel — 多語底圖管理 + 獨立 Region 管理
 * 每個語言可以擁有完全獨立的 region 集合，或繼承主語言。
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Trash2, Globe, Save, Maximize2, X, Copy, Plus, MousePointer, Pen, RotateCcw, Sparkles, Volume2, Loader2 } from 'lucide-react'
import api from '../../../../lib/api'

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
  const [copyDropdown, setCopyDropdown] = useState(false)
  const [narrationLoading, setNarrationLoading] = useState(false)
  const [ttsLoading, setTtsLoading] = useState<string | null>(null)
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

    // Load independent language regions + intro
    api.get(`/training/slides/${slideId}/lang-regions`).then(res => {
      const data = res.data || {}
      setLangRegions(data)
      // Extract _intro per language
      const intros: Record<string, any> = {}
      for (const [lang, val] of Object.entries(data)) {
        if ((val as any)?._intro) intros[lang] = (val as any)._intro
      }
      setLangIntro(intros)
    }).catch(() => {})
  }, [slideId])

  const handleUpload = async (file: File) => {
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
  }

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

  // --- Independent regions helpers ---
  const hasIndependentRegions = !!(langRegions[activeLang]?.[String(blockIndex)])
  const independentRegions: Region[] = langRegions[activeLang]?.[String(blockIndex)] || []

  const getDisplayRegions = (): Region[] => {
    if (hasIndependentRegions) return independentRegions
    // Fallback: main regions with legacy coordinate overrides
    const ovr = regionOverrides[activeLang] || {}
    return regions.map(r => ({
      ...r,
      coords: ovr[r.id] ? { ...r.coords, ...ovr[r.id] } : r.coords
    }))
  }

  const createIndependentRegions = () => {
    // Copy from main language as starting point
    const copied = regions.map(r => ({ ...r }))
    setLangRegions(prev => ({
      ...prev,
      [activeLang]: { ...(prev[activeLang] || {}), [String(blockIndex)]: copied }
    }))
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
        regions: langRegions[activeLang]?.[String(blockIndex)] || []
      })
    } catch (e: any) { alert(e.response?.data?.error || '儲存失敗') }
    finally { setSaving(false) }
  }

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

    if (!dragging.id || !hasIndependentRegions) return

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
      if (w > 1.5 && h > 1.5 && hasIndependentRegions) {
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

  const langImage = overrides[activeLang]?.[String(blockIndex)]
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
            {LANGS.map(l => (
              <button key={l.code} onClick={() => { setActiveLang(l.code); setModalSelected(null) }}
                className="text-[10px] px-2 py-0.5 rounded transition"
                style={{
                  backgroundColor: activeLang === l.code ? 'var(--t-accent-bg)' : 'var(--t-bg-card)',
                  color: activeLang === l.code ? 'white' : 'var(--t-text-dim)',
                  border: `1px solid ${activeLang === l.code ? 'var(--t-accent)' : 'var(--t-border)'}`
                }}>
                {l.flag} {l.code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Side-by-side preview */}
        <div className="flex gap-3">
          {/* zh-TW */}
          <div className="flex-1 space-y-1">
            <div className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>🇹🇼 主語言</div>
            {currentImage ? (
              <img src={currentImage} alt="" className="w-full rounded border" style={{ borderColor: 'var(--t-border)', maxHeight: '150px', objectFit: 'contain' }} />
            ) : (
              <div className="h-16 flex items-center justify-center rounded border border-dashed text-[10px]" style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}>無圖片</div>
            )}
          </div>

          {/* Target language */}
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--t-text-dim)' }}>
              {LANGS.find(l => l.code === activeLang)?.flag} {activeLang.toUpperCase()}
            </div>
            {langImage ? (
              <div className="relative group">
                <img src={langImage} alt="" className="w-full rounded border cursor-pointer" style={{ borderColor: 'var(--t-accent)', maxHeight: '150px', objectFit: 'contain' }}
                  onClick={() => setEditModal(true)} title="點擊放大編輯互動區域" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/30 rounded pointer-events-none">
                  <span className="text-white text-xs font-medium flex items-center gap-1"><Maximize2 size={14} /> 放大編輯</span>
                </div>
                <button onClick={handleDelete}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                  <Trash2 size={10} />
                </button>
              </div>
            ) : (
              <label className="h-16 flex flex-col items-center justify-center rounded border-2 border-dashed cursor-pointer transition hover:opacity-80"
                style={{ borderColor: 'var(--t-accent)', color: 'var(--t-accent)' }}>
                <Upload size={14} />
                <span className="text-[9px] mt-0.5">{uploading ? '上傳中...' : '上傳底圖'}</span>
                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]) }} />
              </label>
            )}
          </div>
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
                <button onClick={revertToInherit}
                  className="flex items-center gap-1 px-2 py-0.5 rounded transition text-orange-400"
                  style={{ border: '1px solid var(--t-border)' }}>
                  <RotateCcw size={10} /> 回到繼承
                </button>
              </>
            ) : (
              <>
                <span style={{ color: 'var(--t-text-dim)' }}>📋 繼承主語言 ({regions.length} 個區域)</span>
                <div className="flex-1" />
                <button onClick={createIndependentRegions}
                  className="flex items-center gap-1 px-2 py-0.5 rounded transition"
                  style={{ color: 'var(--t-accent)', border: '1px solid var(--t-accent)' }}>
                  <Copy size={10} /> 建立獨立區域
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
            : '點「建立獨立區域」可為此語言建立獨立的互動區域集合（從主語言複製為起點）。'}
        </p>

        {/* ═══ Voice editing for independent regions ═══ */}
        {hasIndependentRegions && (
          <div className="border-t pt-2 mt-2 space-y-2" style={{ borderColor: 'var(--t-border)' }}>
            <div className="flex items-center gap-2">
              <Volume2 size={10} style={{ color: 'var(--t-accent)' }} />
              <span className="text-[10px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>
                {LANGS.find(l => l.code === activeLang)?.flag} {activeLang.toUpperCase()} 語音導覽
              </span>
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

            {/* Intro narration preview */}
            {langIntro[activeLang] && (
              <div className="text-[9px] space-y-1 rounded p-1.5" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                {[
                  { key: 'slide_narration', audioKey: 'slide_narration_audio', icon: '🎯', label: '導引' },
                  { key: 'slide_narration_test', audioKey: 'slide_narration_test_audio', icon: '📝', label: '測驗' },
                  { key: 'slide_narration_explore', audioKey: 'slide_narration_explore_audio', icon: '🔍', label: '探索' },
                ].map(m => langIntro[activeLang]?.[m.key] && (
                  <div key={m.key}>
                    <span style={{ color: 'var(--t-text-dim)' }}>{m.icon} {m.label}:</span>
                    <span className="ml-1" style={{ color: 'var(--t-text-secondary)' }}>{(langIntro[activeLang][m.key] as string).slice(0, 40)}...</span>
                    {langIntro[activeLang]?.[m.audioKey] && <audio src={langIntro[activeLang][m.audioKey]} controls className="w-full h-5 mt-0.5" style={{ maxHeight: '20px' }} />}
                  </div>
                ))}
              </div>
            )}

            {/* Per-region voice preview */}
            {independentRegions.filter(r => r.correct).map((r, idx) => (
              <div key={r.id} className="text-[9px] rounded p-1.5 space-y-0.5" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
                <span className="font-medium" style={{ color: 'var(--t-text-secondary)' }}>{idx + 1}. {r.label || r.id}</span>
                {r.narration && <div style={{ color: 'var(--t-text-dim)' }}>📖 {r.narration.slice(0, 50)}{r.narration.length > 50 ? '...' : ''}</div>}
                {r.audio_url && <audio src={r.audio_url} controls className="w-full h-5" style={{ maxHeight: '20px' }} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ Full-screen modal for region editing ═══ */}
      {editModal && (langImage || currentImage) && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setEditModal(false)}>
          <div className="relative w-[92vw] max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-white text-sm font-semibold">
                {LANGS.find(l => l.code === activeLang)?.flag} {activeLang.toUpperCase()} — 互動區域編輯
              </span>
              <span className="text-[10px] text-slate-400">
                {modalRegions.length} 個區域
                {hasIndependentRegions ? ' · 獨立' : ' · 繼承（唯讀）'}
              </span>

              {/* Mode toggle (only for independent) */}
              {hasIndependentRegions && (
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={() => setModalMode('select')}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition"
                    style={{
                      backgroundColor: modalMode === 'select' ? 'rgba(56,189,248,0.2)' : 'transparent',
                      color: modalMode === 'select' ? '#38bdf8' : '#94a3b8',
                      border: `1px solid ${modalMode === 'select' ? '#38bdf8' : '#475569'}`
                    }}>
                    <MousePointer size={10} /> 選取
                  </button>
                  <button onClick={() => setModalMode('draw')}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition"
                    style={{
                      backgroundColor: modalMode === 'draw' ? 'rgba(34,197,94,0.2)' : 'transparent',
                      color: modalMode === 'draw' ? '#22c55e' : '#94a3b8',
                      border: `1px solid ${modalMode === 'draw' ? '#22c55e' : '#475569'}`
                    }}>
                    <Pen size={10} /> 繪製
                  </button>
                  <button onClick={addLangRegionAtCenter}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition"
                    style={{ color: '#94a3b8', border: '1px solid #475569' }}>
                    <Plus size={10} /> 新增
                  </button>
                </div>
              )}

              <div className="flex-1" />

              {hasIndependentRegions && (
                <button onClick={e => { e.stopPropagation(); saveIndependentRegions() }} disabled={saving}
                  className="flex items-center gap-1 text-xs text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                  style={{ backgroundColor: '#22c55e' }}>
                  <Save size={12} /> {saving ? '儲存中...' : '儲存'}
                </button>
              )}
              <button onClick={() => setEditModal(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/10">
                <X size={18} />
              </button>
            </div>

            <div className="flex gap-3" style={{ maxHeight: '85vh' }}>
              {/* Image + draggable regions */}
              <div className="flex-1 relative overflow-auto rounded-lg"
                style={{ cursor: modalMode === 'draw' && hasIndependentRegions ? 'crosshair' : (dragging ? 'grabbing' : 'default') }}
                onMouseDown={handleModalMouseDown}
                onMouseMove={onModalMove}
                onMouseUp={onModalUp}
                onMouseLeave={() => { setDragging(null); setDrawPreview(null) }}>
                <img ref={modalImgRef} src={langImage || currentImage} alt="" className="w-full" draggable={false} />

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
                      onClick={e => { e.stopPropagation(); setModalSelected(r.id) }}>
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
                          onMouseDown={e => startRegionDrag(e, r, 'resize')}
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
              </div>

              {/* Right panel: region properties (only for independent) */}
              {hasIndependentRegions && (
                <div className="w-64 shrink-0 flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: '85vh' }}>
                  {/* Region list */}
                  <div className="rounded-lg p-2 space-y-1" style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid #334155' }}>
                    <div className="text-[10px] text-slate-400 font-semibold mb-1">區域列表 ({independentRegions.length})</div>
                    {independentRegions.map(r => (
                      <div key={r.id}
                        onClick={() => setModalSelected(r.id)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] cursor-pointer transition"
                        style={{
                          backgroundColor: modalSelected === r.id ? 'rgba(56,189,248,0.15)' : 'transparent',
                          color: '#e2e8f0'
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
                      <div className="text-[10px] text-slate-500 py-2 text-center">尚無區域</div>
                    )}
                  </div>

                  {/* Selected region properties */}
                  {selectedModalRegion && (
                    <div className="rounded-lg p-2 space-y-2" style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid #334155' }}>
                      <div className="text-[10px] text-slate-400 font-semibold">編輯：{selectedModalRegion.label || selectedModalRegion.id}</div>
                      <div>
                        <label className="text-[9px] text-slate-500 block mb-0.5">標籤名稱</label>
                        <input value={selectedModalRegion.label || ''}
                          onChange={e => updateLangRegion(selectedModalRegion.id, { label: e.target.value })}
                          className="w-full rounded px-2 py-1 text-[10px] focus:outline-none"
                          style={{ backgroundColor: '#1e293b', border: '1px solid #334155', color: '#e2e8f0' }}
                          placeholder="例：帳號、密碼" />
                      </div>
                      <label className="flex items-center gap-2 text-[10px]">
                        <input type="checkbox" checked={selectedModalRegion.correct || false}
                          onChange={e => updateLangRegion(selectedModalRegion.id, { correct: e.target.checked })}
                          className="rounded" />
                        <span style={{ color: selectedModalRegion.correct ? '#4ade80' : '#f87171' }}>
                          {selectedModalRegion.correct ? '正確區域' : '錯誤區域'}
                        </span>
                      </label>
                      <div>
                        <label className="text-[9px] text-slate-500 block mb-0.5">回饋文字</label>
                        <input value={selectedModalRegion.feedback || ''}
                          onChange={e => updateLangRegion(selectedModalRegion.id, { feedback: e.target.value })}
                          className="w-full rounded px-2 py-1 text-[10px] focus:outline-none"
                          style={{ backgroundColor: '#1e293b', border: '1px solid #334155', color: '#e2e8f0' }}
                          placeholder="點擊後的回饋文字" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
