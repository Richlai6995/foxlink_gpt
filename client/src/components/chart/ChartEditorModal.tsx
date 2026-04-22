/**
 * ChartEditorModal — Phase 5b:從零設計圖表(BI 思維入口)
 *
 * 4-step wizard:
 *   1. 選 tool(目前只支援 ERP,MCP 留 Phase 5c)
 *   2. 填 tool 參數 → 點「執行取欄位」(POST /user-charts/preview)
 *   3. 設計圖表(type / x_field / y_fields)+ 即時 InlineChart 預覽
 *   4. 命名 + 標記哪些 params 可由分享者改 → 存(POST /user-charts)
 *
 * 路徑差異(對照原 chat → pin 路徑):
 *   - chat → pin:有資料才有圖,user 不用懂 chart spec
 *   - 本元件:先設計 → 跑資料,適合 user 知道想看什麼,要從 catalog 挑工具
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ArrowLeft, ArrowRight, Loader2, Plus, Trash2, BarChart3, LineChart, PieChart, AreaChart, Activity, Grid3x3, Hexagon } from 'lucide-react'
import api from '../../lib/api'
import InlineChart from '../chat/InlineChart'
import type { InlineChartSpec, InlineChartType, UserChartParam, UserChartParamType } from '../../types'

interface ErpTool {
  id: number
  code: string
  name: string
  description?: string
  params?: Array<{ name: string; type?: string; required?: boolean; default?: unknown; description?: string; enum?: string[] }>
}

interface Props {
  onClose: () => void
  /** 存好之後 callback 父層 reload */
  onSaved: () => void
}

type Step = 1 | 2 | 3 | 4

const TYPE_OPTIONS: Array<{ type: InlineChartType; label: string; Icon: React.ElementType }> = [
  { type: 'bar', label: '長條圖', Icon: BarChart3 },
  { type: 'line', label: '折線圖', Icon: LineChart },
  { type: 'area', label: '面積圖', Icon: AreaChart },
  { type: 'pie', label: '圓餅圖', Icon: PieChart },
  { type: 'scatter', label: '散點圖', Icon: Activity },
  { type: 'heatmap', label: '熱力圖', Icon: Grid3x3 },
  { type: 'radar', label: '雷達圖', Icon: Hexagon },
]

const PALETTE = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272']

/** ERP param.type → UserChartParamType(供 ChartParamForm 用) */
function mapErpParamType(t?: string): UserChartParamType {
  const tl = (t || '').toLowerCase()
  if (tl.includes('date') || tl.includes('time')) return 'date'
  if (tl.includes('number') || tl.includes('int') || tl.includes('decimal') || tl.includes('float')) return 'number'
  if (tl.includes('bool')) return 'boolean'
  return 'text'
}

