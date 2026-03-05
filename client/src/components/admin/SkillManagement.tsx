import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, Clock, Globe, Lock, Pencil, X, ChevronDown } from 'lucide-react'
import api from '../../lib/api'

interface Skill {
    id: number
    name: string
    description: string
    icon: string
    type: 'builtin' | 'external'
    system_prompt?: string
    endpoint_url?: string
    endpoint_secret?: string
    endpoint_mode: string
    model_key?: string | null
    mcp_tool_mode: string
    tags: number[]
    owner_name?: string
    owner_username?: string
    is_public: number
    is_admin_approved: number
    pending_approval: number
    created_at: string
}

export default function SkillManagement() {
    const [skills, setSkills] = useState<Skill[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await api.get('/admin/skills')
            setSkills(res.data)
        } catch (e: any) {
            setError(e.response?.data?.error || '載入失敗')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const approve = async (id: number) => {
        try { await api.put(`/admin/skills/${id}/approve`); load() }
        catch (e: any) { setError(e.response?.data?.error || '審核失敗') }
    }

    const reject = async (id: number) => {
        try { await api.put(`/admin/skills/${id}/reject`); load() }
        catch (e: any) { setError(e.response?.data?.error || '操作失敗') }
    }

    const saveEdit = async () => {
        if (!editingSkill) return
        setSaving(true)
        try {
            await api.put(`/admin/skills/${editingSkill.id}`, {
                is_public: editingSkill.is_public,
                is_admin_approved: editingSkill.is_admin_approved,
            })
            setEditingSkill(null)
            load()
        } catch (e: any) {
            setError(e.response?.data?.error || '儲存失敗')
        } finally {
            setSaving(false)
        }
    }

    const pending = skills.filter(s => s.pending_approval)
    const others = skills.filter(s => !s.pending_approval)

    return (
        <div>
            <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold text-slate-800">技能管理</h2>
                <span className="text-xs text-slate-400">{skills.length} 個技能</span>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2">
                    {error}<button onClick={() => setError('')}><X size={13} /></button>
                </div>
            )}

            {/* Pending */}
            {pending.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-1.5">
                        <Clock size={14} />待審核 ({pending.length})
                    </h3>
                    <div className="space-y-2">
                        {pending.map(sk => (
                            <div key={sk.id} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                <span className="text-xl">{sk.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-slate-800">{sk.name}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${sk.type === 'external' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{sk.type === 'external' ? '外部' : '內建'}</span>
                                    </div>
                                    <p className="text-xs text-slate-500 truncate">{sk.description || '—'} · 建立者: {sk.owner_name || sk.owner_username}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => approve(sk.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                                        <CheckCircle size={12} />核准
                                    </button>
                                    <button onClick={() => reject(sk.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100">
                                        <XCircle size={12} />拒絕
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* All skills table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">技能</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">類型</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">建立者</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">狀態</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && (
                                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">載入中...</td></tr>
                            )}
                            {!loading && others.map(sk => (
                                <tr key={sk.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                        <span className="mr-2 text-lg">{sk.icon}</span>
                                        <span className="font-medium text-slate-800">{sk.name}</span>
                                        {sk.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{sk.description}</p>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${sk.type === 'external' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                            {sk.type === 'external' ? '外部' : '內建'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600 text-xs">{sk.owner_name || sk.owner_username || '—'}</td>
                                    <td className="px-4 py-3">
                                        {sk.is_public && sk.is_admin_approved
                                            ? <span className="flex items-center gap-1 text-xs text-emerald-600"><Globe size={11} />公開</span>
                                            : <span className="flex items-center gap-1 text-xs text-slate-400"><Lock size={11} />私人</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-1">
                                            {sk.is_public && sk.is_admin_approved
                                                ? <button onClick={() => reject(sk.id)} title="取消公開" className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><XCircle size={14} /></button>
                                                : <button onClick={() => approve(sk.id)} title="設為公開" className="p-1 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600"><CheckCircle size={14} /></button>
                                            }
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
