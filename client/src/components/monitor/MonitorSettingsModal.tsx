import { useState, useEffect } from 'react'
import { X, Send } from 'lucide-react'
import api from '../../lib/api'

interface Props {
  open: boolean
  onClose: () => void
}

const defaultSettings: Record<string, string> = {
  monitor_metrics_retention_days: '7',
  monitor_disk_retention_days: '30',
  monitor_online_retention_days: '30',
  monitor_health_check_retention: '7',
  monitor_log_retention_days: '30',
  monitor_alert_enabled: 'true',
  monitor_alert_cooldown: '30',
  monitor_cpu_threshold: '90',
  monitor_mem_threshold: '85',
  monitor_disk_threshold: '85',
  monitor_load_threshold: '0.9',
  monitor_pod_restart_limit: '5',
  monitor_pod_pending_minutes: '10',
  monitor_alert_webhook_enabled: 'false',
  monitor_alert_webhook_type: 'teams',
  monitor_alert_webhook_url: '',
  monitor_ai_model: 'flash',
  monitor_dept_snapshot_interval: '5',
  monitor_dept_retention_days: '30',
}

export default function MonitorSettingsModal({ open, onClose }: Props) {
  const [settings, setSettings] = useState<Record<string, string>>({ ...defaultSettings })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!open) return
    api.get('/monitor/settings').then(({ data }) => {
      setSettings(prev => ({ ...prev, ...data }))
    }).catch(() => {})
  }, [open])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/monitor/settings', settings)
      onClose()
    } catch (e: unknown) {
      alert((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const testWebhook = async () => {
    setTesting(true)
    try {
      // Quick test: just call webhook directly from settings
      const type = settings.monitor_alert_webhook_type
      const url = settings.monitor_alert_webhook_url
      if (!url) { alert('請先填入 Webhook URL'); return }

      if (type === 'line') {
        await fetch('https://notify-api.line.me/api/notify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${url}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ message: '\n[TEST] FOXLINK GPT TO CORTEX Monitor 測試通知' }),
        })
      } else if (type === 'webex') {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: '✅ **[TEST] FOXLINK GPT TO CORTEX Monitor**\n\n這是一則測試通知' }),
        })
      } else {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            '@type': 'MessageCard',
            themeColor: '0076D7',
            summary: '[TEST] FOXLINK GPT TO CORTEX Monitor',
            sections: [{ activityTitle: '[TEST] FOXLINK GPT TO CORTEX Monitor', text: '這是一則測試通知', markdown: true }],
          }),
        })
      }
      alert('測試通知已發送')
    } catch (e: unknown) {
      alert(`發送失敗: ${(e as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  if (!open) return null

  const Field = ({ label, k, type = 'text' }: { label: string; k: string; type?: string }) => (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-slate-500">{label}</label>
      <input
        type={type}
        value={settings[k] || ''}
        onChange={e => setSettings(s => ({ ...s, [k]: e.target.value }))}
        className="text-xs border rounded px-2 py-1.5"
      />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[520px] max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">監控設定</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-5">
          {/* Retention */}
          <div>
            <h3 className="text-xs font-medium text-slate-700 mb-2">資料保留天數</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="節點/主機指標" k="monitor_metrics_retention_days" type="number" />
              <Field label="磁碟指標" k="monitor_disk_retention_days" type="number" />
              <Field label="線上人數" k="monitor_online_retention_days" type="number" />
              <Field label="健康檢查" k="monitor_health_check_retention" type="number" />
              <Field label="告警紀錄" k="monitor_log_retention_days" type="number" />
            </div>
          </div>

          {/* Thresholds */}
          <div>
            <h3 className="text-xs font-medium text-slate-700 mb-2">告警閾值</h3>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs text-slate-500">啟用告警</label>
              <button
                onClick={() => setSettings(s => ({
                  ...s,
                  monitor_alert_enabled: s.monitor_alert_enabled === 'true' ? 'false' : 'true',
                }))}
                className={`w-10 h-5 rounded-full transition ${settings.monitor_alert_enabled === 'true' ? 'bg-blue-600' : 'bg-slate-300'} relative`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition ${settings.monitor_alert_enabled === 'true' ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="CPU Request % 閾值" k="monitor_cpu_threshold" type="number" />
              <Field label="Memory % 閾值" k="monitor_mem_threshold" type="number" />
              <Field label="磁碟 % 閾值" k="monitor_disk_threshold" type="number" />
              <Field label="CPU Load/cores 比值" k="monitor_load_threshold" type="number" />
              <Field label="Pod restart 上限" k="monitor_pod_restart_limit" type="number" />
              <Field label="Pod pending 上限 (分鐘)" k="monitor_pod_pending_minutes" type="number" />
              <Field label="通知冷卻 (分鐘)" k="monitor_alert_cooldown" type="number" />
            </div>
          </div>

          {/* AI Diagnose */}
          <div>
            <h3 className="text-xs font-medium text-slate-700 mb-2">AI 故障診斷</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-0.5">
                <label className="text-xs text-slate-500">診斷模型</label>
                <select
                  value={settings.monitor_ai_model || 'flash'}
                  onChange={e => setSettings(s => ({ ...s, monitor_ai_model: e.target.value }))}
                  className="text-xs border rounded px-2 py-1.5"
                >
                  <option value="flash">Gemini Flash（快速）</option>
                  <option value="pro">Gemini Pro（深入）</option>
                </select>
              </div>
            </div>
          </div>

          {/* Dept Stats */}
          <div>
            <h3 className="text-xs font-medium text-slate-700 mb-2">部門統計</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="部門統計保留天數" k="monitor_dept_retention_days" type="number" />
            </div>
          </div>

          {/* Webhook */}
          <div>
            <h3 className="text-xs font-medium text-slate-700 mb-2">Webhook 設定</h3>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs text-slate-500">啟用 Webhook</label>
              <button
                onClick={() => setSettings(s => ({
                  ...s,
                  monitor_alert_webhook_enabled: s.monitor_alert_webhook_enabled === 'true' ? 'false' : 'true',
                }))}
                className={`w-10 h-5 rounded-full transition ${settings.monitor_alert_webhook_enabled === 'true' ? 'bg-blue-600' : 'bg-slate-300'} relative`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition ${settings.monitor_alert_webhook_enabled === 'true' ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  value={settings.monitor_alert_webhook_type || 'teams'}
                  onChange={e => setSettings(s => ({ ...s, monitor_alert_webhook_type: e.target.value }))}
                  className="text-xs border rounded px-2 py-1.5 w-40"
                >
                  <option value="teams">Microsoft Teams</option>
                  <option value="webex">Webex</option>
                  <option value="line">LINE Notify</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">
                  {settings.monitor_alert_webhook_type === 'line' ? 'LINE Notify Token' :
                   settings.monitor_alert_webhook_type === 'webex' ? 'Webex Webhook URL' : 'Teams Webhook URL'}
                </label>
                <input
                  value={settings.monitor_alert_webhook_url || ''}
                  onChange={e => setSettings(s => ({ ...s, monitor_alert_webhook_url: e.target.value }))}
                  placeholder={settings.monitor_alert_webhook_type === 'line' ? 'Bearer token' : 'https://...'}
                  className="text-xs border rounded px-2 py-1.5 w-full"
                />
              </div>
              <button
                onClick={testWebhook}
                disabled={testing}
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
              >
                <Send size={12} /> {testing ? '發送中...' : '測試發送'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">取消</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
