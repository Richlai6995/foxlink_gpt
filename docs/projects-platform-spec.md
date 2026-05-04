# Cortex 通用專案管理平台 — 規劃書

> **狀態**:v0.4 規劃稿(取代 [quote-system-spec.md](./quote-system-spec.md) v0.3.5 的核心定位)
> **日期**:2026-04-29 最後更新
> **作者**:資訊部
> **重大轉折**:從「業務報價特化系統」轉為「通用專案管理平台 + 報價是其中一種 project_type」
>
> 本文件用於對齊架構決策,**尚未進入實作**。schema、API、UI 細節留給後續 design doc。

---

## 本次討論已決議事項(2026-04-28 / 04-29 集中討論)

### 機密 / 加密(§4)
- ✅ 二分法 + 欄位級可選(`is_confidential` + `confidential_fields`)
- ✅ 機密 → 非機密不可逆(走結案 fork 脫敏分支取代)

### 部署 / 整合(§1, §10)
- ✅ 整合 Cortex 主入口(放棄獨立 hostname、Step-up 2FA)
- ✅ Chrome Extension 不阻擋(改強化 ACL + 稽核)
- ✅ 對外不直接面向客戶,完成單價交給下游「客戶報價系統」(Phase 1-3 人工傳 Excel,Future API 串接)

### Workflow + Plugin(§5, §9)
- ✅ Workflow Template 三層 scope(SYSTEM/BU/USER)
- ✅ Project Type 僅 admin 可建,PM 不可自加
- ✅ Quote 特化保留,搬進 QUOTE plugin

### KB 雙層(§7)
- ✅ Live KB(per-project)+ 沉澱 KB(cross-project)
- ✅ 全平台訊息 / 檔案 / KB **永久保留**(除非 emergency purge)
- ✅ 機密 / 非機密 KB 物理分開
- ✅ scrub 在 archive 階段完成,不在 query 時跑

### 結案 Fork(§8)
- ✅ 結案 fork 出 declassified project(不可逆)

### Form 引擎(§11)
- ✅ GUI Form Builder Phase 1 一次到位
- ✅ Single-edit lock(同時間一人 edit)
- ✅ FINAL 鎖定後 admin 可解鎖 + 自動建新版本(支援結案後補資料)
- ✅ 全版本保留
- ✅ ERP 失敗 fallback 給原 owner(非 PM)
- ✅ Excel 公式預設不 evaluate,提供「pre-evaluate」按鈕走 LibreOffice headless
- ✅ Excel Import / Export(form / workflow / task)Phase 2

### AI Bot(§12)
- ✅ Bot = user 代理人(權限體系維持單一)
- ✅ 跨專案查詢預設開放(同 BU internal + public)
- ✅ Token per-project 計量,不卡 user(只 warn)
- ✅ AI 建議按鈕走 cache + inputs_hash
- ✅ Bot 自動加入聊天室,機密專案加重提醒
- ✅ Phase 1 白名單 action:建 task + Form 欄位建議
- ✅ 雙段 scrub(掩碼 + 替回)

