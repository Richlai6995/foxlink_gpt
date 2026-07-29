/**
 * FormPanel — WarRoom > 報價 Form tab(v0.5 多 section · spec §11)
 *
 * 對齊 docs/Cortex_互動Demo_v0.5.html renderFormTab() 設計。
 *
 * Section list:
 *   1. 客戶資料(原 FormStub)
 *   2. CMF 變體 · 🆕 v0.5 §11.3.5 (僅 data_payload.variants 存在才顯)
 *   3. BOM(stub)
 *   4. Packaging Sub-form · 🆕 v0.5 §11.3.7
 *   5. NRE 成本 · 🆕 v0.5 §11.3.6
 *   6. 成本核算(含 Multi-Factory Matrix · 🆕 v0.5 §11.3.8)
 *   7. 策略 / 法務(原 FormStub「其他」)
 *   8. AI 工具列(AI 建議 / Cleansheet / What-if · 既有)
 *
 * 全唯讀(讀 project.data_payload JSON)— Phase 2 才上 Form Builder 編輯
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import VariantSection from './VariantSection'
import NreRealSection from './NreRealSection'
import PackagingSection from './PackagingSection'
import FactoryMatrixSection from './FactoryMatrixSection'
import CustomerSection from './CustomerSection'
import AiToolbarSection from './AiToolbarSection'
import BomSection from './BomSection'
import CostSummarySection from './CostSummarySection'
import WorkflowChecklistSection from './WorkflowChecklistSection'

type SectionId =
  | 'customer'
  | 'workflow'
  | 'bom'
  | 'variant'
  | 'nre'
  | 'packaging'
  | 'cost'
  | 'ai'

type SectionDef = {
  id: SectionId
  label: string
  icon: string
  isNew?: boolean
  visible: (p: ProjectDetail) => boolean
  badge?: (p: ProjectDetail) => string | null
}

const SECTIONS: SectionDef[] = [
  { id: 'customer',  label: '客戶資料', icon: '👥', visible: () => true },
  { id: 'workflow',  label: '操作流程', icon: '🎬', isNew: true, visible: () => true },
  { id: 'bom',       label: 'BOM / 材料', icon: '📦', isNew: true, visible: () => true },
  { id: 'variant',   label: 'CMF 變體', icon: '🎨', isNew: true,
    visible: (p) => !!(p.data_payload as any)?.variants?.items?.length,
    badge:   (p) => `${(p.data_payload as any)?.variants?.items?.length || 0} variant` },
  { id: 'packaging', label: 'Packaging', icon: '📦', isNew: true,
    visible: (p) => !!(p.data_payload as any)?.packaging?.items?.length,
    badge:   (p) => `${(p.data_payload as any)?.packaging?.items?.length || 0} 項` },
  { id: 'nre',       label: 'NRE 成本',  icon: '🔧', isNew: true, visible: () => true },
  { id: 'cost',      label: '成本核算',  icon: '📊',
    visible: () => true,
    badge:   (p) => (p.data_payload as any)?.factory_matrix ? '3 廠對比 v0.5' : null },
  { id: 'ai',        label: 'AI 工具',  icon: '✨',  visible: () => true },
]

// sidebar section id → 完成度 service 段 key(多對一加總;v0.16 plan #0)
const COMPLETION_MAP: Record<SectionId, string[]> = {
  customer: ['customer'],
  workflow: ['workflow'],
  bom: ['bom'],
  variant: ['variant'],
  packaging: ['packaging'],
  nre: ['nre'],
  cost: ['cost', 'factory_matrix', 'cleansheet', 'strategy'],
  ai: [],
}

export default function FormPanel({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const visibleSections = SECTIONS.filter((s) => s.visible(project))
  const [activeSection, setActiveSection] = useState<SectionId>(visibleSections[0]?.id || 'customer')
  // 完成度(真計算 · GET /bom/form);表單存檔後由 cortex:form-refresh 重抓
  const [completion, setCompletion] = useState<Record<string, { filled: number; total: number; status: string }>>({})
  useEffect(() => {
    if (!token || !project?.id) return
    const load = () => api.get<any>(token, `/bom/form?projectId=${project.id}`)
      .then((r) => {
        const m: any = {}
        for (const c of r.completion || []) m[c.key] = c
        setCompletion(m)
      }).catch(() => {})
    load()
    const h = () => load()
    window.addEventListener('cortex:form-refresh', h)
    window.addEventListener('cortex:stage-refresh', h)
    return () => { window.removeEventListener('cortex:form-refresh', h); window.removeEventListener('cortex:stage-refresh', h) }
  }, [token, project?.id])
  useEffect(() => {
    const h = (e: any) => { const id = e?.detail as SectionId; if (id) setActiveSection(id) }
    window.addEventListener('cortex:goto-section', h)
    return () => window.removeEventListener('cortex:goto-section', h)
  }, [])
  const compOf = (id: SectionId) => {
    const keys = COMPLETION_MAP[id] || []
    let f = 0, t = 0
    for (const k of keys) { const c = completion[k]; if (c && c.total > 0) { f += c.filled; t += c.total } }
    return t > 0 ? { f, t, pct: Math.round((f / t) * 100) } : null
  }

  return (
    <div className="grid grid-cols-[180px_1fr] divide-x divide-cortex-line min-h-[560px]">
      {/* Section navigator(左) */}
      <aside className="overflow-y-auto bg-cortex-bg/40">
        <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest px-3 py-2 border-b border-cortex-line">
          Form Sections
        </div>
        {visibleSections.map((s) => {
          const active = s.id === activeSection
          const badge = s.badge ? s.badge(project) : null
          return (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-cortex-line/50 transition ${
                active ? 'bg-cortex-cyan-bg' : 'hover:bg-cortex-line-2/40'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[14px]">{s.icon}</span>
                <span className={`text-[12px] font-semibold ${active ? 'text-cortex-teal' : 'text-cortex-ink'}`}>
                  {s.label}
                </span>
                {s.isNew && (
                  <span className="text-[8px] font-bold bg-purple-100 text-purple-700 px-1 py-0.5 rounded">
                    v0.5
                  </span>
                )}
              </div>
              {badge && (
                <div className="text-[10px] text-cortex-muted mt-0.5 ml-5 font-mono">{badge}</div>
              )}
              {(() => {
                const c = compOf(s.id)
                if (!c) return null
                return (
                  <div className="flex items-center gap-1.5 mt-1 ml-5">
                    <div className="flex-1 h-1 bg-cortex-line/60 rounded overflow-hidden max-w-[90px]">
                      <div className={`h-full rounded ${c.pct >= 100 ? 'bg-green-500' : c.pct > 0 ? 'bg-amber-400' : 'bg-cortex-line'}`} style={{ width: `${c.pct}%` }} />
                    </div>
                    <span className={`text-[9px] font-mono ${c.pct >= 100 ? 'text-green-600' : 'text-cortex-muted'}`}>{c.f}/{c.t} · {c.pct}%</span>
                  </div>
                )
              })()}
            </button>
          )
        })}
        <div className="px-3 py-2 mt-2 text-[10px] text-cortex-muted/70 leading-relaxed border-t border-cortex-line">
          spec §11 Form 引擎<br />
          Phase 1 = 唯讀<br />
          Phase 2 = GUI Builder
        </div>
      </aside>

      {/* Active section content(右) */}
      <main className="overflow-y-auto p-5 bg-white">
        {activeSection === 'customer'  && <CustomerSection  project={project} />}
        {activeSection === 'workflow'  && <WorkflowChecklistSection project={project} />}
        {activeSection === 'bom'       && <BomSection       project={project} />}
        {activeSection === 'variant'   && <VariantSection   project={project} />}
        {activeSection === 'packaging' && <PackagingSection project={project} />}
        {activeSection === 'nre'       && <NreRealSection   project={project} />}
        {activeSection === 'cost'      && <CostSection      project={project} />}
        {activeSection === 'ai'        && <AiToolbarSection project={project} />}
      </main>
    </div>
  )
}

// ─── Cost 包成 wrapper(含 Factory Matrix)──────────────────────────
function CostSection({ project }: { project: ProjectDetail }) {
  const dp = project.data_payload as any
  const hasMatrix = !!dp?.factory_matrix
  return (
    <div className="space-y-4">
      {hasMatrix && <FactoryMatrixSection project={project} />}

      {/* §9.3:無 demo matrix → 接真 run_result 多廠彙總(取代舊 stub)*/}
      {!hasMatrix && <CostSummarySection project={project} />}
    </div>
  )
}
