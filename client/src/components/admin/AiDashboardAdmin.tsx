/**
 * AiDashboardAdmin — 管理員 AI 戰情室管理
 * 以 Project 為主軸，顯示所有專案清單，可管理暫停狀態及分享設定
 */
import { useState, useEffect } from 'react'
import { Pause, Play, Share2, Trash2, Plus, CheckCircle, XCircle } from 'lucide-react'
import api from '../../lib/api'
import type { AiSelectProject, AiProjectShare } from '../../types'

function ProjectSharePanel({ project, onClose }: { project: AiSelectProject; onClose: () => void }) {
  const [shares, setShares] = useState<AiProjectShare[]>([])
  const [form, setForm] = useState({ grantee_type: 'user', grantee_id: '', share_type: 'use' as 'use' | 'develop' })
  const [loading, setLoading] = useState(false)

  const load = () => api.get(`/dashboard/projects/${project.id}/shares`).then(r => setShares(r.data)).catch(() => {})
  useEffect(() => { load() }, [project.id])

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
          <div className="bg-gray-50 rounded-xl p-3 space-y-2">
            <p className="text-xs text-gray-500 font-medium">新增分享</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">授權對象類型</label>
                <select className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  value={form.grantee_type} onChange={e => setForm(p => ({ ...p, grantee_type: e.target.value }))}>
                  <option value="user">使用者</option>
                  <option value="role">角色</option>
                  <option value="department">部門</option>
                  <option value="cost_center">利潤中心</option>
                  <option value="division">組織段</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">ID / 代碼</label>
                <input className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  value={form.grantee_id} onChange={e => setForm(p => ({ ...p, grantee_id: e.target.value }))}
                  placeholder="輸入對應 ID" />
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" value="use" checked={form.share_type === 'use'}
                  onChange={() => setForm(p => ({ ...p, share_type: 'use' }))} />
                使用（查詢）
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" value="develop" checked={form.share_type === 'develop'}
                  onChange={() => setForm(p => ({ ...p, share_type: 'develop' }))} />
                開發及使用
              </label>
            </div>
            <button onClick={add} disabled={loading || !form.grantee_id.trim()}
              className="flex items-center gap-1 text-xs bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50">
              <Plus size={12} /> {loading ? '新增中...' : '新增'}
            </button>
          </div>
          {shares.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">尚無分享設定</p>
          ) : (
            <div className="space-y-1.5">
              {shares.map(s => (
                <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-600">
                    <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded mr-2">{s.grantee_type}</span>
                    <span className="font-mono">{s.grantee_id}</span>
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

export default function AiDashboardAdmin() {
  const [projects, setProjects] = useState<AiSelectProject[]>([])
  const [loading, setLoading] = useState(true)
  const [shareProject, setShareProject] = useState<AiSelectProject | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/dashboard/admin/shares')
      setProjects(r.data)
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleSuspend = async (p: AiSelectProject) => {
    await api.patch(`/dashboard/projects/${p.id}/suspend`, { suspended: !p.is_suspended })
    load()
  }

  const approvePublic = async (p: AiSelectProject, approved: boolean) => {
    const msg = approved ? `核准「${p.name}」設為公開？` : `拒絕「${p.name}」的公開申請（將取消公開）？`
    if (!confirm(msg)) return
    await api.patch(`/dashboard/projects/${p.id}/approve-public`, { approved })
    load()
  }

  return (
    <div className="space-y-4">
      {shareProject && (
        <ProjectSharePanel project={shareProject}
          onClose={() => { setShareProject(null); load() }} />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">AI 戰情室管理</h2>
        <button onClick={load} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1">
          重整
        </button>
      </div>

      <p className="text-xs text-slate-500">
        管理所有 AI 查詢專案的可見性、分享授權及暫停狀態。
      </p>

      {loading ? (
        <p className="text-slate-400 text-sm">載入中...</p>
      ) : projects.length === 0 ? (
        <div className="text-slate-400 text-sm p-8 text-center border border-dashed rounded-lg">
          尚無查詢專案
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">專案名稱</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">建立者</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">公開</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">主題數</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">分享數</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">狀態</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map(p => (
                <tr key={p.id} className={`hover:bg-slate-50 ${p.is_suspended ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-800">
                    {p.name}
                    {p.is_suspended === 1 && (
                      <span className="ml-2 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">已暫停</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{p.creator_name || '-'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {p.is_public === 1 && p.public_approved === 1 ? (
                      <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded">公開</span>
                    ) : p.is_public === 1 && !p.public_approved ? (
                      <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded">待核准</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs text-slate-600">{p.topic_count ?? 0}</td>
                  <td className="px-4 py-2.5 text-center text-xs text-slate-600">{(p as any).share_count ?? 0}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${p.is_suspended ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>
                      {p.is_suspended ? '暫停中' : '正常'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-2">
                      {/* 待核准的公開申請：顯示核准/拒絕按鈕 */}
                      {p.is_public === 1 && !p.public_approved && (
                        <>
                          <button onClick={() => approvePublic(p, true)} title="核准公開"
                            className="p-1 text-slate-400 hover:text-green-600 rounded hover:bg-slate-100">
                            <CheckCircle size={14} />
                          </button>
                          <button onClick={() => approvePublic(p, false)} title="拒絕公開"
                            className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100">
                            <XCircle size={14} />
                          </button>
                        </>
                      )}
                      <button onClick={() => setShareProject(p)} title="分享設定"
                        className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-slate-100">
                        <Share2 size={14} />
                      </button>
                      <button onClick={() => toggleSuspend(p)} title={p.is_suspended ? '恢復' : '暫停'}
                        className={`p-1 rounded hover:bg-slate-100 ${p.is_suspended ? 'text-orange-400 hover:text-green-600' : 'text-slate-400 hover:text-orange-500'}`}>
                        {p.is_suspended ? <Play size={14} /> : <Pause size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
