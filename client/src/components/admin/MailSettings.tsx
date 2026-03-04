import { useState, useEffect } from 'react'
import { Mail, Save, Send } from 'lucide-react'
import type { MailSettings } from '../../types'
import api from '../../lib/api'

export default function MailSettingsPanel() {
  const [settings, setSettings] = useState<MailSettings>({})
  const [testEmail, setTestEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.get('/admin/mail-settings').then((res) => setSettings(res.data))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await api.put('/admin/mail-settings', settings)
      setMessage('✅ 設定已儲存')
    } catch (e) {
      setMessage('❌ 儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!testEmail.trim()) return
    setTesting(true)
    setMessage('')
    try {
      const res = await api.post('/admin/mail-settings/test', { to: testEmail })
      setMessage(res.data.success ? '✅ 測試郵件發送成功' : '❌ 發送失敗')
    } catch (e) {
      setMessage('❌ 發送失敗，請確認設定')
    } finally {
      setTesting(false)
    }
  }

  const F = (key: keyof MailSettings) => ({
    value: settings[key] || '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setSettings((p) => ({ ...p, [key]: e.target.value })),
  })

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Mail size={20} className="text-blue-500" />
        <h2 className="text-lg font-semibold text-slate-800">郵件伺服器設定</h2>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-lg">
        <div className="grid gap-4">
          <div>
            <label className="label">SMTP 伺服器</label>
            <input {...F('server')} placeholder="smtp.example.com" className="input" />
          </div>
          <div>
            <label className="label">Port</label>
            <input {...F('port')} placeholder="25" className="input" />
          </div>
          <div>
            <label className="label">使用者名稱</label>
            <input {...F('username')} placeholder="user@example.com" className="input" />
          </div>
          <div>
            <label className="label">密碼</label>
            <input {...F('password')} type="password" placeholder="••••••••" className="input" />
          </div>
          <div>
            <label className="label">發件人地址</label>
            <input {...F('from')} placeholder="noreply@foxlink.com" className="input" />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary w-full mt-5 flex items-center justify-center gap-2"
        >
          <Save size={15} /> {saving ? '儲存中...' : '儲存設定'}
        </button>
      </div>

      {/* Test */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-lg mt-4">
        <h3 className="font-medium text-slate-700 mb-3">發送測試郵件</h3>
        <div className="flex gap-2">
          <input
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="收件人 Email"
            className="input flex-1"
          />
          <button
            onClick={handleTest}
            disabled={testing}
            className="btn-primary flex items-center gap-1.5"
          >
            <Send size={14} /> {testing ? '發送中...' : '發送'}
          </button>
        </div>
      </div>

      {message && (
        <p className={`mt-3 text-sm ${message.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>
          {message}
        </p>
      )}
    </div>
  )
}
