# Cortex RBAC · 功能 × 權限矩陣設計(WIP · 非 SD)

> **版本**:draft-0.1 / 2026-06-26
> **狀態**:細部設計討論中 — RBAC 地基 · 收斂後才寫 SD
> **原則**(user 2026-06-26 拍板):角色不寫死。IT 後台建 ROLE → 對每個 FUNCTION 指定 verb(view/create/edit/delete/action)。三軸授權。
> **回歸 base**:v0.12 project-centric 單一視圖(全貌)· 角色待辦 home 當選配 overlay · v0.13 角色工作區制不採用
> **關聯**:[cortex-role-workspace-sd.md](cortex-role-workspace-sd.md)(角色/handoff 來源 · 工作區制部分作廢 · 角色定義保留為 seed)· [cortex-unified-architecture-sd.md](cortex-unified-architecture-sd.md)(superset section = function 對應源)

---

## §1 三軸授權模型(標準 RBAC + ABAC 混合)

```
能不能做某操作 = ① Function×Verb  AND  ② Data Scope  AND  ③ Field Sensitivity
                  (新建 RBAC)         (既有資料權限管理 新類別)  (既有 VIEW_TRUE_COST)
              ＋ 正交:costing_model(案需要什麼)· stage/lock(現在能不能)
```

| 軸 | 答 | 放哪 |
|---|---|---|
| ① Function × Verb | 「能做什麼操作」 | 🆕 function-RBAC · 掛共用 ROLE |
| ② Data Scope | 「能碰哪些 org/案 紀錄」 | 既有資料權限管理 + 新政策類別(L3 部門/L4 ERP Multi-Org)→ `allowed_org_ids` |
| ③ Field Sensitivity | 「看不看 true cost/markup」 | 既有 `ai_data_policy_rules` VIEW_TRUE_COST(D10 單一源) |
| ＋ costing_model(正交) | 「這案要算 IDL 嗎」= 案 capability · **非權限** | `bom_factory_baseline.costing_model` + component mask |
| ＋ stage/lock(正交) | 「現在能編嗎」= workflow 狀態 · RBAC 說 may,workflow 說 now | `project_stages` + `*.status=locked` + single-edit lock |

> 退役:`bom_settings_admin_grant`(混了 scope+verb)→ scope 進軸②、verb 進軸①。

---

## §2 Function 註冊表(~32 個 · 對齊 superset section + gate 動作)

> 顆粒度 = superset section / 關鍵操作。每 function 宣告適用 verb 集。

### 案生命週期
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_PROJECT` | 案基本/開案 | view · create · edit |
| `F_STAGE_GATE` | Stage gate 放行 | view · gate_confirm |
| `F_PROJECT_CLOSE` | 結案(WIN/LOSS/HOLD) | view · close |
| `F_MEMBER_INVITE` | 角色邀請 + field_grants | view · edit |
| `F_REDACT_APPROVE` | 結案脫敏審核(D11) | view · approve |

### BOM(Stage 4)
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_BOM_STRUCTURE` | BOM 階層(module/section/category/item) | view · create · edit · delete |
| `F_BOM_ERP_MATCH` | ERP 料號比對確認 | view · edit |
| `F_BOM_VARIANT_SCOPE` | variant scope 標記 | view · edit |
| `F_BOM_SUBMIT` | RD 提交交棒 | submit |

### 採購(Stage 5)
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_PURCHASE_STRATEGY` | mfg / snapshot / price tier(雙價) | view · create · edit · delete |
| `F_ERP_PRICE_LOOKUP` | ERP 歷史價查詢 | view(scope 走軸②) |
| `F_PACKAGING_CONFIG` | 包裝 BOM / PKG SKU 矩陣 | view · create · edit |
| `F_PURCHASE_STRATEGY_APPROVE` | 採購策略核可 gate | view · approve |

### Cleansheet / MVA(Stage 5 · EPM)
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_CASE_PROCESS` | 案級製程(細製程/macro/SMT/IDL/設備/耗材) | view · create · edit |
| `F_COMPUTE_RUN` | 觸發 compute | view · run |
| `F_FACTORY_LOCK` | 廠 Lock(per case_factory) | view · lock |

### Cost Review(Stage 6 · DPM)
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_COST_MATRIX` | 多維成本矩陣 | view(field 走軸③) |
| `F_MARGIN_ANALYSIS` | margin heatmap / Top markup | view |
| `F_COST_REVIEW` | review session / flag | view · edit |
| `F_BOM_FINAL_LOCK` | final lock + propagate | view · lock · propagate |
| `F_BASELINE_SECOND_SIGN` | baseline 漲幅二簽 | view · approve |

### 報價(Stage 7-8 · 業務)
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_QUOTE_EXPORT` | RFQ Cost Excel 匯出 | view · export |
| `F_QUOTE_SUBMIT` | Submit Quote | submit |
| `F_REPRICE_TRIGGER` | 議價 reprice 退回 | reprice |
| `F_NRE_STRATEGY` | NRE / 議價策略板 | view · edit |

