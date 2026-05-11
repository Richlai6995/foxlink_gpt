/**
 * HomeTabs — /projects-platform 首頁
 *
 * Tabs:
 *   📁 專案列表   — Sprint 1+2 demo
 *   📋 Overview   — Internal Admin sub-page status
 *   ⚙ System Health — Feature flag / LLM Queue / Plugins (admin only)
 *
 * Phase 0:預設停在「Overview」
 * Sprint 1+2 ship 後:預設停在「專案列表」
 */

import { useState } from 'react'
import { useProjectsPlatformVisibility } from '../../hooks/useProjectsPlatformVisibility'
import InternalAdminOverview from './InternalAdmin/Overview'
import SystemHealthPage from './InternalAdmin/SystemHealth'
import ProjectsList from './Projects/ProjectsList'

type View = 'projects' | 'overview' | 'system-health'

export default function HomeTabs() {
  const v = useProjectsPlatformVisibility()
  const [view, setView] = useState<View>('projects')

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-sky-300">📁 專案管理平台</h1>
            <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-300 rounded">
              beta · Sprint 2
            </span>
            {v.mode === 'admin' && (
              <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-300 rounded">
                admin mode
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">
            v0.4 — 對齊 OIBG RFQ flow + AI 加速。Sprint 1+2 demo:CRUD + 戰情會議室。
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-700 mb-6">
          <TabButton active={view === 'projects'} onClick={() => setView('projects')}>
            📁 專案列表
          </TabButton>
          <TabButton active={view === 'overview'} onClick={() => setView('overview')}>
            📋 Overview
          </TabButton>
          {v.features?.internal_admin && (
            <TabButton active={view === 'system-health'} onClick={() => setView('system-health')}>
              ⚙ System Health
            </TabButton>
          )}
        </div>

        {/* Content */}
        {view === 'projects' && <ProjectsList />}
        {view === 'overview' && <InternalAdminOverview />}
        {view === 'system-health' && <SystemHealthPage />}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm transition ${
        active
          ? 'border-b-2 border-sky-400 text-sky-300'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}
