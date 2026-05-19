/**
 * WhatIfPanel — Sprint N · What-if 模擬器(spec §16.5 / slide 16)
 *
 * UI:
 *   - 左欄:baseline metrics(quantity / cost_total / margin / due_date_days / factory)
 *   - 中欄:4 個 slider/select(quantity_pct / raw_material_pct / fx_pct / factory_code)
 *   - 右欄:projected metrics(自動算)+ delta(綠/紅)+ risks
 *   - 底部:「✨ AI 解讀」按鈕 → call /ai/what-if-analyze 拿 LLM markdown
 *
 * 規則式即時 client-side:不卡 LLM,改 slider 立刻看數值。
 * LLM 補語意解讀(optional)。
 */

import { useMemo, useState } from 'react'
import { X, Sparkles, Loader2, AlertTriangle, TrendingUp, TrendingDown, Factory, Activity, DollarSign } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type ProjectDetail } from '../api'

type Baseline = {
  quantity: number
  cost_total: number   // USD/pcs
  margin_pct: number
  due_date_days: number
  factory_code: string
}

type Scenario = {
  quantity_pct: number       // ±50%
  raw_material_pct: number   // ±20%
  fx_pct: number             // ±5%
  factory_code: string
}

const FACTORIES = [
  { code: 'VN', name: '越南' },
  { code: 'CN', name: '中國' },
  { code: 'IN', name: '印度' },
]

const DEFAULT_BASELINE: Baseline = {
  quantity: 10000,
  cost_total: 3.80,
  margin_pct: 16,
  due_date_days: 21,
  factory_code: 'VN',
}

