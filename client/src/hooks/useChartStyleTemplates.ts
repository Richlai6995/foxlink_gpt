/**
 * useChartStyleTemplates — 載入使用者的樣式模板 + 系統預設,cache in memory
 *
 * Hook 回傳:
 *   templates: { mine, system }
 *   defaultsMap: { [type]: templateId }  — per-type default 對應表
 *   activeDefaultFor(type): ChartStyle   — 套用優先序後的最終 style
 *   refresh(): 重新載
 *   setDefault(templateId, type='all'): 設為指定 type 的 default(id=0 = 清除)
 *
 * 套用優先序(activeDefaultFor 內):
 *   spec.style (render 端 merge) > defaults[type] > defaults['all'] > system > HARDCODED
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import type { ChartStyleTemplate, ChartStyle, ChartDefaultType, InlineChartType } from '../types'
import { HARDCODED_STYLE, mergeChartStyle } from '../lib/chartStyle'

interface State {
  mine: ChartStyleTemplate[]
  system: ChartStyleTemplate[]
  defaultsMap: Partial<Record<ChartDefaultType, number>>
  loading: boolean
  error: string | null
}

let _cache: Omit<State, 'loading' | 'error'> | null = null
const listeners = new Set<() => void>()
function notify() { listeners.forEach(fn => fn()) }

function parseStyle(tmpl?: ChartStyleTemplate | null): ChartStyle | null {
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
    defaultsMap: _cache?.defaultsMap || {},
    loading: !_cache,
    error: null,
  })

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const r = await api.get('/chart-style-templates')
      _cache = {
        mine: r.data.mine || [],
        system: r.data.system || [],
        defaultsMap: r.data.defaultsMap || {},
      }
      setState({ ..._cache, loading: false, error: null })
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

  /**
   * 回傳該 type 的最終套用 style:
   *   system default < 'all' user default < 該 type user default
   * 多層 merge 後回傳。供 InlineChart 套在 spec.style 之前。
   */
  const activeDefaultFor = useCallback((type?: InlineChartType | ChartDefaultType): ChartStyle => {
    const allTmpl = state.mine.find(t => t.is_default === 1 && t.default_for_type === 'all')
    const typeTmpl = type && type !== 'all'
      ? state.mine.find(t => t.is_default === 1 && t.default_for_type === type)
      : null
    const sysTmpl = state.system.find(t => t.is_system === 1)

    const sysStyle = parseStyle(sysTmpl)
    const allStyle = parseStyle(allTmpl)
    const typeStyle = parseStyle(typeTmpl)

    let s: ChartStyle = HARDCODED_STYLE
    if (sysStyle) s = mergeChartStyle(s, sysStyle)
    if (allStyle) s = mergeChartStyle(s, allStyle)
    if (typeStyle) s = mergeChartStyle(s, typeStyle)
    return s
  }, [state.mine, state.system])

  // 向下相容:舊 activeDefault 保留(= activeDefaultFor('all'))
  const activeDefault = useMemo<ChartStyle>(() => activeDefaultFor('all'), [activeDefaultFor])

  const setDefault = useCallback(async (templateId: number, type: ChartDefaultType = 'all') => {
    await api.post(`/chart-style-templates/${templateId}/set-default`, { type })
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
    mine: state.mine,
    system: state.system,
    defaultsMap: state.defaultsMap,
    loading: state.loading,
    error: state.error,
    activeDefault,
    activeDefaultFor,
    refresh: load,
    setDefault,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  }
}
