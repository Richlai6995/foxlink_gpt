# Cortex 通用專案管理平台 · 完整測試劇本

> 對應 commit b41b68a(Phase 1 polish + Sprint H/I/J/K/L/M/N/O/P/Q)
> Seed 腳本:`server/projects-platform/scripts/seed-demo-data.js`
> 預計完整測試時間:**2-3 小時**

---

## 環境前置

### 1. .env 設定

```env
ENABLE_PROJECTS_PLATFORM=true
PROJECTS_PLATFORM_GA_MODE=false
PILOT_USERS=50,52              # 可選:把 sales_mike(50)/ pm_dora(52)加進 pilot
PROJECTS_PLATFORM_USE_LLM=true # 想跑真 LLM 設 true,看 stub 設 false
PROJECTS_DAILY_REPORT_ENABLED=false  # 預設關 daily 自動寄
```

### 2. 跑 seed

```bash
cd server
node projects-platform/scripts/seed-demo-data.js
```

預期:
- 19 個 user(密碼統一 `123456`)
- 5 個 organization_units(2 BG + 3 BU)
- 16 個 role grants
- 8 個 demo projects(ODM × 3 / OEM × 2 / JDM × 1 / IT × 1 / DRAFT × 1)
- 17 條 chat messages(BLOCKER/DECISION 自動 Pin + 同步 announcement)
- 18 個 tasks(部分 DONE 寫 KB chunk)
- 7 個 沉澱 KB cases(歷史結案 · 給 win-rate / pricing 用)
- 3 個 comm rooms(1 global / 1 BU / 1 DM)
- 1 個 pending approval chain(Sony Medical 結案)

### 3. 重啟 server

```bash
cd server
npm run dev
```

確認 console:
```
[projects-platform]/migrations/008-011 ✓
[Route] /api/projects (projects-platform v0.4) OK
[projects-platform] workers started
```

---

## 測試帳號清單(19 個)

| Username | 角色 | role grants | 用途 |
|---|---|---|---|
| `demo_admin` | admin | `admin` | 全功能 / 看 internal admin |
| `amy_bu1_dir` | BU1 主管 | `project.bu_director` (BU 1) | BU 1 跨專案視角 / 結案簽核 |
| `ben_bu2_dir` | BU2 主管 | `project.bu_director` (BU 2) | BU 2 跨專案視角 |
| `tina_top` | 總經理 | `project.top_director` | 全公司視角 |
| `simon_hq` | HQ 經管 | `project.hq_super` | self-join 任一 project |
| `paul_bu1_sup` | BU1 經管 | `project.bu_super` (BU 1) | self-join BU 1 project |
| `sales_mike` | BU1 業務 | `project.sales` | 開 ODM 案 / 看 Mike 負責的案 |
| `sales_lisa` | BU2 業務 | `project.sales` | 開 OEM 案 |
| `pm_dora_dpm` | DPM | `project.pm` | 多 PM 協作 |
| `pm_bob_bpm` | BPM | `project.pm` | (同上) |
| `pm_mary_mpm` | MPM | `project.pm` | Sony Medical PM |
| `pm_eric_epm` | EPM | `project.pm` | Tesla 高壓 PM |
| `workflow_jay` | Workflow Admin | `workflow.admin` | 編 system workflow |
| `data_alex` | 連線管理 | `data.connection_manager` | (Sprint 後續) |
| `notif_kate` | 通知編寫 | `notification.editor` | (Sprint 後續) |
| `conf_steve` | 機密策略 | `confidential.policy_editor` | (Sprint 後續) |
| `user_jenny` | 一般 user | — | 被邀進專案 |
| `user_kevin` | 一般 user | — | 被邀進專案 |
| `guest_helen` | 跨組訪客 | — | demo role 切 CHAT_GUEST 用 |

**密碼:全部 `123456`**

---

## Demo Projects 一覽

