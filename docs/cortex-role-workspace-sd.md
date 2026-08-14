# Cortex Role-Workspace 架構 SD — 角色工作區制(取代單一 form)

> **版本**:v1.0 / 2026-06-24
> **狀態**:Solution Design(細部設計已收斂 · 可實作)
> **原則**:單一 superset schema + 計算引擎不動,前台從「一個 project form 14 section」翻成「**每角色獨立操作工作區 + 流程 + handoff**」
> **決議依據**:[cortex-role-operations-design.md](cortex-role-operations-design.md) §8(D1-D11 + §6 衝突全解 · user 2026-06-24「全部依照建議」)
> **底層依據**:[cortex-unified-architecture-sd.md](cortex-unified-architecture-sd.md)(superset section/欄位/component mask)· [bom-collection-sd.md](bom-collection-sd.md) · [cleansheet-mva-sd.md](cleansheet-mva-sd.md) v0.5
> **角色**:8 operational + 2 oversight(採購併 PKG · Finance 歸業務 · EPM 廠別=參數 · 加 GM_BG/董事長)

---

## §1 導覽 / 路由模型(取代單一 form)

### 1.1 登入分流

```
登入 → resolveUserScope(bg_code/bu_code)
     → 取 role + sub_role + bom_settings_admin_grant + VIEW_TRUE_COST(ai_data_policy_rules)
     → router 依「主角色」決定 default landing route:
```

| 角色 | route | landing |
|---|---|---|
| BPM | `/quote/cockpit` | 我的報價案工作台(案卡牆 + 待我處理收件匣) |
| RD | `/rd/desk` | 我的 BOM 工作台(指派案卡 + 4-step 進度) |
| 採購(含 PKG) | `/buyer/cockpit` | 採購工作台(待採/待Review/退回 三桶 + KPI) |
| EPM | `/epm/desk` | EPM 製造工程工作台(廠別切換 + baseline 健康 + 待辦案) |
| DPM | `/dpm/review` | Cost Review 控制台(待 lock 收件匣) |
| 業務(兼 Finance) | `/sales/quote-desk` | 報價工作台(To-Quote/In-Negotiation/Margin Cockpit) |
| 採購主管 | `/proc/approval` | 採購審核台(跨案待核佇列 + 比價警示) |
| admin/IT | `/admin/cost-master` | 設定 Master 控制台(9 子模組) |
| GM_BG | `/portfolio` | BG Portfolio 戰情中心(該 BG 跨案唯讀) |
| 董事長 | `/portfolio?scope=GLOBAL` | 集團 Portfolio(全 BG · 複用 portfolio + GLOBAL toggle · D9) |

### 1.2 多角色 / 工作區切換

同一 user 多角色 → **workspace switcher**(頂部下拉切 route),非 14 section tab。

### 1.3 操作單位

每工作區單位 = **卡片 / 收件匣 + 角色任務動詞頁**(各有獨立 step UI),不是 section anchor。
完成語意 = **交棒**(stage 推進 + 通知下一角色),不是「存某 section」。
同一案在不同角色工作台 = 同一份資料的**各自投影**(`costing_model` mask + `field_grants` + VIEW_TRUE_COST)。

---

## §2 Stage 引擎 + Handoff + Gate

### 2.1 QUOTE 8 stage(D1)

```
Stage 1-3  前置立案 / 詢價(業務發 RFQ → BPM 開案)
Stage 4    BOM 提供          owner=RD       gate→BPM
Stage 5    並行 Collect       owner=採購 ∥ EPM  gate→BPM(採購策略另過採購主管核可)
Stage 6    BOM Cost Review    owner=DPM      gate=DPM lock(BPM 確認)
Stage 7    報價 Gate          owner=業務      gate→BPM
Stage 8    結案              owner=業務      最終 gate→BPM
```

- `workflow_templates`(QUOTE_STANDARD · SYSTEM scope)→ 開案 copy `project_stages`(status PENDING/ACTIVE/READY_FOR_GATE/DONE)
- **BPM 是 gate 唯一確認人**:角色完成 task 推到 READY_FOR_GATE,BPM 決定放行(角色不能自跳 stage)
- 各工作台待辦 = `current_stage_id + assignee + status` query

### 2.2 端到端 handoff

