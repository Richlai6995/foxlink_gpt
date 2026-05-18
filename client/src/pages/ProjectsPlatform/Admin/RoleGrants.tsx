/**
 * RoleGrants — 13 角色身份授予管理(spec §17)
 *
 * Sprint H ship。
 *
 * UI:
 *   - 左欄:13 role 列表(category 分組)
 *   - 右欄:選中 role 的所有 active grants 表格 + 新增 grant 按鈕
 *   - 新增 grant modal:user 搜尋(LOV)+ scope GLOBAL/BU + 過期日
 */

import { useEffect, useMemo, useState } from 'react'
import { Shield, UserPlus, X, Search, AlertTriangle, CheckCircle2, Globe, Building2, Briefcase, Loader2 } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import AdminPageShell from './AdminPageShell'
import { useCrumbs } from '../Shell/PlatformContext'
import { TOKENS } from '../tokens'

type RoleDef = {
  id: number
  role_code: string
  name_i18n: Record<string, string>
  description_i18n?: Record<string, string>
  category: string
  is_system: boolean
}

type Grant = {
  id: number
  user_id: number
  role_id: number
  role_code: string
  category: string
  name_i18n: Record<string, string>
  scope_type: 'GLOBAL' | 'BU'
  scope_values: number[]
  granted_by_admin_user_id: number | null
  granted_by_name?: string | null
  granted_at: string
  expires_at?: string | null
  is_active: boolean
  username?: string | null
  user_name?: string | null
  user_email?: string | null
}

const CATEGORY_LABEL: Record<string, { label: string; color: string }> = {
  project:        { label: '專案身份',    color: 'text-cortex-teal bg-cortex-cyan-bg' },
  workflow:       { label: '工作流',      color: 'text-purple-700 bg-purple-50' },
  data:           { label: '資料',        color: 'text-cortex-ocean bg-cortex-ocean-bg' },
  notification:   { label: '通知',        color: 'text-amber-700 bg-cortex-amber-bg' },
  confidential:   { label: '機密',        color: 'text-orange-700 bg-orange-50' },
  admin:          { label: '管理',        color: 'text-red-700 bg-cortex-red-bg' },
}

