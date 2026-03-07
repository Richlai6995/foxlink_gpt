/**
 * AI 戰情主頁面 /dashboard
 *
 * 三欄佈局：
 *   左側欄  — 主題/任務樹狀選單 + 設計者管理入口
 *   主要區域 — 查詢介面 + ECharts 圖表 + 資料表
 *   底部     — 開發模式 panel（設計者專用）
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3, ChevronRight, ChevronDown, Send, RefreshCw,
  Table, BarChart2, Settings2, Code, ArrowLeft, Layers
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import AiChart from '../components/dashboard/AiChart'
import ResultTable from '../components/dashboard/ResultTable'
import DesignerPanel from '../components/dashboard/DesignerPanel'
import type { AiSelectTopic, AiSelectDesign, AiQueryResult, AiChartConfig, AiChartDef } from '../types'

type ViewMode = 'chart' | 'table'

export default function AiDashboardPage() {
  const { isAdmin, canUseDashboard, canDesignAiSelect } = useAuth()
  const navigate = useNavigate()

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
    api.get('/dashboard/topics').then(r => {
      setTopics(r.data)
      // auto-expand first topic
      if (r.data.length > 0) setExpandedTopics(new Set([r.data[0].id]))
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
        body: JSON.stringify({ design_id: selectedDesign.id, question: question.trim() }),
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
        body: JSON.stringify({ design_id: selectedDesign.id, question: question.trim() }),
        signal: ctrl.signal,
      })

      if (!resp.ok || !resp.body) throw new Error(`請求失敗 ${resp.status}`)

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
    }
  }

  const chartConfig = result?.chart_config as AiChartConfig | null
  const charts = chartConfig?.charts || []
  const activeChart: AiChartDef | undefined = charts[activeChartIdx]

  if (showDesigner && (canDesignAiSelect || isAdmin)) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900 flex-shrink-0">
          <button onClick={() => { setShowDesigner(false); loadTopics() }}
            className="flex items-center gap-1 text-slate-400 hover:text-slate-200 text-sm transition">
            <ArrowLeft size={14} /> 返回
          </button>
          <BarChart3 size={16} className="text-orange-400" />
          <span className="text-sm font-medium text-slate-200">AI 戰情設計介面</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <DesignerPanel />
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-slate-950 flex">
      {/* 左側欄 — 主題/任務 */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-orange-400" />
            <span className="text-sm font-semibold text-slate-200">AI 戰情</span>
          </div>
          <button onClick={() => navigate('/chat')}
            className="text-slate-500 hover:text-slate-300 text-xs transition">
            <ArrowLeft size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {topics.length === 0 && (
            <p className="text-slate-600 text-xs text-center py-8 px-4">
              {canDesignAiSelect || isAdmin ? '尚未建立查詢主題，請進入設計介面' : '尚無可用的查詢設計'}
            </p>
          )}
          {topics.map(t => (
            <div key={t.id} className="mb-1">
              <button
                onClick={() => toggleTopic(t.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition text-xs font-medium"
              >
                {expandedTopics.has(t.id)
                  ? <ChevronDown size={12} className="flex-shrink-0" />
                  : <ChevronRight size={12} className="flex-shrink-0" />}
                <Layers size={12} className="text-orange-400 flex-shrink-0" />
                <span className="truncate">{t.name}</span>
              </button>
              {expandedTopics.has(t.id) && (
                <div className="ml-4">
                  {(t.designs || []).map(d => (
                    <button
                      key={d.id}
                      onClick={() => selectDesign(d)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition rounded-lg mx-1 mb-0.5 ${
                        selectedDesign?.id === d.id
                          ? 'bg-orange-600/20 text-orange-300 border border-orange-700/50'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <BarChart2 size={11} className="flex-shrink-0" />
                      <span className="truncate text-left">{d.name}</span>
                      {d.vector_search_enabled === 1 && (
                        <span className="ml-auto text-purple-400 text-[10px]">語意</span>
                      )}
                    </button>
                  ))}
                  {(t.designs || []).length === 0 && (
                    <p className="text-slate-700 text-xs px-4 py-1">無任務</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {(canDesignAiSelect || isAdmin) && (
          <div className="p-3 border-t border-slate-800">
            <button
              onClick={() => setShowDesigner(true)}
              className="w-full flex items-center gap-2 text-slate-400 hover:text-orange-400 hover:bg-slate-800 px-3 py-2 rounded-lg text-xs transition"
            >
              <Settings2 size={13} /> 設計介面
            </button>
          </div>
        )}
      </div>

      {/* 主要區域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 頂部：選中的設計 + 開發模式 toggle */}
        <div className="px-6 py-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between flex-shrink-0">
          <div>
            {selectedDesign ? (
              <div>
                <span className="text-sm font-medium text-slate-200">{selectedDesign.name}</span>
                {selectedDesign.description && (
                  <span className="ml-2 text-xs text-slate-500">{selectedDesign.description}</span>
                )}
              </div>
            ) : (
              <span className="text-sm text-slate-500">請從左側選擇查詢設計</span>
            )}
          </div>
          {(canDesignAiSelect || isAdmin) && selectedDesign && (
            <button
              onClick={() => setDevMode(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition ${devMode ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
            >
              <Code size={12} /> 開發模式
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 查詢輸入框 */}
          {selectedDesign && (
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
              <div className="flex gap-3">
                <textarea
                  className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 resize-none outline-none min-h-[60px]"
                  placeholder={`用自然語言描述您想查詢的內容...`}
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
                  {loading ? '查詢中' : '查詢'}
                </button>
              </div>
              {statusMsg && (
                <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
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
                <div className="flex bg-slate-800 rounded-lg p-0.5">
                  {charts.length > 0 && (
                    <button
                      onClick={() => setViewMode('chart')}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition ${viewMode === 'chart' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      <BarChart2 size={12} /> 圖表
                    </button>
                  )}
                  <button
                    onClick={() => setViewMode('table')}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition ${viewMode === 'table' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <Table size={12} /> 資料表
                  </button>
                </div>

                {/* Chart type tabs */}
                {viewMode === 'chart' && charts.length > 1 && (
                  <div className="flex gap-1">
                    {charts.map((c, i) => (
                      <button key={i} onClick={() => setActiveChartIdx(i)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg transition ${activeChartIdx === i ? 'bg-orange-600/20 text-orange-400 border border-orange-700/40' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
                        {c.title || c.type}
                      </button>
                    ))}
                  </div>
                )}

                <span className="ml-auto text-xs text-slate-600">
                  {result.cached && <span className="text-teal-600 mr-2">快取命中</span>}
                  {result.row_count} 筆
                </span>
              </div>

              {/* Chart */}
              {viewMode === 'chart' && activeChart && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                  <AiChart chartDef={activeChart} rows={result.rows} />
                </div>
              )}

              {/* Table */}
              {(viewMode === 'table' || !activeChart) && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                  <ResultTable rows={result.rows} columns={result.columns} />
                </div>
              )}
            </div>
          )}

          {/* 開發模式 Panel */}
          {devMode && (canDesignAiSelect || isAdmin) && (devSql || devVectorResults.length > 0) && (
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <Code size={12} /> 開發者資訊
              </p>
              <div className="grid grid-cols-3 gap-3 text-xs text-slate-500">
                {devCached && <span className="text-teal-500">快取命中</span>}
                {devTokens && <span>Prompt {devTokens.prompt} / Output {devTokens.output} tokens</span>}
                {devDuration !== null && <span>執行 {devDuration}ms</span>}
              </div>
              {devSql && (
                <div>
                  <p className="text-xs text-slate-600 mb-1">生成 SQL</p>
                  <pre className="bg-slate-800 text-green-400 text-xs p-3 rounded-lg overflow-x-auto font-mono whitespace-pre-wrap">{devSql}</pre>
                </div>
              )}
              {devVectorResults.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 mb-1">語意搜尋結果（top {devVectorResults.length}）</p>
                  <div className="space-y-1">
                    {devVectorResults.slice(0, 5).map((r, i) => (
                      <div key={i} className="bg-slate-800 rounded-lg px-3 py-2 text-xs text-slate-400">
                        <span className="text-slate-500">[{r.source_table}]</span> {r.field_name}: {String(r.field_value).slice(0, 100)}
                        <span className="ml-2 text-slate-600">score: {r.score?.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 空白提示 */}
          {!selectedDesign && (
            <div className="flex flex-col items-center justify-center h-64 text-slate-600">
              <BarChart3 size={48} className="mb-4 opacity-30" />
              <p className="text-sm">請從左側選擇一個查詢設計</p>
              {(canDesignAiSelect || isAdmin) && (
                <button onClick={() => setShowDesigner(true)}
                  className="mt-3 text-xs text-orange-400 hover:text-orange-300 transition">
                  或前往設計介面建立新查詢
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
