# Cortex 整合 SD — v0.12 單一視圖 × 三軸 function-RBAC × 動態多角色

> **版本**:v1.1 / 2026-06-29
> **狀態**:Solution Design(細部設計已收斂 · 含對抗式稽核修正 · 互動 demo 已實證 · 可實作)
> **定案**(2026-06-26 user):① 前台回 v0.12 project 單一視圖(全貌按權限投影)· 角色工作區制(v0.13)作廢只留 seed 角色定義 ② function-RBAC **掛既有 `user_role_definitions`**(專案平台多角色 · 非 AI 角色 `roles` · 非新表)③ SoD 預設 **SELF_RECORD + 留痕**,高危可由 IT 升 HARD
> **v1.1 增訂**(2026-06-29 user「寫回」· demo 落地反饋):④ 軸② 落地成前台「**機密策略 / 資料政策**」畫面(admin-gated · 同頁顯軸②③)⑤ 角色**完全動態 CRUD**(IT 後台矩陣可新建/複製/改名/停用/刪 · seed 不可刪只可停用)→ schema 補軟停用欄 ⑥ 角色切換唯一入口 = **登入身分**(user identity)· 舊「DEMO 視角」切換器退役 ⑦ admin 入口從 topbar 移到左 nav「管理」區(`can()` gating)
> **稽核**:`rbac-audit-sd` workflow(5 agents · 4-lens 對抗稽核 · 8 high SoD/coverage/field-leak 已修)
> **參考實作**:[Cortex_互動Demo_v0.15.html](Cortex_互動Demo_v0.15.html)(v0.12 全內容 + can() 投影 + IT 後台動態 role + 資料政策畫面 · 取代 v0.13/v0.14)
> **關聯**:[cortex-rbac-permission-matrix.md](cortex-rbac-permission-matrix.md)(function/矩陣)· [cortex-unified-architecture-sd.md](cortex-unified-architecture-sd.md)(14 superset section)· [cortex-role-workspace-sd.md](cortex-role-workspace-sd.md)(角色/handoff · 工作區制作廢)· [projects-platform-spec.md](projects-platform-spec.md) §17(user_role_definitions/grants)

---

## §0 目的與整合範圍

把累積的設計收斂成**一套可實作架構**:

- **前台** = v0.12 project-centric 單一視圖(14 section 全貌)· 每 section 按**權限投影**(顯隱/唯讀/遮欄)· **不回 v0.13 per-role 拆頁**
- **授權** = 三軸:① Function×Verb(新)② Data Scope(既有資料權限管理新類別)③ Field Sensitivity(既有 VIEW_TRUE_COST + 新 VIEW_MARGIN)
- **角色** = 掛既有 `user_role_definitions`(可改/複製/新建 · 多角色 union · 不寫死)
- **退役** `bom_settings_admin_grant`(混 scope+verb)→ 拆兩軸
- **正交**(非權限):`costing_model`(案 capability)· `stage/lock`(workflow 狀態)

---

## §1 三軸授權模型 + `can()` 解析合約

```
can(user, function, verb) =
  roles  := getEffectiveRoles(user)              -- user_role_grants 全集(多角色)
  allow  := EXISTS ALLOW(roles, fn, verb)         -- 軸① union
  deny   := EXISTS DENY (roles, fn, verb)         -- deny-wins · 不沿相依連鎖
  sod    := pass rbac_sod_exclusion               -- actor ≠ 該紀錄 maker(SELF_RECORD)
  scope  := allowed_org_ids(∪ roles 的軸②政策) 涵蓋本案 org   -- union 互相 cover
  field  := 軸③(VIEW_TRUE_COST / VIEW_MARGIN · 任一 role 有就有)若 verb 碰機密欄
  gate   := isGateActive(fn) 視 gate_type(flow 不可空 / approval 沒人持→跳過留痕)
  stage  := workflow status / lock 允許
  ⇒ allow AND NOT deny AND sod AND scope AND (field if needed) AND gate AND stage
```

短路順序:`deny → sod → scope → field → gate → stage`(任一 fail 即拒,省下游查詢)。