export default function ChartEditorModal({ onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(1)

  // ── Step 1: tool 選擇 ──
  const [tools, setTools] = useState<ErpTool[]>([])
  const [loadingTools, setLoadingTools] = useState(true)
  const [selectedTool, setSelectedTool] = useState<ErpTool | null>(null)
  const [toolFilter, setToolFilter] = useState('')

  // ── Step 2: 參數 + preview ──
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({})
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [schemaHash, setSchemaHash] = useState<string | null>(null)

  // ── Step 3: chart 設計 ──
  const [chartType, setChartType] = useState<InlineChartType>('bar')
  const [xField, setXField] = useState<string>('')
  const [yFields, setYFields] = useState<Array<{ field: string; name: string; color: string }>>([])

  // ── Step 4: 命名 + share-able params ──
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  /** 哪些 param key 在分享時讓被分享者改(其他 baked-in 用 owner 設定的值) */
  const [shareableParams, setShareableParams] = useState<Set<string>>(new Set())
  const [saveBusy, setSaveBusy] = useState(false)

  useEffect(() => {
    api.get('/erp-tools/my/list')
      .then(r => setTools(r.data || []))
      .catch(e => console.error('[ChartEditor] load tools:', e))
      .finally(() => setLoadingTools(false))
  }, [])

  // 自動帶入 default values 當選了工具
  useEffect(() => {
    if (!selectedTool) return
    const init: Record<string, unknown> = {}
    for (const p of selectedTool.params || []) {
      if (p.default !== undefined) init[p.name] = p.default
    }
    setParamValues(init)
    setShareableParams(new Set((selectedTool.params || []).map(p => p.name))) // 預設全部可分享改
  }, [selectedTool])

  // 當 columns 出來時自動猜 x_field / y_fields:第一個 string-like 為 x,其餘 numeric 為 y
  useEffect(() => {
    if (columns.length === 0 || previewRows.length === 0) return
    if (xField && yFields.length > 0) return // 不覆蓋 user 已選的
    const sample = previewRows[0]
    const numerics: string[] = []
    let firstNonNumeric = ''
    for (const c of columns) {
      const v = sample[c]
      const isNum = typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)))
      if (isNum) numerics.push(c)
      else if (!firstNonNumeric) firstNonNumeric = c
    }
    if (!firstNonNumeric && columns.length > 0) firstNonNumeric = columns[0]
    if (!xField) setXField(firstNonNumeric)
    if (yFields.length === 0 && numerics.length > 0) {
      setYFields(numerics.slice(0, 1).map((f, i) => ({ field: f, name: f, color: PALETTE[i % PALETTE.length] })))
    }
  }, [columns, previewRows]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredTools = useMemo(() => {
    if (!toolFilter) return tools
    const q = toolFilter.toLowerCase()
    return tools.filter(tt => (tt.name || '').toLowerCase().includes(q) || (tt.code || '').toLowerCase().includes(q))
  }, [tools, toolFilter])

  const handlePreview = async () => {
    if (!selectedTool) return
    setPreviewBusy(true); setPreviewError(null)
    try {
      const r = await api.post('/user-charts/preview', {
        source_tool: `erp:${selectedTool.id}`,
        params: paramValues,
      })
      setPreviewRows(r.data.rows || [])
      setColumns(r.data.columns || [])
      setSchemaHash(r.data.schema_hash || null)
      if ((r.data.rows || []).length === 0) {
        setPreviewError(t('chart.editor.emptyResult', '工具回傳 0 筆資料,請檢查參數'))
      } else {
        setStep(3)
      }
    } catch (e: any) {
      setPreviewError(e?.response?.data?.error || e?.message || 'preview failed')
    } finally {
      setPreviewBusy(false)
    }
  }

  const previewSpec = useMemo<InlineChartSpec | null>(() => {
    if (!xField || yFields.length === 0 || previewRows.length === 0) return null
    return {
      type: chartType,
      title: title || selectedTool?.name || '預覽',
      x_field: xField,
      y_fields: yFields,
      data: previewRows,
    }
  }, [chartType, xField, yFields, previewRows, title, selectedTool])

  const handleSave = async () => {
    if (!previewSpec || !selectedTool) return
    if (!title.trim()) { alert(t('chart.editor.titleRequired', '請輸入標題')); return }
    setSaveBusy(true)
    try {
      // 把 ERP params 轉成 UserChartParam template;只 share 標記為可改的
      const sourceParams: UserChartParam[] = (selectedTool.params || []).map(p => ({
        key: p.name,
        label: p.description || p.name,
        type: mapErpParamType(p.type),
        default: shareableParams.has(p.name) ? undefined : (paramValues[p.name] as any),
        // 若 user-only(未勾分享改),強制存 owner 當下值當 default — 被分享者跑時無法改(UI 不顯示),
        // 此版本簡化:都顯示給被分享者,只是 default 帶有 owner 值
      }))

      // 把 chart_spec 的 data 拿掉(只存 design,不存資料)
      const specToSave: InlineChartSpec = { ...previewSpec, data: undefined }

      await api.post('/user-charts', {
        title: title.trim(),
        description: description.trim() || undefined,
        chart_spec: specToSave,
        source_type: 'erp',
        source_tool: `erp:${selectedTool.id}`,
        source_schema_hash: schemaHash,
        source_params: sourceParams,
      })
      onSaved()
    } catch (e: any) {
      alert(t('chart.editor.saveFailed', '儲存失敗:') + (e?.response?.data?.error || e?.message))
    } finally {
      setSaveBusy(false)
    }
  }

  const canNext: Record<Step, boolean> = {
    1: !!selectedTool,
    2: previewRows.length > 0,
    3: !!xField && yFields.length > 0,
    4: !!title.trim(),
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="font-semibold">{t('chart.editor.title', '新增圖表')}</h3>
            <div className="flex gap-1 mt-1.5 text-xs text-slate-400">
              {([1, 2, 3, 4] as Step[]).map(s => (
                <span key={s} className={`px-2 py-0.5 rounded ${step === s ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-400'}`}>
                  {s}. {['選工具', '填參數', '設計圖表', '命名儲存'][s - 1]}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ── Step 1 ── */}
          {step === 1 && (
            <div className="space-y-3">
              <input
                type="text"
                value={toolFilter}
                onChange={e => setToolFilter(e.target.value)}
                placeholder={t('chart.editor.filterTools', '搜尋工具(name / code)...')}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
              {loadingTools ? (
                <div className="text-center py-8 text-slate-400 text-sm">載入中...</div>
              ) : filteredTools.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  {tools.length === 0
                    ? '你目前沒有可用的 ERP 工具,請聯絡 admin 申請'
                    : '沒有符合的工具'}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                  {filteredTools.map(tt => (
                    <button
                      key={tt.id}
                      onClick={() => setSelectedTool(tt)}
                      className={`w-full text-left p-3 rounded border transition ${
                        selectedTool?.id === tt.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{tt.name}</span>
                        <span className="text-[10px] font-mono text-slate-400">{tt.code}</span>
                      </div>
                      {tt.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{tt.description}</div>}
                      {tt.params && tt.params.length > 0 && (
                        <div className="text-xs text-slate-400 mt-1">參數: {tt.params.map(p => p.name).join(', ')}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && selectedTool && (
            <div className="space-y-3">
              <div className="text-xs text-slate-500">
                工具: <span className="font-medium text-slate-700">{selectedTool.name}</span> ({selectedTool.code})
              </div>
              {(selectedTool.params || []).length === 0 ? (
                <div className="text-sm text-slate-500 p-3 bg-slate-50 rounded">此工具不需參數,直接執行取欄位。</div>
              ) : (
                <div className="space-y-2">
                  {(selectedTool.params || []).map(p => (
                    <div key={p.name} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-700">
                        {p.description || p.name}
                        {p.required && <span className="text-red-500 ml-1">*</span>}
                        <span className="text-slate-400 font-normal ml-1.5 font-mono">{p.name}: {p.type}</span>
                      </label>
                      {p.enum && p.enum.length > 0 ? (
                        <select
                          value={String(paramValues[p.name] ?? '')}
                          onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                          className="px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                        >
                          <option value="">--</option>
                          {p.enum.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input
                          type={mapErpParamType(p.type) === 'number' ? 'number' : mapErpParamType(p.type) === 'date' ? 'date' : 'text'}
                          value={String(paramValues[p.name] ?? '')}
                          onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                          className="px-2 py-1.5 border border-slate-300 rounded text-sm"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handlePreview}
                disabled={previewBusy}
                className="w-full px-4 py-2 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {previewBusy && <Loader2 size={14} className="animate-spin" />}
                {previewBusy ? '執行中...' : '執行取欄位 →'}
              </button>

              {previewError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                  ❌ {previewError}
                </div>
              )}

              {previewRows.length > 0 && (
                <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                  ✓ 取得 {previewRows.length} 筆資料,{columns.length} 個欄位:{columns.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* chart type */}
              <div>
                <label className="text-xs font-medium text-slate-700">圖表類型</label>
                <div className="grid grid-cols-7 gap-1.5 mt-1.5">
                  {TYPE_OPTIONS.map(({ type, label, Icon }) => (
                    <button
                      key={type}
                      onClick={() => setChartType(type)}
                      className={`flex flex-col items-center gap-1 p-2 rounded border transition ${
                        chartType === type ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                    >
                      <Icon size={16} />
                      <span className="text-[10px]">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* x_field */}
              <div>
                <label className="text-xs font-medium text-slate-700">X 軸欄位</label>
                <select
                  value={xField}
                  onChange={e => setXField(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
                >
                  <option value="">--</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* y_fields */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">Y 軸欄位 / 系列</label>
                  <button
                    onClick={() => setYFields(prev => [...prev, { field: columns[0] || '', name: '', color: PALETTE[prev.length % PALETTE.length] }])}
                    className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Plus size={11} /> 加一個系列
                  </button>
                </div>
                <div className="space-y-1.5 mt-1.5">
                  {yFields.map((yf, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <select
                        value={yf.field}
                        onChange={e => setYFields(prev => prev.map((y, j) => j === i ? { ...y, field: e.target.value } : y))}
                        className="flex-1 px-2 py-1 border border-slate-300 rounded text-xs bg-white"
                      >
                        {columns.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        type="text"
                        value={yf.name}
                        onChange={e => setYFields(prev => prev.map((y, j) => j === i ? { ...y, name: e.target.value } : y))}
                        placeholder="顯示名(可選)"
                        className="w-32 px-2 py-1 border border-slate-300 rounded text-xs"
                      />
                      <input
                        type="color"
                        value={yf.color}
                        onChange={e => setYFields(prev => prev.map((y, j) => j === i ? { ...y, color: e.target.value } : y))}
                        className="w-8 h-7 border border-slate-300 rounded cursor-pointer"
                      />
                      <button
                        onClick={() => setYFields(prev => prev.filter((_, j) => j !== i))}
                        className="p-1 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                {chartType === 'heatmap' && yFields.length < 2 && (
                  <p className="text-xs text-amber-600 mt-1">⚠ heatmap 需要 2 個 y_fields(第 1 個為縱軸 group、第 2 個為值)</p>
                )}
              </div>

              {/* preview */}
              {previewSpec && (
                <div>
                  <label className="text-xs font-medium text-slate-700">預覽</label>
                  <div className="mt-1.5">
                    <InlineChart spec={previewSpec} enablePin={false} height={280} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4 ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700">標題 *</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded text-sm"
                  placeholder={selectedTool?.name || ''}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">描述(選填)</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  className="w-full mt-1 px-2 py-1.5 border border-slate-300 rounded text-sm"
                  placeholder="例如:用途 / 何時 refresh / 注意事項"
                />
              </div>
              {selectedTool?.params && selectedTool.params.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-slate-700">分享時可由被分享者修改的參數</label>
                  <p className="text-[11px] text-slate-400 mb-1.5">勾選的會在被分享者跑圖時顯示為輸入欄;未勾的會用你現在填的值固定</p>
                  <div className="space-y-1">
                    {selectedTool.params.map(p => (
                      <label key={p.name} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={shareableParams.has(p.name)}
                          onChange={e => {
                            setShareableParams(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(p.name)
                              else next.delete(p.name)
                              return next
                            })
                          }}
                        />
                        <span className="font-mono text-slate-700">{p.name}</span>
                        <span className="text-slate-400">— {p.description || p.type || ''}</span>
                        {!shareableParams.has(p.name) && (
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1 rounded">固定: {String(paramValues[p.name] ?? '')}</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {previewSpec && (
                <div>
                  <label className="text-xs font-medium text-slate-700">最終預覽</label>
                  <InlineChart spec={{ ...previewSpec, title: title || previewSpec.title }} enablePin={false} height={240} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={() => step > 1 && setStep((step - 1) as Step)}
            disabled={step === 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ArrowLeft size={14} /> 上一步
          </button>
          <span className="text-xs text-slate-400">Step {step} / 4</span>
          {step < 4 ? (
            <button
              onClick={() => {
                // step 2 → 3 走 handlePreview;其他直接進
                if (step === 2 && previewRows.length === 0) { handlePreview(); return }
                setStep((step + 1) as Step)
              }}
              disabled={!canNext[step]}
              className="flex items-center gap-1 px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              下一步 <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saveBusy || !canNext[4]}
              className="flex items-center gap-1 px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              {saveBusy && <Loader2 size={12} className="animate-spin" />}
              {saveBusy ? '儲存中...' : '儲存到圖庫 ✓'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
