import { useState, useEffect } from 'react'
import { Plus, Edit, Trash2, Save, X, Check, Download, UserCog, FileText, Mic, Image, CalendarClock, RefreshCw, Building2, Search, ShieldCheck, Clock, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { User } from '../../types'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'

// ── Org Sync Schedule Panel ───────────────────────────────────────────────────
interface OrgSyncSchedule { enabled: boolean; hour: number; lastRun: string | null }
interface OrgSyncChangeLog {
  id: number; employee_id: string; user_name: string; sync_trigger: string
  changed_fields: string | null; is_departure: number; notified_admin: number
  error_msg: string | null; synced_at: string
}

function OrgSyncPanel() {
  const [open, setOpen] = useState(false)
  const [schedule, setSchedule] = useState<OrgSyncSchedule>({ enabled: false, hour: 2, lastRun: null })
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState<OrgSyncChangeLog[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)

  useEffect(() => {
    api.get('/admin/org-sync-schedule').then(r => setSchedule(r.data)).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.post('/admin/org-sync-schedule', schedule)
      alert('排程設定已儲存')
    } catch (e: any) { alert(e?.response?.data?.error || '儲存失敗') }
    finally { setSaving(false) }
  }

  const loadLogs = async () => {
    setLogsLoading(true)
    try {
      const r = await api.get('/admin/org-sync-change-logs?limit=50')
      setLogs(r.data)
    } catch { setLogs([]) }
    finally { setLogsLoading(false) }
  }

  const toggleLogs = () => {
    if (!logsOpen) loadLogs()
    setLogsOpen(p => !p)
  }

  const TRIGGER_LABEL: Record<string, string> = { scheduled: '排程', manual: '手動', login: '登入' }

  return (
    <div className="mb-3 border border-blue-200 rounded-lg bg-blue-50/50">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 rounded-lg"
      >
        <span className="flex items-center gap-1.5">
          <Clock size={14} />
          組織自動同步排程
          {schedule.enabled && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
              每天 {schedule.hour}:00
            </span>
          )}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={schedule.enabled}
                onChange={e => setSchedule(p => ({ ...p, enabled: e.target.checked }))}
                className="w-4 h-4 rounded" />
              啟用自動同步
            </label>
            <label className="flex items-center gap-2 text-sm">
              每天
              <select value={schedule.hour}
                onChange={e => setSchedule(p => ({ ...p, hour: parseInt(e.target.value) }))}
                className="border rounded px-2 py-1 text-xs bg-white w-20">
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              執行
            </label>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              <Save size={12} /> {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
          {schedule.lastRun && (
            <p className="text-xs text-slate-500">上次同步：{fmtTW(schedule.lastRun)}</p>
          )}

          {/* 變動紀錄 */}
          <button onClick={toggleLogs}
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
            {logsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            查看變動紀錄（最近 50 筆）
          </button>
          {logsOpen && (
            <div className="overflow-auto max-h-64 rounded border border-slate-200 bg-white">
              {logsLoading ? (
                <div className="text-xs text-slate-400 p-3">載入中...</div>
              ) : logs.length === 0 ? (
                <div className="text-xs text-slate-400 p-3">尚無紀錄</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-slate-500">時間</th>
                      <th className="px-2 py-1.5 text-left text-slate-500">工號</th>
                      <th className="px-2 py-1.5 text-left text-slate-500">姓名</th>
                      <th className="px-2 py-1.5 text-left text-slate-500">來源</th>
                      <th className="px-2 py-1.5 text-left text-slate-500">變動欄位</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => {
                      let fields: string[] = []
                      try { fields = Object.keys(JSON.parse(log.changed_fields || '{}')) } catch { }
                      const isErr = !!log.error_msg
                      return (
                        <tr key={log.id} className={`border-t ${log.is_departure ? 'bg-red-50' : isErr ? 'bg-amber-50' : ''}`}>
                          <td className="px-2 py-1 text-slate-400 whitespace-nowrap">{log.synced_at}</td>
                          <td className="px-2 py-1">{log.employee_id || '-'}</td>
                          <td className="px-2 py-1">{log.user_name || '-'}</td>
                          <td className="px-2 py-1">
                            <span className="px-1 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">
                              {TRIGGER_LABEL[log.sync_trigger] || log.sync_trigger}
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            {isErr ? (
                              <span className="text-amber-600 flex items-center gap-1">
                                <AlertTriangle size={10} /> {log.error_msg}
                              </span>
                            ) : log.is_departure ? (
                              <span className="text-red-600 font-medium">⚠️ 離職/調職 {fields.join(', ')}</span>
                            ) : (
                              <span className="text-slate-600">{fields.join(', ') || '-'}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface Policy {
  id: number
  name: string
  description: string | null
}

interface Role {
  id: number
  name: string
  is_default: number
  budget_daily: number | null
  budget_weekly: number | null
  budget_monthly: number | null
  allow_text_upload: number
  text_max_mb: number
  allow_audio_upload: number
  audio_max_mb: number
  allow_image_upload: number
  image_max_mb: number
  allow_scheduled_tasks: number
}

interface UserForm {
  username: string
  password: string
  name: string
  employee_id: string
  email: string
  role: 'admin' | 'user'
  status: 'active' | 'inactive'
  start_date: string
  end_date: string
  allow_text_upload: boolean
  text_max_mb: number
  allow_audio_upload: boolean
  audio_max_mb: number
  allow_image_upload: boolean
  image_max_mb: number
  allow_scheduled_tasks: boolean
  allow_create_skill: boolean | null  // null = inherit from role
  allow_external_skill: boolean | null
  allow_code_skill: boolean | null
  can_create_kb: boolean | null
  can_deep_research: boolean | null
  can_design_ai_select: boolean | null
  can_use_ai_dashboard: boolean | null
  training_permission: string | null  // null = follow role, 'none' | 'publish' | 'publish_edit'
  webex_bot_enabled: boolean
  name_manually_set: boolean
  kb_max_size_mb: string
  kb_max_count: string
  role_id: number | null
  budget_daily: string
  budget_weekly: string
  budget_monthly: string
  quota_exceed_action: string  // '' = 沿用角色
  // org fields (manual override)
  dept_code: string
  dept_name: string
  profit_center: string
  profit_center_name: string
  org_section: string
  org_section_name: string
  org_group_name: string
  factory_code: string
  org_end_date: string
}

const empty: UserForm = {
  username: '', password: '', name: '', employee_id: '',
  email: '', role: 'user', status: 'inactive', start_date: '', end_date: '',
  allow_text_upload: true, text_max_mb: 10, allow_audio_upload: false, audio_max_mb: 10,
  allow_image_upload: true, image_max_mb: 10,
  allow_scheduled_tasks: false,
  allow_create_skill: null,
  allow_external_skill: null,
  allow_code_skill: null,
  can_create_kb: null,
  can_deep_research: null,
  can_design_ai_select: null,
  can_use_ai_dashboard: null,
  training_permission: null,
  webex_bot_enabled: true,
  name_manually_set: false,
  kb_max_size_mb: '',
  kb_max_count: '',
  role_id: null,
  budget_daily: '', budget_weekly: '', budget_monthly: '', quota_exceed_action: '',
  dept_code: '', dept_name: '', profit_center: '', profit_center_name: '',
  org_section: '', org_section_name: '', org_group_name: '', factory_code: '', org_end_date: '',
}

export default function UserManagement() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [userAssignments, setUserAssignments] = useState<Record<string, number | null>>({}) // userId → policyId
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editOriginalName, setEditOriginalName] = useState('')
  const [form, setForm] = useState<UserForm>(empty)
  const [formPolicyId, setFormPolicyId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [search, setSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState<'mixed_name' | 'en_name' | 'no_eid' | 'no_email' | ''>('')

  const load = async () => {
    const [usersRes, rolesRes, policiesRes, assignRes] = await Promise.all([
      api.get('/users'),
      api.get('/roles'),
      api.get('/data-permissions/policies').catch(() => ({ data: [] })),
      api.get('/data-permissions/assignments').catch(() => ({ data: [] })),
    ])
    setUsers(Array.isArray(usersRes.data) ? usersRes.data : [])
    setRoles(Array.isArray(rolesRes.data) ? rolesRes.data : [])
    setPolicies(Array.isArray(policiesRes.data) ? policiesRes.data : [])
    const map: Record<string, number | null> = {}
    for (const a of (assignRes.data as any[])) {
      if (a.grantee_type === 'user') map[String(a.grantee_id)] = a.policy_id
    }
    setUserAssignments(map)
  }

  useEffect(() => { load() }, [])

  // search filter
  const hasEnChar = (s: string) => /[a-zA-Z]/.test(s)
  const hasCjk = (s: string) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s)

  const filtered = users.filter((u) => {
    const u2 = u as any
    // keyword search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const match =
        u.username?.toLowerCase().includes(q) ||
        u.name?.toLowerCase().includes(q) ||
        (u.employee_id || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u2.dept_name || '').toLowerCase().includes(q) ||
        (u2.profit_center_name || '').toLowerCase().includes(q) ||
        (u2.org_section_name || '').toLowerCase().includes(q) ||
        (u2.org_group_name || '').toLowerCase().includes(q)
      if (!match) return false
    }
    // quick filters
    const name = u.name || ''
    if (quickFilter === 'mixed_name') return hasCjk(name) && hasEnChar(name)
    if (quickFilter === 'en_name') return hasEnChar(name)
    if (quickFilter === 'no_eid') return !u.employee_id
    if (quickFilter === 'no_email') return !u.email
    return true
  })

  const openNew = () => {
    setForm(empty)
    setEditId(null)
    setFormPolicyId(null)
    setError('')
    setShowForm(true)
  }

  const openEdit = (u: User) => {
    const u2 = u as any
    setFormPolicyId(userAssignments[String(u.id)] ?? null)
    setForm({
      username: u.username,
      password: '',
      name: u.name,
      employee_id: u.employee_id || '',
      email: u.email || '',
      role: u.role,
      status: u.status,
      start_date: u.start_date ? String(u.start_date).slice(0, 10) : '',
      end_date: u.end_date ? String(u.end_date).slice(0, 10) : '',
      allow_text_upload: u2.allow_text_upload !== 0,
      text_max_mb: u2.text_max_mb || 10,
      allow_audio_upload: u2.allow_audio_upload === 1,
      audio_max_mb: u2.audio_max_mb || 10,
      allow_image_upload: u2.allow_image_upload !== 0,
      image_max_mb: u2.image_max_mb || 10,
      allow_scheduled_tasks: u2.allow_scheduled_tasks === 1,
      role_id: u2.role_id || null,
      budget_daily: u2.budget_daily != null ? String(u2.budget_daily) : '',
      budget_weekly: u2.budget_weekly != null ? String(u2.budget_weekly) : '',
      budget_monthly: u2.budget_monthly != null ? String(u2.budget_monthly) : '',
      quota_exceed_action: u2.quota_exceed_action || '',
      dept_code: u2.dept_code || '',
      dept_name: u2.dept_name || '',
      profit_center: u2.profit_center || '',
      profit_center_name: u2.profit_center_name || '',
      org_section: u2.org_section || '',
      org_section_name: u2.org_section_name || '',
      org_group_name: u2.org_group_name || '',
      factory_code: u2.factory_code || '',
      org_end_date: u2.org_end_date ? String(u2.org_end_date).slice(0, 10) : '',
      allow_create_skill: u2.allow_create_skill == null ? null : u2.allow_create_skill === 1,
      allow_external_skill: u2.allow_external_skill == null ? null : u2.allow_external_skill === 1,
      allow_code_skill: u2.allow_code_skill == null ? null : u2.allow_code_skill === 1,
      can_create_kb: u2.can_create_kb == null ? null : u2.can_create_kb === 1,
      can_deep_research: u2.can_deep_research == null ? null : u2.can_deep_research === 1,
      can_design_ai_select: u2.can_design_ai_select == null ? null : u2.can_design_ai_select === 1,
      can_use_ai_dashboard: u2.can_use_ai_dashboard == null ? null : u2.can_use_ai_dashboard === 1,
      training_permission: u2.training_permission || null,
      webex_bot_enabled: u2.webex_bot_enabled !== 0,
      name_manually_set: u2.name_manually_set === 1,
      kb_max_size_mb: u2.kb_max_size_mb != null ? String(u2.kb_max_size_mb) : '',
      kb_max_count: u2.kb_max_count != null ? String(u2.kb_max_count) : '',
    })
    setEditId(u.id)
    setEditOriginalName(u.name)
    setError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    setLoading(true)
    setError('')
    try {
      const payload = {
        ...form,
        budget_daily: form.budget_daily !== '' ? Number(form.budget_daily) : null,
        budget_weekly: form.budget_weekly !== '' ? Number(form.budget_weekly) : null,
        budget_monthly: form.budget_monthly !== '' ? Number(form.budget_monthly) : null,
        kb_max_size_mb: form.kb_max_size_mb !== '' ? Number(form.kb_max_size_mb) : null,
        kb_max_count: form.kb_max_count !== '' ? Number(form.kb_max_count) : null,
      }
      let userId: number
      if (editId) {
        await api.put(`/users/${editId}`, payload)
        userId = editId
      } else {
        const r = await api.post('/users', payload)
        userId = r.data.id
      }
      // sync policy assignment
      await api.put(`/data-permissions/assignments/user/${userId}`, { policy_id: formPolicyId })
      setShowForm(false)
      await load()
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('users.saveFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(t('users.deleteUserConfirm', { username }))) return
    try {
      await api.delete(`/users/${id}`)
      await load()
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('users.deleteFailed'))
    }
  }

  const handleSyncOne = async (id: number) => {
    setSyncingId(id)
    setSyncMsg('')
    try {
      const res = await api.post(`/admin/users/${id}/sync-org`)
      setSyncMsg(res.data.message || t('users.syncOrg'))
      await load()
    } catch (e: unknown) {
      const errMsg = (e as any)?.response?.data?.error || t('users.syncOrg')
      setSyncMsg(errMsg)
    } finally {
      setSyncingId(null)
    }
  }

  const handleSyncAll = async () => {
    setSyncingAll(true)
    setSyncMsg('')
    try {
      const res = await api.post('/admin/users/sync-org-all')
      setSyncMsg(res.data.message || t('users.syncAllOrg'))
      await load()
    } catch (e: unknown) {
      const errMsg = (e as any)?.response?.data?.error || t('users.syncAllOrg')
      setSyncMsg(errMsg)
    } finally {
      setSyncingAll(false)
    }
  }

  const exportCsv = () => {
    const header = `${t('users.cols.username')},${t('users.cols.name')},${t('users.cols.employeeId')},Email,${t('users.cols.systemRole')},${t('users.status.active')}/${t('users.status.inactive')},${t('users.cols.deptCode')},${t('users.cols.deptName')},${t('users.cols.profitCenter')},${t('users.cols.profitCenterName')},${t('users.cols.orgSection')},${t('users.cols.orgSectionName')},${t('users.cols.orgGroupName')},${t('users.cols.factoryCode')},${t('users.cols.endDate')}`
    const lines = users.map((u) => {
      const u2 = u as any
      return [
        u.username, u.name, u.employee_id || '', u.email || '',
        u.role === 'admin' ? t('users.adminRole') : t('users.normalUser'),
        u.status === 'active' ? t('users.status.active') : t('users.status.inactive'),
        u2.dept_code || '', u2.dept_name || '', u2.profit_center || '',
        u2.profit_center_name || '', u2.org_section || '', u2.org_section_name || '',
        u2.org_group_name || '', u2.factory_code || '', u2.org_end_date || '',
      ].join(',')
    })
    const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const F = (key: keyof UserForm) => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value })),
  })

  const getRoleBudget = (u: User) => {
    const rid = (u as any).role_id
    if (!rid) return null
    return roles.find(r => r.id === rid) || null
  }

  const effectiveBudget = (u: User, field: 'budget_daily' | 'budget_weekly' | 'budget_monthly') => {
    const userVal = (u as any)[field]
    if (userVal != null) return userVal
    const role = getRoleBudget(u)
    return role ? (role as any)[field] : null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800">{t('users.title')}</h2>
        <div className="flex gap-2 flex-wrap items-center">
          {syncMsg && <span className="text-xs text-blue-600 max-w-xs truncate">{syncMsg}</span>}
          <button onClick={handleSyncAll} disabled={syncingAll}
            className="btn-ghost flex items-center gap-1.5 text-sm">
            <RefreshCw size={14} className={syncingAll ? 'animate-spin' : ''} />
            {t('users.syncAllOrg')}
          </button>
          <button onClick={exportCsv} disabled={users.length === 0} className="btn-ghost flex items-center gap-1.5">
            <Download size={14} /> {t('users.exportCsv')}
          </button>
          <button onClick={openNew} className="btn-primary flex items-center gap-1.5">
            <Plus size={15} /> {t('users.addUser')}
          </button>
        </div>
      </div>

      {/* Org Sync Schedule Panel */}
      <OrgSyncPanel />

      {/* Search bar + quick filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2 bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-200">
        <Search size={15} className="text-slate-400 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('users.searchPlaceholder')}
          className="bg-transparent text-sm outline-none text-slate-700 placeholder:text-slate-400"
          style={{ width: 260 }}
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
        <span className="w-px h-5 bg-slate-300 mx-1 shrink-0" />
        {([
          { key: 'mixed_name', label: t('users.filter.mixedName', '姓名中英混雜') },
          { key: 'en_name', label: t('users.filter.enName', '姓名含英文') },
          { key: 'no_eid', label: t('users.filter.noEid', '無工號') },
          { key: 'no_email', label: t('users.filter.noEmail', '無 Email') },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setQuickFilter(quickFilter === f.key ? '' : f.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
              quickFilter === f.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            {f.label}
          </button>
        ))}
        {quickFilter && (
          <button
            onClick={() => setQuickFilter('')}
            className="px-2 py-1 rounded-full text-xs font-medium border border-red-300 text-red-500 hover:bg-red-50 transition flex items-center gap-1"
          >
            <X size={12} /> {t('common.clear', '清除')}
          </button>
        )}
        {(search || quickFilter) && (
          <span className="text-xs text-slate-500 shrink-0 ml-auto">{filtered.length} / {users.length}</span>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
              <h3 className="font-semibold">{editId ? t('users.editUser') : t('users.addUser')}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('users.form.accountRequired')}</label>
                  <input {...F('username')} className="input" disabled={!!editId} />
                </div>
                <div>
                  <label className="label">{editId ? t('users.form.passwordNoChange') : t('users.form.password')}</label>
                  <input {...F('password')} type="password" autoComplete="new-password" className="input" />
                </div>
                <div>
                  <label className="label">{t('users.form.nameRequired')}</label>
                  <input
                    value={form.name}
                    onChange={e => {
                      const newName = e.target.value
                      setForm(f => ({
                        ...f,
                        name: newName,
                        ...(editId && newName !== editOriginalName && !f.name_manually_set
                          ? { name_manually_set: true }
                          : {}),
                      }))
                    }}
                    className="input"
                  />
                  <label className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.name_manually_set}
                      onChange={e => setForm(f => ({ ...f, name_manually_set: e.target.checked }))}
                    />
                    鎖定姓名（不讓 AD / ERP 自動覆蓋）
                  </label>
                </div>
                <div>
                  <label className="label">{t('users.form.employeeId')}</label>
                  <input {...F('employee_id')} className="input" />
                </div>
                <div className="col-span-2">
                  <label className="label">{t('users.form.email')}</label>
                  <input {...F('email')} type="email" className="input" />
                </div>
                <div>
                  <label className="label">{t('users.form.role')}</label>
                  <select {...F('role')} className="input">
                    <option value="user">{t('users.role.user')}</option>
                    <option value="admin">{t('users.role.admin')}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('users.form.status')}</label>
                  <select {...F('status')} className="input">
                    <option value="active">{t('users.status.active')}</option>
                    <option value="inactive">{t('users.status.inactive')}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('users.form.startDateLabel')}</label>
                  <input {...F('start_date')} type="date" className="input" />
                </div>
                <div>
                  <label className="label">{t('users.form.endDateLabel')}</label>
                  <input {...F('end_date')} type="date" className="input" />
                </div>
                {/* Upload permissions */}
                <div className="col-span-2 border-t pt-3 mt-1">
                  <p className="text-xs font-semibold text-slate-500 mb-2">{t('users.form.uploadPerms')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.allow_text_upload}
                        onChange={e => setForm(p => ({ ...p, allow_text_upload: e.target.checked }))}
                        className="w-4 h-4 accent-blue-600"
                      />
                      {t('users.form.textUpload')}
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">{t('users.form.limitMb')}</span>
                      <input
                        type="number" min={1} max={200}
                        value={form.text_max_mb}
                        onChange={e => setForm(p => ({ ...p, text_max_mb: Number(e.target.value) }))}
                        className="input w-20 py-1"
                        disabled={!form.allow_text_upload}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.allow_audio_upload}
                        onChange={e => setForm(p => ({ ...p, allow_audio_upload: e.target.checked }))}
                        className="w-4 h-4 accent-blue-600"
                      />
                      {t('users.form.audioUpload')}
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">{t('users.form.limitMb')}</span>
                      <input
                        type="number" min={1} max={500}
                        value={form.audio_max_mb}
                        onChange={e => setForm(p => ({ ...p, audio_max_mb: Number(e.target.value) }))}
                        className="input w-20 py-1"
                        disabled={!form.allow_audio_upload}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.allow_image_upload}
                        onChange={e => setForm(p => ({ ...p, allow_image_upload: e.target.checked }))}
                        className="w-4 h-4 accent-blue-600"
                      />
                      {t('users.form.imageUpload')}
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">{t('users.form.limitMb')}</span>
                      <input
                        type="number" min={1} max={200}
                        value={form.image_max_mb}
                        onChange={e => setForm(p => ({ ...p, image_max_mb: Number(e.target.value) }))}
                        className="input w-20 py-1"
                        disabled={!form.allow_image_upload}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Scheduled tasks permission */}
              <div className="px-5 pb-4">
                <label className="label mb-1.5">{t('users.form.funcPerms')}</label>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.allow_scheduled_tasks}
                      onChange={e => setForm(p => ({ ...p, allow_scheduled_tasks: e.target.checked }))}
                      className="w-4 h-4 accent-blue-600"
                    />
                    {t('users.form.allowScheduledTasks')}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.webex_bot_enabled}
                      onChange={e => setForm(p => ({ ...p, webex_bot_enabled: e.target.checked }))}
                      className="w-4 h-4 accent-blue-600"
                    />
                    允許使用 Webex Bot
                  </label>
                </div>
              </div>

              {/* Role assignment */}
              <div className="px-5 pb-4 border-t pt-3">
                <label className="label mb-1.5 flex items-center gap-1.5">
                  <UserCog size={14} /> {t('users.form.mcpDifyRole')}
                </label>
                <select
                  value={form.role_id ?? ''}
                  onChange={e => {
                    const rid = e.target.value ? Number(e.target.value) : null
                    const roleData = rid ? roles.find(r => r.id === rid) : null
                    setForm(p => ({
                      ...p,
                      role_id: rid,
                      ...(roleData ? {
                        allow_text_upload: roleData.allow_text_upload !== 0,
                        text_max_mb: roleData.text_max_mb || 10,
                        allow_audio_upload: roleData.allow_audio_upload === 1,
                        audio_max_mb: roleData.audio_max_mb || 10,
                        allow_image_upload: roleData.allow_image_upload !== 0,
                        image_max_mb: roleData.image_max_mb || 10,
                        allow_scheduled_tasks: roleData.allow_scheduled_tasks === 1,
                        budget_daily: roleData.budget_daily != null ? String(roleData.budget_daily) : '',
                        budget_weekly: roleData.budget_weekly != null ? String(roleData.budget_weekly) : '',
                        budget_monthly: roleData.budget_monthly != null ? String(roleData.budget_monthly) : '',
                      } : {}),
                    }))
                  }}
                  className="input w-full"
                >
                  <option value="">{t('users.form.noRole')}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.is_default ? t('users.form.defaultRole') : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">{t('users.form.mcpDifyRoleNote')}</p>
              </div>

              {/* Data Policy */}
              <div className="px-5 pb-4 border-t pt-3">
                <label className="label mb-1.5 flex items-center gap-1.5">
                  <ShieldCheck size={14} /> {t('users.form.dataPolicy')}
                </label>
                <select
                  value={formPolicyId ?? ''}
                  onChange={e => setFormPolicyId(e.target.value ? Number(e.target.value) : null)}
                  className="input w-full"
                >
                  <option value="">{t('users.form.followRolePolicy')}</option>
                  {policies.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.description ? ` — ${p.description}` : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">{t('users.form.dataPolicyNote')}</p>
              </div>

              {/* Budget override */}
              <div className="px-5 pb-4 border-t pt-3">
                <p className="label mb-2">{t('users.form.budgetOverride')}</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.dailyLimit')}</label>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.budget_daily}
                      onChange={e => setForm(p => ({ ...p, budget_daily: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder={t('common.unlimited')}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.weeklyLimit')}</label>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.budget_weekly}
                      onChange={e => setForm(p => ({ ...p, budget_weekly: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder={t('common.unlimited')}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.monthlyLimit')}</label>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.budget_monthly}
                      onChange={e => setForm(p => ({ ...p, budget_monthly: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder={t('common.unlimited')}
                    />
                  </div>
                </div>
              </div>

              {/* Quota exceed action override */}
              <div className="px-5 pb-2">
                <label className="text-xs text-slate-500 mb-1 block">額度超過限制方式</label>
                <select
                  value={form.quota_exceed_action}
                  onChange={e => setForm(p => ({ ...p, quota_exceed_action: e.target.value }))}
                  className="input py-1.5 text-sm"
                >
                  <option value="">沿用角色設定</option>
                  <option value="block">禁止（封鎖請求）</option>
                  <option value="warn">警告（允許繼續使用，TopBar 顯示警告）</option>
                </select>
              </div>

              {/* Skill permission override */}
              <div className="px-5 pb-4 border-t pt-3">
                <p className="label mb-2 flex items-center gap-1.5">{t('users.form.skillPerms')}</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <select
                      value={form.allow_create_skill === null ? '' : form.allow_create_skill ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, allow_create_skill: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">{t('users.form.followRole')}</option>
                      <option value="1">{t('users.form.allowCreateSkillOpt')}</option>
                      <option value="0">{t('users.form.denyCreateSkill')}</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <select
                      value={form.allow_external_skill === null ? '' : form.allow_external_skill ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, allow_external_skill: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">{t('users.form.followRole')}</option>
                      <option value="1">{t('users.form.allowExternalSkill')}</option>
                      <option value="0">{t('users.form.denyExternalSkill')}</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* KB permission */}
              <div className="px-5 pb-4 border-t pt-3">
                <p className="label mb-2 flex items-center gap-1.5">{t('users.form.kbPerms')}</p>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.createKb')}</label>
                    <select
                      value={form.can_create_kb === null ? '' : form.can_create_kb ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, can_create_kb: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">{t('users.form.followRole')}</option>
                      <option value="1">{t('users.form.allowCreate')}</option>
                      <option value="0">{t('users.form.denyCreate')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.deepResearch')}</label>
                    <select
                      value={form.can_deep_research === null ? '' : form.can_deep_research ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, can_deep_research: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">{t('users.form.followRoleSetting')}</option>
                      <option value="1">{t('users.form.forceAllow')}</option>
                      <option value="0">{t('users.form.forceDeny')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.aiDashboardDesign')}</label>
                    <select
                      value={form.can_design_ai_select === null ? '' : form.can_design_ai_select ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, can_design_ai_select: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">{t('users.form.followRoleSetting')}</option>
                      <option value="1">{t('users.form.allowDesign')}</option>
                      <option value="0">{t('users.form.deny')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.aiDashboardQuery')}</label>
                    <select
                      value={form.can_use_ai_dashboard === null ? '' : form.can_use_ai_dashboard ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, can_use_ai_dashboard: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">{t('users.form.followRoleSetting')}</option>
                      <option value="1">{t('users.form.allowUse')}</option>
                      <option value="0">{t('users.form.deny')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('training.permission.label')}</label>
                    <select
                      value={form.training_permission || ''}
                      onChange={e => setForm(p => ({ ...p, training_permission: e.target.value || null }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">{t('users.form.followRoleSetting')}</option>
                      <option value="publish_edit">{t('training.permission.publishEdit')}</option>
                      <option value="publish">{t('training.permission.publish')}</option>
                      <option value="none">{t('training.permission.none')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.kbMaxSizeMb')}</label>
                    <input
                      type="number" min={1} step={1}
                      value={form.kb_max_size_mb}
                      onChange={e => setForm(p => ({ ...p, kb_max_size_mb: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder="500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.kbMaxCount')}</label>
                    <input
                      type="number" min={1} step={1}
                      value={form.kb_max_count}
                      onChange={e => setForm(p => ({ ...p, kb_max_count: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder="5"
                    />
                  </div>
                </div>
              </div>

              {/* Org fields (manual override) */}
              <div className="px-5 pb-4 border-t pt-3">
                <p className="label mb-2 flex items-center gap-1.5">
                  <Building2 size={13} /> {t('users.form.orgData')}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.deptCode')}</label>
                    <input {...F('dept_code')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.deptName')}</label>
                    <input {...F('dept_name')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.profitCenterCode')}</label>
                    <input {...F('profit_center')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.profitCenterName')}</label>
                    <input {...F('profit_center_name')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.orgSectionCode')}</label>
                    <input {...F('org_section')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.orgSectionName')}</label>
                    <input {...F('org_section_name')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.orgGroupName')}</label>
                    <input {...F('org_group_name')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.factoryCodeLabel')}</label>
                    <input {...F('factory_code')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('users.form.orgEndDate')}</label>
                    <input {...F('org_end_date')} type="date" className="input py-1.5 text-sm" />
                  </div>
                </div>
              </div>

              {/* Creation method (read-only, edit mode only) */}
              {editId && (
                <div className="px-5 pb-4 border-t pt-3">
                  <p className="label mb-1.5">{t('users.form.creationMethod')}</p>
                  {(() => {
                    const method = (users.find(u => u.id === editId) as any)?.creation_method || 'manual'
                    return (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${method === 'ldap'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600'
                        }`}>
                        {method === 'ldap' ? t('users.form.ldapMethod') : t('users.form.manualMethod')}
                      </span>
                    )
                  })()}
                  <p className="text-xs text-slate-400 mt-1">{t('users.form.creationMethodNote')}</p>
                </div>
              )}
            </div>{/* end scrollable area */}

            {error && <p className="px-5 py-2 text-red-500 text-sm flex-shrink-0">{error}</p>}
            <div className="flex justify-end gap-2 p-5 border-t flex-shrink-0">
              <button onClick={() => setShowForm(false)} className="btn-ghost">{t('common.cancel')}</button>
              <button onClick={handleSave} disabled={loading} className="btn-primary flex items-center gap-1.5">
                <Save size={14} /> {loading ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <style>{`
        .user-table-wrap::-webkit-scrollbar { height: 14px; }
        .user-table-wrap::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 7px; border: 3px solid #fff; }
        .user-table-wrap::-webkit-scrollbar-track { background: #f1f5f9; }
      `}</style>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 260px)' }}>
        <div className="overflow-auto flex-1 user-table-wrap">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('users.cols.username')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('users.cols.name')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('users.cols.employeeId')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('users.cols.action')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('users.cols.systemRole')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('users.cols.mcpDifyRole')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 text-center" title={t('users.form.textUpload')}><FileText size={13} className="inline" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 text-center" title={t('users.form.audioUpload')}><Mic size={13} className="inline" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 text-center" title={t('users.form.imageUpload')}><Image size={13} className="inline" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 text-center" title={t('users.form.allowSchedule')}><CalendarClock size={13} className="inline" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600" title={t('users.cols.budget')}>{t('users.cols.budget')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('users.cols.creation')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('users.cols.status')}</th>
                {/* Org columns */}
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50 border-l border-green-200">{t('users.cols.deptCode')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.deptName')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.profitCenter')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.profitCenterName')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.orgSection')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.orgSectionName')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.orgGroupName')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.factoryCode')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.endDate')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">{t('users.cols.lastSync')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((u) => {
                const u2 = u as any
                const budgetD = effectiveBudget(u, 'budget_daily')
                const budgetW = effectiveBudget(u, 'budget_weekly')
                const budgetM = effectiveBudget(u, 'budget_monthly')
                const hasBudget = budgetD != null || budgetW != null || budgetM != null
                return (
                  <tr key={u.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-800">{u.username}</td>
                    <td className="px-4 py-3">{u.name}</td>
                    <td className="px-4 py-3 text-slate-500">{u.employee_id || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{u.email || '-'}</td>
                    {/* Actions — moved after Email */}
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-blue-600 transition" title={t('common.edit')}>
                          <Edit size={14} />
                        </button>
                        <button onClick={() => handleDelete(u.id, u.username)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-500 hover:text-red-600 transition" title={t('common.delete')}>
                          <Trash2 size={14} />
                        </button>
                        {u.employee_id && (
                          <button
                            onClick={() => handleSyncOne(u.id)}
                            disabled={syncingId === u.id}
                            className="p-1.5 hover:bg-green-50 rounded-lg text-slate-500 hover:text-green-600 transition"
                            title={t('users.syncOrg')}
                          >
                            <RefreshCw size={14} className={syncingId === u.id ? 'animate-spin' : ''} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                        {u.role === 'admin' ? t('users.adminRole') : t('users.normalUser')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {u2.role_name ? (
                        <span className="flex items-center gap-1">
                          <UserCog size={12} className="text-blue-500" />
                          {u2.role_name}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Text upload */}
                    <td className="px-4 py-3 text-center">
                      {u2.allow_text_upload !== 0
                        ? <span className="text-green-600 text-xs font-medium">✓ {u2.text_max_mb}M</span>
                        : <span className="text-slate-300 text-xs">✗</span>}
                    </td>
                    {/* Audio upload */}
                    <td className="px-4 py-3 text-center">
                      {u2.allow_audio_upload === 1
                        ? <span className="text-green-600 text-xs font-medium">✓ {u2.audio_max_mb}M</span>
                        : <span className="text-slate-300 text-xs">✗</span>}
                    </td>
                    {/* Image upload */}
                    <td className="px-4 py-3 text-center">
                      {u2.allow_image_upload !== 0
                        ? <span className="text-green-600 text-xs font-medium">✓ {u2.image_max_mb}M</span>
                        : <span className="text-slate-300 text-xs">✗</span>}
                    </td>
                    {/* Scheduled tasks */}
                    <td className="px-4 py-3 text-center">
                      {u2.allow_scheduled_tasks === 1
                        ? <Check size={13} className="text-green-600 mx-auto" />
                        : <X size={13} className="text-slate-300 mx-auto" />}
                    </td>
                    {/* Budget */}
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {hasBudget ? (
                        <div className="flex flex-col gap-0.5">
                          {budgetD != null && <span className="text-orange-600">{t('roles.budgetDaily')} ${budgetD}</span>}
                          {budgetW != null && <span className="text-blue-600">{t('roles.budgetWeekly')} ${budgetW}</span>}
                          {budgetM != null && <span className="text-purple-600">{t('roles.budgetMonthly')} ${budgetM}</span>}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {u2.creation_method === 'ldap'
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{t('users.ldapBadge')}</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{t('users.manualBadge')}</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs font-medium ${u.status === 'active' ? 'text-green-600' : 'text-slate-400'}`}>
                        {u.status === 'active' ? <Check size={12} /> : <X size={12} />}
                        {u.status === 'active' ? t('users.status.active') : t('users.status.inactive')}
                      </span>
                    </td>
                    {/* Org columns */}
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40 border-l border-green-100">{u2.dept_code || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40">{u2.dept_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40">{u2.profit_center || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40">{u2.profit_center_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40">{u2.org_section || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40">{u2.org_section_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40">{u2.org_group_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40">{u2.factory_code || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs bg-green-50/40">{u2.org_end_date || '-'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs bg-green-50/40">{u2.org_synced_at ? fmtTW(u2.org_synced_at) : '-'}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={24} className="px-4 py-8 text-center text-slate-400 text-sm">{t('common.noData')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
