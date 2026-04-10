import { useEffect, useState } from 'react'
import { Mic, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'

interface VoiceInputSettings {
  enabled: boolean
  preferBackendOnly: boolean
}

export default function VoiceInputSettingsPanel() {
  const { t } = useTranslation()
  const [data, setData] = useState<VoiceInputSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = async () => {
    try {
      const { data } = await api.get('/admin/settings/voice-input')
      setData(data)
    } catch {
      setData({ enabled: true, preferBackendOnly: false })
    }
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    if (!data) return
    setSaving(true)
    setMsg(null)
    try {
      await api.put('/admin/settings/voice-input', data)
      setMsg({ ok: true, text: t('voice_input.saveSuccess', '已儲存') })
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || t('voice_input.saveFailed', '儲存失敗') })
    } finally {
      setSaving(false)
    }
  }

  if (!data) return <div className="text-slate-500 text-sm p-4">載入中…</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Mic size={18} className="text-blue-600" />
        <h2 className="text-base font-semibold text-slate-800">{t('voice_input.settingsTitle', '語音輸入設定')}</h2>
      </div>

      <p className="text-xs text-slate-500">{t('voice_input.settingsDesc', '在聊天與問題反饋輸入框顯示麥克風按鈕，使用者可用語音轉文字輸入。')}</p>

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {/* enabled */}
        <label className="flex items-center justify-between p-4 cursor-pointer">
          <div>
            <div className="text-sm font-medium text-slate-800">{t('voice_input.enabled', '啟用語音輸入')}</div>
            <div className="text-xs text-slate-500 mt-0.5">關閉後，所有輸入框的麥克風按鈕將會隱藏。</div>
          </div>
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => setData({ ...data, enabled: e.target.checked })}
            className="w-5 h-5 accent-blue-600"
          />
        </label>

        {/* prefer backend only */}
        <label className="flex items-center justify-between p-4 cursor-pointer">
          <div className="pr-4">
            <div className="text-sm font-medium text-slate-800">{t('voice_input.preferBackendOnly', '僅使用後端轉錄')}</div>
            <div className="text-xs text-slate-500 mt-0.5">{t('voice_input.preferBackendOnlyHint', '若內網無法連線 Google 語音服務，建議開啟此選項以避免每次延遲 2 秒等待降級。')}</div>
          </div>
          <input
            type="checkbox"
            checked={data.preferBackendOnly}
            onChange={(e) => setData({ ...data, preferBackendOnly: e.target.checked })}
            className="w-5 h-5 accent-blue-600"
            disabled={!data.enabled}
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Save size={15} /> {saving ? '儲存中…' : '儲存'}
        </button>
        {msg && (
          <span className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</span>
        )}
      </div>
    </div>
  )
}
