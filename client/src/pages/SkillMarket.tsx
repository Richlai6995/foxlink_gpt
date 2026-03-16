import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Plus, Search, Globe, Lock, GitFork, Send, Pencil, Trash2, Clock, X, ChevronDown, Zap, ArrowLeft, MessageSquare, Code2, Eye, Share2, History, CheckCircle, XCircle } from 'lucide-react'
import api from '../lib/api'
import TranslationFields, { type TranslationData } from '../components/common/TranslationFields'
import UserPicker from '../components/common/UserPicker'

interface Skill {
    id: number
    name: string
    description: string
    icon: string
    type: 'builtin' | 'external' | 'code'
    system_prompt?: string
    endpoint_url?: string
    endpoint_secret?: string
    endpoint_mode: 'inject' | 'answer'
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
}

interface Model { key: string; name: string }

const ICONS = ['🤖', '🧠', '📝', '💡', '🔍', '📊', '🎯', '🛠️', '📚', '🌐', '⚡', '🔬', '💬', '🎨', '🔧', '📋', '🚀', '🏭']

const EMPTY_FORM = {
    name: '', description: '', icon: '🤖', type: 'builtin' as 'builtin' | 'external' | 'code',
    system_prompt: '', endpoint_url: '', endpoint_secret: '', endpoint_mode: 'inject' as 'inject' | 'answer',
    model_key: '', mcp_tool_mode: 'append' as 'append' | 'exclusive' | 'disable',
    mcp_tool_ids: [] as number[], dify_kb_ids: [] as number[], tags: [] as string[],
    code_snippet: '', code_packages: [] as string[],
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

    const canCodeSkill = currentUser?.role === 'admin' || (currentUser as any)?.effective_allow_code_skill === true
    const canCreateSkill = currentUser?.role === 'admin' || (currentUser as any)?.effective_allow_create_skill === true
    const [viewingSkill, setViewingSkill] = useState<Skill | null>(null)
    const [sharingSkill, setSharingSkill] = useState<Skill | null>(null)
    const [editorTab, setEditorTab] = useState<'編輯' | '呼叫歷史'>('編輯')
    const [trans, setTrans] = useState<TranslationData>({})
    const [translating, setTranslating] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const params: Record<string, string> = {}
            if (q) params.q = q
            if (typeFilter) params.type = typeFilter
            const [skillsRes, modelsRes] = await Promise.all([
                api.get('/skills', { params }),
                api.get('/chat/models'),
            ])
            setSkills(skillsRes.data)
            setModels(modelsRes.data)
        } catch (e: any) {
            setError(e.response?.data?.error || '載入失敗')
        } finally {
            setLoading(false)
        }
    }, [q, typeFilter])

    useEffect(() => { load() }, [load])

    const openCreate = () => { setEditingSkill(null); setForm({ ...EMPTY_FORM }); setTagInput(''); setTrans({}); setEditorTab('編輯'); setShowEditor(true) }
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
        })
        setTrans({
            name_zh: (sk as any).name_zh || null, name_en: (sk as any).name_en || null, name_vi: (sk as any).name_vi || null,
            desc_zh: (sk as any).desc_zh || null, desc_en: (sk as any).desc_en || null, desc_vi: (sk as any).desc_vi || null,
        })
        setTagInput('')
        setPkgInput('')
        setEditorTab('編輯')
        setShowEditor(true)
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
        const payload = { ...form, tags: finalTags, code_packages: finalPkgs, ...trans }
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

                {/* Public Skills */}
                {publicSkills.length > 0 && (
                    <section>
                        <h2 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wide">公開技能</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {publicSkills.map(sk => <SkillCard key={sk.id} skill={sk} onFork={() => fork(sk)} onUse={() => navigate(`/chat?skillId=${sk.id}`)} onView={() => setViewingSkill(sk)} isOwner={false} />)}
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
                                    {editingSkill && (
                                        <div className="flex gap-1 border border-slate-200 rounded-lg p-0.5">
                                            {(['編輯', '呼叫歷史'] as const).map((t) => (
                                                <button key={t} onClick={() => setEditorTab(t)}
                                                    className={`px-3 py-1 rounded text-xs font-medium transition ${editorTab === t ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                                                    {t}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button onClick={() => setShowEditor(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={16} /></button>
                            </div>
                            {editorTab === '呼叫歷史' && editingSkill ? (
                                <SkillCallHistory skillId={editingSkill.id} />
                            ) : null}
                            <div className="p-6 space-y-4" style={editorTab === '呼叫歷史' ? { display: 'none' } : {}}>
                                {/* Basic */}
                                <div className="flex gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">圖示</label>
                                        <div className="relative">
                                            <select value={form.icon} onChange={e => setForm(p => ({ ...p, icon: e.target.value }))}
                                                className="appearance-none w-16 text-center text-xl border border-slate-200 rounded-lg py-2 focus:outline-none focus:ring-2 focus:ring-blue-300">
                                                {ICONS.map(i => <option key={i} value={i}>{i}</option>)}
                                            </select>
                                            <ChevronDown size={10} className="absolute right-1 bottom-3 text-slate-400 pointer-events-none" />
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
                                    </div>
                                </div>

                                {form.type === 'builtin' ? (
                                    <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">System Prompt</label>
                                        <textarea value={form.system_prompt} rows={6} onChange={e => setForm(p => ({ ...p, system_prompt: e.target.value }))}
                                            placeholder="輸入給 AI 的角色設定與指令..."
                                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y" />
                                    </div>
                                ) : form.type === 'external' ? (
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
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">回應模式</label>
                                            <div className="flex gap-2">
                                                {(['inject', 'answer'] as const).map(m => (
                                                    <button key={m} onClick={() => setForm(p => ({ ...p, endpoint_mode: m }))}
                                                        className={`px-3 py-1.5 rounded-lg text-xs border transition ${form.endpoint_mode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                                                        {m === 'inject' ? 'Inject（補充 Prompt）' : 'Answer（直接回答）'}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    /* code type */
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
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">回應模式</label>
                                            <div className="flex gap-2">
                                                {(['inject', 'answer'] as const).map(m => (
                                                    <button key={m} type="button" onClick={() => setForm(p => ({ ...p, endpoint_mode: m }))}
                                                        className={`px-3 py-1.5 rounded-lg text-xs border transition ${form.endpoint_mode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                                                        {m === 'inject' ? 'Inject（補充 Prompt）' : 'Answer（直接回答）'}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Model */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1">綁定模型（不設定則跟隨使用者選擇）</label>
                                    <select value={form.model_key} onChange={e => setForm(p => ({ ...p, model_key: e.target.value }))}
                                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-300">
                                        <option value="">不綁定</option>
                                        {models.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
                                    </select>
                                </div>

                                {/* Tags */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1">標籤</label>
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

                                {error && <p className="text-sm text-red-600">{error}</p>}
                            </div>
                            {editorTab === '編輯' && (
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
                                    <div><span className="text-xs text-slate-400 block">類型</span><p className="text-slate-700">{viewingSkill.type === 'builtin' ? '內建 Prompt' : viewingSkill.type === 'external' ? '外部 Endpoint' : '內部程式'}</p></div>
                                    <div><span className="text-xs text-slate-400 block">端點模式</span><p className="text-slate-700">{viewingSkill.endpoint_mode}</p></div>
                                    {viewingSkill.model_key && <div><span className="text-xs text-slate-400 block">指定模型</span><p className="text-slate-700">{viewingSkill.model_key}</p></div>}
                                    <div><span className="text-xs text-slate-400 block">MCP 工具模式</span><p className="text-slate-700">{viewingSkill.mcp_tool_mode}</p></div>
                                </div>
                                {viewingSkill.system_prompt && (
                                    <div>
                                        <p className="text-xs text-slate-400 mb-1">System Prompt</p>
                                        <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">{viewingSkill.system_prompt}</pre>
                                    </div>
                                )}
                                {viewingSkill.endpoint_url && (
                                    <div><span className="text-xs text-slate-400 block">Endpoint URL</span><p className="text-slate-700 font-mono text-xs break-all">{viewingSkill.endpoint_url}</p></div>
                                )}
                                {viewingSkill.type === 'code' && viewingSkill.code_snippet && (
                                    <div>
                                        <p className="text-xs text-slate-400 mb-1">程式碼</p>
                                        <pre className="bg-slate-950 rounded-lg p-3 text-xs text-emerald-300 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">{viewingSkill.code_snippet}</pre>
                                    </div>
                                )}
                                {viewingSkill.tags && viewingSkill.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {viewingSkill.tags.map(t => <span key={t} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">{t}</span>)}
                                    </div>
                                )}
                                <p className="text-xs text-slate-400">建立者：{viewingSkill.owner_name || '—'}</p>
                            </div>
                            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
                                <button onClick={() => { fork(viewingSkill); setViewingSkill(null) }} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><GitFork size={14} />Fork 一份</button>
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
    granted_by: number | null
    granted_by_name?: string
    granted_at: string
}

function SkillShareModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
    const [grants, setGrants] = useState<GrantRecord[]>([])
    const [loadingGrants, setLoadingGrants] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [granteeType, setGranteeType] = useState<string>('user')
    const [granteeId, setGranteeId] = useState<string>('')
    const [userDisplay, setUserDisplay] = useState<string>('')

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

    const handleTypeChange = (t: string) => {
        setGranteeType(t)
        setGranteeId('')
        setUserDisplay('')
    }

    const handleAdd = async () => {
        const finalId = granteeType === 'user' ? granteeId : granteeId.trim()
        if (!finalId) return setError('請填寫共享對象')
        setSubmitting(true)
        setError('')
        try {
            await api.post(`/skills/${skill.id}/access`, { grantee_type: granteeType, grantee_id: finalId })
            setGranteeId('')
            setUserDisplay('')
            await loadGrants()
        } catch (e: any) {
            setError(e.response?.data?.error || '新增失敗')
        } finally {
            setSubmitting(false)
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
                                    <option value="admin">系統管理員</option>
                                    <option value="user">一般使用者</option>
                                </select>
                            ) : (
                                <input
                                    value={granteeId}
                                    onChange={e => setGranteeId(e.target.value)}
                                    placeholder={
                                        granteeType === 'dept' ? '部門代碼' :
                                        granteeType === 'profit_center' ? '利潤中心代碼' :
                                        granteeType === 'org_section' ? '事業處名稱' :
                                        '事業群名稱'
                                    }
                                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                />
                            )}

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
                                        <button
                                            onClick={() => handleDelete(g.id)}
                                            className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition shrink-0 ml-2"
                                            title="移除共享"
                                        >
                                            <Trash2 size={13} />
                                        </button>
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
    onFork: () => void
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
                        <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${skill.type === 'external' ? 'bg-purple-100 text-purple-700' : skill.type === 'code' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                            {skill.type === 'external' ? '外部' : skill.type === 'code' ? '程式' : '內建'}
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
                    {!isOwner && (
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
                    {isOwner && (
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
