# Cortex 通用專案管理平台 · Demo 操作劇本

> 對齊 docs/Cortex_互動Demo.html + Cortex_Demo操作手冊.pdf 11 個 Story
> 預計 demo 時間:30-45 分鐘
> 版本:Sprint A-F 全 ship 後(2026-05-12)
> 進入點:Cortex sidebar → 📁 專案管理(beta)→ `/projects-platform`

---

## 環境前置

1. server 啟動(`cd server && npm run dev`)
2. server/.env 設:
   ```
   ENABLE_PROJECTS_PLATFORM=true
   ENABLE_PROJECTS_WORKERS=true
   PROJECTS_PLATFORM_GA_MODE=false
   PILOT_USERS=3,24                            # 非 admin 試營運名單
   PROJECTS_PLATFORM_USE_LLM=false             # 預設 mock;true = 真 Gemini Flash
   ```
3. client 啟動(`cd client && npm run dev`)
4. 用 admin(RICH_LAI / id=1)登入,或 pilot user(rich_test / id=3)登入

## 風格

進入 `/projects-platform` 後**整個畫面換成獨立 shell**:
- Navy topbar(56px)+ brand「C Cortex v0.4」+ breadcrumb + 視角 dropdown + 通知 + avatar
- Slide-in sidebar(240px,可 M 鍵 toggle)
- 亮色主底(`#F8FAFC`)+ Ocean Depth + Cyan(`#02C39A`)accent
- Cortex 主站 sidebar / topbar 都不顯示

---

## Story 1 · 開案 Wizard 7 步驟(⭐ 最有感)

對應 PPT slide 5-8 · Demo 手冊 §7 · 30min → 5min

### 操作

1. 進 `/projects-platform`(預設「我的專案」頁)
2. 點右上「**+ 新增專案**」(cyan 按鈕)
3. **Wizard modal 開啟**,navy header 帶「⭐ 開案 Wizard · 7 步驟 · 30min → 5min」
4. **Step 1 客戶來信**:
   - 看到「Apple_USB-C_RFQ.pdf 已上傳」+ AI 預填 4 欄位
   - 92% 信心度 + 規格不清提示(電壓 / RoHS)
   - 右側 navy AI 助手 panel
5. **Step 2 歷史參考**:
   - 3 案推薦(QT-2025-0212 WIN / 0087 WIN / 0156 LOSS)
   - AI 推薦 PM:Mike Wang(處理過 3 個 Apple USB-C)
   - 推薦 Workflow:QUOTE_DEFAULT(8 stages)
   - 預估 21 天 + 交期合理性 🚦 綠燈
6. **Step 3 機密設定**:
   - amount / margin / cost_breakdown 預勾 + TIER 策略
   - customer_name → ALIAS
   - quantity → RANGE
   - is_confidential ON toggle
7. **Step 4 PM/Team**:業務 + 助理 + 4 PM(DPM/BPM/MPM/EPM)指派
8. **Step 5 流程模板**:8 stages 卡(STAGE 1 / 6 / 7 / 8 標 ⚖ GATE,STAGE 5 標 ⚡ 並行)
   - 底部 navy panel:AI 自動算 Dependency Deadlines 列表
9. **Step 6 priority_score**:3×3 矩陣(高重×高急 = 6)+ AI 推薦理由
10. **Step 7 確認啟動**:6 區預覽 + 5 件事清單
    - 建 7 channels / 8 stages / 通知 / Pin / SLA
11. 點「**✓ 啟動專案**」(cyan→teal gradient 按鈕)
12. **自動跳 WarRoom**(backend 已建好 7 channels + 8 stages)

---

## Story 2 · 戰情會議室 4 分頁(Slack-like)

對應 PPT slide 9-11 · Demo 手冊 Story 2-7

### 操作

進入 WarRoom 後看到 4 個分頁:**聊天 / 任務看板 / 報價 Form / 成員**

### A. 聊天分頁

1. **左欄**:7 channel 分組(公告 / 頻道 6 / 私訊 DM)
2. **中欄**:當前 channel 訊息流
3. **右欄**:頻道資訊 + ⭐ Status SUMMARY placeholder + Stages 進度
4. 試發訊息:
   - 切到 `#engineering` channel
   - 選類型「🚨 BLOCKER」
   - 輸入「客戶要求縮短交期,需重議」
   - Cmd/Ctrl+Enter 送出
   - **訊息出現,紅 dot**