```
業務 RFQ → BPM 開案(8 stage copy · costing_model 綁 template)
  ↓ 邀 RD + field_grants(D3 角色 template 預設)
Stage4 RD → BOM Desk 4-step → rd_submitted(D5)→ BPM gate
  ↓
Stage5 [採購 ∥ EPM]
  ├ 採購:策略+mfg+ERP 歷史價(D6 參考)+RFQ tier(雙價)+is_chosen(D2 衝突2)+PKG → 採購主管核可(procurement_gate D5)
  └ EPM:baseline snapshot+cleansheet(FULL/SIMPLIFIED)+compute → 廠 Lock(per case_factory · 衝突1)
  ↓ 兩線 READY → BPM gate
Stage6 DPM → Cost Matrix review + margin + baseline 二簽 → BOM Lock Gate(propagate dry-run)→ final lock(限 DPM · 衝突4)
  ↓ 寫 bom_cs_run_result(唯一 fact)+ cache pfm_cell
Stage7 業務 → 雙價矩陣 + Margin 稽核(VIEW_TRUE_COST)→ 選組合+NRE → RFQ Excel(D8 同引擎讀 mask)+ Submit
  ↓
[reprice A·只動 quote] margin 容忍內 → 業務降 markup/換廠/砍 NRE · 同 run
[reprice B·要動成本] 破底線 → 開新 stage iteration(D2)退 Stage5 · 舊 run archived · 帶 client_target(衝突6)
  → 採購重議 + EPM 重 compute + DPM 重 lock → 回 Stage7
Stage8 結案 → 業務標 WIN/LOSS/HOLD → 脫敏 approve(另開審核 menu · D11)→ CLOSED_*

[oversight 旁路] DPM lock+propagate 後 margin/金額即時聚合進 GM/CHAIRMAN(唯讀 dead-end)
[admin 旁路] 月度交付 master(baseline/類別/wage/權限)· 不在 stage 鏈
```

---

## §3 十角色工作區規格

> 每角色:route · landing · menu · flow 摘要 · 資料 · 權限 · handoff。完整 step 見 [cortex-role-operations-design.md](cortex-role-operations-design.md) + workflow 輸出。

### 3.1 BPM 業務專案經理 · `/quote/cockpit`

- **landing**:案卡牆(案名/客戶/costing_model/Stage 進度/SLA 燈/卡關角色 chip)+「待我處理」收件匣(READY_FOR_GATE 待簽 / reprice 退回 / 逾時)
- **menu**:Cockpit 首頁 · 開案 5 步精靈 · 案進度儀表(Stage swimlane)· 角色邀請配置 · Gate 控制台(跨案待簽)· 成本檢視(唯讀)· Stage7-8 Quote Console · 議價回合 · 結案歸檔
- **flow**:開案精靈 5 步(基本資料→costing_model/template→qty_scenarios→pkg_versions→廠別+變體)→ 邀角色+field_grants → 監控各 Stage swimlane → 逐 gate 簽核放行 → Stage7 報價 → Stage8 結案
- **data**:`projects`(owner=pm_user_id · costing_model · status · current_stage_id)· `project_members`(邀+sub_role+field_grants)· `project_stages`(gate_confirmed_by=BPM)· `workflow_templates` · `bom_cs_case_factory/qty_scenario/pkg` · `bom_cs_run_result`/`pfm_cell`(唯讀+匯出源)· `bom_audit_log`
- **權限**:整案 owner · gate 唯一確認人 · 成本唯讀(VIEW_TRUE_COST 才看 true)· 不直接編成本
- **handoff**:接業務 RFQ → 開案 → 每 gate 放行給下一角色 → Stage8 結案

### 3.2 RD 研發 · `/rd/desk`(Stage 4)

