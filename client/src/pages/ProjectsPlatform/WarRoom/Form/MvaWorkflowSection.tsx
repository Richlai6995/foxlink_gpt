/**
 * MvaWorkflowSection — 🛠️ MVA 操作流程(v0.16 plan #10 · 教學段)
 *
 * 對齊 v0.16 MVA_PHASES(A–G),內容平台化改寫(範本庫/Wizard/匯入/compute/定版 = 我們的功能)。
 * 每 Phase:① 需準備素材(prereq)② 操作步驟 ③ 影響的 DB 表。靜態教學,無完成度。
 */

import { useState } from 'react'
import { Wrench, FileSpreadsheet, Database, ListChecks } from 'lucide-react'

type Prereq = { kind: 'doc' | 'data' | 'config' | 'permission'; name: string; detail: string }
type Step = { num: string; name: string; who: string; detail: string }
type Phase = {
  code: string; title: string; timing: string; owner: string; summary: string
  prereq: Prereq[]; steps: Step[]; tables: string[]
}

const PHASES: Phase[] = [
  {
    code: 'A', title: '公司 / 廠級一次性建置', timing: '導入時一次', owner: 'EPM / admin',
    summary: '建立各廠成本模型「廠別標準」範本庫(CORTEX-COST-TPL),之後所有新案從這裡 clone。',
    prereq: [
      { kind: 'doc', name: '廠別標準成本 Excel', detail: 'cost-model-standard-{FULL_MVA|SIMPLIFIED}.xlsx(「📦 BOM/材料 → 成本模型 → 空白範本」含三層填寫指南)' },
      { kind: 'data', name: '廠別 DL 月薪 / 匯率', detail: '月薪→時薪自動換算(週工作天×52/12×日工時)' },
      { kind: 'data', name: '製程 / 設備 / IDL / 廠房參數', detail: 'FULL 8 分頁;SIMPLIFIED 3 分頁' },
      { kind: 'permission', name: 'admin / HOST 視角', detail: '範本庫維護限完整成本視角' },
    ],
    steps: [
      { num: 'A1', name: '下載空白範本', who: 'EPM', detail: 'BOM/材料 → 成本模型工具 → 空白範本(選 FULL/SIMPLIFIED)' },
      { num: 'A2', name: '填廠別標準參數', who: 'EPM', detail: '照「說明/填寫指南/欄位對照」三分頁填(#EXAMPLE 列免刪,匯入自動跳過)' },
      { num: 'A3', name: '存入範本庫', who: 'EPM', detail: '成本模型工具 →「存入範本庫」+ 命名(如 CN-2026Q3);同名再匯入 = 新版本,舊版自動停用' },
      { num: 'A4', name: '驗證 round-trip', who: 'EPM', detail: '「匯出當前廠」對照原檔,六位小數等值' },
    ],
    tables: ['bom_factory_baseline', 'bom_cs_case_factory(範本專案 CORTEX-COST-TPL)', 'bom_cs_case_process / _idl / _equipment / _facility / _consumable'],
  },
  {
    code: 'B', title: '月度 / 季度 Baseline 維護', timing: '每月或每季', owner: 'EPM',
    summary: '薪資調整、匯率、稼動率變動 → 重匯同名範本 = 產生新版本;歷史版保留可回溯。',
    prereq: [
      { kind: 'doc', name: '更新後的廠別標準 Excel', detail: '沿用 A 的檔改參數' },
      { kind: 'config', name: '版本命名規則', detail: '同 label 再匯入 = supersede(is_active 切換);?includeInactive=1 查歷史' },
    ],
    steps: [
      { num: 'B1', name: '匯出當前版', who: 'EPM', detail: '從範本庫匯出 → 改參數' },
      { num: 'B2', name: '同名匯入', who: 'EPM', detail: '「存入範本庫」同 label → 新版生效、舊版停用' },
      { num: 'B3', name: '既有案不受影響', who: '系統', detail: '案級是開案時 clone 的快照;要吃新版 → 該案「＋廠別」重 provision' },
    ],
    tables: ['bom_factory_baseline(is_active / effective_from)'],
  },
  {
    code: 'C', title: '新案開立', timing: '每案一次', owner: '業務 / DPM',
    summary: '開案 Wizard 一路帶好:廠別×成本模型(範本庫 chips)、變異軸、NRE 模式 → 出來直接可匯 BOM。',
    prereq: [
      { kind: 'data', name: '客戶 RFQ 基本資料', detail: '客戶/料號/年量/交期(Wizard Step1)' },
      { kind: 'config', name: '範本庫已有目標廠', detail: 'Phase A 建好的廠別×模型' },
    ],
    steps: [
      { num: 'C1', name: 'Wizard 走 7 步', who: '業務', detail: '專案列表 →「＋新增專案」;Step5 勾廠別模型 / 填變異軸(顏色=Black,White)/ NRE 模式' },
      { num: 'C2', name: '啟動專案', who: '業務', detail: '自動:建案 + provision 廠別 + 建維度 + NRE config + Stage1 ACTIVE' },
    ],
    tables: ['projects', 'bom_cs_case_factory(clone)', 'bom_variant_dimension / _value', 'bom_nre_config', 'project_stages'],
  },
  {
    code: 'D', title: '案級配置', timing: '報價前', owner: 'RD + 採購 + EPM',
    summary: 'BOM 匯入(統一格式)、逐料詢價、NRE 填列/議價、qty scenario、案級成本模型調參。',
    prereq: [
      { kind: 'doc', name: 'BOM Excel(統一格式)', detail: '半成品/分類/Item/FLK/適用欄 + 變異軸分頁' },
      { kind: 'data', name: '採購詢價(vendor+單價)', detail: 'per-FLK 多 vendor 多 tier' },
      { kind: 'doc', name: '案級成本模型 Excel(選配)', detail: '跟廠別標準不同時才需要(匯入 → 蓋案級)' },
    ],
    steps: [
      { num: 'D1', name: '匯入 BOM', who: 'RD', detail: '🎬 操作流程 Stage 4(附自動判定)' },
      { num: 'D2', name: '詢價 enrich', who: '採購', detail: '料件明細 → FLK → 供應商/報價;完成 = 無 PENDING' },
      { num: 'D3', name: 'NRE + 議價', who: 'EPM', detail: 'NRE 段填列 → 議價後欄(effective 進定版)' },
      { num: 'D4', name: 'Qty scenario', who: 'EPM', detail: 'BASE/LOW/HIGH(矩陣 qty 軸)' },
    ],
    tables: ['bom_instance/_section/_category/_item/_flk/_mfg/_price_snapshot/_tier', 'bom_item_effectivity', 'bom_nre_item', 'bom_cs_case_qty_scenario'],
  },
  {
    code: 'E', title: '計算(Compute)', timing: '參數變更後隨時', owner: 'EPM',
    summary: '④ 算成本(單廠×配置×量)或矩陣「算全部」;結果落 run(快取 keyed by 廠+配置+量)。',
    prereq: [
      { kind: 'data', name: '詢價完成(或允許 PENDING 部分計)', detail: 'PENDING 料不計入材料' },
      { kind: 'config', name: '產品配置選定', detail: '顏色×包裝(BOM 區「產品配置」)' },
    ],
    steps: [
      { num: 'E1', name: '單格試算', who: 'EPM', detail: 'BOM 區 ④ 算成本 → ⑤ 成本結果(材料/MVA/SGA/Profit/NRE/Total)' },
      { num: 'E2', name: '矩陣全算', who: 'EPM', detail: '多廠矩陣 → 算全部(每配置×廠×量各一價)· 分解 checkbox 看拆解' },
      { num: 'E3', name: 'Cleansheet 檢視', who: 'EPM', detail: '🧮 section:component×製程矩陣 + 公式 hover' },
    ],
    tables: ['bom_cs_run(qty_scenario_code / variant_value_ids)', 'bom_cs_run_result', 'bom_cs_run_cell'],
  },
  {
    code: 'F', title: 'BOM Lock / 定版', timing: '對客報價前', owner: 'DPM → 核准者',
    summary: '選廠送審 = 鎖定;SoD(送審者≠核准者);核准 = 官方版,矩陣/報價以此為準。',
    prereq: [
      { kind: 'data', name: '各廠 run 已算', detail: '成本核算多廠彙總有值' },
      { kind: 'permission', name: '核准者 ≠ 送審者', detail: 'admin 可覆寫' },
    ],
    steps: [
      { num: 'F1', name: '送審', who: 'DPM', detail: '成本核算 → 報價定版/送審 → 選廠 → 送審' },
      { num: 'F2', name: '核准', who: '主管', detail: '版本表 → 核准 → 🏆 官方版(Stage 8 自動完成)' },
    ],
    tables: ['bom_quote_version(SUBMITTED→APPROVED)', 'project_stages(auto advance)'],
  },
  {
    code: 'G', title: '報價 + Margin 分析', timing: '定版後', owner: '業務 / 主管',
    summary: '報價單 PDF(中/EN)、議價輪次(vs 底線警示)、Margin heatmap、AI 比對上代。',
    prereq: [
      { kind: 'data', name: '官方版存在', detail: 'F 完成' },
      { kind: 'permission', name: 'margin 檢視 = HOST 視角', detail: 'PARTICIPANT 遮 true/margin' },
    ],
    steps: [
      { num: 'G1', name: '報價單輸出', who: '業務', detail: '官方報價 → 📄 PDF(中)/ EN;非正式版蓋 DRAFT 浮水印' },
      { num: 'G2', name: '議價', who: '業務', detail: '🤝 議價紀錄:輪次 + vs 底線(虧本紅字)+ 成交標記' },
      { num: 'G3', name: 'Margin 分析', who: '主管', detail: '📈 Margin section:heatmap + Top Markup 料件' },
      { num: 'G4', name: 'AI 比對上代', who: 'DPM', detail: '成本核算 → 選上代案 → 成本橋 + Pro 摘要' },
    ],
    tables: ['bom_negotiation_round', 'bom_quote_version', '(讀)bom_cs_run_result'],
  },
]

