import { Routes, Route } from 'react-router-dom'
import { TrainingThemeProvider } from '../components/training/TrainingThemeContext'
import CourseList from '../components/training/CourseList'
import CourseDetail from '../components/training/CourseDetail'
import CourseEditor from '../components/training/editor/CourseEditor'
import CoursePlayer from '../components/training/CoursePlayer'
import QuizPage from '../components/training/QuizPage'

export default function TrainingPage() {
  return (
    <TrainingThemeProvider>
      <Routes>
        <Route index element={<CourseList />} />
        <Route path="course/:id" element={<CourseDetail />} />
        <Route path="course/:id/learn" element={<CoursePlayer />} />
        <Route path="course/:id/quiz" element={<QuizPage />} />
        <Route path="editor" element={<CourseList editorMode />} />
        <Route path="editor/new" element={<CourseEditor />} />
        <Route path="editor/:id" element={<CourseEditor />} />
      </Routes>
    </TrainingThemeProvider>
  )
}
