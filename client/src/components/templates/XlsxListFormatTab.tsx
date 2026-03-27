import { XlsxListSettings } from '../../types'
import ColorPicker from './ColorPicker'

interface Props {
  settings: XlsxListSettings
  onChange: (s: XlsxListSettings) => void
  readonly?: boolean
}

const PRESET_SCHEMES = [
  { label: '無配色', odd: '', even: '' },
  { label: '藍白', odd: '#FFFFFF', even: '#EEF2FF' },
  { label: '灰白', odd: '#FFFFFF', even: '#F8FAFC' },
  { label: '藍深', odd: '#DBEAFE', even: '#EFF6FF' },
  { label: '綠白', odd: '#FFFFFF', even: '#F0FDF4' },
]

export default function XlsxListFormatTab({ settings, onChange, readonly }: Props) {
  const set = (patch: Partial<XlsxListSettings>) => onChange({ ...settings, ...patch })

  return (
    <div className="space-y-6 max-w-xl">
      {/* Header row */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">標題列列號</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1} max={100}
            disabled={readonly}
            className="w-20 border rounded px-2 py-1.5 text-sm disabled:opacity-50"
            placeholder="自動偵測"
            value={settings.headerRowNum ?? ''}
            onChange={e => set({ headerRowNum: e.target.value ? parseInt(e.target.value) : undefined })}
          />
          <span className="text-xs text-slate-400">空白 = 自動偵測（依欄位名稱配對）</span>
        </div>
      </div>

      {/* Alternating row colors */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-2">交替列背景色</label>

        {/* Preset */}
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

        {/* Custom pickers */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">奇數列（第 1、3、5… 筆）</label>
            <div className="flex items-center gap-2">
              <ColorPicker
                disabled={readonly}
                value={settings.oddRowColor ?? '#FFFFFF'}
                onChange={hex => set({ oddRowColor: hex === '#FFFFFF' ? undefined : hex })}
              />
              {settings.oddRowColor && (
                <button
                  disabled={readonly}
                  onClick={() => set({ oddRowColor: undefined })}
                  className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                >
                  清除
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1">偶數列（第 2、4、6… 筆）</label>
            <div className="flex items-center gap-2">
              <ColorPicker
                disabled={readonly}
                value={settings.evenRowColor ?? '#FFFFFF'}
                onChange={hex => set({ evenRowColor: hex === '#FFFFFF' ? undefined : hex })}
              />
              {settings.evenRowColor && (
                <button
                  disabled={readonly}
                  onClick={() => set({ evenRowColor: undefined })}
                  className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                >
                  清除
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Preview */}
      {(settings.oddRowColor || settings.evenRowColor) && (
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-2">預覽</label>
          <div className="border rounded overflow-hidden text-xs">
            <div className="bg-slate-100 px-3 py-1.5 font-medium text-slate-600 border-b">
              標題列（不受配色影響）
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                className="px-3 py-1.5 border-b last:border-0 text-slate-600"
                style={{ background: i % 2 === 1 ? (settings.oddRowColor || 'transparent') : (settings.evenRowColor || 'transparent') }}
              >
                第 {i} 筆資料列
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            配色套用於迴圈（loop）型變數的資料列，標題列保持原始範本樣式。
          </p>
        </div>
      )}
    </div>
  )
}
