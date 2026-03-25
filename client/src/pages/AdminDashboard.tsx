import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, BarChart3, Shield, AlertTriangle, Database, Mail, ArrowLeft, Cpu, DollarSign, CalendarClock, Plug, Zap, UserCog, Sparkles, Code2, Search, KeyRound, MonitorPlay, Lock, Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import UserManagement from '../components/admin/UserManagement'
import TokenUsagePanel from '../components/admin/TokenUsage'
import AuditLogs from '../components/admin/AuditLogs'
import SensitiveKeywords from '../components/admin/SensitiveKeywords'
import DbMaintenance from '../components/admin/DbMaintenance'
import MailSettingsPanel from '../components/admin/MailSettings'
import LlmModelsPanel from '../components/admin/LlmModels'
import VectorDefaultsPanel from '../components/admin/VectorDefaultsPanel'
import CostAnalysis from '../components/admin/CostAnalysis'
import ScheduledTasksPanel from '../components/admin/ScheduledTasksPanel'
import MCPServersPanel from '../components/admin/MCPServersPanel'
import DifyKnowledgeBasesPanel from '../components/admin/DifyKnowledgeBasesPanel'
import RoleManagement from '../components/admin/RoleManagement'
import SkillManagement from '../components/admin/SkillManagement'
import CodeRunnersPanel from '../components/admin/CodeRunnersPanel'
import KbAdminPanel from '../components/admin/KbAdminPanel'
import ResearchLogsPanel from '../components/admin/ResearchLogsPanel'
import ApiKeysPanel from '../components/admin/ApiKeysPanel'
import AiDashboardAdmin from '../components/admin/AiDashboardAdmin'
import DataPermissionsPanel from '../components/admin/DataPermissionsPanel'
import MonitorPage from '../components/monitor/MonitorPage'
import DbSourcesPanel from '../components/admin/DbSourcesPanel'
type Tab = 'users' | 'roles' | 'tokens' | 'audit' | 'keywords' | 'db' | 'mail' | 'llm' | 'vector-defaults' | 'cost' | 'scheduled' | 'mcp' | 'dify' | 'kb' | 'skills' | 'code-runners' | 'research' | 'api-keys' | 'ai-dashboard' | 'data-permissions' | 'monitor' | 'db-sources'

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('users')
  const navigate = useNavigate()
  const { t } = useTranslation()

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'users', label: t('admin.tabs.users'), icon: <Users size={16} /> },
    { id: 'roles', label: t('admin.tabs.roles'), icon: <UserCog size={16} /> },
    { id: 'tokens', label: t('admin.tabs.tokens'), icon: <BarChart3 size={16} /> },
    { id: 'cost', label: t('admin.tabs.cost'), icon: <DollarSign size={16} /> },
    { id: 'audit', label: t('admin.tabs.audit'), icon: <Shield size={16} /> },
    { id: 'keywords', label: t('admin.tabs.keywords'), icon: <AlertTriangle size={16} /> },
    { id: 'research', label: t('admin.tabs.research'), icon: <Search size={16} /> },
    { id: 'api-keys', label: t('admin.tabs.apiKeys'), icon: <KeyRound size={16} /> },
    { id: 'scheduled', label: t('admin.tabs.scheduled'), icon: <CalendarClock size={16} /> },
    { id: 'mcp', label: t('admin.tabs.mcp'), icon: <Plug size={16} /> },
    { id: 'dify', label: t('admin.tabs.dify'), icon: <Zap size={16} /> },
    { id: 'kb', label: t('admin.tabs.kb'), icon: <Database size={16} /> },
    { id: 'skills', label: t('admin.tabs.skills'), icon: <Sparkles size={16} /> },
    { id: 'code-runners', label: t('admin.tabs.codeRunners'), icon: <Code2 size={16} /> },
    { id: 'ai-dashboard', label: t('admin.tabs.aiDashboard'), icon: <MonitorPlay size={16} /> },
    { id: 'data-permissions', label: t('admin.tabs.dataPermissions'), icon: <Lock size={16} /> },
    { id: 'db-sources', label: 'DB 來源管理', icon: <Database size={16} /> },
    { id: 'monitor', label: t('admin.tabs.monitor', '系統監控'), icon: <Activity size={16} /> },
    { id: 'db', label: t('admin.tabs.db'), icon: <Database size={16} /> },
    { id: 'mail', label: t('admin.tabs.mail'), icon: <Mail size={16} /> },
    { id: 'llm', label: t('admin.tabs.llm'), icon: <Cpu size={16} /> },
    { id: 'vector-defaults', label: t('admin.tabs.vectorDefaults'), icon: <Cpu size={16} /> },
  ]

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top Nav */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Cpu size={14} className="text-white" />
          </div>
          <span className="font-bold">FOXLINK GPT</span>
          <span className="text-slate-500 text-sm">/ {t('admin.title')}</span>
        </div>
        <button
          onClick={() => navigate('/chat')}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition"
        >
          <ArrowLeft size={15} /> {t('admin.backToChat')}
        </button>
      </header>

      <div className="flex h-[calc(100vh-52px)]">
        {/* Sidebar */}
        <nav className="w-56 bg-white border-r border-slate-200 py-4 overflow-y-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition ${activeTab === t.id
                ? 'text-blue-600 bg-blue-50 border-r-2 border-blue-600 font-medium'
                : 'text-slate-600 hover:bg-slate-50'
                }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {activeTab === 'users' && <UserManagement />}
          {activeTab === 'roles' && <RoleManagement />}
          {activeTab === 'tokens' && <TokenUsagePanel />}
          {activeTab === 'audit' && <AuditLogs />}
          {activeTab === 'keywords' && <SensitiveKeywords />}
          {activeTab === 'db' && <DbMaintenance />}
          {activeTab === 'mail' && <MailSettingsPanel />}
          {activeTab === 'llm' && <LlmModelsPanel />}
          {activeTab === 'vector-defaults' && <VectorDefaultsPanel />}
          {activeTab === 'cost' && <CostAnalysis />}
          {activeTab === 'scheduled' && <ScheduledTasksPanel />}
          {activeTab === 'mcp' && <MCPServersPanel />}
          {activeTab === 'dify' && <DifyKnowledgeBasesPanel />}
          {activeTab === 'kb' && <KbAdminPanel />}
          {activeTab === 'skills' && <SkillManagement />}
          {activeTab === 'code-runners' && <CodeRunnersPanel />}
          {activeTab === 'research' && <ResearchLogsPanel />}
          {activeTab === 'api-keys' && <ApiKeysPanel />}
          {activeTab === 'ai-dashboard' && <AiDashboardAdmin />}
          {activeTab === 'data-permissions' && <DataPermissionsPanel />}
          {activeTab === 'db-sources' && <DbSourcesPanel />}
          {activeTab === 'monitor' && <MonitorPage />}
        </main>
      </div>
    </div>
  )
}
