/**
 * DashboardBoardPage — 儀表板頁面 /dashboard/boards
 * 功能：react-grid-layout 拖拉排版、KPI card、文字標注、背景設定、
 *        全域篩選、書籤、PNG 匯出、簡報模式
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { ResponsiveReactGridLayout, WidthProvider } from 'react-grid-layout/legacy'
const ResponsiveGridLayout = WidthProvider(ResponsiveReactGridLayout)
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Plus, ArrowLeft, Share2, RefreshCw,
  Save, X, Pencil, Download, SlidersHorizontal, Bug, Clock,
  Settings2, Trash2, ChevronLeft, ChevronRight, Maximize2, Minimize2,
  Image, Bookmark, Filter, Play, SkipBack, SkipForward, PanelLeftClose,
  PanelLeftOpen, TrendingUp, TrendingDown, Minus, Type, BarChart2, Activity,
} from 'lucide-react'
import html2canvas from 'html2canvas'
import { resolveDynamicDate, tokenDisplayLabel, isDynamicToken } from '../lib/dynamicDate'
import api from '../lib/api'
import AiChart from '../components/dashboard/AiChart'
import QueryParamsModal from '../components/dashboard/QueryParamsModal'
import ShareModal from '../components/dashboard/ShareModal'
import TranslationFields from '../components/common/TranslationFields'
import type { TranslationData } from '../components/common/TranslationFields'
import ColorPickerInput from '../components/common/ColorPickerInput'
import type {
  AiReportDashboard, AiDashboardItem, AiSavedQuery,
  AiQueryResult, AiChartConfig, AiQueryParameter,
  AiDashboardGlobalFilter, AiDashboardBookmark, KpiAlertRule,
} from '../types'

// ─── local interfaces ────────────────────────────────────────────────────────

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

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildParamPrefix(params: AiQueryParameter[], values: Record<string, string | string[]>): string {
  const parts = params.map(p => {
    let val = values[p.id]
    const label = p.label_zh || p.id
    if (!val || (Array.isArray(val) && val.length === 0) || val === '') return null
    if (Array.isArray(val)) return `${label} ${val.join('、')}`
    if (p.input_type === 'dynamic_date' || isDynamicToken(val as string)) {
      val = resolveDynamicDate(val as string)
    }
    if (typeof val === 'string' && val.includes('|')) {
      const [s, e] = val.split('|')
      return `${label} ${s} 到 ${e}`
    }
    return `${label} ${val}`
  }).filter(Boolean)
  return parts.length ? parts.join('，') + '，' : ''
}

async function execSavedQuery(
  sq: AiSavedQuery,
  paramValues: Record<string, string | string[]> = {},
): Promise<AiQueryResult & { _question: string; _sql?: string }> {
  let params: AiQueryParameter[] = []
  try { params = JSON.parse(sq.parameters_schema as any || '[]') || [] } catch {}

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
  if (!result) throw new Error('無法取得查詢結果')
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

/** hex (#rrggbb) → 自動決定對比文字色（深背景白字，淺背景深字） */
function contrastColor(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#1f2937'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  // perceived luminance
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#1f2937' : '#ffffff'
}

function extractKpiValue(result: AiQueryResult, column?: string, agg?: string): number | null {
  if (!result.rows.length) return null
  const col = column || result.columns.find(c => {
    const v = result.rows[0][c]
    return typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)))
  }) || result.columns[0]
  const values = result.rows.map(r => Number(r[col] ?? 0)).filter(v => !isNaN(v))
  if (!values.length) return null
  switch (agg) {
    case 'sum': return values.reduce((a, b) => a + b, 0)
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length
    case 'count': return values.length
    default: return values[0]
  }
}

