import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Power, History, Trash2, RefreshCw, ChevronDown, ChevronUp, Plus, Edit3, X, PlayCircle, Clock } from 'lucide-react'
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
  schedule_interval_minutes?: number | null
  last_evaluated_at?: string | null
  next_evaluate_at?: string | null
  last_eval_result?: string | null
  creation_date: string
  last_modified: string
}

interface AlertRuleFull extends AlertRule {
  data_source: string
  data_config: any
  comparison_config: any
  actions: any
  message_template: string | null
  use_llm_analysis: number
  dedup_key: string | null
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
  const [editing, setEditing] = useState<AlertRuleFull | null>(null)
  const [creating, setCreating] = useState(false)

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
        <div className="flex items-center gap-2">
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700">
            <Plus size={12} /> {t('admin.alertRules.addStandalone', '+ 新增獨立規則')}
          </button>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {t('common.refresh', '重新整理')}
          </button>
        </div>
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
              <th className="px-3 py-2 text-left font-medium">{t('admin.alertRules.col.schedule', '輪詢')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('admin.alertRules.col.cooldown', '冷卻(分)')}</th>
              <th className="px-3 py-2 text-center font-medium">{t('admin.alertRules.col.status', '狀態')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('admin.alertRules.col.actions', '操作')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">{loading ? t('common.loading', '載入中…') : t('admin.alertRules.empty', '尚無警示規則。請到「排程任務」加 alert 節點,或點右上「+ 新增獨立規則」建獨立 cron 規則。')}</td></tr>
            )}
            {filtered.map(r => (
              <Fragment key={r.id}>
                <tr className="border-t border-slate-100 hover:bg-slate-50">
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
                  <td className="px-3 py-2 text-slate-600">
                    {r.bound_to === 'standalone'
                      ? (r.schedule_interval_minutes
                          ? <span title={r.next_evaluate_at ? `next: ${new Date(r.next_evaluate_at).toLocaleString('zh-TW')}` : ''}>
                              <Clock size={10} className="inline mr-0.5 text-slate-400" />
                              每 {r.schedule_interval_minutes} 分
                            </span>
                          : <span className="text-rose-500" title="無 schedule_interval_minutes,scheduler 不會跑">未設</span>)
                      : <span className="text-slate-400 text-[10px]">隨任務</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.cooldown_minutes}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => toggleActive(r)} className={`p-1 rounded ${r.is_active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                      title={r.is_active ? t('admin.alertRules.clickToPause', '點擊暫停') : t('admin.alertRules.clickToActivate', '點擊啟用')}>
                      <Power size={13} />
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={async () => {
                      try {
                        const full = await api.get(`/alert-rules/${r.id}`)
                        setEditing(full.data)
                      } catch (e: any) { alert(e?.response?.data?.error || e.message) }
                    }} className="p-1 text-slate-400 hover:text-blue-600" title={t('common.edit', '編輯')}>
                      <Edit3 size={13} />
                    </button>
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
                    <td colSpan={10} className="px-4 py-3">
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
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-400">
        {t('admin.alertRules.editHint', '提示:Pipeline 繫結規則(bound_to=pipeline_node)的內容透過「排程任務」中對應 alert 節點編輯,儲存任務時會自動同步。獨立規則(bound_to=standalone)透過上方「+ 新增獨立規則」建立,scheduler 每分鐘 tick 評估到期的規則。')}
      </p>

      {/* Editor modal — 共用 create / edit */}
      {(creating || editing) && (
        <AlertRuleEditor
          mode={creating ? 'create' : 'edit'}
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Editor modal — for standalone rule create/edit ───────────────────────
interface EditorProps {
  mode: 'create' | 'edit'
  initial: AlertRuleFull | null
  onClose: () => void
  onSaved: () => void
}

function AlertRuleEditor({ mode, initial, onClose, onSaved }: EditorProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<any>(() => {
    if (initial) return {
      ...initial,
      data_config: initial.data_config || {},
      comparison_config: initial.comparison_config || {},
      actions: initial.actions || [{ type: 'alert_history' }],
    }
    return {
      rule_name: '',
      bound_to: 'standalone',
      severity: 'warning',
      entity_type: '',
      entity_code: '',
      data_source: 'sql_query',
      data_config: { sql: '' },
      comparison: 'threshold',
      comparison_config: { operator: 'gt', value: 0 },
      actions: [{ type: 'alert_history' }],
      message_template: '{{rule_name}} 觸發:{{entity_code}} 當前值 {{trigger_value}}({{reason}})',
      use_llm_analysis: 0,
      cooldown_minutes: 60,
      schedule_interval_minutes: 60,
      dedup_key: '',
      is_active: 1,
    }
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)

  const set = (k: string, v: any) => setForm({ ...form, [k]: v })
  const setData = (k: string, v: any) => setForm({ ...form, data_config: { ...form.data_config, [k]: v } })
  const setCmp = (k: string, v: any) => setForm({ ...form, comparison_config: { ...form.comparison_config, [k]: v } })
  const updateAction = (i: number, patch: any) => {
    const arr = [...(form.actions || [])]
    arr[i] = { ...arr[i], ...patch }
    set('actions', arr)
  }
  const addAction = (type: string) => set('actions', [...(form.actions || []), { type }])
  const removeAction = (i: number) => set('actions', (form.actions || []).filter((_: any, idx: number) => idx !== i))

  const save = async () => {
    if (!form.rule_name?.trim()) { alert('rule_name 必填'); return }
    if (!form.comparison) { alert('comparison 必填'); return }
    if (form.bound_to === 'standalone' && !form.schedule_interval_minutes) {
      alert('獨立規則必須設輪詢分鐘(schedule_interval_minutes)')
      return
    }
    if (form.bound_to === 'standalone' && form.data_source === 'upstream_json') {
      alert('獨立規則無 upstream JSON 可用,請改 sql_query 或 literal')
      return
    }
    setSaving(true)
    try {
      if (mode === 'edit' && initial?.id) {
        await api.put(`/alert-rules/${initial.id}`, form)
      } else {
        await api.post('/alert-rules', form)
      }
      onSaved()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setSaving(false) }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 用 inline rule 先建一筆 → /test → 刪
      const tempRes = await api.post('/alert-rules', { ...form, schedule_interval_minutes: null, is_active: 0 })
      const tempId = tempRes.data.id
      try {
        const r = await api.post(`/alert-rules/${tempId}/test`, { source_text: '' })
        setTestResult(r.data)
      } finally {
        await api.delete(`/alert-rules/${tempId}`).catch(() => {})
      }
    } catch (e: any) {
      setTestResult({ error: e?.response?.data?.error || e.message })
    } finally { setTesting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-500" />
            {mode === 'create' ? t('admin.alertRules.editor.createTitle', '新增獨立警示規則') : t('admin.alertRules.editor.editTitle', '編輯警示規則')}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          {/* 基本 */}
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <div>
              <label className="block text-slate-600 mb-1">規則名稱 *</label>
              <input className="input w-full" value={form.rule_name} onChange={e => set('rule_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">嚴重等級</label>
              <select className="input w-full" value={form.severity} onChange={e => set('severity', e.target.value)}>
                <option value="info">INFO</option>
                <option value="warning">WARNING</option>
                <option value="critical">CRITICAL</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-600 mb-1">標的類型</label>
              <input className="input w-full" value={form.entity_type || ''} onChange={e => set('entity_type', e.target.value)} placeholder="metal / fx / stock" />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">標的代碼</label>
              <input className="input w-full" value={form.entity_code || ''} onChange={e => set('entity_code', e.target.value)} placeholder="CU / EURUSD / AAPL" />
            </div>
          </div>

          {/* 繫結 + 輪詢 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-600 mb-1">繫結方式</label>
              <select className="input w-full" value={form.bound_to} onChange={e => set('bound_to', e.target.value)} disabled={mode === 'edit'}>
                <option value="standalone">standalone(獨立 cron 輪詢)</option>
                <option value="pipeline_node">pipeline_node(隨任務跑)</option>
              </select>
              {mode === 'edit' && <p className="text-[10px] text-slate-400 mt-0.5">已建立後不可改繫結方式</p>}
            </div>
            {form.bound_to === 'standalone' && (
              <div>
                <label className="block text-slate-600 mb-1">輪詢間隔(分鐘)*</label>
                <input type="number" className="input w-full" value={form.schedule_interval_minutes ?? ''} onChange={e => set('schedule_interval_minutes', Number(e.target.value))} placeholder="60" />
              </div>
            )}
          </div>

          {/* 資料源 */}
          <div>
            <label className="block text-slate-600 mb-1">資料來源</label>
            <select className="input w-full" value={form.data_source} onChange={e => { set('data_source', e.target.value); set('data_config', {}) }}>
              {form.bound_to !== 'standalone' && <option value="upstream_json">upstream JSON(從 pipeline 上游)</option>}
              <option value="sql_query">sql_query(SELECT 查 DB)</option>
              <option value="literal">literal(直接給數值,測試用)</option>
            </select>
            {form.data_source === 'upstream_json' && (
              <input className="input w-full mt-1 font-mono" value={form.data_config?.jsonpath || '$.value'}
                onChange={e => setData('jsonpath', e.target.value)} placeholder="$.price_usd" />
            )}
            {form.data_source === 'sql_query' && (
              <textarea className="input w-full mt-1 font-mono h-20" value={form.data_config?.sql || ''}
                onChange={e => setData('sql', e.target.value)}
                placeholder={`SELECT price_usd FROM pm_price_history\nWHERE metal_code='CU'\nORDER BY as_of_date DESC FETCH FIRST 8 ROWS ONLY`} />
            )}
            {form.data_source === 'literal' && (
              <input type="number" step="any" className="input w-full mt-1" value={form.data_config?.value ?? ''}
                onChange={e => setData('value', e.target.value)} placeholder="13190" />
            )}
            {form.data_source === 'sql_query' && form.comparison !== 'threshold' && (
              <p className="text-[10px] text-slate-400 mt-1">SQL 應回 N 筆數值;系統把最後一筆當 current,前面當歷史 series。</p>
            )}
          </div>

          {/* Comparison */}
          <div>
            <label className="block text-slate-600 mb-1">比較模式</label>
            <select className="input w-full" value={form.comparison} onChange={e => { set('comparison', e.target.value); set('comparison_config', {}) }}>
              <option value="threshold">threshold(絕對閾值)</option>
              <option value="historical_avg">historical_avg(偏離歷史平均)</option>
              <option value="rate_change">rate_change(變化率)</option>
              <option value="zscore">zscore(統計異常)</option>
            </select>
            {form.comparison === 'threshold' && (
              <div className="grid grid-cols-[1fr_2fr] gap-2 mt-1">
                <select className="input" value={form.comparison_config?.operator || 'gt'} onChange={e => setCmp('operator', e.target.value)}>
                  <option value="gt">{'>'}</option>
                  <option value="lt">{'<'}</option>
                  <option value="gte">{'≥'}</option>
                  <option value="lte">{'≤'}</option>
                  <option value="eq">{'='}</option>
                  <option value="ne">{'≠'}</option>
                </select>
                <input type="number" step="any" className="input" value={form.comparison_config?.value ?? ''} onChange={e => setCmp('value', Number(e.target.value))} placeholder="閾值" />
              </div>
            )}
            {form.comparison === 'historical_avg' && (
              <div className="grid grid-cols-2 gap-2 mt-1">
                <input type="number" className="input" value={form.comparison_config?.period_days ?? 7} onChange={e => setCmp('period_days', Number(e.target.value))} placeholder="period_days=7" />
                <input type="number" step="any" className="input" value={form.comparison_config?.deviation_pct ?? 20} onChange={e => setCmp('deviation_pct', Number(e.target.value))} placeholder="deviation_pct=20" />
              </div>
            )}
            {form.comparison === 'rate_change' && (
              <div className="grid grid-cols-3 gap-2 mt-1">
                <select className="input" value={form.comparison_config?.operator || 'abs'} onChange={e => setCmp('operator', e.target.value)}>
                  <option value="abs">|△|</option>
                  <option value="up">↑</option>
                  <option value="down">↓</option>
                </select>
                <input type="number" className="input" value={form.comparison_config?.period_days ?? 1} onChange={e => setCmp('period_days', Number(e.target.value))} placeholder="period_days=1" />
                <input type="number" step="any" className="input" value={form.comparison_config?.threshold_pct ?? 5} onChange={e => setCmp('threshold_pct', Number(e.target.value))} placeholder="threshold_pct=5" />
              </div>
            )}
            {form.comparison === 'zscore' && (
              <div className="grid grid-cols-2 gap-2 mt-1">
                <input type="number" className="input" value={form.comparison_config?.period_days ?? 30} onChange={e => setCmp('period_days', Number(e.target.value))} placeholder="period_days=30" />
                <input type="number" step="any" className="input" value={form.comparison_config?.sigma ?? 2} onChange={e => setCmp('sigma', Number(e.target.value))} placeholder="sigma=2" />
              </div>
            )}
          </div>

          {/* Message + LLM */}
          <div>
            <label className="block text-slate-600 mb-1">訊息模板</label>
            <textarea className="input w-full h-14" value={form.message_template || ''} onChange={e => set('message_template', e.target.value)}
              placeholder="{{rule_name}} 觸發:{{entity_code}} 當前 {{trigger_value}},基準 {{threshold_value}}" />
            <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
              <input type="checkbox" checked={!!form.use_llm_analysis} onChange={e => set('use_llm_analysis', e.target.checked ? 1 : 0)} />
              附加 LLM 分析(觸發時產一段意義說明)
            </label>
          </div>

          {/* Actions */}
          <div>
            <label className="block text-slate-600 mb-1">動作</label>
            <p className="text-[10px] text-slate-400 mb-1">alert_history 永遠執行(自動加)。Email / Webex / Webhook 視需要加。</p>
            <div className="space-y-1.5">
              {(form.actions || []).map((a: any, i: number) => (
                <div key={i} className="grid grid-cols-[80px_1fr_auto] gap-1.5 items-center">
                  <span className="text-xs px-2 py-1 bg-rose-100 text-rose-700 rounded">{a.type}</span>
                  {a.type === 'email' && (
                    <input className="input" value={Array.isArray(a.to) ? a.to.join(',') : (a.to || '')} onChange={e => updateAction(i, { to: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="user1@x.com,user2@y.com" />
                  )}
                  {a.type === 'webex' && (
                    <input className="input" value={a.room_id || ''} onChange={e => updateAction(i, { room_id: e.target.value })} placeholder="Webex room ID" />
                  )}
                  {a.type === 'webhook' && (
                    <input className="input" value={a.url || ''} onChange={e => updateAction(i, { url: e.target.value })} placeholder="https://hooks.example.com/..." />
                  )}
                  {a.type === 'alert_history' && (
                    <span className="text-[10px] text-slate-400">(永遠執行)</span>
                  )}
                  {a.type !== 'alert_history' && (
                    <button onClick={() => removeAction(i)} className="p-0.5 text-slate-300 hover:text-rose-500"><X size={12} /></button>
                  )}
                  {a.type === 'alert_history' && <span />}
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              {['email', 'webex', 'webhook'].map(t => (
                <button key={t} type="button" onClick={() => addAction(t)} className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-rose-400 hover:text-rose-600">+ {t}</button>
              ))}
            </div>
          </div>

          {/* Cooldown + dedup_key */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-600 mb-1">冷卻(分鐘)</label>
              <input type="number" className="input w-full" value={form.cooldown_minutes ?? 60} onChange={e => set('cooldown_minutes', Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">dedup_key(選填)</label>
              <input className="input w-full" value={form.dedup_key || ''} onChange={e => set('dedup_key', e.target.value)} placeholder="同 key 共用 cooldown" />
            </div>
          </div>

          {/* 啟用狀態 */}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked ? 1 : 0)} />
            <span className="text-slate-700">啟用(active)</span>
            {form.bound_to === 'standalone' && form.is_active === 1 && form.schedule_interval_minutes && (
              <span className="text-[10px] text-emerald-600 ml-2">→ scheduler 將每 {form.schedule_interval_minutes} 分評估一次</span>
            )}
          </label>

          {/* Test */}
          <div className="border-t border-slate-200 pt-3">
            <button onClick={runTest} disabled={testing || !form.comparison}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-rose-400 hover:text-rose-600 disabled:opacity-40">
              <PlayCircle size={12} /> {testing ? '試跑中…' : '試跑(模擬觸發,不真寄通知)'}
            </button>
            {testResult && (
              <pre className="mt-2 text-[10px] font-mono bg-slate-50 border border-slate-200 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">取消</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-xs rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">
            {saving ? '儲存中…' : (mode === 'create' ? '建立' : '更新')}
          </button>
        </div>
      </div>
    </div>
  )
}