| project_code | 客戶 | 模式 | BU | 狀態 | 機密 | 用途 |
|---|---|---|---|---|---|---|
| Q-2026-DEMO-001 | Apple | **ODM** | 1 | ACTIVE | ✓ | 旗艦 demo · 跨 PM + BLOCKER + DECISION 自動 Pin |
| Q-2026-DEMO-002 | Samsung | **ODM** | 1 | ACTIVE | ✓ | 中型 ODM · 既有平台快速套用 |
| Q-2026-DEMO-003 | Garmin | **ODM** | 2 | **PAUSED** | ✗ | 客戶 hold · lifecycle 測試 |
| Q-2026-DEMO-004 | Sony Medical | **OEM** | 2 | ACTIVE | ✓ | 醫療代工 · 結案簽核 pending |
| Q-2026-DEMO-005 | Tesla | **OEM** | 3 | ACTIVE | ✓ | 高金額 · BLOCKER 議價 / DECISION 越南廠 |
| Q-2026-DEMO-006 | BYD | **JDM** | 3 | ACTIVE | ✗ | 雙方共同開發 · IP 共享 |
| IT-2026-DEMO-007 | 內部 IT | IT 維護 | 1 | ACTIVE | ✗ | GENERAL plugin · 非 QUOTE |
| Q-2026-DEMO-008 | Xiaomi | OEM | 1 | **DRAFT** | ✗ | 草稿 · 還沒啟動 |

---

## 報價模板說明(spec 對照)

### ODM (Original Design Manufacturing)
- **客戶提需求 → 我方完整設計 + 製造**
- 客戶貼自己 logo 賣
- **機密度高**(設計 IP 是我方的)
- BOM 我方定 · 利潤高
- 範例:Q-2026-DEMO-001 (Apple AirPods Pro 3)

### OEM (Original Equipment Manufacturing)
- **客戶提供完整設計圖 + BOM → 我方代工**
- 客戶 100% 設計
- 機密度普通(客戶 BOM 我方按圖代工)
- 利潤較低 · 認證費分攤
- 範例:Q-2026-DEMO-004 (Sony Medical) / Q-2026-DEMO-005 (Tesla)

### JDM (Joint Design Manufacturing)
- **雙方共同開發**
- 部分設計 IP 共享(雙方各擁有部分)
- NRE 費用通常雙方分攤
- 範例:Q-2026-DEMO-006 (BYD 充電樁)

---

## 測試劇本

> 9 個劇本,涵蓋 Phase 1-3 全功能。每個劇本標 **登入帳號** + **預期結果**。

---

### 劇本 1 · Wizard 開新案(ODM 模式)

**帳號:** `sales_mike` / `123456`

**步驟:**
1. 登入 → sidebar 點「📁 專案管理」
2. 「+ 新增專案」開 Wizard
3. **Step 1 · RFQ 上傳**:
   - 拖一個 PDF / 圖檔(或留預設 `Apple_USB-C_RFQ.pdf` mock)
   - 若 `PROJECTS_PLATFORM_USE_LLM=true` → 真實 Gemini Vision 抽欄位
   - 若 stub → 顯示「📌 stub mock」標籤
   - 確認 6 欄位:customer / part_no / quantity / due_date / specs / notes
4. **Step 2 · 歷史參考**:
   - AI 推薦 5 個相似案
   - 交期合理性燈號(數量超過歷史平均 → 黃/紅)
   - 推薦 PM:Mike Wang(歷史已處理 Apple)
5. **Step 3 · 機密策略**:勾 amount / margin / cost_breakdown 為 TIER
6. **Step 4 · PM Team**:選 sales(自動帶 Mike)/ 助理 / DPM/BPM/MPM/EPM 三劍客
7. **Step 5 · 流程模板**:套 8 stages
8. **Step 6 · priority_score**:3×3 矩陣選 6(高重 × 高急)
9. **Step 7 · 確認**:點啟動 → 自動跳 WarRoom

