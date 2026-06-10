import { useState, useEffect } from 'react'
import { ArrowLeft, ScanSearch, Check, X, Ban, AlertTriangle, RefreshCw, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'

interface Candidate {
  emp_no: string
  email: string | null
  name: string
  dept_code: string | null
  profit_center: string | null
}

interface Suggestion {
  id: number
  user_id: number
  status: 'pending' | 'accepted' | 'rejected' | 'no_match' | 'conflict'
  tier: 'A' | 'B' | 'C' | null
  suggested_emp_no: string | null
  suggested_email: string | null
  suggested_name: string | null
  suggested_dept: string | null
  confidence: number | null
  reason: string | null
  candidates: Candidate[]
  conflict_user_id: number | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string | null
  username: string
  current_name: string | null
  current_emp_id: string | null
  current_emp_source: string | null
  current_email: string | null
  dept_name: string | null
  profit_center_name: string | null
  factory_code: string | null
  conflict_username: string | null
  conflict_name: string | null
  conflict_emp_id: string | null
}

type StatusTab = 'pending' | 'conflict' | 'no_match' | 'done'

interface Props { onBack: () => void; onChanged?: () => void }

export default function EmpMatchPanel({ onBack, onChanged }: Props) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [useLLM, setUseLLM] = useState(true)
  const [tab, setTab] = useState<StatusTab>('pending')
  const [msg, setMsg] = useState('')
  const [picks, setPicks] = useState<Record<number, string>>({}) // suggestionId → chosen emp_no
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/users/emp-match/suggestions')
      setRows(Array.isArray(r.data) ? r.data : [])
    } catch (e: any) { setMsg(e?.response?.data?.error || '載入失敗') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const scan = async () => {
    setScanning(true); setMsg('')
    try {
      const r = await api.post('/users/emp-match/scan', { useLLM })
      const d = r.data
      if (d.ok === false) setMsg(d.reason || '掃描失敗（ERP 未設定？）')
      else setMsg(t('users.empMatch.scanDone', { scanned: d.scanned, a: d.tierA, b: d.tierB, c: d.tierC, n: d.no_match,
        defaultValue: `掃描 ${d.scanned} 人：精確 ${d.tierA}、AI/多候選 ${d.tierB}、查無 ${d.no_match}` }))
      await load()
    } catch (e: any) { setMsg(e?.response?.data?.error || '掃描失敗') }
    finally { setScanning(false) }
  }

  const accept = async (s: Suggestion) => {
    const emp_no = picks[s.id] || s.suggested_emp_no
    if (!emp_no) { setMsg('此筆無工號，請先挑選候選'); return }
    setBusyId(s.id); setMsg('')
    try {
      await api.post(`/users/emp-match/suggestions/${s.id}/accept`, { emp_no })
      setMsg(`${s.current_name || s.username} → 工號 ${emp_no} 已寫入`)
      await load(); onChanged?.()
    } catch (e: any) {
      if (e?.response?.status === 409) {
        const c = e.response.data?.conflictUser
        setMsg(`⛔ 工號 ${emp_no} 已被帳號 ${c?.username}（${c?.name || ''}）占用，已標記衝突待人工處理`)
        await load()
      } else setMsg(e?.response?.data?.error || '寫入失敗')
    } finally { setBusyId(null) }
  }

  const reject = async (s: Suggestion) => {
    setBusyId(s.id)
    try { await api.post(`/users/emp-match/suggestions/${s.id}/reject`); await load() }
    catch (e: any) { setMsg(e?.response?.data?.error || '操作失敗') }
    finally { setBusyId(null) }
  }

  const exempt = async (s: Suggestion) => {
    const reason = prompt(t('users.empMatch.exemptReasonPrompt', '標記為共用/管理帳號，永久跳過比對。原因：') as string, '共用/管理帳號')
    if (reason === null) return
    setBusyId(s.id)
    try { await api.post(`/users/emp-match/users/${s.user_id}/exempt`, { reason }); await load(); onChanged?.() }
    catch (e: any) { setMsg(e?.response?.data?.error || '操作失敗') }
    finally { setBusyId(null) }
  }

  // batch accept 所有 tier A pending（高信心精確命中）
  const batchAcceptA = async () => {
    const targets = rows.filter(r => r.status === 'pending' && r.tier === 'A' && r.suggested_emp_no)
    if (!targets.length) return
    if (!confirm(t('users.empMatch.batchConfirm', { n: targets.length, defaultValue: `批次接受 ${targets.length} 筆精確命中？` }) as string)) return
    setScanning(true)
    let ok = 0, conflict = 0
    for (const s of targets) {
      try { await api.post(`/users/emp-match/suggestions/${s.id}/accept`, { emp_no: s.suggested_emp_no }); ok++ }
      catch (e: any) { if (e?.response?.status === 409) conflict++ }
    }
    setMsg(`批次完成：寫入 ${ok}、衝突 ${conflict}`)
    await load(); onChanged?.()
    setScanning(false)
  }

  const counts = {
    pending: rows.filter(r => r.status === 'pending').length,
    conflict: rows.filter(r => r.status === 'conflict').length,
    no_match: rows.filter(r => r.status === 'no_match').length,
    done: rows.filter(r => r.status === 'accepted' || r.status === 'rejected').length,
  }
  const view = rows.filter(r =>
    tab === 'done' ? (r.status === 'accepted' || r.status === 'rejected') : r.status === tab
  )
  const tierAcount = rows.filter(r => r.status === 'pending' && r.tier === 'A' && r.suggested_emp_no).length

  const confColor = (c: number | null) =>
    c == null ? 'text-slate-400' : c >= 0.9 ? 'text-green-600' : c >= 0.6 ? 'text-amber-600' : 'text-red-500'
  const TierBadge = ({ tier }: { tier: string | null }) => {
    const map: Record<string, { c: string; l: string }> = {
      A: { c: 'bg-green-100 text-green-700', l: t('users.empMatch.tierA', '精確') },
      B: { c: 'bg-blue-100 text-blue-700', l: t('users.empMatch.tierB', 'AI/多候選') },
      C: { c: 'bg-slate-100 text-slate-500', l: t('users.empMatch.tierC', '無中文名') },
    }
    const m = tier ? map[tier] : null
    return m ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${m.c}`}>{m.l}</span> : null
  }

  const TABS: { key: StatusTab; label: string; color: string }[] = [
    { key: 'pending', label: t('users.empMatch.tabPending', '待審'), color: 'blue' },
    { key: 'conflict', label: t('users.empMatch.tabConflict', '工號衝突'), color: 'red' },
    { key: 'no_match', label: t('users.empMatch.tabNoMatch', '查無/建議豁免'), color: 'amber' },
    { key: 'done', label: t('users.empMatch.tabDone', '已處理'), color: 'slate' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 text-sm">
            <ArrowLeft size={15} /> {t('common.back', '返回')}
          </button>
          <h2 className="text-lg font-semibold text-slate-800">{t('users.empMatch.title', 'ERP 補資料')}</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {msg && <span className="text-xs text-blue-600 max-w-md truncate" title={msg}>{msg}</span>}
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={useLLM} onChange={e => setUseLLM(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
            {t('users.empMatch.useLLM', 'AI 語意比對')}
          </label>
          <button onClick={scan} disabled={scanning}
            className="btn-primary flex items-center gap-1.5 text-sm">
            <ScanSearch size={15} className={scanning ? 'animate-pulse' : ''} />
            {scanning ? t('users.empMatch.scanning', '掃描中…') : t('users.empMatch.scan', '掃描補資料')}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-3 leading-relaxed">
        {t('users.empMatch.intro', '以「姓名」反查 ERP 員工主檔，補上缺失的工號 / Email。AI 只處理混英文名或同名多人的情況；精確唯一命中可直接批次接受。共用/管理帳號請標記「免比對」永久跳過。')}
      </p>

      {/* Status tabs */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition flex items-center gap-1.5 ${
              tab === tb.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
            }`}>
            {tb.label}
            <span className={`px-1.5 rounded-full ${tab === tb.key ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{counts[tb.key]}</span>
          </button>
        ))}
        {tab === 'pending' && tierAcount > 0 && (
          <button onClick={batchAcceptA} disabled={scanning}
            className="ml-auto px-3 py-1.5 rounded-full text-xs font-medium bg-green-600 text-white hover:bg-green-700 flex items-center gap-1.5">
            <Check size={13} /> {t('users.empMatch.batchAcceptA', { n: tierAcount, defaultValue: `批次接受精確命中 (${tierAcount})` })}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">{t('users.empMatch.colAccount', '帳號 / 現值')}</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">{t('users.empMatch.colSuggestion', 'AI 建議')}</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">{t('users.empMatch.colConfidence', '信心 / 原因')}</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600">{t('users.cols.action', '操作')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">{t('common.loading', '載入中…')}</td></tr>
              ) : view.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">{t('common.noData', '尚無資料')}</td></tr>
              ) : view.map(s => {
                const chosen = picks[s.id] || s.suggested_emp_no || ''
                const isHistory = s.status === 'accepted' || s.status === 'rejected'
                return (
                  <tr key={s.id} className={`align-top ${s.status === 'conflict' ? 'bg-red-50/40' : ''}`}>
                    {/* 帳號 / 現值 */}
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800">{s.current_name || '-'} <span className="text-slate-400 font-normal">@{s.username}</span></div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {t('users.cols.employeeId', '工號')}: {s.current_emp_id || <span className="text-amber-600">缺</span>}
                        {' · '}Email: {s.current_email && s.current_email !== '-' ? s.current_email : <span className="text-amber-600">缺</span>}
                      </div>
                      {(s.dept_name || s.factory_code) && (
                        <div className="text-[11px] text-slate-400 mt-0.5">{[s.dept_name, s.profit_center_name, s.factory_code].filter(Boolean).join(' / ')}</div>
                      )}
                    </td>

                    {/* AI 建議 */}
                    <td className="px-3 py-2.5">
                      {s.status === 'no_match' ? (
                        <span className="text-xs text-slate-400 italic">{t('users.empMatch.noMatch', '查無對應')}</span>
                      ) : s.status === 'conflict' ? (
                        <div className="text-xs">
                          <div className="text-red-600 font-medium flex items-center gap-1"><AlertTriangle size={12} /> {t('users.empMatch.conflict', '工號衝突')}</div>
                          <div className="text-slate-600 mt-0.5">{t('users.empMatch.conflictDetail', { emp: s.suggested_emp_no, user: `${s.conflict_username}（${s.conflict_name || ''}）`, defaultValue: `工號 ${s.suggested_emp_no} 已被 ${s.conflict_username}（${s.conflict_name || ''}）使用` })}</div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <TierBadge tier={s.tier} />
                            <span className="font-medium text-slate-800">{s.suggested_name || '?'}</span>
                          </div>
                          {/* 候選 ≥2 → 下拉挑選；否則直接顯示 */}
                          {s.candidates.length > 1 && !isHistory ? (
                            <select value={chosen} onChange={e => setPicks(p => ({ ...p, [s.id]: e.target.value }))}
                              className="mt-1 text-xs border border-slate-300 rounded px-1.5 py-1 bg-white max-w-[260px]">
                              <option value="">{t('users.empMatch.pickCandidate', '— 選擇候選 —')}</option>
                              {s.candidates.map(c => (
                                <option key={c.emp_no} value={c.emp_no}>
                                  {c.emp_no} · {c.name} · {[c.dept_code, c.profit_center].filter(Boolean).join('/')}{c.email ? ` · ${c.email}` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="text-xs text-slate-600 mt-0.5">
                              <span className="inline-flex items-center gap-1">
                                <ChevronRight size={11} className="text-slate-400" />
                                {t('users.cols.employeeId', '工號')} <b className="text-slate-800">{s.suggested_emp_no || '-'}</b>
                                {s.suggested_email && <> · {s.suggested_email}</>}
                              </span>
                              {s.suggested_dept && <div className="text-[11px] text-slate-400 ml-4">{s.suggested_dept}</div>}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 信心 / 原因 */}
                    <td className="px-3 py-2.5 text-xs">
                      {s.confidence != null && <span className={`font-semibold ${confColor(s.confidence)}`}>{Math.round(s.confidence * 100)}%</span>}
                      {s.reason && <div className="text-slate-500 mt-0.5 max-w-[220px]">{s.reason}</div>}
                      {isHistory && (
                        <div className="text-[11px] text-slate-400 mt-1">
                          {s.status === 'accepted' ? '✅ ' : '🚫 '}{s.reviewed_by} · {s.reviewed_at}
                        </div>
                      )}
                    </td>

                    {/* 操作 */}
                    <td className="px-3 py-2.5">
                      {!isHistory && (
                        <div className="flex items-center justify-end gap-1">
                          {(s.status === 'pending' || s.status === 'conflict') && (s.suggested_emp_no || picks[s.id]) && (
                            <button onClick={() => accept(s)} disabled={busyId === s.id}
                              className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-40" title={t('users.empMatch.accept', '接受寫入')}>
                              {busyId === s.id ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}
                            </button>
                          )}
                          {s.status === 'pending' && (
                            <button onClick={() => reject(s)} disabled={busyId === s.id}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-500 disabled:opacity-40" title={t('users.empMatch.reject', '拒絕（這筆建議錯）')}>
                              <X size={15} />
                            </button>
                          )}
                          <button onClick={() => exempt(s)} disabled={busyId === s.id}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40" title={t('users.empMatch.exempt', '共用/管理帳號，永久免比對')}>
                            <Ban size={15} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
