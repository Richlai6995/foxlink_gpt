/**
 * ErpToolChartTab — Phase 5c:ERP 手動呼叫 Modal 內的「圖表」tab
 *
 * 目的:procedure 執行後直接從結果設計圖表 + 存進圖庫(tool-bound)。
 * 不經 LLM,不走 chat 釘選流程,是建 user_charts 的第三條路徑。
 *
 * 詳見 docs/chat-inline-chart-plan.md §5c
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, Download, AlertTriangle, BarChart3, LineChart, PieChart, AreaChart, Check } from 'lucide-react'
import api from '../../lib/api'
import InlineChart from './InlineChart'
import type { InlineChartSpec, InlineChartType, UserChartParam, UserChartParamType } from '../../types'
import type { ErpTool, ErpParam } from '../admin/ErpToolsPanel'

interface Props {
  tool: ErpTool
  inputs: Record<string, unknown>
  result: any
}

// ─────────────────────────────────────────────────────────────────────────────
// 從 ERP procedure 執行結果推斷可畫圖的 rows + columns。
//   優先順序:
//     1. result.params.*.rows(ref cursor OUT 參數,最結構化)
//     2. result.function_return 的 markdown table
//   都無 → null
// ─────────────────────────────────────────────────────────────────────────────
function inferChartableRows(result: any): { rows: Record<string, unknown>[]; columns: string[] } | null {
  if (!result) return null

  // 1. params.*.rows(OUT ref cursor)
  if (result.params && typeof result.params === 'object') {
    for (const v of Object.values(result.params) as any[]) {
      if (v && Array.isArray(v.rows) && v.rows.length > 0) {
        return { rows: v.rows, columns: Object.keys(v.rows[0]) }
      }
    }
  }

  // 2. function_return 若是 markdown table,parse 之
  const text = String(result.function_return ?? '').trim()
  if (!text) return null
  return parseMarkdownTable(text)
}

function parseMarkdownTable(text: string): { rows: Record<string, unknown>[]; columns: string[] } | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 3) return null // header + separator + ≥1 row

  const headerIdx = lines.findIndex(l => l.startsWith('|') && l.endsWith('|'))
  if (headerIdx < 0 || headerIdx + 2 > lines.length) return null

  const cells = (l: string) => l.slice(1, -1).split('|').map(s => s.trim())
  const headers = cells(lines[headerIdx])
  const sepLine = lines[headerIdx + 1]
  if (!/^\|[\s:|-]+\|$/.test(sepLine)) return null

  const rows: Record<string, unknown>[] = []
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const l = lines[i]
    if (!l.startsWith('|') || !l.endsWith('|')) continue
    const vs = cells(l)
    if (vs.length !== headers.length) continue
    const row: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      const raw = vs[idx]
      // 嘗試 coerce 千分位 / 數字:1,234 → 1234
      const cleaned = raw.replace(/,/g, '')
      const n = Number(cleaned)
      row[h] = cleaned !== '' && Number.isFinite(n) ? n : raw
    })
    rows.push(row)
  }
  return rows.length > 0 ? { rows, columns: headers } : null
}

// ─────────────────────────────────────────────────────────────────────────────
// 從 ERP tool.params 的 IN 參數 + 當前 inputs 組成 UserChartParam template
// ─────────────────────────────────────────────────────────────────────────────
function inferParamType(p: ErpParam): UserChartParamType {
  if (p.lov_config?.type) return 'select'
  const dt = String(p.data_type || '').toUpperCase()
  if (dt === 'NUMBER') return 'number'
  if (/DATE|TIMESTAMP/.test(dt)) return 'date'
  return 'text'
}

function buildSourceParams(tool: ErpTool, currentInputs: Record<string, unknown>): UserChartParam[] {
  return tool.params
    .filter(p => p.in_out !== 'OUT' && p.visible !== false)
    .map(p => {
      const type = inferParamType(p)
      const opts = p.lov_config?.type === 'static' && Array.isArray(p.lov_config.items)
        ? p.lov_config.items.map((it: any) => ({ value: String(it.value), label: it.label || String(it.value) }))
        : undefined
      const raw = currentInputs[p.name] ?? p.default_value
      const defVal = raw === undefined || raw === null || raw === ''
        ? undefined
        : (type === 'number' ? Number(raw) : type === 'boolean' ? Boolean(raw) : String(raw))
      return {
        key: p.name,
        label: p.display_name || p.name,
        type,
        options: opts,
        default: defVal as any,
        required: !!p.required,
      }
    })
}

async function computeSchemaHashClient(rows: Record<string, unknown>[]): Promise<string | null> {
  if (!rows || rows.length === 0) return null
  const keys = Object.keys(rows[0]).sort().join('|')
  // Web Crypto API sha256
  const data = new TextEncoder().encode(keys)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return hex.slice(0, 16)
}

// ─────────────────────────────────────────────────────────────────────────────
// 主元件
// ─────────────────────────────────────────────────────────────────────────────
const CHART_TYPES: { value: InlineChartType; Icon: React.ElementType; label: string }[] = [
  { value: 'bar', Icon: BarChart3, label: '長條圖' },
  { value: 'line', Icon: LineChart, label: '折線圖' },
  { value: 'area', Icon: AreaChart, label: '面積圖' },
  { value: 'pie', Icon: PieChart, label: '圓餅圖' },
]

export default function ErpToolChartTab({ tool, inputs, result }: Props) {
  const { t } = useTranslation()
  const extracted = useMemo(() => inferChartableRows(result), [result])

  const [chartType, setChartType] = useState<InlineChartType>('bar')
  const [xField, setXField] = useState<string>('')
  const [yFields, setYFields] = useState<string[]>([])
  const [title, setTitle] = useState<string>(tool.name)
  const [saving, setSaving] = useState(false)
  const [savedChartId, setSavedChartId] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 初始化欄位選擇(從 rows[0] 推斷)
  useEffect(() => {
    if (!extracted || extracted.columns.length === 0) return
    const cols = extracted.columns
    if (!xField) {
      // 優先選文字型欄位當 X
      const firstText = cols.find(c => typeof extracted.rows[0][c] !== 'number')
      setXField(firstText || cols[0])
    }
    if (yFields.length === 0) {
      // 找數值型欄位
      const numericCols = cols.filter(c => {
        const v = extracted.rows[0][c]
        return typeof v === 'number' && !isNaN(v)
      })
      setYFields(numericCols.length > 0 ? [numericCols[0]] : cols.slice(-1))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extracted])

  const previewSpec: InlineChartSpec | null = useMemo(() => {
    if (!extracted || !xField || yFields.length === 0) return null
    return {
      version: 1,
      type: chartType,
      title: title.trim() || undefined,
      x_field: xField,
      y_fields: yFields.map(f => ({ field: f })),
      data: extracted.rows,
    }
  }, [extracted, chartType, xField, yFields, title])

  const toggleYField = (f: string) => {
    setYFields(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  const handleSave = async () => {
    if (!previewSpec || !extracted) {
      setSaveError(t('chart.erpTab.needFields', '請先選擇 X 與 Y 欄位'))
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      // Template Share:chart_spec 只存設計,不存 data(重跑時由 chartExecutor 填)
      const specTemplate = {
        version: previewSpec.version,
        type: previewSpec.type,
        title: previewSpec.title,
        x_field: previewSpec.x_field,
        y_fields: previewSpec.y_fields,
      }
      const sourceParams = buildSourceParams(tool, inputs)
      const schemaHash = await computeSchemaHashClient(extracted.rows)

      const res = await api.post('/user-charts', {
        title: title.trim() || tool.name,
        chart_spec: specTemplate,
        source_type: 'erp',
        source_tool: `erp:${tool.id}`,
        source_tool_version: tool.metadata_hash || null,
        source_schema_hash: schemaHash,
        source_params: sourceParams,
      })
      setSavedChartId(res.data?.id ?? -1)
    } catch (e: any) {
      setSaveError(e?.response?.data?.error || e?.message || 'unknown')
    } finally {
      setSaving(false)
    }
  }

  if (!extracted) {
    return (
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
        <AlertTriangle size={14} className="mt-0.5" />
        <div>
          <div className="font-medium">{t('chart.erpTab.noData', '無結構化資料可繪圖')}</div>
          <div className="mt-1 text-amber-700">
            {t('chart.erpTab.noDataHint', '此 procedure 的回傳無 OUT ref cursor,也不是 markdown table 格式。請在工具管理設定 Answer Output Format,或改用有 OUT cursor 的 procedure。')}
          </div>
        </div>
      </div>
    )
  }

  const { columns } = extracted

  return (
    <div className="space-y-3">
      {/* 控制列 */}
      <div className="grid grid-cols-12 gap-2 items-start">
        {/* 圖型 */}
        <div className="col-span-12 md:col-span-6">
          <label className="text-[10px] font-medium text-slate-500 mb-1 block">
            {t('chart.erpTab.chartType', '圖型')}
          </label>
          <div className="flex gap-1">
            {CHART_TYPES.map(({ value, Icon, label }) => (
              <button
                key={value}
                onClick={() => setChartType(value)}
                title={label}
                className={`flex-1 px-2 py-1.5 text-xs rounded border flex items-center justify-center gap-1 transition ${
                  chartType === value
                    ? 'bg-sky-50 border-sky-300 text-sky-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div className="col-span-12 md:col-span-6">
          <label className="text-[10px] font-medium text-slate-500 mb-1 block">
            {t('chart.erpTab.title', '標題')}
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
            placeholder={tool.name}
          />
        </div>

        {/* X 軸 */}
        <div className="col-span-12 md:col-span-6">
          <label className="text-[10px] font-medium text-slate-500 mb-1 block">
            {t('chart.erpTab.xField', 'X 軸欄位')}
          </label>
          <select
            value={xField}
            onChange={e => setXField(e.target.value)}
            className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white"
          >
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Y 軸 */}
        <div className="col-span-12 md:col-span-6">
          <label className="text-[10px] font-medium text-slate-500 mb-1 block">
            {t('chart.erpTab.yFields', 'Y 軸欄位')} ({yFields.length})
          </label>
          <div className="flex flex-wrap gap-1 border border-slate-200 rounded px-2 py-1 bg-white max-h-24 overflow-y-auto">
            {columns.map(c => (
              <label
                key={c}
                className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded cursor-pointer transition ${
                  yFields.includes(c)
                    ? 'bg-sky-100 text-sky-700'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={yFields.includes(c)}
                  onChange={() => toggleYField(c)}
                  className="hidden"
                />
                {c}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Live Preview */}
      {previewSpec && (
        <div>
          <div className="text-[10px] font-medium text-slate-500 mb-1">
            {t('chart.erpTab.preview', '預覽')} · {extracted.rows.length} {t('erpInvoke.rows', '列')}
          </div>
          <InlineChart spec={previewSpec} enablePin={false} height={280} />
        </div>
      )}

      {/* 儲存按鈕區 */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
        {savedChartId ? (
          <div className="flex-1 flex items-center gap-2 text-sm text-green-700">
            <Check size={14} />
            {t('chart.erpTab.saved', '已儲存到圖庫')}
            <a
              href="/my-charts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-600 hover:underline text-xs"
            >
              {t('chart.erpTab.goLibrary', '前往圖庫 →')}
            </a>
          </div>
        ) : (
          <>
            <button
              onClick={handleSave}
              disabled={saving || !previewSpec}
              className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Save size={12} />
              {saving ? t('common.saving', '儲存中...') : t('chart.erpTab.save', '儲存到圖庫')}
            </button>
            {saveError && (
              <span className="text-xs text-red-600 flex items-center gap-1">
                <AlertTriangle size={11} /> {saveError}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
