#!/usr/bin/env node
/**
 * seed-demo-data.js — Phase 1-3 完整 demo 資料 seeder
 *
 * 涵蓋:
 *   - 15+ 測試帳號(13 role 各一 + 一般 user / chat_guest)· 密碼統一 '123456'
 *   - 3 BU organization_units
 *   - 對應 user_role_grants(BU director / super 等)
 *   - 8 個 demo projects(ODM × 3 / OEM × 2 / JDM × 1 / IT × 1 / DRAFT × 1)
 *     · 涵蓋 lifecycle:DRAFT / ACTIVE / PAUSED / CLOSED(WIN+LOSS)
 *     · 涵蓋機密度 / priority / multi-PM
 *   - 聊天訊息(BLOCKER / DECISION 自動 Pin / 普通 / AI_INSIGHT)
 *   - tasks(部分 DONE → 寫 KB chunk)
 *   - 沉澱 KB cases(CLOSED 案 fork 過 · 給 win-rate / pricing-suggest 用)
 *   - comm rooms(1 global group / 1 BU group / 1 DM)
 *   - approval chain(1 pending lifecycle_close)
 *
 * 用法:
 *   node server/projects-platform/scripts/seed-demo-data.js
 *
 * 設計:全 idempotent · 重複跑不會炸不會重複建
 *   · users:UPPER(username) 唯一 → skip
 *   · org_units:code 唯一 → skip
 *   · projects:project_code 唯一 → skip
 *   · 其他子表:跟著 parent skip
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { init } = require('../../database-oracle');

// ─────────────────────────────────────────────────────────────────────
// 帳號清單(15 個 · 密碼統一 '123456')
// ─────────────────────────────────────────────────────────────────────
const DEMO_USERS = [
  // Admin
  { username: 'demo_admin',   name: 'Demo Admin',  email: 'demo_admin@foxlink.com',  cortexRole: 'admin', grants: [{ role: 'admin' }] },

  // BU directors
  { username: 'amy_bu1_dir',  name: 'Amy 王 (BU1 主管)',    email: 'amy@foxlink.com',    grants: [{ role: 'project.bu_director', scope: 'BU', values: [1] }] },
  { username: 'ben_bu2_dir',  name: 'Ben 李 (BU2 主管)',    email: 'ben@foxlink.com',    grants: [{ role: 'project.bu_director', scope: 'BU', values: [2] }] },
  { username: 'tina_top',     name: 'Tina 陳 (總經理)',     email: 'tina@foxlink.com',   grants: [{ role: 'project.top_director' }] },

  // Super users(BU 經管 / HQ 經管)
  { username: 'simon_hq',     name: 'Simon 周 (HQ 經管)',   email: 'simon@foxlink.com',  grants: [{ role: 'project.hq_super' }] },
  { username: 'paul_bu1_sup', name: 'Paul 林 (BU1 經管)',   email: 'paul@foxlink.com',   grants: [{ role: 'project.bu_super', scope: 'BU', values: [1] }] },

  // Sales(業務)
  { username: 'sales_mike',   name: 'Mike 黃 (BU1 業務)',   email: 'mike@foxlink.com',   grants: [{ role: 'project.sales' }] },
  { username: 'sales_lisa',   name: 'Lisa 蔡 (BU2 業務)',   email: 'lisa@foxlink.com',   grants: [{ role: 'project.sales' }] },

  // PMs
  { username: 'pm_dora_dpm',  name: 'Dora (DPM)',           email: 'dora@foxlink.com',   grants: [{ role: 'project.pm' }] },
  { username: 'pm_bob_bpm',   name: 'Bob (BPM)',            email: 'bob@foxlink.com',    grants: [{ role: 'project.pm' }] },
  { username: 'pm_mary_mpm',  name: 'Mary (MPM)',           email: 'mary@foxlink.com',   grants: [{ role: 'project.pm' }] },
  { username: 'pm_eric_epm',  name: 'Eric (EPM)',           email: 'eric@foxlink.com',   grants: [{ role: 'project.pm' }] },

  // 系統身份
  { username: 'workflow_jay', name: 'Jay (Workflow Admin)', email: 'jay@foxlink.com',    grants: [{ role: 'workflow.admin' }] },
  { username: 'data_alex',    name: 'Alex (Data Connection Manager)', email: 'alex@foxlink.com', grants: [{ role: 'data.connection_manager' }] },
  { username: 'notif_kate',   name: 'Kate (Notification Editor)',     email: 'kate@foxlink.com', grants: [{ role: 'notification.editor' }] },
  { username: 'conf_steve',   name: 'Steve (Confidential Policy)',    email: 'steve@foxlink.com', grants: [{ role: 'confidential.policy_editor' }] },

  // 一般 user(無 role grant · 透過 member 加入專案)
  { username: 'user_jenny',   name: 'Jenny (一般)',         email: 'jenny@foxlink.com',  grants: [] },
  { username: 'user_kevin',   name: 'Kevin (一般)',         email: 'kevin@foxlink.com',  grants: [] },

  // Chat guest
  { username: 'guest_helen',  name: 'Helen (跨組訪客)',     email: 'helen@foxlink.com',  grants: [] },

  // ── SteelSeries Rival 3+ Wired Mouse 案專屬團隊(15 人 · v0.5 demo)──
  { username: 'ss_amy',       name: 'Amy 王曉明 (業務主)',    email: 'amy.ss@foxlink.com',     grants: [{ role: 'project.sales' }] },
  { username: 'ss_joy',       name: 'Joy 業務助理',          email: 'joy.ss@foxlink.com',     grants: [] },
  { username: 'ss_mike',      name: 'Mike Chen (DPM)',     email: 'mike.ss@foxlink.com',    grants: [{ role: 'project.pm' }] },
  { username: 'ss_alvin',     name: 'Alvin (ME · 黑/白 BOM)', email: 'alvin.ss@foxlink.com', grants: [] },
  { username: 'ss_troy',      name: 'Troy (EE)',           email: 'troy.ss@foxlink.com',    grants: [] },
  { username: 'ss_keny',      name: 'Keny Chen (RD HW Mgr)', email: 'keny.ss@foxlink.com',  grants: [] },
  { username: 'ss_tony',      name: 'Tony 何宗翰 (MPM)',     email: 'tony.ss@foxlink.com',   grants: [{ role: 'project.pm' }] },
  { username: 'ss_andy',      name: 'Andy (CN 廠 EPM)',     email: 'andy.ss@foxlink.com',    grants: [] },
  { username: 'ss_long',      name: 'Long (VN 廠 EPM)',     email: 'long.ss@foxlink.com',    grants: [] },
  { username: 'ss_ken_tw',    name: 'Ken (TW 廠 EPM)',      email: 'ken.tw.ss@foxlink.com',  grants: [] },
  { username: 'ss_lisa',      name: 'Lisa (BPM)',          email: 'lisa.ss@foxlink.com',    grants: [{ role: 'project.pm' }] },
  { username: 'ss_iris',      name: 'Iris (台北採購)',       email: 'iris.ss@foxlink.com',   grants: [] },
  { username: 'ss_ken_fac',   name: 'Ken (工廠採購)',        email: 'ken.fac.ss@foxlink.com', grants: [] },
  { username: 'ss_john',      name: 'John (QA · 認證)',     email: 'john.ss@foxlink.com',    grants: [] },
];

// ─────────────────────────────────────────────────────────────────────
// Organization units(3 BU · scope 設計用)
// ─────────────────────────────────────────────────────────────────────
const DEMO_ORGS = [
  { code: 'BG_CONSUMER',  level: 'BG', parent_code: null,           name: '消費性電子 BG' },
  { code: 'BU_CONNECTOR', level: 'BU', parent_code: 'BG_CONSUMER',  name: 'BU1 連接器' },
  { code: 'BU_CABLE',     level: 'BU', parent_code: 'BG_CONSUMER',  name: 'BU2 線材' },
  { code: 'BG_AUTO',      level: 'BG', parent_code: null,           name: '車用 BG' },
  { code: 'BU_EV',        level: 'BU', parent_code: 'BG_AUTO',      name: 'BU3 EV 連接器' },
];

// ─────────────────────────────────────────────────────────────────────
// 報價 / IT 專案 templates(ODM / OEM / JDM / IT)
// ─────────────────────────────────────────────────────────────────────
const DEMO_PROJECTS = [
  // ODM × 3
  {
    project_code: 'Q-2026-DEMO-001',
    type_code: 'QUOTE',
    title: 'Apple AirPods Pro 3 USB-C 充電盒(ODM)',
    bu_id: 1,
    lifecycle_status: 'ACTIVE',
    is_confidential: 1,
    importance: 'HIGH',
    urgency: 'HIGH',
    priority_score: 6,
    pm_username: 'pm_dora_dpm',
    sales_username: 'sales_mike',
    members: ['pm_bob_bpm', 'pm_mary_mpm', 'user_jenny'],
    data_payload: {
      title: 'Apple AirPods Pro 3 USB-C 充電盒(ODM)',
      customer: 'Apple Inc.',
      partNo: 'APL-APP3-CASE',
      quantity: '500,000',
      dueDate: '2026-09-30',
      mode: 'ODM',
      specs: '充電盒 + 主動降噪 IC + 無線充電線圈 + Lightning to USB-C 轉接 · MFi 認證 · 18 個月保固',
      notes: 'Apple 全包設計 + 我方主導生產 · 高機密 · 跨 BU 協作(BU1 連接器 + BU2 線材)',
      estimatedCycleDays: 90,
      // 機密欄位(會被 mask)
      amount: 'Tier-S',
      margin: 'MASKED%',
      cost_breakdown: 'MASKED',
    },
    confidential_fields: ['amount', 'margin', 'cost_breakdown'],
    chat_messages: [
      { user: 'sales_mike',  type: 'NORMAL',   content: 'Apple 來信要求 3 個月內報價 · 客戶要 500k 量 · 規格已附 PDF' },
      { user: 'pm_dora_dpm', type: 'NORMAL',   content: '已 review 規格 · 結構複雜度高,需要結構 + 電氣 + 軟體三方 PM 介入' },
      { user: 'pm_bob_bpm',  type: 'BLOCKER',  content: '🚨 USB-C 端 EMI 問題 · 我方目前模具良率 < 80% · 需要 NPI 重評' },
      { user: 'sales_mike',  type: 'DECISION', content: '決定採方案 B:廠區優先越南 + 鎖 6 月匯率 · 已跟客戶口頭達成共識' },
      { user: 'pm_dora_dpm', type: 'PROGRESS', content: '結構分析 80% 完成 · 預計 4/30 出第一版報價單' },
    ],
    tasks: [
      { title: '客戶來信 RFQ 解析',       status: 'DONE', accountable_role: 'PM',      assignee: 'pm_dora_dpm' },
      { title: '結構分析 + FEM 仿真',      status: 'IN_PROGRESS', accountable_role: 'engineering', assignee: 'pm_bob_bpm' },
      { title: 'BOM 展開 + 三廠對比',      status: 'PENDING', accountable_role: 'sourcing', assignee: 'pm_mary_mpm' },
      { title: 'EMI 重新評估',           status: 'BLOCKED', accountable_role: 'engineering', assignee: 'pm_bob_bpm' },
    ],
  },
  {
    project_code: 'Q-2026-DEMO-002',
    type_code: 'QUOTE',
    title: 'Samsung Galaxy Buds 3 線控耳機(ODM)',
    bu_id: 1,
    lifecycle_status: 'ACTIVE',
    is_confidential: 1,
    importance: 'NORMAL',
    urgency: 'HIGH',
    priority_score: 5,
    pm_username: 'pm_eric_epm',
    sales_username: 'sales_mike',
    members: ['pm_bob_bpm'],
    data_payload: {
      title: 'Samsung Galaxy Buds 3 線控耳機(ODM)',
      customer: 'Samsung Electronics',
      partNo: 'SAM-BUDS3-WIRE',
      quantity: '200,000',
      dueDate: '2026-07-15',
      mode: 'ODM',
      specs: '線控 + 麥克風 · 1.2 米線長 · USB-C 接頭 · IP54',
      notes: 'Samsung 給軟需求,我方完整設計 · 中機密',
      estimatedCycleDays: 60,
      amount: 'Tier-M',
      margin: '18%',
    },
    confidential_fields: ['amount', 'margin'],
    chat_messages: [
      { user: 'sales_mike',  type: 'NORMAL',   content: 'Samsung RFQ 來了 · 規格相對寬鬆,可以快速報' },
      { user: 'pm_eric_epm', type: 'PROGRESS', content: '已套用既有耳機平台 · 預計 5 天出報價' },
    ],
    tasks: [
      { title: '套用既有線控耳機平台',  status: 'DONE', accountable_role: 'PM', assignee: 'pm_eric_epm' },
      { title: '材料報價更新',         status: 'IN_PROGRESS', accountable_role: 'sourcing', assignee: 'pm_mary_mpm' },
    ],
  },
  {
    project_code: 'Q-2026-DEMO-003',
    type_code: 'QUOTE',
    title: 'Garmin Forerunner 充電線(ODM)',
    bu_id: 2,
    lifecycle_status: 'PAUSED',
    is_confidential: 0,
    importance: 'NORMAL',
    urgency: 'NORMAL',
    priority_score: 3,
    pm_username: 'pm_bob_bpm',
    sales_username: 'sales_lisa',
    members: [],
    data_payload: {
      title: 'Garmin Forerunner 充電線(ODM)',
      customer: 'Garmin',
      partNo: 'GMN-FR-CHG',
      quantity: '50,000',
      dueDate: '2026-08-01',
      mode: 'ODM',
      specs: '磁吸 + 5 pin · 1 米線長',
      notes: '客戶 hold 中(等市場反饋)· 非機密',
      estimatedCycleDays: 45,
      amount: 12000,
      margin: '22%',
      pause_reason: '客戶要求暫停 · 等 Q3 市場反饋',
    },
    chat_messages: [
      { user: 'sales_lisa', type: 'SYSTEM', content: 'Lifecycle: ACTIVE → PAUSED(客戶 hold)' },
    ],
    tasks: [],
  },

  // OEM × 2
  {
    project_code: 'Q-2026-DEMO-004',
    type_code: 'QUOTE',
    title: 'Sony 醫療影像連接器(OEM)',
    bu_id: 2,
    lifecycle_status: 'ACTIVE',
    is_confidential: 1,
    importance: 'HIGH',
    urgency: 'NORMAL',
    priority_score: 5,
    pm_username: 'pm_mary_mpm',
    sales_username: 'sales_lisa',
    members: ['user_kevin'],
    data_payload: {
      title: 'Sony 醫療影像連接器(OEM)',
      customer: 'Sony Medical',
      partNo: 'SNY-MED-IMG-V3',
      quantity: '5,000',
      dueDate: '2026-10-15',
      mode: 'OEM',
      specs: 'CT 設備連接器 · 客戶完整設計圖 + BOM · ISO 13485 / IEC 60601-1 · 高耐電壓',
      notes: '客戶 100% 設計,我方代工 · 數量低毛利合理 · 醫療級認證要求嚴',
      estimatedCycleDays: 75,
      amount: 'Tier-A',
      margin: 'MASKED%',
    },
    confidential_fields: ['amount', 'margin'],
    chat_messages: [
      { user: 'sales_lisa',   type: 'NORMAL',   content: 'Sony Medical 詢價 · 客戶提供完整圖紙' },
      { user: 'pm_mary_mpm',  type: 'PROGRESS', content: 'BOM 對齊中 · 認證費用約佔 cost 15%' },
      { user: 'pm_mary_mpm',  type: 'AI_INSIGHT', content: '🤖 AI #29 拆解:醫療代工建議拆 4 個 task(BOM 對齊 / 認證 / 試產 / 量產報價)· 已批次建立' },
    ],
    tasks: [
      { title: 'BOM 對齊(對客戶提供)',  status: 'DONE',        accountable_role: 'sourcing', assignee: 'pm_mary_mpm' },
      { title: 'ISO 13485 認證費用估',   status: 'IN_PROGRESS', accountable_role: 'quality',  assignee: 'pm_mary_mpm' },
      { title: '試產樣品成本',           status: 'PENDING',     accountable_role: 'manufacturing', assignee: 'pm_eric_epm' },
      { title: '量產報價單',             status: 'PENDING',     accountable_role: 'PM',       assignee: 'pm_mary_mpm' },
    ],
  },
  {
    project_code: 'Q-2026-DEMO-005',
    type_code: 'QUOTE',
    title: 'Tesla Model Y 高壓連接器(OEM)',
    bu_id: 3,
    lifecycle_status: 'ACTIVE',
    is_confidential: 1,
    importance: 'HIGH',
    urgency: 'HIGH',
    priority_score: 6,
    pm_username: 'pm_eric_epm',
    sales_username: 'sales_mike',
    members: ['pm_bob_bpm', 'pm_mary_mpm', 'user_jenny', 'user_kevin'],
    data_payload: {
      title: 'Tesla Model Y 高壓連接器(OEM)',
      customer: 'Tesla',
      partNo: 'TSL-MY-HVPLUG',
      quantity: '1,200,000',
      dueDate: '2026-12-31',
      mode: 'OEM',
      specs: '800V 高壓系統連接器 · 客戶完整設計 · UL62275 / IEC 62275 認證 · 防水 IP67',
      notes: 'Tesla 量大但壓力大 · 同時 Tier-S 報價 · 月底前必須鎖價',
      estimatedCycleDays: 120,
      amount: 'Tier-S',
      margin: 'MASKED%',
    },
    confidential_fields: ['amount', 'margin', 'cost_breakdown'],
    chat_messages: [
      { user: 'sales_mike',   type: 'BLOCKER', content: '🚨 客戶要求 -8% 價格 · 不接受報原價 · 需要重評' },
      { user: 'pm_eric_epm',  type: 'DECISION', content: '決定:走 Tier-S 議價策略 + 越南廠優先 · 已通知 sourcing' },
      { user: 'pm_mary_mpm',  type: 'PROGRESS', content: '越南廠成本 -5% vs 中國 · 已確認交期可控' },
    ],
    tasks: [
      { title: '高壓認證評估',         status: 'IN_PROGRESS', accountable_role: 'quality',    assignee: 'pm_bob_bpm' },
      { title: '越南廠 cost 確認',     status: 'DONE',        accountable_role: 'sourcing',   assignee: 'pm_mary_mpm' },
      { title: 'Tesla 議價回應草稿',   status: 'PENDING',     accountable_role: 'PM',         assignee: 'pm_eric_epm' },
    ],
  },

  // JDM × 1
  {
    project_code: 'Q-2026-DEMO-006',
    type_code: 'QUOTE',
    title: 'BYD 新能源充電樁線材(JDM)',
    bu_id: 3,
    lifecycle_status: 'ACTIVE',
    is_confidential: 0,
    importance: 'HIGH',
    urgency: 'NORMAL',
    priority_score: 4,
    pm_username: 'pm_dora_dpm',
    sales_username: 'sales_lisa',
    members: ['pm_eric_epm'],
    data_payload: {
      title: 'BYD 新能源充電樁線材(JDM)',
      customer: 'BYD',
      partNo: 'BYD-EV-CHG-CABLE',
      quantity: '300,000',
      dueDate: '2026-11-30',
      mode: 'JDM',
      specs: '350A 直流快充線材 · 雙方共同設計 · 我方提供結構,BYD 提供電氣規格',
      notes: 'JDM 模式 · 雙方各負擔 50% NRE 費用 · IP 共享(我方結構 + 客戶電氣)',
      estimatedCycleDays: 90,
      amount: 28500,
      margin: '15%',
    },
    chat_messages: [
      { user: 'sales_lisa',  type: 'NORMAL', content: 'BYD JDM 案啟動 · 已簽 MOU' },
      { user: 'pm_dora_dpm', type: 'PROGRESS', content: '結構設計初稿完成 · 等 BYD 電氣規格回覆' },
    ],
    tasks: [
      { title: '結構設計初稿',      status: 'DONE',        accountable_role: 'engineering', assignee: 'pm_dora_dpm' },
      { title: 'BYD 電氣規格 align', status: 'IN_PROGRESS', accountable_role: 'PM',          assignee: 'pm_dora_dpm' },
      { title: 'NRE 攤分試算',      status: 'PENDING',     accountable_role: 'sourcing',    assignee: 'pm_mary_mpm' },
    ],
  },

  // IT 案(GENERAL plugin)
  {
    project_code: 'IT-2026-DEMO-007',
    type_code: 'GENERAL',
    title: 'S/4HANA 升級 - MM module 對應',
    bu_id: 1,
    lifecycle_status: 'ACTIVE',
    is_confidential: 0,
    importance: 'NORMAL',
    urgency: 'NORMAL',
    priority_score: 3,
    pm_username: 'workflow_jay',
    sales_username: 'data_alex',
    members: ['user_kevin'],
    data_payload: {
      title: 'S/4HANA 升級 - MM module 對應',
      customer: '內部 IT',
      partNo: 'IT-S4-MM-2026',
      quantity: 'N/A',
      dueDate: '2026-12-15',
      mode: 'IT 維護',
      specs: 'SAP MM module 從 ECC 6.0 升級到 S/4HANA 2025 · 對應 BOM 變更影響',
      notes: '內部 IT 案 · 跨 BU 影響 · 走 GENERAL plugin',
    },
    chat_messages: [
      { user: 'data_alex',     type: 'NORMAL',   content: '升級 plan 已 review · 預計 Q4 上線' },
      { user: 'workflow_jay',  type: 'PROGRESS', content: '已完成 PoC 測試 · 進入正式排程' },
    ],
    tasks: [
      { title: 'PoC 測試',           status: 'DONE',        accountable_role: 'engineering', assignee: 'workflow_jay' },
      { title: '正式環境部署計畫',    status: 'IN_PROGRESS', accountable_role: 'PM',          assignee: 'workflow_jay' },
    ],
  },

  // ⭐ v0.5 旗艦案:SteelSeries Rival 3+ Wired Mouse(ODM · 多 SKU + 三廠 + 11 NRE + 16 PKG)
  {
    project_code: 'Q-2026-DEMO-009-SS',
    type_code: 'QUOTE',
    title: 'SteelSeries Rival 3+ Wired Mouse (ELM5 Gen2 · ODM)',
    bu_id: 1,
    lifecycle_status: 'ACTIVE',
    is_confidential: 1,
    importance: 'HIGH',
    urgency: 'HIGH',
    priority_score: 5,
    pm_username: 'ss_mike',
    sales_username: 'ss_amy',
    members: [
      'ss_joy', 'ss_alvin', 'ss_troy', 'ss_keny', 'ss_tony',
      'ss_andy', 'ss_long', 'ss_ken_tw', 'ss_lisa', 'ss_iris', 'ss_ken_fac', 'ss_john',
    ],
    data_payload: {
      title: 'SteelSeries Rival 3+ Wired Mouse (ELM5 Gen2 · ODM)',
      customer: 'SteelSeries ApS',
      customer_alias: 'S001',
      partNo: '5881-1047-0HA0',
      quantity: 418000,
      dueDate: '2026-08-30',
      mode: 'ODM',
      specs: 'Gaming wired mouse · USB-A · TrueMove Core sensor · PTFE feet · paracord cable · 黑/白雙色',
      notes: '對齊真實案校驗(2024 SteelSeries Rival 3 報價)· 共用 EE BOM、ME BOM 分黑/白、PKG 16 項共用、3 廠對比(CN/VN/TW)',
      estimatedCycleDays: 130,

      // 機密欄位
      amount: 'Tier-S',     // 4,956,000 USD/yr
      margin: 'Tier-L',     // 6.7%(gaming 周邊偏低)
      cost_breakdown: 'MASKED',

      // ─── v0.5 §11.3.5 Variant Dimension ─────────────────────────
      variants: {
        axis_key: 'cmf_color',
        axis_label: 'CMF 顏色',
        cardinality: 2,
        items: [
          { key: 'black', label: 'Black', share: 0.80, qty: 334400, material_cost: 8.52, me_bom: '5881-1047-0HA0(B)', note: 'PTFE Feet 雙色款 / Wheel Grip B1-3' },
          { key: 'white', label: 'White', share: 0.20, qty: 83600,  material_cost: 8.73, me_bom: '5881-1047-0CA0(W)', note: 'PTFE Feet White / Bottom Cover translucent' },
        ],
      },

      // ─── v0.5 §11.3.6 NRE Costs(11 項標準)──────────────────────
      nre: {
        total_original:   218911,
        total_negotiated: 37876,
        delta_pct:        82.7,
        amortize_per_unit: 0.0906,  // 37876 / 418000
        items_count: 11,
        items_done: 7,
        items: [
          { key: 'nre_build_cost',  label: 'Build Cost (試產費)',                 qty: 1,  original: 13600, updated: 13600, remark: '3/13 build qty 300→200 each color', responsible: 'SMT/NPI team', accountable: 'EPM',  status: 'done' },
          { key: 'nre_emc_test',    label: 'EMC Test + Cert',                    qty: 0,  original: 0,     updated: 0,     remark: 'SS 自付',                   responsible: 'QA team',      accountable: 'DPM',  status: 'done' },
          { key: 'nre_emc_debug',   label: 'EMC Debugging 預算 (30hrs×$125)',     qty: 30, original: 3750,  updated: 3750,  remark: '新認證 due · 客戶待回',   responsible: 'RD QA',        accountable: 'DPM',  status: 'pending', sla_color: 'amber' },
          { key: 'nre_compat',      label: 'Compatibility Test',                 qty: 0,  original: 0,     updated: 0,     remark: 'Foxlink internal',          responsible: 'QA team',      accountable: 'DPM',  status: 'done' },
          { key: 'nre_dve',         label: 'DVE NRE (Chromebook)',               qty: 1,  original: 165,   updated: 165,   remark: '認證 fee',                  responsible: 'RD',           accountable: 'DPM',  status: 'done' },
          { key: 'nre_travel',      label: 'Travel Expense',                     qty: 2,  original: 6000,  updated: 0,     remark: '3/13 議價削除',             responsible: 'DPM',          accountable: 'DPM',  status: 'done' },
          { key: 'nre_dev_npi',     label: 'Dev + NPI Labor Cost',               qty: 1,  original: 93299, updated: 10000, remark: '3/13 ↓$83K 長期 partnership', responsible: 'DPM team', accountable: 'DPM', status: 'done' },
          { key: 'nre_reliability', label: 'Reliability Test (EV+DV)',           qty: 1,  original: 9159,  updated: 1500,  remark: '3/13 ↓ if Opt2',            responsible: 'QA team',      accountable: 'DPM',  status: 'pending' },
          { key: 'nre_pkg_ret',     label: 'Package RET (Reliability)',          qty: 1,  original: 2223,  updated: 500,   remark: 'EV+DV 樣本',                 responsible: 'PKG team',     accountable: 'MPM',  status: 'pending' },
          { key: 'nre_ort',         label: 'ORT (Ongoing Reliability)',          qty: 1,  original: 7530,  updated: 361,   remark: '3/10 僅樣本費',              responsible: 'QA team',      accountable: 'DPM',  status: 'pending' },
          { key: 'nre_mte',         label: 'Unique Fixtures (MTE NPI)',          qty: 1,  original: 80185, updated: 5000,  remark: '3/10 僅 NPI · MP 廠自付',    responsible: 'NPI EPM',      accountable: 'DPM',  status: 'done' },
          { key: 'nre_tooling',     label: 'Tooling (模具改費)',                  qty: 1,  original: 3000,  updated: 3000,  remark: 'Middle housing + Trigger', responsible: '塑件 PM',      accountable: 'DPM',  status: 'done' },
        ],
      },

      // ─── v0.5 §11.3.7 Packaging Sub-form(16 項 Mouse 標準範本)─
      packaging: {
        template: 'Mouse / Keyboard standard',
        items_count: 16,
        pallet_compliance: 'EU EPAL',
        total_per_unit: 1.275,  // SUM(qty × unit_price)
        vendor_count: 4,
        items: [
          { no: 1,  part_name: 'Gift Box',                  spec: '278×250mm · 350g art paper coated',         qty: 1, unit_price: 0.32,  vendor: '富立印刷', lead_time_wk: 5,  note: 'Dieline 2024-02' },
          { no: 2,  part_name: 'Inner Pad',                 spec: '296×152mm · E-flute corrugated',           qty: 1, unit_price: 0.12,  vendor: '富立印刷', lead_time_wk: 5,  note: 'FSC certified' },
          { no: 3,  part_name: 'Inner Pad Partition',       spec: '171×84mm · E-flute corrugated',            qty: 1, unit_price: 0.05,  vendor: '富立印刷', lead_time_wk: 5,  note: 'FSC certified' },
          { no: 4,  part_name: 'Seal Sticker',              spec: 'Φ25mm · 透明植物纖維',                       qty: 2, unit_price: 0.02,  vendor: '冠美包裝', lead_time_wk: 3,  note: '2 pcs per box' },
          { no: 5,  part_name: 'Bag for Product',           spec: '套產品 · sustainable material',              qty: 1, unit_price: 0.04,  vendor: '冠美包裝', lead_time_wk: 4,  note: '2025 零塑' },
          { no: 6,  part_name: 'Bag for Box',               spec: '套盒 · sustainable material',                qty: 1, unit_price: 0.03,  vendor: '冠美包裝', lead_time_wk: 4,  note: '2025 零塑' },
          { no: 7,  part_name: 'PIG',                       spec: '320×200.8mm · 80gsm',                       qty: 1, unit_price: 0.08,  vendor: '富立印刷', lead_time_wk: 7,  note: '多語言印刷' },
          { no: 8,  part_name: 'PID Label for Product',     spec: '40×60mm · 80gsm art paper',                 qty: 1, unit_price: 0.015, vendor: '三泰標籤', lead_time_wk: 3,  note: 'with QR' },
          { no: 9,  part_name: 'Box Label',                 spec: '100×13mm · 80gsm art paper',                qty: 1, unit_price: 0.01,  vendor: '三泰標籤', lead_time_wk: 3,  note: 'SN + MFD date' },
          { no: 10, part_name: 'Language Label',            spec: '116×12mm · 80gsm art paper',                qty: 1, unit_price: 0.01,  vendor: '三泰標籤', lead_time_wk: 3,  note: 'keyboard layout 文字' },
          { no: 11, part_name: 'Master Carton',             spec: '5~6 retail box / carton',                   qty: 1, unit_price: 0.45,  vendor: '富立印刷', lead_time_wk: 7,  note: 'Double-wall BC flute' },
          { no: 12, part_name: 'Master Carton Label',       spec: '89×140mm · 80gsm art paper',                qty: 1, unit_price: 0.02,  vendor: '三泰標籤', lead_time_wk: 3,  note: '2 sides duplicated' },
          { no: 13, part_name: 'SN Label for Carton',       spec: '50×50mm · art paper',                       qty: 1, unit_price: 0.01,  vendor: '三泰標籤', lead_time_wk: 3,  note: '2D barcode' },
          { no: 14, part_name: 'SteelSeries Logo Tape',     spec: '封口 OPP tape · 客供印刷模板',                 qty: 1, unit_price: 0.03,  vendor: '冠美包裝', lead_time_wk: 7,  note: '客供 logo file' },
          { no: 15, part_name: 'Pallet Material',           spec: 'EU/US GMA/APAC 三規 · V20',                  qty: 1, unit_price: 0.08,  vendor: '環球棧板', lead_time_wk: 10, note: 'ISPM15 fumigation' },
          { no: 16, part_name: 'UN3481 Label',              spec: 'IATA · lithium battery shipping',           qty: 1, unit_price: 0.01,  vendor: '三泰標籤', lead_time_wk: 3,  note: '本案無電池保留欄' },
        ],
      },

      // ─── v0.5 §11.3.8 Multi-Factory Cost Matrix(3 廠 × 3 PKG)──
      factory_matrix: {
        axes: { factory: ['CN','VN','TW'], pkg_option: ['A','B','C'] },
        mandatory_factory: null,  // 客戶未指定
        recommended: { factory: 'CN', pkg_option: 'A' },  // Tony 4/15 默認
        cheapest: { factory: 'VN', pkg_option: 'B', value: 11.02 },
        spread: 1.58,             // max - min over 3×3 black
        cells: {
          // black variant · total_cost_exfactory ($/unit)
          black: {
            'CN-A': 11.12, 'CN-B': 11.11, 'CN-C': 12.59,
            'VN-A': 11.12, 'VN-B': 11.02, 'VN-C': 12.59,
            'TW-A': 11.12, 'TW-B': 11.02, 'TW-C': 12.60,
          },
          white: {
            'CN-A': 11.34, 'CN-B': 11.33, 'CN-C': 12.75,
            'VN-A': 11.34, 'VN-B': 11.24, 'VN-C': 12.82,
            'TW-A': 11.34, 'TW-B': 11.25, 'TW-C': 12.82,
          },
        },
        mva: { CN: 1.86, VN: 1.43, TW: 3.00 },   // transformation cost
        sga_profit: 0.75,
        suggested_quote: 11.87,                   // / unit
        annual_revenue: 4956000,                  // 418K × $11.87
      },

      // 報價結果(供 BI / dashboard 用)
      win_status: 'IN_NEGOTIATION',
    },
    confidential_fields: ['amount', 'margin', 'cost_breakdown', 'nre.items', 'factory_matrix.cells'],
    chat_messages: [
      { user: 'ss_amy',  type: 'NORMAL',     content: '各位,SteelSeries Rival 3 系列上一代有跑過,這次 Gen2 主要差異是 CMF 改新材質、PTFE 腳貼、paracord cable。客戶要求 CN/VN/TW 三廠對比,黑/白雙色 9 種組合。請各 PM 分頭起跑。' },
      { user: 'ss_mike', type: 'NORMAL',     content: 'DPM 收到。EE BOM 黑白共用 Troy 跑、ME BOM 黑/白分版 Alvin 跑。NRE 11 項分工已在 #engineering 開單。' },
      { user: 'ss_tony', type: 'NORMAL',     content: 'MPM 收到。三廠 Cleansheet 各廠 EPM 收 (Andy/Long/Ken),Packaging 16 項詢價已 sync Ken (工廠採購)。' },
      { user: 'ss_andy', type: 'PROGRESS',   content: 'CN Cleansheet 完成。MVA = $1.86 / unit。BB Assy 22 DL + SMT 38 DL,共 101 DL/day。' },
      { user: 'ss_long', type: 'PROGRESS',   content: 'VN Cleansheet 完成。MVA = $1.43 / unit (Labor 便宜但 indirect material 較貴)。' },
      { user: 'ss_ken_tw', type: 'PROGRESS', content: 'TW Cleansheet 完成。MVA = $3.00 / unit (Labor 高但自動化高,Yield 較好)。' },
      { user: 'ss_lisa', type: 'AI_INSIGHT', content: '🤖 SG&A+Profit 維持 $0.75 / unit,毛利率 ~6.7%,對 gaming 周邊算偏低。建議 NRE 已壓得很低 ($218.9K → $37.9K · ↓ 83%),最終單價想保 7% margin 可能要 push NRE 客戶分擔。' },
      { user: 'ss_mike', type: 'BLOCKER',    content: '🚨 T-107 EMC Debugging 預算 (30hrs×$125 = $3,750) 客戶 Ben 4/22 留言「待 Sustainability 條款確認」目前已 11 天未回應,擋住 Stage 6 進入。Lisa 麻煩 push 一下。' },
      { user: 'ss_amy',  type: 'DECISION',   content: '決定:依 Tony 默認方向採 CN-OptA(總成本 $11.12)。VN-OptB 雖然便宜 $0.10,但客戶未提區域要求,CN 廠對 SS supply 鏈最熟。最終單價建議 $11.87。' },
    ],
    tasks: [
      { title: 'T-018 EE BOM (黑/白共用版)',           status: 'DONE',        accountable_role: 'EE',         assignee: 'ss_troy' },
      { title: 'T-019 ME BOM Black (18 項)',          status: 'DONE',        accountable_role: 'ME',         assignee: 'ss_alvin' },
      { title: 'T-020 ME BOM White (18 項)',          status: 'DONE',        accountable_role: 'ME',         assignee: 'ss_alvin' },
      { title: 'T-024 結構應力分析 R0.8',              status: 'BLOCKED',     accountable_role: 'engineering', assignee: 'ss_keny' },
      { title: 'T-025 NRE EMI/Cert/WHQL',             status: 'IN_PROGRESS', accountable_role: 'QA',         assignee: 'ss_john' },
      { title: 'CN Cleansheet (Andy)',                status: 'DONE',        accountable_role: 'EPM',        assignee: 'ss_andy' },
      { title: 'VN Cleansheet (Long)',                status: 'DONE',        accountable_role: 'EPM',        assignee: 'ss_long' },
      { title: 'TW Cleansheet (Ken)',                 status: 'DONE',        accountable_role: 'EPM',        assignee: 'ss_ken_tw' },
      { title: 'T-107 EMC Debugging 預算客戶確認',     status: 'BLOCKED',     accountable_role: 'BPM',        assignee: 'ss_lisa' },
      { title: 'T-112 30 國認證矩陣',                  status: 'IN_PROGRESS', accountable_role: 'QA',         assignee: 'ss_john' },
      { title: 'Packaging 16 項詢價彙總',              status: 'IN_PROGRESS', accountable_role: 'sourcing',   assignee: 'ss_ken_fac' },
      { title: 'BOM Cost Review 草稿',                status: 'PENDING',     accountable_role: 'PM',         assignee: 'ss_mike' },
    ],
  },

  // DRAFT 案(剛開單還沒啟動)
  {
    project_code: 'Q-2026-DEMO-008',
    type_code: 'QUOTE',
    title: '小米 14 Pro 充電線(草稿 · 待啟動)',
    bu_id: 1,
    lifecycle_status: 'DRAFT',
    is_confidential: 0,
    importance: 'LOW',
    urgency: 'LOW',
    priority_score: 1,
    pm_username: 'pm_dora_dpm',
    sales_username: 'sales_mike',
    members: [],
    data_payload: {
      title: '小米 14 Pro 充電線(草稿)',
      customer: 'Xiaomi',
      partNo: 'XMI-14P-CHG',
      quantity: '100,000',
      dueDate: '2026-12-01',
      mode: 'OEM',
      specs: '120W 快充線 · USB-C to C',
      notes: '剛收到 RFQ · 還在 review',
    },
    chat_messages: [],
    tasks: [],
  },
];

// ─────────────────────────────────────────────────────────────────────
// 沉澱 KB cases(歷史結案 · 給 win-rate / pricing-suggest 找相似案用)
// 直接寫進 project_kb_chunks(is_sediment=1,kind='case')
// ─────────────────────────────────────────────────────────────────────
const DEMO_SEDIMENT_CASES = [
  {
    project_code_hint: 'Q-2025-CLOSED-001',  // 歷史 ID(無實 project,只有 chunk)
    title: 'Apple AirPods 2 USB-C(CLOSED_WIN)',
    content: `Project Q-2025-CLOSED-001 · 客戶 A001(Apple alias)· 料號 APL-APP2-CASE · 數量 400,000
- ODM 模式 · 結構 + 電氣全包
- 越南廠 · 90 天交期
- 報價 Tier-A · 毛利 MASKED%
- WIN reason:技術門檻高 + 越南廠成本優勢
特徵:Apple-like-customer / ODM / 充電盒 / USB-C / EMI 問題`,
    tags: ['CLOSED_WIN', 'ODM', 'A001'],
  },
  {
    project_code_hint: 'Q-2025-CLOSED-002',
    title: 'Apple Watch S9 充電盤(CLOSED_WIN)',
    content: `Project Q-2025-CLOSED-002 · 客戶 A001 · 料號 APL-WCH-S9-CHG · 數量 800,000
- ODM 模式 · 我方完整設計
- 中國廠 + 越南廠雙廠
- 報價 Tier-A · 毛利 MASKED%
- WIN reason:平台共用,降本快
特徵:Apple-like-customer / ODM / 充電盤 / Qi 認證`,
    tags: ['CLOSED_WIN', 'ODM', 'A001'],
  },
  {
    project_code_hint: 'Q-2025-CLOSED-003',
    title: 'Sony Medical 內視鏡連接器(CLOSED_WIN)',
    content: `Project Q-2025-CLOSED-003 · 客戶 A002(Sony Medical alias)· 料號 SNY-MED-ENDO · 數量 3,000
- OEM 模式 · 代工
- 越南廠 · 60 天交期
- 報價 Tier-B · 毛利 MASKED%
- WIN reason:醫療代工經驗 + ISO 13485 已建
特徵:Sony-like-customer / OEM / 醫療 / 認證`,
    tags: ['CLOSED_WIN', 'OEM', 'A002', 'medical'],
  },
  {
    project_code_hint: 'Q-2025-CLOSED-004',
    title: 'Tesla Model 3 高壓連接器 v1(CLOSED_LOSS)',
    content: `Project Q-2025-CLOSED-004 · 客戶 A003(Tesla alias)· 料號 TSL-M3-HVPLUG · 數量 800,000
- OEM 模式
- LOSS reason:報價 Tier-S 競爭對手 12% 低 · 認證費攤分過高
特徵:Tesla-like-customer / OEM / 高壓 / 失單`,
    tags: ['CLOSED_LOSS', 'OEM', 'A003', 'high_voltage'],
  },
  {
    project_code_hint: 'Q-2025-CLOSED-005',
    title: 'Garmin Fenix 7 充電線(CLOSED_WIN)',
    content: `Project Q-2025-CLOSED-005 · 客戶 A004(Garmin alias)· 料號 GMN-F7-CHG · 數量 80,000
- ODM 模式
- 中國廠 · 45 天交期
- 報價 Tier-M · 毛利 22%
- WIN reason:既有平台快速套用,交期短
特徵:Garmin-like-customer / ODM / 磁吸充電`,
    tags: ['CLOSED_WIN', 'ODM', 'A004'],
  },
  {
    project_code_hint: 'Q-2025-CLOSED-006',
    title: 'Xiaomi 13 充電線(CLOSED_LOSS)',
    content: `Project Q-2025-CLOSED-006 · 客戶 A005(Xiaomi alias)· 料號 XMI-13-CHG · 數量 200,000
- OEM 模式
- LOSS reason:競爭對手大陸廠 18% 低
特徵:Xiaomi-like-customer / OEM / 大陸競爭`,
    tags: ['CLOSED_LOSS', 'OEM', 'A005'],
  },
  {
    project_code_hint: 'Q-2025-CLOSED-007',
    title: 'BYD 充電樁線材 v1(CLOSED_HOLD)',
    content: `Project Q-2025-CLOSED-007 · 客戶 A006(BYD alias)· 料號 BYD-EV-CHG-V1 · 數量 250,000
- JDM 模式
- HOLD reason:客戶內部決策延後
特徵:BYD-like / JDM / 新能源 / 充電樁`,
    tags: ['CLOSED_HOLD', 'JDM', 'A006'],
  },
];

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
let _db;
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Phase 1-3 Demo Data Seeder');
  console.log('═══════════════════════════════════════════════════════════');

  await init();
  _db = require('../../database-oracle').db;
  if (!_db) throw new Error('db init failed');

  const passwordService = require('../../services/passwordService');
  const passwordHash = await passwordService.hash('123456');

  console.log('\n[1/8] Seed users (15 個)...');
  const userMap = await seedUsers(passwordHash);

  console.log('\n[2/8] Seed organization_units...');
  await seedOrgUnits();

  console.log('\n[3/8] Seed user_role_grants...');
  await seedRoleGrants(userMap);

  console.log('\n[4/8] Seed projects(8 個)+ members + channels + stages...');
  const projectMap = await seedProjects(userMap);

  console.log('\n[5/8] Seed chat messages + auto-Pin DECISION + KB chunks...');
  await seedChatMessages(projectMap, userMap);

  console.log('\n[6/8] Seed tasks + DONE 寫 KB chunk...');
  await seedTasks(projectMap, userMap);

  console.log('\n[7/8] Seed sediment KB cases(7 個歷史結案)...');
  await seedSedimentCases();

  console.log('\n[8/8] Seed comm rooms + 1 pending approval chain...');
  await seedCommRoomsAndApprovals(userMap, projectMap);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Demo data 全部 seed 完成 ✓');
  console.log('  測試帳號: ' + Object.keys(userMap).join(', '));
  console.log('  密碼: 123456');
  console.log('  測試劇本: docs/projects-platform-test-playbook.md');
  console.log('═══════════════════════════════════════════════════════════');
  process.exit(0);
}

async function seedUsers(passwordHash) {
  const map = {};
  for (const u of DEMO_USERS) {
    const existing = await _db.prepare(
      `SELECT id FROM users WHERE UPPER(username) = UPPER(?)`,
    ).get(u.username);
    let id;
    if (existing) {
      id = Number(existing.id);
      // Reset password to '123456' so test always work
      await _db.prepare(
        `UPDATE users SET password = ?, password_hashed = 'Y', name = ?, email = ?, role = ?, status = 'active'
         WHERE id = ?`,
      ).run(passwordHash, u.name, u.email, u.cortexRole || 'user', id);
      console.log(`  ✓ user ${u.username} (id=${id}, exists, reset pw)`);
    } else {
      const ins = await _db.prepare(`
        INSERT INTO users (username, password, password_hashed, name, email, role, status, creation_method)
        VALUES (?, ?, 'Y', ?, ?, ?, 'active', 'manual')
      `).run(u.username, passwordHash, u.name, u.email, u.cortexRole || 'user');
      id = Number(ins.lastInsertRowid);
      console.log(`  ✓ user ${u.username} (id=${id}, created)`);
    }
    map[u.username] = id;
  }
  return map;
}

async function seedOrgUnits() {
  const map = {};
  // pass 1:create all
  for (const o of DEMO_ORGS) {
    const existing = await _db.prepare(`SELECT id FROM organization_units WHERE code = ?`).get(o.code);
    if (existing) {
      map[o.code] = Number(existing.id);
      console.log(`  ✓ org ${o.code} (exists)`);
      continue;
    }
    const ins = await _db.prepare(`
      INSERT INTO organization_units (code, org_level, name_i18n, is_active)
      VALUES (?, ?, ?, 1)
    `).run(o.code, o.level, JSON.stringify({ 'zh-TW': o.name, en: o.name }));
    map[o.code] = Number(ins.lastInsertRowid);
    console.log(`  ✓ org ${o.code} (id=${map[o.code]}, created)`);
  }
  // pass 2:set parent_id
  for (const o of DEMO_ORGS) {
    if (!o.parent_code) continue;
    const parentId = map[o.parent_code];
    if (parentId) {
      await _db.prepare(
        `UPDATE organization_units SET parent_id = ? WHERE id = ?`,
      ).run(parentId, map[o.code]);
    }
  }
}

async function seedRoleGrants(userMap) {
  const adminId = userMap['demo_admin'];
  // 找對應的 role_definitions
  const roleRows = await _db.prepare(
    `SELECT id, role_code FROM user_role_definitions`,
  ).all();
  const roleByCode = Object.fromEntries(roleRows.map((r) => [r.role_code, Number(r.id)]));

  for (const u of DEMO_USERS) {
    if (!u.grants || u.grants.length === 0) continue;
    for (const g of u.grants) {
      const roleId = roleByCode[g.role];
      if (!roleId) {
        console.warn(`  ⚠ role ${g.role} not found in user_role_definitions`);
        continue;
      }
      const existing = await _db.prepare(
        `SELECT id FROM user_role_grants
          WHERE user_id = ? AND role_id = ? AND scope_type = ? AND is_active = 1`,
      ).get(userMap[u.username], roleId, g.scope || 'GLOBAL');
      if (existing) continue;
      await _db.prepare(`
        INSERT INTO user_role_grants
          (user_id, role_id, scope_type, scope_values,
           granted_by_admin_user_id, audit_metadata_clob)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userMap[u.username], roleId, g.scope || 'GLOBAL',
        g.values ? JSON.stringify(g.values) : null,
        adminId,
        JSON.stringify({ reason: 'demo seed', seeded_at: new Date().toISOString() }),
      );
      console.log(`  ✓ grant ${u.username} → ${g.role} ${g.scope || 'GLOBAL'}${g.values ? ' ' + JSON.stringify(g.values) : ''}`);
    }
  }
}

async function seedProjects(userMap) {
  const map = {};
  for (const p of DEMO_PROJECTS) {
    const existing = await _db.prepare(
      `SELECT id FROM projects WHERE project_code = ?`,
    ).get(p.project_code);
    if (existing) {
      map[p.project_code] = Number(existing.id);
      console.log(`  ✓ project ${p.project_code} (exists, id=${existing.id})`);
      continue;
    }

    // 找 project_type
    const typeRow = await _db.prepare(
      `SELECT id, default_workflow_template_id FROM project_types WHERE type_code = ?`,
    ).get(p.type_code);
    if (!typeRow) {
      console.warn(`  ⚠ project_type ${p.type_code} not found, skip ${p.project_code}`);
      continue;
    }

    const pmUserId    = userMap[p.pm_username];
    const salesUserId = userMap[p.sales_username];
    const createdBy   = userMap['demo_admin'];

    const ins = await _db.prepare(`
      INSERT INTO projects (
        project_code, project_type_id, workflow_template_id,
        data_payload, is_confidential, confidential_fields,
        sales_user_id, pm_user_id, bu_id,
        lifecycle_status, status,
        importance, urgency, priority_score,
        created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      p.project_code,
      Number(typeRow.id),
      typeRow.default_workflow_template_id ? Number(typeRow.default_workflow_template_id) : null,
      JSON.stringify(p.data_payload),
      p.is_confidential || 0,
      p.confidential_fields ? JSON.stringify(p.confidential_fields) : null,
      salesUserId || null,
      pmUserId,
      p.bu_id || null,
      p.lifecycle_status,
      p.lifecycle_status,
      p.importance,
      p.urgency,
      p.priority_score || 3,
      createdBy,
    );
    const projectId = Number(ins.lastInsertRowid);
    map[p.project_code] = projectId;
    console.log(`  ✓ project ${p.project_code} (id=${projectId})`);

    // Members
    await _addMember(projectId, pmUserId, 'PM', createdBy);
    if (salesUserId && salesUserId !== pmUserId) {
      await _addMember(projectId, salesUserId, 'sales', createdBy);
    }
    for (const memberUsername of (p.members || [])) {
      const memberId = userMap[memberUsername];
      if (memberId) await _addMember(projectId, memberId, 'engineering', createdBy);
    }

    // Default channels(從 plugin)
    const plugin = require('../plugins/registry').get(p.type_code);
    if (plugin?.default_channels) {
      for (const ch of plugin.default_channels) {
        try {
          const cIns = await _db.prepare(`
            INSERT INTO project_channels (project_id, name, channel_type, is_default, created_by)
            VALUES (?, ?, ?, ?, ?)
          `).run(projectId, ch.name, ch.type, ch.is_default ? 1 : 0, createdBy);
          const channelId = Number(cIns.lastInsertRowid);
          // PM 自動進(owner)
          await _db.prepare(
            `INSERT INTO channel_participants (channel_id, user_id, role) VALUES (?, ?, 'owner')`,
          ).run(channelId, pmUserId).catch(() => {});
          // Sales 也進
          if (salesUserId && salesUserId !== pmUserId) {
            await _db.prepare(
              `INSERT INTO channel_participants (channel_id, user_id, role) VALUES (?, ?, 'member')`,
            ).run(channelId, salesUserId).catch(() => {});
          }
        } catch (e) {
          // 既有 channel skip
        }
      }
    }

    // Stages(從 workflow template)
    if (typeRow.default_workflow_template_id) {
      try {
        const stages = await _db.prepare(`
          SELECT stage_code, stage_order, sla_hours, gate_required, required_role
            FROM workflow_template_stages
           WHERE template_id = ?
           ORDER BY stage_order
        `).all(Number(typeRow.default_workflow_template_id));
        for (let i = 0; i < stages.length; i++) {
          const s = stages[i];
          const status = i === 0 && p.lifecycle_status === 'ACTIVE' ? 'ACTIVE' : 'PENDING';
          await _db.prepare(`
            INSERT INTO project_stages
              (project_id, stage_code, stage_order, status, sla_hours, gate_required, required_role)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(projectId, s.stage_code, s.stage_order, status, s.sla_hours, s.gate_required, s.required_role).catch(() => {});
        }
      } catch (_) {}
    }
  }
  return map;
}

async function _addMember(projectId, userId, role, invitedBy) {
  try {
    await _db.prepare(`
      INSERT INTO project_members (project_id, user_id, role, invited_by) VALUES (?, ?, ?, ?)
    `).run(projectId, userId, role, invitedBy);
  } catch (_) { /* unique constraint or skip */ }
}

