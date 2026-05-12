/**
 * AI 加速 10 項一覽頁
 *
 * 對齊 PPT slide 21 + Demo 手冊 §8
 *
 * Phase 1 末上線(Gemini Flash · USD $150-250/月)
 * 整合到既有功能(Wizard / Chat / Task / Form / Dashboard),不是另起新頁
 *
 * 必上 8 + 加分 2 = 10 項
 *   v3 移除 12 → 10:
 *     ❌ #10 長料件預警(MP 階段才需,移到 Phase 4)
 *     ❌ #14 三廠對比 AI 解讀(廠區客戶指定,不需 AI)
 */

import { Sparkles, FileText, History, Users, Bell, Crown, Cpu, Clock, Star, TrendingUp, MessageSquare, ListChecks, Eye, GitBranch } from 'lucide-react'
import { useCrumbs } from '../Shell/PlatformContext'

type AiItem = {
  num: number
  star?: boolean
  title: string
  stage: string
  benefit: string
  integration: string
  icon: any
  status: 'live' | 'mock' | 'planned'
  category: 'core' | 'plus'
}

const ITEMS: AiItem[] = [
  {
    num: 21, star: true,
    title: '⭐ 狀態 SUMMARY',
    stage: '全程 · 三處顯示',
    benefit: '主管 30 秒掃完所有專案 · 業務不爬 channel',
    integration: '#announcement Pin / 列表行下 / Watchlist hover',
    icon: Sparkles, status: 'mock', category: 'core',
  },
  {
    num: 1, star: true,
    title: 'RFQ 自動解析',
    stage: 'Stage 1 · 開案 Wizard Step 1',
    benefit: '拖檔案進系統 → form 自動填 70% · 92% 信心度',
    integration: '整合 Wizard Step 1',
    icon: FileText, status: 'mock', category: 'core',
  },
  {
    num: 2, star: true,
    title: '歷史相似案推薦',
    stage: 'Stage 1 · Wizard Step 2',
    benefit: '開案立刻看到「過去類似 3 案」+ 推薦 PM',
    integration: '整合 Wizard Step 2 + Form 議價 section',
    icon: History, status: 'mock', category: 'core',
  },
  {
    num: 5,
    title: 'Q&A 問題自動草稿',
    stage: 'Stage 2 Q&A Collect',
    benefit: 'DPM 不用想要問什麼 · AI 列 5-10 問題給客戶',
    integration: '整合 #qa-customer channel',
    icon: MessageSquare, status: 'planned', category: 'core',
  },
  {
    num: 23,
    title: 'AI 決策紀錄自動 Pin',
    stage: '全程 · channel 內',
    benefit: '對話中講「決定...」AI 自動 Pin 到 #announcement',
    integration: '整合所有 channel message hooks',
    icon: Crown, status: 'planned', category: 'core',
  },
  {
    num: 24,
    title: '訊息智慧排序',
    stage: '進入 channel',
    benefit: '@我 / DECISION / BLOCKER 排最前',
    integration: '整合 chat 分頁訊息排序',
    icon: ListChecks, status: 'planned', category: 'core',
  },
  {
    num: 26,
    title: 'Bot 主動提醒',
    stage: '全程 · SLA 接近時',
    benefit: 'SLA 接近時 @owner 自動催 + 上下文判斷',
    integration: '整合 task SLA cron',
    icon: Bell, status: 'planned', category: 'core',
  },
  {
    num: 29,
    title: '任務自動拆解',
    stage: 'Stage 4-5',
    benefit: 'PM 一句話「跑越南成本」→ AI 拆 4 子項',
    integration: '整合 task 新增按鈕(+ AI 拆解)',
    icon: GitBranch, status: 'planned', category: 'core',
  },
  {
    num: 32,
    title: '交期合理性檢查',
    stage: 'Stage 6 BOM Review · Wizard Step 2',
    benefit: '依 lead time + RACI 工時推算可行 schedule',
    integration: '整合 Wizard Step 2 + Form 交期欄位',
    icon: Clock, status: 'mock', category: 'plus',
  },
  {
    num: 37,
    title: '歷史案主動推薦',
    stage: '全程 · 機會偵測',
    benefit: '寫到某客戶/料件,AI 主動跳「3 年前類似案」',
    integration: '整合 Wizard Step 2 + Form 填寫時 hint',
    icon: Star, status: 'mock', category: 'plus',
  },
]

