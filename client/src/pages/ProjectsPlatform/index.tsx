/**
 * ProjectsPlatform 入口頁(Phase 0 scaffold)
 *
 * Phase 0:只給 admin 看到 sidebar menu;進來看到 Internal Admin Overview
 * Phase 1+:加入儀表板 / 專案列表 / Wizard 等 user 頁面
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useProjectsPlatformVisibility } from '../../hooks/useProjectsPlatformVisibility'
import InternalAdminOverview from './InternalAdmin/Overview'
import SystemHealthPage from './InternalAdmin/SystemHealth'

type View = 'overview' | 'system-health'

export default function ProjectsPlatformPage() {
  const v = useProjectsPlatformVisibility()
  const navigate = useNavigate()
  const [view, setView] = useState<View>('overview')

  useEffect(() => {
    if (v.mode === 'hidden') {
      // 不該進來,踢回 chat
      navigate('/chat', { replace: true })
    }
  }, [v.mode, navigate])

  if (!v.can_see) return null

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-cyan-300">📁 專案管理平台</h1>
            <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-300 rounded">
              beta · Phase 0 scaffold
            </span>
            {v.mode === 'admin' && (
              <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-300 rounded">
                admin mode
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">
            v0.4 — 對齊 OIBG RFQ flow + AI 加速。目前 scaffold 階段,各功能逐 sprint 上線。
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-700 mb-6">
          <button
            onClick={() => setView('overview')}
            className={`px-4 py-2 text-sm transition ${
              view === 'overview'
                ? 'border-b-2 border-cyan-400 text-cyan-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📋 Overview
          </button>
          {v.features?.internal_admin && (
            <button
              onClick={() => setView('system-health')}
              className={`px-4 py-2 text-sm transition ${
                view === 'system-health'
                  ? 'border-b-2 border-cyan-400 text-cyan-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ⚙ System Health
            </button>
          )}
        </div>

        {/* Content */}
        {view === 'overview' && <InternalAdminOverview />}
        {view === 'system-health' && <SystemHealthPage />}
      </div>
    </div>
  )
}
