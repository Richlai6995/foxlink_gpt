import { useRef } from 'react'
import { Upload, Image, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { PptxSlideConfig, PptxSlideType, TemplateVariable } from '../../types'

interface Props {
  templateId?: string
  slideCount: number
  slideConfig: PptxSlideConfig[]
  loopVars: TemplateVariable[]
  onChange: (cfg: PptxSlideConfig[]) => void
}

const SLIDE_TYPE_COLORS: Record<PptxSlideType, string> = {
  cover: 'bg-blue-100 text-blue-700',
  content_single: 'bg-slate-100 text-slate-700',
  content_repeat: 'bg-green-100 text-green-700',
  back: 'bg-purple-100 text-purple-700',
  layout_template: 'bg-teal-100 text-teal-700',
  closing: 'bg-indigo-100 text-indigo-700',
}

export default function PptxSlideConfigurator({ templateId, slideCount, slideConfig, loopVars, onChange }: Props) {
  const { t } = useTranslation()
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({})

  const SLIDE_TYPE_LABELS: Record<PptxSlideType, string> = {
    cover: t('tpl.pptx.cover'),
    content_single: t('tpl.pptx.contentSingle'),
    content_repeat: t('tpl.pptx.contentRepeat'),
    back: t('tpl.pptx.back'),
    layout_template: t('tpl.pptx.layoutTemplate'),
    closing: t('tpl.pptx.closing'),
  }

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
      console.error(t('tpl.pptx.thumbnailFailed'), e)
    }
  }

  return (
    <div className="mb-4">
      <div className="text-xs font-medium text-slate-500 mb-2">{t('tpl.pptx.slideSettings')}</div>
      <div className="space-y-2">
        {Array.from({ length: slideCount }, (_, i) => {
          const cfg = getConfig(i)
          const thumb = cfg.thumbnail_url

          return (
            <div key={i} className="flex gap-3 items-start border rounded-lg p-3 bg-slate-50">
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
                <button
                  className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 rounded transition group"
                  title={templateId ? t('tpl.pptx.uploadThumbnail') : t('tpl.pptx.saveFirstHint')}
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

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-14 flex-shrink-0">Slide {i + 1}</span>
                  {(cfg.type === 'layout_template' || cfg.type === 'closing') ? (
                    <span className={`text-xs px-2 py-1 rounded font-medium ${SLIDE_TYPE_COLORS[cfg.type]}`}>
                      {SLIDE_TYPE_LABELS[cfg.type]}{cfg.layout ? ` (${cfg.layout})` : ''}
                    </span>
                  ) : (
                    <div className="relative">
                      <select
                        className={`text-xs pl-2 pr-6 py-1 rounded border border-transparent appearance-none cursor-pointer font-medium ${SLIDE_TYPE_COLORS[cfg.type] ?? 'bg-slate-100 text-slate-700'}`}
                        value={cfg.type}
                        onChange={e => {
                          const tp = e.target.value as PptxSlideType
                          const patch: Partial<PptxSlideConfig> = { type: tp }
                          if (tp !== 'content_repeat') patch.loop_var = undefined
                          updateConfig(i, patch)
                        }}
                      >
                        {(['cover', 'content_single', 'content_repeat', 'back'] as PptxSlideType[]).map(tp => (
                          <option key={tp} value={tp}>{SLIDE_TYPE_LABELS[tp]}</option>
                        ))}
                      </select>
                      <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-current opacity-60" />
                    </div>
                  )}
                </div>

                {cfg.type === 'content_repeat' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-14 flex-shrink-0">{t('tpl.pptx.loopVar')}</span>
                    {loopVars.length === 0 ? (
                      <span className="text-xs text-orange-500">{t('tpl.pptx.noLoopVarHint')}</span>
                    ) : (
                      <select
                        className="text-xs border rounded px-2 py-1"
                        value={cfg.loop_var || ''}
                        onChange={e => updateConfig(i, { loop_var: e.target.value || undefined })}
                      >
                        <option value="">{t('tpl.pptx.selectLoopVar')}</option>
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
        <p className="text-[11px] text-slate-400 mt-1">{t('tpl.pptx.thumbnailHintAfterCreate')}</p>
      )}
    </div>
  )
}
