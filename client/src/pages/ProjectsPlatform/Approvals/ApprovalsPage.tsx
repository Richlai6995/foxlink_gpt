/**
 * ApprovalsPage — Sprint P · 我的待批
 *
 * spec roadmap Sprint P 多級簽核 + reviewer
 *
 * Sidebar 入口「📝 待批」開啟
 * 列當前 user 待批的 chain steps,可 approve / reject + comment
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, XCircle, RefreshCw, Loader2, AlertTriangle, FileCheck, Clock, ChevronRight, Briefcase } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import { useCrumbs } from '../Shell/PlatformContext'

type Pending = {
  chain_id: number
  chain_kind: string
  title: string
  reason?: string | null
  step_order: number
  current_step_order: number
  total_steps: number
  approver_role?: string | null
  step_kind?: string
  project_id: number
  project_code: string
  project_title?: string | null
  requested_by_user_id?: number | null
  requester_name?: string | null
  requester_username?: string | null
  expires_at?: string | null
  created_at: string
}

const KIND_LABEL: Record<string, { label: string; color: string }> = {
  high_amount:           { label: '高金額',     color: 'bg-cortex-amber-bg text-amber-800' },
  confidential_upgrade:  { label: '機密升級',   color: 'bg-cortex-red-bg/40 text-red-700' },
  lifecycle_close:       { label: '結案簽核',   color: 'bg-cortex-cyan-bg text-cortex-teal' },
  stage_gate:            { label: 'Stage Gate', color: 'bg-purple-100 text-purple-700' },
}

export default function ApprovalsPage() {
  useCrumbs([{ label: '📝 待批' }])
  const { token } = useAuth() as any
  const navigate = useNavigate()
  const [list, setList] = useState<Pending[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.get<{ pending: Pending[] }>(token, '/approvals/pending')
      setList(r.pending || [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (p: Pending, decision: 'approved' | 'rejected') => {
    const comment = prompt(`${decision === 'approved' ? '批准' : '拒絕'} ${p.title}?(備註可空):`)
    if (comment === null) return
    setBusyId(p.chain_id)
    try {
      await api.post(token, `/approvals/chains/${p.chain_id}/decide`, {
        step_order: p.step_order,
        decision,
        comment,
      })
      load()
    } catch (e: any) {
      alert('決定失敗:' + e.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-cortex-ink tracking-tight">📝 待批簽核</h1>
          <div className="text-[12px] text-cortex-muted mt-1">
            多級簽核 · 你被指派的 active 簽核步驟 · spec Sprint P
          </div>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded hover:bg-cortex-bg"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      {err && (
        <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-2 text-[12px] text-red-700">
          <AlertTriangle size={11} className="inline -mt-px mr-1" /> {err}
        </div>
      )}

      {loading && (
        <div className="text-center text-cortex-muted text-[13px] py-8">
          <Loader2 size={16} className="inline animate-spin mr-1" /> 載入中…
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="bg-white border border-cortex-line rounded-xl p-8 text-center">
          <FileCheck size={36} className="mx-auto text-cortex-green mb-2" />
          <div className="text-[14px] font-bold text-cortex-ink mb-1">✓ 沒有待批簽核</div>
          <div className="text-[12px] text-cortex-muted">所有指派給你的步驟都已決定</div>
        </div>
      )}

      <div className="space-y-2">
        {list.map((p) => {
          const k = KIND_LABEL[p.chain_kind] || { label: p.chain_kind, color: 'bg-cortex-line-2 text-cortex-text' }
          const expired = p.expires_at && new Date(p.expires_at).getTime() < Date.now()
          return (
            <div key={`${p.chain_id}-${p.step_order}`} className="bg-white border border-cortex-line rounded-lg p-3.5 hover:shadow-cortex transition">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${k.color}`}>
                      {k.label}
                    </span>
                    <span className="text-[14px] font-bold text-cortex-ink truncate">{p.title}</span>
                    {p.approver_role && (
                      <span className="text-[9px] font-mono text-cortex-muted">via role:{p.approver_role}</span>
                    )}
                    {expired && (
                      <span className="text-[9px] font-bold text-red-600 bg-cortex-red-bg/40 px-1.5 py-0.5 rounded">已過期</span>
                    )}
                  </div>
                  <div className="text-[11px] text-cortex-muted mb-1.5">
                    <button onClick={() => navigate(`/projects-platform/projects/${p.project_id}`)} className="text-cortex-ocean hover:underline font-mono font-bold inline-flex items-center gap-0.5">
                      <Briefcase size={10} /> {p.project_code}
                    </button>
                    {p.project_title && <span className="ml-1.5">— {p.project_title}</span>}
                    <span className="mx-2">·</span>
                    申請人:<strong className="text-cortex-text">{p.requester_name || p.requester_username || `user#${p.requested_by_user_id}`}</strong>
                  </div>
                  {p.reason && (
                    <div className="text-[12px] text-cortex-text bg-cortex-bg/40 border-l-2 border-cortex-line px-2 py-1 rounded-r mb-1.5">
                      {p.reason}
                    </div>
                  )}
                  <div className="text-[10px] text-cortex-muted inline-flex items-center gap-2">
                    <span><Clock size={9} className="inline -mt-px mr-0.5" />{new Date(p.created_at).toLocaleString('zh-TW')}</span>
                    <span>·</span>
                    <span>step <strong>{p.step_order}</strong> / {p.total_steps}</span>
                    {p.expires_at && (
                      <>
                        <span>·</span>
                        <span className={expired ? 'text-red-600 font-bold' : ''}>
                          到期:{new Date(p.expires_at).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => decide(p, 'approved')}
                    disabled={busyId === p.chain_id || !!expired}
                    className="px-3 py-1.5 text-[12px] bg-cortex-green text-white rounded hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1 font-bold"
                  >
                    {busyId === p.chain_id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                    批准
                  </button>
                  <button
                    onClick={() => decide(p, 'rejected')}
                    disabled={busyId === p.chain_id}
                    className="px-3 py-1.5 text-[12px] border border-red-300 text-red-700 rounded hover:bg-cortex-red-bg/40 disabled:opacity-40 inline-flex items-center gap-1 font-bold"
                  >
                    <XCircle size={11} /> 拒絕
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
