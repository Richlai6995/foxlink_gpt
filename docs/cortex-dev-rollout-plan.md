# Cortex 報價/BOM 模組 — 開發推進與隔離紀律(SOT)

> 版本:v1.1 / 2026-06-30 · 狀態:開發紀律 source of truth
> 拍板(2026-06-30 user):① 模組**寄生 `projects-platform`**(case = 既有 project 容器)② **新 flag `ENABLE_CORTEX_BOM`**(獨立 dark-launch)③ 先寫本 doc 再動 S0
> **關鍵定位**:`projects-platform` = 本平台**前一版**(spec `projects-platform-spec.md v0.4`,測試中**未上 prod**)· 本次 = 把它**演進到新設計**(三軸 RBAC + BOM superset)· user #3「先前程式可改/刪」對得上(它就是專案管理程式)
> **三決策拍板(2026-06-30)**:Q1 **成本資料 = 正規化表為唯一真相源**(bom_cs_* · data_payload 只留輕量 metadata)· Q2 **計算引擎產 cost_breakdown**,aiCleansheet 退化成比較視圖(只加 adapter,內部零改)· Q5 **角色共存**(13 system role + 疊加 12 業務 role · 同一 user_role_definitions · sub_role 降純 label)
> 關聯:[cortex-integration-sd.md](cortex-integration-sd.md)(三軸 RBAC)· [cortex-unified-architecture-sd.md](cortex-unified-architecture-sd.md)(BOM superset)· 互動 demo [Cortex_互動Demo_v0.16.html](Cortex_互動Demo_v0.16.html)
> 真實 codebase 測繪依據:workflow `cortex-real-codebase-integration-map` + `projects-platform-deep-read`(各 7 agents)

---

## §0.5 v1 既有 → v2 演進(深讀結論 · reuse/extend/build-new)

projects-platform 已有的(**不重做**,只 reuse/extend):

| 既有 | 處置 | 怎麼接 BOM |
|---|---|---|
| QUOTE plugin:8-stage(BOM_PROVIDE st4 / BOM_COST_REVIEW st6 gated)+ 7 channel + confidential_field_defaults | **reuse + 填空殼** | `form_template`/`stage_hooks`/`scrub_rules` 目前空,填入 14-section superset / hook / scrub map |
| aiCleansheetService(三廠比較 + LLM) | **reconcile** | 加 BOM→cost_breakdown adapter,cleansheet 內部零改 |
| aiPricing/whatIf/winRate | **reuse** | 引擎算完餵 cost_total 純量 |
| confidentialityMiddleware(4 策略遮罩) | **reconcile → 軸③** | capability 驅動 + 加 VIEW_MARGIN 反推鎖(取數路徑改吃正規化表) |
| projectAclMiddleware(成員判定 · field_grants 讀沒用) | **reconcile → 軸②** | 接 allowed_org_ids · field_grants 接成軸③ per-member 例外 |
| userRoleService(13 role · 多角色 grant · BU scope) | **reuse** | getEffectiveRoles=三軸共用 grants 全集 · 軸① can() 包在 hasRole 上 |
| approvalService(多步簽核鏈) | **extend** | 加 `chain_kind=bom_cost_review` case(switch 擴充非重建) |
| stagesService / KB 雙層 / sidebarPermission | **reuse/extend** | stage_hooks 注入點 |

**真正 build-new(BOM 本體缺口 3 塊)**:① 成本正規化 4 表 + 6 層階層 + multi-variant + NRE/PKG/factory-matrix ② 單一計算引擎(costing_model + mask + base_ref → cost_breakdown,v1 完全沒這層)③ 軸① RBAC(rbac_function + rbac_role_permission + can()).

**reconcile 要點(不重做)**:
- `user_role_definitions` 已有 **`is_system`**(seed 不可刪)→ **直接當 is_seed 用,不重複加**。只 ALTER 加 `is_active`(軟停用)+ `copied_from` + `created_by` 三欄。
- `getEffectiveRoles`/`hasRole` 目前只濾 `grant.is_active`,**沒濾 `definition.is_active`** → 加 `is_active` 後要補 `d.is_active=1`(否則停用 role 仍放行)。
- 既有 4 層權限 → 三軸:**軸①**=新(can() 包 hasRole)· **軸②**=projectAcl(reconcile)· **軸③**=confidentiality + field_grants(reconcile)· **SoD/二簽**=approvalService(extend)。

