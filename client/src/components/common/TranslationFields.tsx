import { useState } from 'react'
import { Languages, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../../lib/api'

export interface TranslationData {
  name_zh?: string | null
  name_en?: string | null
  name_vi?: string | null
  desc_zh?: string | null
  desc_en?: string | null
  desc_vi?: string | null
}

interface TranslationFieldsProps {
  /** Translation values */
  data: TranslationData
  onChange: (data: TranslationData) => void
  /** API endpoint for re-translate, e.g. /skills/123/translate  */
  translateUrl?: string
  /** Whether to show description translation rows */
  hasDescription?: boolean
  /** Whether translation is loading (right after save) */
  translating?: boolean
  className?: string
}

const LANGS = [
  { key: 'zh', label: '繁中', flag: '🇹🇼' },
  { key: 'en', label: 'EN', flag: '🇺🇸' },
  { key: 'vi', label: 'VI', flag: '🇻🇳' },
] as const

type LangKey = 'zh' | 'en' | 'vi'

export default function TranslationFields({
  data,
  onChange,
  translateUrl,
  hasDescription = true,
  translating = false,
  className = '',
}: TranslationFieldsProps) {
  const [open, setOpen] = useState(false)
  const [retranslating, setRetranslating] = useState(false)

  const handleRetranslate = async () => {
    if (!translateUrl) return
    setRetranslating(true)
    try {
      const res = await api.post(translateUrl)
      onChange({
        name_zh: res.data.name_zh ?? data.name_zh,
        name_en: res.data.name_en ?? data.name_en,
        name_vi: res.data.name_vi ?? data.name_vi,
        desc_zh: res.data.desc_zh ?? data.desc_zh,
        desc_en: res.data.desc_en ?? data.desc_en,
        desc_vi: res.data.desc_vi ?? data.desc_vi,
      })
    } catch (e: unknown) {
      alert('重新翻譯失敗')
    } finally {
      setRetranslating(false)
    }
  }

  const setName = (lang: LangKey, val: string) =>
    onChange({ ...data, [`name_${lang}`]: val || null })
  const setDesc = (lang: LangKey, val: string) =>
    onChange({ ...data, [`desc_${lang}`]: val || null })

  const hasAny = LANGS.some(
    (l) => data[`name_${l.key}` as keyof TranslationData] || data[`desc_${l.key}` as keyof TranslationData]
  )

  return (
    <div className={`border border-slate-200 rounded-xl overflow-hidden ${className}`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition text-left"
      >
        <div className="flex items-center gap-2">
          <Languages size={14} className="text-blue-500" />
          <span className="text-xs font-medium text-slate-600">多語言版本</span>
          {translating && (
            <span className="text-[10px] text-blue-500 animate-pulse ml-1">翻譯中...</span>
          )}
          {!translating && hasAny && (
            <span className="text-[10px] text-green-600 ml-1">✓ 已翻譯</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {translateUrl && open && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleRetranslate() }}
              disabled={retranslating}
              className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-40"
            >
              <RotateCcw size={10} className={retranslating ? 'animate-spin' : ''} />
              重新翻譯
            </button>
          )}
          {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="p-4 space-y-3 bg-white">
          {/* Name translations */}
          <div>
            <p className="text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wide">名稱</p>
            <div className="space-y-1.5">
              {LANGS.map(({ key, label, flag }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-12 flex-shrink-0 flex items-center gap-1">
                    <span>{flag}</span> {label}
                  </span>
                  <input
                    type="text"
                    value={data[`name_${key}` as keyof TranslationData] as string || ''}
                    onChange={(e) => setName(key as LangKey, e.target.value)}
                    placeholder={translating ? '翻譯中...' : `${label} 名稱`}
                    disabled={translating}
                    className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Description translations */}
          {hasDescription && (
            <div>
              <p className="text-[10px] font-medium text-slate-500 mb-2 uppercase tracking-wide">說明</p>
              <div className="space-y-1.5">
                {LANGS.map(({ key, label, flag }) => (
                  <div key={key} className="flex items-start gap-2">
                    <span className="text-xs text-slate-400 w-12 flex-shrink-0 flex items-center gap-1 mt-1.5">
                      <span>{flag}</span> {label}
                    </span>
                    <textarea
                      rows={2}
                      value={data[`desc_${key}` as keyof TranslationData] as string || ''}
                      onChange={(e) => setDesc(key as LangKey, e.target.value)}
                      placeholder={translating ? '翻譯中...' : `${label} 說明`}
                      disabled={translating}
                      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
