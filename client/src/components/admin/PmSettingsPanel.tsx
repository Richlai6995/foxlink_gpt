import { useState, useEffect } from 'react'
import { Cpu, Save, RefreshCw, Info } from 'lucide-react'
import api from '../../lib/api'

interface LlmModel {
  id: number
  key: string
  name: string
  api_model: string
  model_role?: string
  is_active: number
  sort_order: number
}

interface PmSettings {
  pm_pro_model_key: string
  pm_flash_model_key: string
  auto_pick_preview: { pro: string; flash: string }
}

export default function PmSettingsPanel() {
  const [models, setModels] = useState<LlmModel[]>([])
  const [settings, setSettings] = useState<PmSettings | null>(null)
  const [proKey, setProKey] = useState('')
  const [flashKey, setFlashKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [m, s] = await Promise.all([
        api.get('/admin/llm-models'),
        api.get('/admin/settings/pm-models'),
      ])
      setModels((m.data || []).filter((x: LlmModel) => x.is_active))
      setSettings(s.data)
      setProKey(s.data.pm_pro_model_key || '')
      setFlashKey(s.data.pm_flash_model_key || '')
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    setSaving(true)
    setSavedMsg('')
    try {
      const r = await api.put('/admin/settings/pm-models', {
        pm_pro_model_key: proKey,
        pm_flash_model_key: flashKey,
      })
      setSavedMsg(`✓ 已儲存${r.data.patched_tasks ? `,並更新了 ${r.data.patched_tasks} 個既有 PM 任務的 model 欄位` : ''}`)
      await load()
      setTimeout(() => setSavedMsg(''), 5000)
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setSaving(false) }
  }

  // 排序模型 — chat / 通用優先,其他角色排後
  const chatModels = models.filter(m => !m.model_role || m.model_role === 'chat' || m.model_role === '')
                            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  return (
    <div className="space-y-4 max-w-3xl">
      <header>
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Cpu size={18} className="text-amber-700" />
          PM 平台設定
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          設定 [PM] 系列排程任務(全網收集 / 日報 / 週報 / 月報 / 新聞 / 總體經濟)的預設 LLM 模型。儲存後系統會自動把既有 paused PM 任務的 model 欄位也一併更新。
        </p>
      </header>

      {/* Settings card */}
      <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-4">
        <div className="flex items-start gap-2 text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded p-2">
          <Info size={13} className="text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p>開發 / 生產環境的 LLM 模型 key 不一樣(prod 是「Gemini 3 Pro」「Gemini 3 Flash」、dev 可能是「pro」「flash」),所以這邊由 admin 在每個環境分別設定。</p>
            <p className="mt-1">若不設定,系統會嘗試自動 pick(根據 system_settings.default_chat_model_key + 模糊比對 llm_models 表),pick 結果見下方提示。</p>
          </div>
        </div>

        {/* Pro */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            PM Pro 模型(用於日報 / 週報 / 月報 / 全網收集 — 高品質深度分析)
          </label>
          <select
            className="input w-full"
            value={proKey}
            onChange={e => setProKey(e.target.value)}
            disabled={loading}
          >
            <option value="">(自動 — 由系統挑選)</option>
            {chatModels.map(m => (
              <option key={m.key} value={m.key}>
                {m.key}{m.name && m.name !== m.key ? ` — ${m.name}` : ''}{m.api_model ? ` [${m.api_model}]` : ''}
              </option>
            ))}
          </select>
          {!proKey && settings?.auto_pick_preview?.pro && (
            <p className="text-[10px] text-slate-400 mt-1">系統自動會選:<code className="bg-slate-100 px-1">{settings.auto_pick_preview.pro}</code></p>
          )}
        </div>

        {/* Flash */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            PM Flash 模型(用於每日新聞 / 總體經濟 — 量大要省 token)
          </label>
          <select
            className="input w-full"
            value={flashKey}
            onChange={e => setFlashKey(e.target.value)}
            disabled={loading}
          >
            <option value="">(自動 — 由系統挑選)</option>
            {chatModels.map(m => (
              <option key={m.key} value={m.key}>
                {m.key}{m.name && m.name !== m.key ? ` — ${m.name}` : ''}{m.api_model ? ` [${m.api_model}]` : ''}
              </option>
            ))}
          </select>
          {!flashKey && settings?.auto_pick_preview?.flash && (
            <p className="text-[10px] text-slate-400 mt-1">系統自動會選:<code className="bg-slate-100 px-1">{settings.auto_pick_preview.flash}</code></p>
          )}
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-2 border-t border-slate-200">
          <button
            onClick={save}
            disabled={saving || loading}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
          >
            <Save size={14} /> {saving ? '儲存中…' : '儲存設定'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {savedMsg && <span className="text-xs text-emerald-600">{savedMsg}</span>}
        </div>
      </div>

      {/* Helper context */}
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-xs text-slate-600 space-y-2">
        <p className="font-medium text-slate-700">PM 任務 model 對照(儲存時自動 patch 既有任務)</p>
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="text-left py-1">任務名稱</th>
              <th className="text-left py-1">用哪個模型</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100"><td className="py-1">[PM] 每日金屬新聞抓取</td><td className="py-1 font-mono">PM Flash</td></tr>
            <tr className="border-b border-slate-100"><td className="py-1">[PM] 總體經濟指標日抓</td><td className="py-1 font-mono">PM Flash</td></tr>
            <tr className="border-b border-slate-100"><td className="py-1">[PM] 全網金屬資料收集</td><td className="py-1 font-mono">PM Pro</td></tr>
            <tr className="border-b border-slate-100"><td className="py-1">[PM] 每日金屬日報</td><td className="py-1 font-mono">PM Pro</td></tr>
            <tr className="border-b border-slate-100"><td className="py-1">[PM] 金屬市場週報</td><td className="py-1 font-mono">PM Pro</td></tr>
            <tr><td className="py-1">[PM] 金屬市場月報</td><td className="py-1 font-mono">PM Pro</td></tr>
          </tbody>
        </table>
        <p className="text-[10px] text-slate-400 mt-2">
          注意:儲存後系統會把任務 model 從舊 alias('pro' / 'flash')替換成你選的真實 key。如果你已在排程編輯介面手動改過 task.model 為其他值(像直接寫 api_model 名),系統不會覆蓋(只 patch 仍是 'pro' / 'flash' 的)。
        </p>
      </div>
    </div>
  )
}
