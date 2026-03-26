import { useEffect, useState } from 'react'
import { Plus, Trash2, Edit2, Star, StarOff, Check, FileText, Mic, Image, CalendarClock, Code2, Database, ShieldCheck, Building2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'

interface OrgBinding { id: number; role_id: number; org_type: string; org_code: string; org_name: string | null }
interface OrgLovItem { code: string; name: string }
interface OrgLov { department: OrgLovItem[]; cost_center: OrgLovItem[]; division: OrgLovItem[]; org_group: OrgLovItem[] }
const ORG_TYPE_LABELS: Record<string, string> = {
  department: '部門', cost_center: '利潤中心', division: '事業處', org_group: '事業群'
}
const ORG_TABS = ['department', 'cost_center', 'division', 'org_group'] as const

interface Policy {
  id: number
  name: string
  description: string | null
}

interface Role {
  id: number
  name: string
  description: string | null
  is_default: number
  created_at: string
  budget_daily: number | null
  budget_weekly: number | null
  budget_monthly: number | null
  quota_exceed_action: string
  allow_text_upload: number
  text_max_mb: number
  allow_audio_upload: number
  audio_max_mb: number
  allow_image_upload: number
  image_max_mb: number
  allow_scheduled_tasks: number
  allow_create_skill: number
  allow_external_skill: number
  allow_code_skill: number
  can_create_kb: number
  kb_max_size_mb: number | null
  kb_max_count: number | null
  can_deep_research: number
  can_design_ai_select: number
  can_use_ai_dashboard: number
}

const emptyForm = {
  name: '',
  description: '',
  is_default: false,
  budget_daily: '',
  budget_weekly: '',
  budget_monthly: '',
  quota_exceed_action: 'block',
  allow_text_upload: true,
  text_max_mb: 10,
  allow_audio_upload: false,
  audio_max_mb: 10,
  allow_image_upload: true,
  image_max_mb: 10,
  allow_scheduled_tasks: false,
  allow_create_skill: false,
  allow_external_skill: false,
  allow_code_skill: false,
  can_create_kb: false,
  kb_max_size_mb: 500,
  kb_max_count: 5,
  can_deep_research: true,
  can_design_ai_select: false,
  can_use_ai_dashboard: false,
}

export default function RoleManagement() {
  const { t } = useTranslation()
  const [roles, setRoles] = useState<Role[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [roleAssignments, setRoleAssignments] = useState<Record<string, number | null>>({}) // roleId → policyId
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formPolicyId, setFormPolicyId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [orgBindings, setOrgBindings] = useState<OrgBinding[]>([])
  const [orgLov, setOrgLov] = useState<OrgLov | null>(null)
  const [orgTab, setOrgTab] = useState<typeof ORG_TABS[number]>('department')
  const [orgSearch, setOrgSearch] = useState('')
  const [orgError, setOrgError] = useState('')
  const [showOrgPicker, setShowOrgPicker] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const [rolesRes, policiesRes, assignRes] = await Promise.all([
        api.get('/roles'),
        api.get('/data-permissions/policies').catch(() => ({ data: [] })),
        api.get('/data-permissions/assignments').catch(() => ({ data: [] })),
      ])
      setRoles(rolesRes.data)
      setPolicies(policiesRes.data)
      // build role → policyId map
      const map: Record<string, number | null> = {}
      for (const a of (assignRes.data as any[])) {
        if (a.grantee_type === 'role') map[String(a.grantee_id)] = a.policy_id
      }
      setRoleAssignments(map)
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormPolicyId(null)
    setOrgBindings([])
    setOrgSearch('')
    setOrgError('')
    setError('')
    setShowModal(true)
  }

  const loadOrgData = async (roleId: number) => {
    try {
      const [bindingsRes, lovRes] = await Promise.all([
        api.get(`/roles/${roleId}/org-bindings`),
        orgLov ? Promise.resolve({ data: orgLov }) : api.get('/roles/org-lov'),
      ])
      setOrgBindings(bindingsRes.data)
      if (!orgLov) setOrgLov(lovRes.data)
    } catch (e: any) {
      console.error('[loadOrgData]', e)
      // 載入失敗給空結構，讓畫面不卡在「載入中」
      if (!orgLov) setOrgLov({ department: [], cost_center: [], division: [], org_group: [] })
      setOrgError('組織資料載入失敗：' + (e.response?.data?.error || e.message))
    }
    setOrgSearch('')
  }

  const addOrgBinding = async (roleId: number, type: string, item: OrgLovItem) => {
    setOrgError('')
    try {
      const r = await api.post(`/roles/${roleId}/org-bindings`, { org_type: type, org_code: item.code, org_name: item.name })
      setOrgBindings(r.data)
    } catch (e: any) {
      setOrgError(e.response?.data?.error || '新增失敗')
    }
  }

  const removeOrgBinding = async (roleId: number, bindingId: number) => {
    try {
      await api.delete(`/roles/${roleId}/org-bindings/${bindingId}`)
      setOrgBindings(prev => prev.filter(b => b.id !== bindingId))
    } catch (e: any) {
      setOrgError(e.response?.data?.error || '刪除失敗')
    }
  }

  const openEdit = (role: Role) => {
    setEditing(role)
    setFormPolicyId(roleAssignments[String(role.id)] ?? null)
    loadOrgData(role.id)
    setForm({
      name: role.name,
      description: role.description || '',
      is_default: !!role.is_default,
      budget_daily: role.budget_daily != null ? String(role.budget_daily) : '',
      budget_weekly: role.budget_weekly != null ? String(role.budget_weekly) : '',
      budget_monthly: role.budget_monthly != null ? String(role.budget_monthly) : '',
      quota_exceed_action: role.quota_exceed_action || 'block',
      allow_text_upload: role.allow_text_upload !== 0,
      text_max_mb: role.text_max_mb || 10,
      allow_audio_upload: role.allow_audio_upload === 1,
      audio_max_mb: role.audio_max_mb || 10,
      allow_image_upload: role.allow_image_upload !== 0,
      image_max_mb: role.image_max_mb || 10,
      allow_scheduled_tasks: role.allow_scheduled_tasks === 1,
      allow_create_skill: role.allow_create_skill === 1,
      allow_external_skill: role.allow_external_skill === 1,
      allow_code_skill: role.allow_code_skill === 1,
      can_create_kb: role.can_create_kb === 1,
      kb_max_size_mb: role.kb_max_size_mb ?? 500,
      kb_max_count: role.kb_max_count ?? 5,
      can_deep_research: role.can_deep_research !== 0,
      can_design_ai_select: role.can_design_ai_select === 1,
      can_use_ai_dashboard: role.can_use_ai_dashboard === 1,
    })
    setError('')
    setShowModal(true)
  }

  const toggleId = (arr: number[], id: number) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]

  const save = async () => {
    if (!form.name.trim()) { setError(t('roles.nameRequired')); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        budget_daily: form.budget_daily !== '' ? Number(form.budget_daily) : null,
        budget_weekly: form.budget_weekly !== '' ? Number(form.budget_weekly) : null,
        budget_monthly: form.budget_monthly !== '' ? Number(form.budget_monthly) : null,
      }
      let roleId: number
      if (editing) {
        await api.put(`/roles/${editing.id}`, payload)
        roleId = editing.id
      } else {
        const r = await api.post('/roles', payload)
        roleId = r.data.id
      }
      // sync policy assignment
      await api.put(`/data-permissions/assignments/role/${roleId}`, { policy_id: formPolicyId })
      setShowModal(false)
      load()
    } catch (e: any) {
      setError(e.response?.data?.error || t('roles.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const deleteRole = async (role: Role) => {
    if (!confirm(t('roles.deleteConfirm', { name: role.name }))) return
    try {
      await api.delete(`/roles/${role.id}`)
      load()
    } catch (e: any) {
      alert(e.response?.data?.error || t('roles.deleteFailed'))
    }
  }

  const setDefault = async (role: Role) => {
    try {
      await api.put(`/roles/${role.id}`, {
        name: role.name,
        description: role.description,
        is_default: true,
        budget_daily: role.budget_daily,
        budget_weekly: role.budget_weekly,
        budget_monthly: role.budget_monthly,
        allow_text_upload: role.allow_text_upload,
        text_max_mb: role.text_max_mb,
        allow_audio_upload: role.allow_audio_upload,
        audio_max_mb: role.audio_max_mb,
        allow_image_upload: role.allow_image_upload,
        image_max_mb: role.image_max_mb,
        allow_scheduled_tasks: role.allow_scheduled_tasks,
        can_create_kb: role.can_create_kb,
        kb_max_size_mb: role.kb_max_size_mb,
        kb_max_count: role.kb_max_count,
      })
      load()
    } catch (e: any) {
      alert(e.response?.data?.error || t('roles.setDefaultFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">{t('roles.title')}</h2>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          <Plus size={15} /> {t('roles.addRole')}
        </button>
      </div>

      <p className="text-xs text-slate-500">{t('roles.desc')}</p>

      {loading ? (
        <div className="text-slate-400 text-sm">{t('common.loading')}</div>
      ) : roles.length === 0 ? (
        <div className="text-slate-400 text-sm p-8 text-center border border-dashed rounded-lg">
          {t('roles.noRoles')}
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => (
            <div key={role.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {role.is_default ? (
                    <Star size={15} className="text-yellow-500 shrink-0" />
                  ) : (
                    <StarOff size={15} className="text-slate-300 shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{role.name}</span>
                      {role.is_default && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">{t('roles.defaultBadge')}</span>
                      )}
                    </div>
                    {role.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{role.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!role.is_default && (
                    <button
                      onClick={() => setDefault(role)}
                      className="p-1.5 text-slate-400 hover:text-yellow-500 rounded hover:bg-slate-50"
                      title={t('roles.setAsDefault')}
                    >
                      <Star size={15} />
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(role)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-slate-50"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => deleteRole(role)}
                    className="p-1.5 text-slate-400 hover:text-red-500 rounded hover:bg-slate-50"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Permission summary */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${role.allow_text_upload !== 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200 line-through'}`}>
                  <FileText size={10} /> {t('roles.permText')}{role.allow_text_upload !== 0 ? ` ${role.text_max_mb}MB` : ''}
                </span>
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${role.allow_audio_upload === 1 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200 line-through'}`}>
                  <Mic size={10} /> {t('roles.permAudio')}{role.allow_audio_upload === 1 ? ` ${role.audio_max_mb}MB` : ''}
                </span>
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${role.allow_image_upload !== 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200 line-through'}`}>
                  <Image size={10} /> {t('roles.permImage')}{role.allow_image_upload !== 0 ? ` ${role.image_max_mb}MB` : ''}
                </span>
                {role.allow_scheduled_tasks === 1 && (
                  <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                    <CalendarClock size={10} /> {t('roles.permSchedule')}
                  </span>
                )}
                {role.allow_code_skill === 1 && (
                  <span className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <Code2 size={10} /> {t('roles.permCodeSkill')}
                  </span>
                )}
              </div>
              {/* Budget summary */}
              {(role.budget_daily != null || role.budget_weekly != null || role.budget_monthly != null) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {role.budget_daily != null && (
                    <span className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">{t('roles.budgetDaily')} ${role.budget_daily}</span>
                  )}
                  {role.budget_weekly != null && (
                    <span className="text-xs bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full">{t('roles.budgetWeekly')} ${role.budget_weekly}</span>
                  )}
                  {role.budget_monthly != null && (
                    <span className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full">{t('roles.budgetMonthly')} ${role.budget_monthly}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">{editing ? t('roles.editRole') : t('roles.newRole')}</h3>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('roles.form.roleName')}</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('roles.form.roleNamePlaceholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('roles.form.description')}</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t('roles.form.descPlaceholder')}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-sm text-slate-700">{t('roles.form.setDefault')}</span>
              </label>

              {/* Upload & Function Permissions */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">{t('roles.form.uploadPerms')}</label>
                <div className="space-y-2">
                  {[
                    { label: t('roles.form.textFile'), icon: <FileText size={13} />, field: 'allow_text_upload', mbField: 'text_max_mb' },
                    { label: t('roles.form.audioFile'), icon: <Mic size={13} />, field: 'allow_audio_upload', mbField: 'audio_max_mb' },
                    { label: t('roles.form.imageFile'), icon: <Image size={13} />, field: 'allow_image_upload', mbField: 'image_max_mb' },
                  ].map(({ label, icon, field, mbField }) => (
                    <div key={field} className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 w-28 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={(form as any)[field]}
                          onChange={e => setForm({ ...form, [field]: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600"
                        />
                        {icon}
                        <span className="text-sm text-slate-700">{label}</span>
                      </label>
                      {(form as any)[field] && (
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min={1} max={500}
                            value={(form as any)[mbField]}
                            onChange={e => setForm({ ...form, [mbField]: Number(e.target.value) })}
                            className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm"
                          />
                          <span className="text-xs text-slate-500">{t('roles.form.mbLimit')}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.allow_scheduled_tasks}
                      onChange={e => setForm({ ...form, allow_scheduled_tasks: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <CalendarClock size={13} />
                    <span className="text-sm text-slate-700">{t('roles.form.allowSchedule')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).allow_create_skill}
                      onChange={e => setForm({ ...form, allow_create_skill: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">{t('roles.form.allowCreateSkill')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).allow_external_skill}
                      onChange={e => setForm({ ...form, allow_external_skill: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">{t('roles.form.allowExternalSkill')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).allow_code_skill}
                      onChange={e => setForm({ ...form, allow_code_skill: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <Code2 size={13} />
                    <span className="text-sm text-slate-700">{t('roles.form.allowCodeSkill')}</span>
                  </label>
                </div>
              </div>

              {/* KB Permissions */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                  <Database size={14} /> {t('roles.form.kbPerms')}
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).can_deep_research}
                      onChange={e => setForm({ ...form, can_deep_research: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">{t('roles.form.allowDeepResearch')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).can_use_ai_dashboard}
                      onChange={e => setForm({ ...form, can_use_ai_dashboard: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">{t('roles.form.allowAiDashboard')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).can_design_ai_select}
                      onChange={e => setForm({ ...form, can_design_ai_select: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">{t('roles.form.allowAiDesign')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).can_create_kb}
                      onChange={e => setForm({ ...form, can_create_kb: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">{t('roles.form.allowCreateKb')}</span>
                  </label>
                  {(form as any).can_create_kb && (
                    <div className="flex gap-4 pl-6">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" min={1} max={99999}
                          value={(form as any).kb_max_size_mb ?? 500}
                          onChange={e => setForm({ ...form, kb_max_size_mb: Number(e.target.value) } as any)}
                          className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm"
                        />
                        <span className="text-xs text-slate-500">{t('roles.form.kbMaxSizeMb')}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" min={1} max={999}
                          value={(form as any).kb_max_count ?? 5}
                          onChange={e => setForm({ ...form, kb_max_count: Number(e.target.value) } as any)}
                          className="w-16 border border-slate-300 rounded-lg px-2 py-1 text-sm"
                        />
                        <span className="text-xs text-slate-500">{t('roles.form.kbMaxCount')}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Data Policy */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                  <ShieldCheck size={14} /> {t('roles.form.dataPolicy')}
                </label>
                <select
                  value={formPolicyId ?? ''}
                  onChange={e => setFormPolicyId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t('roles.form.noPolicyOption')}</option>
                  {policies.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.description ? ` — ${p.description}` : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">{t('roles.form.dataPolicyNote')}</p>
              </div>

              {/* Budget limits */}
              <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">{t('roles.form.budgetTitle')}</label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t('roles.form.dailyLimit')}</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={form.budget_daily}
                    onChange={e => setForm({ ...form, budget_daily: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t('roles.form.unlimited')}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t('roles.form.weeklyLimit')}</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={form.budget_weekly}
                    onChange={e => setForm({ ...form, budget_weekly: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t('roles.form.unlimited')}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t('roles.form.monthlyLimit')}</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={form.budget_monthly}
                    onChange={e => setForm({ ...form, budget_monthly: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t('roles.form.unlimited')}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">{t('roles.form.budgetNote')}</p>
              <div className="mt-3">
                <label className="text-xs text-slate-500 mb-1 block">額度超過限制方式</label>
                <select
                  value={form.quota_exceed_action}
                  onChange={e => setForm({ ...form, quota_exceed_action: e.target.value })}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="block">禁止（封鎖請求）</option>
                  <option value="warn">警告（允許繼續使用，TopBar 顯示警告）</option>
                </select>
              </div>
            </div>

            {/* Org bindings — only when editing */}
            {editing && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <Building2 size={14} /> 預設組織綁定
                    <span className="text-xs text-slate-400 font-normal ml-1">（新 LDAP 使用者自動角色判斷）</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => { setShowOrgPicker(true); setOrgSearch('') }}
                    className="px-3 py-1 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-100"
                  >
                    + 設定組織
                  </button>
                </div>

                {/* Current bindings summary by type */}
                {ORG_TABS.map(tab => {
                  const items = orgBindings.filter(b => b.org_type === tab)
                  if (!items.length) return null
                  return (
                    <div key={tab} className="mb-2">
                      <span className="text-xs text-slate-500 mr-1">{ORG_TYPE_LABELS[tab]}：</span>
                      <div className="inline-flex flex-wrap gap-1">
                        {items.map(b => (
                          <span key={b.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                            {b.org_name || b.org_code}
                            <button type="button" onClick={() => removeOrgBinding(editing.id, b.id)} className="hover:text-red-500 ml-0.5"><X size={10} /></button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {orgBindings.length === 0 && <p className="text-xs text-slate-400">尚未設定組織綁定</p>}
                {orgError && <p className="text-xs text-red-500 mt-1">{orgError}</p>}
              </div>
            )}
            </div>{/* end scrollable */}

            <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                disabled={saving}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Org Picker Modal */}
      {showOrgPicker && editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setShowOrgPicker(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h4 className="font-semibold text-slate-800 text-sm">選擇組織綁定 — {editing.name}</h4>
              <button onClick={() => setShowOrgPicker(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 px-2">
              {ORG_TABS.map(tab => (
                <button key={tab} type="button" onClick={() => { setOrgTab(tab); setOrgSearch('') }}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${orgTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  {ORG_TYPE_LABELS[tab]}
                  <span className="ml-1.5 text-xs text-slate-400">({orgBindings.filter(b => b.org_type === tab).length})</span>
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="px-4 py-2 border-b border-slate-100">
              <input
                type="text"
                placeholder={`搜尋${ORG_TYPE_LABELS[orgTab]}名稱或代碼...`}
                value={orgSearch}
                onChange={e => setOrgSearch(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                autoFocus
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {!orgLov ? (
                <div className="text-sm text-slate-400 text-center py-8">載入中...</div>
              ) : (() => {
                const boundCodes = new Set(orgBindings.filter(b => b.org_type === orgTab).map(b => b.org_code))
                const items = (orgLov[orgTab] || []).filter(item =>
                  !orgSearch ||
                  item.code.toLowerCase().includes(orgSearch.toLowerCase()) ||
                  item.name.toLowerCase().includes(orgSearch.toLowerCase())
                )
                if (!items.length) return <div className="text-sm text-slate-400 text-center py-8">無符合資料</div>
                return items.map(item => {
                  const checked = boundCodes.has(item.code)
                  return (
                    <label key={item.code}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-slate-50 ${checked ? 'bg-blue-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (checked) {
                            const binding = orgBindings.find(b => b.org_type === orgTab && b.org_code === item.code)
                            if (binding) removeOrgBinding(editing.id, binding.id)
                          } else {
                            addOrgBinding(editing.id, orgTab, item)
                          }
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-800">{item.name}</div>
                        <div className="text-xs text-slate-400">{item.code}</div>
                      </div>
                      {checked && <Check size={14} className="text-blue-500 flex-shrink-0" />}
                    </label>
                  )
                })
              })()}
            </div>

            {orgError && <div className="px-4 py-2 text-xs text-red-500 border-t border-slate-100">{orgError}</div>}

            <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
              <button onClick={() => setShowOrgPicker(false)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
