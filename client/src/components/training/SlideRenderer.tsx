import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import HotspotBlock from './blocks/HotspotBlock'
import DragDropBlock from './blocks/DragDropBlock'
import FlipCardBlock from './blocks/FlipCardBlock'
import BranchBlock from './blocks/BranchBlock'
import QuizInlineBlock from './blocks/QuizInlineBlock'

interface Slide {
  id: number
  slide_type: string
  content_json: string
  notes: string | null
  audio_url?: string | null
}

interface Block {
  type: string
  [key: string]: any
}

export default function SlideRenderer({ slide, isLastSlide = false, playerMode = 'learn', audioMuted = false, autoPlay = false, onInteractionComplete, onAutoPlayDone }: { slide: Slide; isLastSlide?: boolean; playerMode?: 'learn' | 'test'; audioMuted?: boolean; autoPlay?: boolean; onInteractionComplete?: (slideId: number, result: any) => void; onAutoPlayDone?: () => void }) {
  const { t } = useTranslation()
  const blocks: Block[] = useMemo(() => {
    try { return JSON.parse(slide.content_json || '[]') }
    catch { return [] }
  }, [slide.content_json])

  if (blocks.length === 0) {
    return <div className="text-center text-slate-600 py-20">{t('training.emptySlide')}</div>
  }

  return (
    <div className="space-y-6">
      {blocks.map((block, idx) => (
        <BlockRenderer key={idx} block={block} blockIndex={idx} isLastSlide={isLastSlide} playerMode={playerMode} slideAudioUrl={slide.audio_url} audioMuted={audioMuted} autoPlay={autoPlay}
          onInteractionComplete={onInteractionComplete ? (result: any) => onInteractionComplete(slide.id, result) : undefined}
          onAutoPlayDone={onAutoPlayDone} />
      ))}
    </div>
  )
}

function BlockRenderer({ block, blockIndex = 0, isLastSlide = false, playerMode = 'learn', slideAudioUrl, audioMuted = false, autoPlay = false, onInteractionComplete, onAutoPlayDone }: { block: Block; blockIndex?: number; isLastSlide?: boolean; playerMode?: 'learn' | 'test'; slideAudioUrl?: string | null; audioMuted?: boolean; autoPlay?: boolean; onInteractionComplete?: (result: any) => void; onAutoPlayDone?: () => void }) {
  const { t } = useTranslation()
  switch (block.type) {
    case 'text':
      return (
        <div className="prose prose-sm max-w-none" style={{ color: 'var(--t-text)' }}>
          <ReactMarkdown>{block.content || ''}</ReactMarkdown>
        </div>
      )

    case 'image':
      return (
        <div className="relative">
          {block.src && <img src={block.src} alt={block.alt || ''} className="max-w-full rounded-lg mx-auto" />}
          {/* Annotations are for AI recording hints only — hidden in player (learn/test) */}
        </div>
      )

    case 'steps':
      return (
        <div className="space-y-3">
          {(block.items || []).map((item: any, idx: number) => (
            <div key={idx} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-sky-600/20 flex items-center justify-center text-sky-400 text-sm font-bold shrink-0">
                {idx + 1}
              </div>
              <div>
                <div className="font-medium text-sm">{item.title}</div>
                {item.desc && <div className="text-xs text-slate-400 mt-0.5">{item.desc}</div>}
                {item.image && <img src={item.image} alt="" className="mt-2 rounded max-h-48" />}
              </div>
            </div>
          ))}
        </div>
      )

    case 'callout': {
      const colorMap: Record<string, { border: string; bg: string }> = {
        tip:       { border: '#0ea5e9', bg: 'rgba(14,165,233,0.08)' },
        warning:   { border: '#eab308', bg: 'rgba(234,179,8,0.08)' },
        note:      { border: '#a855f7', bg: 'rgba(168,85,247,0.08)' },
        important: { border: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
      }
      const labels: Record<string, string> = { tip: t('training.calloutTip'), warning: t('training.calloutWarning'), note: t('training.calloutNote'), important: t('training.calloutImportant') }
      const c = colorMap[block.variant] || colorMap.tip
      return (
        <div className="rounded-r-lg px-4 py-3" style={{ borderLeft: `4px solid ${c.border}`, backgroundColor: c.bg }}>
          <div className="text-xs font-bold mb-1" style={{ color: c.border }}>{labels[block.variant] || t('training.calloutTip')}</div>
          <div className="text-sm" style={{ color: 'var(--t-text-secondary)' }}>{block.content}</div>
        </div>
      )
    }

    case 'video':
      return (
        <div className="bg-black rounded-lg overflow-hidden">
          {block.src ? (
            <video src={block.src} controls className="w-full max-h-[60vh]" />
          ) : (
            <div className="py-20 text-center text-slate-600">{t('training.videoNotSet')}</div>
          )}
        </div>
      )

    case 'code':
      return (
        <pre className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-xs font-mono overflow-x-auto">
          <code>{block.text || block.content || ''}</code>
        </pre>
      )

    case 'hotspot': return <HotspotBlock block={block} blockIndex={blockIndex} isLastSlide={isLastSlide} playerMode={playerMode} slideAudioUrl={slideAudioUrl} globalMuted={audioMuted} autoPlay={autoPlay} onInteractionComplete={onInteractionComplete} onAutoPlayDone={onAutoPlayDone} />
    case 'dragdrop': return <DragDropBlock block={block} blockIndex={blockIndex} playerMode={playerMode} onInteractionComplete={onInteractionComplete} />
    case 'flipcard': return <FlipCardBlock block={block} />
    case 'branch': return <BranchBlock block={block} />
    case 'quiz_inline': return <QuizInlineBlock block={block} blockIndex={blockIndex} playerMode={playerMode} onInteractionComplete={onInteractionComplete} />

    default:
      return <div className="text-slate-500 text-xs">{t('training.unsupportedBlock')} {block.type}</div>
  }
}
