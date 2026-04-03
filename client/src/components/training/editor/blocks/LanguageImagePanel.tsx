/**
 * Phase 3A-2: LanguageImagePanel — 多語底圖管理 + Region 位置微調
 * 點擊底圖可放大到 modal，在大圖上拖拉調整 region 位置。
 */
import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, Globe, Save, Maximize2, X } from 'lucide-react'
import api from '../../../../lib/api'

interface Region {
  id: string
  coords: { x: number; y: number; w: number; h: number }
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

export default function LanguageImagePanel({ slideId, blockIndex, currentImage, regions = [] }: Props) {
  const [overrides, setOverrides] = useState<Record<string, any>>({})
  const [activeLang, setActiveLang] = useState('en')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [regionOverrides, setRegionOverrides] = useState<Record<string, Record<string, any>>>({})
  const [editModal, setEditModal] = useState(false)
  const [dragging, setDragging] = useState<{
    id: string; mode: 'move' | 'resize';
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number
  } | null>(null)
  const modalImgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    api.get(`/training/slides/${slideId}/lang-images`).then(res => {
      const data = res.data || {}
      setOverrides(data)
      const rOvr: Record<string, Record<string, any>> = {}
      for (const [lang, val] of Object.entries(data)) {
        if ((val as any)?.region_overrides) rOvr[lang] = (val as any).region_overrides
      }
      setRegionOverrides(rOvr)
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
        if (copy[activeLang]) { delete copy[activeLang][String(blockIndex)]; }
        return copy
      })
    } catch {}
  }

  const saveRegionOverrides = async () => {
    try {
      setSaving(true)
      await api.put(`/training/slides/${slideId}/region-overrides`, {
        lang: activeLang,
        region_overrides: regionOverrides[activeLang] || {}
      })
    } catch (e: any) { alert(e.response?.data?.error || '儲存失敗') }
    finally { setSaving(false) }
  }

  const getEffectiveRegions = () => {
    const ovr = regionOverrides[activeLang] || {}
    return regions.map(r => ({
      ...r,
      coords: ovr[r.id] ? { ...r.coords, ...ovr[r.id] } : r.coords
    }))
  }

  // Modal drag handlers
  const toPct = (e: React.MouseEvent) => {
    if (!modalImgRef.current) return { x: 0, y: 0 }
    const rect = modalImgRef.current.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 }
  }

  const startDrag = (e: React.MouseEvent, r: Region, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation()
    const pt = toPct(e)
    const eff = getEffectiveRegions().find(er => er.id === r.id)
    if (!eff) return
    setDragging({
      id: r.id, mode,
      startX: pt.x, startY: pt.y,
      origX: eff.coords.x, origY: eff.coords.y,
      origW: eff.coords.w, origH: eff.coords.h
    })
  }

  const onModalMove = (e: React.MouseEvent) => {
    if (!dragging) return
    const pt = toPct(e)
    const dx = pt.x - dragging.startX
    const dy = pt.y - dragging.startY

    if (dragging.mode === 'move') {
      setRegionOverrides(prev => ({
        ...prev,
        [activeLang]: {
          ...(prev[activeLang] || {}),
          [dragging.id]: { x: dragging.origX + dx, y: dragging.origY + dy, w: dragging.origW, h: dragging.origH }
        }
      }))
    } else {
      // resize: change w and h
      setRegionOverrides(prev => ({
        ...prev,
        [activeLang]: {
          ...(prev[activeLang] || {}),
          [dragging.id]: {
            x: dragging.origX, y: dragging.origY,
            w: Math.max(2, dragging.origW + dx),
            h: Math.max(2, dragging.origH + dy)
          }
        }
      }))
    }
  }

  const langImage = overrides[activeLang]?.[String(blockIndex)]
  const effectiveRegions = getEffectiveRegions()
  const hasRegionChanges = Object.keys(regionOverrides[activeLang] || {}).length > 0

  return (
    <>
      <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))' }}>
        <div className="flex items-center gap-2">
          <Globe size={12} style={{ color: 'var(--t-accent)' }} />
          <span className="text-[11px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>多語底圖</span>
          <div className="flex gap-1 ml-auto">
            {LANGS.map(l => (
              <button key={l.code} onClick={() => setActiveLang(l.code)}
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
            <div className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>🇹🇼 zh-TW（主圖）</div>
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
              {hasRegionChanges && <span className="text-orange-400">（已調整）</span>}
            </div>
            {langImage ? (
              <div className="relative group">
                <img src={langImage} alt="" className="w-full rounded border cursor-pointer" style={{ borderColor: 'var(--t-accent)', maxHeight: '150px', objectFit: 'contain' }}
                  onClick={() => setEditModal(true)} title="點擊放大編輯互動位置" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/30 rounded pointer-events-none">
                  <span className="text-white text-xs font-medium flex items-center gap-1"><Maximize2 size={14} /> 放大調整位置</span>
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

        {hasRegionChanges && (
          <button onClick={saveRegionOverrides} disabled={saving}
            className="flex items-center gap-1 text-[10px] text-white px-3 py-1 rounded transition disabled:opacity-50"
            style={{ backgroundColor: 'var(--t-accent-bg)' }}>
            <Save size={10} /> {saving ? '儲存中...' : '儲存位置調整'}
          </button>
        )}

        <p className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>
          上傳底圖後點擊圖片可放大，在大圖上拖拉綠框調整互動位置。
        </p>
      </div>

      {/* ═══ Full-screen modal for region editing ═══ */}
      {editModal && langImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setEditModal(false)}>
          <div className="relative w-[90vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-white text-sm font-semibold">
                {LANGS.find(l => l.code === activeLang)?.flag} {activeLang.toUpperCase()} — 拖拉綠框調整互動位置
              </span>
              <span className="text-[10px] text-slate-400">
                {regions.length} 個互動區域
                {hasRegionChanges && ' · 已調整'}
              </span>
              <div className="flex-1" />
              {hasRegionChanges && (
                <button onClick={e => { e.stopPropagation(); saveRegionOverrides() }} disabled={saving}
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

            {/* Image + draggable regions */}
            <div className="relative overflow-auto rounded-lg" style={{ maxHeight: '85vh' }}
              onMouseMove={onModalMove} onMouseUp={() => setDragging(null)} onMouseLeave={() => setDragging(null)}>
              <img ref={modalImgRef} src={langImage} alt="" className="w-full" draggable={false}
                style={{ cursor: dragging ? 'grabbing' : 'default' }} />

              {effectiveRegions.map(r => {
                const isActive = dragging?.id === r.id
                return (
                <div key={r.id}
                  className="absolute border-2 rounded transition-shadow"
                  style={{
                    left: `${r.coords.x}%`, top: `${r.coords.y}%`,
                    width: `${r.coords.w}%`, height: `${r.coords.h}%`,
                    borderColor: isActive ? '#facc15' : '#22c55e',
                    background: isActive ? 'rgba(250,204,21,0.15)' : 'rgba(34,197,94,0.1)',
                    cursor: dragging?.mode === 'resize' ? 'nwse-resize' : 'grab',
                    boxShadow: isActive ? '0 0 0 3px rgba(250,204,21,0.4)' : 'none'
                  }}
                  onMouseDown={e => startDrag(e, r, 'move')}>
                  {/* Label */}
                  <span className="absolute -top-5 left-0 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm"
                    style={{ backgroundColor: isActive ? '#facc15' : '#22c55e', color: isActive ? '#000' : '#fff' }}>
                    {r.label || r.id}
                  </span>
                  {/* Resize handle — bottom-right corner */}
                  <div
                    className="absolute -bottom-1 -right-1 w-3 h-3 rounded-sm"
                    style={{ backgroundColor: '#22c55e', cursor: 'nwse-resize', border: '1px solid white' }}
                    onMouseDown={e => startDrag(e, r, 'resize')}
                    title="拖拉調整大小"
                  />
                </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
