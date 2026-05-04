# Cortex 通用專案管理平台 — Phase 1 啟動 Checklist

> 對應規格書:[projects-platform-spec.md](./projects-platform-spec.md) v0.4
> 用途:Phase 1 開工前需要確認 / 補齊的所有資料,可逐項 check off
> 維護:由 PM / IT 主導填寫,各部門協助提供
>
> **使用方式**:每項打勾後填入答案;有 TBD 的項目要明確指派負責人 + due date。

---

## 進度總覽

| 大塊 | 完成度 | 狀態 |
|---|---|---|
| 🔴 必補(kickoff 前) | 0 / 4 | ⏳ 待填 |
| 🟡 開發中補 | 0 / 3 | ⏳ 待填 |
| 🟢 Pilot 後補 | 0 / 2 | 📅 後處理 |
| 🔵 Future Phase | 0 / 5 | 📅 後處理 |

---

# 🔴 必補 — Phase 1 kickoff 前

## 1.1 組織結構

### 組織層級深度
- [ ] **層級結構確認**(對應 §17.5.2)

```
我公司的層級是:
   ☐ BG > BU > sub-BU > DEPT
   ☐ BU > sub-BU
   ☐ 其他: ___________________________________

sub-BU 對應於:
   ☐ 處 / 部 / 課 / 事業部 / ___________________
```

### 組織列表
- [ ] **填入完整組織清單**

```
BG(若有):
  - BG-1 名稱: __________  簡稱: __________  GM: __________
  - BG-2 名稱: __________  簡稱: __________  GM: __________
  - ...

BU(每 BG 下):
  BG-1:
    - BU-1A 名稱: __________  主管: __________
    - BU-1B 名稱: __________  主管: __________
    - ...

sub-BU / 處 / 部:
  BU-1A:
    - sub-1A-x 名稱: __________  主管: __________
    - ...
```

### user 隸屬關係
- [ ] **批次 user list**(可從 HR / LDAP dump CSV)

```
CSV 欄位: user_id, name, employee_id, primary_bu_id, additional_bu_ids, current_role
範例:
  E12345, 王小明, 12345, BU-1A, [BU-1B], project.sales
  E12346, 李大華, 12346, BU-1A, [], project.pm
```

### 兼任人員
- [ ] **跨 BU 兼任名單**(若有)

```
人員: __________  主 BU: __________  兼任 BU: __________  原因: __________
人員: __________  主 BU: __________  兼任 BU: __________  原因: __________
```

---

## 1.2 Day 0 角色名單

> ⚠ 必須:**admin × 1 + project.sales × 1 + project.pm × 1 至少各 1 人**(Pilot 啟動最小集)

### admin 名單(IT 部門)
- [ ] **admin 人選**

```
主要 admin:
  1. ____________  email: ____________
  2. ____________  email: ____________

Backup admin:
  1. ____________  email: ____________

(最少 2 主 + 1 backup,避免單點)
```

### top_director(最高層主管)
- [ ] **top_director 名單**

```
1-3 人,看全公司專案唯讀
  1. ____________  職稱: ____________
  2. ____________  職稱: ____________
```

### bu_director(BU 主管 / 處級)
- [ ] **每 BU 至少 1 位 bu_director**

```
BU-1A: ____________(可授多 BU,例:處長管 1A + 1B → 授 [1A, 1B])
BU-1B: ____________
BU-1C: ____________
...

跨多 BU 授權的(如 GM):
  人員: ____________  授予 BU: ____________
```

### 平台運維角色
- [ ] **workflow.admin**(編 SYSTEM workflow template)

```
1-2 人(IT)
  1. ____________
  2. ____________
```

- [ ] **data.connection_manager**(管 ERP/SFC 連線)

```
1-2 人(IT)
  1. ____________
  2. ____________
```

- [ ] **notification.editor**(編 SYSTEM 通知規則)

```
1-2 人
  1. ____________
  2. ____________
```

- [ ] **confidential.policy_editor**(編機密欄位策略)

```
admin + 法務 / 財務代表
  1. ____________(IT)
  2. ____________(法務 or 財務)
```

### 業務 / PM 全員授權
- [ ] **project.sales 範圍**

```
業務部全員(LDAP group → admin 批次授)
  業務部 LDAP group 名稱: ____________
  預估人數: ____________
```

