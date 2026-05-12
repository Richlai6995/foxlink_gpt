import { useEffect, useState } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import api from '../lib/api'

/**
 * KbImage:從 KB 拉圖。
 *
 * Token 在 Authorization header,瀏覽器 <img src> 帶不了 → 用 axios fetch blob,
 * URL.createObjectURL 給 <img> 用。權限 / 保密 KB 規則由後端 GET /api/kb/images/:id 統一管。
 *
 * 用於兩處:
 *   - chat 訊息(MarkdownRenderer 攔 kb-img:// 替換成 <KbImage>)
 *   - KB 圖庫 tab
 */
interface Props {
  imageId: string
  alt?: string
  className?: string
  /** 點擊時放大;false 時純展示 */
  zoomable?: boolean
}

const blobCache = new Map<string, string>() // imageId → objectURL

export default function KbImage({ imageId, alt = '', className = '', zoomable = true }: Props) {
  const [url, setUrl] = useState<string | null>(blobCache.get(imageId) || null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!url)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    if (url) return
    let cancelled = false
    setLoading(true); setError(null)
    api.get(`/kb/images/${imageId}`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        const blobUrl = URL.createObjectURL(res.data)
        blobCache.set(imageId, blobUrl)
        setUrl(blobUrl)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.response?.status === 404 ? '圖片不存在或無權限' : (e.message || '載入失敗'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [imageId, url])

  if (error) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-rose-500 bg-rose-50 px-2 py-1 rounded ${className}`}>
        <ImageOff size={12} /> {error}
      </span>
    )
  }
  if (loading || !url) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-slate-400 ${className}`}>
        <Loader2 size={12} className="animate-spin" /> 載入圖片...
      </span>
    )
  }

  return (
    <>
      <img
        src={url}
        alt={alt}
        className={`max-w-full rounded-lg border border-slate-200 ${zoomable ? 'cursor-zoom-in hover:shadow-md transition' : ''} ${className}`}
        onClick={zoomable ? () => setZoom(true) : undefined}
        loading="lazy"
      />
      {zoom && (
        <div
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoom(false)}
        >
          <img src={url} alt={alt} className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </>
  )
}