| 軸 | 答 | 落點 |
|---|---|---|
| ① Function × Verb | 能做什麼操作 | 🆕 `rbac_function` + `rbac_role_permission`(引 `user_role_definitions.role_code`) |
| ② Data Scope | 能碰哪些 org/案 | 既有資料權限管理 + 新類別「BOM 報價成本資料權限」· L3 部門/L4 ERP Multi-Org → `allowed_org_ids` |
| ③ Field Sensitivity | 看不看 true cost/margin | 既有 `ai_data_policy_rules`:VIEW_TRUE_COST(true_cost/mva)+ 🆕 VIEW_MARGIN(markup/gross_margin) |

---

## §2 既有資產盤點 · 不新建平行 role 表

Cortex 有**兩套** role,**勿混**:

| 表 | 是什麼 | 對 function-RBAC |
|---|---|---|
| `roles`(legacy · NUMBER id · `users.role_id` 單 FK · 編輯角色那張)| AI/KB/Skill/上傳/dashboard feature tier · 軸②③ 政策表 FK 在此 | ❌ **不碰** |
| **`user_role_definitions`**(role_code UNIQUE · permissions_json · is_system · default_expires_days · requires_dual_sign)+ **`user_role_grants`**(多角色 × GLOBAL/BU scope + expires)| 專案平台多角色系統 · **已支援兼任/任期/雙簽** | ✅ **軸① 掛這個** |

**決策**:軸① 復用 `user_role_definitions`(加 3 欄)· **絕不另建 VARCHAR2-PK `rbac_role`**(否則 `ai_role_cat_policies.role_id` 等 NUMBER FK 接不上)· 也不碰 AI 角色(honor user 指示)。
軸② 走部門→org(不靠 role)· 所以兩套 role 並存對 BOM 模組**零衝突**。

---

## §3 Function 註冊表(35 fn · 對齊 14 superset section)

完整清單見 [cortex-rbac-permission-matrix.md](cortex-rbac-permission-matrix.md) §2 · 本 SD 補稽核缺口:

