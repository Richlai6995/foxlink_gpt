/**
 * MetalsNewsPanel — 右欄底:tab 切換 新聞 / 週報 / 月報
 *  - 新聞:今日抓取(scraped_at >= TRUNC(SYSDATE)),點擊 _blank 開原始 url
 *  - 週/月報:採購端 published 後的版本
 */
import { useEffect, useState } from 'react'
import { Newspaper, FileText, BarChart3, Loader2, ExternalLink } from 'lucide-react'
import api from '../../lib/api'

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

export default function MetalsNewsPanel() {
  const [tab, setTab] = useState<Tab>('news')
  const [news, setNews] = useState<NewsItem[]>([])
  const [report, setReport] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    if (tab === 'news') {
      api.get('/metals/news', { params: { limit: 30, today: 1 } })
        .then(r => setNews(r.data?.rows || []))
        .finally(() => setLoading(false))
    } else {
      api.get('/metals/reports', { params: { type: tab } })
        .then(r => setReport(r.data?.report || null))
        .finally(() => setLoading(false))
    }
  }, [tab])

  return (
    <div className="bg-white border rounded-lg flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Tab header — 黃色色帶配合 user 設計 */}
      <div className="flex items-center border-b bg-gradient-to-r from-amber-100 to-yellow-50">
        {([
          { id: 'news', label: '今日新聞', icon: <Newspaper size={12} /> },
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

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-slate-400 text-xs gap-1.5">
            <Loader2 size={12} className="animate-spin" /> 載入中…
          </div>
        ) : tab === 'news' ? (
          news.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-4">今日尚無新聞</div>
          ) : (
            <div className="space-y-2">
              {news.map(n => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block px-2 py-1.5 rounded border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition group"
                >
                  <div className="flex items-start gap-1">
                    <span className="text-xs font-medium text-slate-800 line-clamp-2 flex-1 group-hover:text-blue-700">{n.title}</span>
                    <ExternalLink size={10} className="text-slate-400 mt-0.5 flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500 flex-wrap">
                    {n.source && <span className="truncate max-w-[140px]">{n.source}</span>}
                    {n.related_metals && <span className="font-mono text-slate-600">{n.related_metals}</span>}
                    {n.sentiment_label && (
                      <span className={`px-1 rounded ${
                        n.sentiment_label.includes('positive') ? 'bg-emerald-50 text-emerald-700'
                        : n.sentiment_label.includes('negative') ? 'bg-red-50 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                      }`}>{n.sentiment_label}</span>
                    )}
                    <span className="ml-auto text-slate-400">{(n.scraped_at || n.published_at || '').slice(5, 16).replace('T', ' ')}</span>
                  </div>
                  {n.summary && (
                    <div className="text-[11px] text-slate-600 mt-1 line-clamp-2 leading-snug">{n.summary}</div>
                  )}
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
    </div>
  )
}