- [ ] **project.pm 範圍**

```
PM 部全員
  PM 部 LDAP group 名稱: ____________
  預估人數: ____________
```

---

## 1.3 業務 SOP 預設值

> 對應 §18.1.4「IT 角色扮演」— 開工前 IT 仍要有預設值跑流程驗證

### Workflow QUOTE_STANDARD stages + 預設 SLA
- [ ] **Stage 順序 + SLA 時數**

```
建議沿用 v0.3.5 8 階段:
  1. 收單 (DRAFT)         SLA: ___ h(預設 2h)
  2. 評估 (EVALUATING)    SLA: ___ h(預設 4h)
  3. 詢價 (QUOTING)       SLA: ___ h(預設 8h)
  4. 核算 (COSTING)       SLA: ___ h(預設 8h)
  5. 策略 (STRATEGY)      SLA: ___ h(預設 4h)
  6. 審核 (APPROVING)     SLA: ___ h(預設 4h)
  7. 送出 (SUBMITTED)     SLA: ___ h(預設 2h)
  8. 結案 (CLOSED)        SLA: 不計

確認:☐ 沿用  ☐ 修改如上
```

- [ ] **各 stage 進入時自動建哪些 task?**(對應 task templates)

```
COSTING stage on_enter:
  ☐ 自動建「BOM 展開」task
  ☐ 自動建「中國廠核算」task
  ☐ 自動建「越南廠核算」task
  ☐ ____________

STRATEGY stage on_enter:
  ☐ 自動建「廠區比較決策」task
  ☐ ____________
```

### 廠區清單
- [ ] **支援的廠區**

```
☐ 中國(CN)
☐ 越南(VN)
☐ 印度(IN)
☐ 其他: ____________
```

### Tier 邊界(金額 USD)
- [ ] **金額 Tier 範圍**(沿用 v0.3.5 提案,確認 / 調整)

```
XS  < ___ K USD       (建議 50K)
S   ___ K - ___ K USD (建議 50K-200K)
A   ___ K - ___ M USD (建議 200K-1M)
B   ___ M - ___ M USD (建議 1M-5M)
C   ___ M - ___ M USD (建議 5M-20M)
D   > ___ M USD       (建議 20M+)

確認:☐ 沿用  ☐ 修改如上
```

### 毛利率 Tier 邊界
- [ ] **毛利率分級**

```
Loss     < 0%
Thin     0-5%
Low      5-10%
Mid      10-18%
High     18-30%
Premium  > 30%

確認:☐ 沿用  ☐ 修改如下:
   ____________________________
```

### 客戶報價系統 Excel 範本
- [ ] **取得一份 sample Excel**(讓 IT 跑 cell binding 驗證)

```
☐ 已取得 sample Excel(filename: ____________)
☐ 暫無,IT 用 dummy 範本驗證機制
☐ 客戶報價系統承辦人: ____________  email: ____________
```

---

## 1.4 環境 / 整合對接

### ERP / DB 連線
- [ ] **連線清單**

```
ERP-CN-readonly:
  Endpoint: ____________
  Port: ____________
  Read-only role 名稱: ____________
  Phase 1 day 0 開放的 procedure / table:
    - ____________
    - ____________

ERP-VN-readonly:
  ____________

SFC:
  ____________

BI / DW:
  ____________

其他 API:
  - ____________
```

### Pilot 候選 RFQ 案
- [ ] **業務推薦 1-2 個案**(對應 §18.2.1 候選條件)

```
案 1:
  案號 / 客戶: ____________ / ____________
  料號: ____________
  廠區候選: ____________
  BOM 深度: ___ 層
  金額預估 Tier: ____________
  PM 陪跑承諾: ☐ 是  ☐ 否

案 2:
  ____________
```

---

# 🟡 開發中補 — Phase 1 跑到一半時

## 2.1 QUOTE plugin 詳細

- [ ] **Form fields 完整清單**(IT 角色扮演 + 開工後業務微調)

```
預估 30-50 個 field。建議分 sections:
  Section 1: 基本資料(客戶/料號/數量/交期/...)
  Section 2: BOM 展開
  Section 3: 詢價
  Section 4: 中國廠核算(料費/工時/管銷/物流)
  Section 5: 越南廠核算
  Section 6: 印度廠核算
  Section 7: 廠區比較
  Section 8: 策略決策

每 field 標:
  - field_key
  - data_type
  - source_type (manual / erp_proc / custom_sql / computed)
  - owner_role
  - is_confidential_default (☐)

(IT 開工後製表填,業務 review 一次)
```

