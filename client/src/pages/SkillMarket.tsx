import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Plus, Search, Globe, Lock, GitFork, Send, Pencil, Trash2, Clock, X, ChevronDown, Zap, ArrowLeft, MessageSquare, Code2, Eye, Share2, History, CheckCircle, XCircle, LayoutTemplate } from 'lucide-react'
import api from '../lib/api'
import { fmtTW } from '../lib/fmtTW'
import TranslationFields, { type TranslationData } from '../components/common/TranslationFields'
import UserPicker from '../components/common/UserPicker'
import TagInput from '../components/common/TagInput'
import WorkflowEditor from '../components/workflow/WorkflowEditor'
import TemplatePickerPopover from '../components/templates/TemplatePickerPopover'
import type { DocTemplate } from '../types'

interface Skill {
    id: number
    name: string
    description: string
    icon: string
    type: 'builtin' | 'external' | 'code' | 'workflow'
    system_prompt?: string
    endpoint_url?: string
    endpoint_secret?: string
    endpoint_mode: 'inject' | 'answer' | 'post_answer'
    model_key?: string | null
    mcp_tool_mode: 'append' | 'exclusive' | 'disable'
    mcp_tool_ids: number[]
    dify_kb_ids: number[]
    tags: string[]
    owner_user_id: number
    owner_name?: string
    is_public: number
    is_admin_approved: number
    pending_approval: number
    code_snippet?: string
    code_packages?: string[]
    code_status?: string
    created_at: string
    self_kb_ids: string[]
    kb_mode: 'append' | 'exclusive' | 'disable'
    tool_schema?: string
    output_schema?: string
    rate_limit_per_user?: number | null
    rate_limit_global?: number | null
    rate_limit_window?: 'minute' | 'hour' | 'day'
    prompt_version?: number
    published_prompt?: string
    draft_prompt?: string
    workflow_json?: string
    prompt_variables?: string
    output_template_id?: string | null
    my_share_type?: 'use' | 'develop' | 'owner'
}

interface Model { key: string; name: string }

const ICONS = [
  // AI / 技術
  '🤖','🧠','💡','⚡','🔬','🔭','🧬','🛸','🤯','🦾','🦿','🧩','💻','🖥️','⌨️','🖱️',
  // 文件 / 辦公
  '📝','📋','📄','📃','📑','📜','🗒️','📰','📓','📔','📒','📕','📗','📘','📙','📚',
  '🗂️','🗃️','📂','📁','🗄️','🖊️','🖋️','✒️','✏️','📐','📏','📌','📎','🖇️',
  // 分析 / 數據
  '📊','📈','📉','🔢','🧮','🗓️','📅','📆','🕐','⏱️','⏰','🔔','🔕',
  // 工具 / 設定
  '🔧','🛠️','⚙️','🔩','🪛','🔨','⛏️','🪚','🔗','🪝','🔑','🗝️','🔓','🔒','🛡️',
  // 通訊 / 社交
  '💬','🗨️','🗯️','💭','📢','📣','📡','📞','☎️','📠','📧','📨','📩','📤','📥','📬',
  // 搜尋 / 導航
  '🔍','🔎','🧭','🗺️','📍','🚩','🏁','🎯','🏴','🌐','🌍','🌎','🌏',
  // 媒體 / 創意
  '🎨','🖼️','🖌️','🖍️','🎬','🎥','📸','📷','🎙️','🎚️','🎛️','🎵','🎶','🎼','🎤','🎧',
  '🎭','🎪','🎠','🎡','🎢',
  // 商業 / 金融
  '💼','🏢','🏦','💰','💳','💵','💴','💶','💷','💸','📦','🏷️','🛒','🤝','🤜','🤛',
  // 人物 / 角色
  '👤','👥','🧑‍💻','👨‍🔬','👩‍🏫','🧑‍🏭','👮','🕵️','🧑‍⚕️','👨‍🍳','🧑‍🎨','👷','🧑‍🚀',
  // 自然 / 環境
  '🌿','🍃','☀️','🌙','⭐','🌟','💫','✨','🌈','🔥','💧','🌱','🌊','🌋','🏔️','🏝️',
  // 交通 / 物流
  '🚀','✈️','🚂','🚢','🚁','🚛','🏭','🏗️','⚓','🛤️',
  // 符號 / 狀態
  '✅','❌','⭕','❓','❗','💯','🆗','🆕','🆙','🆒','🔴','🟡','🟢','🔵','🟣',
  '🏆','🥇','🎖️','🎗️','🎁','🎀','🧧','⚔️','🗡️','🛡️',
]

const EMPTY_FORM = {
    name: '', description: '', icon: '🤖', type: 'builtin' as 'builtin' | 'external' | 'code' | 'workflow',
    system_prompt: '', endpoint_url: '', endpoint_secret: '', endpoint_mode: 'inject' as 'inject' | 'answer' | 'post_answer',
    model_key: '', mcp_tool_mode: 'append' as 'append' | 'exclusive' | 'disable',
    mcp_tool_ids: [] as number[], dify_kb_ids: [] as number[], tags: [] as string[],
    code_snippet: '', code_packages: [] as string[],
    self_kb_ids: [] as string[],
    kb_mode: 'append' as 'append' | 'exclusive' | 'disable',
    tool_schema: '',
    output_schema: '',
    rate_limit_per_user: '' as string | number,
    rate_limit_global: '' as string | number,
    rate_limit_window: 'hour' as 'minute' | 'hour' | 'day',
    prompt_variables: '[]',
    workflow_json: '',
    output_template_id: '' as string,
}

