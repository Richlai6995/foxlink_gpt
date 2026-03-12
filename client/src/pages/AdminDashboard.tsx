import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, BarChart3, Shield, AlertTriangle, Database, Mail, ArrowLeft, Cpu, DollarSign, CalendarClock, Plug, Zap, UserCog, Sparkles, Code2, Search, KeyRound, MonitorPlay, Lock } from 'lucide-react'
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

type Tab = 'users' | 'roles' | 'tokens' | 'audit' | 'keywords' | 'db' | 'mail' | 'llm' | 'vector-defaults' | 'cost' | 'scheduled' | 'mcp' | 'dify' | 'kb' | 'skills' | 'code-runners' | 'research' | 'api-keys' | 'ai-dashboard' | 'data-permissions'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'users', label: '使用者管理', icon: <Users size={16} /> },
  { id: 'roles', label: '角色管理', icon: <UserCog size={16} /> },
  { id: 'tokens', label: 'Token 統計', icon: <BarChart3 size={16} /> },
  { id: 'cost', label: '費用統計及分析', icon: <DollarSign size={16} /> },
  { id: 'audit', label: '稽核日誌', icon: <Shield size={16} /> },
  { id: 'keywords', label: '敏感詞彙', icon: <AlertTriangle size={16} /> },
  { id: 'research', label: '深度研究紀錄', icon: <Search size={16} /> },
  { id: 'api-keys', label: 'API 金鑰管理', icon: <KeyRound size={16} /> },
  { id: 'scheduled', label: '排程任務', icon: <CalendarClock size={16} /> },
  { id: 'mcp', label: 'MCP 伺服器', icon: <Plug size={16} /> },
  { id: 'dify', label: 'DIFY 知識庫', icon: <Zap size={16} /> },
  { id: 'kb', label: '知識庫管理', icon: <Database size={16} /> },
  { id: 'skills', label: '技能管理', icon: <Sparkles size={16} /> },
  { id: 'code-runners', label: 'Code Runners', icon: <Code2 size={16} /> },
  { id: 'ai-dashboard', label: 'AI 戰情室', icon: <MonitorPlay size={16} /> },
  { id: 'data-permissions', label: '資料權限管理', icon: <Lock size={16} /> },
  { id: 'db', label: '資料庫維護', icon: <Database size={16} /> },
  { id: 'mail', label: '郵件設定', icon: <Mail size={16} /> },
  { id: 'llm', label: 'LLM 模型設定', icon: <Cpu size={16} /> },
  { id: 'vector-defaults', label: '向量預設模型', icon: <Cpu size={16} /> },
]

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('users')
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top Nav */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Cpu size={14} className="text-white" />
          </div>
          <span className="font-bold">FOXLINK GPT</span>
          <span className="text-slate-500 text-sm">/ 系統管理</span>
        </div>
        <button
          onClick={() => navigate('/chat')}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition"
        >
          <ArrowLeft size={15} /> 返回聊天
        </button>
      </header>

      <div className="flex h-[calc(100vh-52px)]">
        {/* Sidebar */}
        <nav className="w-56 bg-white border-r border-slate-200 py-4">
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
        </main>
      </div>
    </div>
  )
}