export default function RoleGrants() {
  const { token } = useAuth() as any
  const [roles, setRoles] = useState<RoleDef[]>([])
  const [grants, setGrants] = useState<Grant[]>([])
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  useCrumbs([
    { label: '我的專案', to: '/projects-platform' },
    { label: '角色授予 (13 role)' },
  ])

  // 載 13 role definitions(一次)
  useEffect(() => {
    if (!token) return
    api.get<{ roles: RoleDef[] }>(token, '/internal-admin/roles')
      .then((r) => {
        setRoles(r.roles || [])
        if (!selectedCode && r.roles?.length) setSelectedCode(r.roles[0].role_code)
      })
      .catch((e) => setErr(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // 載對應 role 的 grants
  const loadGrants = (code?: string | null) => {
    if (!token) return
    const q = code ? `?role_code=${encodeURIComponent(code)}` : ''
    setLoading(true)
    api.get<{ grants: Grant[] }>(token, `/internal-admin/role-grants${q}`)
      .then((r) => setGrants(r.grants || []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadGrants(selectedCode) }, [selectedCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const byCategory = useMemo(() => {
    const m: Record<string, RoleDef[]> = {}
    for (const r of roles) {
      (m[r.category] = m[r.category] || []).push(r)
    }
    return m
  }, [roles])

  const handleRevoke = async (grant: Grant) => {
    const reason = prompt(`撤回 ${grant.role_code} for ${grant.user_name || grant.username}?(理由,可空):`)
    if (reason === null) return
    try {
      await api.delete(token, `/internal-admin/role-grants/${grant.id}`, { reason })
      loadGrants(selectedCode)
    } catch (e: any) {
      alert('撤回失敗:' + e.message)
    }
  }

  const selectedRole = roles.find((r) => r.role_code === selectedCode)

  return (
    <AdminPageShell
      title="角色授予 · 13 role"
      subtitle={`管理 user × role × scope · spec §17`}
      specLink={{ label: 'spec §17', href: '/docs/projects-platform-spec.md#17' }}
      actions={
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 rounded text-[12px] font-bold text-white inline-flex items-center gap-1.5"
          style={{ background: TOKENS.cyan, color: TOKENS.navy }}
          disabled={!selectedCode}
        >
          <UserPlus size={12} /> 新增授予
        </button>
      }
    >
      {err && (
        <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-2 text-[12px] text-red-700 mb-2">
          <AlertTriangle size={11} className="inline -mt-px mr-1" /> {err}
        </div>
      )}

      <div className="grid grid-cols-[260px_1fr] gap-3.5">
        {/* Left: 13 role list */}
        <div className="bg-white border border-cortex-line rounded-lg p-2 max-h-[640px] overflow-y-auto">
          <div className="text-[10px] font-bold text-cortex-muted tracking-widest mb-2 px-1">
            13 ROLE DEFINITIONS
          </div>
          {Object.keys(byCategory).map((cat) => (
            <div key={cat} className="mb-2">
              <div className="text-[9px] font-bold text-cortex-text px-1.5 mt-2 mb-1 tracking-wider">
                {CATEGORY_LABEL[cat]?.label || cat}
              </div>
              {byCategory[cat].map((r) => {
                const active = r.role_code === selectedCode
                return (
                  <button
                    key={r.role_code}
                    onClick={() => setSelectedCode(r.role_code)}
                    className={`block w-full text-left px-2 py-1.5 rounded text-[12px] transition ${
                      active ? 'bg-cortex-cyan-bg text-cortex-teal font-semibold' : 'text-cortex-text hover:bg-cortex-line-2/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Shield size={11} className={active ? 'text-cortex-teal' : 'text-cortex-muted'} />
                      <span className="truncate">{r.name_i18n?.['zh-TW'] || r.role_code}</span>
                    </div>
                    <div className="text-[9px] text-cortex-muted font-mono ml-4 truncate">{r.role_code}</div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Right: grants list */}
        <div className="bg-white border border-cortex-line rounded-lg p-3">
          {selectedRole ? (
            <>
              <div className="flex items-end justify-between mb-2.5 flex-wrap gap-1">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${CATEGORY_LABEL[selectedRole.category]?.color || ''}`}>
                      {CATEGORY_LABEL[selectedRole.category]?.label || selectedRole.category}
                    </span>
                    <span className="text-[15px] font-bold text-cortex-ink">{selectedRole.name_i18n?.['zh-TW'] || selectedRole.role_code}</span>
                    <span className="text-[11px] font-mono text-cortex-muted">· {selectedRole.role_code}</span>
                  </div>
                  <div className="text-[11px] text-cortex-muted mt-1">
                    {selectedRole.description_i18n?.['zh-TW'] || '—'}
                  </div>
                </div>
                <span className="text-[10px] text-cortex-muted">{grants.length} active grants</span>
              </div>

              {/* Grants table */}
              {loading ? (
                <div className="text-center text-cortex-muted text-[12px] py-6">
                  <Loader2 size={16} className="inline animate-spin mr-1" /> 載入中…
                </div>
              ) : grants.length === 0 ? (
                <div className="text-center py-10 text-cortex-muted text-[12px] italic">
                  尚無人有此 role · 點右上「新增授予」開始
                </div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="text-[10px] text-cortex-muted uppercase tracking-wider border-b border-cortex-line">
                    <tr>
                      <th className="text-left py-1.5 px-2">User</th>
                      <th className="text-left py-1.5 px-2">Scope</th>
                      <th className="text-left py-1.5 px-2">授予人</th>
                      <th className="text-left py-1.5 px-2">日期</th>
                      <th className="text-left py-1.5 px-2">過期</th>
                      <th className="text-right py-1.5 px-2">動作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map((g) => (
                      <tr key={g.id} className="border-b border-cortex-line/50 hover:bg-cortex-line-2/30">
                        <td className="py-2 px-2">
                          <div className="font-semibold text-cortex-ink">{g.user_name || g.username || `user#${g.user_id}`}</div>
                          <div className="text-[9px] text-cortex-muted font-mono">{g.username} · {g.user_email || '—'}</div>
                        </td>
                        <td className="py-2 px-2">
                          {g.scope_type === 'GLOBAL' ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-cortex-green bg-cortex-green-bg px-1.5 py-0.5 rounded">
                              <Globe size={9} /> GLOBAL
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-cortex-teal bg-cortex-cyan-bg px-1.5 py-0.5 rounded">
                              <Building2 size={9} /> BU [{(g.scope_values || []).join(',')}]
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-[11px] text-cortex-text">
                          {g.granted_by_name || `admin#${g.granted_by_admin_user_id}`}
                        </td>
                        <td className="py-2 px-2 text-[10px] text-cortex-muted">
                          {fmtDate(g.granted_at)}
                        </td>
                        <td className="py-2 px-2 text-[10px]">
                          {g.expires_at ? (
                            <span className="text-amber-700">{fmtDate(g.expires_at)}</span>
                          ) : (
                            <span className="text-cortex-muted">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <button
                            onClick={() => handleRevoke(g)}
                            className="text-[10px] text-red-600 hover:underline"
                          >
                            撤回
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className="text-center text-cortex-muted py-10 text-[12px]">請從左側選擇 role</div>
          )}
        </div>
      </div>

      {showAdd && selectedRole && (
        <GrantModal
          role={selectedRole}
          token={token}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadGrants(selectedCode) }}
        />
      )}
    </AdminPageShell>
  )
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString('zh-TW', { year: '2-digit', month: 'short', day: 'numeric' })
  } catch { return iso }
}

// ────────────────────────────────────────────────────────────────────
// GrantModal — 授予 role
// ────────────────────────────────────────────────────────────────────
type UserLite = { user_id: number; username?: string; name?: string; email?: string }

function GrantModal({ role, token, onClose, onSaved }: {
  role: RoleDef
  token: string
  onClose: () => void
  onSaved: () => void
}) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<UserLite[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<UserLite | null>(null)
  const [scopeType, setScopeType] = useState<'GLOBAL' | 'BU'>('GLOBAL')
  const [buInput, setBuInput] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Sales / PM / BU director 通常會多 BU,super 也常多。預設 BU scope。
  const suggestBuScope = role.role_code.includes('bu_') || role.role_code === 'project.bu_director'

  useEffect(() => {
    if (suggestBuScope) setScopeType('BU')
  }, [suggestBuScope])

  // User LOV search(/internal-admin/users/search,不卡 project membership)
  useEffect(() => {
    const t = setTimeout(() => {
      setSearching(true)
      const url = q.trim()
        ? `/internal-admin/users/search?q=${encodeURIComponent(q.trim())}`
        : `/internal-admin/users/search`
      api.get<{ users: UserLite[] }>(token, url)
        .then((r) => setList(r.users || []))
        .catch(() => setList([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, token])

  const submit = async () => {
    setErr(null)
    if (!selected) { setErr('請選 user'); return }
    let scopeValues: number[] | undefined
    if (scopeType === 'BU') {
      scopeValues = buInput.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
      if (!scopeValues.length) { setErr('BU scope 必須輸入至少 1 個 BU ID'); return }
    }
    setSubmitting(true)
    try {
      await api.post(token, '/internal-admin/role-grants', {
        user_id: selected.user_id,
        role_code: role.role_code,
        scope_type: scopeType,
        scope_values: scopeValues,
        expires_at: expiresAt || null,
        reason,
      })
      onSaved()
    } catch (e: any) {
      setErr(e.message || '失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-[640px] w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-cortex-navy to-cortex-teal px-5 py-3.5 text-white flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cortex-cyan font-bold">授予 ROLE</div>
            <div className="text-base font-bold">{role.name_i18n?.['zh-TW']} <span className="font-mono text-[12px] text-cortex-cyan-bg ml-1">{role.role_code}</span></div>
          </div>
          <button onClick={onClose} className="text-cortex-cyan-bg hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          {/* User picker */}
          <div>
            <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1">User</div>
            {selected ? (
              <div className="flex items-center gap-2 p-2 bg-cortex-green-bg border border-cortex-green/30 rounded">
                <CheckCircle2 size={14} className="text-cortex-green" />
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-cortex-ink">{selected.name || selected.username}</div>
                  <div className="text-[10px] font-mono text-cortex-muted">{selected.username} · {selected.email || '—'}</div>
                </div>
                <button onClick={() => setSelected(null)} className="text-[10px] text-cortex-ocean hover:underline">換</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-2.5 text-cortex-muted pointer-events-none" />
                  <input
                    type="text"
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜尋 user(姓名 / 工號 / email)…"
                    className="w-full pl-7 pr-2 py-1.5 border border-cortex-line rounded text-[12px] focus:outline-none focus:border-cortex-cyan"
                  />
                </div>
                <div className="mt-1 border border-cortex-line rounded max-h-[160px] overflow-y-auto">
                  {searching && <div className="text-[11px] text-cortex-muted italic p-2">搜尋中…</div>}
                  {!searching && list.length === 0 && (
                    <div className="text-[11px] text-cortex-muted italic p-2">無結果</div>
                  )}
                  {list.map((u) => (
                    <button
                      key={u.user_id}
                      onClick={() => setSelected(u)}
                      className="block w-full text-left px-2 py-1.5 hover:bg-cortex-cyan-bg text-[12px] border-b border-cortex-line/50 last:border-b-0"
                    >
                      <span className="font-semibold text-cortex-ink">{u.name || u.username}</span>
                      <span className="ml-2 text-[10px] font-mono text-cortex-muted">{u.username} · {u.email || '—'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Scope */}
          <div>
            <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1">Scope</div>
            <div className="inline-flex rounded overflow-hidden border border-cortex-line">
              <button
                onClick={() => setScopeType('GLOBAL')}
                className={`px-3 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1 ${
                  scopeType === 'GLOBAL' ? 'bg-cortex-navy text-white' : 'bg-white text-cortex-text'
                }`}
              >
                <Globe size={11} /> GLOBAL
              </button>
              <button
                onClick={() => setScopeType('BU')}
                className={`px-3 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1 ${
                  scopeType === 'BU' ? 'bg-cortex-navy text-white' : 'bg-white text-cortex-text'
                }`}
              >
                <Building2 size={11} /> BU
              </button>
            </div>
            {scopeType === 'BU' && (
              <div className="mt-1.5">
                <input
                  type="text"
                  value={buInput}
                  onChange={(e) => setBuInput(e.target.value)}
                  placeholder="輸入 BU ID 列表(逗號分隔,e.g. 1,2,3)"
                  className="w-full px-2 py-1.5 border border-cortex-line rounded text-[12px] font-mono focus:outline-none focus:border-cortex-cyan"
                />
                <div className="text-[10px] text-cortex-muted mt-0.5 italic">
                  Phase 1:organization_units 表還沒 seed,直接輸 bu_id 即可(對齊 projects.bu_id)
                </div>
              </div>
            )}
          </div>

          {/* Expires */}
          <div>
            <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1">過期日(空 = 永久)</div>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="px-2 py-1.5 border border-cortex-line rounded text-[12px] focus:outline-none focus:border-cortex-cyan"
            />
          </div>

          {/* Reason */}
          <div>
            <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1">理由(audit)</div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 border border-cortex-line rounded text-[12px] focus:outline-none focus:border-cortex-cyan"
              placeholder="e.g. 新進業務,授 project.sales..."
            />
          </div>

          {err && (
            <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-2 text-[11px] text-red-700">
              <AlertTriangle size={11} className="inline -mt-px mr-1" /> {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-cortex-line">
            <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-cortex-muted hover:text-cortex-ink">取消</button>
            <button
              onClick={submit}
              disabled={submitting || !selected}
              className="px-4 py-1.5 text-[12px] font-bold rounded inline-flex items-center gap-1"
              style={{
                background: submitting || !selected ? TOKENS.muted : TOKENS.cyan,
                color: submitting || !selected ? '#fff' : TOKENS.navy,
              }}
            >
              {submitting ? <Loader2 size={11} className="animate-spin" /> : <Briefcase size={11} />}
              授予
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
