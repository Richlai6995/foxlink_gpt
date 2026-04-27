/**
 * PmBriefingPage — 採購每日資料一站式頁面
 *
 * Layout:
 *   ┌── Top bar(返回 + 我的偏好 + 匯出 CSV)
 *   ├── 報價 Banner(sticky,sticky 不在 layer 而是 page 頂部)
 *   ├── 今日 AI 綜述(daily report 摘要 + 展開全文)
 *   └── Tabs: [新聞 (預設)] [週報] [月報] [Prompt 審核]
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Settings, Download, ChevronDown, ChevronUp, Loader2, RefreshCw,
  X, Filter, Pin, ExternalLink, Calendar, Search, FileText, BarChart3, Newspaper,
  Sparkles, AlertCircle, Bookmark,
} from 'lucide-react'
import api from '../lib/api'
import PmReviewQueueView from '../components/pm/PmReviewQueueView'
import PmFeedbackThumbs from '../components/pm/PmFeedbackThumbs'

// ── Constants ──────────────────────────────────────────────────────────────
const ALL_METALS = [
  { code: 'Au', name: '金',   group: '貴金屬' },
  { code: 'Ag', name: '銀',   group: '貴金屬' },
  { code: 'Pt', name: '鉑',   group: '貴金屬' },
  { code: 'Pd', name: '鈀',   group: '貴金屬' },
  { code: 'CU', name: '銅',   group: '基本金屬' },
  { code: 'AL', name: '鋁',   group: '基本金屬' },
  { code: 'NI', name: '鎳',   group: '基本金屬' },
  { code: 'ZN', name: '鋅',   group: '基本金屬' },
  { code: 'PB', name: '鉛',   group: '基本金屬' },
  { code: 'SN', name: '錫',   group: '基本金屬' },
  { code: 'RH', name: '銠',   group: '貴金屬' },
]

type Tab = 'news' | 'weekly' | 'monthly' | 'review'

interface Prefs {
  focused_metals: string[]
  default_24h_only: number
}

export default function PmBriefingPage() {
  const navigate = useNavigate()
  const [denied, setDenied] = useState(false)
  const [loadingInit, setLoadingInit] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>({ focused_metals: [], default_24h_only: 1 })
  const [tab, setTab] = useState<Tab>('news')
  const [showPrefs, setShowPrefs] = useState(false)
  const [reviewPendingCount, setReviewPendingCount] = useState(0)
  const [bannerExpanded, setBannerExpanded] = useState(false)

  useEffect(() => {
    api.get('/pm/briefing/preferences').then(r => {
      setPrefs(r.data || { focused_metals: [], default_24h_only: 1 })
    }).catch(err => {
      if (err?.response?.status === 403) setDenied(true)
    }).finally(() => setLoadingInit(false))
  }, [])

  const focusedSet = useMemo(() => new Set((prefs.focused_metals || [])), [prefs])
  const hasFocus = focusedSet.size > 0

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 text-slate-500 gap-3">
        <AlertCircle size={48} className="text-amber-400" />
        <div className="text-lg font-medium">需要貴金屬平台閱讀權限</div>
        <div className="text-sm">請洽 admin 在「特殊說明書管理」加你進貴金屬書的分享名單</div>
        <button onClick={() => navigate('/chat')} className="mt-3 px-4 py-2 text-sm rounded bg-slate-800 text-white hover:bg-slate-900">回到對話</button>
      </div>
    )
  }

  if (loadingInit) {
    return <div className="flex items-center justify-center h-screen text-slate-400"><Loader2 className="animate-spin" /> 載入中…</div>
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b px-6 py-3 flex items-center gap-4 shadow-sm">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-800 text-sm flex items-center gap-1">
          <ArrowLeft size={16} /> 返回
        </button>
        <Sparkles size={18} className="text-amber-500" />
        <h1 className="text-lg font-bold text-slate-800">貴金屬情報</h1>
        <span className="text-xs text-slate-400">採購每日一站式資料 — 報價 / 新聞 / AI 報告 / Prompt 審核</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowPrefs(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-slate-200 hover:bg-slate-50 text-slate-700"
          ><Settings size={14} /> 我的偏好</button>
          <button
            onClick={() => downloadPricesCSV(prefs.focused_metals)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
            title="匯出當前關注金屬 30 天價格"
          ><Download size={14} /> 匯出 CSV</button>
        </div>
      </header>

      {/* Sticky 報價 banner */}
      <PriceBanner focusedSet={focusedSet} expanded={bannerExpanded} onToggleExpand={() => setBannerExpanded(v => !v)} />

      {/* AI 綜述 */}
      <DailyInsight />

      {/* Tabs */}
      <div className="bg-white border-b border-t flex items-center gap-1 px-4">
        {([
          { id: 'news',    label: '新聞列表', icon: <Newspaper size={14} /> },
          { id: 'weekly',  label: '週報',     icon: <BarChart3 size={14} /> },
          { id: 'monthly', label: '月報',     icon: <FileText size={14} /> },
          { id: 'review',  label: 'Prompt 審核', icon: <Sparkles size={14} />, badge: reviewPendingCount },
        ] as { id: Tab; label: string; icon: React.ReactNode; badge?: number }[]).map(s => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm transition border-b-2 ${
              tab === s.id ? 'text-blue-600 border-blue-600 font-medium' : 'text-slate-500 border-transparent hover:text-slate-800'
            }`}
          >
            {s.icon}{s.label}
            {s.badge != null && s.badge > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px]">{s.badge}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'news'    && <NewsTab focusedSet={focusedSet} default24h={prefs.default_24h_only === 1} />}
        {tab === 'weekly'  && <ReportsTab type="weekly" />}
        {tab === 'monthly' && <ReportsTab type="monthly" />}
        {tab === 'review'  && <PmReviewQueueView embedded onPendingCountChange={setReviewPendingCount} />}
      </div>

      {showPrefs && <PrefsModal prefs={prefs} onClose={() => setShowPrefs(false)} onSaved={(p) => { setPrefs(p); setShowPrefs(false) }} />}
    </div>
  )
}

async function downloadPricesCSV(focusedMetals: string[]) {
  const today = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const params: Record<string, string> = { from, to: today }
  if (focusedMetals.length > 0) params.metals = focusedMetals.join(',')
  const url = '/pm/briefing/prices/export.csv?' + new URLSearchParams(params).toString()
  const resp = await api.get(url, { responseType: 'blob' })
  const blob = new Blob([resp.data], { type: 'text/csv;charset=utf-8' })
  const dl = document.createElement('a')
  dl.href = URL.createObjectURL(blob)
  dl.download = `PM_價格_${from}_${today}.csv`
  dl.click()
  URL.revokeObjectURL(dl.href)
}

// ── Price Banner ───────────────────────────────────────────────────────────
function PriceBanner({ focusedSet, expanded, onToggleExpand }: { focusedSet: Set<string>; expanded: boolean; onToggleExpand: () => void }) {
  const [prices, setPrices] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [asOfDate, setAsOfDate] = useState<string>('')

  useEffect(() => {
    setLoading(true)
    api.get('/pm/briefing/prices').then(r => {
      const list = r.data || []
      setPrices(list)
      const dates = list.map((p: any) => p.as_of_date).filter(Boolean).sort()
      setAsOfDate(dates[dates.length - 1] ? String(dates[dates.length - 1]).slice(0, 10) : '')
    }).finally(() => setLoading(false))
  }, [])

  const visible = expanded || focusedSet.size === 0 ? prices : prices.filter(p => focusedSet.has(p.metal_code || p.METAL_CODE))
  const hidden = prices.length - visible.length

  if (loading) {
    return <div className="bg-white border-b px-6 py-3 text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 報價載入中…</div>
  }
  if (prices.length === 0) {
    return <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-sm text-amber-700">⚠️ 尚無報價資料(可能新環境或排程未跑)</div>
  }

  return (
    <div className="bg-white border-b px-6 py-2 flex items-center gap-3 overflow-x-auto">
      <span className="text-xs text-slate-400 flex-shrink-0">📅 {asOfDate}</span>
      {visible.map(p => {
        const code = p.metal_code || p.METAL_CODE
        const price = Number(p.price_usd ?? p.PRICE_USD)
        const chg = Number(p.day_change_pct ?? p.DAY_CHANGE_PCT)
        const isUp = chg > 0
        return (
          <div key={code} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-slate-50 flex-shrink-0">
            <span className="font-bold text-slate-800 text-sm">{code}</span>
            <span className="text-slate-700 font-mono text-sm">{Number.isFinite(price) ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</span>
            {Number.isFinite(chg) && (
              <span className={`text-xs font-medium ${isUp ? 'text-emerald-600' : chg < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                {isUp ? '+' : ''}{chg.toFixed(2)}%
              </span>
            )}
          </div>
        )
      })}
      {hidden > 0 && (
        <button onClick={onToggleExpand} className="ml-auto text-xs text-blue-600 hover:underline flex-shrink-0">
          {expanded ? '收合' : `展開全部 (+${hidden})`}
        </button>
      )}
      {hidden === 0 && focusedSet.size > 0 && expanded && (
        <button onClick={onToggleExpand} className="ml-auto text-xs text-slate-500 hover:underline flex-shrink-0">收合</button>
      )}
    </div>
  )
}