- **landing**:指派案卡 + 4-step 進度;不進 14-section form
- **menu**:BOM Desk 首頁 · BOM 建置 4-step(上傳 Excel→AI 解析校對→ERP 料號確認→Variant Scope)· Module Board(WHOOP 8-module)· 提交給 Collect · Reprice 收件匣
- **flow**:S1 建 instance → S2 上傳 Excel(AI 解析抽子料)→ S3 階層校對(parse 紅旗歸零)→ S4 逐筆 ERP 料號確認(採用/略過/手動 · `bom_item_flk` source=AI_RECOMMEND/ERP_LOOKUP/RD_MANUAL)→ S5 標 variant scope(EE shared / ME per_variant · cat 自動預設 D4)→ S6 WHOOP 逐 module 重複 → S7 自評 checklist + **rd_submitted**(D5)交棒
- **data**:`bom_instance`(DRAFT · variant_scope · single-edit lock · **rd_submitted_at/by**)· `bom_module`(D4 新 · WHOOP 8 / SteelSeries 1 隱性 · cat EE/ME · vendor_consigned/consigned_pn/is_customer_specified)· `bom_section/category/item/item_flk/item_mfg` · `bom_erp_item_index` · `bom_ai_cache` · `bom_audit_log`
- **權限**:R · 改自己 owner 的 DRAFT instance · ERP 反查受 L4 ORG 過濾 · **不渲染雙價欄**(RD 不看 cost) · DPM final_lock 後唯讀
- **handoff**:接 BPM 開案 → 交採購+EPM(結構完整 instance + final_flk + variant + 8-module · 仍 DRAFT)

### 3.3 採購 Buyer(含 PKG)· `/buyer/cockpit`(Stage 5)

- **landing**:跨案待採卡片牆(待採/待Review/退回 三桶)+ KPI(待報價子料 / markup 異常 / ERP 未拉)
- **menu**:Cockpit · 採購策略工作台(子料矩陣)· RFQ 報價錄入(雙價 tier grid)· ERP 歷史價查詢(獨立探價)· PKG 配置工作台 · 廠內料號維護 · Markup 檢視 · 提交給 DPM · Reprice Queue
- **flow**:認領 BOM → 設策略+套 category markup → 加 mfg(可多家)→ 批次拉 ERP 歷史價(**D6 只當參考預填可改**)→ 開 RFQ snapshot → 填 N 個 price tier(qty_min/max + true_cost + quote · markup VIRTUAL)→ 比價選定(**`is_chosen` 為 source of truth · D2 衝突2**)→ PKG 配置(商包/工包 · WHOOP 5SKU×8module 矩陣)→ 掛廠內料號(`foxlink_part_no`)→ Markup 自檢 → 缺口檢核提交
- **data**:`bom_item_mfg/price_snapshot/price_tier`(true/quote/is_chosen)· `bom_category_markup_default` · `bom_cs_case_pkg/pkg_item/pkg_module_include`(WHOOP 矩陣)· `foxlink_part_no`(料號兩案都補)· `bom_audit_log`
- **權限**:採購持 VIEW_TRUE_COST(true_cost/markup 可見可改 = 核心欄)· per-instance 鎖(衝突1)· DPM lock 後唯讀
- **handoff**:接 RD BOM → 採購主管核可策略 → 交 DPM(每子料選定 tier + PKG 定版 + 料號齊)

### 3.4 EPM 廠製造工程經理(廠別=參數)· `/epm/desk`(Stage 5)

- **landing**:廠別切換器(CN/VN/TW · 只看 grant 的廠)+ baseline 健康卡(月度燈號)+ 待辦案(dirty/待reprice/待compute)
- **menu(雙動線)**:
  - **廠級**:Baseline 維護台(7 sub-tab SCD)· 月度上傳&Diff 審批 · 漲幅二簽佇列 · 設備類別 Catalog&單價 · SMT 點數規則(SIMPLIFIED)
  - **案級**:Cleansheet 填寫台 · Compute & 廠 Lock · Reprice 中心 · 我廠成本矩陣(唯讀)
- **flow A(廠 baseline 月維)**:看健康 → 上傳新月 xlsx → 逐項 Diff approve/reject → 漲幅二簽(**DPM 核 · 衝突3**)→ SCD 切版 → notify 受影響 draft 案
- **flow B(案級成本)**:接案 → 選 template → **FULL**:§A 55 行細製程 + IDL matrix(17×製程)+ 設備類別 binding + 耗材 / **SIMPLIFIED**:macro header(stations/work_time/dl/uph/yield)+ SMT 點數(算式字串可案級 override)+ 材料耗損率 → Compute(superset 引擎讀 mask)→ 檢視拆解 → **廠 Lock**(per case_factory · 衝突1/4)
- **data**:`bom_factory_baseline/idl_role/idl_linedep_wage/dep_years/equip_category_catalog/equip_category_price/consumable/smt_point_rule` · `bom_cs_case_process/idl_alloc/equip_category/consumable/macro_process/smt_point` · `bom_cs_run/run_cell/run_result` · `bom_cs_baseline_diff`
- **權限**:廠別=grant 參數 · VIEW_TRUE_COST(製造成本)· 不碰材料價(採購的)· per case_factory 鎖
- **handoff**:接採購材料價 → compute+lock → 交 DPM(每廠 frozen baseline 算出可追溯 cs_run)