**預期:**
- ✅ 自動建 7 channels(announcement / general / qa-customer / engineering / sourcing / factory / cost-review)
- ✅ 自動建 8 stages,Stage 1 ACTIVE
- ✅ 寫 form chunk + attach chunk(若 RFQ 上傳)到 live KB
- ✅ Stage 1 (RECEIVE_RFQ) 自動 SLA 倒數

---

### 劇本 2 · WarRoom 訊息流 + AI #23 自動 Pin + WebSocket

**帳號:** `pm_dora_dpm` + 另一帳號 `sales_mike`(兩瀏覽器)

**步驟:**
1. 兩個瀏覽器分別登入,都進 **Q-2026-DEMO-001 Apple AirPods Pro 3 ODM**
2. 兩邊都到「聊天」tab → 切 #engineering
3. **看連線狀態**:header 右上「🟢 即時」綠燈表 socket 已連
4. Dora 發 NORMAL:「測試訊息」→ Mike 不到 1 秒看到
5. Dora 發 BLOCKER:「客戶要縮短 30%」→
   - 訊息流紅色語言 + 自動同步到 #announcement
   - server console 看 `📨 [BLOCKER_NEW] webex_dm → PM + 業務(2 人)` + email + in_app_badge
   - Mike 鈴鐺紅點 1 秒內跳(socket 推不等 20s poll)
6. Dora 發 NORMAL「**決定**採方案 B 越南廠」(含「決定」字眼):
   - AI #23 自動 Pin · pin_note 顯「⭐ AI #23 · 偵測「決定」」
   - 同步到 #announcement
7. 訊息流頂部切「✨ 智慧」排序:
   - 順序變 Pin(decision)> BLOCKER > DECISION > 我發的 > 時間

**預期:**
- ✅ Socket WebSocket 即時推播跨瀏覽器
- ✅ AI #23 偵測「決定/決議/同意/通過」自動 Pin
- ✅ BLOCKER/DECISION 自動 announcement 同步
- ✅ Notification 4 通道(in_app_badge + webex_dm + email,webex_group/browser_push stub)

---

### 劇本 3 · Stage Gate 業務確認 + lifecycle 切換

**帳號:** `sales_mike`(QUOTE 業務 = HOST)

**步驟:**
1. 進 Q-2026-DEMO-001 WarRoom
2. header 右側看到琥珀「⚖ 業務確認 → 下一 Stage」按鈕(因 Stage 1 RECEIVE_RFQ 是 gate_required)
3. 點 → prompt「確認 RFQ 已收齊?」→ 輸入備註「客戶提供完整規格」→ 確認
4. **預期:**
   - Stage 1 變 DONE 綠色 / Stage 2 自動 ACTIVE
   - #announcement 多一條 SYSTEM「✅ Stage 1 → Stage 2 業務確認」
   - 鈴鐺收 STAGE_GATE 通知
5. **lifecycle dropdown**:右上「生命週期 ▼」
   - 當前 ACTIVE → 看到「PAUSED」和「結案 → CLOSED」選項
6. 試「暫停」→ prompt 輸理由「等客戶反饋」→ 確認
   - **預期:**所有 project members 收到「⏸ 專案暫停」通知

---

### 劇本 4 · Tasks 任務看板 + Gantt + AI #29 拆解

**帳號:** `pm_dora_dpm`

**步驟:**
1. 進 Q-2026-DEMO-001 WarRoom → 「任務看板」tab
2. 看 Kanban 4 個 task(seed 已建):
   - DONE: 客戶來信 RFQ 解析
   - IN_PROGRESS: 結構分析 + FEM 仿真
   - PENDING: BOM 展開 + 三廠對比
   - BLOCKED: EMI 重新評估
3. 切「Kanban ⇄ Gantt」toggle
   - 純 SVG Gantt 圖,Today 虛線,Overdue 紅邊條,Progress overlay
4. 工具列「✨ AI 拆解」紫色按鈕 → 開 modal
5. 輸入「跑越南成本評估」→ AI 拆解 4-5 個 subtask
6. 點批次建立 → 全部進 Kanban
7. 把 "結構分析" task 拖到 DONE
   - **預期:**自動寫 KB chunk(kind='task',Sprint J)

