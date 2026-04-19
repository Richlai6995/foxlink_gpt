/**
 * AI 戰情主頁面 /dashboard
 *
 * 三欄佈局：
 *   左側欄  — 主題/任務樹狀選單 + 設計者管理入口
 *   主要區域 — 查詢介面 + ECharts 圖表 + 資料表
 *   底部     — 開發模式 panel（設計者專用）
 */
import { useState, useEffect, useRef } from 'react'
import { fmtTW } from '../lib/fmtTW'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BarChart3, ChevronRight, ChevronDown, Send, RefreshCw,
  Table, BarChart2, Settings2, Code, ArrowLeft, Layers, History, Trash2, X,
  Save, BookMarked, Columns, LayoutDashboard, Share2, Pencil, Download, Shield, CornerUpLeft
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import AiChart from '../components/dashboard/AiChart'
import ResultTable from '../components/dashboard/ResultTable'
import DesignerPanel from '../components/dashboard/DesignerPanel'
import SchemaFieldPicker from '../components/dashboard/SchemaFieldPicker'
import ChartBuilder from '../components/dashboard/ChartBuilder'
import ShelfChartBuilder from '../components/dashboard/ShelfChartBuilder'
import SavedQueryModal from '../components/dashboard/SavedQueryModal'
import QueryParamsModal from '../components/dashboard/QueryParamsModal'
import ShareModal from '../components/dashboard/ShareModal'
import type {
  AiSelectTopic, AiSelectDesign, AiQueryResult, AiChartConfig, AiChartDef,
  AiDashboardHistory, AiSavedQuery, AiQueryParameter, MultiOrgScope, OrgScope
} from '../types'

type ViewMode = 'chart' | 'table'
type SidebarTab = 'topics' | 'history' | 'saved'

