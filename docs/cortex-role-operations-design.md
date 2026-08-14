# Cortex 角色操作細部設計(WIP · 非 SD)

> **版本**:draft-0.1 / 2026-06-24
> **狀態**:細部設計討論中 — **依 user 指示「細部設計沒收斂完不寫 SD」,本文件是設計稿不是 SD**
> **目的**:把現在「開案 → 一個 project form → 14 section 單一 flow」翻成 **每個角色有獨立操作工作區 + 流程設計 + handoff**
> **來源**:`cortex-role-ops-design` workflow(11 agents · 816K tokens · 2026-06-24)· 10 角色平行設計 + 合成
> **角色拍板**(2026-06-24):採購併 PKG · Finance/CFO 砍歸業務 · 加 GM_BG + 董事長兩 oversight 層 · EPM 廠別=參數
> **關聯**:[cortex-unified-architecture-sd.md](cortex-unified-architecture-sd.md)(底層 superset schema 不動,本文件只換前台導覽)

---

## §0 核心轉變:單一 form → 角色工作區

| | 現在(v0.12) | 新方向 |
|---|---|---|
| 入口 | 進案 → 一個 project form → 翻 14 section | **登入 → 依角色 landing 到專屬工作區** |
| 操作單位 | section anchor scroll(成本/BOM/cleansheet… 全擠一頁) | **角色任務動詞頁**(各有獨立 step UI) |
| 完成語意 | 存檔某 section | **交棒**(stage 推進 + 通知下一角色) |
| 一張案 | 一個大 form | 同一案在不同角色工作台呈現**各自投影**(mask + field_grants) |
| 底層 | — | **superset schema + 計算引擎不動**,只換前台導覽包裝 |

**技術判斷**:登入 → `resolveUserScope(bg/bu)` + 取 `role/sub_role/admin_grant/VIEW_TRUE_COST` → router 依主角色決定 default landing。多角色 → workspace switcher(非 14 section tab)。

---

## §1 十個角色工作區

### Operational 作業軌(8 個 · 各自獨立 route landing)

| 角色 | 工作區 | route | 主畫面(獨立 menu) |
|---|---|---|---|
| **BPM** 業務專案經理 | 我的報價案工作台 | `/quote/cockpit` | 案卡牆+待我處理收件匣 · 開案 5 步精靈 · 案進度儀表(Stage swimlane)· 角色邀請配置 · Gate 控制台(跨案待簽)· 成本檢視(唯讀)· 報價 Console · 議價回合 · 結案歸檔 |
| **RD** 研發 | 我的 BOM 工作台 | `/rd/desk` | BOM Desk 首頁(指派案卡)· BOM 建置 4-step(上傳→AI 解析校對→ERP 料號確認→Variant Scope)· Module Board(WHOOP 8-module)· 提交給 Collect · Reprice 收件匣 |
| **採購** Buyer(含 PKG) | 採購工作台 | `/buyer/cockpit` | 卡片牆(待採/待Review/退回)· 採購策略工作台 · RFQ 報價錄入(雙價 tier grid)· ERP 歷史價查詢 · PKG 配置(商包工包 / 5SKU×8module)· 廠內料號維護 · 提交給 DPM |
| **EPM** 廠工程經理(廠別=參數) | EPM 製造工程工作台 | `/epm/desk` | 廠別切換器+baseline 健康卡 · 廠 Baseline 維護台(7 sub-tab SCD)· 月度上傳&Diff 審批 · 漲幅二簽 · 設備類別 Catalog · SMT 點數規則 · 案級 Cleansheet 填寫(FULL 細製程 / SIMPLIFIED macro+SMT)· Compute & 廠 Lock · Reprice 中心 |
| **DPM** 開發總監 | Cost Review 控制台 | `/dpm/review` | 收件匣(待 lock 案卡)· Cost Matrix 控制台(多維 pivot+margin heatmap+雙價 toggle)· BOM Lock Gate(propagate dry-run+執行)· Baseline 漲幅二簽 · Lock/Unlock Audit · 強制釋放編輯鎖 |
| **業務** Sales(兼 margin 稽核) | 報價工作台 | `/sales/quote-desk` | To-Quote/In-Negotiation/Margin Cockpit 三類待辦 · 報價案 3-tab(報價編輯 / Margin 稽核 / 議價時間軸)· 客戶報價單匯出(浮水印)· NRE 議價策略板 · 成交流標歸檔 |
| **採購主管** | 採購審核台 | `/proc/approval` | 跨案待核佇列(SLA+金額影響排序)· 採購策略審核(試算)· Price Tier 核可 · 跨案 Supplier 比價 Benchmark · Markup 治理 · 核可歷史 |
| **admin/IT** | 設定 Master 控制台 | `/admin/cost-master` | 平台健康儀表 · 廠 Baseline · 設備類別 Catalog(跨 BG copy)· 類別單價 · 工資 Master(DL+IDL Line-Dep 4+Centralized 17)· 耗材 · SMT 點數規則 · Costing Model×Template×component mask · 權限 Grant+BG/BU 主檔+使用者同步 |