---

### 劇本 5 · 報價 Form + AI 建議 + Cleansheet + What-if

**帳號:** `sales_mike`

**步驟:**
1. 進 Q-2026-DEMO-001 WarRoom → 「報價 Form」tab
2. 看 4 sections(客戶資料 / 規格 / 價格機密 / 其他)+ 版本鏈 v1→v3★→v4 draft
3. **AI 建議**(Sprint M-11):機密欄位旁紫色「✨ AI」按鈕
   - 點 amount 旁的 ✨ → 紫色 modal:建議值 / confidence / reasoning / 引用歷史相似案
   - 點「採用此建議」→ 欄位旁出現「AI ✓」紫色標籤(影子表)
4. **Cleansheet AI 三廠分析**(Sprint M-12):「價格 / 成本」section 右上「Cleansheet AI 分析」黑底按鈕
   - 開 modal · 三廠 cost_breakdown 編輯表(VN/CN/IN 預設值)
   - 修改 PCB / SMT / 組裝 / 測試 cost
   - 點「✨ AI 分析」→ 顯推薦廠 + 排序 + 各項目最低廠 + 分析 markdown + 優勢/風險
5. **What-if 模擬**(Sprint N):同 section 右上紫色「What-if 模擬」按鈕
   - 3 欄 layout(Baseline / Scenario / Projected)
   - 拉 slider:**數量 +10% / 原料 +5% / 匯率 -2%** / 廠區 VN→CN
   - **預期 Projected:**cost 3.80 → 3.97(+4.4%)/ margin 16% → 12.31% / due 21 → 25.4 天
   - 風險顯「交期延長 > 20%」中危
   - 點「✨ AI 解讀」→ Gemini Flash markdown(若 USE_LLM=true)

---

### 劇本 6 · 贏單機率預測(Sprint O)

**帳號:** `sales_mike`

**步驟:**
1. 進 Q-2026-DEMO-001 WarRoom
2. header 右上「贏單機率」紫色按鈕 → 開 modal
3. **預期:**
   - 環形 ring 顯示 win%(由規則式算 base + 沉澱 KB 相似案調整)
   - confidence badge: low (history_sample < 3) / mid (3-10) / high (>10)
   - 案件特徵 grid(customer, part_no, BU win rate, priority, season, task health)
   - 影響因素列表(歷史相似案 .7 / BU .15 / blocker -.10 / Q4 -.03)
   - LLM 解讀 markdown(若 USE_LLM=true)
4. 同樣對 Q-2026-DEMO-005 Tesla 跑:
   - Apple 案因有沉澱 KB 歷史 → confidence > low
   - Tesla 案因沉澱 KB 中 Tesla v1 是 LOSS → win rate 較低

---

### 劇本 7 · 多級簽核(Sprint P)

**Pre-condition:** seed 已建 pending chain on Q-2026-DEMO-004 Sony Medical

**Step A · pm_mary_mpm 確認 chain 存在(自己是申請者):**
1. `pm_mary_mpm` 登入 → 進 Sony Medical WarRoom
2. 此時看不到「申請結案簽核」按鈕(已有 pending chain)
3. (可用 API `GET /api/projects/approvals/by-project/44` 看 chain status PENDING)

**Step B · ben_bu2_dir 收到通知並批准:**
1. `ben_bu2_dir` 登入(BU2 director · seed grant 過)
2. sidebar 點「📝 待批 P3」進 ApprovalsPage
3. **預期:**看到 1 筆 pending(Sony Medical 結案)
4. 標 `lifecycle_close` 琥珀 badge + Sony Medical 連結 + 申請人 Mary
5. 點「批准」→ prompt 備註「OK」→ 提交
6. **預期:**
   - chain status APPROVED
   - 自動呼叫 `projectsService.updateLifecycle(44, CLOSED)`
   - Sony Medical lifecycle 變 CLOSED
   - 觸發 forkToSediment → 沉澱 KB 多一個 case + 對應 chunk fork

