# Cortex 通用專案管理平台 · Demo 操作劇本

> 對齊 docs/Cortex_互動Demo.html + Cortex_Demo操作手冊.pdf 11 個 Story
> 預計 demo 時間:30-45 分鐘
> 版本:Sprint A-F + Phase 1 polish(notification + socket)ship 後(2026-05-18)
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

## ⭐ Phase 3 Sprint O/P/Q — 贏單預測 + 多級簽核 + ML widget(2026-05-19 ship)

Phase 3 一氣呵成 3 個 sprint。

### Sprint O · 贏單機率預測

1. 進任一專案 WarRoom
2. header 右上點紫色「贏單機率」按鈕
3. modal 開:
   - 環形 ring 顯示 WIN%(0-100)
   - confidence badge(high/mid/low based on sample size)
   - 案件特徵 grid(customer / part_no / quantity / BU / priority / season / BU win rate / tasks)
   - 影響因素列表(綠 ↑ / 紅 ↓ 排序)
   - LLM 解讀 markdown(若 USE_LLM=true)
4. API:`POST /api/projects/ai/win-rate-predict { project_id }`

### Sprint P · 多級簽核

1. WarRoom header(ACTIVE 專案)看到琥珀「申請結案簽核」按鈕
2. 點 → prompt 輸理由 → 送出
3. 預設規則:`lifecycle_close` chain 需 `project.bu_director` 1 票
4. BU director 收到 in_app_badge 通知
5. director 進 sidebar「📝 待批」看到該 chain → 批准 / 拒絕
6. 全批准 → 自動呼叫 `projectsService.updateLifecycle(CLOSED)`
7. requester 收到通知「✅ 簽核已通過」

**4 個 default chainKinds**:
- `high_amount` — bu_director + sales 雙簽
- `confidential_upgrade` — confidential.policy_editor + admin
- `lifecycle_close` — bu_director
- `stage_gate` — bu_director

### Sprint Q · ML 預測警示 widget C

1. 進跨專案儀表板
2. 找到底部紫色 widget「ML 預測模型 widget C」
3. 點「跑批次預測」→ 對 active 專案批次跑規則式預測
4. 兩欄分組:
   - 🚨 高風險(WIN < 40%):點專案直接跳 WarRoom 看 detail
   - ⭐ 高機率(WIN ≥ 70%)
5. 每筆顯 project_code + customer + win% + top_factor(影響最強因素)

API:`POST /api/projects/ai/win-rate-batch { limit: 30 }`

### Phase 3 ship 全圖

| Sprint | 狀態 | commit |
|---|---|---|
| N · What-if 模擬器 | ✅ | (前一輪) |
| O · 贏單機率預測 | ✅ | c05756c |
| P · 多級簽核 + reviewer | ✅ | 8278514 |
| Q · ML 預測警示 widget C | ✅ | (本 commit) |

---

## ⭐ Phase 3 Sprint N — What-if 模擬器(2026-05-19 ship)

對齊 spec §16.5(預測能力 B 層)+ slide 16。改參數即時看影響。

### A. 入口

1. 進 WarRoom > Form tab
2. 「價格 / 成本」section 右上有 2 個按鈕:
   - 紫色「What-if 模擬」(Sprint N)
   - 黑底「Cleansheet AI 分析」(Sprint M-12)
3. 點 What-if → 紫/teal gradient modal 跳出

### B. 三欄 layout

**左欄 · BASELINE**:從 project.data_payload 推
- 數量 / cost_total / margin / due_date_days / factory

**中欄 · SCENARIO**:4 個輸入
- **數量 slider**(-50% ~ +100%,step 5%)→ 即時顯示換算後 pcs
- **原料 slider**(-20% ~ +30%,step 1%)→ 顯示「漲 X%」/「跌 X%」
- **匯率 slider**(-10% ~ +10%,step 1%)→ USD 升 / 貶
- **廠區 dropdown**(VN/CN/IN)

**右欄 · PROJECTED**:client-side 規則式即時算
- 數量 / cost / margin / due_date / 廠
- 每項顯示 delta(綠 ↑ / 紅 ↓)
- margin < 10% → 紅底警示
- 風險列表(margin < 5% 高危 / 交期 +20% 中危 / 數量翻倍 → 產能風險 / 原料漲 > 10% 建議鎖價)

### C. ✨ AI 解讀(LLM)

底部「✨ AI 解讀」按鈕 → POST `/ai/what-if-analyze`
- Gemini Flash 生 markdown(< 250 字)
- 解釋為何 delta / 影響最大因素 / margin 危險時補救建議

