import { useState, useEffect } from 'react'
import { History, Trash2, Clock, Save, Play, ShieldAlert, MessageSquare, CalendarClock, Database, Zap, Search, FlaskConical, BarChart2 } from 'lucide-react'
import api from '../../lib/api'

interface CleanupSettings {
  audit_days: number
  audit_sensitive_days: number
  llm_days: number
  scheduled_task_days: number
  dify_days: number
  kb_query_days: number
  skill_days: number
  research_days: number
  token_usage_days: number
  auto_enabled: boolean
  auto_hour: number
}

interface CleanupStats {
  audit_normal: number
  audit_sensitive: number
  llm_sessions: number
  scheduled_task_runs: number
  dify_call_logs: number
  kb_query_logs: number
  skill_call_logs: number
  research_jobs: number
  token_usage: number
}

const DEFAULT: CleanupSettings = {
  audit_days: 90, audit_sensitive_days: 365,
  llm_days: 90, scheduled_task_days: 90,
  dify_days: 90, kb_query_days: 90,
  skill_days: 90, research_days: 90,
  token_usage_days: 365,
  auto_enabled: false, auto_hour: 2,
}

function DaysInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="number" min={1} max={3650} value={value}
          onChange={(e) => onChange(Math.max(1, Number(e.target.value)))}
          className="input w-20 py-1 text-sm"
        />
        <span className="text-xs text-slate-400">天</span>
      </div>
    </div>
  )
}

interface SectionProps {
  icon: React.ReactNode
  title: string
  desc: string
  children: React.ReactNode
}
function Section({ icon, title, desc, children }: SectionProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
      </div>
      <p className="text-xs text-slate-400 mb-4">{desc}</p>
      {children}
    </div>
  )
}

