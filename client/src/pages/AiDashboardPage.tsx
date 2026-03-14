/**
 * AI 戰情主頁面 /dashboard
 *
 * 三欄佈局：
 *   左側欄  — 主題/任務樹狀選單 + 設計者管理入口
 *   主要區域 — 查詢介面 + ECharts 圖表 + 資料表
 *   底部     — 開發模式 panel（設計者專用）
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BarChart3, ChevronRight, ChevronDown, Send, RefreshCw,
  Table, BarChart2, Settings2, Code, ArrowLeft, Layers, History, Trash2, X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import AiChart from '../components/dashboard/AiChart'
import ResultTable from '../components/dashboard/ResultTable'
import DesignerPanel from '../components/dashboard/DesignerPanel'
import type { AiSelectTopic, AiSelectDesign, AiQueryResult, AiChartConfig, AiChartDef, AiDashboardHistory } from '../types'

type ViewMode = 'chart' | 'table'

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
  const [showDesigner, setShowDesigner] = useState(false)

  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [result, setResult] = useState<AiQueryResult | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('chart')
  const [activeChartIdx, setActiveChartIdx] = useState(0)

  // 歷史記錄
  const [sidebarTab, setSidebarTab] = useState<'topics' | 'history'>('topics')
  const [history, setHistory] = useState<AiDashboardHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null)

  useEffect(() => { if (sidebarTab === 'history') loadHistory() }, [sidebarTab])

  const loadHistory = async () => {
    setHistoryLoading(true)
    try { setHistory((await api.get('/dashboard/history?limit=100')).data) } catch { } finally { setHistoryLoading(false) }
  }
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
    if ('message' in data && !('rows' in data)) {
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
  const handleQuerySse = async () => {
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
          if (event === 'status') setStatusMsg(data.message || '')
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
          else if (event === 'error') setStatusMsg('錯誤：' + data.message)
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

  const chartConfig = result?.chart_config as AiChartConfig | null
  const charts = chartConfig?.charts || []
  const activeChart: AiChartDef | undefined = charts[activeChartIdx]

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
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
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
                <div key={h.id} className="border-b border-gray-100">
                  <button
                    onClick={() => setExpandedHistory(expandedHistory === h.id ? null : h.id)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 transition group"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 truncate">{h.question}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {h.topic_name && <span className="mr-1">{h.topic_name} /</span>}
                          {h.design_name}
                        </p>
                        <p className="text-[10px] text-gray-300">{h.created_at}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={e => deleteHistory(h.id, e)} className="text-gray-300 hover:text-red-400 p-0.5">
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  </button>
                  {expandedHistory === h.id && (
                    <div className="bg-gray-50 px-3 py-2 space-y-2">
                      {h.generated_sql && (
                        <div>
                          <p className="text-[10px] text-gray-400 mb-1 flex items-center justify-between">
                            <span>生成 SQL</span>
                            <span className="text-gray-300">{h.row_count} 筆</span>
                          </p>
                          <pre className="text-[10px] text-gray-600 bg-white border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
                            {h.generated_sql}
                          </pre>
                        </div>
                      )}
                      <button
                        onClick={() => { setQuestion(h.question); setSidebarTab('topics') }}
                        className="text-xs text-blue-500 hover:text-blue-700"
                      >
                        {t('aiDash.requery')}
                      </button>
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
          {(canDesignAiSelect || isAdmin) && selectedDesign && (
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
                  className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 resize-none outline-none min-h-[60px]"
                  placeholder={t('aiDash.queryPlaceholder')}
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuerySse() }
                  }}
                  disabled={loading}
                />
                <button
                  onClick={handleQuerySse}
                  disabled={!question.trim() || loading}
                  className="self-end flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
                >
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {loading ? t('aiDash.querying') : t('aiDash.queryBtn')}
                </button>
              </div>
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

          {/* 結果區域 */}
          {result && (
            <div className="space-y-3">
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

                <span className="ml-auto text-xs text-gray-400">
                  {result.cached && <span className="text-teal-600 mr-2">{t('aiDash.cacheHit')}</span>}
                  {t('aiDash.rowCount', { count: result.row_count })}
                </span>
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
          )}

          {/* 開發模式 Panel */}
          {devMode && (canDesignAiSelect || isAdmin) && (devSql || devVectorResults.length > 0) && (
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
    </div>
  )
}