5. 切到 `#announcement`
   - **自動同步**:看到 SYSTEM 訊息「🚨 BLOCKER (from #engineering · msg #X)」
6. 試 Pin:hover 任一訊息 → 點 📌 → 訊息上方 pinned banner 出現

### B. 任務看板

1. 5 欄 Kanban:PENDING / IN_PROGRESS / BLOCKED / READY_FOR_REVIEW / DONE
2. 點「**+ 新任務**」開 modal,填:
   - 標題:`EE BOM 結構分析`
   - Stage:`#1 RECEIVE_RFQ`
   - A · Accountable:`DPM`
3. 卡片出現在 PENDING 欄,顯示:
   - **A 紅 pill**(DPM)+ **R 藍 pill**(預設 owner)
   - Dependency chip ⏰(若有設 depends_on)
4. 點卡片 → detail modal → 點「進行中」狀態
5. **狀態改 DONE 後,下游 task computed_due_at 自動算**(backend dependency engine)

### C. Form 分頁(stub,Sprint E.2 補 builder)

stub 訊息:「Sprint E 接 qp_form_* schema」

### D. 成員分頁

1. **Multi-PM Team 分組視覺化**:
   - 業務 HOST(2 人)
   - DPM Team / BPM Team / MPM Team / EPM
   - 採購跨 team
   - 其他
2. 頂部 Wizard 填的 PM 三劍客預覽卡

---

## Story 3 · ⭐ 跨專案儀表板(主管視角)

對應 PPT slide 13-14 · Demo 手冊 §8.4

### 操作

1. Sidebar 點「**📊 跨專案儀表板**」
2. **Widget 1 SLA 燈號**:4 卡(超期 / 接近 / 正常 / 暫停)
3. **Widget 2 Watchlist**(priority_score ≥ 6 自動訂閱)
   - **hover 任一行 → ⭐ Status SUMMARY tooltip(navy 漸層 + 三段式)**
   - 顯示「進度 / 風險 / 待辦(24h)」
4. Widget 3+4:我的 Task / 待 Review
5. Widget 5+6:Delay 熱點(per stage bar)/ 本期 KPI
6. Widget 7:成員負載熱圖 + 超期警示
7. AI 預測警示 3 phase 卡

---

## Story 4 · ⭐ Status SUMMARY 三處顯示

對應 PPT slide 14

### 位置驗證

| 位置 | 驗收方式 |
|------|---------|
| **#announcement Pin** | WarRoom 聊天 → #announcement,呼叫 `POST /api/projects/dashboard/summary/:id/pin`(PM/admin),自動寫 AI_INSIGHT 訊息並 Pin |
| **專案列表行下** | `/projects-platform` 每張卡下方顯示 AI one_liner(漸層綠卡帶 AI badge)— 一進專案列表就看到 |
| **Watchlist hover** | Dashboard → hover Watchlist 任一行 → navy 完整三段式 tooltip |

### LLM 切換

```bash
# server/.env
PROJECTS_PLATFORM_USE_LLM=true   # 啟用真 Gemini Flash
# 重啟 server,SUMMARY 內容變成 LLM 產(_mock: false)
# 失敗自動 fallback 回 mock
```

---

## Story 5 · ⭐ 6 角色機密策略 demo(displayStrategy 真接)

對應 PPT slide 17 · Demo 手冊 §10 · Sprint E.2 後端真接

### 操作

1. 進「**機密策略管理**」(Sidebar 管理 → 機密策略)
2. 看上半 4 策略 explainer 卡(TIER / ALIAS / MASK / RANGE)
3. 滑到下半「⭐ 6 角色 displayStrategy DEMO」navy 卡
4. **點 topbar 右上的「視角」dropdown**,切換 6 角色:
   - **HOST**:`Apple Inc.` / `$182,500` / `16.6%` 全明文
   - **PARTICIPANT**:`A001` / `Tier-A` / `Tier-?`(走 displayStrategy)
   - **OBSERVER**:全明文(唯讀)
   - **CHAT_GUEST**:form 全 🔒 403(後端真擋)
   - **SUPER_PARTICIPANT**:全明文(BU/HQ 經管)
   - **OUTSIDER**:機密案 403(後端真擋)

### 進一步驗收:後端真實 mask

5. 切到 OUTSIDER → 回「我的專案」 → **機密案的 customer/amount 真的被 mask** 成 Tier-A / A001(API 層套)
6. 切到 OUTSIDER → 點機密案進 WarRoom → **直接 403 頁**
7. 後端 log 看到 `X-Demo-Role: OUTSIDER`

---

## Story 6 · KB 雙層(Live + 沉澱)

對應 PPT slide 18 · Demo 手冊 Story 9 · spec §7-§8

### 操作

1. Sidebar 點「**📚 KB / 知識庫**」
2. **Live KB tab**(預設):5 個進行中專案的 chunk
   - 類型 chat/form/task/attach
   - 機密案有 🔒
   - tags 為 RAG 召回用
3. 切「**沉澱 KB**」:4 個結案案的不可逆快照
   - 已 scrub 標記(客戶名→A001、金額→Tier-A、毛利→MASKED)
4. 看底部「🔁 Archive Pipeline 流程」5 步驟(spec §7.14、§8.1)
5. 底部 navy 卡「💬 範例 RAG 查詢」

---

## Story 7 · AI 加速 10 項一覽

對應 PPT slide 21

### 操作

1. Sidebar 點「**✨ AI 加速 10**」
2. Hero banner:漸層 navy → teal → purple,顯示 LIVE / DEMO / TBD 計數
3. ⭐ Wizard banner:點此可跳回 Wizard
4. **必上 8 項(核心)**:每張卡顯示:
   - #編號(#21 / #1 / #2 / #5 / #23 / #24 / #26 / #29)
   - 整合到哪些功能(eye icon + 說明)
   - 業務體感
   - status badge(LIVE / DEMO / TBD)
5. **加分 2 項**(#32 交期合理性 / #37 歷史推薦)
6. 底部 Phase 2-4 roadmap 3 卡 + 成本估算

---

## Story 8 · Admin 後台 5 頁

對應 Demo 手冊 Story 10-11

### 操作(快速 demo)

| Sidebar Link | 內容 |
|--------------|------|
| **表單範本** | 3-pane designer:6 sections × 18 fields(QUOTE)· 點欄位看機密策略 |
| **任務模板** | EPIC × SUBTASK 樹(6 EPIC × 24 SUBTASK)· 收合 / RACI A·R pill / Dependency chip |
| **機密策略** | 4 策略 explainer + 6 角色互動 demo(看 Story 5)|
| **通知規則** | 5 通道 × 8 規則 + 2 escalation chain · 切 toggle |
| **連線管理** | 5 source_type + 6 連線 + Field Mapping 視覺化 |

每頁頂部有 **Scope toggle**(SYSTEM / BU / USER)— spec §5.1 三層 scope

---

## Story 9 · Cortex Internal Admin(限 admin 看)

對應 docs/projects-platform-internal-admin-plan.md

### 操作

1. admin 登入後 sidebar 看到「**內部 Admin**」段
2. 點「**Internal Admin**」→ 10 個子頁狀態 + sprint roadmap
3. 點「**System Health**」→ Module / Version / Uptime / Feature flag / LLM Queue / Plugins / Sprint progress(每 10 秒 auto-refresh)

---

## API 試打(curl)

```bash
TOKEN="..."  # 從 admin 登入後拿

# 7 widget
curl -H "Authorization: Bearer $TOKEN" http://localhost:3007/api/projects/dashboard

# 機密案 SUMMARY(OUTSIDER 視角會 mask)
curl -H "Authorization: Bearer $TOKEN" -H "X-Demo-Role: OUTSIDER" \
     http://localhost:3007/api/projects/dashboard/summary/3

# Pin SUMMARY 到 announcement(PM/admin)
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:3007/api/projects/dashboard/summary/3/pin

# 列出我的專案(用 PARTICIPANT 視角 → 機密欄位 mask)
curl -H "Authorization: Bearer $TOKEN" -H "X-Demo-Role: PARTICIPANT" \
     http://localhost:3007/api/projects/projects

# 機密案 + OUTSIDER → 403
curl -i -H "Authorization: Bearer $TOKEN" -H "X-Demo-Role: OUTSIDER" \
     http://localhost:3007/api/projects/projects/3
```

---

## 已知 demo 限制(Sprint F 後待補)

| 範圍 | 現況 | 待補 |
|------|------|------|
| Form 分頁 | stub | qp_form_* schema(migration 007-010)+ form builder UI |
| AI #5/#23/#24/#26/#29 | UI 提示「Sprint 後續」 | 接 Gemini Flash + 在對應 channel/task 上跑 |
| Connection inboundResolver | UI 視覺化 | 真實 ERP / SQL 拉值 |
| Notification routing engine | UI 規則表 | 真實 Webex / Email 觸發 |
| 結案 fork pipeline | 列表 + 流程說明 | 真 scrub middleware + KB embedding |
| AI 預測警示 | A 規則式 ✓ / B+C TBD | Phase 2-3 ML 模型 |

---

## 回到對話模式

點 topbar 左上「**C Cortex**」brand → 回 `/projects-platform` 首頁
或 sidebar 左上 hamburger → 收起 sidebar(M 鍵)
或直接導 `/chat` 回 Cortex 主站