### 3.5 DPM 開發總監 · `/dpm/review`(Stage 6)

- **landing**:Cost Review 收件匣(待 lock 案卡 · costing_model/BG/margin 燈/二簽 badge/collect%)+ 二簽待辦 + 最近 lock 紀錄
- **menu**:收件匣 · Cost Matrix 控制台(多維 pivot+margin heatmap+雙價 toggle+review flag)· BOM Lock Gate(propagate dry-run)· Baseline 漲幅二簽 · Margin Heatmap 跨案 · Lock/Unlock Audit · 強制釋放編輯鎖
- **flow**:接案 → 開 Cost Review(凍 snapshot · 通知 EPM/採購/業務)→ review 多維矩陣(廠×variant×qty×pkg · cs_run_cell 展開看公式)→ Margin Heatmap(揪異常 · 退件回 Stage5)→ baseline 二簽(diff approve)→ 收斂 flag → Lock Gate(dry-run 預覽 24 列 delta)→ **Final Lock**(transaction UPSERT `bom_cs_run_result` + cache `pfm_cell` · 失敗 rollback · 限 DPM · 衝突4)→ 交業務
- **data**:`bom_cs_run_result`(★propagate 終點 · 對外唯一 fact)· `bom_cs_run/run_cell` · `pfm_cell/pfm_factory/pfm_pkg_option` · `bom_factory_baseline`(approve)· `bom_audit_log`(review_opened/review_flag/final_locked/BOM_PROPAGATE/BASELINE_UPDATED)
- **權限**:VIEW_TRUE_COST 預設有 · cost 內容唯讀(不編 cell)· 專屬寫:final_lock + baseline approve(grant scope=approve)+ review flag + force-release · unlock 需 admin
- **handoff**:接採購+EPM(compute 完)→ lock → 交業務(凍結雙價 fact)· baseline 二簽 → 受影響案 EPM reprice

### 3.6 業務 Sales(兼 Finance margin 稽核)· `/sales/quote-desk`(Stage 7-8)

- **landing**:報價工作台(To-Quote / In-Negotiation / Margin Cockpit 三類待辦)+ KPI(加權 gross_margin · VIEW_TRUE_COST 才顯)
- **menu**:My Quotes 首頁 · To-Quote · 議價循環 In-Negotiation · **Margin 稽核台(VIEW_TRUE_COST gate · 無權限整個隱藏)** · 客戶報價單匯出(浮水印)· NRE/策略板(FULL only)· 成交流標歸檔 · 報價設定/匯率基準
- **flow**:接 DPM lock 案 → 看鎖版雙價矩陣 → **Margin 稽核(Finance 帽 · `(quote-true)/quote` amount 加權 · D7)** → 選報價組合(廠/variant/qty/pkg)+ 訂條件 + NRE → 產 RFQ Excel(**只含 quote + 浮水印 · D8 同引擎讀 mask 出 FULL/SIMPLIFIED 兩版面**)+ Submit → 客戶議價開 round → **路徑A** 只動 quote(同 run)/ **路徑B** 要動成本按 Reprice(**開新 stage iteration 退 Stage5 · 舊 run archived · 帶 client_target · D2/衝突6**)→ 成交流標標 WIN/LOSS/HOLD → **脫敏 approve(另開審核 menu · D11)**
- **data**:`bom_cs_run_result`(讀 · 雙價 fact)· `bom_cs_run`(archived/run_label)· `quote_negotiation_round`(新表 · round/client_target/floor_margin/status)· `quote_export_log/quote_audit_log` · `ai_data_policy_rules`(VIEW_TRUE_COST)· `bom_cs_case_nre`(FULL)
- **權限**:VIEW_TRUE_COST(兼 Finance 才有 · 同登入身分 · 衝突5)→ Margin 稽核解鎖 · markup_pct/gross_margin = 🔒🔒(每 access 寫 audit)· 客戶 Excel 強制只含 quote(🟢)· reprice/submit/close 限 sales/pm/admin
- **handoff**:接 DPM lock → 報價/議價 → 路徑B reprice 退採購/EPM/DPM → 成交交脫敏 + GM 儀表板