export default function SkillMarket() {
    const navigate = useNavigate()
    const { user: currentUser } = useAuth()
    const [skills, setSkills] = useState<Skill[]>([])
    const [models, setModels] = useState<Model[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [q, setQ] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [showEditor, setShowEditor] = useState(false)
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null)
    const [form, setForm] = useState({ ...EMPTY_FORM })
    const [saving, setSaving] = useState(false)
    const [tagInput, setTagInput] = useState('')
    const [pkgInput, setPkgInput] = useState('')
    const [showIconPicker, setShowIconPicker] = useState(false)

    const canCodeSkill = currentUser?.role === 'admin' || (currentUser as any)?.effective_allow_code_skill === true
    const canCreateSkill = currentUser?.role === 'admin' || (currentUser as any)?.effective_allow_create_skill === true
    const [viewingSkill, setViewingSkill] = useState<Skill | null>(null)
    const [sharingSkill, setSharingSkill] = useState<Skill | null>(null)
    const [editorTab, setEditorTab] = useState<'basic' | 'tools' | 'io' | 'advanced' | 'history'>('basic')
    const [availableKbs, setAvailableKbs] = useState<{id: string; name: string}[]>([])
    const [availableDifyKbs, setAvailableDifyKbs] = useState<{id: number; name: string}[]>([])
    const [availableMcpServers, setAvailableMcpServers] = useState<{id: number; name: string}[]>([])
    const [availableSkillsList, setAvailableSkillsList] = useState<{id: number; name: string}[]>([])
    const [versionHistory, setVersionHistory] = useState<any[]>([])
    const [showVersions, setShowVersions] = useState(false)
    const [trans, setTrans] = useState<TranslationData>({})
    const [outputTemplate, setOutputTemplate] = useState<DocTemplate | null>(null)
    const [showTemplatePicker, setShowTemplatePicker] = useState(false)
    const [translating, setTranslating] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const params: Record<string, string> = {}
            if (q) params.q = q
            if (typeFilter) params.type = typeFilter
            const [skillsRes, modelsRes, kbRes, difyRes, mcpRes] = await Promise.all([
                api.get('/skills', { params }),
                api.get('/chat/models'),
                api.get('/kb').catch(() => ({ data: [] })),
                api.get('/dify-kb/my').catch(() => ({ data: [] })),
                api.get('/mcp-servers/my').catch(() => ({ data: [] })),
            ])
            setSkills(skillsRes.data)
            setModels(modelsRes.data)
            setAvailableKbs(kbRes.data.map((k: any) => ({ id: k.id, name: k.name })))
            setAvailableDifyKbs(difyRes.data.map((k: any) => ({ id: k.id, name: k.name })))
            setAvailableMcpServers(mcpRes.data.map((s: any) => ({ id: s.id, name: s.name })))
            setAvailableSkillsList(skillsRes.data.map((s: any) => ({ id: s.id, name: s.name })))
        } catch (e: any) {
            setError(e.response?.data?.error || '載入失敗')
        } finally {
            setLoading(false)
        }
    }, [q, typeFilter])

    useEffect(() => { load() }, [load])

    const openCreate = () => { setEditingSkill(null); setForm({ ...EMPTY_FORM }); setTagInput(''); setTrans({}); setEditorTab('basic'); setShowEditor(true); setVersionHistory([]); setOutputTemplate(null) }
    const openEdit = async (sk: Skill) => {
        setEditingSkill(sk)
        setForm({
            name: sk.name, description: sk.description || '', icon: sk.icon || '🤖',
            type: sk.type, system_prompt: sk.system_prompt || '',
            endpoint_url: sk.endpoint_url || '', endpoint_secret: sk.endpoint_secret || '',
            endpoint_mode: sk.endpoint_mode || 'inject', model_key: sk.model_key || '',
            mcp_tool_mode: sk.mcp_tool_mode || 'append',
            mcp_tool_ids: sk.mcp_tool_ids || [],
            dify_kb_ids: sk.dify_kb_ids || [],
            tags: sk.tags || [],
            code_snippet: sk.code_snippet || '',
            code_packages: sk.code_packages || [],
            self_kb_ids: sk.self_kb_ids || [],
            kb_mode: sk.kb_mode || 'append',
            tool_schema: typeof sk.tool_schema === 'object' ? JSON.stringify(sk.tool_schema, null, 2) : (sk.tool_schema || ''),
            output_schema: typeof sk.output_schema === 'object' ? JSON.stringify(sk.output_schema, null, 2) : (sk.output_schema || ''),
            rate_limit_per_user: sk.rate_limit_per_user ?? '',
            rate_limit_global: sk.rate_limit_global ?? '',
            rate_limit_window: sk.rate_limit_window || 'hour',
            prompt_variables: typeof sk.prompt_variables === 'object' ? JSON.stringify(sk.prompt_variables, null, 2) : (sk.prompt_variables || '[]'),
            workflow_json: typeof sk.workflow_json === 'object' ? JSON.stringify(sk.workflow_json, null, 2) : (sk.workflow_json || ''),
            output_template_id: sk.output_template_id || '',
        })
        // Load output template info if set
        if (sk.output_template_id) {
            api.get(`/doc-templates/${sk.output_template_id}`).then(r => setOutputTemplate(r.data)).catch(() => setOutputTemplate(null))
        } else {
            setOutputTemplate(null)
        }
        setTrans({
            name_zh: (sk as any).name_zh || null, name_en: (sk as any).name_en || null, name_vi: (sk as any).name_vi || null,
            desc_zh: (sk as any).desc_zh || null, desc_en: (sk as any).desc_en || null, desc_vi: (sk as any).desc_vi || null,
        })
        setTagInput('')
        setPkgInput('')
        setEditorTab('basic')
        setShowEditor(true)
        loadVersionHistory(sk.id)
    }

    const save = async () => {
        if (!form.name.trim()) return setError('名稱必填')
        setSaving(true)
        setError('')
        // Auto-flush any pending tag/package input before save
        const pendingTag = tagInput.trim()
        const pendingPkg = pkgInput.trim()
        const finalTags = pendingTag && !form.tags.includes(pendingTag) ? [...form.tags, pendingTag] : form.tags
        const finalPkgs = pendingPkg && !form.code_packages.includes(pendingPkg) ? [...form.code_packages, pendingPkg] : form.code_packages
        const payload = {
            ...form, tags: finalTags, code_packages: finalPkgs, ...trans,
            self_kb_ids: JSON.stringify(form.self_kb_ids),
            kb_mode: form.kb_mode,
            tool_schema: form.tool_schema || null,
            output_schema: form.output_schema || null,
            rate_limit_per_user: form.rate_limit_per_user ? Number(form.rate_limit_per_user) : null,
            rate_limit_global: form.rate_limit_global ? Number(form.rate_limit_global) : null,
            rate_limit_window: form.rate_limit_window,
            prompt_variables: form.prompt_variables || '[]',
            workflow_json: form.workflow_json || null,
            output_template_id: form.output_template_id || null,
        }
        setTranslating(true)
        try {
            if (editingSkill) {
                const res = await api.put(`/skills/${editingSkill.id}`, payload)
                setTrans({
                    name_zh: res.data.name_zh || null, name_en: res.data.name_en || null, name_vi: res.data.name_vi || null,
                    desc_zh: res.data.desc_zh || null, desc_en: res.data.desc_en || null, desc_vi: res.data.desc_vi || null,
                })
            } else {
                const res = await api.post('/skills', payload)
                setTrans({
                    name_zh: res.data.name_zh || null, name_en: res.data.name_en || null, name_vi: res.data.name_vi || null,
                    desc_zh: res.data.desc_zh || null, desc_en: res.data.desc_en || null, desc_vi: res.data.desc_vi || null,
                })
            }
            setTagInput('')
            setPkgInput('')
            setShowEditor(false)
            load()
        } catch (e: any) {
            setError(e.response?.data?.error || '儲存失敗')
        } finally {
            setSaving(false)
            setTranslating(false)
        }
    }

    const setField = (key: string, value: any) => setForm(p => ({ ...p, [key]: value }))

    const handlePublish = async () => {
        if (!editingSkill) return
        const note = prompt('版本備注 (選填):')
        try {
            await api.post(`/skills/${editingSkill.id}/publish`, { change_note: note || '' })
            alert('已發布')
            loadVersionHistory(editingSkill.id)
            load()
        } catch (e: any) { alert(e.response?.data?.error || '發布失敗') }
    }

    const handleRollback = async (version: number) => {
        if (!editingSkill || !confirm(`確定要回滾到 v${version}？`)) return
        try {
            await api.post(`/skills/${editingSkill.id}/rollback/${version}`)
            alert(`已回滾到 v${version}`)
            const res = await api.get(`/skills/${editingSkill.id}`)
            setEditingSkill(res.data)
            setField('system_prompt', res.data.system_prompt || '')
            setField('workflow_json', res.data.workflow_json || '')
            loadVersionHistory(editingSkill.id)
        } catch (e: any) { alert(e.response?.data?.error || '回滾失敗') }
    }

    const loadVersionHistory = async (id: number) => {
        try {
            const res = await api.get(`/skills/${id}/versions`)
            setVersionHistory(res.data)
        } catch { setVersionHistory([]) }
    }

    const del = async (sk: Skill) => {
        if (!confirm(`確定刪除 "${sk.name}"？`)) return
        try { await api.delete(`/skills/${sk.id}`); load() } catch (e: any) { setError(e.response?.data?.error || '刪除失敗') }
    }

    const fork = async (sk: Skill) => {
        try { await api.post(`/skills/${sk.id}/fork`); load() } catch (e: any) { setError(e.response?.data?.error || 'Fork 失敗') }
    }

    const requestPublic = async (sk: Skill) => {
        try { await api.post(`/skills/${sk.id}/request-public`); load() } catch (e: any) { setError(e.response?.data?.error || '申請失敗') }
    }

    const addTag = () => {
        const t = tagInput.trim()
        if (t && !form.tags.includes(t)) setForm(p => ({ ...p, tags: [...p.tags, t] }))
        setTagInput('')
    }

    const addPkg = () => {
        const t = pkgInput.trim()
        if (t && !form.code_packages.includes(t)) setForm(p => ({ ...p, code_packages: [...p.code_packages, t] }))
        setPkgInput('')
    }

    const isOwner = (sk: Skill) => {
        return sk.owner_user_id === currentUser?.id || currentUser?.role === 'admin'
    }

    const mySkills = skills.filter(s => isOwner(s))
    const sharedSkills = skills.filter(s => !isOwner(s) && !s.is_public && s.my_share_type)
    const publicSkills = skills.filter(s => !isOwner(s) && s.is_public && s.is_admin_approved)

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-6xl mx-auto p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <button onClick={() => navigate('/chat')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Zap size={22} className="text-blue-500" />技能市集</h1>
                            <p className="text-sm text-slate-500 mt-0.5">建立並分享 AI Skill，讓對話更強大</p>
                        </div>
                    </div>
                    {canCreateSkill && (
                        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">
                            <Plus size={15} />建立技能
                        </button>
                    )}
                </div>

                {/* Filters */}
                <div className="flex gap-2 mb-6">
                    <div className="relative flex-1 max-w-sm">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋技能名稱..."
                            className="pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                    <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300">
                        <option value="">全部類型</option>
                        <option value="builtin">內建</option>
                        <option value="external">外部</option>
                        <option value="code">內部程式</option>
                        <option value="workflow">工作流</option>
                    </select>
                </div>

                {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}<button className="ml-2 text-red-400 hover:text-red-600" onClick={() => setError('')}><X size={13} /></button></div>}

                {loading && <div className="text-center py-12 text-slate-400">載入中...</div>}

                {/* My Skills */}
                {mySkills.length > 0 && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wide">我的技能</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {mySkills.map(sk => <SkillCard key={sk.id} skill={sk} onEdit={() => openEdit(sk)} onDelete={() => del(sk)} onFork={() => fork(sk)} onRequestPublic={() => requestPublic(sk)} onUse={() => navigate(`/chat?skillId=${sk.id}`)} onShare={() => setSharingSkill(sk)} isOwner />)}
                        </div>
                    </section>
                )}

                {/* Shared Skills */}
                {sharedSkills.length > 0 && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wide">共享給我的技能</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {sharedSkills.map(sk => (
                                <SkillCard key={sk.id} skill={sk}
                                    onFork={sk.my_share_type === 'develop' ? () => fork(sk) : undefined}
                                    onUse={() => navigate(`/chat?skillId=${sk.id}`)}
                                    onView={() => setViewingSkill(sk)}
                                    isOwner={false} />
                            ))}
                        </div>
                    </section>
                )}

                {/* Public Skills */}
                {publicSkills.length > 0 && (
                    <section>
                        <h2 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wide">公開技能</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {publicSkills.map(sk => (
                                <SkillCard key={sk.id} skill={sk}
                                    onFork={sk.my_share_type === 'develop' ? () => fork(sk) : undefined}
                                    onUse={() => navigate(`/chat?skillId=${sk.id}`)}
                                    onView={() => setViewingSkill(sk)}
                                    isOwner={false} />
                            ))}
                        </div>
                    </section>
                )}

                {!loading && skills.length === 0 && (
                    <div className="text-center py-20 text-slate-400">
                        <Zap size={40} className="mx-auto mb-3 opacity-30" />
                        <p>還沒有技能，點擊「建立技能」開始</p>
                    </div>
                )}

                {/* Editor modal */}
                {showEditor && (
                    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
                            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                                <div className="flex items-center gap-4">
                                    <h3 className="font-semibold text-slate-800">{editingSkill ? '編輯技能' : '建立技能'}</h3>
                                </div>
                                <button onClick={() => setShowEditor(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={16} /></button>
                            </div>
                            {/* Tab bar */}
                            <div className="flex gap-1 border-b border-slate-100 px-6 pt-2">
                                {([
                                    ['basic', '基本資訊'],
                                    ['tools', '工具綁定'],
                                    ['io', '輸入/輸出'],
                                    ['advanced', '進階設定'],
                                    ...(editingSkill ? [['history', '版本歷史']] : []),
                                ] as [typeof editorTab, string][]).map(([key, label]) => (
                                    <button key={key} onClick={() => setEditorTab(key)}
                                        className={`px-3 py-2 text-xs font-medium transition border-b-2 ${editorTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div className="p-6 space-y-4">
                                {/* ─── Basic tab ─── */}
                                {editorTab === 'basic' && (
                                    <div className="space-y-4">
                                        <div className="flex gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">圖示</label>
                                                <div className="relative">
                                                    <button type="button"
                                                        onClick={() => setShowIconPicker(p => !p)}
                                                        className="w-16 h-10 text-2xl border border-slate-200 rounded-lg flex items-center justify-center hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300">
                                                        {form.icon}
                                                    </button>
                                                    {showIconPicker && (
                                                        <>
                                                        <div className="fixed inset-0 z-40" onClick={() => setShowIconPicker(false)} />
                                                        <div className="absolute z-50 mt-1 left-0 w-72 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl p-2 grid grid-cols-8 gap-1">
                                                            {ICONS.map(i => (
                                                                <button key={i} type="button"
                                                                    onClick={() => { setForm(p => ({ ...p, icon: i })); setShowIconPicker(false) }}
                                                                    className={`text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 transition-colors ${form.icon === i ? 'bg-blue-100 ring-2 ring-blue-300' : ''}`}>
                                                                    {i}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <label className="block text-xs font-medium text-slate-600 mb-1">名稱 *</label>
                                                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">描述</label>
                                            <textarea value={form.description} rows={2} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
                                        </div>

                                        <TranslationFields
                                            data={trans}
                                            onChange={setTrans}
                                            translateUrl={editingSkill ? `/skills/${editingSkill.id}/translate` : undefined}
                                            hasDescription
                                            translating={translating}
                                        />

                                        {/* Type */}
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">類型</label>
                                            <div className="flex gap-2 flex-wrap">
                                                {(['builtin', 'external'] as const).map(t => (
                                                    <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))}
                                                        className={`px-4 py-1.5 rounded-lg text-sm border transition ${form.type === t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}>
                                                        {t === 'builtin' ? '內建 Prompt' : '外部 Endpoint'}
                                                    </button>
                                                ))}
                                                {canCodeSkill && (
                                                    <button onClick={() => setForm(p => ({ ...p, type: 'code' }))}
                                                        className={`px-4 py-1.5 rounded-lg text-sm border transition flex items-center gap-1 ${form.type === 'code' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 text-slate-600 hover:border-emerald-300'}`}>
                                                        <Code2 size={13} />內部程式
                                                    </button>
                                                )}
                                                <button onClick={() => setForm(p => ({ ...p, type: 'workflow' }))}
                                                    className={`px-4 py-1.5 rounded-lg text-sm border transition ${form.type === 'workflow' ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-200 text-slate-600 hover:border-orange-300'}`}>
                                                    工作流
                                                </button>
                                            </div>
                                        </div>

                                        {/* Tags */}
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">標籤 *</label>
                                            <div className="flex gap-2 flex-wrap mb-2">
                                                {form.tags.map(t => (
                                                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600">
                                                        {t}<button onClick={() => setForm(p => ({ ...p, tags: p.tags.filter(x => x !== t) }))}><X size={10} /></button>
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="flex gap-2">
                                                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                                                    placeholder="輸入標籤後按 Enter"
                                                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                                                <button onClick={addTag} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:border-blue-300">新增</button>
                                            </div>
                                        </div>

                                        {/* System Prompt (builtin) */}
                                        {form.type === 'builtin' && (
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">System Prompt</label>
                                                <textarea value={form.system_prompt} rows={6} onChange={e => setForm(p => ({ ...p, system_prompt: e.target.value }))}
                                                    placeholder="輸入給 AI 的角色設定與指令..."
                                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y" />
                                            </div>
                                        )}

                                        {/* External type fields */}
                                        {form.type === 'external' && (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-600 mb-1">Endpoint URL</label>
                                                    <input value={form.endpoint_url} onChange={e => setForm(p => ({ ...p, endpoint_url: e.target.value }))}
                                                        placeholder="https://your-service.com/skill"
                                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-600 mb-1">Bearer Token（選填）</label>
                                                    <input type="password" value={form.endpoint_secret} onChange={e => setForm(p => ({ ...p, endpoint_secret: e.target.value }))}
                                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                                                </div>
                                            </div>
                                        )}

                                        {/* Code type fields */}
                                        {form.type === 'code' && (
                                            <div className="space-y-3">
                                                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                                                    儲存後請至後台「Code Runners」頁簽啟動此 Skill。handler 需 export 一個 async function，回傳 {'{ system_prompt }'} 或 {'{ content }'}。
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-600 mb-1">Node.js Handler 程式碼</label>
                                                    <textarea value={form.code_snippet} rows={12}
                                                        onChange={e => setForm(p => ({ ...p, code_snippet: e.target.value }))}
                                                        placeholder={`// 範例\nmodule.exports = async function handler(body) {\n  const { user_message } = body;\n  // 可 require 已安裝的 npm 套件\n  return { system_prompt: '相關資訊：' + user_message };\n};`}
                                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-y bg-slate-950 text-emerald-300" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-600 mb-1">NPM 套件（安裝後才可 require）</label>
                                                    <div className="flex flex-wrap gap-1 mb-2">
                                                        {form.code_packages.map(p => (
                                                            <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 rounded text-xs text-emerald-700">
                                                                {p}<button type="button" onClick={() => setForm(f => ({ ...f, code_packages: f.code_packages.filter(x => x !== p) }))}><X size={10} /></button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <input value={pkgInput} onChange={e => setPkgInput(e.target.value)}
                                                            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addPkg())}
                                                            placeholder="axios, mssql... 後按 Enter"
                                                            className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                                                        <button type="button" onClick={addPkg} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:border-emerald-300">新增</button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Workflow editor */}
                                        {form.type === 'workflow' && (
                                            <div className="mt-3">
                                                <label className="block text-xs text-slate-500 mb-1">工作流程編輯器</label>
                                                <WorkflowEditor
                                                    value={form.workflow_json}
                                                    onChange={(json) => setField('workflow_json', json)}
                                                    availableKbs={availableKbs}
                                                    availableDifyKbs={availableDifyKbs}
                                                    availableMcpServers={availableMcpServers}
                                                    availableSkills={availableSkillsList}
                                                    availableModels={models}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ─── Tools tab ─── */}
                                {editorTab === 'tools' && (
                                    <div className="space-y-4">
                                        {/* MCP Tool Mode */}
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">MCP 工具模式</label>
                                            <select value={form.mcp_tool_mode} onChange={e => setField('mcp_tool_mode', e.target.value)}
                                                className="w-full border rounded px-3 py-2 text-sm">
                                                <option value="append">附加</option>
                                                <option value="exclusive">獨佔</option>
                                                <option value="disable">停用</option>
                                            </select>
                                        </div>

                                        {/* Self KB binding */}
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">自建知識庫綁定</label>
                                            <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                                                {availableKbs.map(kb => (
                                                    <label key={kb.id} className="flex items-center gap-2 text-sm">
                                                        <input type="checkbox" checked={form.self_kb_ids.includes(kb.id)}
                                                            onChange={e => setField('self_kb_ids', e.target.checked
                                                                ? [...form.self_kb_ids, kb.id]
                                                                : form.self_kb_ids.filter(x => x !== kb.id))} />
                                                        {kb.name}
                                                    </label>
                                                ))}
                                                {availableKbs.length === 0 && <span className="text-xs text-slate-400">無可用知識庫</span>}
                                            </div>
                                        </div>

                                        {/* DIFY KB binding */}
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">DIFY 知識庫綁定</label>
                                            <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                                                {availableDifyKbs.map(kb => (
                                                    <label key={kb.id} className="flex items-center gap-2 text-sm">
                                                        <input type="checkbox" checked={form.dify_kb_ids.includes(kb.id)}
                                                            onChange={e => setField('dify_kb_ids', e.target.checked
                                                                ? [...form.dify_kb_ids, kb.id]
                                                                : form.dify_kb_ids.filter(x => x !== kb.id))} />
                                                        {kb.name}
                                                    </label>
                                                ))}
                                                {availableDifyKbs.length === 0 && <span className="text-xs text-slate-400">無可用 DIFY 知識庫</span>}
                                            </div>
                                        </div>

                                        {/* KB Mode */}
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">知識庫模式</label>
                                            <select value={form.kb_mode} onChange={e => setField('kb_mode', e.target.value)}
                                                className="w-full border rounded px-3 py-2 text-sm">
                                                <option value="append">附加 (加入可用清單)</option>
                                                <option value="exclusive">獨佔 (只用這些)</option>
                                                <option value="disable">停用 (不使用知識庫)</option>
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {/* ─── I/O tab ─── */}
                                {editorTab === 'io' && (
                                    <div className="space-y-4">
                                        {/* prompt_variables */}
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">輸入變數 (prompt_variables)</label>
                                            <textarea value={form.prompt_variables} onChange={e => setField('prompt_variables', e.target.value)}
                                                className="w-full border rounded px-3 py-2 text-xs font-mono h-32 resize-y"
                                                placeholder='[{"name":"department","label":"部門","type":"select","options":["HR","IT"],"required":true}]' />
                                            <p className="text-xs text-slate-400 mt-1">JSON 陣列。type: text/select/number/date/date_range/textarea/checkbox</p>
                                        </div>

                                        {/* tool_schema (code/external skills) */}
                                        {(form.type === 'code' || form.type === 'external') && (
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1">Tool Schema (Gemini Function Declaration)</label>
                                                <textarea value={form.tool_schema} onChange={e => setField('tool_schema', e.target.value)}
                                                    className="w-full border rounded px-3 py-2 text-xs font-mono h-32 resize-y"
                                                    placeholder='{"description":"查詢出勤","parameters":{"type":"object","properties":{"employee_id":{"type":"string"}}}}' />
                                                <p className="text-xs text-slate-400 mt-1">定義後，LLM 會自動判斷何時呼叫此技能的程式</p>
                                            </div>
                                        )}

                                        {/* output_schema */}
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">輸出格式 (Output Schema)</label>
                                            <textarea value={form.output_schema} onChange={e => setField('output_schema', e.target.value)}
                                                className="w-full border rounded px-3 py-2 text-xs font-mono h-32 resize-y"
                                                placeholder='{"type":"object","properties":{"summary":{"type":"string"},"items":{"type":"array"}}}' />
                                            <p className="text-xs text-slate-400 mt-1">JSON Schema，LLM 會按此格式輸出</p>
                                        </div>

                                        {/* output_template_id */}
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">輸出範本</label>
                                            <div className="relative">
                                                {outputTemplate ? (
                                                    <div className="flex items-center gap-2 px-3 py-2 border border-blue-300 bg-blue-50 rounded-lg text-sm">
                                                        <LayoutTemplate size={14} className="text-blue-500 shrink-0" />
                                                        <span className="flex-1 text-blue-700 truncate">{outputTemplate.name}</span>
                                                        <button type="button" onClick={() => { setOutputTemplate(null); setField('output_template_id', '') }}
                                                            className="text-slate-400 hover:text-red-500"><X size={13} /></button>
                                                    </div>
                                                ) : (
                                                    <button type="button" onClick={() => setShowTemplatePicker(true)}
                                                        className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition w-full">
                                                        <LayoutTemplate size={14} />選擇輸出範本（選填）
                                                    </button>
                                                )}
                                                {showTemplatePicker && (
                                                    <div className="absolute z-50 top-full mt-1 left-0 right-0">
                                                        <TemplatePickerPopover
                                                            onSelect={t => { setOutputTemplate(t); setField('output_template_id', t.id); setShowTemplatePicker(false) }}
                                                            onClose={() => setShowTemplatePicker(false)}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-400 mt-1">選擇後 AI 會強制輸出 JSON 並套用此範本產生文件</p>
                                        </div>
                                    </div>
                                )}

                                {/* ─── Advanced tab ─── */}
                                {editorTab === 'advanced' && (
                                    <div className="space-y-4">
                                        {/* model_key */}
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">指定模型</label>
                                            <select value={form.model_key} onChange={e => setField('model_key', e.target.value)}
                                                className="w-full border rounded px-3 py-2 text-sm">
                                                <option value="">預設</option>
                                                {models.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
                                            </select>
                                        </div>

                                        {/* endpoint_mode */}
                                        {(form.type === 'external' || form.type === 'code') && (
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1">回應模式</label>
                                                <select value={form.endpoint_mode} onChange={e => setField('endpoint_mode', e.target.value as any)}
                                                    className="w-full border rounded px-3 py-2 text-sm">
                                                    <option value="inject">注入 (結果送入 LLM)</option>
                                                    <option value="answer">直答 (直接回傳，跳過 LLM)</option>
                                                    <option value="post_answer">後處理 (LLM 回答後再呼叫，適合 TTS)</option>
                                                </select>
                                            </div>
                                        )}

                                        {/* Rate Limiting */}
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1">每用戶上限</label>
                                                <input type="number" value={form.rate_limit_per_user} onChange={e => setField('rate_limit_per_user', e.target.value)}
                                                    className="w-full border rounded px-3 py-2 text-sm" placeholder="不限" min={0} />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1">全域上限</label>
                                                <input type="number" value={form.rate_limit_global} onChange={e => setField('rate_limit_global', e.target.value)}
                                                    className="w-full border rounded px-3 py-2 text-sm" placeholder="不限" min={0} />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1">時間窗口</label>
                                                <select value={form.rate_limit_window} onChange={e => setField('rate_limit_window', e.target.value)}
                                                    className="w-full border rounded px-3 py-2 text-sm">
                                                    <option value="minute">每分鐘</option>
                                                    <option value="hour">每小時</option>
                                                    <option value="day">每天</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* ─── History tab ─── */}
                                {editorTab === 'history' && (
                                    <div className="space-y-3">
                                        {/* Publish button */}
                                        <div className="flex items-center gap-2">
                                            <button onClick={handlePublish} className="px-3 py-1.5 bg-green-500 text-white text-sm rounded hover:bg-green-600">
                                                發布版本
                                            </button>
                                            <span className="text-xs text-slate-500">當前版本: v{editingSkill?.prompt_version || 1}</span>
                                        </div>

                                        {/* Version list */}
                                        <div className="space-y-2 max-h-60 overflow-y-auto">
                                            {versionHistory.map((v: any) => (
                                                <div key={v.version} className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm">
                                                    <div>
                                                        <span className="font-medium">v{v.version}</span>
                                                        <span className="text-xs text-slate-400 ml-2">{v.changed_by_name} · {fmtTW(v.created_at)}</span>
                                                        {v.change_note && <span className="text-xs text-slate-500 ml-2">{v.change_note}</span>}
                                                    </div>
                                                    <button onClick={() => handleRollback(v.version)} className="text-xs text-blue-500 hover:underline">回滾</button>
                                                </div>
                                            ))}
                                            {versionHistory.length === 0 && <p className="text-xs text-slate-400 text-center py-4">尚無發布歷史</p>}
                                        </div>
                                    </div>
                                )}

                                {error && <p className="text-sm text-red-600">{error}</p>}
                            </div>
                            {editorTab !== 'history' && (
                            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
                                <button onClick={() => setShowEditor(false)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">取消</button>
                                <button onClick={save} disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                                    {saving ? '儲存中...' : '儲存'}
                                </button>
                            </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Read-only view modal for public skills */}
                {sharingSkill && (
                    <SkillShareModal skill={sharingSkill} onClose={() => setSharingSkill(null)} />
                )}

                {viewingSkill && (
                    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
                            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                    <Eye size={16} className="text-blue-500" />
                                    <h3 className="font-semibold text-slate-800">技能詳情（唯讀）</h3>
                                </div>
                                <button onClick={() => setViewingSkill(null)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={16} /></button>
                            </div>
                            <div className="p-6 space-y-4 text-sm">
                                <div className="flex items-center gap-3">
                                    <span className="text-3xl">{viewingSkill.icon}</span>
                                    <div>
                                        <p className="font-semibold text-slate-800 text-base">{viewingSkill.name}</p>
                                        <p className="text-slate-500 text-xs">{viewingSkill.description}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div><span className="text-xs text-slate-400 block">類型</span><p className="text-slate-700">{viewingSkill.type === 'builtin' ? '內建 Prompt' : viewingSkill.type === 'external' ? '外部 Endpoint' : viewingSkill.type === 'workflow' ? '工作流' : '內部程式'}</p></div>
                                    <div><span className="text-xs text-slate-400 block">端點模式</span><p className="text-slate-700">{viewingSkill.endpoint_mode}</p></div>
                                    {viewingSkill.model_key && <div><span className="text-xs text-slate-400 block">指定模型</span><p className="text-slate-700">{viewingSkill.model_key}</p></div>}
                                    <div><span className="text-xs text-slate-400 block">MCP 工具模式</span><p className="text-slate-700">{viewingSkill.mcp_tool_mode}</p></div>
                                </div>
                                {viewingSkill.my_share_type === 'develop' && viewingSkill.system_prompt && (
                                    <div>
                                        <p className="text-xs text-slate-400 mb-1">System Prompt</p>
                                        <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">{viewingSkill.system_prompt}</pre>
                                    </div>
                                )}
                                {viewingSkill.my_share_type === 'develop' && viewingSkill.endpoint_url && (
                                    <div><span className="text-xs text-slate-400 block">Endpoint URL</span><p className="text-slate-700 font-mono text-xs break-all">{viewingSkill.endpoint_url}</p></div>
                                )}
                                {viewingSkill.my_share_type === 'develop' && viewingSkill.type === 'code' && viewingSkill.code_snippet && (
                                    <div>
                                        <p className="text-xs text-slate-400 mb-1">程式碼</p>
                                        <pre className="bg-slate-950 rounded-lg p-3 text-xs text-emerald-300 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">{viewingSkill.code_snippet}</pre>
                                    </div>
                                )}
                                {viewingSkill.my_share_type !== 'develop' && (
                                    <p className="text-xs text-slate-400 italic">需要「開發」權限才能查看程式碼與設定細節</p>
                                )}
                                {viewingSkill.tags && viewingSkill.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {viewingSkill.tags.map(t => <span key={t} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">{t}</span>)}
                                    </div>
                                )}
                                <p className="text-xs text-slate-400">建立者：{viewingSkill.owner_name || '—'}</p>
                            </div>
                            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
                                {viewingSkill.my_share_type === 'develop' && (
                                    <button onClick={() => { fork(viewingSkill); setViewingSkill(null) }} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><GitFork size={14} />Fork 一份</button>
                                )}
                                <button onClick={() => setViewingSkill(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">關閉</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Grantee type labels ───────────────────────────────────────────────────────
const GRANTEE_TYPE_LABELS: Record<string, string> = {
    user: '使用者',
    role: '角色',
    dept: '部門',
    profit_center: '利潤中心',
    org_section: '事業處',
    org_group: '事業群',
}

interface GrantRecord {
    id: string
    skill_id: number
    grantee_type: string
    grantee_id: string
    grantee_name?: string
    share_type: 'use' | 'develop'
    granted_by: number | null
    granted_by_name?: string
    granted_at: string
}

interface OrgLov {
    depts: { code: string; name: string }[]
    profit_centers: { code: string; name: string }[]
    org_sections: { code: string; name: string }[]
    org_groups: { name: string }[]
}

function SkillShareModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
    const [grants, setGrants] = useState<GrantRecord[]>([])
    const [loadingGrants, setLoadingGrants] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [granteeType, setGranteeType] = useState<string>('user')
    const [granteeId, setGranteeId] = useState<string>('')
    const [shareType, setShareType] = useState<'use' | 'develop'>('use')
    const [userDisplay, setUserDisplay] = useState<string>('')
    const [roles, setRoles] = useState<{ id: number; name: string }[]>([])
    const [orgs, setOrgs] = useState<OrgLov | null>(null)
    const [orgSearch, setOrgSearch] = useState('')
    const [orgOptions, setOrgOptions] = useState<{ id: string; name: string; sub?: string }[]>([])

    const loadGrants = useCallback(async () => {
        setLoadingGrants(true)
        try {
            const res = await api.get(`/skills/${skill.id}/access`)
            setGrants(res.data)
        } catch (e: any) {
            setError(e.response?.data?.error || '載入共享設定失敗')
        } finally {
            setLoadingGrants(false)
        }
    }, [skill.id])

    useEffect(() => { loadGrants() }, [loadGrants])

    useEffect(() => {
        api.get('/roles').then(r => setRoles(r.data || [])).catch(() => {})
        api.get('/dashboard/orgs').then(r => setOrgs(r.data)).catch(() => {})
    }, [])

    // 計算 org LOV 選項
    useEffect(() => {
        if (!orgs) { setOrgOptions([]); return }
        const q = orgSearch.toLowerCase()
        if (granteeType === 'dept') {
            setOrgOptions(orgs.depts.filter(d => !q || d.code.toLowerCase().includes(q) || (d.name || '').toLowerCase().includes(q))
                .map(d => ({ id: d.code, name: d.name || d.code, sub: d.code })))
        } else if (granteeType === 'profit_center') {
            setOrgOptions(orgs.profit_centers.filter(d => !q || d.code.toLowerCase().includes(q) || (d.name || '').toLowerCase().includes(q))
                .map(d => ({ id: d.code, name: d.name || d.code, sub: d.code })))
        } else if (granteeType === 'org_section') {
            setOrgOptions(orgs.org_sections.filter(d => !q || d.code.toLowerCase().includes(q) || (d.name || '').toLowerCase().includes(q))
                .map(d => ({ id: d.code, name: d.name || d.code, sub: d.code })))
        } else if (granteeType === 'org_group') {
            setOrgOptions(orgs.org_groups.filter(d => !q || d.name.toLowerCase().includes(q))
                .map(d => ({ id: d.name, name: d.name })))
        } else {
            setOrgOptions([])
        }
    }, [granteeType, orgSearch, orgs])

    const handleTypeChange = (t: string) => {
        setGranteeType(t)
        setGranteeId('')
        setUserDisplay('')
        setOrgSearch('')
    }

    const handleAdd = async () => {
        const finalId = granteeType === 'user' ? granteeId : granteeId.trim()
        if (!finalId) return setError('請填寫共享對象')
        setSubmitting(true)
        setError('')
        try {
            const res = await api.post(`/skills/${skill.id}/access`, {
                grantee_type: granteeType, grantee_id: finalId, share_type: shareType
            })
            setGrants(Array.isArray(res.data) ? res.data : grants)
            setGranteeId('')
            setUserDisplay('')
        } catch (e: any) {
            setError(e.response?.data?.error || '新增失敗')
        } finally {
            setSubmitting(false)
        }
    }

    const handleChangeShareType = async (grant: GrantRecord, newType: 'use' | 'develop') => {
        try {
            const res = await api.post(`/skills/${skill.id}/access`, {
                grantee_type: grant.grantee_type, grantee_id: grant.grantee_id, share_type: newType
            })
            setGrants(Array.isArray(res.data) ? res.data : grants)
        } catch (e: any) {
            setError(e.response?.data?.error || '更新失敗')
        }
    }

    const handleDelete = async (grantId: string) => {
        try {
            await api.delete(`/skills/${skill.id}/access/${grantId}`)
            setGrants(prev => prev.filter(g => g.id !== grantId))
        } catch (e: any) {
            setError(e.response?.data?.error || '刪除失敗')
        }
    }

    const getGranteeDisplay = (grant: GrantRecord) => {
        if (grant.grantee_type === 'role') return grant.grantee_id === 'admin' ? '系統管理員' : '一般使用者'
        return grant.grantee_name || grant.grantee_id
    }

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <Share2 size={16} className="text-blue-500" />
                        <h3 className="font-semibold text-slate-800">共享設定 — {skill.name}</h3>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={16} /></button>
                </div>

                <div className="p-6 space-y-5">
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center justify-between">
                            {error}
                            <button onClick={() => setError('')}><X size={13} /></button>
                        </div>
                    )}

                    {/* Add form */}
                    <div className="space-y-3">
                        <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">新增共享對象</p>
                        <div className="flex gap-2">
                            <select
                                value={granteeType}
                                onChange={e => handleTypeChange(e.target.value)}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 shrink-0"
                            >
                                {Object.entries(GRANTEE_TYPE_LABELS).map(([val, label]) => (
                                    <option key={val} value={val}>{label}</option>
                                ))}
                            </select>

                            {granteeType === 'user' ? (
                                <UserPicker
                                    value={granteeId}
                                    display={userDisplay}
                                    onChange={(id, disp) => { setGranteeId(id); setUserDisplay(disp) }}
                                    className="flex-1"
                                />
                            ) : granteeType === 'role' ? (
                                <select
                                    value={granteeId}
                                    onChange={e => setGranteeId(e.target.value)}
                                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                >
                                    <option value="">請選擇角色</option>
                                    {roles.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
                                </select>
                            ) : (
                                <div className="flex-1 relative">
                                    <input
                                        value={orgSearch || granteeId}
                                        onChange={e => {
                                            const v = e.target.value
                                            setOrgSearch(v)
                                            setGranteeId(v.trim()) // free-text fallback
                                        }}
                                        placeholder={orgOptions.length > 0
                                            ? `篩選${GRANTEE_TYPE_LABELS[granteeType]}...`
                                            : `輸入${GRANTEE_TYPE_LABELS[granteeType]}代碼/名稱`}
                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                    />
                                    {orgOptions.length > 0 && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
                                            {orgOptions.map(opt => (
                                                <button key={opt.id} type="button"
                                                    onClick={() => { setGranteeId(opt.id); setOrgSearch(opt.name); setOrgOptions([]) }}
                                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center justify-between text-slate-700">
                                                    <span>{opt.name}</span>
                                                    {opt.sub && <span className="text-xs text-slate-400">{opt.sub}</span>}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <select
                                value={shareType}
                                onChange={e => setShareType(e.target.value as 'use' | 'develop')}
                                className="border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 shrink-0"
                            >
                                <option value="use">使用</option>
                                <option value="develop">開發</option>
                            </select>
                            <button
                                onClick={handleAdd}
                                disabled={submitting}
                                className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0 flex items-center gap-1"
                            >
                                <Plus size={14} />{submitting ? '...' : '新增'}
                            </button>
                        </div>
                    </div>

                    {/* Grants list */}
                    <div>
                        <p className="text-xs font-medium text-slate-600 uppercase tracking-wide mb-2">已共享對象</p>
                        {loadingGrants ? (
                            <p className="text-sm text-slate-400 py-4 text-center">載入中...</p>
                        ) : grants.length === 0 ? (
                            <p className="text-sm text-slate-400 py-4 text-center">尚未設定任何共享對象</p>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {grants.map(g => (
                                    <div key={g.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg border border-slate-100">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium shrink-0">
                                                {GRANTEE_TYPE_LABELS[g.grantee_type] || g.grantee_type}
                                            </span>
                                            <span className="text-sm text-slate-700 truncate">{getGranteeDisplay(g)}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                            <select
                                                value={g.share_type || 'use'}
                                                onChange={e => handleChangeShareType(g, e.target.value as 'use' | 'develop')}
                                                className={`text-xs border rounded px-1.5 py-0.5 ${g.share_type === 'develop' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                                            >
                                                <option value="use">使用</option>
                                                <option value="develop">開發</option>
                                            </select>
                                            <button
                                                onClick={() => handleDelete(g.id)}
                                                className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition"
                                                title="移除共享"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex justify-end px-6 py-4 border-t border-slate-100">
                    <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">關閉</button>
                </div>
            </div>
        </div>
    )
}

function SkillCard({ skill, onEdit, onDelete, onFork, onRequestPublic, onUse, onView, onShare, isOwner }: {
    skill: Skill
    onEdit?: () => void
    onDelete?: () => void
    onFork?: () => void
    onRequestPublic?: () => void
    onUse?: () => void
    onView?: () => void
    onShare?: () => void
    isOwner: boolean
}) {
    const statusBadge = skill.is_public && skill.is_admin_approved
        ? <span className="flex items-center gap-1 text-xs text-emerald-600"><Globe size={10} />公開</span>
        : skill.pending_approval
            ? <span className="flex items-center gap-1 text-xs text-amber-600"><Clock size={10} />審核中</span>
            : <span className="flex items-center gap-1 text-xs text-slate-400"><Lock size={10} />私人</span>

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition group">
            <div className="flex items-start gap-3 mb-3">
                <div className="text-3xl leading-none mt-0.5">{skill.icon}</div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-800 text-sm truncate">{skill.name}</h3>
                        <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${skill.type === 'external' ? 'bg-purple-100 text-purple-700' : skill.type === 'code' ? 'bg-emerald-100 text-emerald-700' : skill.type === 'workflow' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                            {skill.type === 'external' ? '外部' : skill.type === 'code' ? '程式' : skill.type === 'workflow' ? '工作流' : '內建'}
                        </span>
                        {skill.type === 'code' && skill.code_status && (
                            <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${skill.code_status === 'running' ? 'bg-emerald-50 text-emerald-600' : skill.code_status === 'error' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                                {skill.code_status === 'running' ? '運行中' : skill.code_status === 'error' ? '錯誤' : '已停止'}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{skill.description || '—'}</p>
                </div>
            </div>

            {skill.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                    {skill.tags.slice(0, 4).map(t => <span key={t} className="text-xs px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">{t}</span>)}
                </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-100 pt-3">
                <div className="flex items-center gap-2">
                    {statusBadge}
                    {skill.model_key && <span className="text-xs text-indigo-500">🔗{skill.model_key}</span>}
                </div>
                <div className="flex items-center gap-1">
                    {onUse && (
                        <button onClick={onUse} title="在對話中使用" className="p-1 rounded hover:bg-purple-50 text-slate-400 hover:text-purple-600 transition">
                            <MessageSquare size={13} />
                        </button>
                    )}
                    {!isOwner && onView && (
                        <button onClick={onView} title="檢視內容" className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition">
                            <Eye size={13} />
                        </button>
                    )}
                    {!isOwner && onFork && (
                        <button onClick={onFork} title="Fork 一份" className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
                            <GitFork size={13} />
                        </button>
                    )}
                    {isOwner && onEdit && (
                        <button onClick={onEdit} title="編輯" className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
                            <Pencil size={13} />
                        </button>
                    )}
                    {isOwner && !skill.is_public && !skill.pending_approval && onRequestPublic && (
                        <button onClick={onRequestPublic} title="申請公開" className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-emerald-600 transition">
                            <Send size={13} />
                        </button>
                    )}
                    {isOwner && onShare && (
                        <button onClick={onShare} title="共享設定" className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition">
                            <Share2 size={13} />
                        </button>
                    )}
                    {isOwner && onDelete && (
                        <button onClick={onDelete} title="刪除" className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition">
                            <Trash2 size={13} />
                        </button>
                    )}
                    {isOwner && onFork && (
                        <button onClick={onFork} title="複製一份" className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
                            <GitFork size={13} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Skill Call History ─────────────────────────────────────────────────────────

interface SkillCallLog {
    id: number
    user_id: number
    session_id: string | null
    query_preview: string | null
    response_preview: string | null
    status: string
    error_msg: string | null
    duration_ms: number | null
    called_at: string
    user_name: string | null
}

function SkillCallHistory({ skillId }: { skillId: number }) {
    const [logs, setLogs] = useState<SkillCallLog[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        api.get(`/skills/${skillId}/call-logs`).then((res) => {
            setLogs(res.data)
        }).catch(() => {}).finally(() => setLoading(false))
    }, [skillId])

    if (loading) return <div className="px-6 py-8 text-center text-slate-400 text-sm">載入中...</div>
    if (logs.length === 0) return (
        <div className="px-6 py-10 text-center text-slate-400">
            <History size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">尚無呼叫紀錄</p>
        </div>
    )

    return (
        <div className="px-6 py-4 max-h-96 overflow-y-auto">
            <p className="text-xs text-slate-400 mb-3">最近 100 筆呼叫紀錄</p>
            <div className="space-y-2">
                {logs.map((log) => (
                    <div key={log.id} className={`rounded-lg px-4 py-3 border text-sm ${log.status === 'ok' ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                                {log.status === 'ok'
                                    ? <CheckCircle size={13} className="text-green-500 shrink-0" />
                                    : <XCircle size={13} className="text-red-500 shrink-0" />}
                                <span className="text-xs text-slate-500">{log.user_name || `uid:${log.user_id}`}</span>
                                {log.duration_ms && <span className="text-xs text-slate-400">{log.duration_ms}ms</span>}
                            </div>
                            <span className="text-xs text-slate-400 whitespace-nowrap">{log.called_at}</span>
                        </div>
                        {log.query_preview && <p className="text-xs text-slate-600 truncate">Q: {log.query_preview}</p>}
                        {log.error_msg && <p className="text-xs text-red-600 truncate">錯誤: {log.error_msg}</p>}
                    </div>
                ))}
            </div>
        </div>
    )
}
