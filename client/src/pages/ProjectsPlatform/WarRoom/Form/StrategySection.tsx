/**
 * StrategySection — 🎯 議價策略(v0.16 plan #13 · 10 欄 + AI 輔助填)
 *
 * 欄位存 form.strategy(S2:非全視角 GET ▒▒▒ / PUT 403);round_no 由議價輪次自動。
 * AI 建議(Pro):吃官方版/底線/議價輪次脈絡 → 填空草稿(user 看過才存)。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Loader2, Lock, Target, Sparkles } from 'lucide-react'

const FIELDS: { key: string; label: string; type?: 'textarea' | 'select'; options?: string[]; ph?: string; req?: boolean }[] = [
  { key: 'min_margin', label: '內部底線毛利率 %', ph: '14.0', req: true },
  { key: 'compete_price', label: '競品市場價格(USD)', ph: '13.5', req: true },
  { key: 'fallback', label: '最低可接受價(USD)', ph: '11.80' },
  { key: 'win_prob', label: '贏單機率', type: 'select', options: ['HIGH', 'MEDIUM', 'LOW'] },
  { key: 'cust_room', label: '客戶議價空間描述', type: 'textarea', req: true },
  { key: 'past_discount', label: '過往折讓記錄', type: 'textarea' },
  { key: 'strategy_note', label: '議價策略筆記', type: 'textarea' },
  { key: 'qty_discount', label: '量價條件', type: 'textarea', ph: '150k → -2% / 250k → -3.5%' },
  { key: 'special_terms', label: '特殊條件', type: 'textarea', ph: 'NRE 分期 / 模具攤提…' },
]

export default function StrategySection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [vals, setVals] = useState<Record<string, string>>({})
  const [roundNo, setRoundNo] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!token) return
    api.get<any>(token, `/bom/form?projectId=${projectId}`).then((r) => {
      const st = r.form?.strategy || {}
      if (Object.values(st).some((v: any) => v === '▒▒▒')) { setLocked(true); return }
      setVals(st)
    }).catch(() => {})
    api.get<any>(token, `/bom/negotiation?projectId=${projectId}`).then((n) => {
      setRoundNo(n?.rounds?.length ? n.rounds.length : null)
    }).catch(() => {})
  }, [token, projectId])   // eslint-disable-line

  if (locked) return (
    <div className="p-6 text-center space-y-2">
      <Lock className="w-8 h-8 mx-auto text-cortex-muted" />
      <div className="text-[13px] font-bold text-cortex-ink">議價策略已鎖定</div>
      <div className="text-[11px] text-cortex-muted">內部策略需完整成本視角(HOST/admin)。</div>
    </div>
  )

  const set = (k: string, v: string) => { setVals((p) => ({ ...p, [k]: v })); setDirty(true) }
  async function save() {
    setBusy(true); setMsg('')
    try {
      await api.put(token, '/bom/form/strategy', { projectId, fields: vals })
      setDirty(false); setMsg('✓ 已存檔'); window.dispatchEvent(new CustomEvent('cortex:form-refresh'))
      setTimeout(() => setMsg(''), 2500)
    } catch (e: any) { setMsg(`存檔失敗:${e.message}`) } finally { setBusy(false) }
  }
  async function aiSuggest() {
    setAiBusy(true); setMsg('')
    try {
      const r = await api.post<any>(token, '/bom/strategy/ai-suggest', { projectId })
      const s = r.suggest || {}
      setVals((p) => ({
        ...p,
        cust_room: p.cust_room || s.cust_room || '',
        strategy_note: p.strategy_note || s.strategy_note || '',
        qty_discount: p.qty_discount || s.qty_discount || '',
        win_prob: p.win_prob || s.win_prob || '',
        fallback: p.fallback || String(s.fallback ?? '') || '',
      }))
      setDirty(true); setMsg('✨ AI 草稿已填入空欄(確認後按存檔)')
    } catch (e: any) { setMsg(`AI 建議失敗:${e.message}`) } finally { setAiBusy(false) }
  }
  const filledN = FIELDS.filter((f) => (vals[f.key] || '').trim()).length + (roundNo ? 1 : 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2"><Target className="w-4 h-4" /> 議價策略
          <span className="text-[10px] text-cortex-muted font-normal">{filledN} / {FIELDS.length + 1} 欄(內部 · 機密)</span>
        </h3>
        <div className="flex items-center gap-2">
          {msg && <span className={`text-[10px] ${/✓|✨/.test(msg) ? 'text-green-600' : 'text-red-600'}`}>{msg}</span>}
          <button onClick={aiSuggest} disabled={aiBusy}
            className="flex items-center gap-1 px-2.5 py-1 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40 text-[11px]">
            {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI 建議(Pro)
          </button>
          <button onClick={save} disabled={busy || !dirty}
            className="px-2.5 py-1 bg-cortex-navy text-white rounded hover:opacity-90 disabled:opacity-40 text-[11px]">
            {busy ? <Loader2 className="w-3 h-3 inline animate-spin" /> : null} 存檔
          </button>
        </div>
      </div>
      <div className="text-[10px] text-cortex-muted bg-cortex-bg/40 border border-cortex-line rounded p-2">
        議價輪次:<b className="text-cortex-ink">{roundNo ? `第 ${roundNo} 輪(自動 · 見 成本核算 → 議價紀錄)` : '尚未開始議價'}</b>
        · AI 建議會引用官方版/底線/議價歷程,只填空欄不覆蓋已填值
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {FIELDS.map((f) => (
          <label key={f.key} className={`text-[10px] text-cortex-muted ${f.type === 'textarea' ? 'col-span-2' : ''}`}>
            {f.label}{f.req && <span className="text-red-400"> *</span>}
            {f.type === 'select' ? (
              <select value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value)}
                className="mt-0.5 w-full border border-cortex-line rounded px-2 py-1 text-[12px] bg-white text-cortex-ink">
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o === 'HIGH' ? 'HIGH(高)' : o === 'MEDIUM' ? 'MEDIUM(中)' : 'LOW(低)'}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} rows={2} placeholder={f.ph}
                className="mt-0.5 w-full border border-cortex-line rounded px-2 py-1 text-[12px] text-cortex-ink" />
            ) : (
              <input value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.ph}
                className="mt-0.5 w-full border border-cortex-line rounded px-2 py-1 text-[12px] font-mono text-cortex-ink" />
            )}
          </label>
        ))}
      </div>
    </div>
  )
}
