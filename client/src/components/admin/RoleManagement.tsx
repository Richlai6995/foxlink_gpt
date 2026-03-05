import { useEffect, useState } from 'react'
import { Plus, Trash2, Edit2, Star, StarOff, Plug, Zap, Check, FileText, Mic, Image, CalendarClock, Code2 } from 'lucide-react'
import api from '../../lib/api'

interface Role {
  id: number
  name: string
  description: string | null
  is_default: number
  mcp_server_ids: number[]
  dify_kb_ids: number[]
  created_at: string
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
  allow_create_skill: number
  allow_external_skill: number
  allow_code_skill: number
}

interface McpServer {
  id: number
  name: string
  description: string | null
  is_active: number
}

interface DifyKb {
  id: number
  name: string
  description: string | null
  is_active: number
}

const emptyForm = {
  name: '',
  description: '',
  is_default: false,
  mcp_server_ids: [] as number[],
  dify_kb_ids: [] as number[],
  budget_daily: '',
  budget_weekly: '',
  budget_monthly: '',
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
}

export default function RoleManagement() {
  const [roles, setRoles] = useState<Role[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [difyKbs, setDifyKbs] = useState<DifyKb[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setLoading(true)
      const [rolesRes, mcpRes, difyRes] = await Promise.all([
        api.get('/roles'),
        api.get('/mcp-servers'),
        api.get('/dify-kb'),
      ])
      setRoles(rolesRes.data)
      setMcpServers(mcpRes.data)
      setDifyKbs(difyRes.data)
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
    setError('')
    setShowModal(true)
  }

  const openEdit = (role: Role) => {
    setEditing(role)
    setForm({
      name: role.name,
      description: role.description || '',
      is_default: !!role.is_default,
      mcp_server_ids: [...role.mcp_server_ids],
      dify_kb_ids: [...role.dify_kb_ids],
      budget_daily: role.budget_daily != null ? String(role.budget_daily) : '',
      budget_weekly: role.budget_weekly != null ? String(role.budget_weekly) : '',
      budget_monthly: role.budget_monthly != null ? String(role.budget_monthly) : '',
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
    })
    setError('')
    setShowModal(true)
  }

  const toggleId = (arr: number[], id: number) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]

  const save = async () => {
    if (!form.name.trim()) { setError('角色名稱為必填'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        budget_daily: form.budget_daily !== '' ? Number(form.budget_daily) : null,
        budget_weekly: form.budget_weekly !== '' ? Number(form.budget_weekly) : null,
        budget_monthly: form.budget_monthly !== '' ? Number(form.budget_monthly) : null,
      }
      if (editing) {
        await api.put(`/roles/${editing.id}`, payload)
      } else {
        await api.post('/roles', payload)
      }
      setShowModal(false)
      load()
    } catch (e: any) {
      setError(e.response?.data?.error || '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const deleteRole = async (role: Role) => {
    if (!confirm(`確定刪除角色「${role.name}」？使用此角色的使用者將被取消綁定。`)) return
    try {
      await api.delete(`/roles/${role.id}`)
      load()
    } catch (e: any) {
      alert(e.response?.data?.error || '刪除失敗')
    }
  }

  const setDefault = async (role: Role) => {
    try {
      await api.put(`/roles/${role.id}`, {
        name: role.name,
        description: role.description,
        is_default: true,
        mcp_server_ids: role.mcp_server_ids,
        dify_kb_ids: role.dify_kb_ids,
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
      })
      load()
    } catch (e: any) {
      alert(e.response?.data?.error || '設定失敗')
    }
  }

  const mcpById = Object.fromEntries(mcpServers.map((s) => [s.id, s]))
  const difyById = Object.fromEntries(difyKbs.map((k) => [k.id, k]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">角色管理</h2>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          <Plus size={15} /> 新增角色
        </button>
      </div>

      <p className="text-xs text-slate-500">
        將 MCP 伺服器 / DIFY 知識庫指派到角色，再將角色設定給使用者，該使用者即可使用對應的工具與知識庫。
        標示 <Star size={12} className="inline text-yellow-500" /> 的為預設角色，新使用者建立時自動套用。
      </p>

      {loading ? (
        <div className="text-slate-400 text-sm">載入中...</div>
      ) : roles.length === 0 ? (
        <div className="text-slate-400 text-sm p-8 text-center border border-dashed rounded-lg">
          尚無角色，請點擊「新增角色」
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
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">預設</span>
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
                      title="設為預設角色"
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

              {/* Assigned resources */}
              <div className="mt-3 flex flex-wrap gap-2">
                {role.mcp_server_ids.length === 0 && role.dify_kb_ids.length === 0 && (
                  <span className="text-xs text-slate-400 italic">尚未指派任何工具 / 知識庫</span>
                )}
                {role.mcp_server_ids.map((id) => (
                  <span key={`mcp-${id}`} className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                    <Plug size={11} /> {mcpById[id]?.name ?? `MCP #${id}`}
                  </span>
                ))}
                {role.dify_kb_ids.map((id) => (
                  <span key={`dify-${id}`} className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">
                    <Zap size={11} /> {difyById[id]?.name ?? `DIFY #${id}`}
                  </span>
                ))}
              </div>
              {/* Permission summary */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${role.allow_text_upload !== 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200 line-through'}`}>
                  <FileText size={10} /> 文字{role.allow_text_upload !== 0 ? ` ${role.text_max_mb}MB` : ''}
                </span>
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${role.allow_audio_upload === 1 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200 line-through'}`}>
                  <Mic size={10} /> 聲音{role.allow_audio_upload === 1 ? ` ${role.audio_max_mb}MB` : ''}
                </span>
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${role.allow_image_upload !== 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200 line-through'}`}>
                  <Image size={10} /> 圖片{role.allow_image_upload !== 0 ? ` ${role.image_max_mb}MB` : ''}
                </span>
                {role.allow_scheduled_tasks === 1 && (
                  <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                    <CalendarClock size={10} /> 排程
                  </span>
                )}
                {role.allow_code_skill === 1 && (
                  <span className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <Code2 size={10} /> 程式Skill
                  </span>
                )}
              </div>
              {/* Budget summary */}
              {(role.budget_daily != null || role.budget_weekly != null || role.budget_monthly != null) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {role.budget_daily != null && (
                    <span className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">日 ${role.budget_daily}</span>
                  )}
                  {role.budget_weekly != null && (
                    <span className="text-xs bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full">週 ${role.budget_weekly}</span>
                  )}
                  {role.budget_monthly != null && (
                    <span className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full">月 ${role.budget_monthly}</span>
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
              <h3 className="font-semibold text-slate-800">{editing ? '編輯角色' : '新增角色'}</h3>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">角色名稱 *</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例：基本使用者"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">描述</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="選填說明"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-sm text-slate-700">設為預設角色（新使用者自動套用，全系統唯一）</span>
              </label>

              {/* MCP Servers */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                  <Plug size={14} /> MCP 伺服器
                </label>
                {mcpServers.length === 0 ? (
                  <p className="text-xs text-slate-400">尚未設定 MCP 伺服器</p>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2">
                    {mcpServers.map((s) => {
                      const checked = form.mcp_server_ids.includes(s.id)
                      return (
                        <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}
                            onClick={() => setForm({ ...form, mcp_server_ids: toggleId(form.mcp_server_ids, s.id) })}>
                            {checked && <Check size={10} className="text-white" />}
                          </div>
                          <span className="text-sm text-slate-700">{s.name}</span>
                          {!s.is_active && <span className="text-xs text-slate-400">(停用)</span>}
                          {s.description && <span className="text-xs text-slate-400 truncate">{s.description}</span>}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* DIFY KBs */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                  <Zap size={14} /> DIFY 知識庫
                </label>
                {difyKbs.length === 0 ? (
                  <p className="text-xs text-slate-400">尚未設定 DIFY 知識庫</p>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2">
                    {difyKbs.map((k) => {
                      const checked = form.dify_kb_ids.includes(k.id)
                      return (
                        <label key={k.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${checked ? 'bg-purple-600 border-purple-600' : 'border-slate-300'}`}
                            onClick={() => setForm({ ...form, dify_kb_ids: toggleId(form.dify_kb_ids, k.id) })}>
                            {checked && <Check size={10} className="text-white" />}
                          </div>
                          <span className="text-sm text-slate-700">{k.name}</span>
                          {!k.is_active && <span className="text-xs text-slate-400">(停用)</span>}
                          {k.description && <span className="text-xs text-slate-400 truncate">{k.description}</span>}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              {/* Upload & Function Permissions */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">上傳權限預設值</label>
                <div className="space-y-2">
                  {[
                    { label: '文字檔', icon: <FileText size={13} />, field: 'allow_text_upload', mbField: 'text_max_mb' },
                    { label: '聲音檔', icon: <Mic size={13} />, field: 'allow_audio_upload', mbField: 'audio_max_mb' },
                    { label: '圖片檔', icon: <Image size={13} />, field: 'allow_image_upload', mbField: 'image_max_mb' },
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
                          <span className="text-xs text-slate-500">MB 上限</span>
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
                    <span className="text-sm text-slate-700">允許排程任務</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).allow_create_skill}
                      onChange={e => setForm({ ...form, allow_create_skill: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">✨ 允許建立 Skill</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).allow_external_skill}
                      onChange={e => setForm({ ...form, allow_external_skill: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">🌐 允許建立外部 Skill</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(form as any).allow_code_skill}
                      onChange={e => setForm({ ...form, allow_code_skill: e.target.checked } as any)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <Code2 size={13} />
                    <span className="text-sm text-slate-700">允許建立內部程式 Skill（資訊部門專用）</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Budget limits */}
            <div className="px-5 pb-5">
              <label className="block text-sm font-medium text-slate-700 mb-2">使用金額限制（空白=無限制）</label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">當日上限 ($)</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={form.budget_daily}
                    onChange={e => setForm({ ...form, budget_daily: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="無限制"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">當週上限 ($)</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={form.budget_weekly}
                    onChange={e => setForm({ ...form, budget_weekly: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="無限制"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">當月上限 ($)</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={form.budget_monthly}
                    onChange={e => setForm({ ...form, budget_monthly: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="無限制"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">週期為當日/週一至週日/當月。使用者個人設定可覆蓋角色設定。管理員不受限制。</p>
            </div>

            <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                disabled={saving}
              >
                取消
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
