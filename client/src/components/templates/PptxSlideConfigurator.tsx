import { useRef } from 'react'
import { Upload, Image, ChevronDown } from 'lucide-react'
import api from '../../lib/api'
import { PptxSlideConfig, PptxSlideType, TemplateVariable } from '../../types'

interface Props {
  templateId?: string          // undefined = not saved yet (thumbnail upload disabled)
  slideCount: number
  slideConfig: PptxSlideConfig[]
  loopVars: TemplateVariable[] // variables with type === 'loop'
  onChange: (cfg: PptxSlideConfig[]) => void
}

const SLIDE_TYPE_LABELS: Record<PptxSlideType, string> = {
  cover: '封面',
  content_single: '內頁（單次）',
  content_repeat: '內頁（可重複）',
  back: '封底',
}

const SLIDE_TYPE_COLORS: Record<PptxSlideType, string> = {
  cover: 'bg-blue-100 text-blue-700',
  content_single: 'bg-slate-100 text-slate-700',
  content_repeat: 'bg-green-100 text-green-700',
  back: 'bg-purple-100 text-purple-700',
}

export default function PptxSlideConfigurator({ templateId, slideCount, slideConfig, loopVars, onChange }: Props) {
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({})

  const getConfig = (index: number): PptxSlideConfig =>
    slideConfig.find(c => c.index === index) ?? { index, type: 'content_single' }

  const updateConfig = (index: number, patch: Partial<PptxSlideConfig>) => {
    const existing = slideConfig.filter(c => c.index !== index)
    onChange([...existing, { ...getConfig(index), ...patch }].sort((a, b) => a.index - b.index))
  }

  const handleThumbnailUpload = async (index: number, file: File) => {
    if (!templateId) return
    const fd = new FormData()
    fd.append('thumbnail', file)
    try {
      const res = await api.post(`/doc-templates/${templateId}/slides/${index}/thumbnail`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      updateConfig(index, { thumbnail_url: res.data.thumbnail_url })
    } catch (e) {
      console.error('縮圖上傳失敗', e)
    }
  }

  return (
    <div className="mb-4">
      <div className="text-xs font-medium text-slate-500 mb-2">投影片設定</div>
      <div className="space-y-2">
        {Array.from({ length: slideCount }, (_, i) => {
          const cfg = getConfig(i)
          const thumb = cfg.thumbnail_url

          return (
            <div key={i} className="flex gap-3 items-start border rounded-lg p-3 bg-slate-50">
              {/* Thumbnail preview / upload */}
              <div className="flex-shrink-0 w-24 h-16 relative">
                {thumb ? (
                  <img
                    src={thumb}
                    alt={`Slide ${i + 1}`}
                    className="w-24 h-16 object-cover rounded border border-slate-200"
                  />
                ) : (
                  <div className="w-24 h-16 rounded border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center gap-1">
                    <Image size={14} className="text-slate-300" />
                    <span className="text-[10px] text-slate-400">Slide {i + 1}</span>
                  </div>
                )}
                {/* Upload overlay */}
                <button
                  className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 rounded transition group"
                  title={templateId ? '上傳縮圖' : '請先建立範本後再上傳縮圖'}
                  onClick={() => templateId && fileRefs.current[i]?.click()}
                >
                  <Upload size={14} className="text-white opacity-0 group-hover:opacity-100 transition" />
                </button>
                <input
                  ref={el => { fileRefs.current[i] = el }}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleThumbnailUpload(i, f)
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Config */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-14 flex-shrink-0">Slide {i + 1}</span>
                  {/* Type selector */}
                  <div className="relative">
                    <select
                      className={`text-xs pl-2 pr-6 py-1 rounded border border-transparent appearance-none cursor-pointer font-medium ${SLIDE_TYPE_COLORS[cfg.type]}`}
                      value={cfg.type}
                      onChange={e => {
                        const t = e.target.value as PptxSlideType
                        const patch: Partial<PptxSlideConfig> = { type: t }
                        if (t !== 'content_repeat') patch.loop_var = undefined
                        updateConfig(i, patch)
                      }}
                    >
                      {(Object.keys(SLIDE_TYPE_LABELS) as PptxSlideType[]).map(t => (
                        <option key={t} value={t}>{SLIDE_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-current opacity-60" />
                  </div>
                </div>

                {/* Loop var selector for content_repeat */}
                {cfg.type === 'content_repeat' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-14 flex-shrink-0">迴圈變數</span>
                    {loopVars.length === 0 ? (
                      <span className="text-xs text-orange-500">請先在變數清單中設定一個 loop 類型變數</span>
                    ) : (
                      <select
                        className="text-xs border rounded px-2 py-1"
                        value={cfg.loop_var || ''}
                        onChange={e => updateConfig(i, { loop_var: e.target.value || undefined })}
                      >
                        <option value="">— 選擇迴圈變數 —</option>
                        {loopVars.map(v => (
                          <option key={v.key} value={v.key}>{v.label || v.key}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {!templateId && (
        <p className="text-[11px] text-slate-400 mt-1">建立範本後，可點擊縮圖區塊上傳各投影片預覽圖。</p>
      )}
    </div>
  )
}
