import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AdminOverrideProvider } from './context/AdminOverrideContext'
import { MicProvider } from './context/MicContext'
import { GlobalThemeProvider } from './context/ThemeContext'
import { usePageActivity } from './lib/usePageActivity'
import Login from './pages/Login'
import ChatPage from './pages/ChatPage'
import AdminDashboard from './pages/AdminDashboard'
import ScheduledTasksPage from './pages/ScheduledTasksPage'
import HelpPage from './pages/HelpPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SkillMarket from './pages/SkillMarket'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import KnowledgeBaseDetailPage from './pages/KnowledgeBaseDetailPage'
import AiDashboardPage from './pages/AiDashboardPage'
import DashboardBoardPage from './pages/DashboardBoardPage'
import TemplatesPage from './pages/TemplatesPage'
import MyChartsPage from './pages/MyChartsPage'
import FeedbackFAB from './components/feedback/FeedbackFAB'
import FeedbackToast from './components/feedback/FeedbackToast'
import GlobalVoiceInput from './components/GlobalVoiceInput'
import VoiceHotkeyHint from './components/VoiceHotkeyHint'
import InstallPwaPrompt from './components/common/InstallPwaPrompt'
import MobileUnsupportedScreen from './components/common/MobileUnsupportedScreen'
import { useDeviceProfile } from './hooks/useDeviceProfile'
import FeedbackPage from './pages/FeedbackPage'
import FeedbackNewPage from './pages/FeedbackNewPage'
import FeedbackDetailPage from './pages/FeedbackDetailPage'
import { lazy, Suspense } from 'react'
const TrainingPage = lazy(() => import('./pages/TrainingPage'))
const PmReviewQueuePage = lazy(() => import('./pages/PmReviewQueuePage'))
const PmBriefingPage = lazy(() => import('./pages/PmBriefingPage'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isAdmin } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/chat" replace />
  return <>{children}</>
}

// 手機不支援的頁面攔截 — 顯示「請使用桌機開啟」+ 回 chat / logout
// 桌機通行,手機被擋
function MobileGuard({ children, pageName }: { children: React.ReactNode; pageName?: string }) {
  const { isMobile } = useDeviceProfile()
  if (isMobile) return <MobileUnsupportedScreen pageName={pageName} />
  return <>{children}</>
}

function AppRoutes() {
  const { isAuthenticated, user } = useAuth()
  const { isMobile } = useDeviceProfile()
  usePageActivity()
  return (
    <AdminOverrideProvider userId={(user as any)?.id ?? null}>
    <MicProvider>
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/chat" replace /> : <Login />} />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <MobileGuard pageName="管理後台">
              <AdminDashboard />
            </MobileGuard>
          </AdminRoute>
        }
      />
      <Route
        path="/scheduled-tasks"
        element={
          <ProtectedRoute>
            <MobileGuard pageName="排程任務">
              <ScheduledTasksPage />
            </MobileGuard>
          </ProtectedRoute>
        }
      />
      <Route
        path="/help"
        element={
          <ProtectedRoute>
            <HelpPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/skills"
        element={
          <ProtectedRoute>
            <SkillMarket />
          </ProtectedRoute>
        }
      />
      <Route path="/kb" element={<ProtectedRoute><MobileGuard pageName="知識庫"><KnowledgeBasePage /></MobileGuard></ProtectedRoute>} />
      <Route path="/kb/:id" element={<ProtectedRoute><MobileGuard pageName="知識庫"><KnowledgeBaseDetailPage /></MobileGuard></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><MobileGuard pageName="AI 戰情"><AiDashboardPage /></MobileGuard></ProtectedRoute>} />
      <Route path="/dashboard/boards" element={<ProtectedRoute><MobileGuard pageName="AI 戰情"><DashboardBoardPage /></MobileGuard></ProtectedRoute>} />
      <Route path="/templates" element={<ProtectedRoute><TemplatesPage /></ProtectedRoute>} />
      <Route path="/my-charts" element={<ProtectedRoute><MyChartsPage /></ProtectedRoute>} />
      <Route path="/feedback" element={<ProtectedRoute><FeedbackPage /></ProtectedRoute>} />
      <Route path="/feedback/new" element={<ProtectedRoute><FeedbackNewPage /></ProtectedRoute>} />
      <Route path="/feedback/:id" element={<ProtectedRoute><FeedbackDetailPage /></ProtectedRoute>} />
      <Route path="/training/*" element={<ProtectedRoute><MobileGuard pageName="教育訓練"><Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-900 text-slate-400">Loading...</div>}><TrainingPage /></Suspense></MobileGuard></ProtectedRoute>} />
      <Route path="/pm/review" element={<ProtectedRoute><MobileGuard pageName="PM 平台"><Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-50 text-slate-400">Loading...</div>}><PmReviewQueuePage /></Suspense></MobileGuard></ProtectedRoute>} />
      <Route path="/pm/briefing" element={<ProtectedRoute><MobileGuard pageName="PM 平台"><Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-50 text-slate-400">Loading...</div>}><PmBriefingPage /></Suspense></MobileGuard></ProtectedRoute>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="*" element={<Navigate to={isAuthenticated ? '/chat' : '/login'} replace />} />
    </Routes>
    {/* 桌機才顯示 FeedbackFAB(手機收進 menu — PR-2 後續) / Voice 熱鍵在手機沒鍵盤無意義 */}
    {isAuthenticated && !isMobile && <FeedbackFAB />}
    {isAuthenticated && <FeedbackToast />}
    {isAuthenticated && !isMobile && <GlobalVoiceInput />}
    {isAuthenticated && !isMobile && <VoiceHotkeyHint />}
    {isAuthenticated && <InstallPwaPrompt />}
    </MicProvider>
    </AdminOverrideProvider>
  )
}

export default function App() {
  return (
    <GlobalThemeProvider>
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </GlobalThemeProvider>
  )
}
