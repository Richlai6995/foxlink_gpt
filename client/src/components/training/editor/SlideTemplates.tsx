import { X } from 'lucide-react'
import type { Block } from './SlideEditor'

export interface SlideTemplate {
  id: string
  name: string
  thumbnail: string
  content_json: Block[]
}

const TEMPLATES: SlideTemplate[] = [
  {
    id: 'title_page',
    name: '標題頁',
    thumbnail: '■■■■',
    content_json: [
      { type: 'text', content: '# 課程標題\n\n副標題或說明文字', style: { textAlign: 'center' } }
    ]
  },
  {
    id: 'image_left_text_right',
    name: '左圖右文',
    thumbnail: '▨■■',
    content_json: [
      { type: 'image', src: '', alt: '', annotations: [], layout: 'left' },
      { type: 'text', content: '## 說明\n\n在此輸入說明文字...' }
    ]
  },
  {
    id: 'text_left_image_right',
    name: '右圖左文',
    thumbnail: '■■▨',
    content_json: [
      { type: 'text', content: '## 說明\n\n在此輸入說明文字...' },
      { type: 'image', src: '', alt: '', annotations: [], layout: 'right' }
    ]
  },
  {
    id: 'step_by_step',
    name: '步驟教學',
    thumbnail: '1.▨\n2.▨',
    content_json: [
      { type: 'text', content: '## 操作步驟' },
      { type: 'steps', items: [
        { title: '步驟 1', desc: '說明文字', image: '' },
        { title: '步驟 2', desc: '說明文字', image: '' },
        { title: '步驟 3', desc: '說明文字', image: '' }
      ]}
    ]
  },
  {
    id: 'fullscreen_hotspot',
    name: '全幅截圖 + 互動',
    thumbnail: '▨●',
    content_json: [
      { type: 'hotspot', image: '', instruction: '請點擊正確的位置', regions: [], max_attempts: 3, show_hint_after: 2 }
    ]
  },
  {
    id: 'comparison',
    name: '雙欄比較',
    thumbnail: '■|■',
    content_json: [
      { type: 'text', content: '## 比較\n\n| 項目 | 做法 A | 做法 B |\n|------|--------|--------|\n| 優點 |  |  |\n| 缺點 |  |  |' }
    ]
  },
  {
    id: 'flipcard_grid',
    name: '卡片展示',
    thumbnail: '○○\n○○',
    content_json: [
      { type: 'flipcard', instruction: '點擊卡片翻轉查看', cards: [
        { front: { text: '問題 1' }, back: { text: '答案 1' } },
        { front: { text: '問題 2' }, back: { text: '答案 2' } },
        { front: { text: '問題 3' }, back: { text: '答案 3' } },
        { front: { text: '問題 4' }, back: { text: '答案 4' } }
      ], layout: 'grid', columns: 2 }
    ]
  },
  {
    id: 'video_page',
    name: '影片頁',
    thumbnail: '▶▨',
    content_json: [
      { type: 'video', src: '', source_type: 'upload' },
      { type: 'text', content: '影片說明文字...' }
    ]
  },
  {
    id: 'quiz_page',
    name: '測驗頁',
    thumbnail: '?○○',
    content_json: [
      { type: 'quiz_inline', question: '請回答以下問題', question_type: 'single_choice',
        options: [{ text: '選項 A', correct: true }, { text: '選項 B', correct: false }, { text: '選項 C', correct: false }],
        explanation: '', points: 10 }
    ]
  },
  {
    id: 'blank',
    name: '空白',
    thumbnail: '　',
    content_json: []
  }
]

interface Props {
  onSelect: (template: SlideTemplate) => void
  onClose: () => void
}

export default function SlideTemplates({ onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-60 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-[640px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">選擇版型模板</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={16} /></button>
        </div>
        <div className="p-4 grid grid-cols-3 gap-3">
          {TEMPLATES.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => onSelect(tpl)}
              className="bg-slate-900 border border-slate-700 rounded-lg p-3 hover:border-sky-500 transition text-left group"
            >
              <div className="h-16 bg-slate-800 rounded flex items-center justify-center text-slate-600 text-xs font-mono whitespace-pre mb-2 group-hover:text-sky-400">
                {tpl.thumbnail}
              </div>
              <div className="text-xs text-slate-300 text-center">{tpl.name}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
