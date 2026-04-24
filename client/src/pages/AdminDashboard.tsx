import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, BarChart3, Shield, AlertTriangle, Database, Mail, ArrowLeft, Cpu, DollarSign, CalendarClock, Plug, Zap, UserCog, Sparkles, Code2, Search, KeyRound, MonitorPlay, Lock, Activity, MessageSquare, Languages, GraduationCap, TicketCheck, Mic, Factory } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import UserManagement from '../components/admin/UserManagement'
import TokenUsagePanel from '../components/admin/TokenUsage'
import AuditLogs from '../components/admin/AuditLogs'
import SensitiveKeywords from '../components/admin/SensitiveKeywords'
import DbMaintenance from '../components/admin/DbMaintenance'
import MailSettingsPanel from '../components/admin/MailSettings'
import LlmModelsPanel from '../components/admin/LlmModels'
import VectorDefaultsPanel from '../components/admin/VectorDefaultsPanel'
import KbRetrievalSettings from '../components/admin/KbRetrievalSettings'
import KbRetrievalDebug from '../components/admin/KbRetrievalDebug'
import KbSynonyms from '../components/admin/KbSynonyms'
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
import ChartAdoptionPanel from '../components/admin/ChartAdoptionPanel'
import DataPermissionsPanel from '../components/admin/DataPermissionsPanel'
import MonitorPage from '../components/monitor/MonitorPage'
import DbSourcesPanel from '../components/admin/DbSourcesPanel'
import PipelineWritableTablesPanel from '../components/admin/PipelineWritableTablesPanel'
import WebexLogsPanel from '../components/admin/WebexLogsPanel'
import HelpTranslationPanel from '../components/admin/HelpTranslationPanel'
import FactoryTranslationsPanel from '../components/admin/FactoryTranslationsPanel'
import TrainingAdmin from '../components/admin/TrainingAdmin'
import FeedbackCategoryManager from '../components/feedback/admin/FeedbackCategoryManager'
import FeedbackSLAConfig from '../components/feedback/admin/FeedbackSLAConfig'
import FeedbackStatsPanel from '../components/feedback/FeedbackStatsPanel'
import VoiceInputSettingsPanel from '../components/admin/VoiceInputSettings'
type Tab = 'users' | 'roles' | 'tokens' | 'audit' | 'keywords' | 'db' | 'mail' | 'llm' | 'vector-defaults' | 'kb-retrieval' | 'kb-debug' | 'kb-synonyms' | 'cost' | 'scheduled' | 'mcp' | 'dify' | 'kb' | 'skills' | 'code-runners' | 'research' | 'api-keys' | 'ai-dashboard' | 'chart-adoption' | 'data-permissions' | 'monitor' | 'db-sources' | 'pipeline-whitelist' | 'webex-logs' | 'help-translation' | 'factory-translations' | 'training' | 'feedback' | 'voice-input'

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('users')
  const navigate = useNavigate()
  const { t } = useTranslation()

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    // ─ 使用者與權限 ─
    { id: 'users', label: t('admin.tabs.users'), icon: <Users size={16} className="text-blue-500" /> },
    { id: 'roles', label: t('admin.tabs.roles'), icon: <UserCog size={16} className="text-blue-700" /> },
    { id: 'data-permissions', label: t('admin.tabs.dataPermissions'), icon: <Lock size={16} className="text-amber-700" /> },
    // ─ 稽核與安全 ─
    { id: 'audit', label: t('admin.tabs.audit'), icon: <Shield size={16} className="text-amber-500" /> },
    { id: 'keywords', label: t('admin.tabs.keywords'), icon: <AlertTriangle size={16} className="text-red-500" /> },
    // ─ 用量與費用 ─
    { id: 'tokens', label: t('admin.tabs.tokens'), icon: <BarChart3 size={16} className="text-emerald-500" /> },
    { id: 'cost', label: t('admin.tabs.cost'), icon: <DollarSign size={16} className="text-green-600" /> },
    // ─ AI 功能 ─
    { id: 'llm', label: t('admin.tabs.llm'), icon: <Cpu size={16} className="text-indigo-600" /> },
    { id: 'skills', label: t('admin.tabs.skills'), icon: <Sparkles size={16} className="text-pink-500" /> },
    { id: 'code-runners', label: t('admin.tabs.codeRunners'), icon: <Code2 size={16} className="text-rose-600" /> },
    { id: 'ai-dashboard', label: t('admin.tabs.aiDashboard'), icon: <MonitorPlay size={16} className="text-fuchsia-500" /> },
    { id: 'chart-adoption', label: t('admin.tabs.chartAdoption', '使用者圖庫採納'), icon: <BarChart3 size={16} className="text-amber-500" /> },
    { id: 'research', label: t('admin.tabs.research'), icon: <Search size={16} className="text-teal-500" /> },
    // ─ 知識庫與資料 ─
    { id: 'kb', label: t('admin.tabs.kb'), icon: <Database size={16} className="text-violet-500" /> },
    { id: 'dify', label: t('admin.tabs.apiConnectors'), icon: <Zap size={16} className="text-orange-500" /> },
    { id: 'vector-defaults', label: t('admin.tabs.vectorDefaults'), icon: <Cpu size={16} className="text-teal-600" /> },
    { id: 'kb-retrieval', label: 'KB 檢索設定', icon: <Search size={16} className="text-teal-500" /> },
    { id: 'kb-debug', label: 'KB 檢索調校', icon: <Search size={16} className="text-purple-500" /> },
    { id: 'kb-synonyms', label: 'KB 同義詞字典', icon: <Search size={16} className="text-emerald-500" /> },
    // ─ 整合與排程 ─
    { id: 'mcp', label: t('admin.tabs.mcp'), icon: <Plug size={16} className="text-indigo-500" /> },
    { id: 'api-keys', label: t('admin.tabs.apiKeys'), icon: <KeyRound size={16} className="text-yellow-600" /> },
    { id: 'scheduled', label: t('admin.tabs.scheduled'), icon: <CalendarClock size={16} className="text-cyan-500" /> },
    { id: 'webex-logs', label: 'Webex Bot 日誌', icon: <MessageSquare size={16} className="text-purple-500" /> },
    { id: 'help-translation', label: '說明文件翻譯', icon: <Languages size={16} className="text-sky-500" /> },
    { id: 'factory-translations', label: t('admin.tabs.factoryTranslations', '廠區翻譯'), icon: <Factory size={16} className="text-indigo-500" /> },
    // ─ 教育訓練 ─
    { id: 'training', label: '教育訓練報表', icon: <GraduationCap size={16} className="text-sky-400" /> },
    // ─ 問題反饋 ─
    { id: 'feedback' as Tab, label: t('feedback.title', '問題反饋'), icon: <TicketCheck size={16} className="text-rose-400" /> },
    // ─ 系統維運 ─
    { id: 'monitor', label: t('admin.tabs.monitor', '系統監控'), icon: <Activity size={16} className="text-red-400" /> },
    { id: 'db', label: t('admin.tabs.db'), icon: <Database size={16} className="text-slate-500" /> },
    { id: 'db-sources', label: 'DB 來源管理', icon: <Database size={16} className="text-sky-500" /> },
    { id: 'pipeline-whitelist', label: t('admin.tabs.pipelineWhitelist', 'Pipeline 可寫表'), icon: <Database size={16} className="text-slate-600" /> },
    { id: 'mail', label: t('admin.tabs.mail'), icon: <Mail size={16} className="text-purple-600" /> },
    { id: 'voice-input', label: t('voice_input.settingsTitle', '語音輸入'), icon: <Mic size={16} className="text-blue-500" /> },
  ]

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top Nav */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Cpu size={14} className="text-white" />
          </div>
          <span className="font-bold">Cortex</span>
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
        <nav data-region="sidebar" className="w-56 bg-white border-r border-slate-200 py-4 overflow-y-auto">
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
          {activeTab === 'webex-logs' && <WebexLogsPanel />}
          {activeTab === 'keywords' && <SensitiveKeywords />}
          {activeTab === 'db' && <DbMaintenance />}
          {activeTab === 'mail' && <MailSettingsPanel />}
          {activeTab === 'llm' && <LlmModelsPanel />}
          {activeTab === 'vector-defaults' && <VectorDefaultsPanel />}
          {activeTab === 'kb-retrieval' && <KbRetrievalSettings />}
          {activeTab === 'kb-debug' && <KbRetrievalDebug />}
          {activeTab === 'kb-synonyms' && <KbSynonyms />}
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
          {activeTab === 'chart-adoption' && <ChartAdoptionPanel />}
          {activeTab === 'data-permissions' && <DataPermissionsPanel />}
          {activeTab === 'db-sources' && <DbSourcesPanel />}
          {activeTab === 'pipeline-whitelist' && <PipelineWritableTablesPanel />}
          {activeTab === 'help-translation' && <HelpTranslationPanel />}
          {activeTab === 'factory-translations' && <FactoryTranslationsPanel />}
          {activeTab === 'training' && <TrainingAdmin />}
          {activeTab === 'feedback' && (
            <div className="space-y-8">
              <FeedbackStatsPanel />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FeedbackCategoryManager />
                <FeedbackSLAConfig />
              </div>
            </div>
          )}
          {activeTab === 'monitor' && <MonitorPage />}
          {activeTab === 'voice-input' && <VoiceInputSettingsPanel />}
        </main>
      </div>
    </div>
  )
}
