import { useState, useEffect } from 'react'
import { Cpu, Save, RefreshCw, Info, BookOpen, Trash2, AlertTriangle, Eye, Loader2 } from 'lucide-react'
import api from '../../lib/api'
import HelpBookShareInline from './HelpBookShareInline'

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
      const patched = r.data.patched_tasks || 0
      const skipped = r.data.skipped_custom_tasks || 0
      let msg = '✓ 已儲存'
      if (patched > 0) msg += `,更新了 ${patched} 個既有 PM 任務 model`
      if (skipped > 0) msg += `(${skipped} 個 user 自訂的不動)`
      setSavedMsg(msg)
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

      {/* ──── 資料保留設定 ──── */}
      <PmRetentionSection />

      {/* ──── 閱讀權限分享(快捷入口,管理同一份 help_book_shares 資料)──── */}
      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={16} className="text-amber-500" />
          <h3 className="text-sm font-medium text-slate-800">閱讀權限分享</h3>
          <span className="text-xs text-slate-400">— 誰能看「貴金屬情報」menu / 進 /pm/briefing / 用 PM Webex Bot</span>
        </div>
        <div className="text-xs text-slate-500 mb-3 bg-blue-50 border border-blue-100 rounded p-2">
          💡 <strong>建議用 department(部門)或 role(角色)整批授權</strong>,人事異動會自動跟,不用 admin 手動改 user 清單。
          典型做法:加一筆「<code>department = 採購部 dept_code</code>」全採購部立即可用。
        </div>
        <HelpBookShareInline bookCode="precious-metals" />
        <p className="text-[10px] text-slate-400 mt-3 border-t pt-2">
          這份設定也會在「特殊說明書管理 → 貴金屬書 [🔗 分享]」同步顯示(同一份資料,雙入口管理)。
        </p>
      </div>
    </div>
  )
}

// ── PmRetentionSection ──────────────────────────────────────────────────────
// 資料保留天數:每個 entity 各自設定,空 = 永久保留。daily 凌晨 3:00 自動跑。
interface RetentionTarget {
  key: string
  label: string
  days: number | null
  will_remove: number
  total: number
  oldest: string | null
  kb_paired?: { kb_name: string; will_remove: number; total: number; oldest: string | null }
  _error?: string
  _note?: string
}
interface RetentionConfig { [key: string]: number | null }

