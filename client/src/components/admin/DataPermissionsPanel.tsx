import { useState, useEffect, useCallback } from 'react'
import api from '../../lib/api'
import {
  Plus, Trash2, Edit2, Save, X, ChevronRight, ChevronDown,
  Shield, Users, UserCheck, Building2, Database, Check,
  AlertCircle, RefreshCw
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
    { value: 'dept_code', label: '部門' },
    { value: 'profit_center', label: '利潤中心' },
    { value: 'org_section', label: '事業處' },
    { value: 'org_group_name', label: '事業群' },
  ],
  4: [
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
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [users, setUsers] = useState<UserLov[]>([])
  const [roles, setRoles] = useState<RoleLov[]>([])
  const [orgLov, setOrgLov] = useState<OrgLov[]>([])
  const [erpOrgLov, setErpOrgLov] = useState<ErpOrgLov[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Omit<Policy, 'id'>>({ name: '', description: '', rules: [] })
  const [activeTab, setActiveTab] = useState<'policies' | 'assignments'>('policies')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, a, u, r, orgData, erpOrgData] = await Promise.all([
        api.get('/data-permissions/policies').then(r => r.data),
        api.get('/data-permissions/assignments').then(r => r.data),
        api.get('/data-permissions/lov/users').then(r => r.data),
        api.get('/data-permissions/lov/roles').then(r => r.data),
        api.get('/data-permissions/lov/org').then(r => r.data).catch(() => []),
        api.get('/data-permissions/lov/erp-org').then(r => r.data).catch(() => []),
      ])
      setPolicies(p); setAssignments(a); setUsers(u); setRoles(r)
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
        {(['policies', 'assignments'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === t
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t === 'policies' ? '政策設定' : '角色/使用者指派'}
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
function PolicyDetail({ policy, onEdit }: { policy: Policy; onEdit: () => void }) {
  const byLayer = [1, 2, 3, 4].map(l => ({
    layer: l,
    rules: policy.rules.filter(r => r.layer === l),
  }))

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">{policy.name}</h3>
          {policy.description && <p className="text-sm text-slate-500 mt-1">{policy.description}</p>}
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
                    {r.value_name || r.value_id}
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
    // reset value when type changes
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
        const layerRules = form.rules.filter((_, i) => form.rules.findIndex(r => r === form.rules[i]) === i && form.rules[i].layer === layer)
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
      {/* include/exclude toggle */}
      <select
        value={rule.include_type}
        onChange={e => onChange({ include_type: e.target.value as 'include' | 'exclude' })}
        className={`text-xs border rounded px-2 py-1 outline-none ${rule.include_type === 'include' ? 'border-green-300 text-green-700 bg-green-50' : 'border-red-300 text-red-700 bg-red-50'}`}
      >
        <option value="include">包含</option>
        <option value="exclude">排除</option>
      </select>

      {/* value type */}
      <select
        value={rule.value_type}
        onChange={e => onChange({ value_type: e.target.value })}
        className="text-xs border border-slate-200 rounded px-2 py-1 outline-none bg-white"
      >
        {valueTypeOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {/* value picker */}
      {lovOpts.length > 0 ? (
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

// ── AssignmentsPanel ──────────────────────────────────────────────────────────
function AssignmentsPanel({
  policies, assignments, users, roles, onRefresh
}: {
  policies: Policy[]; assignments: Assignment[]
  users: UserLov[]; roles: RoleLov[]
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'roles' | 'users'>('roles')
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState('')

  function getAssignment(type: 'role' | 'user', id: number): Assignment | undefined {
    return assignments.find(a => a.grantee_type === type && a.grantee_id === id)
  }

  async function assign(type: 'role' | 'user', id: number, policyId: number | null) {
    setSaving(id); setError('')
    try {
      const endpoint = type === 'role'
        ? `/data-permissions/assignments/role/${id}`
        : `/data-permissions/assignments/user/${id}`
      await api.put(endpoint, { policy_id: policyId })
      await onRefresh()
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setSaving(null)
    }
  }

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

      {tab === 'roles' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-600">角色</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-600">指派政策</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {roles.map(role => {
                const asgn = getAssignment('role', role.id)
                return (
                  <AssignRow
                    key={role.id}
                    label={role.name}
                    sub={role.description}
                    currentPolicyId={asgn?.policy_id ?? null}
                    policies={policies}
                    saving={saving === role.id}
                    onSave={pid => assign('role', role.id, pid)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'users' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700">
            使用者有設定個人政策時優先套用；未設定則沿用所屬角色的政策。
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-600">使用者</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-600">個人指派政策</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const asgn = getAssignment('user', user.id)
                return (
                  <AssignRow
                    key={user.id}
                    label={user.name || user.username}
                    sub={`${user.employee_id ? user.employee_id + ' | ' : ''}${user.dept_name || ''}`}
                    currentPolicyId={asgn?.policy_id ?? null}
                    policies={policies}
                    saving={saving === user.id}
                    onSave={pid => assign('user', user.id, pid)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AssignRow({
  label, sub, currentPolicyId, policies, saving, onSave
}: {
  label: string; sub?: string; currentPolicyId: number | null
  policies: Policy[]
  saving: boolean; onSave: (pid: number | null) => void
}) {
  const [sel, setSel] = useState<string>(currentPolicyId != null ? String(currentPolicyId) : '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setSel(currentPolicyId != null ? String(currentPolicyId) : '')
    setDirty(false)
  }, [currentPolicyId])

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-2.5">
        <div className="font-medium text-slate-800">{label}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </td>
      <td className="px-4 py-2.5">
        <select
          value={sel}
          onChange={e => { setSel(e.target.value); setDirty(true) }}
          className="text-sm border border-slate-200 rounded px-2 py-1 outline-none bg-white w-48"
        >
          <option value="">-- 不限制 --</option>
          {policies.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
      </td>
      <td className="px-4 py-2.5 text-right">
        {dirty && (
          <button
            onClick={() => { onSave(sel ? Number(sel) : null); setDirty(false) }}
            disabled={saving}
            className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
            儲存
          </button>
        )}
      </td>
    </tr>
  )
}