const STATUS_STYLE: Record<AiItem['status'], { label: string; bg: string; text: string; ico: string }> = {
  live:    { label: 'LIVE',  bg: 'bg-cortex-green-bg',  text: 'text-green-700',  ico: '✓' },
  mock:    { label: 'DEMO',  bg: 'bg-cortex-amber-bg',  text: 'text-amber-800',  ico: '◐' },
  planned: { label: 'TBD',   bg: 'bg-cortex-line-2',    text: 'text-cortex-muted', ico: '○' },
}

export default function AiAcceleration() {
  useCrumbs([{ label: 'AI 加速 10' }])

  const live = ITEMS.filter((i) => i.status === 'live').length
  const mock = ITEMS.filter((i) => i.status === 'mock').length
  const planned = ITEMS.filter((i) => i.status === 'planned').length

  return (
    <div className="space-y-5">
      {/* Hero banner */}
      <div className="bg-gradient-to-br from-cortex-navy via-cortex-teal to-purple-700 rounded-xl p-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 opacity-10">
          <Cpu size={180} />
        </div>
        <div className="text-[11px] font-bold text-cortex-cyan tracking-[3px] mb-2">⭐ AI ACCELERATION · v3</div>
        <h1 className="text-3xl font-extrabold mb-2">AI 加速 10 項 + ⭐ 開案 Wizard</h1>
        <p className="text-[13px] text-cortex-cyan-bg/90 mb-4 leading-relaxed">
          Phase 1 末上線 · Gemini Flash 預估 USD $150-250/月 · 整合到既有功能,不另起新頁<br />
          ⭐ 核心 8 項 + 加分 2 項 · v3 移除 #10 長料件預警 + #14 三廠對比(移到 Phase 4)
        </p>
        <div className="flex gap-3 text-[12px]">
          <span className="bg-cortex-green-bg text-green-700 px-2 py-1 rounded font-bold">
            ✓ LIVE: {live}
          </span>
          <span className="bg-cortex-amber-bg text-amber-800 px-2 py-1 rounded font-bold">
            ◐ DEMO: {mock}
          </span>
          <span className="bg-white/10 text-cortex-cyan-bg px-2 py-1 rounded font-bold">
            ○ TBD: {planned}
          </span>
        </div>
      </div>

      {/* ⭐ Wizard banner */}
      <div className="bg-gradient-to-r from-cortex-navy to-purple-700 rounded-xl p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-cortex-cyan text-cortex-navy rounded-lg flex items-center justify-center font-extrabold text-xl">
            ⭐
          </div>
          <div className="flex-1">
            <div className="text-[24px] font-extrabold">開案 7 步驟 Wizard · 30min → 5min</div>
            <div className="text-[13px] text-cortex-cyan-bg/80 mt-1">
              整合 #1 RFQ 解析 + #2 歷史相似 + #32 交期合理 + #37 主動推薦 · 業務拖 RFQ → AI 自動填 → 7 步到啟動
            </div>
            <div className="text-[11px] text-amber-200 font-bold mt-1.5">▶ 在「我的專案」按「+ 新增專案」即可試用</div>
          </div>
        </div>
      </div>

      {/* Core 8 items */}
      <div>
        <h2 className="text-base font-bold text-cortex-ink mb-3">
          Phase 1 必上 8 項(核心)
          <span className="ml-2 text-[11px] font-normal text-cortex-muted">沿 RFQ 8-stage 加速</span>
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {ITEMS.filter((i) => i.category === 'core').map((it) => <AiCard key={it.num} item={it} />)}
        </div>
      </div>

      {/* Plus 2 items */}
      <div>
        <h2 className="text-base font-bold text-cortex-ink mb-3">
          加分 2 項(業務超有感)
          <span className="ml-2 text-[11px] font-normal text-cortex-muted">機會偵測 + 交期檢查</span>
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {ITEMS.filter((i) => i.category === 'plus').map((it) => <AiCard key={it.num} item={it} />)}
        </div>
      </div>

      {/* Phase 2-4 roadmap */}
      <div className="bg-white border border-cortex-line rounded-xl p-4">
        <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-widest mb-3">未來 Phase 規劃</div>
        <div className="grid grid-cols-3 gap-3 text-[11px]">
          <PhaseCard
            title="Phase 2(4-8 週)"
            color="bg-cortex-cyan-bg border-cortex-cyan/30"
            items={['AI 13 項深化', 'Cleansheet 智慧分析', '智慧定價建議', '主管日報']}
          />
          <PhaseCard
            title="Phase 3(8-12 週)"
            color="bg-purple-50 border-purple-200"
            items={['What-if 模擬', '贏單機率預測', 'ML 預測警示', '多級簽核']}
          />
          <PhaseCard
            title="Phase 4(持續)"
            color="bg-cortex-line-2 border-cortex-line"
            items={['#10 長料件預警(MP 階段)', '#14 三廠對比 AI 解讀', '其他 plugin (TRAINING / IT)']}
          />
        </div>
      </div>

      {/* Cost note */}
      <div className="bg-gradient-to-br from-cortex-amber-bg/60 to-white border border-amber-200 rounded-lg p-4 text-[11px] text-amber-900">
        <div className="font-bold mb-1.5">💰 Phase 1 成本估算</div>
        <ul className="space-y-0.5 leading-relaxed">
          <li>• Gemini Flash · USD $150-250 / 月</li>
          <li>• 基於 100 個活躍專案/月 × 平均每案 50 次 AI 呼叫</li>
          <li>• 主要為 SUMMARY(高頻)+ 解析 / 拆解 / Wizard 預填(中頻)</li>
          <li>• LLM Queue(rate limiter):預設 5 req/s + burst 20(spec §scaffold)</li>
        </ul>
      </div>
    </div>
  )
}

