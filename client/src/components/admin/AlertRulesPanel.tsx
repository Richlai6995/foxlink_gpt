import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Power, History, Trash2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../../lib/api'

interface AlertRule {
  id: number
  rule_name: string
  owner_user_id: number | null
  bound_to: string
  task_id: number | null
  node_id: string | null
  entity_type: string | null
  entity_code: string | null
  comparison: string
  severity: string
  is_active: number
  cooldown_minutes: number
  creation_date: string
  last_modified: string
}

interface AlertHistoryRow {
  id: number
  triggered_at: string
  severity: string
  entity_type: string | null
  entity_code: string | null
  trigger_value: number | null
  threshold_value: number | null
  message: string
  llm_analysis: string | null
  channels_sent: string | null
}

const SEVERITY_COLOR: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-rose-100 text-rose-700',
}

export default function AlertRulesPanel() {
  const { t } = useTranslation()
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [history, setHistory] = useState<Record<number, AlertHistoryRow[]>>({})
  const [historyLoading, setHistoryLoading] = useState<number | null>(null)
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'paused'>('all')
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'info' | 'warning' | 'critical'>('all')

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/alert-rules')
      setRules(r.data || [])
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleActive = async (rule: AlertRule) => {
    try {
      await api.put(`/alert-rules/${rule.id}`, { is_active: rule.is_active ? 0 : 1 })
      await load()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    }
  }

  const remove = async (rule: AlertRule) => {
    if (!confirm(t('admin.alertRules.confirmDelete', { name: rule.rule_name }))) return
    try {
      await api.delete(`/alert-rules/${rule.id}`)
      await load()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    }
  }

  const loadHistory = async (id: number) => {
    setHistoryLoading(id)
    try {
      const r = await api.get(`/alert-rules/${id}/history?limit=20`)
      setHistory({ ...history, [id]: r.data || [] })
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally {
      setHistoryLoading(null)
    }
  }

  const toggleExpand = async (id: number) => {
    if (expanded === id) {
      setExpanded(null)
    } else {
      setExpanded(id)
      if (!history[id]) await loadHistory(id)
    }
  }

  const filtered = rules.filter(r => {
    if (filterActive === 'active' && !r.is_active) return false
    if (filterActive === 'paused' && r.is_active) return false
    if (filterSeverity !== 'all' && r.severity !== filterSeverity) return false
    return true
  })

  return (
    <div className="space-y-3">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-500" />
            {t('admin.alertRules.title', '警示規則')}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('admin.alertRules.description', '管理 Phase 3 警示節點對應規則 + 獨立規則。Pipeline 內的 alert 節點會自動同步一筆規則(by task_id+node_id)。')}</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh', '重新整理')}
        </button>
      </header>

      {/* Filters */}
      <div className="flex items-center gap-3 text-xs bg-slate-50 border border-slate-200 rounded p-2">
        <span className="text-slate-500">{t('admin.alertRules.filterStatus', '狀態')}:</span>
        {(['all', 'active', 'paused'] as const).map(s => (
          <button key={s} onClick={() => setFilterActive(s)}
            className={`px-2 py-0.5 rounded ${filterActive === s ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}>
            {t(`admin.alertRules.filter.${s}`, s)}
          </button>
        ))}
        <span className="text-slate-300 mx-1">|</span>
        <span className="text-slate-500">{t('admin.alertRules.filterSeverity', '嚴重等級')}:</span>
        {(['all', 'info', 'warning', 'critical'] as const).map(s => (
          <button key={s} onClick={() => setFilterSeverity(s)}
            className={`px-2 py-0.5 rounded ${filterSeverity === s ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}>
            {s.toUpperCase()}
          </button>
        ))}
        <span className="ml-auto text-slate-400">{t('admin.alertRules.totalCount', '共 {{n}} 筆', { n: filtered.length })}</span>
      </div>

      {/* Rules table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-8"></th>
              <th className="px-3 py-2 text-left font-medium">{t('admin.alertRules.col.name', '規則名')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('admin.alertRules.col.severity', '嚴重等級')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('admin.alertRules.col.entity', '標的')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('admin.alertRules.col.comparison', '比較模式')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('admin.alertRules.col.boundTo', '繫結')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('admin.alertRules.col.cooldown', '冷卻(分)')}</th>
              <th className="px-3 py-2 text-center font-medium">{t('admin.alertRules.col.status', '狀態')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('admin.alertRules.col.actions', '操作')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">{loading ? t('common.loading', '載入中…') : t('admin.alertRules.empty', '尚無警示規則。請到「排程任務」加 alert 節點,儲存時會自動產生對應規則。')}</td></tr>
            )}
            {filtered.map(r => (
              <>
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => toggleExpand(r.id)} className="text-slate-400 hover:text-slate-700">
                      {expanded === r.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-700">{r.rule_name}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SEVERITY_COLOR[r.severity] || 'bg-slate-100 text-slate-600'}`}>
                      {(r.severity || 'warning').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {r.entity_type ? `${r.entity_type}/${r.entity_code || '?'}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 font-mono">{r.comparison}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {r.bound_to === 'pipeline_node' ? `task #${r.task_id}` : 'standalone'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.cooldown_minutes}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => toggleActive(r)} className={`p-1 rounded ${r.is_active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                      title={r.is_active ? t('admin.alertRules.clickToPause', '點擊暫停') : t('admin.alertRules.clickToActivate', '點擊啟用')}>
                      <Power size={13} />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => loadHistory(r.id).then(() => setExpanded(r.id))} className="p-1 text-slate-400 hover:text-blue-600" title={t('admin.alertRules.viewHistory', '查看歷史')}>
                      <History size={13} />
                    </button>
                    <button onClick={() => remove(r)} className="p-1 text-slate-400 hover:text-rose-500" title={t('common.delete', '刪除')}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr className="bg-slate-50 border-t border-slate-100">
                    <td colSpan={9} className="px-4 py-3">
                      <div className="text-xs text-slate-700 mb-2 font-medium">
                        <History size={12} className="inline mr-1" />
                        {t('admin.alertRules.recentHistory', '最近觸發紀錄')}
                        {historyLoading === r.id && <span className="ml-2 text-slate-400">({t('common.loading', '載入中')})</span>}
                      </div>
                      {(history[r.id] || []).length === 0 && historyLoading !== r.id && (
                        <p className="text-xs text-slate-400">{t('admin.alertRules.noHistory', '尚無觸發紀錄')}</p>
                      )}
                      {(history[r.id] || []).map(h => (
                        <div key={h.id} className="border border-slate-200 rounded bg-white p-2 mb-1 text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SEVERITY_COLOR[h.severity] || 'bg-slate-100'}`}>
                              {(h.severity || 'warning').toUpperCase()}
                            </span>
                            <span className="text-slate-500">{new Date(h.triggered_at).toLocaleString('zh-TW')}</span>
                            {h.channels_sent && <span className="text-slate-400 text-[10px]">→ {h.channels_sent}</span>}
                          </div>
                          <p className="text-slate-700 mb-0.5">
                            {h.entity_type && `[${h.entity_type}/${h.entity_code}] `}
                            <span className="font-medium">{h.trigger_value}</span> vs <span className="text-slate-500">{h.threshold_value}</span>
                          </p>
                          <p className="text-slate-600 whitespace-pre-wrap">{h.message}</p>
                          {h.llm_analysis && (
                            <details className="mt-1 text-slate-500">
                              <summary className="cursor-pointer text-blue-600 hover:text-blue-700 text-[10px]">LLM 分析</summary>
                              <p className="mt-1 whitespace-pre-wrap text-[10px]">{h.llm_analysis}</p>
                            </details>
                          )}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-400">
        {t('admin.alertRules.editHint', '提示:規則內容(資料源 / 比較條件 / 動作 / 訊息模板)透過「排程任務」中對應 alert 節點編輯,儲存任務時會自動同步到此。獨立規則(bound_to=standalone)目前需透過 API 建立,UI 編輯器待 Phase 3.1 加入。')}
      </p>
    </div>
  )
}
