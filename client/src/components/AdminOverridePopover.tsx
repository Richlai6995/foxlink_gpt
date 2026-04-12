import { useState, useRef, useEffect, useCallback } from 'react'
import { FlaskConical, X, Plus, Plug, Zap, Database, Sparkles, FileText, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { useAdminOverride, type OverrideTool, type OverrideTemplate } from '../context/AdminOverrideContext'

interface RawTool {
  id: number | string
  name: string
  description?: string | null
  name_zh?: string | null
  name_en?: string | null
  name_vi?: string | null
  desc_zh?: string | null
  desc_en?: string | null
  desc_vi?: string | null
  icon?: string
  type?: string
  tags?: string | null
}

interface RawTemplate {
  id: string
  name: string
  description?: string | null
  format?: string | null
  tags?: string | null
}

const TYPE_ICONS = {
  mcp: <Plug size={12} className="text-blue-500 flex-shrink-0" />,
  dify: <Zap size={12} className="text-amber-500 flex-shrink-0" />,
  kb: <Database size={12} className="text-emerald-500 flex-shrink-0" />,
  skill: <Sparkles size={12} className="text-purple-500 flex-shrink-0" />,
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  mcp: 'adminOverride.typeMcp',
  dify: 'adminOverride.typeDify',
  kb: 'adminOverride.typeKb',
  skill: 'adminOverride.typeSkill',
}

export default function AdminOverridePopover() {
  const { t, i18n } = useTranslation()
  const { overrideTools, overrideTemplates, addTool, removeTool, addTemplate, removeTemplate, overrideCount } =
    useAdminOverride()

  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'tools' | 'templates'>('tools')
  const [loading, setLoading] = useState(false)

  const [unauthorizedMcp, setUnauthorizedMcp] = useState<RawTool[]>([])
  const [unauthorizedDify, setUnauthorizedDify] = useState<RawTool[]>([])
  const [unauthorizedKb, setUnauthorizedKb] = useState<RawTool[]>([])
  const [unauthorizedSkills, setUnauthorizedSkills] = useState<RawTool[]>([])
  const [unauthorizedTemplates, setUnauthorizedTemplates] = useState<RawTemplate[]>([])

  const popoverRef = useRef<HTMLDivElement>(null)

  const localName = useCallback(
    (item: RawTool | RawTemplate) => {
      if (i18n.language === 'en') return (item as RawTool).name_en || item.name
      if (i18n.language === 'vi') return (item as RawTool).name_vi || item.name
      return (item as RawTool).name_zh || item.name
    },
    [i18n.language]
  )

  const fetchUnauthorized = useCallback(async () => {
    setLoading(true)
    try {
      const [mcpR, difyR, kbR, skillR, tplR] = await Promise.allSettled([
        api.get('/mcp-servers/unauthorized'),
        api.get('/dify-kb/unauthorized'),
        api.get('/kb/unauthorized'),
        api.get('/skills/unauthorized'),
        api.get('/doc-templates/unauthorized'),
      ])
      if (mcpR.status === 'fulfilled') setUnauthorizedMcp(mcpR.value.data || [])
      if (difyR.status === 'fulfilled') setUnauthorizedDify(difyR.value.data || [])
      if (kbR.status === 'fulfilled') setUnauthorizedKb(kbR.value.data || [])
      if (skillR.status === 'fulfilled') setUnauthorizedSkills(skillR.value.data || [])
      if (tplR.status === 'fulfilled') setUnauthorizedTemplates(tplR.value.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch when opening
  useEffect(() => {
    if (open) fetchUnauthorized()
  }, [open, fetchUnauthorized])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleAddTool = (item: RawTool, type: OverrideTool['type']) => {
    addTool({
      id: item.id,
      type,
      name: item.name,
      description: item.description,
      name_zh: item.name_zh,
      name_en: item.name_en,
      name_vi: item.name_vi,
      desc_zh: item.desc_zh,
      desc_en: item.desc_en,
      desc_vi: item.desc_vi,
      icon: item.icon,
      skill_type: item.type,
    })
  }

  const renderToolGroup = (items: RawTool[], type: OverrideTool['type']) => {
    if (!items.length) return null
    const unauthorized = items.filter(
      (it) => !overrideTools.some((ot) => ot.type === type && String(ot.id) === String(it.id))
    )
    if (!unauthorized.length) return null
    return (
      <div>
        <div className="px-3 py-1 text-xs font-semibold text-slate-500 flex items-center gap-1.5 bg-slate-50 border-y border-slate-100">
          {TYPE_ICONS[type]}
          {t(TYPE_LABEL_KEYS[type])}
        </div>
        {unauthorized.map((item) => (
          <div key={item.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-800 truncate">{localName(item)}</p>
              {(item.desc_zh || item.description) && (
                <p className="text-xs text-slate-400 truncate">{i18n.language === 'zh-TW' ? item.desc_zh || item.description : item.description}</p>
              )}
            </div>
            <button
              onClick={() => handleAddTool(item, type)}
              className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg flex-shrink-0 border border-blue-200"
            >
              <Plus size={10} />
              {t('adminOverride.addBtn')}
            </button>
          </div>
        ))}
      </div>
    )
  }

  const addedToolsSection = overrideTools.length > 0 && (
    <div className="border-t border-slate-100 mt-1">
      <div className="px-3 py-1 text-xs font-semibold text-slate-500 bg-orange-50 border-y border-orange-100 flex items-center gap-1">
        <FlaskConical size={11} className="text-orange-500" />
        {t('adminOverride.addedSection', { count: overrideTools.length })}
      </div>
      {overrideTools.map((tool) => (
        <div key={`${tool.type}-${tool.id}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
          {TYPE_ICONS[tool.type]}
          <span className="flex-1 text-xs text-slate-700 truncate">{tool.name_zh || tool.name}</span>
          <span className="text-xs text-slate-400 mr-1">{t(TYPE_LABEL_KEYS[tool.type])}</span>
          <button
            onClick={() => removeTool(tool.type, tool.id)}
            className="text-slate-400 hover:text-red-500 flex-shrink-0"
            title={t('adminOverride.remove')}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )

  const noUnauthorizedTools =
    !loading &&
    unauthorizedMcp.filter((i) => !overrideTools.some((o) => o.type === 'mcp' && String(o.id) === String(i.id))).length === 0 &&
    unauthorizedDify.filter((i) => !overrideTools.some((o) => o.type === 'dify' && String(o.id) === String(i.id))).length === 0 &&
    unauthorizedKb.filter((i) => !overrideTools.some((o) => o.type === 'kb' && String(o.id) === String(i.id))).length === 0 &&
    unauthorizedSkills.filter((i) => !overrideTools.some((o) => o.type === 'skill' && String(o.id) === String(i.id))).length === 0

  const unauthorizedTemplatesFiltered = unauthorizedTemplates.filter((t) => !overrideTemplates.some((ot) => ot.id === t.id))

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 text-xs border rounded-lg px-2 py-1 transition relative ${
          overrideCount > 0
            ? 'text-orange-600 border-orange-300 bg-orange-50 hover:bg-orange-100'
            : 'text-slate-400 border-slate-200 hover:text-orange-500 hover:border-orange-300'
        }`}
        title={t('adminOverride.triggerTitle')}
      >
        <FlaskConical size={13} />
        {overrideCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center leading-none font-bold">
            {overrideCount > 9 ? '9+' : overrideCount}
          </span>
        )}
        <ChevronDown size={10} />
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="p-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <FlaskConical size={14} className="text-orange-500" />
              {t('adminOverride.title')}
            </span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100">
            <button
              onClick={() => setActiveTab('tools')}
              className={`flex-1 py-2 text-xs font-medium transition ${
                activeTab === 'tools'
                  ? 'text-blue-600 border-b-2 border-blue-500'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t('adminOverride.tabTools')}
              {overrideTools.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full text-xs">
                  {overrideTools.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`flex-1 py-2 text-xs font-medium transition ${
                activeTab === 'templates'
                  ? 'text-blue-600 border-b-2 border-blue-500'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t('adminOverride.tabTemplates')}
              {overrideTemplates.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full text-xs">
                  {overrideTemplates.length}
                </span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="text-center py-8 text-slate-400 text-xs">{t('adminOverride.loading')}</div>
            ) : activeTab === 'tools' ? (
              <>
                {noUnauthorizedTools && overrideTools.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs px-4">
                    <FlaskConical size={24} className="mx-auto mb-2 opacity-30" />
                    {t('adminOverride.allAuthorized')}
                  </div>
                ) : (
                  <>
                    {noUnauthorizedTools && overrideTools.length > 0 ? null : (
                      <div className="py-1">
                        {renderToolGroup(unauthorizedMcp, 'mcp')}
                        {renderToolGroup(unauthorizedDify, 'dify')}
                        {renderToolGroup(unauthorizedKb, 'kb')}
                        {renderToolGroup(unauthorizedSkills, 'skill')}
                      </div>
                    )}
                    {addedToolsSection}
                  </>
                )}
              </>
            ) : (
              /* Templates tab */
              <>
                {unauthorizedTemplatesFiltered.length === 0 && overrideTemplates.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs px-4">
                    <FileText size={24} className="mx-auto mb-2 opacity-30" />
                    {t('adminOverride.allTemplatesAuthorized')}
                  </div>
                ) : (
                  <>
                    {unauthorizedTemplatesFiltered.length > 0 && (
                      <div className="py-1">
                        {unauthorizedTemplatesFiltered.map((tpl) => (
                          <div key={tpl.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                            <FileText size={12} className="text-indigo-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-800 truncate">{tpl.name}</p>
                              {tpl.format && <p className="text-xs text-slate-400">{tpl.format.toUpperCase()}</p>}
                            </div>
                            <button
                              onClick={() => addTemplate({ id: String(tpl.id), name: tpl.name, description: tpl.description, format: tpl.format, tags: tpl.tags })}
                              className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg flex-shrink-0 border border-blue-200"
                            >
                              <Plus size={10} />
                              {t('adminOverride.addBtn')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {overrideTemplates.length > 0 && (
                      <div className="border-t border-slate-100 mt-1">
                        <div className="px-3 py-1 text-xs font-semibold text-slate-500 bg-orange-50 border-y border-orange-100 flex items-center gap-1">
                          <FlaskConical size={11} className="text-orange-500" />
                          {t('adminOverride.addedSection', { count: overrideTemplates.length })}
                        </div>
                        {overrideTemplates.map((tpl) => (
                          <div key={tpl.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                            <FileText size={12} className="text-indigo-500 flex-shrink-0" />
                            <span className="flex-1 text-xs text-slate-700 truncate">{tpl.name}</span>
                            {tpl.format && <span className="text-xs text-slate-400">{tpl.format.toUpperCase()}</span>}
                            <button
                              onClick={() => removeTemplate(String(tpl.id))}
                              className="text-slate-400 hover:text-red-500 flex-shrink-0"
                              title={t('adminOverride.remove')}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">{t('adminOverride.footer')}</span>
            {overrideCount > 0 && (
              <button
                className="text-xs text-slate-500 hover:text-red-500 px-2 py-1"
                onClick={() => {
                  const toolsCopy = [...overrideTools]
                  const tplsCopy = [...overrideTemplates]
                  toolsCopy.forEach(t => removeTool(t.type, t.id))
                  tplsCopy.forEach(t => removeTemplate(t.id))
                  setOpen(false)
                }}
              >
                {t('adminOverride.clearAll')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
