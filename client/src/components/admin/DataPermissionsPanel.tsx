import { useState, useEffect, useCallback } from 'react'
import api from '../../lib/api'
import {
  Plus, Trash2, Edit2, Save, X, ChevronRight, ChevronDown,
  Shield, UserCheck, Building2, Database, Check,
  AlertCircle, RefreshCw, Tag, ChevronUp, GripVertical
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface PolicyRule {
  id?: number
  layer: 1 | 2 | 3 | 4
  include_type: 'include' | 'exclude'
  value_type: string
  value_id: string
  value_name: string
}

interface Policy {
  id: number
  name: string
  description?: string
  creator_name?: string
  rules: PolicyRule[]
  category_ids?: number[]
}

interface PolicyCategory {
  id: number
  name: string
  description?: string
  policy_ids?: number[]
}

interface PolicyAssignment {
  policy_id: number
  priority: number
  name?: string       // from backend JOIN
  policy_name?: string // local label fallback
}

interface Assignment {
  id: number
  policy_id: number | null
  policy_name?: string
  grantee_type: 'role' | 'user'
  grantee_id: number
}

interface OrgLov {
  DEPT_CODE: string; DEPT_DESC: string
  PROFIT_CENTER: string; PROFIT_CENTER_NAME: string
  ORG_SECTION: string; ORG_SECTION_NAME: string
  ORG_GROUP_NAME: string
  ORG_CODE?: string; ORG_ID?: number
}

interface ErpOrgLov {
  ORGANIZATION_ID: number; ORGANIZATION_CODE: string; ORGANIZATION_NAME: string
  OPERATING_UNIT: number; OPERATING_UNIT_NAME: string
  SET_OF_BOOKS_ID: number; SET_OF_BOOKS_NAME: string; CURRENCY_CODE: string
}

interface UserLov { id: number; username: string; name: string; employee_id?: string; dept_name?: string }
interface RoleLov { id: number; name: string; description?: string }

// ── Layer config ──────────────────────────────────────────────────────────────
const LAYER_LABELS: Record<number, { label: string; icon: React.ReactNode; color: string }> = {
  1: { label: '第1層 使用者過濾', icon: <UserCheck size={14} />, color: 'text-blue-600 bg-blue-50' },
  2: { label: '第2層 角色過濾', icon: <Shield size={14} />, color: 'text-purple-600 bg-purple-50' },
  3: { label: '第3層 組織過濾', icon: <Building2 size={14} />, color: 'text-green-600 bg-green-50' },
  4: { label: '第4層 ERP Multi-Org', icon: <Database size={14} />, color: 'text-orange-600 bg-orange-50' },
}

const VALUE_TYPE_OPTIONS: Record<number, { value: string; label: string }[]> = {
  1: [{ value: 'user_id', label: '使用者' }],
  2: [{ value: 'role_id', label: '角色' }],
  3: [
    { value: 'super_user',         label: '🔓 超級使用者（無限制）' },
    { value: 'auto_from_employee', label: '⚡ 依員工組織自動推導' },
    { value: 'dept_code', label: '部門' },
    { value: 'profit_center', label: '利潤中心' },
    { value: 'org_section', label: '事業處' },
    { value: 'org_group_name', label: '事業群' },
    { value: 'org_code', label: '組織代碼 (ORG_CODE)' },
  ],
  4: [
    { value: 'super_user',           label: '🔓 超級使用者（無限制）' },
    { value: 'auto_from_employee',   label: '⚡ 依員工組織自動推導' },
    { value: 'organization_id',      label: '製造組織 ID (數字)' },
    { value: 'organization_code',    label: '製造組織 Code (如 Z4E)' },
    { value: 'operating_unit',       label: '營運單位 ID (數字)' },
    { value: 'operating_unit_name',  label: '營運單位名稱' },
    { value: 'set_of_books_id',      label: '帳套 ID (數字)' },
    { value: 'set_of_books_name',    label: '帳套名稱' },
  ],
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DataPermissionsPanel() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [categories, setCategories] = useState<PolicyCategory[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [users, setUsers] = useState<UserLov[]>([])
  const [roles, setRoles] = useState<RoleLov[]>([])
  const [orgLov, setOrgLov] = useState<OrgLov[]>([])
  const [erpOrgLov, setErpOrgLov] = useState<ErpOrgLov[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Omit<Policy, 'id'>>({ name: '', description: '', rules: [] })
  const [activeTab, setActiveTab] = useState<'policies' | 'categories' | 'assignments'>('policies')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, cats, a, u, r, orgData, erpOrgData] = await Promise.all([
        api.get('/data-permissions/policies').then(r => r.data),
        api.get('/data-permissions/categories').then(r => r.data).catch(() => []),
        api.get('/data-permissions/assignments').then(r => r.data),
        api.get('/data-permissions/lov/users').then(r => r.data),
        api.get('/data-permissions/lov/roles').then(r => r.data),
        api.get('/data-permissions/lov/org').then(r => r.data).catch(() => []),
        api.get('/data-permissions/lov/erp-org').then(r => r.data).catch(() => []),
      ])
      setPolicies(p); setCategories(cats); setAssignments(a); setUsers(u); setRoles(r)
      setOrgLov(orgData); setErpOrgLov(erpOrgData)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const selectedPolicy = policies.find(p => p.id === selectedPolicyId) ?? null

  function startNew() {
    setSelectedPolicyId(null)
    setEditing(true)
    setEditForm({ name: '', description: '', rules: [] })
  }

  function startEdit(p: Policy) {
    setSelectedPolicyId(p.id)
    setEditing(true)
    setEditForm({ name: p.name, description: p.description || '', rules: [...p.rules] })
  }

  async function savePolicy() {
    if (!editForm.name.trim()) { setError('政策名稱為必填'); return }
    setSaving(true); setError('')
    try {
      if (selectedPolicyId) {
        await api.put(`/data-permissions/policies/${selectedPolicyId}`, editForm)
      } else {
        const r = await api.post('/data-permissions/policies', editForm)
        setSelectedPolicyId(r.data.id)
      }
      await load()
      setEditing(false)
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deletePolicy(id: number) {
    if (!confirm('確定刪除此政策？')) return
    try {
      await api.delete(`/data-permissions/policies/${id}`)
      if (selectedPolicyId === id) { setSelectedPolicyId(null); setEditing(false) }
      await load()
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500">載入中...</div>

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">資料權限管理</h2>
          <p className="text-xs text-slate-500 mt-0.5">設定多層級資料過濾政策，並指派給角色或使用者</p>
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
          <RefreshCw size={15} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
          <AlertCircle size={14} /> {error}
          <button className="ml-auto" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['policies', 'categories', 'assignments'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === t
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t === 'policies' ? '政策設定' : t === 'categories' ? '政策類別' : '角色/使用者指派'}
          </button>
        ))}
      </div>

      {activeTab === 'policies' && (
        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Policy List */}
          <div className="w-64 flex flex-col gap-2 min-h-0">
            <button
              onClick={startNew}
              className="flex items-center gap-2 text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              <Plus size={14} /> 新增政策
            </button>
            <div className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white">
              {policies.length === 0 && (
                <div className="text-center text-slate-400 text-sm py-8">尚無政策</div>
              )}
              {policies.map(p => (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 last:border-0 cursor-pointer transition ${selectedPolicyId === p.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                  onClick={() => { setSelectedPolicyId(p.id); setEditing(false) }}
                >
                  <Shield size={14} className="text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.rules.length} 條規則</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); startEdit(p) }}
                      className="p-1 text-slate-400 hover:text-blue-600 rounded"
                    ><Edit2 size={12} /></button>
                    <button
                      onClick={e => { e.stopPropagation(); deletePolicy(p.id) }}
                      className="p-1 text-slate-400 hover:text-red-600 rounded"
                    ><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Editor / Detail */}
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
            {editing ? (
              <PolicyEditor
                form={editForm}
                setForm={setEditForm}
                users={users}
                roles={roles}
                orgLov={orgLov}
                erpOrgLov={erpOrgLov}
                onSave={savePolicy}
                onCancel={() => setEditing(false)}
                saving={saving}
              />
            ) : selectedPolicy ? (
              <PolicyDetail
                policy={selectedPolicy}
                categories={categories}
                onEdit={() => startEdit(selectedPolicy)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
                <Shield size={40} className="mb-3 opacity-30" />
                選擇政策或新增
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'categories' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CategoriesPanel
            categories={categories}
            policies={policies}
            onRefresh={load}
          />
        </div>
      )}

      {activeTab === 'assignments' && (
        <div className="flex-1 overflow-y-auto">
          <AssignmentsPanel
            policies={policies}
            assignments={assignments}
            users={users}
            roles={roles}
            onRefresh={load}
          />
        </div>
      )}
    </div>
  )
}

// ── PolicyDetail ──────────────────────────────────────────────────────────────
function PolicyDetail({ policy, categories, onEdit }: { policy: Policy; categories: PolicyCategory[]; onEdit: () => void }) {
  const byLayer = [1, 2, 3, 4].map(l => ({
    layer: l,
    rules: policy.rules.filter(r => r.layer === l),
  }))

  const policyCats = categories.filter(c => c.policy_ids?.includes(policy.id))

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">{policy.name}</h3>
          {policy.description && <p className="text-sm text-slate-500 mt-1">{policy.description}</p>}
          {policyCats.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {policyCats.map(c => (
                <span key={c.id} className="inline-flex items-center gap-1 text-xs bg-purple-50 border border-purple-200 text-purple-700 px-2 py-0.5 rounded-full">
                  <Tag size={9} /> {c.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <button onClick={onEdit} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700">
          <Edit2 size={13} /> 編輯
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {byLayer.map(({ layer, rules }) => {
          const cfg = LAYER_LABELS[layer]
          if (rules.length === 0) return (
            <div key={layer} className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${cfg.color}`}>{cfg.icon}{cfg.label}</span>
              未設定（不過濾）
            </div>
          )
          return (
            <div key={layer} className="p-3 rounded-lg border border-slate-200">
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium mb-2 ${cfg.color}`}>
                {cfg.icon}{cfg.label}
              </div>
              <div className="flex flex-wrap gap-2">
                {rules.map((r, i) => (
                  <span
                    key={i}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${r.include_type === 'include'
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-red-50 border-red-200 text-red-700'}`}
                  >
                    {r.include_type === 'include' ? <Check size={10} /> : <X size={10} />}
                    {r.value_type === 'super_user' ? '🔓 超級使用者' : r.value_type === 'auto_from_employee' ? '⚡ 依員工組織' : (r.value_name || r.value_id)}
                    <span className="opacity-60 text-[10px]">({r.include_type === 'include' ? '允許' : '排除'})</span>
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── PolicyEditor ──────────────────────────────────────────────────────────────
function PolicyEditor({
  form, setForm, users, roles, orgLov, erpOrgLov, onSave, onCancel, saving
}: {
  form: Omit<Policy, 'id'>
  setForm: (f: Omit<Policy, 'id'>) => void
  users: UserLov[]; roles: RoleLov[]
  orgLov: OrgLov[]; erpOrgLov: ErpOrgLov[]
  onSave: () => void; onCancel: () => void; saving: boolean
}) {
  const [expandedLayer, setExpandedLayer] = useState<number | null>(1)

  function addRule(layer: 1 | 2 | 3 | 4) {
    const defaultType = VALUE_TYPE_OPTIONS[layer][0].value
    setForm({
      ...form,
      rules: [...form.rules, { layer, include_type: 'include', value_type: defaultType, value_id: '', value_name: '' }]
    })
  }

  function updateRule(idx: number, patch: Partial<PolicyRule>) {
    const rules = [...form.rules]
    rules[idx] = { ...rules[idx], ...patch }
    if (patch.value_type !== undefined) {
      rules[idx].value_id = ''
      rules[idx].value_name = ''
    }
    setForm({ ...form, rules })
  }

  function removeRule(idx: number) {
    setForm({ ...form, rules: form.rules.filter((_, i) => i !== idx) })
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">政策設定</h3>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={13} /> {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">政策名稱 *</label>
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
            placeholder="例：業務部門查詢權限"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">說明</label>
          <input
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
            placeholder="選填"
          />
        </div>
      </div>

      <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        各層正面表列：有設定才過濾，未設定的層不限制。包含/排除可混用。
      </div>

      {([1, 2, 3, 4] as const).map(layer => {
        const cfg = LAYER_LABELS[layer]
        const expanded = expandedLayer === layer
        return (
          <div key={layer} className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium transition ${expanded ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'}`}
              onClick={() => setExpandedLayer(expanded ? null : layer)}
            >
              <span className={`flex items-center gap-2 px-2 py-0.5 rounded ${cfg.color}`}>
                {cfg.icon} {cfg.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{form.rules.filter(r => r.layer === layer).length} 條</span>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
            </button>
            {expanded && (
              <div className="p-3 flex flex-col gap-2 border-t border-slate-100">
                {form.rules.map((rule, idx) => {
                  if (rule.layer !== layer) return null
                  return (
                    <RuleRow
                      key={idx}
                      rule={rule}
                      layer={layer}
                      users={users}
                      roles={roles}
                      orgLov={orgLov}
                      erpOrgLov={erpOrgLov}
                      onChange={patch => updateRule(idx, patch)}
                      onRemove={() => removeRule(idx)}
                    />
                  )
                })}
                <button
                  onClick={() => addRule(layer)}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 py-1"
                >
                  <Plus size={12} /> 新增規則
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── RuleRow ───────────────────────────────────────────────────────────────────
function RuleRow({
  rule, layer, users, roles, orgLov, erpOrgLov, onChange, onRemove
}: {
  rule: PolicyRule; layer: 1 | 2 | 3 | 4
  users: UserLov[]; roles: RoleLov[]; orgLov: OrgLov[]; erpOrgLov: ErpOrgLov[]
  onChange: (patch: Partial<PolicyRule>) => void
  onRemove: () => void
}) {
  const valueTypeOpts = VALUE_TYPE_OPTIONS[layer]

  function buildLovOptions() {
    const vt = rule.value_type
    if (vt === 'user_id') return users.map(u => ({ id: String(u.id), name: `${u.name}${u.employee_id ? ` (${u.employee_id})` : ''}` }))
    if (vt === 'role_id') return roles.map(r => ({ id: String(r.id), name: r.name }))

    if (vt === 'dept_code') {
      const map = new Map<string, string>()
      orgLov.forEach(o => { if (o.DEPT_CODE) map.set(o.DEPT_CODE, o.DEPT_DESC) })
      return Array.from(map.entries()).map(([id, name]) => ({ id, name: `${name} (${id})` }))
    }
    if (vt === 'profit_center') {
      const map = new Map<string, string>()
      orgLov.forEach(o => { if (o.PROFIT_CENTER) map.set(o.PROFIT_CENTER, o.PROFIT_CENTER_NAME) })
      return Array.from(map.entries()).map(([id, name]) => ({ id, name: `${name} (${id})` }))
    }
    if (vt === 'org_section') {
      const map = new Map<string, string>()
      orgLov.forEach(o => { if (o.ORG_SECTION) map.set(o.ORG_SECTION, o.ORG_SECTION_NAME) })
      return Array.from(map.entries()).map(([id, name]) => ({ id, name: `${name} (${id})` }))
    }
    if (vt === 'org_code') {
      const set = new Set<string>()
      orgLov.forEach(o => { if (o.ORG_CODE) set.add(o.ORG_CODE) })
      return Array.from(set).map(c => ({ id: c, name: c }))
    }
    if (vt === 'org_group_name') {
      const set = new Set<string>()
      orgLov.forEach(o => { if (o.ORG_GROUP_NAME) set.add(o.ORG_GROUP_NAME) })
      return Array.from(set).map(n => ({ id: n, name: n }))
    }

    if (vt === 'organization_id')   return erpOrgLov.map(o => ({ id: String(o.ORGANIZATION_ID), name: `${o.ORGANIZATION_NAME} (${o.ORGANIZATION_CODE})` }))
    if (vt === 'organization_code') return erpOrgLov.map(o => ({ id: o.ORGANIZATION_CODE, name: `${o.ORGANIZATION_NAME} (${o.ORGANIZATION_CODE})` }))
    if (vt === 'operating_unit') {
      const map = new Map<string, string>()
      erpOrgLov.forEach(o => { if (o.OPERATING_UNIT) map.set(String(o.OPERATING_UNIT), o.OPERATING_UNIT_NAME) })
      return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
    }
    if (vt === 'operating_unit_name') {
      const set = new Set<string>()
      erpOrgLov.forEach(o => { if (o.OPERATING_UNIT_NAME) set.add(o.OPERATING_UNIT_NAME) })
      return Array.from(set).map(n => ({ id: n, name: n }))
    }
    if (vt === 'set_of_books_id') {
      const map = new Map<string, string>()
      erpOrgLov.forEach(o => { if (o.SET_OF_BOOKS_ID) map.set(String(o.SET_OF_BOOKS_ID), o.SET_OF_BOOKS_NAME) })
      return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
    }
    if (vt === 'set_of_books_name') {
      const set = new Set<string>()
      erpOrgLov.forEach(o => { if (o.SET_OF_BOOKS_NAME) set.add(o.SET_OF_BOOKS_NAME) })
      return Array.from(set).map(n => ({ id: n, name: n }))
    }
    return []
  }

  const lovOpts = buildLovOptions()

  return (
    <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
      <select
        value={rule.include_type}
        onChange={e => onChange({ include_type: e.target.value as 'include' | 'exclude' })}
        className={`text-xs border rounded px-2 py-1 outline-none ${rule.include_type === 'include' ? 'border-green-300 text-green-700 bg-green-50' : 'border-red-300 text-red-700 bg-red-50'}`}
      >
        <option value="include">包含</option>
        <option value="exclude">排除</option>
      </select>

      <select
        value={rule.value_type}
        onChange={e => onChange({ value_type: e.target.value })}
        className="text-xs border border-slate-200 rounded px-2 py-1 outline-none bg-white"
      >
        {valueTypeOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {rule.value_type === 'super_user' ? (
        <div className="flex-1 flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
          <span className="text-[10px] text-amber-700 font-medium">🔓 超級使用者 — 不套用任何限制條件</span>
        </div>
      ) : rule.value_type === 'auto_from_employee' ? (
        <div className="flex-1 flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded px-2.5 py-1.5">
          <span className="text-[10px] text-blue-600 font-medium">自動依登入員工部門推導</span>
          <span className="text-[9px] text-blue-400">
            {layer === 4 ? 'dept → FL_ORG_EMP_DEPT_MV → ORGANIZATION_ID' : 'dept → FL_ORG_EMP_DEPT_MV → 組織範圍'}
          </span>
        </div>
      ) : lovOpts.length > 0 ? (
        <select
          value={rule.value_id}
          onChange={e => {
            const opt = lovOpts.find(o => o.id === e.target.value)
            onChange({ value_id: e.target.value, value_name: opt?.name || e.target.value })
          }}
          className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 outline-none bg-white"
        >
          <option value="">-- 請選擇 --</option>
          {lovOpts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      ) : (
        <div className="flex-1 flex flex-col gap-0.5">
          <input
            value={rule.value_id}
            onChange={e => onChange({ value_id: e.target.value, value_name: rule.value_name || e.target.value })}
            placeholder={layer === 4 ? '輸入 ID (ERP 未連線，請手動填入)' : '輸入代碼'}
            className="w-full border border-slate-200 rounded px-2 py-1 outline-none bg-white text-xs"
          />
          {layer === 4 && (
            <input
              value={rule.value_name || ''}
              onChange={e => onChange({ value_name: e.target.value })}
              placeholder="顯示名稱（選填）"
              className="w-full border border-slate-100 rounded px-2 py-1 outline-none bg-white text-[10px] text-slate-500"
            />
          )}
        </div>
      )}

      <button onClick={onRemove} className="p-1 text-slate-400 hover:text-red-500 rounded shrink-0">
        <X size={12} />
      </button>
    </div>
  )
}

// ── CategoriesPanel ───────────────────────────────────────────────────────────
function CategoriesPanel({
  categories, policies, onRefresh
}: {
  categories: PolicyCategory[]
  policies: Policy[]
  onRefresh: () => void
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editingNew, setEditingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // per-category edit state
  const [editCatId, setEditCatId] = useState<number | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editCatDesc, setEditCatDesc] = useState('')
  const [editCatPolicies, setEditCatPolicies] = useState<number[]>([])

  const selectedCat = categories.find(c => c.id === selectedId)

  function selectCat(c: PolicyCategory) {
    setSelectedId(c.id)
    setEditingNew(false)
    setEditCatId(null)
  }

  function startEditCat(c: PolicyCategory) {
    setEditCatId(c.id)
    setEditCatName(c.name)
    setEditCatDesc(c.description || '')
    setEditCatPolicies(c.policy_ids || [])
  }

  async function saveNewCategory() {
    if (!newName.trim()) { setError('類別名稱為必填'); return }
    setSaving(true); setError('')
    try {
      await api.post('/data-permissions/categories', { name: newName.trim(), description: newDesc.trim() })
      setNewName(''); setNewDesc(''); setEditingNew(false)
      await onRefresh()
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveEditCat() {
    if (!editCatName.trim()) { setError('類別名稱為必填'); return }
    setSaving(true); setError('')
    try {
      await api.put(`/data-permissions/categories/${editCatId}`, {
        name: editCatName.trim(),
        description: editCatDesc.trim()
      })
      await api.put(`/data-permissions/categories/${editCatId}/policies`, { policy_ids: editCatPolicies })
      setEditCatId(null)
      await onRefresh()
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteCategory(id: number) {
    if (!confirm('確定刪除此類別？（不會刪除關聯的政策）')) return
    try {
      await api.delete(`/data-permissions/categories/${id}`)
      if (selectedId === id) setSelectedId(null)
      await onRefresh()
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    }
  }

  function togglePolicy(pid: number) {
    setEditCatPolicies(prev =>
      prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]
    )
  }

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Left: category list */}
      <div className="w-64 flex flex-col gap-2 min-h-0">
        <button
          onClick={() => { setEditingNew(true); setSelectedId(null); setEditCatId(null) }}
          className="flex items-center gap-2 text-sm bg-purple-600 text-white px-3 py-2 rounded-lg hover:bg-purple-700 transition"
        >
          <Plus size={14} /> 新增類別
        </button>

        {editingNew && (
          <div className="bg-white border border-purple-200 rounded-lg p-3 flex flex-col gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="類別名稱 *"
              className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-300"
              autoFocus
            />
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="說明（選填）"
              className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm outline-none"
            />
            <div className="flex gap-1.5">
              <button
                onClick={saveNewCategory}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1 text-xs bg-purple-600 text-white px-2 py-1.5 rounded hover:bg-purple-700 disabled:opacity-50"
              >
                <Save size={11} /> {saving ? '儲存中...' : '建立'}
              </button>
              <button
                onClick={() => { setEditingNew(false); setNewName(''); setNewDesc('') }}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white">
          {categories.length === 0 && !editingNew && (
            <div className="text-center text-slate-400 text-sm py-8">尚無類別</div>
          )}
          {categories.map(c => (
            <div
              key={c.id}
              className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 last:border-0 cursor-pointer transition ${selectedId === c.id ? 'bg-purple-50' : 'hover:bg-slate-50'}`}
              onClick={() => selectCat(c)}
            >
              <Tag size={13} className="text-purple-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{c.name}</div>
                <div className="text-xs text-slate-400">{(c.policy_ids || []).length} 個政策</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); selectCat(c); startEditCat(c) }}
                  className="p-1 text-slate-400 hover:text-purple-600 rounded"
                ><Edit2 size={12} /></button>
                <button
                  onClick={e => { e.stopPropagation(); deleteCategory(c.id) }}
                  className="p-1 text-slate-400 hover:text-red-600 rounded"
                ><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: detail / edit */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {error && (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm mb-3">
            <AlertCircle size={14} /> {error}
            <button className="ml-auto" onClick={() => setError('')}><X size={14} /></button>
          </div>
        )}

        {editCatId !== null && selectedCat ? (
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">編輯類別</h3>
              <div className="flex gap-2">
                <button onClick={() => setEditCatId(null)} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
                  取消
                </button>
                <button
                  onClick={saveEditCat}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  <Save size={13} /> {saving ? '儲存中...' : '儲存'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">類別名稱 *</label>
                <input
                  value={editCatName}
                  onChange={e => setEditCatName(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-300 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">說明</label>
                <input
                  value={editCatDesc}
                  onChange={e => setEditCatDesc(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-300 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">包含的政策（多選）</label>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                {policies.length === 0 && (
                  <div className="text-center text-slate-400 text-sm py-4">尚無政策可選</div>
                )}
                {policies.map(p => (
                  <label
                    key={p.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={editCatPolicies.includes(p.id)}
                      onChange={() => togglePolicy(p.id)}
                      className="accent-purple-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800">{p.name}</div>
                      {p.description && <div className="text-xs text-slate-400 truncate">{p.description}</div>}
                    </div>
                    <span className="text-xs text-slate-400">{p.rules.length} 條規則</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : selectedCat ? (
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Tag size={16} className="text-purple-500" />
                  <h3 className="font-semibold text-slate-800">{selectedCat.name}</h3>
                </div>
                {selectedCat.description && <p className="text-sm text-slate-500 mt-1">{selectedCat.description}</p>}
              </div>
              <button
                onClick={() => startEditCat(selectedCat)}
                className="flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-700"
              >
                <Edit2 size={13} /> 編輯
              </button>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-600 mb-2">包含的政策</div>
              {(selectedCat.policy_ids || []).length === 0 ? (
                <div className="text-sm text-slate-400 italic">尚未指派任何政策</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(selectedCat.policy_ids || []).map(pid => {
                    const p = policies.find(x => x.id === pid)
                    if (!p) return null
                    return (
                      <div key={pid} className="flex items-center gap-3 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
                        <Shield size={13} className="text-purple-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800">{p.name}</div>
                          {p.description && <div className="text-xs text-slate-400 truncate">{p.description}</div>}
                        </div>
                        <span className="text-xs text-slate-400">{p.rules.length} 條規則</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
            <Tag size={40} className="mb-3 opacity-30" />
            選擇類別或新增
          </div>
        )}
      </div>
    </div>
  )
}

// ── AssignmentsPanel ──────────────────────────────────────────────────────────
function AssignmentsPanel({
  policies, assignments, users, roles, onRefresh
}: {
  policies: Policy[]; assignments: Assignment[]
  users: UserLov[]; roles: RoleLov[]
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'roles' | 'users'>('roles')
  const [error, setError] = useState('')

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
          <AlertCircle size={14} /> {error}
          <button className="ml-auto" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {(['roles', 'users'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t === 'roles' ? `角色 (${roles.length})` : `使用者 (${users.length})`}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="flex items-center gap-2 text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs">
          <AlertCircle size={13} /> 使用者有個人指派政策時優先套用；未設定則沿用所屬角色的政策。
        </div>
      )}

      <div className="flex flex-col gap-2">
        {tab === 'roles' && roles.map(role => (
          <MultiAssignRow
            key={role.id}
            type="role"
            granteeId={role.id}
            label={role.name}
            sub={role.description}
            policies={policies}
            onError={setError}
            onRefresh={onRefresh}
          />
        ))}
        {tab === 'users' && users.map(user => (
          <MultiAssignRow
            key={user.id}
            type="user"
            granteeId={user.id}
            label={user.name || user.username}
            sub={`${user.employee_id ? user.employee_id + ' | ' : ''}${user.dept_name || ''}`}
            policies={policies}
            onError={setError}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  )
}

// ── MultiAssignRow ─────────────────────────────────────────────────────────────
function MultiAssignRow({
  type, granteeId, label, sub, policies, onError, onRefresh
}: {
  type: 'role' | 'user'
  granteeId: number
  label: string
  sub?: string
  policies: Policy[]
  onError: (msg: string) => void
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [assigned, setAssigned] = useState<PolicyAssignment[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const endpoint = type === 'role'
    ? `/data-permissions/role-policies/${granteeId}`
    : `/data-permissions/user-policies/${granteeId}`

  async function loadAssigned() {
    setLoading(true)
    try {
      const data = await api.get(endpoint).then(r => r.data)
      setAssigned(Array.isArray(data) ? data : [])
    } catch {
      setAssigned([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (expanded) loadAssigned()
  }, [expanded])

  function isChecked(pid: number) {
    return assigned.some(a => a.policy_id === pid)
  }

  function togglePolicy(pid: number) {
    setDirty(true)
    if (isChecked(pid)) {
      setAssigned(prev => prev.filter(a => a.policy_id !== pid))
    } else {
      const maxPriority = assigned.length > 0 ? Math.max(...assigned.map(a => a.priority)) : 0
      const p = policies.find(x => x.id === pid)
      setAssigned(prev => [...prev, { policy_id: pid, priority: maxPriority + 10, name: p?.name }])
    }
  }

  function movePriority(pid: number, direction: 'up' | 'down') {
    const sorted = [...assigned].sort((a, b) => a.priority - b.priority)
    const idx = sorted.findIndex(a => a.policy_id === pid)
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === sorted.length - 1) return

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const newPriorities = sorted.map(a => a.priority)
    ;[newPriorities[idx], newPriorities[swapIdx]] = [newPriorities[swapIdx], newPriorities[idx]]

    setDirty(true)
    setAssigned(sorted.map((a, i) => ({ ...a, priority: newPriorities[i] })))
  }

  async function saveAssigned() {
    setSaving(true)
    try {
      await api.put(endpoint, {
        policies: assigned.map(a => ({ policy_id: a.policy_id, priority: a.priority }))
      })
      setDirty(false)
      await onRefresh()
    } catch (e: any) {
      onError(e.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  const sortedAssigned = [...assigned].sort((a, b) => a.priority - b.priority)

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-800 text-sm">{label}</div>
          {sub && <div className="text-xs text-slate-400">{sub}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {assigned.length > 0 && !expanded && (
            <div className="flex flex-wrap gap-1">
              {sortedAssigned.slice(0, 3).map((a, i) => {
                const p = policies.find(x => x.id === a.policy_id)
                return (
                  <span key={a.policy_id} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded-full">
                    {i + 1}. {p?.name || a.name || `Policy ${a.policy_id}`}
                  </span>
                )
              })}
              {sortedAssigned.length > 3 && (
                <span className="text-xs text-slate-400">+{sortedAssigned.length - 3}</span>
              )}
            </div>
          )}
          {expanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 p-4 flex flex-col gap-3">
          {loading ? (
            <div className="text-center text-slate-400 text-sm py-4">載入中...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                {/* Left: policy checklist */}
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-2">選擇政策</div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                    {policies.length === 0 ? (
                      <div className="text-center text-slate-400 text-sm py-4">尚無政策</div>
                    ) : policies.map(p => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2.5 px-3 py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked(p.id)}
                          onChange={() => togglePolicy(p.id)}
                          className="accent-blue-600"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-800 truncate">{p.name}</div>
                          {p.description && <div className="text-[10px] text-slate-400 truncate">{p.description}</div>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Right: priority order */}
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-2">
                    優先順序
                    <span className="ml-1 text-slate-400 font-normal">（數字越小越優先，可調整順序）</span>
                  </div>
                  {sortedAssigned.length === 0 ? (
                    <div className="text-xs text-slate-400 italic py-2">未選擇任何政策（不限制）</div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {sortedAssigned.map((a, i) => {
                        const p = policies.find(x => x.id === a.policy_id)
                        return (
                          <div key={a.policy_id} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5">
                            <GripVertical size={12} className="text-slate-300 shrink-0" />
                            <span className="text-xs text-blue-700 font-bold w-5 shrink-0">{i + 1}</span>
                            <span className="flex-1 text-xs text-slate-800 truncate">
                              {p?.name || a.name || `Policy ${a.policy_id}`}
                            </span>
                            <div className="flex flex-col gap-0.5 shrink-0">
                              <button
                                onClick={() => movePriority(a.policy_id, 'up')}
                                disabled={i === 0}
                                className="p-0.5 text-slate-400 hover:text-blue-600 disabled:opacity-30"
                              >
                                <ChevronUp size={10} />
                              </button>
                              <button
                                onClick={() => movePriority(a.policy_id, 'down')}
                                disabled={i === sortedAssigned.length - 1}
                                className="p-0.5 text-slate-400 hover:text-blue-600 disabled:opacity-30"
                              >
                                <ChevronDown size={10} />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {dirty && (
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => { loadAssigned(); setDirty(false) }}
                    className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                  >
                    還原
                  </button>
                  <button
                    onClick={saveAssigned}
                    disabled={saving}
                    className="flex items-center gap-1 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                    {saving ? '儲存中...' : '儲存變更'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