export default function WhatIfPanel({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const { token } = useAuth() as any
  const dp = (project.data_payload as any) || {}

  // 從 project payload 推 baseline(沒值用 DEFAULT)
  const [baseline] = useState<Baseline>({
    quantity:      Number(dp.quantity) || DEFAULT_BASELINE.quantity,
    cost_total:    Number(dp.cost_total) || DEFAULT_BASELINE.cost_total,
    margin_pct:    Number(dp.margin_pct) || DEFAULT_BASELINE.margin_pct,
    due_date_days: Number(dp.estimatedCycleDays) || DEFAULT_BASELINE.due_date_days,
    factory_code:  String(dp.factory_code || dp.plant || DEFAULT_BASELINE.factory_code),
  })

  const [scenario, setScenario] = useState<Scenario>({
    quantity_pct: 0,
    raw_material_pct: 0,
    fx_pct: 0,
    factory_code: baseline.factory_code,
  })

  // Client-side rule-based projection(立刻反應)
  const projection = useMemo(() => _computeProjection(baseline, scenario), [baseline, scenario])

  // LLM 解讀
  const [explainOpen, setExplainOpen] = useState(false)
  const [explainMd, setExplainMd] = useState<string | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainErr, setExplainErr] = useState<string | null>(null)

  const askLlm = async () => {
    setExplainOpen(true)
    setExplainLoading(true)
    setExplainErr(null)
    setExplainMd(null)
    try {
      const r: any = await api.post(token, '/ai/what-if-analyze', {
        project_id: project.id,
        baseline,
        scenario,
      })
      setExplainMd(r.explanation_md || r.explanation || '(無解讀,可能 LLM 未啟用)')
    } catch (e: any) {
      setExplainErr(e.message)
    } finally {
      setExplainLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-[1080px] w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-cortex-navy via-purple-700 to-cortex-teal px-5 py-3.5 text-white flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-cortex-cyan font-bold inline-flex items-center gap-1">
              <Activity size={11} /> AI #18 What-if 模擬器
            </div>
            <div className="text-base font-bold">改參數即時看影響(spec §16.5)</div>
          </div>
          <button onClick={onClose} className="text-cortex-cyan-bg hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-3 divide-x divide-cortex-line">

            {/* Baseline */}
            <section className="p-4 bg-cortex-bg/40">
              <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">
                BASELINE(現況)
              </div>
              <MetricRow label="數量"     value={baseline.quantity.toLocaleString()} unit="pcs" />
              <MetricRow label="單位 cost" value={baseline.cost_total.toFixed(2)}   unit="USD/pcs" />
              <MetricRow label="毛利"     value={`${baseline.margin_pct}`}          unit="%" />
              <MetricRow label="交期"     value={`${baseline.due_date_days}`}       unit="天" />
              <MetricRow label="廠區"     value={baseline.factory_code}             />
              <div className="text-[9px] text-cortex-muted mt-3 italic">
                來自 project.data_payload(若沒值 → DEFAULT)
              </div>
            </section>

            {/* Scenario controls */}
            <section className="p-4">
              <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">
                SCENARIO(調整參數)
              </div>

              <Slider
                label="數量"
                value={scenario.quantity_pct}
                min={-50} max={100} step={5}
                unit="%"
                hint={(v) => `→ ${Math.round(baseline.quantity * (1 + v / 100)).toLocaleString()} pcs`}
                onChange={(v) => setScenario((s) => ({ ...s, quantity_pct: v }))}
              />
              <Slider
                label="原料"
                value={scenario.raw_material_pct}
                min={-20} max={30} step={1}
                unit="%"
                hint={(v) => v > 0 ? `原料漲 ${v}%` : v < 0 ? `原料跌 ${-v}%` : '無變動'}
                onChange={(v) => setScenario((s) => ({ ...s, raw_material_pct: v }))}
              />
              <Slider
                label="匯率"
                value={scenario.fx_pct}
                min={-10} max={10} step={1}
                unit="%"
                hint={(v) => v > 0 ? `USD 升值 ${v}%` : v < 0 ? `USD 貶值 ${-v}%` : '無變動'}
                onChange={(v) => setScenario((s) => ({ ...s, fx_pct: v }))}
              />

              <div className="mb-3">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-cortex-text font-semibold inline-flex items-center gap-1">
                    <Factory size={11} /> 廠區
                  </span>
                  {scenario.factory_code !== baseline.factory_code && (
                    <span className="text-[9px] text-amber-700 font-bold bg-cortex-amber-bg px-1.5 py-0.5 rounded">
                      {baseline.factory_code} → {scenario.factory_code}
                    </span>
                  )}
                </div>
                <select
                  value={scenario.factory_code}
                  onChange={(e) => setScenario((s) => ({ ...s, factory_code: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-cortex-line rounded text-[12px]"
                >
                  {FACTORIES.map((f) => (
                    <option key={f.code} value={f.code}>{f.code} · {f.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => setScenario({
                  quantity_pct: 0, raw_material_pct: 0, fx_pct: 0,
                  factory_code: baseline.factory_code,
                })}
                className="text-[10px] text-cortex-ocean hover:underline"
              >
                ↻ 重置 baseline
              </button>
            </section>

            {/* Projected */}
            <section className="p-4 bg-cortex-cyan-bg/20">
              <div className="text-[10px] font-bold text-cortex-teal uppercase tracking-widest mb-2">
                PROJECTED(預測)
              </div>
              <MetricRow
                label="數量"
                value={Math.round(baseline.quantity * (1 + scenario.quantity_pct / 100)).toLocaleString()}
                unit="pcs"
                delta={scenario.quantity_pct ? `${scenario.quantity_pct > 0 ? '+' : ''}${scenario.quantity_pct}%` : null}
                deltaIsGood={scenario.quantity_pct > 0}
              />
              <MetricRow
                label="單位 cost"
                value={projection.cost_total.toFixed(2)}
                unit="USD/pcs"
                delta={projection.dCostPct ? `${projection.dCostPct > 0 ? '+' : ''}${projection.dCostPct}%` : null}
                deltaIsGood={projection.dCostPct < 0}
              />
              <MetricRow
                label="毛利"
                value={projection.margin_pct.toFixed(1)}
                unit="%"
                delta={projection.dMargin ? `${projection.dMargin > 0 ? '+' : ''}${projection.dMargin.toFixed(2)}pp` : null}
                deltaIsGood={projection.dMargin > 0}
                highlight={projection.margin_pct < 10}
              />
              <MetricRow
                label="交期"
                value={projection.due_date_days.toFixed(1)}
                unit="天"
                delta={projection.dDays ? `${projection.dDays > 0 ? '+' : ''}${projection.dDays.toFixed(1)}` : null}
                deltaIsGood={projection.dDays < 0}
              />
              <MetricRow label="廠區" value={scenario.factory_code} />

              {/* Risks */}
              {projection.risks.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">⚠ 風險</div>
                  {projection.risks.map((r, i) => (
                    <div
                      key={i}
                      className={`text-[10px] px-2 py-1 rounded border ${
                        r.level === 'high' ? 'bg-cortex-red-bg/40 border-red-300 text-red-700' :
                                              'bg-cortex-amber-bg/60 border-amber-300 text-amber-800'
                      }`}
                    >
                      <AlertTriangle size={9} className="inline -mt-px mr-1" />
                      {r.message}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* AI 解讀 */}
          <div className="border-t border-cortex-line p-4 bg-gradient-to-r from-purple-50 to-cortex-cyan-bg/30">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={askLlm}
                disabled={explainLoading}
                className="px-3 py-1.5 text-[12px] font-bold rounded inline-flex items-center gap-1 bg-gradient-to-r from-purple-500 to-cortex-teal text-white disabled:opacity-50"
              >
                {explainLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                ✨ AI 解讀
              </button>
              <span className="text-[10px] text-cortex-muted">
                為什麼這些 delta?風險點?補救建議?
              </span>
            </div>
            {explainOpen && (
              <div className="bg-white border border-purple-200 rounded p-3 text-[12px]">
                {explainLoading && (
                  <div className="text-cortex-muted italic">
                    <Loader2 size={11} className="inline animate-spin mr-1" />
                    Gemini Flash 分析中…
                  </div>
                )}
                {explainErr && (
                  <div className="text-red-700">
                    <AlertTriangle size={10} className="inline -mt-px mr-1" />
                    解讀失敗:{explainErr}
                  </div>
                )}
                {explainMd && (
                  <div className="text-cortex-ink leading-relaxed whitespace-pre-wrap">{explainMd}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
function MetricRow({ label, value, unit, delta, deltaIsGood, highlight }: {
  label: string; value: string; unit?: string; delta?: string | null; deltaIsGood?: boolean; highlight?: boolean
}) {
  return (
    <div className={`flex items-center justify-between text-[12px] py-1 border-b border-cortex-line/40 last:border-b-0 ${highlight ? 'bg-cortex-red-bg/30 px-1.5 -mx-1.5 rounded' : ''}`}>
      <span className="text-cortex-muted text-[10px]">{label}</span>
      <span className="font-mono font-bold text-cortex-ink">
        {value} {unit && <span className="text-[9px] text-cortex-muted font-normal">{unit}</span>}
        {delta && (
          <span className={`ml-1.5 text-[9px] inline-flex items-center gap-0.5 ${deltaIsGood ? 'text-cortex-green' : 'text-red-600'}`}>
            {deltaIsGood ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {delta}
          </span>
        )}
      </span>
    </div>
  )
}

function Slider({ label, value, min, max, step, unit, hint, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  hint?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-cortex-text font-semibold inline-flex items-center gap-1">
          {label === '原料' ? <DollarSign size={10} /> : null}
          {label}
        </span>
        <span className={`font-mono font-bold ${value > 0 ? 'text-cortex-green' : value < 0 ? 'text-red-600' : 'text-cortex-muted'}`}>
          {value > 0 ? '+' : ''}{value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      {hint && (
        <div className="text-[9px] text-cortex-muted mt-0.5 font-mono">{hint(value)}</div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Client-side rule-based projection(對齊 server aiWhatIfService._ruleBasedProject)
// ────────────────────────────────────────────────────────────────────
function _computeProjection(baseline: Baseline, scenario: Scenario) {
  const scaleCostMul    = 1 - (scenario.quantity_pct / 100) * 0.15
  const rawCostMul      = 1 + (scenario.raw_material_pct / 100) * 0.60
  const fxCostMul       = 1 + scenario.fx_pct / 100
  const factorySwitch   = scenario.factory_code !== baseline.factory_code
  const factoryCostMul  = factorySwitch ? 1.05 : 1
  const factoryLeadMul  = factorySwitch ? 1.10 : 1
  const scaleFactor     = 1 + scenario.quantity_pct / 100

  const newCostTotal = baseline.cost_total * scaleCostMul * rawCostMul * fxCostMul * factoryCostMul
  const baselineRevenue = baseline.cost_total / Math.max(0.01, 1 - baseline.margin_pct / 100)
  const newMarginPct = baselineRevenue > 0 ? (1 - newCostTotal / baselineRevenue) * 100 : 0
  const newDueDays = baseline.due_date_days * factoryLeadMul * scaleFactor

  const dCost   = newCostTotal - baseline.cost_total
  const dMargin = newMarginPct - baseline.margin_pct
  const dDays   = newDueDays - baseline.due_date_days
  const dCostPct = baseline.cost_total > 0 ? (dCost / baseline.cost_total) * 100 : 0

  const risks: { level: 'high' | 'mid'; message: string }[] = []
  if (newMarginPct < 5) risks.push({ level: 'high', message: `毛利率降至 ${newMarginPct.toFixed(1)}%(< 5% 警戒線)` })
  else if (newMarginPct < 10) risks.push({ level: 'mid', message: `毛利率低於 10%` })
  if (newDueDays > baseline.due_date_days * 1.2) risks.push({ level: 'mid', message: `交期延長 > 20%` })
  if (scenario.quantity_pct > 50) risks.push({ level: 'high', message: `數量翻倍 → 產能 / 良率風險,需 NPI 重評` })
  if (scenario.raw_material_pct > 10) risks.push({ level: 'mid', message: `原料漲 > 10%,建議鎖價` })

  return {
    cost_total: newCostTotal,
    margin_pct: newMarginPct,
    due_date_days: newDueDays,
    dCost, dMargin, dDays,
    dCostPct: Math.round(dCostPct * 100) / 100,
    risks,
  }
}
