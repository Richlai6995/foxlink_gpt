/**
 * ChartStyleTemplatesTab — Phase 4c:圖庫頁的第 3 個 tab「樣式模板」
 *
 * - 列表:我的(可編 / 刪 / 設為預設)+ 系統(唯讀)
 * - 點「+ 新增」或「編輯」開 ChartStyleTemplateEditor modal
 * - 設為預設 = star icon,一人一筆 is_default=1(server 端 atomic 切換)
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Star, Trash2, Edit, Plus, Lock, Check } from 'lucide-react'
import { useChartStyleTemplates } from '../../hooks/useChartStyleTemplates'
import { useAuth } from '../../context/AuthContext'
import ChartStyleTemplateEditor from './ChartStyleTemplateEditor'
import type { ChartStyleTemplate, ChartStyle } from '../../types'
import { getPaletteColors } from '../../lib/chartStyle'
import { fmtDateTW } from '../../lib/fmtTW'

export default function ChartStyleTemplatesTab() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { mine, system, loading, refresh, setDefault, deleteTemplate } = useChartStyleTemplates()
  const [editing, setEditing] = useState<ChartStyleTemplate | null>(null)
  const [creating, setCreating] = useState(false)

  const parseStyle = (tmpl: ChartStyleTemplate): ChartStyle | null => {
    if (!tmpl.style_json) return null
    if (typeof tmpl.style_json === 'object') return tmpl.style_json as ChartStyle
    try { return JSON.parse(tmpl.style_json as string) as ChartStyle } catch { return null }
  }

  const handleDelete = async (tmpl: ChartStyleTemplate) => {
    if (!confirm(t('chart.library.templates.confirmDelete', '確定刪除模板「{{name}}」?', { name: tmpl.name }))) return
    await deleteTemplate(tmpl.id)
  }

  const handleSetDefault = async (tmpl: ChartStyleTemplate) => {
    // 若已是 default,再點一次就取消(設為 0 = 清除)
    const target = tmpl.is_default === 1 ? 0 : tmpl.id
    await setDefault(target)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          {t('chart.library.templates.desc', '命名的樣式模板。設為「預設」後,所有對話中自動產生的圖表會自動套用。')}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
        >
          <Plus size={14} /> {t('chart.library.templates.create', '新增模板')}
        </button>
      </div>

      {loading && mine.length === 0 && system.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">{t('common.loading', '載入中...')}</div>
      ) : (
        <>
          {/* 我的 */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              {t('chart.library.templates.mine', '我的模板')} ({mine.length})
            </div>
            {mine.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 rounded">
                {t('chart.library.templates.emptyMine', '尚未建立模板,可在 chat 對話圖表的「樣式設定」→「另存為模板」,或按上方「新增模板」。')}
              </div>
            ) : (
              <div className="space-y-2">
                {mine.map(tmpl => (
                  <TemplateCard
                    key={tmpl.id}
                    tmpl={tmpl}
                    owned
                    parseStyle={parseStyle}
                    onEdit={() => setEditing(tmpl)}
                    onDelete={() => handleDelete(tmpl)}
                    onSetDefault={() => handleSetDefault(tmpl)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 系統 — admin 可編輯內容(但不可刪、不可設為 user default) */}
          {system.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                {t('chart.library.templates.system', '系統預設')} ({system.length})
                {isAdmin && (
                  <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-normal">
                    {t('chart.library.templates.adminCanEdit', 'Admin 可編輯')}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {system.map(tmpl => (
                  <TemplateCard
                    key={tmpl.id}
                    tmpl={tmpl}
                    owned={false}
                    systemEditable={isAdmin}
                    parseStyle={parseStyle}
                    onEdit={isAdmin ? () => setEditing(tmpl) : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {(editing || creating) && (
        <ChartStyleTemplateEditor
          template={editing}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={async () => {
            setEditing(null); setCreating(false)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

function TemplateCard({
  tmpl, owned, systemEditable, parseStyle, onEdit, onDelete, onSetDefault,
}: {
  tmpl: ChartStyleTemplate
  owned: boolean
  /** admin 可編輯系統模板(但仍不可刪 / 不可設 user default) */
  systemEditable?: boolean
  parseStyle: (t: ChartStyleTemplate) => ChartStyle | null
  onEdit?: () => void
  onDelete?: () => void
  onSetDefault?: () => void
}) {
  const { t } = useTranslation()
  const style = parseStyle(tmpl)
  const colors = style ? getPaletteColors(style) : ['#5470c6']
  const isDefault = tmpl.is_default === 1
  const c = style?.common

  return (
    <div className={`border rounded-lg bg-white p-3 flex items-center gap-3 ${isDefault ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'}`}>
      {/* Palette preview */}
      <div className="flex gap-0.5 flex-shrink-0">
        {colors.slice(0, 5).map((col, i) => (
          <div key={i} className="w-3 h-8 rounded-sm" style={{ backgroundColor: col }} />
        ))}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm truncate">{tmpl.name}</h3>
          {isDefault && (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <Star size={10} fill="currentColor" /> {t('chart.library.templates.default', '預設')}
            </span>
          )}
          {!owned && (
            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <Lock size={10} /> {t('chart.library.templates.systemLabel', '系統')}
            </span>
          )}
        </div>
        {tmpl.description && <div className="text-xs text-slate-500 mt-0.5 truncate">{tmpl.description}</div>}
        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
          {c && (
            <>
              <span>{c.palette} · {c.legend_position || 'top'}</span>
              <span>{c.title_size}px / {c.axis_label_size}px</span>
              <span>{c.number_format}</span>
              <span>{c.background === 'dark' ? '🌙 深色' : '☀ 淺色'}</span>
            </>
          )}
          {tmpl.updated_at && <span>· {fmtDateTW(tmpl.updated_at)}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {owned && (
          <>
            <button
              onClick={onSetDefault}
              title={isDefault ? t('chart.library.templates.unsetDefault', '取消預設') : t('chart.library.templates.setDefault', '設為預設')}
              className={`p-1.5 rounded ${isDefault ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-400 hover:text-amber-500 hover:bg-slate-50'}`}
            >
              {isDefault ? <Check size={14} /> : <Star size={14} />}
            </button>
            <button onClick={onEdit} title={t('common.edit', '編輯')} className="p-1.5 text-slate-400 hover:text-blue-500 rounded">
              <Edit size={14} />
            </button>
            <button onClick={onDelete} title={t('common.delete', '刪除')} className="p-1.5 text-slate-400 hover:text-red-500 rounded">
              <Trash2 size={14} />
            </button>
          </>
        )}
        {/* 系統模板:僅 admin 可「編輯內容」;刪除與設預設皆不適用 */}
        {!owned && systemEditable && onEdit && (
          <button
            onClick={onEdit}
            title={t('chart.library.templates.adminEditSystem', '編輯系統模板(全站可見)')}
            className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
          >
            <Edit size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