async function seedChatMessages(projectMap, userMap) {
  const crypto = require('crypto');
  for (const p of DEMO_PROJECTS) {
    if (!p.chat_messages?.length) continue;
    const projectId = projectMap[p.project_code];
    if (!projectId) continue;

    // 找 general channel(seed chat 進 general)
    const channel = await _db.prepare(`
      SELECT id FROM project_channels
       WHERE project_id = ? AND channel_type = 'general'
    `).get(projectId);
    if (!channel) continue;

    // 也找 announcement(for BLOCKER/DECISION sync)
    const announcementCh = await _db.prepare(`
      SELECT id FROM project_channels
       WHERE project_id = ? AND channel_type = 'announcement'
    `).get(projectId).catch(() => null);

    // 已有訊息 → skip
    const exist = await _db.prepare(
      `SELECT COUNT(*) AS C FROM project_messages WHERE channel_id = ?`,
    ).get(channel.id);
    if (Number(exist?.C ?? exist?.c ?? 0) > 0) {
      console.log(`  ⊝ ${p.project_code} chats exist, skip`);
      continue;
    }

    for (const m of p.chat_messages) {
      const userId = userMap[m.user];
      if (!userId) continue;
      const hash = crypto.createHash('sha256').update(m.content).digest('hex').slice(0, 64);
      const ins = await _db.prepare(`
        INSERT INTO project_messages
          (channel_id, project_id, user_id, content, message_type, content_hash,
           is_pinned, pinned_by, pinned_at, pin_note,
           synced_to_announcement, announcement_msg_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        channel.id, projectId, userId, m.content, m.type, hash,
        m.type === 'DECISION' ? 1 : 0,
        m.type === 'DECISION' ? userId : null,
        m.type === 'DECISION' ? new Date() : null,
        m.type === 'DECISION' ? '⭐ AI #23 · 自動 Pin (DECISION)' : null,
        0, null,
      );
      const msgId = Number(ins.lastInsertRowid);

      // BLOCKER / DECISION / AI_INSIGHT 同步到 announcement
      if (['BLOCKER', 'DECISION', 'AI_INSIGHT'].includes(m.type) && announcementCh) {
        const prefix = { BLOCKER: '🚨 BLOCKER', DECISION: '✅ DECISION', AI_INSIGHT: '🤖 AI INSIGHT' }[m.type];
        const annContent = `${prefix} (synced from #general)\n\n${m.content}`;
        const annIns = await _db.prepare(`
          INSERT INTO project_messages
            (channel_id, project_id, user_id, content, message_type, content_hash)
          VALUES (?, ?, ?, ?, 'SYSTEM', ?)
        `).run(announcementCh.id, projectId, userId, annContent,
              crypto.createHash('sha256').update(annContent).digest('hex').slice(0, 64));
        await _db.prepare(`
          UPDATE project_messages SET synced_to_announcement = 1, announcement_msg_id = ?
           WHERE id = ?
        `).run(Number(annIns.lastInsertRowid), msgId);
      }

      // Write live KB chunk
      try {
        await _db.prepare(`
          INSERT INTO project_kb_chunks
            (project_id, kind, source_id, content, tags, is_confidential, is_sediment)
          VALUES (?, 'chat', ?, ?, ?, ?, 0)
        `).run(projectId, msgId, m.content, JSON.stringify([m.type, 'channel:general']),
              p.is_confidential ? 1 : 0);
      } catch (_) {}
    }
    console.log(`  ✓ ${p.project_code} seed ${p.chat_messages.length} msgs`);
  }
}

async function seedTasks(projectMap, userMap) {
  for (const p of DEMO_PROJECTS) {
    if (!p.tasks?.length) continue;
    const projectId = projectMap[p.project_code];
    if (!projectId) continue;
    const exist = await _db.prepare(
      `SELECT COUNT(*) AS C FROM project_tasks WHERE project_id = ?`,
    ).get(projectId);
    if (Number(exist?.C ?? exist?.c ?? 0) > 0) continue;

    for (const t of p.tasks) {
      const ownerId = userMap[t.assignee] || null;
      try {
        const ins = await _db.prepare(`
          INSERT INTO project_tasks
            (project_id, title, accountable_role, primary_owner_user_id, status,
             progress_percent, created_by_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(projectId, t.title, t.accountable_role || null, ownerId, t.status || 'PENDING',
              t.status === 'DONE' ? 100 : (t.status === 'IN_PROGRESS' ? 50 : 0),
              userMap['demo_admin']);

        // DONE → 補 completed_at + 寫 KB chunk
        if (t.status === 'DONE') {
          await _db.prepare(`UPDATE project_tasks SET completed_at = SYSTIMESTAMP WHERE id = ?`)
            .run(Number(ins.lastInsertRowid));
          await _db.prepare(`
            INSERT INTO project_kb_chunks
              (project_id, kind, source_id, content, title, tags, is_confidential, is_sediment)
            VALUES (?, 'task', ?, ?, ?, ?, ?, 0)
          `).run(projectId, Number(ins.lastInsertRowid),
                `[task DONE] ${t.title}\naccountable: ${t.accountable_role || '—'}`,
                t.title, JSON.stringify(['task_done', t.accountable_role || '']),
                p.is_confidential ? 1 : 0).catch(() => {});
        }
      } catch (_) {}
    }
    console.log(`  ✓ ${p.project_code} seed ${p.tasks.length} tasks`);
  }
}

async function seedSedimentCases() {
  for (const c of DEMO_SEDIMENT_CASES) {
    const exist = await _db.prepare(
      `SELECT id FROM project_kb_chunks WHERE is_sediment = 1 AND kind = 'case' AND title = ?`,
    ).get(c.title);
    if (exist) {
      console.log(`  ⊝ sediment "${c.title}" exists`);
      continue;
    }
    // 加 retry + 短暫 delay 解 Oracle Client CLOB locator 偶發 ORA-03108
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        await _db.prepare(`
          INSERT INTO project_kb_chunks
            (project_id, kind, content, title, is_sediment, scrubbed, scrub_note, tags)
          VALUES (0, 'case', ?, ?, 1, 1, '已 scrub:客戶→Alias、金額→Tier-?、毛利→MASKED%', ?)
        `).run(c.content, c.title, JSON.stringify(c.tags));
        console.log(`  ✓ sediment "${c.title}"`);
        inserted = true;
      } catch (e) {
        if (attempt < 2 && /ORA-03108|ORA-29861/.test(e.message)) {
          await new Promise((r) => setTimeout(r, 500));  // 500ms 後重試
          continue;
        }
        console.warn(`  ⚠ sediment "${c.title}" failed: ${e.message}`);
      }
    }
    // 微 delay 避免 CTX index sync 堆積觸發 client bug
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function seedCommRoomsAndApprovals(userMap, projectMap) {
  // ─── Comm rooms ─────────────────────────────────────────────────────
  const adminId = userMap['demo_admin'];
  const amyId   = userMap['amy_bu1_dir'];

  // Global group
  const existing1 = await _db.prepare(
    `SELECT id FROM communication_rooms WHERE name = '全公司業務週會' AND room_type = 'org_group'`,
  ).get();
  if (!existing1) {
    const r1 = await _db.prepare(`
      INSERT INTO communication_rooms
        (room_type, name, description, scope, created_by_user_id)
      VALUES ('org_group', '全公司業務週會', '每週一固定討論', 'global', ?)
    `).run(adminId);
    const rid1 = Number(r1.lastInsertRowid);
    await _db.prepare(`INSERT INTO comm_room_participants (room_id, user_id, role) VALUES (?, ?, 'owner')`).run(rid1, adminId);
    for (const u of ['amy_bu1_dir', 'ben_bu2_dir', 'tina_top', 'sales_mike', 'sales_lisa']) {
      await _db.prepare(`INSERT INTO comm_room_participants (room_id, user_id, role) VALUES (?, ?, 'member')`)
        .run(rid1, userMap[u]).catch(() => {});
    }
    console.log(`  ✓ comm room: 全公司業務週會 (id=${rid1})`);
  }

  // BU1 group
  const existing2 = await _db.prepare(
    `SELECT id FROM communication_rooms WHERE name = 'BU1 連接器組' AND bu_id = 1`,
  ).get();
  if (!existing2) {
    const r2 = await _db.prepare(`
      INSERT INTO communication_rooms
        (room_type, name, description, scope, scope_owner_id, bu_id, created_by_user_id)
      VALUES ('org_group', 'BU1 連接器組', 'BU1 內部討論', 'cross_org', 1, 1, ?)
    `).run(amyId);
    const rid2 = Number(r2.lastInsertRowid);
    await _db.prepare(`INSERT INTO comm_room_participants (room_id, user_id, role) VALUES (?, ?, 'owner')`).run(rid2, amyId);
    for (const u of ['sales_mike', 'pm_dora_dpm', 'pm_bob_bpm']) {
      await _db.prepare(`INSERT INTO comm_room_participants (room_id, user_id, role) VALUES (?, ?, 'member')`)
        .run(rid2, userMap[u]).catch(() => {});
    }
    console.log(`  ✓ comm room: BU1 連接器組 (id=${rid2})`);
  }

  // DM:Mike ↔ Amy
  const mikeId = userMap['sales_mike'];
  const [lo, hi] = mikeId < amyId ? [mikeId, amyId] : [amyId, mikeId];
  const existingDm = await _db.prepare(
    `SELECT id FROM communication_rooms WHERE room_type = 'org_dm' AND dm_user_a_id = ? AND dm_user_b_id = ?`,
  ).get(lo, hi);
  if (!existingDm) {
    const r3 = await _db.prepare(`
      INSERT INTO communication_rooms
        (room_type, name, scope, created_by_user_id, dm_user_a_id, dm_user_b_id)
      VALUES ('org_dm', ?, 'cross_project', ?, ?, ?)
    `).run(`dm:u${lo}:u${hi}`, mikeId, lo, hi);
    const rid3 = Number(r3.lastInsertRowid);
    await _db.prepare(`INSERT INTO comm_room_participants (room_id, user_id, role) VALUES (?, ?, 'member')`).run(rid3, lo);
    await _db.prepare(`INSERT INTO comm_room_participants (room_id, user_id, role) VALUES (?, ?, 'member')`).run(rid3, hi);
    console.log(`  ✓ DM Mike ↔ Amy (id=${rid3})`);
  }

  // ─── Approval chain(pending lifecycle_close on project Sony Medical)──
  const sonyId = projectMap['Q-2026-DEMO-004'];
  if (sonyId) {
    const existChain = await _db.prepare(
      `SELECT id FROM project_approval_chains WHERE project_id = ? AND chain_kind = 'lifecycle_close' AND status = 'PENDING'`,
    ).get(sonyId);
    if (!existChain) {
      const ins = await _db.prepare(`
        INSERT INTO project_approval_chains
          (project_id, chain_kind, title, reason, requested_by_user_id,
           target_payload_json, total_steps, expires_at)
        VALUES (?, 'lifecycle_close', ?, ?, ?, ?, 1, ?)
      `).run(sonyId, '結案簽核 · Sony Medical', '量產確認完成,請 BU 主管批准結案',
            userMap['pm_mary_mpm'],
            JSON.stringify({ to_lifecycle: 'CLOSED' }),
            new Date(Date.now() + 72 * 3600 * 1000));
      const chainId = Number(ins.lastInsertRowid);
      await _db.prepare(`
        INSERT INTO project_approval_steps (chain_id, step_order, approver_role, step_kind)
        VALUES (?, 1, 'project.bu_director', 'approve')
      `).run(chainId);
      console.log(`  ✓ approval chain pending (chain_id=${chainId}, Sony Medical 結案)`);
    }
  }
}

main().catch((e) => {
  console.error('SEED FAILED:', e.message, e.stack);
  process.exit(1);
});
