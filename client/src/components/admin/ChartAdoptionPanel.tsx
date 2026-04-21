/**
 * ChartAdoptionPanel — Phase 5:admin 採納使用者圖庫熱門圖表為戰情室 official chart
 *
 * 流程:
 *   1. 列出 user_charts 按 use_count desc(僅 source_tool != null 的可採納)
 *   2. 點「採納」→ 彈 form 要求 admin 提供:topic_id / design_name / sql_query
 *      (因 user chart 走 tool 路徑、戰情室走 SQL 路徑,需 admin 手動橋接)
 *   3. POST /api/user-charts/admin/:id/adopt → 在 ai_select_designs 建一筆,
 *      帶 adopted_from_user_chart_id 紀錄來源
 *
 * 注意:本面板的「自動採納」是 Phase 5 第一輪,真正的 LLM 輔助 SQL 生成留 Phase 5b。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Star, Check, ExternalLink } from 'lucide-react'
import api from '../../lib/api'
import { fmtDateTW } from '../../lib/fmtTW'

interface PopularChart {
  id: number
  title: string
  description?: string
  owner_id: number
  owner_name?: string
  source_type?: string
  source_tool?: string
  use_count?: number
  share_count?: number
  created_at?: string
  updated_at?: string
  adopted_design_id?: number | null
}

interface AiTopic {
  id: number
  name: string
}

export default function ChartAdoptionPanel() {
  const { t } = useTranslation()
  const [charts, setCharts] = useState<PopularChart[]>([])
  const [topics, setTopics] = useState<AiTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [adoptForm, setAdoptForm] = useState<{ chart: PopularChart; topic_id?: number; design_name: string; sql_query: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/user-charts/admin/popular?limit=100').then(r => setCharts(r.data || [])),
      api.get('/dashboard/topics').then(r => setTopics((r.data || []).map((x: any) => ({ id: x.id, name: x.name })))).catch(() => setTopics([])),
    ]).finally(() => setLoading(false))
  }, [])

  const handleAdopt = async () => {
    if (!adoptForm) return
    if (!adoptForm.topic_id || !adoptForm.design_name.trim() || !adoptForm.sql_query.trim()) {
      alert('請填寫主題 / Design 名稱 / SQL')
      return
    }
    setBusy(true)
    try {
      await api.post(`/user-charts/admin/${adoptForm.chart.id}/adopt`, {
        topic_id: adoptForm.topic_id,
        design_name: adoptForm.design_name.trim(),
        sql_query: adoptForm.sql_query.trim(),
      })
      // refresh
      const r = await api.get('/user-charts/admin/popular?limit=100')
      setCharts(r.data || [])
      setAdoptForm(null)
    } catch (e: any) {
      alert('採納失敗:' + (e?.response?.data?.error || e?.message || 'unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Star className="text-amber-500" size={20} />
        <h2 className="text-lg font-semibold">{t('admin.chartAdoption.title', '使用者圖庫採納')}</h2>
      </div>
      <p className="text-sm text-slate-500">
        {t('admin.chartAdoption.desc', '由使用者在 chat 中收藏的熱門圖表。經採納後會建立對應的戰情室 design,並標記來源使用者圖表。')}
      </p>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">{t('common.loading', '載入中...')}</div>
      ) : charts.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">尚無使用者圖庫資料</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">標題</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">擁有者</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">來源</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">使用次數</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">分享數</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">最後更新</th>
                <th className="px-4 py-2 text-center font-medium text-slate-600">採納</th>
              </tr>
            </thead>
            <tbody>
              {charts.map(c => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 max-w-xs truncate">{c.title}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{c.owner_name || c.owner_id}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{c.source_tool}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.use_count || 0}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.share_count || 0}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{c.updated_at ? fmtDateTW(c.updated_at) : '-'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {c.adopted_design_id ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <Check size={12} />
                        已採納 (#{c.adopted_design_id})
                      </span>
                    ) : (
                      <button
                        onClick={() => setAdoptForm({ chart: c, design_name: c.title, sql_query: '' })}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        <ExternalLink size={11} />
                        採納
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adoptForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4">
            <div>
              <h3 className="font-semibold">採納為戰情室 official chart</h3>
              <p className="text-xs text-slate-500 mt-0.5 truncate">來源: {adoptForm.chart.title} (chart #{adoptForm.chart.id})</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700">主題</label>
              <select
                value={adoptForm.topic_id || ''}
                onChange={e => setAdoptForm(prev => prev ? { ...prev, topic_id: e.target.value ? Number(e.target.value) : undefined } : null)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="">--請選擇--</option>
                {topics.map(tp => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700">Design 名稱</label>
              <input
                type="text"
                value={adoptForm.design_name}
                onChange={e => setAdoptForm(prev => prev ? { ...prev, design_name: e.target.value } : null)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700">SQL Query</label>
              <textarea
                value={adoptForm.sql_query}
                onChange={e => setAdoptForm(prev => prev ? { ...prev, sql_query: e.target.value } : null)}
                rows={6}
                placeholder="SELECT ... 對應 chart 的 x_field / y_fields 欄位"
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm font-mono"
              />
              <p className="text-xs text-slate-400">
                提示:user chart 走 tool 路徑,戰情室走 SQL。需手動橋接 — 對 ERP/MCP tool 結果欄位寫對應 SQL。
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button onClick={() => setAdoptForm(null)} className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">
                取消
              </button>
              <button onClick={handleAdopt} disabled={busy} className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
                {busy ? '採納中...' : '確認採納'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
