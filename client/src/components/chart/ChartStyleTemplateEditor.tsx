/**
 * ChartStyleTemplateEditor — 建立 / 編輯 chart_style_templates 的 Modal
 *
 * 包 ChartStyleEditor + 名稱 / 描述 + 左側即時預覽(用 InlineChart 塞 demo 資料)
 */
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Save, RotateCcw } from 'lucide-react'
import api from '../../lib/api'
import ChartStyleEditor from './ChartStyleEditor'
import InlineChart from '../chat/InlineChart'
import type { ChartStyle, ChartStyleTemplate, InlineChartSpec } from '../../types'
import { HARDCODED_STYLE } from '../../lib/chartStyle'

const DEMO_SPEC: InlineChartSpec = {
  type: 'bar',
  title: '預覽圖表',
  x_field: 'site',
  y_fields: [{ field: 'output', name: '產量' }, { field: 'plan', name: '計劃' }],
  data: [
    { site: '龜山', output: 12500, plan: 10000 },
    { site: '林口', output: 9800, plan: 11000 },
    { site: '平鎮', output: 14200, plan: 13000 },
    { site: '昆山', output: 18600, plan: 17000 },
  ],
}

interface Props {
  template: ChartStyleTemplate | null   // null = 新增
  onClose: () => void
  onSaved: () => void
}

export default function ChartStyleTemplateEditor({ template, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState(template?.name || '')
  const [description, setDescription] = useState(template?.description || '')
  const [style, setStyle] = useState<ChartStyle>(() => {
    if (template?.style_json) {
      if (typeof template.style_json === 'object') return template.style_json as ChartStyle
      try { return JSON.parse(template.style_json as string) } catch { /* fall through */ }
    }
    return HARDCODED_STYLE
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 加 style 進 preview spec
  const previewSpec = useMemo<InlineChartSpec>(
    () => ({ ...DEMO_SPEC, style }),
    [style]
  )

  const handleSave = async () => {
    if (!name.trim()) {
      setErr(t('chart.style.nameRequired', '請輸入模板名稱'))
      return
    }
    setSaving(true)
    setErr(null)
    try {
      if (template) {
        await api.put(`/chart-style-templates/${template.id}`, {
          name: name.trim(),
          description: description || null,
          style_json: style,
        })
      } else {
        await api.post('/chart-style-templates', {
          name: name.trim(),
          description: description || null,
          style_json: style,
        })
      }
      onSaved()
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'unknown')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-[min(960px,95vw)] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {template
              ? t('chart.style.editTemplate', '編輯樣式模板')
              : t('chart.style.newTemplate', '新增樣式模板')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-12 gap-4">
          {/* Left: Preview + name/desc */}
          <div className="col-span-12 md:col-span-7 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                {t('chart.style.templateName', '模板名稱')} *
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('chart.style.namePlaceholder', '例:公司正式、活潑彩色')}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                {t('chart.style.templateDesc', '描述(選填)')}
              </label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('chart.style.descPlaceholder', '簡述這個模板的用途')}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">
                {t('chart.style.preview', '即時預覽')}
              </div>
              <div className="border border-slate-200 rounded">
                <InlineChart spec={previewSpec} enablePin={false} height={280} />
              </div>
            </div>
          </div>

          {/* Right: Style editor */}
          <div className="col-span-12 md:col-span-5">
            <div className="border border-slate-200 rounded p-3 bg-slate-50/50 max-h-[500px] overflow-y-auto">
              <ChartStyleEditor value={style} onChange={setStyle} compact />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
          {/* 左側:恢復內建預設(保險絲,避免改壞了回不去) */}
          <button
            onClick={() => {
              if (confirm(t('chart.style.confirmResetHardcoded', '確定把模板重設為系統內建預設樣式?此動作會覆蓋目前所有調整(儲存後才會真正生效)'))) {
                setStyle(HARDCODED_STYLE)
              }
            }}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded hover:bg-slate-50 text-slate-600 flex items-center gap-1.5"
            title={t('chart.style.resetHardcodedHint', '回到程式內建樣式(FOXLINK 初始值)')}
          >
            <RotateCcw size={12} />
            {t('chart.style.resetHardcoded', '恢復內建預設')}
          </button>

          {err && <span className="text-xs text-red-600">{err}</span>}

          <div className="flex-1" />

          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Save size={13} />
            {saving ? t('common.saving', '儲存中...') : t('common.save', '儲存')}
          </button>
        </div>
      </div>
    </div>
  )
}
