import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

export interface OverrideTool {
  id: number | string
  type: 'mcp' | 'dify' | 'kb' | 'skill'
  name: string
  description?: string | null
  name_zh?: string | null
  name_en?: string | null
  name_vi?: string | null
  desc_zh?: string | null
  desc_en?: string | null
  desc_vi?: string | null
  icon?: string       // for skills
  skill_type?: string // for skills
}

export interface OverrideTemplate {
  id: string
  name: string
  description?: string | null
  format?: string | null
  tags?: string | null
}

interface AdminOverrideContextType {
  overrideTools: OverrideTool[]
  overrideTemplates: OverrideTemplate[]
  addTool: (item: OverrideTool) => void
  removeTool: (type: OverrideTool['type'], id: number | string) => void
  addTemplate: (item: OverrideTemplate) => void
  removeTemplate: (id: string) => void
  clearAll: () => void
  isOverrideTool: (type: OverrideTool['type'], id: number | string) => boolean
  isOverrideTemplate: (id: string) => boolean
  overrideCount: number
}

const AdminOverrideContext = createContext<AdminOverrideContextType | null>(null)

const STORAGE_KEY = (userId: number | string) => `fl_admin_overrides_${userId}`

interface StoredState {
  tools: OverrideTool[]
  templates: OverrideTemplate[]
}

export const AdminOverrideProvider: React.FC<{ userId: number | string | null; children: React.ReactNode }> = ({
  userId,
  children,
}) => {
  const [overrideTools, setOverrideTools] = useState<OverrideTool[]>([])
  const [overrideTemplates, setOverrideTemplates] = useState<OverrideTemplate[]>([])

  // Load from localStorage when userId changes
  useEffect(() => {
    if (!userId) {
      setOverrideTools([])
      setOverrideTemplates([])
      return
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY(userId))
      if (raw) {
        const parsed: StoredState = JSON.parse(raw)
        setOverrideTools(parsed.tools || [])
        setOverrideTemplates(parsed.templates || [])
      }
    } catch {}
  }, [userId])

  const persist = useCallback(
    (tools: OverrideTool[], templates: OverrideTemplate[]) => {
      if (!userId) return
      localStorage.setItem(STORAGE_KEY(userId), JSON.stringify({ tools, templates }))
    },
    [userId]
  )

  const addTool = useCallback(
    (item: OverrideTool) => {
      setOverrideTools((prev) => {
        if (prev.some((t) => t.type === item.type && String(t.id) === String(item.id))) return prev
        const next = [...prev, item]
        persist(next, overrideTemplates)
        return next
      })
    },
    [overrideTemplates, persist]
  )

  const removeTool = useCallback(
    (type: OverrideTool['type'], id: number | string) => {
      setOverrideTools((prev) => {
        const next = prev.filter((t) => !(t.type === type && String(t.id) === String(id)))
        persist(next, overrideTemplates)
        return next
      })
    },
    [overrideTemplates, persist]
  )

  const addTemplate = useCallback(
    (item: OverrideTemplate) => {
      setOverrideTemplates((prev) => {
        if (prev.some((t) => t.id === item.id)) return prev
        const next = [...prev, item]
        persist(overrideTools, next)
        return next
      })
    },
    [overrideTools, persist]
  )

  const removeTemplate = useCallback(
    (id: string) => {
      setOverrideTemplates((prev) => {
        const next = prev.filter((t) => t.id !== id)
        persist(overrideTools, next)
        return next
      })
    },
    [overrideTools, persist]
  )

  const clearAll = useCallback(() => {
    setOverrideTools([])
    setOverrideTemplates([])
    if (userId) localStorage.removeItem(STORAGE_KEY(userId))
  }, [userId])

  const isOverrideTool = useCallback(
    (type: OverrideTool['type'], id: number | string) =>
      overrideTools.some((t) => t.type === type && String(t.id) === String(id)),
    [overrideTools]
  )

  const isOverrideTemplate = useCallback(
    (id: string) => overrideTemplates.some((t) => t.id === id),
    [overrideTemplates]
  )

  const overrideCount = overrideTools.length + overrideTemplates.length

  return (
    <AdminOverrideContext.Provider
      value={{
        overrideTools,
        overrideTemplates,
        addTool,
        removeTool,
        addTemplate,
        removeTemplate,
        clearAll,
        isOverrideTool,
        isOverrideTemplate,
        overrideCount,
      }}
    >
      {children}
    </AdminOverrideContext.Provider>
  )
}

export function useAdminOverride() {
  const ctx = useContext(AdminOverrideContext)
  if (!ctx) throw new Error('useAdminOverride must be used within AdminOverrideProvider')
  return ctx
}

/** Clear override data for a userId from localStorage (call on logout) */
export function clearAdminOverrideStorage(userId: number | string) {
  localStorage.removeItem(STORAGE_KEY(userId))
}
