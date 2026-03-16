/**
 * DashboardBoardPage — 儀表板頁面 /dashboard/boards
 * 使用 react-grid-layout 拖拉排版，每個 tile 是一個 saved query 的指定圖表
 * 各 tile 的查詢參數各自獨立
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
// react-grid-layout v2 legacy API — 相容 v1 props (isDraggable, draggableHandle 等)
import { ResponsiveReactGridLayout, WidthProvider } from 'react-grid-layout/legacy'
const ResponsiveGridLayout = WidthProvider(ResponsiveReactGridLayout)
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Plus, ArrowLeft, Share2, RefreshCw,
  Save, X, Pencil, Download, SlidersHorizontal, Bug, Clock,
  Settings2, Trash2,
} from 'lucide-react'
import { resolveDynamicDate, tokenDisplayLabel, isDynamicToken } from '../lib/dynamicDate'
import api from '../lib/api'
import AiChart from '../components/dashboard/AiChart'
import QueryParamsModal from '../components/dashboard/QueryParamsModal'
import ShareModal from '../components/dashboard/ShareModal'
import TranslationFields from '../components/common/TranslationFields'
import type { TranslationData } from '../components/common/TranslationFields'
import type {
  AiReportDashboard, AiDashboardItem, AiSavedQuery,
  AiQueryResult, AiChartConfig, AiQueryParameter
} from '../types'


interface TileState {
  item: AiDashboardItem
  result: AiQueryResult | null
  loading: boolean
  error: string | null
  pendingParams: boolean
  paramValues: Record<string, string | string[]>
  debugQuestion?: string
  debugSql?: string
  showDebug?: boolean
}

// 執行 saved query（pinned_sql → POST /dashboard/query）
function buildParamPrefix(params: AiQueryParameter[], values: Record<string, string | string[]>): string {
  const parts = params.map(p => {
    let val = values[p.id]
    const label = p.label_zh || p.id
    if (!val || (Array.isArray(val) && val.length === 0) || val === '') return null
    if (Array.isArray(val)) return `${label} ${val.join('、')}`
    // dynamic_date token → resolve to actual date string
    if (p.input_type === 'dynamic_date' || isDynamicToken(val as string)) {
      const resolved = resolveDynamicDate(val as string)
      val = resolved
    }
    if (typeof val === 'string' && val.includes('|')) {
      const [s, e] = val.split('|')
      return `${label} ${s} 到 ${e}`
    }
    return `${label} ${val}`
  }).filter(Boolean)
  return parts.length ? parts.join('，') + '，' : ''
}

async function execSavedQuery(sq: AiSavedQuery, paramValues: Record<string, string | string[]> = {}): Promise<AiQueryResult & { _question: string; _sql?: string }> {
  let params: AiQueryParameter[] = []
  try { params = JSON.parse(sq.parameters_schema as any || '[]') || [] } catch {}

  // 建立參數前綴注入到問句
  const prefix = buildParamPrefix(params, paramValues)
  const question = prefix ? prefix + (sq.question || '') : (sq.question || '')

  const resp = await fetch('/api/dashboard/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify({
      design_id: sq.design_id,
      question,
      override_sql: sq.pinned_sql || undefined,
    }),
  })
  if (!resp.ok || !resp.body) throw new Error('查詢失敗')

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let result: AiQueryResult | null = null
  let previewSql: string | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const blocks = buf.split('\n\n')
    buf = blocks.pop() || ''
    for (const block of blocks) {
      const lines = block.split('\n')
      let event = '', dataStr = ''
      for (const l of lines) {
        if (l.startsWith('event:')) event = l.slice(6).trim()
        else if (l.startsWith('data:')) dataStr = l.slice(5).trim()
      }
      if (event === 'result' && dataStr) {
        try {
          const data = JSON.parse(dataStr)
          const cfg = data.chart_config
            ? (typeof data.chart_config === 'string' ? JSON.parse(data.chart_config) : data.chart_config)
            : null
          // saved query 使用者設定的 chart_config 優先；
          // SSE result 的 design chart_config 僅在 saved query 無設定時作為 fallback
          const sqCfg = sq.chart_config
            ? (typeof sq.chart_config === 'string' ? JSON.parse(sq.chart_config as any) : sq.chart_config)
            : null
          const effectiveCfg = sqCfg || (cfg?.charts?.length ? cfg : null) || cfg
          result = {
            rows: data.rows,
            columns: data.columns || (data.rows.length > 0 ? Object.keys(data.rows[0]) : []),
            column_labels: data.column_labels || {},
            row_count: data.row_count,
            chart_config: effectiveCfg,
          }
        } catch {}
      }
      if (event === 'sql_preview' && dataStr) {
        try { previewSql = JSON.parse(dataStr).sql } catch {}
      }
      if (event === 'error' && dataStr) {
        try { const d = JSON.parse(dataStr); throw new Error(d.message || d.error || '查詢失敗') } catch (e: any) { throw e }
      }
    }
  }
  if (!result) throw new Error('無法取得查詢結果（請確認 SQL 和資料庫連線）')
  return { ...result, _question: question, _sql: previewSql || sq.pinned_sql || undefined }
}

function exportCsv(rows: Record<string, unknown>[], columns: string[], labels: Record<string, string>, filename: string) {
  const headers = columns.map(c => labels[c] || c)
  const csvRows = [
    headers.join(','),
    ...rows.map(r => columns.map(c => {
      const v = String(r[c] ?? '')
      return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
    }).join(',')),
  ]
  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${filename}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export default function DashboardBoardPage() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()

  const boardName = (b: AiReportDashboard) => {
    if (i18n.language === 'en' && b.name_en) return b.name_en
    if (i18n.language === 'vi' && b.name_vi) return b.name_vi
    return b.name
  }

  const boardDesc = (b: AiReportDashboard) => {
    if (i18n.language === 'en' && b.description_en) return b.description_en
    if (i18n.language === 'vi' && b.description_vi) return b.description_vi
    return b.description
  }

  const boardCategory = (b: AiReportDashboard) => {
    if (i18n.language === 'en' && b.category_en) return b.category_en
    if (i18n.language === 'vi' && b.category_vi) return b.category_vi
    return b.category
  }

  const sqName = (q: AiSavedQuery) => {
    if (i18n.language === 'en' && q.name_en) return q.name_en
    if (i18n.language === 'vi' && q.name_vi) return q.name_vi
    return q.name
  }

  const [dashboards, setDashboards] = useState<AiReportDashboard[]>([])
  const [activeDashboard, setActiveDashboard] = useState<AiReportDashboard | null>(null)
  const [tiles, setTiles] = useState<TileState[]>([])
  const [savedQueries, setSavedQueries] = useState<AiSavedQuery[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [showNewDashboard, setShowNewDashboard] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [shareTarget, setShareTarget] = useState<{ id: number; name: string } | null>(null)
  // Edit dashboard settings modal
  const [editTarget, setEditTarget] = useState<AiReportDashboard | null>(null)
  const [editName, setEditName] = useState('')
  const [editTranslation, setEditTranslation] = useState<TranslationData>({})
  const [editDesc, setEditDesc] = useState('')
  const [editDescEn, setEditDescEn] = useState('')
  const [editDescVi, setEditDescVi] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editCategoryEn, setEditCategoryEn] = useState('')
  const [editCategoryVi, setEditCategoryVi] = useState('')
  const [translatingBoard, setTranslatingBoard] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [customRefreshInput, setCustomRefreshInput] = useState('')
  const [showCustomRefresh, setShowCustomRefresh] = useState(false)
  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<AiReportDashboard | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingParamTile, setPendingParamTile] = useState<{ tileIdx: number; sq: AiSavedQuery; params: AiQueryParameter[]; isEdit?: boolean } | null>(null)
  const [pendingAddQuery, setPendingAddQuery] = useState<{ sq: AiSavedQuery; charts: { idx: number; title: string }[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadDashboard = useCallback((board: AiReportDashboard) => {
    setActiveDashboard(board)
    const layout: AiDashboardItem[] = (() => {
      try { return (typeof board.layout_config === 'string' ? JSON.parse(board.layout_config) : board.layout_config) || [] }
      catch { return [] }
    })()
    // 從 item.param_values 載入持久化的參數值
    setTiles(layout.map(item => ({
      item,
      result: null,
      loading: false,
      error: null,
      pendingParams: false,
      paramValues: item.param_values || {},
    })))
    setIsEditing(false)
  }, [])

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/report-dashboards'),
      api.get('/dashboard/saved-queries'),
    ]).then(([r1, r2]) => {
      const boards: AiReportDashboard[] = r1.data
      setDashboards(boards)
      setSavedQueries(r2.data)
      if (boards.length > 0) loadDashboard(boards[0])
    }).catch(console.error)
  }, [loadDashboard])

  // Auto-refresh timer
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    const interval = activeDashboard?.auto_refresh_interval
    if (!interval || isEditing) return
    refreshTimerRef.current = setInterval(() => {
      setLastRefreshed(prev => prev === null ? new Date() : new Date())  // trigger runTile effect
      setLastRefreshed(new Date())
    }, interval * 60 * 1000)
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current) }
  }, [activeDashboard?.auto_refresh_interval, isEditing])

  // 實際 auto-refresh 執行（當 lastRefreshed 更新時跑所有 tile）
  const tilesLenRef = useRef(0)
  tilesLenRef.current = tiles.length
  useEffect(() => {
    if (!lastRefreshed) return
    for (let i = 0; i < tilesLenRef.current; i++) runTile(i)
  }, [lastRefreshed])

  const runTile = useCallback(async (idx: number) => {
    setTiles(prev => prev.map((t, i) => i === idx ? { ...t, loading: true, error: null } : t))
    try {
      const tile = tiles[idx]
      const sq = savedQueries.find(q => q.id === tile.item.query_id)
      if (!sq) throw new Error('找不到查詢')

      // 檢查是否有必填參數未填
      let params: AiQueryParameter[] = []
      try { params = JSON.parse(sq.parameters_schema as any || '[]') || [] } catch {}
      const requiredMissing = params.filter(p => p.required && !tile.paramValues[p.id])
      if (requiredMissing.length > 0) {
        setTiles(prev => prev.map((t, i) => i === idx ? { ...t, loading: false, pendingParams: true } : t))
        setPendingParamTile({ tileIdx: idx, sq, params })
        return
      }

      const r = await execSavedQuery(sq, tile.paramValues)
      setTiles(prev => prev.map((t, i) => i === idx ? { ...t, result: r, loading: false, debugQuestion: r._question, debugSql: r._sql } : t))
    } catch (e: any) {
      setTiles(prev => prev.map((t, i) => i === idx ? { ...t, loading: false, error: e.message } : t))
    }
  }, [tiles, savedQueries])

  function addTile(queryId: number, chartIndex = 0) {
    const newItem: AiDashboardItem = {
      query_id: queryId,
      chart_index: chartIndex,
      i: `${queryId}_${chartIndex}_${Date.now()}`,
      x: 0, y: Infinity, w: 6, h: 4,
    }
    setTiles(prev => [...prev, { item: newItem, result: null, loading: false, error: null, pendingParams: false, paramValues: {} }])
  }

  function removeTile(idx: number) {
    setTiles(prev => prev.filter((_, i) => i !== idx))
  }

  /** 儲存 layout（含 param_values）到 DB */
  async function saveLayoutToDB(currentTiles: TileState[], board = activeDashboard, silent = false) {
    if (!board) return
    if (!silent) setSaving(true)
    try {
      const layout = currentTiles.map(t => ({
        ...t.item,
        param_values: Object.keys(t.paramValues).length > 0 ? t.paramValues : undefined,
      }))
      await api.put(`/dashboard/report-dashboards/${board.id}`, {
        ...board,
        layout_config: layout,
      })
    } catch (e) {
      console.error(e)
    } finally {
      if (!silent) setSaving(false)
    }
  }

  async function saveDashboard() {
    await saveLayoutToDB(tiles)
    setIsEditing(false)
  }

  async function updateAutoRefresh(interval: number | null) {
    if (!activeDashboard) return
    const updated = { ...activeDashboard, auto_refresh_interval: interval }
    setActiveDashboard(updated)
    setDashboards(prev => prev.map(b => b.id === activeDashboard.id ? updated : b))
    await api.put(`/dashboard/report-dashboards/${activeDashboard.id}`, updated).catch(console.error)
  }

  async function createDashboard() {
    if (!newName.trim()) return
    try {
      const r = await api.post('/dashboard/report-dashboards', { name: newName, description: newDesc, category: newCategory })
      const board = r.data
      setDashboards(prev => [...prev, board])
      loadDashboard(board)
      setShowNewDashboard(false)
      setNewName(''); setNewDesc(''); setNewCategory('')
    } catch (e) {
      console.error(e)
    }
  }

  function openEditModal(b: AiReportDashboard) {
    setEditTarget(b)
    setEditName(b.name)
    setEditTranslation({ name_zh: b.name, name_en: b.name_en || null, name_vi: b.name_vi || null })
    setEditDesc(b.description || '')
    setEditDescEn(b.description_en || '')
    setEditDescVi(b.description_vi || '')
    setEditCategory(b.category || '')
    setEditCategoryEn(b.category_en || '')
    setEditCategoryVi(b.category_vi || '')
  }

  async function saveEditDashboard() {
    if (!editTarget || !editName.trim()) return
    setEditSaving(true)
    try {
      // 用目前 tiles 重建 layout，避免 editTarget.layout_config（DB 字串）被雙重 JSON.stringify
      const currentLayout = tiles.map(t => ({
        ...t.item,
        param_values: Object.keys(t.paramValues).length > 0 ? t.paramValues : undefined,
      }))
      const payload = {
        ...editTarget,
        name: editName,
        name_en: editTranslation.name_en || null,
        name_vi: editTranslation.name_vi || null,
        description: editDesc || null,
        description_en: editDescEn || null,
        description_vi: editDescVi || null,
        category: editCategory || null,
        category_en: editCategoryEn || null,
        category_vi: editCategoryVi || null,
        layout_config: currentLayout,
      }
      const r = await api.put(`/dashboard/report-dashboards/${editTarget.id}`, payload)
      const updated: AiReportDashboard = r.data
      setDashboards(prev => prev.map(b => b.id === updated.id ? updated : b))
      if (activeDashboard?.id === updated.id) setActiveDashboard(updated)
      setEditTarget(null)
    } catch (e) {
      console.error(e)
    } finally {
      setEditSaving(false)
    }
  }

  async function deleteDashboard(b: AiReportDashboard) {
    setDeleting(true)
    try {
      await api.delete(`/dashboard/report-dashboards/${b.id}`)
      const remaining = dashboards.filter(d => d.id !== b.id)
      setDashboards(remaining)
      if (activeDashboard?.id === b.id) {
        if (remaining.length > 0) loadDashboard(remaining[0])
        else { setActiveDashboard(null); setTiles([]) }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  function handleLayoutChange(layout: readonly { i: string; x: number; y: number; w: number; h: number }[], _layouts?: unknown) {
    if (!isEditing) return
    setTiles(prev => prev.map(t => {
      const l = layout.find(li => li.i === t.item.i)
      if (!l) return t
      return { ...t, item: { ...t.item, x: l.x, y: l.y, w: l.w, h: l.h } }
    }))
  }

  const gridLayout = tiles.map(t => ({ i: t.item.i, x: t.item.x, y: t.item.y, w: t.item.w, h: t.item.h }))

  return (
    <div className="h-screen bg-gray-50 flex">
      {/* Left sidebar */}
      <div className="w-60 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
          <button onClick={() => navigate('/dashboard')} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft size={14} />
          </button>
          <LayoutDashboard size={14} className="text-orange-400" />
          <span className="text-sm font-semibold text-gray-800">{t('aiDash.board.title')}</span>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {/* 按 category 分組 */}
          {(() => {
            const grouped = dashboards.reduce<Record<string, AiReportDashboard[]>>((acc, d) => {
              const cat = boardCategory(d) || t('aiDash.board.uncategorized')
              ;(acc[cat] = acc[cat] || []).push(d)
              return acc
            }, {})
            return Object.entries(grouped).map(([cat, ds]) => (
              <div key={cat} className="mb-2">
                <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
                  {cat}
                </div>
                {ds.map(d => (
                  <div
                    key={d.id}
                    className={`group flex items-center gap-1 px-3 py-2 text-xs transition cursor-pointer
                      ${activeDashboard?.id === d.id ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                    onClick={() => loadDashboard(d)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{boardName(d)}</p>
                      {boardDesc(d) && <p className="text-[10px] text-gray-400 truncate">{boardDesc(d)}</p>}
                    </div>
                    {!!d.can_manage && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); openEditModal(d) }}
                          className="p-0.5 text-gray-400 hover:text-blue-500 rounded"
                          title="編輯儀表板設定"
                        >
                          <Settings2 size={11} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteTarget(d) }}
                          className="p-0.5 text-gray-400 hover:text-red-500 rounded"
                          title="刪除儀表板"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          })()}
          {dashboards.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8 px-3">{t('aiDash.board.noBoards')}</p>
          )}
        </div>

        <div className="p-3 border-t border-gray-200">
          <button
            onClick={() => setShowNewDashboard(true)}
            className="w-full flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition"
          >
            <Plus size={12} /> {t('aiDash.board.addDashboard')}
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeDashboard ? (
          <>
            {/* Board toolbar */}
            <div className="flex items-center justify-between px-5 py-2 bg-white border-b border-gray-200 flex-shrink-0">
              <div>
                <span className="font-semibold text-sm text-gray-800">{boardName(activeDashboard)}</span>
                {boardDesc(activeDashboard) && (
                  <span className="ml-2 text-xs text-gray-400">{boardDesc(activeDashboard)}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* 重新整理全部 */}
                <button
                  onClick={() => tiles.forEach((_, i) => runTile(i))}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 px-2 py-1.5 rounded hover:bg-blue-50 transition"
                >
                  <RefreshCw size={12} /> {t('aiDash.board.refreshAll')}
                </button>

                {/* 分享 — 僅 can_manage 才顯示 */}
                {!!activeDashboard.can_manage && (
                  <button
                    onClick={() => setShareTarget({ id: activeDashboard.id, name: activeDashboard.name })}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 px-2 py-1.5 rounded hover:bg-blue-50 transition"
                  >
                    <Share2 size={12} /> {t('aiDash.board.share')}
                  </button>
                )}

                {/* Auto-refresh 控制 */}
                {!isEditing && (
                  <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1">
                    <Clock size={11} className="text-gray-400" />
                    <select
                      value={showCustomRefresh ? 'custom' : (activeDashboard.auto_refresh_interval ?? '')}
                      onChange={e => {
                        if (e.target.value === 'custom') {
                          setShowCustomRefresh(true)
                          setCustomRefreshInput('')
                        } else {
                          setShowCustomRefresh(false)
                          updateAutoRefresh(e.target.value === '' ? null : Number(e.target.value))
                        }
                      }}
                      className="text-xs text-gray-600 bg-transparent focus:outline-none cursor-pointer"
                      title={t('aiDash.board.autoRefresh')}
                    >
                      <option value="">{t('aiDash.board.manual')}</option>
                      <option value="30">{t('aiDash.board.refresh30m')}</option>
                      <option value="60">{t('aiDash.board.refresh1h')}</option>
                      <option value="240">{t('aiDash.board.refresh4h')}</option>
                      <option value="1440">{t('aiDash.board.refreshDaily')}</option>
                      <option value="custom">{t('aiDash.board.refreshCustom')}</option>
                    </select>
                    {showCustomRefresh && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          value={customRefreshInput}
                          onChange={e => setCustomRefreshInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && customRefreshInput) {
                              const mins = parseInt(customRefreshInput)
                              if (mins > 0) { updateAutoRefresh(mins); setShowCustomRefresh(false) }
                            }
                          }}
                          placeholder={t('aiDash.board.refreshCustomPh')}
                          className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                          autoFocus
                        />
                        <span className="text-xs text-gray-400">{t('aiDash.board.refreshMinUnit')}</span>
                        <button
                          onClick={() => {
                            const mins = parseInt(customRefreshInput)
                            if (mins > 0) { updateAutoRefresh(mins); setShowCustomRefresh(false) }
                          }}
                          className="px-1.5 py-0.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                        >✓</button>
                        <button onClick={() => setShowCustomRefresh(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                      </div>
                    )}
                    {lastRefreshed && !showCustomRefresh && (
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {lastRefreshed.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}

                {/* 編輯 / 儲存 — 僅 can_manage 才顯示 */}
                {!!activeDashboard.can_manage && (!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-orange-600 px-2 py-1.5 rounded hover:bg-orange-50 transition"
                  >
                    <Pencil size={12} /> {t('aiDash.board.editLayout')}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={saveDashboard}
                      disabled={saving}
                      className="flex items-center gap-1 text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition"
                    >
                      <Save size={12} /> {saving ? t('aiDash.board.saving') : t('common.save')}
                    </button>
                    <button
                      onClick={() => { setIsEditing(false); loadDashboard(activeDashboard) }}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
                    >{t('common.cancel')}</button>
                  </>
                ))}
              </div>
            </div>

            {/* 編輯模式：加入 tile 的選擇器 */}
            {isEditing && (
              <div className="bg-blue-50 border-b border-blue-100 px-5 py-2 flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-blue-700 font-medium">{t('aiDash.board.editLayout')}：</span>
                <select
                  defaultValue=""
                  onChange={e => {
                    if (!e.target.value) return
                    const qid = parseInt(e.target.value)
                    e.target.value = ''
                    const sq = savedQueries.find(q => q.id === qid)
                    if (!sq) return
                    // 解析有幾張圖表
                    let chartCount = 1
                    try {
                      const cfg = typeof sq.chart_config === 'string' ? JSON.parse(sq.chart_config) : sq.chart_config
                      chartCount = (cfg as any)?.charts?.length || 1
                      if (chartCount > 1) {
                        const charts = ((cfg as any).charts as { title?: string }[]).map((c, i) => ({
                          idx: i,
                          title: c.title || `圖表 ${i + 1}`,
                        }))
                        setPendingAddQuery({ sq, charts })
                        return
                      }
                    } catch {}
                    addTile(qid, 0)
                  }}
                  className="text-xs border border-blue-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400"
                >
                  <option value="">{t('aiDash.board.addQuery')}</option>
                  {savedQueries.map(q => (
                    <option key={q.id} value={q.id}>{sqName(q)} {q.category ? `(${q.category})` : ''}</option>
                  ))}
                </select>
                <span className="text-[10px] text-blue-500">可拖拉調整位置和大小</span>
              </div>
            )}

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              <ResponsiveGridLayout
                className="layout"
                layouts={{ lg: gridLayout }}
                breakpoints={{ lg: 1200, md: 996, sm: 768 }}
                cols={{ lg: 12, md: 10, sm: 6 }}
                rowHeight={80}
                isDraggable={isEditing}
                isResizable={isEditing}
                onLayoutChange={handleLayoutChange}
                draggableHandle=".drag-handle"
              >
                {tiles.map((tile, idx) => {
                  const sq = savedQueries.find(q => q.id === tile.item.query_id)
                  const chartCfg = tile.result?.chart_config as AiChartConfig | null
                  const charts = chartCfg?.charts || []
                  const chartDef = charts[tile.item.chart_index] || charts[0]

                  return (
                    <div key={tile.item.i} className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
                      {/* Tile header */}
                      <div className="drag-handle flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100 cursor-move select-none flex-shrink-0">
                        <span className="text-xs font-medium text-gray-700 truncate">
                          {tile.item.title_override || (sq ? sqName(sq) : `查詢 ${tile.item.query_id}`)}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {tile.result && (
                            <button
                              onClick={() => {
                                const cols = tile.result!.columns
                                const labels = tile.result!.column_labels || {}
                                exportCsv(tile.result!.rows, cols, labels, tile.item.title_override || sq?.name || `query_${tile.item.query_id}`)
                              }}
                              className="text-gray-400 hover:text-green-500 p-0.5"
                              title="匯出 CSV"
                            >
                              <Download size={10} />
                            </button>
                          )}
                          {(() => {
                            let tileParams: AiQueryParameter[] = []
                            try { tileParams = JSON.parse(sq?.parameters_schema as any || '[]') || [] } catch {}
                            return tileParams.length > 0 ? (
                              <button
                                onClick={() => sq && setPendingParamTile({ tileIdx: idx, sq, params: tileParams, isEdit: true })}
                                className="text-gray-400 hover:text-purple-500 p-0.5"
                                title="編輯查詢參數"
                              >
                                <SlidersHorizontal size={10} />
                              </button>
                            ) : null
                          })()}
                          <button
                            onClick={() => setTiles(prev => prev.map((t, i) => i === idx ? { ...t, showDebug: !t.showDebug } : t))}
                            className={`p-0.5 ${tile.showDebug ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}
                            title="查看自然語言 & SQL"
                          >
                            <Bug size={10} />
                          </button>
                          <button
                            onClick={() => runTile(idx)}
                            disabled={tile.loading}
                            className="text-gray-400 hover:text-blue-500 p-0.5"
                            title="重新整理"
                          >
                            <RefreshCw size={10} className={tile.loading ? 'animate-spin' : ''} />
                          </button>
                          {isEditing && (
                            <button onClick={() => removeTile(idx)} className="text-gray-400 hover:text-red-400 p-0.5">
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Tile body */}
                      <div className="flex-1 overflow-hidden p-2">
                        {tile.loading && (
                          <div className="h-full flex items-center justify-center text-gray-400">
                            <RefreshCw size={20} className="animate-spin" />
                          </div>
                        )}
                        {tile.error && (
                          <div className="h-full flex items-center justify-center text-red-400 text-xs text-center px-3">
                            {tile.error}
                          </div>
                        )}
                        {!tile.loading && !tile.error && !tile.result && (
                          <div className="h-full flex items-center justify-center">
                            <button
                              onClick={() => runTile(idx)}
                              className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                            >
                              <RefreshCw size={12} /> {t('aiDash.board.clickToRun')}
                            </button>
                          </div>
                        )}
                        {!tile.loading && tile.result && chartDef && (
                          <AiChart
                            chartDef={chartDef}
                            rows={tile.result.rows}
                            columnLabels={tile.result.column_labels}
                          />
                        )}
                        {!tile.loading && tile.result && !chartDef && tile.result.rows.length > 0 && (
                          <div className="h-full overflow-auto text-xs">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-gray-100 sticky top-0">
                                  {tile.result.columns.map(col => (
                                    <th key={col} className="px-2 py-1 text-left border border-gray-200 font-medium text-gray-600 whitespace-nowrap">
                                      {tile.result!.column_labels?.[col] || col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {tile.result.rows.map((row, ri) => (
                                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    {tile.result!.columns.map(col => (
                                      <td key={col} className="px-2 py-1 border border-gray-100 text-gray-700 whitespace-nowrap">
                                        {String(row[col] ?? '')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {!tile.loading && tile.result && !chartDef && tile.result.rows.length === 0 && (
                          <div className="h-full flex items-center justify-center text-gray-400 text-xs">{t('aiDash.board.noData')}</div>
                        )}
                        {tile.showDebug && (
                          <div className="mt-2 border-t border-amber-200 bg-amber-50 rounded-b p-2 text-xs space-y-1">
                            <div>
                              <span className="font-semibold text-amber-700">{t('aiDash.board.queryStatement')}</span>
                              <span className="text-gray-700 break-all">{tile.debugQuestion || '—'}</span>
                            </div>
                            {tile.debugSql && (
                              <div>
                                <span className="font-semibold text-amber-700">{t('aiDash.board.sqlLabel')}</span>
                                <pre className="mt-1 text-gray-700 whitespace-pre-wrap break-all bg-white border border-amber-100 rounded p-1">{tile.debugSql}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </ResponsiveGridLayout>
              {tiles.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16">
                  <LayoutDashboard size={48} className="mb-4 text-orange-200" />
                  {isEditing ? (
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-600 mb-1">{t('aiDash.board.addFromAbove')}</p>
                      <p className="text-xs text-gray-400">
                        {savedQueries.length > 0
                          ? t('aiDash.board.editModeHint', { count: savedQueries.length })
                          : t('aiDash.board.noQueriesEditHint')}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center space-y-3">
                      <p className="text-sm font-medium text-gray-600">{t('aiDash.board.noChartsInBoard')}</p>
                      {savedQueries.length === 0 ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 max-w-xs">
                          <p className="font-medium mb-1">{t('aiDash.board.noQueriesHint')}</p>
                          <p>{t('aiDash.board.noQueriesDesc')}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">
                          {!!activeDashboard.can_manage
                            ? t('aiDash.board.availableQueries', { count: savedQueries.length })
                            : t('aiDash.board.noManageAccess')}
                        </p>
                      )}
                      {!!activeDashboard.can_manage && (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="mt-2 px-4 py-2 bg-orange-500 text-white text-xs rounded-lg hover:bg-orange-600 transition"
                        >
                          {t('aiDash.board.editLayout')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <LayoutDashboard size={56} className="text-orange-200" />
            <div className="text-center space-y-2">
              <p className="text-sm font-medium text-gray-500">{t('aiDash.board.selectDashboard')}</p>
              <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
                {t('aiDash.board.selectDashboardHint')}
              </p>
            </div>
            <button
              onClick={() => setShowNewDashboard(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 transition"
            >
              <Plus size={14} /> {t('aiDash.board.createFirst')}
            </button>
          </div>
        )}
      </div>

      {/* 新增儀表板 Modal */}
      {showNewDashboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-800">{t('aiDash.board.newDashTitle')}</h3>
            <div>
              <label className="text-sm text-gray-600 block mb-1">{t('aiDash.board.newDashName')}</label>
              <input autoFocus type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder={t('aiDash.board.newDashNamePlaceholder')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">{t('aiDash.board.newDashDesc')}</label>
              <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">{t('aiDash.board.newDashCategory')}</label>
              <input type="text" value={newCategory} onChange={e => setNewCategory(e.target.value)}
                placeholder={t('aiDash.board.boardCategoryPlaceholder')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewDashboard(false)} className="px-4 py-2 text-sm text-gray-600">{t('common.cancel')}</button>
              <button onClick={createDashboard} disabled={!newName.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {t('aiDash.board.newDashCreate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 查詢參數 Modal（tile 執行前填值） */}
      {pendingParamTile && (
        <QueryParamsModal
          queryName={sqName(pendingParamTile.sq)}
          params={pendingParamTile.params}
          initialValues={pendingParamTile.isEdit
            ? tiles[pendingParamTile.tileIdx]?.paramValues
            : undefined}
          onConfirm={async values => {
            const { tileIdx: idx, sq } = pendingParamTile
            setPendingParamTile(null)
            // 直接從 tiles 快照建 newTiles（避免 setState updater 副作用問題）
            const newTiles = tiles.map((t, i) => i === idx
              ? { ...t, paramValues: values, item: { ...t.item, param_values: values }, pendingParams: false, loading: true, error: null }
              : t)
            setTiles(newTiles)
            // 立即持久化 param_values 到 DB
            saveLayoutToDB(newTiles, activeDashboard!, true)
            try {
              const r = await execSavedQuery(sq, values)
              setTiles(prev => prev.map((t, i) => i === idx
                ? { ...t, result: r, loading: false, debugQuestion: r._question, debugSql: r._sql }
                : t))
            } catch (e: any) {
              setTiles(prev => prev.map((t, i) => i === idx ? { ...t, loading: false, error: e.message } : t))
            }
          }}
          onClose={() => setPendingParamTile(null)}
        />
      )}

      {/* 圖表選擇 Modal（查詢有多張圖表時） */}
      {pendingAddQuery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 text-sm">{t('aiDash.board.selectChart')}</h3>
            <p className="text-xs text-gray-500">{t('aiDash.board.selectChartDesc', { name: sqName(pendingAddQuery.sq), count: pendingAddQuery.charts.length })}</p>
            <div className="space-y-2">
              {pendingAddQuery.charts.map(c => (
                <button
                  key={c.idx}
                  onClick={() => {
                    addTile(pendingAddQuery.sq.id, c.idx)
                    setPendingAddQuery(null)
                  }}
                  className="w-full text-left px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition"
                >
                  <span className="text-gray-700">{c.title}</span>
                  <span className="ml-2 text-xs text-gray-400">#{c.idx + 1}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  // 全部加入
                  pendingAddQuery.charts.forEach(c => addTile(pendingAddQuery.sq.id, c.idx))
                  setPendingAddQuery(null)
                }}
                className="w-full text-center px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 rounded-lg border border-dashed border-blue-200 transition"
              >
                {t('aiDash.board.addAll', { count: pendingAddQuery.charts.length })}
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setPendingAddQuery(null)} className="text-sm text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯儀表板設定 Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">{t('aiDash.board.boardSettings')}</h3>
              <button
                onClick={async () => {
                  if (!editTarget || translatingBoard) return
                  setTranslatingBoard(true)
                  try {
                    const r = await api.post(`/dashboard/report-dashboards/${editTarget.id}/translate`, {
                      name: editName,
                      description: editDesc,
                      category: editCategory,
                    })
                    setEditTranslation(p => ({ ...p, name_en: r.data.name_en, name_vi: r.data.name_vi }))
                    if (r.data.description_en != null) setEditDescEn(r.data.description_en)
                    if (r.data.description_vi != null) setEditDescVi(r.data.description_vi)
                    if (r.data.category_en != null) setEditCategoryEn(r.data.category_en)
                    if (r.data.category_vi != null) setEditCategoryVi(r.data.category_vi)
                  } catch (e) { console.error(e) } finally { setTranslatingBoard(false) }
                }}
                disabled={translatingBoard}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-blue-50 text-gray-500 hover:text-blue-600 rounded border border-gray-200 disabled:opacity-50"
              >
                {translatingBoard ? '...' : `↻ ${t('aiDash.board.translateAll')}`}
              </button>
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">{t('aiDash.board.boardNameLabel')}</label>
              <input autoFocus type="text" value={editName}
                onChange={e => { setEditName(e.target.value); setEditTranslation(p => ({ ...p, name_zh: e.target.value })) }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <TranslationFields
              data={editTranslation}
              onChange={setEditTranslation}
              hasDescription={false}
              translateUrl={`/dashboard/report-dashboards/${editTarget.id}/translate`}
            />
            <div>
              <label className="text-sm text-gray-600 block mb-1">{t('aiDash.board.boardDesc')}</label>
              <input type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 mb-1" />
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-xs text-gray-400 block mb-0.5">EN</label>
                  <input type="text" value={editDescEn} onChange={e => setEditDescEn(e.target.value)}
                    placeholder="Description (EN)"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-0.5">VI</label>
                  <input type="text" value={editDescVi} onChange={e => setEditDescVi(e.target.value)}
                    placeholder="Mô tả (VI)"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
                </div>
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">{t('aiDash.board.boardCategory')}</label>
              <input type="text" value={editCategory} onChange={e => setEditCategory(e.target.value)}
                placeholder={t('aiDash.board.boardCategoryPlaceholder')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 mb-1" />
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-xs text-gray-400 block mb-0.5">EN</label>
                  <input type="text" value={editCategoryEn} onChange={e => setEditCategoryEn(e.target.value)}
                    placeholder="Category (EN)"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-0.5">VI</label>
                  <input type="text" value={editCategoryVi} onChange={e => setEditCategoryVi(e.target.value)}
                    placeholder="Danh mục (VI)"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditTarget(null)} className="px-4 py-2 text-sm text-gray-600">{t('common.cancel')}</button>
              <button onClick={saveEditDashboard} disabled={!editName.trim() || editSaving}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {editSaving ? t('aiDash.board.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除確認 Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs p-6 space-y-4">
            <h3 className="font-semibold text-gray-800">{t('aiDash.board.deleteConfirmTitle')}</h3>
            <p className="text-sm text-gray-600">
              {t('aiDash.board.deleteConfirmMsg', { name: boardName(deleteTarget) })}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600">{t('common.cancel')}</button>
              <button onClick={() => deleteDashboard(deleteTarget)} disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50">
                {deleting ? t('common.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分享 Modal */}
      {shareTarget && (
        <ShareModal
          title={shareTarget.name}
          sharesUrl={`/dashboard/report-dashboards/${shareTarget.id}/shares`}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  )
}
