/**
 * MetalsNewsPanel — 右欄底:tab 切換 新聞 / 週報 / 月報
 *  - 新聞:今日抓取(scraped_at >= TRUNC(SYSDATE)),點擊 _blank 開原始 url
 *  - 週/月報:採購端 published 後的版本
 */
import { useEffect, useState } from 'react'
import { Newspaper, FileText, BarChart3, Loader2, ExternalLink, Maximize2 } from 'lucide-react'
import api from '../../lib/api'
import PmNewsExplorerModal from '../pm/PmNewsExplorerModal'

type Tab = 'news' | 'weekly' | 'monthly'

interface NewsItem {
  id: number
  url: string
  title: string
  source?: string
  language?: string
  published_at?: string
  scraped_at?: string
  summary?: string
  sentiment_label?: string
  related_metals?: string
}

interface Props {
  viewDate?: string  // 'YYYY-MM-DD'
}

const NEWS_DAYS_KEY = 'metals.newsDays'
const NEWS_DAYS_OPTIONS = [1, 3, 7, 14, 30] as const

export default function MetalsNewsPanel({ viewDate }: Props) {
  const [tab, setTab] = useState<Tab>('news')
  const [news, setNews] = useState<NewsItem[]>([])
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [showExplorer, setShowExplorer] = useState(false)
  // 新聞抓取天數 selector — 預設 7 天,localStorage 記憶
  const [newsDays, setNewsDays] = useState<number>(() => {
    const saved = Number(localStorage.getItem(NEWS_DAYS_KEY))
    return NEWS_DAYS_OPTIONS.includes(saved as any) ? saved : 7
  })
  const changeDays = (d: number) => {
    setNewsDays(d)
    localStorage.setItem(NEWS_DAYS_KEY, String(d))
  }

  useEffect(() => {
    setLoading(true)
    if (tab === 'news') {
      const params: Record<string, any> = { limit: 30, days: newsDays }
      if (viewDate) params.date = viewDate
      api.get('/metals/news', { params })
        .then(r => setNews(r.data?.rows || []))
        .finally(() => setLoading(false))
    } else {
      const params: Record<string, any> = { type: tab }
      if (viewDate) params.date = viewDate
      api.get('/metals/reports', { params })
        .then(r => setReport(r.data?.report || null))
        .finally(() => setLoading(false))
    }
  }, [tab, viewDate, newsDays])

  return (
    <div className="bg-white border rounded-lg flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Tab header — 黃色色帶配合 user 設計 */}
      <div className="flex items-center border-b bg-gradient-to-r from-amber-100 to-yellow-50">
        {([
          { id: 'news', label: '新聞', icon: <Newspaper size={12} /> },
          { id: 'weekly', label: '週報', icon: <BarChart3 size={12} /> },
          { id: 'monthly', label: '月報', icon: <FileText size={12} /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(s => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 text-xs font-medium transition border-b-2 ${
              tab === s.id ? 'text-amber-800 border-amber-600 bg-white/40' : 'text-amber-700/70 border-transparent hover:text-amber-900'
            }`}
          >
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      {/* news tab 限定:抓取天數 selector(localStorage 記憶) + 放大按鈕 */}
      {tab === 'news' && (
        <div className="flex items-center gap-1 px-2 py-1 border-b bg-slate-50 text-[10px] text-slate-500">
          <span className="text-slate-400">近</span>
          {NEWS_DAYS_OPTIONS.map(d => (
            <button
              key={d}
              onClick={() => changeDays(d)}
              className={`px-1.5 py-0.5 rounded transition ${
                newsDays === d
                  ? 'bg-amber-600 text-white font-medium'
                  : 'text-slate-500 hover:bg-amber-100 hover:text-amber-700'
              }`}
            >
              {d}{d === 1 ? '日' : '天'}
            </button>
          ))}
          <button
            onClick={() => setShowExplorer(true)}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-amber-700 hover:bg-amber-100 hover:text-amber-900 transition"
            title="放大瀏覽(完整篩選器 / 關鍵字 / 來源 / 摘要)"
          >
            <Maximize2 size={11} />
            <span className="hidden sm:inline">放大</span>
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-slate-400 text-xs gap-1.5">
            <Loader2 size={12} className="animate-spin" /> 載入中…
          </div>
        ) : tab === 'news' ? (
          news.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-4">
              {viewDate ? `${viewDate} 起往前 ${newsDays} 天無新聞` : `近 ${newsDays} 天無新聞`}
            </div>
          ) : (
            // 緊湊版:每則一列(title 一行 + meta 一行),不 show summary 預覽 → 同空間多顯示 N 倍新聞
            <div className="divide-y">
              {news.map(n => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-2 py-1.5 hover:bg-blue-50/40 transition group"
                  title={n.summary || ''}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-slate-800 truncate flex-1 group-hover:text-blue-700">{n.title}</span>
                    <ExternalLink size={10} className="text-slate-300 flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5">
                    {n.source && <span className="truncate max-w-[100px]">{n.source}</span>}
                    {n.related_metals && <span className="font-mono text-slate-600">{n.related_metals}</span>}
                    {n.sentiment_label && (
                      <span className={`px-1 rounded text-[9px] ${
                        n.sentiment_label.includes('positive') ? 'bg-emerald-50 text-emerald-700'
                        : n.sentiment_label.includes('negative') ? 'bg-red-50 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                      }`}>{n.sentiment_label}</span>
                    )}
                    <span
                      className="ml-auto text-slate-400 flex-shrink-0"
                      title={`發布 ${n.published_at || '—'} / 抓取 ${n.scraped_at || '—'}`}
                    >
                      {(n.published_at || n.scraped_at || '').slice(5, 16).replace('T', ' ')}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )
        ) : (
          // weekly / monthly report
          report ? (
            <article className="px-2 py-1">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-700">{report.title || `${report.as_of_date} ${tab === 'weekly' ? '週' : '月'}報`}</h4>
                <span className="text-[10px] text-emerald-600">✓ 已發布 {report.published_at || ''}</span>
              </div>
              <pre className="whitespace-pre-wrap text-xs text-slate-700 leading-relaxed font-sans">{report.content || '(無內容)'}</pre>
            </article>
          ) : (
            <div className="text-xs text-slate-400 text-center py-4">
              採購尚未發布 {tab === 'weekly' ? '週' : '月'}報
            </div>
          )
        )}
      </div>

      {showExplorer && (
        <PmNewsExplorerModal onClose={() => setShowExplorer(false)} default24h={false} />
      )}
    </div>
  )
}
