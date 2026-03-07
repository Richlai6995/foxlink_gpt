import { useState, useEffect } from 'react'
import { Plus, Edit, Trash2, Save, X, Check, Download, UserCog, FileText, Mic, Image, CalendarClock, RefreshCw, Building2, Search } from 'lucide-react'
import type { User } from '../../types'
import api from '../../lib/api'

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
  kb_max_size_mb: string
  kb_max_count: string
  role_id: number | null
  budget_daily: string
  budget_weekly: string
  budget_monthly: string
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
  kb_max_size_mb: '',
  kb_max_count: '',
  role_id: null,
  budget_daily: '', budget_weekly: '', budget_monthly: '',
  dept_code: '', dept_name: '', profit_center: '', profit_center_name: '',
  org_section: '', org_section_name: '', org_group_name: '', factory_code: '', org_end_date: '',
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<UserForm>(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [search, setSearch] = useState('')

  const load = async () => {
    const [usersRes, rolesRes] = await Promise.all([
      api.get('/users'),
      api.get('/roles'),
    ])
    setUsers(Array.isArray(usersRes.data) ? usersRes.data : [])
    setRoles(Array.isArray(rolesRes.data) ? rolesRes.data : [])
  }

  useEffect(() => { load() }, [])

  // search filter
  const filtered = search.trim()
    ? users.filter((u) => {
      const q = search.trim().toLowerCase()
      const u2 = u as any
      return (
        u.username?.toLowerCase().includes(q) ||
        u.name?.toLowerCase().includes(q) ||
        (u.employee_id || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u2.dept_name || '').toLowerCase().includes(q) ||
        (u2.profit_center_name || '').toLowerCase().includes(q) ||
        (u2.org_section_name || '').toLowerCase().includes(q) ||
        (u2.org_group_name || '').toLowerCase().includes(q)
      )
    })
    : users

  const openNew = () => {
    setForm(empty)
    setEditId(null)
    setError('')
    setShowForm(true)
  }

  const openEdit = (u: User) => {
    const u2 = u as any
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
      kb_max_size_mb: u2.kb_max_size_mb != null ? String(u2.kb_max_size_mb) : '',
      kb_max_count: u2.kb_max_count != null ? String(u2.kb_max_count) : '',
    })
    setEditId(u.id)
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
      if (editId) {
        await api.put(`/users/${editId}`, payload)
      } else {
        await api.post('/users', payload)
      }
      setShowForm(false)
      await load()
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || '儲存失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(`確定刪除使用者 ${username}？`)) return
    try {
      await api.delete(`/users/${id}`)
      await load()
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } })?.response?.data?.error || '刪除失敗')
    }
  }

  const handleSyncOne = async (id: number) => {
    setSyncingId(id)
    setSyncMsg('')
    try {
      const res = await api.post(`/admin/users/${id}/sync-org`)
      setSyncMsg(res.data.message || '同步完成')
      await load()
    } catch (e: unknown) {
      const errMsg = (e as any)?.response?.data?.error || '同步失敗'
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
      setSyncMsg(res.data.message || '全部同步完成')
      await load()
    } catch (e: unknown) {
      const errMsg = (e as any)?.response?.data?.error || '同步失敗'
      setSyncMsg(errMsg)
    } finally {
      setSyncingAll(false)
    }
  }

  const exportCsv = () => {
    const header = '帳號,姓名,工號,Email,角色,狀態,部門代碼,部門名稱,利潤中心,利潤中心名稱,事業處代碼,事業處名稱,事業群名稱,廠區碼,離職日'
    const lines = users.map((u) => {
      const u2 = u as any
      return [
        u.username, u.name, u.employee_id || '', u.email || '',
        u.role === 'admin' ? '管理員' : '一般使用者',
        u.status === 'active' ? '啟用' : '停用',
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
        <h2 className="text-lg font-semibold text-slate-800">使用者管理</h2>
        <div className="flex gap-2 flex-wrap items-center">
          {syncMsg && <span className="text-xs text-blue-600 max-w-xs truncate">{syncMsg}</span>}
          <button onClick={handleSyncAll} disabled={syncingAll}
            className="btn-ghost flex items-center gap-1.5 text-sm">
            <RefreshCw size={14} className={syncingAll ? 'animate-spin' : ''} />
            同步所有組織
          </button>
          <button onClick={exportCsv} disabled={users.length === 0} className="btn-ghost flex items-center gap-1.5">
            <Download size={14} /> 匯出 CSV
          </button>
          <button onClick={openNew} className="btn-primary flex items-center gap-1.5">
            <Plus size={15} /> 新增使用者
          </button>
        </div>
      </div>

      {/* 搜尋列 */}
      <div className="mb-3 flex items-center gap-2 bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-200">
        <Search size={15} className="text-slate-400 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋 姓名 / 工號 / Email / 部門名稱 / 利潤中心名稱 / 事業處名稱 / 事業群名稱"
          className="flex-1 bg-transparent text-sm outline-none text-slate-700 placeholder:text-slate-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
        {search && (
          <span className="text-xs text-slate-500 shrink-0">{filtered.length} / {users.length}</span>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
              <h3 className="font-semibold">{editId ? '編輯使用者' : '新增使用者'}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className="label">帳號 *</label>
                  <input {...F('username')} className="input" disabled={!!editId} />
                </div>
                <div>
                  <label className="label">密碼 {editId && '(留空不改)'}</label>
                  <input {...F('password')} type="password" autoComplete="new-password" className="input" />
                </div>
                <div>
                  <label className="label">姓名 *</label>
                  <input {...F('name')} className="input" />
                </div>
                <div>
                  <label className="label">工號</label>
                  <input {...F('employee_id')} className="input" />
                </div>
                <div className="col-span-2">
                  <label className="label">Email</label>
                  <input {...F('email')} type="email" className="input" />
                </div>
                <div>
                  <label className="label">角色</label>
                  <select {...F('role')} className="input">
                    <option value="user">一般使用者</option>
                    <option value="admin">系統管理員</option>
                  </select>
                </div>
                <div>
                  <label className="label">狀態</label>
                  <select {...F('status')} className="input">
                    <option value="active">啟用</option>
                    <option value="inactive">停用</option>
                  </select>
                </div>
                <div>
                  <label className="label">生效日期</label>
                  <input {...F('start_date')} type="date" className="input" />
                </div>
                <div>
                  <label className="label">到期日期</label>
                  <input {...F('end_date')} type="date" className="input" />
                </div>
                {/* Upload permissions */}
                <div className="col-span-2 border-t pt-3 mt-1">
                  <p className="text-xs font-semibold text-slate-500 mb-2">上傳權限</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.allow_text_upload}
                        onChange={e => setForm(p => ({ ...p, allow_text_upload: e.target.checked }))}
                        className="w-4 h-4 accent-blue-600"
                      />
                      文字類上傳
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">上限 (MB)</span>
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
                      聲音類上傳
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">上限 (MB)</span>
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
                      圖片類上傳
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">上限 (MB)</span>
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
                <label className="label mb-1.5">功能權限</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.allow_scheduled_tasks}
                    onChange={e => setForm(p => ({ ...p, allow_scheduled_tasks: e.target.checked }))}
                    className="w-4 h-4 accent-blue-600"
                  />
                  允許使用排程任務功能
                </label>
              </div>

              {/* Role assignment */}
              <div className="px-5 pb-4 border-t pt-3">
                <label className="label mb-1.5 flex items-center gap-1.5">
                  <UserCog size={14} /> MCP / DIFY 角色
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
                  <option value="">— 不指派角色 —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.is_default ? ' (預設)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">決定此使用者可使用的 MCP 工具與 DIFY 知識庫</p>
              </div>

              {/* Budget override */}
              <div className="px-5 pb-4 border-t pt-3">
                <p className="label mb-2">使用金額限制（個人覆蓋，空白=沿用角色設定）</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">當日上限 ($)</label>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.budget_daily}
                      onChange={e => setForm(p => ({ ...p, budget_daily: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder="無限制"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">當週上限 ($)</label>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.budget_weekly}
                      onChange={e => setForm(p => ({ ...p, budget_weekly: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder="無限制"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">當月上限 ($)</label>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.budget_monthly}
                      onChange={e => setForm(p => ({ ...p, budget_monthly: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder="無限制"
                    />
                  </div>
                </div>
              </div>

              {/* Skill permission override */}
              <div className="px-5 pb-4 border-t pt-3">
                <p className="label mb-2 flex items-center gap-1.5">✨ Skill 權限（個人覆蓋，null=沿用角色設定）</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <select
                      value={form.allow_create_skill === null ? '' : form.allow_create_skill ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, allow_create_skill: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">沿用角色</option>
                      <option value="1">允許建立 Skill</option>
                      <option value="0">禁止建立 Skill</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <select
                      value={form.allow_external_skill === null ? '' : form.allow_external_skill ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, allow_external_skill: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">沿用角色</option>
                      <option value="1">允許外部 Skill</option>
                      <option value="0">禁止外部 Skill</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* KB permission */}
              <div className="px-5 pb-4 border-t pt-3">
                <p className="label mb-2 flex items-center gap-1.5">📚 知識庫 / 深度研究權限（個人覆蓋，null=沿用角色設定）</p>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">建立知識庫</label>
                    <select
                      value={form.can_create_kb === null ? '' : form.can_create_kb ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, can_create_kb: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">沿用角色</option>
                      <option value="1">允許建立</option>
                      <option value="0">禁止建立</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">深度研究</label>
                    <select
                      value={form.can_deep_research === null ? '' : form.can_deep_research ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, can_deep_research: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">沿用角色設定</option>
                      <option value="1">強制允許</option>
                      <option value="0">強制禁止</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">AI 戰情設計</label>
                    <select
                      value={form.can_design_ai_select === null ? '' : form.can_design_ai_select ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, can_design_ai_select: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">預設禁止</option>
                      <option value="1">允許設計</option>
                      <option value="0">禁止</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">AI 戰情查詢</label>
                    <select
                      value={form.can_use_ai_dashboard === null ? '' : form.can_use_ai_dashboard ? '1' : '0'}
                      onChange={e => setForm(p => ({ ...p, can_use_ai_dashboard: e.target.value === '' ? null : e.target.value === '1' }))}
                      className="input py-1 text-sm"
                    >
                      <option value="">預設禁止</option>
                      <option value="1">允許使用</option>
                      <option value="0">禁止</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">最大容量 (MB，空白=沿用角色)</label>
                    <input
                      type="number" min={1} step={1}
                      value={form.kb_max_size_mb}
                      onChange={e => setForm(p => ({ ...p, kb_max_size_mb: e.target.value }))}
                      className="input py-1.5 text-sm"
                      placeholder="500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">最多知識庫數量（空白=沿用角色）</label>
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
                  <Building2 size={13} /> 組織資料（可手動覆蓋；儲存工號時系統自動從 ERP 同步）
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">部門代碼</label>
                    <input {...F('dept_code')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">部門名稱</label>
                    <input {...F('dept_name')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">利潤中心代碼</label>
                    <input {...F('profit_center')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">利潤中心名稱</label>
                    <input {...F('profit_center_name')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">事業處代碼</label>
                    <input {...F('org_section')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">事業處名稱</label>
                    <input {...F('org_section_name')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">事業群名稱</label>
                    <input {...F('org_group_name')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">廠區碼</label>
                    <input {...F('factory_code')} className="input py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">離職日</label>
                    <input {...F('org_end_date')} type="date" className="input py-1.5 text-sm" />
                  </div>
                </div>
              </div>

              {/* Creation method (read-only, edit mode only) */}
              {editId && (
                <div className="px-5 pb-4 border-t pt-3">
                  <p className="label mb-1.5">產生方式</p>
                  {(() => {
                    const method = (users.find(u => u.id === editId) as any)?.creation_method || 'manual'
                    return (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${method === 'ldap'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600'
                        }`}>
                        {method === 'ldap' ? '🔗 AD 網域同步 (LDAP)' : '✏️ 手動建立'}
                      </span>
                    )
                  })()}
                  <p className="text-xs text-slate-400 mt-1">此欄位由系統自動記錄，LDAP 帳號密碼由 AD 管理</p>
                </div>
              )}
            </div>{/* end scrollable area */}

            {error && <p className="px-5 py-2 text-red-500 text-sm flex-shrink-0">{error}</p>}
            <div className="flex justify-end gap-2 p-5 border-t flex-shrink-0">
              <button onClick={() => setShowForm(false)} className="btn-ghost">取消</button>
              <button onClick={handleSave} disabled={loading} className="btn-primary flex items-center gap-1.5">
                <Save size={14} /> {loading ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">帳號</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">姓名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">工號</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">系統角色</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">MCP/DIFY角色</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 text-center" title="文字上傳"><FileText size={13} className="inline" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 text-center" title="聲音上傳"><Mic size={13} className="inline" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 text-center" title="圖片上傳"><Image size={13} className="inline" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 text-center" title="排程任務"><CalendarClock size={13} className="inline" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600" title="日/週/月金額上限">限額</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">產生方式</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">狀態</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">操作</th>
                {/* Org columns — visible by scrolling right */}
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50 border-l border-green-200">部門代碼</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">部門名稱</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">利潤中心</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">利潤中心名稱</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">事業處</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">事業處名稱</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">事業群名稱</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">廠區碼</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">離職日</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 bg-green-50">最後同步</th>
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
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                        {u.role === 'admin' ? '管理員' : '一般使用者'}
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
                    {/* 文字上傳 */}
                    <td className="px-4 py-3 text-center">
                      {u2.allow_text_upload !== 0
                        ? <span className="text-green-600 text-xs font-medium">✓ {u2.text_max_mb}M</span>
                        : <span className="text-slate-300 text-xs">✗</span>}
                    </td>
                    {/* 聲音上傳 */}
                    <td className="px-4 py-3 text-center">
                      {u2.allow_audio_upload === 1
                        ? <span className="text-green-600 text-xs font-medium">✓ {u2.audio_max_mb}M</span>
                        : <span className="text-slate-300 text-xs">✗</span>}
                    </td>
                    {/* 圖片上傳 */}
                    <td className="px-4 py-3 text-center">
                      {u2.allow_image_upload !== 0
                        ? <span className="text-green-600 text-xs font-medium">✓ {u2.image_max_mb}M</span>
                        : <span className="text-slate-300 text-xs">✗</span>}
                    </td>
                    {/* 排程任務 */}
                    <td className="px-4 py-3 text-center">
                      {u2.allow_scheduled_tasks === 1
                        ? <Check size={13} className="text-green-600 mx-auto" />
                        : <X size={13} className="text-slate-300 mx-auto" />}
                    </td>
                    {/* 限額欄 */}
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {hasBudget ? (
                        <div className="flex flex-col gap-0.5">
                          {budgetD != null && <span className="text-orange-600">日 ${budgetD}</span>}
                          {budgetW != null && <span className="text-blue-600">週 ${budgetW}</span>}
                          {budgetM != null && <span className="text-purple-600">月 ${budgetM}</span>}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {u2.creation_method === 'ldap'
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">LDAP</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">手動</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs font-medium ${u.status === 'active' ? 'text-green-600' : 'text-slate-400'}`}>
                        {u.status === 'active' ? <Check size={12} /> : <X size={12} />}
                        {u.status === 'active' ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-blue-600 transition" title="編輯">
                          <Edit size={14} />
                        </button>
                        <button onClick={() => handleDelete(u.id, u.username)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-500 hover:text-red-600 transition" title="刪除">
                          <Trash2 size={14} />
                        </button>
                        {u.employee_id && (
                          <button
                            onClick={() => handleSyncOne(u.id)}
                            disabled={syncingId === u.id}
                            className="p-1.5 hover:bg-green-50 rounded-lg text-slate-500 hover:text-green-600 transition"
                            title="同步組織資料"
                          >
                            <RefreshCw size={14} className={syncingId === u.id ? 'animate-spin' : ''} />
                          </button>
                        )}
                      </div>
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
                    <td className="px-4 py-3 text-slate-400 text-xs bg-green-50/40">{u2.org_synced_at ? u2.org_synced_at.slice(0, 16).replace('T', ' ') : '-'}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={24} className="px-4 py-8 text-center text-slate-400 text-sm">查無資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
