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
import ReactECharts from 'echarts-for-react'

// ── Constants ──────────────────────────────────────────────────────────────
const ALL_METALS = [
  { code: 'AU', name: '金',   group: '貴金屬' },
  { code: 'AG', name: '銀',   group: '貴金屬' },
  { code: 'PT', name: '鉑',   group: '貴金屬' },
  { code: 'PD', name: '鈀',   group: '貴金屬' },
  { code: 'CU', name: '銅',   group: '基本金屬' },
  { code: 'AL', name: '鋁',   group: '基本金屬' },
  { code: 'NI', name: '鎳',   group: '基本金屬' },
  { code: 'ZN', name: '鋅',   group: '基本金屬' },
  { code: 'PB', name: '鉛',   group: '基本金屬' },
  { code: 'SN', name: '錫',   group: '基本金屬' },
  { code: 'RH', name: '銠',   group: '貴金屬' },
]

type Tab = 'news' | 'history' | 'weekly' | 'monthly' | 'review'

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

      {/* 宏觀指標 mini banner(DXY / VIX / UST10Y / WTI 等)*/}
      <MacroBanner />

      {/* 近期警示卡(若有未 ACK 的高優先警示)*/}
      <AlertsBanner />

      {/* AI 綜述 */}
      <DailyInsight />

      {/* Tabs */}
      <div className="bg-white border-b border-t flex items-center gap-1 px-4">
        {([
          { id: 'news',    label: '新聞列表', icon: <Newspaper size={14} /> },
          { id: 'history', label: '歷史價格', icon: <BarChart3 size={14} /> },
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
        {tab === 'history' && <PriceHistoryTab focusedMetals={Array.from(focusedSet)} />}
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

// Client-side CSV from rows in memory(完整資料表「匯出此表 CSV」按鈕用)
// 跟 detail table thead 同 20 欄,讓使用者所見即所得
const DETAIL_CSV_COLS = [
  'as_of_date','metal_code','metal_name','original_price','original_currency','original_unit',
  'price_usd','unit','fx_rate_to_usd','day_change_pct','source','source_url',
  'price_type','market','grade','lme_stock','stock_change','is_estimated','conversion_note','scraped_at',
] as const

function csvEscape(v: any) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function downloadDetailCSV(rows: any[], from: string, to: string) {
  const lines = [DETAIL_CSV_COLS.join(',')]
  for (const r of rows) {
    lines.push(DETAIL_CSV_COLS.map(c => {
      const v = r[c] ?? r[c.toUpperCase()]
      return csvEscape(v)
    }).join(','))
  }
  const csv = '﻿' + lines.join('\n')  // UTF-8 BOM,Excel 不亂碼
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const dl = document.createElement('a')
  dl.href = URL.createObjectURL(blob)
  dl.download = `PM_價格詳細_${from}_${to}.csv`
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

  if (loading) {
    return <div className="bg-white border-b px-6 py-3 text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 報價載入中…</div>
  }

  // 把 11 個 ALL_METALS 為基底,LEFT JOIN prices(沒資料的顯示「—」)
  // 排序:有資料的在前(per `as_of_date DESC`),沒資料的後排序按 ALL_METALS 順序
  // 統一用 UPPERCASE 做 key,避免 DB 大小寫不一致(歷史資料可能有 'Au' / 'AU' 混存)
  const priceMap = new Map<string, any>()
  for (const p of prices) {
    const code = String(p.metal_code || p.METAL_CODE || '').toUpperCase()
    if (code) priceMap.set(code, p)
  }
  const fullList = ALL_METALS.map(m => {
    const p = priceMap.get(m.code.toUpperCase())
    return {
      code: m.code,
      name_zh: m.name,
      price_usd: p ? (p.price_usd ?? p.PRICE_USD) : null,
      day_change_pct: p ? (p.day_change_pct ?? p.DAY_CHANGE_PCT) : null,
      hasData: !!p,
    }
  })

  const visible = expanded || focusedSet.size === 0 ? fullList : fullList.filter(p => focusedSet.has(p.code))
  const hidden = fullList.length - visible.length
  const noData = prices.length === 0

  return (
    <div>
      {noData && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-1.5 text-xs text-amber-800">
          ⚠️ 近 30 天無報價資料(可至「歷史價格」tab 放寬日期範圍查更早資料)
        </div>
      )}
      <div className="bg-white border-b px-6 py-2 flex items-center gap-3 overflow-x-auto">
        <span className="text-xs text-slate-400 flex-shrink-0">📅 {asOfDate || '—'}</span>
        {visible.map(p => {
          const price = Number(p.price_usd)
          const chg = Number(p.day_change_pct)
          const isUp = chg > 0
          return (
            <div key={p.code} className={`flex items-center gap-1 px-2 py-1 rounded border flex-shrink-0 ${
              p.hasData ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-slate-50/50 opacity-60'
            }`}>
              <span className="font-bold text-slate-800 text-sm">{p.code}</span>
              <span className="text-slate-500 text-[11px]">{p.name_zh}</span>
              <span className="text-slate-700 font-mono text-sm">
                {p.hasData && p.price_usd != null && Number.isFinite(price)
                  ? price.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : '—'}
              </span>
              {p.hasData && p.day_change_pct != null && Number.isFinite(chg) && (
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
    </div>
  )
}

// ── 今日 AI 綜述 ───────────────────────────────────────────────────────────
// ── 宏觀指標 mini banner ───────────────────────────────────────────────────
function MacroBanner() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/pm/briefing/macro').then(r => setRows(r.data || [])).finally(() => setLoading(false))
  }, [])

  if (loading) return null  // 載入中不佔位
  if (rows.length === 0) {
    return (
      <div className="bg-slate-50 border-b px-6 py-1.5 text-xs text-slate-400">
        📈 宏觀指標(DXY / VIX / UST10Y / WTI 等)— <em>尚無資料,需 [PM] 總體經濟指標日抓 排程跑過</em>
      </div>
    )
  }

  return (
    <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-2 flex items-center gap-3 overflow-x-auto">
      <span className="text-xs text-indigo-600 font-medium flex-shrink-0">📈 宏觀</span>
      {rows.map(r => {
        const cur = Number(r.value ?? r.VALUE)
        const prev = Number(r.prev_value ?? r.PREV_VALUE)
        const chgPct = Number.isFinite(prev) && prev !== 0 ? ((cur - prev) / prev) * 100 : null
        const isUp = chgPct != null && chgPct > 0
        return (
          <div key={r.indicator_code || r.INDICATOR_CODE} className="flex items-center gap-1 px-2 py-1 rounded border border-indigo-200 bg-white flex-shrink-0">
            <span className="font-bold text-slate-800 text-xs">{r.indicator_code || r.INDICATOR_CODE}</span>
            {(r.indicator_name || r.INDICATOR_NAME) && (
              <span className="text-[10px] text-slate-500">({r.indicator_name || r.INDICATOR_NAME})</span>
            )}
            <span className="font-mono text-xs text-slate-700">{Number.isFinite(cur) ? cur.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}</span>
            {chgPct != null && Number.isFinite(chgPct) && (
              <span className={`text-[10px] font-medium ${isUp ? 'text-emerald-600' : chgPct < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                {isUp ? '+' : ''}{chgPct.toFixed(2)}%
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 近期警示卡 ────────────────────────────────────────────────────────────
function AlertsBanner() {
  const [alerts, setAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [acking, setAcking] = useState<number | null>(null)

  const load = () => {
    setLoading(true)
    api.get('/pm/briefing/alerts', { params: { days: 7, limit: 20 } })
      .then(r => setAlerts(r.data || []))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const ack = async (id: number) => {
    setAcking(id)
    try {
      await api.post(`/pm/briefing/alerts/${id}/ack`, {})
      load()
    } finally { setAcking(null) }
  }

  if (loading || alerts.length === 0) return null  // 沒警示不佔位

  const unacked = alerts.filter(a => !a.ack_user_id && !a.ACK_USER_ID)
  const visible = expanded ? alerts : unacked.slice(0, 3)
  const hasUnacked = unacked.length > 0

  if (!hasUnacked && !expanded) {
    // 全 ACK 過 → 顯示縮小版
    return (
      <div className="bg-slate-50 border-b px-6 py-1.5 text-xs text-slate-500 flex items-center gap-2">
        ✅ 近 7 天 {alerts.length} 個警示已全部處理
        <button onClick={() => setExpanded(true)} className="text-blue-600 hover:underline">[看歷史]</button>
      </div>
    )
  }

  const sevColor = (sev: string) => {
    if (/critical|error/i.test(sev || '')) return 'bg-red-50 border-red-300 text-red-800'
    if (/warning/i.test(sev || '')) return 'bg-amber-50 border-amber-300 text-amber-800'
    return 'bg-slate-50 border-slate-300 text-slate-700'
  }

  return (
    <div className="bg-red-50/30 border-b border-red-200 px-6 py-2 space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-red-700 font-medium">🚨 近期警示</span>
        {hasUnacked && <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{unacked.length} 未處理</span>}
        <button onClick={() => setExpanded(v => !v)} className="ml-auto text-xs text-blue-600 hover:underline">
          {expanded ? '收合' : `看全部 ${alerts.length} 筆`}
        </button>
      </div>
      <div className="space-y-1">
        {visible.map(a => {
          const id = a.id || a.ID
          const acked = !!(a.ack_user_id || a.ACK_USER_ID)
          return (
            <div key={id} className={`flex items-start gap-2 px-3 py-1.5 text-xs rounded border ${sevColor(a.severity || a.SEVERITY)} ${acked ? 'opacity-60' : ''}`}>
              <span className="font-mono text-[10px] flex-shrink-0">{a.triggered_at || a.TRIGGERED_AT}</span>
              <span className="font-medium flex-shrink-0">[{a.rule_code || a.RULE_CODE}]</span>
              {(a.entity_code || a.ENTITY_CODE) && <span className="font-bold flex-shrink-0">{a.entity_code || a.ENTITY_CODE}</span>}
              <span className="flex-1">{a.message || a.MESSAGE || '—'}</span>
              {acked ? (
                <span className="text-[10px] text-emerald-600 flex-shrink-0">✓ ACK</span>
              ) : (
                <button
                  onClick={() => ack(id)}
                  disabled={acking === id}
                  className="text-[10px] px-2 py-0.5 rounded border border-current hover:bg-white/50 flex-shrink-0"
                >{acking === id ? '...' : '我已知道'}</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
        ℹ️ 尚未生成任何日報 — 請先到「排程任務」啟用 [PM] 每日金屬日報(預設每日 18:00 跑)
      </div>
    )
  }

  const content = String(report.content || '')
  const summary = content.length > 250 ? content.slice(0, 250) + '...' : content

  return (
    <div className="bg-blue-50 border-b border-blue-100 px-6 py-3 text-sm">
      {todayMissing && (
        <div className="text-amber-700 text-xs mb-2 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
          ⏳ 今日(尚未生成日報 — 預設每日 18:00 跑)— 以下為 {report.as_of_date} 報告
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
              <label key={m.code} className={`flex items-center justify-center gap-1 px-1.5 py-1 text-xs rounded cursor-pointer ${
                metals.includes(m.code) ? 'bg-blue-100 text-blue-700' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}>
                <input type="checkbox" checked={metals.includes(m.code)} onChange={() => setMetalSel(m.code)} className="hidden" />
                <span className="font-mono font-bold">{m.code}</span>
                <span className="text-[11px]">{m.name}</span>
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
// ── 歷史價格 Tab(完整欄位 + ECharts line chart)─────────────────────────
function PriceHistoryTab({ focusedMetals }: { focusedMetals: string[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  // 沒設偏好 → 預設全選 11 個(看全貌);有偏好 → 只看偏好
  const initMetals = focusedMetals.length > 0
    ? focusedMetals.map(m => m.toUpperCase())
    : ALL_METALS.map(m => m.code)
  const [metals, setMetals] = useState<string[]>(initMetals)
  const [from, setFrom] = useState(monthAgo)
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // D — overlay 狀態
  const [showForecast, setShowForecast] = useState(true)
  const [showPurchase, setShowPurchase] = useState(true)
  const [showBand, setShowBand] = useState(false)
  const [forecastMap, setForecastMap] = useState<Record<string, Array<{ target_date: string; mean: number; lower: number | null; upper: number | null }>>>({})
  const [purchaseMap, setPurchaseMap] = useState<Record<string, Array<{ purchase_month: string; avg_unit_price: number; total_qty: number }>>>({})
  const [metricsMap, setMetricsMap] = useState<Record<string, any>>({})

  useEffect(() => {
    if (metals.length === 0) { setRows([]); return }
    setLoading(true)
    api.get('/pm/briefing/prices/history', {
      params: { metals: metals.join(','), from, to, limit: 5000 },
    }).then(r => setRows(r.data?.rows || []))
      .finally(() => setLoading(false))
  }, [metals.join(','), from, to])

  // 載 forecast / purchase overlay + metrics(per-metal,平行)
  useEffect(() => {
    if (metals.length === 0) {
      setForecastMap({}); setPurchaseMap({}); setMetricsMap({})
      return
    }
    const fcAll: any = {}, puAll: any = {}, mtAll: any = {}
    Promise.all(metals.map(metal => Promise.all([
      api.get('/pm/briefing/forecast-overlay', { params: { metal, from, to } })
        .then(r => fcAll[metal] = (r.data || []).map((x: any) => ({
          target_date: x.target_date || x.TARGET_DATE,
          mean:  Number(x.predicted_mean ?? x.PREDICTED_MEAN),
          lower: x.predicted_lower != null ? Number(x.predicted_lower) : null,
          upper: x.predicted_upper != null ? Number(x.predicted_upper) : null,
        }))).catch(() => fcAll[metal] = []),
      api.get('/pm/briefing/purchase-overlay', { params: { metal, from, to } })
        .then(r => puAll[metal] = (r.data || []).map((x: any) => ({
          purchase_month: x.purchase_month || x.PURCHASE_MONTH,
          avg_unit_price: Number(x.avg_unit_price ?? x.AVG_UNIT_PRICE),
          total_qty:      Number(x.total_qty ?? x.TOTAL_QTY),
        }))).catch(() => puAll[metal] = []),
      api.get('/pm/briefing/metrics-summary', { params: { metal, days: 180 } })
        .then(r => mtAll[metal] = r.data).catch(() => mtAll[metal] = null),
    ]))).then(() => {
      setForecastMap(fcAll); setPurchaseMap(puAll); setMetricsMap(mtAll)
    })
  }, [metals.join(','), from, to])

  // 為 ECharts 準備 series:每金屬一條 line(x=as_of_date, y=price_usd)
  const seriesByMetal: Record<string, [string, number][]> = {}
  for (const r of rows) {
    const code = r.metal_code || r.METAL_CODE
    if (!seriesByMetal[code]) seriesByMetal[code] = []
    const date = r.as_of_date || r.AS_OF_DATE
    const price = Number(r.price_usd ?? r.PRICE_USD)
    if (Number.isFinite(price)) seriesByMetal[code].push([date, price])
  }
  // 同一金屬同一天可能有多 source,取平均
  const aggregated: Record<string, [string, number][]> = {}
  for (const code in seriesByMetal) {
    const map = new Map<string, number[]>()
    for (const [d, p] of seriesByMetal[code]) {
      if (!map.has(d)) map.set(d, [])
      map.get(d)!.push(p)
    }
    aggregated[code] = Array.from(map.entries())
      .map(([d, arr]) => [d, arr.reduce((a, b) => a + b, 0) / arr.length] as [string, number])
      .sort((a, b) => a[0].localeCompare(b[0]))
  }

  const downloadCSV = async () => {
    setDownloading(true)
    try {
      const params: Record<string, string> = { from, to }
      if (metals.length > 0) params.metals = metals.join(',')
      const url = '/pm/briefing/prices/export.csv?' + new URLSearchParams(params).toString()
      const resp = await api.get(url, { responseType: 'blob' })
      const blob = new Blob([resp.data], { type: 'text/csv;charset=utf-8' })
      const dl = document.createElement('a')
      dl.href = URL.createObjectURL(blob)
      dl.download = `PM_價格歷史_${from}_${to}.csv`
      dl.click()
      URL.revokeObjectURL(dl.href)
    } finally { setDownloading(false) }
  }

  const toggleMetal = (code: string) =>
    setMetals(metals.includes(code) ? metals.filter(m => m !== code) : [...metals, code])

  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* 篩選列 */}
        <div className="bg-white border rounded p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-slate-700">📅 日期</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
            <span className="text-slate-400">~</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
            <div className="flex gap-1 text-xs">
              <button onClick={() => { setFrom(monthAgo); setTo(today) }} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200">30d</button>
              <button onClick={() => { setFrom(new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)); setTo(today) }} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200">60d</button>
              <button onClick={() => { setFrom(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)); setTo(today) }} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200">90d</button>
              <button onClick={() => { setFrom(new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)); setTo(today) }} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200">1y</button>
            </div>
            <button
              onClick={downloadCSV} disabled={downloading || rows.length === 0}
              className="ml-auto flex items-center gap-1 px-3 py-1 text-xs rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} 匯出 CSV
            </button>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">🪙 金屬(可多選 — 圖表會疊起來)</div>
            <div className="flex gap-1 flex-wrap">
              {ALL_METALS.map(m => (
                <label key={m.code} className={`flex items-center gap-1 px-2 py-1 text-xs rounded cursor-pointer border ${
                  metals.includes(m.code) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                  <input type="checkbox" checked={metals.includes(m.code)} onChange={() => toggleMetal(m.code)} className="hidden" />
                  <span className="font-mono font-bold">{m.code}</span>
                  <span>{m.name}</span>
                </label>
              ))}
              {metals.length > 0 && (
                <button onClick={() => setMetals([])} className="px-2 py-1 text-xs text-red-600 hover:underline">清除</button>
              )}
            </div>
          </div>
        </div>

        {/* Metric cards + Overlay toggles(D — 採購節奏 vs 預測)*/}
        {metals.length > 0 && (
          <MetricsCards metals={metals} metricsMap={metricsMap} />
        )}

        <div className="bg-white border rounded px-4 py-2 flex items-center gap-3 flex-wrap text-xs">
          <span className="text-slate-500 font-medium">📊 圖表疊加層:</span>
          <label className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${showForecast ? 'bg-blue-100 text-blue-700' : 'bg-slate-50 text-slate-500'}`}>
            <input type="checkbox" checked={showForecast} onChange={e => setShowForecast(e.target.checked)} />
            AI 預測線
          </label>
          <label className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${showBand ? 'bg-blue-100 text-blue-700' : 'bg-slate-50 text-slate-500'}`}>
            <input type="checkbox" checked={showBand} onChange={e => setShowBand(e.target.checked)} disabled={!showForecast} />
            信心區間(80%)
          </label>
          <label className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${showPurchase ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
            <input type="checkbox" checked={showPurchase} onChange={e => setShowPurchase(e.target.checked)} />
            實際採購點(by month)
          </label>
          <span className="ml-auto text-[10px] text-slate-400">
            {showForecast && Object.values(forecastMap).every(arr => arr.length === 0) && '⚠️ forecast_history 無資料 '}
            {showPurchase && Object.values(purchaseMap).every(arr => arr.length === 0) && '⚠️ pm_purchase_history 無資料(需 ERP sync 啟用)'}
          </span>
        </div>

        {/* Chart */}
        {loading ? (
          <div className="text-center py-12 text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 載入中…</div>
        ) : Object.keys(aggregated).length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded p-6 text-center text-amber-700 text-sm">
            ⚠️ 無資料 — 篩選條件下找不到價格,請放寬日期或選其他金屬
          </div>
        ) : (
          <PriceChart
            aggregated={aggregated}
            forecastMap={showForecast ? forecastMap : {}}
            purchaseMap={showPurchase ? purchaseMap : {}}
            showBand={showForecast && showBand}
          />
        )}

        {/* Detail table — 所有欄位 SHOW */}
        {!loading && rows.length > 0 && (
          <div className="bg-white border rounded">
            <div className="px-4 py-2 border-b bg-slate-50 flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">完整資料表(共 {rows.length} 筆)</span>
              <span className="text-xs text-slate-400">所有 pm_price_history 欄位</span>
              <button
                onClick={() => downloadDetailCSV(rows, from, to)}
                className="ml-auto flex items-center gap-1 px-3 py-1 text-xs rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
                title="把目前篩選條件下的所有 rows 匯出 CSV(20 欄全資料)"
              >
                <Download size={12} /> 匯出此表 CSV
              </button>
            </div>
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
                  <tr>
                    {['as_of_date','metal_code','metal_name','original_price','original_currency','original_unit','price_usd','unit','fx_rate_to_usd','day_change_pct','source','source_url','price_type','market','grade','lme_stock','stock_change','is_estimated','conversion_note','scraped_at'].map(c => (
                      <th key={c} className="px-2 py-1.5 text-left font-mono whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-blue-50/50">
                      <td className="px-2 py-1 font-mono">{r.as_of_date || r.AS_OF_DATE}</td>
                      <td className="px-2 py-1 font-mono font-bold">{r.metal_code || r.METAL_CODE}</td>
                      <td className="px-2 py-1">{r.metal_name || r.METAL_NAME || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{numFmt(r.original_price ?? r.ORIGINAL_PRICE)}</td>
                      <td className="px-2 py-1">{r.original_currency || r.ORIGINAL_CURRENCY || '—'}</td>
                      <td className="px-2 py-1">{r.original_unit || r.ORIGINAL_UNIT || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono font-bold">{numFmt(r.price_usd ?? r.PRICE_USD)}</td>
                      <td className="px-2 py-1">{r.unit || r.UNIT || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{numFmt(r.fx_rate_to_usd ?? r.FX_RATE_TO_USD)}</td>
                      <td className={`px-2 py-1 text-right font-mono ${Number(r.day_change_pct ?? r.DAY_CHANGE_PCT) > 0 ? 'text-emerald-600' : Number(r.day_change_pct ?? r.DAY_CHANGE_PCT) < 0 ? 'text-red-600' : ''}`}>
                        {numFmt(r.day_change_pct ?? r.DAY_CHANGE_PCT)}
                      </td>
                      <td className="px-2 py-1">{r.source || r.SOURCE || '—'}</td>
                      <td className="px-2 py-1 max-w-[200px] truncate">
                        {(r.source_url || r.SOURCE_URL) ? (
                          <a href={r.source_url || r.SOURCE_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{r.source_url || r.SOURCE_URL}</a>
                        ) : '—'}
                      </td>
                      <td className="px-2 py-1">{r.price_type || r.PRICE_TYPE || '—'}</td>
                      <td className="px-2 py-1">{r.market || r.MARKET || '—'}</td>
                      <td className="px-2 py-1">{r.grade || r.GRADE || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{numFmt(r.lme_stock ?? r.LME_STOCK)}</td>
                      <td className="px-2 py-1 text-right font-mono">{numFmt(r.stock_change ?? r.STOCK_CHANGE)}</td>
                      <td className="px-2 py-1 text-center">{Number(r.is_estimated ?? r.IS_ESTIMATED) === 1 ? '✓' : ''}</td>
                      <td className="px-2 py-1 max-w-[160px] truncate" title={r.conversion_note || r.CONVERSION_NOTE || ''}>{r.conversion_note || r.CONVERSION_NOTE || '—'}</td>
                      <td className="px-2 py-1 text-slate-400 whitespace-nowrap">{r.scraped_at || r.SCRAPED_AT || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function numFmt(v: any) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(n) >= 10) return n.toFixed(2)
  return n.toFixed(4)
}

function PriceChart({
  aggregated, forecastMap = {}, purchaseMap = {}, showBand = false,
}: {
  aggregated: Record<string, [string, number][]>
  forecastMap?: Record<string, Array<{ target_date: string; mean: number; lower: number | null; upper: number | null }>>
  purchaseMap?: Record<string, Array<{ purchase_month: string; avg_unit_price: number; total_qty: number }>>
  showBand?: boolean
}) {
  const codes = Object.keys(aggregated).sort()

  // 採購點:size = 月用量 normalize 到 8-30 px 範圍
  const allQtys = Object.values(purchaseMap).flat().map(p => Number(p.total_qty)).filter(Number.isFinite)
  const maxQty = allQtys.length > 0 ? Math.max(...allQtys) : 1
  const sizeFor = (q: number) => {
    if (!Number.isFinite(q) || maxQty <= 0) return 12
    return 8 + Math.round((q / maxQty) * 22)  // 8 ~ 30
  }
  // YYYY-MM → YYYY-MM-15(月中,跟 line chart 對齊)
  const monthMid = (m: string) => `${m}-15`

  const series: any[] = []
  const legendData: string[] = []

  for (const code of codes) {
    legendData.push(code)
    series.push({
      name: code,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 4,
      data: aggregated[code],
    })

    // forecast line(虛線)
    const fc = forecastMap[code] || []
    if (fc.length > 0) {
      const fcName = `${code}(預測)`
      legendData.push(fcName)
      series.push({
        name: fcName,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', width: 1.5 },
        itemStyle: { opacity: 0.7 },
        data: fc.map(p => [p.target_date, p.mean]),
      })

      // 信心區間 band(填色)— 用兩條 line + areaStyle 做
      if (showBand && fc.some(p => p.lower != null && p.upper != null)) {
        series.push({
          name: `${code} lower`, type: 'line', stack: `${code}-band`,
          symbol: 'none', lineStyle: { opacity: 0 }, showInLegend: false,
          data: fc.map(p => [p.target_date, p.lower]),
        })
        series.push({
          name: `${code} band`, type: 'line', stack: `${code}-band`,
          symbol: 'none', lineStyle: { opacity: 0 },
          areaStyle: { opacity: 0.15 },
          data: fc.map(p => [p.target_date, p.upper != null && p.lower != null ? p.upper - p.lower : 0]),
        })
      }
    }

    // 採購點(scatter,size = 月用量)
    const pu = purchaseMap[code] || []
    if (pu.length > 0) {
      const puName = `${code}(實際採購)`
      legendData.push(puName)
      series.push({
        name: puName,
        type: 'scatter',
        symbolSize: (val: any) => {
          const q = Array.isArray(val) ? Number(val[2]) : 0
          return sizeFor(q)
        },
        itemStyle: { color: '#10b981', borderColor: '#047857', borderWidth: 1 },
        encode: { x: 0, y: 1 },
        tooltip: {
          formatter: (params: any) => {
            const [, price, qty] = params.data
            return `${puName}<br/>${params.data[0]}<br/>均價: ${Number(price).toLocaleString(undefined, { maximumFractionDigits: 2 })}<br/>用量: ${Number(qty).toLocaleString()}`
          },
        },
        data: pu.map(p => [monthMid(p.purchase_month), p.avg_unit_price, p.total_qty]),
      })
    }
  }

  // 把 ms timestamp 格成 YYYY-MM-DD,tooltip / cross axis label 都用
  const fmtDate = (val: number) => {
    const d = new Date(val)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        // cross 軸下方 label(滑鼠跟著的小框)— 強制日期,不要 00:00:00 時間
        label: { formatter: (params: any) => params.axisDimension === 'x' ? fmtDate(params.value) : Number(params.value).toLocaleString() },
      },
      // tooltip header(滑鼠 hover 跳出的整框)第一行也是日期
      formatter: (items: any[]) => {
        if (!items || !items.length) return ''
        const dateStr = fmtDate(items[0].axisValue)
        const lines = items.map(it => {
          const v = Array.isArray(it.data) ? it.data[1] : it.value
          const num = Number(v)
          const fmt = Number.isFinite(num) ? num.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'
          return `${it.marker}${it.seriesName}<span style="float:right;margin-left:20px;font-weight:bold">${fmt}</span>`
        }).join('<br/>')
        return `<div style="font-weight:bold;margin-bottom:4px">${dateStr}</div>${lines}`
      },
    },
    legend: {
      data: legendData,
      type: 'scroll',
      top: 4,                    // 移到頂端,別擋 X 軸
      left: 'center',
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: { left: 60, right: 30, top: 40, bottom: 60 },  // bottom 大一點留 dataZoom slider 空間
    xAxis: {
      type: 'time',
      // 強制按「天」切刻度,避免短期資料(< 1 週)時 ECharts auto 退化到「小時」/「2 天」格式
      minInterval: 24 * 3600 * 1000,
      maxInterval: 24 * 3600 * 1000,
      axisLabel: {
        formatter: (val: number) => {
          const d = new Date(val)
          const mm = String(d.getMonth() + 1).padStart(2, '0')
          const dd = String(d.getDate()).padStart(2, '0')
          return `${mm}-${dd}`  // 軸 label 簡短:MM-DD;tooltip 才顯示完整年份
        },
        hideOverlap: true,
      },
    },
    // > 3 條線時用 log 軸 — 金屬價差 PB(1.9k) ~ SN(50k) 26 倍,linear 會把低價金屬壓成平線
    yAxis: codes.length > 3
      ? { type: 'log', name: 'USD (log)', logBase: 10, scale: true }
      : { type: 'value', name: 'USD', scale: true },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 20 }],
    series,
  }
  return (
    <div className="bg-white border rounded p-4">
      <ReactECharts option={option} style={{ height: 480 }} notMerge />
    </div>
  )
}

// ── Metric Cards(D 三個 KPI)─────────────────────────────────────────────
function MetricsCards({ metals, metricsMap }: { metals: string[]; metricsMap: Record<string, any> }) {
  if (metals.length === 0) return null
  // 多金屬時取第一個顯示主要 metric;副欄列其他金屬
  const primary = metals[0]
  const m = metricsMap[primary] || {}
  const timing = m.timing_pct
  const mape = m.mape_30d
  const dos = m.days_of_supply

  const fmtPct = (v: any) => {
    if (v == null || !Number.isFinite(Number(v))) return '—'
    const n = Number(v)
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
  }
  const timingColor = timing == null ? 'text-slate-400' : timing < 0 ? 'text-emerald-600' : 'text-red-600'
  const mapeColor = mape == null ? 'text-slate-400' : mape < 5 ? 'text-emerald-600' : mape < 15 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="bg-white border rounded p-4">
        <div className="text-xs text-slate-500 mb-1">📊 採購擇時(180 天)</div>
        <div className={`text-2xl font-mono font-bold ${timingColor}`}>{fmtPct(timing)}</div>
        <div className="text-[11px] text-slate-400 mt-1">
          {primary} 我們均價 vs 市場月均 — {timing == null ? '無資料' : timing < 0 ? '✓ 比市場便宜' : '⚠ 高於市場均'}
        </div>
      </div>
      <div className="bg-white border rounded p-4">
        <div className="text-xs text-slate-500 mb-1">🎯 AI 預測準度(30 天)</div>
        <div className={`text-2xl font-mono font-bold ${mapeColor}`}>{mape == null ? '—' : `${Number(mape).toFixed(2)}%`}</div>
        <div className="text-[11px] text-slate-400 mt-1">
          {primary} MAPE · {Number(m.mape_samples || 0)} 樣本 · {mape == null ? '無資料' : mape < 5 ? '✓ 高準確' : mape < 15 ? '~ 可接受' : '⚠ 不可信'}
        </div>
      </div>
      <div className="bg-white border rounded p-4">
        <div className="text-xs text-slate-500 mb-1">📦 庫存週轉天數</div>
        <div className={`text-2xl font-mono font-bold ${dos == null ? 'text-slate-400' : dos < 30 ? 'text-amber-600' : dos < 90 ? 'text-emerald-600' : 'text-blue-600'}`}>
          {dos == null ? '—' : `${Number(dos).toFixed(0)} 天`}
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          {primary} 在庫+在途 / 月平均用量 · {dos == null ? '需 pm_inventory + 採購歷史' : dos < 30 ? '⚠ 低於 30 天' : '✓ 充裕'}
        </div>
      </div>
    </div>
  )
}

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