### Oversight 唯讀軌(2 個 · portfolio)

| 角色 | 工作區 | route | scope |
|---|---|---|---|
| **GM_BG** 總經理/BG 高層 | BG Portfolio 戰情中心 | `/portfolio` | 該 BG 所有 BU · 唯讀 · 通常持 VIEW_TRUE_COST(看 margin/雙價) |
| **董事長** 集團最高 | 集團 Portfolio 戰情儀表板 | `/cortex/chairman` | 全 BG/BU 不過濾 · true cost 恆開 · 機密穿透 · 唯讀 |

> oversight = 純消費端,讀 fact table 被動聚合,**不交棒、不推進 stage、不回寫**。治理介入只走線下/訊息催 DPM(lock)/業務(議價)。

---

## §2 端到端 Handoff 鏈

```
[起點] 業務發 RFQ 需求(客戶/產品/年量/截止) → 交 BPM(成 owner)
   ↓
[BPM 開案] 5 步 wizard → projects(ACTIVE · costing_model 綁 template)+ project_stages + case_factory/qty/pkg
   ↓ 邀 RD + 指派 Stage4 + field_grants
[Stage4 RD] BOM Desk 4-step(上傳→解析→料號→variant)→ 提交 → READY_FOR_GATE
   ↓ BPM Gate 簽核放行
[Stage5 並行 Collect]
   ├─ 採購線:策略+mfg+ERP 歷史價+RFQ tier(雙價)+選定+PKG → 採購主管核可 gate
   └─ EPM 線:baseline snapshot+cleansheet(FULL/SIMPLIFIED)+Compute → cs_run + 廠 Lock
   ↓ 兩線 READY → BPM Gate 簽核
[Stage6 DPM] Cost Review + margin heatmap + baseline 二簽 → BOM Lock Gate(propagate dry-run)→ final lock(UPSERT bom_cs_run_result + cache pfm_cell)
   ↓ 交業務:凍結的雙價成本矩陣 fact
[Stage7 業務] Quote Desk 看雙價+Margin 稽核 → 選報價組合+NRE → 客戶報價 Excel(只含 quote+浮水印)+ Submit
   ↓
[reprice 回圈 A·只動 quote] 議價在 margin 容忍內 → 業務降 markup/換廠/砍 NRE,同 run,重產 Excel
[reprice 回圈 B·要動成本] 破底線 → 退回 Stage5(舊 run archived)→ 採購重議+EPM 重 compute+DPM 重 lock → 回 Stage7
   ↓
[Stage8 結案] 業務標 WIN/LOSS/HOLD → BPM 最終 gate → CLOSED_* → 觸發脫敏歸檔 hook

[oversight 旁路] DPM lock+propagate 後,margin/金額即時聚合進 GM/CHAIRMAN(唯讀 · dead-end)
[admin 旁路] 不在 Stage 鏈上 · 月度節奏交付「可信 master + 正確權限」給所有作業角色
```

---

## §3 共用基礎(shared infra · 跨角色)

