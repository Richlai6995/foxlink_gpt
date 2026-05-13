/**
 * InviteMemberModal — 中途拉新成員進專案
 *
 * 流程:
 *   搜尋 user(顯示前 20) → 選 user → 選 role + sub_role → 送出
 *
 * Role 可選:
 *   PM / sales / engineering / sourcing / factory / observer / chat_guest
 * sub_role(僅 PM 時用):DPM / BPM / MPM / EPM
 */

import { useEffect, useState } from 'react'
import { X, Search, Loader2, UserPlus, Check } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import { TOKENS } from '../tokens'

type UserRow = {
  id: number
  username: string
  name?: string | null
  employee_id?: string | null
  email?: string | null
  dept_name?: string | null
  already_member: boolean
}

const ROLES = [
  { key: 'PM',           label: 'PM(專案經理)',         needsSub: true },
  { key: 'sales',        label: 'Sales(業務)',          needsSub: false },
  { key: 'engineering',  label: 'Engineering',            needsSub: false },
  { key: 'sourcing',     label: 'Sourcing(採購)',       needsSub: false },
  { key: 'factory',      label: 'Factory(工廠)',        needsSub: false },
  { key: 'observer',     label: 'Observer(觀察者)',     needsSub: false },
  { key: 'chat_guest',   label: 'Chat Guest(臨時)',     needsSub: false },
]

const SUB_ROLES = ['DPM', 'BPM', 'MPM', 'EPM']

type Props = {
  projectId: number
  onClose: () => void
  onInvited: () => void
}

export default function InviteMemberModal({ projectId, onClose, onInvited }: Props) {
  const { token } = useAuth() as any
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserRow[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [role, setRole] = useState('PM')
  const [subRole, setSubRole] = useState('DPM')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // LOV 模式:一開啟即載預設清單,輸入做過濾(debounce 250ms)
  useEffect(() => {
    const id = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api.get<{ users: UserRow[] }>(
          token,
          `/projects/${projectId}/members/search?q=${encodeURIComponent(query)}`,
        )
        setUsers(r.users || [])
      } catch (e: any) {
        setErr(e.message)
      } finally {
        setSearching(false)
      }
    }, query.trim() ? 250 : 0)  // 預設清單立刻載,輸入時 debounce
    return () => clearTimeout(id)
  }, [query, projectId, token])

  const submit = async () => {
    if (!selected) return
    setBusy(true)
    setErr(null)
    try {
      await api.post(token, `/projects/${projectId}/members`, {
        user_id: selected.id,
        role,
        sub_role: ROLES.find((r) => r.key === role)?.needsSub ? subRole : null,
      })
      onInvited()
      onClose()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const needsSub = ROLES.find((r) => r.key === role)?.needsSub

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4 font-cortex" onClick={onClose}>
      <div
        className="rounded-xl shadow-cortex-lg w-full max-w-[560px] flex flex-col overflow-hidden"
        style={{ background: '#fff', maxHeight: 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-3 border-b flex items-center justify-between"
          style={{ background: TOKENS.navy, borderColor: TOKENS.line, color: '#fff' }}
        >
          <div className="font-bold text-[14px] inline-flex items-center gap-2">
            <UserPlus size={14} className="text-cortex-cyan" />
            邀請成員加入專案
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {/* Search input(LOV 過濾)*/}
          <div>
            <div className="text-[11px] font-bold mb-1.5" style={{ color: TOKENS.muted }}>
              1. 選擇 user(預設顯示前 30,可輸入工號 / 帳號 / 姓名過濾)
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: TOKENS.muted }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null) }}
                placeholder="輸入關鍵字過濾,或直接從下方清單選"
                className="w-full h-9 pl-8 pr-3 rounded border text-[13px] focus:outline-none"
                style={{ borderColor: TOKENS.line, color: TOKENS.ink, background: '#fff' }}
              />
            </div>
          </div>

          {/* User LOV(預設就顯示)*/}
          <div>
            <div
              className="border rounded max-h-[260px] overflow-y-auto"
              style={{ borderColor: TOKENS.line, background: TOKENS.line2 }}
            >
              {searching && (
                <div className="p-3 text-[12px] inline-flex items-center gap-2" style={{ color: TOKENS.muted }}>
                  <Loader2 size={12} className="animate-spin" /> 載入中…
                </div>
              )}
              {!searching && users.length === 0 && (
                <div className="p-3 text-[12px]" style={{ color: TOKENS.muted }}>無符合結果</div>
              )}
              {users.map((u) => (
                <button
                  key={u.id}
                  disabled={u.already_member}
                  onClick={() => setSelected(u)}
                  className="w-full text-left px-3 py-2 text-[12px] border-b last:border-b-0 transition flex items-center gap-2.5 disabled:opacity-50"
                  style={{
                    borderColor: TOKENS.line,
                    background: selected?.id === u.id ? TOKENS.cyanBg : '#fff',
                    color: TOKENS.text,
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[11px]"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #06b6d4)' }}
                  >
                    {(u.name || u.username).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ color: TOKENS.ink }}>
                      {u.name || u.username}
                      {u.employee_id && <span className="ml-1.5 font-mono text-[10px]" style={{ color: TOKENS.muted }}>{u.employee_id}</span>}
                    </div>
                    <div className="text-[10px]" style={{ color: TOKENS.muted }}>
                      @{u.username}{u.dept_name && ` · ${u.dept_name}`}
                    </div>
                  </div>
                  {u.already_member && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: TOKENS.line2, color: TOKENS.muted }}>
                      已是成員
                    </span>
                  )}
                  {selected?.id === u.id && <Check size={14} style={{ color: TOKENS.cyan }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: role */}
          {selected && (
            <>
              <div>
                <div className="text-[11px] font-bold mb-1.5" style={{ color: TOKENS.muted }}>
                  2. 在此專案的角色
                </div>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3 py-2 rounded border text-[13px] focus:outline-none"
                  style={{ borderColor: TOKENS.line, color: TOKENS.ink, background: '#fff' }}
                >
                  {ROLES.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </div>

              {needsSub && (
                <div>
                  <div className="text-[11px] font-bold mb-1.5" style={{ color: TOKENS.muted }}>
                    3. PM sub_role(Multi-PM 模型)
                  </div>
                  <div className="flex gap-1.5">
                    {SUB_ROLES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSubRole(s)}
                        className="px-3 py-1.5 text-[12px] font-bold rounded border transition"
                        style={
                          subRole === s
                            ? { background: TOKENS.navy, color: '#fff', borderColor: TOKENS.navy }
                            : { background: '#fff', color: TOKENS.text, borderColor: TOKENS.line }
                        }
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {err && (
            <div className="text-[12px] px-3 py-2 rounded border" style={{ background: TOKENS.redBg, color: '#b91c1c', borderColor: '#fca5a5' }}>
              ⚠ {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 border-t flex justify-end gap-2"
          style={{ background: TOKENS.bg, borderColor: TOKENS.line }}
        >
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] rounded border"
            style={{ background: '#fff', borderColor: TOKENS.line, color: TOKENS.text }}
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!selected || busy}
            className="px-3 py-1.5 text-[13px] font-bold rounded transition disabled:opacity-50 inline-flex items-center gap-1"
            style={{ background: TOKENS.cyan, color: TOKENS.navy }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
            邀請加入
          </button>
        </div>
      </div>
    </div>
  )
}
