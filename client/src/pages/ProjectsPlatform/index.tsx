/**
 * ProjectsPlatform 入口
 *
 * 設計變更(2026-05-12):
 *   依照 docs/Cortex_互動Demo.html(Ocean Depth + Cyan)重新設計風格,
 *   進入 /projects-platform/* 後完全獨立 shell(navy topbar + slide-in sidebar),
 *   Cortex 主站 sidebar 不顯示(對齊 spec slide 4「Cortex 加一個 menu 入口」)。
 *
 * Routes:
 *   /projects-platform                              → ProjectsList(我的專案)
 *   /projects-platform/projects/:id                 → WarRoom(戰情會議室)
 *   /projects-platform/internal-admin/overview      → Internal Admin Overview(admin only)
 *   /projects-platform/internal-admin/system-health → System Health(admin only)
 */

import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useProjectsPlatformVisibility } from '../../hooks/useProjectsPlatformVisibility'
import { PlatformProvider } from './Shell/PlatformContext'
import PlatformShell from './Shell/PlatformShell'
import ProjectsList from './Projects/ProjectsList'
import WarRoom from './WarRoom/WarRoom'
import Dashboard from './Dashboard/Dashboard'
import AiAcceleration from './AiAccel/AiAcceleration'
import KnowledgeBase from './KB/KnowledgeBase'
import FormTemplates from './Admin/FormTemplates'
import TaskTemplates from './Admin/TaskTemplates'
import NotificationRules from './Admin/NotificationRules'
import Connections from './Admin/Connections'
import ConfidentialPolicies from './Admin/ConfidentialPolicies'
import RoleGrants from './Admin/RoleGrants'
import MessagesPage from './Messages/MessagesPage'
import ApprovalsPage from './Approvals/ApprovalsPage'
import InternalAdminOverview from './InternalAdmin/Overview'
import SystemHealthPage from './InternalAdmin/SystemHealth'

export default function ProjectsPlatformPage() {
  const v = useProjectsPlatformVisibility()
  const navigate = useNavigate()

  // Loading
  if (v.mode === 'loading') {
    return (
      <div className="min-h-screen bg-cortex-bg text-cortex-muted flex items-center justify-center font-cortex">
        <span className="text-sm">確認權限中…</span>
      </div>
    )
  }

  // 不可見 — 顯示診斷頁(對齊 docs/Cortex_互動Demo 風格)
  if (!v.can_see) {
    return (
      <div className="min-h-screen bg-cortex-bg text-cortex-text font-cortex flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white border border-cortex-line rounded-lg shadow-cortex p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🔒</span>
            <h2 className="text-lg font-bold text-cortex-ink">無法存取 Cortex 專案管理平台</h2>
          </div>
          <p className="text-sm text-cortex-text mb-4">
            原因:<code className="text-amber-700 bg-cortex-amber-bg px-1.5 py-0.5 rounded">{v.reason || 'unknown'}</code>
          </p>
          <div className="bg-cortex-bg border border-cortex-line rounded p-3 text-xs text-cortex-muted space-y-1.5 mb-4">
            <DiagItem label="mode"    value={v.mode} />
            <DiagItem label="reason"  value={v.reason || '—'} />
            {v.user && (
              <>
                <DiagItem label="user.id"       value={String(v.user.id)} mono />
                <DiagItem label="user.username" value={v.user.username} />
                <DiagItem label="user.role"     value={v.user.role} />
              </>
            )}
            {v.api_error && <DiagItem label="api_error" value={v.api_error} mono />}
          </div>
          <div className="space-y-2 text-xs text-cortex-muted">
            <p className="font-semibold text-cortex-text">可能的解決方式:</p>
            {v.reason === 'not-admin-not-pilot' && (
              <>
                <p>• Phase 0 只給 admin 看到此功能</p>
                <p>• 改用 admin 帳號登入(server/.env 的 DEFAULT_ADMIN_ACCOUNT)</p>
                <p>• 或請 admin 把你的 user_id 加進 server/.env 的 PILOT_USERS</p>
              </>
            )}
            {v.reason === 'api-error' && (
              <>
                <p>• server 沒啟用 module:檢查 server/.env 是否設 ENABLE_PROJECTS_PLATFORM=true</p>
                <p>• 改完 .env 後必須重啟 server</p>
              </>
            )}
            {v.reason === 'no-user' && <p>• 尚未登入</p>}
          </div>
          <button
            onClick={() => navigate('/chat')}
            className="mt-5 px-3 py-1.5 bg-cortex-navy text-white text-sm rounded hover:opacity-90 transition"
          >
            返回對話
          </button>
        </div>
      </div>
    )
  }

  // Visible — 走 shell
  return (
    <PlatformProvider>
      <PlatformShell>
        <Routes>
          <Route index element={<ProjectsList />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="ai-acceleration" element={<AiAcceleration />} />
          <Route path="kb" element={<KnowledgeBase />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="projects/:id" element={<WarRoom />} />
          <Route path="admin/form-templates" element={<FormTemplates />} />
          <Route path="admin/task-templates" element={<TaskTemplates />} />
          <Route path="admin/notification-rules" element={<NotificationRules />} />
          <Route path="admin/connections" element={<Connections />} />
          <Route path="admin/confidential-policies" element={<ConfidentialPolicies />} />
          <Route path="admin/role-grants" element={<AdminGuard mode={v.mode}><RoleGrants /></AdminGuard>} />
          <Route path="internal-admin/overview" element={<AdminGuard mode={v.mode}><InternalAdminOverview /></AdminGuard>} />
          <Route path="internal-admin/system-health" element={<AdminGuard mode={v.mode}><SystemHealthPage /></AdminGuard>} />
          <Route path="*" element={<Navigate to="" replace />} />
        </Routes>
      </PlatformShell>
    </PlatformProvider>
  )
}

function AdminGuard({ mode, children }: { mode: string; children: React.ReactNode }) {
  if (mode !== 'admin') {
    return (
      <div className="bg-white border border-cortex-line rounded p-6 text-center text-cortex-muted">
        Internal admin 限 Cortex admin 進入(目前:{mode})
      </div>
    )
  }
  return <>{children}</>
}

function DiagItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-cortex-muted shrink-0 w-20">{label}:</span>
      <span className={`text-cortex-ink break-all ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  )
}
