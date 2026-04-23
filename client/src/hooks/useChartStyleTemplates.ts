/**
 * useChartStyleTemplates — 載入使用者的樣式模板 + 系統預設,cache in memory
 *
 * Hook 回傳:
 *   templates: { mine, system }
 *   activeDefault: ChartStyle  ← 已 merge 好可直接 render 的預設樣式
 *   refresh(): 重新載
 *   setDefault(templateId | 0): 原子切 default,0 = 清除
 *
 * 由 InlineChart 讀來當 fallback style(spec.style > activeDefault > hardcoded)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import type { ChartStyleTemplate, ChartStyle } from '../types'
import { HARDCODED_STYLE, mergeChartStyle } from '../lib/chartStyle'

interface State {
  mine: ChartStyleTemplate[]
  system: ChartStyleTemplate[]
  loading: boolean
  error: string | null
}

let _cache: { mine: ChartStyleTemplate[]; system: ChartStyleTemplate[] } | null = null
const listeners = new Set<() => void>()

function notify() { listeners.forEach(fn => fn()) }

function parseStyle(tmpl: ChartStyleTemplate): ChartStyle | null {
  if (!tmpl) return null
  const raw = tmpl.style_json
  if (!raw) return null
  if (typeof raw === 'object') return raw as ChartStyle
  try { return JSON.parse(raw as string) as ChartStyle } catch { return null }
}

export function useChartStyleTemplates() {
  const [, forceUpdate] = useState(0)
  const [state, setState] = useState<State>({
    mine: _cache?.mine || [],
    system: _cache?.system || [],
    loading: !_cache,
    error: null,
  })

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const r = await api.get('/chart-style-templates')
      _cache = { mine: r.data.mine || [], system: r.data.system || [] }
      setState({ mine: _cache.mine, system: _cache.system, loading: false, error: null })
      notify()
    } catch (e: any) {
      setState(s => ({ ...s, loading: false, error: e?.message || 'load failed' }))
    }
  }, [])

  useEffect(() => {
    if (!_cache) load()
    const l = () => forceUpdate(x => x + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [load])

  const activeDefault = useMemo<ChartStyle>(() => {
    const userDef = state.mine.find(t => t.is_default === 1)
    const sysDef = state.system.find(t => t.is_system === 1)
    const userStyle = userDef ? parseStyle(userDef) : null
    const sysStyle = sysDef ? parseStyle(sysDef) : null
    // priority: user default > system default > HARDCODED
    return mergeChartStyle(mergeChartStyle(HARDCODED_STYLE, sysStyle || undefined), userStyle || undefined)
  }, [state.mine, state.system])

  const setDefault = useCallback(async (templateId: number) => {
    await api.post(`/chart-style-templates/${templateId}/set-default`)
    await load()
  }, [load])

  const createTemplate = useCallback(async (name: string, style: ChartStyle, description?: string) => {
    const r = await api.post('/chart-style-templates', { name, style_json: style, description })
    await load()
    return r.data?.id as number | undefined
  }, [load])

  const updateTemplate = useCallback(async (id: number, patch: Partial<ChartStyleTemplate>) => {
    await api.put(`/chart-style-templates/${id}`, patch)
    await load()
  }, [load])

  const deleteTemplate = useCallback(async (id: number) => {
    await api.delete(`/chart-style-templates/${id}`)
    await load()
  }, [load])

  return {
    ...state,
    activeDefault,
    refresh: load,
    setDefault,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  }
}
