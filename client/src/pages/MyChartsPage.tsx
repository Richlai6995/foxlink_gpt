/**
 * MyChartsPage — Phase 5:我的圖庫
 *
 * - 兩個 tab:我的 / 別人分享給我的
 * - 點 chart card → expand 顯示 ChartParamForm + 執行 → 渲染 InlineChart
 * - owner 卡片右側:分享 / 刪除
 *
 * 分享 Modal 直接 reuse dashboard/ShareModal.tsx(同 sharesUrl pattern)
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Star, Trash2, Share2, Clock, AlertTriangle, BarChart3, ExternalLink, ArrowLeft, Cpu, Plus, FileText } from 'lucide-react'
import api from '../lib/api'
import InlineChart from '../components/chat/InlineChart'
import ChartParamForm from '../components/chart/ChartParamForm'
import ChartEditorModal from '../components/chart/ChartEditorModal'
import ShareModal from '../components/dashboard/ShareModal'
import { fmtDateTW } from '../lib/fmtTW'
import { exportChartsToPptx, type ChartExportItem } from '../lib/chartExport'
import type { UserChart, InlineChartSpec, UserChartParam } from '../types'

type Tab = 'mine' | 'shared'

export default function MyChartsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('mine')
  const [mine, setMine] = useState<UserChart[]>([])
  const [shared, setShared] = useState<UserChart[]>([])
  const [loading, setLoading] = useState(true)
  const [shareModal, setShareModal] = useState<UserChart | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [chartData, setChartData] = useState<Record<number, { spec: InlineChartSpec; warnings?: string[] }>>({})
  const [chartBusy, setChartBusy] = useState<Record<number, boolean>>({})
  const [chartDetails, setChartDetails] = useState<Record<number, UserChart>>({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await api.get('/user-charts?scope=all')
      setMine(r.data.mine || [])
      setShared(r.data.shared || [])
    } catch (e) {
      console.error(e)
    } finally { setLoading(false) }
  }

  async function ensureDetail(id: number): Promise<UserChart | null> {
    if (chartDetails[id]) return chartDetails[id]
    try {
      const r = await api.get(`/user-charts/${id}`)
      setChartDetails(prev => ({ ...prev, [id]: r.data }))
      return r.data
    } catch (e) {
      console.error(e); return null
    }
  }

  async function handleExpand(id: number) {
    const nextExpanded = expandedId === id ? null : id
    setExpandedId(nextExpanded)
    if (nextExpanded === id) {
      if (!chartDetails[id]) await ensureDetail(id)
      // 使用率遙測:bump open_count(失敗不影響主流程)
      try { await api.post(`/user-charts/${id}/view`, {}) } catch (_) {}
    }
  }

  async function handleExecute(id: number, params: Record<string, unknown>) {
    setChartBusy(prev => ({ ...prev, [id]: true }))
    try {
      const r = await api.post(`/user-charts/${id}/execute`, { params })
      setChartData(prev => ({ ...prev, [id]: { spec: r.data.spec, warnings: r.data.warnings } }))
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'unknown'
      alert(t('chart.exec.failed', '執行失敗:') + msg)
    } finally {
      setChartBusy(prev => ({ ...prev, [id]: false }))
    }
  }

  async function handleDelete(c: UserChart) {
    if (!window.confirm(t('chart.delete.confirm', '確定刪除「{{title}}」?', { title: c.title }))) return
    try {
      await api.delete(`/user-charts/${c.id}`)
      await load()
      setExpandedId(null)
    } catch (e) { console.error(e) }
  }

  const list = tab === 'mine' ? mine : shared

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header — 對齊 KnowledgeBasePage / SkillMarket pattern */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Cpu size={14} className="text-white" />
          </div>
          <span className="font-bold">Cortex</span>
          <span className="text-slate-500 text-sm">/ {t('chart.library.title', '我的圖庫')}</span>
        </div>
        <button onClick={() => navigate('/chat')} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition">
          <ArrowLeft size={15} /> {t('common.backToChat', '返回對話')}
        </button>
      </header>

      <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Star className="text-amber-500" size={24} />
          <h1 className="text-xl font-semibold">{t('chart.library.title', '我的圖庫')}</h1>
        </div>
        <button
          onClick={() => setEditorOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
        >
          <Plus size={14} /> {t('chart.library.create', '新增圖表')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {(['mine', 'shared'] as Tab[]).map(tp => (
          <button
            key={tp}
            onClick={() => setTab(tp)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              tab === tp
                ? 'text-blue-600 border-blue-600'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            {tp === 'mine'
              ? t('chart.library.mine', '我的') + ` (${mine.length})`
              : t('chart.library.shared', '別人分享給我的') + ` (${shared.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">{t('common.loading', '載入中...')}</div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          {tab === 'mine'
            ? t('chart.library.emptyMine', '尚無收藏的圖表。在 chat 對話中對 inline chart 點擊星號可加入圖庫。')
            : t('chart.library.emptyShared', '目前沒有他人分享的圖表')}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(c => {
            const expanded = expandedId === c.id
            const detail = chartDetails[c.id]
            const data = chartData[c.id]
            const busy = chartBusy[c.id]
            const params = (detail?.source_params && Array.isArray(detail.source_params)
              ? detail.source_params as UserChartParam[]
              : []) as UserChartParam[]
            const isOwner = tab === 'mine'
            const canShare = isOwner && !!c.source_tool

            return (
              <div key={c.id} className="border border-slate-200 rounded-lg bg-white">
                <div className="flex items-center gap-3 p-4">
                  <BarChart3 size={18} className="text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-sm truncate">{c.title}</h3>
                      {!c.source_tool && (
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                          {t('chart.library.freeform', 'Freeform')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      {c.owner_name && <span>{t('chart.library.owner', '由')} {c.owner_name}</span>}
                      {c.source_tool && <span className="font-mono">{c.source_tool}</span>}
                      {c.use_count !== undefined && c.use_count > 0 && (
                        <span>· {t('chart.library.used', '使用')} {c.use_count} {t('chart.library.times', '次')}</span>
                      )}
                      {c.updated_at && <span className="flex items-center gap-1"><Clock size={10} />{fmtDateTW(c.updated_at)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleExpand(c.id)}
                      className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-1"
                    >
                      {expanded ? t('chart.library.collapse', '收合') : t('chart.library.open', '打開')}
                      <ExternalLink size={11} />
                    </button>
                    {canShare && (
                      <button
                        onClick={() => setShareModal(c)}
                        title={t('common.share', '分享')}
                        className="p-1.5 text-slate-400 hover:text-blue-500 rounded"
                      >
                        <Share2 size={14} />
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => handleDelete(c)}
                        title={t('common.delete', '刪除')}
                        className="p-1.5 text-slate-400 hover:text-red-500 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 p-4 bg-slate-50/50 space-y-3">
                    {c.source_tool ? (
                      <ChartParamForm
                        params={params}
                        busy={busy}
                        onSubmit={(vals) => handleExecute(c.id, vals)}
                      />
                    ) : (
                      // freeform:沒 tool,直接從 chart_spec 渲染原本資料
                      detail && typeof detail.chart_spec === 'object' && (
                        <InlineChart spec={detail.chart_spec as InlineChartSpec} enablePin={false} />
                      )
                    )}

                    {data?.warnings && data.warnings.length > 0 && (
                      <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                        <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                        <div>
                          {data.warnings.map((w, i) => <div key={i}>{w}</div>)}
                        </div>
                      </div>
                    )}

                    {data?.spec && <InlineChart spec={data.spec} enablePin={false} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {shareModal && (
        <ShareModal
          title={shareModal.title}
          sharesUrl={`/user-charts/${shareModal.id}/shares`}
          onClose={() => setShareModal(null)}
        />
      )}

      {editorOpen && (
        <ChartEditorModal
          onClose={() => setEditorOpen(false)}
          onSaved={async () => { setEditorOpen(false); await load() }}
        />
      )}
      </div>
    </div>
  )
}