**Step C · 驗證沉澱:**
- `demo_admin` 登入 → sidebar「📚 KB / 知識庫」
- 切「沉澱 KB」
- project_id 填 44 + 搜「Sony」→ 看到 Sony Medical 沉澱 chunk

**Step D · 申請新 chain:**
- `pm_dora_dpm` 進 Apple AirPods Pro 3(Q-2026-DEMO-001)WarRoom
- 點「申請結案簽核」琥珀按鈕 → 輸理由 → 送出
- `amy_bu1_dir`(BU1 director)登入 → sidebar「待批」看到 1 筆
- 此次點「拒絕」+ 理由「還有 BLOCKER 未解」
- **預期:**chain REJECTED · project 仍為 ACTIVE · requester(Dora)收到拒絕通知

---

### 劇本 8 · 域內通訊 + AI 戰情 embed

**帳號:** `amy_bu1_dir`(BU1 director)

**Step A · 訊息(Sprint K):**
1. sidebar「💌 訊息 · 域內」
2. **預期:**左欄看到 3 個 rooms:
   - 全公司業務週會(global)
   - BU1 連接器組(BU 1)
   - DM · user#N(Amy ↔ Mike DM)
3. 點 BU1 連接器組 → 發訊息「BU1 本週重點」
4. `sales_mike` 同一房間應該即時收到(socket comm_new_message)
5. unread 紅點 +1

**Step B · BI 戰情 embed(Sprint L):**
1. 進 Q-2026-DEMO-001 Apple WarRoom → 切「📊 BI 戰情」tab
2. **預期:**左欄列 Cortex 既有 AI 戰情設計(若已建)
3. 勾「只看本案 BU」filter
4. 點任一 design → 右欄 iframe 開 `/dashboard?design=N&project_id=41&embed=1`
5. embed=1 自動隱藏 Cortex 內建 sidebar(避免雙重導覽)

---

### 劇本 9 · 跨專案儀表板 + 我的日報 + ML widget C

**帳號:** `tina_top`(總經理 · top_director GLOBAL)

**步驟:**
1. sidebar「📊 跨專案儀表板」
2. 7 widgets:
   - Widget 1 SLA 燈號 / Widget 2 Watchlist(高 priority 自動進)
   - Widget 3 Delay 熱點 / Widget 4 我的任務 / Widget 5 Review queue
   - Widget 6 KPI / Widget 7 成員負載熱圖
3. AI 預測 3 卡(A 規則式 ✅ / B RAG ✅ / C ML ✅)
4. **Sprint Q widget C**:底部紫色 widget「ML 預測模型 widget C」
   - 點「跑批次預測」→ 對所有 ACTIVE project 跑規則式 winRate
   - **預期:**
     - 🚨 高風險(win < 40%):排前(Tesla 因沉澱有 LOSS 歷史)
     - ⭐ 高機率(win ≥ 70%):排後(Apple/Samsung/Garmin)
   - 點任一專案 → 跳該 WarRoom

5. **我的日報**(Sprint M-13):右上琥珀「☀️ 我的日報」
   - 切日報 / 週報
   - 「預覽」:dry_run · 看 markdown(總經理關注 8 個 active 案)
   - 「生成 + 寄出」:
     - 寫 user_notifications · 鈴鐺紅點
     - 寄 email(if user.email + SMTP 已配)

---

## 12 重點 spec 對照表