function AiCard({ item }: { item: AiItem }) {
  const Icon = item.icon
  const s = STATUS_STYLE[item.status]
  return (
    <div className={`border rounded-xl p-3.5 transition hover:shadow-cortex ${item.star ? 'bg-gradient-to-br from-cortex-cyan-bg/30 to-white border-cortex-cyan' : 'bg-white border-cortex-line'}`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${item.star ? 'bg-cortex-cyan text-cortex-navy' : 'bg-cortex-line-2 text-cortex-text'}`}>
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-[10px] font-bold text-cortex-muted">#{item.num}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>{s.ico} {s.label}</span>
            {item.star && <span className="text-[9px] bg-cortex-amber-bg text-amber-800 px-1.5 py-0.5 rounded font-bold">⭐ 核心</span>}
          </div>
          <div className="text-[14px] font-bold text-cortex-ink mb-1">{item.title}</div>
          <div className="text-[10px] text-cortex-teal font-semibold mb-2">{item.stage}</div>
          <div className="text-[11px] text-cortex-text leading-relaxed mb-1.5">{item.benefit}</div>
          <div className="text-[10px] text-cortex-muted italic">
            <Eye size={9} className="inline -mt-px mr-0.5" /> {item.integration}
          </div>
        </div>
      </div>
    </div>
  )
}

function PhaseCard({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div className={`border rounded-lg p-3 ${color}`}>
      <div className="text-[12px] font-bold mb-2">{title}</div>
      <ul className="space-y-1 text-cortex-text">
        {items.map((i) => <li key={i}>• {i}</li>)}
      </ul>
    </div>
  )
}