### 3.7 採購主管 · `/proc/approval`

- **landing**:審核台首頁(待核佇列 SLA+金額排序)+ 比價警示(同料跨案價差/supplier 集中/markup 離群)
- **menu**:My Approval Desk · 採購策略審核(preview-strategy 試算)· Price Tier 核可(逐項 approve/reject)· 跨案 Supplier 比價 Benchmark · Markup 預設治理(`bom_category_markup_default`)· 比價警示 · 核可歷史
- **flow**:挑案 → 審策略(MIN/AVG/MAX · period · org · preview delta)→ 逐項審 price tier markup(離群標紅)→ approve/reject/退補件(**`procurement_gate_status` · D5**)→ 跨案 benchmark(去識別化跨 BG 單價分布 · 衝突7)
- **data**:`bom_item_price_tier/snapshot`(讀+核可)· `bom_category_markup_default`(寫)· `bom_audit_log`(strategy_approved/rejected · D5)· `bom_instance.procurement_gate_status`
- **權限**:VIEW_TRUE_COST(看 true/markup)· 採購策略核可 gate(衝突3)· 跨案唯讀 benchmark · 跨 BG 只去識別化分布
- **handoff**:接採購提交策略 → 核可 → 放行進 DPM(或退回採購補)

### 3.8 admin/IT · `/admin/cost-master`

- **landing**:平台健康儀表(baseline 就緒度卡牆 + 告警 chip)· 獨立後台 route(與 /projects 同層)
- **menu(9 子模組)**:廠 Baseline 控制台 · 設備類別 Catalog(跨 BG copy)· 類別單價 · 工資 Master(DL 廠級單一 + IDL Line-Dep 4 + Centralized 17)· 耗材 Master · SMT 點數規則 · **Costing Model × Template × component mask 配置** · 權限 Grant + BG/BU 主檔 + 使用者同步
- **flow**:月度 baseline 建置 · 新 BG onboarding(跨 BG copy catalog · copy=fork)· component mask 改(影響全 draft 案 · 比照 baseline Diff 影響預估)· 權限 grant 維護(**VIEW_TRUE_COST 單一源=既有資料權限管理 · D10**)· 使用者 BG 同步
- **data**:全 master 表(`bom_factory_*` · `bom_equip_category_*` · `bom_*_smt_point_rule`)· `bom_cs_component`(model_applicability/fallback_into_code)· `bom_factory_baseline`(costing_model + base_ref + oh_pct + …)· `bom_settings_admin_grant` · `org_bg/org_bu` · `ai_data_policy_rules`
- **權限**:跨 BG · scope=ALL · super-admin
- **handoff**:不在 stage 鏈 · 月度交付可信 master + 正確權限給所有作業角色

### 3.9 GM_BG 總經理/BG 高層 · `/portfolio`(oversight 唯讀)

- **landing**:BG 戰情總覽(KPI 磚 + widget 牆)· scope=該 BG 所有 BU · 全唯讀
- **menu**:BG 總覽 · 全案清單(唯讀)· 卡關紅燈中心 · Margin 風險雷達(VIEW_TRUE_COST gate · **GM 預設進名單 · 衝突5**)· Stage 流量漏斗 · 贏單 KPI · Watchlist · 單案唯讀 Drill · AI 預測警示
- **flow**:看(集團 KPI 磚)→ drill(widget→清單)→ 單案唯讀投影(cost_matrix + stage timeline + 卡關 task · ≤2 點擊)→ **不改不交棒**(dead-end)· 治理只走線下/訊息催 DPM/業務
- **data**:讀 `bom_cs_run_result/pfm_cell` 被動聚合 · `projects/project_stages` · 全唯讀
- **權限**:scope=該 BG BU 清單 · VIEW_TRUE_COST 通常持有(Margin 雷達)· 無 Edit/lock/reprice/指派

### 3.10 董事長/集團最高 · `/portfolio?scope=GLOBAL`(oversight 唯讀)

- **landing**:集團 Portfolio(集團 KPI + 各 BG swimlane + Attention 清單)· **複用 /portfolio + GLOBAL toggle · D9**
- **menu**:集團總覽 · BG 對比 · 全集團專案瀏覽器 · Margin/雙價分析 · 卡關/Gate 監看 · 客戶量級組合 · 專案唯讀檢視 · 匯出 Board Pack(機密浮水印)
- **flow**:集團→BG→專案→cell 下鑽(同 GM 框架 · 只差 scope=全不過濾)· **不改不交棒**
- **權限**:scope=GLOBAL(全 BG/BU 不過濾 · GM 的超集)· VIEW_TRUE_COST 恆 true · 機密案穿透(右上常亮綠盾)· Attention 門檻 admin 可調(`system_settings` · D9)

