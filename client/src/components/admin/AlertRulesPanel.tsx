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
  schedule_count?: number
  active_schedule_count?: number
  next_schedule_at?: string | null
  schedule_cooldowns?: string | null  // 各 schedule cooldown 逗號/斜線清單,例 "1440/10080/43200"
  last_evaluated_at?: string | null
  next_evaluate_at?: string | null
  last_eval_result?: string | null
  creation_date: string
  last_modified: string
}

interface AlertSchedule {
  id?: number
  schedule_key: string
  schedule_cron_expr: string | null
  schedule_interval_minutes: number | null
  lookback_days: number | null
  cooldown_minutes: number
  is_active: number
  last_evaluated_at?: string | null
  next_evaluate_at?: string | null
  last_eval_result?: string | null
}

interface AlertRuleFull extends AlertRule {
  data_source: string
  data_config: any
  comparison_config: any
  actions: any
  message_template: string | null
  use_llm_analysis: number
  dedup_key: string | null
  schedules?: AlertSchedule[]
}

// ── 排程模式工具:cron-based(daily/weekly/monthly)+ interval-based(每 N 分鐘)──
type ScheduleKind = 'daily' | 'weekly' | 'monthly' | 'interval'
type SchedulePartial = { kind: ScheduleKind; hour?: number; minute?: number; weekday?: number; monthday?: number; intervalMin?: number }

function cronToParts(expr: string | null): SchedulePartial | null {
  if (!expr) return null
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [m, h, dom, mon, dow] = parts
  if (mon !== '*') return null
  const mi = Number(m), hi = Number(h)
  if (!Number.isFinite(mi) || !Number.isFinite(hi)) return null
  if (dom === '*' && dow === '*') return { kind: 'daily', hour: hi, minute: mi }
  if (dom === '*' && /^\d+$/.test(dow)) return { kind: 'weekly', hour: hi, minute: mi, weekday: Number(dow) }
  if (/^\d+$/.test(dom) && dow === '*') return { kind: 'monthly', hour: hi, minute: mi, monthday: Number(dom) }
  return null
}

function partsToCron(p: SchedulePartial): string | null {
  switch (p.kind) {
    case 'daily':    return `${p.minute ?? 0} ${p.hour ?? 8} * * *`
    case 'weekly':   return `${p.minute ?? 0} ${p.hour ?? 8} * * ${p.weekday ?? 1}`
    case 'monthly':  return `${p.minute ?? 0} ${p.hour ?? 8} ${p.monthday ?? 1} * *`
    case 'interval': return null  // interval 不用 cron
  }
}

// 從 schedule item 反推 SchedulePartial(支援 cron + interval)
function scheduleToParts(s: AlertSchedule): SchedulePartial {
  if (s.schedule_interval_minutes && s.schedule_interval_minutes > 0) {
    return { kind: 'interval', intervalMin: Number(s.schedule_interval_minutes) }
  }
  return cronToParts(s.schedule_cron_expr) || { kind: 'daily', hour: 8, minute: 0 }
}

// 確保 schedule_key 唯一(同一條 rule 內不衝突)
function ensureUniqueKey(kind: ScheduleKind, existing: AlertSchedule[]): string {
  const usedKeys = new Set((existing || []).map(s => s.schedule_key))
  if (!usedKeys.has(kind)) return kind
  let i = 2
  while (usedKeys.has(`${kind}_${i}`)) i++
  return `${kind}_${i}`
}