function PmRetentionSection() {
  const [targets, setTargets] = useState<RetentionTarget[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({}) // input 值(string,空字串=永久)
  const [schedule, setSchedule] = useState<{ enabled: boolean; hour: number; minute: number; running: boolean; cron_expr: string | null }>({
    enabled: true, hour: 3, minute: 0, running: false, cron_expr: null,
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingSched, setSavingSched] = useState(false)
  const [running, setRunning] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [schedMsg, setSchedMsg] = useState('')
  const [runResult, setRunResult] = useState<any>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/admin/settings/pm-retention')
      setTargets(r.data.targets || [])
      const d: Record<string, string> = {}
      for (const t of r.data.targets || []) {
        d[t.key] = t.days == null ? '' : String(t.days)
      }
      setDraft(d)
      if (r.data.schedule) setSchedule(r.data.schedule)
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const saveSchedule = async () => {
    setSavingSched(true)
    setSchedMsg('')
    try {
      const r = await api.put('/admin/settings/pm-retention/schedule', {
        enabled: schedule.enabled,
        hour: schedule.hour,
        minute: schedule.minute,
      })
      setSchedule(r.data.schedule)
      setSchedMsg(`✓ 已套用 — ${r.data.schedule.running ? `下次執行 ${String(r.data.schedule.hour).padStart(2, '0')}:${String(r.data.schedule.minute).padStart(2, '0')}` : '已停用自動排程'}`)
      setTimeout(() => setSchedMsg(''), 5000)
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setSavingSched(false) }
  }

  const save = async () => {
    setSaving(true)
    setSavedMsg('')
    try {
      const config: RetentionConfig = {}
      for (const k of Object.keys(draft)) {
        const v = draft[k].trim()
        config[k] = v === '' ? null : Number(v)
      }
      const r = await api.put('/admin/settings/pm-retention', config)
      setTargets(r.data.targets || [])
      setSavedMsg('✓ 已儲存設定(每天 03:00 自動清,或下方按「立即執行」)')
      setTimeout(() => setSavedMsg(''), 5000)
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setSaving(false) }
  }

  const runNow = async () => {
    const willRemoveTotal = targets.reduce((s, t) => s + (t.will_remove || 0) + (t.kb_paired?.will_remove || 0), 0)
    if (!confirm(`確定立即清理 ${willRemoveTotal} 筆過期資料?(此操作不可復原)`)) return
    setRunning(true)
    setRunResult(null)
    try {
      const r = await api.post('/admin/settings/pm-retention/run')
      setRunResult(r.data.result)
      setTargets(r.data.after?.targets || [])
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally { setRunning(false) }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Trash2 size={16} className="text-rose-500" />
        <h3 className="text-sm font-medium text-slate-800">資料保留設定</h3>
        <span className="text-xs text-slate-400">
          — 自動清過期資料{schedule.running && schedule.cron_expr ? `,目前排程: 每天 ${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}` : ',已停用自動排程'}
        </span>
      </div>

      {/* 排程時間設定 */}
      <div className="border border-slate-200 rounded p-2 bg-slate-50 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={e => setSchedule({ ...schedule, enabled: e.target.checked })}
              disabled={loading}
            />
            啟用每日自動清理
          </label>
          <span className="text-xs text-slate-500">每天</span>
          <input
            type="number" min="0" max="23"
            value={schedule.hour}
            onChange={e => setSchedule({ ...schedule, hour: Number(e.target.value) })}
            disabled={loading || !schedule.enabled}
            className="w-14 text-center px-1 py-1 border border-slate-300 rounded text-xs disabled:bg-slate-100"
          />
          <span className="text-xs text-slate-500">:</span>
          <input
            type="number" min="0" max="59"
            value={schedule.minute}
            onChange={e => setSchedule({ ...schedule, minute: Number(e.target.value) })}
            disabled={loading || !schedule.enabled}
            className="w-14 text-center px-1 py-1 border border-slate-300 rounded text-xs disabled:bg-slate-100"
          />
          <span className="text-xs text-slate-400">(24 小時制)</span>
          <button
            onClick={saveSchedule}
            disabled={savingSched || loading}
            className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Save size={12} /> {savingSched ? '套用中…' : '套用排程'}
          </button>
          {schedMsg && <span className="text-xs text-emerald-600">{schedMsg}</span>}
        </div>
        <div className="text-[10px] text-slate-400">
          建議避開 06:00–09:00(PM 排程任務正在跑),凌晨 02:00–04:00 是好選擇。改完按「套用排程」立即生效,不用重啟 server。
        </div>
      </div>

      <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          天數欄位<strong>留空 = 永久保留</strong>;設數字 N 表示「N 天前的資料會被清掉」。
          KB 跟對應 table 已綁同一個天數(避免 SUMMARY 點開找不到 KB 全文)。
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-3 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 載入中…
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-slate-500 border-b border-slate-200">
            <tr>
              <th className="text-left py-1.5 px-1">資料項目</th>
              <th className="text-right py-1.5 px-1">總筆</th>
              <th className="text-right py-1.5 px-1">最舊</th>
              <th className="text-right py-1.5 px-1">會清掉</th>
              <th className="text-center py-1.5 px-1 w-32">保留天數</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(t => (
              <tr key={t.key} className="border-b border-slate-100">
                <td className="py-1.5 px-1">
                  <div className="text-slate-800">{t.label}</div>
                  {t.kb_paired && (
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      └ 連動 {t.kb_paired.kb_name}:{t.kb_paired.total} docs,最舊 {t.kb_paired.oldest || '—'},會清 {t.kb_paired.will_remove}
                    </div>
                  )}
                  {t._error && <div className="text-[10px] text-red-600 mt-0.5">⚠ {t._error}</div>}
                  {t._note && <div className="text-[10px] text-slate-400 mt-0.5">{t._note}</div>}
                </td>
                <td className="py-1.5 px-1 text-right font-mono">{t.total}</td>
                <td className="py-1.5 px-1 text-right text-slate-500 font-mono">{t.oldest || '—'}</td>
                <td className="py-1.5 px-1 text-right font-mono">
                  {t.days == null ? <span className="text-slate-400">—</span> : (
                    <span className={t.will_remove > 0 ? 'text-rose-600 font-medium' : 'text-slate-400'}>
                      {t.will_remove}
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-1">
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    placeholder="永久"
                    value={draft[t.key] ?? ''}
                    onChange={e => setDraft({ ...draft, [t.key]: e.target.value })}
                    className="w-full text-center px-1 py-1 border border-slate-300 rounded text-xs"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
        <button
          onClick={save}
          disabled={saving || loading}
          className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
        >
          <Save size={13} /> {saving ? '儲存中…' : '儲存設定'}
        </button>
        <button
          onClick={load}
          disabled={loading}
          title="重新統計各 entity 筆數"
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
        >
          <Eye size={13} /> 重新預覽
        </button>
        <button
          onClick={runNow}
          disabled={running || loading}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
        >
          <Trash2 size={13} /> {running ? '清理中…' : '立即執行清理'}
        </button>
        {savedMsg && <span className="text-xs text-emerald-600 ml-2">{savedMsg}</span>}
      </div>

      {runResult && (
        <div className="border border-emerald-200 bg-emerald-50 rounded p-2 text-xs space-y-1">
          <div className="font-medium text-emerald-700">✓ 清理完成 — {new Date(runResult.ran_at).toLocaleString()}</div>
          {(runResult.summary || []).map((s: any) => (
            <div key={s.key} className="text-slate-600 ml-2">
              <span className="font-medium">{s.label}</span>:
              {s.skipped ? <span className="text-slate-400 ml-1">{s.skipped}</span>
                : s.error ? <span className="text-red-600 ml-1">❌ {s.error}</span>
                : <span className="text-slate-700 ml-1 font-mono">{Object.entries(s).filter(([k]) => !['key','label','days'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' / ')}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