---

## §4 Shared Infra(跨角色共用)

1. **BG/BU 隔離** — `resolveUserScope` 過濾每工作台卡片/佇列/比價;跨 BG 機密 cell + customer_alias 遮罩;admin/HQ/CHAIRMAN 穿透。
2. **權限三層** — `bom_settings_admin_grant`(user×scope×bg/bu/factory×view/edit/approve)+ `ai_data_policy_rules`(VIEW_TRUE_COST 單一源 · D10)+ `project_members.field_grants`(角色 template 預設 · D3)。
3. **stage 引擎 + gate** — `workflow_templates`(QUOTE 8 階段)→ copy `project_stages`;BPM 唯一 gate 確認人;reprice 開新 iteration(D2)。
4. **audit** — `bom_audit_log`(+ strategy_approved/rejected · D5)+ quote audit(EXPORT/VIEW_COST/SUBMIT/CLOSE/REDACT · append-only + 浮水印)。
5. **通知** — `user_notifications`:handoff / baseline 升版 reprice chip / reprice request / DPM lock → 業務;oversight priority≥門檻 自動訂閱。
6. **single-edit lock + heartbeat** — per `bom_instance`(採購)/ per `bom_cs_case_factory`(EPM)分鎖(衝突1)· 5min heartbeat · DPM/admin 強制踢。
7. **costing_model + superset 引擎** — 一張 superset form-schema + 一條引擎 · 20-component mask(model_applicability/fallback_into_code)+ field enabled_when;**各角色工作區只是前台任務化包裝層,底層不動**。
8. **fact 收斂** — `bom_cs_run_result`(對外唯一 fact)+ `pfm_cell`(propagate cache)為所有下游(業務報價/GM margin/董事長彙總)唯一消費源 · 不依賴任何 form 開啟狀態。

---

## §5 Schema 收斂(砍 / 保留 / 新增)

### 5.1 可砍重做(僅本 BOM/MVA/報價專案)
- `quote_negotiation_round` / `quote_export_log` / `quote_audit_log` — 業務工作區新表 · 對齊 `bom_audit_log` 風格
- `data_payload.factory_matrix` JSON 中繼 — 退役(`pfm_cell` 唯一終點)
- 舊 `STEELSERIES_FM` 2 維 / `DEFAULT_FM` / `bom_factory_dl_role` 死表 — 移除
- 5 個 `renderFormWhoop*` + `STEELSERIES_*` vs `DEFAULT_*` 雙 const(demo)— 收斂進 superset render

### 5.2 保留不動(只加導覽包裝)
- BOM 主鏈 `bom_instance/section/category/item/item_flk/item_mfg/price_snapshot/price_tier`
- cleansheet `bom_cs_case_factory/process/idl_alloc/equip_category/consumable/macro_process/macro_station/smt_point`
- 計算+fact `bom_cs_run/run_cell/run_result` · `pfm_cell/pfm_factory/pfm_pkg_option`
- master SCD `bom_factory_baseline/idl_role/idl_linedep_wage/dep_years/equip_category_catalog/equip_category_price/consumable/smt_point_rule`
- 權限 `bom_settings_admin_grant`/`ai_data_policy_rules` · 流程 `projects/project_stages/project_members/workflow_templates` · `bom_audit_log`

### 5.3 新增 DDL

