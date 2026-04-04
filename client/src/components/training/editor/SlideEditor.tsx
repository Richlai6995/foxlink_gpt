import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Save, Plus, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Image, Type, MousePointer, GripVertical, Move, RotateCcw, Eye, Layers, Wand2, Loader2 } from 'lucide-react'
import api from '../../../lib/api'
import SlideTemplates, { type SlideTemplate } from './SlideTemplates'
import TextBlockEditor from './blocks/TextBlockEditor'
import ImageBlockEditor from './blocks/ImageBlockEditor'
import HotspotEditor from './blocks/HotspotEditor'
import DragDropEditor from './blocks/DragDropEditor'
import FlipCardEditor from './blocks/FlipCardEditor'
import BranchEditor from './blocks/BranchEditor'
import QuizInlineEditor from './blocks/QuizInlineEditor'
import CalloutEditor from './blocks/CalloutEditor'
import VideoBlockEditor from './blocks/VideoBlockEditor'
import StepsEditor from './blocks/StepsEditor'
import AudioPanel from './AudioPanel'

export interface Block {
  type: string
  [key: string]: any
}

interface Slide {
  id: number
  slide_type?: string
  content_json?: string
  [key: string]: any
}

interface Props {
  slideId: number
  courseId: number
  slideList?: Slide[]
  onSlideChange?: (slideId: number) => void
  onClose: () => void
  onSaved?: () => void
}

const BLOCK_TYPES = [
  { type: 'text', label: '文字', icon: Type, color: 'text-slate-400' },
  { type: 'image', label: '圖片', icon: Image, color: 'text-blue-400' },
  { type: 'steps', label: '步驟', icon: Layers, color: 'text-cyan-400' },
  { type: 'callout', label: '提示框', icon: Type, color: 'text-yellow-400' },
  { type: 'video', label: '影片', icon: Eye, color: 'text-purple-400' },
  { type: 'hotspot', label: '熱點互動', icon: MousePointer, color: 'text-red-400' },
  { type: 'dragdrop', label: '拖放互動', icon: Move, color: 'text-purple-400' },
  { type: 'flipcard', label: '翻轉卡片', icon: RotateCcw, color: 'text-amber-400' },
  { type: 'branch', label: '分支選擇', icon: GripVertical, color: 'text-green-400' },
  { type: 'quiz_inline', label: '內嵌測驗', icon: Type, color: 'text-blue-400' },
]