// 給定 schedule(cron 或 interval),前端純 JS 預估下 N 次
function predictScheduleNext(s: { schedule_cron_expr: string | null; schedule_interval_minutes: number | null }, count = 3): string[] {
  const now = new Date()
  const fmt = (d: Date) => {
    const wd = ['日','一','二','三','四','五','六'][d.getDay()]
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      ' (週' + wd + ') ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }
  const results: Date[] = []

  // interval 模式
  if (s.schedule_interval_minutes && s.schedule_interval_minutes > 0) {
    const stepMs = Number(s.schedule_interval_minutes) * 60 * 1000
    for (let i = 1; i <= count; i++) {
      results.push(new Date(now.getTime() + stepMs * i))
    }
    return results.map(fmt)
  }

  // cron 模式
  const p = cronToParts(s.schedule_cron_expr); if (!p) return []
  if (p.kind === 'daily') {
    for (let i = 0; results.length < count && i < 30; i++) {
      const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(p.hour ?? 8, p.minute ?? 0, 0, 0)
      if (d > now) results.push(d)
    }
  } else if (p.kind === 'weekly') {
    for (let i = 0; results.length < count && i < 60; i++) {
      const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(p.hour ?? 8, p.minute ?? 0, 0, 0)
      if (d.getDay() === (p.weekday ?? 1) && d > now) results.push(d)
    }
  } else if (p.kind === 'monthly') {
    for (let i = 0; results.length < count && i < 18; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, p.monthday ?? 1, p.hour ?? 8, p.minute ?? 0, 0, 0)
      if (d > now) results.push(d)
    }
  }
  return results.map(fmt)
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
                      ? ((r.schedule_count ?? 0) > 0
                          ? <span title={r.next_schedule_at ? `next: ${new Date(r.next_schedule_at).toLocaleString('zh-TW')}` : ''}>
                              <Clock size={10} className="inline mr-0.5 text-slate-400" />
                              {r.active_schedule_count ?? r.schedule_count} 個排程
                            </span>
                          : (r.schedule_interval_minutes
                              ? <span title={r.next_evaluate_at ? `next: ${new Date(r.next_evaluate_at).toLocaleString('zh-TW')}` : ''}>
                                  <Clock size={10} className="inline mr-0.5 text-slate-400" />
                                  每 {r.schedule_interval_minutes} 分(legacy)
                                </span>
                              : <span className="text-rose-500" title="尚未設定排程,scheduler 不會跑">未設</span>))
                      : <span className="text-slate-400 text-[10px]">隨任務</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {(r.bound_to === 'standalone' && (r.schedule_count ?? 0) > 0 && r.schedule_cooldowns)
                      ? (() => {
                          const arr = r.schedule_cooldowns.split('/').map(s => Number(s)).filter(Number.isFinite)
                          const allSame = arr.every(v => v === arr[0])
                          const fmt = (m: number) => m >= 1440 ? `${Math.round(m/1440)}d` : m >= 60 ? `${Math.round(m/60)}h` : `${m}m`
                          return allSame
                            ? <span title={`所有 schedule cooldown = ${arr[0]} 分`}>{arr[0]} 分</span>
                            : <span title={`各 schedule cooldown: ${r.schedule_cooldowns} 分`} className="font-mono text-[11px]">{arr.map(fmt).join(' / ')}</span>
                        })()
                      : r.cooldown_minutes}
                  </td>
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
      schedules: initial.schedules || [],
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
      schedule_interval_minutes: null,
      dedup_key: '',
      is_active: 1,
      schedules: [],
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
    if (form.bound_to === 'standalone' && form.data_source === 'upstream_json') {
      alert('獨立規則無 upstream JSON 可用,請改 sql_query 或 literal')
      return
    }
    // standalone:必須至少有一個排程(schedules 或 legacy interval)
    if (form.bound_to === 'standalone'
        && (!Array.isArray(form.schedules) || form.schedules.length === 0)
        && !form.schedule_interval_minutes) {
      alert('獨立規則必須設至少一個排程(日/週/月)')
      return
    }
    setSaving(true)
    try {
      if (mode === 'edit' && initial?.id) {
        const r = await api.put(`/alert-rules/${initial.id}`, form)
        if (r.data?._schedule_warnings?.length) {
          alert('排程設定有警告:\n' + r.data._schedule_warnings.join('\n'))
        }
      } else {
        const r = await api.post('/alert-rules', form)
        if (r.data?._schedule_warnings?.length) {
          alert('排程設定有警告:\n' + r.data._schedule_warnings.join('\n'))
        }
      }
      onSaved()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setSaving(false) }
  }

  // schedules 子表操作
  const setSchedules = (next: AlertSchedule[]) => setForm({ ...form, schedules: next })
  const addSchedule = (kind: ScheduleKind) => {
    const base: SchedulePartial = { kind, hour: 8, minute: 0 }
    if (kind === 'weekly') base.weekday = 1
    if (kind === 'monthly') base.monthday = 1
    if (kind === 'interval') base.intervalMin = 60
    // cooldown / lookback 預設值依模式
    const cooldownDefault =
      kind === 'daily'   ? 1440  :
      kind === 'weekly'  ? 10080 :
      kind === 'monthly' ? 43200 :
                           60     // interval default
    const lookbackDefault =
      kind === 'daily'   ? 1  :
      kind === 'weekly'  ? 5  :
      kind === 'monthly' ? 22 :
                           1   // interval 也用 1 天(短期變化)
    const newItem: AlertSchedule = {
      schedule_key: ensureUniqueKey(kind, form.schedules || []),
      schedule_cron_expr: kind === 'interval' ? null : partsToCron(base),
      schedule_interval_minutes: kind === 'interval' ? (base.intervalMin ?? 60) : null,
      lookback_days: lookbackDefault,
      cooldown_minutes: cooldownDefault,
      is_active: 1,
    }
    setSchedules([...(form.schedules || []), newItem])
  }
  const updateSchedule = (idx: number, patch: Partial<AlertSchedule>) => {
    const arr = [...(form.schedules || [])]
    arr[idx] = { ...arr[idx], ...patch }
    setSchedules(arr)
  }
  // 切換 kind(daily/weekly/monthly/interval)時自動 reset cron/interval 欄位
  const updateScheduleParts = (idx: number, patch: Partial<SchedulePartial>) => {
    const cur = form.schedules[idx]
    const curParts = scheduleToParts(cur)
    const next = { ...curParts, ...patch } as SchedulePartial

    if (next.kind === 'interval') {
      updateSchedule(idx, {
        schedule_cron_expr: null,
        schedule_interval_minutes: next.intervalMin ?? 60,
      })
    } else {
      // 從 interval 切換到 cron 模式時補預設 hour/minute
      if (curParts.kind === 'interval' && (next.hour == null || next.minute == null)) {
        next.hour = 8
        next.minute = 0
      }
      updateSchedule(idx, {
        schedule_cron_expr: partsToCron(next),
        schedule_interval_minutes: null,
      })
    }
  }
  const removeSchedule = (idx: number) => {
    setSchedules((form.schedules || []).filter((_: any, i: number) => i !== idx))
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

          {/* 繫結 */}
          <div>
            <label className="block text-slate-600 mb-1">繫結方式</label>
            <select className="input w-full" value={form.bound_to} onChange={e => set('bound_to', e.target.value)} disabled={mode === 'edit'}>
              <option value="standalone">standalone(獨立 cron 輪詢)</option>
              <option value="pipeline_node">pipeline_node(隨任務跑)</option>
            </select>
            {mode === 'edit' && <p className="text-[10px] text-slate-400 mt-0.5">已建立後不可改繫結方式</p>}
          </div>

          {/* 排程子表(standalone 才顯示)— 一條 rule 可掛多個 schedule(日/週/月) */}
          {form.bound_to === 'standalone' && (
            <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-slate-700 font-semibold">
                  排程設定 <span className="text-[10px] text-slate-400 font-normal">({(form.schedules || []).length} 個)</span>
                </label>
                <div className="flex gap-1">
                  <button type="button" onClick={() => addSchedule('daily')} className="text-[10px] px-2 py-0.5 rounded border border-slate-300 hover:border-rose-400 hover:text-rose-600">+ 日</button>
                  <button type="button" onClick={() => addSchedule('weekly')} className="text-[10px] px-2 py-0.5 rounded border border-slate-300 hover:border-rose-400 hover:text-rose-600">+ 週</button>
                  <button type="button" onClick={() => addSchedule('monthly')} className="text-[10px] px-2 py-0.5 rounded border border-slate-300 hover:border-rose-400 hover:text-rose-600">+ 月</button>
                  <button type="button" onClick={() => addSchedule('interval')} className="text-[10px] px-2 py-0.5 rounded border border-slate-300 hover:border-blue-400 hover:text-blue-600">+ 間隔</button>
                </div>
              </div>

              {(!form.schedules || form.schedules.length === 0) && (
                <p className="text-[10px] text-slate-400 italic">點上方 +日 / +週 / +月 / +間隔 加排程,可同時多個</p>
              )}

              <div className="space-y-2">
                {(form.schedules || []).map((s: AlertSchedule, idx: number) => {
                  const parts = scheduleToParts(s)
                  const nextRuns = predictScheduleNext(s, 3)
                  // 緊湊樣式:不依賴 .input class(那個 padding 太大),自己寫 minimal style
                  const compactInput = 'text-xs py-0 px-1 h-6 border border-slate-300 rounded bg-white focus:border-rose-400 focus:outline-none'
                  return (
                    <div key={idx} className="bg-white border border-slate-200 rounded px-2 py-1.5 space-y-1">
                      {/* Row 1: key tag + 模式 + 時間設定 + 刪除 — 全部 inline 不 wrap */}
                      <div className="flex items-center gap-1 text-xs">
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-mono text-[10px] whitespace-nowrap">{s.schedule_key}</span>
                        <select className={`${compactInput} w-14`}
                          value={parts.kind}
                          onChange={e => {
                            const newKind = e.target.value as ScheduleKind
                            updateScheduleParts(idx, {
                              kind: newKind,
                              weekday: newKind === 'weekly' ? (parts.weekday ?? 1) : undefined,
                              monthday: newKind === 'monthly' ? (parts.monthday ?? 1) : undefined,
                              intervalMin: newKind === 'interval' ? (parts.intervalMin ?? 60) : undefined,
                            })
                          }}>
                          <option value="daily">每天</option>
                          <option value="weekly">每週</option>
                          <option value="monthly">每月</option>
                          <option value="interval">間隔</option>
                        </select>

                        {parts.kind === 'interval' ? (
                          <>
                            <input type="number" min={1} max={1440} className={`${compactInput} w-14`}
                              value={parts.intervalMin ?? 60}
                              onChange={e => updateScheduleParts(idx, { intervalMin: Math.max(1, Number(e.target.value)) })} />
                            <span className="text-slate-500 text-[11px]">分鐘</span>
                          </>
                        ) : (
                          <>
                            {parts.kind === 'weekly' && (
                              <select className={`${compactInput} w-12`} value={parts.weekday ?? 1}
                                onChange={e => updateScheduleParts(idx, { weekday: Number(e.target.value) })}>
                                {['日','一','二','三','四','五','六'].map((d, i) => <option key={i} value={i}>週{d}</option>)}
                              </select>
                            )}
                            {parts.kind === 'monthly' && (
                              <input type="number" min={1} max={28} className={`${compactInput} w-10`}
                                value={parts.monthday ?? 1}
                                onChange={e => updateScheduleParts(idx, { monthday: Number(e.target.value) })} />
                            )}
                            <select className={`${compactInput} w-11`} value={parts.hour ?? 8}
                              onChange={e => updateScheduleParts(idx, { hour: Number(e.target.value) })}>
                              {Array.from({ length: 24 }, (_, i) => i).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
                            </select>
                            <span className="text-slate-400">:</span>
                            <select className={`${compactInput} w-11`} value={parts.minute ?? 0}
                              onChange={e => updateScheduleParts(idx, { minute: Number(e.target.value) })}>
                              {[0,15,30,45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                            </select>
                          </>
                        )}
                        <label className="flex items-center gap-0.5 cursor-pointer text-[11px] ml-auto">
                          <input type="checkbox" checked={!!s.is_active}
                            onChange={e => updateSchedule(idx, { is_active: e.target.checked ? 1 : 0 })} />
                          啟
                        </label>
                        <button type="button" onClick={() => removeSchedule(idx)} className="text-slate-300 hover:text-rose-500 ml-0.5"><X size={11} /></button>
                      </div>

                      {/* Row 2: lookback + cooldown — inline */}
                      <div className="flex items-center gap-2 text-[11px] text-slate-600">
                        <span>lookback</span>
                        <input type="number" className={`${compactInput} w-12`}
                          value={s.lookback_days ?? ''}
                          onChange={e => updateSchedule(idx, { lookback_days: e.target.value === '' ? null : Number(e.target.value) })}
                          placeholder="—" />
                        <span>天</span>
                        <span className="ml-2">冷卻</span>
                        <input type="number" className={`${compactInput} w-16`}
                          value={s.cooldown_minutes}
                          onChange={e => updateSchedule(idx, { cooldown_minutes: Number(e.target.value) })} />
                        <span>分</span>
                        <span className="text-slate-300 ml-auto text-[10px] font-mono">
                          {s.schedule_cron_expr ? s.schedule_cron_expr : `每 ${s.schedule_interval_minutes} 分`}
                        </span>
                      </div>

                      {/* Row 3: 下次預估 */}
                      {nextRuns.length > 0 && (
                        <div className="text-[10px] text-emerald-600 leading-tight">
                          ⏱ {nextRuns[0]}{nextRuns[1] ? ` → ${nextRuns[1]}` : ''}
                          {s.last_eval_result && <span className="text-slate-400 ml-2">last: {s.last_eval_result.slice(0, 40)}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">
                💡 SQL 內可寫 <code className="bg-slate-100 px-0.5">{`{{lookback_days}}`}</code> 變數,scheduler 評估時自動換成該 schedule 的 lookback_days 值。
              </p>
            </div>
          )}

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

          {/* Cooldown + dedup_key — standalone 有 schedules 子表時被覆蓋,隱藏避免誤會 */}
          {!(form.bound_to === 'standalone' && form.schedules?.length > 0) && (
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
          )}
          {form.bound_to === 'standalone' && form.schedules?.length > 0 && (
            <p className="text-[10px] text-slate-400 italic">
              💡 rule-level cooldown / dedup_key 在多排程模式下會被各 schedule 內的設定覆蓋,故隱藏避免誤會。
            </p>
          )}

          {/* 啟用狀態 */}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked ? 1 : 0)} />
            <span className="text-slate-700">啟用(active)</span>
            {form.bound_to === 'standalone' && form.is_active === 1 && (form.schedules?.length > 0) && (
              <span className="text-[10px] text-emerald-600 ml-2">→ scheduler 將依 {form.schedules.length} 個排程獨立評估</span>
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