1. **BG/BU 隔離** — `resolveUserScope` 過濾每個工作台的卡片/佇列/比價樣本;跨 BG 機密 cell + customer alias 遮罩;admin/HQ/CHAIRMAN 穿透。
2. **權限三層** — `bom_settings_admin_grant`(user×scope×bg/bu/factory×view/edit/approve)+ `ai_data_policy_rules`(VIEW_TRUE_COST 名單 → true_cost/mva/margin 打 ▒)+ `project_members.field_grants`(BPM 邀案設機密欄可見)。
3. **stage 引擎 + gate** — `workflow_templates`(QUOTE 8 階段)→ 開案 copy `project_stages`;**BPM 是 gate 唯一確認人**(角色完成 task 不能自跳 stage);待辦由 `current_stage_id + assignee + status` query。
4. **audit** — `bom_audit_log`(instance_created/excel_imported/final_locked/PROPAGATE/BASELINE_UPDATED…)+ quote audit(EXPORT/VIEW_COST/SUBMIT/CLOSE/REDACT,append-only+浮水印)。
5. **通知** — `user_notifications` 統一鈴鐺:handoff / baseline 升版 reprice chip / reprice request / DPM lock → 業務。
6. **single-edit lock + heartbeat** — per instance/case_factory 一人編輯,5min heartbeat,DPM/admin 可強制踢。
7. **costing_model + superset 引擎** — 一張 superset form-schema + 一條引擎,FULL/SIMPLIFIED 差異全由 `costing_model` + 20-component mask + field `enabled_when` 控制;**各角色工作區只是這份 superset 的前台任務化包裝層,底層不動**。
8. **fact 收斂** — `bom_cs_run_result`(對外唯一 fact)+ `pfm_cell`(propagate cache)為所有下游(業務報價/GM margin/CHAIRMAN 彙總)唯一消費源。

---

## §4 vs 現有 form(14 section 拆到哪個工作區)

| 現 section / render | 拆到 |
|---|---|
| inquiry / 基本資料 | → BPM 開案 5 步 wizard |
| bom(統一 6 層 · 含 whoop_modules 8-module) | → RD BOM Desk 4-step + Module Board;採購在 Buyer Cockpit 寫 mfg/snapshot/tier |
| packaging(含 whoop_sku) | → 採購 PKG 配置工作台(商包工包 / 5SKU×8module 矩陣) |
| process_mva(含 whoop_process macro) | → EPM 案級 Cleansheet 填寫台(FULL 細製程 / SIMPLIFIED macro+SMT) |
| cost_structure(含 whoop_cost) | → EPM Compute 結果拆解 + DPM review |
| cost_matrix(三合一:factory_matrix+margin+whoop_summary) | → DPM Cost Matrix 控制台 + 業務 Margin 稽核(唯讀)+ GM/CHAIRMAN drill |
| strategy / NRE | → 業務 NRE 議價策略板 + 採購策略審核 |
| gate / 簽核 | → BPM Gate 控制台 + DPM Lock Gate + 業務 Quote Console |
| baseline/設備/工資/耗材/SMT/mask master | → admin 設定 Master 9 子模組 + EPM 廠 Baseline 維護台 |

> 核心:section anchor → 角色任務動詞頁;維度退化(FULL/SIMPLIFIED)仍由資料/mask 控制,不是函數 branch。

---

## §5 表:砍 / 保留 / 新增

### 可砍重做(僅本 BOM/MVA/報價專案)
- `quote_negotiation_round` / `quote_export_log` / `quote_audit_log` — 業務工作區新表,可重做對齊 `bom_audit_log`
- `data_payload.factory_matrix` JSON 中繼 — 退役(pfm_cell 唯一終點)
- 舊 `STEELSERIES_FM` 2 維 / `DEFAULT_FM` / `bom_factory_dl_role` 死表 — 移除
- 5 個 `renderFormWhoop*` + `STEELSERIES_*` vs `DEFAULT_*` 雙 const — 收斂進 superset render

### 保留不動(只加導覽包裝)
- BOM 主鏈 `bom_instance/section/category/item/flk/mfg/price_snapshot/price_tier`
- cleansheet `bom_cs_case_factory/process/idl_alloc/equip_category/consumable/macro_process/smt_point`
- 計算+fact `bom_cs_run/run_cell/run_result` · `pfm_cell/pfm_factory/pfm_pkg_option`
- master SCD `bom_factory_baseline/idl_role/idl_linedep_wage/dep_years/equip_category_catalog/equip_category_price/consumable/smt_point_rule`
- 權限 `bom_settings_admin_grant/ai_data_policy_rules` · 流程 `projects/project_stages/project_members/workflow_templates` · `bom_audit_log`