export default function AiDashboardPage() {
  const { isAdmin, canUseDashboard, canDesignAiSelect } = useAuth()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [searchParams] = useSearchParams()

  const localName = (item: any) => {
    if (i18n.language === 'en') return item.name_en || item.name
    if (i18n.language === 'vi') return item.name_vi || item.name
    return item.name_zh || item.name
  }

  const localDesc = (item: any) => {
    if (i18n.language === 'en') return item.desc_en || item.description
    if (i18n.language === 'vi') return item.desc_vi || item.description
    return item.desc_zh || item.description
  }

  const [topics, setTopics] = useState<AiSelectTopic[]>([])
  const [expandedTopics, setExpandedTopics] = useState<Set<number>>(new Set())
  const [selectedDesign, setSelectedDesign] = useState<AiSelectDesign | null>(null)
  const selectedTopic = topics.find(t => t.designs?.some(d => d.id === selectedDesign?.id)) ?? null
  const [showDesigner, setShowDesigner] = useState(false)

  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [result, setResult] = useState<AiQueryResult | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('chart')
  const [activeChartIdx, setActiveChartIdx] = useState(0)

  // 歷史記錄
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('topics')
  const [history, setHistory] = useState<AiDashboardHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null)

  useEffect(() => { if (sidebarTab === 'history') loadHistory() }, [sidebarTab])
  // mount 時預先載入歷史，讓「最近問過」chip 有資料可顯示
  useEffect(() => { loadHistory() }, [])

  const loadHistory = async () => {
    setHistoryLoading(true)
    try { setHistory((await api.get('/dashboard/history?limit=100')).data) } catch { } finally { setHistoryLoading(false) }
  }

  // 切 design 時：若該 design 在 history 裡 < 3 筆，lazy-load 該 design 專屬的最近 10 筆補上
  useEffect(() => {
    if (!selectedDesign) return
    const cnt = history.filter(h => h.design_id === selectedDesign.id).length
    if (cnt >= 3) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get(`/dashboard/history?design_id=${selectedDesign.id}&limit=10`)
        const extra: AiDashboardHistory[] = r.data || []
        if (cancelled || !extra.length) return
        setHistory(prev => {
          const ids = new Set(prev.map(h => h.id))
          return [...prev, ...extra.filter(e => !ids.has(e.id))]
        })
      } catch {}
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDesign?.id])
  const deleteHistory = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await api.delete(`/dashboard/history/${id}`)
    setHistory(p => p.filter(h => h.id !== id))
  }
  const clearHistory = async () => {
    if (!confirm(t('aiDash.clearAllConfirm'))) return
    await api.delete('/dashboard/history')
    setHistory([])
  }

  // LLM model 選擇
  const [models, setModels] = useState<{ key: string; name: string; description?: string }[]>([])
  const [selectedModelKey, setSelectedModelKey] = useState<string>('')
  useEffect(() => {
    api.get('/chat/models').then(r => {
      const list = (r.data || []).filter((m: any) => !m.image_output)
      setModels(list)
      if (!selectedModelKey && list.length) setSelectedModelKey(list[0].key)
    }).catch(() => {})
  }, [])

  // ── Oracle MultiOrg 權限範圍 ────────────────────────────────────────────────
  const [multiOrgScope, setMultiOrgScope] = useState<MultiOrgScope | null>(null)
  const [multiOrgExpanded, setMultiOrgExpanded] = useState(false)

  // ── 公司組織階層權限範圍（Layer 3）────────────────────────────────────────
  const [orgScope, setOrgScope] = useState<OrgScope | null>(null)
  const [orgScopeExpanded, setOrgScopeExpanded] = useState(false)

  useEffect(() => {
    if (isAdmin) {
      setMultiOrgScope({ has_restrictions: false, is_admin: true })
      setOrgScope({ has_restrictions: false, is_admin: true } as any)
      return
    }
    const catId = selectedTopic?.policy_category_id
    const designId = selectedDesign?.id
    const base = catId ? `?category_id=${catId}` : '?'
    const qs = base + (designId ? `${catId ? '&' : ''}design_id=${designId}` : '')
    api.get(`/dashboard/multiorg-scope${qs}`)
      .then(r => setMultiOrgScope(r.data))
      .catch(e => {
        const d = e?.response?.data
        if (d?.denied) setMultiOrgScope(d)
        else setMultiOrgScope({ has_restrictions: false })
      })
    api.get(`/dashboard/org-scope${qs}`)
      .then(r => setOrgScope(r.data))
      .catch(e => {
        const d = e?.response?.data
        if (d?.denied) setOrgScope(d as any)
        else setOrgScope(null)
      })
  }, [isAdmin, selectedTopic?.policy_category_id, selectedDesign?.id])

  // 向量搜尋覆蓋參數（查詢時可調整）
  const [showVectorAdv, setShowVectorAdv] = useState(false)
  const [advTopK, setAdvTopK] = useState('')
  const [advThreshold, setAdvThreshold] = useState('')

  // 開發模式 panel
  const [devMode, setDevMode] = useState(false)
  const [devSql, setDevSql] = useState('')
  const [devCached, setDevCached] = useState(false)
  const [devTokens, setDevTokens] = useState<{ prompt?: number; output?: number } | null>(null)
  const [devDuration, setDevDuration] = useState<number | null>(null)
  const [devVectorResults, setDevVectorResults] = useState<any[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // ── 命名查詢 / 報表 ──────────────────────────────────────────────────────
  const [savedQueries, setSavedQueries] = useState<AiSavedQuery[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [editingQuery, setEditingQuery] = useState<AiSavedQuery | null>(null)
  const [showChartBuilder, setShowChartBuilder] = useState(false)
  const [showShelfBuilder, setShowShelfBuilder] = useState(false)
  const [showFieldPicker, setShowFieldPicker] = useState(false)
  const [shareTarget, setShareTarget] = useState<{ type: 'query' | 'dashboard'; id: number; name: string } | null>(null)
  // 即將執行的命名查詢（需先填參數）
  const [pendingQuery, setPendingQuery] = useState<AiSavedQuery | null>(null)
  // 使用者自訂的 chart_config（覆蓋 design 預設）
  const [userChartConfig, setUserChartConfig] = useState<AiChartConfig | null>(null)
  // 目前載入執行的命名查詢 id（Tableau 自動存檔用）
  const [loadedSqId, setLoadedSqId] = useState<number | null>(null)
  // 從 Tableau 另存為新查詢時帶入的 chart_config（新存才用，一般儲存不帶圖表設定）
  const [pendingSaveChartConfig, setPendingSaveChartConfig] = useState<AiChartConfig | null>(null)

  const loadSavedQueries = async () => {
    setSavedLoading(true)
    try { setSavedQueries((await api.get('/dashboard/saved-queries')).data) }
    catch { } finally { setSavedLoading(false) }
  }

  useEffect(() => { if (sidebarTab === 'saved') loadSavedQueries() }, [sidebarTab])

  useEffect(() => {
    if (!canUseDashboard && !isAdmin) {
      navigate('/chat')
      return
    }
    loadTopics()
  }, [])

  const loadTopics = () => {
    const targetTopicId = Number(searchParams.get('topic'))
    const targetDesignId = Number(searchParams.get('design'))
    api.get('/dashboard/topics').then(r => {
      const data: AiSelectTopic[] = r.data
      setTopics(data)
      // auto-select from URL params
      if (targetDesignId) {
        for (const topic of data) {
          const d = topic.designs?.find((d: AiSelectDesign) => d.id === targetDesignId)
          if (d) { selectDesign(d); setExpandedTopics(new Set([topic.id])); return }
        }
      }
      // auto-expand by topicId or first topic
      if (targetTopicId) {
        setExpandedTopics(new Set([targetTopicId]))
      } else if (data.length > 0) {
        setExpandedTopics(new Set([data[0].id]))
      }
    }).catch(() => {})
  }

  const toggleTopic = (id: number) => {
    setExpandedTopics(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const selectDesign = (d: AiSelectDesign) => {
    setSelectedDesign(d)
    setResult(null)
    setDevSql('')
    setDevTokens(null)
    setDevDuration(null)
    setDevVectorResults([])
    setQuestion('')
    setUserChartConfig(null)
    setLoadedSqId(null)
    setShowChartBuilder(false)
    // 帶入任務設定的向量搜尋預設值
    setAdvTopK(d.vector_top_k != null ? String(d.vector_top_k) : '')
    setAdvThreshold(d.vector_similarity_threshold != null ? String(d.vector_similarity_threshold) : '')
  }

  const handleQuery = async () => {
    if (!selectedDesign || !question.trim() || loading) return
    setLoading(true)
    setStatusMsg('準備中...')
    setResult(null)
    setDevSql('')
    setDevCached(false)
    setDevTokens(null)
    setDevDuration(null)
    setDevVectorResults([])

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const resp = await fetch('/api/dashboard/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          design_id: selectedDesign.id,
          question: question.trim(),
          lang: i18n.language,
          ...(selectedModelKey ? { model_key: selectedModelKey } : {}),
          ...(advTopK ? { vector_top_k: Number(advTopK) } : {}),
          ...(advThreshold ? { vector_similarity_threshold: advThreshold } : {}),
        }),
        signal: ctrl.signal,
      })

      if (!resp.ok || !resp.body) throw new Error('請求失敗')
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const data = JSON.parse(line.slice(5).trim())
            processEvent(line, data)
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setStatusMsg('查詢錯誤：' + (e.message || ''))
    } finally {
      setLoading(false)
      if (!result) setStatusMsg('')
      loadHistory()
    }
  }

  const processEvent = (rawLine: string, data: any) => {
    // detect event type from prior "event:" line — simplified: parse SSE properly
    // Since we only read data: lines above, we lose event names.
    // Re-parse: the buf contains "event: X\ndata: {...}\n\n"
    // For simplicity, data objects carry implicit keys:
    if ('has_restrictions' in data) {
      setMultiOrgScope(data as MultiOrgScope)
    } else if ('message' in data && !('rows' in data)) {
      setStatusMsg(data.message || '')
    } else if ('sql' in data) {
      setDevSql(data.sql || '')
      setDevCached(data.cached || false)
      if (data.prompt_tokens) setDevTokens({ prompt: data.prompt_tokens, output: data.output_tokens })
    } else if ('duration_ms' in data) {
      setDevDuration(data.duration_ms)
    } else if ('results' in data) {
      setDevVectorResults(data.results || [])
    } else if ('rows' in data) {
      setResult({
        rows: data.rows,
        columns: data.columns || (data.rows.length > 0 ? Object.keys(data.rows[0]) : []),
        column_labels: data.column_labels || {},
        row_count: data.row_count,
        chart_config: data.chart_config ? (typeof data.chart_config === 'string' ? JSON.parse(data.chart_config) : data.chart_config) : null,
      })
      setStatusMsg('')
      setActiveChartIdx(0)
    } else if ('error' in data) {
      setStatusMsg('錯誤：' + data.error)
    }
  }

  // Re-implement with proper SSE event parsing
  /** 從參數值組出問句前綴，例：「計畫名稱 20250506，廠別 TW1、TW2，」 */
  function buildParamPrefix(params: AiQueryParameter[], values: Record<string, string | string[]>): string {
    const parts = params.map(p => {
      const val = values[p.id]
      const label = p.label_zh
      if (!val || (Array.isArray(val) && val.length === 0) || val === '') return null
      if (Array.isArray(val)) return `${label} ${val.join('、')}`
      if (p.input_type === 'date_range') {
        const [s, e] = (val as string).split('|')
        return `${label} ${s} 到 ${e}`
      }
      if (p.input_type === 'number_range') {
        const [min, max] = (val as string).split('|')
        return `${label} ${min} 到 ${max}`
      }
      return `${label} ${val}`
    }).filter(Boolean)
    return parts.length ? parts.join('，') + '，' : ''
  }

  const handleQuerySse = async (overrideQuestion?: string) => {
    const q = overrideQuestion ?? question
    if (!selectedDesign || !q.trim() || loading) return
    setLoading(true)
    setStatusMsg('準備中...')
    setResult(null)
    setDevSql('')
    setDevCached(false)
    setDevTokens(null)
    setDevDuration(null)
    setDevVectorResults([])

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const resp = await fetch('/api/dashboard/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          design_id: selectedDesign.id,
          question: q.trim(),
          lang: i18n.language,
          ...(selectedModelKey ? { model_key: selectedModelKey } : {}),
          ...(advTopK ? { vector_top_k: Number(advTopK) } : {}),
          ...(advThreshold ? { vector_similarity_threshold: advThreshold } : {}),
        }),
        signal: ctrl.signal,
      })

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}))
        throw new Error(errBody.error || `請求失敗 ${resp.status}`)
      }
      if (!resp.body) throw new Error('請求失敗')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      const parseBlock = (block: string) => {
        const lines = block.split('\n')
        let event = ''
        let dataStr = ''
        for (const l of lines) {
          if (l.startsWith('event:')) event = l.slice(6).trim()
          else if (l.startsWith('data:')) dataStr = l.slice(5).trim()
        }
        if (!dataStr) return
        try {
          const data = JSON.parse(dataStr)
          if (event === 'multiorg_scope') setMultiOrgScope(data as MultiOrgScope)
          else if (event === 'org_scope') setOrgScope(data as OrgScope)
          else if (event === 'status') setStatusMsg(data.message || '')
          else if (event === 'sql_preview') {
            setDevSql(data.sql || '')
            setDevCached(!!data.cached)
            if (data.prompt_tokens) setDevTokens({ prompt: data.prompt_tokens, output: data.output_tokens })
          }
          else if (event === 'query_meta') setDevDuration(data.duration_ms)
          else if (event === 'vector_results') setDevVectorResults(data.results || [])
          else if (event === 'result') {
            const cfg = data.chart_config
              ? (typeof data.chart_config === 'string' ? JSON.parse(data.chart_config) : data.chart_config)
              : null
            setResult({
              rows: data.rows,
              columns: data.columns || (data.rows.length > 0 ? Object.keys(data.rows[0]) : []),
              column_labels: data.column_labels || {},
              row_count: data.row_count,
              chart_config: cfg,
            })
            setStatusMsg('')
            setActiveChartIdx(0)
          }
          else if (event === 'error') setStatusMsg('錯誤：' + (data.error || data.message || '未知錯誤'))
        } catch {}
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const blocks = buf.split('\n\n')
        buf = blocks.pop() || ''
        blocks.forEach(parseBlock)
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setStatusMsg('查詢錯誤：' + (e.message || ''))
    } finally {
      setLoading(false)
      loadHistory()
    }
  }

  // userChartConfig 覆蓋 result.chart_config
  const effectiveChartConfig = (userChartConfig || result?.chart_config) as AiChartConfig | null
  const charts = effectiveChartConfig?.charts || []
  const activeChart: AiChartDef | undefined = charts[activeChartIdx]

  /** 載入命名查詢（帶 pinned_sql 直接執行，或開啟參數填寫 modal） */
  const loadSavedQuery = async (sq: AiSavedQuery) => {
    // 找對應 design
    const did = sq.design_id
    if (did) {
      for (const topic of topics) {
        const d = topic.designs?.find(d => d.id === did)
        if (d) { selectDesign(d); break }
      }
    }
    // 記錄目前載入的命名查詢 id（供 Tableau 自動存檔使用）
    setLoadedSqId(sq.id)
    // 恢復 chart config
    if (sq.chart_config) {
      const cfg = typeof sq.chart_config === 'string' ? JSON.parse(sq.chart_config) : sq.chart_config
      setUserChartConfig(cfg)
    }
    // 有參數 → 先開 modal
    let params: AiQueryParameter[] = []
    try { params = JSON.parse(sq.parameters_schema as any || '[]') || [] } catch { }
    if (params.length > 0) {
      setPendingQuery(sq)
    } else {
      // 直接執行
      setQuestion(sq.question || '')
      if (sq.pinned_sql && sq.auto_run) {
        // TODO: trigger query with pinned_sql directly (future enhancement)
      }
    }
    await api.patch(`/dashboard/saved-queries/${sq.id}/last-run`).catch(() => {})
  }

  if (showDesigner && (canDesignAiSelect || isAdmin)) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
          <button onClick={() => { setShowDesigner(false); loadTopics() }}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-800 text-sm transition">
            <ArrowLeft size={14} /> {t('aiDash.back')}
          </button>
          <BarChart3 size={16} className="text-orange-400" />
          <span className="text-sm font-medium text-gray-800">{t('aiDash.designInterface')}</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <DesignerPanel />
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-50 flex">
      {/* 左側欄 — 主題/任務 */}
      <div data-region="sidebar" className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-orange-400" />
            <span className="text-sm font-semibold text-gray-800">{t('aiDash.title')}</span>
          </div>
          <button onClick={() => navigate('/chat')}
            className="text-gray-400 hover:text-gray-700 text-xs transition">
            <ArrowLeft size={14} />
          </button>
        </div>

        {/* Tab 切換 */}
        <div className="flex border-b border-gray-200 flex-shrink-0">
          <button onClick={() => setSidebarTab('topics')}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition ${sidebarTab === 'topics' ? 'text-orange-600 border-b-2 border-orange-400 font-medium' : 'text-gray-400 hover:text-gray-700'}`}>
            <Layers size={11} /> {t('aiDash.tabQuery')}
          </button>
          <button onClick={() => setSidebarTab('saved')}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition ${sidebarTab === 'saved' ? 'text-orange-600 border-b-2 border-orange-400 font-medium' : 'text-gray-400 hover:text-gray-700'}`}>
            <BookMarked size={11} /> {t('aiDash.tabSaved')}
          </button>
          <button onClick={() => setSidebarTab('history')}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition ${sidebarTab === 'history' ? 'text-orange-600 border-b-2 border-orange-400 font-medium' : 'text-gray-400 hover:text-gray-700'}`}>
            <History size={11} /> {t('aiDash.tabHistory')}
          </button>
        </div>

        {/* 查詢主題 */}
        {sidebarTab === 'topics' && (
          <div className="flex-1 overflow-y-auto py-2">
            {topics.length === 0 && (
              <p className="text-gray-400 text-xs text-center py-8 px-4">
                {canDesignAiSelect || isAdmin ? t('aiDash.noTopicsAdmin') : t('aiDash.noTopicsUser')}
              </p>
            )}
            {topics.map(topic => (
              <div key={topic.id} className="mb-1">
                <button
                  onClick={() => toggleTopic(topic.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition text-xs font-medium"
                >
                  {expandedTopics.has(topic.id)
                    ? <ChevronDown size={12} className="flex-shrink-0" />
                    : <ChevronRight size={12} className="flex-shrink-0" />}
                  <Layers size={12} className="text-orange-400 flex-shrink-0" />
                  <span className="truncate">{localName(topic)}</span>
                </button>
                {expandedTopics.has(topic.id) && (
                  <div className="ml-4">
                    {(topic.designs || []).map(d => (
                      <button
                        key={d.id}
                        onClick={() => selectDesign(d)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition rounded-lg mx-1 mb-0.5 ${
                          selectedDesign?.id === d.id
                            ? 'bg-orange-50 text-orange-700 border border-orange-200'
                            : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <BarChart2 size={11} className="flex-shrink-0" />
                        <span className="truncate text-left">{localName(d)}</span>
                        {d.vector_search_enabled === 1 && (
                          <span className="ml-auto text-purple-400 text-[10px]">{t('aiDash.semanticBadge')}</span>
                        )}
                      </button>
                    ))}
                    {(topic.designs || []).length === 0 && (
                      <p className="text-gray-400 text-xs px-4 py-1">{t('aiDash.noDesigns')}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 我的查詢 */}
        {sidebarTab === 'saved' && (
          <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <span className="text-xs text-gray-400">{savedQueries.length} 個查詢</span>
              <button onClick={loadSavedQueries} className="text-gray-400 hover:text-blue-500">
                <RefreshCw size={11} />
              </button>
            </div>
            {savedLoading && <p className="text-xs text-gray-400 text-center py-4">載入中...</p>}
            {!savedLoading && savedQueries.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8 px-3">
                尚無儲存的查詢<br />
                <span className="text-gray-300">執行查詢後點上方💾按鈕儲存</span>
              </p>
            )}
            {/* 按 category 分組 */}
            {!savedLoading && (() => {
              const grouped = savedQueries.reduce<Record<string, AiSavedQuery[]>>((acc, q) => {
                const cat = q.category || '未分類'
                ;(acc[cat] = acc[cat] || []).push(q)
                return acc
              }, {})
              return Object.entries(grouped).map(([cat, qs]) => (
                <div key={cat} className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
                    {cat}
                  </div>
                  {qs.map(q => (
                    <div key={q.id} className="flex items-center gap-1 border-b border-gray-50 pr-1 hover:bg-orange-50 transition group">
                      <button
                        onClick={() => loadSavedQuery(q)}
                        className="flex-1 text-left px-3 py-2 min-w-0"
                      >
                        <p className="text-xs text-gray-700 truncate font-medium">{localName(q)}</p>
                        <p className="text-[10px] text-gray-400 truncate">{localName({ name: q.design_name || '', name_en: q.design_name_en, name_vi: q.design_name_vi }) || '—'}</p>
                      </button>
                      {/* 常駐操作 icons — 僅 can_manage 才顯示 */}
                      {!!q.can_manage && (
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            title="編輯"
                            onClick={e => { e.stopPropagation(); setEditingQuery(q); setShowSaveModal(true) }}
                            className="p-1 text-gray-300 hover:text-blue-500 rounded transition"
                          ><Pencil size={11} /></button>
                          <button
                            title="分享"
                            onClick={e => { e.stopPropagation(); setShareTarget({ type: 'query', id: q.id, name: q.name }) }}
                            className="p-1 text-gray-300 hover:text-blue-500 rounded transition"
                          ><Share2 size={11} /></button>
                          <button
                            title="刪除"
                            onClick={async e => {
                              e.stopPropagation()
                              if (confirm(`刪除「${q.name}」?`)) {
                                await api.delete(`/dashboard/saved-queries/${q.id}`)
                                loadSavedQueries()
                              }
                            }}
                            className="p-1 text-gray-300 hover:text-red-400 rounded transition"
                          ><Trash2 size={11} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
            })()}
          </div>
        )}

        {/* 查詢歷史 */}
        {sidebarTab === 'history' && (
          <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <span className="text-xs text-gray-400">{t('aiDash.historyCount', { count: history.length })}</span>
              {history.length > 0 && (
                <button onClick={clearHistory} className="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1">
                  <Trash2 size={10} /> {t('aiDash.clearAll')}
                </button>
              )}
            </div>
            {historyLoading && <p className="text-xs text-gray-400 text-center py-4">{t('aiDash.loading')}</p>}
            {!historyLoading && history.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">{t('aiDash.noHistory')}</p>
            )}
            <div className="flex-1 overflow-y-auto">
              {history.map(h => (
                <div key={h.id} className="border-b border-gray-100 group">
                  <div className="flex items-start gap-1 px-3 py-2 hover:bg-gray-50 transition">
                    {/* 文字區：點擊展開 SQL */}
                    <button
                      onClick={() => setExpandedHistory(expandedHistory === h.id ? null : h.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="text-xs text-gray-700 truncate">{h.question}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {h.topic_name && <span className="mr-1">{h.topic_name} /</span>}
                        {h.design_name}
                      </p>
                      <p className="text-[10px] text-gray-300">{fmtTW(h.created_at)}</p>
                    </button>
                    {/* 操作按鈕：hover 顯示 */}
                    <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition mt-0.5">
                      <button
                        title="引用到提問欄"
                        onClick={() => { setQuestion(h.question); setSidebarTab('topics') }}
                        className="text-gray-300 hover:text-blue-500 p-0.5"
                      >
                        <CornerUpLeft size={12} />
                      </button>
                      <button
                        title="刪除"
                        onClick={e => deleteHistory(h.id, e)}
                        className="text-gray-300 hover:text-red-400 p-0.5"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                  {expandedHistory === h.id && h.generated_sql && (
                    <div className="bg-gray-50 px-3 pb-2">
                      <p className="text-[10px] text-gray-400 mb-1 flex items-center justify-between">
                        <span>生成 SQL</span>
                        <span className="text-gray-300">{h.row_count} 筆</span>
                      </p>
                      <pre className="text-[10px] text-gray-600 bg-white border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
                        {h.generated_sql}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(canDesignAiSelect || isAdmin) && (
          <div className="p-3 border-t border-gray-200">
            <button
              onClick={() => setShowDesigner(true)}
              className="w-full flex items-center gap-2 text-gray-500 hover:text-orange-400 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs transition"
            >
              <Settings2 size={13} /> {t('aiDash.designerBtn')}
            </button>
          </div>
        )}
      </div>

      {/* 主要區域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 頂部：選中的設計 + 開發模式 toggle */}
        <div className="px-6 py-3 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
          <div>
            {selectedDesign ? (
              <div>
                <span className="text-sm font-medium text-gray-800">{localName(selectedDesign)}</span>
                {selectedDesign.description && (
                  <span className="ml-2 text-xs text-gray-400">{localDesc(selectedDesign)}</span>
                )}
              </div>
            ) : (
              <span className="text-sm text-gray-400">{t('aiDash.selectDesign')}</span>
            )}
          </div>
          {selectedDesign && (
            <div className="flex items-center gap-1.5">
              {/* 欄位選擇 */}
              <div className="relative">
                <button
                  onClick={() => setShowFieldPicker(v => !v)}
                  title="插入 Schema 欄位到游標位置"
                  className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition
                    ${showFieldPicker ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}
                >
                  <Columns size={12} /> {t('aiDash.fp.btnLabel')}
                </button>
                {showFieldPicker && selectedDesign && (
                  <SchemaFieldPicker
                    designId={selectedDesign.id!}
                    textareaRef={textareaRef}
                    onInsert={setQuestion}
                    onClose={() => setShowFieldPicker(false)}
                  />
                )}
              </div>

              {/* 圖表建構器 */}
              {result && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowChartBuilder(v => !v)}
                    title="經典圖表建構器"
                    className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition
                      ${showChartBuilder ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}
                  >
                    <BarChart3 size={12} /> 圖表
                  </button>
                  <button
                    onClick={() => setShowShelfBuilder(true)}
                    title="Tableau 拖拉模式"
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                  >
                    <Layers size={12} /> Tableau
                  </button>
                </div>
              )}

              {/* 儲存查詢 */}
              {result && (
                <button
                  onClick={() => { setEditingQuery(null); setPendingSaveChartConfig(null); setShowSaveModal(true) }}
                  title="儲存為命名查詢"
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                >
                  <Save size={12} /> 儲存
                </button>
              )}

              {/* 儀表板入口 */}
              <button
                onClick={() => navigate('/dashboard/boards')}
                title="儀表板"
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition"
              >
                <LayoutDashboard size={12} />
              </button>

              {/* 開發模式 */}
              <button
                onClick={() => setDevMode(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition ${devMode ? 'bg-gray-200 text-gray-800' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                <Code size={12} /> {t('aiDash.devMode')}
              </button>
            </div>
          )}
          {!selectedDesign && (
            <button
              onClick={() => setDevMode(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition ${devMode ? 'bg-gray-200 text-gray-800' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}
            >
              <Code size={12} /> {t('aiDash.devMode')}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 查詢輸入框 */}
          {selectedDesign && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex gap-3">
                <textarea
                  ref={textareaRef}
                  className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 resize-none outline-none min-h-[60px]"
                  placeholder={t('aiDash.queryPlaceholder')}
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuerySse() }
                  }}
                  disabled={loading || !!(multiOrgScope?.denied) || !!(orgScope as any)?.denied}
                />
                <button
                  onClick={() => handleQuerySse()}
                  disabled={!question.trim() || loading || !!(multiOrgScope?.denied) || !!(orgScope as any)?.denied}
                  className="self-end flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
                >
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {loading ? t('aiDash.querying') : t('aiDash.queryBtn')}
                </button>
              </div>
              {/* 範例問題 chip — few_shot（多語言）+ 使用者最近問過 + 空時 fallback */}
              {(() => {
                // 1) 解析 few_shot_examples
                const lang = i18n.language.startsWith('en') ? 'en' : i18n.language.startsWith('vi') ? 'vi' : 'zh'
                const parseFew = (): { q: string; sql?: string }[] => {
                  const raw = selectedDesign.few_shot_examples
                  if (!raw) return []
                  let arr: any = null
                  try {
                    arr = typeof raw === 'string' ? JSON.parse(raw) : raw
                    if (typeof arr === 'string') arr = JSON.parse(arr)
                  } catch { return [] }
                  if (!Array.isArray(arr)) return []
                  return arr.map((x: any) => {
                    if (!x) return null
                    const q = x[`q_${lang}`] || x.q_zh || x.q || x.q_en || x.q_vi
                    if (typeof q !== 'string' || !q.trim()) return null
                    return { q: q.trim(), sql: typeof x.sql === 'string' ? x.sql : undefined }
                  }).filter(Boolean) as { q: string; sql?: string }[]
                }
                const few = parseFew()

                // 2) 此任務最近問過（前 3 筆去重）
                const recent: string[] = []
                const seen = new Set<string>()
                for (const h of history) {
                  if (h.design_id !== selectedDesign.id) continue
                  const q = (h.question || '').trim()
                  if (!q || seen.has(q)) continue
                  seen.add(q); recent.push(q)
                  if (recent.length >= 3) break
                }

                // 3) fallback 通用提示（few 與 recent 都空時才顯示）
                const fallback = (few.length === 0 && recent.length === 0)
                  ? [t('aiDash.genericExample1'), t('aiDash.genericExample2'), t('aiDash.genericExample3')]
                  : []

                if (few.length === 0 && recent.length === 0 && fallback.length === 0) return null

                const chipBase = 'text-xs px-2.5 py-1 rounded-full border transition disabled:opacity-50 max-w-[320px] truncate'
                const fillQ = (q: string) => { setQuestion(q); textareaRef.current?.focus() }

                return (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    {few.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-gray-400 mr-1">💡 {t('aiDash.exampleQuestions')}</span>
                        {few.map((ex, i) => (
                          <button key={`f-${i}`} type="button"
                            onClick={() => fillQ(ex.q)}
                            disabled={loading}
                            title={devMode && ex.sql ? `${ex.q}\n\n${t('aiDash.exampleSqlHint')}:\n${ex.sql}` : ex.q}
                            className={`${chipBase} bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200`}>
                            {ex.q}
                          </button>
                        ))}
                      </div>
                    )}
                    {recent.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-gray-400 mr-1">🕘 {t('aiDash.recentQuestions')}</span>
                        {recent.map((q, i) => (
                          <button key={`r-${i}`} type="button"
                            onClick={() => fillQ(q)}
                            disabled={loading}
                            title={q}
                            className={`${chipBase} bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200`}>
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                    {fallback.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-gray-400 mr-1">💭 {t('aiDash.tryAsking')}</span>
                        {fallback.map((q, i) => (
                          <button key={`g-${i}`} type="button"
                            onClick={() => fillQ(q)}
                            disabled={loading}
                            title={q}
                            className={`${chipBase} bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200`}>
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
              {/* Model 選擇器 */}
              {models.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-400">{t('aiDash.modelLabel')}</span>
                  <select
                    value={selectedModelKey}
                    onChange={e => setSelectedModelKey(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white focus:outline-none focus:border-blue-400"
                  >
                    {models.map(m => (
                      <option key={m.key} value={m.key}>{m.name}{m.description ? ` — ${m.description}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* 向量進階設定（僅語意搜尋任務顯示） */}
              {selectedDesign.vector_search_enabled === 1 && (
                <div className="mt-2 border-t border-gray-100 pt-2">
                  <button onClick={() => setShowVectorAdv(p => !p)}
                    className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-1">
                    <Settings2 size={11} />
                    {t('aiDash.vectorParams')} {showVectorAdv ? '▲' : '▼'}
                  </button>
                  {showVectorAdv && (
                    <div className="flex items-center gap-4 mt-2">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Top K</label>
                        <input type="number" min={1} max={50} className="input py-1 text-xs w-20"
                          placeholder={String(selectedDesign.vector_top_k ?? 10)}
                          value={advTopK}
                          onChange={e => setAdvTopK(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">{t('aiDash.threshold')}</label>
                        <input type="number" min={0} max={2} step={0.05} className="input py-1 text-xs w-24"
                          placeholder={String(selectedDesign.vector_similarity_threshold ?? '0.50')}
                          value={advThreshold}
                          onChange={e => setAdvThreshold(e.target.value)} />
                      </div>
                      <p className="text-xs text-gray-400 self-end pb-1">{t('aiDash.thresholdHint')}</p>
                      {(advTopK || advThreshold) && (
                        <button onClick={() => { setAdvTopK(''); setAdvThreshold('') }}
                          className="text-xs text-gray-400 hover:text-red-400 self-end pb-1">{t('aiDash.reset')}</button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {statusMsg && (
                <p className="text-xs text-gray-400 mt-2 flex items-center gap-1.5">
                  {loading && <RefreshCw size={11} className="animate-spin" />}
                  {statusMsg}
                </p>
              )}
            </div>
          )}

          {/* ── Oracle MultiOrg denied / full_block 警告 ────────────────────── */}
          {multiOrgScope?.denied && (
            <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 flex items-start gap-2">
              <Shield size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700">
                  {(multiOrgScope as any).full_block ? '🚫 全面禁止 — 此帳號無權查詢此主題' : 'Oracle MultiOrg 資料權限未設定'}
                </p>
                <p className="text-xs text-red-600 mt-0.5">{multiOrgScope.denied_reason}</p>
              </div>
            </div>
          )}

          {/* ── Oracle MultiOrg 資料權限範圍 Persistent Panel ───────────────── */}
          {multiOrgScope?.has_restrictions && !multiOrgScope?.denied && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setMultiOrgExpanded(p => !p)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-blue-100 transition"
              >
                <Shield size={13} className="text-blue-500 flex-shrink-0" />
                <span className="text-xs font-medium text-blue-700 flex-1">
                  Oracle MultiOrg 資料權限範圍
                </span>
                <span className="text-xs text-blue-500">
                  可查詢 {multiOrgScope.org_count ?? 0} 個製造組織
                  &nbsp;{multiOrgExpanded ? '▲' : '▼'}
                </span>
              </button>

              {multiOrgExpanded && (
                <div className="px-4 pb-3 space-y-2.5 border-t border-blue-200">
                  {/* 帳套 */}
                  {(multiOrgScope.sob_details?.length ?? 0) > 0 && (
                    <div className="pt-2">
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-1.5">
                        帳套（Set of Books）
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {multiOrgScope.sob_details!.map(s => (
                          <span key={s.id} className="text-xs bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full">
                            {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 營運單位 */}
                  {(multiOrgScope.ou_details?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-1.5">
                        營運單位（Operating Unit）
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {multiOrgScope.ou_details!.map(o => (
                          <span key={o.id} className="text-xs bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full">
                            {o.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 製造組織 */}
                  {(multiOrgScope.org_details?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-1.5">
                        製造組織（Organization）— 共 {multiOrgScope.org_count} 個
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {multiOrgScope.org_details!.map(o => (
                          <span
                            key={o.id}
                            title={`${o.ou_name} / ${o.sob_name}`}
                            className="text-xs bg-white text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full cursor-default"
                          >
                            <span className="font-mono font-semibold">{o.code}</span>
                            {o.name !== o.code && <span className="ml-1 text-blue-600">{o.name}</span>}
                          </span>
                        ))}
                      </div>
                      <p className="text-[10px] text-blue-400 mt-1.5">
                        * 滑鼠移至組織卡片可查看所屬 OU / 帳套
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── 公司組織階層 denied / full_block 警告 ───────────────────────── */}
          {(orgScope as any)?.denied && (
            <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 flex items-start gap-2">
              <Shield size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700">
                  {(orgScope as any).full_block ? '🚫 全面禁止 — 此帳號無權查詢此主題' : '公司組織資料權限未設定'}
                </p>
                <p className="text-xs text-red-600 mt-0.5">{(orgScope as any).denied_reason}</p>
              </div>
            </div>
          )}

          {/* ── 公司組織階層資料權限範圍（Layer 3）────────────────────────────── */}
          {orgScope?.has_restrictions && !(orgScope as any)?.denied && (
            <div className="bg-green-50 border border-green-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setOrgScopeExpanded(p => !p)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-green-100 transition"
              >
                <Shield size={13} className="text-green-500 flex-shrink-0" />
                <span className="text-xs font-medium text-green-700 flex-1">
                  公司組織資料權限範圍
                </span>
                <span className="text-xs text-green-500">
                  {(orgScope.org_code_count ?? 0) > 0
                    ? `可查詢 ${orgScope.org_code_count} 個組織`
                    : `可查詢 ${orgScope.dept_count ?? 0} 個部門`}
                  &nbsp;{orgScopeExpanded ? '▲' : '▼'}
                </span>
              </button>
              {orgScopeExpanded && (
                <div className="px-4 pb-3 space-y-2.5 border-t border-green-200">
                  {/* 事業群 */}
                  {(orgScope.org_group_details?.length ?? 0) > 0 && (
                    <div className="pt-2">
                      <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1.5">事業群</p>
                      <div className="flex flex-wrap gap-1">
                        {orgScope.org_group_details!.map(g => (
                          <span key={g.name} className="text-xs bg-green-100 text-green-800 border border-green-200 px-2 py-0.5 rounded-full">{g.name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 事業處 */}
                  {(orgScope.org_section_details?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1.5">事業處</p>
                      <div className="flex flex-wrap gap-1">
                        {orgScope.org_section_details!.map(s => (
                          <span key={s.code} className="text-xs bg-green-100 text-green-800 border border-green-200 px-2 py-0.5 rounded-full">
                            <span className="font-mono font-semibold">{s.code}</span>
                            {s.name && s.name !== s.code && <span className="ml-1">{s.name}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 利潤中心 */}
                  {(orgScope.profit_center_details?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1.5">利潤中心</p>
                      <div className="flex flex-wrap gap-1">
                        {orgScope.profit_center_details!.map(p => (
                          <span key={p.code} className="text-xs bg-green-100 text-green-800 border border-green-200 px-2 py-0.5 rounded-full">
                            <span className="font-mono font-semibold">{p.code}</span>
                            {p.name && p.name !== p.code && <span className="ml-1">{p.name}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 組織代碼（ORG_CODE） */}
                  {(orgScope.org_code_details?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1.5">
                        組織代碼 — 共 {orgScope.org_code_count} 個
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {orgScope.org_code_details!.map(o => (
                          <span key={o.org_code} className="text-xs bg-teal-50 text-teal-800 border border-teal-200 px-2 py-0.5 rounded-full font-mono font-semibold">
                            {o.org_code}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 部門 */}
                  {(orgScope.dept_details?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1.5">
                        部門 — 共 {orgScope.dept_count} 個
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {orgScope.dept_details!.map(d => (
                          <span
                            key={d.dept_code}
                            title={`${d.profit_center_name ?? ''} / ${d.org_section_name ?? ''}`}
                            className="text-xs bg-white text-green-800 border border-green-200 px-2 py-0.5 rounded-full cursor-default"
                          >
                            <span className="font-mono font-semibold">{d.dept_code}</span>
                            {d.dept_name && <span className="ml-1 text-green-600">{d.dept_name}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ERP 權限驗證失敗提示 */}
          {multiOrgScope?.unavailable && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Shield size={13} className="text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-700">
                無法驗證 Oracle MultiOrg 資料權限（ERP 連線異常），查詢功能暫時限制。
              </span>
            </div>
          )}

          {/* 結果區域 */}
          {result && (
            <div className={showChartBuilder ? 'flex gap-4 items-start' : 'space-y-3'}>
            <div className={showChartBuilder ? 'flex-1 space-y-3' : undefined}>
              {/* View mode toggle */}
              <div className="flex items-center gap-2">
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  {charts.length > 0 && (
                    <button
                      onClick={() => setViewMode('chart')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition ${viewMode === 'chart' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                      <BarChart2 size={12} /> {t('aiDash.chartTab')}
                    </button>
                  )}
                  <button
                    onClick={() => setViewMode('table')}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                  >
                    <Table size={12} /> {t('aiDash.tableTab')}
                  </button>
                </div>

                {/* Chart type tabs */}
                {viewMode === 'chart' && charts.length > 1 && (
                  <div className="flex gap-1">
                    {charts.map((c, i) => (
                      <button key={i} onClick={() => setActiveChartIdx(i)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg transition ${activeChartIdx === i ? 'bg-orange-600/20 text-orange-400 border border-orange-700/40' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}>
                        {c.title || c.type}
                      </button>
                    ))}
                  </div>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => {
                      const cols = result.columns
                      const labels = result.column_labels || {}
                      const headers = cols.map(c => labels[c] || c)
                      const csvRows = [
                        headers.join(','),
                        ...result.rows.map(r => cols.map(c => {
                          const v = String((r as Record<string, unknown>)[c] ?? '')
                          return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
                        }).join(',')),
                      ]
                      const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a'); a.href = url
                      a.download = `${selectedDesign?.name || 'export'}_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 hover:bg-green-50 px-2 py-1 rounded transition"
                    title="匯出 CSV"
                  >
                    <Download size={12} /> CSV
                  </button>
                  <span className="text-xs text-gray-400">
                    {result.cached && <span className="text-teal-600 mr-2">{t('aiDash.cacheHit')}</span>}
                    {t('aiDash.rowCount', { count: result.row_count })}
                  </span>
                </div>
              </div>

              {/* Chart */}
              {viewMode === 'chart' && activeChart && (
                <div className="bg-white border border-gray-200 rounded-2xl p-4">
                  <AiChart chartDef={activeChart} rows={result.rows} columnLabels={result.column_labels} />
                </div>
              )}

              {/* Table */}
              {(viewMode === 'table' || !activeChart) && (
                <div className="bg-white border border-gray-200 rounded-2xl p-4">
                  <ResultTable rows={result.rows} columns={result.columns} column_labels={result.column_labels} />
                </div>
              )}
            </div>

            {/* ChartBuilder 側邊面板 */}
            {showChartBuilder && (
              <div className="flex-shrink-0" style={{ width: 360 }}>
                <ChartBuilder
                  rows={result.rows}
                  columns={result.columns}
                  columnLabels={result.column_labels}
                  initialConfig={effectiveChartConfig}
                  onSave={cfg => setUserChartConfig(cfg)}
                  onClose={() => setShowChartBuilder(false)}
                />
              </div>
            )}
          </div>
          )}

          {/* 開發模式 Panel */}
          {devMode && (devSql || devVectorResults.length > 0) && (
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Code size={12} /> {t('aiDash.devInfo')}
              </p>
              <div className="grid grid-cols-3 gap-3 text-xs text-gray-400">
                {devCached && <span className="text-teal-500">{t('aiDash.cacheHit')}</span>}
                {devTokens && <span>Prompt {devTokens.prompt} / Output {devTokens.output} tokens</span>}
                {devDuration !== null && <span>執行 {devDuration}ms</span>}
              </div>
              {devSql && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t('aiDash.generatedSql')}</p>
                  <pre className="bg-gray-900 text-green-400 text-xs p-3 rounded-lg overflow-x-auto font-mono whitespace-pre-wrap">{devSql}</pre>
                </div>
              )}
              {devVectorResults.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t('aiDash.vectorResults', { count: devVectorResults.length })}</p>
                  <div className="space-y-1">
                    {devVectorResults.slice(0, 5).map((r, i) => (
                      <div key={i} className="bg-gray-100 rounded-lg px-3 py-2 text-xs text-gray-500">
                        <span className="text-gray-400">[{r.source_table}]</span> {r.field_name}: {String(r.field_value).slice(0, 100)}
                        <span className="ml-2 text-gray-400">score: {r.score?.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 空白提示 */}
          {!selectedDesign && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <BarChart3 size={48} className="mb-4 opacity-30" />
              <p className="text-sm">{t('aiDash.selectDesign')}</p>
              {(canDesignAiSelect || isAdmin) && (
                <button onClick={() => setShowDesigner(true)}
                  className="mt-3 text-xs text-orange-400 hover:text-orange-300 transition">
                  {t('aiDash.goToDesigner')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* 儲存/編輯命名查詢 */}
      {showSaveModal && (
        <SavedQueryModal
          initial={editingQuery || undefined}
          designId={selectedDesign?.id}
          question={editingQuery ? undefined : question}
          pinnedSql={editingQuery ? undefined : devSql || undefined}
          detectedSql={editingQuery ? undefined : devSql || undefined}
          chartConfig={(() => {
            // 編輯模式：使用已儲存的 chart_config
            // 新增模式：只有從 Tableau 另存時才帶 pendingSaveChartConfig，一般儲存不帶圖表
            const existingCfg = editingQuery
              ? (() => {
                  try {
                    const raw = editingQuery.chart_config
                    if (!raw) return null
                    return typeof raw === 'string' ? JSON.parse(raw) : raw
                  } catch { return null }
                })()
              : null
            const cfg = editingQuery
              ? (existingCfg || userChartConfig || result?.chart_config)
              : pendingSaveChartConfig   // 新增：只帶 Tableau 另存的設定，或 null
            if (!cfg) return null
            // 帶入 available_columns（優先用本次 result columns，fallback 到已存的）
            const withCols = {
              ...cfg,
              available_columns: result?.columns?.map(c => ({
                key: c,
                label: result.column_labels?.[c] || c,
              })) || (cfg as any).available_columns || [],
            }
            return JSON.stringify(withCols)
          })()}
          onSave={saved => {
            loadSavedQueries()
            setSidebarTab('saved')
          }}
          onClose={() => { setShowSaveModal(false); setEditingQuery(null); setPendingSaveChartConfig(null) }}
        />
      )}

      {/* 執行命名查詢前填參數 */}
      {pendingQuery && (() => {
        let params: AiQueryParameter[] = []
        try { params = JSON.parse(pendingQuery.parameters_schema as any || '[]') || [] } catch { }
        return (
          <QueryParamsModal
            queryName={pendingQuery.name}
            params={params}
            onConfirm={values => {
              const prefix = buildParamPrefix(params, values)
              const baseQ = pendingQuery.question || ''
              setQuestion(prefix + baseQ)  // 填入 textarea，讓使用者確認/修改後再按查詢
              setPendingQuery(null)
            }}
            onClose={() => setPendingQuery(null)}
          />
        )
      })()}

      {/* 分享 Modal */}
      {shareTarget && (
        <ShareModal
          title={shareTarget.name}
          sharesUrl={`/dashboard/${shareTarget.type === 'query' ? 'saved-queries' : 'report-dashboards'}/${shareTarget.id}/shares`}
          onClose={() => setShareTarget(null)}
        />
      )}

      {/* Tableau 拖拉模式 — 全螢幕 overlay */}
      {showShelfBuilder && result && (
        <ShelfChartBuilder
          rows={result.rows}
          columns={result.columns}
          columnLabels={result.column_labels}
          initialConfig={effectiveChartConfig}
          loadedSqName={loadedSqId ? (savedQueries.find(q => q.id === loadedSqId)?.name ?? null) : null}
          onSave={async cfg => {
            setUserChartConfig(cfg)
            setShowShelfBuilder(false)
            if (loadedSqId) {
              try {
                await api.patch(`/dashboard/saved-queries/${loadedSqId}/chart-config`, { chart_config: cfg })
                loadSavedQueries()
              } catch (e) { console.error('auto-save chart config failed', e) }
            }
          }}
          onSaveAs={cfg => {
            setUserChartConfig(cfg)
            setShowShelfBuilder(false)
            setEditingQuery(null)         // 確保開新建模式
            setPendingSaveChartConfig(cfg) // 帶入 Tableau 設計好的圖表
            setShowSaveModal(true)
          }}
          onClose={() => setShowShelfBuilder(false)}
        />
      )}
    </div>
  )
}