### D. 規則式邏輯(對齊 spec slide 16 範例)

```
quantity_pct:    每 +10% 數量 → unit cost -1.5%(規模效應)
raw_material_pct: × 0.60 sensitivity(PCB+SMT 60% 成本佔比)
fx_pct:           直接 × USD 報價
factory_switch:   VN→其他 → cost +5% / lead_time +10%

new_margin =(1 - new_cost / baseline_revenue) × 100
```

對齊 spec slide 16:
- "原料漲 5% → 毛利從 16% 降至 11%" ✓(實測 5% 漲 → ~13% margin)
- "匯率 -2% → 毛利從 16% 升至 18%" ✓

### E. API 試打

```bash
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"project_id\":3,\"baseline\":{\"quantity\":10000,\"cost_total\":3.80,\"margin_pct\":16,\"due_date_days\":21,\"factory_code\":\"VN\"},\"scenario\":{\"quantity_pct\":10,\"raw_material_pct\":5,\"fx_pct\":-2,\"factory_code\":\"CN\"}}' `
  http://localhost:3007/api/projects/ai/what-if-analyze
```

回:
```json
{
  "baseline": {...},
  "projected": { "cost_total": 3.97, "margin_pct": 12.31, "due_date_days": 25.4, "factory_code": "CN" },
  "delta": { "cost_total_pct": 4.4, "margin_pct": -3.69, "due_date_pct": 20.95 },
  "risks": [{ "level": "mid", "message": "交期延長 > 20%" }],
  "explanation_md": "(LLM markdown)"
}
```

---

## ⭐ Phase 2 Sprint M — AI 13 項深化(2026-05-18 ship)

對齊 spec §12.10.4 + PDF §E。3 個明列項目都上(MVP 範圍)。

### A. 智慧定價建議(#16 / Sprint M-11)

對應 spec §12.5 Form Surface 2「✨ AI 建議」按鈕。

1. 進任一專案 WarRoom → 「報價 Form」tab
2. 機密欄位區(報價金額 / 毛利率 / cost_breakdown / priorityScore)右側看到紫色「✨ AI」小按鈕
3. 點 ✨ → 紫色 modal 跳出「AI 智慧定價建議」:
   - **建議值**(Tier-M / MASKED% / 數字)
   - **信心 %**(綠/琥珀/紅色碼)
   - **推薦理由**(< 250 字)
   - **引用**(歷史相似案 — 從沉澱 KB 撈,scrub 過後 safe)
4. 點「採用此建議」→ 欄位旁出現「AI ✓」紫色標籤(走影子表 / shadow,不直寫,spec §12.5)

**Stub 模式**:`PROJECTS_PLATFORM_USE_LLM=false` → 回 stub mock + 「stub mock」琥珀 badge

### B. Cleansheet 三廠成本分析(#12 / Sprint M-12)

對應 spec §12.10.4 Cleansheet 草稿。

1. 進 Form tab → 「價格 / 成本」section 右上有黑底「Cleansheet AI 分析」按鈕
2. 點開 navy modal — 三廠 cost_breakdown 編輯表(VN/CN/IN 預設值 PCB/SMT/組裝/測試)
3. 修改任一格 → 自動算 total
4. 點「✨ AI 分析」:
   - **推薦廠**(獎盃 icon · 不一定是最便宜)
   - **總成本排序**(綠 → 紅,差 X%)
   - **各項目最低廠**(PCB winner / SMT winner / ...)
   - **AI 分析**(markdown 詳細說明)
   - **優勢 / 風險**(綠/琥珀雙欄)
5. 規則式 fallback:LLM 失敗仍給數值對比 + 推薦最便宜廠

### C. 主管日報(#33 / Sprint M-13)

對應 spec §12.10.4 主管 AI 日報。

1. 進跨專案儀表板 → 右上琥珀「☀️ 我的日報」按鈕
2. 點開 modal,可選 ☀️ 日報 / 📊 週報
3. **「預覽」**:跑 dry_run,顯示 markdown 但不寄通知
4. **「生成 + 寄出」**:
   - 把每個關注專案跑 StatusSummary
   - 紅燈專案排前面
   - **底部 AI 重點濃縮**(若 ≥ 3 個專案 + USE_LLM=true)
   - 寫進 user_notifications(鈴鐺紅點)
   - 寄 email(若 user.email 存在)
   - 回傳「✓ 已彙整 N 個專案 · 發送通道:in_app_badge · email」

### D. 批次跑(admin scheduled job)

```bash
# 跑所有 admin / PM / sales / director / super 的日報
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"period\":\"daily\"}' `
  http://localhost:3007/api/projects/ai/daily-report/run-all
