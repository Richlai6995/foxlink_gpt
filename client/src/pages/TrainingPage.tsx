import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { TrainingThemeProvider } from '../components/training/TrainingThemeContext'
import { useAuth } from '../context/AuthContext'
import CourseList from '../components/training/CourseList'
import CourseDetail from '../components/training/CourseDetail'
import CourseEditor from '../components/training/editor/CourseEditor'
import CoursePlayer from '../components/training/CoursePlayer'
import QuizPage from '../components/training/QuizPage'
import TrainingDevArea from './TrainingDevArea'
import TrainingClassroom from './TrainingClassroom'
import ProgramEditor from '../components/training/ProgramEditor'
import ProgramView from '../components/training/ProgramView'

function RedirectEditorId() {
  const { id } = useParams()
  return <Navigate to={`/training/dev/courses/${id}`} replace />
}

export default function TrainingPage() {
  const { canAccessTrainingDev } = useAuth()

  return (
    <TrainingThemeProvider>
      <Routes>
        {/* ── 開發區 ─────────────────────────────────── */}
        {canAccessTrainingDev && (
          <>
            <Route path="dev" element={<TrainingDevArea />} />
            <Route path="dev/courses" element={<TrainingDevArea />} />
            <Route path="dev/programs" element={<TrainingDevArea />} />
            <Route path="dev/courses/new" element={<CourseEditor />} />
            <Route path="dev/courses/:id" element={<CourseEditor />} />
            <Route path="dev/programs/new" element={<ProgramEditor />} />
            <Route path="dev/programs/:id" element={<ProgramEditor />} />
          </>
        )}

        {/* ── 訓練教室 ───────────────────────────────── */}
        <Route path="classroom" element={<TrainingClassroom />} />
        <Route path="classroom/program/:id" element={<ProgramView />} />
        <Route path="classroom/course/:id" element={<CourseDetail />} />
        <Route path="classroom/course/:id/learn" element={<CoursePlayer />} />
        <Route path="classroom/course/:id/quiz" element={<QuizPage />} />

        {/* ── 舊路由相容 ─────────────────────────────── */}
        <Route path="editor" element={<Navigate to="/training/dev/courses" replace />} />
        <Route path="editor/new" element={<Navigate to="/training/dev/courses/new" replace />} />
        <Route path="editor/:id" element={<RedirectEditorId />} />
        <Route path="course/:id" element={<CourseDetail />} />
        <Route path="course/:id/learn" element={<CoursePlayer />} />
        <Route path="course/:id/quiz" element={<QuizPage />} />

        {/* ── 根路由自動導向 ─────────────────────────── */}
        <Route index element={
          canAccessTrainingDev
            ? <Navigate to="/training/dev" replace />
            : <Navigate to="/training/classroom" replace />
        } />
      </Routes>
    </TrainingThemeProvider>
  )
}
