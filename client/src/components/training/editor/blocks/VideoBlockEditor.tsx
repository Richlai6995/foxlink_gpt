import { useState, useRef } from 'react'
import { Upload, X } from 'lucide-react'
import api from '../../../../lib/api'
import { proxiedVideoUrl } from '../../../../lib/videoUrl'
import type { Block } from '../SlideEditor'

interface Props {
  block: Block
  onChange: (b: Block) => void
  courseId: number
}

const VIDEO_MAX_MB = 50  // server multer limit

export default function VideoBlockEditor({ block, onChange, courseId }: Props) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const sizeMB = file.size / 1024 / 1024
    if (sizeMB > VIDEO_MAX_MB) {
      alert(`檔案 ${sizeMB.toFixed(1)}MB 超過 ${VIDEO_MAX_MB}MB 上限,請壓縮後再上傳或改用「影片網址」`)
      return
    }

    try {
      setUploading(true)
      const form = new FormData()
      form.append('file', file, file.name)
      const res = await api.post(`/training/courses/${courseId}/upload`, form)
      onChange({ ...block, src: res.data.url, source_type: 'upload' })
    } catch (err: any) {
      console.error(err)
      alert(err.response?.data?.error || '影片上傳失敗')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--t-text-secondary)' }}>影片 Block</h3>

      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>來源類型</label>
        <div className="flex gap-2">
          {['upload', 'url'].map(m => (
            <button key={m} onClick={() => onChange({ ...block, source_type: m })}
              className="px-3 py-1.5 rounded text-xs transition border"
              style={{
                borderColor: block.source_type === m ? 'var(--t-accent)' : 'var(--t-border)',
                backgroundColor: block.source_type === m ? 'var(--t-accent-subtle)' : 'transparent',
                color: block.source_type === m ? 'var(--t-accent)' : 'var(--t-text-muted)'
              }}>
              {m === 'upload' ? '上傳影片' : '影片網址'}
            </button>
          ))}
        </div>
      </div>

      {block.source_type === 'upload' ? (
        <div>
          {block.src ? (
            <div className="relative group">
              <video src={proxiedVideoUrl(block.src)} controls className="w-full max-h-64 rounded-lg border" style={{ borderColor: 'var(--t-border)' }} />
              <button
                onClick={() => onChange({ ...block, src: '' })}
                className="absolute top-2 right-2 bg-red-600 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition"
                title="移除影片"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div
              onClick={() => !uploading && fileRef.current?.click()}
              className="border-2 border-dashed rounded-lg py-12 flex flex-col items-center justify-center cursor-pointer transition"
              style={{ borderColor: 'var(--t-border)' }}
            >
              <Upload size={24} className="mb-2" style={{ color: 'var(--t-text-dim)' }} />
              <p className="text-xs" style={{ color: 'var(--t-text-dim)' }}>
                {uploading ? '上傳中...' : '點擊上傳影片檔(最大 50MB)'}
              </p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--t-text-dim)' }}>
                支援 mp4、webm、mov;大檔請改用「影片網址」
              </p>
            </div>
          )}
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleUpload} />

          <div className="mt-2">
            <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>影片檔案路徑(或上傳)</label>
            <input
              value={block.src || ''}
              onChange={e => onChange({ ...block, src: e.target.value })}
              className="w-full border rounded px-3 py-1.5 text-xs focus:outline-none"
              style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
              placeholder="/uploads/training/..."
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>影片網址</label>
          <input
            value={block.src || ''}
            onChange={e => onChange({ ...block, src: e.target.value })}
            className="w-full border rounded px-3 py-1.5 text-xs focus:outline-none"
            style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
            placeholder="https://video-server.example.com/video.mp4"
          />
          {block.src && (
            <div className="mt-2 bg-black rounded-lg overflow-hidden">
              <video src={proxiedVideoUrl(block.src)} controls className="w-full max-h-64" />
            </div>
          )}
          <p className="text-[10px] mt-1" style={{ color: 'var(--t-text-dim)' }}>
            支援:foxlink-NAS 分享連結(自動透過 server 中繼)、外部 mp4 直連、YouTube/影音平台 embed
          </p>
        </div>
      )}
    </div>
  )
}