const KIND_STYLE: Record<string, string> = {
  doc: 'bg-blue-50 text-blue-700 border-blue-200',
  data: 'bg-teal-50 text-teal-700 border-teal-200',
  config: 'bg-amber-50 text-amber-700 border-amber-200',
  permission: 'bg-red-50 text-red-600 border-red-200',
}
const KIND_LABEL: Record<string, string> = { doc: '檔案', data: '資料', config: '設定', permission: '權限' }

export default function MvaWorkflowSection() {
  const [active, setActive] = useState('A')
  const ph = PHASES.find((p) => p.code === active)!
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2"><Wrench className="w-4 h-4" /> MVA 操作流程
        <span className="text-[10px] text-cortex-muted font-normal">成本模型從建置到報價的 7 個階段(平台操作版)</span>
      </h3>
      <div className="flex items-center gap-1 flex-wrap">
        {PHASES.map((p) => (
          <button key={p.code} onClick={() => setActive(p.code)}
            className={`px-2.5 py-1.5 rounded text-[11px] border ${active === p.code ? 'bg-cortex-navy text-white border-cortex-navy' : 'bg-white border-cortex-line text-cortex-muted hover:border-cortex-teal'}`}>
            <b>{p.code}</b> {p.title}
          </button>
        ))}
      </div>
      <div className="bg-cortex-bg/40 border border-cortex-line rounded-lg p-3">
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-[14px] font-bold text-cortex-ink">Phase {ph.code} · {ph.title}</span>
          <span className="text-[9px] bg-cortex-line px-1.5 py-0.5 rounded text-cortex-muted">{ph.timing}</span>
          <span className="text-[9px] bg-cortex-cyan-bg px-1.5 py-0.5 rounded text-cortex-teal">{ph.owner}</span>
        </div>
        <p className="text-[11px] text-cortex-muted mt-1">{ph.summary}</p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="border border-cortex-line rounded-lg p-3 space-y-1.5">
          <div className="text-[11px] font-bold text-cortex-ink flex items-center gap-1"><FileSpreadsheet className="w-3.5 h-3.5" /> ① 需準備的素材({ph.prereq.length})</div>
          {ph.prereq.map((q, i) => (
            <div key={i} className="text-[10px] flex gap-1.5">
              <span className={`shrink-0 border rounded px-1 ${KIND_STYLE[q.kind]}`}>{KIND_LABEL[q.kind]}</span>
              <span><b className="text-cortex-ink">{q.name}</b> — <span className="text-cortex-muted">{q.detail}</span></span>
            </div>
          ))}
        </div>
        <div className="border border-cortex-line rounded-lg p-3 space-y-1.5">
          <div className="text-[11px] font-bold text-cortex-ink flex items-center gap-1"><ListChecks className="w-3.5 h-3.5" /> ② 操作步驟({ph.steps.length})</div>
          {ph.steps.map((st) => (
            <div key={st.num} className="text-[10px] flex gap-1.5">
              <span className="shrink-0 font-mono text-cortex-teal font-bold">{st.num}</span>
              <span><b className="text-cortex-ink">{st.name}</b><span className="text-cortex-muted">({st.who})— {st.detail}</span></span>
            </div>
          ))}
        </div>
      </div>
      <div className="border border-cortex-line rounded-lg p-3">
        <div className="text-[11px] font-bold text-cortex-ink flex items-center gap-1 mb-1"><Database className="w-3.5 h-3.5" /> ③ 影響的資料表</div>
        <div className="flex gap-1.5 flex-wrap">
          {ph.tables.map((t, i) => <span key={i} className="text-[9px] font-mono bg-cortex-bg border border-cortex-line rounded px-1.5 py-0.5 text-cortex-muted">{t}</span>)}
        </div>
      </div>
      <div className="text-[10px] text-cortex-muted">完整說明:docs/Cortex_MVA操作流程說明手冊(v4 Excel 完整對齊版 PPTX)· 本段為平台內快速指引</div>
    </div>
  )
}
