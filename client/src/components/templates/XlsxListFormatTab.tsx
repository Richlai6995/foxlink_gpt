import { useTranslation } from 'react-i18next'
import { XlsxListSettings } from '../../types'
import ColorPicker from './ColorPicker'

interface Props {
  settings: XlsxListSettings
  onChange: (s: XlsxListSettings) => void
  readonly?: boolean
}

export default function XlsxListFormatTab({ settings, onChange, readonly }: Props) {
  const { t } = useTranslation()
  const set = (patch: Partial<XlsxListSettings>) => onChange({ ...settings, ...patch })

  const PRESET_SCHEMES = [
    { label: t('tpl.xlsx.noColor'), odd: '', even: '' },
    { label: t('tpl.xlsx.blueWhite'), odd: '#FFFFFF', even: '#EEF2FF' },
    { label: t('tpl.xlsx.grayWhite'), odd: '#FFFFFF', even: '#F8FAFC' },
    { label: t('tpl.xlsx.blueDeep'), odd: '#DBEAFE', even: '#EFF6FF' },
    { label: t('tpl.xlsx.greenWhite'), odd: '#FFFFFF', even: '#F0FDF4' },
  ]

  return (
    <div className="space-y-6 max-w-xl">
      {/* Header row */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">{t('tpl.xlsx.headerRowNum')}</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1} max={100}
            disabled={readonly}
            className="w-20 border rounded px-2 py-1.5 text-sm disabled:opacity-50"
            placeholder={t('tpl.xlsx.autoDetect')}
            value={settings.headerRowNum ?? ''}
            onChange={e => set({ headerRowNum: e.target.value ? parseInt(e.target.value) : undefined })}
          />
          <span className="text-xs text-slate-400">{t('tpl.xlsx.autoDetectHint')}</span>
        </div>
      </div>

      {/* Alternating row colors */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-2">{t('tpl.xlsx.altRowColors')}</label>

        <div className="flex flex-wrap gap-2 mb-4">
          {PRESET_SCHEMES.map(p => (
            <button
              key={p.label}
              disabled={readonly}
              onClick={() => set({ oddRowColor: p.odd || undefined, evenRowColor: p.even || undefined })}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 border rounded hover:border-blue-400 disabled:opacity-50"
            >
              {p.odd || p.even ? (
                <span className="flex">
                  <span className="inline-block w-4 h-4 rounded-sm border border-slate-200" style={{ background: p.odd || '#fff' }} />
                  <span className="inline-block w-4 h-4 rounded-sm border border-slate-200 -ml-1" style={{ background: p.even || '#fff' }} />
                </span>
              ) : (
                <span className="inline-block w-8 h-4 rounded-sm border border-dashed border-slate-300" />
              )}
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">{t('tpl.xlsx.oddRow')}</label>
            <div className="flex items-center gap-2">
              <ColorPicker
                disabled={readonly}
                value={settings.oddRowColor ?? '#FFFFFF'}
                onChange={hex => set({ oddRowColor: hex === '#FFFFFF' ? undefined : hex })}
              />
              {settings.oddRowColor && (
                <button disabled={readonly} onClick={() => set({ oddRowColor: undefined })}
                  className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                >{t('tpl.xlsx.clear')}</button>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1">{t('tpl.xlsx.evenRow')}</label>
            <div className="flex items-center gap-2">
              <ColorPicker
                disabled={readonly}
                value={settings.evenRowColor ?? '#FFFFFF'}
                onChange={hex => set({ evenRowColor: hex === '#FFFFFF' ? undefined : hex })}
              />
              {settings.evenRowColor && (
                <button disabled={readonly} onClick={() => set({ evenRowColor: undefined })}
                  className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                >{t('tpl.xlsx.clear')}</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Preview */}
      {(settings.oddRowColor || settings.evenRowColor) && (
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-2">{t('tpl.xlsx.preview')}</label>
          <div className="border rounded overflow-hidden text-xs">
            <div className="bg-slate-100 px-3 py-1.5 font-medium text-slate-600 border-b">
              {t('tpl.xlsx.headerRowPreview')}
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                className="px-3 py-1.5 border-b last:border-0 text-slate-600"
                style={{ background: i % 2 === 1 ? (settings.oddRowColor || 'transparent') : (settings.evenRowColor || 'transparent') }}
              >
                {t('tpl.xlsx.dataRow', { n: i })}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {t('tpl.xlsx.colorHint')}
          </p>
        </div>
      )}
    </div>
  )
}
