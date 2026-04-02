import { useState, useRef, useEffect } from 'react'
import { Upload, X, ClipboardPaste } from 'lucide-react'
import api from '../../../../lib/api'
import type { Block } from '../SlideEditor'

interface Props {
  block: Block
  onChange: (b: Block) => void
  courseId: number
}

export default function ImageBlockEditor({ block, onChange, courseId }: Props) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const uploadImageFile = async (file: File | Blob, filename?: string) => {
    try {
      setUploading(true)
      const form = new FormData()
      form.append('file', file, filename || 'pasted_image.png')
      const res = await api.post(`/training/courses/${courseId}/upload`, form)
      onChange({ ...block, src: res.data.url })
    } catch (err) { console.error(err) }
    finally { setUploading(false) }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadImageFile(file, file.name)
  }

  // Clipboard paste
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

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-300">圖片 Block</h3>

      {block.src ? (
        <div className="relative group">
          <img src={block.src} alt={block.alt || ''} className="max-h-96 rounded-lg border border-slate-700" />
          <button
            onClick={() => onChange({ ...block, src: '' })}
            className="absolute top-2 right-2 bg-red-600 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-slate-700 rounded-lg py-12 flex flex-col items-center justify-center cursor-pointer hover:border-sky-500 transition"
        >
          <Upload size={24} className="text-slate-500 mb-2" />
          <p className="text-xs text-slate-500">{uploading ? '上傳中...' : '點擊上傳圖片'}</p>
          <p className="text-[10px] text-slate-600 mt-2 flex items-center gap-1">
            <ClipboardPaste size={11} /> 或直接 Ctrl+V 貼上剪貼簿圖片
          </p>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      <div>
        <label className="text-xs text-slate-500 mb-1 block">圖片網址（或上傳）</label>
        <input
          value={block.src || ''}
          onChange={e => onChange({ ...block, src: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-sky-500"
          placeholder="https://..."
        />
      </div>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">替代文字</label>
        <input
          value={block.alt || ''}
          onChange={e => onChange({ ...block, alt: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-sky-500"
          placeholder="圖片描述"
        />
      </div>
    </div>
  )
}