```sql
-- D4 · WHOOP multi-sub-BOM module 層
CREATE TABLE bom_module (
  module_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id          NUMBER REFERENCES bom_instance(instance_id) ON DELETE CASCADE,
  module_code          VARCHAR2(40),                 -- 'HARVARD_SENSOR' / 'BIRD_MAIN' / 'STRAP' ...
  module_name          VARCHAR2(200),
  cat                  VARCHAR2(10),                 -- 'EE' | 'ME'(→ 預設 shared/per_variant)
  rev                  VARCHAR2(20),
  vendor_consigned     NUMBER(1) DEFAULT 0,          -- 客供料 module
  consigned_pn         VARCHAR2(80),                 -- 客供料號
  is_customer_specified NUMBER(1) DEFAULT 0,         -- 客戶指定 mfg
  items_count          NUMBER,
  step_order           NUMBER,
  -- SteelSeries = 1 隱性 module · WHOOP = 8 顯式
  PRIMARY KEY 已用 IDENTITY
);
-- bom_section 加 module_id FK(section 掛在 module 下 · 6 層:module→section→category→item→flk→mfg)
ALTER TABLE bom_section ADD module_id NUMBER REFERENCES bom_module(module_id);

-- D5 · RD 提交 + 採購核可狀態欄
ALTER TABLE bom_instance ADD rd_submitted_at TIMESTAMP;
ALTER TABLE bom_instance ADD rd_submitted_by NUMBER REFERENCES users(id);
ALTER TABLE bom_instance ADD procurement_gate_status VARCHAR2(20);   -- pending/approved/rejected
ALTER TABLE bom_instance ADD procurement_approved_by NUMBER REFERENCES users(id);
ALTER TABLE bom_instance ADD procurement_approved_at TIMESTAMP;
-- bom_audit_log event enum 補:strategy_approved / strategy_rejected / rd_submitted

-- 業務議價輪(可砍重做)
CREATE TABLE quote_negotiation_round (
  round_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id        NUMBER REFERENCES projects(id) ON DELETE CASCADE,
  round_no          NUMBER,
  archived_run_id   NUMBER,                          -- 一 round 對一 archived cs_run(D2)
  client_target_usd NUMBER(15,6),
  my_floor_margin   NUMBER(8,4),
  ask_reason        VARCHAR2(500),
  status            VARCHAR2(30),                    -- open/countered/reprice_triggered/closed
  created_by        NUMBER REFERENCES users(id),
  created_at        TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- D2 · reprice 開新 stage iteration(不覆蓋 gate 歷史)
ALTER TABLE project_stages ADD iteration_no NUMBER DEFAULT 1;
ALTER TABLE project_stages ADD superseded_by_iteration NUMBER;
-- gate_confirmed_* 留在各 iteration · 不覆蓋

-- D6 · ERP 歷史價標來源(只當參考)
ALTER TABLE bom_item_price_tier ADD true_cost_source_ref VARCHAR2(40);  -- 'ERP_HIST' | 'VENDOR_RFQ' | 'MANUAL'

-- 料號兩案都補(若未補)
ALTER TABLE bom_factory_consumable ADD foxlink_part_no VARCHAR2(40);
ALTER TABLE bom_cs_case_consumable ADD foxlink_part_no VARCHAR2(40);
ALTER TABLE bom_cs_case_pkg_item  ADD foxlink_part_no VARCHAR2(40);

-- D9 · oversight Attention 門檻 admin 可調
-- 走既有 system_settings(key='portfolio_attention_thresholds' value=JSON)· 不新建表
```

> 另對齊 [cortex-unified-architecture-sd.md](cortex-unified-architecture-sd.md) §3:`bom_cs_component` 加 `model_applicability/fallback_into_code` · `bom_factory_baseline` 加 `costing_model/sga_base_ref/profit_base_ref/oh_pct/outbound_transportation/loss_factor_per_process/smt_*`。

---

## §6 與既有 / 後續

| 文件 | 關係 |
|---|---|
| 本文件 | **角色工作區架構 SD**(authoritative · 前台導覽) |
| cortex-unified-architecture-sd | 底層 superset schema/component mask(本文件不重複) |
| cortex-role-operations-design | 設計稿 + D1-D11 決議來源 |
| bom-collection-sd / cleansheet-mva-sd | BOM/MVA 細節 · module 層(D4)補進 bom-collection |

### 後續(SD 定案後)

1. **Phase 0 DDL** — §5.3 + unified-arch §3(component mask + baseline 參數)。
2. **demo 重做** — v0.13 起改角色工作區制(10 route landing + workspace switcher),取代 v0.12 單一 form;先做 BPM/RD/採購/EPM/DPM/業務 6 個作業軌 + admin 設定台,再做 GM/董事長 portfolio。
3. **計算引擎** — superset 引擎讀 mask 跑 FULL/SIMPLIFIED 兩 model(unified-arch §3.4)· ε<0.01 regression。

---

**完。** 細部設計已收斂(D1-D11 + §6 衝突全解)· 本 SD 為角色工作區制實作依據 · 底層 superset schema 不動。