| spec | Sprint | 測試 |
|---|---|---|
| §5 Workflow template | 1 | 劇本 1 套 QUOTE_DEFAULT 8 stages |
| §7-8 KB 雙層 + scrub | J | 劇本 7 Step C 驗證沉澱 |
| §10.4 域內通訊 | K | 劇本 8 Step A |
| §10.5 AI 戰情 embed | L | 劇本 8 Step B |
| §10.6 機密 displayStrategy | E.2 | 切 demo role (HOST/PARTICIPANT/OBSERVER/OUTSIDER) |
| §12.4 雙段 scrub | I/M | 劇本 5 AI 建議 (Sprint M-11 / pricing-suggest) |
| §12.5 Form Surface 2 影子表 | M | 劇本 5「✨ AI」按鈕 |
| §12.10.4 #12 Cleansheet | M | 劇本 5 三廠分析 |
| §12.10.4 #33 主管日報 | M | 劇本 9「我的日報」 |
| §13.6 announcement sync | C | 劇本 2 BLOCKER/DECISION |
| §13.7 Stage Gate | 1 | 劇本 3 |
| §14.9 Notification 8 規則 | F | 劇本 2 BLOCKER 4 通道 |
| §16.4 預測 A/B/C | F+M+O+Q | 劇本 6 Sprint O · 劇本 9 widget C |
| §16.5 預測 B 層 What-if | N | 劇本 5 |
| §17 13 role | H | 19 帳號各 role grant |

---

## 機密 demo role 切換驗證

`demo_admin` 登入 → topbar 視角 dropdown 切 6 role:

| Demo Role | Q-2026-DEMO-001 Apple(機密案)看得到? | amount 顯示 |
|---|---|---|
| **HOST**(業務本人)| ✅ 完整 | $XX,XXX 真值 |
| **PARTICIPANT**(被邀成員)| ✅ 部分 | `Tier-A`(TIER 策略 mask)|
| **OBSERVER**(主管)| ✅ 完整 | $XX,XXX 真值 |
| **SUPER_PARTICIPANT** | ✅ 完整 | $XX,XXX 真值 |
| **CHAT_GUEST**(跨組訪客)| ⚠ 報價 Form 403 / 只能 chat | N/A |
| **OUTSIDER** | 🚫 整個 403 | N/A |

非機密案(Q-2026-DEMO-003 Garmin)所有 role 都看得到完整資料。

---

## 已知環境問題

| 問題 | 應對 |
|---|---|
| Oracle 23 AI `comment` / `level` 是保留字 | migration 008/011 已 rename(`decision_comment` / `org_level`)|
| Oracle Text 索引 ORA-29861 偶發 FAILED | `ALTER INDEX pkb_chunks_ftx REBUILD` |
| ORA-03108 偶發插 CLOB 失敗 | seed 已加 retry · 重跑 idempotent |
| projects-platform 修改 nodemon 不自動 reload | `package.json` 已加 `--watch projects-platform`(2026-05-18)|

---

## API 試打速查

```bash
# Login
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"username":"demo_admin","password":"123456"}' \
  http://localhost:3007/api/auth/login | jq -r .token)

# Sprint H 13 role definitions
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/projects/internal-admin/roles

# Sprint I bot ask
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"這個料號去年有報過嗎?"}' \
  http://localhost:3007/api/projects/projects/41/channels/<ch_id>/bot

# Sprint J KB hybrid search
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3007/api/projects/kb/search?q=Apple&layer=archived&mode=auto"

# Sprint K comm rooms
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/projects/comm-rooms

# Sprint M pricing suggest
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"project_id":41,"field":"amount"}' \
  http://localhost:3007/api/projects/ai/pricing-suggest

# Sprint N What-if
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"project_id":41,"baseline":{"quantity":500000,"cost_total":3.80,"margin_pct":18,"due_date_days":90,"factory_code":"VN"},"scenario":{"quantity_pct":10,"raw_material_pct":5,"fx_pct":-2,"factory_code":"CN"}}' \
  http://localhost:3007/api/projects/ai/what-if-analyze

# Sprint O win-rate
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"project_id":41}' \
  http://localhost:3007/api/projects/ai/win-rate-predict

# Sprint P pending
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3007/api/projects/approvals/pending

# Sprint Q batch
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"limit":10}' \
  http://localhost:3007/api/projects/ai/win-rate-batch
```

---

## 測試完成 checklist

跑完 9 個劇本後對:

- [ ] 19 個帳號都能登入(密碼 123456)
- [ ] 8 個 demo project 都看得到
- [ ] BLOCKER/DECISION 自動同步 announcement + AI #23 自動 Pin
- [ ] WebSocket 兩瀏覽器即時推播
- [ ] Stage Gate 推進 + lifecycle 切換
- [ ] Tasks Kanban ⇄ Gantt + AI #29 拆解
- [ ] AI #16 Pricing 建議走影子表
- [ ] Cleansheet 三廠分析 + 推薦廠
- [ ] What-if slider 即時算 + AI 解讀
- [ ] 贏單機率環形 ring + 影響因素
- [ ] Approval chain 端對端(create → approve → lifecycle CLOSED → sediment fork)
- [ ] Comm rooms group + DM 即時推
- [ ] BI 戰情 iframe embed + ?embed=1 hide sidebar
- [ ] 跨專案儀表板 7 widgets + widget C 批次預測
- [ ] 我的日報 markdown + 寄 email + 鈴鐺紅點
- [ ] 6 demo role 切換看機密 mask

---

## Reset / 清資料

要重新乾淨測試:

```sql
-- 刪測試 user(會 cascade?)Phase 1 沒寫 cascade,要手動 clean
DELETE FROM user_role_grants WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'demo_%' OR username LIKE 'pm_%' OR username LIKE 'sales_%' OR username LIKE 'amy_%' OR username LIKE 'ben_%' OR username LIKE 'tina_%' OR username LIKE 'simon_%' OR username LIKE 'paul_%' OR username LIKE 'workflow_%' OR username LIKE 'data_%' OR username LIKE 'notif_%' OR username LIKE 'conf_%' OR username LIKE 'user_%' OR username LIKE 'guest_%');
DELETE FROM project_kb_chunks WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%');
DELETE FROM project_kb_chunks WHERE is_sediment = 1 AND title LIKE '%CLOSED%';
DELETE FROM project_messages WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%');
DELETE FROM project_tasks WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%');
DELETE FROM project_approval_steps WHERE chain_id IN (SELECT id FROM project_approval_chains WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%'));
DELETE FROM project_approval_chains WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%');
DELETE FROM channel_participants WHERE channel_id IN (SELECT id FROM project_channels WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%'));
DELETE FROM project_channels WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%');
DELETE FROM project_stages WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%');
DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE project_code LIKE '%-DEMO-%');
DELETE FROM projects WHERE project_code LIKE '%-DEMO-%';

DELETE FROM comm_room_messages WHERE room_id IN (SELECT id FROM communication_rooms WHERE name LIKE '%全公司%' OR name LIKE '%BU1 連接器%' OR room_type='org_dm');
DELETE FROM comm_room_participants WHERE room_id IN (SELECT id FROM communication_rooms WHERE name LIKE '%全公司%' OR name LIKE '%BU1 連接器%' OR room_type='org_dm');
DELETE FROM communication_rooms WHERE name LIKE '%全公司%' OR name LIKE '%BU1 連接器%' OR room_type='org_dm';

DELETE FROM user_organization_memberships WHERE org_unit_id IN (SELECT id FROM organization_units WHERE code LIKE 'BG_%' OR code LIKE 'BU_%');
DELETE FROM organization_units WHERE code IN ('BG_CONSUMER','BU_CONNECTOR','BU_CABLE','BG_AUTO','BU_EV');

DELETE FROM users WHERE username LIKE 'demo_%' OR username LIKE 'pm_%' OR username LIKE 'sales_%' OR username LIKE 'amy_%' OR username LIKE 'ben_%' OR username LIKE 'tina_%' OR username LIKE 'simon_%' OR username LIKE 'paul_%' OR username LIKE 'workflow_%' OR username LIKE 'data_%' OR username LIKE 'notif_%' OR username LIKE 'conf_%' OR username LIKE 'user_%' OR username LIKE 'guest_%';

COMMIT;
```

然後重跑 `node projects-platform/scripts/seed-demo-data.js`。

---

跑完所有劇本 + checklist 表面通過 = **Phase 1-3 端對端可 demo**。