### AI 加速 10 項 + 開案 Wizard(§12.10)— Phase 1 末上線
- ✅ ⭐ **狀態 SUMMARY**(announcement Pin + 專案列表 + Watchlist hover 三處顯示)
- ✅ ⭐ **開案 7 步驟 Wizard**(整合 #1 / #2 / #32 / #37,業務開案從 30min → 5min)
- ✅ #1 客戶 RFQ 自動解析(預填 form)
- ✅ #2 歷史相似案推薦 + 建議 PM
- ✅ #5 Q&A 問題自動草稿
- ✅ #23 AI 自動寫決策紀錄
- ✅ #24 未讀訊息智慧排序(@我 / DECISION / BLOCKER 排前)
- ✅ #26 Bot 主動提醒(SLA 接近自動 @owner)
- ✅ #29 任務自動拆解(一句話 → 子任務 + 估時 + 推 owner)
- ✅ 加分(2 項):#32 交期合理性 / #37 歷史案主動推薦
- ❌ **移除**(2026-05-04):#10 長料件預警(試產轉量產才需要)/ #14 三廠對比 AI 解讀(廠區客戶指定,移到未來規劃)
- ✅ 走 Gemini Flash;預估 USD $150-250 / 月
- ✅ Phase 2 / 3 已規劃 13 項深化(Cleansheet 草稿 / 智慧定價 / 主管日報 / ML 預測等)

### 戰情會議室(§13)— v0.4 重構為多 Channel 模型
- ✅ 從「一專案一聊天室」改為 **Slack/Teams 風格多 channel**
- ✅ Channel types:announcement / general / group / topic / dm 五種
- ✅ DM 1對1 私聊 **Phase 1 直接上**(原規劃 P2 提前)
- ✅ QUOTE plugin 預設 7 channels(announcement + general + qa-customer + engineering + sourcing + factory + cost-review)
- ✅ 誰能建 channel:group 限 HOST;topic 任何 member;dm 雙方任一
- ✅ announcement 每則必須已讀回執
- ✅ 跨 channel 通知:作者勾「同步公告」才推 DECISION 到 announcement
- ✅ Channel 可歸檔不能硬刪;結案自動全歸
- ✅ chat_guest 支援(機密走業務 / PM 雙簽)
- ✅ super_user 機制(GLOBAL / BU 兩級主動 self-join,可選寫權)
- ✅ Bot context per-channel + 跨 channel RAG;不做 compact
- ✅ 階段性 summary Phase 2 上
- ✅ 訊息刪除:進行中本人隨時可刪 + audit 加重;結案後需 admin 解鎖
- ✅ 緊急清除權限:本人 + host
- ✅ chat_guest 被踢即斷讀取權
- ✅ 訊息永久保留

### 任務指派(§14)— v0.4 加 RACI / Multi-PM / Dependency / PM Team / Stage Gate
- ✅ 大項 / 小項雙層(EPIC / SUBTASK,深度限 1 層)
- ✅ 多 owner(co-owner)Phase 1
- ✅ **RACI 矩陣(Accountable + Responsible)Phase 1**(對齊業務 RFQ flow PDF)
- ✅ **Multi-PM(DPM/BPM/MPM/EPM)走 `project_members.sub_role`**;主 PM 仍存 `projects.pm_user_id`
- ✅ **HOST = 業務(+ 業務助理 role='SALES'),不含 PM**;業務必在線,不需 PM 代理
- ✅ **PM Team 自然涌現**(`invited_by_pm_user_id`,不加新表);各 PM 邀請限自己 team
- ✅ **Stage Gate 機制**:全 task 完成 → READY_FOR_GATE → 業務確認 → DONE
- ✅ **Dependency-based deadlines Phase 1**(`depends_on_task_id` + `relative_deadline_days`)
- ✅ reviewer 簽核 Phase 3(配多級簽核)
- ✅ role-only 待 claim task Phase 2
- ✅ 從其他專案複製 task 結構 Phase 2
- ✅ priority_score (b) 全面影響(SLA + escalation + 主管訂閱 + 排序)
- ✅ Project Lifecycle 5-state(DRAFT / ACTIVE / PAUSED / CLOSED / REOPENED)
- ✅ Workflow Stage 是 plugin 層 sub-stage(雙 dimension)
- ✅ Notification 三層 scope(Phase 1 SYSTEM / Phase 2 加 BU + PROJECT_TYPE)
- ✅ 個人偏好覆寫 Phase 2

### 整合既有模組(§10)
- ✅ 混合方案:重做專案脈絡 UI / 嵌入 AI 戰情 / 共用工具池 / 抽出域內通訊
- ✅ 機密處理**集中在平台層** `confidentialityMiddleware`,不分散到各模組
- ✅ 域內通訊(通用聊天)Phase 2 上;三 room type 共用底層
- ✅ AI 戰情 embed Phase 2 上(主管跨專案 KPI 看板)
- ✅ 私聊預設不寫 KB
- ✅ 一般群組可選 confidential
- ✅ 教育訓練 ↔ 專案平台雙向整合 Phase 4 才看

### Inbound 資料整合(§15)
- ✅ 新 source_type:`custom_sql` / `custom_plsql` Phase 1 上(取代 erp_proc-only)
- ✅ Field Mapping UI:Phase 1 直接做**視覺化拖拉**(借鏡 Hightouch / Census)
- ✅ 排程化(`refresh_policy: scheduled` / `event_triggered`)Phase 2
- ✅ 編寫者權限限 admin / BU 主管;PM 只能綁定既有 source
- ✅ 失敗通知:同時通知 field owner + 編寫者
- ✅ 對外 read API(H2)— **待需求才做**(目前無強烈需求)
- ✅ 沿用 Cortex 既有 schedule + skill 為排程基礎建設

### 跨專案儀表板(§16)
- ✅ sidebar 點專案管理 → 預設進儀表板(非專案清單)
- ✅ Widget 由通用層固定 7-10 個 + plugin 可加自家
- ✅ 跨 BU 視角切換只 super_user(GLOBAL)看得到
- ✅ Watchlist 可加機密專案(摘要走 displayStrategy)
- ✅ 自動訂閱 Phase 1 上(priority_score >= 6 → director Watchlist)
- ✅ Phase 1 全即時 query(P2 若爆量再加 MV / cache)
- ✅ AI 警示拆 3 種:規則式 A→P1 末 / RAG 類似案 B→P2 / ML 模型 C→P3

### 角色身份體系(§17)
- ✅ 13 個預定義身份;全 admin 手動授予,**不走 LDAP**
- ✅ 一個 user 可多身份(union 權限)
- ✅ Multi-BU 授權 `bu_director` 取代 BG role(總經理 = 授全 BG 下 BU)
- ✅ 組織隸屬走 `user_organization_memberships` 多對多
- ✅ admin 權限**預設不鎖**(確保 debug 順暢);testing mode toggle 做 audit 區分(沿用既有 `a-admin-test`)
- ✅ super_user / director Phase 2 才上(配合戰情會議室)
- ✅ chat_guest 不做主動任期(host 踢 + 結案凍結已足)
- ✅ 不做高風險 role 雙簽 / 不做雙人雙鑰(IT 一定有 admin 人選)
- ✅ 離職保留 audit + 「已離職」標記
- ✅ Day 0 最小集:admin / sales / pm 各 1 人

### Phase 1 啟動規劃(§18)
- ✅ 歷史報價**完全不遷**(冷啟動,自然累積)
- ✅ 主檔**全部從 ERP 拉 + snapshot**(本平台不維護基本檔;§6.3 ERP 快照機制更新為「不限機密」)
- ✅ 廠區成本**不在平台維護**;ERP 為 single source of truth
- ✅ Phase 1 開工前**不安排 Review 週**;IT 自己角色扮演驗證
- ✅ Pilot 走 1-2 個真實 RFQ + v0.3.5 候選條件 + PM 陪跑
- ✅ Pilot 期 1-2 個月 + 每週 retro
- ✅ 成功 criteria:無 critical bug + 無資料外洩 + PM 滿意 ≥ 7/10
- ✅ Rollback 底線 (a) 完全 rollback;實際走 (b)/(c)
- ✅ 主站滾動上線,不需 maintenance window

### 待繼續討論
- 組織層級深度 + 主管 + sub-BU(BU 已知,完整層級 TBD)

---

## v0.4 對 v0.3.5 的關鍵變更

| 維度 | v0.3.5(舊) | v0.4(新) |
|------|-------------|-----------|
| 系統定位 | 業務報價特化 | 通用專案管理 + 多 project_type |
| 部署 | 獨立 hostname `quote.foxlink.com.tw` | 整合到 Cortex 主入口,sidebar 加 menu |
| JWT audience | 獨立 `aud=quote` | 共用 cortex JWT |
| Cookie domain | 分離 | 共用 |
| Step-up 2FA | 進機密頁強制 TOTP | **移除**(統一交給 SSO 層處理) |
| 機密控制 | 整個 quote 系統皆敏感 | 專案級 `is_confidential` flag + 欄位級 `confidential_fields` 勾選 |
| 流程 stage | 報價 8 階段固定 | `workflow_templates` 三層 scope(SYSTEM/BU/USER) |
| ERP/工具綁定 | 固定 | 讀 = user 權限決定;寫 KB = project_type 決定 |
| KB 結構 | 三層 quote-cases-* | **雙層**:Live KB(per-project)+ 沉澱 KB(`projects-{type}-{visibility}`),命名族取代三層 |
| KB 寫入時機 | 結案才寫 | Live KB 進行中即寫(可即時查);結案跑 archive pipeline 寫沉澱 |
| KB 刪除 | 未明確規範 | hard delete + per-source `source_id` 索引 + 1 分鐘 Text index lag + emergency purge |
| Quote 特化邏輯(戰情室、核算引擎、廠區比較) | 主流程 | 變 QUOTE plugin,通用層不感知 |
| 結案脫敏 | 同表更新 | **Fork 出新 project**(不可逆) |
| project_type 誰建 | — | 僅 admin 可建,PM 不可自加 |
| 戰情會議室結構 | 單一 stream + 三欄版面 | **多 channel(Slack/Teams 風格)**;一專案 N channels |
| DM 私聊 | 無 | **Phase 1 直接上** |
| 任務 owner 模型 | 單一 owner_role | **RACI(A + R + C + I)** + Multi-PM(sub_role 區分 DPM/BPM/MPM/EPM) |
| Task 截止日 | 固定 sla_hours | **Dependency-based deadlines**(`depends_on_task_id` + `relative_deadline_days`)|

---

## 0. TL;DR

| 面向 | 作法 |
|------|------|
| **核心物件** | `projects`(通用),欄位 `project_type_id` / `is_confidential` / `confidential_fields` 驅動分流 |
| **plugin 機制** | 各 project_type 在 server 程式碼註冊 plugin → 提供 JSON Schema、UI tabs、stage hooks、scrub rules、KB 寫入 pipeline |
| **流程引擎** | `workflow_templates` (SYSTEM/BU/USER scope) + `workflow_template_stages` 定義;PM 建專案 copy 後可改 `project_stages` |
| **機密欄位** | `is_confidential=1` 啟用整套保護;`confidential_fields` JSON array 勾選哪些 field 加密;成員 `field_grants` 個別授權 |
| **顯示策略** | TIER / ALIAS / MASK / RANGE 四種,記在 `confidential_field_policies` 系統表 |
| **資料源** | 讀(ERP/MCP/skill/讀 KB)→ 走 user 既有權限;寫 KB → `project_type_kb_routes` 由 system 強制 |
| **KB 雙層** | Live KB(per-project,進行中)+ 沉澱 KB(`projects-{type}-{visibility}`,跨專案);hard delete + Text index 1 分鐘 lag;結案 archive pipeline 雙寫 internal/public |
| **結案** | Fork 出 `declassified_project`(不可逆),寫進 public KB;原 project 寫進 internal KB |
| **整合 Cortex** | sidebar menu + `/projects/*` 路徑 + 共用 SPA / JWT;**無**獨立 hostname、**無** step-up 2FA |
| **Phase** | P1(2-4w)通用 schema + Quote plugin / P2(4-8w)群聊 + KB pipeline + 戰情會議室 / P3(8-12w)What-if + 多級簽核 + 其他 plugin |
| **Form 引擎** | 動態 Form Template(GUI Form Builder Phase 1 直接做)+ 版本鏈 + 客戶議價 diff + Excel 渲染(GUI Cell Binding + 預設不 evaluate + 「pre-evaluate」走 LibreOffice headless)— 詳 §11 |
| **AI Bot** | user 代理人模型;雙段 scrub(掩碼+替回);Form 走「建議不直寫」;Phase 1 白名單 action 開放「建 task」+「Form 欄位建議」;Token 計量 per-project + 不卡 user — 詳 §12 |
| **AI 加速 10 項 + 開案 Wizard** | Phase 1 末上線:⭐ 狀態 SUMMARY(三處顯示)+ RFQ 自動解析 + 歷史相似案推薦 + Q&A 草稿 + AI 決策紀錄 + 智慧訊息排序 + Bot 主動提醒 + 任務自動拆解 + 加分(交期合理性 / 主動推薦);**開案 7 步驟 Wizard** 整合 AI 預填(開案時間從 30 分鐘 → 5 分鐘);走 Gemini Flash 約 USD $150-250/月 — 詳 §12.10 |
| **戰情會議室** | **多 channel 模型**(Slack/Teams 風格);1 project = N channels(announcement / general / group / topic / dm);QUOTE plugin 預設 7 channels;DM Phase 1 直接上;super_user 機制(GLOBAL/BU 兩級主動 self-join);訊息永久保留;Bot context 走 per-channel + 跨 channel RAG — 詳 §13 |
| **任務指派** | 大項/小項雙層;多 owner;**RACI(A + R)**;**Multi-PM(sub_role)** + **HOST = 業務(含助理),不含 PM**;**PM Team 自然涌現**(`invited_by_pm_user_id`)**Stage Gate(業務確認)**;**Dependency-based deadlines**;per-task SLA + 三層燈號 roll-up;Project Lifecycle 5-state + Workflow Stage 雙 dimension — 詳 §14 |
| **Notification 引擎** | SYSTEM/BU/PROJECT_TYPE 三層 scope(Phase 1 SYSTEM,Phase 2 加 BU+TYPE);Escalation chain(time-stepped + recipients + channels);通道:Webex / Email / 站內 Badge / 訊息流 / Browser Push(P2);個人偏好覆寫 Phase 2 — 詳 §14.9 |
| **對外系統交付** | **本系統不直接對客戶**;完成的單價透過下游「客戶報價系統」交付。Phase 1-3 純人工傳遞 Excel(PM 下載後手動傳);Future 雙向 API 串接(待對方 API ready)— 詳 §10.3 |
| **整合策略(混合)** | 重做專案脈絡 UI / 嵌入 AI 戰情 / 共用工具池 / 抽出域內通訊(P2);機密處理**集中在平台層** `confidentialityMiddleware`,各模組統一消費 — 詳 §10.2 / §10.6 |
| **域內通訊** | **簡化**:Phase 1 多 channel 已 build 基礎(§13);Phase 2 只擴 scope 到跨專案 / 跨組織 channel;私聊預設不寫 KB;跨組織群組可選 confidential — 詳 §10.4 |
| **Inbound 資料整合** | Phase 1 直接做完整層:`custom_sql` / `custom_plsql` + **視覺化 Field Mapping UI**(借鏡 Hightouch)+ connection 管理;Phase 2 加排程化(`scheduled` / `event_triggered`);編寫者限 admin / BU 主管;失敗同時通知 owner + 編寫者 — 詳 §15 |
| **對外 read API** | 待集團其他系統提需求才做(Phase 不定) |
| **跨專案儀表板** | sidebar 點專案管理 → 預設進儀表板;7 個基礎 widget + Watchlist + 自動訂閱(priority_score >= 6);AI 警示拆 3 種(規則式 A→P1末/RAG 類似案 B→P2/ML 模型 C→P3);與 AI 戰情 BI 分工(儀表板 always-on 入口,AI 戰情 deep dive)— 詳 §16 |
| **角色身份體系** | 13 個身份(全 admin 手動授,無 LDAP 自動);一人多身份;multi-BU 授權取代 BG role;admin 權限**預設不鎖**走 testing mode toggle 做 audit 區分;super_user / director Phase 2 才上;Day 0 最小集 admin/sales/pm 各 1 人 — 詳 §17 |
| **Phase 1 啟動規劃** | 歷史報價**完全不遷**(冷啟動);主檔**全部 ERP 拉 + snapshot**(本平台不維護基本檔);Review 週不安排,IT 角色扮演驗證;Pilot 1-2 個真實 RFQ × 1-2 個月 + 每週 retro;主站滾動上線不需 maintenance window — 詳 §18 |

---

## 1. 範圍與架構決策

### 1.1 為什麼要從「報價」轉「通用 + 報價 plugin」

1. **底層其實一樣**:任何「專案 + 成員 + 任務 + 群聊 + 結案 + 知識沉澱」流程,核心 90% 相同;報價特殊的只剩「成本核算 / 廠區比較 / Tier 顯示」。
2. **未來會多開 project_type**:IT 專案、教育訓練專案、跨部門任務,沒必要每個都重做一個系統。
3. **整合到 Cortex 主入口**:獨立 hostname 的安全增益對「內部使用 + 不要求物理隔離」場景過頭;省下的維運成本投到 ACL / 加密 / 稽核更值得。

### 1.2 刻意複用 Cortex 的機制

| Cortex 既有 | 通用平台用法 |
|------------|----------------|
| feedback 工單(`tickets`)+ `ticket_messages` WebSocket 群聊 | 擴充成 `projects` + 同套群聊(`room_type='project'`) |
| 知識庫市集(向量化 / OCR / Tags 路由) | KB 三層命名族 `projects-{type}-{visibility}` |
| AI 戰情室 Board + ECharts | 專案戰情儀表板(各 plugin 提供 tile config) |
| ERP Procedure / MCP / Skill / API 連接器 | 讀工具池子,user 權限濾,專案內可呼叫 |
| Webex Bot + SMTP | SLA 告警推播 |
| LDAP + SSO + UUID token Map | 沿用 |
| 五層組織模型(廠區 / 部門 / 利潤中心 / 事業處 / 事業群) | 沿用,作 ACL 主軸 |

### 1.3 刻意**不**做的

- ❌ 獨立 hostname(`quote.foxlink.com.tw`)→ 改 sidebar menu
- ❌ Step-up 2FA / TOTP → 統一交給 SSO 層,平台不另做
- ❌ Chrome Extension 額外阻擋 → 截圖工具市面太多,擋了沒實質意義,改強化權限與稽核
- ❌ project_type 由 admin 後台動態建 → plugin 涉及 UI 元件,純 DB 控制做不到動態載入,改成程式碼 plugin 註冊 + admin 只能 enable/disable
- ❌ 對外合作模式(external_partner_mode)→ 僅內部使用

### 1.4 術語

- **Project**:平台核心物件,1 件可追蹤的工作 = 1 個 project
- **Project Type**:類別,例 QUOTE / GENERAL / IT / TRAINING,程式碼 plugin 註冊
- **Confidential Project**:`is_confidential=1`,整套保護啟用
- **Confidential Fields**:該 project 內被勾選為機密的欄位 key 集合
- **Workflow Template**:流程模板,定義 stage 清單;有 SYSTEM/BU/USER 三層 scope
- **Resource Binding**:專案能用的資料源(ERP/MCP/KB/Skill)綁定關係
- **Declassified Project**:結案脫敏 fork 出的新 project,不可逆

---

## 2. 整體架構

### 2.1 分層

```
┌─────────────────────────────────────────────────────────────┐
│  Cortex 主 SPA (cortex.foxlink.com.tw)                      │
│  Sidebar: 對話 / 技能 / KB / 戰情室 / ... / [專案管理] ★    │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼  /api/projects/*
┌─────────────────────────────────────────────────────────────┐
│  通用專案 API 層 (Express)                                   │
│  - confidentialityMiddleware (依 is_confidential 加密/解密)  │
│  - workflowEngine (stage 推進 / SLA 計算)                    │
│  - resourceResolver (讀工具 = user 權限;寫 = type 路由)      │
│  - pluginRegistry (依 project_type_code 載入 server-side hook)│
│  - auditLogger (append-only)                                 │
└─────────────────────────────────────────────────────────────┘
                       │
   ┌───────────────────┼───────────────────────┐
   ▼                   ▼                       ▼
┌──────────┐  ┌────────────────┐  ┌─────────────────────┐
│ projects │  │ workflow       │  │ confidential_field_ │
│ (通用)   │  │ templates +    │  │ policies (顯示策略) │
│          │  │ project_stages │  │                     │
└──────────┘  └────────────────┘  └─────────────────────┘
   ┌──────────┐  ┌────────────────┐  ┌──────────────────┐
   │ project_ │  │ project_type_  │  │ project_         │
   │ members  │  │ kb_routes      │  │ declassifications│
   │ (含      │  │ (寫 KB 對應)   │  │ (fork 追溯)      │
   │ field_   │  │                │  │                  │
   │ grants)  │  │                │  │                  │
   └──────────┘  └────────────────┘  └──────────────────┘

Plugin (server-side code-defined registry):
  ├─ QUOTE (報價)        — extra_fields, ui_tabs, stage_hooks, scrub_rules, kb_pipeline
  ├─ GENERAL (一般專案)  — 最簡,只要 overview + tasks + 群聊
  ├─ IT (IT 任務)        — phase 2
  └─ TRAINING (教育訓練) — phase 2
```

### 2.2 請求流程(以「打開機密專案」為例)

```
GET /api/projects/143
  ↓
authMiddleware (sso JWT)
  ↓
loadProjectMiddleware
  → fetch projects + project_members + project_stages
  ↓
pluginResolver
  → 依 project.project_type_code 載 plugin
  ↓
confidentialityMiddleware
  if !is_confidential:
    → 全 payload 明文,fast path
  if is_confidential:
    → 對 confidential_fields 內每個 key,檢查 user.role / member.field_grants
       授權 → 解密
       未授權 → 套用 plugin 提供的 displayStrategy
                (依 confidential_field_policies 的 TIER/ALIAS/MASK/RANGE)
  ↓
plugin.transformResponse(payload, user)
  → QUOTE plugin 加上 cost_breakdown / factory_compare 區塊
  ↓
auditLogger.write({event:'PROJECT_VIEW', project_id, user, ts})
  ↓
return JSON
```

---

## 3. Schema 草案

> 慣例遵照 [CLAUDE.md#DB 慣例](../CLAUDE.md):`NUMBER GENERATED ALWAYS AS IDENTITY` / `CLOB` JSON / `TIMESTAMP DEFAULT SYSTIMESTAMP` / migration 在 `runMigrations()` with column existence check。
>
> 詳細欄位最終以 design doc 為準,以下為對齊用草案。

### 3.1 核心:projects

```sql
CREATE TABLE projects (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_code          VARCHAR2(40) UNIQUE NOT NULL,        -- PJ-2026-00143 / QT-2026-00143

  project_type_id       NUMBER NOT NULL,                     -- FK project_types(admin 維護)
  workflow_template_id  NUMBER,                              -- FK workflow_templates,NULL = ad-hoc

  -- 機密旗標
  is_confidential       NUMBER(1) DEFAULT 0,                 -- 0/1
  confidential_fields   CLOB,                                -- JSON array,is_confidential=0 時 NULL
  classification_label  VARCHAR2(20),                        -- 顯示用 'PUBLIC'|'INTERNAL'|'CONFIDENTIAL'

  -- 通用結構化資料
  data_payload          CLOB,                                -- JSON,各 plugin 自訂 schema(ajv 驗)
  encrypted_payload     BLOB,                                -- AES-256-GCM,只機密欄位
  encryption_key_id     VARCHAR2(100),

  -- 人員
  sales_user_id         NUMBER,                              -- 業務發起人(audit anchor);可 NULL(非 QUOTE type 不一定有);其他業務助理走 project_members role='SALES',權限同等
  pm_user_id            NUMBER NOT NULL,                     -- 主 PM(通常是 DPM);其他 PM 進 project_members 走 sub_role(§14.2-1)
  bu_id                 NUMBER NOT NULL,                     -- ACL 主軸

  -- 狀態 / SLA
  status                VARCHAR2(20) DEFAULT 'DRAFT',        -- 通用狀態 + 各 plugin 自訂 sub-status
  current_stage_id      NUMBER,                              -- FK project_stages
  rfq_received_at       TIMESTAMP DEFAULT SYSTIMESTAMP,
  sla_due_at            TIMESTAMP,
  closed_at             TIMESTAMP,

  -- 結案 fork 追溯
  declassified_from_project_id NUMBER,                       -- 若是 fork 來的,指向原機密 project
  is_declassified       NUMBER(1) DEFAULT 0,                 -- 自己是脫敏版

  created_by_user_id    NUMBER NOT NULL,
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT chk_no_uplevel CHECK (
    is_declassified = 0 OR is_confidential = 0
  )
);

CREATE INDEX idx_p_pm ON projects(pm_user_id, status);
CREATE INDEX idx_p_sales ON projects(sales_user_id, status);
CREATE INDEX idx_p_bu_type ON projects(bu_id, project_type_id, status);
CREATE INDEX idx_p_sla ON projects(sla_due_at) WHERE status NOT LIKE 'CLOSED%';
CREATE INDEX idx_p_declass ON projects(declassified_from_project_id) WHERE declassified_from_project_id IS NOT NULL;
```

### 3.2 project_types(admin 維護;但實際 plugin 邏輯在程式碼)

```sql
CREATE TABLE project_types (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type_code             VARCHAR2(30) UNIQUE NOT NULL,        -- 'QUOTE'|'GENERAL'|'IT'|'TRAINING'
  name_i18n             CLOB,                                -- {zh-TW, en, vi}
  description_i18n      CLOB,
  icon                  VARCHAR2(100),                       -- lucide-react icon name

  is_enabled            NUMBER(1) DEFAULT 1,                 -- admin 可關
  default_workflow_template_id  NUMBER,
  default_classification_label  VARCHAR2(20),                -- 建專案的預設分類
  default_is_confidential       NUMBER(1) DEFAULT 0,

  sort_order            NUMBER DEFAULT 100,
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

`type_code` 必須與程式碼端 plugin 註冊的 code 對齊;admin 介面僅能 CRUD 此表的 metadata、enable/disable、設預設值,不能新增 type_code(出現未註冊的 code → server boot 時拒絕啟用)。

### 3.3 project_members(含 field_grants)

```sql
CREATE TABLE project_members (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            NUMBER NOT NULL,
  user_id               NUMBER NOT NULL,
  role                  VARCHAR2(20) NOT NULL,               -- MEMBER|OBSERVER|PM|SALES
  sub_role              VARCHAR2(20),                        -- role='PM' 時:'DPM'|'BPM'|'MPM'|'EPM';role='SALES' 時:可 NULL(業務助理),不分主從
  field_grants          CLOB,                                -- JSON {"amount":true,"margin":false},預設 {}
  invited_by            NUMBER NOT NULL,
  invited_by_pm_user_id NUMBER,                              -- §14.2-3 PM Team 自然涌現:該 member 是哪個 PM 邀進來的
  invited_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  UNIQUE (project_id, user_id)
);

CREATE INDEX idx_pm_team ON project_members(project_id, invited_by_pm_user_id) WHERE invited_by_pm_user_id IS NOT NULL;
```

**身份說明**:

- `projects.sales_user_id`:業務發起人(audit anchor);**業務助理**走 project_members role='SALES'(權限同等,都是 HOST)
- `projects.pm_user_id`:主 PM(通常是 DPM);**其他 PM(BPM/MPM/EPM)**走 project_members role='PM' + sub_role
- `field_grants` 對 PM / SALES 永遠 `all true`(等同 HOST 權限)
- **業務必在線才能做 HOST 動作**(踢人 / 結案 / 換主 PM);業務 + 業務助理總有一人在線,不需 PM 代理

### 3.4 confidential_field_policies(系統級 metadata)

```sql
CREATE TABLE confidential_field_policies (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_type_id       NUMBER NOT NULL,
  field_key             VARCHAR2(50) NOT NULL,               -- 'amount'/'margin'/'customer_name'
  field_label_i18n      CLOB,
  display_strategy      VARCHAR2(20) NOT NULL,               -- TIER|ALIAS|MASK|RANGE
  strategy_config       CLOB,                                -- JSON
  default_confidential  NUMBER(1) DEFAULT 1,                 -- 機密專案下預設勾不勾
  sort_order            NUMBER DEFAULT 100,
  UNIQUE (project_type_id, field_key)
);
```

### 3.5 workflow_templates / template_stages / project_stages

```sql
CREATE TABLE workflow_templates (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_code         VARCHAR2(50) UNIQUE NOT NULL,        -- QUOTE_STANDARD / IT_DEPLOY
  name_i18n             CLOB,
  description_i18n      CLOB,
  scope                 VARCHAR2(10) NOT NULL,               -- SYSTEM|BU|USER
  scope_owner_id        NUMBER,                              -- BU=bu_id;USER=user_id;SYSTEM=NULL
  project_type_id       NUMBER,                              -- 限制此 type;NULL = 任意
  is_default            NUMBER(1) DEFAULT 0,
  is_active             NUMBER(1) DEFAULT 1,
  forked_from_template_id NUMBER,                            -- clone 來源
  created_by_user_id    NUMBER,
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE TABLE workflow_template_stages (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id           NUMBER NOT NULL,
  sort_order            NUMBER NOT NULL,
  stage_code            VARCHAR2(30) NOT NULL,
  stage_name_i18n       CLOB,
  stage_color           VARCHAR2(20),
  default_sla_hours     NUMBER,
  required_role         VARCHAR2(20),                        -- PM|SALES|ANY|MEMBER
  on_enter_skill_id     NUMBER,
  on_exit_skill_id      NUMBER,
  on_enter_hook         VARCHAR2(100),                       -- plugin 端 hook code
  task_template_ids     CLOB,                                -- JSON array
  UNIQUE (template_id, stage_code)
);

CREATE TABLE project_stages (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            NUMBER NOT NULL,
  sort_order            NUMBER NOT NULL,
  stage_code            VARCHAR2(30) NOT NULL,
  stage_name_i18n       CLOB,
  stage_color           VARCHAR2(20),
  status                VARCHAR2(20) DEFAULT 'PENDING',      -- PENDING|ACTIVE|DONE|SKIPPED
  sla_hours             NUMBER,
  started_at            TIMESTAMP,
  completed_at          TIMESTAMP,
  completed_by_user_id  NUMBER,
  source_template_stage_id NUMBER,                           -- NULL = PM 自建
  UNIQUE (project_id, stage_code)
);
```

### 3.6 KB 路由與快照

```sql
-- Live KB 對應(每個專案一個,自動建立)
CREATE TABLE project_live_kbs (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            NUMBER NOT NULL,
  kb_id                 NUMBER NOT NULL,                     -- FK knowledge_bases
  kb_name               VARCHAR2(100),                       -- e.g. project-143-live
  status                VARCHAR2(20) DEFAULT 'ACTIVE',       -- ACTIVE|ARCHIVED|DROPPED
  archived_at           TIMESTAMP,
  drop_due_at           TIMESTAMP,                           -- retention 過期時間
  UNIQUE (project_id)
);

-- 沉澱 KB 路由(machine-controlled,PM 不能改)
CREATE TABLE project_type_kb_routes (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_type_id       NUMBER NOT NULL,
  kb_id_internal        NUMBER,                              -- 完整版 KB(限事業處)
  kb_id_public          NUMBER,                              -- 脫敏版 KB(全公司)
  trigger_event         VARCHAR2(20) NOT NULL,               -- STAGE_DONE|PROJECT_CLOSED|MANUAL
  trigger_stage_code    VARCHAR2(30),
  pipeline_skill_id     NUMBER,                              -- 跑摘要/脫敏/向量化的 skill
  is_active             NUMBER(1) DEFAULT 1,
  UNIQUE (project_type_id, trigger_event, trigger_stage_code)
);

-- KB 寫入物件追溯(查歷史 / 反向刪除用)
-- 注意:doc 內容真正存在 kb_documents 表,本表是業務側索引
CREATE TABLE project_kb_documents (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            NUMBER NOT NULL,
  kb_doc_id             VARCHAR2(36) NOT NULL,               -- → kb_documents.id
  kb_id                 NUMBER NOT NULL,                     -- → knowledge_bases.id
  source_type           VARCHAR2(30) NOT NULL,               -- chat_message|file|task_completion|...
  source_id             VARCHAR2(100) NOT NULL,              -- 業務側 id
  is_in_sediment        NUMBER(1) DEFAULT 0,                 -- 1 = 沉澱 KB,0 = live KB
  paired_doc_id         VARCHAR2(36),                        -- internal/public 雙寫追溯
  supersedes_doc_id     VARCHAR2(36),                        -- 修改鏈
  written_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  UNIQUE (kb_doc_id, kb_id)
);
CREATE INDEX idx_pkd_project ON project_kb_documents(project_id, source_type);
CREATE INDEX idx_pkd_source  ON project_kb_documents(source_type, source_id);

-- ERP / 外部系統拉值快照(全部 ERP 拉值都快照,不限機密專案)
-- 因為本平台不維護基本檔(廠區成本 / 料件成本以 ERP 為準),所有拉值留 snapshot
CREATE TABLE project_erp_snapshots (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            NUMBER NOT NULL,
  taken_at              TIMESTAMP DEFAULT SYSTIMESTAMP,
  taken_by_user_id      NUMBER,
  resource_type         VARCHAR2(20),                        -- erp_procedure|mcp|api_connector
  resource_id           NUMBER,
  parameters_json       CLOB,
  is_encrypted          NUMBER(1),
  result_json           CLOB,                                -- 非機密
  encrypted_result      BLOB                                 -- 機密
);

-- 結案 fork 追溯
CREATE TABLE project_declassifications (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_project_id     NUMBER NOT NULL,
  declassified_project_id NUMBER NOT NULL,
  declassified_at       TIMESTAMP DEFAULT SYSTIMESTAMP,
  declassified_by_user_id NUMBER,
  pipeline_skill_id     NUMBER,
  audit_log_id          NUMBER,
  UNIQUE (source_project_id)
);
```

> `kb_documents.metadata` 已沿用 Cortex 既有 CLOB JSON 欄位儲存 §7.4 所列的 metadata schema,不另建欄位;`project_kb_documents` 是業務側的快速 index,讓「依 source_id 反查 / 刪除」不用 JSON_VALUE scan。

### 3.7 沿用 / rename

| 既有 v0.3.5 表 | v0.4 處理 |
|---|---|
| `quote_projects` | rename `projects` + 加新欄位 |
| `quote_project_members` | rename `project_members` + 加 `field_grants` |
| `quote_tasks` | rename `project_tasks` |
| `quote_audit_log` | rename `project_audit_log` |
| `quote_factory_cost_master` | 留 QUOTE plugin namespace,改名 `qp_factory_cost_master` |
| `quote_customer_aliases` | 改 `customer_aliases`(可被多 plugin 共用) |
| `quote_cost_breakdowns` | 留 QUOTE plugin namespace,改名 `qp_cost_breakdowns` |
| `quote_task_templates` | rename `project_task_templates`(通用) |
| `ticket_message_read_receipts` | 沿用,room_type 加 `'project'` |

> v0.3.5 尚未上 prod,直接走新 schema,不做歷史遷移。

---

## 4. 機密欄位機制

### 4.1 二分 + 欄位級可選

```
┌─ Project: 是否機密?─┐
│                     │
├─ 否 (is_conf=0) ──→ 全公開,confidential_fields 必為 NULL,encrypted_payload 必為空
│                     成員看到完整 data_payload
│
└─ 是 (is_conf=1)
   │
   ├─ 哪些欄位機密?(confidential_fields JSON array)
   │  例:["amount", "margin", "cost_breakdown"]
   │
   └─ 對每個機密欄位:
      ├─ 業務 / PM / Director → 永遠看明文
      ├─ MEMBER / OBSERVER + member.field_grants[field]=true → 看明文
      └─ 否則 → 走 displayStrategy(TIER/ALIAS/MASK/RANGE)
```

### 4.2 顯示策略

| 策略 | 用在 | strategy_config 範例 | 顯示效果 |
|---|---|---|---|
| `TIER` | 金額 / 毛利率 | `{"tiers":[{"max":50000,"label":"Tier-XS"},{"max":200000,"label":"Tier-S"},...]}` | `Tier-A` |
| `ALIAS` | 客戶名 / 廠商名 | `{"alias_table":"customer_aliases"}` | `A001` |
| `MASK` | 一般字串 | `{"keep_first":2,"keep_last":0,"mask_char":"*"}` | `蘋果****` |
| `RANGE` | 數量 / 規模 | `{"buckets":[100,500,1000,5000]}` | `100~500` |

### 4.3 機密旗標切換規則

| 從 | 到 | 是否允許 | 動作 |
|---|---|---|---|
| 非機密 | 機密 | ✅(僅 PM/業務,專案 ≤ ACTIVE 狀態) | 原 data_payload 內勾選欄位搬到 encrypted_payload + 加密 |
| 機密 | 非機密 | ❌ | 一律拒絕,改走「結案後 fork 脫敏分支」 |
| 是 declassified | 任何方向 | ❌ | constraint 擋住 |
| 已結案專案 | 任何方向 | ❌ | 必須先重開,且 audit log 鎖死 |

### 4.4 加密實作

- 演算法:AES-256-GCM
- KMS 階段式:P1 K8s Secret + HKDF derived key per project / P2 Vault Transit(不變更 v0.3.5 決策)
- `encryption_key_id` 紀錄使用的 master key version,做 key rotation 時用
- 解密只在 server-side middleware 內,前端永遠拿到「該看的版本」

---

## 5. Workflow Template 三層 scope

### 5.1 三層 scope 定義

| Scope | 誰能 CRUD | 適用範圍 |
|---|---|---|
| `SYSTEM` | role `workflow.admin` | 全公司,所有 BU 預設可選 |
| `BU` | role `workflow.bu_editor` 且 `scope_owner_id == user.bu_id` | 該 BU 內可選 |
| `USER` | 本人(`scope_owner_id == user.id`)+ admin | 僅該 PM 自己 |

### 5.2 解析優先序(PM 建專案時下拉清單)

```sql
SELECT * FROM workflow_templates
WHERE is_active = 1
  AND (project_type_id = :type OR project_type_id IS NULL)
  AND (
    scope = 'SYSTEM'
    OR (scope = 'BU'   AND scope_owner_id = :user_bu_id)
    OR (scope = 'USER' AND scope_owner_id = :user_id)
  )
ORDER BY
  CASE scope WHEN 'USER' THEN 1 WHEN 'BU' THEN 2 ELSE 3 END,
  is_default DESC,
  name;
```

預設選擇:`USER is_default=1` > `BU is_default=1` > `SYSTEM is_default=1` > 第一個。

### 5.3 對 project_stages 的修改權

PM 在專案建立後可以:

| 動作 | 規則 |
|---|---|
| 加新 stage(尾端 / 中間插) | ✅ 任何時候 |
| 改 stage_name / sla_hours / color | ✅ 任何時候(只動 `project_stages`,不影響 template) |
| 拖拉重排 sort_order | ✅ 限 PENDING 的 stage |
| 標記 SKIPPED | ✅ 限 PENDING 的 stage,需填理由 |
| 刪除 ACTIVE / DONE 的 stage | ❌ |
| 機密專案 + 進入 COSTING 後改流程 | ❌(避免逃避 SLA) |

UI:專案頁有「自訂流程」按鈕,進去看到 timeline 拖拉介面;改完顯示「此專案已偏離 template 'QUOTE_STANDARD'」標籤。

### 5.4 Template fork

任一可見 template → 「複製為個人模板」按鈕 → 在使用者個人 scope 建一份,可改。
BU 主管可把個人模板 promote 成 BU scope;admin 可把 BU 模板 promote 成 SYSTEM scope。

---

## 6. Resource Binding(讀靠權限,寫靠類別)

### 6.1 讀資源(ERP / MCP / Skill / API connector / 讀 KB)

**不存在綁定表**。AI Bot 在專案聊天室被 @ 時,server 即時跑:

```javascript
async function resolveAvailableTools(project, user) {
  const userPerms = await getUserPermissions(user.id);
  return {
    erp_procedures: filterByPermission(allErpProcs, userPerms),
    mcp_servers:    filterByPermission(allMcpServers, userPerms),
    skills:         filterByPermission(allSkills, userPerms),
    api_connectors: filterByPermission(allApiConn, userPerms),
    kb_read: [
      ...await getProjectKbs(project.id),                    // 本專案 live KB
      ...await getKbsByPattern(`projects-${project.type_code}-internal-bu${user.bu_id}`),
      ...await getKbsByPattern(`projects-${project.type_code}-public`),
      ...filterByPermission(otherKbs, userPerms),
    ],
    kb_write: [],                                            // 永遠空,不開放手動寫
  };
}
```

### 6.2 寫 KB(由 project_type 強制路由)

`project_type_kb_routes` 表完全 system-controlled:

| project_type | trigger | KB |
|---|---|---|
| QUOTE | `PROJECT_CLOSED` | internal: `projects-quote-internal-bu{X}` / public: `projects-quote-public` |
| QUOTE | `STAGE_DONE: COSTING` | internal: `projects-quote-internal-bu{X}` |
| GENERAL | `PROJECT_CLOSED` | public: `projects-general-public` |
| IT | `PROJECT_CLOSED` | internal: `projects-it-internal` / public: `projects-it-public` |
| TRAINING | ... | ... |

PM 只能觸發,不能改路由。

### 6.3 ERP 快照機制(全部 ERP 拉值都快照)

**設計原則**:本平台**不維護基本檔**(廠區成本 / 料件成本 / 客戶 / 料號 都以 ERP 為 single source of truth)。任何 ERP 拉值都自動 snapshot,確保結案後歷史可追溯。

`resourceResolver` 對所有 ERP / SQL / PL-SQL / API 結果統一處理:

- 結案後 KB pipeline 從 snapshot 撈,不再即時打 ERP(避免 ERP 後續異動造成歷史失真)
- 機密專案的 snapshot 走 `is_encrypted=1` 加密儲存
- 非機密專案的 snapshot 走明文(`result_json`)
- 對應 §15 Inbound 資料整合層的 fetch audit(`qp_data_fetch_jobs`)雙寫:技術 audit + 業務語意 snapshot

→ 廠區成本主檔不在本平台維護(對齊 v0.4 決議),財務在 ERP 改完後本平台下次拉值自動同步。

---

## 7. KB 雙層架構(RAG 友善)

> KB 是本平台最關鍵的資料層之一。設計目標:**進行中可即時查 + 結案後沉澱知識 + 機密 / 非機密物理隔離 + 召回率穩定**。

### 7.1 雙層 KB 架構

不是「一專案一 KB」也不是「全公司一 KB」,而是**分兩層**:

```
┌─ Live KB(per-project,進行中)──────────────────────┐
│   project-{id}-live                                   │
│   ▸ 一個專案一個 KB,Oracle LIST PARTITION 物理隔離    │
│   ▸ 內容:聊天訊息 / 上傳檔案 / 任務說明 / ERP 快照    │
│   ▸ 高頻寫 + 偶爾刪改                                 │
│   ▸ 隨機密 / 非機密走不同 share_permissions           │
│   ▸ 專案結案時 → 跑 archive pipeline → 寫沉澱 KB      │
│   ▸ 然後 rename → archive-project-{id}-live + 唯讀    │
│     (或 retention 過期後 drop partition)             │
└───────────────────────────────────────────────────────┘

┌─ 沉澱 KB(cross-project,結案後沉澱)────────────────┐
│   projects-{type}-public                              │
│   projects-{type}-internal-bu{X}                      │
│   ▸ 跨專案,RAG 自動 cross-learning                   │
│   ▸ 一個專案 = 1~3 個 doc(closure_summary +          │
│     key_decisions + selected_attachments)             │
│   ▸ LLM 摘要 + 精選後寫入,不是 raw dump              │
│   ▸ 機密版(internal)/ 脫敏版(public)各自獨立     │
└───────────────────────────────────────────────────────┘
```

**為什麼分兩層**:

- Live KB 髒、亂、量大、頻繁刪改 → 適合 per-project,partition 物理隔離,刪除/歸檔簡單
- 沉澱 KB 結構化、量少、極少改 → 適合 cross-project,RAG 召回時自動跨案學習

### 7.2 命名族(沿用前版設計)

```
Live:   project-{id}-live
        archive-project-{id}-live          -- 歸檔後 rename

沉澱:   projects-{type_code}-public
        projects-{type_code}-internal-bu{X}

範例:
  project-143-live                         -- 報價案 143 的進行中 KB
  archive-project-143-live                 -- 結案後歸檔(retention 期間保留)
  projects-quote-public                    -- 業務報價脫敏版,全公司可學
  projects-quote-internal-bu1              -- 業務報價完整版,事業處 1
  projects-it-public                       -- IT 專案脫敏版
  projects-general-public                  -- 一般專案(未分類)
```

### 7.3 KB 物件粒度(關鍵設計)

從業務視角想清楚「一個物件」是什麼:

| 物件粒度 | 例 | doc_id 命名 | 用途 |
|---|---|---|---|
| **Per-message** | DECISION / BLOCKER 訊息 | `msg-{uuid}` | 立即 vectorize,可獨立刪 |
| **Per-file** | 上傳的 BOM Excel | `file-{uuid}` | 立即 vectorize |
| **Per-task** | 任務的完成說明 + 附件 | `task-{id}-completion` | 任務 done 時 vectorize |
| **Per-batch** | 一段聊天合併(每小時 / 每 50 條) | `chat-{room}-batch-{N}` | batch 寫,降 doc 數 |
| **Per-erp-snapshot** | ERP procedure 結果快照 | `erp-{snapshot_id}` | 機密專案才產生 |
| **Closure summary** | 結案 LLM 摘要 | `closure-{project_id}` | 結案 pipeline 產出 |

**寫入策略**:

- 重要訊息(`message_type IN ('DECISION','BLOCKER')`)→ per-message,立即 vectorize
- 一般聊天 → per-batch,後台 worker 每 30min 或滿 50 條合併一次
- 檔案上傳 → 立即 vectorize(user 馬上會問)
- 任務完成 → 立即 vectorize(PM 馬上會問「John 做完沒」)
- ERP 快照 → **全部 ERP 拉值都寫**(對齊 §6.3,本平台不維護基本檔);機密專案加密儲存

### 7.4 Metadata Schema(必填)

利用既有 `kb_documents.metadata` JSON 欄位,write 時強制塞:

```json
{
  "project_id": 143,
  "project_code": "QT-2026-00143",
  "project_type": "QUOTE",
  "bu_id": 1,
  "is_confidential": 1,

  "source_type": "chat_message",
  "source_id": "msg-uuid-12345",
  "source_object_path": "tickets/143/messages/12345",

  "author_user_id": 42,
  "captured_at": "2026-04-28T10:23:00Z",
  "tags": ["decision", "factory_choice"],

  "supersedes_doc_id": null,
  "declassified_from_doc_id": null,
  "paired_doc_id": null
}
```

`source_type` 可選值:`chat_message` / `file_upload` / `task_completion` / `decision` / `blocker` / `erp_snapshot` / `closure_summary` / `bot_response` / `key_decision`(由 plugin 擴充)。

**檢索時的 filter**:`/api/projects/:id/ask` 路由查詢預設帶 `metadata.project_id = :id`,跨專案查才放開。

### 7.5 RAG 預設行為

| 場景 | 預設搜尋 KB |
|---|---|
| 一般 chat(非專案內) | `projects-*-public` + 用 user 權限濾掉看不到的 BU |
| 業務 chat 問「歷史報價」 | `projects-quote-public` + `projects-quote-internal-bu{user.bu}` |
| 機密專案聊天室內 @bot | 本專案 `project-{id}-live` + `projects-{type}-internal-bu{user.bu}` + `projects-{type}-public` |
| 非機密專案聊天室內 @bot | 同上 + 直接合併查(不用區分) |
| Admin 查全公司 | 全部(僅 admin role) |

**多 KB 並行查** + **跨 KB rerank** 沿用 Cortex 既有 `kbRetrieval.js` 機制,重點在 score normalization(見 §7.9)。

### 7.6 刪除策略

#### 7.6.1 Cortex 已具備的能力

- ✅ `kb_chunks` 每 chunk 有獨立 `id`,partitioned by `kb_id`
- ✅ `kb_documents.id` → `kb_chunks.doc_id` 有 `ON DELETE CASCADE`
- ✅ Oracle Text 索引 `SYNC EVERY 1 minute`,delete 後 1 分鐘內反映
- ✅ Vector index(IVF)delete 立即移除,但累積 dead blocks 需週期性 rebuild

→ **單個物件可精準刪,不用整個 KB 重整**。

#### 7.6.2 標準刪除

```sql
DELETE FROM kb_documents
WHERE JSON_VALUE(metadata, '$.source_type') = :type
  AND JSON_VALUE(metadata, '$.source_id') = :id;
-- chunks 自動 cascade
-- Text index 1 分鐘內反映;vector index 立即生效
```

#### 7.6.3 修改 ≠ update content

向量會錯位。標準作法:

```
1. 寫新 doc(metadata.supersedes_doc_id 指向舊)
2. 刪舊 doc(cascade chunks)
3. retrieval 時 filter 掉 supersedes 的舊 doc(或讓它已刪)
```

留 `supersedes_doc_id` 鏈可追歷史(audit 用),不影響召回。

#### 7.6.4 軟刪 vs 硬刪

**全部用 hard delete**,理由:

- ❌ 機密訊息誤發後想刪 → soft delete 內容還在 DB,法務不接受
- ❌ Text index 不會 filter status,還是會 match 到內容(只是回 row 後被你 filter)
- ❌ 索引膨脹

→ 硬刪 + 前端做「30 秒 undo buffer」解決誤刪。

#### 7.6.5 緊急清除(emergency purge)

機密訊息誤發 → 走特殊 API:

```
DELETE /api/kb/emergency-purge
  body: { source_id, reason, audit_note }
```

效果:hard delete + force sync Text index(`CTX_DDL.SYNC_INDEX('KB_CHUNKS_FTX')`),不等 1 分鐘 lag。權限:PM / admin / 該 BU 主管。

### 7.7 Live KB 進行中的查詢一致性

| 情境 | 處理 |
|---|---|
| 上傳檔案 → 同步 vectorize → 幾秒可查 | 走 `kbEmbedding.js` 同步管線 |
| Chat 訊息(一般)→ batch 累積 → 30min 內 vectorize | 標籤 BLOCKER/DECISION 例外,即時 vectorize |
| User 刪 chat 時 KB 已 vectorize | DELETE doc → cascade chunks;Text index 1 分鐘 stale,可接受 |
| User 修 chat 時 KB 已 vectorize | 寫新 doc + 刪舊 doc + supersedes 鏈 |
| Chat 還在 batch buffer 沒 vectorize | 直接從 buffer 移除,不需動 KB |
| 機密訊息誤發 → 緊急刪 | emergency purge(§7.6.5) |
| 檔案 update(re-upload 同名) | delete + insert,新 doc 的 `supersedes_doc_id` 指舊 |

**重點**:Live KB 設計上接受「Text index 1 分鐘內 stale」的 lag,因為這比強制 `SYNC ON COMMIT` 拖累寫入速度划算。緊急情境走 emergency purge。

### 7.8 Live KB → 沉澱 KB 的 Archive Pipeline

專案結案時,跑(`pipelineKbWriter.js` 擴充):

```
1. 抓 live KB 全部 doc(可能 100-1000 個)
2. LLM 摘要關鍵決策 / 卡關原因 / 解法 / 贏輸原因
3. 產出結構化 doc:
   - closure-{project_id}      -- 整案摘要
   - decision-{project_id}-{N} -- 每個重要決策獨立 doc(便於 RAG 命中)
4. 重要附件按 plugin 規則挑選(QUOTE: BOM / 報價單 / 競品分析)
5. 開 Oracle 交易:
   ┌─ INSERT 進 projects-{type}-internal-bu{X}(完整版)
   └─ INSERT 進 projects-{type}-public(脫敏版,經 plugin scrub_rules)
6. 紀錄 paired_doc_id(internal ↔ public 雙寫追溯)
7. live KB 改名 archive-project-{id}-live + 唯讀
   (retention 期過後 drop partition)
```

**Transactional 一致性**(雙寫 internal + public):

- DB transaction 包住 `kb_documents` insert
- chunk vectorize 是異步 → 寫補償:cleanup job 掃 `paired_doc_id` 但對方不存在的 orphan,刪除
- 失敗時 audit log + alert,人工 review

```javascript
async function archiveProjectToKB(project) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const internalDoc = await writeToKB(conn, internalKbId, project.fullPayload);
    const publicDoc   = await writeToKB(conn, publicKbId,   plugin.scrub(project.fullPayload));
    await conn.recordPair(internalDoc.id, publicDoc.id);
    await conn.commit();
    // chunk vectorize 在 commit 後 async 跑(避免 transaction 太長)
    await Promise.all([
      vectorize(internalDoc.id),
      vectorize(publicDoc.id),
    ]);
  } catch (e) {
    await conn.rollback();
    auditLog.error('archive_failed', { project_id, error: e });
    throw e;
  }
}
```

### 7.9 召回率維持策略

#### 7.9.1 沿用 Cortex 既有能力

- ✅ Hybrid retrieval(vector + Oracle Text full-text)
- ✅ Multi-vector(`title_embedding` + content embedding)
- ✅ Synonym query-time OR expansion(`kbSynonyms.expandQuery`)
- ✅ Parent-child chunks(每 chunk 有 parent_content)
- ✅ Per-KB `retrieval_config` 覆寫(同義詞、權重、cutoff)

#### 7.9.2 Live KB vs 沉澱 KB 兩套參數

| 參數 | Live KB | 沉澱 KB |
|---|---|---|
| chunk size | 300-500 token(chat 短) | 800-1200 token(摘要長) |
| `score_threshold` | 0(放寬召回,靠 metadata filter 收斂) | 0.6-0.7(精度優先) |
| Text 索引 SYNC | EVERY 1 minute | EVERY 5 minute(極少改) |
| 同義詞表 | 沿用 project_type 級 | 同 |
| Re-rank | LLM rerank top-20 → 5 | LLM rerank top-50 → 10 |

#### 7.9.3 Title embedding 強化

每個 doc 寫入時,title 欄位塞「source_type + 重點關鍵字 + tags」,讓 multi-vector 命中率高:

```
file-abc.xlsx (BOM 物料清單) [QT-2026-00143] tags: bom, costing
msg-12345 (DECISION 廠區優先越南) [QT-2026-00143]
closure-143 (專案結案摘要 客戶 A001 廠區 VN 結果 WIN)
```

#### 7.9.4 跨 KB rerank score 校正

不同 KB 的向量分布可能不同(內容性質不同),直接合併排序會偏。Cortex 既有 rerank 已支援 per-KB min-max normalize 後合併,但要在 `retrieval_config` 中明確開啟:

```json
{
  "cross_kb_rerank": {
    "enabled": true,
    "normalize": "min_max_per_kb",
    "weight_by_kb": {
      "project-{id}-live": 1.2,
      "projects-quote-internal-bu1": 1.0,
      "projects-quote-public": 0.8
    }
  }
}
```

→ Live KB(本案)權重最高、internal 次之、public 再次之。

### 7.10 機密 / 非機密 KB 不能混

**錯誤做法**:把機密 + 非機密 chunks 全放在 `projects-quote-public`,RAG 結果再 filter user 看不到的 → 召回降、洩 metadata 風險、Vector index 一炸全炸。

**正確做法**:KB 物理分開(命名族決定),query 時依 user 權限決定查哪幾個 KB,結果合併 rerank。Cortex 既有 `getKbsByPattern` + 多 KB 並行查 + 統一 rerank 已支援。

### 7.11 權限控管沿用 Cortex 既有機制

- 每個 KB 是 `knowledge_bases` 表一筆,沿用 `share_permissions` / `data_policy_categories`
- Live KB 的 share_permissions:該專案成員 + PM + 業務 + 該 BU 主管
- internal KB 的 share_permissions:該 BU 全員
- public KB 的 share_permissions:全公司
- Admin 介面提供 KB 命名族總覽 + 批次調權限

### 7.12 Partition 容量規劃

`kb_chunks` 是 `LIST PARTITION by kb_id`,每個 active 專案一個 partition:

| 項目 | 預估 |
|---|---|
| Oracle 預設 partition cap | 1024(可調至 1M+) |
| 同時 active 報價案 | 50-200 |
| 加上其他 type 同時 active | 200-500 |
| **歸檔 KB partition** | 必須週期性 drop,否則累積到 cap |

**Retention policy**(v0.4 全平台改成永久保留,呼應 §13.6):

- live KB → 結案 + 30 天後 → rename `archive-project-{id}-live` 唯讀
- archive live KB → **不 drop**,永久保留
- 沉澱 KB(`projects-*-*`)→ 永久保留
- 法務要求保留期間內,不可 drop(audit log 鎖定)
- 例外刪除 → 走 emergency purge API + admin 雙簽 + audit 加重(§7.6.5)
- 容量控制(實作細節由 DBA 評估):
  - Oracle Hybrid Partitioned Tables — 舊 partition 移到 external table(Object Storage / NFS cold tier)
  - `COMPRESS FOR ARCHIVE HIGH` 壓縮舊 partition
  - Vector index 不索引舊 partition(查冷資料即時計算)

### 7.13 Vector index 維護

- 全公司只有一個 `kb_chunks_vidx`,rebuild 期間所有 KB 召回都受影響
- Live KB 因高頻刪改 → Vector index 累積 dead blocks → 召回逐漸下降
- 排程:**每月凌晨低峰跑一次 rebuild**(走 `kbMaintenance.js`)
- Phase 2 觀察累積速度,可能改成「每 2 週」或「partition-level 局部 rebuild」

### 7.14 結案 fork 的 scrub 必須在「進 KB 之前」

特別重要的設計點:

- ❌ 錯誤做法:沉澱 KB 存原文,query 時依 user 權限替換
  - LLM 看到的還是真金額
  - 一旦權限 bug,真值洩漏
- ✅ 正確做法:**scrub pipeline 在 archive 階段就跑完**,寫進 public KB 的 chunk content 已經是 `Tier-A` / `A001`
  - LLM 永遠看不到真值
  - 沒有「依 query 替換」的 race condition

→ Plugin 提供 `scrub_rules`,archive pipeline 在 chunking 前先跑 scrub,再 vectorize。

---

## 8. 結案脫敏 Fork(不可逆)

### 8.1 流程

```
原 project (id=143, is_confidential=1, status=ACTIVE)
  ↓ PM 點「結案」
  ↓ 跑 PROJECT_CLOSED hook
  ↓ status = CLOSED_WIN | CLOSED_LOSS | CLOSED_HOLD
  ↓ 保留 encrypted_payload
  ↓ 寫進 projects-quote-internal-bu{X}(摘要 + 原始附件 + Bot 對話)
  ↓
  ├─ 自動 fork(若 type 設定有 public 路由)
  └─ 跑 declassify pipeline:
     1. plugin 提供 scrub map: amount→Tier-A, customer→A001 ...
     2. 套用 displayStrategy 產生明文脫敏值
     3. 建新 project (id=143-d, is_confidential=0, is_declassified=1,
                     declassified_from_project_id=143)
     4. 複製 stage / task / 群聊摘要 / 結案報告(全脫敏)
     5. 寫進 projects-quote-public
     6. 紀錄 project_declassifications

declassified project (143-d) 屬性:
  is_confidential = 0
  encrypted_payload = NULL
  data_payload 含脫敏明文(Tier-A, A001 ...)
  status = CLOSED_DECLASSIFIED
  唯讀
```

### 8.2 不可逆 enforce

- DB constraint:`chk_no_uplevel`(`is_declassified=1 AND is_confidential=1` 禁止)
- App-level:PATCH `is_confidential` 時若 `is_declassified=1` → 直接拒絕
- Audit log:任何嘗試都記錄
- 真要修原機密版內容 → 必須重跑 declassify pipeline,舊的 declassified project 標記 SUPERSEDED + KB chunk 重建

### 8.3 為什麼用 fork 而非 view

- view 模式下「機密版改了 → 脫敏版自動跟著改」會有時間不一致(KB 已索引但內容變)
- fork 後兩邊獨立,KB 不會抖動
- audit 看得出每次脫敏

---

## 9. Plugin 架構

### 9.1 Plugin 註冊(server-side code)

```javascript
// server/plugins/quote/index.js
module.exports = {
  type_code: 'QUOTE',
  
  // ajv JSON schema for projects.data_payload
  data_schema: require('./schema.json'),
  
  // 機密欄位預設清單
  confidential_field_defaults: ['amount', 'margin', 'cost_breakdown'],
  
  // UI tabs(server 提供 metadata,前端動態載元件)
  ui_tabs: [
    { id: 'overview',     order: 1, component: 'QuoteOverview' },
    { id: 'war_room',     order: 2, component: 'WarRoom' },
    { id: 'costing',      order: 3, component: 'CostingPanel' },
    { id: 'factory_cmp',  order: 4, component: 'FactoryCompare' },
    { id: 'tasks',        order: 5, component: 'TaskBoard' },
  ],
  
  // Stage hooks
  stage_hooks: {
    'COSTING:on_enter': require('./hooks/runCostingEngine'),
    'CLOSED:on_enter':  require('./hooks/triggerDeclassify'),
  },
  
  // LLM Scrub 規則
  scrub_rules: require('./scrub'),
  
  // KB pipeline
  kb_pipeline: require('./kbPipeline'),
};

// server/plugins/registry.js
const plugins = {
  QUOTE:    require('./quote'),
  GENERAL:  require('./general'),
  // IT:    require('./it'),       // phase 2
  // TRAINING: require('./training'),
};
module.exports = plugins;
```

### 9.2 前端動態載入

```jsx
// client/src/modules/projects/ProjectDetailPage.tsx
const project = useProject(id);
const Plugin = await import(`./plugins/${project.type_code.toLowerCase()}`);

return (
  <Layout>
    <ProjectHeader project={project} />
    <Tabs>
      {Plugin.ui_tabs.map(tab => 
        <Tab key={tab.id} title={tab.title}>
          <Suspense fallback={<Spinner/>}>
            {React.createElement(Plugin.components[tab.component], { project })}
          </Suspense>
        </Tab>
      )}
    </Tabs>
  </Layout>
);
```

### 9.3 通用層 vs Plugin 邊界

| 層 | 誰負責 |
|---|---|
| projects CRUD / ACL / 加密 / 稽核 | 通用 |
| Workflow stage 引擎 / SLA 計算 | 通用 |
| 群聊 / WebSocket / Pin / 已讀回執 | 通用(沿用 `ticket_messages`) |
| KB write pipeline 框架 | 通用,plugin 提供 scrub_rules |
| Project 列表 / Sidebar / Notification | 通用 |
| Quote 報價金額 / 廠區比較 / 戰情會議室特化 UI | QUOTE plugin |
| Quote 料工費公式 / 廠區成本核算 | QUOTE plugin(掛 stage hook) |
| QUOTE 的 LLM Scrub 規則(amount→Tier-A) | QUOTE plugin |

### 9.4 戰情會議室定位

戰情會議室原本是 v0.3.5 的核心功能,通用化後:

- **三欄版面 / Pin / 已讀回執 / 訊息色語言** → 上拉到通用層,任何 project_type 都用得到
- **任務 Template** → 通用層,各 plugin 可註冊自己的 template
- **AI Bot 即時建議** → 通用層,plugin 提供 prompt 模板與 scrub 規則
- **24h SLA banner / 廠區比較側邊欄** → QUOTE plugin 專屬

---

## 10. 與 Cortex 既有模組的整合

### 10.1 Sidebar / Help 整合

新增 Help section(對應 [help-manual-structure.md](./help-manual-structure.md)):

| section ID | 標題 | sort_order | 分組 |
|---|---|---|---|
| `u-projects` | 專案管理平台 | 17 | 進階 |
| `u-projects-quote` | 業務報價(QUOTE plugin) | 18 | 進階 |
| `u-projects-general` | 一般專案(GENERAL plugin) | 19 | 進階 |

Admin 手冊新增:
| section ID | 標題 |
|---|---|
| `a-project-types` | Project Type 管理 |
| `a-workflow-templates` | Workflow Template 管理 |
| `a-project-kb-routes` | 專案 KB 路由設定 |
| `a-confidential-policies` | 機密欄位策略 |

### 10.2 整合策略總覽(混合方案)

> **核心原則**:
> 1. **重做** — 與專案脈絡強耦合的 UI(戰情會議室、任務看板、Form 引擎、專案儀表板)
> 2. **保留 + 嵌入** — 既有強大模組(AI 戰情 BI),提供 embed 進專案頁
> 3. **完全共用** — 通用工具(技能 / KB 市集 / ERP / MCP / 文件範本 / 排程)
> 4. **抽出通用** — 聊天底層抽出成「域內通訊」,服務 Cortex 所有 user(Phase 2)
> 5. **機密處理集中** — 平台層 `confidentialityMiddleware` 是 single source of truth(§10.6)

| Cortex 既有 | 處理方式 | Phase | 詳述 |
|---|---|---|---|
| 戰情會議室 / 任務看板 / Form 引擎 / 專案儀表板 | **重做** | P1 | §11 / §13 / §14 |
| AI 戰情(BI) | **保留 + 可嵌入專案頁** | P2 | §10.5 |
| 聊天底層(`ticket_messages` + WebSocket) | **共用,Phase 2 抽通用** | P1 共用,P2 通用化 | §10.4 |
| 知識庫市集 | **共用** | P1 | 新增 `projects-*` 命名族(§7) |
| 技能市集 | **共用** | P1 | plugin 內呼叫,§6 user 權限濾 |
| ERP / MCP / API 連接器 | **共用** | P1 | 工具池;讀靠 user 權限 |
| 文件範本 | **共用** | P1 | plugin 結案報告調用 |
| 排程任務 / Webex Bot / SMTP | **共用** | P1 | Notification 引擎掛上去(§14.9) |
| 教育訓練平台 | **完全獨立** | (P4 評估雙向) | TRAINING plugin 上線時再看 |
| feedback ticket | **完全獨立(不改)** | — | 底層 `ticket_messages` 共用 |

### 10.3 對外系統整合(交付對象 — 客戶報價系統)

**重要設計原則**:本平台**不直接對外**(不對客戶開放)。完成的單價、報價單透過下游「客戶報價系統」交付給客戶。

#### 10.3.1 ✅ 交付方式決議

| Phase | 交付方式 |
|---|---|
| **Phase 1 / 2 / 3** | **純人工傳遞** — PM 在平台下載 §11.5 產出的 Excel,手動傳給客戶報價系統承辦人 |
| **Future(時程未定)** | **雙向 API 串接** — 推送單價結果 + 接收客戶反饋自動建新 form 版本(待客戶報價系統提供 API 規格) |

#### 10.3.2 對 Phase 1 設計的影響

- **§11.5 Excel Renderer 仍要做**:用途是 PM 下載後人工傳遞給客戶報價系統承辦人(不是給客戶)
- **§11.3 Form 版本鏈仍有用**:客戶反饋 / 客戶報價系統承辦人反饋 → PM 手動建新版本(label「客戶反饋 vN」/「客戶報價系統反饋 vN」)
- **不需要**:Email gateway / 客戶 portal / 電子簽章整合 / 對外 webhook

#### 10.3.3 Future 串接時的架構保留點

未來雙向串接上線前,先保留接點:

- 結案 trigger 已在 §14.8.3 lifecycle table 設計,可 hook 上 outbound API
- form 版本鏈支援「外部觸發新版本」(同 PM 手動建新版機制)
- 機密 / 顯示策略的設計確保:對外輸出時只送脫敏 / 結構化 view,不洩內部成本明細
- **API 規格本平台不單方面定義**;待客戶報價系統那端 ready 時雙方對齊

→ 這段 spec 留下「未來會做」的框架,實際 schema / endpoint / 認證機制 待 Future Phase 時定。

### 10.4 域內通訊(通用聊天)— ✅ 簡化:Phase 1 已 build channel 基礎,Phase 2 擴 scope

> **重要更新**:§13 已重構為「多 channel 模型」(Phase 1 上),DM / group / topic channel 都已實作。本節 Phase 2 的工作只剩**把 channel scope 從「專案內」擴到「跨專案 / 跨組織」**。

#### 10.4.1 Phase 1 已涵蓋的(透過 §13 多 channel)

```
Phase 1 build 了:
  ▸ project_channels 表(支援 announcement / general / group / topic / dm)
  ▸ DM 1:1 私聊(專案內,Phase 1)
  ▸ Group / Topic channel(專案內)
  ▸ 訊息 retention 永久 + KB 寫入策略(per-channel)
```

#### 10.4.2 Phase 2 擴展:跨專案 / 跨組織 channel

```sql
-- Phase 2 加入 communication_rooms 表(scope 不限專案)
CREATE TABLE communication_rooms (
  id, room_type,                           -- org_group | org_dm
  name, description,
  scope,                                   -- 'cross_org' | 'cross_project'
  scope_owner_id,                          -- BU id 或 NULL(全公司)
  created_by_user_id,
  is_confidential NUMBER(1) DEFAULT 0,
  is_archived NUMBER(1) DEFAULT 0,
  -- DM 用
  dm_user_a_id, dm_user_b_id,              -- sorted ascending,UNIQUE
  created_at, updated_at
);

-- ticket_messages 已有 channel_id(§13);Phase 2 加 room_id 兼容跨專案 room
ALTER TABLE ticket_messages ADD (
  comm_room_id NUMBER                      -- 跨專案 room(若 channel_id 為 NULL)
);
```

#### 10.4.3 三種 channel scope 差異

| 維度 | 專案 channel(P1)| 跨組織 group(P2)| 跨組織 DM(P2) |
|---|---|---|---|
| 範圍 | 某 project 下 | 全 BU 或全公司 | 任何兩 user |
| 與專案綁定 | ✅ 跟 lifecycle 走 | ❌ 常駐 | ❌ 常駐 |
| SLA banner | ✅ | ❌ | ❌ |
| Bot 自動加入 | ✅ | OWNER 選 | user @bot 才回 |
| 寫進 KB | per-channel(announcement 全寫 / general batch / dm 不寫)| group 可選 | **預設不寫** |
| 訊息 retention | 永久 | 永久 | 永久 |

#### 10.4.4 ✅ 私聊 KB 寫入決議(沿用)

**預設不寫 KB**(尊重隱私 + governance 簡單)— 不論專案內 DM 還是跨組織 DM。

#### 10.4.5 ✅ 群組可選 Confidential 決議(沿用)

跨組織 group OWNER 建立時可勾 `is_confidential=1`,啟用加密 + 雙簽邀請。

#### 10.4.6 Sidebar / Navigation(Phase 2 新增)

```
Cortex Sidebar:
  💬 對話        ← 既有,跟 AI 對話
  💌 訊息  ★    ← NEW(Phase 2)
     ├─ 私聊(跨專案)
     ├─ 跨 BU 群組
     └─ 我的專案 channels(在 §13 專案管理頁也能進)
  ...
```

→ 「對話」+「訊息」並列,前者是 AI bot,後者是人對人(可選 @bot)。

### 10.5 AI 戰情整合(embed 進專案)— ✅ Phase 2

#### 10.5.1 概念

不在專案平台重做 BI,改 embed 既有 AI 戰情 dashboard:

```
admin 在 AI 戰情建一個 BU-scoped dashboard
   ↓
專案管理 → 該 BU 主管的「關注專案」頁
   ↓
embed iframe / portlet:
  /ai-bi/dashboard/{id}?scope=bu-1&filter=active_quote
   ↓
顯示該 BU 跨專案 KPI(贏單率 / 平均 SLA / Delay 熱點 / cost trend)
```

#### 10.5.2 需要的擴充

- AI 戰情 query 支援 `project_id` / `lifecycle_status` filter
- 機密欄位走平台 `confidentialityMiddleware`(§10.6),不另寫
- iframe 安全:CSP + sandbox(雖然同源但保險)
- 主管「關注專案」頁的儀表板 tile,允許自定 widget 組合

#### 10.5.3 不重做專案 BI 的理由

- AI 戰情已支援 ECharts / NL→SQL / 多 BU 資料源
- 維護兩套儀表板邏輯成本高
- BI 領域 user 已熟悉,習慣保留

### 10.6 機密處理集中原則(✅ 決議)

#### 10.6.1 single source of truth

所有處理機密資料的模組(AI 戰情 / KB 市集 / 聊天 / 文件範本 / 對外輸出)**統一過 `confidentialityMiddleware`**。

```
(任何模組要拿資料)
   ↓
confidentialityMiddleware (§4.1)
   ├─ identify: 此資料的 project_id / is_confidential / confidential_fields
   ├─ resolve user permissions:
   │     ├─ HOST/Sales/PM/Director → 全授權
   │     ├─ MEMBER + member.field_grants[field]=true → 該欄位授權
   │     └─ 其他 → 走 displayStrategy
   ├─ decrypt 機密欄位(若授權)or apply TIER/ALIAS/MASK/RANGE
   └─ return 處理後的 payload
```

#### 10.6.2 為什麼集中

- ✅ 機密邏輯只寫一份,bug 只修一處
- ✅ 加新 project_type / 新模組,不需要重新實作機密 filter
- ✅ Audit 一致(`PROJECT_VIEW`、`BOT_DECRYPT_FIELD` 等事件統一在 middleware emit)
- ❌ 散布痛(替代方案)— 每模組自己處理,加新規則要改 N 個地方

#### 10.6.3 各模組消費 middleware 的方式

| 模組 | 消費點 |
|---|---|
| AI 戰情 BI | query 結果走 middleware,filter / mask 後回傳 |
| KB 市集 | RAG 召回 chunk 走 middleware,輸出依 user 視角 |
| 聊天訊息流 | 訊息 / 附件 retrieve 時走 middleware |
| 文件範本 generator | 渲染前過 middleware,例:Excel 內嵌入金額時自動套 displayStrategy |
| 對外 API(Future) | 推送前過 middleware,scrub 後送出 |
| Bot context | INPUT 流經 middleware 轉換,再進 LLM(§12.4) |

### 10.7 原 quote-system v0.3.5 內容對照

| v0.3.5 章節 | v0.4 處理 |
|---|---|
| §1 部署拓撲 Option C(獨立 hostname) | **刪除**,改 sidebar menu |
| §2 Schema(quote_*) | rename → `projects` 通用 + QUOTE plugin namespace |
| §3 狀態機(8 階段) | 變 `WORKFLOW_TEMPLATE: QUOTE_STANDARD` |
| §4 授權模型(quote.sales / quote.pm / quote.director) | rename `project.sales` / `project.pm` / `project.director`(因為通用) |
| §7 安全分層 L0-L5 | L0 hostname 隔離拿掉;Step-up 2FA 拿掉;L2-L5 全留 |
| §7.4 加密 / KMS | 完全沿用 |
| §14 戰情會議室 | 通用層,沿用 |
| §15 AI 分析架構 + Scrub | 通用層 + plugin 提供 scrub rules |

---

## 11. Quote Form 引擎(動態 Form / Task / Versioning / Excel)

> 本章是 QUOTE plugin 的核心子系統。雖然技術上屬 plugin 範疇,但因架構規模大且決策已定案,獨立成章。
>
> 4 個模組:Form Template Engine → Form Instance(版本鏈)→ Task Generator → Excel Renderer。

### 11.1 整體架構

```
┌─ 1. Form Template Engine ────────────────────────────┐
│   定義:有哪些 field、誰填、從哪抓、怎麼算            │
│   scope:SYSTEM / BU / USER 三層(沿用 workflow 模式) │
└──────────────────────────────────────────────────────┘
                        ↓
┌─ 2. Form Instance(per-project + 版本鏈)─────────────┐
│   每次改版 = 新 instance,parent_version_id 連起來     │
│   status: DRAFT → ACTIVE → SUPERSEDED → FINAL          │
└──────────────────────────────────────────────────────┘
                        ↓
┌─ 3. Task Generator ──────────────────────────────────┐
│   把 manual 欄位依 owner 分組 → 每組變一個 task        │
│   ERP/自動欄位不產生 task,拉失敗時 fallback 給原 owner│
└──────────────────────────────────────────────────────┘
                        ↓
┌─ 4. Excel Renderer ──────────────────────────────────┐
│   Cell Binding(GUI 拖拉)+ exceljs 填值 + 預設不      │
│   evaluate 公式 + 「pre-evaluate」按鈕走 LibreOffice │
└──────────────────────────────────────────────────────┘
```

### 11.2 Form Template

#### 11.2.1 Schema

```sql
CREATE TABLE qp_form_templates (
  id, name_i18n, project_type_id,
  scope, scope_owner_id, is_default,
  template_version,                   -- template 結構版本
  created_at, created_by
);

CREATE TABLE qp_form_template_fields (
  id, template_id, sort_order,
  field_key,                          -- material_cost_cn
  label_i18n,
  data_type,                          -- currency|number|text|date|enum|matrix|file|computed
  data_type_config,                   -- enum 選項;matrix 列欄;...

  source_type,                        -- manual|erp_proc|mcp_tool|api_connector|bi_query|computed
  source_config,                      -- JSON,各 source 詳細參數

  -- RACI(Phase 1 加 A + R)
  responsible_role,                   -- R: 實作者 'engineer'|'sourcing'|'finance'|...(原 owner_role 重命名)
  responsible_user_resolution,        -- 'fixed'|'project_role'|'dynamic_assign'
  accountable_role,                   -- A: 背鍋者 'DPM'|'BPM'|'MPM'|'EPM'(對齊 multi-PM)

  validation,                         -- {required, min, max, regex}
  display,                            -- {section_id, width, hint}

  is_confidential_default,
  is_in_summary,

  ai_suggest_skill_id,                -- 可選:綁定 skill 給 AI 建議
  ai_explain_skill_id,
  ai_validate_skill_id,

  section_id
);

CREATE TABLE qp_form_template_sections (
  id, template_id, sort_order,
  section_key, label_i18n,
  layout                              -- grid|tabs|accordion
);

CREATE TABLE qp_form_template_calculations (
  id, template_id,
  calc_key,
  formula,                            -- ${material_cost_cn} + ${labor_cost_cn}
  data_type, rounding, is_in_summary
);
```

#### 11.2.2 source_config 範例

```json
// manual
{ "responsible_role": "engineer", "accountable_role": "DPM", "default_value": null, "hint": "..." }

// erp_proc
{
  "procedure_id": 42,
  "parameters": { "factory": "CN", "part_number": "${form.part_number}" },
  "result_path": "$.rows[0].standard_cost",
  "refresh_policy": "on_demand",      // on_demand | cached_24h | live
  "fallback": "manual"
}

// bi_query
{ "datasource_id": 7, "sql_skill_id": 99, "parameters": {...},
  "result_path": "...", "refresh_policy": "live" }

// computed
{ "formula": "${material_cost_cn} + ${labor_cost_cn} + ${overhead_cn}",
  "rounding": 4 }
```

#### 11.2.3 變數替換

語法:`${form.field_key}` / `${project.xxx}` / `${user.xxx}` / `${stage.xxx}`

Evaluator 走 sandbox(`vm2` 或 `expression-eval`),**禁任意 JS**(注入風險)。

#### 11.2.4 ✅ 編輯介面決議

**Phase 1 直接做 GUI Form Builder**(不走 YAML 中繼站)。

理由:一次到位,使用者體驗一致;admin 不用學 YAML 語法。設計參考 typeform / google forms 風格。

#### 11.2.5 ✅ Excel Import / Export(Phase 2)

GUI Builder 的補充工具,**不取代** GUI。

**匯出**:GUI 一鍵下載當前 form template 為 Excel:

```
qp_form_template_quote_standard_v3.xlsx
├─ Sheet: Fields              (field_key, label, data_type, source_type, owner_role, ...)
├─ Sheet: Sections            (section_key, label, layout, order)
├─ Sheet: Calculations        (calc_key, formula, data_type)
├─ Sheet: AI_Suggestions      (field_key, ai_suggest_skill_id, ai_explain_skill_id)
├─ Sheet: Source_Configs      (field_key, source_type, source_config_json)
└─ Sheet: __Meta              (template_id, version, exported_at, ...)
```

每 sheet 帶 header + dropdown 約束 + 欄位說明 + sample 資料。

**匯入**:

```
PM/Admin upload Excel
   ↓
Server 解析 + ajv 驗證 schema
   ↓
顯示 diff 預覽:
   ▸ 新增 5 個 fields
   ▸ 修改 2 個 fields(label_zh-TW、source_config)
   ▸ 刪除 1 個 field(已棄用)
   ▸ ⚠ Source_config 引用了不存在的 procedure_id=999(錯誤)
   ↓
修正錯誤後 → PM/Admin 確認 → 建 template 新版本
舊版本仍引用既有 form instance,不影響歷史
```

**適用情境**:

- 初始大量 setup(50+ fields 一次建)
- 跨 BU 範本分享(寄 Excel)
- 版本快照保存(Excel 存 git 等版控系統)
- Admin batch 修改(篩選 + 改後一次匯入)

**不適用**:即時拖拉 sections / AI 建議按鈕設定 / 即時 preview → 仍走 GUI Builder。

**同樣機制適用 Workflow Template / Task Template Structure**(§14.3),Phase 2 一起做。

### 11.3 Form Instance + 版本管理

#### 11.3.1 Schema

```sql
CREATE TABLE qp_form_instances (
  id, project_id, template_id, template_version,
  version_number,                     -- 1, 2, 3...
  version_label,                      -- '初稿' / '客戶反饋 v1' / '最終版'
  status,                             -- DRAFT|ACTIVE|SUPERSEDED|FINAL
  parent_version_id,
  notes_clob,                         -- 改版說明(必填)
  created_at, created_by,
  activated_at, activated_by,
  superseded_at,

  -- 編輯鎖(single-edit 衝突解決)
  edit_locked_by_user_id,
  edit_locked_at,
  edit_lock_expires_at                -- 30 min 沒動作自動釋放
);

CREATE TABLE qp_form_field_values (
  id, instance_id, field_key,
  value_json,                         -- 非機密
  encrypted_value,                    -- 機密(由 project.confidential_fields 決定)
  source_actual,                      -- 'manual:42' | 'erp_proc:123:2026-04-29T10:00:00Z'
  source_snapshot_id,                 -- → project_erp_snapshots
  filled_at, filled_by,
  is_overridden,                      -- 是否手動覆蓋自動值
  UNIQUE (instance_id, field_key)
);

CREATE TABLE qp_form_calc_results (
  id, instance_id, calc_key,
  value_json, computed_at,
  inputs_hash                         -- 輸入沒變就不重算
);

-- AI 建議快取(對應 §12.5)
CREATE TABLE qp_form_ai_suggestions (
  id, instance_id, field_key,
  suggested_value, suggestion_metadata,
  generated_at, generated_by_skill_id,
  inputs_hash,                        -- 改變才重跑
  accepted_by_user_id, accepted_at,
  UNIQUE (instance_id, field_key)
);
```

#### 11.3.2 改版流程

```
ACTIVE v1
   ↓ PM 點「建立新版本」+ 寫改版說明(必填)
Clone v1 全部 field_values → v2 (DRAFT)
   ↓ v1.status = SUPERSEDED
   ↓ PM 改 v2 內容
   ↓ PM 點「啟用此版本」
ACTIVE v2

最終送出 → status = FINAL → 不可改不可新建
真要改 → admin 解鎖 → 自動建 v3(label 'FINAL_v2')+ audit 加註
```

#### 11.3.3 ✅ 已決議

| # | 決議 |
|---|---|
| Multi-edit 衝突 | **single-edit lock**;同時間只能一人 edit,其他人 read-only,UI 顯示「Mike 編輯中」;30 min 沒動作自動釋放 |
| FINAL 鎖定後改動 | **admin 可解鎖**,自動建新版本(label 'FINAL_v2'),audit 加註(支援結案後補資料場景) |
| 舊版本保留 | **全保留**(audit 完整,storage 量可接受) |

#### 11.3.4 客戶來回議價

- 每收一次反饋 → PM 一鍵建新版,version_label「客戶反饋 vN」/「客戶報價系統反饋 vN」/「內部修正 vN」
- 反饋來源(Phase 1):**PM 手動接收**(客戶報價系統承辦人 Email / Webex 給 PM)後手動建新版
- 反饋來源(Future):客戶報價系統 API 自動 trigger(見 §10.3)
- **diff view**:v(N-1) vs vN 哪些欄位變了 + 變多少
- Timeline:每版的 activated_at + 對應戰情會議室訊息(自動 link)
- 結案時整條版本鏈進 internal KB,脫敏後最終版進 public KB

### 11.4 Task Generator

#### 11.4.1 拆分規則

Form instance 建立(或改版)時自動跑:

- 只看 `source_type='manual'` 的欄位
- 依 `owner_role + section_id` 雙鍵分組(避免一個 owner 跨多 section 變一個巨大 task)
- 每組 → 1 個 task,assigned_to = `resolveOwner(field)`

#### 11.4.2 完成度計算

```
task.completion = filled(tracked_field_keys) / count(tracked_field_keys)

0%      → PENDING
1-99%   → IN_PROGRESS  (戰情會議室顯示「Mike: 3/5 (60%)」)
100%    → REVIEW       (PM review 後 → DONE)
```

#### 11.4.3 ✅ ERP 失敗 fallback 決議

**fallback 給原 owner**(該欄位本來的負責人,他知道該填什麼),不是 PM。
自動建 fallback task,標題加註「ERP 拉值失敗,請人工填寫」。

#### 11.4.4 自動欄位策略

- `on_demand` → form UI 顯示「拉 ERP」按鈕,PM 點觸發
- `cached_24h` → 第一次拉後快取
- `live` → 進 form 時即時打 ERP

機密專案的 ERP 結果寫進 `project_erp_snapshots`(§3.6)。

#### 11.4.5 Form Progress Tile(戰情會議室)

```
報價 Form 完成度:34 / 50 欄位 (68%)
─────────────────────────────────
  成本核算    ████████░░  80%  Mike
  廠區比較    █████░░░░░  50%  John
  策略決策    ░░░░░░░░░░  0%   PM
─────────────────────────────────
  ERP 失敗    1 個欄位       採購 Tony
```

### 11.5 Excel Renderer

> **用途**(對應 §10.3 決議):Phase 1 產出的 Excel 由 PM 下載後**人工傳遞**給下游「客戶報價系統」承辦人,本平台不直接對客戶。Future 雙向串接時,Excel 仍可作 backup 交付通道。

#### 11.5.1 三段式

```
1. Template Upload     管理員/PM 上傳客戶報價系統指定的 Excel 範本
2. Cell Binding Setup  GUI 拖拉設定 form field → Excel cell
3. Generate            生成填好的 Excel,PM 下載後人工傳給客戶報價系統承辦人
```

#### 11.5.2 Schema

```sql
CREATE TABLE qp_excel_template_bindings (
  id, form_template_id,
  excel_file_path,                    -- NFS / object storage
  excel_template_version,             -- 客戶 Excel 範本本身的版本
  bindings_json,                      -- [{ field_key, sheet, cell, transform }]
  recalc_strategy,                    -- 'on_open' | 'libreoffice_headless'
  created_at, created_by, is_active
);
```

`bindings_json` 範例:

```json
[
  { "field_key": "customer_name",      "sheet": "報價單", "cell": "B5"  },
  { "field_key": "material_cost_cn",   "sheet": "成本",   "cell": "C12", "transform": "currency_4dp" },
  { "calc_key":  "total_cost_cn",      "sheet": "成本",   "cell": "C20" },
  { "field_key": "factory_compare",    "sheet": "廠區比較", "range": "B5:E20", "transform": "table_2d" }
]
```

#### 11.5.3 Cell Binding 設定方法

| 方法 | 方式 | Phase |
|---|---|---|
| **GUI 拖拉** | luckysheet 顯示 Excel 預覽,PM 從 form fields 拖到 cell | Phase 1 預設 |
| **Named Range** | 客戶在 Excel 用「定義名稱」標記每格,平台讀 Named Range 自動對應 | Phase 1 進階使用者 |
| **AI 輔助** | LLM 看 Excel 結構 + form fields 建議 binding | Phase 2 |

#### 11.5.4 ✅ 公式重算決議

**Phase 1 預設不 evaluate**,讓客戶 Excel 自己算;額外提供「pre-evaluate」按鈕走 LibreOffice headless。

| 策略 | 用在 |
|---|---|
| **不評估**(預設) | 一般情況,輸出快、依賴客戶 Excel |
| **LibreOffice headless**(按鈕) | 含 Pivot / 客戶要求送已 calc 過的版本 |

**特殊情境**:客戶 Excel 含 Pivot Table 必須走 LibreOffice(否則 pivot stale)。

#### 11.5.5 不能用 exceljs 處理的情境

- **複雜 Pivot Table** → 必須走 LibreOffice headless
- **VBA 巨集**(`.xlsm`)→ 拒絕含巨集的範本
- **Power Query 連外部資料** → 拒絕,要客戶調整範本

#### 11.5.6 範本變更管理

客戶定期更新 Excel 範本時:

- 範本有 version,新版上傳時自動 cell diff
- PM admin UI review:哪些 binding 還對得上、哪些失效
- 已活躍的 form_instance 仍引用舊版 binding(歷史報價單樣式不變)

### 11.6 與其他模組整合

| 接點 | 怎麼接 |
|---|---|
| Workflow Template | form_template 可綁定 stage(進入 stage 自動建 instance + task) |
| QUOTE Plugin | form / source_resolver / excel_renderer 全在 QUOTE plugin namespace |
| Resource Binding | form 內 erp_proc / mcp_tool 受 user 權限驗證,沒權限 → fallback manual |
| Confidential Fields | field 的 `is_confidential_default` 進 project.confidential_fields;未授權者看顯示策略後的版本 |
| ERP Snapshot | erp_proc 拉的值同時寫進 `project_erp_snapshots`,結案時 KB 從 snapshot 撈 |
| KB Sediment | form_instance 整鏈進 internal KB;最終版脫敏進 public KB;Excel 大檔走 file storage |
| AI Bot | 見 §12.5 — Bot 對 form 走「建議,不直寫」原則 |
| Audit Log | 改版、ERP 拉值、Excel 生成 都進 `project_audit_log` |

### 11.7 風險

| # | 風險 | 緩解 |
|---|---|---|
| F1 | Form schema 太彈性 → 各 BU 自定義 → 跨 BU 統計困難 | 核心欄位(amount/margin/customer)走通用 schema 強制必填 |
| F2 | Excel 模板複雜 → cell binding 工作量大 | Pilot 期 admin 親自 setup;Phase 2 上 AI 輔助 mapping |
| F3 | ERP 拉 100+ 欄位 latency 高 | 批次拉(Promise.all)+ 快取 + UI 進度條 |
| F4 | computed 公式注入風險 | sandbox(vm2 / expression-eval),禁任意 JS |
| F5 | 版本爆炸 | 接受;改版必填 notes |
| F6 | 客戶 Excel 含 Pivot / VBA → 處理不來 | Pivot 走 LibreOffice;VBA 拒收;Power Query 要客戶調整 |
| F7 | Form 進度 ≠ 真實品質 | PM 在 REVIEW 階段 sample 抽查 |

---

## 12. AI Bot 架構

> Bot 是 Cortex 既有能力在專案內的延伸,不是另起新系統。本章定義 Bot 在專案內的「角色 / 邊界 / 權限 / 整合點」。

### 12.1 Bot 出現的兩個 surface

```
┌─ Surface 1: 戰情會議室聊天框 ────────────────────────┐
│   @bot 這個料號去年給其他客戶報過嗎?                 │
│   @bot 跑一下 BOM 展開                              │
│   @bot 寫一段「廠區優先越南」的決策紀錄              │
│   ▸ user-triggered,即時對話                         │
│   ▸ 結果是訊息,可被 Pin / 進 KB                     │
└──────────────────────────────────────────────────────┘

┌─ Surface 2: Form 內「AI 建議」按鈕 ─────────────────┐
│   每個欄位旁可選掛「✨ AI 建議」按鈕(plugin 配置)   │
│   點下去 → Bot 跑對應 skill → 產出建議              │
│   user 確認後寫進欄位(不直接寫,§12.5)             │
└──────────────────────────────────────────────────────┘

(次要 surface:結案 archive pipeline、SLA 即時提醒 — 屬「自動化 worker」,
 不算 Bot,設計分開談)
```

### 12.2 Bot 的 4 類能力 + 權限分級

| 類別 | 例 | 風險 | 設計 |
|---|---|---|---|
| **1. 問答檢索** | 歷史類似案 / BOM 展開 | 低 | 預設開放,走 RAG + tool call |
| **2. 執行工具(read-only)** | 跑 ERP procedure / MCP / API 連接器 | 中 | 沿用 user 既有權限,失敗 fallback 提示 |
| **3. 產生內容** | 寫摘要 / 翻譯 / 建議文字 | 中 | 結果是「draft」,user 必須 confirm 才落地 |
| **4. 執行動作(write)** | 改 form / 建任務 / 推進 stage / 結案 | 高 | **預設禁**;只有白名單 action 可做且必須 user 二次確認 |

### 12.3 權限模型:Bot 是 user 的代理人

關鍵原則:**Bot 永遠以發起 user 的身份執行**(沿用 Cortex 既有 X-User-Token 機制)。

- Bot 不會因「跑在 server」而有 superuser 權限
- user 沒看到的機密欄位,Bot 也只能用「顯示策略後的版本」(Tier-A / A001)推理
- ERP / MCP 工具 user 沒權限 → Bot 也叫不到
- → **權限體系維持單一**,不為 Bot 另設

### 12.4 機密欄位的雙段 Scrub

```
INPUT 流(進 LLM 之前):
  ├─ 來自 form / KB / 訊息流的 raw text
  ├─ 經 confidentialityMiddleware 已換成「該 user 看的版本」
  ├─ 再經 plugin.scrub_rules 換成 placeholder
  │   (Tier-A → [PRICE_01] / Apple → [CUST_01])
  └─ 送給 LLM(Gemini / Azure)

OUTPUT 流(LLM 回來):
  ├─ LLM 回應含 [PRICE_01] [CUST_01]
  ├─ Unscrub:替回 user 看的版本(Tier-A / Apple / A001)
  └─ 寫進訊息流 + 顯示給 user
```

**為何兩段都要 scrub**:

- 第一段 confidentialityMiddleware 確保「user 沒權看的金額,Bot 也看不到真值」
- 第二段 scrub 確保「LLM 服務商的 log 永遠看不到任何 raw 資料」(Tier-A 都不該洩,因為是 Foxlink 內部分級)

### 12.5 Form 互動原則

Bot 看 Form 時:

- 看到的是該 user 視角的 form(field_grants 已套用)
- Bot 要「填欄位」 → **走建議,不直寫**
  - Bot 把建議值寫到 `qp_form_ai_suggestions` 影子表
  - form UI 顯示「✨ AI 建議:1.245 USD/pcs」+ accept/reject 按鈕
  - user accept 後才寫進 `qp_form_field_values`
- **例外**:`source_type=erp_proc` 等結構化來源,user 點「拉 ERP」直接寫(這是 wrapper,不是 Bot 創造)

→ 避免 Bot hallucination 改錯了 PM 沒發現。

#### 12.5.1 Form Template 的 AI 整合點

Form template 在 field 上加可選欄位(已在 §11.2.1 Schema):

| 欄位 | 用途 |
|---|---|
| `ai_suggest_skill_id` | 哪個 skill 產建議 |
| `ai_explain_skill_id` | hover ? 圖示時跑哪個 skill 解釋 |
| `ai_validate_skill_id` | 填完後跑 sanity check |

例:
- 「報價金額」→ ai_suggest = `pricingRecommend` skill
- 「廠區建議」→ ai_suggest = `factoryRecommend` skill
- 「客戶信用」→ ai_validate = `creditCheck` skill

→ 全部走 Cortex 既有 skill 機制,平台層不寫死任何業務邏輯。

#### 12.5.2 ✅ AI 建議按鈕觸發成本決議

**走 cache + inputs_hash 比對**(`qp_form_ai_suggestions.inputs_hash`):

- 第一次點 → 跑 skill + 寫入 cache
- 後續點 → 比對 inputs_hash,沒變化直接從 cache 取(秒回)
- inputs 變化 → 重跑 + 更新 cache

理由:計算成本可控、user 看到的建議穩定(不會每次點不一樣的數字)。

### 12.6 Bot 高風險 action 白名單

#### 12.6.1 Phase 1 ✅ 開放範圍

開放:

| Action | 設計 |
|---|---|
| **建 task** | Bot 給 task draft → 訊息流出現「建議建立任務:...,確認嗎?」→ user 點 yes 才建 |
| **Form 欄位建議** | 走 ai_suggestion 影子表 + user accept(§12.5) |

禁止(Phase 1 一律拒絕):

| Action | 理由 |
|---|---|
| Pin 訊息 | 避免 Bot 自己置頂 |
| 推進 stage | 關鍵業務動作,人決定 |
| 結案 | 同 |
| 改機密欄位 / 改 confidential_fields | 安全紅線 |
| Emergency purge | 超權限 |
| 邀請 / 踢成員 | 安全紅線 |

→ 維持「人為決策、Bot 為輔助」分界。

### 12.7 Audit + KB 寫入

- 每次 Bot tool call → `project_audit_log` 記錄(誰呼叫、用什麼工具、輸入參數、輸出 hash)
- Bot 跑的 LLM 對話 → 寫進 `chat_messages` 同一條訊息流(role='assistant'),不另存
- Bot 對機密欄位的解密請求 → 加重 audit(emit `BOT_DECRYPT_FIELD` 事件)
- 與「user 親自做」一視同仁 — 因為是 user 代理

Bot 訊息進 Live KB:

- 一般回答 → 進 batch(§7.3)
- 被 user Pin 的回答 → 立即 vectorize,獨立 doc(`source_type='bot_pinned'`)
- 結案歸檔時,Bot 對話的精華被 LLM 摘要進 closure_summary

### 12.8 機密 vs 非機密的差別

| 維度 | 非機密 | 機密 |
|---|---|---|
| Scrub 程度 | 標準(客戶名 / 金額) | 加嚴(plugin 提供的擴充字典) |
| 跨案查詢 | 可查 `projects-*-public` + 同 BU internal | 同 |
| ERP 結果送外部 LLM | 直接送 | 先 scrub |
| Bot 對解密欄位的存取 | N/A | 走 confidentialityMiddleware,跟 user 同步 |
| 高風險 action 白名單 | 同 | 同(不因機密放寬或收緊) |
| Bot 加入時提醒 | banner「Bot 已加入」 | 加重提醒「機密專案,所有對話經 LLM 處理」 |

### 12.9 Token 額度(獨立計算 + 不卡使用)

#### 12.9.1 ✅ 決議

- **計算要分開**:Bot 用量按 `(user_id, project_id, project_type, model)` 多維度記錄(`token_usage` 表加 `project_id` / `project_type` 欄位)
- **不卡使用**:user 個人額度滿了 → **只 warn,不 block**;專案操作要永遠能跑
- **block 只在 admin 全域層級**:全公司 LLM 預算超過時,admin 可手動降級或限流

#### 12.9.2 主管視角的 cost 分析

Cost dashboard 切片:

| 切片 | 用途 |
|---|---|
| Per project | 哪個專案燒最多 token |
| Per project_type | QUOTE vs IT vs Training 的 AI 使用密度 |
| Per BU | 各事業處 AI 投入 |
| Per user | 個人使用熱度(可選擇關掉,避免 micro-management) |
| Per skill | 哪個 skill 最耗 token(優化重點) |

#### 12.9.3 與 Cortex 主帳本的關係

- Cortex 全公司 token_usage 主帳本不變
- 專案平台是「擴充欄位」,不另起帳本
- 查詢時 admin UI 提供 filter「限定 project_id」即可切出專案視圖

### 12.10 ✅ AI 加速能力(Phase 1 末 10 項 + 開案 Wizard)

> 業務 RFQ 流程在 8 個 stage 中,可用 AI 加速的點散落各處。本節列出 Phase 1 末必上的 12 項(8 必上 + 4 加分)。
>
> 設計原則:**沿用既有 AI Bot / RAG / scrub 機制**,不另起 ML pipeline(P3 才上)。Phase 1 末用 Gemini Flash 為主(便宜快)。

#### 12.10.0 AI 改進對應流程圖

```
RFQ 進來 ──→ 開案 ──→ Q&A ──→ BOM ──→ 並行 ──→ 核算 ──→ 策略 ──→ 送出 ──→ 結案
              ① ②       ⑤        ⑩      ⑭                               ㊱
   ④                                                                      
                              全程同步:⑳ ㉓ ㉔ ㉖ ㉛ 
```

(數字對應下表 12 項)

#### 12.10.1 ⭐ Status Summary(#21,核心特色)

**最重要的功能** — 所有人不用爬 channel 就能看到專案當下狀態。

**顯示位置(3 處)**:

| 位置 | 觸發 | 形式 |
|---|---|---|
| `#announcement` channel | 自動每天 09:00 + 手動「@bot 給我 summary」+ stage 切換時 | Pinned 訊息(取代昨日) |
| 專案列表 | 開列表時即時(cache 30 min refresh) | 每行專案下一行灰字摘要 |
| 跨專案儀表板 Watchlist | 同上 | hover 顯示完整摘要 |

**摘要結構 prompt template**:

```
{狀態一句話}
─────────────────────────
🔵 進度:當前 stage / 已完成 X% / 哪幾個 task 在跑
🟡 風險:Blocker / SLA 接近 / 客戶卡 Q&A
🟢 待辦:接下來 24h 要做什麼 / 等誰確認
```

**範例輸出**:

```
QT-2026-0143 / Apple / 越南廠
"等客戶 Q&A 回覆,後段 BOM 提供已 ready"
─────────────────────────
🔵 進度:Stage 3 (Q&A Feedback),BOM 提供已預先做完
🟡 風險:客戶 5 天沒回 Q&A,SLA 已 80%
🟢 待辦:BPM 應主動 follow up;DPM 可同步 stage 5 並行 collect
```

**技術實作**(沿用既有架構):

```
跨所有 channel(announcement/general/各 group) 最近 24h 訊息
   ↓
+ 任務狀態(§14)+ Form 完成度(§11)+ Stage 狀態(§14.8)
   ↓
plugin scrub(機密欄位 → Tier-A,§12.4)
   ↓
LLM(Gemini Flash,便宜快,§12.9 token 帳本)
   ↓
輸出 + unscrub
   ↓
Pin 進 announcement / 寫進 cache 給列表用
```

#### 12.10.2 Phase 1 必上(8 項)

| # | AI 改進 | 觸發 | 實作要點 |
|---|---|---|---|
| **1** | **客戶 RFQ 自動解析** | 業務拖 Email/PDF/Excel 進開案頁 | LLM 抓客戶名/料號/數量/交期 → 預填 form |
| **2** | **歷史相似案推薦 + 建議 PM** | 開案時 | RAG 搜沉澱 KB(同 BU + public)→ 推薦 N 案 + 過去處理過此類客戶的 PM |
| **5** | **Q&A 問題自動草稿** | DPM 在 #qa-customer channel 點「AI 列問題」 | LLM 看 RFQ + PRD → 列出規格不清 / 矛盾點 |
| **21** | **⭐ 狀態 SUMMARY** | 自動 + 手動 + stage 切換 | 見 §12.10.1 |
| **23** | **AI 自動寫決策紀錄** | 訊息流偵測「決定」「同意」「結論」關鍵字 | LLM 抓出 DECISION 自動格式化 + 建議 Pin(走白名單 §12.6) |
| **24** | **未讀訊息智慧排序** | 進 channel 時 | 不按時間排,按重要度(@我 / DECISION / BLOCKER / 普通) |
| **26** | **Bot 主動提醒** | SLA 70% 但 owner 沒動作 | Bot 主動在訊息流 @owner「task X 還剩 N 小時,需要協助嗎?」(對應 §16 規則式警示 widget A) |
| **29** | **任務自動拆解** | PM 寫一句話「跑越南廠成本對比」 | LLM 拆子任務 + 估時 + 推 owner(走 ai_suggest 影子表 §11.2.5) |

#### 12.10.3 Phase 1 加分(2 項,有時間就上)

| # | AI 改進 | 觸發 | 實作要點 |
|---|---|---|---|
| **32** | **交期合理性 check** | 開案時 + 客戶反饋時 | LLM 看客戶要求交期 vs 歷史平均週期 → 紅黃綠評估 |
| **37** | **歷史相似案主動推薦** | open project 時 + Stage 切換時 | 跟 #2 整合,但持續主動推薦(每 stage 不同重點) |

> **移除**(2026-05-04 user 修正):
> - ❌ #10 長料件預警 — 試產轉量產才需要,不在 RFQ 階段做
> - ❌ #14 三廠成本對比 AI 解讀 — 廠區是客戶指定,移到未來規劃書

#### 12.10.4 Phase 2 / 3 規劃(展望)

**Phase 2 加深**:
- 跨 channel 懶人包(#22)
- 離線 catch-up(#25)
- BOM 自動展開(#8)
- Cleansheet 草稿(#12)
- AI 智慧定價(#16)
- 主管 AI 日報(#33)
- 結案 AI 摘要強化(#36 map-reduce)
- Excel cell binding AI 推薦(#40)
- 新人 onboarding 教練(#38)

**Phase 3 加 ML**:
- 贏單機率預測(#17)
- What-if 模擬(#18)
- 異常 pattern 偵測(#31)
- 任務狀態預測(#30)

#### 12.10.5 成本估算(Phase 1 末)

```
100 active 專案
   × 每天 1-2 次 summary(#21)= 150 calls
   × Q&A 草稿(#5)= 10 calls
   × 任務拆解(#29)= 30 calls
   × 決策紀錄(#23)= 50 calls(僅關鍵字觸發後)
   × Bot 主動提醒(#26)= 20 calls
   × RFQ 解析(#1)= 5 calls(只在開案時)
   × 其他 ≈ 50 calls
─────────────────────────────────────────
   ≈ 315 LLM calls / 天
   ≈ 9,500 calls / 月
   走 Gemini Flash → 預估 USD ~$150-250 / 月
   + Vertex AI embedding(已既有)
```

→ 可接受,且大幅降低業務作業時間。

#### 12.10.6 ✅ 10 項 Phase 1 末上線清單 + 開案 Wizard(對應 Phase 規劃)

| Phase 1 必上(8) | Phase 1 加分(2) |
|---|---|
| 1, 2, 5, 21, 23, 24, 26, 29 | 32, 37 |

→ 全部走既有 §12 AI Bot 架構,plugin 提供 prompt template + scrub rules。
→ 對應實際 Phase 1 開發增加約 1.5-2 週工時(P1 從 4 週變成 6 週)。

#### 12.10.7 ⭐ 開案 Wizard(整合 AI #1 / #2 / #32 / #37)

> **重要**:把開案 50+ 項設定**包成 7 步驟 wizard**,大量靠模板 + AI 預填,業務只要 confirm。

**為什麼**:系統設定複雜(workflow / channel / 機密 / 角色 / dependency),業務不可能記住;開案就放棄。

**7 步驟流程**:

```
Step 1: 客戶來信
   業務拖 RFQ Email/PDF/Excel 進來
   → AI 解析 (#1 RFQ 自動解析)
   → 預填客戶名/料號/數量/交期
   → 業務 confirm/微調

Step 2: 歷史參考
   AI 顯示「過去類似 N 案」(#2 歷史相似案)
   推薦 PM(處理過此類客戶的)(#37 持續推薦)
   推薦 workflow template(對齊 OIBG QUOTE_STANDARD)
   AI 預估完成週期
   AI 交期合理性 check (#32)— 紅黃綠燈

Step 3: 機密設定
   AI 預判「該案是否機密」(基於客戶 Tier / 預估金額)
   預勾 confidential_fields(amount/margin/cost_breakdown)
   業務 confirm

Step 4: PM / Team
   業務指派主 DPM(從 AI 推薦清單選)
   系統依 workflow template 預先建議其他 PM(BPM/MPM/EPM)
   業務 confirm 或調整

Step 5: 流程模板
   套用 workflow template(預設 OIBG 8 stages)
   AI 預估各 stage 截止日(Dependency-based,對應 RFQ Schedule)
   業務調整 / confirm

Step 6: 重要 / 緊急
   業務設 importance / urgency
   AI 建議 priority_score(基於客戶歷史 + 數量 + 戰略客戶清單)
   業務 confirm

Step 7: 確認 + 啟動
   一頁預覽所有設定
   業務按「啟動專案」
   ↓
   系統自動:
     ▸ 建 project
     ▸ 建 7 channels(announcement/general/qa-customer/engineering/sourcing/factory/cost-review)
     ▸ 建 8 stages(workflow_template stages)
     ▸ 自動建初始 task(stage 1 on_enter hook)
     ▸ 通知所有相關人員(Webex + 站內)
     ▸ 在 #announcement Pin 「專案啟動」訊息
```

**業務體感**:
- 從「設 50 個項目」→「7 步驟 wizard,大部分 AI 預填」
- 開案時間從 30 分鐘 → 5 分鐘
- 第一次用沒問題,第二次更熟

**Wizard 之後**:PM 接手後仍可在專案頁細調(改 channel / 加 task / 改流程)— Wizard 是「快速啟動」,不是「終局設定」

---

### 12.11 ✅ 已決議總覽

| # | 議題 | 決議 |
|---|---|---|
| 1 | Bot 跨專案查詢預設 | **預設開放**(查同 BU internal + public) |
| 2 | Token 額度 | **per-project 計算 + 不卡 user**;只 warn 不 block |
| 3 | AI 建議按鈕觸發成本 | **cache + inputs_hash**,變化才重跑 |
| 4 | Bot 在戰情會議室預設角色 | **自動加入**;機密專案加重提醒「對話經 LLM 處理」 |
| 5 | Phase 1 白名單 action | **開放「建 task」+「Form 欄位建議」**;其他禁 |

---

## 13. 戰情會議室架構(多 Channel 模型)

> 戰情會議室是 active 階段的核心協作面。**v0.4 重構為 Slack/Teams 風格的多 channel 模型**:每個專案下有公告 / 群組討論 / Topic ad-hoc / 1對1 私聊,可隨時開新對話。
>
> 解決原痛點:DECISION 訊息會在單一 stream 裡迷路、跨組討論互相干擾、機密私聊無處去。

### 13.1 多 Channel 模型(取代「一專案一聊天室」)

```
專案 (Project)
  │
  ├─ 📢 #announcement(公告 channel)
  │    ▸ 自動建立,所有 project member 自動加入,不能離
  │    ▸ 只有 HOST(業務 / PM)能發訊息
  │    ▸ **每則必須已讀回執**
  │    ▸ 用於:廠區決策、客戶反饋彙整、結案宣告
  │
  ├─ 💬 #general(預設群組,沿用既有單一聊天體驗)
  │    ▸ 自動建立,所有 member 自動加入
  │    ▸ 全員可發,訊息色語言全套
  │
  ├─ 💬 #group-channels(host 自建,如 #engineering / #sourcing / #factory)
  │
  ├─ 💬 #topic-channels(ad-hoc 議題,任何 member 可建)
  │
  ├─ 🤖 @bot(在每個 channel 都可被 @)
  │
  └─ 🔒 DM(1:1 私聊,雙方可發起)— ✅ Phase 1 直接上
```

#### 13.1.1 Schema 草案(Channel-based)

```sql
-- 取代 project_meeting_rooms,改成 1 project = N channels
CREATE TABLE project_channels (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            NUMBER NOT NULL,
  channel_type          VARCHAR2(20) NOT NULL,       -- announcement|general|group|topic|dm
  name                  VARCHAR2(100),               -- #engineering / #cost-cn-debate / DM:Amy↔John
  description           CLOB,

  is_default            NUMBER(1) DEFAULT 0,         -- announcement / general 自動建
  is_pinned_to_top      NUMBER(1) DEFAULT 0,         -- 公告固定置頂
  is_open_to_super_users NUMBER(1) DEFAULT 1,

  -- DM 特例
  dm_user_a_id          NUMBER,                      -- DM 才用,sorted ascending
  dm_user_b_id          NUMBER,

  -- 機密旗標(可獨立於 project,例:跨組 confidential 群組)
  is_confidential       NUMBER(1) DEFAULT 0,

  created_by_user_id    NUMBER,
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  archived_at           TIMESTAMP,                   -- channel 歸檔(read-only)
  UNIQUE (project_id, name)
);

CREATE INDEX idx_pc_project_type ON project_channels(project_id, channel_type);
CREATE UNIQUE INDEX idx_pc_dm ON project_channels(project_id, dm_user_a_id, dm_user_b_id) WHERE channel_type='dm';

CREATE TABLE channel_participants (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id            NUMBER NOT NULL,
  user_id               NUMBER NOT NULL,
  role                  VARCHAR2(20) NOT NULL,       -- OWNER|MEMBER|OBSERVER|CHAT_GUEST|SUPER_PARTICIPANT
  joined_at             TIMESTAMP DEFAULT SYSTIMESTAMP,
  joined_by             NUMBER,
  joined_via            VARCHAR2(40),                -- channel_default_auto|host_invite|self|super_user_self_join|guest_invite_dual_sign
  last_read_message_id  NUMBER,                      -- 未讀計算
  last_active_at        TIMESTAMP,
  notification_pref     VARCHAR2(20) DEFAULT 'all',  -- silent|mentions_only|all
  removed_at            TIMESTAMP,
  removed_by            NUMBER,
  removed_reason        VARCHAR2(200),
  UNIQUE (channel_id, user_id)
);

-- 訊息加 channel_id(取代 room_id)
ALTER TABLE ticket_messages ADD (
  channel_id            NUMBER NOT NULL,             -- → project_channels.id
  message_type          VARCHAR2(20) DEFAULT 'NORMAL',  -- NORMAL|PROGRESS|BLOCKER|DECISION|AI_INSIGHT
  is_pinned             NUMBER(1) DEFAULT 0,
  pinned_by             NUMBER,
  pinned_at             TIMESTAMP,
  requires_read_receipt NUMBER(1) DEFAULT 0,
  synced_to_announcement NUMBER(1) DEFAULT 0,        -- DECISION 是否同步到公告 channel
  deleted_at            TIMESTAMP,
  deleted_by            NUMBER,
  deletion_mode         VARCHAR2(20),                -- standard|emergency_purge
  deletion_reason       VARCHAR2(500),
  content_hash          VARCHAR2(64)
);

-- super_user(同既有設計,進專案後 self-join 任一 channel)
CREATE TABLE project_super_users (
  id, user_id UNIQUE,
  scope,                                             -- GLOBAL|BU
  bu_ids,                                            -- JSON array
  can_read_chat NUMBER(1) DEFAULT 1,
  can_write_chat NUMBER(1) DEFAULT 0,
  can_join_confidential NUMBER(1) DEFAULT 1,
  granted_by_admin_user_id, granted_at, expires_at,
  is_active NUMBER(1) DEFAULT 1
);
```

### 13.2 Channel Types(5 種)

| Channel Type | 自動建? | 誰能發 | 訊息色全套 | Pin | 已讀回執 | 自動寫 KB |
|---|---|---|---|---|---|---|
| **announcement** | ✅ 自動 | 限 HOST(業務/PM)| ⚠ 簡化 | ✅ 全自動 | ✅ **每則必須** | ✅ 全寫 |
| **general** | ✅ 自動 | 全員 | ✅ 全套 | host 手動 | DECISION 強制 | batch 寫 |
| **group** | host 自建 | 該 channel members | ✅ 全套 | OWNER 手動 | DECISION 強制 | batch 寫 |
| **topic**(ad-hoc) | member 自建 | 該 channel members | ✅ 全套 | 可選 | 不強制 | batch 寫 |
| **dm**(1:1 私聊) | 雙方發起 | 雙方 | ⚠ 簡化(NORMAL + AI) | 可選 | 不強制 | **預設不寫** |

### 13.3 Channel-level 角色 + 專案級 HOST 定義

#### 13.3.0 ✅ 專案 HOST 定義(更新)

**HOST = 業務 + 業務助理(role='SALES')**;PM **不是 HOST**。

| 動作 | 業務(主 + 助理) | DPM(主 PM) | 其他 PM(BPM/MPM/EPM) | MEMBER |
|---|---|---|---|---|
| 結案 / 換主 PM | ✅ | ❌ | ❌ | ❌ |
| 改機密欄位設定 | ✅ | ❌ | ❌ | ❌ |
| 邀請 / 踢任何成員 | ✅ | ❌ | ❌ | ❌ |
| 邀請 / 踢自己 team 成員 | ✅(全) | ✅(自己邀的) | ✅(自己邀的) | ❌ |
| 開 group channel | ✅ | ✅(自己 team) | ✅(自己 team) | ❌ |
| 開 topic channel(ad-hoc) | ✅ | ✅ | ✅ | ✅ |
| 發 announcement | ✅ | ❌ | ❌ | ❌ |

→ 業務必在線才能做 HOST 動作(業務 + 業務助理總有一人在,不需 PM 代理)。

#### 13.3.1 Channel-level 角色

| 角色 | 範圍 | 權限 |
|---|---|---|
| **OWNER** | 自建 channel 的人 | 邀人 / 踢人 / 改 channel 屬性 / 歸檔 |
| **MEMBER** | 一般成員 | 讀寫,刪自己訊息 |
| **OBSERVER** | 唯讀 | 看不能寫 |
| **CHAT_GUEST** | 非 project_member 但被邀進 channel | 看 chat,看不到 form / 機密欄位 |
| **SUPER_PARTICIPANT** | super_user self-join 後 | 看完整,寫權看 admin 設定 |

#### 13.3.2 ✅ 誰能建 channel 決議

| Channel Type | 誰能建 |
|---|---|
| announcement / general | 系統自動(專案建立時)|
| group | **業務 / 業務助理 / PM**(PM 限自己 team 用)|
| topic | **任何 project member** |
| dm | 任何 user 可發起 1:1 |

→ 群組要管(避免亂開),DM 不卡(個人空間)。

#### 13.3.3 PM Team 自然涌現(✅ 新概念)

各 PM 邀進來的 member 自動「歸屬該 PM team」(走 `project_members.invited_by_pm_user_id`,§3.3)。

**戰情會議室成員面板 UX**:依 PM 分組顯示

```
👤 業務組(HOST)
   Amy(業務發起人)
   Lisa(業務助理)

🔧 DPM Team(Mike — 主 PM)
   John(EE)
   Lin(ME)
   Wang(RD)

🏭 MPM Team(Tony)
   Chen(SMT)
   Wu(EPM)
   Zhao(採購)

💼 BPM Team(Lisa-B)
   (客戶窗口 / 助理)
```

**邀請權限**:PM 限邀進自己 team(`invited_by_pm_user_id = 自己`);只有業務可跨 team 邀。

#### 13.3.4 與 project_members 的關係

- `project_members` 控制 form / 任務 / 機密欄位
- `channel_participants` 控制各 channel 存取
- 加入專案時自動加入 announcement + general(必加),其他 channel 看 host 邀請或 self-join

### 13.3 Super User(✅ 新概念)

#### 13.3.1 兩級 scope

| 級別 | 範圍 | 適用對象 |
|---|---|---|
| `GLOBAL` | 全公司所有專案 | 老闆 / 集團高階 / 法務長 |
| `BU` | 指定 BU(可多個) | 事業處 GM / 副總 |

#### 13.3.2 進入流程

```
admin 授予某 user 為 super_user(scope=GLOBAL or BU=[1,3,5])
         ↓
該 user 「我的專案」頁有「全部專案」tab
         ↓
看到範圍內所有專案,點任一個 → 一鍵加入聊天室
         ↓
進入時:
  ▸ audit log 記錄 SUPER_USER_JOIN
  ▸ 訊息流推一條「Director 王XX 已加入」
  ▸ join 後在 meeting_room_participants 變一筆 role='SUPER_PARTICIPANT'
```

#### 13.3.3 預設權限

- 預設**唯讀**(類似 OBSERVER)
- admin 可勾「`can_write_chat`」flag,讓特定老闆能直接參與討論
- 永遠看得到完整 form(機密欄位的 confidential_fields + field_grants 視為「director 等級」自動全授權)
- **不能** 踢人 / 結案 / 改 form / 改 confidential_fields(維持 PM/業務 主導)

#### 13.3.4 與 `project.director` 的差別

| 維度 | director | super_user |
|---|---|---|
| 看得到 | 權限內所有專案的「概覽 + 進度」 | 同 |
| 進聊天室 | 不主動進,要 host 邀請 | **主動 self-join**,不需邀請 |
| 寫訊息 | 不能 | **可開放(admin 控制)** |
| 改機密欄位 | 永遠看明文 | 同 |
| 範圍 | 自己 BU 內 | GLOBAL or 指定多 BU |

→ super_user 是 director 的擴充:director 看,super_user 還能進去討論。

#### 13.3.5 機密專案的特殊規則

- super_user 預設**可進機密專案**(信任度等同 director)
- admin 授權時可關閉(`can_join_confidential = 0`),例如某老闆只想看一般專案
- 進入時 audit 加重(`SUPER_USER_JOIN_CONFIDENTIAL`),通知該專案 PM + 業務

#### 13.3.6 任期

- `expires_at` 可選 — 例如代理執行長 3 個月任期
- 過期後 `is_active=0`,當前已加入的聊天室自動降級為 read-only,新專案不能 self-join

### 13.4 機密 vs 非機密差別

| 動作 | 非機密 | 機密 |
|---|---|---|
| HOST 邀 project_member | 直接 | 直接 |
| HOST 邀 chat_guest(非 member) | 直接 | 業務或 PM approve(雙簽) |
| chat_guest 看 form | 看得到非機密欄位 | 完全看不到 form |
| Bot 加入提醒 | banner「Bot 已加入」 | 加重「機密專案,所有對話經 LLM 處理」 |
| super_user self-join | 一鍵 | 同(若 `can_join_confidential=1`) |
| 跨 BU 邀請外部成員 | 業務 owner + 該外部 BU 主管 approve | 同 + audit 加重 |

### 13.5 訊息刪除策略

#### 13.5.1 雙模式

```
┌─ 模式 1: 標準刪除 ───────────────────────────────────┐
│   訊息變 placeholder「[已刪除]」                     │
│   原 metadata 保留(誰發的、什麼時間、deletion_mode) │
│   被引用 / 回覆的脈絡不破壞                          │
│   KB 同步刪 chunk(走 §7.6 標準刪除)                 │
└──────────────────────────────────────────────────────┘

┌─ 模式 2: 緊急清除 ───────────────────────────────────┐
│   訊息完全消失(連 placeholder 都沒)                │
│   KB 走 emergency purge(force sync Text index)      │
│   引用該訊息的脈絡顯示「[已從紀錄移除]」             │
│   必填理由(audit 加重)                             │
└──────────────────────────────────────────────────────┘
```

#### 13.5.2 ✅ 階段權限決議

| 階段 | 標準刪除權限 | 設計 |
|---|---|---|
| **進行中** | 本人**隨時**可刪(無 24h 限制) | 簡化操作;audit 標記時間越久越可疑 |
| **結案後** | 預設禁 | 需 admin 解鎖 + 特許流程(同 FINAL form 解鎖機制) |

→ 不再做「24h 內外不同權限」,改用 audit 加重 + 結案後鎖定。

#### 13.5.3 ✅ 緊急清除權限決議

**本人 + host(業務 / PM)** 可用。

理由:機密誤傳通常 sender 自己最快發現;sender 離線時 host 也要能即時處理。

#### 13.5.4 ✅ chat_guest 被踢後決議

**立即撤銷讀取權限,過去訊息也無法再 access**。

- platform 控制「未來訪問權」 — 從踢出時刻起,該 user API 任何 read 都 403
- 「他眼睛已經看過」這事實 platform 無法控制(屬人事流程,不在平台範疇)
- 緊一點以避免機密再洩漏 — 這是 PM/業務的特權保留
- audit log 完整記錄(誰踢的、何時、原因)

#### 13.5.5 Pin / 引用訊息

| 情境 | 處理 |
|---|---|
| 訊息已被 Pin → 想刪 | 必須先 Unpin 才能刪;Pin 是「重要決策」,不能默默消失 |
| 訊息已被 reply 引用 | 可刪。原訊息變 placeholder,reply 顯示「[原訊息已刪除]」 |
| 訊息已有「已讀回執」(DECISION) | 可刪,但加重提示「此訊息有 N 人已讀,確定刪除?」+ audit |

#### 13.5.6 上傳檔案

- 本人:任何時候可刪(走標準或緊急,user 自選)
- host(業務 / PM):任何時候可刪任何成員的檔案(機密專案場景)
- 一旦刪,KB chunks 同步 emergency purge,Storage 物理刪除
- 標準刪除有 30 秒 undo buffer

#### 13.5.7 Audit 與保密的衝突

| 項目 | 標準刪除 | 緊急清除 |
|---|---|---|
| 訊息內容 | 不留(只留 hash) | 不留(只留 hash) |
| Sender + timestamp | 留 | 留 |
| 刪除者 + 刪除時間 | 留 | 留 |
| 刪除理由 | 不必填 | 必填 |
| Hash 用途 | 法務可請 sender 提供原文 + 比對 hash 驗證 | 同 |

→ 內容不留,但「有人發 → 有人刪」永遠在 audit。

### 13.6 訊息 retention

#### 13.6.1 ✅ 全部永久保留決議

平台基線改成「**永久保留**」(除非有特殊刪除設定)。

| 物件 | retention |
|---|---|
| chat 訊息 | 永久(除非走 §13.5 標準/緊急刪除) |
| 上傳檔案 | 永久(除非走 §13.5.6 刪除) |
| KB chunks(live + 沉澱) | 永久(同步 §7.12 更新) |
| Audit log | 永久 |

#### 13.6.2 對 §7.12 的影響

原規劃「archive live KB 1 年後 drop partition」**取消**。改:

- live KB → 結案 + 30 天後 → rename `archive-project-{id}-live` 唯讀
- archive live KB → **不 drop**,永久保留
- partition 容量靠以下機制控制成本(實作細節由 DBA 評估):
  - Oracle Hybrid Partitioned Tables — 舊 partition 移到 external table(Object Storage / NFS cold tier)
  - `COMPRESS FOR ARCHIVE HIGH` 壓縮舊 partition
  - Vector index 不索引舊 partition(查冷資料即時計算)

#### 13.6.3 例外刪除路徑

「永久保留」≠ 不能刪。例外刪除走:

- emergency purge API(§7.6.5)+ admin 雙簽 + audit 加重
- 法務 / GDPR-style 個資刪除請求 → admin 走標準流程
- 已刪除的物件 audit 仍永久保留

### 13.7 Bot context 策略(per-channel + 跨 channel RAG)

#### 13.7.1 ✅ RAG-based 決議

**Bot context 不做 Claude 風格 compact**,改 RAG-based 挑選。

```
Bot 在某 channel 被 @ 時,context = 
   ┌─ 系統提示(plugin 提供 + scrub rules)
   │
   ├─ 「永遠帶」的訊息:
   │     ▸ 該 channel 的全部 Pinned 訊息
   │     ▸ 該 channel 最近 N 條訊息(例:20 條)
   │
   ├─ 「按需召回」的訊息(跨 channel + 跨專案):
   │     ▸ Live KB RAG(本專案):跨 channel 召回(例:#engineering 提到的決策)
   │     ▸ 沉澱 KB RAG → 跨專案歷史(預設開,§12.10 決議 1)
   │     ▸ ERP / MCP tool call results
   │
   └─ 最後 user 的 prompt
```

跨 channel 召回常見場景:`@bot 工程那邊昨天決定的廠區是?` → Bot RAG 撈 #engineering channel + #cost-debate 訊息。

#### 13.7.2 訊息 metadata 加 channel_id

KB 寫入時 metadata 帶 `channel_id` + `channel_type`,RAG 可精準到 channel(例:只查 #engineering 的訊息)。

#### 13.7.3 三種 summary 場景必須分開

| 場景 | 觸發 | 做什麼 |
|---|---|---|
| **1. 結案歸檔 summary** | 系統(project 結案) | 跨所有 channel chat → LLM 摘要 → 進沉澱 KB(§7.8) |
| **2. 階段性 summary** | user 點按鈕 | 該 channel 段時間 chat → 摘要 → Pin 進訊息流 |
| **3. Bot context compaction** | Bot 被 @ | 用 §13.7.1 的 RAG-based 挑選 |

### 13.8 階段性 summary

#### 13.8.1 ✅ Phase 上線決議

**Phase 2 上**。Phase 1:Bot 對話 + 結案歸檔已能滿足。

### 13.9 跨 Channel 通知策略

某 group / topic channel 標 DECISION,要不要自動推到 announcement?

#### 13.9.1 ✅ 決議:作者勾「同步公告」才推(c)

- **預設不推**(避免太吵)
- 訊息發出時可勾選「同步到 #announcement」
- 勾選後該訊息在 announcement channel 也出現一份(`synced_to_announcement=1`)
- 重要 DECISION(廠區決定 / 客戶反饋)PM 主動勾即可

### 13.10 預設 Channel 配置(QUOTE Plugin)

✅ **走 (b) 預設多 channel,非極簡**

QUOTE plugin 提供的 default channel template,專案建立時自動建 7 個:

```
📢 #announcement      公告(host = DPM/BPM,所有 member 必看)
💬 #general           一般討論(全員)
💬 #qa-customer       客戶 Q&A(BPM 主導)
💬 #engineering       EE/ME/RD 討論
💬 #sourcing          採購 / 供應商
💬 #factory           工廠(MPM + EPM + 各廠採購)
💬 #cost-review       BOM cost review + RFQ cost review
🔒 (DM by need)
```

對應業務 RFQ flow 的 8 階段協作分工(詳 §18.1.5)。

對應 GENERAL plugin / IT plugin 等其他 type,提供各自的 channel template。

### 13.11 Channel 歸檔機制

#### 13.11.1 ✅ 決議:可歸檔不能刪 + 結案自動歸檔

- channel 不能硬刪(走 emergency purge 才能)
- 任何時候 OWNER 可手動 archive(read-only,訊息仍在 KB)
- **專案結案時所有 channel 自動歸檔**
- 歸檔的 channel 在 sidebar 顯示「已歸檔」分組,點開可瀏覽

### 13.12 ✅ 已決議總覽

| # | 議題 | 決議 |
|---|---|---|
| 1 | 多 channel 模型 | **取代「一專案一聊天室」**;Slack/Teams 風格 |
| 2 | Channel types | announcement / general / group / topic / dm 五種 |
| 3 | DM Phase | **Phase 1 直接上**(對應 1對1 私聊需求) |
| 4 | 預設 channel 配置 | QUOTE plugin 預設 7 個(announcement + general + 5 個業務 group) |
| 5 | 誰能建 channel | group: 限 HOST;topic: 任何 member;dm: 雙方任一 |
| 6 | announcement 已讀回執 | **每則必須**(非僅 DECISION) |
| 7 | chat_guest 是否支援 | 支援;機密 host 邀請走業務/PM 雙簽 |
| 8 | super_user 機制 | GLOBAL / BU 兩級 scope;進專案後 self-join 任一 channel |
| 9 | Bot context 策略 | RAG-based;per-channel + 跨 channel RAG |
| 10 | 階段性 summary Phase | Phase 2 上 |
| 11 | 訊息刪除階段權限 | 進行中本人隨時可刪 + audit 加重;結案後需 admin 解鎖 |
| 12 | 緊急清除權限 | 本人 + host(channel OWNER 可刪該 channel 任何訊息) |
| 13 | chat_guest 被踢處理 | 立即撤銷讀取權 |
| 14 | 訊息 retention | 全部永久保留 |
| 15 | 跨 channel 通知策略 | 作者勾「同步公告」才推 DECISION 到 announcement |
| 16 | Channel 歸檔 | 可歸檔不能硬刪;結案自動全歸 |

---

## 14. 任務指派架構

> 任務(Task)是 active 階段的執行單位,銜接 Form Engine(§11)+ Workflow(§5)+ 戰情會議室(§13)+ Notification(§14.9)。
>
> 設計核心:**大項 / 小項雙層階層 + 多 owner + per-task SLA + 三層燈號 roll-up + Lifecycle 5-state + 彈性 Notification**。

### 14.1 任務階層:大項 / 小項

```
Project
  └─ 大項任務(Epic / Major Task)
      ├─ 小項任務(Subtask)
      ├─ 小項任務
      └─ 小項任務
```

| 維度 | 大項 | 小項 |
|---|---|---|
| `task_type` | `EPIC` | `SUBTASK` |
| `parent_task_id` | NULL | 指向大項 |
| Owner | **可多人**(接受窗口) | **可多人**(co-owner) |
| 完成定義 | 所有小項完成 + 大項自身 review_note | filled_fields/tracked + completion_note 必填 |
| SLA | 獨立(通常較長) | 獨立(通常較短) |
| 燈號 | roll-up(取自小項 + 自身最差) | 自身計算 |

**設計原則**:深度限 1 層(EPIC → SUBTASK),不做 nested epic;再深就直接拆專案。

### 14.2 多 owner + RACI(✅ Phase 1 加入 RACI)

對齊業務 RFQ 流程,task / form field 走 **RACI 矩陣**:

| RACI 欄位 | 對應業務 | 用途 |
|---|---|---|
| **A**(Accountable) | 「Accountable to BPM」(PDF 中 DPM/MPM 等)| 背鍋向上回報的人,task 超期時加重通知 |
| **R**(Responsible) | 「From NPI team Responsible」 | 實際做事的人(原 owner) |
| **C**(Consulted) | 顧問 / co-owner | Phase 2 才上(對應 collaborator) |
| **I**(Informed) | 通知收件者 | Phase 2 才上 |

```sql
project_tasks (
  ...
  -- R(實作者)
  primary_owner_user_id    NUMBER,             -- 可 NULL,role-only 待 claim
  primary_owner_role       VARCHAR2(20),       -- 'engineer'|'sourcing'|'finance'|...
  -- A(背鍋者)— Phase 1 加入
  accountable_user_id      NUMBER,
  accountable_role         VARCHAR2(20),       -- 'DPM'|'BPM'|'MPM'|'EPM'|...
  -- C(顧問,Phase 2)
  collaborator_user_ids    CLOB,
  -- I(通知,Phase 2)
  informed_user_ids        CLOB,
  -- 簽核(Phase 3)
  reviewer_user_ids        CLOB,
  ...
)
```

**完成判定**:

- 預設:**R 完成 → task 完成**(任一 collaborator 標完成,co-owner 不互鎖)
- 例外:有 `reviewer_user_ids` → 需所有 reviewer 簽核(Phase 3)
- 大項任務:所有小項完成才能標完成
- A(accountable)**不卡完成**,但 SLA 接近 / 超期時 escalation 自動加 A 進通知對象

#### 14.2.1 ✅ Phase 上線決議

| 機制 | Phase |
|---|---|
| `accountable_role` / `accountable_user_id`(RACI 的 A) | **Phase 1**(對齊業務 RFQ flow) |
| `primary_owner_*`(R)+ `collaborator_user_ids`(C) | **Phase 1** |
| `informed_user_ids`(I)| **Phase 2** |
| `reviewer_user_ids`(簽核)| **Phase 3**(多級簽核) |
| role-only task 待 claim | **Phase 2** |

### 14.2-1 Multi-PM 模型(✅ Phase 1)

對齊業務 4 種 PM(DPM / BPM / MPM / EPM),走 **`project_members.sub_role`** 區分:

```sql
ALTER TABLE project_members ADD (
  sub_role VARCHAR2(20)              -- 'DPM'|'BPM'|'MPM'|'EPM'(role='PM' 時用)
);
```

**設計**:

- `project.pm_user_id` 改成 `project.primary_pm_user_id`(主 PM,通常是 DPM)
- 其他 PM 進 `project_members`,role='PM',sub_role='BPM'/'MPM'/'EPM'
- 各 PM 可指定自己負責的 task / form field 給 member(走原 ownership 機制)
- 戰情會議室成員面板顯示「Mike (DPM) / Lisa (BPM) / Tony (MPM)」清楚區分

**PM sub_role**:

| sub_role | 中文 | 主導 |
|---|---|---|
| `DPM` | Design PM | 設計 + RD/QA/EE/ME 整體技術評估 |
| `BPM` | Business PM | 對客戶 / Q&A / 報價提交 |
| `MPM` | Manufacturing PM | 工廠 cleansheet / NRE / PKG |
| `EPM` | NPI Engineering PM | NPI 工程細項 |

→ Form / Task 的 `accountable_role` 直接用 sub_role 命名(如 `accountable_role='DPM'`)。

### 14.2-2 PM Team 自然涌現(✅ Phase 1,不加新表)

對齊「各 PM 領自己任務 + 各自指派 MEMBER 完成 + 匯總給業務」的業務流程。

**機制**:

```
project_members 加 invited_by_pm_user_id
   ↓
DPM 邀 EE/ME/RD 進專案 → 該 member 的 invited_by_pm_user_id = DPM
MPM 邀 SMT/EPM/採購 進專案 → 該 member 的 invited_by_pm_user_id = MPM
   ↓
DPM 的 team = SELECT user_id FROM project_members WHERE invited_by_pm_user_id = DPM
   ↓
DPM 指派 task 給自己 team 的 member(寫權限自然限制)
任務完成度 roll-up 到 DPM(accountable_role='DPM')
   ↓
匯總到 stage 6 (BOM cost review) → stage 7 (RFQ cost review) → stage 8 業務 submit
```

**邀請權限規則**:

- 業務(HOST)→ 全專案範圍邀請
- 主 DPM → 邀請 sub PM(BPM/MPM/EPM)+ 自己 team
- 其他 PM → 限自己 team(`invited_by_pm_user_id = 自己`)
- MEMBER → 不能邀

**Channel 對應**:每 PM team 對應一個 group channel(#engineering = DPM team / #factory = MPM team / #qa-customer = BPM team)— 對應 §13.10 預設 7 channels

→ **不需要 `project_member_teams` 顯式表**,team 自然涌現。

### 14.2-3 Stage Gate 機制(✅ 業務確認制)

對齊業務「PM 對各自任務負責,整個 stage 由業務及助理確定」的流程。

**Stage 狀態機**(取代原 PENDING/ACTIVE/DONE/SKIPPED 三態):

```
PENDING ──→ ACTIVE ──→ READY_FOR_GATE ──→ DONE
                                      ↓ (業務確認)
                                      
              auto-trigger:該 stage 全部 task 完成
              ↓
              系統自動設 stage.status = 'READY_FOR_GATE'
              ↓
              訊息流發 announcement「Stage X 全部 task 完成,請業務確認進入下一 stage」
              ↓
              業務(或業務助理)點「進入下一 stage」按鈕
              ↓
              stage.status = 'DONE' + 下一 stage = 'ACTIVE'
              + 該 stage hook (workflow_template_stages.on_exit_skill_id) 觸發
```

**Schema 補充**:

```sql
ALTER TABLE project_stages MODIFY (
  status VARCHAR2(20) DEFAULT 'PENDING'      -- PENDING|ACTIVE|READY_FOR_GATE|DONE|SKIPPED
);

ALTER TABLE project_stages ADD (
  ready_for_gate_at     TIMESTAMP,
  gate_confirmed_at     TIMESTAMP,
  gate_confirmed_by_user_id NUMBER             -- 業務 / 業務助理 user_id
);
```

**特殊規則**:

- 只有業務(主 + 助理)可確認 gate
- PM 完成自己 task 後**不能跳 stage**
- 業務在 announcement channel 看到 ready 提示後 + 戰情室 banner 顯示 ⏳「等業務確認進入下一 stage」
- Stage 6(BOM cost review)+ Stage 7(RFQ cost review)+ Stage 8(Submit Final Quote)都走 gate 確認

→ 業務統合決策節點,PM 各自把球推到對的位置。

### 14.2-4 Dependency-based Deadlines(✅ Phase 1)

對齊業務 RFQ schedule(「QA response+1day」「EE BOM+3days」這類相對 deadline):

```sql
ALTER TABLE project_tasks ADD (
  depends_on_task_id        NUMBER,            -- FK self
  relative_deadline_days    NUMBER,            -- 從 depends 完成日 + N 天
  computed_due_at           TIMESTAMP          -- 算出來的絕對 due_at
);

CREATE INDEX idx_pt_depends ON project_tasks(depends_on_task_id);
```

**SLA 計算邏輯**:

```
if depends_on_task_id IS NOT NULL:
  computed_due_at = parent_task.completed_at + relative_deadline_days
  task.sla_due_at = computed_due_at
else if sla_hours IS NOT NULL:
  task.sla_due_at = task.started_at + sla_hours

→ Dependency tree 上算遞迴,parent 完成才更新 child 的 due_at
→ parent 還沒完成時,child SLA 燈號 = ⚫ 灰(尚未啟動)
```

**Gantt 圖**:Phase 2 加 dashboard widget(原本就規劃)。

**範例**(對應 RFQ Schedule):

| Task | depends_on | relative_days | 計算後 due_at |
|---|---|---|---|
| QA response | (none) | — | 起始 anchor |
| Schedule update | QA response | +1 | QA 完成 +1 day |
| RET Plan and Cost | QA response | +3 | QA 完成 +3 days |
| EE BOM cost | EE BOM | +3 | EE BOM 完成 +3 days |
| Internal BOM review | EE BOM Cost | +1 | EE BOM cost 完成 +1 day |
| Cleansheet to VP | EE BOM Cost | +1 | 同上 |
| Quotation to Sales | EE BOM Cost | +2 | EE BOM cost 完成 +2 days |

### 14.3 任務模板來源

PM 接案後設計 task 結構,**三種來源**:

```
1. Workflow Template 預設帶
   ├─ workflow_template_stages 各 stage 的 task_template_ids
   └─ 進入 stage 自動建出大項 + 預設小項

2. 從其他專案複製(Phase 2)
   ├─ PM 在「建立大項」彈窗點「從其他專案複製」
   ├─ 搜尋(類別 / 客戶 / 料號)→ 列出符合條件的歷史專案
   ├─ 預覽 task 結構 → 勾選要複製的大項 / 小項
   └─ owner 留空(自動依 role 對應到本專案 role)

3. 從零建(空白)
   └─ PM 直接打字建大項 + 小項
```

#### 14.3.1 從其他專案複製的權限

- 來源專案 user 看不到的欄位 → 複製來只剩結構(沒有 form 值)
- 機密 source 專案 → 只能複製大項 / 小項標題 + sla_hours,不複製 description / attachments
- 非機密 source → 結構 + description 都複製

#### 14.3.2 ✅ Phase 上線決議

**從其他專案複製 → Phase 2**(Phase 1 累積夠歷史專案再做 search)。

#### 14.3.3 Excel Import / Export(Phase 2)

Workflow Template / Task Structure 沿用 §11.2.5 同樣機制:

```
qp_workflow_template_quote_standard_v2.xlsx
├─ Sheet: Stages              (stage_code, label, color, sla_hours, on_enter_hook)
├─ Sheet: Tasks               (task_code, parent_task_code, title, sla_hours, owner_role)
├─ Sheet: Notifications       (trigger_event, recipient_resolver, channels)
└─ Sheet: __Meta
```

匯出 → admin 在 Excel 改 → 匯入 → diff + 確認 → 建新版本。

### 14.4 SLA + 燈號(per task)

```sql
project_tasks (
  ...
  sla_hours              NUMBER,               -- 該 task 時長
  started_at             TIMESTAMP,
  sla_due_at             TIMESTAMP,
  sla_paused_at          TIMESTAMP,
  sla_consumed_seconds   NUMBER,               -- 累積消耗(支援暫停恢復)
  ...
)
```

**燈號規則**:

| 燈號 | 條件 |
|---|---|
| 🟢 綠 | `consumed / total < 70%` |
| 🟡 黃 | `70% <= consumed / total < 100%` |
| 🔴 紅 | `consumed / total >= 100%` |
| ⚫ 灰 | task 尚未 started 或專案 PAUSED |

**SLA 暫停場景**(`sla_paused_at` 起算):

- 專案進入 PAUSED 狀態
- Owner 進入 pending_reassign(離職 / 不在)
- 大項在等所有小項完成(可選關閉自動暫停)
- 等客戶反饋(`is_waiting_external` flag)

### 14.5 燈號 Roll-up(三層視角)

```
小項 task 燈號(自身計算)
   ↓ roll-up MAX
大項 task 燈號 = MAX(所有小項燈號, 大項自身燈號)
   ↓ roll-up MAX
專案燈號 = MAX(所有 active 大項燈號)
   ↓ roll-up
專案清單頁(高階主管視角)= 每專案 1 個燈號
```

**MAX 規則**:🔴 > 🟡 > 🟢 > ⚫

主管在「我的關注專案」頁:

```
🔴 QT-2026-0143 / Apple / 越南廠 / 超期 4h
🟡 QT-2026-0145 / Sony / 中國廠 / 剩 6h
🟢 QT-2026-0146 / 日立 / 印度廠 / 進度 80%
⚫ QT-2026-0147 / TBA / 暫停中
```

→ 主管不用打開單一專案,清單看燈就知道要不要進去跟催。

### 14.6 完成度回報 + 文件附件

PM/owner 標完成時:

- `completion_note_clob` 必填(≥10 字)
- 附件 optional(`attachments_json`)
- 連動 form field 自動寫入(若 task 來源是 form-driven,§11.4)
- 部分完成:user 可標「完成(部分,標記跳過)」+ 補理由

進訊息流:綠色 PROGRESS 訊息「Mike 完成『中國廠成本』」+ 附件 link。

### 14.7 重要 / 緊急矩陣

```sql
projects (
  ...
  importance     VARCHAR2(10) DEFAULT 'NORMAL',     -- HIGH|NORMAL|LOW
  urgency        VARCHAR2(10) DEFAULT 'NORMAL',
  priority_score NUMBER,                            -- 計算欄位:HIGH=3 NORMAL=2 LOW=1,score = importance × urgency
  ...
)
```

**Priority Score**:

```
HIGH × HIGH     = 9   戰略 / 立即(紅色 banner)
HIGH × NORMAL   = 6   重要 / 一般(橘色 banner)
NORMAL × HIGH   = 6   一般 / 緊急(橘色 banner)
NORMAL × NORMAL = 4   預設(無 banner)
LOW × LOW       = 1   低優先(灰色)
```

#### 14.7.1 ✅ priority_score 影響範圍決議

**(b)** — 影響 SLA 預設長度 + escalation 速度 + 主管自動訂閱(不只排序顯示):

| 影響面 | 規則 |
|---|---|
| SLA 預設長度 | score=9 → SLA = template × 0.5;score=6 → ×0.75;score≤4 → ×1.0 |
| Escalation 升級速度 | score 越高,§14.9.2 escalation chain 各 step 的 trigger_offset_min 縮短 |
| 主管自動訂閱 | score ≥ 6 自動進該 BU director / super_user 的「關注清單」 |
| 任務頁排序權重 | 高 score 排前 |

**指定權限**:業務開案時手動指定;PM 接案後可建議調整,但需業務同意。

### 14.8 Project Lifecycle(5-state)

#### 14.8.1 Lifecycle States

```
project.lifecycle_status:

DRAFT ──→ ACTIVE ──→ CLOSED ──→ REOPENED ──→ ACTIVE
              ↕              (可退回)
            PAUSED
```

| State | 中文 | 說明 |
|---|---|---|
| `DRAFT` | 開案 | 業務在填基本資料 + 指派 PM |
| `ACTIVE` | 進行中 | PM 接管,task 跑起來,SLA 計時 |
| `PAUSED` | 暫停 | 等客戶 / 等內部審核 / 人事問題,SLA 凍結 |
| `CLOSED` | 結案 | 已送出 + 結果記錄 + KB sediment 完成 |
| `REOPENED` | 結案重開 | admin 解鎖,自動建 form 'FINAL_v2',audit 加重 |

#### 14.8.2 與 Workflow Stage 的關係

**雙 dimension**:

- **Lifecycle**(5 states)= 平台層,定義整個專案生命週期
- **Workflow Stage**(`project_stages`)= plugin 層,**只在 ACTIVE 期間有意義**

QUOTE plugin 提供的 `QUOTE_STANDARD` workflow template 內含 stages(收單 / 評估 / 詢價 / 核算 / 策略 / 審核 / 送出 / 結案)— 這些是 ACTIVE 內的 sub-stages,不是 lifecycle。

#### 14.8.3 各 Lifecycle 狀態的操作控制

| 操作 | DRAFT | ACTIVE | PAUSED | CLOSED | REOPENED |
|---|---|---|---|---|---|
| 改基本資料(客戶/料號/數量) | ✅ 業務 | ⚠ 業務+審核 | ❌ | ❌ | ⚠ admin 加註 |
| 改 PM | ✅ 業務 | ✅ 業務 | ❌ | ❌ | ✅ 業務 |
| 加成員 | ⚠ 限業務+PM | ✅ HOST | ❌ | ❌ | ✅ HOST |
| 加 / 改 task | ❌ | ✅ HOST/owner | ❌ | ❌ | ✅ |
| 完成 task | ❌ | ✅ owner | ❌ | ❌ | ✅ owner |
| 改 form | ⚠ 業務初始 | ✅ 走版本鏈 | ❌ | ❌ | ✅ 自動建新版 |
| 戰情會議室 | ⚠ 限 PM+業務 | ✅ 全開 | ⚠ 唯讀 | ⚠ 唯讀 | ✅ |
| SLA 計時 | 不計 | 計時 | 暫停 | 不計 | 重啟,延展 due_at |
| Bot 互動 | ⚠ 受限 | ✅ 全開 | ⚠ 唯讀 | ⚠ 唯讀 | ✅ |
| 改機密旗標 | ✅ 業務 | ⚠ 限業務+admin | ❌ | ❌ | ❌ |
| KB Live 寫入 | 不寫 | 寫 | 寫(暫停期間 batch 不停) | 沉澱完成 | 仍寫 + 結案再 sediment |
| 結案 fork(declassify) | — | — | — | ✅ 自動跑 | — |
| 進入 / 退出 | 業務開案 | 業務 commit | HOST | HOST | admin 解鎖 |

#### 14.8.4 PAUSED 細節

- 任何狀態都可進 PAUSED(除 CLOSED)
- 必填 `pause_reason`(列舉):`WAITING_CUSTOMER` / `INTERNAL_APPROVAL` / `RESOURCE_BLOCKED` / `OTHER`
- `pause_until` 可選(預期恢復時間,用於提醒)
- SLA 凍結時間自動展延所有 task 的 due_at
- 戰情會議室 banner:「⏸ 暫停中:等客戶反饋,預計 5/15 恢復」

#### 14.8.5 REOPENED 規則

- 進入時必填 `reopen_reason`
- audit 加重(`PROJECT_REOPENED`)
- 通知該專案所有 active member + super_user
- form 自動建 'FINAL_v2' 版本(對應 §11.3.3)
- KB 沉澱層舊紀錄不刪,加 metadata `superseded_by_reopen=true`

### 14.9 Notification 引擎

#### 14.9.1 三層 Scope(Phase 演進)

```sql
notification_rules (
  id, scope,                              -- SYSTEM | BU | PROJECT_TYPE
  scope_owner_id,
  trigger_event,                          -- TASK_OVERDUE / TASK_AT_70 / BLOCKER / DECISION_NEW / ...
  recipient_resolver,                     -- task_owner | project_host | project_director | super_user_global
  channels,                               -- JSON: ['webex','email','in_app_badge']
  escalation_chain_id,
  is_active
);
```

##### ✅ Phase 上線決議

| Scope | Phase |
|---|---|
| SYSTEM(全公司預設) | **Phase 1** |
| BU(該 BU 客製) | **Phase 2** |
| PROJECT_TYPE(各 type 不同預設) | **Phase 2** |

#### 14.9.2 Escalation Chain

```sql
notification_escalation_chains (
  id, name, project_type_id,
  steps_json,
  is_active
);
```

`steps_json` 範例(SLA 70% → owner;超期 → +host;超期 30min → +director):

```json
{
  "steps": [
    { "trigger_offset_min": 0,    "recipients": ["task_owner"], "channels": ["webex","in_app"] },
    { "trigger_offset_min": 30,   "recipients": ["task_owner","project_host"], "channels": ["webex","in_app"] },
    { "trigger_offset_min": 120,  "recipients": ["project_host","project_director"], "channels": ["webex","email","in_app"] },
    { "trigger_offset_min": 480,  "recipients": ["super_user_bu"], "channels": ["email"] }
  ]
}
```

→ 一個 trigger 觸發後按時間表逐步升級;每步通知不同對象 + 不同通道。

#### 14.9.3 通道

| 通道 | 用途 | 即時性 |
|---|---|---|
| Webex | 即時 push,點開直接進專案 | 即時 |
| Email | 摘要 / 升級告警 | 可選 daily digest |
| 站內 Badge | sidebar / toolbar 紅圈數字 | 即時 |
| 戰情會議室訊息流 | 自動發訊息(色語言)+ Pin | 即時 |
| Browser Push(Phase 2) | OS 級通知 | 即時 |

#### 14.9.4 站內 Badge

每個使用者頂部 toolbar:

```
🔔 待處理事項 (12)   👤
   ↓ 點開 dropdown
   🔴 1 個 task 超期
   🟡 3 個 task 接近 SLA
   🟢 5 個 mentions
   📋 3 個 form 欄位待填
```

Sidebar:

```
📁 專案管理 (5)
   ├─ 我的任務 (8)
   ├─ 待 review (2)
   └─ 戰情會議室 (3)   ← 未讀提及
```

#### 14.9.5 個人偏好覆寫(Phase 2)

```sql
user_notification_preferences (
  id, user_id, trigger_event,
  channel,                                -- webex|email|in_app|browser_push
  enabled,                                -- 預設 1
  digest_mode                             -- realtime|hourly|daily
);
```

User 可關掉某類通知的某通道(例:不要 Email,只要 Webex);**但 escalation 第二步以後不可關**(避免錯過重要升級)。

##### ✅ Phase 上線決議

**Phase 2** 上(Phase 1 用 SYSTEM 預設足夠)。

#### 14.9.6 Notification UI(admin 設定)

PM 進專案頁 → 設定 → 通知:

```
本專案通知規則:☉ 沿用 BU 預設  ○ 客製

事件                        對象          通道           升級
─────────────────────────────────────────────────────────────
[v] Task 接近 SLA 70%       task_owner    Webex+站內     30 min → +PM
[v] Task 超期                task_owner    Webex+站內     2h → +director
[v] 機密訊息發出             HOST          Webex+Email    立即
[ ] Form 欄位填寫完成         HOST          站內           立即
[v] 客戶議價新版本            HOST          Webex+Email    立即
...
[+ 新增規則]              [儲存]
```

### 14.10 Schema 增量

```sql
-- 任務(沿用 v0.3.5 quote_tasks 改名)
CREATE TABLE project_tasks (
  id, project_id, parent_task_id,             -- 子任務
  form_instance_id, form_field_keys,          -- form-driven 才有
  source_type,                                -- form|stage_hook|manual|blocker|bot_suggested
  task_type,                                  -- EPIC|SUBTASK
  template_id,

  title, description_clob,

  primary_owner_user_id, primary_owner_role,
  collaborator_user_ids, reviewer_user_ids,   -- JSON arrays

  status,                                     -- PENDING|IN_PROGRESS|REVIEW|DONE|BLOCKED|CANCELLED|PENDING_REASSIGN
  sla_hours, started_at, sla_due_at, sla_paused_at, sla_consumed_seconds,

  completion_note_clob,                       -- 必填(≥10 字)
  attachments_json,

  created_at, created_by, source_message_id,
  reassigned_count
);

CREATE INDEX idx_pt_owner   ON project_tasks(primary_owner_user_id, status);
CREATE INDEX idx_pt_role    ON project_tasks(project_id, primary_owner_role) WHERE primary_owner_user_id IS NULL;
CREATE INDEX idx_pt_sla     ON project_tasks(sla_due_at) WHERE status NOT IN ('DONE','CANCELLED');
CREATE INDEX idx_pt_parent  ON project_tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- 任務轉交申請
CREATE TABLE project_task_handoff_requests (
  id, task_id, requested_by_user_id, requested_to_user_id,
  reason_clob, status,                        -- PENDING|APPROVED|REJECTED
  decided_by_user_id, decided_at, decided_note,
  created_at
);

-- Notification 規則(系統 / BU / type 三層)
CREATE TABLE notification_rules (...);
CREATE TABLE notification_escalation_chains (...);
CREATE TABLE user_notification_preferences (...);

-- projects 加欄位
ALTER TABLE projects ADD (
  lifecycle_status     VARCHAR2(20) DEFAULT 'DRAFT',  -- DRAFT|ACTIVE|PAUSED|CLOSED|REOPENED
  importance           VARCHAR2(10) DEFAULT 'NORMAL',
  urgency              VARCHAR2(10) DEFAULT 'NORMAL',
  priority_score       NUMBER,
  pause_reason         VARCHAR2(50),
  pause_until          TIMESTAMP,
  reopen_reason        VARCHAR2(500)
);
```

### 14.11 ✅ 已決議總覽

| # | 議題 | 決議 |
|---|---|---|
| 1 | role-only 待 claim task | **Phase 2** |
| 2 | 多 owner(co-owner / collaborators) | **Phase 1** |
| 3 | reviewer 簽核機制 | **Phase 3** |
| 4 | 從其他專案複製 task 結構 | **Phase 2** |
| 5 | priority_score 影響範圍 | **(b) 全面影響**(SLA + escalation + 主管訂閱 + 排序) |
| 6 | Notification 三層 scope Phase | **Phase 1 SYSTEM only,Phase 2 加 BU + PROJECT_TYPE** |
| 7 | 個人偏好覆寫 Phase | **Phase 2** |
| 8 | Project Lifecycle | **5-state**(DRAFT / ACTIVE / PAUSED / CLOSED / REOPENED) |
| 9 | Workflow Stage | **plugin 層,ACTIVE 內 sub-stage**(與 lifecycle 雙 dimension) |
| 10 | Excel Import / Export(form + workflow + task structure) | **Phase 2**(GUI Builder 為主,Excel 補充) |

### 14.12 借鏡的市面產品

依架構各層分別借鏡:

| 借鏡來源 | 用在 |
|---|---|
| **Jira / JSM** | Workflow state machine + SLA escalation 引擎 |
| **PagerDuty** | Escalation chain 模型(steps + recipients + channels) |
| **Asana** | 大項 / 小項 drag-drop UI、Workload 視圖 |
| **Monday.com** | 主管儀表板 widget pattern + 燈號顯示 |
| **Smartsheet** | Excel template binding UI |
| **Salesforce CPQ** | Pricing rules / Approval flow(Phase 3 多級簽核時) |

→ 不對標單一產品,**核心架構自建,UX 借鏡這些家裡適合的點**。

---

## 15. Inbound 資料整合層(從 ERP / BI / 外部拉資料進 form)

> 把 §11.2.2 的 source_type 擴充成完整的「資料整合層」:自定義 SQL / PL-SQL、可重用 data source 定義、視覺化 field mapping、排程化、連線管理、執行 audit。
>
> 借鏡 Reverse ETL(Hightouch / Census)的設計範式,以 Cortex 既有 schedule + skill 為基礎建設。

### 15.1 概念

```
ERP / SFC / BI / API / MCP
        │
        ▼
qp_data_connections (連線池,read-only role)
        │
        ▼
qp_data_source_definitions (可重用,scope=SYSTEM/BU)
   ┌─ source_type: erp_proc / custom_sql / custom_plsql / api / mcp / bi
   ├─ query_template + parameters_schema
   └─ rate_limit / timeout / max_rows
        │
        ▼
qp_form_field_data_bindings (form template 上每個欄位綁哪個 source)
   ├─ parameter_mapping (form/project/user metadata → source params)
   ├─ result_path_mapping (source result → form fields,可一對多)
   ├─ refresh_policy (on_demand / cached_24h / live / scheduled / event_triggered)
   └─ on_failure_config
        │
        ▼
trigger:
   ├─ on_demand (PM 點按鈕)
   ├─ scheduled (cron / interval, Phase 2)
   ├─ event_triggered (進入 stage / 欄位變更, Phase 2)
        │
        ▼
qp_data_fetch_jobs (每次執行 audit)
        │
        ▼
寫進 qp_form_field_values (機密欄位走 confidentialityMiddleware 加密)
```

### 15.2 ✅ source_type 擴充(Phase 1)

#### 15.2.1 `custom_sql` — 自定義 SELECT 查詢

```json
{
  "type": "custom_sql",
  "connection_id": 42,
  "sql_template": "SELECT std_cost, currency FROM erp.cost_master WHERE part_no = :pn AND factory = :fac AND dt <= :as_of",
  "parameters": {
    "pn":    "${form.part_number}",
    "fac":   "CN",
    "as_of": "${project.rfq_received_at}"
  },
  "result_mapping": [
    { "result_path": "$.rows[0].std_cost", "field_key": "material_cost_cn" },
    { "result_path": "$.rows[0].currency", "field_key": "currency_cn" }
  ],
  "timeout_ms": 30000,
  "max_rows": 1
}
```

**保護**:

- 強制只接受 SELECT(server 端 SQL parser 拒含 INSERT/UPDATE/DELETE/MERGE/DDL)
- 連線 ERP 用 read-only DB role(底層強制)
- 參數化綁定(`:pn` 走 prepared statement,**禁止** string concat)
- timeout + max_rows 上限

#### 15.2.2 `custom_plsql` — 自定義 PL/SQL block

```json
{
  "type": "custom_plsql",
  "connection_id": 42,
  "plsql_block": "DECLARE v_cost NUMBER; BEGIN SELECT std_cost INTO v_cost FROM erp.cost_master WHERE part_no = :pn; :result := v_cost * 1.05; END;",
  "parameters": { "pn": "${form.part_number}" },
  "result_binding": ":result",
  "result_mapping": [
    { "result_path": "$", "field_key": "material_cost_with_markup" }
  ]
}
```

**保護**:

- DB role 不准 DDL / DML(只跑 read-only logic + assign 到 OUT 變數)
- 限定 anonymous block,不能呼叫高權限 procedure
- Server 預編譯 + plan 驗證

→ `custom_sql` / `custom_plsql` 比 `erp_proc` 彈性,但安全防線更嚴。

### 15.3 ✅ 排程化(Phase 2 — `refresh_policy: scheduled`)

```json
{
  "refresh_policy": "scheduled",
  "schedule_config": {
    "cron": "0 6 * * *",
    "scope": "all_active_projects",
    "filter": { "project_type": "QUOTE", "lifecycle_status": "ACTIVE" }
  },
  "on_failure": {
    "retry_count": 3,
    "backoff_seconds": 300,
    "notify_owner_role": "engineer",
    "notify_source_author": true,
    "fallback_value": null
  }
}
```

#### 15.3.1 觸發模式

| 模式 | 用途 |
|---|---|
| `cron` | 絕對時間,例每天 06:00 批次 refresh ERP 成本 |
| `interval` | 每 N 分鐘 / 小時 polling |
| `event_triggered` | project 進入某 stage 觸發 / form 某欄位變更觸發 dependent fetch |

#### 15.3.2 排程引擎

**沿用 Cortex 既有 `schedule` + `skill` 系統**,不另起:

```
qp_data_source 上的 scheduled trigger
   ↓
觸發時 Cortex schedule engine 呼叫
   ↓
平台註冊的 system skill: runDataSourceFetch(source_id, project_id)
   ↓
   ├─ 從 connection pool 拉資料
   ├─ 套用 result_mapping → 寫進 qp_form_field_values
   ├─ 寫 qp_data_fetch_jobs(SUCCESS / FAILED / TIMEOUT)
   └─ 失敗時觸發 notification(走 §14.9 引擎)
```

#### 15.3.3 寫入規則

| 規則 | 說明 |
|---|---|
| 寫入優先序 | 排程拉的值 < user 手動覆寫(`is_overridden=1` 後鎖住) |
| 機密欄位 | 走 `confidentialityMiddleware`,加密儲存 |
| 衝突處理 | user single-edit lock 中時,結果暫存 staging,lock 釋放後再寫 |
| 異常值通知 | 拉到超出 validation range → 通知 owner |

### 15.4 ✅ Field Mapping UI(Phase 1 視覺化拖拉)

> Phase 1 直接做視覺化拖拉介面(借鏡 Hightouch / Census)。理由:這是應用重要基礎,可用性第一。

#### 15.4.1 UI 設計

```
┌─────────────────────────────────────────────────────────────────┐
│ Source: ERP 中國廠成本查詢(custom_sql)                          │
│ Connection: ERP-CN-readonly                                     │
├──────────────────────────┬──────────────────────────────────────┤
│ Source 結果 Schema       │  Form Fields                         │
│ (從 sample query 自動推斷)│  (form template 的 fields)           │
├──────────────────────────┼──────────────────────────────────────┤
│  std_cost      number    │ ───┬──→ material_cost_cn   currency  │
│  currency      string    │ ──┐│                                  │
│  factory       string    │   └│──→ currency_cn         string   │
│  effective_dt  date      │    │                                  │
│  source_doc    string    │    │   labor_cost_cn        number   │
│                          │    │                                  │
│  [拖拉箭頭建立 mapping]   │    │   overhead_cn          number   │
└──────────────────────────┴──────────────────────────────────────┘

Parameters:
  pn   = ${form.part_number}      [編輯]
  fac  = CN                        [編輯]
  as_of = ${project.rfq_received_at}  [編輯]

[執行測試]  [儲存綁定]  [檢視 SQL]  [檢視 audit]
```

#### 15.4.2 UI 互動

- **左側**:輸入 SQL → 點「執行 sample」→ Server 跑 query(LIMIT 1)→ 自動推斷欄位 schema
- **右側**:form template 的 fields list(顯示 label_i18n + data_type)
- **中間**:拖拉箭頭建立 source field → form field 的 mapping
- **參數**:用 `${form.xxx}` / `${project.xxx}` / `${user.xxx}` 引用,UI 提供 autocomplete
- **測試**:執行測試 → 顯示完整結果 + diff 顯示要寫到哪些 form field

#### 15.4.3 borrowed from Hightouch

| 借鏡點 | 用法 |
|---|---|
| 視覺化 mapping | 對應箭頭 + drag handles |
| Sync log UI | qp_data_fetch_jobs 的歷史 + filter + 重試按鈕 |
| Sample / Test 機制 | 執行測試不寫真值,只 preview |
| Field type validation | source field 與 form field type 不符時警告 |

### 15.5 Connection 管理

```sql
CREATE TABLE qp_data_connections (
  id, name, connection_type,                  -- oracle_erp | oracle_sfc | mssql_bi | rest_api | mcp_server
  connection_string_encrypted,
  username_encrypted, password_encrypted,
  pool_max, pool_timeout_seconds,
  is_readonly,                                -- 強制 read-only role
  scope, scope_owner_id,                      -- SYSTEM | BU
  is_active,
  managed_by_admin_user_id,
  last_health_check_at,
  health_status                               -- HEALTHY | DEGRADED | DOWN
);
```

- 連線是 admin / BU 主管管理,PM 不直接接觸
- 健康檢查每 5 分鐘
- DOWN 時排程自動暫停 + 通知 admin

### 15.6 安全 / 治理

| 風險 | 緩解 |
|---|---|
| SQL injection | 強制參數化 + ajv 驗 parameters_schema |
| DDL / DML 寫入 ERP | DB role read-only + server SQL parser 拒寫操作 |
| 跑爆 ERP | per-source rate_limit_per_minute + connection pool 限制 + max_rows + timeout |
| 編寫者誤刪 mapping | source 走版本鏈,舊版仍跑既有 form_instance |
| 排程任務炸庫 | concurrency limit(同 source 不能並行)+ off-peak 排程 |
| 機密欄位寫入 | 走 confidentialityMiddleware,自動加密 |
| 失敗 silent | 預設 ON;不能關 |
| 編寫者權限 | **限 admin / BU 主管**;PM 只能在 form template 上「綁定既有 source 到 field」,不能寫 SQL |

### 15.7 Schema 增量

```sql
-- 連線管理
CREATE TABLE qp_data_connections (...);   -- 見 §15.5

-- 資料源定義(可重用)
CREATE TABLE qp_data_source_definitions (
  id, name, scope, scope_owner_id,
  source_type,                              -- erp_proc | custom_sql | custom_plsql | api | mcp | bi
  connection_id,
  query_template_clob,                      -- SQL / PL-SQL / api endpoint
  parameters_schema,                        -- JSON Schema
  result_mapping_default,                   -- JSON,可被 form binding 覆寫
  rate_limit_per_minute,
  max_rows, timeout_ms,
  created_by_user_id,
  version,                                  -- source 版本鏈
  is_active
);

-- form 欄位綁定
CREATE TABLE qp_form_field_data_bindings (
  id, form_template_id, field_key,
  data_source_id,                           -- → qp_data_source_definitions
  parameter_mapping,                        -- form/project/user → source params
  result_path_mapping,                      -- source result → form fields(一對多)
  refresh_policy,                           -- on_demand | cached_24h | live | scheduled | event_triggered
  schedule_config,                          -- cron / interval / event spec
  on_failure_config,
  is_active
);

-- 執行紀錄(audit)
CREATE TABLE qp_data_fetch_jobs (
  id, source_id, project_id, form_instance_id,
  triggered_by,                             -- schedule | manual | event:stage_enter
  triggered_at, completed_at,
  status,                                   -- SUCCESS | FAILED | TIMEOUT | ABORTED
  rows_fetched, fields_written,
  error_message, retry_count
);

CREATE INDEX idx_dfj_source ON qp_data_fetch_jobs(source_id, triggered_at);
CREATE INDEX idx_dfj_project ON qp_data_fetch_jobs(project_id, triggered_at);
```

### 15.8 Audit

每次 fetch 寫進:

- `qp_data_fetch_jobs`(技術細節:成功 / 失敗 / 耗時 / rows)
- `project_audit_log`(業務語意:哪個 form_instance 哪個 field 被自動更新)

UI:

- 每個 form field(若綁了 source)旁顯示「最後拉值時間 + 來源 + audit link」
- admin 介面:source 級別的執行歷史(Hightouch 風格 sync log)

### 15.9 借鏡產品

| 產品 | 借鏡點 |
|---|---|
| **Hightouch / Census**(Reverse ETL) | SQL → field mapping → 寫回 app 的設計範式;Sync log;視覺化 mapping |
| **Apache Airflow / Dagster** | 排程 + 重試 + backfill;Web UI 監控 |
| **Snowflake / BigQuery scheduled queries** | SQL + cron 純 DB 層排程 |
| **n8n / Zapier** | trigger → action 低代碼概念 |

→ 借鏡他們的 **field mapping UI + sync log + 重試 backoff**,實作走 Cortex 內部 schedule + skill。

### 15.10 對外 read API(H2 議題,Phase 待需求)

> ✅ 決議:**待需求才做**(目前無強烈集團查詢需求,做了沒人用)

未來若有需求,典型 endpoints(read-only,過 confidentialityMiddleware):

- `GET /api/external/projects?bu_id=&status=ACTIVE` — 列表 + 燈號
- `GET /api/external/projects/{id}/summary` — 摘要,不含明細
- `GET /api/external/projects/{id}/sla` — SLA 狀態
- `GET /api/external/projects/{id}/result` — 結案結果(脫敏)

不做:UPDATE / DELETE、聊天訊息、Form 詳細欄位、KB 內容。

### 15.11 ✅ 已決議總覽

| # | 議題 | 決議 |
|---|---|---|
| 1 | `custom_sql` / `custom_plsql` source type | **Phase 1** |
| 2 | 排程化(`refresh_policy: scheduled`) | **Phase 2** |
| 3 | Field Mapping UI | **Phase 1 直接做視覺化拖拉**(原建議 JSON-first 改) |
| 4 | 資料源編寫者權限 | 限 **admin / BU 主管**;PM 只能綁定既有 source |
| 5 | 失敗通知 | **同時通知** field owner + 編寫者 |
| 6 | Outbound read API(H2) | **待需求才做** |

---

## 16. 跨專案儀表板(主管視角 BI)

> 設計精神:**進 Cortex 第一眼就看完,不用點進任何專案**。
> 對標思路:類似交通管制中心牆面 — 燈號 / 警示 / 流量都聚合在一個畫面。

### 16.1 三類視角(角色分層)

| 視角 | 對象 | 看到什麼 | 訂閱方式 |
|---|---|---|---|
| **個人視角** | Sales / PM / 一般成員 | 我經手的專案 + 我手上 task + 我關注的 | 自動(被指派 / 邀請) |
| **BU 視角** | BU Manager / director | 該 BU 所有 active + KPI | 自動(role-based) |
| **跨 BU / Global 視角** | super_user(GLOBAL/多 BU)/ 業務總監 | 跨 BU 戰略案 + 全公司 KPI + 自訂 watchlist | scope 自動 + watchlist 手動 |

每個 user 進儀表板看到的是**他能看的東西的聚合**,不需要切視角 — 系統自動帶。

#### 16.1.1 ✅ 跨 BU 視角切換決議

**只 super_user(GLOBAL)看得到「全公司 vs 我的 BU」切換 toggle**。

理由:避免一般 BU 主管誤觸看到不該看的;super_user(GLOBAL)經 admin 授權,信任度等同 director 跨 BU。

### 16.2 ✅ 入口決議

**進 Cortex / 點 sidebar 「📁 專案管理」→ 預設進「儀表板」**(而非「我的專案清單」)。

理由:發揮主管儀表板價值;一般 PM 也能用個人視角看自己的事。

```
Cortex Sidebar
   📁 專案管理 ★
      ├─ 儀表板 ★(預設)
      ├─ 我的專案
      ├─ 我的任務
      └─ 創建專案
```

### 16.3 主畫面 7 個 Widget(Phase 1)

```
┌─ 1. SLA 燈號統計 ──────────────────────────────────┐
│   🔴 超期 2   🟡 接近 5   🟢 正常 23   ⚫ 暫停 1     │
│   點 🔴 → drill-down 到所有超期專案清單             │
└────────────────────────────────────────────────────┘

┌─ 2. 我的關注專案(Watchlist + 自動訂閱)────────┐
│   🔴 QT-2026-0143 / Apple    / 越南廠 / 超期 4h    │
│   🟡 QT-2026-0145 / Sony     / 中國廠 / 剩 6h     │
│   🟢 QT-2026-0146 / 日立     / 印度廠 / 進度 80%  │
│   ⚫ QT-2026-0147 / TBA      / 暫停中             │
│   [+ 加入 Watchlist]                                │
└────────────────────────────────────────────────────┘

┌─ 3. 我的 Task ──────────┐  ┌─ 4. 待 Review ───────┐
│   🔴 1 / 🟡 3 / 🟢 5    │  │ Form 待 review: 2     │
│   點開:跨專案 task 清單 │  │ Task 待 review: 1     │
└─────────────────────────┘  └────────────────────────┘

┌─ 5. Delay 熱點 ──────────────┐  ┌─ 6. 本期 KPI ────────────┐
│   詢價階段卡 5 件             │  │ 本週新增報價: 12          │
│   核算階段卡 3 件             │  │ 本週結案: 5 (3W/1L/1H)   │
│   策略階段卡 2 件             │  │ 本月贏單率: 68%           │
│                               │  │ 平均回應時間: 18 小時     │
└───────────────────────────────┘  └──────────────────────────┘

┌─ 7. 成員負載熱圖(BU 視角才出現)──────────────────┐
│   Amy  ████████░░  4 案 (1 超期)                  │
│   Rich ██████░░░░  3 案                            │
│   John ██████████  5 案 (1 卡住)                  │
└────────────────────────────────────────────────────┘
```

**全部 widget click → drill-down 到對應清單頁;再 click 行 → 進該專案**。

主管不用打開單一專案,**從燈號到專案頁最多 2 次點擊**。

#### 16.3.1 ✅ Widget 由通用層固定 + plugin 可加

通用層提供 7-10 個跨 type 都用得到的 widget;plugin(QUOTE)可註冊自家 widget(例:廠區比較燈號、Tier 分布)。

### 16.4 ✅ AI 預測警示(三種能力分 Phase)

AI 警示拆三種,**分 Phase 上**(避免 Phase 2 ML 過早做出問題):

| 能力 | 例 | 技術 | Phase |
|---|---|---|---|
| **A. 規則式警示** | 「目前完成度 < 預期 → 將超期」/「待客戶反饋 > 7 天 → 客戶可能流失」 | if-then + 統計外推 | **Phase 1 末 / Phase 2 初** |
| **B. RAG-based 類似案推論** | 「歷史類似 5 案 → 3 Win / 2 Loss,平均毛利 Tier-M」 | KB + RAG(已有架構) | **Phase 2** |
| **C. 統計 ML 模型 / 異常偵測 / What-if** | 「此案贏單機率 42%」/ 異常 pattern / 原料漲 5% 影響毛利 | ML pipeline + model serving | **Phase 3** |

#### 16.4.1 為什麼這樣分

| 維度 | A | B | C |
|---|---|---|---|
| 資料量需求 | 不需要 | 不需訓練(用 KB) | 需要 200+ 結案歷史 |
| 技術成熟度 | 規則 + SQL | 既有 RAG | 需 ML/DS 介入 |
| 假警報風險 | 低(規則明確) | 中(可調 top-K) | 高(早期過擬合) |
| Phase 2 上線時 | 已穩定 | 已穩定 | 資料量不足,做了會壞 |

→ Phase 2 末儀表板會多 8、9 兩個 widget(規則式 + RAG 類似案);
→ Phase 3 加 10、11、12(贏單預測 / What-if / 異常偵測)。

#### 16.4.2 Phase 2 預期出現的警示 widget

```
┌─ 8. 危險清單(規則式)─────────────────┐
│   未來 24h 高風險超期:                 │
│   🟡 QT-2026-0148 / Apple              │
│      理由:核算階段 2 天前進入,完成度  │
│            僅 30%,SLA 還剩 4h         │
│   🟡 QT-2026-0152 / Sony               │
│      理由:等客戶反饋已 9 天,接近流失  │
└────────────────────────────────────────┘

┌─ 9. 類似案推論(RAG)─────────────────┐
│   QT-2026-0143(車用連接器,越南廠):  │
│   類似 5 案 → 3 Win / 2 Loss          │
│   平均毛利 Tier-M / 平均回應 16h      │
│   參考案:QT-2025-0087 / QT-2025-0212 │
│   [查更多]                             │
└────────────────────────────────────────┘
```

#### 16.4.3 Phase 3 加的 widget

```
┌─ 10. 贏單機率模型 ──────────────────────┐
│   QT-2026-0143 / 預測贏單率 42%         │
│   主因:廠區選擇 / 數量 / 客戶歷史      │
└─────────────────────────────────────────┘

┌─ 11. What-if 模擬 ──────────────────────┐
│   原料漲 5% → 毛利從 16% 降至 11%       │
│   匯率 -2% → 毛利從 16% 升至 18%        │
└─────────────────────────────────────────┘

┌─ 12. 異常 pattern 偵測 ────────────────┐
│   ⚠ John 本週 task 量比平均 +180%       │
│   ⚠ BU2 平均回應時間從 12h 升至 28h     │
└────────────────────────────────────────┘
```

### 16.5 機密處理(沿用 §10.6 集中原則)

主管儀表板**完全消費** `confidentialityMiddleware`,不另寫機密邏輯:

| 情境 | 處理 |
|---|---|
| 主管能看的非機密專案 | 全資料明文 |
| 主管能看的機密專案(跨 BU) | 摘要 view(燈號 + 客戶 alias + Tier 金額) |
| 主管不能看的專案 | 完全不出現 |
| 統計聚合(贏單率 / Delay 熱點) | 已聚合,不洩個別案 |
| Watchlist | **可加機密專案**,但摘要走 displayStrategy |

### 16.6 計算策略(即時 vs 批次)

| 資料類型 | 計算策略 | 為什麼 |
|---|---|---|
| **燈號 / SLA 倒數** | 即時 query | < 100ms |
| **燈號數量統計** | 即時 aggregate | 同 |
| **Delay 熱點 / 成員負載** | 即時 aggregate | 同 |
| **本週 / 本月 KPI** | Phase 1 即時;若量大 P2 加 5min cache | 跨多月會慢 |
| **趨勢圖** | **MV 每天 refresh** | 跨年資料量大 |
| **AI 預測**(Phase 3) | scheduled batch + cache | 模型推論貴 |

#### 16.6.1 ✅ Phase 1 即時 query 決議

**Phase 1 全走即時 query**(< 5000 active 專案沒問題)。

5min cache 主管會無感但有時延煩,初期量不大不需要。Phase 2 若爆量再加 MV / cache。

### 16.7 與 AI 戰情(BI)的分工

```
跨專案儀表板(本 §16,自家做)
  ▸ 「always-on」進入點,輕量,固定 widget set
  ▸ 主管登入 → 點專案管理 → 直接看到
  ▸ Phase 1 上,平台自有 ECharts 元件
  ▸ Drill-down 到專案頁(平台內導覽)

AI 戰情 embed(§10.5,Phase 2)
  ▸ 「deep dive」工具,可自定 SQL / NL→SQL
  ▸ admin 為各 BU 建客製 dashboard
  ▸ embed iframe 在主管的「BU KPI 詳細」分頁
```

→ **不重複**:儀表板是入口,AI 戰情是深挖工具。儀表板 KPI 卡片可掛超連結跳到對應 AI 戰情 dashboard。

### 16.8 Watchlist + 自動訂閱

```sql
-- 手動關注
CREATE TABLE project_watchlists (
  id, user_id, project_id,
  reason VARCHAR2(200),
  added_at,
  UNIQUE (user_id, project_id)
);

-- 自動訂閱規則
CREATE TABLE project_auto_subscriptions (
  id, user_id,
  filter_json,                              -- {priority_score_min: 6, customer_in: [...], bu_in: [...]}
  is_active
);
```

#### 16.8.1 ✅ 自動訂閱 Phase 1 上線決議

**Phase 1 上**。系統規則:`priority_score >= 6` 的專案 → 自動進相關 director / super_user 的 Watchlist。

理由:自動訂閱對主管太有價值,Phase 1 不能少;對應 §14.7.1「priority_score 全面影響 + 主管自動訂閱」決議。

### 16.9 自訂 Dashboard(Phase 2)

預設 layout per role:

| Role | 預設 widget |
|---|---|
| PM / Sales | 1, 2, 3 |
| BU Manager | 1, 2, 5, 6, 7 |
| super_user (BU) | 同 BU Manager + Watchlist 大 |
| super_user (GLOBAL) / 業務總監 | 全部 widget + 視角切換 |

Phase 2 加自訂:

- user 拖拉 widget 進 / 出 / 重排
- 存個人 layout(`dashboard_layouts.user_id`)
- BU Manager 可定義「BU 預設 layout」(下屬看到的預設)

### 16.10 與 §14.5 燈號 roll-up 的關係

§14.5 已定義「task → 大項 → 專案 → 清單頁」三層 roll-up。

跨專案儀表板**消費**這個 roll-up,不重新算:

```
專案燈號(已 roll-up,§14.5)
   ↓
儀表板列表逕行展示
   ↓
燈號統計 = group by 燈號 count
```

→ 邏輯一致,維護一份。

### 16.11 Schema 增量

```sql
-- Watchlist + 自動訂閱(§16.8)

-- 自訂 dashboard layout(P2)
CREATE TABLE dashboard_layouts (
  id, user_id,                              -- NULL = role 預設
  role_scope,                               -- pm | bu_manager | super_user | director
  is_default,
  widgets_json,                             -- [{widget_id, position, config}]
  created_at, updated_at
);

-- KPI 預先計算(P2,若量大)
CREATE MATERIALIZED VIEW mv_project_kpi_weekly
  REFRESH FAST ON COMMIT
  AS SELECT bu_id, week_of_year, COUNT(*) projects, ...;
```

### 16.12 視覺 Layout 草圖

```
┌────────────────────────────────────────────────────────────────────┐
│ 跨專案儀表板                              視角: ●BU 1   ○全公司 ▼│
├──────────┬─────────────────────────────────────────────────────────┤
│ 篩選     │  🔴 超期 2   🟡 接近 5   🟢 正常 23   ⚫ 暫停 1            │
│ ━━━━━━━━ │  ─────────────────────────────────────────────────────  │
│ Status:  │  我的關注專案                                             │
│ ☑ Active │  🔴 QT-2026-0143 / Apple / 越南廠 / 超期 4h               │
│ ☐ Paused │  🟡 QT-2026-0145 / Sony / 中國廠 / 剩 6h                  │
│          │  🟢 QT-2026-0146 / 日立 / 印度廠 / 進度 80%               │
│ Priority:│  ⚫ QT-2026-0147 / TBA / 暫停中                           │
│ ☑ HIGH   │                                                           │
│ ☑ NORMAL │  ┌────────────┐ ┌────────────┐ ┌────────────────────┐    │
│          │  │ Delay 熱點 │ │ 本期 KPI   │ │ 成員負載           │    │
│ Customer:│  │ 詢價 5     │ │ 新增 12    │ │ Amy  ████████░ 4   │    │
│ [搜尋]   │  │ 核算 3     │ │ 贏單 68%   │ │ Rich █████░░░░ 3   │    │
│          │  │ 策略 2     │ │ 平均 18h   │ │ John ██████████ 5  │    │
│ Watchlist│  └────────────┘ └────────────┘ └────────────────────┘    │
│ • Apple  │                                                           │
│ • Sony   │  [+ 加進階 Widget]                                        │
└──────────┴───────────────────────────────────────────────────────────┘
```

### 16.13 Phase 規劃

| Phase | 內容 |
|---|---|
| **P1** | 基本儀表板(預設 layout per role)+ 7 個基礎 widget + Watchlist + 自動訂閱(priority_score >= 6)+ 篩選 + 燈號 drill-down + 即時 query + **規則式警示 widget(A)** |
| **P2** | 自訂 dashboard 拖拉 + 進階 widget(趨勢 / 客戶分布)+ AI 戰情 embed + KPI MV 優化 + **RAG 類似案推論 widget(B)** |
| **P3** | **贏單預測模型 + What-if + 異常 pattern 偵測(C)** |

### 16.14 ✅ 已決議總覽

| # | 議題 | 決議 |
|---|---|---|
| 1 | 入口 | sidebar 點專案管理 → 預設進儀表板(非專案清單) |
| 2 | Widget 註冊 | 通用層固定 7-10 個 + plugin 可加自家 |
| 3 | 跨 BU 視角切換 | 只 super_user(GLOBAL)看得到 toggle |
| 4 | Watchlist 機密專案 | 可加,摘要走 displayStrategy |
| 5 | 自動訂閱 | Phase 1 上(priority_score >= 6 自動進 director Watchlist) |
| 6 | 計算即時度 | Phase 1 全即時 query;若爆量 P2 加 MV / cache |
| 7 | AI 預測警示 | **三種能力分 Phase**:A→P1末/P2初;B→P2;C→P3 |

---

## 17. 角色身份體系

> Cross-cutting concern。前面各章節散落的 role 在此集中總整理。

### 17.1 設計原則

1. ✅ 所有身份 admin 手動授予,**不走 LDAP** 自動推導
2. ✅ 一個 user 可有多身份(union 權限)
3. ✅ 預定義身份類別,PM/user 不可自加
4. ✅ 主管類身份必須預授;**一般專案參與者不卡**(可跨組織邀)
5. ✅ 此階段組織關係 admin 手動 maintain;未來再 evaluate 自動化
6. ✅ admin **權限預設全開**(不鎖,確保 debug 順暢);用 testing mode toggle 做 audit 區分

### 17.2 完整身份清單(13 個)

#### 17.2.1 專案身份(`project.*`)

| Role Code | 中文 | 職責 | 看得到的範圍 | 進聊天室方式 |
|---|---|---|---|---|
| `project.sales` | 業務 | 開案、指派 PM | 自己 + 被邀請 | 自動 HOST |
| `project.pm` | PM(統稱) | 接案、執行;`project_members.sub_role` 區分 DPM/BPM/MPM/EPM(§14.2-1) | 自己 + 被邀請 | 自動 HOST |
| `project.bu_director` | BU 主管(處級) | 管 BU 內專案;**支援 multi-BU 授權** | 該 user 隸屬 BU 的全部專案 | host 邀才進 |
| `project.top_director` | 最高層主管 | 全公司 | 全部 | host 邀才進 |
| `project.bu_super` | BU 經管 | 該 BU 經營管理(財控 / HR / Audit) | 該 BU 全部專案 | **主動 self-join**(§13.3) |
| `project.hq_super` | HQ 經管 | 集團經管 | 全部 | **主動 self-join** |

> **「BG 主管 / 總經理」實作方式**:授予該 BG 下所有 BU 給 `bu_director`,不單獨建 role。
> 「處級主管管多個事業處」實作方式:授予多個 BU 給 `bu_director`。

#### 17.2.2 工作流 / 系統身份

| Role Code | 中文 | 職責 |
|---|---|---|
| `workflow.admin` | 流程模板管理 | 編 SYSTEM workflow template(§5) |
| `workflow.bu_editor` | BU 流程編輯 | 編 BU workflow template |
| `data.connection_manager` | 連線管理員 | 管 ERP / SFC / API 連線(§15.5) |
| `notification.editor` | 通知編寫者 | 編 SYSTEM / BU notification rules(§14.9) |
| `confidential.policy_editor` | 機密策略編寫 | 編欄位顯示策略(§4) |
| `admin` | 系統管理員 | **權限全開**(不鎖);測試業務功能走 testing mode |
| `admin.testing` | 管理員測試模式 | toggle,啟動後業務操作 audit 加 `[ADMIN_TEST]` |

### 17.3 命名規則

身份代號全部 prefix 分類:

```
project.*           專案身份(業務 / PM / 主管 / 經管)
workflow.*          工作流模板管理
data.*              資料連線 / 整合
notification.*      通知規則
confidential.*      機密策略
admin / admin.*     系統管理 + 測試模式
```

### 17.4 admin 權限與測試模式

#### 17.4.1 admin 預設權限

- `admin` role 的 `permissions_json` **預設全開**,不做預設限制
- 確保 debug / 系統設定 / 資料修復 順暢
- 不走 (a) 完全禁業務 / (b) read-only / (c) 機密 mask 三選一,**走 (d) 全開 + audit 區分**

#### 17.4.2 ✅ Testing Mode toggle 設計(沿用 Cortex 既有 `a-admin-test`)

```
admin 進系統 → 預設「管理模式」
   操作:設定 / 授權 / KB 管理 / template 編輯 / data source 編寫 / dashboard 配置 / audit 查詢
   audit:一般紀錄(無特別 prefix)

   ↓ 點「進入測試模式」(toggle)
   填:理由 + 預期完成時間
   session 期間有效;1 小時自動超時退出(可手動延)

進入測試模式後:
   操作:可建專案 / 可改 form / 可進聊天室 / 可改 lifecycle
   audit:全部加 `[ADMIN_TEST]` prefix
   通知:該 BU 主管(若操作牽涉特定專案)
```

#### 17.4.3 不沿用既有 a-admin-test 的話?

決議:**沿用既有**。Cortex 平台已有此機制,不重做。

### 17.5 組織層級(待後續細化)

#### 17.5.1 ✅ Schema 框架(留 placeholder)

```sql
CREATE TABLE organization_units (
  id, parent_id, level,                       -- BG | BU | SUB_BU | DEPT
  code, name_i18n,
  is_active,
  managed_by_admin_user_id,
  created_at, updated_at
);

CREATE TABLE user_organization_memberships (
  id, user_id, org_unit_id,
  is_primary,                                 -- 主要單位(報表用)
  joined_at, left_at,
  managed_by_admin_user_id,
  UNIQUE (user_id, org_unit_id)
);
```

#### 17.5.2 待回答(留作 TBD)

- **Q**:組織層級深度 — `BG > BU > SUB_BU > DEPT`?還是只有 `BU > SUB_BU`?
- 已知:有 BU + sub-BU 兩層
- 影響:director 的 hierarchical 看法 + organization_units 的 level enum
- 等用戶確認後填入

#### 17.5.3 ✅ 多對多隸屬決議(Q2.3)

走 `user_organization_memberships`(一人可在多 BU,例如兼任),不走 `users.bu_id` 單值。

對應「一個人可多身份」邏輯一致。

### 17.6 Director / Super 的範圍解析

`user_role_grants` 加 scope:

```sql
CREATE TABLE user_role_grants (
  id, user_id, role_id,                       -- → user_role_definitions
  scope_type,                                 -- GLOBAL | BU
  scope_values,                               -- JSON array,scope_type=BU 時放 bu_ids
  granted_by_admin_user_id,
  granted_at, expires_at,                     -- 任期(super_user 預設無)
  is_active,
  audit_metadata_clob
);
```

範例授權:

| User | Role | scope_type | scope_values | 解析 |
|---|---|---|---|---|
| 王副總 | `project.bu_director` | BU | `[1,2,3]` | 看 BU 1/2/3 的全部專案(處級主管管 3 個 BU) |
| 李總經理 | `project.bu_director` | BU | `[1,2,3,4,5,6]` | 看 BG 下全 6 個 BU(總經理) |
| 張董事長 | `project.top_director` | GLOBAL | — | 全公司 |
| 陳財務長 | `project.hq_super` | GLOBAL | — | 全公司,主動 self-join |
| 王經理 | `project.bu_super` | BU | `[1,2]` | BU 1+2 經管 |

### 17.7 ✅ 角色 Lifecycle

| 場景 | 處理 |
|---|---|
| 離職 | LDAP disabled 觸發 → 全 role 自動 `is_active=0`;名下 active 專案進 pending_reassign(§3.1);**audit 保留 + 名稱加「已離職」標記**(Q4.5) |
| 調 BU | super_user / bu_director 的 scope_values **手動更新**(此階段)+ audit |
| 任期 | super_user / director 預設無 expires_at(Q4.2)|
| chat_guest 任期 | **不做主動任期**(Q4.1 簡化);只靠 host 踢 + 結案凍結 |
| 高風險 role 雙簽授予 | **不做**(Q4.4);走單簽 + audit |
| 緊急 break-glass | 平台技術防護「不准刪到 0 admin」;不做雙人雙鑰實體保管(Q4.3,IT 一定有 admin 人選) |
| 兼任(同時多身份 / 多 BU) | ✅ 支援(`user_role_grants` 多筆 + `user_organization_memberships` 多 row) |

### 17.8 Schema 增量

```sql
-- 預定義身份(seed data,system 維護)
CREATE TABLE user_role_definitions (
  id,
  role_code,                                  -- project.sales | project.bu_director | ...
  name_i18n, description_i18n,
  category,                                   -- project|workflow|data|notification|confidential|admin
  is_system,                                  -- 1 = 系統預設不可刪
  permissions_json,                           -- 此 role 對應的 permission set
  default_expires_days,                       -- 任期預設(NULL = 無)
  requires_dual_sign,                         -- 高風險 role 是否雙簽(目前全 0)
  created_at, updated_at
);

-- user 身份授予(見 §17.6)
CREATE TABLE user_role_grants (...);

-- 組織層級(見 §17.5)
CREATE TABLE organization_units (...);
CREATE TABLE user_organization_memberships (...);

-- admin testing mode session
CREATE TABLE admin_testing_sessions (
  id, user_id,
  reason VARCHAR2(500),
  expected_duration_minutes,
  started_at,
  ended_at,
  ended_reason,                               -- manual_exit | timeout | session_expired
  notified_bu_director_user_ids               -- JSON array
);
```

### 17.9 ✅ 角色上線時機(Phase Plan)

| Role | Phase 1 day 0 | Phase 2 |
|---|---|---|
| `admin` | ✅ 必須 | — |
| `project.sales` / `project.pm` | ✅ 必須(批次 LDAP group → admin 手動授) | — |
| `project.bu_director` / `project.top_director` | ⚠ **可上但無實質用途** | ✅ 戰情會議室上線後有意義 |
| `project.bu_super` / `project.hq_super` | ❌ Phase 2 | ✅(配合戰情會議室) |
| `workflow.admin` / `workflow.bu_editor` | ✅ 必須 | — |
| `data.connection_manager` | ✅ 必須(P1 inbound 整合) | — |
| `notification.editor` | ✅ 必須(P1 SYSTEM scope) | — |
| `confidential.policy_editor` | ✅ 必須(P1 機密策略) | — |
| `admin.testing` | ✅ 必須(沿用既有) | — |

### 17.10 Phase 1 啟動 Checklist(Day 0 名單)

> ⚠ **TBD**:用戶回辦公室問完後填入。最低要求:**admin / project.pm / project.sales 至少各 1 人**(可跑 pilot)。

```
☐ admin                            (?人,IT 部門;最少 2 人 + 1 backup)
☐ project.top_director             (?人,最高層;1-3 人)
☐ project.bu_director              (each BU 1人;BU 數量 TBD)
☐ project.bu_super / hq_super      (Phase 2 才上,可暫緩)
☐ workflow.admin                   (?人,IT 1-2 人)
☐ workflow.bu_editor               (each BU 1人,可由 bu_director 兼)
☐ data.connection_manager          (?人,IT 1-2 人)
☐ notification.editor              (?人,IT 1-2 人 + admin)
☐ confidential.policy_editor       (?人,admin + 法務 / 財務代表)

☐ project.sales                    (業務部全員,LDAP group → admin 批次授)
☐ project.pm                       (PM 部全員,同上)

☐ Pilot 啟動最小集合:
    ✅ admin × 1
    ✅ project.sales × 1
    ✅ project.pm × 1
    ✅ workflow.admin × 1
```

### 17.11 ✅ 已決議總覽

| # | 議題 | 決議 |
|---|---|---|
| 1 | 身份授予機制 | **全 admin 手動**,不走 LDAP 自動推導 |
| 2 | 一個 user 多身份 | ✅ 支援,union 權限 |
| 3 | 身份清單 | **13 個**(移除 `bg_director`,改用 multi-BU 授權 `bu_director`) |
| 4 | 組織隸屬 | **多對多** `user_organization_memberships`,admin 手動 maintain |
| 5 | 組織層級 | 確認有 BU + sub-BU,深度 TBD |
| 6 | admin 權限 | **預設全開不鎖**;走 testing mode toggle 做 audit 區分 |
| 7 | testing mode | 沿用 Cortex 既有 `a-admin-test`;進入填理由 + 1 小時 timeout + audit prefix `[ADMIN_TEST]` |
| 8 | super_user 任期 | 預設無 |
| 9 | chat_guest 任期 | **不做主動任期**(host 踢 + 結案凍結已足) |
| 10 | 緊急 break-glass | 平台技術防護「不准刪到 0 admin」;不做雙人雙鑰 |
| 11 | 高風險 role 雙簽 | **不做** |
| 12 | 離職員工 audit 名稱 | 保留 + 「已離職」標記 |
| 13 | super_user / director 上線時機 | Phase 2(配合戰情會議室) |
| 14 | Day 0 最小名單 | admin × 1 + sales × 1 + pm × 1 至少有 |

---

## 18. Phase 1 啟動規劃(資料遷移 / Pilot / 滾動上線)

> Phase 1 開工前的 playbook。

### 18.1 ✅ 資料遷移策略

#### 18.1.1 歷史報價案 — **完全不遷**

- 平台冷啟動,KB 從 Phase 1 結案案自然累積
- **不做** 歷史 Excel parse(質量參差會誤導 RAG)
- **不做** admin 手動挑案 seed
- 接受冷啟動初期 RAG 召回有限,1-2 個月內隨案累積

#### 18.1.2 主檔處理 — **全部從 ERP 拉,不在平台維護基本檔**

| 主檔 | 處理 |
|---|---|
| 客戶名單 | ERP 即時拉(走 §15 inbound + snapshot) |
| 料號 / BOM | 同 |
| 料件成本 | ERP 採購價即時拉 + snapshot |
| 廠區成本基期 | **不在平台維護**;ERP 改完後本平台下次拉值自動同步 |
| 客戶 RFQ 單 | 純文件附件,不另建主檔 |

對應 §6.3:所有 ERP 拉值都自動 snapshot 到 `project_erp_snapshots`(歷史可追溯)。

#### 18.1.3 組織層級初始化

- ⚠ **此處 TBD**:現有系統已有部分組織資料(BU 已知);**缺組織主管 + sub-BU 結構**
- → 後續討論時定案,Phase 1 開工前 admin 手動補齊

#### 18.1.4 ✅ Phase 1 開工前不安排正式 Review 週

**初期由 IT 自己角色扮演所有人(業務 / PM / 工程 / 財務 / 法務)走完流程驗證**;確認系統可用後再讓真實業務介入(Pilot)。

對應 v0.3.5 提的「業務+財務+法務 review tier 邊界」流程**取消**或**延後到 Pilot 之後**。

理由:
- 初期需求不清,業務 review 反而拖慢
- IT 自己跑可以快速 iterate,確認 happy path
- Pilot 上線時(P1 末)再讓業務介入

#### 18.1.5 ✅ QUOTE Plugin 預設配置(對齊事業單位 RFQ Flow)

事業單位提供的 RFQ flow(2026-05-01 OIBG 文件)已對齊 spec,以下作為 QUOTE plugin 的預設配置。

**Workflow Template QUOTE_STANDARD 8 Stages**:

```
1. Receive RFQ                  業務 → DPM,sla 4h
   ↓
2. Q&A Collect                  DPM + Team 收問題,sla 24h
   ↓
3. Q&A Feedback                 BPM 對客戶回覆,sla 8h
   ↓
4. BOM 提供                     RD/DPM(EE+ME),sla 24-72h(視 BOM 複雜度)
   ↓
5. ⚡ 並行(stage 內多 task 並行,§14 已支援)
   ├─ MPM Collect:PKG / ME / SMT / Assembly / Test / Tooling / FD / Cleansheet
   └─ DPM Collect NRE:EE/ME BOM / EMI / Cert / WHQL / Compat / RD Resource / Schedule
   ↓
6. BOM Cost Review              DPM + BPM + RD + 採購,sla 8h
   ↓
7. RFQ Cost Review              DPM + BPM + RD,True cost / CMS / Suggested quote / Profit,sla 16h
   ↓
8. Submit Final Quote           BPM + Sales,sla 4h
```

**預設 Channel 配置(QUOTE plugin 7 channels,§13.10)**:

```
📢 #announcement      公告(host = DPM/BPM)
💬 #general           一般討論(全員)
💬 #qa-customer       客戶 Q&A(BPM 主導)
💬 #engineering       EE/ME/RD 討論
💬 #sourcing          採購 / 供應商
💬 #factory           工廠(MPM + EPM + 各廠採購)
💬 #cost-review       BOM cost review + RFQ cost review
🔒 (DM by need)
```

**預設 Form Fields(15+ deliverables,RACI 對齊)**:

| Field | Responsible(R) | Accountable(A) |
|---|---|---|
| BOM cost - EE | 台北採購 / 工廠採購 | DPM |
| BOM cost - ME | 廠商 / 塑件PM / 工廠採購 | DPM |
| BOM cost - PKG | 工廠採購 | MPM |
| Cleansheet | SMT team / NPI EPM | DPM |
| NRE - SMT | SMT team | DPM |
| NRE - BB Assembling | NPI EPM | DPM |
| NRE - MTE (Quality) | NPI EPM | DPM |
| NRE - ME Tooling | 廠商 / 塑件PM / 工廠採購 | DPM |
| Transportation - Part | 台北採購 / 工廠採購 / PE | DPM |
| Transportation - FG | (待定) | MPM |
| EMI / Safety Cert | QA team | DPM |
| WHQL / USB IF | RD QA | DPM |
| Compatibility Test | QA team | DPM |
| RD Resource Cost | RD | DPM |
| Royalty fee | RD / 採購 | DPM |
| Suggested Quote / Profit | DPM + BPM + RD | BPM |

**預設 Dependency Schedule**(`relative_deadline_days`):

| Task | depends_on | days |
|---|---|---|
| QA Response | (anchor) | — |
| Schedule update | QA Response | +1 |
| RET Plan and Cost | QA Response | +3 |
| EE BOM cost | EE BOM | +3 |
| Internal BOM review | EE BOM Cost | +1 |
| Cleansheet to VP | EE BOM Cost | +1 |
| Quotation to Sales | EE BOM Cost | +2 |

→ 細節清單由 launch checklist 補完;IT 角色扮演時用此作 first cut。

### 18.2 ✅ Pilot 規劃

#### 18.2.1 Pilot 案範圍 — 走 (a)

- **1-2 個真實 RFQ 案**,業務推薦 + PM 陪跑
- 不做模擬案、不做平行驗證(舊 Excel + 新平台雙寫)
- 接受真實業務驗證的風險,但走 v0.3.5 候選條件降低風險

**Pilot 候選條件**(v0.3.5 對齊):

```
☐ 非戰略客戶(萬一卡住不影響重要案)
☐ 料號為標準通用品(非客戶專用)
☐ 可打 2-3 地廠區(驗證成本對比)
☐ BOM 深度適中(2-4 層)
☐ 金額 Tier-S 或 Tier-A(不涉最敏感金額)
☐ 近期有真實 RFQ
☐ PM 有意願陪跑
```

#### 18.2.2 ✅ Pilot 期長 + 評估節奏 — 走 (b)

- **1-2 個月**(至少 1 個案完整跑完:收件 → 結案 → KB sediment)
- **每週 retro**(週五 30 min):收 PM / 業務 feedback,當週評估是否需 hot-fix

#### 18.2.3 ✅ 成功 Criteria(must-pass 最低 3 項)

```
✅ 無 critical bug(資料外洩 / 機密欄位 leak / 結案 fork 失敗)
✅ 無資料外洩
✅ PM 主觀滿意度 ≥ 7/10
```

其他 nice-to-have(不是 GA 阻擋,但要追蹤):

```
☐ 平均 SLA 達 24h(對齊原訴求)
☐ 贏單率不降(對比歷史平均)
☐ 業務主觀滿意度 ≥ 7/10
☐ Form 完成度自動追蹤準確
☐ KB sediment 後可被 RAG 召回
☐ 主管儀表板燈號正確
```

#### 18.2.4 ✅ Rollback 策略

- **底線**:(a) 完全 rollback,Pilot 案改回 Excel 舊流程,Phase 1 推遲
- **實際走**:(b) 部分 rollback(某些 painful 功能停用,其他繼續)or (c) 不 rollback,bug fix on the fly + 延長 Pilot
- 觸發 (a) 的條件:critical bug 連續 3 次 + IT 評估短期內無解

### 18.3 ✅ Cortex 主站滾動上線(不需 maintenance window)

#### 18.3.1 修改範圍(全部不影響既有 user)

| 修改 | 影響 |
|---|---|
| `ticket_messages` ALTER TABLE 加欄位(§13.1.1) | 滾動式,不鎖表;既有 feedback ticket 完全不受影響 |
| KB 命名族 `projects-*` 新增 | 不影響既有 KB(`feedback-*` / `help-*` / 等等)|
| Sidebar 加「📁 專案管理」menu | 既有 user 多看到一個 entry,可選不點 |
| Help 章節 `u-projects` / `u-projects-quote` 新增(§10.1) | 不影響既有章節 |
| Cortex chat / 教育訓練 / AI 戰情 | **完全不動**,不會影響既有功能 |

#### 18.3.2 ✅ 上線時段

- **不需要選低使用時段**(週末、深夜)
- 直接平日工作時段滾動上線(典型 10-11 AM 上線後監控)
- 保留 quick rollback 路徑(deployment.yaml `rollback` ready)

### 18.4 Phase 1 啟動 Checklist(完整版)

```
☐ admin 名單(IT 部門,最少 2 + 1 backup)
☐ project.sales × 1 + project.pm × 1(Pilot 啟動最小集)
☐ workflow.admin × 1
☐ 組織層級 / 主管 / sub-BU 補齊(待後續討論)
☐ ERP / SFC / BI connection 設定 + read-only role 確認
☐ ERP procedure / SQL source 清單(IT 自己角色扮演業務跑出來)
☐ workflow_template QUOTE_STANDARD seed
☐ form_template QUOTE_STANDARD seed
☐ confidential_field_policies seed(IT 角色扮演業務 / 財務 / 法務)
☐ Excel 範本 cell binding(IT 角色扮演 PM)
☐ Pilot 候選 RFQ 案 1-2 個(業務推薦,PM 陪跑意願)
☐ Cortex 主站滾動部署 + smoke test
☐ Pilot 啟動 + 每週 retro 排程
```

### 18.5 ✅ 已決議總覽

| # | 議題 | 決議 |
|---|---|---|
| 1 | 歷史報價遷移 | **完全不遷**(冷啟動,自然累積) |
| 2 | 主檔處理 | **全部 ERP 拉 + snapshot**;不在平台維護基本檔(對齊 §6.3)|
| 3 | 組織層級初始化 | TBD(後續討論) |
| 4 | 開工前 Review 週 | **不安排**;IT 自己角色扮演;真實業務介入留到 Pilot |
| 5 | Pilot 案範圍 | 1-2 個真實 RFQ + v0.3.5 候選條件 |
| 6 | Pilot 期 | 1-2 個月 + 每週 retro |
| 7 | 成功 criteria | 無 critical bug + 無資料外洩 + PM 滿意 ≥ 7/10 |
| 8 | Rollback | (a) 為底線;實際 (b)/(c) |
| 9 | 主站上線 | 滾動式,不需 maintenance window |

---

## 19. 安全分層(更新版)

| 層 | v0.3.5 | v0.4 |
|---|---|---|
| L0 網路 | 獨立 hostname + IP 白名單 + 獨立 WAF | **移除**(共用主站) |
| L1 身份 | SSO + Step-up 2FA | **僅 SSO**(2FA 改交 SSO 層處理) |
| L2 授權 | role + ABAC + Oracle VPD + 欄位級 ACL | 沿用 |
| L3 加密 | App AES-GCM BLOB(機密欄位) + Oracle TDE 表空間 | 沿用 |
| L4 DLP / 浮水印 | 圖片 OCR 偵測價格、下載浮水印、批量匯出核准 | 沿用 |
| L5 稽核 | append-only audit log 7 年 | 沿用 |

**結論**:從 6 層退到 4-5 層,但對「內部 + 不要求物理隔離」場景仍然足夠;Chrome Extension 漏洞用「強化權限與稽核」補。

---

## 20. Phase 規劃

| Phase | 時程 | 主要交付 |
|---|---|---|
| **P1 MVP** | 2-4 週 + 1.5-2 週 AI 加速 = ~6 週 | 通用 schema + project_types + workflow_templates(SYSTEM scope only)+ QUOTE plugin 最小版 + 機密欄位機制 + **多 channel 戰情會議室**(含 dm) + QUOTE plugin 預設 7 channels + 大項/小項雙層 task + 多 owner + **RACI(A+R)** + **Multi-PM(sub_role)** + **Dependency-based deadlines** + 燈號 roll-up + Project Lifecycle 5-state + GUI Form Builder + Notification SYSTEM scope + **Inbound 資料整合層** + **跨專案儀表板** + **規則式警示 widget A** + **AI 加速 10 項 + 開案 Wizard**(⭐ 7 步驟 Wizard + ⭐ 狀態 SUMMARY + RFQ 解析 + 歷史相似案 + Q&A 草稿 + 決策紀錄 + 訊息排序 + Bot 主動提醒 + 任務拆解 + 2 加分項) |
| **P2 協作 + KB** | 4-8 週 | 戰情會議室(通用)+ super_user 機制 + Bot 整合 + 群聊 + KB write pipeline + 結案 fork + 脫敏 + RAG 整合 + 階段性 summary + 個人偏好 + Notification BU/PROJECT_TYPE + Workflow_template BU/USER scope + role-only 待 claim task + 從其他專案複製 task + Excel Import/Export(form/workflow/task) + AI 輔助 Excel cell binding + **域內通訊(通用聊天 私聊 / 群組)** + **AI 戰情 embed 進專案頁** + **Inbound 排程化(scheduled / event_triggered)** + **儀表板 RAG 類似案推論 widget B + 自訂 dashboard 拖拉 + 進階 widget(趨勢 / 客戶分布)+ KPI MV 優化** |
| **P3 進階分析** | 8-12 週 | What-if 模擬 / 贏單率預測(QUOTE)/ 多級簽核工作流 + reviewer 簽核機制 / 第二個 plugin(IT 或 GENERAL 強化)/ Browser push notification / **儀表板 ML 預測模型 widget C(贏單機率 / What-if / 異常 pattern 偵測)** |
| **P4 持續迭代** | — | TRAINING plugin / NPI closed-loop / 客戶畫像 / 競品對標 / **客戶報價系統雙向 API 串接(待對方 API ready)** / 教育訓練 ↔ 專案平台雙向整合評估 |

---

## 21. RAID(Risk / Assumption / Issue / Dependency)

### 風險

| # | 風險 | 影響 | 緩解 |
|---|---|---|---|
| R1 | 通用化稀釋報價系統的「戰情價值」定位 | 業務感受不到差異化 | UI 顯著差異化:QUOTE plugin 有專屬主題色 + 戰情會議室 + SLA banner;sidebar 標題仍叫「業務報價」 |
| R2 | 整合到主入口失去 hostname 隔離 | 截圖類洩漏增加 | 接受;以 ACL + 稽核 + 浮水印補 |
| R3 | plugin 程式碼定義 → 新 type 必須 RD 上 code | 業務想加新類別等 RD release | admin 預先建議 + RD release cadence 一個月一次 |
| R4 | ajv 驗 schema 在 PATCH 慢 | 大 payload 延遲 | schema 預編譯快取 |
| R5 | 工作流 template fork 太多管不動 | 模板爆炸 | 每使用者最多 N 個 USER scope template;BU 模板需主管核准 |
| R6 | 機密 → 非機密 不可逆,但 PM 可能誤勾機密 | 後悔無法回頭 | 建立後 24h 內由 admin 可協助回頭(audit 加註)→ 之後不可改 |
| R7 | 結案 fork 時 LLM 脫敏漏掉某些金額 | 真實金額洩到 public KB | scrub 規則由 plugin 提供 + 結案前 PM 預覽 + 法務 sample 抽查 |
| R8 | KB 命名族擴張失控 | RAG 干擾 | 命名規則嚴格,新 type 上線時 admin review |

### 假設

- A1:Cortex 既有的群聊 / KB / 技能 / ERP 工具機制穩定可複用
- A2:LDAP / SSO 已支援必要的身份識別
- A3:Oracle TDE 在內網環境已啟用
- A4:Phase 1 的 pilot 由業務部選 1-2 個 QUOTE 真實案

### Issue / Dependency

- D1:project_types plugin code 規範需要 RD 內部先對齊
- D2:Workflow template 三層 scope 編輯介面需設計 mockup(P1 內)
- D3:`confidential_field_policies` 初始資料(QUOTE 的 amount/margin 等)需業務 + 財務 review
- D4:KB 命名族與既有 KB 共存時的 search 預設行為要 review

---

## 22. 待後續討論

### 22.1 Phase 1 啟動前需要補的資料

> 詳見 [projects-platform-launch-checklist.md](./projects-platform-launch-checklist.md)
>
> 該 checklist 涵蓋:
> - 🔴 必補(kickoff 前):組織結構 / Day 0 名單 / 業務 SOP 預設值 / 環境對接
> - 🟡 開發中補:QUOTE plugin 詳細 / Notification 初始 / 機密策略
> - 🟢 Pilot 後補:治理文件化 / UI 風格
> - 🔵 Future Phase

### 22.2 架構級 待後續定案

- project_types 的「進階參數」放 metadata 表還是 plugin code?(目前先 plugin code)
- workflow_template 改版時,已綁定的 in-flight 專案要不要強制升級?(預設不,但提供 PM 看 diff)
- declassify pipeline 的 LLM scrub 是否需要法務人工 review?(P2 上線前定)
- 戰情會議室要不要支援「跨專案」聚合(主管視角看多個 active project_id)?(P3 評估)
- **組織層級深度**(BU + sub-BU 已知,完整層級 TBD — 由用戶後續討論補)
- **客戶報價系統 API 規格**(Future Phase 雙向串接時對齊):
  - 推送方向:本系統 → 客戶報價系統(我方完成單價結果)
  - 拉回方向:客戶報價系統 → 本系統(觸發我方建 form 新版本)
  - 認證機制(待對方系統 ready 時雙方對齊)
  - 重試 / 冪等性 / 失敗告警策略

---

## 23. 對照參考

### 同源文件(2026-05-01 v2 最新)
- **Phase 1 啟動 checklist**:[projects-platform-launch-checklist.md](./projects-platform-launch-checklist.md) — 開工前 / 中 / 後需要補的資料
- **OIBG RFQ flow 解釋(給不懂業務的人)**:[oibg-rfq-flow-explained.md](./oibg-rfq-flow-explained.md) — 19 頁 + 完整用語表(角色 / 文件 / 成本 / 認證類縮寫)
- **業務主管投影片**:[projects-platform-slides.md](./projects-platform-slides.md) — 27 張 v2(對齊 OIBG flow + 多 channel + RACI + Multi-PM + Stage Gate)
- **主管簡報完整版**:[projects-platform-executive-deck.md](./projects-platform-executive-deck.md) — 29 張 v2(架構 / 流程 / 功能 / 時程 / 效益)
- **主管簡報 2 頁總結**:[projects-platform-executive-summary.md](./projects-platform-executive-summary.md) — 1 頁功能 + 1 頁流程 v2

### 既有 Cortex 文件
- 舊規格書:[quote-system-spec.md](./quote-system-spec.md)(v0.3.5)— 仍可作報價特化邏輯參考
- Cortex 使用者手冊:[help-manual-structure.md](./help-manual-structure.md)
- KB 檢索架構:[kb-retrieval-architecture-v2.md](./kb-retrieval-architecture-v2.md)
- 教育訓練平台(plugin 模式參考):[training-platform-design.md](./training-platform-design.md)
- 問題反饋平台(整合到主入口模式參考):[feedback-platform-design.md](./feedback-platform-design.md)

— 本文件結束 —
