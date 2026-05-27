/**
 * AiToolbarSection — Form tab 「AI 工具」section
 *
 * 把 Sprint M-11 / M-12 / N / O 的入口集中到 Form 內(原本散在 Form / WarRoom header)
 * 業務 demo 時可在 Form section 內一次看到所有 AI 工具。
 */

import { useState } from 'react'
import { Sparkles, Factory, Activity, Trophy } from 'lucide-react'
import type { ProjectDetail } from '../../api'
import AiSuggestionModal from '../AiSuggestionModal'
import CleansheetPanel from '../CleansheetPanel'
import WhatIfPanel from '../WhatIfPanel'
import WinRatePanel from '../WinRatePanel'

const TOOLS = [
  {
    key: 'pricing',
    label: 'AI 建議定價(Sprint M-11)',
    icon: Sparkles,
    color: 'from-purple-500 to-cortex-teal',
    desc: '對 amount / margin / cost_breakdown / priorityScore 走影子表建議 · 沉澱 KB 歷史相似案 RAG',
    spec: 'spec §12.5 Form Surface 2 + #16 智慧定價',
  },
  {
    key: 'cleansheet',
    label: 'Cleansheet 三廠分析(Sprint M-12)',
    icon: Factory,
    color: 'from-cortex-navy to-cortex-teal',
    desc: '輸三廠 cost_breakdown → 規則式 + LLM 解讀推薦廠 / 風險',
    spec: 'spec §12.10.4 #12',
  },
  {
    key: 'whatif',
    label: 'What-if 模擬器(Sprint N)',
    icon: Activity,
    color: 'from-purple-600 to-cortex-teal',
    desc: 'slider 改數量 / 原料 / 匯率 / 廠區 → 即時算 cost / margin / 交期 delta + 風險',
    spec: 'spec §16.5 預測能力 B 層',
  },
  {
    key: 'winrate',
    label: '贏單機率預測(Sprint O)',
    icon: Trophy,
    color: 'from-cortex-navy to-purple-700',
    desc: '抽 features(歷史相似案 / BU win rate / priority / 季節 / task health)→ 規則式預測 + LLM 解讀',
    spec: 'spec §16.4 預測能力 C 層',
  },
]

export default function AiToolbarSection({ project }: { project: ProjectDetail }) {
  const [pricingField, setPricingField] = useState<{ key: string; label: string } | null>(null)
  const [showCleansheet, setShowCleansheet] = useState(false)
  const [showWhatIf, setShowWhatIf] = useState(false)
  const [showWinRate, setShowWinRate] = useState(false)

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2">
          ✨ AI 工具列
          <span className="text-[10px] font-normal text-cortex-muted">spec §12 + §16</span>
        </h3>
        <p className="text-[12px] text-cortex-muted mt-0.5">
          四個 AI 工具直接從 Form 觸發 · 也可從 WarRoom header / 報價 Form 內按鈕入口
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {TOOLS.map((t) => {
          const Icon = t.icon
          const openIt = () => {
            if (t.key === 'pricing')    setPricingField({ key: 'amount', label: '報價金額' })
            if (t.key === 'cleansheet') setShowCleansheet(true)
            if (t.key === 'whatif')     setShowWhatIf(true)
            if (t.key === 'winrate')    setShowWinRate(true)
          }
          return (
            <button
              key={t.key}
              onClick={openIt}
              className={`bg-gradient-to-br ${t.color} text-white rounded-xl p-4 text-left hover:brightness-105 transition shadow-md`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={18} />
                <span className="text-[14px] font-bold">{t.label}</span>
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed mb-2">{t.desc}</p>
              <div className="text-[10px] opacity-70 italic">{t.spec}</div>
            </button>
          )
        })}
      </div>

      <div className="bg-cortex-bg/60 border-l-2 border-cortex-cyan rounded-r p-3 text-[11px] text-cortex-text leading-relaxed">
        💡 4 個 AI 工具走 Gemini Flash + LLM cache · 機密欄位走 confidentialityMiddleware + plugin scrub_rules 雙段 scrub
        · 設 <code className="bg-white px-1 py-0.5 rounded">PROJECTS_PLATFORM_USE_LLM=true</code> 跑真 Gemini,否則 stub mock
      </div>

      {pricingField && (
        <AiSuggestionModal
          project={project}
          field={pricingField.key}
          fieldLabel={pricingField.label}
          onClose={() => setPricingField(null)}
          onAccept={() => setPricingField(null)}
        />
      )}
      {showCleansheet && <CleansheetPanel project={project} onClose={() => setShowCleansheet(false)} />}
      {showWhatIf     && <WhatIfPanel     project={project} onClose={() => setShowWhatIf(false)} />}
      {showWinRate    && <WinRatePanel    project={project} onClose={() => setShowWinRate(false)} />}
    </div>
  )
}