export default function DbMaintenance() {
  const [settings, setSettings] = useState<CleanupSettings>(DEFAULT)
  const [saving, setSaving] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [cleanupStats, setCleanupStats] = useState<CleanupStats | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.get('/admin/settings/cleanup').then((res) => {
      setSettings((prev) => ({ ...prev, ...res.data }))
    }).catch(() => {})
  }, [])

  const set = <K extends keyof CleanupSettings>(key: K, val: CleanupSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await api.put('/admin/settings/cleanup', settings)
      setMessage('✅ 設定已儲存' + (settings.auto_enabled ? `，每日 ${String(settings.auto_hour).padStart(2, '0')}:00 自動清除` : ''))
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || '儲存失敗'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleManualCleanup = async () => {
    if (!confirm('確定立即執行清除？此操作不可復原。')) return
    setCleaningUp(true)
    setMessage('')
    setCleanupStats(null)
    try {
      const res = await api.post('/admin/db/cleanup')
      setCleanupStats(res.data.stats)
      const s = res.data.stats as CleanupStats
      const total = Object.values(s).reduce((a, b) => a + b, 0)
      setMessage(`✅ 清除完成，共刪除 ${total} 筆資料`)
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || '清除失敗'}`)
    } finally {
      setCleaningUp(false)
    }
  }

  const statItems = cleanupStats ? [
    { label: '稽核日誌（一般）', value: cleanupStats.audit_normal, color: 'text-slate-600' },
    { label: '稽核日誌（敏感）', value: cleanupStats.audit_sensitive, color: 'text-orange-600' },
    { label: 'LLM 對話', value: cleanupStats.llm_sessions, color: 'text-blue-600' },
    { label: '排程任務執行', value: cleanupStats.scheduled_task_runs, color: 'text-indigo-600' },
    { label: 'API 連接器呼叫', value: cleanupStats.dify_call_logs, color: 'text-purple-600' },
    { label: 'KB 查詢', value: cleanupStats.kb_query_logs, color: 'text-teal-600' },
    { label: '技能呼叫', value: cleanupStats.skill_call_logs, color: 'text-yellow-600' },
    { label: '研究任務', value: cleanupStats.research_jobs, color: 'text-red-600' },
    { label: 'Token 統計', value: cleanupStats.token_usage, color: 'text-cyan-600' },
  ] : []

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-120px)] pr-1">
      <div className="flex items-center gap-2 mb-5">
        <History size={20} className="text-blue-500" />
        <h2 className="text-lg font-semibold text-slate-800">歷史資料清除設定</h2>
      </div>

      {/* 稽核日誌 */}
      <Section
        icon={<ShieldAlert size={16} className="text-orange-500" />}
        title="稽核日誌清除"
        desc="超過保留天數的稽核對話將被刪除。敏感對話可設定更長保留時間。"
      >
        <div className="flex gap-6">
          <DaysInput label="一般稽核對話保留天數" value={settings.audit_days} onChange={(v) => set('audit_days', v)} />
          <DaysInput label="敏感稽核對話保留天數" value={settings.audit_sensitive_days} onChange={(v) => set('audit_sensitive_days', v)} />
        </div>
      </Section>

      {/* LLM 問答 */}
      <Section
        icon={<MessageSquare size={16} className="text-blue-500" />}
        title="LLM 問答資料清除"
        desc="清除 Sidebar 對話歷史及上傳附件，超過此天數的對話將被刪除。"
      >
        <DaysInput label="對話歷史保留天數" value={settings.llm_days} onChange={(v) => set('llm_days', v)} />
      </Section>

      {/* 排程任務 */}
      <Section
        icon={<CalendarClock size={16} className="text-indigo-500" />}
        title="排程任務歷史紀錄清除"
        desc="清除排程任務執行歷史及產出附件，超過此天數的執行紀錄將被刪除。"
      >
        <DaysInput label="排程執行歷史保留天數" value={settings.scheduled_task_days} onChange={(v) => set('scheduled_task_days', v)} />
      </Section>

      {/* API Connector */}
      <Section
        icon={<Database size={16} className="text-purple-500" />}
        title="API 連接器呼叫紀錄清除"
        desc="清除早於此天數的 API 連接器呼叫紀錄。"
      >
        <DaysInput label="API 連接器呼叫紀錄保留天數" value={settings.dify_days} onChange={(v) => set('dify_days', v)} />
      </Section>

      {/* 自建 KB */}
      <Section
        icon={<Search size={16} className="text-teal-500" />}
        title="自建知識庫呼叫紀錄清除"
        desc="清除早於此天數的自建知識庫查詢紀錄（包含召回測試及對話查詢）。"
      >
        <DaysInput label="知識庫查詢紀錄保留天數" value={settings.kb_query_days} onChange={(v) => set('kb_query_days', v)} />
      </Section>

      {/* 技能 */}
      <Section
        icon={<Zap size={16} className="text-yellow-500" />}
        title="技能呼叫紀錄清除"
        desc="清除早於此天數的技能呼叫紀錄及附件。"
      >
        <DaysInput label="技能呼叫紀錄保留天數" value={settings.skill_days} onChange={(v) => set('skill_days', v)} />
      </Section>

      {/* 研究任務 */}
      <Section
        icon={<FlaskConical size={16} className="text-red-500" />}
        title="研究任務資料清除"
        desc="清除早於此天數的深度研究任務及產出附件。"
      >
        <DaysInput label="研究任務保留天數" value={settings.research_days} onChange={(v) => set('research_days', v)} />
      </Section>

      {/* Token 使用統計 */}
      <Section
        icon={<BarChart2 size={16} className="text-cyan-500" />}
        title="Token 使用統計清除"
        desc="清除早於此天數的 Token 使用量統計資料（token_usage 表）。"
      >
        <DaysInput label="Token 統計保留天數" value={settings.token_usage_days} onChange={(v) => set('token_usage_days', v)} />
      </Section>

      {/* Auto schedule + actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-slate-500" />
          <h3 className="font-semibold text-slate-700 text-sm">自動清除排程</h3>
        </div>
        <p className="text-xs text-slate-400 mb-4">以上所有清除動作依此排程自動執行。</p>

        <div className="flex items-center gap-4 bg-slate-50 rounded-xl p-3 mb-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_enabled}
              onChange={(e) => set('auto_enabled', e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            每天自動清除
          </label>
          {settings.auto_enabled && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">執行時間</span>
              <select
                value={settings.auto_hour}
                onChange={(e) => set('auto_hour', Number(e.target.value))}
                className="input py-1 w-20 text-sm"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Save size={14} /> {saving ? '儲存中...' : '儲存設定'}
          </button>
          <button
            onClick={handleManualCleanup}
            disabled={cleaningUp}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition text-sm"
          >
            <Play size={14} /> {cleaningUp ? '清除中...' : '立即手動清除'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {cleanupStats && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Trash2 size={16} className="text-red-500" />
            <h3 className="font-semibold text-slate-700 text-sm">清除結果</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {statItems.map((s) => (
              <div key={s.label} className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 mb-1 leading-tight">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-400">筆</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {message && (
        <div className={`p-3 rounded-xl text-sm ${message.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message}
        </div>
      )}
    </div>
  )
}