### Master(設定 · 廠級/平台級)
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_FACTORY_BASELINE` | 廠 baseline 維護(SCD) | view · create · edit |
| `F_EQUIP_CATEGORY` | 設備類別 catalog + 單價 | view · create · edit · copy |
| `F_WAGE_MASTER` | DL/IDL Line-Dep/Centralized wage | view · edit |
| `F_SMT_POINT_RULE` | SMT 點數規則(算式字串) | view · edit |
| `F_CONSUMABLE_MASTER` | 耗材庫 + 料號 | view · edit |
| `F_COSTING_MODEL_MASK` | costing_model × component mask | view · edit |
| `F_PROCESS_TEMPLATE` | 製程模板 | view · edit |

### 權限/管理
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_ROLE_PERMISSION` | function-RBAC 後台(建 role / 派 function) | view · edit |
| `F_DATA_POLICY` | 資料權限管理(軸②③) | view · edit |
| `F_USER_BG_SYNC` | 使用者 BG/部門同步 | view · edit |

### Portfolio(唯讀)
| code | 名稱 | 適用 verb |
|---|---|---|
| `F_PORTFOLIO_BG` | 該 BG 跨案 portfolio | view |
| `F_PORTFOLIO_GLOBAL` | 集團跨案 portfolio | view |

---

## §3 Verb 集(可擴 · 每 function 宣告適用)

| 類 | verb | 說明 |
|---|---|---|
| CRUD | `view` `create` `edit` `delete` | 資料型 function |
| Action | `submit` `approve` `gate_confirm` `lock` `propagate` `export` `reprice` `close` `run` `copy` | 動作型 function |

相依驗證(避免 IT 配出破洞):`edit/delete/lock/approve/export ⊃ view`(給高階 verb 自動含 view)· `propagate ⊃ lock`。

---

## §4 Scope(軸② · 既有資料權限管理新類別)

新增政策類別 **「BOM 報價成本資料權限」**,內含政策(對齊現有 4 層):

```
政策例「光電 BG BOM 權限」:
  L1 使用者過濾  未設(不過濾)
  L2 角色過濾    role:採購, role:EPM(光電)
  L3 組織過濾    光電製造處 + 各廠部門
  L4 ERP Multi-Org  OPTO operating units(CN/VN/TW org_id)
  → 解出 allowed_org_ids · 套用於 F_ERP_PRICE_LOOKUP / F_BOM_ERP_MATCH / F_FACTORY_BASELINE 等碰 ERP 資料的 function
```

| scope 種類 | 由誰決定 |
|---|---|
| ERP org 範圍(能匯入/查哪些 OU 資料) | 資料權限管理 L3+L4(user 部門→org) |
| BG/BU 隔離(能看哪些案) | 同上 · L3 組織對 BG/BU |
| ASSIGNED_ONLY(只我被指派的案) | `project_members` |
| OWN(自己建/owner) | `projects.pm_user_id` 等 |

---

## §5 Field Sensitivity(軸③ · 既有 · D10)

- VIEW_TRUE_COST = `ai_data_policy_rules` 的 capability · 控 `true_cost / mva / markup / gross_margin` 是否打 ▒
- 分級:`markup_pct/gross_margin` = 🔒🔒(每 access 寫 audit)· `true_cost/mva` = 🔒 · `quote` = 🟢
- 不另開 · 單一源

---

## §6 Seed Role × Function 權限矩陣(預設 10 角色 · 可改/可複製/可新建)

> 這 10 個是**開箱預設模板**,不是寫死 enum。IT 可改任一格、複製出第 11 個(如「廠採購」只給單廠 scope)。
> 格內 = 給的 verb。空 = 無此 function 權限(UI 該 section 隱藏)。