---

## §0 核心紀律(每次動工前讀)

1. **trunk-based dark-launch · 不養長分支**:每切片完成就小 PR 進 git master(flag off 狀態),按定序逐步點亮。長分支的真實成本不在 BOM(綠地),在 5 個高頻變動的前端共用檔 rebase 地獄。
2. **唯一例外 = S5**(軸②③ 資料政策橋接 · `collision_risk=high` · 會 leak true_cost/margin):走**獨立短命分支 + 雙軌 resolver + 雙寫驗證 + 嚴格 review**,不可跟其他切片混。
3. **加性優先**:新表全 `rbac_*` / `bom_cs_*` 新建;只有 **3 處 ALTER**(見 §2),全走 idempotent `safeAddColumn` + 欄位存在檢查,既有資料不動。
4. **不碰非專案管理程式**(user #3):靠「加性 + 命名空間 + flag + RBAC gating」保證,不靠分支隔離。
5. **K8S 部署可無限延後**:不影響其他模組(影響來自「動到共用」與「分支 drift」,不是「不部署」)。git master 仍要勤併以維持整合健康。
6. **每切片本機測過才併**(server 3007 + client 5173 + Oracle)。

---

## §1 命名與落點(鎖定)

| 項 | 規則 |
|---|---|
| 後端落點 | `server/projects-platform/bom/`(寄生)· 路由 `/api/projects/:id/bom/*` 或模組級 `/api/cortex-bom/*` |
| Flag | **`ENABLE_CORTEX_BOM`**(新 · 獨立於 `ENABLE_PROJECTS_PLATFORM`)· flag off → sub-router 回 null、migration 不拋 |
| ⚠️ 命名禁區 | **不可**用 `/api/bom`、`/api/pm-bom`、`PmBom*`、`pm_bom_metal`(= 貴金屬 BOM,已上 prod,完全不同物) |
| 新表前綴 | `rbac_*`(RBAC 地基)· `bom_cs_*` / `bom_factory_*`(報價 superset)· 比照既有 `PROJECT_*`/`QP_*` 慣例 |
| 前端落點 | 仿 `ProjectsPlatform/` 開獨立子目錄(自己 Routes + Context)· lazy import · 共用檔只加 flag-gated 條件分支 |

---

## §2 整合面(真實 codebase · 哪些加性 / 哪些共用)

| 子系統 | 現況 | 加性/共用 | 風險 |
|---|---|---|---|
| `projects-platform` 容器 | **已存在**(flag + namespace + error-boundary + verifyToken + migrations) | additive(BOM 的案容器 = 它) | low |
| `user_role_definitions` / `user_role_grants` | **已存在**(13 system role · getEffectiveRoles 已吐 role_code) | shared(ALTER +4 欄) | med |
| RBAC 軸① 4 表 + `can()` 引擎 | **不存在**(純紙上) | additive 建表 · can() 為新共用中介層 | med |
| BOM superset(`bom_cs_*`…) | **不存在**(綠地) | additive 全新建 | low |
| AI/legacy 資料政策(`roles`/`ai_role_cat_policies`…) | **已存在**(role_id→legacy `roles`) | shared 橋接(ALTER +udr_role_code) | **high** ⚠️ |
| `pm_bom_metal`(貴金屬) | **已存在 prod** | 獨立 · 勿同名勿誤 ALTER | low |
| server.js 掛載 + verifyToken | 已存在(無全域 error handler · 每路由自負 500) | shared 最小(寄生則免改) | low |
| 前端 App/Sidebar/AuthContext/i18n×3/AdminDashboard | 已存在 | shared(flag-gated 條件分支) | med |

**3 處 ALTER(全 idempotent)**:
1. `user_role_definitions` +`is_seed/copied_from/created_by/is_active`
2. `ai_role_cat_policies` / `ai_role_policies` +`udr_role_code VARCHAR2(80)`(橋接 · S5)
3. `ai_data_policy_rules` +`VIEW_MARGIN` capability(S5)

**`is_active` 軟停用注意**:`getEffectiveRoles()`/`hasRole()` 目前只濾 `grant.is_active`,**沒濾 `definition.is_active`** → S1/S2 要在這兩個 query 加 `d.is_active=1`,否則停用 role 後 can() 仍放行。

---

## §3 BOM-first 定序(依賴已對齊)

並行圖:`S0 → (S1→S2) ∥ (S3→S4) → S5 → S6 → S7`
(BOM schema/引擎 S3/S4 不硬依賴 RBAC,純函數可先跑離線測;權限投影才需 S1/S2)

| 切片 | 交付 | 依賴 | shared 接點 | 本機測 |
|---|---|---|---|---|
| **S0** | flag + namespace 骨架(`/bom/_health`) | — | index.js sub-mount(寄生則僅此) | flag off=0改動;on=200 |
| **S1** | RBAC 4 表 + ALTER user_role_definitions +4欄 + seed 12 Cortex role | S0 | 新 migration | init() 跑兩次驗 idempotent |
| **S2** | `can()` 引擎(軸①+SoD · scope mock 全通) | S1 | rbacService.js(新)· requireFunction middleware(新)· getEffectiveRoles 加 `d.is_active=1` | 純單元測真值表 |
| **S3** | BOM superset schema(綠地 · case→project FK) | S0 | 新 migration | SQL 驗 component mask |
| **S4** | 單一計算引擎(純函數) | S3 | bomCostEngine.js(新) | Rival3/WHOOP 兩 Excel ε<0.01 離線 |
| **S5** ⚠️ | 軸②③ 橋接 + 接 can()(**獨立分支**) | S1,S2,S4 | database-oracle.js + 既有 resolver(雙軌) | 雙寫驗 allowed_org_ids 新舊相等;無 VIEW_MARGIN 打 margin API 回整段隱藏 |
| **S6** | 前端投影 + IT 後台矩陣 | S2,S5 | App/Sidebar/AuthContext/i18n×3/AdminDashboard | 不同 seed role 帳號逐 section 驗 |
| **S7** | reprice/unlock + admin_grant 退役 | S2,S5,S6 | rbacService/bomCostEngine | path B 端到端不卡死 |

---

## §3.6 BOM superset 權威 DDL(收斂結果 · 46 表 / 4 層 / 拆 013a–d)

來源:`bom-superset-schema-reconcile` workflow(3 SD + 9 缺口表收斂)。完整每欄 spec 見 workflow 輸出。

**FK 策略**:**case = project**(1:1,不另建 case 容器表)。`projects.id`(既有 001_init)為唯一容器,**projects 表 0 ALTER**。三個 root 接 `projects(id)`:`bom_instance`(BOM 結構根)/ `project_factory_matrix`(矩陣根)/ `bom_cs_case_factory.case_id`(一案 N 廠計算鏈根)。Layer 1/2 master 不接 projects。ERP 識別跨庫只存值不建 FK。

| migration | 層 | 表(數) | FK |
|---|---|---|---|
| **013a** ✅ | L1/2 master | bom_factory · process_catalog · cs_component(20 mask)· equip_category_catalog · factory_baseline(+idl_role/idl_linedep_wage/dep_years/equip_category_price/consumable/smt_point_rule)· process_template(+step)· category_dict · category_markup_default(**15**) | 無 projects |
| **013b** | L3 BOM 結構鏈 | bom_instance→section→category→item→ai_cache→item_flk→item_mfg→price_snapshot→price_tier · erp_item_index(**10**) | projects(id) |
| **013c** | 案級 cleansheet | bom_cs_case_factory→case_process/idl_alloc/equip_category/consumable/qty_scenario/pkg(+pkg_item+pkg_module_include)/macro_process/smt_point/run→run_cell→run_result(**16**) | case_factory_id |
| **013d** | 矩陣+audit | project_factory_matrix→pfm_factory/pfm_pkg_option/pfm_cell · bom_audit_log · bom_settings_admin_grant · bom_cs_baseline_diff(**7**) | projects(id) |

**9 缺口表裁決**:設備類別三表=新建(類別制)· audit 併單一 `bom_audit_log`(event_type enum 擴)· baseline_diff=輕表+回指 audit · admin_grant=新建(資源級細權,與 user_role_grants 互補)· pfm MVA variant/pkg=暫不建(併 pfm_cell 維度)· macro_station=暫不建 · 個別機表=暫不建(類別制為主)· form 引擎去 plugin=留 014+。

**open(多數 defer · 不阻 013a–d schema · 影響 S1/013c-d 細節)**:
1. ⚠️ **quote 側 mva/sga/profit 是否=true 側?**(影響 margin 定義 · 必與兩支 Excel ε<0.01 對齊)→ **留 S1 計算引擎拍**(013 先把 true+quote 欄都建好)
2. baseline_diff 獨立表 vs 併 audit JSON → 預設獨立表
3. pfm 預聚合快照(報表需要再議)→ 暫不建
4. macro_station(WHOOP 細站)→ 暫不建(demo 只 macro header)
5. 個別機 override 表 → 暫不建(類別制;遷移期 mva_source 對帳 ε<0.01 不可破)
6. form 引擎去 plugin(F16-18)→ 014+ Phase 4

---

## §4 隔離戰術(對應 user #4)

1. **Flag dark-launch**:複用 projects-platform pattern(buildRouter flag off 回 null · migration 失敗不拋)· 整包 flag-gated → 天天可併 master 不曝光
2. **命名空間寄生 + error-boundary**:掛 /api/projects 底下 · 下游 throw 不冒泡污染主站
3. **加性 schema**:見 §2 · 唯三 ALTER idempotent
4. **RBAC gating 天然隱藏**:新 role/function 不發給人 = 前端 can() 全 false = section 整段隱藏 · 比 flag 更細粒度(Day0 只授 1-2 測試帳號)
5. **雙軌 resolver(S5)**:橋接期 udr_role_code 與 legacy role_id 並存 · 先「讀舊為準、新只比對驗證」· 確認無 leak 才切讀新路
6. **前端 lazy + 獨立子目錄**:仿 ProjectsPlatform/ · 共用檔只加條件分支
7. **計算引擎離線可測**:bomCostEngine 純函數讀 fixture · ε<0.01 regression 不依賴 server/DB

---

## §5 進度追蹤

| 切片 | 狀態 | PR/commit | 備註 |
|---|---|---|---|
| S0-RBAC(012_rbac.js) | ✅ **本機 Oracle 驗證通過**(2026-06-30 · verify-rbac-012.js 全 ✓ · 冪等重跑乾淨) | | 4 RBAC 表 + ALTER user_role_definitions(+is_active/copied_from/created_by · is_system 沿用為 seed)+ seed 11 cortex.* 業務 role。function/矩陣 seed 留 S2/S3 |
| S0-BOM schema 收斂 | ✅ workflow 完成 → §3.6 權威 DDL(46 表/4 層/拆 013a-d) | | bom-superset-schema-reconcile workflow |
| S0-BOM **013a**(masters 15 表) | ✅ **本機 Oracle 驗證通過**(verify-bom-013a 全 ✓) | | Layer1/2 master + 20-component mask + 3 廠/9 製程/3 模板 seed · 不接 projects |
| S0-BOM **013b**(BOM 結構鏈 10 表) | ✅ **本機驗證通過**(VIRTUAL/VECTOR/FK 對) | | bom_instance(FK projects)→…→price_tier(雙價 VIRTUAL)· erp_item_index(VECTOR) |
| S0-BOM **013c**(cleansheet 案級 14 表) | ✅ **本機驗證通過**(14 表 + FK + 6 VIRTUAL 對) | | …run_result(雙價+margin VIRTUAL · **open#1 公式 S1 驗**) |
| S0-BOM **013d**(factory_matrix+audit 7 表) | ✅ **本機驗證通過** · **🎯 S0 全數到位(RBAC 4 + BOM 46 = 50 表)** | | project_factory_matrix→pfm_*(唯一終點)+ bom_audit_log + admin_grant + baseline_diff |
| S1 | ⬜ | | |
| S2 | ⬜ | | |
| S3 | ⬜ | | |
| S4 | ⬜ | | |
| S5 | ⬜(獨立分支) | | |
| S6 | ⬜ | | |
| S7 | ⬜ | | |
