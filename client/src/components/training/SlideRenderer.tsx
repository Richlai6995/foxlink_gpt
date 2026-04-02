import { useMemo } from 'react'
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
}

interface Block {
  type: string
  [key: string]: any
}

export default function SlideRenderer({ slide }: { slide: Slide }) {
  const blocks: Block[] = useMemo(() => {
    try { return JSON.parse(slide.content_json || '[]') }
    catch { return [] }
  }, [slide.content_json])

  if (blocks.length === 0) {
    return <div className="text-center text-slate-600 py-20">（空投影片）</div>
  }

  return (
    <div className="space-y-6">
      {blocks.map((block, idx) => (
        <BlockRenderer key={idx} block={block} />
      ))}
    </div>
  )
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case 'text':
      return (
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{block.content || ''}</ReactMarkdown>
        </div>
      )

    case 'image':
      return (
        <div>
          {block.src && <img src={block.src} alt={block.alt || ''} className="max-w-full rounded-lg mx-auto" />}
          {block.annotations?.length > 0 && (
            <div className="relative" style={{ marginTop: block.src ? '-100%' : 0 }}>
              {/* Annotations would be SVG overlays - simplified for now */}
            </div>
          )}
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
      const colors: Record<string, string> = {
        tip: 'border-sky-500 bg-sky-500/10 text-sky-200',
        warning: 'border-yellow-500 bg-yellow-500/10 text-yellow-200',
        note: 'border-purple-500 bg-purple-500/10 text-purple-200',
        important: 'border-red-500 bg-red-500/10 text-red-200',
      }
      const labels: Record<string, string> = { tip: '提示', warning: '警告', note: '注意', important: '重要' }
      return (
        <div className={`border-l-4 rounded-r-lg px-4 py-3 ${colors[block.variant] || colors.tip}`}>
          <div className="text-xs font-bold mb-1">{labels[block.variant] || '提示'}</div>
          <div className="text-sm">{block.content}</div>
        </div>
      )
    }

    case 'video':
      return (
        <div className="bg-black rounded-lg overflow-hidden">
          {block.src ? (
            <video src={block.src} controls className="w-full max-h-[60vh]" />
          ) : (
            <div className="py-20 text-center text-slate-600">影片未設定</div>
          )}
        </div>
      )

    case 'code':
      return (
        <pre className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-xs font-mono overflow-x-auto">
          <code>{block.text || block.content || ''}</code>
        </pre>
      )

    case 'hotspot': return <HotspotBlock block={block} />
    case 'dragdrop': return <DragDropBlock block={block} />
    case 'flipcard': return <FlipCardBlock block={block} />
    case 'branch': return <BranchBlock block={block} />
    case 'quiz_inline': return <QuizInlineBlock block={block} />

    default:
      return <div className="text-slate-500 text-xs">不支援的 block 類型: {block.type}</div>
  }
}