| Function \ Role | BPM | RD | 採購 | EPM | DPM | 業務 | 採購主管 | admin | GM_BG | 董事長 |
|---|---|---|---|---|---|---|---|---|---|---|
| F_PROJECT | CRUD | v | v | v | v | v | v | v | v | v |
| F_STAGE_GATE | gate | | | | | | | | | |
| F_PROJECT_CLOSE | close | | | | | close | | | | |
| F_MEMBER_INVITE | v·e | | | | | | | v·e | | |
| F_REDACT_APPROVE | | | | | | | | | approve | approve |
| F_BOM_STRUCTURE | v | CRUD | v | | v | | | | v | v |
| F_BOM_ERP_MATCH | | v·e | v | | | | | | | |
| F_BOM_VARIANT_SCOPE | | v·e | | | | | | | | |
| F_BOM_SUBMIT | | submit | | | | | | | | |
| F_PURCHASE_STRATEGY | v | | CRUD | | v | | v | | | |
| F_ERP_PRICE_LOOKUP | | | v | | v | | v | | | |
| F_PACKAGING_CONFIG | v | | v·c·e | | v | | | | | |
| F_PURCHASE_STRATEGY_APPROVE | | | | | | | approve | | | |
| F_CASE_PROCESS | v | | | CRUD | v | | | | | |
| F_COMPUTE_RUN | | | | run | | | | | | |
| F_FACTORY_LOCK | | | | lock | v | | | | | |
| F_COST_MATRIX | v | | v | v | v | v | v | | v | v |
| F_MARGIN_ANALYSIS | v | | | | v | v | v | | v | v |
| F_COST_REVIEW | | | | | v·e | | | | | |
| F_BOM_FINAL_LOCK | v | | | | lock·prop | | | | | |
| F_BASELINE_SECOND_SIGN | | | | | approve | | | | | |
| F_QUOTE_EXPORT | export | | | | | export | | | | |
| F_QUOTE_SUBMIT | submit | | | | | submit | | | | |
| F_REPRICE_TRIGGER | | | | | | reprice | | | | |
| F_NRE_STRATEGY | v | | | | | v·e | | | | |
| F_FACTORY_BASELINE | | | | v·c·e | v | | | v·c·e | | |
| F_EQUIP_CATEGORY | | | | v·e | | | | CRUD·copy | | |
| F_WAGE_MASTER | | | | v·e | | | | v·e | | |
| F_SMT_POINT_RULE | | | | v·e | | | | v·e | | |
| F_CONSUMABLE_MASTER | | | v | v·e | | | | v·e | | |
| F_COSTING_MODEL_MASK | | | | | | | | v·e | | |
| F_PROCESS_TEMPLATE | | | | v | | | | v·e | | |
| F_ROLE_PERMISSION | | | | | | | | v·e | | |
| F_DATA_POLICY | | | | | | | | v·e | | |
| F_USER_BG_SYNC | | | | | | | | v·e | | |
| F_PORTFOLIO_BG | | | | | | | | | view | |
| F_PORTFOLIO_GLOBAL | | | | | | | | | | view |

> `CRUD`=view+create+edit+delete · `v`=view · `v·e`=view+edit · `gate`=gate_confirm · `prop`=propagate
> 機密欄(F_COST_MATRIX/F_MARGIN_ANALYSIS 的 true cost)再受軸③ VIEW_TRUE_COST gate:RD 無 → 不在矩陣(根本沒 view);業務初階無 VIEW_TRUE_COST → 有 view 但 true cost 打 ▒。

### §6.1 Refinement(2026-06-26 user 拍板 · 全強化動態性)

| # | 拍板 | 矩陣調整 |
|---|---|---|
| **R1** | 廠級 master「EPM 維護 + 權限設給**經管**」· 不寫死 | 新增 seed role **`經管(PLANNING)`** · `F_FACTORY_BASELINE/F_EQUIP_CATEGORY/F_WAGE_MASTER/F_SMT_POINT_RULE/F_CONSUMABLE_MASTER` 預設給 **EPM + 經管 + admin**(各單位可自配誰維護) |
| **R2** | 採購策略 approve **單層 + 很多單位不簽** | `F_PURCHASE_STRATEGY_APPROVE` = **可選 gate** · gate 啟用 = 「有任一 role 持此 function」· 沒人持 → workflow 自動跳過此 gate(不卡流程)· 採購主管單層(不疊 DPM) |
| **R3** | 業務/業助/BPM **互相 cover** | 新增 seed role **`業助(SALES_ASSIST)`** · 業務/業助/BPM function 集**大量重疊**(F_PROJECT/F_QUOTE_*/F_COST_MATRIX 共通)· **多角色 per user · union** · 一人可同時掛 BPM+業務+業助 |
| **R4** | gate 普遍**可選** | 所有 gate(F_STAGE_GATE/F_PURCHASE_STRATEGY_APPROVE/F_BASELINE_SECOND_SIGN/F_REDACT_APPROVE)= 「有人持 → 啟用 · 沒人持 → 跳過」· gate 存在性 **config-driven**(org/project 級),非硬編 |

