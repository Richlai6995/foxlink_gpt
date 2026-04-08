import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../../lib/api'
import { Save, Loader2, Clock } from 'lucide-react'

interface SLAConfig {
  id: number
  priority: string
  first_response_hours: number
  resolution_hours: number
  escalation_enabled: number
}

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low']
const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400', high: 'text-orange-400', medium: 'text-blue-400', low: 'text-gray-500',
}

export default function FeedbackSLAConfig() {
  const { t } = useTranslation()
  const [configs, setConfigs] = useState<SLAConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [edits, setEdits] = useState<Record<string, Partial<SLAConfig>>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = async () => {
    try {
      const { data } = await api.get('/feedback/admin/sla-configs')
      setConfigs(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleChange = (priority: string, field: string, value: number) => {
    setEdits(prev => ({
      ...prev,
      [priority]: { ...prev[priority], [field]: value },
    }))
  }

  const handleSave = async (priority: string) => {
    const config = configs.find(c => c.priority === priority)
    if (!config) return
    const edit = edits[priority] || {}
    setSaving(priority)
    try {
      await api.put(`/feedback/admin/sla-configs/${priority}`, {
        first_response_hours: edit.first_response_hours ?? config.first_response_hours,
        resolution_hours: edit.resolution_hours ?? config.resolution_hours,
        escalation_enabled: edit.escalation_enabled ?? config.escalation_enabled,
      })
      setEdits(prev => { const n = { ...prev }; delete n[priority]; return n })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
    setSaving(null)
  }

  const getValue = (config: SLAConfig, field: keyof SLAConfig) => {
    return edits[config.priority]?.[field] ?? config[field]
  }

  const isChanged = (priority: string) => !!edits[priority]

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-400" /></div>

  const sorted = [...configs].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Clock size={14} /> {t('feedback.admin.slaConfig')}
      </h3>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">{t('feedback.priority')}</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">{t('feedback.admin.firstResponseHours')}</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">{t('feedback.admin.resolutionHours')}</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(config => (
              <tr key={config.priority} className="border-b border-gray-200/50 last:border-0">
                <td className="px-4 py-3">
                  <span className={`font-medium ${PRIORITY_COLORS[config.priority] || 'text-gray-700'}`}>
                    {t(`feedback.priorityLabels.${config.priority}`)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={getValue(config, 'first_response_hours')}
                    onChange={e => handleChange(config.priority, 'first_response_hours', Number(e.target.value))}
                    className="w-20 bg-white border border-gray-300 rounded px-2 py-1 text-center text-gray-900 text-sm"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={getValue(config, 'resolution_hours')}
                    onChange={e => handleChange(config.priority, 'resolution_hours', Number(e.target.value))}
                    className="w-20 bg-white border border-gray-300 rounded px-2 py-1 text-center text-gray-900 text-sm"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  {isChanged(config.priority) && (
                    <button
                      onClick={() => handleSave(config.priority)}
                      disabled={saving === config.priority}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving === config.priority ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                      {t('common.save')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        * SLA 計時從工單建立開始，24 小時全天計算。逾期工單會自動標記並通知管理員。
      </p>
    </div>
  )
}
