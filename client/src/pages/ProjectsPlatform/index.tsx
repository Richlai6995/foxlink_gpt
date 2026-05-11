/**
 * ProjectsPlatform 入口 — Routes + Tabs(home view)
 *
 * Phase 0:只給 admin 看到 sidebar menu
 * Sprint 1+2 ship 後:home tab 改成「📁 專案列表」為主
 */

import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useProjectsPlatformVisibility } from '../../hooks/useProjectsPlatformVisibility'
import HomeTabs from './HomeTabs'
import ProjectDetail from './Projects/ProjectDetail'

export default function ProjectsPlatformPage() {
  const v = useProjectsPlatformVisibility()
  const navigate = useNavigate()

  useEffect(() => {
    if (v.mode === 'hidden') {
      navigate('/chat', { replace: true })
    }
  }, [v.mode, navigate])

  if (!v.can_see) return null

  return (
    <Routes>
      <Route path="/" element={<HomeTabs />} />
      <Route path="/projects/:id" element={<ProjectDetail />} />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  )
}