### 需新增欄(非砍)
- `bom_instance` 加 `rd_submitted_at/by`(Stage4→5)+ `procurement_gate_status/approved_by/at`(採購主管核可,現缺)
- `project_stages` 表達 reprice 回退狀態機
- `bom_audit_log` event enum 補 `strategy_approved/rejected`

---

## §6 角色間衝突/缺口(設計要收斂)

1. **Stage5 採購 vs EPM 並行寫同案** — 採購寫 instance、EPM 寫 case_factory,理論分表但 single-edit lock 是 per-instance 還 per-case_factory 要定。
2. **「選定」三處重複** — `bom_item.preferred_mfg_id` + `bom_item_mfg.is_preferred` + `price_tier.is_chosen`,source of truth?採購選 vs 採購主管核可後誰落定?
3. **二簽/核可 gate 重疊** — EPM baseline 二簽 vs DPM baseline 二簽 vs 採購主管策略核可,三個都碰 approve,二簽人固定還輪簽?門檻(±5%)誰定?
4. **lock 三層** — RD 提交 vs EPM 廠 Lock vs DPM final lock+propagate,BPM Stage6 gate=確認 DPM 已 lock 還獨立 gate?
5. **VIEW_TRUE_COST** — 業務兼 Finance 是否同登入身分?初階業務沒此權限,Margin tab 拆 role 還隱藏?GM_BG 是否預設進名單?
6. **reprice 回退顆粒度** — 退到採購/EPM/RD?tier-level vs item-level vs 整 instance?業務 reprice vs DPM 退件要統一一條流。
7. **跨 BG 報價案** — BPM/業務單 BG 能否監控含他 BG 機密 cell 的整案?採購主管跨案比價需跨 BG 但 VIEW_TRUE_COST 受限。
8. **admin VIEW_TRUE_COST 名單** vs Cortex 既有「資料權限管理」後台 — 可能重複管同一份政策,要單一 source of truth。

---

## §7 待 user 拍板(收斂關鍵 · 逐一)

| # | 決策 | 選項 |
|---|---|---|
| D1 | **Stage 編號** | QUOTE 是 8 階段還 4-7?BPM 最終 gate 落 Stage7 還 8?與 workflow_template seed 對齊 |
| D2 | **reprice 回退狀態機** | 退 Stage5 是「新 stage 實例」還「Stage5 改回 ACTIVE」?避免 gate 歷史被覆蓋 |
| D3 | **field_grants 預設** | BPM 邀各角色時機密欄(quote/margin)預設 deny 還依角色 template? |
| D4 | **module 層 DDL** | WHOOP 8 子組件新建 `bom_module` 表還復用 `bom_section`?(unified-arch 提 6 層 · bom-collection v0.4 是 5 層)含客供料 vendor_consigned/consigned_pn/is_customer_specified |
| D5 | **RD 提交 / 採購核可狀態欄** | 補 `rd_submitted_*` / `procurement_gate_*` 欄還純靠 current_stage 推? |
| D6 | **ERP 歷史價** | MIN/AVG/MAX 拉回直接當 true_cost 預填還只當參考(一律手填供應商實報)? |
| D7 | **margin 口徑** | 加權 gross_margin% 權重=amount/qty/最佳廠 cell?FULL vs SIMPLIFIED 兩 model margin 可比性先對齊(GM/CHAIRMAN 都需要) |
| D8 | **RFQ Excel 格式** | SIMPLIFIED(5SKU)pivot vs FULL(廠×variant)版面差很大 → 同一 export 引擎讀 mask 出不同版面(守 superset)還兩套 template? |
| D9 | **oversight 兩層** | CHAIRMAN 複用 `/portfolio`+scope toggle 還另開全公司頁?Attention 門檻(margin<X/金額>Y/停留>Z)硬編還 admin 可調? |
| D10 | **VIEW_TRUE_COST 名單** | admin 設定頁 vs Cortex 既有「資料權限管理」單一 source of truth?業務兼 Finance 同身分? |
| D11 | **結案脫敏 approve** | human-in-loop(PM+業務主管+法務)落業務工作區(自報自審)還另開審核 menu? |

---

## §8 決議(2026-06-24 · user「全部依照建議」)

### §7 D1-D11 全採建議定案

