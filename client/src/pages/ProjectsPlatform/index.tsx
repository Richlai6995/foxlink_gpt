/**
 * ProjectsPlatform 入口 — Routes + Tabs(home view)
 *
 * 設計變更(2026-05-11):
 *   原本 visibility=hidden 會「靜默 redirect 回 /chat」— debug 起來很痛苦
 *   改成顯示診斷頁,讓 user / dev 看到「為什麼進不來」
 */

import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useProjectsPlatformVisibility } from '../../hooks/useProjectsPlatformVisibility'
import HomeTabs from './HomeTabs'
import ProjectDetail from './Projects/ProjectDetail'

export default function ProjectsPlatformPage() {
  const v = useProjectsPlatformVisibility()
  const navigate = useNavigate()

  // Loading
  if (v.mode === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-400 flex items-center justify-center">
        <span className="text-sm">確認權限中…</span>
      </div>
    )
  }

  // 不可見 — 顯示診斷頁,不再靜默 redirect
  if (!v.can_see) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-200 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🔒</span>
            <h2 className="text-lg font-semibold text-amber-300">無法存取專案管理平台</h2>
          </div>
          <p className="text-sm text-slate-300 mb-4">
            原因:<code className="text-amber-300 bg-slate-900 px-1.5 py-0.5 rounded">{v.reason || 'unknown'}</code>
          </p>

          <div className="bg-slate-900/60 border border-slate-700 rounded p-3 text-xs text-slate-400 space-y-1.5 mb-4">
            <DiagItem label="mode"      value={v.mode} />
            <DiagItem label="reason"    value={v.reason || '—'} />
            {v.user && (
              <>
                <DiagItem label="user.id"       value={String(v.user.id)} mono />
                <DiagItem label="user.username" value={v.user.username} />
                <DiagItem label="user.role"     value={v.user.role} />
              </>
            )}
            {v.api_error && <DiagItem label="api_error" value={v.api_error} mono />}
          </div>

          <div className="space-y-2 text-xs text-slate-400">
            <p className="font-semibold text-slate-300">可能的解決方式:</p>
            {v.reason === 'not-admin-not-pilot' && (
              <>
                <p>• Phase 0 只給 admin 看到此功能(visibility evolution plan §A.3)</p>
                <p>• 改用 admin 帳號登入(server/.env 的 <code className="text-cyan-400">DEFAULT_ADMIN_ACCOUNT</code>)</p>
                <p>• 或請 admin 把你的 user_id 加進 server/.env 的 <code className="text-cyan-400">PILOT_USERS</code></p>
              </>
            )}
            {v.reason === 'api-error' && (
              <>
                <p>• server 沒啟用 module:檢查 server/.env 是否設 <code className="text-cyan-400">ENABLE_PROJECTS_PLATFORM=true</code></p>
                <p>• 改完 .env 後必須重啟 server</p>
                <p>• 確認 server log 有出現 <code className="text-cyan-400">[Route] /api/projects (projects-platform v0.4) OK</code></p>
              </>
            )}
            {v.reason === 'no-user' && <p>• 尚未登入</p>}
            {v.reason === 'no-role-no-membership' && <p>• GA mode 下,需有 project role 或為任一 project 成員</p>}
          </div>

          <button
            onClick={() => navigate('/chat')}
            className="mt-5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded transition"
          >
            返回對話
          </button>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route index element={<HomeTabs />} />
      <Route path="projects/:id" element={<ProjectDetail />} />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  )
}

function DiagItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-500 shrink-0 w-20">{label}:</span>
      <span className={`text-slate-200 break-all ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  )
}