- 🆕 `F_GAP_ANALYSIS`(view·edit · 給 RD/EPM/DPM)— section 13 不漏 gate
- 🆕 `F_QUOTE_APPROVE`(approve · config gate)— 報價四眼(稽核 high #4)
- 🆕 `F_EDIT_LOCK_RELEASE`(force_release · DPM+admin)— single-edit 鎖踢人
- `F_BOM_FINAL_LOCK` 補 **unlock** verb · `F_FACTORY_LOCK` 補 unlock — reprice 解死結(稽核 high #8)
- `F_ROLE_PERMISSION` 拆兩個:`F_ROLE_PERM_EDIT`(改 role 權限)vs `F_ROLE_ASSIGN`(指派 role 給 user)— admin 提權防線(稽核 high #7)

每 fn 帶 `section_code`(對 14 superset section · 前台 dispatch 權威源)+ `is_field_gated`(機密欄受軸③)。

---

## §4 Verb 集 + 相依

| 類 | verb |
|---|---|
| CRUD | view · create · edit · delete |
| Action | submit · approve · gate_confirm · lock · **unlock** · propagate · export · reprice · close · run · copy · **force_release** |

- 相依(`edit⊃view` · `propagate⊃lock` · `lock⊃view`)在**配置寫入時展開成顯式列**,解析不推導(快 + 可審)
- `DENY` **不沿相依連鎖**(拒 propagate 要另寫一列 deny)

---

## §5 Seed Role × Function 矩陣(補完 12 欄)

§6 矩陣補 **經管(PLANNING)** / **業助(SALES_ASSIST)** 兩欄(原 10 欄落空 · 稽核 high #9):

| Function \ Role | …(原 10 欄見 matrix §6)… | **經管** | **業助** |
|---|---|---|---|
| F_PROJECT | | v | v |
| F_COST_MATRIX | | v | v(僅 quote 投影欄) |
| F_MARGIN_ANALYSIS | | v | ❌(初階不給 · 軸③也擋) |
| F_FACTORY_BASELINE | | **v·c·e**(R1 主維護) | |
| F_EQUIP_CATEGORY | | v·c·e | |
| F_WAGE_MASTER | | v·e | |
| F_SMT_POINT_RULE | | v·e | |
| F_CONSUMABLE_MASTER | | v·e | |
| F_QUOTE_EXPORT | | | export(代業務備料) |
| F_NRE_STRATEGY | | | v·e |
| F_QUOTE_SUBMIT / F_REPRICE_TRIGGER | | | ❌(由業務持 · cover 靠 union 不是每人全給) |

**最小權限收斂**(稽核 medium):
- 廠級 master `edit` 收斂**單一 owner**(經管 or EPM 擇一 · 另一方 view)· 多方可編竄改面太大
- `F_COST_MATRIX` view 對業務/業助只給 **quote 投影欄** · 採購限 `ASSIGNED_ONLY` scope(不給跨案全矩陣)
- seed 只是**開箱預設** · 真實分工 IT 後台調(複製就近角色有過授風險 · config lint 警示)

---

## §6 軸② Data Scope 整合(多角色 union)

- 新增政策類別 **「BOM 報價成本資料權限」** 走既有 L1 使用者 / L3 部門 / L4 ERP Multi-Org(**不用 L2 角色過濾** · 部門→org)
- 軸②③ role 解析從 `users.role_id`(單)改吃 **`user_role_grants` 全集** · `scope = union`(互相 cover 語意)· `allowed_org_ids = ∪ 各 role 政策解出的 org`
- 廠級 master 實際可編 = 軸① edit **∩** 軸② `allowed_org_ids`(只能編自己 org 範圍的廠 baseline)
- ⚠ 跨 BG「經管(集團級)」union 可能解出全廠 master 編輯權 → 高敏 function(廠級 master edit)可選 **intersection** 或 `scope ∩ master 廠別欄` 收斂(open #2)

**前台落地(v1.1)**:軸② 在前台呈現為**「機密策略 / 資料政策」畫面**(左 nav「管理」區 · admin-gated 查 `F_DATA_POLICY.view`)。畫面 = 既有「資料權限管理」的一個**新政策類別**,非另做表:
- 上半 = 軸② 範圍政策表:L1 使用者 / L3 部門 / L4 ERP Multi-Org 綁定 → 各列解出的 `allowed_org_ids` · 標明多角色/多層 **union**(案 BG/BU 不在集合 → 連案列表都看不到 = 跨 BG 隔離)
- 三軸關係明示:① 能不能進 function(IT 後台矩陣)→ ② 碰得到哪些**資料列**(本畫面 org 範圍)→ ③ 列裡哪些**機密欄**(見 §7)· `can()` 一次 AND 收斂

---

## §7 軸③ Field Sensitivity + margin 反推鎖(稽核 high #6)

- **VIEW_TRUE_COST**(既有 · 單一源)= true_cost / mva / SGA
- 🆕 **VIEW_MARGIN** capability(對齊 VIEW_TRUE_COST · 獨立 gate)= markup_pct / gross_margin(🔒🔒)
- **反推鎖**:軸①給 `F_MARGIN_ANALYSIS` view 但軸③ VIEW_MARGIN 未過 → **整頁隱藏**(非打 ▒ · 否則 heatmap 全 ▒ 空頁 + quote+margin% 可反算 true_cost)
- 同案 true_cost 被 mask → **連帶 mask 任何可反算衍生欄**
- 軸③ capability **不因多角色 union 放寬**(任一 role 有才有,但不是「湊」出來)

**前台落地(v1.1)**:軸③ 在「機密策略 / 資料政策」畫面下半呈現 = 既有 `ai_data_policy_rules` 的欄位級 displayStrategy 表(機密欄 × capability 旗標 × 無權時行為:VIEW_TRUE_COST→MASKED ▒ / VIEW_MARGIN→整段隱藏)+ **各 user 當前 capability live 表**(IT 一眼看誰看得到 true cost/margin)。每次 access margin 寫 audit。

---

## §8 SoD 硬約束(稽核核心 · SELF_RECORD 預設 + 留痕)

### 8.1 互斥對表

```sql
CREATE TABLE rbac_sod_exclusion (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fn_a VARCHAR2(40), verb_a VARCHAR2(20),   -- maker 端
  fn_b VARCHAR2(40), verb_b VARCHAR2(20),   -- checker/lock 端
  enforce_level VARCHAR2(20) DEFAULT 'SELF_RECORD',  -- SELF_RECORD(actor≠該紀錄 maker 才放行 · 預設 · 適小團隊)
                                                     -- HARD(同 user 不得同持 · IT 對高危可升)
  scope_grain   VARCHAR2(20) DEFAULT 'RECORD',       -- RECORD(同一案/版本)| ROLE_ASSIGN(指派階段 warning)
  reason VARCHAR2(500), is_active NUMBER(1) DEFAULT 1
);
```

### 8.2 Seed 互斥對(落地稽核 8 high)

| maker 端 | checker/lock 端 | 預設 | 稽核 |
|---|---|---|---|
| `F_COST_REVIEW.edit` | `F_BOM_FINAL_LOCK.lock` | SELF_RECORD(lock actor≠last_cost_editor) | #1 DPM 自做自鎖 |
| `F_CASE_PROCESS.edit` | `F_FACTORY_LOCK.lock` | SELF_RECORD(lock actor≠製程最後編輯者) | #2 EPM 自做自鎖 |
| `F_PURCHASE_STRATEGY.edit` | `F_PURCHASE_STRATEGY_APPROVE.approve` | SELF_RECORD(approve 對自己建的失效) | #3 union 架空 |
| `F_QUOTE_SUBMIT.submit` | `F_REPRICE_TRIGGER.reprice`(同版本) | SELF_RECORD(submit 者≠上輪 reprice 發起人) | #4 報價零核准 |
| `F_FACTORY_BASELINE.edit`(propagate 進 true_cost 的 master) | `F_BASELINE_SECOND_SIGN.approve` | SELF_RECORD(三角色至少跨兩人) | self-sign |

- 執行層:`distinct-actor` 校驗 — 系統記 `last_editor_user_id` · lock/approve 時 `actor != maker` 才放行
- 高危(DPM lock / 報價核准)IT 可升 **HARD**(同 user 不得同持 → 指派階段就擋)
- `F_ROLE_PERM_EDIT` / `F_DATA_POLICY` 高敏變更(授 VIEW_TRUE_COST/VIEW_MARGIN/approve/lock)第二 admin 二簽 + **self-grant guard**(不能改自己持有的 role)+ 不可竄改 audit(稽核 high #7)

---

## §9 Gate 動態啟用引擎(config-driven · 跳過留痕 · 稽核 high #5)

```sql
CREATE TABLE rbac_gate_config (
  function_code VARCHAR2(40) PRIMARY KEY REFERENCES rbac_function(function_code),
  gate_type     VARCHAR2(20),   -- 'flow'(F_STAGE_GATE · 不可全空)| 'approval'(可跳過)
  skip_policy   VARCHAR2(20) DEFAULT 'NO_HOLDER',  -- NO_HOLDER(暫無人持→留痕跳過+告警)
                                                   -- DISABLED(明確關 · 需理由+核准)| NEVER(flow)
  fallback_role VARCHAR2(80),   -- flow gate 單點保護(admin/owner)
  disabled_reason VARCHAR2(500), disabled_by NUMBER REFERENCES users(id)
);
```

- `isGateActive(projectId, fn)` = `EXISTS user IN project_members WHERE can(user,fn,gate_verb) AND 軸②scope 涵蓋本案` · **per-project 即時重算不快取**
- **flow gate**(`F_STAGE_GATE`)**不可套「沒人持→跳過」**(否則永遠卡 READY_FOR_GATE 或角色自跳 stage)· 「至少一 active role 持 gate_confirm」設**系統不變式** · 啟用流程時無 holder → 後台擋存 + admin/owner fallback
- **approval gate**(採購核可 / 二簽 / 報價核准 / 脫敏)沿用「沒人持→跳過」但**顯式留痕**:`disabled` vs `no_holder` 區分 · 跳過寫 audit `{project, fn, reason:'no_holder', resolved_at}` · 管理面板列「**當前被架空的控制點**」清單(稽核一眼看到)

---

## §10 reprice 回圈 + unlock / force-release(稽核 high #8)

- path B 退 Stage5 重編需 **unlock**:`F_BOM_FINAL_LOCK` = view·lock·**unlock**·propagate · DPM = lock·unlock·prop(對齊 force-release)
- single-edit 5min heartbeat 鎖 force_release 顯式化 = `F_EDIT_LOCK_RELEASE`(DPM+admin)
- reprice 開新 iteration 的 stage rewind 權限歸 `F_STAGE_GATE`
- path B 端到端驗證不卡死

---

## §11 軸① schema(復用既有 + 新增 4 物件)

```sql
-- A. 既有 user_role_definitions 加欄(ALTER · 不新建 role 表)
ALTER TABLE user_role_definitions ADD (is_seed NUMBER(1) DEFAULT 0);       -- 1=開箱模板(可改不可刪·只可停用)
ALTER TABLE user_role_definitions ADD (copied_from VARCHAR2(80));          -- 複製來源 role_code
ALTER TABLE user_role_definitions ADD (created_by NUMBER REFERENCES users(id));
-- is_active 軟停用(若既有表未含則加 · 1=啟用 0=停用):停用 role 不參與 can() 計算 · 但保留歷史 grant/audit
ALTER TABLE user_role_definitions ADD (is_active NUMBER(1) DEFAULT 1);
-- 既有 is_system 13 個維持 · 新增 12 Cortex seed(BPM/RD/採購/EPM/DPM/業務/採購主管/admin/GM_BG/董事長/經管/業助)is_seed=1
-- ⚠ role_code 一旦建立永不改(PK 穩定 · rbac_role_permission/grants/ai_*_policies FK 都指它)· 「改名」= 只改 display_name_i18n(三語)
--   (demo v0.15 為簡化直接改 key 並 cascade user.roles;生產務必走 display_name 改名,不可動 role_code)

-- A'. IT 後台動態 role CRUD(對應上述欄位 · 純配置不需 migration)
--   新建 = INSERT(is_seed=0, created_by=actor) · 至少給 F_PROJECT.view
--   複製 = INSERT(copied_from=來源) + clone 來源的 rbac_role_permission 全列
--   停用 = UPDATE is_active=0(seed/自建皆可 · can() 排除)· 啟用 = is_active=1
--   刪除 = DELETE,但 is_seed=1 擋(只能停用)· is_seed=0 自建可刪(連帶 ON DELETE CASCADE 清 rbac_role_permission;殘留 user_role_grants 需先回收或告警)
--   改名 = UPDATE display_name_i18n(role_code 不動)

-- B. Function 註冊表(seed 35)
CREATE TABLE rbac_function (
  function_code     VARCHAR2(40) PRIMARY KEY,
  display_name_i18n CLOB,                       -- {zh-TW,en,vi} 三語強制
  module            VARCHAR2(40),               -- PROJECT/BOM/PURCHASE/CLEANSHEET/COST/QUOTE/MASTER/ADMIN/PORTFOLIO
  section_code      VARCHAR2(40),               -- 對 14 superset section · 前台 dispatch
  applicable_verbs  VARCHAR2(200),
  is_field_gated    NUMBER(1) DEFAULT 0,        -- 機密欄受軸③
  display_order NUMBER, is_active NUMBER(1) DEFAULT 1
);

-- C. role × function × verb(IT 後台配置核心)
CREATE TABLE rbac_role_permission (
  role_code     VARCHAR2(80) REFERENCES user_role_definitions(role_code) ON DELETE CASCADE,
  function_code VARCHAR2(40) REFERENCES rbac_function(function_code),
  verb          VARCHAR2(20),
  effect        VARCHAR2(10) DEFAULT 'ALLOW',   -- ALLOW / DENY(deny-wins)
  PRIMARY KEY (role_code, function_code, verb)  -- 相依寫入時展開成顯式列
);

-- D. user × role = 復用 user_role_grants(已多角色 × scope + expires · 不新建)
-- getEffectiveRoles(user) = user_role_grants 全集 · 軸①②③ 共用此全集

-- E. rbac_sod_exclusion(見 §8)· F. rbac_gate_config(見 §9)

-- G. 軸②③ 橋接
ALTER TABLE ai_role_cat_policies ADD (udr_role_code VARCHAR2(80) REFERENCES user_role_definitions(role_code));
ALTER TABLE ai_role_policies     ADD (udr_role_code VARCHAR2(80) REFERENCES user_role_definitions(role_code));
-- resolver 對一 user 取 user_role_grants 全集 → 各 role 政策 allowed_org_ids 取 UNION
-- 新增 VIEW_MARGIN capability 進 ai_data_policy_rules(對齊 VIEW_TRUE_COST)

-- H. bom_settings_admin_grant 退役:verb→軸① · scope→軸② 新類別 · 留 legacy view · 搬遷後 DROP
```

---

## §12 前台落地(v0.12 14 section 權限投影)

- **section→function 1:1 對照表**(`rbac_function.section_code`)當 dispatch 權威源 · 補無主 section:section 2/11 歸 `F_PROJECT.view` 隨附 · section 13 → `F_GAP_ANALYSIS`
- **投影規則**:每 section render 前 `can(view)` 決顯隱(無 view 整段隱藏)· `can(edit)` 決可改/唯讀 · 機密欄查軸③
- **一律查能力不查角色字串**:刪掉所有 `role==='DPM'` / `title.includes('SteelSeries')` / `sub_role===` 硬判 → lock 鈕查 `can(F_BOM_FINAL_LOCK,'lock')` · gate 放行查 `can(F_STAGE_GATE,'gate_confirm')` · reprice 查 `can(F_REPRICE_TRIGGER,'reprice')`。demo v0.12 `sub_role` 從授權字串**降級為純顯示 label**。改角色名(三語)或新建第 N 個 role 都不打爆前台。
- **全貌保留**:所有 section 在同一頁同一 project backbone · 只按 `can()` 投影 · **不回 v0.13 拆頁**
- **角色待辦 home overlay**(選配):多角色者預設入口 = union 待辦收件匣(`user_role_grants` + `project_members` 推「我有 function 權限的待辦案」)· 但 backbone 永遠是案視圖 · `/dpm/review` 等 per-role route 廢
- **SoD/gate 視覺回饋**:lock/approve 鈕 distinct-actor 失敗時 disable + tooltip「你是此案 cost editor,不能自鎖,需他人」· 管理面板「被架空控制點」· role 三軸彙總唯讀視圖(軸① grid + 軸② org 範圍 + 軸③ capability 同頁)· config lint(有 view 但軸③缺 capability → 警示)

**v1.1 demo 落地補充**:

- **IT 入口 = 左 nav「管理」區**(非 topbar 浮動 icon):新增「🔐 權限 / 角色 (RBAC)」+「🔒 機密策略 / 資料政策」兩項。**`can()` gating 直接隱藏**:非 admin(無 F_ROLE_PERM_EDIT / F_DATA_POLICY)看不到該 nav(v0.16 定案 · render() 每次重算 · 另保留 render 層 ⛔ guard 防直連)
- **角色切換 = 登入身分(user identity)**:右上「登入身分」下拉是唯一切角色入口 · 舊「DEMO 視角」(host/member/observer…)切換器退役 · 切 user → 自動橋接機密遮罩
- **IT 後台 = Role×Function 矩陣(唯一寫權處)+ 5 唯讀/管理分頁**:
  - 矩陣:點 verb 格即時改 `rbac_role_permission` · 表頭可 **新建/複製/改名/停用/刪** role(⭐seed 不可刪只可停用 · 🆕自建可刪)· role 顯示三語 display_name(zh / en · 對齊專案三語規則)
  - **三軸彙總**:選 role 顯 ①Function×Verb grid + ②角色↔資料政策(org 範圍)+ ③capability(**可點 toggle 改 → 持該角色 user 遮罩即時變**)+ **角色↔使用者(`user_role_grants` 指派/移除)**· 指派走 **F_ROLE_ASSIGN**(與改權限 F_ROLE_PERM_EDIT **分權** · 無此權僅檢視)
  - SoD 互斥對(5 對 · 見 §8.2)/ Gate 被架空控制點 / Config Lint / **變更稽核 Audit**(權限變更/角色 CRUD/指派/gate-skip/SoD 命中 時間序列)
- **SoD 可視化全 5 對**:section banner 對 checker-end 動作(Final Lock / 廠 Lock / 策略核准 / Baseline 二簽 / Submit×Reprice)出對應鈕 · distinct-actor 命中時 disable + tooltip(maker 來源 = 該案各 maker-function 的最後編輯者 · demo 用 `CASE_MAKERS` · 生產讀 `project_editing_log`)
- **機密策略 / 資料政策畫面**(軸②③ · 見 §6/§7):同頁顯 L1-L4 範圍 + **角色→org live 表** + 欄位 displayStrategy + **各 user 當前 capability live 表**
- **capability 來源 = 角色資料政策衍生**:demo 把 VIEW_TRUE_COST/VIEW_MARGIN 從「寫死在 user」改成「**user 有效 cap = ∪ 各 active 角色的政策 caps**」· 改某角色政策 caps → 持該角色的 user 前台遮罩即時變(= 軸③ 也是「角色對應資料政策」)· 對齊 §7「任一 role 有就有」

---

## §13 既有 demo/SD 衝突重述

- `cortex-role-workspace-sd.md` 衝突1-7「限 DPM lock / BPM 唯一 gate / DPM 核二簽」→ 全重述為「**限持有對應 function-verb 者**」· 角色工作區制(per-role route)作廢 · 只留 seed 角色定義
- v0.13 demo 作廢 · 回 v0.12 + 權限投影

---

## §14 Audit + 管理彙總

- role 三軸彙總唯讀視圖(IT 一眼看某 role 的軸① grid + 軸② 政策/org 範圍 + 軸③ capability + **角色↔使用者清單**)
- config lint:「有 view 但軸③缺 capability → 看得到但全遮」警示
- 所有權限變更 / lock / gate-skip / SoD 命中 → **不可竄改 audit**
- **角色 CRUD audit**:新建/複製/改名(改 display_name)/停用(is_active=0)/刪除 + **指派/移除 user**(`user_role_grants` 異動)全寫 audit(who/when/before-after)· 高敏(授 VIEW_TRUE_COST/VIEW_MARGIN/approve/lock 或停用持有人多的 role)走二簽 + self-grant guard
- 「被架空控制點」面板(open #8:是否週/月推稽核角色)

---

## §15 Migration 分期

| Phase | 範圍 |
|---|---|
| **0** | 拍板(✅ 完成):軸① 復用 user_role_definitions · 軸②③ 吃 user_role_grants 全集 union · gate per-project · DENY deny-wins · 相依寫入展開 · SoD SELF_RECORD 預設 |
| **1** | RBAC 地基 schema:rbac_function(35)+ rbac_role_permission + rbac_sod_exclusion + rbac_gate_config · user_role_definitions 加 **4 欄(is_seed/copied_from/created_by/is_active)** + 12 seed role · 矩陣寫入 · **IT 後台動態 role CRUD(新建/複製/改名 display_name/停用 is_active/刪 + 指派 user)** |
| **2** | 軸②③ 橋接:新政策類別「BOM 報價成本資料權限」(前台 = 機密策略畫面)· udr_role_code 橋接欄 · VIEW_MARGIN capability · **capability 由角色政策衍生(user cap = ∪ 角色 caps)** · 雙寫驗證 allowed_org_ids |
| **3** | `can()` 解析引擎 + SoD/gate 硬約束:全鏈 · isGateActive · distinct-actor · self-grant guard · 二簽 · audit(含角色 CRUD/指派 audit) |
| **4** | 前台 v0.12 投影:section→function 對照 · render 查 can() · 拔 role 字串硬判 · margin 反推鎖 · SoD 鈕 + 管理面板 + lint · **IT 入口進左 nav(可見+🔒 gating)· 登入身分切角色 · 三軸彙總含角色↔使用者** |
| **5** | reprice/unlock 回圈:unlock verb · force_release · path B 不卡死 |
| **6** | bom_settings_admin_grant 退役:搬遷 + 雙寫 + 切讀取點 + legacy view + DROP |
| **7** | 角色待辦 overlay + 收尾:per-role route 廢 · IT 配置 SOP(過授風險提示) |

---

## §16 待 user 拍(open · 不阻塞 Phase 1)

1. 軸②③ 橋接走 **(A) udr_role_code 雙軌 resolver**(快 · 兩套 role 並存一段)還 **(B) 一次正規化單一 role 世界**(乾淨但動既有 LLM/KB/training · 風險大)?legacy roles 要不要一起收?
2. 跨 BG「經管(集團級)」union 對高敏 master edit 要不要改 **intersection**(避免解出全廠編輯權)?
3. `F_QUOTE_APPROVE` 預設給誰(BPM/GM_BG)· 預設啟用?還是不設只留 submit≠reprice 互斥當底線?
4. `F_DATA_POLICY` 下放 GM_BG/經管 在自己 BG scope?還是 admin-only 集中?(demo v0.15 暫 **admin-only** · 機密策略畫面只 admin 開得了)
5. `F_ROLE_PERM_EDIT` 二簽在只有一個 admin 的小單位會不會卡 → 要不要 fallback 上拋?
6. `F_PROJECT` 補 delete verb(admin+owner DRAFT)還是只 close?
7. 「被架空控制點」面板定期推稽核?

---

**完。** 細部設計收斂(三軸 + 動態多角色 + SoD 硬約束 + 稽核 8 high 全修)· 軸① 掛 `user_role_definitions`(非 AI 角色 · 非新表)· 前台回 v0.12 全貌 + 權限投影 · 可進 Phase 1 實作。
