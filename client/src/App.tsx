import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AdminOverrideProvider } from './context/AdminOverrideContext'
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
import { lazy, Suspense } from 'react'
const TrainingPage = lazy(() => import('./pages/TrainingPage'))

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

function AppRoutes() {
  const { isAuthenticated, user } = useAuth()
  usePageActivity()
  return (
    <AdminOverrideProvider userId={(user as any)?.id ?? null}>
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
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/scheduled-tasks"
        element={
          <ProtectedRoute>
            <ScheduledTasksPage />
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
      <Route path="/kb" element={<ProtectedRoute><KnowledgeBasePage /></ProtectedRoute>} />
      <Route path="/kb/:id" element={<ProtectedRoute><KnowledgeBaseDetailPage /></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><AiDashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/boards" element={<ProtectedRoute><DashboardBoardPage /></ProtectedRoute>} />
      <Route path="/templates" element={<ProtectedRoute><TemplatesPage /></ProtectedRoute>} />
      <Route path="/training/*" element={<ProtectedRoute><Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-900 text-slate-400">Loading...</div>}><TrainingPage /></Suspense></ProtectedRoute>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="*" element={<Navigate to={isAuthenticated ? '/chat' : '/login'} replace />} />
    </Routes>
    </AdminOverrideProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
