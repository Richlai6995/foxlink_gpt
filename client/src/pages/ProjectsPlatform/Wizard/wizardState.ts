/**
 * Wizard 7-step state model
 *
 * 對應 docs/Cortex_互動Demo.html renderWizardStep1-7 + Demo 手冊 §7
 *
 * Step 1 客戶來信       — 拖 RFQ PDF + AI 解析(整合 AI #1)
 * Step 2 歷史參考       — AI 推薦 5 相似案 + PM(整合 #2 / #32 / #37)
 * Step 3 機密設定       — AI 預判機密欄位
 * Step 4 PM/Team       — 4 PM 指派
 * Step 5 流程模板       — QUOTE_STANDARD 8 stages + dependency
 * Step 6 重要 × 緊急    — priority_score 矩陣
 * Step 7 確認啟動       — 一頁預覽 + 自動 5 件事
 */

export type WizardData = {
  // Step 1
  rfqFileName: string
  rfqFilePath?: string         // server 端暫存路徑(extract-rfq 回來的)
  rfqMimeType?: string
  customer: string
  custAlias: string
  kickoffNote: string
  taxId: string
  paymentTerms: string
  shipAddress: string
  contactName: string
  partNo: string
  quantity: string
  dueDate: string
  specs?: string               // AI #1 抽出的規格摘要
  notes?: string               // AI #1 抽出的備註
  rfqConfidence?: {            // 每欄位 + 整體 confidence(0-100)
    customer?: number
    part_no?: number
    quantity?: number
    due_date?: number
    specs?: number
    notes?: number
    overall?: number
  }
  rfqMissing?: string[]        // AI 未找到的欄位 key 列表
  rfqWarnings?: string[]       // AI 警示(電壓不清、RoHS 未提等)
  rfqIsStub?: boolean          // true = LLM 不可用 fallback stub mock

  // Step 2
  selectedHistoryId: string | null
  recommendedPmName: string
  recommendedPmUserId: number | null
  workflowTemplateCode: string  // 真範本 code(Step4 載入時回填,啟動 create 同源)
  custAvgCycleDays: number | null  // 此客戶歷史平均 開案→送審 天數(Step1 選老客戶帶入;真資料)
  custProjectCount: number | null  // 此客戶過往案數(Step5 重要度加權用)
  scheduleSanity: 'green' | 'amber' | 'red'

  // Step 3
  isConfidential: boolean
  confidentialFields: Record<string, { enabled: boolean; strategy: 'TIER' | 'ALIAS' | 'MASK' | 'RANGE' | 'NONE' }>

  // Step 4(name = 顯示;UserId = users.id,null = 未連結系統帳號)
  salesName: string
  salesUserId: number | null
  salesAssistantName: string
  salesAssistantUserId: number | null
  dpmName: string
  dpmUserId: number | null
  bpmName: string
  bpmUserId: number | null
  mpmName: string
  mpmUserId: number | null
  epmName: string
  epmUserId: number | null

  // Step 5 — 模板就是 step 2 選的 workflowTemplateCode

  // 優先序(路線一:獨立步已砍 — 系統建議自動採用,確認頁可微調)
  priorityScore: number  // 1-6 by matrix
  priorityTouched: boolean  // user 在確認頁手動調過 → 不再被系統建議覆蓋

  // Step 7 — 系統 generate
  generatedProjectCode: string
}

export const INITIAL_WIZARD: WizardData = {
  // Step 1
  rfqFileName: 'Apple_USB-C_RFQ.pdf',
  customer: '',
  custAlias: '',
  kickoffNote: '',
  taxId: '',
  paymentTerms: '',
  shipAddress: '',
  contactName: '',
  partNo: '',
  quantity: '100,000',
  dueDate: '2026-08-15',

  // Step 2(歷史參考步已廢;推薦 PM 改真資料 = Step1 選老客戶時帶入)
  selectedHistoryId: null,
  recommendedPmName: '',
  recommendedPmUserId: null,
  workflowTemplateCode: 'QUOTE_DEFAULT',
  custAvgCycleDays: null,
  custProjectCount: null,
  scheduleSanity: 'green',

  // Step 3
  isConfidential: true,
  confidentialFields: {
    amount:           { enabled: true,  strategy: 'TIER' },
    margin:           { enabled: true,  strategy: 'TIER' },
    cost_breakdown:   { enabled: true,  strategy: 'TIER' },
    customer_name:    { enabled: false, strategy: 'ALIAS' },
    quantity:         { enabled: false, strategy: 'RANGE' },
    due_date:         { enabled: false, strategy: 'NONE' },
  },

  // Step 4(真使用者 — WizardModal 開啟時帶入當前 user;其餘用 UserPicker 選)
  salesName: '',          // 自動帶 = 當前 user
  salesUserId: null,
  salesAssistantName: '',
  salesAssistantUserId: null,
  dpmName: '',
  dpmUserId: null,
  bpmName: '',
  bpmUserId: null,
  mpmName: '',
  mpmUserId: null,
  epmName: '',
  epmUserId: null,

  // 優先序(自動 = 系統建議;手動調過才固定)
  priorityScore: 6,
  priorityTouched: false,

  // Step 7
  generatedProjectCode: '',
}

/** Generate Q-YYYY-NNNN with current date + 4-digit random */
export function generateProjectCode(prefix: string = 'Q'): string {
  const y = new Date().getFullYear()
  const n = String(Math.floor(Math.random() * 9000) + 1000)
  return `${prefix}-${y}-${n}`
}