// ── 今日 AI 綜述 ───────────────────────────────────────────────────────────
function DailyInsight() {
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [todayMissing, setTodayMissing] = useState(false)

  useEffect(() => {
    api.get('/pm/briefing/reports', { params: { type: 'daily', limit: 1, offset: 0 } })
      .then(r => {
        const row = (r.data?.rows || [])[0]
        setReport(row || null)
        if (row) {
          const today = new Date().toISOString().slice(0, 10)
          if (String(row.as_of_date).slice(0, 10) < today) setTodayMissing(true)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="bg-blue-50 border-b border-blue-100 px-6 py-3 text-sm text-slate-500"><Loader2 size={14} className="animate-spin inline mr-2" /> 載入今日 AI 綜述…</div>
  }
  if (!report) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-sm text-amber-800">
        ℹ️ 今日報告 09:30 才生成,目前無資料可顯示
      </div>
    )
  }

  const content = String(report.content || '')
  const summary = content.length > 250 ? content.slice(0, 250) + '...' : content

  return (
    <div className="bg-blue-50 border-b border-blue-100 px-6 py-3 text-sm">
      {todayMissing && (
        <div className="text-amber-700 text-xs mb-2 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
          ⏳ 今日報告 09:30 才生成 — 以下為 {report.as_of_date} 報告
        </div>
      )}
      <div className="flex items-start gap-2">
        <Sparkles size={14} className="text-blue-500 mt-1 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-slate-800 mb-1">{report.title || `${report.as_of_date} 日報`}</div>
          {expanded ? (
            <div className="text-slate-700 whitespace-pre-wrap text-xs leading-relaxed">{content}</div>
          ) : (
            <div className="text-slate-700 text-xs leading-relaxed">{summary}</div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => setExpanded(v => !v)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              {expanded ? <>收合 <ChevronUp size={12} /></> : <>看完整日報 <ChevronDown size={12} /></>}
            </button>
            <PmFeedbackThumbs targetType="report" targetRef={`daily-${report.as_of_date}`} compact />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 新聞 Tab ────────────────────────────────────────────────────────────────
interface NewsItem {
  id: number
  url: string
  title: string
  source: string | null
  language: string | null
  published_at: string | null
  scraped_at: string
  summary: string | null
  sentiment_score: number | null
  sentiment_label: string | null
  related_metals: string | null
  topics: string | null
  is_pinned: number | null
}

function NewsTab({ focusedSet, default24h }: { focusedSet: Set<string>; default24h: boolean }) {
  // 從 localStorage 讀 sticky filter
  const stickyKey = 'pm_news_filters_v1'
  const sticky = (() => { try { return JSON.parse(localStorage.getItem(stickyKey) || '{}') } catch { return {} } })()

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  const [from, setFrom] = useState(sticky.from || (default24h ? yesterday : ''))
  const [to, setTo] = useState(sticky.to || '')
  const [metals, setMetals] = useState<string[]>(sticky.metals || (focusedSet.size > 0 ? Array.from(focusedSet) : []))
  const [sources, setSources] = useState<string[]>(sticky.sources || [])
  const [sentiment, setSentiment] = useState(sticky.sentiment || '')
  const [q, setQ] = useState(sticky.q || '')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [size] = useState(50)
  const [rows, setRows] = useState<NewsItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sourcesLov, setSourcesLov] = useState<{ source: string; cnt: number }[]>([])
  const [exporting, setExporting] = useState(false)

  const filters = useMemo(() => ({
    metal: metals.join(',') || undefined,
    source: sources.join(',') || undefined,
    sentiment: sentiment || undefined,
    from: from || undefined,
    to: to || undefined,
    q: q.trim() || undefined,
    pinned_only: pinnedOnly ? 1 : undefined,
  }), [metals, sources, sentiment, from, to, q, pinnedOnly])

  // sticky filter 寫回 localStorage(每次 filters 變動)
  useEffect(() => {
    localStorage.setItem(stickyKey, JSON.stringify({
      from, to, metals, sources, sentiment, q,
    }))
  }, [from, to, metals, sources, sentiment, q])

  useEffect(() => {
    setLoading(true)
    api.get('/pm/briefing/news', { params: { ...filters, page, size } })
      .then(r => {
        setRows(r.data?.rows || [])
        setTotal(r.data?.total || 0)
      }).finally(() => setLoading(false))
  }, [JSON.stringify(filters), page])

  useEffect(() => {
    api.get('/pm/briefing/news/sources').then(r => setSourcesLov(r.data || [])).catch(() => {})
  }, [])

  const togglePin = async (item: NewsItem) => {
    if (item.is_pinned) await api.delete(`/pm/briefing/news/${item.id}/pin`)
    else                await api.post(`/pm/briefing/news/${item.id}/pin`, {})
    setRows(rows.map(r => r.id === item.id ? { ...r, is_pinned: r.is_pinned ? 0 : 1 } : r))
  }

  const setMetalSel = (code: string) => {
    setMetals(metals.includes(code) ? metals.filter(m => m !== code) : [...metals, code])
    setPage(1)
  }
  const setSourceSel = (s: string) => {
    setSources(sources.includes(s) ? sources.filter(x => x !== s) : [...sources, s])
    setPage(1)
  }

  const exportPdf = async () => {
    if (total > 500) {
      alert(`篩選結果 ${total} 筆 > 500 上限,請縮小日期或加 filter`)
      return
    }
    setExporting(true)
    try {
      const url = '/pm/briefing/news/export.pdf?' + new URLSearchParams(
        Object.entries(filters).filter(([_, v]) => v != null).reduce((acc: any, [k, v]) => { acc[k] = String(v); return acc }, {})
      ).toString()
      const resp = await api.get(url, { responseType: 'blob' })
      const blob = new Blob([resp.data], { type: 'application/pdf' })
      const dl = document.createElement('a')
      dl.href = URL.createObjectURL(blob)
      dl.download = `PM_新聞_${from || 'all'}_${to || 'all'}.pdf`
      dl.click()
      URL.revokeObjectURL(dl.href)
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setExporting(false) }
  }

  const totalPages = Math.max(1, Math.ceil(total / size))

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左側 篩選器 */}
      <aside className="w-72 bg-white border-r overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-1 text-sm font-medium text-slate-700">
          <Filter size={14} /> 篩選器
        </div>

        {/* 釘選 toggle */}
        <button
          onClick={() => { setPinnedOnly(v => !v); setPage(1) }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded transition ${
            pinnedOnly ? 'bg-amber-100 text-amber-700' : 'text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Bookmark size={12} fill={pinnedOnly ? 'currentColor' : 'none'} />
          {pinnedOnly ? '只看釘選' : '只看我釘選的'}
        </button>

        {/* 日期 */}
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1"><Calendar size={11} /> 日期範圍</div>
          <div className="flex gap-1">
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} className="border rounded px-2 py-1 text-xs flex-1" />
            <span className="text-slate-400 self-center">~</span>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }} className="border rounded px-2 py-1 text-xs flex-1" />
          </div>
          <div className="flex gap-1 mt-1 text-[10px]">
            <button onClick={() => { setFrom(today); setTo(today); setPage(1) }} className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200">今日</button>
            <button onClick={() => { setFrom(yesterday); setTo(''); setPage(1) }} className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200">24h</button>
            <button onClick={() => { setFrom(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)); setTo(''); setPage(1) }} className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200">7d</button>
            <button onClick={() => { setFrom(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)); setTo(''); setPage(1) }} className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200">30d</button>
            <button onClick={() => { setFrom(''); setTo(''); setPage(1) }} className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200">清除</button>
          </div>
        </div>

        {/* 金屬 */}
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">🪙 金屬</div>
          <div className="grid grid-cols-3 gap-1">
            {ALL_METALS.map(m => (
              <label key={m.code} className={`flex items-center gap-1 px-1.5 py-1 text-xs rounded cursor-pointer ${
                metals.includes(m.code) ? 'bg-blue-100 text-blue-700' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}>
                <input type="checkbox" checked={metals.includes(m.code)} onChange={() => setMetalSel(m.code)} className="hidden" />
                {m.code}
              </label>
            ))}
          </div>
        </div>

        {/* 情緒 */}
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">😀 情緒</div>
          <select value={sentiment} onChange={e => { setSentiment(e.target.value); setPage(1) }} className="w-full border rounded px-2 py-1 text-xs">
            <option value="">全部</option>
            <option value="positive">正面</option>
            <option value="neutral">中性</option>
            <option value="negative">負面</option>
          </select>
        </div>

        {/* 來源 */}
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">🌐 來源網站</div>
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {sourcesLov.map(s => (
              <label key={s.source} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 px-1 py-0.5 rounded">
                <input type="checkbox" checked={sources.includes(s.source)} onChange={() => setSourceSel(s.source)} />
                <span className="flex-1 truncate">{s.source}</span>
                <span className="text-slate-400">{s.cnt}</span>
              </label>
            ))}
            {sourcesLov.length === 0 && <div className="text-slate-400 text-xs">無來源</div>}
          </div>
        </div>

        {/* 全文搜尋 */}
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1"><Search size={11} /> 關鍵字</div>
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1) }}
            placeholder="搜尋標題 / 摘要"
            className="w-full border rounded px-2 py-1 text-xs"
          />
        </div>

        {(metals.length > 0 || sources.length > 0 || sentiment || from || to || q) && (
          <button
            onClick={() => { setMetals([]); setSources([]); setSentiment(''); setFrom(''); setTo(''); setQ(''); setPage(1) }}
            className="w-full text-xs text-red-600 hover:underline"
          >🗑️ 清除全部篩選</button>
        )}
      </aside>

      {/* 右側 列表 */}
      <main className="flex-1 overflow-y-auto bg-slate-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-slate-500">共 {total} 筆 · 第 {page} / {totalPages} 頁</span>
          <button
            onClick={exportPdf}
            disabled={exporting || total === 0}
            className="ml-auto flex items-center gap-1 px-3 py-1 text-xs rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            匯出 PDF {total > 500 && `(超過 500 筆,先縮 filter)`}
          </button>
        </div>

        {loading ? (
          <div className="text-center text-slate-400 py-12 text-sm flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 載入中…</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-slate-400 py-12 text-sm">無符合條件的新聞</div>
        ) : (
          <div className="space-y-2">
            {rows.map(item => <NewsCard key={item.id} item={item} onTogglePin={() => togglePin(item)} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 text-xs rounded border disabled:opacity-50">← 上一頁</button>
            <span className="text-xs text-slate-500">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 text-xs rounded border disabled:opacity-50">下一頁 →</button>
          </div>
        )}
      </main>
    </div>
  )
}

function NewsCard({ item, onTogglePin }: { item: NewsItem; onTogglePin: () => void }) {
  const sent = item.sentiment_label || ''
  const sentColor = /positive/i.test(sent) ? 'text-emerald-600 bg-emerald-50' :
                    /negative/i.test(sent) ? 'text-red-600 bg-red-50' :
                    'text-slate-600 bg-slate-100'
  const date = item.published_at || item.scraped_at
  return (
    <div className="bg-white rounded border border-slate-200 p-3 hover:shadow-sm transition">
      <div className="flex items-start gap-2">
        <button
          onClick={onTogglePin}
          title={item.is_pinned ? '取消釘選' : '釘選此新聞'}
          className={`flex-shrink-0 p-1 rounded hover:bg-amber-50 ${item.is_pinned ? 'text-amber-500' : 'text-slate-300'}`}
        >
          <Pin size={14} fill={item.is_pinned ? 'currentColor' : 'none'} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sentColor}`}>{sent || '—'}</span>
            {item.related_metals && (
              <div className="flex gap-1 flex-wrap">
                {item.related_metals.split(',').map(m => (
                  <span key={m} className="px-1 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700">{m.trim()}</span>
                ))}
              </div>
            )}
            <span className="text-[10px] text-slate-400 ml-auto">{date ? String(date).slice(0, 16).replace('T', ' ') : '—'}</span>
          </div>
          <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-slate-800 hover:text-blue-600 text-sm flex items-start gap-1">
            <span className="flex-1">{item.title || '(無標題)'}</span>
            <ExternalLink size={12} className="flex-shrink-0 mt-1 text-slate-400" />
          </a>
          {item.summary && <div className="text-xs text-slate-600 mt-1 leading-relaxed">{item.summary}</div>}
          <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
            <span>{item.source || '—'}</span>
            <PmFeedbackThumbs targetType="forecast" targetRef={`news-${item.id}`} compact />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 報告 Tab(週/月)─────────────────────────────────────────────────────
function ReportsTab({ type }: { type: 'weekly' | 'monthly' }) {
  const [reports, setReports] = useState<any[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<any[]>([])

  useEffect(() => {
    setLoading(true)
    api.get('/pm/briefing/reports', { params: { type, offset, limit: 1 } })
      .then(r => setReports(r.data?.rows || []))
      .finally(() => setLoading(false))
  }, [type, offset])

  // 載歷史 dropdown
  useEffect(() => {
    const max = type === 'weekly' ? 8 : 12
    api.get('/pm/briefing/reports', { params: { type, offset: 0, limit: max } })
      .then(r => setHistory(r.data?.rows || []))
      .catch(() => {})
  }, [type])

  const current = reports[0]

  return (
    <div className="h-full overflow-y-auto p-6 bg-white">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-3 border-b pb-3">
          <h2 className="text-lg font-bold text-slate-800">{type === 'weekly' ? '📊 週報' : '📈 月報'}</h2>
          {history.length > 0 && (
            <select
              value={offset}
              onChange={e => setOffset(Number(e.target.value))}
              className="border rounded px-2 py-1 text-sm"
            >
              {history.map((h, i) => (
                <option key={h.id} value={i}>{i === 0 ? '最新 ▾ ' : ''}{h.as_of_date}</option>
              ))}
            </select>
          )}
          {current?.file_url && (
            <a
              href={current.file_url} target="_blank" rel="noreferrer"
              className="ml-auto flex items-center gap-1 px-3 py-1 text-sm rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
            ><Download size={12} /> 下載 docx</a>
          )}
        </div>

        {loading ? (
          <div className="text-center text-slate-400 py-8 flex items-center justify-center gap-2"><Loader2 className="animate-spin" /> 載入中…</div>
        ) : !current ? (
          <div className="text-center text-slate-400 py-8 text-sm">無 {type} 報告</div>
        ) : (
          <article className="prose prose-sm max-w-none">
            <h3 className="text-base font-medium text-slate-700">{current.title || `${current.as_of_date} ${type === 'weekly' ? '週' : '月'}報`}</h3>
            <pre className="whitespace-pre-wrap text-sm text-slate-700 bg-slate-50 border rounded p-4 font-sans leading-relaxed">{current.content || '(無內容)'}</pre>
            <div className="not-prose mt-3">
              <PmFeedbackThumbs targetType="report" targetRef={`${type}-${current.as_of_date}`} />
            </div>
          </article>
        )}
      </div>
    </div>
  )
}

// ── 我的偏好 modal ─────────────────────────────────────────────────────────
function PrefsModal({ prefs, onClose, onSaved }: { prefs: Prefs; onClose: () => void; onSaved: (p: Prefs) => void }) {
  const [focused, setFocused] = useState<string[]>(prefs.focused_metals || [])
  const [d24h, setD24h] = useState<number>(prefs.default_24h_only != null ? prefs.default_24h_only : 1)
  const [saving, setSaving] = useState(false)

  const toggle = (code: string) => setFocused(focused.includes(code) ? focused.filter(c => c !== code) : [...focused, code])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/pm/briefing/preferences', { focused_metals: focused, default_24h_only: d24h })
      onSaved({ focused_metals: focused, default_24h_only: d24h })
    } catch (e: any) { alert(e?.response?.data?.error || String(e)) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[480px] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium">⚙ 我的偏好</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">🪙 關注金屬(留空 = 全部都關注)</div>
            <div className="grid grid-cols-3 gap-2">
              {ALL_METALS.map(m => (
                <label key={m.code} className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer border ${
                  focused.includes(m.code) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                  <input type="checkbox" checked={focused.includes(m.code)} onChange={() => toggle(m.code)} />
                  <span className="font-mono font-bold">{m.code}</span>
                  <span className="text-slate-500">{m.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">設後:報價 banner / 新聞列表預設只顯示這些金屬。可隨時 [展開全部] 暫解。</p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={d24h === 1} onChange={e => setD24h(e.target.checked ? 1 : 0)} />
              新聞列表預設只看過去 24 小時
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600">取消</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50">
            {saving ? '...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
