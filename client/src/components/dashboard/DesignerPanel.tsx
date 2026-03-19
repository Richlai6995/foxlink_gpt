/**
 * DesignerPanel — Schema / Topic / Design / ETL 管理介面
 * 僅 can_design_ai_select / admin 可見
 */
import React, { useState, useEffect, useRef } from 'react'
import { Plus, Save, Trash2, Play, RefreshCw, ChevronDown, ChevronRight, Eye, Link2, Edit3, Square, Pause, Share2, Copy, Upload, FolderOpen, Filter, X, Download, FileUp, PenLine, FunctionSquare, Languages, RotateCcw } from 'lucide-react'
import api from '../../lib/api'
import type { AiSchemaDef, AiSchemaJoin, AiSelectTopic, AiSelectDesign, AiEtlJob, AiEtlRunLog, AiDashboardShare, AiSelectProject, AiProjectShare } from '../../types'
import TranslationFields, { type TranslationData } from '../common/TranslationFields'
import UserPicker from '../common/UserPicker'

// ── Project Selector ──────────────────────────────────────────────────────────
function ProjectSelector({
  selectedId,
  onChange,
  onCreateNew,
  onManageShare,
  currentProject,
  refreshToken,
}: {
  selectedId: number | null
  onChange: (id: number | null, project: AiSelectProject | null, projects: AiSelectProject[]) => void
  onCreateNew: () => void
  onManageShare: () => void
  currentProject: AiSelectProject | null
  refreshToken: number
}) {
  const [projects, setProjects] = useState<AiSelectProject[]>([])

  const load = () => api.get('/dashboard/projects').then(r => {
    setProjects(r.data)
    return r.data as AiSelectProject[]
  }).catch(() => [])
  useEffect(() => { load() }, [refreshToken])

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100">
      <FolderOpen size={14} className="text-blue-500 flex-shrink-0" />
      <span className="text-xs text-blue-600 font-medium flex-shrink-0">專案</span>
      <select
        className="flex-1 text-xs border border-blue-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400"
        value={selectedId ?? ''}
        onChange={e => {
          const id = e.target.value ? Number(e.target.value) : null
          onChange(id, id ? projects.find(p => p.id === id) || null : null, projects)
        }}
      >
        <option value="">— 請選擇專案 —</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.is_suspended ? ' [已暫停]' : ''}
            {p.is_public === 1 && !p.public_approved ? ' [公開申請中]' : ''}
            {p.is_public === 1 && p.public_approved === 1 ? ' [公開]' : ''}
          </option>
        ))}
      </select>
      <button onClick={onCreateNew} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5 flex-shrink-0">
        <Plus size={12} />新專案
      </button>
      {currentProject && (
        <button onClick={onManageShare} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5 flex-shrink-0">
          <Share2 size={12} />分享
        </button>
      )}
    </div>
  )
}

// ── Project Share Modal ───────────────────────────────────────────────────────
type OrgData = { depts: {code:string;name:string}[]; profit_centers: {code:string;name:string}[]; org_sections: {code:string;name:string}[]; org_groups: {name:string}[] }

const GRANTEE_TYPE_LABEL: Record<string, string> = {
  user: '使用者', role: '角色', department: '部門', cost_center: '利潤中心', division: '事業處', org_group: '事業群'
}

function useOrgData() {
  const [roles, setRoles] = useState<{id: number; name: string}[]>([])
  const [orgs, setOrgs] = useState<OrgData>({ depts: [], profit_centers: [], org_sections: [], org_groups: [] })
  useEffect(() => {
    api.get('/roles').then(r => setRoles(r.data)).catch(() => {})
    api.get('/dashboard/orgs').then(r => setOrgs(r.data)).catch(() => {})
  }, [])
  return { roles, orgs }
}

function getOrgLov(granteeType: string, roles: {id:number;name:string}[], orgs: OrgData): {value: string; label: string}[] {
  if (granteeType === 'role') return roles.map(r => ({ value: String(r.id), label: r.name }))
  if (granteeType === 'department') return orgs.depts.map(d => ({ value: d.code, label: `${d.code} ${d.name || ''}`.trim() }))
  if (granteeType === 'cost_center') return orgs.profit_centers.map(d => ({ value: d.code, label: `${d.code} ${d.name || ''}`.trim() }))
  if (granteeType === 'division') return orgs.org_sections.map(d => ({ value: d.code, label: `${d.code} ${d.name || ''}`.trim() }))
  if (granteeType === 'org_group') return orgs.org_groups.map(d => ({ value: d.name, label: d.name }))
  return []
}

type ShareForm = { grantee_type: string; grantee_id: string; share_type: 'use' | 'develop' }