```

回:`{ sent: 12, skipped: 3, errors: [] }`

Cron 整合(可選):
- env `PROJECTS_DAILY_REPORT_CRON='0 9 * * *'` 開啟(預設不開)
- 排程 service 內呼叫 `POST /api/projects/ai/daily-report/run-all`

### E. API 試打

```bash
# 智慧定價
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"project_id\":3,\"field\":\"amount\"}' `
  http://localhost:3007/api/projects/ai/pricing-suggest

# Cleansheet
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"project_id\":3,\"factories\":[{\"code\":\"VN\",\"cost_breakdown\":{\"pcb\":1.2,\"smt\":0.8,\"assembly\":1.5,\"test\":0.3}},{\"code\":\"CN\",\"cost_breakdown\":{\"pcb\":1.1,\"smt\":0.9,\"assembly\":1.4,\"test\":0.35}}],\"target\":{\"quantity\":10000}}' `
  http://localhost:3007/api/projects/ai/cleansheet-analyze

# 我的日報(dry_run 預覽)
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"period\":\"daily\",\"dry_run\":true}' `
  http://localhost:3007/api/projects/ai/daily-report/run
```

### F. 三段 scrub 鍊路

| 服務 | scrub 點 |
|---|---|
| pricing-suggest | confidential mask → plugin scrub → LLM 看 placeholder → unscrub 回 user 視角 |
| cleansheet-analyze | 不涉及機密 raw(cost 數字 user 自己輸入)|
| daily-report | StatusSummary 已經走 §10.6 → markdown 內金額不會洩 |

---

## ⭐ Phase 2 Sprint L — AI 戰情 embed(2026-05-18 ship)

對齊 spec §10.5。不重做 BI,沿用 Cortex 既有 AI 戰情。

### A. WarRoom 新分頁

1. 進任一專案 WarRoom
2. tab 切到「**📊 BI 戰情**」(第 5 個 tab)
3. 看到分割 layout:
   - 左欄 280px:Cortex BI 設計清單 + 搜尋 + 「只看本案 BU」filter
   - 右欄:iframe embed 已選設計

### B. 設計選擇 + 即時 embed

1. 左欄列出 user 可看的全部 design(`GET /api/dashboard/topics`,沿用 Cortex 既有 ACL)
2. filter「只看本案 BU」開啟 → 只剩 `design.bu_id === project.bu_id` 的
3. 點任一設計 → 右欄 iframe 載入 `/dashboard?design=N&project_id=M&embed=1`
4. **`embed=1` 模式**:AiDashboardPage 自動隱藏左側 sidebar(專案頁已有導覽)
5. iframe 內顯示對應 design 的 query / chart / 結果表

### C. 「在新分頁打開」

- 右上「新分頁打開」link → `/dashboard?design=N&project_id=M`(無 embed)
- 跳到完整 AI 戰情頁面,可做更多操作(改 query / 建 saved query / 看歷史)

### D. 機密欄位繼承 confidentialityMiddleware(spec §10.5.2)

- 不另寫 BI 機密處理
- AI 戰情 query 出來的結果若含機密欄位 → 走平台 `confidentialityMiddleware`
- user 視角為 OUTSIDER 時 → BI 中的金額自動顯 Tier-?

### E. iframe 安全(spec §10.5.2)

- **同源**:`/dashboard` 跟 `/projects-platform` 在同一 origin → 沿用 cookie auth
- **不設 sandbox**:user 既有權限自動帶入,Cortex 既有 auth 流程不變
- (Future)CSP:Phase 2C 可考慮加 `Content-Security-Policy` header 增強

### F. 不需後端 migration

- 不動 Cortex 既有 `/api/dashboard/*` 路由
- iframe 加 `?design=&project_id=&embed=1` URL params
- AiDashboardPage 加 `searchParams.get('embed') === '1'` 判斷,hide sidebar
- 後續可在後端 `/api/dashboard/topics` 加 `?bu_id=` filter(Phase 2C)

---

## ⭐ Phase 2 Sprint K — 域內通訊(2026-05-18 ship)

對齊 spec §10.4 / §13.5。跨專案 group + 跨組織 1:1 DM,與專案 channel 獨立。

### A. 入口 + 建 Group

1. sidebar 點「💌 訊息 · 域內」進 `/projects-platform/messages`
2. 看到分割 layout:左欄 room 列表 / 右欄 chat
3. 點右上「+ 新 Group」開 modal
4. 輸:
   - Group name(例「BU1-業務週會」)
   - 描述(可空)
   - BU ID:空 = 全公司可看 / 填 1 = BU 1 限定
   - 機密 checkbox(Phase 2 enforcement 未啟用)
5. 點「建立」→ 自動成 owner + 跳到該 room

### B. 建 DM(跨專案 1:1 私訊)

1. 點「+ 新 DM」→ user LOV 搜尋(同 RoleGrants modal)
2. 選一個 user → 自動 findOrCreateDm(已存在不重建)
3. 跳到 DM room,room 名稱「DM · user#N」
4. spec §10.4.4:**DM 永不寫 KB**(私聊隱私)

### C. 即時推送(WebSocket)

兩個瀏覽器:
1. user A 進 `/projects-platform/messages` 點某 group
2. user B 進同 group
3. user A 發訊息 → user B 不到 1 秒看到(`comm_new_message` socket event)
4. room header 右側「🟢 即時」綠點表示 socket 已連

### D. ACL 規則(spec §10.4.6)

`commRoomService.canAccess` 邏輯:

| Room 類型 | 誰可看 |
|---|---|
| `org_dm` | 只 dm_user_a_id / dm_user_b_id + admin |
| `org_group · bu_id=NULL`(global)| 全 user |
| `org_group · bu_id=N` | 該 BU 成員(`user_organization_memberships`)/ admin / project.bu_director(scope_values 含 N)/ project.bu_super(scope 含 N)/ project.top_director / project.hq_super |

未授權 → API 回 403,UI 看不到 room。

### E. Sidebar 未讀紅點(unread count)

`comm_room_participants.last_read_at` 對比 `comm_room_messages.created_at`:
- 列表項目右上紅點 + 數字(<99 顯示數字 / >99 顯示「99+」)
- 點 room → 自動 `POST /:roomId/read`(更新 last_read_at)
- 紅點消失

### F. API 試打

```bash
# 列我的 rooms
curl.exe -s -H "Authorization: Bearer $TOKEN" `
  http://localhost:3007/api/projects/comm-rooms

# 建 group
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"name\":\"BU1 業務週會\",\"bu_id\":1}' `
  http://localhost:3007/api/projects/comm-rooms/groups

# 開 DM
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"target_user_id\":3}' `
  http://localhost:3007/api/projects/comm-rooms/dm

# 發訊息
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"content\":\"hello\"}' `
  http://localhost:3007/api/projects/comm-rooms/15/messages
```

### G. Migration 010 確認

server restart:
```
[projects-platform]/migrations/010 created table COMMUNICATION_ROOMS
[projects-platform]/migrations/010 created table COMM_ROOM_PARTICIPANTS
[projects-platform]/migrations/010 created table COMM_ROOM_MESSAGES
[projects-platform]/migrations/010 created index idx_comm_room_type (×N)
```

### H. 與專案 channel 的關係(spec §10.4.3)

| 維度 | 專案 channel(P1)| 跨組織 group(P2 · Sprint K)| 跨組織 DM(P2 · Sprint K)|
|---|---|---|---|
| 範圍 | 某 project 下 | BU / 全公司常駐 | 任意兩 user |
| 與專案綁定 | ✅ 跟 lifecycle 走 | ❌ 常駐 | ❌ 常駐 |
| SLA banner | ✅ | ❌ | ❌ |
| 寫進 KB | per-channel | group 預設不寫(Phase 2C 補可選)| **永不寫** |
| 訊息 retention | 永久 | 永久 | 永久 |

兩套 schema 解耦,但 UI 一致性高(同類聊天 component / socket 即時 push)。

---

## ⭐ Phase 2 Sprint J — KB Sediment production(2026-05-18 ship)

對齊 spec §7-8。`project_kb_chunks` 加 VECTOR(768)+ title_embedding + Oracle Text + audit trail + hybrid search。

### A. 結案 fork production

1. 進機密案 WarRoom,確認有些 chat 訊息(會寫 live chunk)
2. 觸發結案:lifecycle dropdown → 結案 → 輸 reason
3. server console 看:
   ```
   [kbPipeline] fork to sediment: project 3
   [kbPipeline] sediment fork done: project 3 · N chunks copied · M scrubbed · XXXms
   [kbPipeline] sediment auto-embed: project=3 embedded=N/N
   ```
4. KB 頁,輸 project_id=3 + 點「審計」→ 看 fork / embed 兩筆 audit:
   - `fork` · chunks N/N · scrubbed M · duration XXXms
   - `embed` · embed_model=gemini-embedding-001 · N chunks
5. 切到「沉澱 KB」搜「A001」→ 看到 scrub 後的 chunk
6. 每筆結果右側顯示 **signal badge**(vector / fulltext / hybrid / like)+ score + embedding model

### B. Hybrid search 模式切換

KB 頁右上的「mode」下拉:
- `auto (hybrid)` — 預設,vector + Oracle Text RRF 融合
- `vector only` — 強制 vector cosine
- `fulltext` — 強制 Oracle Text CONTAINS
- `like` — LIKE 退化模式(無 embedding 也能跑)

實測:同樣 query 切不同 mode,看 hit rate 差異:
- vector 對「給車用客戶過去策略」這種模糊問題召回好
- fulltext 對「BOM RD78」這種專有名詞召回精準
- hybrid 兩個訊號 RRF 融合,通常最好

### C. 手動重 fork(admin)

KB 頁右上「重 fork」按鈕(admin only):
1. 輸入 project_id(已結案的)
2. 點重 fork → confirm
3. server 端會刪舊沉澱 + 重新 scrub + 重新算 embedding
4. audit 多一筆 `re_fork`

API:
```bash
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"force\":true,\"notes\":\"重 scrub 試新 plugin\"}' `
  http://localhost:3007/api/projects/kb/fork/3
```

### D. Task DONE 自動寫 KB

Sprint J 補:任意 task `PATCH status=DONE` 會自動寫 live chunk(kind='task')

1. 進 WarRoom 任務看板,把一個 task 拖到 DONE
2. 後台 console 看 `[kbPipeline] writeLiveChunk` + 自動算 embedding 那行
3. 開 KB 搜該 task title → 立即查到

### E. 嚴格 audit trail(spec §7.14 不可逆)

`project_kb_sediment_audit` 表記錄每次 fork / re_fork / embed / error:
- actor_user_id(誰觸發)
- chunks_total / chunks_copied / chunks_scrubbed
- scrub_map_json(每個被替的 raw → placeholder 對應)
- duration_ms
- error_log

API:
```bash
curl.exe -s -H "Authorization: Bearer $TOKEN" `
  http://localhost:3007/api/projects/kb/audit/3
```

### F. Embedding 模型 + 算法

- 預設 `gemini-embedding-001` · 768 dim · Vertex global
- env override:`PROJECTS_KB_EMBED_MODEL` / `PROJECTS_KB_EMBED_DIMS`
- Auto-embed 開關:`PROJECTS_KB_AUTO_EMBED=false` 關背景算(走純 LIKE)
- 失敗 graceful:無 embedding 的 chunk 仍可用 Oracle Text / LIKE 召回

### G. Migration 009 確認

restart server 後 console:
```
[projects-platform]/migrations/009 added column PROJECT_KB_CHUNKS.TITLE
[projects-platform]/migrations/009 added column PROJECT_KB_CHUNKS.EMBEDDING
[projects-platform]/migrations/009 added column PROJECT_KB_CHUNKS.TITLE_EMBEDDING
[projects-platform]/migrations/009 added column PROJECT_KB_CHUNKS.EMBEDDING_MODEL
[projects-platform]/migrations/009 added column PROJECT_KB_CHUNKS.EMBEDDED_AT
[projects-platform]/migrations/009 added column PROJECT_KB_CHUNKS.SCRUB_MAP_JSON
[projects-platform]/migrations/009 created table PROJECT_KB_SEDIMENT_AUDIT
[projects-platform]/migrations/009 created index pkb_chunks_vidx
[projects-platform]/migrations/009 created index pkb_chunks_titlevidx
[projects-platform]/migrations/009 created index pkb_chunks_ftx
```

若 vector / oracle text 索引建立失敗(老 Oracle 版本):graceful skip,系統仍可運作(走 LIKE)

---

## ⭐ Phase 2 Sprint I — Bot 整合(2026-05-18 ship · Phase 1 MVP)

對齊 spec §12。Bot 4 類能力第 1+3 級先上(問答 + 內容生成),第 2 級 read-only tool / 第 4 級 write action 待 Phase 2 補。

### A. @bot 在任意 channel(Surface 1)

1. 進 WarRoom #engineering channel
2. 訊息框輸入 `@bot 這個料號去年給其他客戶報過嗎?`
3. 訊息框紫色 banner 跳出:「🤖 @bot 模式 · 回覆型態:AI_INSIGHT · 走兩段 scrub」
4. 送出按鈕變紫色「問 Bot」
5. 點送出:
   - 先把 user 的 @bot 訊息 post 到 channel(NORMAL 紀錄)
   - 立刻變灰色「Bot 跑中…」+ thinking indicator「AI Bot 思考中 · 機密欄位已 scrub · Gemini Flash 處理中」
6. 約 3-10 秒後 channel 多一條 **AI_INSIGHT 訊息**(紫色語言):
   - `🤖 **AI Bot**`
   - 「(LLM 答覆內容)」
   - `_由 Gemini Flash 回覆_`
7. AI_INSIGHT 自動同步到 #announcement(spec §13.6)

### B. 兩段 Scrub 驗證(spec §12.4)

**前置**:`PROJECTS_PLATFORM_USE_LLM=true` + 機密案 3(`is_confidential=1`)

1. 用機密案開 WarRoom
2. `@bot 這個案的金額和客戶名是?`
3. **Bot 拒答 raw 值**,回答「該欄位機密,僅顯示策略後版本」
4. server log 看 scrub 過程:
   - INPUT:`question` 經 `_buildScrubMap` 把 Apple → [CUST_01]、Tier-A → [PRICE_01]
   - LLM 拿到的是 placeholder 不是 raw
   - OUTPUT:Bot 回應的 [CUST_01] 再 unscrub 回 user 視角

### C. Stub 模式(無 LLM 也可 demo)

`PROJECTS_PLATFORM_USE_LLM=false`(預設)→ Bot 回 stub message:
```
📌 Stub 模式回應
已收到問題:「…」
已撈到上下文:
- 最近頻道訊息 N 筆
- KB 相關 chunks M 筆
設 PROJECTS_PLATFORM_USE_LLM=true 後 Bot 會真的用 Gemini Flash 回答
```

### D. API 試打

```bash
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"question\":\"這個料號去年有報過嗎?\"}' `
  http://localhost:3007/api/projects/projects/3/channels/15/bot
```

回傳:
```json
{
  "message_id": 123,
  "announcement_msg_id": 124,
  "content": "(unscrub 後的 Bot 回答)",
  "llm_used": true,
  "fallback_reason": null,
  "context": { "messages_count": 12, "kb_chunks_count": 5 },
  "scrub_keys_count": 2
}
```

### E. 限制(Phase 1 MVP 已知)

- ✅ Tier 1 問答(RAG over project_kb_chunks + 最近 channel 訊息)
- ✅ Tier 3 內容生成(回應就是 draft,user 自己決定 Pin / 改 form)
- ⏳ Tier 2 read-only tool(ERP procedure / MCP) — 待接 Cortex skill registry
- ⏳ Tier 4 write action(改 form / 建任務 / 推進 stage) — 待白名單 + 二次確認 UI
- ⏳ Multi-turn 對話 context(Bot 不記得上次問題)— Phase 2 加 conversation thread

---

## ⭐ Phase 2 Sprint H — 13 角色身份體系(2026-05-18 ship)

對應 spec §17。13 個預定義 role + admin 手動授予 + super_user 主動 self-join + admin testing mode。

### A. 角色授予 Admin UI

1. admin 登入 → sidebar「**角色授予 13**」(內部 Admin 段)
2. 左欄看 13 個 role 分 6 類(專案 / 工作流 / 資料 / 通知 / 機密 / 管理)
3. 點 `project.bu_director` → 右欄空(尚無人授)
4. 點右上「+ 新增授予」開 modal
5. modal:
   - 搜尋 user(LOV 預設前 30 個)
   - 選一個 user
   - Scope:`GLOBAL` 或 `BU`(role 含 `bu_` 自動推薦 BU)
   - 若 BU:輸 BU ID 列表 e.g. `1,2,3`
   - 過期日(空 = 永久)
   - 理由(audit)
   - 點「授予」
6. 回到列表看新增的 grant + 撤回 / 顯示授予人 / 日期 / scope

### B. super_user self-join(spec §13.3)

**前置**:用 admin UI 授某 user 為 `project.hq_super`(GLOBAL)或 `project.bu_super`(BU + scope_values)

**操作**(以 `project.hq_super` 的 user 為例):

```bash
# 不需要 PM 邀請,直接 self-join 任一 project
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"reason\":\"audit Q3 cost\"}' `
  http://localhost:3007/api/projects/projects/3/super-join
```

回傳 `{ id, via_role: 'project.hq_super' }`

之後該 user 可:
- `GET /projects/3` 不再 403
- 看到 channel(若非機密策略限制)
- 列自己 self-join 的專案:`GET /projects/me/super-projects`

### C. Admin Testing Mode toggle(spec §17.4)

```bash
# 進入 testing 模式(填理由 + 預期分鐘)
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"reason\":\"test BLOCKER notification\",\"duration_minutes\":30}' `
  http://localhost:3007/api/projects/internal-admin/testing-mode/enter

# 查目前是否在 testing
curl.exe -s -H "Authorization: Bearer $TOKEN" `
  http://localhost:3007/api/projects/internal-admin/testing-mode/active

# 退出
curl.exe -s -X POST -H "Authorization: Bearer $TOKEN" `
  http://localhost:3007/api/projects/internal-admin/testing-mode/exit

# 列最近 50 筆 audit
curl.exe -s -H "Authorization: Bearer $TOKEN" `
  http://localhost:3007/api/projects/internal-admin/testing-mode/sessions
```

### D. ACL/Visibility 整合(自動受惠)

- **GA mode**(`PROJECTS_PLATFORM_GA_MODE=true`):有任一 `project.*` role grant 的 user 自動 visible(不再卡 admin/pilot)
- **WarRoom**:`project.bu_director`(scope 含此 bu_id)或 `project.top_director`(GLOBAL)看得到專案
- **notification engine `admin + super_user` target**:自動 union user_role_grants 撈 `admin / bu_super / hq_super`
- **CONF_FIELD_CHG 通知**:現在會真實寄信給 admin + super_user(spec §14.9)

### E. 5 張新表 + 13 seed(migration 008)

restart server 後 console:
```
[projects-platform]/migrations/008 created table USER_ROLE_DEFINITIONS
[projects-platform]/migrations/008 created table ORGANIZATION_UNITS
[projects-platform]/migrations/008 created table USER_ORGANIZATION_MEMBERSHIPS
[projects-platform]/migrations/008 created table USER_ROLE_GRANTS
[projects-platform]/migrations/008 created table PROJECT_SUPER_USERS
[projects-platform]/migrations/008 created table ADMIN_TESTING_SESSIONS
[projects-platform]/migrations/008 seeded role: project.sales
... (13 個 seed)
```

查 seed:
```sql
SELECT role_code, category FROM user_role_definitions ORDER BY category, role_code;
```

---

## ⭐ Phase 1 Polish 新增驗證(2026-05-18 ship)

### AI #1 RFQ 真抽取(取代 mock 預填)

**前置**:`server/.env` 設 `PROJECTS_PLATFORM_USE_LLM=true` + GCP credentials(Vertex 或 Studio 一個有就好)

**操作**:

1. 點「+ 新增專案」開 Wizard
2. **Step 1**:看到上傳區「拖檔到此處或點擊選擇 · PDF/圖檔/.eml · ≤25MB」
3. 拖一個真的 RFQ PDF(或客戶 email .eml)進去
4. 看到 navy 上傳區變橘色 + Loader spinning「解析中… Gemini Vision · 約 5-30 秒」
5. 完成後變綠 + 顯示「AI 解析完成 · 整體信心 87%」
6. 6 欄位自動填入(customer / part_no / quantity / due_date / specs / notes)
7. 每欄位右側顯示 confidence chip:
   - ≥80 綠
   - 60-79 琥珀
   - <60 紅
8. 右側 navy AI panel 顯示:
   - 整體信心度(綠/琥珀/紅)
   - 警示列表(電壓不清 / RoHS 未提 / ...)
   - 未找到的欄位 key
9. 業務直接微調(改 input)後點下一步

**LLM 關閉時(預設)**:
- `PROJECTS_PLATFORM_USE_LLM=false` → backend 回 stub mock
- AI panel 顯「📌 LLM 不可用 · 顯示 stub mock」
- 上傳區綠色但標琥珀小標籤「stub mock」

**API 試打**:

```bash
curl.exe -X POST -H "Authorization: Bearer $TOKEN" `
  -F "file=@C:\path\to\Apple_USB-C_RFQ.pdf" `
  http://localhost:3007/api/projects/wizard/extract-rfq
```

回傳:`{ file_path, original_name, mime_type, size, extracted: { customer, part_no, quantity, due_date, specs, notes, confidence, missing, warnings } }`



### A. WebSocket 即時 chat(看「即時」綠燈在 channel header)

**兩個瀏覽器測試**:

1. **瀏覽器 1**:RICH_LAI 登入 → 進專案 3 WarRoom → 聊天分頁 → channel header 右上看「🟢 即時 · X 案件成員」(socket connected 綠點)
2. **瀏覽器 2**:rich_test 登入 → 同專案同 channel
3. 瀏覽器 1 發訊息「測試即時」→ **瀏覽器 2 不到 1 秒看到訊息**(不用等 5s polling)
4. 互換,瀏覽器 2 發,瀏覽器 1 也即時看到

WarRoom 8-stage ribbon 也即時(PM 推進 stage,所有 WarRoom 在線同步 ribbon)。

### B. Notification 真發送(4 通道接通)

**前置**:`server/.env` 確認 `SMTP_*` + `FROM_ADDRESS`(預設已配 dp-notes.foxlink.com.tw)、`WEBEX_BOT_TOKEN`

**測試**:

1. RICH_LAI 進 WarRoom #engineering channel
2. 選類型「🚨 BLOCKER」發訊息「客戶要縮短交期」
3. 預期:
   - 訊息流多一筆 BLOCKER(紅色語言)
   - 同步到 #announcement(自動)
   - **server console**:`📨 [BLOCKER_NEW] webex_dm → PM + 業務(2 人)` + `email → ...(2 人)` + `in_app_badge → ...(2 人)`
   - **PM + 業務的 Webex DM 真的跳出來**(他們手機 Webex App 收到)
   - **PM + 業務的 email 真的收到**(到 SMTP)
   - **PM + 業務的鈴鐺紅點 1 秒內跳**(socket 推 → 不等 20s poll)
4. 點鈴鐺:看到「🚨 BLOCKER in #engineering」notification → 點 → 跳回 WarRoom

**STAGE_GATE 通知**:

1. PM 推進 Stage 1 → Stage 2
2. server console 看 `📨 [STAGE_GATE] webex_dm → 業務 + 助理(N 人)`
3. 業務 / 助理收到 Webex DM 「✅ Stage RECEIVE_RFQ → Q_AND_A_COLLECT」

**PROJECT_PAUSED 通知**:

1. 切「生命週期 → 暫停」→ 輸入理由
2. 全 project members 鈴鐺紅點 + in_app_badge「⏸ 專案暫停」

### C. Internal Admin /notification-log(查最近 dispatch)

```bash
curl.exe -s -H "Authorization: Bearer $TOKEN" `
  http://localhost:3007/api/projects/internal-admin/notification-log
```

新版回傳每筆 event 有:
- `recipients`:[{user_id, name, email}] 全展開
- `delivery`:{in_app_badge: N, webex_dm: N, email: N}(實際送達數)
- `errors`:[{channel, error}](失敗詳情)

### D. ChatTab 右欄頻道成員(2026-05-18 補)

1. 進聊天分頁 → 切 channel
2. 右欄第二區「👥 頻道成員(N)」顯示 channel 內 user 列表
3. PM 角色橘色 + 「PM」標
4. 業務角色綠色 + 「業務」標
5. hover 看 tooltip 顯示 username + channel role + project role

---

## 已知 demo 限制(Phase 1 後待補)

| 範圍 | 現況 | 待補 |
|------|------|------|
| Form 分頁 | stub | qp_form_* schema(migration 007-010)+ form builder UI |
| AI #1 RFQ PDF 抽取 | Wizard 預填 mock | Gemini Vision 真接 PDF/email 抽欄位 |
| AI #5/#26 | UI 提示「Sprint 後續」 | 接 Gemini Flash + 在對應 channel/task 上跑 |
| Connection inboundResolver | UI 視覺化 | 真實 ERP / SQL 拉值 |
| Notification engine | ✅ 真發送(in_app_badge + webex_dm + email)| webex_group + browser_push 還 stub |
| 結案 fork pipeline | scrub 簡易版 ✓ | LLM 階段判斷哪些 chunk 該洗 |
| AI 預測警示 | A 規則式 ✓ / B+C TBD | Phase 2-3 ML 模型 |

---

## 回到對話模式

點 topbar 左上「**C Cortex**」brand → 回 `/projects-platform` 首頁
或 sidebar 左上 hamburger → 收起 sidebar(M 鍵)
或直接導 `/chat` 回 Cortex 主站
