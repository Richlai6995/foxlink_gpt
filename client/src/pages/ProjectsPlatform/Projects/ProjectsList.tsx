/**
 * ProjectsList — 列出所有 user 可看的專案
 *
 * - 顯示 project_code / type / title / lifecycle / importance / 更新時間
 * - 提供建案按鈕(開 NewProjectDialog)
 * - 點 row 進詳細頁
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, Project, ProjectType } from '../api'
import NewProjectDialog from './NewProjectDialog'

const LIFECYCLE_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT:    { label: '草稿',     cls: 'bg-slate-700/40 text-slate-300 border-slate-600/50' },
  ACTIVE:   { label: '進行中',   cls: 'bg-green-700/30 text-green-300 border-green-700/50' },
  PAUSED:   { label: '暫停',     cls: 'bg-amber-700/30 text-amber-300 border-amber-700/50' },
  CLOSED:   { label: '已結案',   cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  REOPENED: { label: '重啟',     cls: 'bg-sky-700/30 text-sky-300 border-sky-700/50' },
}

const IMPORTANCE_DOT: Record<string, string> = {
  HIGH:   'bg-red-500',
  NORMAL: 'bg-slate-500',
  LOW:    'bg-slate-700',
}

export default function ProjectsList() {
  const { token } = useAuth() as any
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [types, setTypes] = useState<ProjectType[]>([])
  const [filter, setFilter] = useState<{ status?: string; type_code?: string }>({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const reload = async () => {
    setLoading(true)
    setErr(null)
    try {
      const qs = new URLSearchParams()
      if (filter.status) qs.set('status', filter.status)
      if (filter.type_code) qs.set('type_code', filter.type_code)
      const path = '/projects' + (qs.toString() ? `?${qs}` : '')
      const data = await api.get<{ projects: Project[] }>(token, path)
      setProjects(data.projects || [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    api.get<{ types: ProjectType[] }>(token, '/projects/types')
      .then((d) => setTypes(d.types || []))
      .catch(() => {})
  }, [token])

  useEffect(() => {
    if (token) reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filter.status, filter.type_code])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-700 hover:bg-sky-600 text-white text-sm rounded transition"
        >
          <Plus size={14} /> 建立專案
        </button>
        <button
          onClick={reload}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded transition"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新整理
        </button>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={filter.type_code || ''}
            onChange={(e) => setFilter({ ...filter, type_code: e.target.value || undefined })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="">所有類型</option>
            {types.map((t) => (
              <option key={t.type_code} value={t.type_code}>{t.type_code}</option>
            ))}
          </select>
          <select
            value={filter.status || ''}
            onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="">所有狀態</option>
            <option value="DRAFT">草稿</option>
            <option value="ACTIVE">進行中</option>
            <option value="PAUSED">暫停</option>
            <option value="CLOSED">已結案</option>
            <option value="REOPENED">重啟</option>
          </select>
        </div>
      </div>

      {err && (
        <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-300 text-sm">
          {err}
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-800/40 border border-slate-700 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/50 text-slate-400 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Code</th>
              <th className="text-left px-4 py-2.5">類型</th>
              <th className="text-left px-4 py-2.5">標題</th>
              <th className="text-left px-4 py-2.5">狀態</th>
              <th className="text-left px-4 py-2.5">重要</th>
              <th className="text-left px-4 py-2.5">更新</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  尚無專案 — 點「建立專案」開始
                </td>
              </tr>
            )}
            {projects.map((p) => {
              const lc = LIFECYCLE_BADGE[p.lifecycle_status] || LIFECYCLE_BADGE.DRAFT
              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/projects-platform/projects/${p.id}`)}
                  className="border-t border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition"
                >
                  <td className="px-4 py-2.5 font-mono text-sky-300">{p.project_code}</td>
                  <td className="px-4 py-2.5 text-slate-300">{p.type_code}</td>
                  <td className="px-4 py-2.5 text-slate-200">{p.data_payload?.title || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 text-xs rounded border ${lc.cls}`}>
                      {lc.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                      <span className={`w-2 h-2 rounded-full ${IMPORTANCE_DOT[p.importance] || 'bg-slate-600'}`} />
                      {p.importance}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {p.updated_at ? new Date(p.updated_at).toLocaleString('zh-TW') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewProjectDialog
          types={types}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false)
            navigate(`/projects-platform/projects/${id}`)
          }}
        />
      )}
    </div>
  )
}