→ 新增 2 seed role(經管 / 業助)後 **共 12 seed role** · 全部可改/複製/刪(seed 不可刪只可停用)。
> **核心**:seed 矩陣只是「開箱預設」· 真實分工由 IT 在後台按單位調(有些單位 EPM 不碰 master 改給經管 · 有些採購主管不簽 · 業務一人兼三役)。系統**不假設任何角色固定持有任何 function**。

---

## §7 Function-RBAC schema(軸① · 新建 · 掛共用 ROLE)

```sql
-- function 註冊表(seed 32 個 · 系統維護)
CREATE TABLE rbac_function (
  function_code   VARCHAR2(40) PRIMARY KEY,   -- 'F_BOM_STRUCTURE'
  display_name_zh VARCHAR2(100),
  module          VARCHAR2(40),               -- PROJECT/BOM/PURCHASE/CLEANSHEET/COST/QUOTE/MASTER/ADMIN/PORTFOLIO
  applicable_verbs VARCHAR2(200),             -- 'view,create,edit,delete'(該 function 適用 verb 集)
  display_order   NUMBER, is_active NUMBER(1) DEFAULT 1
);

-- ROLE(可配置 · seed 10 個但可改/複製/新建)· 若既有資料權限管理已有 role 表則復用,不新建
CREATE TABLE rbac_role (
  role_code       VARCHAR2(40) PRIMARY KEY,   -- 'BPM' / 'BUYER' / 'FACTORY_BUYER_CN'(IT 自建)
  display_name_zh VARCHAR2(100),
  is_seed         NUMBER(1) DEFAULT 0,        -- 1=系統預設模板(可改不可刪)
  copied_from     VARCHAR2(40),               -- 複製來源 role
  created_by      NUMBER REFERENCES users(id),
  is_active       NUMBER(1) DEFAULT 1
);

-- role × function × verb(IT 後台配置的核心)
CREATE TABLE rbac_role_permission (
  role_code     VARCHAR2(40) REFERENCES rbac_role(role_code) ON DELETE CASCADE,
  function_code VARCHAR2(40) REFERENCES rbac_function(function_code),
  verb          VARCHAR2(20),                 -- 'view'/'edit'/'approve'/'lock'/...
  effect        VARCHAR2(10) DEFAULT 'ALLOW', -- ALLOW / DENY(deny 覆寫聯集)
  PRIMARY KEY (role_code, function_code, verb)
);

-- user × role(多角色 · 復用既有「角色/使用者指派」若有)
CREATE TABLE rbac_user_role (
  user_id   NUMBER REFERENCES users(id),
  role_code VARCHAR2(40) REFERENCES rbac_role(role_code),
  PRIMARY KEY (user_id, role_code)
);

-- 有效權限解析(快取或 runtime):
--   can(user, function, verb) =
--     EXISTS ALLOW in (user's roles) AND NOT EXISTS DENY
--     AND 軸② scope 通過(資料權限管理 allowed_org/案 scope)
--     AND 軸③ field 通過(若該 verb 碰機密欄)
--     AND stage/lock 允許(workflow 狀態)
```

退役 `bom_settings_admin_grant`:scope 欄 → 資料權限管理新類別;verb 欄 → `rbac_role_permission`。

---

## §8 整合既有 + 前台落地

### 與既有資料權限管理整合(軸②③)
- 新增政策類別「BOM 報價成本資料權限」(§4)· 走既有 L1-L4
- VIEW_TRUE_COST 留既有(§5)
- **ROLE 共用**:`rbac_role` 若能直接用既有 role 表則不新建(待確認 · §0 問題)

### 前台(v0.12 project 視圖 + 權限 gate)
- v0.12 的 14 section dispatch 已是對的結構 → 每 section 對一 function,render 前查 `can(user, F_xxx, 'view')` 決定顯示/隱藏,查 `'edit'` 決定可改/唯讀,機密欄查軸③
- **全貌保留**(所有 section 在一頁)· 但按權限投影
- 角色待辦 home(選配 overlay):從 `rbac_user_role` + `project_members` 推「我有哪些 function 權限的待辦案」當收件匣,但 backbone 是案視圖

### 待確認(收斂後寫 SD)
1. ⭐ 既有「資料權限管理」的角色是否正式 role 表(決定 `rbac_role` 復用 vs 新建 vs 正規化)
2. function 顆粒度 32 個夠不夠(要不要再拆/合)
3. verb 相依驗證規則(§3)是否照此
4. deny 覆寫是否需要(多角色聯集時)
5. seed 10 role 預設矩陣(§6)各格對不對

---

**WIP** · 矩陣 + schema 為 RBAC 地基 · 收斂 §8 待確認後寫正式 RBAC SD · 前台回 v0.12 project 視圖 + 權限 gate。
