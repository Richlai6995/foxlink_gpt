/**
 * MvaWorkflowSection — 🛠️ MVA 操作流程細部手冊 (Phase A → G)(v0.16 原設計重寫)
 *
 * 忠於 demo renderFormMvaWorkflow(17220–17427)+ MVA_PHASES(16984–17213):
 * 兩案差異 banner → Phase tab bar(縱向 tab · active 填 phase 色)→ Active header 卡 →
 * 四 panel(①素材 kind 色卡 ②步驟 斑馬紋+編號+mins+sys ③兩案差異 ④DB 表 chips)→ prev/next 導覽。
 * 靜態雙案整合手冊(MOUSE_STD vs WHOOP_WEARABLE),內容照 SD spec。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'

type Prereq = { kind: 'doc' | 'data' | 'policy' | 'config' | 'permission'; name: string; detail: string }
type Step = { num: string; name: string; who: string; sys: string; detail: string; mins: number | string }
type Phase = {
  code: string; title: string; icon: string; color: string; timing: string; main_owner: string; summary: string
  prereq: Prereq[]; steps: Step[]; delta_steelseries: string; delta_whoop: string; schemas: string[]
}

const KIND_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  doc: { bg: '#FEF3C7', fg: '#92400E', label: '📄 文件 / xlsx' },
  data: { bg: '#DBEAFE', fg: '#1E40AF', label: '📊 資料' },
  policy: { bg: '#FCE7F3', fg: '#9D174D', label: '📐 政策 / 規則' },
  config: { bg: '#E0E7FF', fg: '#3730A3', label: '⚙️ 設定' },
  permission: { bg: '#FEE2E2', fg: '#991B1B', label: '🔐 權限' },
}

const PHASES: Phase[] = [
  {
    code: 'A', title: '公司 / 廠級一次性建置', icon: '🏗️', color: '#7C3AED',
    timing: '初始 · 一次性 · ~2 週/廠', main_owner: 'IT + Admin EPM(per 廠)',
    summary: '建立公司級主檔(製程目錄 / 模板)+ 各廠首份 baseline(SupplierBaseInput / IDL 17 角色 / 設備庫 / 耗材庫)。完成後其他案才能開。',
    prereq: [
      { kind: 'doc', name: '廠 EPM Cleansheet xlsx 原檔', detail: '至少一份代表廠 baseline(本 demo:CN 廠 = Rival 3+ Wired Mouse Cleansheet_China-20241011-19S.xlsx)' },
      { kind: 'doc', name: '設備折舊年限政策', detail: '各設備分類(SMT / SMT_TEST / BB_ASSY / BB_TEST / IT)年限 · 由廠財務或集團政策定' },
      { kind: 'data', name: 'IDL 角色 17 種薪資表', detail: 'Ops Mgr / Section Mgr / Engineer / Tech / Line Leader / ... 年薪 USD' },
      { kind: 'data', name: '廠別 master(CN/VN/TW)', detail: '幣別 · ERP ledger book_id · 對齊 gl_daily_rates 反推 OU' },
      { kind: 'policy', name: '9 個製程目錄初始 enum', detail: 'SMT_MAIN / WAVE_SOLDER / ROUTER_OFFLINE / LASER_ETCH / BB_ASSY / BB_TEST / MAT_MGMT / Q_SMT / Q_BB(可擴)' },
      { kind: 'policy', name: '產品類型模板初始(2 種)', detail: 'MOUSE_STD(本 SteelSeries 案 9 製程)+ WHOOP_WEARABLE(模組化 SMT × N + FATP 7 station)' },
    ],
    steps: [
      { num: 'A1', name: '廠基本資料建檔', who: 'Admin', sys: 'INSERT bom_factory', detail: 'CN / VN / TW 各一列 · factory_code / full_name / country_iso / currency / ledger_book_id', mins: 30 },
      { num: 'A2', name: '9 製程目錄 enum 初始化', who: 'Admin', sys: 'INSERT bom_process_catalog', detail: '依 cleansheet-mva-sd §3.2 表格 · 9 + COMMON 共 10 列 · 三語言名稱', mins: 60 },
      { num: 'A3', name: '2 產品模板(含 step list)', who: 'Admin', sys: 'INSERT bom_process_template + bom_process_template_step', detail: 'MOUSE_STD:SMT→Wave→Router→Laser→BB Assy→BB Test→Mat Mgmt→Q-SMT→Q-BB · WHOOP_WEARABLE:Multi-Module SMT→Module Integration→Final Assembly→FATP 7-station', mins: 90 },
      { num: 'A4', name: '廠 EPM 上傳首份 Cleansheet xlsx', who: 'CN EPM Andy', sys: 'multer upload → 暫存 stage', detail: 'SupplierBaseInput / Equipment List / Consumables / Cleansheet / Price Summary 5 sheet 必備', mins: 10 },
      { num: 'A5', name: '系統解析 → 寫 baseline + IDL + 折舊年限', who: '系統', sys: 'bom_cs_baseline_import', detail: 'INSERT bom_factory_baseline (status="draft") + bom_factory_idl_role × 17 + bom_factory_dep_years × N', mins: 5 },
      { num: 'A6', name: '系統解析 Equipment List → upsert 廠設備庫', who: '系統', sys: 'INSERT/UPDATE bom_factory_equipment', detail: '58 件設備(本案 CN baseline)· 每件:bucket / type / desc / manuf / model / pn / useful_life / acq_cost', mins: 5 },
      { num: 'A7', name: '系統解析 Consumables → 廠耗材庫', who: '系統', sys: 'INSERT bom_factory_consumable', detail: '17 種耗材(本案)· unit_cost / annual_usage_default / UOM', mins: 5 },
      { num: 'A8', name: 'Admin approve baseline', who: 'Admin', sys: 'UPDATE baseline status="active" + effective_from', detail: '設 effective_from = today · 該廠首份 active baseline 鎖定 · 之後新案才能引用', mins: 15 },
    ],
    delta_steelseries: 'CN baseline:DL $4.95/hr · 58 equipment · 17 consumable · 17 IDL roles · 9 製程',
    delta_whoop: '同廠 baseline 共用(不重建)· 但 process_template 用 WHOOP_WEARABLE · FATP 7 station 設備庫獨立加 7 件',
    schemas: ['bom_factory', 'bom_factory_baseline', 'bom_factory_idl_role', 'bom_factory_dep_years', 'bom_factory_equipment', 'bom_factory_consumable', 'bom_process_catalog', 'bom_process_template', 'bom_process_template_step'],
  },
  {
    code: 'B', title: '月度 Baseline 維護', icon: '📆', color: '#0EA5E9',
    timing: '每月底 · ~1 天/廠', main_owner: '各廠 EPM(自家廠)+ admin 簽核',
    summary: '廠級 wage / 設備購置 / 耗材單價 月度異動 · SCD Type 2 切版 · 不影響已 lock 案,僅 draft 案 EPM 自選 reprice。',
    prereq: [
      { kind: 'doc', name: '新月 Cleansheet xlsx', detail: 'EPM 本月更新版 · 主要異動:SupplierBaseInput(wage 漲) + Equipment List(新增/汰換) + Consumables(漲價)' },
      { kind: 'data', name: '現行 active baseline 版本', detail: 'SELECT FROM bom_factory_baseline WHERE factory_code=? AND status=active · 系統自動 fetch' },
      { kind: 'policy', name: 'Diff 比對策略', detail: 'wage 漲 > 5% / 設備 acq_cost 漲 > 10% / 折舊年限改 → 需 EPM 與廠財務雙簽' },
    ],
    steps: [
      { num: 'B1', name: 'EPM 上傳新版 xlsx', who: '廠 EPM Andy/Long/Ken', sys: 'POST /api/cs/baselines/import', detail: 'admin → factory baselines 介面 → 上傳 · 系統建 draft baseline · 不影響 active', mins: 5 },
      { num: 'B2', name: '系統解析 + Diff 比對', who: '系統', sys: 'bom_cs_baseline_diff 表寫入', detail: 'wage / IDL / 設備 / 耗材 / 折舊年限 5 個維度逐項比 · 標 ADDED / CHANGED / RETIRED', mins: 3 },
      { num: 'B3', name: 'Diff Preview UI', who: 'EPM', sys: 'GET /api/cs/baselines/:id/diff', detail: '卡片式呈現:DL $4.95 → $5.20(+5.05%) · DEK acq_cost $84k→$92k · 新增 FUJI M6S · 汰換 TR7500 AOI · 加 Impact estimation', mins: 20 },
      { num: 'B4', name: 'EPM 逐項勾選 approve / reject', who: 'EPM', sys: 'PATCH /api/cs/baselines/:id/items', detail: '每行 diff 可單獨勾 · 沒勾的不套用 · 漲幅 > 5% 系統高亮需要二簽', mins: 15 },
      { num: 'B5', name: 'admin / 廠財務 sign-off(漲幅大者)', who: '廠財務 + admin', sys: 'audit_log entry', detail: '若任一項勾選且漲幅 > 5% · 系統 block 直到二簽完成', mins: 30 },
      { num: 'B6', name: 'SCD Type 2 切版', who: '系統', sys: 'UPDATE old baseline effective_to + status=superseded · UPDATE new status=active', detail: '舊 baseline.effective_to = today · 新 baseline.effective_from = today+1', mins: 1 },
      { num: 'B7', name: '影響案 notify', who: '系統', sys: 'user_notifications', detail: '找所有 draft case_factory WHERE baseline_id IN (該廠舊 baselines) · 推 chip「baseline 已更新,點此 reprice」', mins: 1 },
    ],
    delta_steelseries: '本案若還 draft → EPM 收到 chip · 可選 reprice(triggers cs_run 重算) 或保留(baseline_locked_manually=1)',
    delta_whoop: '同 SteelSeries · 但 reprice 觸發 8 個 sub-BOM × 24 cells 重算 · 比 SteelSeries 慢 ~3x',
    schemas: ['bom_factory_baseline', 'bom_cs_baseline_diff', 'bom_cs_audit_log', 'user_notifications'],
  },
  {
    code: 'C', title: '新案開立 (Case Setup)', icon: '📂', color: '#16A34A',
    timing: '案啟動 · 1 天', main_owner: 'BPM(業務專案經理)+ 三廠 EPM',
    summary: '從 project 出發建 case_factory · 選 process_template · 配 qty_scenarios + pkg_versions · variants(色款)。此 phase 結束才能進案級配置。',
    prereq: [
      { kind: 'data', name: 'project 主表 (已建立)', detail: 'customer_id / BPN / annual_demand / 期望出貨地' },
      { kind: 'data', name: 'variants 清單', detail: 'SteelSeries:black/white · WHOOP:black/white/midnight 3 色' },
      { kind: 'data', name: 'qty_scenarios 拍板', detail: 'Low/High(本案 100K / 418K)· 對應 region 適用範圍' },
      { kind: 'data', name: 'pkg_versions 拍板', detail: 'SteelSeries:商包(16 item) + 工包(3 item)· WHOOP:5 PKG SKU × 8 module matrix' },
      { kind: 'policy', name: '廠別配置範圍', detail: '3 廠都跑 / 只 CN+VN / 只 TW · BPM 決定 RFQ scope' },
    ],
    steps: [
      { num: 'C1', name: 'BPM 開 project + 設 customer/BPN', who: 'BPM Lisa', sys: 'INSERT projects', detail: '§customer section 填完 → status=ACTIVE', mins: 20 },
      { num: 'C2', name: 'RD 上傳 BOM xlsx → 抽 variants', who: 'RD Troy', sys: '§BOM 流程', detail: 'AI 解析 EE/ME BOM · §variants 標 shared/per_variant scope', mins: 60 },
      { num: 'C3', name: 'BPM 建 case_factory × 3 廠', who: 'BPM', sys: 'INSERT bom_cs_case_factory × 3', detail: 'CN / VN / TW 各一列 · baseline_id 鎖當前 active · status=draft', mins: 10 },
      { num: 'C4', name: '選 process_template', who: 'BPM + EPM', sys: 'UPDATE bom_cs_case_factory.process_template_id', detail: 'MOUSE 類 → MOUSE_STD · 可穿戴 → WHOOP_WEARABLE · 自訂 → CUSTOM 空白', mins: 5 },
      { num: 'C5', name: '設 qty_scenarios', who: 'BPM', sys: 'INSERT bom_cs_case_qty_scenario', detail: '本 demo:LOW=100K(region=US) · HIGH=418K(global) · is_baseline 標 HIGH', mins: 5 },
      { num: 'C6', name: '設 pkg_versions', who: 'BPM + PKG 採購 Ken', sys: 'INSERT bom_cs_case_pkg', detail: '本 demo:RETAIL=商包(channel:retail+online) · BULK=工包(channel:spare_parts+b2b)', mins: 10 },
    ],
    delta_steelseries: 'MOUSE_STD 模板 · 3 廠 × 2 variant × 2 qty × 2 pkg = 24 cells / case · 1-BOM 結構',
    delta_whoop: 'WHOOP_WEARABLE 模板 · 8 sub-BOM (bom_module) · 5 PKG SKU × 8 module 包含矩陣 · FATP 7 station',
    schemas: ['bom_cs_case_factory', 'bom_cs_case_qty_scenario', 'bom_cs_case_pkg', 'projects'],
  },
  {
    code: 'D', title: '案級配置 (Case-Level Config)', icon: '⚙️', color: '#0891B2',
    timing: '案級填單 · 3-5 天 / 廠', main_owner: '各廠 EPM(自家廠 case_factory)',
    summary: '從模板帶入製程清單 → 各製程調 9 個變數(takt/yield/eff/工時/shifts/DL/IDL)· IDL × 製程 multiplier matrix · 設備與耗材 binding(line_qty/qty_per_line)· PKG items 上傳。',
    prereq: [
      { kind: 'data', name: '廠 master 已建立(Phase A 完成)', detail: '設備庫 + 耗材庫 must exist' },
      { kind: 'data', name: 'case_factory + qty_scenarios + pkg_versions(Phase C 完成)', detail: 'case_factory.process_template_id 已選' },
      { kind: 'doc', name: 'RD Process Flow xlsx', detail: '各製程的 takt 來源 · 文字 ref(takt_source 欄位記)· Phase 1 不結構化解析' },
      { kind: 'doc', name: 'EE BOM Cleansheet 章節(SMT/Wave/Router 的 DL/IDL 標準工時)', detail: 'EPM 對齊 industrial engineer 給的工時資料' },
      { kind: 'data', name: '廠設備 master 子集(line_qty / qty_per_line 案級配置)', detail: '例:DEK 案內 line_qty=1 / qty_per_line=1 · 同一台機跨案可分配' },
      { kind: 'doc', name: 'PKG BOM xlsx(本案商包 + 工包 ranges)', detail: '本 demo:商包 16 item / 工包 3 item · sheet 名「PKG BOM 20241023_Amber」' },
    ],
    steps: [
      { num: 'D1', name: '從 template 帶入製程清單', who: 'EPM', sys: 'INSERT bom_cs_case_process FROM bom_process_template_step', detail: '一鍵 copy 模板 9 製程 → 案級 process list · 預設帶模板 step_order', mins: 5 },
      { num: 'D2', name: 'EPM 調各製程 9 變數', who: 'EPM', sys: 'UPDATE bom_cs_case_process', detail: 'takt(s) · yield% · efficiency% · 工時/day · 工作日/wk · shifts · DL/shift · debug DL · functional DL · lines installed', mins: 60 },
      { num: 'D3', name: 'IDL × 製程 multiplier matrix', who: 'EPM', sys: 'INSERT bom_cs_case_idl_alloc', detail: '17 role × 9 process · 從 Excel J64/L64/N64... 抄(首次)· 後續 UI 編輯 multiplier 欄位', mins: 90 },
      { num: 'D4', name: '案級設備 binding(子集 of 廠 master)', who: 'EPM', sys: 'INSERT bom_cs_case_equipment', detail: '從廠 master 選 32 件(SteelSeries 案)· 設 line_qty / qty_per_line / 可 override useful_life / acq_cost', mins: 30 },
      { num: 'D5', name: '案級耗材 binding', who: 'EPM', sys: 'INSERT bom_cs_case_consumable', detail: '從廠 master 選對應耗材 · 設 annual_usage_qty · 可 override unit_cost', mins: 20 },
      { num: 'D6', name: 'PKG items 上傳(per pkg_version)', who: 'PKG 採購 Ken', sys: 'INSERT bom_cs_case_pkg_item', detail: '商包 16 item · 工包 3 item · 各填 qty/unit/spec/vendor/true_cost/quote_price/markup', mins: 45 },
    ],
    delta_steelseries: '9 製程 × 17 IDL role · 32 設備 binding(從 58 件廠 master 挑)· 17 耗材 · 商包 16 item + 工包 3 item',
    delta_whoop: '製程結構多層:每 sub-BOM(8 個 module)各自 SMT 配置 · FATP 7 station 串接 · IDL multiplier matrix 變大 · PKG SKU × Module 矩陣 5×8=40 點要勾',
    schemas: ['bom_cs_case_process', 'bom_cs_case_idl_alloc', 'bom_cs_case_equipment', 'bom_cs_case_consumable', 'bom_cs_case_pkg_item'],
  },
  {
    code: 'E', title: '計算 (Compute)', icon: '🧮', color: '#DC2626',
    timing: '配置完按鈕 · 30 秒 / case_factory', main_owner: 'EPM 觸發 · 系統執行',
    summary: '5 區公式跑(DL / IDL / Equip+Facility / Others / Total)· 寫 cs_run header + cs_run_cell × (process × component × qty_scenario) · MVA per unit 出來 · Regression test vs Excel < 0.01ε。',
    prereq: [
      { kind: 'data', name: 'Phase D 全完成', detail: 'case_process / idl_alloc / case_equipment / case_consumable / pkg_item 都齊' },
      { kind: 'data', name: 'BOM main board cost', detail: '從 bom_item motherboard 取 motherboard_cost_ref(本案 ≈ $8.683)· 算 VAT 用' },
      { kind: 'config', name: 'compute engine 版本', detail: 'compute_engine = db_v1 · 對齊 §App-A 100+ 條 Excel 公式對應表' },
      { kind: 'config', name: 'Regression test 容差', detail: '每 cell 跟 Excel 原值比 · ε < 0.01 PASS · > 0.01 FAIL → run.status=failed' },
    ],
    steps: [
      { num: 'E1', name: 'EPM 按 「🔄 Compute」 按鈕', who: 'EPM', sys: 'POST /api/cs/case-factories/:id/compute', detail: '系統開新 cs_run(status=computing)· 標 case_factory.dirty=0', mins: 1 },
      { num: 'E2', name: 'compute_dl_cost(per process × qty_scenario)', who: '系統', sys: 'service: compute_dl_cost', detail: '步驟:UPH → max_output/line → lines → weekly_output → DL/day → multipliers → DL/week → /unit · 對 Cleansheet!C58', mins: 5 },
      { num: 'E3', name: 'compute_idl_cost(per process × qty_scenario)', who: '系統', sys: 'service: compute_idl_cost', detail: 'centralized service IDL + line-dep IDL · 對 Cleansheet rows 64-83', mins: 5 },
      { num: 'E4', name: 'compute_equipment_cost(MRO + Depr)', who: '系統', sys: 'service: compute_equipment_cost', detail: 'SUM(Equipment List MRO P:P / Depr P:P) × (annual_demand / weekly_output) · 對 Cleansheet!H90/H91', mins: 3 },
      { num: 'E5', name: 'compute_facility + ind_materials', who: '系統', sys: 'service: compute_facility_cost', detail: 'sqft × $unit × IDL multiplier × (年 demand / 週 output) · 對 Cleansheet!J100', mins: 3 },
      { num: 'E6', name: 'compute_others(Freight + VAT + Loss · Common 欄)', who: '系統', sys: 'compute_others_cost', detail: 'inbound_freight / annual_demand · motherboard × vat_rate / 18 · loss_factor × material · 對 J107/J110/J114', mins: 2 },
      { num: 'E7', name: '寫 cs_run_cell × N rows', who: '系統', sys: 'INSERT bom_cs_run_cell', detail: '9 process × 9 component × qty_scenarios · 多 qty scenario 寫多份 cell(因 lines 變)', mins: 1 },
      { num: 'E8', name: 'Roll-up MVA + SGA + Profit', who: '系統', sys: 'compute_mva_total / compute_sga_profit', detail: 'MVA = SUM(non-common cell + common cell) · SGA = motherboard × 0.02 · Profit = (MVA+motherboard) × 0.14', mins: 1 },
      { num: 'E9', name: 'Regression test vs Excel(自動)', who: '系統 CI', sys: 'pytest tests/test_compute_regression', detail: '每 cell 取 Excel 原值 cross-check · ε > 0.01 → run.status=failed + warnings_json 寫差異', mins: 5 },
      { num: 'E10', name: 'cs_run.status = ready', who: '系統', sys: 'UPDATE bom_cs_run', detail: '寫 computed_at / computed_by / 觸發 user_notification「Compute 完成」', mins: 1 },
    ],
    delta_steelseries: '本案 = 3 廠 × 2 qty = 6 cs_run · 各 run 9 process × 9 component = ~50 effective cell rows',
    delta_whoop: '本案 = 3 廠 × 2 qty = 6 cs_run · 但每 run 含 8 sub-BOM × 各自 SMT process · FATP 7 station · cell rows ~300+ · compute 時間長 ~3 分鐘',
    schemas: ['bom_cs_run', 'bom_cs_run_cell'],
  },
  {
    code: 'F', title: 'BOM Lock Propagate', icon: '🔒', color: '#B45309',
    timing: 'DPM gate · 5 分鐘', main_owner: 'DPM(觸發)+ 系統(自動寫 fact table)',
    summary: 'BOM 鎖版時自動跑 material × MVA × SGA × Profit 整合 · 寫 cs_run_result fact table(SteelSeries:24 列 · WHOOP:依 PKG×module 展開更多)· True/Quote 雙價 + Margin auto computed via Oracle GENERATED ALWAYS AS。',
    prereq: [
      { kind: 'data', name: 'cs_run 已 ready(Phase E 完成)', detail: '各廠各 qty scenario 都有 ready run · status≠failed' },
      { kind: 'data', name: 'BOM 採購策略已選定', detail: '每 item 已 select_mfg + select_tier · 採購主管已 review' },
      { kind: 'data', name: 'PKG BOM items 雙價齊全', detail: '商包 16 / 工包 3 · 每 item 含 true_cost_usd + quote_price_usd' },
      { kind: 'config', name: 'variant scope 對齊', detail: 'project.variants × bom_item.variant_scope(shared / per_variant)· 影響每 cell material 算法' },
      { kind: 'policy', name: 'multi-PKG lock 順序', detail: 'lock 全部 PKG / 只 lock primary(預設全 lock)· DPM UI 選擇' },
    ],
    steps: [
      { num: 'F1', name: 'DPM 按 「🔒 Lock BOM」', who: 'DPM Mike', sys: 'POST /api/bom/:id/lock', detail: '§factory_matrix UI 點 lock · 系統前置檢查(cs_run ready / 雙價齊 / variant scope 對) · pass 才 propagate', mins: 3 },
      { num: 'F2', name: '列每 case_factory 維度組合', who: '系統', sys: 'in-memory 展開', detail: 'variants × qty_scenarios × pkg_versions × factory · SteelSeries 案 = 24 組合 · WHOOP 案視 PKG SKU 矩陣展開', mins: 1 },
      { num: 'F3', name: 'compute_material_per_combo', who: '系統', sys: 'SUMPRODUCT(bom_item × tier match × variant scope)', detail: '每 combo:material_true_usd / material_quote_usd · 對 qty_scenario 找對應 tier(qty_min ≤ target_qty ≤ qty_max)', mins: 5 },
      { num: 'F4', name: '取 PKG cost(per pkg_version)', who: '系統', sys: 'SELECT total_cost FROM bom_cs_case_pkg', detail: '已在 Phase D 算好 roll-up · 直接帶入 · 商包 $0.706 / 工包 $0.182(SteelSeries 案)', mins: 1 },
      { num: 'F5', name: '取 MVA(per qty_scenario)', who: '系統', sys: 'SUM(bom_cs_run_cell WHERE run_id AND qty_scenario)', detail: 'MVA per unit 已在 Phase E 算好 · 此處只 SUM aggregate', mins: 1 },
      { num: 'F6', name: '算 SGA + Profit', who: '系統', sys: '公式 hard-code', detail: 'sga_usd = motherboard × baseline.sga_pct(0.02)· profit_amount_usd = (MVA + motherboard) × baseline.profit_pct(0.14)', mins: 1 },
      { num: 'F7', name: 'UPSERT bom_cs_run_result × N rows', who: '系統', sys: 'MERGE INTO bom_cs_run_result', detail: 'UNIQUE (run_id, factory, variant, qty_scenario, pkg) · 24 列(SteelSeries) · Margin/Total 用 GENERATED VIRTUAL 自動算', mins: 2 },
      { num: 'F8', name: 'audit_log 寫 PROPAGATE event', who: '系統', sys: 'INSERT bom_cs_audit_log', detail: 'event=BOM_PROPAGATE · payload={total_rows:24, factories, variants, qty, pkg}', mins: 1 },
      { num: 'F9', name: 'notify 影響干係人', who: '系統', sys: 'user_notifications', detail: 'EPM(已 propagate)· BPM(可進業務 gate)· 採購主管(可看 markup 結果)', mins: 1 },
    ],
    delta_steelseries: 'propagate 寫 24 列 result · 切 qty/pkg/variant pivot view 直接看 6 cells (3 廠 × 2 variant)',
    delta_whoop: 'propagate 寫多 PKG × 多 module 結果 · 5 SKU × 24 cells = 120 列 · 跨 SKU 看 module cost 拆解(由 PKG_SKU_MODULE_MATRIX 加權)',
    schemas: ['bom_cs_run_result', 'bom_cs_audit_log', 'user_notifications'],
  },
  {
    code: 'G', title: '報價 + Margin 分析', icon: '💰', color: '#9333EA',
    timing: '業務 Gate · 4 小時', main_owner: '業務 + BPM + 採購主管 + finance',
    summary: 'Factory matrix pivot view · 24 cells 切 qty/pkg/variant 動態 refresh · True Cost 走 VIEW_TRUE_COST 權限(finance/採購主管/dpm 可見)· 業務只看 Quote · 議價時走 reprice / unlock 流程開新 cs_run cycle。',
    prereq: [
      { kind: 'data', name: 'BOM 已 lock(Phase F 完成)', detail: 'cs_run_result fact table 已有 24 列' },
      { kind: 'permission', name: 'VIEW_TRUE_COST 權限分配', detail: 'finance / dpm / procurement_director / epm(自家廠)· 一般業務 / 助理 ❌' },
      { kind: 'data', name: '競品 / 客戶歷史報價(議價用)', detail: 'BPM 從 CRM 拉 · 對齊 markup % 上下限' },
      { kind: 'policy', name: 'reprice 觸發條件', detail: '客戶議價 → 新 cs_run · 舊 run.status=archived · UI 只列 ready · toggle 看歷史' },
    ],
    steps: [
      { num: 'G1', name: '§factory_matrix UI 開啟', who: 'BPM / 採購主管 / finance', sys: 'GET /api/cs/cases/:id/matrix', detail: '回 24 cells × {factory, variant, qty, pkg, total_true, total_quote, mva, gross_margin_pct}', mins: 5 },
      { num: 'G2', name: 'Qty / PKG / Variant toggle 切換', who: '用戶', sys: '前端 state pivot', detail: '狀態 v07.qty / v07.pkg → re-fetch fact table pivot · 6 cell 主表 dynamic refresh', mins: 10 },
      { num: 'G3', name: 'Margin Heatmap 視角', who: 'finance / 採購主管', sys: 'GET /api/cs/margin/:run', detail: '24 cells heatmap · gross_margin_pct 顏色 · Top Markup Items per PKG · 需 VIEW_TRUE_COST', mins: 15 },
      { num: 'G4', name: 'BPM 匯出 RFQ Cost Excel', who: 'BPM Lisa', sys: 'POST /api/quotes/:id/export', detail: '只匯 Quote 欄位(True/Margin 被 strip)· 內含 region/qty/pkg 分頁 · 進客戶報價系統', mins: 20 },
      { num: 'G5', name: '業務 / BPM 簽核 submit', who: '業務 John + BPM', sys: 'INSERT rfq_submissions', detail: 'submit quote · 系統建 RFQ record · 入 audit log · status=submitted', mins: 5 },
      { num: 'G6', name: '(議價時)客戶回 → 採購 reprice', who: '採購 + EPM', sys: 'POST /api/cs/case-factories/:id/reprice', detail: '採購改 price tier or mfg · trigger 新 compute · 舊 cs_run.status=archived(軟刪)· 新 run 接續', mins: '循環' },
    ],
    delta_steelseries: 'BPM 用 §factory_matrix toggle 24 cells · finance 看 §margin_analysis heatmap · 客戶議價 → reprice 進下一 cycle',
    delta_whoop: '同 SteelSeries · 但 §whoop_summary 用 5 SKU 拆解視角 · 看「同一 module 跨 SKU 攤分」效應 · 比 SteelSeries 視角多一層',
    schemas: ['bom_cs_run_result', 'rfq_submissions', 'ai_data_policy_rules(VIEW_TRUE_COST)'],
  },
]

const TOTAL_STEPS = PHASES.reduce((a, p) => a + p.steps.length, 0)
const TOTAL_PREREQ = PHASES.reduce((a, p) => a + p.prereq.length, 0)
const shortTitle = (t: string) => t.split(' (')[0]

// 每 Phase 對應平台功能:本案實況判定 + 前往目標
const PHASE_LINK: Record<string, { target: string; targetLabel: string; judge: (st: any) => 'done' | 'warn' | 'todo'; hint: (st: any) => string }> = {
  A: { target: 'ADMIN_TPL', targetLabel: '廠級成本範本(管理)', judge: (st) => (st.templates > 0 ? 'done' : 'todo'), hint: (st) => (st.templates > 0 ? `範本庫已建置(${st.templates} 套現行)` : '範本庫為空 → 先到管理頁匯入廠級標準') },
  B: { target: 'ADMIN_TPL', targetLabel: '廠級成本範本(管理)', judge: (st) => (st.templates > 0 ? 'done' : 'todo'), hint: () => '月度維護:管理頁匯入同名新版 = 自動版本化(舊版停用保留)' },
  C: { target: 'bom', targetLabel: 'BOM / 材料', judge: (st) => (st.cfs > 0 ? 'done' : 'todo'), hint: (st) => (st.cfs > 0 ? `本案已配 ${st.cfs} 個試算廠別` : '本案尚未建廠別 → BOM 區「＋廠別」或開案 Wizard') },
  D: { target: 'cleansheet', targetLabel: 'Cleansheet', judge: (st) => (st.cleansheetDone ? 'done' : st.cfs > 0 ? 'warn' : 'todo'), hint: (st) => (st.cleansheetDone ? '案級參數已齊(baseline 全綁)' : '到 Cleansheet Step 1~4 檢查/調參') },
  E: { target: 'cleansheet', targetLabel: 'Cleansheet · Compute', judge: (st) => (st.hasRun ? 'done' : 'todo'), hint: (st) => (st.hasRun ? '本案已有試算 run(可用 What-if 沙盒再試)' : '按 🔄 Compute 產生第一筆 run') },
  F: { target: 'cost', targetLabel: '成本核算 · 定版', judge: (st) => (st.approved ? 'done' : st.submitted ? 'warn' : 'todo'), hint: (st) => (st.approved ? '已有官方版(APPROVED)' : st.submitted ? '送審中,待核准' : '成本核算 → 選廠送審') },
  G: { target: 'cost', targetLabel: '成本核算 · 報價/議價', judge: (st) => (st.rounds > 0 ? 'done' : st.approved ? 'warn' : 'todo'), hint: (st) => (st.rounds > 0 ? `議價進行中(${st.rounds} 輪)· Margin 段看熱圖` : st.approved ? '可出報價單 PDF / 開始議價' : '先完成定版') },
}
const ST_BADGE: Record<string, { cls: string; label: string }> = {
  done: { cls: 'bg-green-100 text-green-700', label: '✓ 本案已完成' },
  warn: { cls: 'bg-amber-100 text-amber-700', label: '⏳ 進行中' },
  todo: { cls: 'bg-cortex-line text-cortex-muted', label: '· 未開始' },
}

export default function MvaWorkflowSection({ project }: { project?: ProjectDetail }) {
  const { token } = useAuth() as any
  const [st, setSt] = useState<any>({ templates: 0, cfs: 0, cleansheetDone: false, hasRun: false, submitted: 0, approved: 0, rounds: 0 })
  const [dbOpen, setDbOpen] = useState(false)
  useEffect(() => {
    if (!token || !project?.id) return
    api.get<any>(token, '/bom/provision/templates').then((r) => setSt((p: any) => ({ ...p, templates: (r.templates || []).length }))).catch(() => {})
    api.get<any>(token, `/bom/cases?projectId=${project.id}`).then((r) => setSt((p: any) => ({ ...p, cfs: (r.cases || []).length }))).catch(() => {})
    api.get<any>(token, `/bom/form?projectId=${project.id}`).then((r) => {
      const cm: any = {}; for (const c of r.completion || []) cm[c.key] = c
      setSt((p: any) => ({
        ...p,
        cleansheetDone: (cm.cleansheet?.total || 0) > 0 && cm.cleansheet.filled >= cm.cleansheet.total,
        hasRun: (cm.cost?.filled || 0) >= 1,
      }))
    }).catch(() => {})
    api.get<any>(token, `/bom/quote?projectId=${project.id}`).then((q) => {
      const vs = q?.versions || []
      setSt((p: any) => ({ ...p, submitted: vs.filter((v: any) => v.status === 'SUBMITTED').length, approved: vs.filter((v: any) => v.status === 'APPROVED').length }))
    }).catch(() => {})
    api.get<any>(token, `/bom/negotiation?projectId=${project.id}`).then((n) => setSt((p: any) => ({ ...p, rounds: (n?.rounds || []).length }))).catch(() => {})
  }, [token, project?.id])
  const goto = (target: string) => {
    if (target === 'ADMIN_TPL') { window.location.href = '/projects-platform/admin/factory-cost-templates'; return }
    window.dispatchEvent(new CustomEvent('cortex:goto-section', { detail: target }))
  }
  async function dlHandbook() {
    const res = await fetch('/api/projects/bom/mva-handbook', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { alert('手冊下載失敗'); return }
    const blob = await res.blob(); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'Cortex_MVA操作流程說明手冊_v4.pptx'; a.click(); URL.revokeObjectURL(url)
  }
  const [code, setCode] = useState('A')
  const ph = PHASES.find((p) => p.code === code)!
  const idx = PHASES.findIndex((p) => p.code === code)
  const prev = idx > 0 ? PHASES[idx - 1] : null
  const next = idx < PHASES.length - 1 ? PHASES[idx + 1] : null
  const phaseMins = ph.steps.reduce((a, s) => a + (typeof s.mins === 'number' ? s.mins : 0), 0)

  return (
    <div className="space-y-3">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink">🛠️ MVA 操作流程細部手冊 (Phase A → G)</h3>
          <p className="text-[11px] text-cortex-muted mt-0.5">
            {PHASES.length} Phase · {TOTAL_STEPS} 操作步驟 · {TOTAL_PREREQ} 個輸入素材 · 兩案差異對照(MOUSE_STD vs WHOOP_WEARABLE)
            <span className="ml-2 text-[8px] font-bold text-white px-1.5 py-0.5 rounded align-middle" style={{ background: 'linear-gradient(135deg,#7C3AED,#4C1D95)' }}>手冊</span>
            <span className="ml-1 text-[8px] font-bold bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded align-middle">spec cleansheet-mva-sd v0.3</span>
          </p>
        </div>
        <button onClick={dlHandbook} className="text-[11px] px-2.5 py-1.5 border border-cortex-teal text-cortex-teal rounded hover:bg-cortex-cyan-bg">📑 下載 PPTX 手冊(v4)</button>
      </div>

      {/* 兩案差異 banner(靜態總覽) */}
      <div className="grid md:grid-cols-2 gap-2.5">
        <div className="rounded-lg p-2.5" style={{ background: 'linear-gradient(135deg,#F0F9FF,#FFFFFF)', borderLeft: '4px solid #0EA5E9' }}>
          <div className="text-[11px] font-bold" style={{ color: '#0369A1' }}>🖱️ SteelSeries Rival 3+ Wired(本 demo)</div>
          <div className="text-[10px] text-cortex-ink leading-relaxed mt-0.5">
            MOUSE_STD 模板 · 1-BOM · 9 製程(SMT→Wave→Router→Laser→BB Assy→Test→Mat Mgmt→Q-SMT→Q-BB)<br />
            3 廠 × 2 variant × 2 qty × 2 pkg = <b>24 result cells</b> · 商包 16 + 工包 3 item
          </div>
        </div>
        <div className="rounded-lg p-2.5" style={{ background: 'linear-gradient(135deg,#FAF5FF,#FFFFFF)', borderLeft: '4px solid #9333EA' }}>
          <div className="text-[11px] font-bold" style={{ color: '#6B21A8' }}>⌚ WHOOP Gen4 MP(新案)</div>
          <div className="text-[10px] text-cortex-ink leading-relaxed mt-0.5">
            WHOOP_WEARABLE 模板 · <b>8 sub-BOM (bom_module)</b> · 模組化 SMT × N + Module Integration + Final Assembly + <b>FATP 7 stations</b><br />
            5 PKG SKU × 8 module 包含矩陣 = 40 點要勾 · result cells 多 2-3x
          </div>
        </div>
      </div>

      {/* phase tab bar */}
      <div className="flex gap-1.5 flex-wrap border-b-2 border-cortex-line pb-2.5">
        {PHASES.map((x) => {
          const active = x.code === code
          return (
            <button key={x.code} onClick={() => setCode(x.code)}
              className="flex flex-col items-center gap-0.5 rounded-lg transition-all"
              style={{
                minWidth: 100, padding: '8px 12px', fontSize: 12,
                background: active ? x.color : '#fff', color: active ? '#fff' : x.color,
                border: `2px solid ${x.color}`, boxShadow: active ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
              }}>
              <span style={{ fontSize: 18 }}>{x.icon}</span>
              <span style={{ fontSize: 11 }}>Phase {x.code}</span>
              <span style={{ fontSize: 10, opacity: 0.9 }}>{shortTitle(x.title)}</span>
              <span className="rounded-full" style={{ fontSize: 9, background: active ? 'rgba(255,255,255,0.25)' : `${x.color}20`, padding: '1px 6px', marginTop: 2 }}>{x.steps.length} 步</span>
            </button>
          )
        })}
      </div>

      {/* active phase header 卡 */}
      <div className="rounded-lg p-4" style={{ background: `linear-gradient(135deg,${ph.color}10 0%,#fff 60%)`, border: `1px solid ${ph.color}` }}>
        <div className="flex items-center gap-3">
          <div style={{ fontSize: 36 }}>{ph.icon}</div>
          <div className="flex-1">
            <div style={{ color: ph.color, fontWeight: 700, letterSpacing: 0.6, fontSize: 11 }}>PHASE {ph.code}</div>
            <div className="text-[17px] font-bold text-cortex-ink">{ph.title}</div>
            <div className="text-[11px] text-cortex-muted"><b>主負責:</b> {ph.main_owner} &nbsp;|&nbsp; <b>時程:</b> {ph.timing}</div>
          </div>
        </div>
        <div className="text-[12px] leading-relaxed bg-white rounded-md px-3 py-2 mt-2" style={{ borderLeft: `3px solid ${ph.color}` }}>{ph.summary}</div>
        {/* 本案實況(手冊 → 導引):此 Phase 在本專案做到哪 + 一鍵前往 */}
        {project && (() => {
          const link = PHASE_LINK[ph.code]
          if (!link) return null
          const judge = ST_BADGE[link.judge(st)]
          return (
            <div className="flex items-center gap-2 flex-wrap mt-2 bg-white rounded-md px-3 py-2 border border-dashed" style={{ borderColor: ph.color }}>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${judge.cls}`}>{judge.label}</span>
              <span className="text-[11px] text-cortex-ink">{link.hint(st)}</span>
              <button onClick={() => goto(link.target)}
                className="ml-auto text-[11px] px-2.5 py-1 rounded text-white hover:opacity-90" style={{ background: ph.color }}>
                前往 {link.targetLabel} →
              </button>
            </div>
          )
        })()}
      </div>

      {/* Panel ① 素材 */}
      <div className="bg-white border border-cortex-line rounded-lg p-3.5">
        <div className="flex items-center gap-2 border-b border-cortex-line pb-2 mb-2.5">
          <span>📋</span><b className="text-[13px] text-cortex-ink">① 需要準備的素材 (Prerequisites)</b>
          <span className="text-[10px] text-cortex-muted">{ph.prereq.length} 項 · 進此 Phase 前必須備齊</span>
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          {ph.prereq.map((pr, i) => {
            const k = KIND_STYLE[pr.kind] || KIND_STYLE.data
            return (
              <div key={i} className="flex gap-2 rounded-md p-2" style={{ background: `${k.bg}30`, borderLeft: `3px solid ${k.fg}` }}>
                <span className="shrink-0 self-start rounded whitespace-nowrap" style={{ background: k.bg, color: k.fg, fontSize: 9, fontWeight: 700, padding: '2px 6px', letterSpacing: 0.3 }}>{k.label}</span>
                <span>
                  <span className="block text-[12px] font-semibold text-cortex-ink">{pr.name}</span>
                  <span className="block text-[10px] text-cortex-muted leading-relaxed">{pr.detail}</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Panel ② 步驟 */}
      <div className="bg-white border border-cortex-line rounded-lg p-3.5">
        <div className="flex items-center gap-2 border-b border-cortex-line pb-2 mb-2.5">
          <span>🎯</span><b className="text-[13px] text-cortex-ink">② 操作步驟 (Step-by-step)</b>
          <span className="text-[10px] text-cortex-muted">{ph.steps.length} 步 · 依序執行 · 預估總計 {phaseMins} 分鐘</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {ph.steps.map((s, i) => (
            <div key={s.num} className="flex gap-2.5 rounded-md px-3 py-2" style={{ background: i % 2 === 0 ? '#FAFBFC' : '#fff', borderLeft: `3px solid ${ph.color}` }}>
              <span className="shrink-0 self-start text-center font-mono font-bold rounded" style={{ color: ph.color, fontSize: 12, minWidth: 32, background: `${ph.color}15`, padding: '3px 4px' }}>{s.num}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline gap-1.5 flex-wrap">
                  <b className="text-[12px] text-cortex-ink">{s.name}</b>
                  <span className="text-[9px] text-cortex-muted">·</span>
                  <span className="text-[10px] text-cortex-muted">{s.who}</span>
                  {typeof s.mins === 'number'
                    ? <span className="rounded" style={{ fontSize: 9, background: '#F3F4F6', color: '#374151', padding: '1px 5px' }}>{s.mins} min</span>
                    : <span className="rounded" style={{ fontSize: 9, background: '#FEF3C7', color: '#92400E', padding: '1px 5px' }}>{s.mins}</span>}
                </span>
                <span className="block text-[11px] text-cortex-ink leading-relaxed mt-0.5">{s.detail}</span>
                <span className="inline-block font-mono rounded mt-1" style={{ fontSize: 9, color: ph.color, background: `${ph.color}10`, padding: '2px 6px' }}>⚙ {s.sys}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Panel ③ 兩案差異 */}
      <div className="bg-white border border-cortex-line rounded-lg p-3.5">
        <div className="flex items-center gap-2 border-b border-cortex-line pb-2 mb-2.5">
          <span>🔬</span><b className="text-[13px] text-cortex-ink">③ 兩案差異對照</b>
          <span className="text-[10px] text-cortex-muted">MOUSE_STD vs WHOOP_WEARABLE · 此 Phase 的不同處</span>
        </div>
        <div className="grid md:grid-cols-2 gap-2.5">
          <div className="rounded-lg p-2.5" style={{ background: 'linear-gradient(135deg,#F0F9FF,#fff)', border: '1px solid #0EA5E9' }}>
            <div className="text-[11px] font-bold mb-1" style={{ color: '#0369A1' }}>🖱️ SteelSeries (MOUSE_STD)</div>
            <div className="text-[11px] text-cortex-ink leading-relaxed">{ph.delta_steelseries}</div>
          </div>
          <div className="rounded-lg p-2.5" style={{ background: 'linear-gradient(135deg,#FAF5FF,#fff)', border: '1px solid #9333EA' }}>
            <div className="text-[11px] font-bold mb-1" style={{ color: '#6B21A8' }}>⌚ WHOOP (WEARABLE)</div>
            <div className="text-[11px] text-cortex-ink leading-relaxed">{ph.delta_whoop}</div>
          </div>
        </div>
      </div>

      {/* Panel ④ DB 表(SD 設計對應 · 工程用 · 預設收起) */}
      <div className="bg-white border border-cortex-line rounded-lg p-3.5">
        <button onClick={() => setDbOpen(!dbOpen)} className="w-full flex items-center gap-2 text-left">
          <span>🗄️</span><b className="text-[13px] text-cortex-ink">④ 寫入 / 影響的 DB 表</b>
          <span className="text-[10px] text-cortex-muted">SD 設計對應(工程 / EPM 查表用)· {ph.schemas.length} 張 · 點開</span>
          <span className="ml-auto text-cortex-muted text-[11px]">{dbOpen ? '▲' : '▼'}</span>
        </button>
        {dbOpen && (
          <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-cortex-line">
            {ph.schemas.map((t) => (
              <span key={t} className="font-mono font-semibold rounded" style={{ fontSize: 11, background: `${ph.color}15`, color: ph.color, padding: '5px 10px', border: `1px solid ${ph.color}40` }}>{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* footer 導覽 */}
      <div className="flex items-center gap-2 pt-3 border-t border-cortex-line">
        {prev ? (
          <button onClick={() => setCode(prev.code)} className="text-[11px] px-2.5 py-1.5 border border-cortex-line rounded hover:bg-cortex-bg text-cortex-muted">
            ← Phase {prev.code}: {shortTitle(prev.title)}
          </button>
        ) : <div />}
        <div className="flex-1 text-center text-[11px] text-cortex-muted">Phase {code} / {PHASES.length} · {ph.steps.length} 步 · {ph.prereq.length} 個輸入</div>
        {next ? (
          <button onClick={() => setCode(next.code)} className="text-[11px] px-2.5 py-1.5 rounded text-white hover:opacity-90" style={{ background: ph.color }}>
            Phase {next.code}: {shortTitle(next.title)} →
          </button>
        ) : <div />}
      </div>
      <div className="text-[10px] text-cortex-muted">MVA 操作流程細部手冊 v1 · spec cleansheet-mva-sd v0.3 §3-§8 · 對應 SD §1.2 (vs BOM) · §4 (廠級) · §5 (案級) · §6 (計算) · §7 (compute) · §8 (propagate)</div>
    </div>
  )
}