- [ ] **LLM scrub_rules**(QUOTE plugin)

```
客戶名 alias 對應表:
  Apple → A001
  Sony  → S001
  ____________

金額 → Tier 規則:走 confidential_field_policies(Tier 邊界已定)

廠區 → 簡稱:
  中國廠 → CN
  越南廠 → VN
  印度廠 → IN
```

- [ ] **Task templates**(對應 v0.3.5 6 套)

```
BOM_EXPAND:
  - 標準件 BOM
  - 新料識別
  - 替代料

SOURCING:
  - A 供應商詢價
  - B 供應商詢價
  - C 供應商詢價

COSTING_CN:
  - 料費
  - 工時
  - 管銷
  - 物流

COSTING_VN: 同 CN

STRATEGY:
  - 廠區比較
  - 客戶歷史
  - 競品分析
  - 建議

CUSTOM:
  - 空白
```

## 2.2 Notification 規則初始

- [ ] **Phase 1 SYSTEM scope 預設規則**

```
TASK_OVERDUE:
  - 0 min: task_owner / 通道:webex + in_app
  - 30 min: task_owner + project_host / webex + in_app
  - 2h: project_host + project_director / webex + email + in_app

TASK_AT_70:
  - 0 min: task_owner / webex + in_app

DECISION_NEW:
  - 0 min: 該專案全 active member / in_app(訊息流自動)

BLOCKER_NEW:
  - 0 min: project_host / webex + in_app
  - 30 min: project_host + bu_director / webex + email

(IT 寫 first cut,Pilot 中調整)
```

## 2.3 機密策略初始

- [ ] **confidential_field_policies seed**

```
Field           Strategy   Default Confidential
────────────────────────────────────────────────
amount          TIER       1
margin          TIER       1
cost_breakdown  TIER       1
customer_name   ALIAS      0(機密專案 default,但業務可選)
labor_cost      TIER       1
overhead        TIER       1
quantity        RANGE      0
delivery_date   (明文)    0
part_number     (明文)    0
```

---

# 🟢 Pilot 期間或之後補

## 3.1 治理 / 法務文件化

- [ ] **audit log retention 政策法務確認**(目前永久保留)
- [ ] **緊急 break-glass 流程 SOP**(IT 主管核准 / 通知層級)
- [ ] **admin testing mode 觸發通知 BU 主管條件**(每次?critical 操作才?)
- [ ] **機密欄位策略每年 review cadence 文件**

## 3.2 UI / UX 風格確認

- [ ] **Form Builder GUI 風格**(typeform-like / google forms / 自定?)
- [ ] **Excel cell binding UI**(luckysheet 預設?)
- [ ] **戰情會議室 UX 細節**(沿用 §13.1 草圖 / 改)
- [ ] **儀表板 widget 顏色 / 圖示風格**
- [ ] **機密專案視覺差異化**(冷色調 / banner?)

---

# 🔵 Future Phase 才需要

- [ ] 客戶報價系統 API 規格(待對方 ready)
- [ ] 多級簽核 approval 路由規則(P3 reviewer)
- [ ] 教育訓練 ↔ 專案平台雙向整合需求(P4)
- [ ] 競品對標庫初始資料(P4)
- [ ] NPI 量產成本 closed-loop 數據源(P4)

---

# 預估時程建議

```
Week 0 ─────── 收到此 checklist
Week 1 ─────── 1.1 組織結構 + 1.2 角色名單(問 HR / IT)
Week 2 ─────── 1.3 業務 SOP 預設(問業務主管)
Week 3 ─────── 1.4 環境對接(IT 自己跑 + 業務推薦 Pilot 案)
Week 4 ─────── ✅ Phase 1 kickoff!
Week 4-12 ── Phase 1 開發 + 2.x 邊跑邊補
Week 13-16 ─ Pilot + 3.x 補
```

---

# 異動紀錄

| 日期 | 修改人 | 內容 |
|---|---|---|
| 2026-04-30 | 資訊部 | 初版建立 |

— 本文件結束 —