export default function SlideEditor({ slideId, courseId, slideList = [], onSlideChange, onClose, onSaved }: Props) {
  const currentSlideIdx = slideList.findIndex(s => s.id === slideId)
  const canGoPrev = currentSlideIdx > 0
  const canGoNext = currentSlideIdx < slideList.length - 1 && currentSlideIdx >= 0

  const getSlideLabel = (s: Slide, idx: number) => {
    try {
      const blocks = JSON.parse(s.content_json || '[]')
      const first = blocks[0]
      if (first?.instruction) return first.instruction.slice(0, 30)
      if (first?.content) return first.content.slice(0, 30)
      if (first?.text) return first.text.slice(0, 30)
    } catch {}
    return `投影片 ${idx + 1}`
  }
  const [blocks, setBlocks] = useState<Block[]>([])
  const [notes, setNotes] = useState('')
  const [slideType, setSlideType] = useState('content')
  const [saving, setSaving] = useState(false)
  const [showAddBlock, setShowAddBlock] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [activeBlockIdx, setActiveBlockIdx] = useState<number | null>(null)
  const [aiAnalyzing, setAiAnalyzing] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  const aiAnalyze = async () => {
    try {
      setAiAnalyzing(true)
      const res = await api.post(`/training/slides/${slideId}/ai-analyze`, {}, { timeout: 30000 })
      if (res.data.ok) {
        await loadSlide() // reload to get updated content
      }
    } catch (e: any) {
      alert(e.response?.data?.error || 'AI 分析失敗')
    } finally { setAiAnalyzing(false) }
  }

  useEffect(() => {
    loadSlide()
  }, [slideId])

  const loadSlide = async () => {
    try {
      // Get slide data from parent lesson's slides list — or direct endpoint
      const res = await api.get(`/training/slides/${slideId}` ).catch(() => null)
      if (!res) return
      const slide = res.data
      try {
        const parsed = JSON.parse(slide.content_json || '[]')
        setBlocks(parsed)
        if (parsed.length > 0 && activeBlockIdx === null) setActiveBlockIdx(0)
      } catch { setBlocks([]) }
      setNotes(slide.notes || '')
      setSlideType(slide.slide_type || 'content')
      setAudioUrl(slide.audio_url || null)
    } catch (e) { console.error(e) }
  }

  const save = async () => {
    try {
      setSaving(true)
      await api.put(`/training/slides/${slideId}`, {
        slide_type: slideType,
        content_json: JSON.stringify(blocks),
        notes
      })
      onSaved?.()
    } catch (e: any) {
      alert(e.response?.data?.error || '儲存失敗')
    } finally { setSaving(false) }
  }

  const addBlock = (type: string) => {
    const newBlock = createDefaultBlock(type)
    setBlocks([...blocks, newBlock])
    setActiveBlockIdx(blocks.length)
    setShowAddBlock(false)
  }

  const applyTemplate = (template: SlideTemplate) => {
    setBlocks(template.content_json)
    setShowTemplates(false)
  }

  const updateBlock = useCallback((idx: number, updated: Block) => {
    setBlocks(prev => prev.map((b, i) => i === idx ? updated : b))
  }, [])

  const removeBlock = (idx: number) => {
    setBlocks(blocks.filter((_, i) => i !== idx))
    setActiveBlockIdx(null)
  }

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= blocks.length) return
    const newBlocks = [...blocks]
    ;[newBlocks[idx], newBlocks[newIdx]] = [newBlocks[newIdx], newBlocks[idx]]
    setBlocks(newBlocks)
    setActiveBlockIdx(newIdx)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)' }}>
      {/* Header */}
      <div className="border-b px-4 py-2 flex items-center gap-3 shrink-0" style={{ backgroundColor: 'var(--t-bg-elevated)', borderColor: 'var(--t-border)' }}>
        <button onClick={onClose} style={{ color: 'var(--t-text-muted)' }} className="hover:opacity-80">
          <ArrowLeft size={18} />
        </button>

        {/* Slide navigation */}
        {slideList.length > 1 && onSlideChange && (
          <div className="flex items-center gap-1">
            <button onClick={() => canGoPrev && onSlideChange(slideList[currentSlideIdx - 1].id)}
              disabled={!canGoPrev}
              className="w-6 h-6 rounded flex items-center justify-center transition disabled:opacity-20 hover:bg-white/10"
              style={{ color: 'var(--t-text-muted)' }}>
              <ChevronLeft size={16} />
            </button>
            <span className="text-[10px] px-1" style={{ color: 'var(--t-text-dim)' }}>
              {currentSlideIdx + 1}/{slideList.length}
            </span>
            <button onClick={() => canGoNext && onSlideChange(slideList[currentSlideIdx + 1].id)}
              disabled={!canGoNext}
              className="w-6 h-6 rounded flex items-center justify-center transition disabled:opacity-20 hover:bg-white/10"
              style={{ color: 'var(--t-text-muted)' }}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <span className="text-sm font-medium truncate max-w-[200px]">
          {currentSlideIdx >= 0 ? getSlideLabel(slideList[currentSlideIdx], currentSlideIdx) : '投影片編輯'}
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>{slideType}</span>
        <div className="flex-1" />

        <button onClick={() => setShowTemplates(true)}
          className="text-xs px-2 py-1 rounded transition" style={{ color: 'var(--t-text-muted)' }}>
          版型模板
        </button>
        <button onClick={aiAnalyze} disabled={aiAnalyzing}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: 'var(--t-border)', color: 'var(--t-accent)' }}
          title="用 AI 重新分析此投影片的截圖，更新操作說明和互動區域">
          {aiAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          {aiAnalyzing ? 'AI 分析中...' : 'AI 分析'}
        </button>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50"
          style={{ backgroundColor: 'var(--t-accent-bg)' }}>
          <Save size={13} /> {saving ? '儲存中...' : '儲存'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Block List (left) */}
        <div className="w-72 border-r flex flex-col overflow-y-auto" style={{ backgroundColor: 'var(--t-bg-inset)', borderColor: 'var(--t-border)' }}>
          <div className="p-3 text-xs font-semibold uppercase flex items-center justify-between" style={{ color: 'var(--t-text-muted)' }}>
            <span>Block 列表 ({blocks.length})</span>
            <button onClick={() => setShowAddBlock(!showAddBlock)} style={{ color: 'var(--t-accent)' }}>
              <Plus size={14} />
            </button>
          </div>

          {/* Add block dropdown */}
          {showAddBlock && (
            <div className="px-3 pb-2 grid grid-cols-2 gap-1">
              {BLOCK_TYPES.map(bt => (
                <button key={bt.type} onClick={() => addBlock(bt.type)}
                  className="flex items-center gap-1.5 text-[10px] rounded px-2 py-1.5 transition hover:opacity-80"
                  style={{ color: 'var(--t-text-secondary)' }}>
                  <bt.icon size={11} className={bt.color} /> {bt.label}
                </button>
              ))}
            </div>
          )}

          {/* Block items */}
          {blocks.map((block, idx) => (
            <div key={idx}
              onClick={() => setActiveBlockIdx(idx)}
              className="group mx-2 mb-1 px-2 py-2 rounded-lg text-xs cursor-pointer flex items-center gap-2 transition border"
              style={{
                backgroundColor: activeBlockIdx === idx ? 'var(--t-accent-subtle)' : 'transparent',
                borderColor: activeBlockIdx === idx ? 'var(--t-accent)' : 'transparent'
              }}
            >
              <span className="text-[9px] w-4" style={{ color: 'var(--t-text-dim)' }}>{idx + 1}</span>
              <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase shrink-0 ${
                block.type === 'hotspot' ? 'bg-red-500/20 text-red-400' :
                block.type === 'dragdrop' ? 'bg-purple-500/20 text-purple-400' :
                block.type === 'flipcard' ? 'bg-amber-500/20 text-amber-400' :
                block.type === 'branch' ? 'bg-green-500/20 text-green-400' :
                block.type === 'quiz_inline' ? 'bg-blue-500/20 text-blue-400' :
                'bg-slate-600/30 text-slate-400'
              }`}>{block.type}</span>
              <span className="flex-1 truncate" style={{ color: 'var(--t-text-muted)' }}>
                {block.content?.slice(0, 20) || block.instruction?.slice(0, 20) || block.text?.slice(0, 20) || ''}
              </span>
              <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--t-text-dim)' }}>
                <button onClick={e => { e.stopPropagation(); moveBlock(idx, -1) }} className="hover:opacity-70 p-0.5">
                  <ChevronUp size={10} />
                </button>
                <button onClick={e => { e.stopPropagation(); moveBlock(idx, 1) }} className="hover:opacity-70 p-0.5">
                  <ChevronDown size={10} />
                </button>
                <button onClick={e => { e.stopPropagation(); removeBlock(idx) }} className="hover:text-red-500 p-0.5">
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}

          {blocks.length === 0 && (
            <div className="px-3 py-8 text-center text-xs" style={{ color: 'var(--t-text-dim)' }}>
              <p>尚無 Block</p>
              <button onClick={() => setShowAddBlock(true)} style={{ color: 'var(--t-accent)' }} className="mt-2">
                + 新增第一個 Block
              </button>
            </div>
          )}

          {/* Audio Panel (bottom) */}
          <AudioPanel
            slideId={slideId}
            courseId={courseId}
            audioUrl={audioUrl}
            notes={notes}
            onAudioChange={setAudioUrl}
            onNotesChange={setNotes}
          />
        </div>

        {/* Block Editor (right) */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeBlockIdx !== null && blocks[activeBlockIdx] ? (
            <BlockEditorSwitch
              block={blocks[activeBlockIdx]}
              onChange={(updated) => updateBlock(activeBlockIdx, updated)}
              courseId={courseId}
              slideId={slideId}
              blockIdx={activeBlockIdx}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--t-text-dim)' }}>
              <Layers size={48} className="mb-3 opacity-30" />
              <p className="text-sm">選擇左側 Block 或新增一個開始編輯</p>
            </div>
          )}
        </div>
      </div>

      {/* Template overlay */}
      {showTemplates && (
        <SlideTemplates onSelect={applyTemplate} onClose={() => setShowTemplates(false)} />
      )}
    </div>
  )
}

// Route to correct block editor
function BlockEditorSwitch({ block, onChange, courseId, slideId, blockIdx }: { block: Block; onChange: (b: Block) => void; courseId: number; slideId?: number; blockIdx?: number }) {
  switch (block.type) {
    case 'text': return <TextBlockEditor block={block} onChange={onChange} />
    case 'image': return <ImageBlockEditor block={block} onChange={onChange} courseId={courseId} slideId={slideId} blockIdx={blockIdx} />
    case 'steps': return <StepsEditor block={block} onChange={onChange} />
    case 'callout': return <CalloutEditor block={block} onChange={onChange} />
    case 'video': return <VideoBlockEditor block={block} onChange={onChange} />
    case 'hotspot': return <HotspotEditor block={block} onChange={onChange} courseId={courseId} slideId={slideId} blockIdx={blockIdx} />
    case 'dragdrop': return <DragDropEditor block={block} onChange={onChange} />
    case 'flipcard': return <FlipCardEditor block={block} onChange={onChange} />
    case 'branch': return <BranchEditor block={block} onChange={onChange} />
    case 'quiz_inline': return <QuizInlineEditor block={block} onChange={onChange} />
    default:
      return <div className="text-slate-500 text-sm">不支援的 Block 類型: {block.type}</div>
  }
}

function createDefaultBlock(type: string): Block {
  switch (type) {
    case 'text': return { type: 'text', content: '' }
    case 'image': return { type: 'image', src: '', alt: '', annotations: [] }
    case 'steps': return { type: 'steps', items: [{ title: '步驟 1', desc: '' }] }
    case 'callout': return { type: 'callout', variant: 'tip', content: '' }
    case 'video': return { type: 'video', src: '', source_type: 'upload' }
    case 'hotspot': return { type: 'hotspot', image: '', instruction: '', regions: [], max_attempts: 3, show_hint_after: 2 }
    case 'dragdrop': return { type: 'dragdrop', mode: 'ordering', instruction: '', items: [], targets: [], feedback_correct: '正確！', feedback_incorrect: '再試一次。' }
    case 'flipcard': return { type: 'flipcard', instruction: '', cards: [{ front: { text: '' }, back: { text: '' } }], layout: 'grid', columns: 2 }
    case 'branch': return { type: 'branch', scenario: '', options: [{ text: '', target_slide_id: null, is_best: false }] }
    case 'quiz_inline': return { type: 'quiz_inline', question: '', question_type: 'single_choice', options: [{ text: '', correct: false }], explanation: '', points: 10 }
    default: return { type }
  }
}