function formatKpiValue(val: number | null, format?: string, decimals?: number): string {
  if (val === null) return '—'
  const d = decimals ?? (format === 'percent' ? 1 : 0)
  if (format === 'currency') return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: d }).format(val)
  if (format === 'percent') return `${val.toFixed(d)}%`
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`
  return val.toFixed(d)
}

function getAlertStyle(val: number | null, rules?: KpiAlertRule[]): { color?: string; bg?: string } {
  if (val === null || !rules?.length) return {}
  for (const rule of rules) {
    const match = rule.operator === '>' ? val > rule.value
      : rule.operator === '<' ? val < rule.value
      : rule.operator === '>=' ? val >= rule.value
      : val <= rule.value
    if (match) return { color: rule.color, bg: rule.bg_color }
  }
  return {}
}

function parseGlobalFilters(raw: AiDashboardGlobalFilter[] | string | null | undefined): AiDashboardGlobalFilter[] {
  if (!raw) return []
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return [] } }
  return raw
}

function parseBookmarks(raw: AiDashboardBookmark[] | string | null | undefined): AiDashboardBookmark[] {
  if (!raw) return []
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return [] } }
  return raw
}

// ─── component ───────────────────────────────────────────────────────────────

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

  // ── core state ──────────────────────────────────────────────────────────────
  const [dashboards, setDashboards] = useState<AiReportDashboard[]>([])
  const [activeDashboard, setActiveDashboard] = useState<AiReportDashboard | null>(null)
  const [tiles, setTiles] = useState<TileState[]>([])
  const [savedQueries, setSavedQueries] = useState<AiSavedQuery[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── sidebar ──────────────────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // ── background ──────────────────────────────────────────────────────────────
  const [showBgPanel, setShowBgPanel] = useState(false)
  const [bgColor, setBgColor] = useState('#f9fafb')
  const [bgImageUrl, setBgImageUrl] = useState('')
  const [bgOpacity, setBgOpacity] = useState(0.15)
  const [toolbarBgColor, setToolbarBgColor] = useState('')   // '' = 預設白色
  const [toolbarTextColor, setToolbarTextColor] = useState('')  // '' = 自動對比
  const [logoUrl, setLogoUrl] = useState('')
  const [logoHeight, setLogoHeight] = useState(28)

  // ── global filters ──────────────────────────────────────────────────────────
  const [globalFilters, setGlobalFilters] = useState<AiDashboardGlobalFilter[]>([])
  const [globalValues, setGlobalValues] = useState<Record<string, string>>({})
  const [showFilterEditor, setShowFilterEditor] = useState(false)
  const [editingFilter, setEditingFilter] = useState<Partial<AiDashboardGlobalFilter> | null>(null)

  // ── bookmarks ──────────────────────────────────────────────────────────────
  const [bookmarks, setBookmarks] = useState<AiDashboardBookmark[]>([])
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [bookmarkName, setBookmarkName] = useState('')
  const [savingBookmark, setSavingBookmark] = useState(false)

  // ── presentation mode ───────────────────────────────────────────────────────
  const [presentationMode, setPresentationMode] = useState(false)
  const [presentationIdx, setPresentationIdx] = useState(0)
  const [presentationAuto, setPresentationAuto] = useState(false)
  const presentationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── export ──────────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const wallpaperInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [wallpaperUploading, setWallpaperUploading] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)

  // ── per-tile edit ───────────────────────────────────────────────────────────
  const [editingTile, setEditingTile] = useState<{ idx: number; item: AiDashboardItem } | null>(null)

  // ── new dashboard ───────────────────────────────────────────────────────────
  const [showNewDashboard, setShowNewDashboard] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCategory, setNewCategory] = useState('')

  // ── share / delete ──────────────────────────────────────────────────────────
  const [shareTarget, setShareTarget] = useState<{ id: number; name: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AiReportDashboard | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── edit dashboard modal ─────────────────────────────────────────────────────
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
  const [editBgColor, setEditBgColor] = useState('')
  const [editBgImageUrl, setEditBgImageUrl] = useState('')
  const [editBgOpacity, setEditBgOpacity] = useState(0.15)
  const [editToolbarBgColor, setEditToolbarBgColor] = useState('')
  const [editToolbarTextColor, setEditToolbarTextColor] = useState('')
  const [editLogoUrl, setEditLogoUrl] = useState('')
  const [editLogoHeight, setEditLogoHeight] = useState(28)
  const [editGlobalFilters, setEditGlobalFilters] = useState<AiDashboardGlobalFilter[]>([])
  const [editingFilterLocal, setEditingFilterLocal] = useState<Partial<AiDashboardGlobalFilter> | null>(null)

  // ── query param / add-query modals ───────────────────────────────────────────
  const [pendingParamTile, setPendingParamTile] = useState<{ tileIdx: number; sq: AiSavedQuery; params: AiQueryParameter[]; isEdit?: boolean } | null>(null)
  const [pendingAddQuery, setPendingAddQuery] = useState<{ sq: AiSavedQuery; charts: { idx: number; title: string }[] } | null>(null)

  // ── auto-refresh ─────────────────────────────────────────────────────────────
  const [customRefreshInput, setCustomRefreshInput] = useState('')
  const [showCustomRefresh, setShowCustomRefresh] = useState(false)

  // ─── load dashboard ──────────────────────────────────────────────────────────

  const loadDashboard = useCallback((board: AiReportDashboard) => {
    setActiveDashboard(board)
    const layout: AiDashboardItem[] = (() => {
      try { return (typeof board.layout_config === 'string' ? JSON.parse(board.layout_config as any) : board.layout_config) || [] }
      catch { return [] }
    })()
    setTiles(layout.map(item => ({
      item,
      result: null,
      loading: false,
      error: null,
      pendingParams: false,
      paramValues: item.param_values || {},
    })))
    // bg settings
    setBgColor(board.bg_color || '#f9fafb')
    setBgImageUrl(board.bg_image_url || '')
    setBgOpacity(board.bg_opacity ?? 0.15)
    setToolbarBgColor(board.toolbar_bg_color || '')
    setToolbarTextColor(board.toolbar_text_color || '')
    setLogoUrl(board.logo_url || '')
    setLogoHeight(board.logo_height ?? 28)
    // global filters
    const gf = parseGlobalFilters(board.global_filters_schema)
    setGlobalFilters(gf)
    setGlobalValues(Object.fromEntries(gf.map(f => [f.id, f.default_value || ''])))
    // bookmarks
    setBookmarks(parseBookmarks(board.bookmarks))
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

  // auto-refresh timer
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    const interval = activeDashboard?.auto_refresh_interval
    if (!interval || isEditing) return
    refreshTimerRef.current = setInterval(() => setLastRefreshed(new Date()), interval * 60 * 1000)
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current) }
  }, [activeDashboard?.auto_refresh_interval, isEditing])

  const tilesLenRef = useRef(0)
  tilesLenRef.current = tiles.length
  useEffect(() => {
    if (!lastRefreshed) return
    for (let i = 0; i < tilesLenRef.current; i++) runTile(i)
  }, [lastRefreshed])

  // presentation auto-advance
  useEffect(() => {
    if (presentationTimerRef.current) clearInterval(presentationTimerRef.current)
    if (!presentationMode || !presentationAuto || tiles.length === 0) return
    presentationTimerRef.current = setInterval(() => {
      setPresentationIdx(prev => (prev + 1) % tiles.length)
    }, 5000)
    return () => { if (presentationTimerRef.current) clearInterval(presentationTimerRef.current) }
  }, [presentationMode, presentationAuto, tiles.length])

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (presentationMode) {
        if (e.key === 'Escape') setPresentationMode(false)
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setPresentationIdx(p => (p + 1) % tiles.length)
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setPresentationIdx(p => (p - 1 + tiles.length) % tiles.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presentationMode, tiles.length])

  // ─── tile execution ──────────────────────────────────────────────────────────

  const runTile = useCallback(async (idx: number) => {
    setTiles(prev => {
      const tile = prev[idx]
      if (!tile || tile.item.tile_type === 'text') return prev
      return prev.map((t, i) => i === idx ? { ...t, loading: true, error: null } : t)
    })
    try {
      const tile = tiles[idx]
      if (!tile || tile.item.tile_type === 'text') return
      const sq = savedQueries.find(q => q.id === tile.item.query_id)
      if (!sq) throw new Error('找不到查詢')

      let params: AiQueryParameter[] = []
      try { params = JSON.parse(sq.parameters_schema as any || '[]') || [] } catch {}
      const requiredMissing = params.filter(p => p.required && !tile.paramValues[p.id] && !globalValues[p.id])
      if (requiredMissing.length > 0) {
        setTiles(prev => prev.map((t, i) => i === idx ? { ...t, loading: false, pendingParams: true } : t))
        setPendingParamTile({ tileIdx: idx, sq, params })
        return
      }

      // merge global filter values into tile param values
      const mergedParams = { ...globalValues, ...tile.paramValues }
      const r = await execSavedQuery(sq, mergedParams)
      setTiles(prev => prev.map((t, i) => i === idx ? { ...t, result: r, loading: false, debugQuestion: r._question, debugSql: r._sql } : t))
    } catch (e: any) {
      setTiles(prev => prev.map((t, i) => i === idx ? { ...t, loading: false, error: e.message } : t))
    }
  }, [tiles, savedQueries, globalValues])

  function runAllTiles() {
    tiles.forEach((_, i) => runTile(i))
  }

  // ─── tile management ─────────────────────────────────────────────────────────

  function addTile(queryId: number, chartIndex = 0, tileType?: AiDashboardItem['tile_type']) {
    const type = tileType || 'chart'
    const newItem: AiDashboardItem = {
      tile_type: type,
      query_id: queryId,
      chart_index: chartIndex,
      i: `${queryId}_${chartIndex}_${Date.now()}`,
      x: 0, y: Infinity,
      w: type === 'kpi' ? 3 : 6,
      h: type === 'kpi' ? 2 : 4,
    }
    setTiles(prev => [...prev, { item: newItem, result: null, loading: false, error: null, pendingParams: false, paramValues: {} }])
  }

  function addTextTile() {
    const newItem: AiDashboardItem = {
      tile_type: 'text',
      chart_index: 0,
      i: `text_${Date.now()}`,
      x: 0, y: Infinity, w: 6, h: 2,
      text_content: '在此輸入說明文字…',
    }
    setTiles(prev => [...prev, { item: newItem, result: null, loading: false, error: null, pendingParams: false, paramValues: {} }])
  }

  function removeTile(idx: number) {
    setTiles(prev => prev.filter((_, i) => i !== idx))
  }

  function updateTileItem(idx: number, patch: Partial<AiDashboardItem>) {
    setTiles(prev => prev.map((t, i) => i === idx ? { ...t, item: { ...t.item, ...patch } } : t))
  }

  // ─── layout save ─────────────────────────────────────────────────────────────

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
        bg_color: bgColor,
        bg_image_url: bgImageUrl || null,
        bg_opacity: bgOpacity,
        toolbar_bg_color: toolbarBgColor || null,
        toolbar_text_color: toolbarTextColor || null,
        logo_url: logoUrl || null,
        logo_height: logoHeight,
        global_filters_schema: globalFilters,
        bookmarks: bookmarks,
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

  function handleLayoutChange(layout: readonly { i: string; x: number; y: number; w: number; h: number }[]) {
    if (!isEditing) return
    setTiles(prev => prev.map(t => {
      const l = layout.find(li => li.i === t.item.i)
      if (!l) return t
      return { ...t, item: { ...t.item, x: l.x, y: l.y, w: l.w, h: l.h } }
    }))
  }

  // ─── auto-refresh ─────────────────────────────────────────────────────────────

  async function updateAutoRefresh(interval: number | null) {
    if (!activeDashboard) return
    const updated = { ...activeDashboard, auto_refresh_interval: interval }
    setActiveDashboard(updated)
    setDashboards(prev => prev.map(b => b.id === activeDashboard.id ? updated : b))
    await api.put(`/dashboard/report-dashboards/${activeDashboard.id}`, updated).catch(console.error)
  }

  // ─── dashboard CRUD ───────────────────────────────────────────────────────────

  async function createDashboard() {
    if (!newName.trim()) return
    try {
      const r = await api.post('/dashboard/report-dashboards', { name: newName, description: newDesc, category: newCategory })
      setDashboards(prev => [...prev, r.data])
      loadDashboard(r.data)
      setShowNewDashboard(false)
      setNewName(''); setNewDesc(''); setNewCategory('')
    } catch (e) { console.error(e) }
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
    setEditBgColor(b.bg_color || '#f9fafb')
    setEditBgImageUrl(b.bg_image_url || '')
    setEditBgOpacity(b.bg_opacity ?? 0.15)
    setEditToolbarBgColor(b.toolbar_bg_color || '')
    setEditToolbarTextColor(b.toolbar_text_color || '')
    setEditLogoUrl(b.logo_url || '')
    setEditLogoHeight(b.logo_height ?? 28)
    setEditGlobalFilters(parseGlobalFilters(b.global_filters_schema))
    setEditingFilterLocal(null)
  }

  async function saveEditDashboard() {
    if (!editTarget || !editName.trim()) return
    setEditSaving(true)
    try {
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
        bg_color: editBgColor || null,
        bg_image_url: editBgImageUrl || null,
        bg_opacity: editBgOpacity,
        toolbar_bg_color: editToolbarBgColor || null,
        toolbar_text_color: editToolbarTextColor || null,
        logo_url: editLogoUrl || null,
        logo_height: editLogoHeight,
        global_filters_schema: editGlobalFilters,
        bookmarks: bookmarks,
      }
      const r = await api.put(`/dashboard/report-dashboards/${editTarget.id}`, payload)
      const updated: AiReportDashboard = r.data
      setDashboards(prev => prev.map(b => b.id === updated.id ? updated : b))
      if (activeDashboard?.id === updated.id) {
        setActiveDashboard(updated)
        setBgColor(editBgColor || '#f9fafb')
        setBgImageUrl(editBgImageUrl || '')
        setBgOpacity(editBgOpacity)
        setToolbarBgColor(editToolbarBgColor || '')
        setToolbarTextColor(editToolbarTextColor || '')
        setLogoUrl(editLogoUrl || '')
        setLogoHeight(editLogoHeight)
        const gf = editGlobalFilters
        setGlobalFilters(gf)
        setGlobalValues(prev => {
          const next = { ...prev }
          gf.forEach(f => { if (!(f.id in next)) next[f.id] = f.default_value || '' })
          return next
        })
      }
      setEditTarget(null)
    } catch (e) { console.error(e) }
    finally { setEditSaving(false) }
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
    } catch (e) { console.error(e) }
    finally { setDeleting(false); setDeleteTarget(null) }
  }

  // ─── bookmarks ────────────────────────────────────────────────────────────────

  async function saveBookmark() {
    if (!bookmarkName.trim() || !activeDashboard) return
    setSavingBookmark(true)
    const newBm: AiDashboardBookmark = {
      id: `bm_${Date.now()}`,
      name: bookmarkName.trim(),
      global_values: { ...globalValues },
      created_at: new Date().toISOString(),
    }
    const updated = [...bookmarks, newBm]
    setBookmarks(updated)
    setBookmarkName('')
    try {
      await api.put(`/dashboard/report-dashboards/${activeDashboard.id}`, {
        ...activeDashboard,
        bookmarks: updated,
      })
    } catch (e) { console.error(e) }
    finally { setSavingBookmark(false) }
  }

  function loadBookmark(bm: AiDashboardBookmark) {
    setGlobalValues(bm.global_values)
    setShowBookmarks(false)
  }

  async function deleteBookmark(id: string) {
    if (!activeDashboard) return
    const updated = bookmarks.filter(b => b.id !== id)
    setBookmarks(updated)
    await api.put(`/dashboard/report-dashboards/${activeDashboard.id}`, {
      ...activeDashboard,
      bookmarks: updated,
    }).catch(console.error)
  }

  // ─── export ───────────────────────────────────────────────────────────────────

  async function exportPng() {
    if (!gridRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(gridRef.current, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: bgColor || '#f9fafb',
        scale: 1.5,
      })
      const link = document.createElement('a')
      link.download = `${activeDashboard?.name || 'dashboard'}_${new Date().toLocaleDateString('zh-TW')}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (e) { console.error(e) }
    finally { setExporting(false) }
  }

  // ─── render helpers ───────────────────────────────────────────────────────────

  const gridLayout = tiles.map(t => ({
    i: t.item.i,
    x: t.item.x, y: t.item.y, w: t.item.w, h: t.item.h,
    minW: t.item.tile_type === 'kpi' ? 2 : 3,
    minH: t.item.tile_type === 'kpi' ? 1 : 2,
  }))

  function renderTileBody(tile: TileState, idx: number) {
    const type = tile.item.tile_type || 'chart'
    const sq = savedQueries.find(q => q.id === tile.item.query_id)

    // ── TEXT WIDGET ──────────────────────────────────────────────────────────
    if (type === 'text') {
      return (
        <div className="h-full p-3 overflow-auto">
          {isEditing ? (
            <textarea
              className="w-full h-full resize-none text-sm text-gray-700 focus:outline-none bg-transparent"
              value={tile.item.text_content || ''}
              onChange={e => updateTileItem(idx, { text_content: e.target.value })}
            />
          ) : (
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{tile.item.text_content || ''}</div>
          )}
        </div>
      )
    }

    // ── KPI CARD ─────────────────────────────────────────────────────────────
    if (type === 'kpi') {
      if (tile.loading) return (
        <div className="h-full flex items-center justify-center text-gray-400">
          <RefreshCw size={20} className="animate-spin" />
        </div>
      )
      if (tile.error) return (
        <div className="h-full flex items-center justify-center text-red-400 text-xs text-center px-3">{tile.error}</div>
      )
      if (!tile.result) return (
        <div className="h-full flex items-center justify-center">
          <button onClick={() => runTile(idx)} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
            <RefreshCw size={12} /> 點擊執行
          </button>
        </div>
      )
      const val = extractKpiValue(tile.result, tile.item.kpi_column, tile.item.kpi_agg)
      const compVal = tile.item.kpi_comparison_column
        ? extractKpiValue(tile.result, tile.item.kpi_comparison_column, 'first')
        : null
      const formatted = formatKpiValue(val, tile.item.kpi_format, tile.item.kpi_decimals)
      const alert = getAlertStyle(val, tile.item.kpi_alert_rules)
      const trend = compVal !== null && val !== null
        ? (val > compVal ? 'up' : val < compVal ? 'down' : 'flat')
        : null
      return (
        <div
          className="h-full flex flex-col items-center justify-center p-3 rounded"
          style={alert.bg ? { backgroundColor: alert.bg } : undefined}
        >
          <span className="text-xs text-gray-400 mb-1 text-center truncate max-w-full">
            {tile.item.title_override || (sq ? sqName(sq) : '')}
          </span>
          <span
            className="font-bold leading-none"
            style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
              color: alert.color || '#1e293b',
            }}
          >
            {formatted}
          </span>
          {trend && (
            <span className={`flex items-center gap-0.5 text-xs mt-1 ${trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-400'}`}>
              {trend === 'up' ? <TrendingUp size={12} /> : trend === 'down' ? <TrendingDown size={12} /> : <Minus size={12} />}
              {compVal !== null && val !== null ? `vs ${formatKpiValue(compVal, tile.item.kpi_format, tile.item.kpi_decimals)}` : ''}
            </span>
          )}
          {tile.showDebug && tile.result.rows.length > 0 && (
            <div className="mt-1 text-[10px] text-gray-400 text-center">
              rows: {tile.result.row_count ?? tile.result.rows.length}
            </div>
          )}
        </div>
      )
    }

    // ── CHART TILE ───────────────────────────────────────────────────────────
    const chartCfg = tile.result?.chart_config as AiChartConfig | null
    const charts = chartCfg?.charts || []
    const chartDef = charts[tile.item.chart_index] || charts[0]

    if (tile.loading) return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <RefreshCw size={20} className="animate-spin" />
      </div>
    )
    if (tile.error) return (
      <div className="h-full flex items-center justify-center text-red-400 text-xs text-center px-3">{tile.error}</div>
    )
    if (!tile.result) return (
      <div className="h-full flex items-center justify-center">
        <button onClick={() => runTile(idx)} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
          <RefreshCw size={12} /> 點擊執行
        </button>
      </div>
    )
    if (chartDef) return (
      <AiChart chartDef={chartDef} rows={tile.result.rows} columnLabels={tile.result.column_labels} />
    )
    if (tile.result.rows.length === 0) return (
      <div className="h-full flex items-center justify-center text-gray-400 text-xs">無資料</div>
    )
    return (
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
    )
  }

  // ─── main render ──────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-gray-50 flex relative">

      {/* ─── Left sidebar ─────────────────────────────────────────────────── */}
      {!sidebarCollapsed && (
        <div className="w-60 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
            <button onClick={() => navigate('/dashboard')} className="text-gray-400 hover:text-gray-700">
              <ArrowLeft size={14} />
            </button>
            <LayoutDashboard size={14} className="text-orange-400" />
            <span className="text-sm font-semibold text-gray-800 flex-1">儀表板</span>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="text-gray-400 hover:text-gray-600"
              title="收起側欄"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {(() => {
              const grouped = dashboards.reduce<Record<string, AiReportDashboard[]>>((acc, d) => {
                const cat = boardCategory(d) || '未分類'
                ;(acc[cat] = acc[cat] || []).push(d)
                return acc
              }, {})
              return Object.entries(grouped).map(([cat, ds]) => (
                <div key={cat} className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">{cat}</div>
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
                          <button onClick={e => { e.stopPropagation(); openEditModal(d) }} className="p-0.5 text-gray-400 hover:text-blue-500 rounded" title="設定">
                            <Settings2 size={11} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); setDeleteTarget(d) }} className="p-0.5 text-gray-400 hover:text-red-500 rounded" title="刪除">
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
              <p className="text-xs text-gray-400 text-center py-8 px-3">尚無儀表板</p>
            )}
          </div>

          <div className="p-3 border-t border-gray-200">
            <button
              onClick={() => setShowNewDashboard(true)}
              className="w-full flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition"
            >
              <Plus size={12} /> 新增儀表板
            </button>
          </div>
        </div>
      )}

      {/* ─── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeDashboard ? (
          <>
            {/* Board toolbar */}
            {(toolbarTextColor || toolbarBgColor) && (
              <style>{`.tbtn { color: ${toolbarTextColor || contrastColor(toolbarBgColor || '#fff')} !important; opacity: 0.8; } .tbtn:hover { opacity: 1 !important; }`}</style>
            )}
            <div
              className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0 gap-2 transition-colors"
              style={toolbarBgColor
                ? { backgroundColor: toolbarBgColor, borderColor: `${toolbarBgColor}cc`, color: toolbarTextColor || contrastColor(toolbarBgColor) }
                : { backgroundColor: '#ffffff', borderColor: '#e5e7eb', color: toolbarTextColor || '#111827' }
              }>
              <div className="flex items-center gap-2 min-w-0">
                {sidebarCollapsed && (
                  <button onClick={() => setSidebarCollapsed(false)} className="text-gray-400 hover:text-gray-600 flex-shrink-0" title="展開側欄">
                    <PanelLeftOpen size={16} />
                  </button>
                )}
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt="logo"
                    className="flex-shrink-0 object-contain"
                    style={{ height: logoHeight, maxWidth: logoHeight * 4 }}
                  />
                )}
                <span className="font-semibold text-sm truncate" style={{ color: 'inherit' }}>{boardName(activeDashboard)}</span>
                {boardDesc(activeDashboard) && (
                  <span className="text-xs truncate hidden md:block opacity-60">{boardDesc(activeDashboard)}</span>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                {/* 全域篩選值指示 */}
                {globalFilters.length > 0 && Object.values(globalValues).some(v => v) && (
                  <span className="flex items-center gap-1 text-[10px] text-purple-600 bg-purple-50 px-2 py-1 rounded border border-purple-200">
                    <Filter size={10} /> 已篩選
                  </span>
                )}

                {/* 書籤 */}
                {bookmarks.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowBookmarks(p => !p)}
                      className="tbtn flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 px-2 py-1.5 rounded hover:bg-amber-50 transition"
                      title="書籤"
                    >
                      <Bookmark size={12} />
                    </button>
                    {showBookmarks && (
                      <div className="absolute right-0 top-8 z-50 bg-white rounded-xl shadow-xl border border-gray-200 w-56 p-2">
                        <div className="text-xs font-semibold text-gray-600 px-2 mb-1">已儲存書籤</div>
                        {bookmarks.map(bm => (
                          <div key={bm.id} className="flex items-center gap-1 group px-2 py-1.5 rounded hover:bg-gray-50">
                            <button className="flex-1 text-left text-xs text-gray-700 truncate" onClick={() => loadBookmark(bm)}>{bm.name}</button>
                            <button onClick={() => deleteBookmark(bm.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500">
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                        <div className="border-t border-gray-100 mt-1 pt-1 px-2 flex gap-1">
                          <input
                            className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-400"
                            placeholder="書籤名稱"
                            value={bookmarkName}
                            onChange={e => setBookmarkName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveBookmark()}
                          />
                          <button
                            onClick={saveBookmark}
                            disabled={!bookmarkName.trim() || savingBookmark}
                            className="px-2 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50"
                          >儲存</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 背景設定 */}
                {!!activeDashboard.can_manage && (
                  <button
                    onClick={() => setShowBgPanel(p => !p)}
                    className={`tbtn flex items-center gap-1 text-xs px-2 py-1.5 rounded transition ${showBgPanel ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                    title="背景設定"
                  >
                    <Image size={12} />
                  </button>
                )}

                {/* 簡報模式 */}
                {tiles.length > 0 && (
                  <button
                    onClick={() => { setPresentationMode(true); setPresentationIdx(0) }}
                    className="tbtn flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 px-2 py-1.5 rounded hover:bg-indigo-50 transition"
                    title="簡報模式"
                  >
                    <Play size={12} />
                  </button>
                )}

                {/* 匯出 PNG */}
                <button
                  onClick={exportPng}
                  disabled={exporting}
                  className="tbtn flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 px-2 py-1.5 rounded hover:bg-green-50 transition"
                  title="匯出為 PNG"
                >
                  {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
                </button>

                {/* 重新整理 */}
                <button
                  onClick={runAllTiles}
                  className="tbtn flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 px-2 py-1.5 rounded hover:bg-blue-50 transition"
                >
                  <RefreshCw size={12} /> 重新整理
                </button>

                {/* 分享 */}
                {!!activeDashboard.can_manage && (
                  <button
                    onClick={() => setShareTarget({ id: activeDashboard.id, name: activeDashboard.name })}
                    className="tbtn flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 px-2 py-1.5 rounded hover:bg-blue-50 transition"
                  >
                    <Share2 size={12} />
                  </button>
                )}

                {/* Auto-refresh */}
                {!isEditing && (
                  <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1">
                    <Clock size={11} className="text-gray-400" />
                    <select
                      value={showCustomRefresh ? 'custom' : (activeDashboard.auto_refresh_interval ?? '')}
                      onChange={e => {
                        if (e.target.value === 'custom') { setShowCustomRefresh(true); setCustomRefreshInput('') }
                        else { setShowCustomRefresh(false); updateAutoRefresh(e.target.value === '' ? null : Number(e.target.value)) }
                      }}
                      className="text-xs text-gray-600 bg-transparent focus:outline-none cursor-pointer"
                    >
                      <option value="">手動</option>
                      <option value="30">30分鐘</option>
                      <option value="60">1小時</option>
                      <option value="240">4小時</option>
                      <option value="1440">每日</option>
                      <option value="custom">自訂</option>
                    </select>
                    {showCustomRefresh && (
                      <div className="flex items-center gap-1">
                        <input type="number" min={1} max={9999} value={customRefreshInput}
                          onChange={e => setCustomRefreshInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && customRefreshInput) { const m = parseInt(customRefreshInput); if (m > 0) { updateAutoRefresh(m); setShowCustomRefresh(false) } } }}
                          placeholder="分鐘" className="w-12 border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none" autoFocus />
                        <span className="text-xs text-gray-400">分</span>
                        <button onClick={() => { const m = parseInt(customRefreshInput); if (m > 0) { updateAutoRefresh(m); setShowCustomRefresh(false) } }}
                          className="px-1.5 py-0.5 bg-blue-600 text-white text-xs rounded">✓</button>
                        <button onClick={() => setShowCustomRefresh(false)} className="text-gray-400 text-xs">✕</button>
                      </div>
                    )}
                  </div>
                )}

                {/* 編輯 / 儲存 */}
                {!!activeDashboard.can_manage && (!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="tbtn flex items-center gap-1 text-xs text-gray-400 hover:text-orange-600 px-2 py-1.5 rounded hover:bg-orange-50 transition"
                  >
                    <Pencil size={12} /> 編輯
                  </button>
                ) : (
                  <>
                    <button onClick={saveDashboard} disabled={saving}
                      className="flex items-center gap-1 text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition">
                      <Save size={12} /> {saving ? '儲存中…' : '儲存'}
                    </button>
                    <button onClick={() => { setIsEditing(false); loadDashboard(activeDashboard) }}
                      className="tbtn text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">取消</button>
                  </>
                ))}
              </div>
            </div>

            {/* 背景設定面板 */}
            {showBgPanel && (
              <div className="bg-white border-b border-gray-200 px-5 py-2.5 flex items-center gap-4 flex-shrink-0 flex-wrap">
                {/* Logo */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Logo</span>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setLogoUploading(true)
                      try {
                        const fd = new FormData()
                        fd.append('logo', file)
                        const r = await api.post('/dashboard/upload-logo', fd, {
                          headers: { 'Content-Type': 'multipart/form-data' },
                        })
                        setLogoUrl(r.data.url)
                      } catch (err) { console.error(err) }
                      finally { setLogoUploading(false); e.target.value = '' }
                    }}
                  />
                  {logoUrl
                    ? <img src={logoUrl} alt="logo" className="object-contain rounded border border-gray-200" style={{ height: 28, maxWidth: 80 }} />
                    : <span className="text-[10px] text-gray-400">未設定</span>}
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploading}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition disabled:opacity-50"
                  >
                    {logoUploading ? <RefreshCw size={10} className="animate-spin" /> : <Image size={10} />}
                    上傳
                  </button>
                  {logoUrl && (
                    <button onClick={() => setLogoUrl('')} className="text-gray-400 hover:text-red-400" title="移除 Logo">
                      <X size={10} />
                    </button>
                  )}
                </div>
                {/* Logo 尺寸 */}
                {logoUrl && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Logo 高度</span>
                    <input type="range" min={16} max={60} step={2} value={logoHeight}
                      onChange={e => setLogoHeight(Number(e.target.value))}
                      className="w-20 h-1.5 accent-blue-500" />
                    <span className="text-[10px] text-gray-500 w-8">{logoHeight}px</span>
                  </div>
                )}

                <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

                {/* 工具列背景 */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">工具列底色</span>
                  <ColorPickerInput value={toolbarBgColor || '#ffffff'} onChange={v => setToolbarBgColor(v)} title="工具列背景色" size="md" />
                  {toolbarBgColor && (
                    <button onClick={() => setToolbarBgColor('')} className="text-gray-400 hover:text-red-400" title="重設為白色">
                      <X size={10} />
                    </button>
                  )}
                </div>

                {/* 工具列文字色 */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">工具列文字</span>
                  <ColorPickerInput value={toolbarTextColor || '#111827'} onChange={v => setToolbarTextColor(v)} title="工具列文字色" size="md" />
                  {toolbarTextColor && (
                    <button onClick={() => setToolbarTextColor('')} className="text-gray-400 hover:text-red-400" title="自動對比">
                      <X size={10} />
                    </button>
                  )}
                </div>

                <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

                {/* 內容區背景 */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">內容區</span>
                  <ColorPickerInput value={bgColor} onChange={v => setBgColor(v)} title="內容區背景色" size="md" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 whitespace-nowrap">壁紙</span>
                  {/* 隱藏 file input */}
                  <input
                    ref={wallpaperInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setWallpaperUploading(true)
                      try {
                        const fd = new FormData()
                        fd.append('wallpaper', file)
                        const r = await api.post('/dashboard/upload-wallpaper', fd, {
                          headers: { 'Content-Type': 'multipart/form-data' },
                        })
                        setBgImageUrl(r.data.url)
                      } catch (err) {
                        console.error(err)
                      } finally {
                        setWallpaperUploading(false)
                        e.target.value = ''
                      }
                    }}
                  />
                  <button
                    onClick={() => wallpaperInputRef.current?.click()}
                    disabled={wallpaperUploading}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition disabled:opacity-50"
                    title="從電腦上傳圖片"
                  >
                    {wallpaperUploading ? <RefreshCw size={10} className="animate-spin" /> : <Image size={10} />}
                    上傳
                  </button>
                  <input type="text" value={bgImageUrl} onChange={e => setBgImageUrl(e.target.value)}
                    placeholder="或貼上 URL…"
                    className="w-36 border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400" />
                  {bgImageUrl && <button onClick={() => setBgImageUrl('')} className="text-gray-400 hover:text-red-400"><X size={10} /></button>}
                </div>
                {bgImageUrl && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400 whitespace-nowrap">遮罩 {Math.round(bgOpacity * 100)}%</span>
                    <input type="range" min={0} max={1} step={0.05} value={bgOpacity}
                      onChange={e => setBgOpacity(Number(e.target.value))}
                      className="w-20 h-1.5 accent-blue-500" />
                  </div>
                )}
                <button
                  onClick={async () => {
                    if (!activeDashboard) return
                    const updated = {
                      ...activeDashboard,
                      bg_color: bgColor,
                      bg_image_url: bgImageUrl || undefined,
                      bg_opacity: bgOpacity,
                      toolbar_bg_color: toolbarBgColor || undefined,
                      toolbar_text_color: toolbarTextColor || undefined,
                      logo_url: logoUrl || undefined,
                      logo_height: logoHeight,
                    }
                    setActiveDashboard(updated)
                    await api.put(`/dashboard/report-dashboards/${activeDashboard.id}`, updated).catch(console.error)
                    setShowBgPanel(false)
                  }}
                  className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                >套用</button>
                <button onClick={() => setShowBgPanel(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
              </div>
            )}

            {/* 全域篩選列 */}
            {globalFilters.length > 0 && (
              <div className="bg-purple-50 border-b border-purple-100 px-5 py-2 flex items-center gap-3 flex-shrink-0 flex-wrap">
                <span className="text-xs text-purple-700 font-medium flex items-center gap-1">
                  <Filter size={11} /> 全域篩選
                </span>
                {globalFilters.map(f => (
                  <div key={f.id} className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">{f.label_zh}：</span>
                    {f.input_type === 'select' ? (
                      <select
                        value={globalValues[f.id] || ''}
                        onChange={e => setGlobalValues(p => ({ ...p, [f.id]: e.target.value }))}
                        className="text-xs border border-purple-200 rounded px-1.5 py-0.5 bg-white focus:outline-none"
                      >
                        <option value="">（全部）</option>
                        {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.input_type === 'date' ? (
                      <input type="date" value={globalValues[f.id] || ''}
                        onChange={e => setGlobalValues(p => ({ ...p, [f.id]: e.target.value }))}
                        className="text-xs border border-purple-200 rounded px-1.5 py-0.5 focus:outline-none w-32" />
                    ) : (
                      <input type="text" value={globalValues[f.id] || ''}
                        onChange={e => setGlobalValues(p => ({ ...p, [f.id]: e.target.value }))}
                        placeholder={f.default_value || ''}
                        className="text-xs border border-purple-200 rounded px-1.5 py-0.5 focus:outline-none w-28" />
                    )}
                  </div>
                ))}
                <button
                  onClick={runAllTiles}
                  className="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700"
                >套用</button>
                <button
                  onClick={() => {
                    setGlobalValues(Object.fromEntries(globalFilters.map(f => [f.id, f.default_value || ''])))
                  }}
                  className="text-xs text-purple-600 hover:text-purple-800"
                >重設</button>
                {/* 儲存書籤 */}
                {Object.values(globalValues).some(v => v) && !showBookmarks && (
                  <button
                    onClick={() => setShowBookmarks(true)}
                    className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-0.5"
                    title="儲存為書籤"
                  >
                    <Bookmark size={11} /> 儲存書籤
                  </button>
                )}
              </div>
            )}

            {/* 編輯模式：加入 tile 選擇器 */}
            {isEditing && (
              <div className="bg-blue-50 border-b border-blue-100 px-5 py-2 flex items-center gap-3 flex-shrink-0 flex-wrap">
                <span className="text-xs text-blue-700 font-medium">編輯佈局：</span>

                {/* 加入查詢 tile */}
                <select
                  defaultValue=""
                  onChange={e => {
                    if (!e.target.value) return
                    const [type, qid] = e.target.value.split(':')
                    e.target.value = ''
                    if (type === 'kpi') {
                      addTile(parseInt(qid), 0, 'kpi')
                      return
                    }
                    const sq = savedQueries.find(q => q.id === parseInt(qid))
                    if (!sq) return
                    let chartCount = 1
                    try {
                      const cfg = typeof sq.chart_config === 'string' ? JSON.parse(sq.chart_config) : sq.chart_config
                      chartCount = (cfg as any)?.charts?.length || 1
                      if (chartCount > 1) {
                        const charts = ((cfg as any).charts as { title?: string }[]).map((c, i) => ({ idx: i, title: c.title || `圖表 ${i + 1}` }))
                        setPendingAddQuery({ sq, charts })
                        return
                      }
                    } catch {}
                    addTile(parseInt(qid), 0, 'chart')
                  }}
                  className="text-xs border border-blue-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400"
                >
                  <option value="">＋ 加入圖表查詢</option>
                  {savedQueries.map(q => (
                    <option key={`chart:${q.id}`} value={`chart:${q.id}`}>{sqName(q)}{q.category ? ` (${q.category})` : ''}</option>
                  ))}
                </select>

                {/* KPI 卡 */}
                <select
                  defaultValue=""
                  onChange={e => {
                    if (!e.target.value) return
                    addTile(parseInt(e.target.value), 0, 'kpi')
                    e.target.value = ''
                  }}
                  className="text-xs border border-blue-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400"
                >
                  <option value="">＋ 加入 KPI 卡</option>
                  {savedQueries.map(q => (
                    <option key={q.id} value={q.id}>{sqName(q)}</option>
                  ))}
                </select>

                {/* 文字標注 */}
                <button
                  onClick={addTextTile}
                  className="flex items-center gap-1 text-xs text-blue-600 border border-blue-200 bg-white px-2 py-1 rounded hover:bg-blue-50"
                >
                  <Type size={11} /> 文字標注
                </button>

                <span className="text-[10px] text-blue-500">可拖拉調整位置和大小</span>
              </div>
            )}

            {/* Grid */}
            <div
              ref={gridRef}
              className="flex-1 overflow-y-auto p-4 relative"
              style={{
                backgroundColor: bgColor || '#f9fafb',
                backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {bgImageUrl && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ backgroundColor: `rgba(249,250,251,${bgOpacity})` }}
                />
              )}
              <div className="relative z-10">
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
                    const type = tile.item.tile_type || 'chart'
                    let tileParams: AiQueryParameter[] = []
                    try { tileParams = JSON.parse(sq?.parameters_schema as any || '[]') || [] } catch {}
                    // chart_bg_color from chartDef (only available when result is loaded)
                    const chartCfg = tile.result?.chart_config as AiChartConfig | null
                    const charts = chartCfg?.charts || []
                    const chartDef = charts[tile.item.chart_index] || charts[0]
                    const tileBg = chartDef?.chart_bg_color || (type === 'kpi' ? '#ffffff' : '#ffffff')
                    const tileTextColor = chartDef?.chart_bg_color ? contrastColor(chartDef.chart_bg_color) : '#374151'
                    const tileHeaderBg = chartDef?.chart_bg_color
                      ? chartDef.chart_bg_color + 'dd'
                      : type === 'text' ? '#eff6ff' : '#f9fafb'

                    return (
                      <div
                        key={tile.item.i}
                        className="border rounded-xl overflow-hidden flex flex-col transition-colors"
                        style={{ backgroundColor: tileBg, borderColor: chartDef?.chart_bg_color ? chartDef.chart_bg_color + '80' : '#e5e7eb' }}
                      >
                        {/* Tile header */}
                        <div
                          className="drag-handle flex items-center justify-between px-3 py-2 border-b select-none flex-shrink-0"
                          style={{
                            backgroundColor: tileHeaderBg,
                            borderColor: chartDef?.chart_bg_color ? chartDef.chart_bg_color + '60' : '#f3f4f6',
                            color: tileTextColor,
                            cursor: isEditing ? 'move' : 'default',
                          }}
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            {type === 'kpi' && <Activity size={10} className="text-orange-400 flex-shrink-0" />}
                            {type === 'text' && <Type size={10} className="text-blue-400 flex-shrink-0" />}
                            {type === 'chart' && <BarChart2 size={10} className="text-gray-400 flex-shrink-0" />}
                            <span className="text-xs font-medium truncate" style={{ color: 'inherit' }}>
                              {tile.item.title_override || (sq ? sqName(sq) : type === 'text' ? '文字標注' : `查詢 ${tile.item.query_id}`)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {/* 匯出 CSV（chart/table only） */}
                            {tile.result && type !== 'text' && (
                              <button
                                onClick={() => exportCsv(tile.result!.rows, tile.result!.columns, tile.result!.column_labels || {}, tile.item.title_override || sq?.name || `query_${tile.item.query_id}`)}
                                className="text-gray-400 hover:text-green-500 p-0.5" title="匯出 CSV"
                              >
                                <Download size={10} />
                              </button>
                            )}
                            {/* 參數 */}
                            {tileParams.length > 0 && (
                              <button onClick={() => sq && setPendingParamTile({ tileIdx: idx, sq, params: tileParams, isEdit: true })}
                                className="text-gray-400 hover:text-purple-500 p-0.5" title="查詢參數">
                                <SlidersHorizontal size={10} />
                              </button>
                            )}
                            {/* Tile 設定（KPI / Chart title-override） */}
                            {isEditing && type !== 'text' && (
                              <button
                                onClick={() => setEditingTile({ idx, item: { ...tile.item } })}
                                className="text-gray-400 hover:text-blue-500 p-0.5" title="Tile 設定"
                              >
                                <Settings2 size={10} />
                              </button>
                            )}
                            {/* Debug */}
                            {type !== 'text' && (
                              <button
                                onClick={() => setTiles(prev => prev.map((t, i) => i === idx ? { ...t, showDebug: !t.showDebug } : t))}
                                className={`p-0.5 ${tile.showDebug ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}
                                title="查看 SQL"
                              >
                                <Bug size={10} />
                              </button>
                            )}
                            {/* Refresh */}
                            {type !== 'text' && (
                              <button onClick={() => runTile(idx)} disabled={tile.loading}
                                className="text-gray-400 hover:text-blue-500 p-0.5" title="重新整理">
                                <RefreshCw size={10} className={tile.loading ? 'animate-spin' : ''} />
                              </button>
                            )}
                            {/* Remove */}
                            {isEditing && (
                              <button onClick={() => removeTile(idx)} className="text-gray-400 hover:text-red-400 p-0.5">
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Tile body */}
                        <div className="flex-1 overflow-hidden p-2">
                          {renderTileBody(tile, idx)}
                          {tile.showDebug && tile.debugQuestion && (
                            <div className="mt-2 border-t border-amber-200 bg-amber-50 rounded-b p-2 text-xs space-y-1">
                              <div>
                                <span className="font-semibold text-amber-700">問句：</span>
                                <span className="text-gray-700 break-all">{tile.debugQuestion}</span>
                              </div>
                              {tile.debugSql && (
                                <div>
                                  <span className="font-semibold text-amber-700">SQL：</span>
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
                      <p className="text-sm text-gray-500">從上方加入查詢</p>
                    ) : (
                      <div className="text-center space-y-3">
                        <p className="text-sm font-medium text-gray-600">此儀表板尚無圖表</p>
                        {!!activeDashboard.can_manage && (
                          <button onClick={() => setIsEditing(true)} className="px-4 py-2 bg-orange-500 text-white text-xs rounded-lg hover:bg-orange-600 transition">
                            編輯佈局
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <LayoutDashboard size={56} className="text-orange-200" />
            <div className="text-center space-y-2">
              <p className="text-sm font-medium text-gray-500">選擇左側儀表板</p>
              <p className="text-xs text-gray-400 max-w-sm">或建立一個新的儀表板</p>
            </div>
            <button onClick={() => setShowNewDashboard(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 transition">
              <Plus size={14} /> 建立第一個儀表板
            </button>
          </div>
        )}
      </div>

      {/* ─── Presentation Mode ────────────────────────────────────────────── */}
      {presentationMode && tiles.length > 0 && (
        <div className="fixed inset-0 z-[100] bg-gray-900 flex flex-col">
          {/* controls bar */}
          <div className="flex items-center justify-between px-6 py-3 bg-black/40">
            <span className="text-white font-semibold text-sm">{boardName(activeDashboard!)}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPresentationAuto(p => !p)}
                className={`text-xs px-2 py-1 rounded ${presentationAuto ? 'bg-blue-600 text-white' : 'bg-white/20 text-white'}`}
              >
                {presentationAuto ? '自動播放中' : '手動'}
              </button>
              <span className="text-white/60 text-xs">{presentationIdx + 1} / {tiles.length}</span>
              <button onClick={() => setPresentationMode(false)} className="text-white hover:text-red-300 p-1">
                <X size={18} />
              </button>
            </div>
          </div>
          {/* slide */}
          <div className="flex-1 p-8 flex items-center justify-center">
            {(() => {
              const tile = tiles[presentationIdx]
              const sq = savedQueries.find(q => q.id === tile?.item.query_id)
              return (
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[60vh] flex flex-col overflow-hidden">
                  <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <span className="font-semibold text-gray-800">
                      {tile?.item.title_override || (sq ? sqName(sq) : '—')}
                    </span>
                    <div className="flex gap-2">
                      {tile && !tile.loading && !tile.result && tile.item.tile_type !== 'text' && (
                        <button onClick={() => runTile(presentationIdx)} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                          <RefreshCw size={12} /> 執行
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden p-3">
                    {tile ? renderTileBody(tile, presentationIdx) : null}
                  </div>
                </div>
              )
            })()}
          </div>
          {/* prev / next */}
          <div className="flex items-center justify-center gap-6 pb-6">
            <button
              onClick={() => setPresentationIdx(p => (p - 1 + tiles.length) % tiles.length)}
              className="p-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition"
            >
              <SkipBack size={20} />
            </button>
            <div className="flex gap-1.5">
              {tiles.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPresentationIdx(i)}
                  className={`w-2 h-2 rounded-full transition ${i === presentationIdx ? 'bg-white' : 'bg-white/30 hover:bg-white/60'}`}
                />
              ))}
            </div>
            <button
              onClick={() => setPresentationIdx(p => (p + 1) % tiles.length)}
              className="p-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition"
            >
              <SkipForward size={20} />
            </button>
          </div>
          <div className="text-center pb-3 text-white/30 text-xs">← → 鍵切換 · Esc 退出</div>
        </div>
      )}

      {/* ─── Tile settings modal (KPI / chart title-override) ─────────────── */}
      {editingTile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-800">Tile 設定</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">標題（覆蓋）</label>
              <input type="text" value={editingTile.item.title_override || ''}
                onChange={e => setEditingTile(p => p ? { ...p, item: { ...p.item, title_override: e.target.value } } : null)}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                placeholder="留空使用查詢名稱" />
            </div>
            {editingTile.item.tile_type === 'kpi' && (
              <>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">KPI 欄位</label>
                  <input type="text" value={editingTile.item.kpi_column || ''}
                    onChange={e => setEditingTile(p => p ? { ...p, item: { ...p.item, kpi_column: e.target.value } } : null)}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                    placeholder="欄位名稱（留空=第一個數字欄）" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">聚合方式</label>
                    <select value={editingTile.item.kpi_agg || 'first'}
                      onChange={e => setEditingTile(p => p ? { ...p, item: { ...p.item, kpi_agg: e.target.value as any } } : null)}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none">
                      <option value="first">第一筆</option>
                      <option value="sum">加總</option>
                      <option value="avg">平均</option>
                      <option value="count">筆數</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">格式</label>
                    <select value={editingTile.item.kpi_format || 'number'}
                      onChange={e => setEditingTile(p => p ? { ...p, item: { ...p.item, kpi_format: e.target.value as any } } : null)}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none">
                      <option value="number">數字</option>
                      <option value="currency">貨幣 NTD</option>
                      <option value="percent">百分比</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">比較欄位（顯示趨勢箭頭）</label>
                  <input type="text" value={editingTile.item.kpi_comparison_column || ''}
                    onChange={e => setEditingTile(p => p ? { ...p, item: { ...p.item, kpi_comparison_column: e.target.value } } : null)}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                    placeholder="留空不顯示趨勢" />
                </div>
                {/* Alert rules */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">警示規則</label>
                  <div className="space-y-1">
                    {(editingTile.item.kpi_alert_rules || []).map((rule, ri) => (
                      <div key={ri} className="flex items-center gap-1">
                        <select value={rule.operator}
                          onChange={e => setEditingTile(p => {
                            if (!p) return null
                            const rules = [...(p.item.kpi_alert_rules || [])]
                            rules[ri] = { ...rules[ri], operator: e.target.value as any }
                            return { ...p, item: { ...p.item, kpi_alert_rules: rules } }
                          })}
                          className="border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none w-14">
                          <option value=">">{'>'}</option>
                          <option value="<">{'<'}</option>
                          <option value=">=">{'>='}</option>
                          <option value="<=">{'<='}</option>
                        </select>
                        <input type="number" value={rule.value}
                          onChange={e => setEditingTile(p => {
                            if (!p) return null
                            const rules = [...(p.item.kpi_alert_rules || [])]
                            rules[ri] = { ...rules[ri], value: Number(e.target.value) }
                            return { ...p, item: { ...p.item, kpi_alert_rules: rules } }
                          })}
                          className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none w-20" />
                        <ColorPickerInput value={rule.color}
                          onChange={v => setEditingTile(p => {
                            if (!p) return null
                            const rules = [...(p.item.kpi_alert_rules || [])]
                            rules[ri] = { ...rules[ri], color: v }
                            return { ...p, item: { ...p.item, kpi_alert_rules: rules } }
                          })}
                          title="文字顏色" size="md" />
                        <ColorPickerInput value={rule.bg_color || '#ffffff'}
                          onChange={v => setEditingTile(p => {
                            if (!p) return null
                            const rules = [...(p.item.kpi_alert_rules || [])]
                            rules[ri] = { ...rules[ri], bg_color: v }
                            return { ...p, item: { ...p.item, kpi_alert_rules: rules } }
                          })}
                          title="背景顏色" size="md" />
                        <button onClick={() => setEditingTile(p => {
                          if (!p) return null
                          const rules = (p.item.kpi_alert_rules || []).filter((_, i) => i !== ri)
                          return { ...p, item: { ...p.item, kpi_alert_rules: rules } }
                        })} className="text-gray-400 hover:text-red-400"><X size={12} /></button>
                      </div>
                    ))}
                    <button
                      onClick={() => setEditingTile(p => {
                        if (!p) return null
                        const rules = [...(p.item.kpi_alert_rules || []), { operator: '>' as const, value: 0, color: '#ef4444', bg_color: '#fee2e2' }]
                        return { ...p, item: { ...p.item, kpi_alert_rules: rules } }
                      })}
                      className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                    >
                      <Plus size={11} /> 加入規則
                    </button>
                  </div>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingTile(null)} className="px-4 py-2 text-sm text-gray-600">取消</button>
              <button
                onClick={() => {
                  updateTileItem(editingTile.idx, editingTile.item)
                  setEditingTile(null)
                }}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >套用</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 新增儀表板 Modal ──────────────────────────────────────────────── */}
      {showNewDashboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-800">新增儀表板</h3>
            <div>
              <label className="text-sm text-gray-600 block mb-1">名稱</label>
              <input autoFocus type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="儀表板名稱"
                onKeyDown={e => e.key === 'Enter' && createDashboard()}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">說明</label>
              <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">分類</label>
              <input type="text" value={newCategory} onChange={e => setNewCategory(e.target.value)}
                placeholder="e.g. 生產 / 品質"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewDashboard(false)} className="px-4 py-2 text-sm text-gray-600">取消</button>
              <button onClick={createDashboard} disabled={!newName.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">建立</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 查詢參數 Modal ────────────────────────────────────────────────── */}
      {pendingParamTile && (
        <QueryParamsModal
          queryName={sqName(pendingParamTile.sq)}
          params={pendingParamTile.params}
          initialValues={pendingParamTile.isEdit ? tiles[pendingParamTile.tileIdx]?.paramValues : undefined}
          onConfirm={async values => {
            const { tileIdx: idx, sq } = pendingParamTile
            setPendingParamTile(null)
            const newTiles = tiles.map((t, i) => i === idx
              ? { ...t, paramValues: values, item: { ...t.item, param_values: values }, pendingParams: false, loading: true, error: null }
              : t)
            setTiles(newTiles)
            saveLayoutToDB(newTiles, activeDashboard!, true)
            try {
              const r = await execSavedQuery(sq, { ...globalValues, ...values })
              setTiles(prev => prev.map((t, i) => i === idx ? { ...t, result: r, loading: false, debugQuestion: r._question, debugSql: r._sql } : t))
            } catch (e: any) {
              setTiles(prev => prev.map((t, i) => i === idx ? { ...t, loading: false, error: e.message } : t))
            }
          }}
          onClose={() => setPendingParamTile(null)}
        />
      )}

      {/* ─── 圖表選擇 Modal ────────────────────────────────────────────────── */}
      {pendingAddQuery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 text-sm">選擇要加入的圖表</h3>
            <p className="text-xs text-gray-500">{sqName(pendingAddQuery.sq)} 共 {pendingAddQuery.charts.length} 張圖表</p>
            <div className="space-y-2">
              {pendingAddQuery.charts.map(c => (
                <button key={c.idx} onClick={() => { addTile(pendingAddQuery.sq.id, c.idx); setPendingAddQuery(null) }}
                  className="w-full text-left px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition">
                  {c.title} <span className="text-xs text-gray-400">#{c.idx + 1}</span>
                </button>
              ))}
              <button onClick={() => { pendingAddQuery.charts.forEach(c => addTile(pendingAddQuery.sq.id, c.idx)); setPendingAddQuery(null) }}
                className="w-full text-center px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 rounded-lg border border-dashed border-blue-200 transition">
                全部加入（{pendingAddQuery.charts.length} 張）
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setPendingAddQuery(null)} className="text-sm text-gray-500 hover:text-gray-700">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 編輯儀表板設定 Modal ──────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">儀表板設定</h3>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!editTarget || translatingBoard) return
                    setTranslatingBoard(true)
                    try {
                      const r = await api.post(`/dashboard/report-dashboards/${editTarget.id}/translate`, {
                        name: editName, description: editDesc, category: editCategory,
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
                  {translatingBoard ? '...' : '↻ 翻譯'}
                </button>
                <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
            </div>

            {/* 名稱 */}
            <div>
              <label className="text-sm text-gray-600 block mb-1">名稱</label>
              <input autoFocus type="text" value={editName}
                onChange={e => { setEditName(e.target.value); setEditTranslation(p => ({ ...p, name_zh: e.target.value })) }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <TranslationFields data={editTranslation} onChange={setEditTranslation} hasDescription={false}
              translateUrl={`/dashboard/report-dashboards/${editTarget.id}/translate`} />

            {/* 說明 */}
            <div>
              <label className="text-sm text-gray-600 block mb-1">說明</label>
              <input type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 mb-1" />
              <div className="grid grid-cols-2 gap-1">
                <div><label className="text-xs text-gray-400 block mb-0.5">EN</label>
                  <input type="text" value={editDescEn} onChange={e => setEditDescEn(e.target.value)} placeholder="Description (EN)"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" /></div>
                <div><label className="text-xs text-gray-400 block mb-0.5">VI</label>
                  <input type="text" value={editDescVi} onChange={e => setEditDescVi(e.target.value)} placeholder="Mô tả (VI)"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" /></div>
              </div>
            </div>

            {/* 分類 */}
            <div>
              <label className="text-sm text-gray-600 block mb-1">分類</label>
              <input type="text" value={editCategory} onChange={e => setEditCategory(e.target.value)} placeholder="e.g. 生產"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 mb-1" />
              <div className="grid grid-cols-2 gap-1">
                <div><label className="text-xs text-gray-400 block mb-0.5">EN</label>
                  <input type="text" value={editCategoryEn} onChange={e => setEditCategoryEn(e.target.value)} placeholder="Category (EN)"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" /></div>
                <div><label className="text-xs text-gray-400 block mb-0.5">VI</label>
                  <input type="text" value={editCategoryVi} onChange={e => setEditCategoryVi(e.target.value)} placeholder="Danh mục (VI)"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" /></div>
              </div>
            </div>

            {/* 背景設定 */}
            <div className="border-t border-gray-100 pt-3">
              <label className="text-sm text-gray-600 font-medium block mb-2">外觀設定</label>
              <div className="space-y-2">
                {/* Logo */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-16 flex-shrink-0">Logo</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    id="edit-logo-input"
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setLogoUploading(true)
                      try {
                        const fd = new FormData()
                        fd.append('logo', file)
                        const r = await api.post('/dashboard/upload-logo', fd, {
                          headers: { 'Content-Type': 'multipart/form-data' },
                        })
                        setEditLogoUrl(r.data.url)
                      } catch (err) { console.error(err) }
                      finally { setLogoUploading(false); e.target.value = '' }
                    }}
                  />
                  {editLogoUrl
                    ? <img src={editLogoUrl} alt="logo" className="object-contain rounded border border-gray-200 h-6 max-w-[60px]" />
                    : <span className="text-[10px] text-gray-400">未設定</span>}
                  <button
                    onClick={() => document.getElementById('edit-logo-input')?.click()}
                    disabled={logoUploading}
                    className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition disabled:opacity-50"
                  >
                    {logoUploading ? <RefreshCw size={10} className="animate-spin" /> : <Image size={10} />}
                    上傳
                  </button>
                  {editLogoUrl && <button onClick={() => setEditLogoUrl('')} className="text-gray-400 hover:text-red-400"><X size={10} /></button>}
                </div>
                {editLogoUrl && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16 flex-shrink-0">Logo 高度</span>
                    <input type="range" min={16} max={60} step={2} value={editLogoHeight}
                      onChange={e => setEditLogoHeight(Number(e.target.value))}
                      className="w-24 h-1.5 accent-blue-500" />
                    <span className="text-[10px] text-gray-400">{editLogoHeight}px</span>
                  </div>
                )}
                {/* 工具列背景色 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-16 flex-shrink-0">工具列底色</span>
                  <ColorPickerInput value={editToolbarBgColor || '#ffffff'} onChange={v => setEditToolbarBgColor(v)} title="工具列背景色" size="md" />
                  {editToolbarBgColor && (
                    <button onClick={() => setEditToolbarBgColor('')} className="text-xs text-gray-400 hover:text-red-400">重設</button>
                  )}
                </div>
                {/* 工具列文字色 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-16 flex-shrink-0">工具列文字</span>
                  <ColorPickerInput value={editToolbarTextColor || '#111827'} onChange={v => setEditToolbarTextColor(v)} title="工具列文字色" size="md" />
                  {editToolbarTextColor && (
                    <button onClick={() => setEditToolbarTextColor('')} className="text-xs text-gray-400 hover:text-red-400">重設</button>
                  )}
                </div>
                {/* 內容區背景色 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-16 flex-shrink-0">內容區色</span>
                  <ColorPickerInput value={editBgColor} onChange={v => setEditBgColor(v)} title="內容區背景色" size="md" />
                </div>
                {/* 壁紙 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-16 flex-shrink-0">壁紙</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    id="edit-wallpaper-input"
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setWallpaperUploading(true)
                      try {
                        const fd = new FormData()
                        fd.append('wallpaper', file)
                        const r = await api.post('/dashboard/upload-wallpaper', fd, {
                          headers: { 'Content-Type': 'multipart/form-data' },
                        })
                        setEditBgImageUrl(r.data.url)
                      } catch (err) {
                        console.error(err)
                      } finally {
                        setWallpaperUploading(false)
                        e.target.value = ''
                      }
                    }}
                  />
                  <button
                    onClick={() => document.getElementById('edit-wallpaper-input')?.click()}
                    disabled={wallpaperUploading}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition disabled:opacity-50 flex-shrink-0"
                  >
                    {wallpaperUploading ? <RefreshCw size={10} className="animate-spin" /> : <Image size={10} />}
                    上傳
                  </button>
                  <input type="text" value={editBgImageUrl} onChange={e => setEditBgImageUrl(e.target.value)}
                    placeholder="或貼上 URL…"
                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
                  {editBgImageUrl && <button onClick={() => setEditBgImageUrl('')} className="text-gray-400 hover:text-red-400"><X size={12} /></button>}
                </div>
                {editBgImageUrl && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16 flex-shrink-0">遮罩</span>
                    <input type="range" min={0} max={1} step={0.05} value={editBgOpacity}
                      onChange={e => setEditBgOpacity(Number(e.target.value))}
                      className="w-28 h-1.5 accent-blue-500" />
                    <span className="text-xs text-gray-400">{Math.round(editBgOpacity * 100)}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* 全域篩選定義 */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-600 font-medium">全域篩選</label>
                <button
                  onClick={() => setEditingFilterLocal({ id: `f_${Date.now()}`, label_zh: '', input_type: 'text', param_name: '' })}
                  className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5"
                >
                  <Plus size={11} /> 加入篩選
                </button>
              </div>
              {editGlobalFilters.length === 0 && (
                <p className="text-xs text-gray-400">尚無全域篩選。加入後可跨所有 tile 篩選。</p>
              )}
              {editGlobalFilters.map((f, fi) => (
                <div key={f.id} className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                  <span className="flex-1 text-xs text-gray-700 truncate">{f.label_zh || '（未命名）'} <span className="text-gray-400">[{f.param_name}]</span></span>
                  <span className="text-[10px] text-gray-400">{f.input_type}</span>
                  <button onClick={() => setEditingFilterLocal({ ...f })} className="text-gray-400 hover:text-blue-500"><Pencil size={11} /></button>
                  <button onClick={() => setEditGlobalFilters(p => p.filter((_, i) => i !== fi))} className="text-gray-400 hover:text-red-400"><X size={11} /></button>
                </div>
              ))}
              {/* edit filter */}
              {editingFilterLocal && (
                <div className="mt-2 border border-blue-200 rounded-lg p-3 bg-blue-50 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5">標籤</label>
                      <input type="text" value={editingFilterLocal.label_zh || ''}
                        onChange={e => setEditingFilterLocal(p => p ? { ...p, label_zh: e.target.value } : null)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5">param_name（注入到問句）</label>
                      <input type="text" value={editingFilterLocal.param_name || ''}
                        onChange={e => setEditingFilterLocal(p => p ? { ...p, param_name: e.target.value } : null)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                        placeholder="e.g. factory_code" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5">輸入類型</label>
                      <select value={editingFilterLocal.input_type || 'text'}
                        onChange={e => setEditingFilterLocal(p => p ? { ...p, input_type: e.target.value as any } : null)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none">
                        <option value="text">文字</option>
                        <option value="date">日期</option>
                        <option value="select">下拉</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5">預設值</label>
                      <input type="text" value={editingFilterLocal.default_value || ''}
                        onChange={e => setEditingFilterLocal(p => p ? { ...p, default_value: e.target.value } : null)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
                    </div>
                  </div>
                  {editingFilterLocal.input_type === 'select' && (
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5">選項（逗號分隔）</label>
                      <input type="text" value={(editingFilterLocal.options || []).join(',')}
                        onChange={e => setEditingFilterLocal(p => p ? { ...p, options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } : null)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                        placeholder="A,B,C" />
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingFilterLocal(null)} className="text-xs text-gray-500">取消</button>
                    <button
                      onClick={() => {
                        if (!editingFilterLocal?.label_zh || !editingFilterLocal?.param_name) return
                        setEditGlobalFilters(prev => {
                          const idx = prev.findIndex(f => f.id === editingFilterLocal.id)
                          if (idx >= 0) { const next = [...prev]; next[idx] = editingFilterLocal as AiDashboardGlobalFilter; return next }
                          return [...prev, editingFilterLocal as AiDashboardGlobalFilter]
                        })
                        setEditingFilterLocal(null)
                      }}
                      className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                    >確認</button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditTarget(null)} className="px-4 py-2 text-sm text-gray-600">取消</button>
              <button onClick={saveEditDashboard} disabled={!editName.trim() || editSaving}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {editSaving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 刪除確認 ─────────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs p-6 space-y-4">
            <h3 className="font-semibold text-gray-800">刪除儀表板</h3>
            <p className="text-sm text-gray-600">確定刪除「{boardName(deleteTarget)}」？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600">取消</button>
              <button onClick={() => deleteDashboard(deleteTarget)} disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50">
                {deleting ? '刪除中…' : '刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 分享 Modal ───────────────────────────────────────────────────── */}
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