| # | 決議 |
|---|---|
| D1 | QUOTE = **8 stage**(1-3 前置立案/詢價 · 4 BOM · 5 並行 Collect · 6 Cost Review · 7 報價 Gate · 8 結案)· BPM 最終 gate 落 **Stage 8** · 對齊 `workflow_template QUOTE_STANDARD` seed |
| D2 | reprice 退回 = **開新 stage iteration(round_no++)**,舊 iteration 標 superseded,**不覆蓋舊 gate record** · 一 reprice round 對一 archived `cs_run` |
| D3 | `field_grants` **依角色 template 預設**(RD/EPM 看製造成本不看 quote margin · 採購看 true cost 不看別人 markup · 業務看 quote+margin · DPM 全看)· 可逐案 override |
| D4 | **新建 `bom_module` 表**(WHOOP multi-sub-BOM)· `cat=EE/ME` → 預設 `shared/per_variant` · 含 `vendor_consigned/consigned_pn/is_customer_specified` 客供料欄 |
| D5 | **補欄**:`bom_instance.rd_submitted_at/by` + `procurement_gate_status/approved_by/at` · `bom_audit_log` event 補 `strategy_approved/rejected` |
| D6 | ERP 歷史價 **只當參考預填 + 標來源**,採購可改 · `true_cost` 以供應商實報為準(ERP 是 anchor 不是 truth) |
| D7 | margin 統一 **`(quote-true)/quote` · amount 加權** · FULL/SIMPLIFIED 同口徑(GM/董事長彙總可比) |
| D8 | RFQ Excel = **同一 export 引擎讀 mask 出兩版面**(FULL 廠×variant · SIMPLIFIED 5SKU pivot)· 守 superset · 不兩套 template |
| D9 | CHAIRMAN **複用 `/portfolio` + GLOBAL scope toggle** · Attention 門檻(margin<X/金額>Y/停留>Z)**admin 可調 `system_settings`** 不硬編 |
| D10 | VIEW_TRUE_COST **單一 source = 既有 `ai_data_policy_rules`/資料權限管理** · admin 設定頁只是該政策的 view 不另存 · 業務兼 Finance 同登入身分,Margin tab 由權限 gate |
| D11 | 結案脫敏 approve = **另開審核 menu**(PM+業務主管+法務)· 避免業務自報自審 |

### §6 衝突全解(採建議)

| # | 解法 |
|---|---|
| 1 | Stage5 並行寫:**per-instance 鎖**(採購寫 `bom_instance`)+ **per-case_factory 鎖**(EPM 寫 `bom_cs_case_factory`)分表分鎖,不衝突 |
| 2 | 「選定」source of truth = **`bom_item_price_tier.is_chosen`** · `preferred_mfg_id`/`is_preferred` 為衍生 UI 標記 · 採購選 → 採購主管核可後落定 |
| 3 | 二簽:**baseline 漲幅二簽=DPM** · **採購策略核可=採購主管** · EPM 只發起不二簽 · 門檻 `admin system_settings` per costing_model |
| 4 | lock 三層:**RD 提交 < EPM 廠 Lock < DPM final lock+propagate** · BPM Stage6 gate = 確認 DPM 已 lock(非獨立 gate)· final lock **限 DPM** |
| 5 | VIEW_TRUE_COST:業務兼 Finance **同登入身分**,Margin tab 由權限 gate(初階業務沒權限隱藏)· **GM_BG 預設進名單**(director 級) |
| 6 | reprice 顆粒度:**instance-level 回退 + client_target context** · 業務 reprice 與 DPM 退件**統一一條 reprice 流** |
| 7 | 跨 BG 案:單 BG 角色**不看他 BG 機密** · 跨 BG 案綁主 BG 或 HQ/admin 接手 owner · 採購主管跨案比價給**去識別化單價分布**(不露具體案/客戶) |
| 8 | VIEW_TRUE_COST 名單 = 既有資料權限管理單一源(同 D10) |

## §9 下一步

1. ✅ 細部設計(§6 衝突 + §7 D1-D11)**已收斂** → 寫正式 SD
2. 正式 SD:[cortex-role-workspace-sd.md](cortex-role-workspace-sd.md)(role-workspace 架構 + 10 角色操作 + DDL)
3. SD 定案 → demo 重做成角色工作區制(取代 v0.12 單一 form)