function ShareFormBody({
  form, setForm, onAdd, loading, roles, orgs
}: {
  form: ShareForm
  setForm: React.Dispatch<React.SetStateAction<ShareForm>>
  onAdd: () => void
  loading: boolean
  roles: {id:number;name:string}[]
  orgs: OrgData
}) {
  const [userDisplay, setUserDisplay] = useState('')
  const lovOptions = getOrgLov(form.grantee_type, roles, orgs)

  const changeType = (t: string) => {
    setForm(p => ({ ...p, grantee_type: t, grantee_id: '' }))
    setUserDisplay('')
  }

  return (
    <div className="bg-gray-50 rounded-xl p-3 space-y-2">
      <p className="text-xs text-gray-500 font-medium">新增分享</p>
      <div className="flex gap-2 flex-wrap">
        <select className="input py-1.5 text-sm" value={form.grantee_type} onChange={e => changeType(e.target.value)}>
          {Object.entries(GRANTEE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {form.grantee_type === 'user' ? (
          <UserPicker
            value={form.grantee_id}
            display={userDisplay}
            onChange={(id, disp) => { setForm(p => ({ ...p, grantee_id: id })); setUserDisplay(disp) }}
            className="flex-1 min-w-40"
          />
        ) : (
          <select className="input py-1.5 text-sm flex-1" value={form.grantee_id}
            onChange={e => setForm(p => ({ ...p, grantee_id: e.target.value }))}>
            <option value="">請選擇...</option>
            {lovOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex gap-3">
          {(['use', 'develop'] as const).map(v => (
            <label key={v} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="radio" value={v} checked={form.share_type === v}
                onChange={() => setForm(p => ({ ...p, share_type: v }))} />
              {v === 'use' ? '使用（查詢）' : '開發及使用'}
            </label>
          ))}
        </div>
        <button onClick={onAdd} disabled={loading || !form.grantee_id.trim()}
          className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1 ml-auto">
          <Plus size={12} /> {loading ? '新增中...' : '新增'}
        </button>
      </div>
    </div>
  )
}

function ProjectShareModal({ project, onClose }: { project: AiSelectProject; onClose: () => void }) {
  const [shares, setShares] = useState<AiProjectShare[]>([])
  const [form, setForm] = useState<ShareForm>({ grantee_type: 'user', grantee_id: '', share_type: 'use' })
  const [loading, setLoading] = useState(false)
  const { roles, orgs } = useOrgData()

  const load = () => api.get(`/dashboard/projects/${project.id}/shares`).then(r => setShares(r.data)).catch(() => {})
  useEffect(() => { load() }, [project.id])

  const resolveGranteeName = (s: AiProjectShare) => {
    const lov = getOrgLov(s.grantee_type, roles, orgs)
    const found = lov.find(o => o.value === String(s.grantee_id))
    return found ? found.label : s.grantee_id
  }

  const add = async () => {
    if (!form.grantee_id.trim()) return
    setLoading(true)
    try {
      await api.post(`/dashboard/projects/${project.id}/shares`, form)
      setForm(p => ({ ...p, grantee_id: '' }))
      load()
    } catch (e: any) { alert(e?.response?.data?.error || '新增失敗') }
    finally { setLoading(false) }
  }

  const del = async (shareId: number) => {
    await api.delete(`/dashboard/projects/${project.id}/shares/${shareId}`)
    load()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-800">專案分享設定 — {project.name}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <ShareFormBody form={form} setForm={setForm} onAdd={add} loading={loading} roles={roles} orgs={orgs} />
          {shares.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">尚無分享設定</p>
          ) : (
            <div className="space-y-1.5">
              {shares.map(s => (
                <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-600">
                    <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded mr-2">{GRANTEE_TYPE_LABEL[s.grantee_type] || s.grantee_type}</span>
                    <span className="font-medium">{resolveGranteeName(s)}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${s.share_type === 'develop' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
                      {s.share_type === 'develop' ? '開發及使用' : '使用'}
                    </span>
                  </div>
                  <button onClick={() => del(s.id)} className="text-gray-400 hover:text-red-400 ml-2">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800 px-4">關閉</button>
        </div>
      </div>
    </div>
  )
}

// ── Share Modal ───────────────────────────────────────────────────────────────
function ShareModal({ design, onClose }: { design: AiSelectDesign; onClose: () => void }) {
  const [shares, setShares] = useState<AiDashboardShare[]>([])
  const [form, setForm] = useState<ShareForm>({ grantee_type: 'user', grantee_id: '', share_type: 'use' })
  const [loading, setLoading] = useState(false)
  const { roles, orgs } = useOrgData()

  const load = () => api.get(`/dashboard/designs/${design.id}/shares`).then(r => setShares(r.data)).catch(() => {})
  useEffect(() => { load() }, [design.id])

  const granteeLabel = (s: AiDashboardShare) => {
    const lov = getOrgLov(s.grantee_type, roles, orgs)
    const found = lov.find(o => o.value === String(s.grantee_id))
    return found ? found.label : s.grantee_id
  }

  const add = async () => {
    if (!form.grantee_id.trim()) return
    setLoading(true)
    try {
      await api.post(`/dashboard/designs/${design.id}/shares`, form)
      setForm(p => ({ ...p, grantee_id: '' }))
      load()
    } catch (e: any) { alert(e?.response?.data?.error || '新增失敗') }
    finally { setLoading(false) }
  }

  const del = async (shareId: number) => {
    await api.delete(`/dashboard/designs/${design.id}/shares/${shareId}`)
    load()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-800">分享設定 — {design.name}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <ShareFormBody form={form} setForm={setForm} onAdd={add} loading={loading} roles={roles} orgs={orgs} />
          {shares.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">尚無分享設定</p>
          ) : (
            <div className="space-y-1.5">
              {shares.map(s => (
                <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-600">
                    <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded mr-2">{GRANTEE_TYPE_LABEL[s.grantee_type] || s.grantee_type}</span>
                    <span>{granteeLabel(s)}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${s.share_type === 'develop' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
                      {s.share_type === 'develop' ? '開發及使用' : '使用'}
                    </span>
                  </div>
                  <button onClick={() => del(s.id)} className="text-gray-400 hover:text-red-400 ml-2">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800 px-4">關閉</button>
        </div>
      </div>
    </div>
  )
}

// ── Copy Topic Modal ──────────────────────────────────────────────────────────
function CopyTopicModal({ topic, onClose, onDone }: {
  topic: AiSelectTopic; onClose: () => void; onDone: () => void
}) {
  const [name, setName] = useState(topic.name + ' (複本)')
  const [designs, setDesigns] = useState<AiSelectDesign[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (topic.designs) {
      setDesigns(topic.designs)
      setSelectedIds(topic.designs.map(d => d.id))
    }
  }, [topic])

  const toggle = (id: number) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )

  const copy = async () => {
    setLoading(true)
    try {
      await api.post(`/dashboard/topics/${topic.id}/copy`, { name, design_ids: selectedIds })
      onDone()
      onClose()
    } catch (e: any) { alert(e?.response?.data?.error || '複製失敗') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-800">複製主題</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">新主題名稱</label>
            <input className="input py-1.5 text-sm w-full" value={name} onChange={e => setName(e.target.value)} />
          </div>
          {designs.length > 0 && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">選擇要複製的任務</label>
              <div className="space-y-1 max-h-40 overflow-y-auto bg-gray-50 rounded-lg p-2">
                {designs.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:bg-gray-100 rounded px-1 py-0.5">
                    <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggle(d.id)} />
                    {d.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">已選 {selectedIds.length} / {designs.length} 個任務</p>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800 px-3">取消</button>
          <button onClick={copy} disabled={loading || !name.trim()}
            className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1">
            <Copy size={12} /> {loading ? '複製中...' : '確認複製'}
          </button>
        </div>
      </div>
    </div>
  )
}

type Tab = 'schema' | 'joins' | 'designs' | 'etl'

export default function DesignerPanel() {
  const [tab, setTab] = useState<Tab>('schema')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [currentProject, setCurrentProject] = useState<AiSelectProject | null>(null)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [projectForm, setProjectForm] = useState({ name: '', description: '', is_public: false })
  const [shareProject, setShareProject] = useState<AiSelectProject | null>(null)
  const [projectRefresh, setProjectRefresh] = useState(0)

  const createProject = async () => {
    if (!projectForm.name.trim()) return
    try {
      const r = await api.post('/dashboard/projects', projectForm)
      const newProj: AiSelectProject = { id: r.data.id, name: projectForm.name, description: projectForm.description, is_public: projectForm.is_public ? 1 : 0 }
      setProjectId(r.data.id)
      setCurrentProject(newProj)
      setShowProjectForm(false)
      setProjectForm({ name: '', description: '', is_public: false })
      setProjectRefresh(n => n + 1)  // trigger ProjectSelector reload
    } catch (e: any) { alert(e?.response?.data?.error || '建立失敗') }
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Project Selector */}
      <ProjectSelector
        selectedId={projectId}
        onChange={(id, proj) => { setProjectId(id); setCurrentProject(proj) }}
        onCreateNew={() => setShowProjectForm(true)}
        onManageShare={() => setShareProject(currentProject)}
        currentProject={currentProject}
        refreshToken={projectRefresh}
      />

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-4 pt-3 gap-1 flex-shrink-0">
        {(['schema', 'joins', 'designs', 'etl'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs rounded-t-lg transition ${
              tab === t ? 'bg-white text-blue-600 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {{ schema: 'Schema 知識庫', joins: 'Join 定義', designs: '查詢設計', etl: 'ETL 排程' }[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {tab === 'schema' && <SchemaManager projectId={projectId} />}
        {tab === 'joins' && <JoinManager projectId={projectId} />}
        {tab === 'designs' && <DesignManager projectId={projectId} />}
        {tab === 'etl' && <EtlManager projectId={projectId} />}
      </div>

      {/* Project creation modal */}
      {showProjectForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-800">建立新專案</p>
            <input className="input text-sm" placeholder="專案名稱 *" value={projectForm.name}
              onChange={e => setProjectForm(p => ({ ...p, name: e.target.value }))} />
            <textarea className="input text-sm resize-none" rows={2} placeholder="說明（選填）"
              value={projectForm.description}
              onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))} />
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={projectForm.is_public}
                onChange={e => setProjectForm(p => ({ ...p, is_public: e.target.checked }))} />
              公開（所有使用者可查詢）
            </label>
            {projectForm.is_public && (
              <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                ⚠ 公開申請需由管理員核准後才對所有人可見
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowProjectForm(false)} className="text-xs text-gray-500 px-3 py-1.5">取消</button>
              <button onClick={createProject} disabled={!projectForm.name.trim()} className="btn-primary text-xs py-1.5 px-4">建立</button>
            </div>
          </div>
        </div>
      )}

      {/* Project share modal */}
      {shareProject && <ProjectShareModal project={shareProject} onClose={() => setShareProject(null)} />}
    </div>
  )
}

// ── Schema Manager ────────────────────────────────────────────────────────────
type BaseCondition = { col: string; op: string; val: string }

function SchemaManager({ projectId }: { projectId: number | null }) {
  const [schemas, setSchemas] = useState<AiSchemaDef[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    table_name: '', display_name: '', display_name_en: '', display_name_vi: '', alias: '',
    source_type: 'table' as 'table' | 'view' | 'sql', source_sql: '',
    db_connection: 'erp', business_notes: '', join_hints: '',
    vector_etl_job_id: undefined as number | undefined,
    form_project_id: undefined as number | undefined
  })
  const [baseConditions, setBaseConditions] = useState<BaseCondition[]>([])
  const [etlJobs, setEtlJobs] = useState<AiEtlJob[]>([])
  const [projects, setProjects] = useState<AiSelectProject[]>([])
  const [loading, setLoading] = useState(false)
  const [schemaTranslating, setSchemaTranslating] = useState(false)
  const [showCopyDialog, setShowCopyDialog] = useState(false)
  const [allSchemasForCopy, setAllSchemasForCopy] = useState<AiSchemaDef[]>([])
  const [copySearch, setCopySearch] = useState('')
  const formRef = useRef<HTMLDivElement>(null)

  // ── 欄位說明編輯 ──────────────────────────────────────────────────────────────
  const [editingColsId, setEditingColsId] = useState<number | null>(null)
  const [editingCols, setEditingCols] = useState<any[]>([])
  const [colFilter, setColFilter] = useState('')
  const [colsSaving, setColsSaving] = useState(false)
  const [showVirtualForm, setShowVirtualForm] = useState(false)
  const [virtualForm, setVirtualForm] = useState({ name: '', expression: '', description: '', fn_template: '' })

  const ORACLE_FN_TEMPLATES = [
    { label: '選擇函數範本...', value: '' },
    { label: "TO_CHAR 年月 (YYYYMM)", value: "TO_CHAR(#col#, 'YYYYMM')" },
    { label: "TO_CHAR 年份 (YYYY)", value: "TO_CHAR(#col#, 'YYYY')" },
    { label: "TO_CHAR 月份 (MM)", value: "TO_CHAR(#col#, 'MM')" },
    { label: "TO_CHAR 日期字串 (YYYY-MM-DD)", value: "TO_CHAR(#col#, 'YYYY-MM-DD')" },
    { label: "TRUNC 月初", value: "TRUNC(#col#, 'MONTH')" },
    { label: "TRUNC 年初", value: "TRUNC(#col#, 'YEAR')" },
    { label: "EXTRACT 月份數字", value: "EXTRACT(MONTH FROM #col#)" },
    { label: "EXTRACT 年份數字", value: "EXTRACT(YEAR FROM #col#)" },
    { label: "NVL 替換 NULL 為 0", value: "NVL(#col#, 0)" },
    { label: "NVL 替換 NULL 為空字串", value: "NVL(#col#, ' ')" },
    { label: "ROUND 四捨五入 2 位", value: "ROUND(#col#, 2)" },
    { label: "FLOOR 無條件捨去", value: "FLOOR(#col#)" },
    { label: "CEIL 無條件進位", value: "CEIL(#col#)" },
    { label: "字串合併 (col1 || col2)", value: "#col# || '_' || #col2#" },
    { label: "加法運算 (col1 + col2)", value: "#col# + #col2#" },
    { label: "減法運算 (col1 - col2)", value: "#col# - #col2#" },
  ]

  const startEditCols = (s: any) => {
    setEditingColsId(s.id)
    setEditingCols((s.columns || []).map((c: any) => ({ ...c })))
    setColFilter('')
    setShowVirtualForm(false)
  }

  const saveEditCols = async (schemaId: number) => {
    setColsSaving(true)
    try {
      await api.put(`/dashboard/designer/schemas/${schemaId}/columns`, { columns: editingCols })
      load()
      setEditingColsId(null)
    } catch (e: any) {
      alert(e?.response?.data?.error || '儲存失敗')
    } finally { setColsSaving(false) }
  }

  const exportCsv = async (schemaId: number) => {
    try {
      const r = await api.get(`/dashboard/designer/schemas/${schemaId}/columns/export-csv`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      const s = schemas.find(sc => sc.id === schemaId)
      a.href = url; a.download = `schema_${s?.table_name || schemaId}.csv`
      a.click(); URL.revokeObjectURL(url)
    } catch { alert('匯出失敗') }
  }

  const importCsvFile = (schemaId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const buf = ev.target?.result as ArrayBuffer
      // 先嘗試 UTF-8（含 BOM），失敗則 fallback Big5（Excel 台灣版預設存檔編碼）
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
      } catch {
        text = new TextDecoder('big5').decode(buf)
      }
      // 去掉 UTF-8 BOM（\uFEFF）
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
      const lines = text.replace(/\r/g, '').split('\n').filter(Boolean)
      if (lines.length < 2) return alert('CSV 格式錯誤')
      const header = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
      const nameIdx = header.indexOf('column_name')
      const descIdx = header.indexOf('description')
      if (nameIdx < 0 || descIdx < 0) return alert('CSV 必須含 column_name 和 description 欄位')
      const parseCsvRow = (line: string) => {
        const result: string[] = []
        let cur = '', inQ = false
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ }
          else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
          else cur += ch
        }
        result.push(cur)
        return result
      }
      const rows = lines.slice(1).map(l => {
        const cells = parseCsvRow(l)
        return { column_name: cells[nameIdx]?.replace(/^"|"$/g, '') || '', description: cells[descIdx]?.replace(/^"|"$/g, '') || '' }
      }).filter(r => r.column_name)
      try {
        const r = await api.post(`/dashboard/designer/schemas/${schemaId}/columns/import-csv`, { rows })
        alert(`匯入完成：更新 ${r.data.updated} 個欄位說明`)
        load()
      } catch (err: any) {
        alert(err?.response?.data?.error || '匯入失敗')
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const addVirtualCol = () => {
    if (!virtualForm.name || !virtualForm.expression) return alert('請填欄位別名和計算式')
    setEditingCols(prev => [...prev, {
      column_name: virtualForm.name,
      data_type: 'VARCHAR2',
      description: virtualForm.description,
      is_virtual: 1,
      expression: virtualForm.expression,
      is_vectorized: 0,
    }])
    setVirtualForm({ name: '', expression: '', description: '', fn_template: '' })
    setShowVirtualForm(false)
  }

  // Oracle 批次匯入
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importOwner, setImportOwner] = useState('APPS')
  const [importConn, setImportConn] = useState('erp')
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: {table:string,columns:number}[], skipped: string[] } | null>(null)

  const load = () => {
    const url = projectId ? `/dashboard/designer/schemas?project_id=${projectId}` : '/dashboard/designer/schemas'
    api.get(url).then(r => setSchemas(r.data)).catch(() => {})
  }
  useEffect(() => {
    load()
    const etlUrl = projectId ? `/dashboard/etl/jobs?project_id=${projectId}` : '/dashboard/etl/jobs'
    api.get(etlUrl).then(r => setEtlJobs(r.data)).catch(() => {})
    api.get('/dashboard/projects').then(r => setProjects(r.data)).catch(() => {})
  }, [projectId])

  const emptyForm = { table_name: '', display_name: '', display_name_en: '', display_name_vi: '', alias: '', source_type: 'table' as const, source_sql: '', db_connection: 'erp', business_notes: '', join_hints: '', vector_etl_job_id: undefined as number | undefined, form_project_id: projectId || undefined }

  const editingSchema = schemas.find(s => s.id === editId)
  const editColOptions = editingSchema
    ? ((editingSchema as any).columns || []).map((c: any) => c.column_name as string)
    : []

  const addBaseCond = () => setBaseConditions(cs => [...cs, { col: '', op: '=', val: '' }])
  const delBaseCond = (i: number) => setBaseConditions(cs => cs.filter((_, idx) => idx !== i))
  const setBaseCond = (i: number, field: keyof BaseCondition, v: string) =>
    setBaseConditions(cs => cs.map((c, idx) => idx === i ? { ...c, [field]: v } : c))

  const save = async () => {
    setLoading(true)
    setSchemaTranslating(true)
    try {
      const { form_project_id, ...rest } = form
      const payload = { ...rest, base_conditions: baseConditions.filter(c => c.col), project_id: form_project_id ?? projectId ?? undefined }
      if (editId) {
        const r = await api.put(`/dashboard/designer/schemas/${editId}`, payload)
        if (r.data.display_name_en || r.data.display_name_vi) {
          setForm(p => ({ ...p, display_name_en: r.data.display_name_en || p.display_name_en, display_name_vi: r.data.display_name_vi || p.display_name_vi }))
        }
      } else {
        await api.post('/dashboard/designer/schemas', payload)
        setEditId(null)
        setForm(emptyForm)
        setBaseConditions([])
      }
      load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '儲存失敗')
    } finally {
      setLoading(false)
      setSchemaTranslating(false)
    }
  }

  const retranslateSchema = async () => {
    if (!editId) return
    setSchemaTranslating(true)
    try {
      const r = await api.post(`/dashboard/designer/schemas/${editId}/translate`)
      setForm(p => ({ ...p, display_name_en: r.data.display_name_en || '', display_name_vi: r.data.display_name_vi || '' }))
    } catch { alert('重新翻譯失敗') }
    finally { setSchemaTranslating(false) }
  }

  const openCopyDialog = async () => {
    setCopySearch('')
    try {
      const r = await api.get('/dashboard/designer/schemas?all=true')
      // 排除已在本專案的
      const filtered = (r.data as AiSchemaDef[]).filter(s => s.project_id !== projectId)
      setAllSchemasForCopy(filtered)
    } catch { setAllSchemasForCopy([]) }
    setShowCopyDialog(true)
  }

  const copySchema = async (srcId: number) => {
    try {
      await api.post(`/dashboard/designer/schemas/${srcId}/copy`, { target_project_id: projectId })
      setShowCopyDialog(false)
      load()
    } catch (e: any) { alert(e?.response?.data?.error || '複製失敗') }
  }

  const del = async (id: number) => {
    if (!confirm('確定刪除此 Schema？')) return
    await api.delete(`/dashboard/designer/schemas/${id}`)
    load()
  }

  const runImport = async () => {
    const table_names = importText.split('\n').map(l => l.trim().toUpperCase()).filter(Boolean)
    if (!table_names.length) return
    setImportLoading(true)
    setImportResult(null)
    try {
      const r = await api.post('/dashboard/designer/schemas/import-oracle', {
        table_names, owner: importOwner, db_connection: importConn
      })
      setImportResult(r.data)
      load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '匯入失敗')
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Oracle 批次匯入 Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[480px] space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">從 Oracle ERP 批次匯入 Schema</p>
              <button onClick={() => { setShowImport(false); setImportResult(null) }}
                className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">預設 Owner（若行內無前綴則套用）</label>
                  <input className="input py-1.5 text-sm" value={importOwner}
                    onChange={e => setImportOwner(e.target.value.toUpperCase())} placeholder="APPS" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">DB 連線</label>
                  <select className="input py-1.5 text-sm" value={importConn}
                    onChange={e => setImportConn(e.target.value)}>
                    <option value="erp">ERP (Oracle)</option>
                    <option value="system">系統 DB</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  資料表清單（每行一個，可加 OWNER 前綴混搭不同 owner）
                </label>
                <textarea className="input text-sm font-mono resize-none" rows={8}
                  placeholder={"FL_MRP_FG_PEGGING_SUMMARY\nAPPS.WO_ABNORMAL_V\nHR.EMPLOYEES\nBOM_HEADER\n..."}
                  value={importText} onChange={e => setImportText(e.target.value)} />
                <p className="text-[11px] text-gray-400 mt-1">
                  {importText.split('\n').filter(l => l.trim()).length} 個 table（上限 50）｜不含前綴者使用預設 Owner：{importOwner || 'APPS'}
                </p>
              </div>
              {importResult && (
                <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
                  <p className="font-medium text-gray-700">匯入結果</p>
                  {importResult.imported.map(i => (
                    <p key={i.table} className="text-green-600">✓ {i.table} — {i.columns} 欄</p>
                  ))}
                  {importResult.skipped.map(t => (
                    <p key={t} className="text-red-500">✗ {t} — 查無此 table（請確認 Owner/名稱）</p>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowImport(false); setImportResult(null) }}
                className="text-xs text-gray-500 hover:text-gray-700 px-3">關閉</button>
              <button onClick={runImport} disabled={importLoading || !importText.trim()}
                className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1">
                <RefreshCw size={12} className={importLoading ? 'animate-spin' : ''} />
                {importLoading ? '匯入中...' : '開始匯入'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={formRef} className="bg-gray-100 rounded-xl p-4 space-y-3">
        <p className="text-xs text-gray-500 font-medium">{editId ? '編輯 Schema' : '新增 Schema'}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">資料表/視圖名稱 *</label>
            <input className="input py-1.5 text-sm" placeholder="APPS.WO_ABNORMAL_V"
              value={form.table_name} onChange={e => setForm(p => ({ ...p, table_name: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">顯示名稱</label>
            <input className="input py-1.5 text-sm" placeholder="工單異常視圖"
              value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} />
            <div className="mt-1 space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 w-5 flex-shrink-0">EN</span>
                <input className={`input py-1 text-xs flex-1 ${schemaTranslating ? 'opacity-50' : ''}`} placeholder={schemaTranslating ? '翻譯中...' : 'Display Name (EN)'}
                  disabled={schemaTranslating}
                  value={form.display_name_en} onChange={e => setForm(p => ({ ...p, display_name_en: e.target.value }))} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 w-5 flex-shrink-0">VI</span>
                <input className={`input py-1 text-xs flex-1 ${schemaTranslating ? 'opacity-50' : ''}`} placeholder={schemaTranslating ? '翻譯中...' : 'Tên hiển thị (VI)'}
                  disabled={schemaTranslating}
                  value={form.display_name_vi} onChange={e => setForm(p => ({ ...p, display_name_vi: e.target.value }))} />
                {editId && (
                  <button type="button" onClick={retranslateSchema} disabled={schemaTranslating || !form.display_name}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-40 flex-shrink-0">
                    <RotateCcw size={10} className={schemaTranslating ? 'animate-spin' : ''} />
                    重新翻譯
                  </button>
                )}
              </div>
              {!editId && form.display_name && (
                <p className="text-[10px] text-blue-400">儲存後自動翻譯</p>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">別名 (alias) <span className="text-gray-300">SQL 中引用用</span></label>
            <input className="input py-1.5 text-sm font-mono" placeholder="wo_abnormal"
              value={form.alias} onChange={e => setForm(p => ({ ...p, alias: e.target.value.toLowerCase() }))} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">來源類型</label>
            <select className="input py-1.5 text-sm" value={form.source_type}
              onChange={e => setForm(p => ({ ...p, source_type: e.target.value as any }))}>
              <option value="table">Table（實體資料表）</option>
              <option value="view">View（視圖）</option>
              <option value="sql">SQL（自訂子查詢）</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">資料庫連線</label>
            <select className="input py-1.5 text-sm" value={form.db_connection}
              onChange={e => setForm(p => ({ ...p, db_connection: e.target.value }))}>
              <option value="erp">ERP (Oracle)</option>
              <option value="system">系統 DB</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">所屬專案</label>
            <select className="input py-1.5 text-sm" value={form.form_project_id ?? ''}
              onChange={e => setForm(p => ({ ...p, form_project_id: e.target.value ? Number(e.target.value) : undefined }))}>
              <option value="">— 未分配 —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        {form.source_type === 'sql' && (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">自訂 SQL（不含 SELECT *，此查詢會包在子查詢中）</label>
            <textarea className="input py-1.5 text-sm font-mono resize-none" rows={4}
              placeholder="SELECT wo_no, part_no, qty FROM apps.wip_discrete_jobs WHERE status_type = 3"
              value={form.source_sql} onChange={e => setForm(p => ({ ...p, source_sql: e.target.value }))} />
          </div>
        )}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">商業邏輯說明（LLM 理解用）</label>
          <textarea className="input py-1.5 text-sm resize-none" rows={2}
            placeholder="此視圖包含工單異常紀錄，欄位說明..."
            value={form.business_notes} onChange={e => setForm(p => ({ ...p, business_notes: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">
            關聯向量 ETL Job
            <span className="ml-1 text-gray-300">— 語意搜尋時使用此 Job 的向量過濾本表</span>
          </label>
          <select className="input py-1.5 text-sm"
            value={form.vector_etl_job_id || ''}
            onChange={e => setForm(p => ({ ...p, vector_etl_job_id: e.target.value ? Number(e.target.value) : undefined }))}>
            <option value="">不使用向量搜尋</option>
            {etlJobs.filter(j => j.job_type !== 'table_copy').map(j => (
              <option key={j.id} value={j.id}>{j.name} (PK: {j.upsert_key || '自動'})</option>
            ))}
          </select>
        </div>

        {/* 固定篩選條件 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-400 font-medium">
              固定 WHERE 條件 <span className="text-gray-300 font-normal">（每次查詢都會帶入）</span>
            </label>
            <button onClick={addBaseCond}
              className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1">
              <Plus size={10} /> 加條件
            </button>
          </div>
          {baseConditions.length === 0 ? (
            <p className="text-xs text-gray-300 italic">無固定條件（例如 organization_id=83）</p>
          ) : (
            <div className="space-y-2">
              {baseConditions.map((c, i) => (
                <div key={i} className="bg-white rounded-lg border border-gray-200 px-2 py-2 space-y-1.5">
                  <div className="flex gap-1.5 items-center">
                    {/* Column */}
                    <div className="flex-1 min-w-0">
                      {editColOptions.length > 0 ? (
                        <select className="input py-1 text-xs w-full font-mono" value={c.col}
                          onChange={e => setBaseCond(i, 'col', e.target.value)}>
                          <option value="">-- 欄位 --</option>
                          {editColOptions.map((col: string) => {
                            const alias = form.alias || form.table_name.split('.').pop()!.toLowerCase()
                            const full = `${alias}.${col}`
                            return <option key={col} value={full}>{full}</option>
                          })}
                          <option value="__custom__">✎ 自訂...</option>
                        </select>
                      ) : (
                        <input className="input py-1 text-xs font-mono w-full" placeholder="alias.COLUMN"
                          value={c.col} onChange={e => setBaseCond(i, 'col', e.target.value)} />
                      )}
                    </div>
                    {/* Op */}
                    <select className="input py-1 text-xs flex-shrink-0" style={{ width: '7rem' }} value={c.op}
                      onChange={e => setBaseCond(i, 'op', e.target.value)}>
                      {['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL'].map(op => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                    {/* Value */}
                    {!['IS NULL', 'IS NOT NULL'].includes(c.op) && (
                      <input className="input py-1 text-xs font-mono flex-1 min-w-0"
                        placeholder={c.op === 'BETWEEN' ? "val1 AND val2" : c.op === 'IN' || c.op === 'NOT IN' ? "'A','B'" : "83"}
                        value={c.val} onChange={e => setBaseCond(i, 'val', e.target.value)} />
                    )}
                    <button onClick={() => delBaseCond(i)}
                      className="flex-shrink-0 p-1 rounded text-red-400 hover:bg-red-50 hover:text-red-600 transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {/* Preview */}
                  {c.col && (
                    <p className="text-[10px] font-mono text-gray-400 pl-1">
                      {c.op === 'IS NULL' || c.op === 'IS NOT NULL' ? `${c.col} ${c.op}` : `${c.col} ${c.op} ${c.val || '?'}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={loading || !form.table_name}
            className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
            <Save size={12} /> {loading ? '儲存中...' : '儲存'}
          </button>
          {editId && <button onClick={() => { setEditId(null); setForm(emptyForm); setBaseConditions([]) }}
            className="text-xs text-gray-500 hover:text-gray-800 px-2">取消</button>}
        </div>
      </div>

      {/* 跨專案複製 Dialog */}
      {showCopyDialog && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-[520px] max-h-[70vh] flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">從其他專案複製 Schema</p>
              <button onClick={() => setShowCopyDialog(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <input className="input py-1.5 text-sm" placeholder="搜尋名稱或 table..."
              value={copySearch} onChange={e => setCopySearch(e.target.value)} autoFocus />
            <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
              {allSchemasForCopy
                .filter(s => {
                  const q = copySearch.toLowerCase()
                  return !q || (s.display_name || '').toLowerCase().includes(q) || s.table_name.toLowerCase().includes(q)
                })
                .map(s => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 border border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-700">{s.display_name || s.table_name}</p>
                      <p className="text-xs text-gray-400 font-mono">{s.table_name} · {s.db_connection}</p>
                    </div>
                    <button onClick={() => copySchema(s.id!)}
                      className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
                      複製到本專案
                    </button>
                  </div>
                ))}
              {allSchemasForCopy.filter(s => {
                const q = copySearch.toLowerCase()
                return !q || (s.display_name || '').toLowerCase().includes(q) || s.table_name.toLowerCase().includes(q)
              }).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">無其他專案的 Schema</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-medium">Schema 清單（{schemas.length}）</span>
        <div className="flex items-center gap-3">
          {projectId && (
            <button onClick={openCopyDialog}
              className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 transition">
              <Copy size={12} /> 從其他專案複製
            </button>
          )}
          <button onClick={() => { setShowImport(true); setImportResult(null) }}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition">
            <RefreshCw size={12} /> 從 Oracle ERP 批次匯入
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {schemas.map(s => (
          <div key={s.id} className="bg-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer"
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
              <div className="flex items-center gap-2 flex-wrap">
                {expanded === s.id ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                <span className="text-sm text-gray-800 font-medium">{s.display_name || s.table_name}</span>
                {s.alias && <span className="text-xs font-mono text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">AS {s.alias}</span>}
                <span className="text-xs text-gray-400">{s.table_name}</span>
                {s.source_type && s.source_type !== 'table' && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-600">{s.source_type}</span>
                )}
                <span className={`text-xs px-1.5 py-0.5 rounded ${s.db_connection === 'erp' ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}>
                  {s.db_connection}
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={e => {
                  e.stopPropagation()
                  setEditId(s.id)
                  setForm({
                    table_name: s.table_name, display_name: s.display_name || '',
                    display_name_en: s.display_name_en || '', display_name_vi: s.display_name_vi || '',
                    alias: s.alias || '', source_type: s.source_type || 'table', source_sql: s.source_sql || '',
                    db_connection: s.db_connection, business_notes: s.business_notes || '', join_hints: s.join_hints || '',
                    vector_etl_job_id: s.vector_etl_job_id,
                    form_project_id: s.project_id ?? projectId ?? undefined
                  })
                  try {
                    const bc = s.base_conditions ? JSON.parse(s.base_conditions) : []
                    setBaseConditions(Array.isArray(bc) ? bc : [])
                  } catch { setBaseConditions([]) }
                  setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                }} className="text-gray-400 hover:text-blue-400 text-xs">編輯</button>
                <button onClick={e => { e.stopPropagation(); del(s.id) }}
                  className="text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
              </div>
            </div>
            {expanded === s.id && (
              <div className="px-4 pb-3 border-t border-gray-200 pt-2 space-y-2">
                {s.business_notes && (
                  <p className="text-xs text-gray-500">{s.business_notes}</p>
                )}
                {s.base_conditions && (() => {
                  try {
                    const bc: BaseCondition[] = JSON.parse(s.base_conditions)
                    if (!bc.length) return null
                    return (
                      <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 font-mono space-y-0.5">
                        <p className="font-sans font-medium text-amber-500 mb-0.5">固定 WHERE 條件：</p>
                        {bc.map((c, i) => (
                          <p key={i}>{c.col} {c.op}{['IS NULL','IS NOT NULL'].includes(c.op) ? '' : ' ' + c.val}</p>
                        ))}
                      </div>
                    )
                  } catch { return null }
                })()}
                {/* 欄位操作按鈕列 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => startEditCols(s)}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600">
                    <PenLine size={11} /> 編輯說明
                  </button>
                  {(s.source_type === 'table' || s.source_type === 'view' || !s.source_type) && (
                    <button onClick={async () => {
                      if (!confirm(`刷新「${s.display_name || s.table_name}」的欄位定義？\n• 新增欄位將加入\n• 已移除欄位將刪除\n• 現有欄位的所有設定（說明、可見性、過濾鍵等）保留不動`)) return
                      try {
                        const res = await api.post(`/dashboard/designer/schemas/${s.id}/refresh`)
                        const { added, removed, unchanged, total, added_cols, removed_cols } = res.data
                        // 重新載入 schemas
                        const qs = projectId ? `?project_id=${projectId}` : ''
                        const schemasRes = await api.get(`/dashboard/designer/schemas${qs}`)
                        setSchemas(schemasRes.data)
                        const freshSchema = schemasRes.data.find((sc: any) => sc.id === s.id)
                        if (editingColsId === s.id && freshSchema) startEditCols(freshSchema)
                        let msg = `刷新完成（共 ${total} 欄）\n✅ 新增 ${added}，🗑 移除 ${removed}，⬜ 保留 ${unchanged}`
                        if (added_cols?.length) msg += `\n新增欄位：${added_cols.join(', ')}`
                        if (removed_cols?.length) msg += `\n移除欄位：${removed_cols.join(', ')}`
                        alert(msg)
                      } catch (e: any) { alert(e?.response?.data?.error || '刷新失敗') }
                    }}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-teal-400 hover:text-teal-600">
                      <RotateCcw size={11} /> 刷新定義
                    </button>
                  )}
                  <button onClick={async () => {
                    if (!confirm(`批次自動翻譯「${s.display_name || s.table_name}」所有欄位說明為英文和越文？`)) return
                    try {
                      const res = await api.post(`/dashboard/designer/schemas/${s.id}/columns/translate`)
                      // 重新拉最新 schemas（含 desc_en/desc_vi）並更新 editingCols
                      const qs = projectId ? `?project_id=${projectId}` : ''
                      const schemasRes = await api.get(`/dashboard/designer/schemas${qs}`)
                      const freshSchema = schemasRes.data.find((sc: any) => sc.id === s.id)
                      if (freshSchema) {
                        setSchemas(schemasRes.data)
                        startEditCols(freshSchema)
                      }
                      alert(`翻譯完成，已更新 ${res.data.updated} 個欄位`)
                    } catch (e: any) { alert(e?.response?.data?.error || '翻譯失敗') }
                  }}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-purple-400 hover:text-purple-600">
                    <Languages size={11} /> 批次翻譯
                  </button>
                  <button onClick={() => exportCsv(s.id)}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-green-400 hover:text-green-600">
                    <Download size={11} /> 匯出 CSV
                  </button>
                  <label className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 cursor-pointer">
                    <FileUp size={11} /> 匯入 CSV
                    <input type="file" accept=".csv" className="hidden" onChange={e => importCsvFile(s.id, e)} />
                  </label>
                </div>

                {/* 欄位列表 — 編輯模式 */}
                {editingColsId === s.id ? (
                  <div className="space-y-2">
                    {/* 搜尋過濾列 */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="input py-1 text-xs flex-1"
                        placeholder="🔍 搜尋欄位名稱、說明..."
                        value={colFilter}
                        onChange={e => setColFilter(e.target.value)}
                      />
                      {colFilter && (
                        <button onClick={() => setColFilter('')} className="text-gray-400 hover:text-gray-600 text-xs px-2">✕ 清除</button>
                      )}
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {colFilter
                          ? `${editingCols.filter(c => c.column_name.toLowerCase().includes(colFilter.toLowerCase()) || (c.description || '').toLowerCase().includes(colFilter.toLowerCase()) || (c.desc_en || '').toLowerCase().includes(colFilter.toLowerCase())).length} / ${editingCols.length}`
                          : `共 ${editingCols.length} 欄`}
                      </span>
                    </div>
                    <div className="overflow-auto max-h-[600px] rounded border border-blue-200">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-blue-50 z-10">
                          <tr>
                            <th className="px-2 py-1.5 text-center w-8" title="資料權限過濾">🔒</th>
                            <th className="px-2 py-1.5 text-center w-8">
                              <div className="flex flex-col items-center gap-0.5">
                                <span title="使用者可見（可在欄位選擇器中選取）">👁</span>
                                <div className="flex gap-0.5">
                                  <button type="button" className="text-[9px] text-blue-500 hover:underline leading-none" title="全部設為可見"
                                    onClick={() => setEditingCols(prev => prev.map(c => ({ ...c, is_visible: 1 })))}>全</button>
                                  <span className="text-gray-300 text-[9px]">/</span>
                                  <button type="button" className="text-[9px] text-gray-400 hover:underline leading-none" title="全部設為隱藏"
                                    onClick={() => setEditingCols(prev => prev.map(c => ({ ...c, is_visible: 0 })))}>無</button>
                                </div>
                              </div>
                            </th>
                            <th className="px-2 py-1.5 text-left text-gray-500 font-medium w-44">欄位名稱</th>
                            <th className="px-2 py-1.5 text-left text-gray-500 font-medium w-24">型態</th>
                            <th className="px-2 py-1.5 text-left text-gray-500 font-medium">說明 🇹🇼</th>
                            <th className="px-2 py-1.5 text-left text-gray-500 font-medium">EN 🇺🇸</th>
                            <th className="px-2 py-1.5 text-left text-gray-500 font-medium">VI 🇻🇳</th>
                            <th className="px-2 py-1.5 w-6"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editingCols.map((col, i) => {
                            if (colFilter) {
                              const q = colFilter.toLowerCase()
                              const match = col.column_name.toLowerCase().includes(q)
                                || (col.description || '').toLowerCase().includes(q)
                                || (col.desc_en || '').toLowerCase().includes(q)
                                || (col.desc_vi || '').toLowerCase().includes(q)
                              if (!match) return null
                            }
                            return (
                            <>
                              <tr key={`row-${i}`} className={col.is_virtual ? 'bg-purple-50' : col.is_filter_key ? 'bg-orange-50' : col.is_visible === 0 ? 'bg-gray-100 opacity-50' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                {/* 過濾 checkbox */}
                                <td className="px-2 py-1.5 text-center">
                                  <input type="checkbox"
                                    checked={!!col.is_filter_key}
                                    onChange={e => setEditingCols(prev => prev.map((c, idx) => idx === i ? { ...c, is_filter_key: e.target.checked ? 1 : 0 } : c))}
                                    className="w-3.5 h-3.5 rounded accent-orange-500 cursor-pointer"
                                    title="勾選：此欄位作為資料權限 SQL 過濾條件"
                                  />
                                </td>
                                {/* 可見 checkbox */}
                                <td className="px-2 py-1.5 text-center">
                                  <input type="checkbox"
                                    checked={col.is_visible !== 0}
                                    onChange={e => setEditingCols(prev => prev.map((c, idx) => idx === i ? { ...c, is_visible: e.target.checked ? 1 : 0 } : c))}
                                    className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer"
                                    title="使用者可在欄位選擇器中看到此欄位"
                                  />
                                </td>
                                <td className="px-2 py-1.5 font-mono text-gray-700 whitespace-nowrap">
                                  {col.column_name}
                                  {col.is_virtual ? <span className="ml-1 text-[10px] text-purple-500 bg-purple-100 px-1 rounded">計算</span> : null}
                                </td>
                                <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">
                                  {col.is_virtual
                                    ? <span className="text-purple-400 font-mono text-[10px] truncate block max-w-[90px]" title={col.expression}>{col.expression}</span>
                                    : col.data_type || '-'}
                                </td>
                                <td className="px-2 py-1">
                                  <input className="w-full border border-transparent hover:border-gray-300 focus:border-blue-400 rounded px-1 py-0.5 bg-transparent text-gray-700 focus:outline-none focus:bg-white"
                                    value={col.description || ''}
                                    onChange={e => setEditingCols(prev => prev.map((c, idx) => idx === i ? { ...c, description: e.target.value } : c))} />
                                </td>
                                <td className="px-2 py-1">
                                  <input className="w-full border border-transparent hover:border-gray-300 focus:border-blue-400 rounded px-1 py-0.5 bg-transparent text-gray-700 focus:outline-none focus:bg-white text-xs text-blue-700"
                                    placeholder="English"
                                    value={(col as any).desc_en || ''}
                                    onChange={e => setEditingCols(prev => prev.map((c, idx) => idx === i ? { ...c, desc_en: e.target.value } : c))} />
                                </td>
                                <td className="px-2 py-1">
                                  <input className="w-full border border-transparent hover:border-gray-300 focus:border-blue-400 rounded px-1 py-0.5 bg-transparent text-gray-700 focus:outline-none focus:bg-white text-xs text-green-700"
                                    placeholder="Tiếng Việt"
                                    value={(col as any).desc_vi || ''}
                                    onChange={e => setEditingCols(prev => prev.map((c, idx) => idx === i ? { ...c, desc_vi: e.target.value } : c))} />
                                </td>
                                <td className="px-1 py-1">
                                  {col.is_virtual && (
                                    <button onClick={() => setEditingCols(prev => prev.filter((_, idx) => idx !== i))}
                                      className="text-gray-300 hover:text-red-400"><X size={11} /></button>
                                  )}
                                </td>
                              </tr>
                              {/* 展開子列：過濾層級 + 來源欄位 */}
                              {col.is_filter_key && (
                                <tr key={`filter-${i}`} className="bg-orange-50 border-b border-orange-100">
                                  <td></td>
                                  <td colSpan={4} className="px-3 py-2">
                                    <div className="flex items-center gap-3">
                                      <span className="text-orange-600 font-medium text-xs whitespace-nowrap">⚙ 過濾設定</span>
                                      <div className="flex items-center gap-2 flex-1">
                                        <div>
                                          <label className="block text-[10px] text-gray-400 mb-0.5">過濾層級</label>
                                          <select
                                            value={col.filter_layer || ''}
                                            onChange={e => setEditingCols(prev => prev.map((c, idx) => idx === i ? { ...c, filter_layer: e.target.value, filter_source: '' } : c))}
                                            className="border border-orange-200 rounded px-2 py-1 text-xs bg-white outline-none focus:ring-1 focus:ring-orange-300 min-w-[140px]"
                                          >
                                            <option value="">-- 選層級 --</option>
                                            <option value="layer3">第3層 組織過濾</option>
                                            <option value="layer4">第4層 ERP Multi-Org</option>
                                          </select>
                                        </div>
                                        {col.filter_layer && (
                                          <div>
                                            <label className="block text-[10px] text-gray-400 mb-0.5">對應來源欄位</label>
                                            <select
                                              value={col.filter_source || ''}
                                              onChange={e => setEditingCols(prev => prev.map((c, idx) => idx === i ? { ...c, filter_source: e.target.value } : c))}
                                              className="border border-orange-200 rounded px-2 py-1 text-xs bg-white outline-none focus:ring-1 focus:ring-orange-300 min-w-[200px]"
                                            >
                                              <option value="">-- 來源欄位 --</option>
                                              {col.filter_layer === 'layer3' && <>
                                                <optgroup label="公司組織階層">
                                                  <option value="org_group_name">事業群名稱 (ORG_GROUP_NAME)</option>
                                                  <option value="org_section">事業處 (ORG_SECTION)</option>
                                                  <option value="profit_center">利潤中心 (PROFIT_CENTER)</option>
                                                  <option value="dept_code">部門代碼 (DEPT_CODE)</option>
                                                </optgroup>
                                                <optgroup label="對應製造組織">
                                                  <option value="org_code">組織代碼 (ORG_CODE)</option>
                                                  <option value="org_id">組織 ID (ORG_ID)</option>
                                                </optgroup>
                                              </>}
                                              {col.filter_layer === 'layer4' && <>
                                                <optgroup label="製造組織層 (INV/WIP/BOM)">
                                                  <option value="organization_id">製造組織 ID（ORGANIZATION_ID）</option>
                                                  <option value="organization_code">製造組織 Code（如 Z4E）</option>
                                                </optgroup>
                                                <optgroup label="營運單位層 (AP/AR/PO/OM)">
                                                  <option value="operating_unit">營運單位 ID（OPERATING_UNIT）</option>
                                                  <option value="operating_unit_name">營運單位名稱</option>
                                                </optgroup>
                                                <optgroup label="帳套層 (GL 總帳)">
                                                  <option value="set_of_books_id">帳套 ID（SET_OF_BOOKS_ID）</option>
                                                  <option value="set_of_books_name">帳套名稱</option>
                                                </optgroup>
                                              </>}
                                            </select>
                                          </div>
                                        )}
                                        {col.filter_source && (
                                          <span className="text-xs text-orange-500 bg-orange-100 px-2 py-1 rounded-full whitespace-nowrap">
                                            {col.column_name} → {col.filter_source}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* 新增計算欄位 */}
                    {showVirtualForm ? (
                      <div className="border border-purple-200 rounded-lg p-3 bg-purple-50 space-y-2">
                        <p className="text-xs font-medium text-purple-700 flex items-center gap-1"><FunctionSquare size={12} /> 新增計算欄位</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-400">欄位別名（AS 名稱）</label>
                            <input className="input py-1 text-xs mt-0.5" placeholder="例如 data_month"
                              value={virtualForm.name} onChange={e => setVirtualForm(p => ({ ...p, name: e.target.value }))} />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-400">說明</label>
                            <input className="input py-1 text-xs mt-0.5" placeholder="例如 資料完工月份"
                              value={virtualForm.description} onChange={e => setVirtualForm(p => ({ ...p, description: e.target.value }))} />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400">函數範本快速帶入</label>
                          <select className="input py-1 text-xs mt-0.5"
                            value={virtualForm.fn_template}
                            onChange={e => {
                              const v = e.target.value
                              setVirtualForm(p => ({ ...p, fn_template: v, expression: v || p.expression }))
                            }}>
                            {ORACLE_FN_TEMPLATES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400">計算式（Oracle SQL 表達式，#col# 替換為實際欄位名）</label>
                          <input className="input py-1 text-xs font-mono mt-0.5"
                            placeholder="例如 TO_CHAR(data_completion_date, 'YYYYMM')"
                            value={virtualForm.expression} onChange={e => setVirtualForm(p => ({ ...p, expression: e.target.value }))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={addVirtualCol} className="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700">加入</button>
                          <button onClick={() => setShowVirtualForm(false)} className="text-xs text-gray-500 hover:text-gray-700">取消</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setShowVirtualForm(true)}
                        className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700">
                        <Plus size={11} /> 新增計算欄位
                      </button>
                    )}

                    <div className="flex gap-2">
                      <button onClick={() => saveEditCols(s.id)} disabled={colsSaving}
                        className="flex items-center gap-1 text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50">
                        <Save size={11} /> {colsSaving ? '儲存中...' : '儲存'}
                      </button>
                      <button onClick={() => { setEditingColsId(null); setShowVirtualForm(false) }}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2">取消</button>
                    </div>
                  </div>
                ) : (
                  /* 欄位列表 — 唯讀模式 */
                  (s as any).columns?.length > 0 ? (
                    <div className="overflow-auto max-h-64 rounded border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-gray-200">
                          <tr>
                            <th className="px-2 py-1 text-left text-gray-500 font-medium">欄位名稱</th>
                            <th className="px-2 py-1 text-left text-gray-500 font-medium">型態</th>
                            <th className="px-2 py-1 text-left text-gray-500 font-medium">說明</th>
                            <th className="px-2 py-1 text-left text-gray-500 font-medium">資料權限</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(s as any).columns.map((col: any, i: number) => (
                            <tr key={col.id ?? i} className={col.is_virtual ? 'bg-purple-50' : (i % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                              <td className="px-2 py-1 font-mono text-gray-700 whitespace-nowrap">
                                {col.column_name}
                                {col.is_virtual ? <span className="ml-1 text-[10px] text-purple-500 bg-purple-100 px-1 rounded">計算</span> : null}
                              </td>
                              <td className="px-2 py-1 text-gray-400 whitespace-nowrap">
                                {col.is_virtual
                                  ? <span className="text-purple-400 font-mono text-[10px]">{col.expression}</span>
                                  : (col.data_type || '-')}
                              </td>
                              <td className="px-2 py-1 text-gray-500">{col.description || ''}</td>
                              <td className="px-2 py-1">
                                {col.is_filter_key ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] bg-orange-50 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                    🔒 {col.filter_layer === 'layer3' ? 'L3' : col.filter_layer === 'layer4' ? 'L4' : col.filter_layer}:{col.filter_source}
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">無欄位定義</p>
                  )
                )}
              </div>
            )}
          </div>
        ))}
        {schemas.length === 0 && <p className="text-gray-400 text-xs text-center py-4">尚無 Schema 定義</p>}
      </div>
    </div>
  )
}

// ── Join Manager ──────────────────────────────────────────────────────────────
type JoinCondition = { left: string; op: string; right: string; right2?: string }

const OPS_NO_RIGHT = ['IS NULL', 'IS NOT NULL']
const OPS_BETWEEN  = ['BETWEEN']
const OPS_TEXT     = ['LIKE', 'NOT LIKE', 'IN']  // IN: comma-separated

// 建立含兩個 schema 欄位的 optgroup 結構
function buildColGroups(schemas: AiSchemaDef[]) {
  return schemas
    .filter(Boolean)
    .map(s => {
      const alias = s.alias || s.table_name.split('.').pop()!.toLowerCase()
      const cols = ((s as any).columns || []) as any[]
      return {
        label: `${alias}  (${s.display_name || s.table_name})`,
        options: cols.map(c => ({
          value: `${alias}.${c.column_name}`,
          label: `${alias}.${c.column_name}${c.description ? '  — ' + c.description : ''}`
        }))
      }
    })
    .filter(g => g.options.length > 0)
}

// 欄位選擇器：optgroup 列出兩個 schema 的欄位，最後可自由輸入
function ColSelect({ value, onChange, groups, placeholder, disabled }: {
  value: string; onChange: (v: string) => void
  groups: { label: string; options: { value: string; label: string }[] }[]
  placeholder: string; disabled?: boolean
}) {
  const isCustom = value !== '' && !groups.some(g => g.options.some(o => o.value === value))
  const [showCustom, setShowCustom] = useState(isCustom)
  const [customVal, setCustomVal] = useState(isCustom ? value : '')

  if (showCustom) {
    return (
      <div className="flex gap-1">
        <input className="input py-1 text-xs flex-1 min-w-0" placeholder="alias.COLUMN 或 '值'"
          value={customVal} onChange={e => { setCustomVal(e.target.value); onChange(e.target.value) }} />
        <button onClick={() => { setShowCustom(false); setCustomVal('') }}
          className="text-xs text-gray-400 hover:text-gray-600 px-1 flex-shrink-0">↩</button>
      </div>
    )
  }
  return (
    <select className="input py-1 text-xs w-full" value={value} disabled={disabled}
      onChange={e => {
        if (e.target.value === '__custom__') { setShowCustom(true); onChange('') }
        else onChange(e.target.value)
      }}>
      <option value="">{placeholder}</option>
      {groups.map(g => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      ))}
      <option value="__custom__">✎ 自訂值/運算式...</option>
    </select>
  )
}

function JoinManager({ projectId }: { projectId: number | null }) {
  const [schemas, setSchemas] = useState<AiSchemaDef[]>([])
  const [joins, setJoins] = useState<AiSchemaJoin[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '', left_schema_id: '', right_schema_id: '', join_type: 'LEFT',
    form_project_id: undefined as number | undefined
  })
  const [conditions, setConditions] = useState<JoinCondition[]>([{ left: '', op: '=', right: '' }])
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<AiSelectProject[]>([])

  const load = () => {
    const qs = projectId ? `?project_id=${projectId}` : ''
    api.get(`/dashboard/designer/schemas`).then(r => setSchemas(r.data)).catch(() => {})
    api.get(`/dashboard/designer/joins${qs}`).then(r => setJoins(r.data)).catch(() => {})
  }
  useEffect(() => {
    load()
    api.get('/dashboard/projects').then(r => setProjects(r.data)).catch(() => {})
  }, [projectId])

  const reset = () => {
    setEditId(null)
    setForm({ name: '', left_schema_id: '', right_schema_id: '', join_type: 'LEFT', form_project_id: projectId || undefined })
    setConditions([{ left: '', op: '=', right: '' }])
    setShowForm(false)
  }

  const startEdit = (j: AiSchemaJoin & any) => {
    setEditId(j.id)
    setForm({ name: j.name, left_schema_id: String(j.left_schema_id), right_schema_id: String(j.right_schema_id), join_type: j.join_type, form_project_id: j.project_id ?? projectId ?? undefined })
    try {
      const conds = typeof j.conditions_json === 'string' ? JSON.parse(j.conditions_json) : j.conditions_json
      setConditions(Array.isArray(conds) && conds.length ? conds : [{ left: '', op: '=', right: '' }])
    } catch { setConditions([{ left: '', op: '=', right: '' }]) }
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name || !form.left_schema_id || !form.right_schema_id) return
    setLoading(true)
    try {
      const { form_project_id, ...rest } = form
      const payload = { ...rest, left_schema_id: Number(form.left_schema_id), right_schema_id: Number(form.right_schema_id), conditions_json: conditions, project_id: form_project_id ?? projectId ?? undefined }
      if (editId) await api.put(`/dashboard/designer/joins/${editId}`, payload)
      else await api.post('/dashboard/designer/joins', payload)
      reset(); load()
    } catch (e: any) { alert(e?.response?.data?.error || '儲存失敗') }
    finally { setLoading(false) }
  }

  const del = async (id: number) => {
    if (!confirm('刪除此 Join 定義？')) return
    await api.delete(`/dashboard/designer/joins/${id}`); load()
  }

  const setCondField = (i: number, field: keyof JoinCondition, val: string) =>
    setConditions(cs => cs.map((c, idx) => idx === i ? { ...c, [field]: val } : c))

  const addCond = () => setConditions(cs => [...cs, { left: '', op: '=', right: '' }])
  const delCond = (i: number) => setConditions(cs => cs.filter((_, idx) => idx !== i))
  const changeOp = (i: number, op: string) =>
    setConditions(cs => cs.map((c, idx) => idx === i ? { ...c, op, right: OPS_NO_RIGHT.includes(op) ? '' : c.right, right2: undefined } : c))

  const leftSchema  = schemas.find(s => s.id === Number(form.left_schema_id))
  const rightSchema = schemas.find(s => s.id === Number(form.right_schema_id))
  // 兩個 schema 的欄位合併（都顯示在每個欄位選擇器中）
  const colGroups = buildColGroups([leftSchema!, rightSchema!].filter(Boolean) as AiSchemaDef[])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-medium">Join 定義（{joins.length}）</span>
        <button onClick={() => { reset(); setShowForm(true) }}
          className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
          <Plus size={12} /> 新增 Join
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-100 rounded-xl p-4 space-y-4">
          <p className="text-xs text-gray-500 font-medium">{editId ? '編輯 Join' : '新增 Join'}</p>

          {/* 基本設定 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">Join 名稱 *</label>
              <input className="input py-1.5 text-sm" placeholder="合理庫存 JOIN 料件主檔"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">主表（左側）*</label>
              <select className="input py-1.5 text-sm" value={form.left_schema_id}
                onChange={e => setForm(p => ({ ...p, left_schema_id: e.target.value }))}>
                <option value="">-- 選擇 --</option>
                {schemas.map(s => <option key={s.id} value={s.id}>{s.alias || s.display_name || s.table_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Join 表（右側）*</label>
              <select className="input py-1.5 text-sm" value={form.right_schema_id}
                onChange={e => setForm(p => ({ ...p, right_schema_id: e.target.value }))}>
                <option value="">-- 選擇 --</option>
                {schemas.filter(s => s.id !== Number(form.left_schema_id)).map(s => (
                  <option key={s.id} value={s.id}>{s.alias || s.display_name || s.table_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Join 類型</label>
              <select className="input py-1.5 text-sm" value={form.join_type}
                onChange={e => setForm(p => ({ ...p, join_type: e.target.value }))}>
                <option value="LEFT">LEFT JOIN（以主表為主）</option>
                <option value="INNER">INNER JOIN（取交集）</option>
                <option value="RIGHT">RIGHT JOIN（以 Join 表為主）</option>
                <option value="FULL">FULL OUTER JOIN（全外連接）</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">所屬專案</label>
              <select className="input py-1.5 text-sm" value={form.form_project_id ?? ''}
                onChange={e => setForm(p => ({ ...p, form_project_id: e.target.value ? Number(e.target.value) : undefined }))}>
                <option value="">— 未分配 —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {/* Conditions Builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-medium">ON 條件</label>
              <button onClick={addCond}
                className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1">
                <Plus size={10} /> 加條件
              </button>
            </div>

            {(!leftSchema || !rightSchema) && (
              <p className="text-xs text-amber-500 bg-amber-50 rounded-lg px-3 py-2">請先選擇主表和 Join 表，才能從欄位清單選擇</p>
            )}

            <div className="space-y-3">
              {conditions.map((c, i) => (
                <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400">條件 {i + 1}</span>
                    {conditions.length > 1 && (
                      <button onClick={() => delCond(i)}
                        className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
                        <Trash2 size={11} /> 刪除
                      </button>
                    )}
                  </div>

                  {/* Left field */}
                  <div className="mb-2">
                    <label className="text-[10px] text-gray-400 mb-0.5 block">左側欄位</label>
                    <ColSelect
                      value={c.left} onChange={v => setCondField(i, 'left', v)}
                      groups={colGroups} placeholder="-- 選擇欄位 --"
                    />
                  </div>

                  {/* Operator */}
                  <div className="mb-2">
                    <label className="text-[10px] text-gray-400 mb-0.5 block">運算子</label>
                    <select className="input py-1 text-xs w-full" value={c.op}
                      onChange={e => changeOp(i, e.target.value)}>
                      <optgroup label="等值/比較">
                        {['=', '!=', '>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
                      </optgroup>
                      <optgroup label="字串比對">
                        {['LIKE', 'NOT LIKE'].map(op => <option key={op} value={op}>{op}</option>)}
                      </optgroup>
                      <optgroup label="集合/範圍">
                        <option value="IN">IN（逗號分隔多值）</option>
                        <option value="NOT IN">NOT IN</option>
                        <option value="BETWEEN">BETWEEN（範圍）</option>
                      </optgroup>
                      <optgroup label="NULL 判斷">
                        <option value="IS NULL">IS NULL</option>
                        <option value="IS NOT NULL">IS NOT NULL</option>
                      </optgroup>
                    </select>
                  </div>

                  {/* Right field(s) — depends on op */}
                  {!OPS_NO_RIGHT.includes(c.op) && (
                    <div>
                      {OPS_BETWEEN.includes(c.op) ? (
                        <>
                          <label className="text-[10px] text-gray-400 mb-0.5 block">起始值</label>
                          <ColSelect
                            value={c.right} onChange={v => setCondField(i, 'right', v)}
                            groups={colGroups} placeholder="-- 起始值 --"
                          />
                          <label className="text-[10px] text-gray-400 mt-1.5 mb-0.5 block">結束值（AND ...）</label>
                          <ColSelect
                            value={c.right2 || ''} onChange={v => setCondField(i, 'right2', v)}
                            groups={colGroups} placeholder="-- 結束值 --"
                          />
                        </>
                      ) : OPS_TEXT.includes(c.op) ? (
                        <>
                          <label className="text-[10px] text-gray-400 mb-0.5 block">
                            {c.op === 'IN' || c.op === 'NOT IN' ? '值（逗號分隔，e.g. 1,2,3）' : '模式（% 為萬用字元）'}
                          </label>
                          <input className="input py-1 text-xs w-full font-mono"
                            placeholder={c.op === 'IN' || c.op === 'NOT IN' ? "'A','B','C'" : "'%keyword%'"}
                            value={c.right} onChange={e => setCondField(i, 'right', e.target.value)} />
                        </>
                      ) : (
                        <>
                          <label className="text-[10px] text-gray-400 mb-0.5 block">右側欄位或值</label>
                          <ColSelect
                            value={c.right} onChange={v => setCondField(i, 'right', v)}
                            groups={colGroups} placeholder="-- 選擇欄位或自訂值 --"
                          />
                        </>
                      )}
                    </div>
                  )}

                  {/* Preview */}
                  <p className="text-[10px] font-mono text-gray-400 mt-2 truncate">
                    {c.left || '?'} {c.op}{' '}
                    {OPS_NO_RIGHT.includes(c.op) ? '' :
                      OPS_BETWEEN.includes(c.op) ? `${c.right || '?'} AND ${c.right2 || '?'}` :
                      OPS_TEXT.includes(c.op) ? c.right || '?' : c.right || '?'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={loading || !form.name || !form.left_schema_id || !form.right_schema_id}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
              <Save size={12} /> {loading ? '儲存中...' : '儲存'}
            </button>
            <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-800 px-2">取消</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {joins.map((j: any) => {
          let conds: JoinCondition[] = []
          try { conds = typeof j.conditions_json === 'string' ? JSON.parse(j.conditions_json) : j.conditions_json } catch {}
          return (
            <div key={j.id} className="bg-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Link2 size={14} className="text-blue-500" />
                  <span className="text-sm font-medium text-gray-800">{j.name}</span>
                  <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">{j.join_type} JOIN</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(j)} className="text-xs text-gray-500 hover:text-blue-400">編輯</button>
                  <button onClick={() => del(j.id)} className="text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <p>
                  <span className="font-mono text-purple-600">{j.left_alias || j.left_table}</span>
                  {' '}→{' '}
                  <span className="font-mono text-purple-600">{j.right_alias || j.right_table}</span>
                </p>
                {conds.map((c, i) => (
                  <p key={i} className="font-mono text-gray-400 pl-2">
                    ON {c.left} {c.op}{' '}
                    {OPS_NO_RIGHT.includes(c.op) ? '' :
                      OPS_BETWEEN.includes(c.op) ? `${c.right} AND ${c.right2 || '?'}` : c.right}
                  </p>
                ))}
              </div>
            </div>
          )
        })}
        {joins.length === 0 && <p className="text-gray-400 text-xs text-center py-4">尚無 Join 定義</p>}
      </div>
    </div>
  )
}

// ── Vector Skip Fields Picker（向量跳過欄位選擇器，以 popover 呈現）────────────
function VectorSkipFieldsPicker({
  schemas, targetSchemaIds, selected, onChangeSelected,
  topK, onChangeTopK, threshold, onChangeThreshold
}: {
  schemas: AiSchemaDef[]
  targetSchemaIds: number[]
  selected: string[]
  onChangeSelected: (fields: string[]) => void
  topK: string
  onChangeTopK: (v: string) => void
  threshold: string
  onChangeThreshold: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const availableCols = Array.from(new Set(
    schemas.filter(s => targetSchemaIds.includes(s.id))
      .flatMap(s => (s.columns || []).map((c: any) => c.column_name).filter(Boolean))
  )).sort()

  const toggle = (col: string) => onChangeSelected(
    selected.includes(col) ? selected.filter(f => f !== col) : [...selected, col]
  )

  return (
    <div className="pt-2 space-y-2">
      <div className="flex items-end gap-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Top K（回傳筆數）</label>
          <input type="number" min={1} max={500} className="input py-1 text-xs" style={{ width: '90px', minWidth: '90px' }}
            value={topK} onChange={e => onChangeTopK(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">相似度門檻（COSINE，越小越嚴格）</label>
          <input type="number" min={0} max={2} step={0.05} className="input py-1 text-xs w-24"
            value={threshold} onChange={e => onChangeThreshold(e.target.value)} />
        </div>
        <p className="text-xs text-gray-400 pb-1">建議 0.30~0.60</p>
        {availableCols.length > 0 && (
          <div className="relative pb-1">
            <button type="button" onClick={() => setOpen(p => !p)}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border transition ${
                selected.length > 0
                  ? 'bg-orange-50 border-orange-300 text-orange-700'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
              }`}>
              <Filter size={11} />
              跳過欄位
              {selected.length > 0 && <span className="ml-1 bg-orange-400 text-white rounded-full text-[10px] w-4 h-4 flex items-center justify-center">{selected.length}</span>}
            </button>
            {open && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-72">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-700">欄位有明確值時跳過向量搜尋</p>
                  <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
                </div>
                <p className="text-[10px] text-gray-400 mb-2">勾選後，問題中出現這些欄位的精確值（如料號、計畫名稱）時不啟動向量搜尋</p>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {availableCols.map(col => (
                    <label key={col} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={selected.includes(col)} onChange={() => toggle(col)}
                        className="accent-orange-500" />
                      <span className="text-xs text-gray-700 font-mono">{col}</span>
                    </label>
                  ))}
                </div>
                {selected.length > 0 && (
                  <button onClick={() => onChangeSelected([])}
                    className="mt-2 text-[10px] text-gray-400 hover:text-red-400">清除全部</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Design Manager ────────────────────────────────────────────────────────────
function DesignManager({ projectId }: { projectId: number | null }) {
  const [topics, setTopics] = useState<AiSelectTopic[]>([])
  const [schemas, setSchemas] = useState<AiSchemaDef[]>([])
  const [allJoins, setAllJoins] = useState<AiSchemaJoin[]>([])
  const [editDesign, setEditDesign] = useState<AiSelectDesign | null>(null)
  const [showDesignForm, setShowDesignForm] = useState(false)
  const [designTrans, setDesignTrans] = useState<TranslationData>({})
  const [designTranslating, setDesignTranslating] = useState(false)
  const [topicTrans, setTopicTrans] = useState<TranslationData>({})
  const [topicTranslating, setTopicTranslating] = useState(false)
  const [designForm, setDesignForm] = useState({
    topic_id: '', name: '', description: '', system_prompt: '', few_shot_examples: '[]',
    chart_config: '', cache_ttl_minutes: '30', is_public: false, vector_search_enabled: false,
    vector_top_k: '10', vector_similarity_threshold: '0.50',
    vector_skip_fields: [] as string[],
    target_schema_ids: [] as number[], target_join_ids: [] as number[],
    schema_where_only_ids: [] as number[],
    max_rows: '1000',
  })
  const [editTopicId, setEditTopicId] = useState<number | null>(null)
  const [topicForm, setTopicForm] = useState({ name: '', description: '', icon: '', sort_order: '0', form_project_id: undefined as number | undefined })
  const [loading, setLoading] = useState(false)
  const topicFormRef = useRef<HTMLDivElement>(null)
  const iconInputRef = useRef<HTMLInputElement>(null)
  const [projects, setProjects] = useState<AiSelectProject[]>([])

  // Share & copy modals
  const [shareDesign, setShareDesign] = useState<AiSelectDesign | null>(null)
  const [copyTopic, setCopyTopic] = useState<AiSelectTopic | null>(null)

  const load = () => {
    const qs = projectId ? `?project_id=${projectId}` : ''
    api.get(`/dashboard/designer/topics${qs}`).then(r => setTopics(r.data)).catch(() => {})
    api.get(`/dashboard/designer/schemas${qs}`).then(r => setSchemas(r.data)).catch(() => {})
    api.get(`/dashboard/designer/joins${qs}`).then(r => setAllJoins(r.data)).catch(() => {})
  }
  useEffect(() => {
    load()
    api.get('/dashboard/projects').then(r => setProjects(r.data)).catch(() => {})
  }, [projectId])

  const saveTopic = async () => {
    setTopicTranslating(true)
    try {
      const { form_project_id, ...rest } = topicForm
      const payload = { ...rest, project_id: form_project_id ?? projectId ?? undefined, ...topicTrans }
      if (editTopicId) {
        await api.put(`/dashboard/designer/topics/${editTopicId}`, payload)
        setEditTopicId(null)
      } else {
        const res = await api.post('/dashboard/designer/topics', payload)
        setTopicTrans({
          name_zh: res.data.name_zh || null, name_en: res.data.name_en || null, name_vi: res.data.name_vi || null,
          desc_zh: res.data.desc_zh || null, desc_en: res.data.desc_en || null, desc_vi: res.data.desc_vi || null,
        })
      }
      setTopicForm({ name: '', description: '', icon: '', sort_order: '0', form_project_id: projectId || undefined })
      setTopicTrans({})
      load()
    } finally {
      setTopicTranslating(false)
    }
  }

  const startEditTopic = (t: AiSelectTopic) => {
    setEditTopicId(t.id)
    setTopicForm({ name: t.name, description: t.description || '', icon: t.icon || '', sort_order: String(t.sort_order ?? 0), form_project_id: t.project_id ?? projectId ?? undefined })
    setTopicTrans({
      name_zh: (t as any).name_zh || null, name_en: (t as any).name_en || null, name_vi: (t as any).name_vi || null,
      desc_zh: (t as any).desc_zh || null, desc_en: (t as any).desc_en || null, desc_vi: (t as any).desc_vi || null,
    })
    setTimeout(() => topicFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const delTopic = async (id: number) => {
    if (!confirm('刪除主題會一併刪除其下所有任務')) return
    await api.delete(`/dashboard/designer/topics/${id}`)
    load()
  }

  const suspendTopic = async (id: number, suspended: boolean) => {
    await api.patch(`/dashboard/topics/${id}/suspend`, { suspended })
    load()
  }

  const suspendDesign = async (id: number, suspended: boolean) => {
    await api.patch(`/dashboard/designs/${id}/suspend`, { suspended })
    load()
  }

  const uploadIcon = async (topicId: number, file: File) => {
    const fd = new FormData()
    fd.append('icon', file)
    try {
      await api.post(`/dashboard/topics/${topicId}/icon`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      load()
    } catch (e: any) { alert(e?.response?.data?.error || '上傳失敗') }
  }

  const toggleSchemaId = (id: number) => {
    setDesignForm(p => {
      const removing = p.target_schema_ids.includes(id)
      return {
        ...p,
        target_schema_ids: removing
          ? p.target_schema_ids.filter(x => x !== id)
          : [...p.target_schema_ids, id],
        // 取消 schema 時同時移除涉及該 schema 的 join 及 where_only 設定
        target_join_ids: removing
          ? p.target_join_ids.filter(jid => {
              const j = allJoins.find(j => j.id === jid)
              return j && j.left_schema_id !== id && j.right_schema_id !== id
            })
          : p.target_join_ids,
        schema_where_only_ids: removing
          ? p.schema_where_only_ids.filter(x => x !== id)
          : p.schema_where_only_ids,
      }
    })
  }

  const toggleJoinId = (id: number) => {
    setDesignForm(p => ({
      ...p,
      target_join_ids: p.target_join_ids.includes(id)
        ? p.target_join_ids.filter(x => x !== id)
        : [...p.target_join_ids, id]
    }))
  }

  const toggleSchemaWhereOnly = (id: number) => {
    setDesignForm(p => ({
      ...p,
      schema_where_only_ids: p.schema_where_only_ids.includes(id)
        ? p.schema_where_only_ids.filter(x => x !== id)
        : [...p.schema_where_only_ids, id]
    }))
  }

  const saveDesign = async () => {
    setLoading(true)
    setDesignTranslating(true)
    try {
      const payload = {
        ...designForm,
        topic_id: Number(designForm.topic_id),
        cache_ttl_minutes: Number(designForm.cache_ttl_minutes),
        max_rows: Number(designForm.max_rows) || 1000,
        vector_top_k: Number(designForm.vector_top_k) || 10,
        vector_similarity_threshold: designForm.vector_similarity_threshold || '0.50',
        vector_skip_fields: JSON.stringify(designForm.vector_skip_fields),
        target_schema_ids: designForm.target_schema_ids,
        target_join_ids: designForm.target_join_ids,
        schema_where_only_ids: designForm.schema_where_only_ids,
        ...designTrans,
      }
      if (editDesign) {
        await api.put(`/dashboard/designer/designs/${editDesign.id}`, payload)
      } else {
        const res = await api.post('/dashboard/designer/designs', payload)
        setDesignTrans({
          name_zh: res.data.name_zh || null, name_en: res.data.name_en || null, name_vi: res.data.name_vi || null,
          desc_zh: res.data.desc_zh || null, desc_en: res.data.desc_en || null, desc_vi: res.data.desc_vi || null,
        })
      }
      setShowDesignForm(false)
      setEditDesign(null)
      load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '儲存失敗')
    } finally {
      setLoading(false)
      setDesignTranslating(false)
    }
  }

  const resetDesignForm = (topicId = '') => ({
    topic_id: topicId, name: '', description: '', system_prompt: '', few_shot_examples: '[]',
    chart_config: '', cache_ttl_minutes: '30', is_public: false, vector_search_enabled: false,
    vector_top_k: '10', vector_similarity_threshold: '0.50',
    vector_skip_fields: [] as string[],
    target_schema_ids: [] as number[], target_join_ids: [] as number[],
    schema_where_only_ids: [] as number[],
    max_rows: '1000',
  })

  return (
    <div className="space-y-4">
      {/* Modals */}
      {shareDesign && <ShareModal design={shareDesign} onClose={() => setShareDesign(null)} />}
      {copyTopic && <CopyTopicModal topic={copyTopic} onClose={() => setCopyTopic(null)} onDone={load} />}

      {/* 新增/編輯主題 */}
      <div ref={topicFormRef} className="bg-gray-100 rounded-xl p-4 space-y-2">
        <p className="text-xs text-gray-500 font-medium">{editTopicId ? '編輯主題' : '新增主題'}</p>
        <div className="grid grid-cols-3 gap-2">
          <input className="input py-1.5 text-sm col-span-2" placeholder="主題名稱 *"
            value={topicForm.name} onChange={e => setTopicForm(p => ({ ...p, name: e.target.value }))} />
          <input className="input py-1.5 text-sm" placeholder="icon (e.g. bar-chart-2)"
            value={topicForm.icon} onChange={e => setTopicForm(p => ({ ...p, icon: e.target.value }))} />
          <input className="input py-1.5 text-sm col-span-2" placeholder="說明"
            value={topicForm.description} onChange={e => setTopicForm(p => ({ ...p, description: e.target.value }))} />
          <div className="relative">
            <input className="input py-1.5 text-sm w-full" placeholder="排序" type="number"
              value={topicForm.sort_order} onChange={e => setTopicForm(p => ({ ...p, sort_order: e.target.value }))} />
            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none">越小越前</span>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-400 mb-1 block">所屬專案</label>
            <select className="input py-1.5 text-sm" value={topicForm.form_project_id ?? ''}
              onChange={e => setTopicForm(p => ({ ...p, form_project_id: e.target.value ? Number(e.target.value) : undefined }))}>
              <option value="">— 未分配 —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        {/* 多語言翻譯 */}
        <TranslationFields
          data={topicTrans}
          onChange={setTopicTrans}
          translateUrl={editTopicId ? `/dashboard/designer/topics/${editTopicId}/translate` : undefined}
          hasDescription
          translating={topicTranslating}
        />
        {/* Icon upload (only in edit mode after topic created) */}
        {editTopicId && (
          <div className="flex items-center gap-2">
            <input ref={iconInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { if (e.target.files?.[0]) uploadIcon(editTopicId, e.target.files[0]) }} />
            <button onClick={() => iconInputRef.current?.click()}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-500 border border-gray-200 rounded-lg px-2 py-1">
              <Upload size={11} /> 上傳圖示圖片
            </button>
            <span className="text-xs text-gray-400">（2MB 以內圖片，儲存後顯示於主題卡片）</span>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={saveTopic} disabled={!topicForm.name}
            className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
            <Plus size={12} /> {editTopicId ? '儲存主題' : '新增主題'}
          </button>
          {editTopicId && (
            <button onClick={() => { setEditTopicId(null); setTopicForm({ name: '', description: '', icon: '', sort_order: '0', form_project_id: projectId || undefined }); setTopicTrans({}) }}
              className="text-xs text-gray-500 hover:text-gray-800 px-2">取消</button>
          )}
        </div>
      </div>

      {/* 主題清單 */}
      {topics.map(t => (
        <div key={t.id} className="bg-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200">
            <div className="flex items-center gap-2">
              {t.icon_url && <img src={t.icon_url} alt="" className="w-5 h-5 rounded object-cover" />}
              <span className={`text-sm font-medium ${t.is_suspended ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.name}</span>
              {t.is_suspended === 1 && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">已暫停</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => { setDesignForm(resetDesignForm(String(t.id))); setEditDesign(null); setDesignTrans({}); setShowDesignForm(true) }}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                <Plus size={11} /> 新增任務
              </button>
              <button onClick={() => startEditTopic(t)}
                className="text-xs text-gray-500 hover:text-blue-400">編輯</button>
              <button onClick={() => setCopyTopic(t)} title="複製主題"
                className="text-gray-400 hover:text-blue-400 p-0.5"><Copy size={12} /></button>
              <button onClick={() => suspendTopic(t.id, !t.is_suspended)} title={t.is_suspended ? '恢復' : '暫停'}
                className={`p-0.5 ${t.is_suspended ? 'text-orange-400 hover:text-green-400' : 'text-gray-400 hover:text-orange-400'}`}>
                {t.is_suspended ? <Play size={12} /> : <Pause size={12} />}
              </button>
              <button onClick={() => delTopic(t.id)} className="text-gray-400 hover:text-red-400 p-0.5"><Trash2 size={12} /></button>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {(t.designs || []).map(d => (
              <div key={d.id} className={`flex items-center justify-between px-6 py-2 ${d.is_suspended ? 'opacity-50' : ''}`}>
                <div>
                  <span className={`text-xs ${d.is_suspended ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{d.name}</span>
                  {d.is_suspended === 1 && <span className="ml-1 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">已暫停</span>}
                  {d.vector_search_enabled === 1 && <span className="ml-2 text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">語意</span>}
                  {d.is_public === 1 && <span className="ml-1 text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded">公開</span>}
                  {(() => {
                    const ids: number[] = d.target_schema_ids ? (typeof d.target_schema_ids === 'string' ? JSON.parse(d.target_schema_ids) : d.target_schema_ids) : []
                    return ids.length > 0 ? (
                      <span className="ml-1 text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded">
                        {ids.length} schema
                      </span>
                    ) : null
                  })()}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setShareDesign(d)} title="分享設定"
                    className="text-gray-400 hover:text-blue-400 p-0.5"><Share2 size={12} /></button>
                  <button onClick={() => suspendDesign(d.id, !d.is_suspended)} title={d.is_suspended ? '恢復' : '暫停'}
                    className={`p-0.5 ${d.is_suspended ? 'text-orange-400 hover:text-green-400' : 'text-gray-400 hover:text-orange-400'}`}>
                    {d.is_suspended ? <Play size={12} /> : <Pause size={12} />}
                  </button>
                  <button onClick={async () => {
                    try {
                      const r = await api.get(`/dashboard/designer/designs/${d.id}`)
                      const full = r.data
                      const sids: number[] = full.target_schema_ids
                        ? (typeof full.target_schema_ids === 'string' ? JSON.parse(full.target_schema_ids) : full.target_schema_ids)
                        : []
                      const jids: number[] = full.target_join_ids
                        ? (typeof full.target_join_ids === 'string' ? JSON.parse(full.target_join_ids) : full.target_join_ids)
                        : []
                      setEditDesign(full)
                      setDesignForm({
                        topic_id: String(full.topic_id), name: full.name, description: full.description || '',
                        system_prompt: full.system_prompt || '', few_shot_examples: full.few_shot_examples || '[]',
                        chart_config: full.chart_config || '', cache_ttl_minutes: String(full.cache_ttl_minutes ?? 30),
                        is_public: full.is_public === 1, vector_search_enabled: full.vector_search_enabled === 1,
                        vector_top_k: String(full.vector_top_k ?? 10),
                        vector_similarity_threshold: String(full.vector_similarity_threshold ?? '0.50'),
                        max_rows: String(full.max_rows ?? full.MAX_ROWS ?? 1000),
                        vector_skip_fields: full.vector_skip_fields
                          ? (typeof full.vector_skip_fields === 'string' ? JSON.parse(full.vector_skip_fields) : full.vector_skip_fields)
                          : [],
                        target_schema_ids: sids, target_join_ids: jids,
                        schema_where_only_ids: full.schema_where_only_ids
                          ? (typeof full.schema_where_only_ids === 'string' ? JSON.parse(full.schema_where_only_ids) : full.schema_where_only_ids)
                          : [],
                      })
                      setDesignTrans({
                        name_zh: (full as any).name_zh || null, name_en: (full as any).name_en || null, name_vi: (full as any).name_vi || null,
                        desc_zh: (full as any).desc_zh || null, desc_en: (full as any).desc_en || null, desc_vi: (full as any).desc_vi || null,
                      })
                      setShowDesignForm(true)
                    } catch { alert('載入失敗') }
                  }} className="text-xs text-gray-500 hover:text-blue-400">編輯</button>
                  <button onClick={async () => { if (confirm('刪除此任務？')) { await api.delete(`/dashboard/designer/designs/${d.id}`); load() } }}
                    className="text-gray-400 hover:text-red-400 p-0.5"><Trash2 size={11} /></button>
                </div>
              </div>
            ))}
            {(t.designs || []).length === 0 && (
              <p className="text-xs text-gray-400 px-6 py-2">尚無任務</p>
            )}
          </div>
        </div>
      ))}

      {/* 任務表單 Modal */}
      {showDesignForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-100 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <p className="text-sm font-medium text-gray-800">{editDesign ? '編輯任務' : '新增任務'}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">任務名稱 *</label>
                <input className="input py-1.5 text-sm" value={designForm.name}
                  onChange={e => setDesignForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">說明</label>
                <input className="input py-1.5 text-sm" value={designForm.description}
                  onChange={e => setDesignForm(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <TranslationFields
                  data={designTrans}
                  onChange={setDesignTrans}
                  translateUrl={editDesign ? `/dashboard/designer/designs/${editDesign.id}/translate` : undefined}
                  hasDescription
                  translating={designTranslating}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">快取時間（分鐘）</label>
                  <input className="input py-1.5 text-sm" type="number" value={designForm.cache_ttl_minutes}
                    onChange={e => setDesignForm(p => ({ ...p, cache_ttl_minutes: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">最大回傳筆數</label>
                  <input className="input py-1.5 text-sm" type="number" min={1} max={100000}
                    value={designForm.max_rows}
                    onChange={e => setDesignForm(p => ({ ...p, max_rows: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={designForm.is_public}
                    onChange={e => setDesignForm(p => ({ ...p, is_public: e.target.checked }))} />
                  公開
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={designForm.vector_search_enabled}
                    onChange={e => setDesignForm(p => ({ ...p, vector_search_enabled: e.target.checked }))} />
                  啟用語意搜尋
                </label>
              </div>
              {designForm.vector_search_enabled && <VectorSkipFieldsPicker
                schemas={schemas}
                targetSchemaIds={designForm.target_schema_ids}
                selected={designForm.vector_skip_fields}
                onChangeSelected={fields => setDesignForm(p => ({ ...p, vector_skip_fields: fields }))}
                topK={designForm.vector_top_k}
                onChangeTopK={v => setDesignForm(p => ({ ...p, vector_top_k: v }))}
                threshold={designForm.vector_similarity_threshold}
                onChangeThreshold={v => setDesignForm(p => ({ ...p, vector_similarity_threshold: v }))}
              />}
            </div>

            {/* Schema 選擇 */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                關聯 Schema（AI 查詢時會注入這些表的欄位定義）
              </label>
              {schemas.length === 0 ? (
                <p className="text-xs text-gray-400 bg-white rounded-lg px-3 py-2">尚無 Schema，請先至 Schema 知識庫匯入</p>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {schemas.map(s => {
                    const isSelected = designForm.target_schema_ids.includes(s.id)
                    const isWhereOnly = designForm.schema_where_only_ids.includes(s.id)
                    return (
                      <div key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50">
                        <input type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSchemaId(s.id)} />
                        {s.alias && <span className="text-xs font-mono text-purple-600">{s.alias}</span>}
                        <span className="text-xs text-gray-700 font-medium flex-1 truncate">{s.display_name || s.table_name}</span>
                        <span className="text-xs text-gray-400 truncate max-w-[100px] font-mono">{s.table_name}</span>
                        {isSelected && (
                          <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer" title="僅作 WHERE 篩選，不出現在欄位選擇器">
                            <input type="checkbox" checked={isWhereOnly}
                              onChange={() => toggleSchemaWhereOnly(s.id)} />
                            <span className={`text-xs ${isWhereOnly ? 'text-orange-500 font-medium' : 'text-gray-400'}`}>僅WHERE</span>
                          </label>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${s.db_connection === 'erp' ? 'bg-blue-100 text-blue-500' : 'bg-gray-200 text-gray-500'}`}>
                          {s.db_connection}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {designForm.target_schema_ids.length > 0 && (
                <p className="text-xs text-blue-500 mt-1">已選 {designForm.target_schema_ids.length} 個 Schema</p>
              )}
            </div>

            {/* Join 選擇（只顯示涉及已選 Schema 的 Join） */}
            {(() => {
              const relatedJoins = allJoins.filter((j: any) =>
                designForm.target_schema_ids.includes(j.left_schema_id) &&
                designForm.target_schema_ids.includes(j.right_schema_id)
              )
              if (designForm.target_schema_ids.length < 2 || relatedJoins.length === 0) return null
              return (
                <div>
                  <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
                    <Link2 size={11} /> 啟用 Join（自動生成 FROM ... JOIN 子句）
                  </label>
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {relatedJoins.map((j: any) => {
                      let conds: any[] = []
                      try { conds = typeof j.conditions_json === 'string' ? JSON.parse(j.conditions_json) : j.conditions_json } catch {}
                      return (
                        <label key={j.id} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                          <input type="checkbox" className="mt-0.5"
                            checked={designForm.target_join_ids.includes(j.id)}
                            onChange={() => toggleJoinId(j.id)} />
                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 font-medium">{j.name}</p>
                            <p className="text-xs text-gray-400 font-mono">
                              {j.join_type} JOIN {j.right_alias || j.right_table} ON {conds.map(c => `${c.left} ${c.op} ${c.right}`).join(' AND ') || '...'}
                            </p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                  {designForm.target_join_ids.length > 0 && (
                    <p className="text-xs text-green-500 mt-1">已啟用 {designForm.target_join_ids.length} 個 Join</p>
                  )}
                </div>
              )
            })()}

            <div>
              <label className="text-xs text-gray-400 mb-1 block">System Prompt（SQL 生成指令）</label>
              <textarea className="input py-1.5 text-sm font-mono resize-none" rows={6}
                value={designForm.system_prompt}
                onChange={e => setDesignForm(p => ({ ...p, system_prompt: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Few-shot 範例（JSON）</label>
              <textarea className="input py-1.5 text-sm font-mono resize-none" rows={4}
                placeholder='[{"q":"計畫異常數量","sql":"SELECT COUNT(*) FROM ..."}]'
                value={designForm.few_shot_examples}
                onChange={e => setDesignForm(p => ({ ...p, few_shot_examples: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">圖表設定</label>
              {(() => {
                const selSchemas = schemas.filter(s => designForm.target_schema_ids.includes(s.id!))
                const colOpts = selSchemas.flatMap(s => {
                  const alias = s.alias || s.table_name.split('.').pop()!.toLowerCase()
                  return ((s as any).columns || []).map((c: any) => ({
                    value: `${alias}.${c.column_name}`,
                    label: `${alias}.${c.column_name}${c.description ? ' — ' + c.description : ''}`
                  }))
                })
                return (
                  <ChartConfigEditor
                    key={editDesign?.id ?? 'new'}
                    value={designForm.chart_config}
                    onChange={v => setDesignForm(p => ({ ...p, chart_config: v }))}
                    colOptions={colOpts}
                  />
                )
              })()}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={saveDesign} disabled={loading || !designForm.name}
                className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1">
                <Save size={12} /> {loading ? '儲存中...' : '儲存'}
              </button>
              <button onClick={() => { setShowDesignForm(false); setEditDesign(null) }}
                className="text-xs text-gray-500 hover:text-gray-800 px-3">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Chart Config Visual Editor ────────────────────────────────────────────────
const CHART_TYPES_DEF = [
  { value: 'bar',     label: '長條圖' },
  { value: 'line',    label: '折線圖' },
  { value: 'pie',     label: '圓餅圖' },
  { value: 'scatter', label: '散佈圖' },
  { value: 'radar',   label: '雷達圖' },
  { value: 'gauge',   label: '儀表板' },
] as const

type ChartTypeName = typeof CHART_TYPES_DEF[number]['value']

interface LocalChartDef {
  type: ChartTypeName
  title?: string
  x_field?: string; y_field?: string
  label_field?: string; value_field?: string
  horizontal?: boolean; smooth?: boolean; area?: boolean
  gradient?: boolean; donut?: boolean; show_label?: boolean
}

interface LocalChartConfig {
  default_chart: ChartTypeName
  allow_table?: boolean
  allow_export?: boolean
  charts: LocalChartDef[]
}

function parseChartCfg(v: string): LocalChartConfig {
  try { const p = JSON.parse(v); if (p?.charts) return p } catch {}
  return { default_chart: 'bar', charts: [] }
}

function ChartConfigEditor({ value, onChange, colOptions }: {
  value: string
  onChange: (v: string) => void
  colOptions: { value: string; label: string }[]
}) {
  const [cfg, setCfg] = useState<LocalChartConfig>(() => parseChartCfg(value))

  const emit = (c: LocalChartConfig) => { setCfg(c); onChange(JSON.stringify(c)) }
  const upd  = (i: number, patch: Partial<LocalChartDef>) =>
    emit({ ...cfg, charts: cfg.charts.map((c, j) => j === i ? { ...c, ...patch } : c) })
  const rmv  = (i: number) => emit({ ...cfg, charts: cfg.charts.filter((_, j) => j !== i) })
  const add  = () => emit({ ...cfg, charts: [...cfg.charts, { type: 'bar' }] })

  const TypePill = ({ selected, onSelect }: { selected: ChartTypeName; onSelect: (t: ChartTypeName) => void }) => (
    <div className="flex gap-1 flex-wrap">
      {CHART_TYPES_DEF.map(ct => (
        <button key={ct.value} type="button" onClick={() => onSelect(ct.value)}
          className={`text-xs px-2.5 py-0.5 rounded-full transition ${
            selected === ct.value ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}>
          {ct.label}
        </button>
      ))}
    </div>
  )

  const ColSel = ({ lbl, val, onCh }: { lbl: string; val?: string; onCh: (v: string) => void }) => (
    <div>
      <p className="text-[10px] text-gray-400 mb-0.5">{lbl}</p>
      <select className="input py-1 text-xs w-full" value={val || ''} onChange={e => onCh(e.target.value)}>
        <option value="">-- 選擇欄位 --</option>
        {colOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )

  const Tog = ({ lbl, val, onCh }: { lbl: string; val?: boolean; onCh: (v: boolean) => void }) => (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input type="checkbox" className="w-3 h-3 accent-blue-500" checked={!!val} onChange={e => onCh(e.target.checked)} />
      <span className="text-xs text-gray-500">{lbl}</span>
    </label>
  )

  return (
    <div className="space-y-3">
      {/* 全局設定 */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-gray-500 flex-shrink-0">預設顯示</span>
          <TypePill selected={cfg.default_chart} onSelect={t => emit({ ...cfg, default_chart: t })} />
        </div>
        <div className="flex gap-4 pt-0.5">
          <Tog lbl="允許切換表格" val={cfg.allow_table}  onCh={v => emit({ ...cfg, allow_table: v })} />
          <Tog lbl="允許匯出 CSV" val={cfg.allow_export} onCh={v => emit({ ...cfg, allow_export: v })} />
        </div>
      </div>

      {/* 各圖表卡片 */}
      {cfg.charts.map((ch, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2.5">
          {/* 標題列 */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400 font-semibold flex-shrink-0">圖 {i + 1}</span>
            <div className="flex-1">
              <TypePill selected={ch.type} onSelect={t => upd(i, { type: t })} />
            </div>
            <button type="button" onClick={() => rmv(i)}
              className="flex-shrink-0 p-1 rounded text-red-400 hover:bg-red-50 hover:text-red-600 transition">
              <Trash2 size={13} />
            </button>
          </div>

          {/* 標題輸入 */}
          <div>
            <p className="text-[10px] text-gray-400 mb-0.5">圖表標題（選填）</p>
            <input className="input py-1 text-xs w-full" placeholder="不填則自動命名"
              value={ch.title || ''} onChange={e => upd(i, { title: e.target.value })} />
          </div>

          {/* 欄位對應 */}
          {(ch.type === 'bar' || ch.type === 'line' || ch.type === 'scatter') && (
            <div className="grid grid-cols-2 gap-2">
              <ColSel lbl="X 軸（類別/時間）" val={ch.x_field}  onCh={v => upd(i, { x_field: v })} />
              <ColSel lbl="Y 軸（數值）"       val={ch.y_field}  onCh={v => upd(i, { y_field: v })} />
            </div>
          )}
          {ch.type === 'pie' && (
            <div className="grid grid-cols-2 gap-2">
              <ColSel lbl="標籤欄位" val={ch.label_field}  onCh={v => upd(i, { label_field: v })} />
              <ColSel lbl="數值欄位" val={ch.value_field}  onCh={v => upd(i, { value_field: v })} />
            </div>
          )}
          {ch.type === 'gauge' && (
            <ColSel lbl="數值欄位" val={ch.value_field} onCh={v => upd(i, { value_field: v })} />
          )}

          {/* 視覺選項 */}
          <div className="flex gap-4 flex-wrap pt-1.5 border-t border-gray-100">
            {ch.type === 'bar' && <>
              <Tog lbl="水平排列"     val={ch.horizontal}  onCh={v => upd(i, { horizontal: v })} />
              <Tog lbl="漸層色"       val={ch.gradient}    onCh={v => upd(i, { gradient: v })} />
              <Tog lbl="顯示數值標籤" val={ch.show_label}  onCh={v => upd(i, { show_label: v })} />
            </>}
            {ch.type === 'line' && <>
              <Tog lbl="平滑曲線"     val={ch.smooth}      onCh={v => upd(i, { smooth: v })} />
              <Tog lbl="填滿區域"     val={ch.area}        onCh={v => upd(i, { area: v })} />
              <Tog lbl="漸層色"       val={ch.gradient}    onCh={v => upd(i, { gradient: v })} />
              <Tog lbl="顯示數值標籤" val={ch.show_label}  onCh={v => upd(i, { show_label: v })} />
            </>}
            {ch.type === 'pie' && <>
              <Tog lbl="環狀圖"       val={ch.donut}       onCh={v => upd(i, { donut: v })} />
              <Tog lbl="顯示數值標籤" val={ch.show_label}  onCh={v => upd(i, { show_label: v })} />
            </>}
          </div>

          {/* JSON preview */}
          <p className="text-[10px] font-mono text-gray-300 truncate">{JSON.stringify(ch)}</p>
        </div>
      ))}

      <button type="button" onClick={add}
        className="w-full py-2 rounded-lg border-2 border-dashed border-gray-200 text-xs text-gray-400 hover:border-blue-300 hover:text-blue-400 transition flex items-center justify-center gap-1">
        <Plus size={12} /> 新增圖表
      </button>
    </div>
  )
}

// ── ETL Manager ───────────────────────────────────────────────────────────────
// ── Schedule Builder ─────────────────────────────────────────────────────────
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const SCHEDULE_TYPES = [
  { value: 'hourly',  label: '每N小時' },
  { value: 'daily',   label: '每天' },
  { value: 'weekly',  label: '每週' },
  { value: 'monthly', label: '每月' },
  { value: 'cron',    label: '自訂 Cron' },
]

function scheduleToCronPreview(type: string, cfg: Record<string, any>): string {
  const h = cfg.hour ?? 2
  const m = cfg.minute ?? 0
  switch (type) {
    case 'hourly':  return `${m} */${Math.max(1, cfg.interval_hours || 1)} * * *`
    case 'daily':   return `${m} ${h} * * *`
    case 'weekly':  return `${m} ${h} * * ${(cfg.weekdays?.length ? cfg.weekdays : [1]).join(',')}`
    case 'monthly': return `${m} ${h} ${cfg.monthday || 1} * *`
    default:        return cfg.cron_expression || ''
  }
}

function ScheduleBuilder({
  scheduleType, scheduleConfig, onChange
}: {
  scheduleType: string
  scheduleConfig: Record<string, any>
  onChange: (type: string, cfg: Record<string, any>) => void
}) {
  const setType = (t: string) => onChange(t, scheduleConfig)
  const setCfg = (patch: Record<string, any>) => onChange(scheduleType, { ...scheduleConfig, ...patch })
  const preview = scheduleToCronPreview(scheduleType, scheduleConfig)

  return (
    <div className="space-y-2">
      {/* type pills */}
      <div className="flex gap-1 flex-wrap">
        {SCHEDULE_TYPES.map(st => (
          <button key={st.value} type="button"
            onClick={() => setType(st.value)}
            className={`text-xs px-2 py-0.5 rounded-full border transition ${scheduleType === st.value ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-300 text-gray-500 hover:border-blue-400'}`}>
            {st.label}
          </button>
        ))}
      </div>

      {/* shared compact number input style */}
      {scheduleType !== 'cron' && (() => {
        const N = ({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) => (
          <input type="number" min={min} max={max}
            className="input py-1 text-sm text-center"
            style={{ width: '3.5rem' }}
            value={value}
            onChange={e => onChange(Number(e.target.value))} />
        )
        const TimeFields = ({ hKey = 'hour', hDef = 2 }: { hKey?: string; hDef?: number }) => (
          <>
            <N value={scheduleConfig[hKey] ?? hDef} min={0} max={23}
              onChange={v => setCfg({ [hKey]: v })} />
            <span className="text-xs text-gray-400">時</span>
            <N value={scheduleConfig.minute ?? 0} min={0} max={59}
              onChange={v => setCfg({ minute: v })} />
            <span className="text-xs text-gray-400">分</span>
          </>
        )
        return (
          <>
            {/* hourly */}
            {scheduleType === 'hourly' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400">每</span>
                <N value={scheduleConfig.interval_hours ?? 1} min={1} max={24}
                  onChange={v => setCfg({ interval_hours: v })} />
                <span className="text-xs text-gray-400">小時，於第</span>
                <N value={scheduleConfig.minute ?? 0} min={0} max={59}
                  onChange={v => setCfg({ minute: v })} />
                <span className="text-xs text-gray-400">分執行</span>
              </div>
            )}

            {/* daily */}
            {scheduleType === 'daily' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400">每天</span>
                <TimeFields />
                <span className="text-xs text-gray-400">執行</span>
              </div>
            )}

            {/* weekly */}
            {scheduleType === 'weekly' && (
              <div className="space-y-1.5">
                <div className="flex gap-1">
                  {WEEKDAY_LABELS.map((label, i) => {
                    const active = (scheduleConfig.weekdays || [1]).includes(i)
                    return (
                      <button key={i} type="button"
                        onClick={() => {
                          const cur: number[] = scheduleConfig.weekdays || [1]
                          const next = active ? cur.filter(d => d !== i) : [...cur, i].sort()
                          setCfg({ weekdays: next.length ? next : [i] })
                        }}
                        className={`w-7 h-7 text-xs rounded-full border transition ${active ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-300 text-gray-500 hover:border-blue-400'}`}>
                        {label}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-gray-400">執行時間</span>
                  <TimeFields hDef={8} />
                </div>
              </div>
            )}

            {/* monthly */}
            {scheduleType === 'monthly' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400">每月</span>
                <N value={scheduleConfig.monthday ?? 1} min={1} max={28}
                  onChange={v => setCfg({ monthday: v })} />
                <span className="text-xs text-gray-400">號</span>
                <TimeFields />
                <span className="text-xs text-gray-400">執行</span>
              </div>
            )}
          </>
        )
      })()}

      {/* cron */}
      {scheduleType === 'cron' && (
        <input className="input py-1 text-sm font-mono" placeholder="0 2 * * *"
          value={scheduleConfig.cron_expression || ''}
          onChange={e => setCfg({ cron_expression: e.target.value })} />
      )}

      {/* preview */}
      {preview && (
        <p className="text-[10px] font-mono text-blue-400 bg-blue-50 rounded px-2 py-0.5">
          cron: {preview}
        </p>
      )}
    </div>
  )
}

// ── ETL Manager ───────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  name: '', source_sql: '', source_connection: 'erp', is_incremental: true,
  job_type: 'vector' as 'vector' | 'table_copy',
  vectorize_fields: '', metadata_fields: '', embedding_dimension: '768', trigger_intent: '',
  target_table: '', target_mode: 'truncate_insert' as string, upsert_key: '', delete_sql: '',
  schedule_type: 'daily', schedule_config: { hour: 2, minute: 0 } as Record<string, any>,
  form_project_id: undefined as number | undefined,
}

// 把 DB 回傳的 JSON 字串 / 陣列 解回逗號分隔字串
function parseFieldsToStr(f: any): string {
  if (!f) return ''
  if (Array.isArray(f)) return f.join(', ')
  if (typeof f === 'string') {
    try {
      const p = JSON.parse(f)
      return Array.isArray(p) ? p.join(', ') : f
    } catch { return f }
  }
  return ''
}

function EtlManager({ projectId }: { projectId: number | null }) {
  const [jobs, setJobs] = useState<AiEtlJob[]>([])
  const [logs, setLogs] = useState<AiEtlRunLog[]>([])
  const [showLogs, setShowLogs] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [running, setRunning] = useState<number | null>(null)
  const [runProgress, setRunProgress] = useState<AiEtlRunLog | null>(null)
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<AiSelectProject[]>([])

  const loadJobs = () => {
    const url = projectId ? `/dashboard/etl/jobs?project_id=${projectId}` : '/dashboard/etl/jobs'
    api.get(url).then(r => setJobs(r.data)).catch(() => {})
  }
  useEffect(() => {
    loadJobs()
    api.get('/dashboard/projects').then(r => setProjects(r.data)).catch(() => {})
  }, [projectId])

  // 回到頁面時自動恢復執行中的 Job 狀態
  useEffect(() => {
    if (running !== null || jobs.length === 0) return
    Promise.all(
      jobs.map(j =>
        api.get(`/dashboard/etl/jobs/${j.id}/logs`)
          .then(r => ({ jobId: j.id, latest: r.data[0] as AiEtlRunLog | undefined }))
          .catch(() => null)
      )
    ).then(checks => {
      const found = checks.find(c => c?.latest?.status === 'running')
      if (found?.latest) {
        setRunning(found.jobId)
        setRunProgress(found.latest)
      }
    })
  }, [jobs])

  // 執行中輪詢進度（每 1.5 秒）
  useEffect(() => {
    if (running === null) return
    let stopped = false
    const poll = async () => {
      try {
        const r = await api.get(`/dashboard/etl/jobs/${running}/logs`)
        const latest: AiEtlRunLog = r.data[0]
        if (!latest) return
        setRunProgress(latest)
        if (latest.status !== 'running') {
          stopped = true
          // 完成後延遲 2 秒才清除，讓使用者看到最終筆數
          setTimeout(() => {
            setRunning(null)
            setRunProgress(null)
            loadJobs()
          }, 2000)
        }
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(() => { if (!stopped) poll() }, 1500)
    return () => clearInterval(id)
  }, [running])

  const openNew = () => {
    setForm({ ...EMPTY_FORM })
    setEditId(null)
    setShowForm(true)
  }

  const openEdit = (j: AiEtlJob) => {
    const schCfg = (() => {
      try { return typeof j.schedule_config === 'string' ? JSON.parse(j.schedule_config) : (j.schedule_config || { hour: 2, minute: 0 }) }
      catch { return { hour: 2, minute: 0 } }
    })()
    setForm({
      name: j.name,
      source_sql: j.source_sql || '',
      source_connection: j.source_connection || 'erp',
      is_incremental: !!j.is_incremental,
      job_type: (j.job_type || 'vector') as 'vector' | 'table_copy',
      vectorize_fields: parseFieldsToStr(j.vectorize_fields),
      metadata_fields: parseFieldsToStr(j.metadata_fields),
      embedding_dimension: String(j.embedding_dimension || 768),
      trigger_intent: j.trigger_intent || '',
      target_table: j.target_table || '',
      target_mode: j.target_mode || 'truncate_insert',
      upsert_key: j.upsert_key || '',
      delete_sql: j.delete_sql || '',
      schedule_type: j.schedule_type || 'cron',
      schedule_config: schCfg,
      form_project_id: j.project_id ?? projectId ?? undefined,
    })
    setEditId(j.id)
    setShowForm(true)
  }

  const loadLogs = async (jobId: number) => {
    const r = await api.get(`/dashboard/etl/jobs/${jobId}/logs`)
    setLogs(r.data)
    setShowLogs(jobId)
  }

  const runNow = async (jobId: number) => {
    setRunning(jobId)
    setRunProgress(null)
    try {
      await api.post(`/dashboard/etl/jobs/${jobId}/run`)
    } catch (e: any) {
      alert(e?.response?.data?.error || '執行失敗')
      setRunning(null)
    }
  }

  const cancelJob = async (jobId: number) => {
    try {
      await api.post(`/dashboard/etl/jobs/${jobId}/cancel`)
    } catch (e: any) {
      alert(e?.response?.data?.error || '取消失敗')
    }
  }

  const save = async () => {
    setLoading(true)
    try {
      const { form_project_id, ...restForm } = form
      const payload = {
        ...restForm,
        embedding_dimension: Number(form.embedding_dimension),
        vectorize_fields: form.vectorize_fields ? form.vectorize_fields.split(',').map(s => s.trim()).filter(Boolean) : [],
        metadata_fields: form.metadata_fields ? form.metadata_fields.split(',').map(s => s.trim()).filter(Boolean) : [],
        project_id: form_project_id ?? projectId ?? undefined,
      }
      if (editId) await api.put(`/dashboard/etl/jobs/${editId}`, payload)
      else await api.post('/dashboard/etl/jobs', payload)
      setShowForm(false)
      setEditId(null)
      loadJobs()
    } catch (e: any) {
      alert(e?.response?.data?.error || '儲存失敗')
    } finally {
      setLoading(false)
    }
  }

  const scheduleLabel = (j: AiEtlJob) => {
    if (!j.cron_expression) return null
    const t = SCHEDULE_TYPES.find(s => s.value === j.schedule_type)
    return `${t?.label || 'Cron'}: ${j.cron_expression}`
  }

  return (
    <div className="space-y-4">
      <button onClick={openNew}
        className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
        <Plus size={12} /> 新增 ETL Job
      </button>

      {showForm && (
        <div className="bg-gray-100 rounded-xl p-4 space-y-4 border border-gray-200">
          <p className="text-xs text-gray-500 font-semibold">{editId ? '編輯 ETL Job' : '新增 ETL Job'}</p>

          {/* 基本 */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">名稱 *</label>
                <input className="input py-1.5 text-sm" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">所屬專案</label>
                <select className="input py-1.5 text-sm" value={form.form_project_id ?? ''}
                  onChange={e => setForm(p => ({ ...p, form_project_id: e.target.value ? Number(e.target.value) : undefined }))}>
                  <option value="">— 未分配 —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            {/* Job 類型 */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Job 類型</label>
              <div className="flex gap-2">
                {([['vector', '向量化（語意搜尋）'], ['table_copy', '資料搬運（Table Copy）']] as const).map(([v, l]) => (
                  <button key={v} type="button"
                    onClick={() => setForm(p => ({ ...p, job_type: v }))}
                    className={`text-xs px-3 py-1 rounded-lg border transition ${form.job_type === v ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-300 text-gray-500 hover:border-blue-400'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                來源 SQL
                <span className="ml-1 text-gray-300">（含 :last_run 會自動傳入，不含則全撈；增量去重靠主鍵欄位判斷）</span>
              </label>
              <textarea className="input py-1.5 text-sm font-mono resize-none" rows={5}
                placeholder={'SELECT INVENTORY_ITEM_ID, ITEM_DESCRIPTION FROM FL_MRP_FG_PEGGING_SUMMARY PS\nWHERE ITEM_DESCRIPTION IS NOT NULL AND ORG_CODE=\'Z4E\''}
                value={form.source_sql}
                onChange={e => setForm(p => ({ ...p, source_sql: e.target.value }))} />
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="etl-incr" checked={form.is_incremental}
                onChange={e => setForm(p => ({ ...p, is_incremental: e.target.checked }))} />
              <label htmlFor="etl-incr" className="text-xs text-gray-500">
                增量模式（保留舊向量，依主鍵欄位跳過已向量化的資料；全量模式會清空重跑）
              </label>
            </div>
          </div>

          {/* 向量化欄位 */}
          {form.job_type === 'vector' && (
            <div className="space-y-2 border-t border-gray-200 pt-3">
              <p className="text-xs text-gray-400 font-medium">向量化設定</p>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">
                  觸發意圖描述
                  <span className="ml-1 text-gray-300">（用自然語言描述「何時該搜尋此向量庫」，未填則永遠觸發）</span>
                </label>
                <input className="input py-1.5 text-sm w-full" placeholder="例：用戶想透過品名/描述搜尋料號，而非只是提到料號欄位名稱"
                  value={form.trigger_intent}
                  onChange={e => setForm(p => ({ ...p, trigger_intent: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">向量化欄位（逗號分隔）</label>
                  <input className="input py-1.5 text-sm" placeholder="DESCRIPTION"
                    value={form.vectorize_fields}
                    onChange={e => setForm(p => ({ ...p, vectorize_fields: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Metadata 欄位</label>
                  <input className="input py-1.5 text-sm" placeholder="INVENTORY_ITEM_ID, SEGMENT1"
                    value={form.metadata_fields}
                    onChange={e => setForm(p => ({ ...p, metadata_fields: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Embedding 維度</label>
                  <select className="input py-1.5 text-sm" value={form.embedding_dimension}
                    onChange={e => setForm(p => ({ ...p, embedding_dimension: e.target.value }))}>
                    <option value="768">768 (gemini-embedding-001)</option>
                    <option value="1536">1536</option>
                    <option value="3072">3072</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">
                    主鍵欄位（逗號分隔，用於增量去重）
                    <span className="ml-1 text-gray-300">— 多欄組合可如：INVENTORY_ITEM_ID, ORGANIZATION_ID</span>
                  </label>
                  <input className="input py-1.5 text-sm font-mono" placeholder="INVENTORY_ITEM_ID（不填則取前3欄）"
                    value={form.upsert_key}
                    onChange={e => setForm(p => ({ ...p, upsert_key: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">
                    刪除 SQL（選填）
                    <span className="ml-1 text-gray-300">— 執行後以 KEY 刪除舊向量再重新 embed；可用 :last_run 參數</span>
                  </label>
                  <textarea
                    className="input py-1.5 text-sm font-mono resize-y"
                    rows={3}
                    placeholder={'SELECT INVENTORY_ITEM_ID FROM FL_MRP_FG_PEGGING_SUMMARY\nWHERE LAST_UPDATE_DATE > :last_run'}
                    value={form.delete_sql}
                    onChange={e => setForm(p => ({ ...p, delete_sql: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 資料搬運欄位 */}
          {form.job_type === 'table_copy' && (
            <div className="space-y-2 border-t border-gray-200 pt-3">
              <p className="text-xs text-gray-400 font-medium">目標設定</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">目標 Table 名稱 *</label>
                  <input className="input py-1.5 text-sm font-mono" placeholder="MY_SCHEMA.TARGET_TABLE"
                    value={form.target_table}
                    onChange={e => setForm(p => ({ ...p, target_table: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">寫入模式</label>
                  <select className="input py-1.5 text-sm" value={form.target_mode}
                    onChange={e => setForm(p => ({ ...p, target_mode: e.target.value }))}>
                    <option value="truncate_insert">Truncate + Insert（全量覆蓋）</option>
                    <option value="append">Append（只新增）</option>
                    <option value="upsert">Upsert（有 KEY 合併）</option>
                  </select>
                </div>
                {form.target_mode === 'upsert' && (
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Upsert Key 欄位（逗號分隔）</label>
                    <input className="input py-1.5 text-sm font-mono" placeholder="INVENTORY_ITEM_ID"
                      value={form.upsert_key}
                      onChange={e => setForm(p => ({ ...p, upsert_key: e.target.value }))} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 排程 */}
          <div className="border-t border-gray-200 pt-3 space-y-2">
            <p className="text-xs text-gray-400 font-medium">排程設定</p>
            <ScheduleBuilder
              scheduleType={form.schedule_type}
              scheduleConfig={form.schedule_config}
              onChange={(type, cfg) => setForm(p => ({ ...p, schedule_type: type, schedule_config: cfg }))}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={loading || !form.name || !form.source_sql || (form.job_type === 'table_copy' && !form.target_table)}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
              <Save size={12} /> {loading ? '儲存中...' : '儲存'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-gray-500 hover:text-gray-800 px-2">取消</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {jobs.map(j => (
          <div key={j.id} className="bg-gray-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-800 font-medium">{j.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${j.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-400'}`}>{j.status}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${j.job_type === 'table_copy' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                  {j.job_type === 'table_copy' ? '資料搬運' : '向量化'}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {running !== null && Number(running) === Number(j.id) ? (
                  /* 執行中：進度動畫 + 停止按鈕 */
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => cancelJob(j.id)}
                      title="停止執行"
                      className="text-red-400 hover:text-red-600 transition flex-shrink-0"
                    >
                      <Square size={11} fill="currentColor" />
                    </button>
                    <RefreshCw size={11} className="animate-spin text-blue-400 flex-shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs text-blue-500 font-medium whitespace-nowrap">
                        {(runProgress?.rows_fetched ?? 0) === 0
                          ? (runProgress?.status_message || '撈取中...')
                          : `${runProgress?.rows_vectorized ?? 0} / ${runProgress?.rows_fetched} 筆`}
                      </span>
                      {runProgress?.status_message && (runProgress?.rows_fetched ?? 0) > 0 && (
                        <span className="text-[10px] text-gray-400 truncate max-w-[160px]">{runProgress.status_message}</span>
                      )}
                    </div>
                    {(runProgress?.rows_fetched ?? 0) > 0 && (
                      <div className="w-20 bg-gray-200 rounded-full h-1.5 flex-shrink-0">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${Math.round(((runProgress?.rows_vectorized ?? 0) / (runProgress?.rows_fetched ?? 1)) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <button onClick={() => openEdit(j)} className="text-gray-400 hover:text-gray-700 transition">
                      <Edit3 size={12} />
                    </button>
                    <button onClick={() => runNow(j.id)}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-600 transition">
                      <Play size={12} /> 執行
                    </button>
                  </>
                )}
                <button onClick={() => loadLogs(j.id)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700">
                  <Eye size={12} /> 紀錄
                </button>
                <button onClick={async () => { if (confirm('刪除此 ETL Job？')) { await api.delete(`/dashboard/etl/jobs/${j.id}`); loadJobs() } }}
                  className="text-gray-300 hover:text-red-400"><Trash2 size={12} /></button>
              </div>
            </div>
            <div className="text-xs text-gray-400 flex gap-3 flex-wrap">
              {scheduleLabel(j) && <span className="font-mono text-blue-400">{scheduleLabel(j)}</span>}
              <span>執行 {j.run_count ?? 0} 次</span>
              {j.last_run_at && <span>上次：{new Date(j.last_run_at).toLocaleString('zh-TW')}</span>}
              {j.job_type !== 'table_copy' && <span>維度：{j.embedding_dimension}</span>}
              {j.job_type !== 'table_copy' && j.upsert_key && <span className="text-teal-500">PK：{j.upsert_key}</span>}
              {j.job_type === 'table_copy' && j.target_table && <span>→ {j.target_table} ({j.target_mode})</span>}
              {j.is_incremental ? <span className="text-teal-500">增量</span> : <span className="text-amber-500">全量</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Logs Modal */}
      {showLogs !== null && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-100 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <p className="text-sm font-medium text-gray-800">執行紀錄</p>
              <button onClick={() => setShowLogs(null)} className="text-gray-500 hover:text-gray-800">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {logs.map(l => (
                <div key={l.id} className={`rounded-lg p-3 text-xs ${l.status === 'success' ? 'bg-green-50 border border-green-200' : l.status === 'failed' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <div className="flex justify-between mb-1">
                    <span className={`font-medium ${l.status === 'success' ? 'text-green-600' : l.status === 'failed' ? 'text-red-500' : 'text-yellow-600'}`}>{l.status}</span>
                    <span className="text-gray-400">{l.started_at ? new Date(l.started_at).toLocaleString('zh-TW') : '-'}</span>
                  </div>
                  <div className="text-gray-500 flex gap-3 flex-wrap">
                    <span>撈取 {l.rows_fetched ?? 0} 筆</span>
                    {(l.rows_deleted ?? 0) > 0 && <span className="text-orange-500">清除 {l.rows_deleted} 筆</span>}
                    {(l.rows_vectorized ?? 0) > 0 && <span className="text-blue-500">向量化 {l.rows_vectorized} 筆</span>}
                    {(l.rows_inserted ?? 0) > 0 && <span>寫入 {l.rows_inserted} 筆</span>}
                    {l.finished_at && l.started_at && (
                      <span>耗時 {((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  {l.status_message && <p className="text-gray-400 mt-1 text-[11px]">{l.status_message}</p>}
                  {l.error_message && <p className="text-red-400 mt-1 font-mono whitespace-pre-wrap">{l.error_message}</p>}
                </div>
              ))}
              {logs.length === 0 && <p className="text-gray-400 text-center py-4">無執行紀錄</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
