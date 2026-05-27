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

import { useState } from 'react'
import type { ProjectDetail } from '../../api'
import VariantSection from './VariantSection'
import NreSection from './NreSection'
import PackagingSection from './PackagingSection'
import FactoryMatrixSection from './FactoryMatrixSection'
import CustomerSection from './CustomerSection'
import AiToolbarSection from './AiToolbarSection'

type SectionId =
  | 'customer'
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
  { id: 'variant',   label: 'CMF 變體', icon: '🎨', isNew: true,
    visible: (p) => !!(p.data_payload as any)?.variants?.items?.length,
    badge:   (p) => `${(p.data_payload as any)?.variants?.items?.length || 0} variant` },
  { id: 'packaging', label: 'Packaging', icon: '📦', isNew: true,
    visible: (p) => !!(p.data_payload as any)?.packaging?.items?.length,
    badge:   (p) => `${(p.data_payload as any)?.packaging?.items?.length || 0} 項` },
  { id: 'nre',       label: 'NRE 成本',  icon: '🔧', isNew: true,
    visible: (p) => !!(p.data_payload as any)?.nre?.items?.length,
    badge:   (p) => `${(p.data_payload as any)?.nre?.items_done || 0}/${(p.data_payload as any)?.nre?.items_count || 0}` },
  { id: 'cost',      label: '成本核算',  icon: '📊',
    visible: () => true,
    badge:   (p) => (p.data_payload as any)?.factory_matrix ? '3 廠對比 v0.5' : null },
  { id: 'ai',        label: 'AI 工具',  icon: '✨',  visible: () => true },
]

export default function FormPanel({ project }: { project: ProjectDetail }) {
  const visibleSections = SECTIONS.filter((s) => s.visible(project))
  const [activeSection, setActiveSection] = useState<SectionId>(visibleSections[0]?.id || 'customer')

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
        {activeSection === 'variant'   && <VariantSection   project={project} />}
        {activeSection === 'packaging' && <PackagingSection project={project} />}
        {activeSection === 'nre'       && <NreSection       project={project} />}
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

      {/* Cost breakdown stub(若無 matrix · 顯示舊版機密 mask 提示)*/}
      {!hasMatrix && (
        <div className="bg-cortex-bg/40 border border-cortex-line rounded-lg p-4">
          <div className="text-[13px] font-bold text-cortex-ink mb-2">📊 成本核算</div>
          <div className="text-[11px] text-cortex-muted">
            此專案未啟用 Multi-Factory Matrix(spec §11.3.8)。預設成本以單廠表示。
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
            <div className="bg-white border border-cortex-line rounded p-2">
              <div className="text-[10px] text-cortex-muted">amount</div>
              <div className="font-mono font-bold text-cortex-ink">{dp?.amount ?? '—'}</div>
            </div>
            <div className="bg-white border border-cortex-line rounded p-2">
              <div className="text-[10px] text-cortex-muted">margin</div>
              <div className="font-mono font-bold text-cortex-ink">{dp?.margin ?? '—'}</div>
            </div>
            <div className="bg-white border border-cortex-line rounded p-2">
              <div className="text-[10px] text-cortex-muted">cost_breakdown</div>
              <div className="font-mono font-bold text-cortex-ink">{dp?.cost_breakdown ?? '—'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
