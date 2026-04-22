# Chat Inline Chart — 規劃書

> Chat 對話內(MCP / 深度研究 / 一般對話)LLM 輸出資料自動渲染為互動圖表
> 作者:規劃於 2026-04-21
> 狀態:**Phase 1–5 實作完成(未驗收)** @ 2026-04-22
>
> 實作進度快照:
> - Phase 1 基礎渲染 → commit `488bb4a`
> - Phase 2 LLM 自動畫 + chartSpecParser + SSE → commit `53bf9a3`
> - Phase 3 使用者控制(local 切換 + reprompt) → commit `29293de`
> - Phase 4 進階圖型 + dataZoom → commit `66fb118`
> - Phase 5 使用者圖庫 + Template Share + admin 採納 → commit `216f395`
> - Phase 5b ChartEditor 4-step wizard(從零設計圖表)+ MyChartsPage 返回鍵 → commit `bf67467`
>
> **尚未做**:測試驗收(見 §9 測試劇本)、push to origin、Phase 4 的 Chart→PPT 匯出、Phase 5c 的 MCP/skill 來源 ChartEditor 支援、PinChartButton source metadata 注入(目前 pin 進來都 freeform)

---

## 1. 背景與需求來源

### 需求
使用者反映:MCP tool 回傳的結構化資料(如 ERP 查詢結果、庫存列表、趨勢數據)目前只能以純文字 / markdown table 呈現,無法視覺化。希望能直接在 chat 訊息中畫成圖表。

### 範圍擴大(對原始需求的補強)

本規劃書刻意把範圍從「MCP-only」擴大到:
1. **所有 tool-calling 結果都受惠**(MCP / ERP procedure / 技能 / 深度研究 / 一般對話)— 詳見 §7.1。
   - **ERP 工具是真正的甜點**,預期日常使用頻率 > MCP。
2. **Phase 5 規劃使用者自建 + 分享圖表**,讓好用的圖從一次性對話沉澱成可重用資產,並當 AI 戰情室的孵化器(使用者常用 → admin 採納為 official)。

### 目前狀況(scan 結果)
| 項目 | 位置 | 現況 |
|------|------|------|
| MCP 結果進 chat | [server/services/mcpClient.js:532-577](../server/services/mcpClient.js#L532) + [server/routes/chat.js:2789-2916](../server/routes/chat.js#L2789) | **純文本單軌**:`resultContent = textParts \|\| JSON.stringify(result)` 直接進 LLM context |
| ChatMessage 結構 | [client/src/types.ts:48-58](../client/src/types.ts#L48) | `content: string` 純 markdown,**無 structured content 欄位** |
| 訊息渲染 | [client/src/components/ChatWindow.tsx:103-184](../client/src/components/ChatWindow.tsx#L103) | 目前只有 MarkdownRenderer + GeneratedFileLinks + ResearchProgressCard |
| Fenced code 慣例 | [server/services/fileGenerator.js:56-96](../server/services/fileGenerator.js#L56) | 已有 ` ```generate_xlsx:filename.xlsx ``` ` pattern(成熟、可複製) |
| 戰情室圖表 | [client/src/components/dashboard/AiChart.tsx](../client/src/components/dashboard/AiChart.tsx) + `ChartBuilder.tsx` | 使用 `echarts-for-react`,props 為 `AiChartDef`(types.ts:438+),**緊耦合 `AiQueryResult`(SQL 結果)** |

---

## 2. 與 AI 戰情室的邊界(為什麼隔開)

**結論:共用 ECharts 底層庫,但元件 / spec schema / 資料流完全獨立。**

### 隔開的理由

| 維度 | AI 戰情室 | Chat Inline Chart |
|------|-----------|-------------------|
| **用途** | Admin 預先設計的長期儀表板 | Ad-hoc、一次性、per-message |
| **資料來源** | SQL query 跑自家 DB(有 schema 契約) | LLM 從 MCP / 研究 / 對話中產的任意 JSON |
| **生命週期** | 存 DB、跨使用者共享、持久化 | 隨 chat message 一起走、一次性 render |
| **設計者** | Admin 手動配 + LLM 輔助生成 SQL | LLM 自動決定要不要畫 + 選圖型 |
| **Spec 格式** | `AiChartDef` 依賴 `x_field` / `y_field` 指向查詢結果欄名 | 需要自帶 inline data 或指向 tool_call_id |
| **互動** | 支援 filter、drill-down、跨 chart 連動 | 先做唯讀靜態 |

### 耦合成本(如果硬要共用)

- `AiChart.tsx` 目前吃 `AiQueryResult` + `AiChartDef`,要做成通用要把資料源抽象化 → 動到戰情室運行時、風險擴散
- `AiChartDef` schema 被 admin 介面綁 → 改欄位會連動 ChartBuilder 表單
- 戰情室的 theme / responsive / tooltip 風格跟 chat 氣泡內容需求不同

### 共享點(僅限底層)

- `echarts` / `echarts-for-react` npm 套件(本來就是 app-level shared dep)
- 未來若需共享 util(顏色 palette、format helper),拉到 `client/src/lib/chartCommon.ts`

### 隔開 ≠ 斷絕 — 單向養分流

雖然運行時完全獨立,但 Phase 5 規劃**「Chat Chart → AI 戰情室」的單向升級管道**(詳見 Phase 5):
- 使用者分享的熱門 chart,admin 可一鍵「採納」為戰情室 official chart
- LLM 當時產的 chart spec + prompt → 轉成戰情室 SQL query 的起點
- 這讓戰情室從「admin 憑空設計」變成「使用者真實需求驅動」,且不必放棄解耦優勢

---

## 3. 整合路線選擇

### 三種方案比較

| 方案 | 描述 | 難度 | UX | 推薦度 |
|------|------|------|-----|-------|
| **A. LLM 自動吐 chart spec** | 仿 `generate_xlsx` 新增 ` ```generate_chart:type ``` ` fenced block | 中 | 零點擊、智能 | ⭐⭐⭐ 主軸 |
| **B. Chat message 右側「畫成圖表」按鈕** | 使用者點按鈕 → 發 re-prompt → LLM 回 chart spec | 低 | 可控、但多一步 | ⭐⭐ 補救 |
| **C. MCP server 回傳時帶 chart_hint** | 擴 MCP 協議 extension field | 低 | 依賴 MCP server 配合 | ✗ 不做 |

### 為何選 A 為主 + B 為補救

**A 的優勢:**
- 零點擊體驗,使用者問完答案就看到圖
- 複用 `generate_xlsx` 的 fenced code block 慣例,parser / frontend pipeline 成熟
- Generic — 不綁 MCP,深度研究、一般對話都能受惠
- LLM 判斷錯時自動 fallback 純文字,無 regression

**B 的定位:**
- A 選錯圖型 / 沒畫時的逃生門
- 實作成本極低(re-prompt + 提示詞塞「請畫成 X 圖」)
- A 通了之後順手加,不用一開始就做

**為何不做 C:**
- 改 MCP 協議 → 破壞協議中立性
- 第三方 MCP server 不會配合 → 只有自家 server 吃得到
- ROI 差,且 A 通了之後 C 變多餘

---

## 4. 系統設計

### 4.1 Fenced Code Block 協議

LLM 在需要畫圖時輸出:

````markdown
```generate_chart:bar
{
  "title": "2026 Q1 各廠區產量",
  "x_field": "site",
  "y_fields": [
    {"field": "output", "name": "產量", "color": "#4f46e5"}
  ],
  "data": [
    {"site": "龜山", "output": 12500},
    {"site": "林口", "output": 9800}
  ]
}
```
````

**支援 type:** `bar` / `line` / `pie` / `scatter` / `area` / `heatmap`(ECharts 全支援,先做 bar/line/pie 三個)

### 4.2 大資料優化:`data_ref` 模式

MCP 回傳 500 rows 時,讓 LLM 重吐一次到 fenced body 太浪費 token。改用 reference:

````markdown
```generate_chart:line
{
  "title": "近 30 天訂單趨勢",
  "x_field": "date",
  "y_fields": [{"field": "count"}],
  "data_ref": {
    "tool_call_id": "call_abc123",
    "path": "$.data.daily"
  }
}
```
````

**Server 端 parser 邏輯:**
1. 若有 `data`,直接用
2. 若有 `data_ref.tool_call_id`,從該 message 的 `tool_calls[].result` 找對應,再用 `jsonpath` 抽 `path`
3. Rows cap:> 1000 點自動 downsample(線性採樣)

### 4.3 資料結構改動

**`client/src/types.ts` 新增:**
```ts
export interface InlineChartSpec {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'heatmap'
  title?: string
  x_field: string
  y_fields: Array<{ field: string; name?: string; color?: string }>
  data?: Record<string, any>[]
  data_ref?: { tool_call_id: string; path?: string }
}

export interface ChatMessage {
  // ...既有欄位...
  charts?: InlineChartSpec[]  // 新增
}
```

**DB schema (`chat_messages` 表) 新增:**
```sql
ALTER TABLE chat_messages ADD charts_json CLOB
```
對應 `runMigrations()` 加 column existence check,照既有慣例。

### 4.4 後端 Parser

**新檔** `server/services/chartSpecParser.js`:
- `parseChartBlocks(text, toolCallResults)` → 回傳 `{ strippedText, charts: InlineChartSpec[] }`
- Tolerant JSON parse:失敗時保留 fenced block 當 code 原樣顯示,不炸整個 message
- Rows cap / downsample
- 資料量驗證(欄位存在、型別正確)

**整合點:** [chat.js](../server/routes/chat.js) SSE stream 完成時,在 `fileGenerator.processGeneratedFiles` 之後呼叫 `parseChartBlocks`,把 charts 存 DB + SSE 推 `charts` event。

### 4.5 前端渲染

**新檔** `client/src/components/chat/InlineChart.tsx`:
- Import `echarts-for-react`(不從 `dashboard/AiChart.tsx` fork)
- Props: `spec: InlineChartSpec`
- 錯誤邊界:spec 壞 → render 「⚠ 圖表資料異常」+ 原始 JSON 可展開
- Responsive:`width: 100%`, `height: 320px`(chat bubble 內標準尺寸)
- 工具列:右上角下載 PNG(ECharts `getDataURL`)

**改 `ChatWindow.tsx`:**
在 [line 103-184](../client/src/components/ChatWindow.tsx#L103) 訊息 bubble 加條件分支:
```tsx
{msg.charts?.map((chart, i) => <InlineChart key={i} spec={chart} />)}
```
插在 `MarkdownRenderer` 之後、`GeneratedFileLinks` 之前。

### 4.6 System Prompt 教學

`server/config/systemPrompts.js`(或目前存 prompt 的位置)加 section:

```
## 圖表視覺化

當你的回答包含可視化的數值資料(時間序列、分類比較、比例分布),
請在回答後使用以下格式生成圖表:

<fenced code block 範例 + 選圖型原則>

注意:
- 只在資料量 3~100 rows 時畫圖(太少沒意義、太多改用表格)
- 時間序列選 line,分類比較選 bar,比例選 pie
- 如果資料來自 tool call,優先用 data_ref 指向結果,不要複製 rows
```

---

## 5. 分階段實作計畫

### Phase 1 — 基礎渲染(獨立可 ship)✅
- [x] `types.ts` 加 `InlineChartSpec` + `ChatMessage.charts`
- [x] `InlineChart.tsx` 元件(bar/line/pie + DEMO_SPECS 可視覺驗證)
- [x] `ChatWindow.tsx` 條件 render(MarkdownRenderer 後、GeneratedFileLinks 前)
- [x] DB migration: `chat_messages.charts_json` CLOB
- [x] 無後端、無 LLM 接線

### Phase 2 — LLM 自動畫 ✅
- [x] `chartSpecParser.js`:tolerant JSON、DATA_ROW_HARDMAX=2000、SOFTCAP=200 線性 downsample、data_ref + 簡化 JSONPath(`$`, `.a`, `[0]`, `[*]`)
- [x] Chat SSE 流程:toolHandler wrap 收集 toolCallResults → `parseChartBlocks(text, toolCallResults)` → SSE `charts` event → 存 `charts_json` CLOB → GET messages 還原
- [x] `chartInstruction` 注入 4 條路徑(dify / kb / tools / standard)的 systemInstruction
- [x] 6 個 unit test 覆蓋 basic / tolerant / data_ref / invalid / downsample / strip

### Phase 3 — 使用者控制(補救路徑)✅
- [x] InlineChart hover 加 4 圖型切換 icon(bar/line/area/pie),local state,不重打 LLM
- [x] ChatWindow assistant message hover 加「畫成圖表」dropdown(3 選)— 只在無現成 chart + 內容含結構化資料 pattern(table / 數字 / 百分比)時顯示
- [x] `onDrawChart` callback → ChatPage 組 reprompt 打 LLM 重畫

### Phase 4 — 進階 ✅(除 PPT 匯出)
- [x] scatter(自動偵測 xAxis 數值 / 類別)
- [x] heatmap(3 維:x × y_fields[0]=group × y_fields[1]=value,漸層 visualMap)
- [x] radar(indicator 從 x_field,多系列,max 自動算 × 1.1)
- [x] dataZoom — rows > 30 自動掛 inside + slider(滾輪/拖曳)
- [ ] **未做**:Chart → PPT 匯出(跟 `generate_pptx` 整合)— 留後續
- [ ] **未做**:ECharts aria 模式 — 低優先,暫不做

### Phase 5 — 使用者自建圖表 + 分享

> **定位**:有工具存取權的 user 把 chat 內好用的圖表**收藏成「我的圖庫」**,並可**分享給特定使用者 / 部門 / 全員**。本質是「使用者生成的輕量儀表板」,讓散落在對話中的洞察能重複利用 + 傳播。

#### 與 AI 戰情室的關係(重要)

```
┌────────────┐   LLM 自動畫   ┌─────────────┐   使用者「釘選」  ┌────────────┐
│  Chat      │ ─────────────▶ │  Chat       │ ──────────────▶ │  我的圖庫   │
│  tool 結果 │                │  Inline     │                 │  (user)    │
└────────────┘                │  Chart      │                 └─────┬──────┘
                              └─────────────┘                       │ 分享
                                                                    ▼
                                                             ┌────────────┐
                                                             │  團隊/全員 │
                                                             │  共享圖庫  │
                                                             └─────┬──────┘
                                                                   │ Admin 採納
                                                                   ▼
                                                             ┌────────────┐
                                                             │ AI 戰情室  │
                                                             │(official) │
                                                             └────────────┘
```

**Chat Inline Chart = AI 戰情室的孵化器**:
- 使用者日常對話中發現「這張圖很有用」→ 釘選到圖庫 → 分享
- Admin 定期 review 熱門分享圖 → 採納成戰情室 official chart(LLM 產的 chart spec + prompt 當 SQL 起點)
- 這建立了「自下而上的儀表板需求收集管道」,比 admin 憑空設計更貼近真實需求

#### 核心設計原則:**Template Share(分享設計,不分享資料)**

> 圖表最貴的成本是「設計」(怎麼選圖型、對哪個 tool、欄位怎麼 map),不是資料本身。分享 template + 被分享者用自己權限跑 tool 取資料,資安問題自動交給 tool 層 RBAC 處理,無需另建快照 / 代打機制。

#### 核心功能 ✅

- [x] **釘選 / 收藏**:`PinChartButton.tsx` → `POST /api/user-charts`;存 user_charts 表
- [x] **Tool-bound 檢查**:`source_tool=NULL` 的 freeform chart 在 server + client 雙端禁止分享(`/:id/shares` POST 會 400)
- [x] **圖庫頁**:`/my-charts` 上線,兩 tab(我的 / 別人分享給我的),expand 跑 param form + render
- [x] **參數化**:`ChartParamForm.tsx` 支援 5 型(text/number/date/select/boolean),`source_params` CLOB 存 template
- [x] **打開時執行**:`POST /api/user-charts/:id/execute` 走 `chartExecutor.runSourceTool` 用**被分享者自己的 user context** 呼叫 `erpToolExecutor.execute` / `mcpClient.callTool`
- [x] **Schema 變動偵測**:`computeSchemaHash(rows[0].keys.sorted)` sha256 前 16 字,不符時 warning 推給 client
- [x] **分享**:直接 import `dashboard/ShareModal.tsx`(原生支援 `sharesUrl` prop),zero 新輪子
- [x] **Admin 採納**:`ChartAdoptionPanel.tsx` + `/api/user-charts/admin/popular` + `/api/user-charts/admin/:id/adopt`;**第一版需 admin 手填 SQL**(tool ↔ SQL 路徑差異 Phase 5b 才做 LLM 輔助)

**Phase 5 留給 5b 的小尾巴**:
- `PinChartButton.pinSource` prop 預留但 ChatPage 還沒注入元資料 → 目前存進去一律 `source_type=chat_freeform, source_tool=NULL`(不可分享);需要在 ChatPage 把 toolCallResults 對照到 spec 再 inject
- `source_type=skill` 分支在 `chartExecutor.runSourceTool` 回「暫不支援」
- `source_prompt` 目前未實際使用(原本設計是 fallback 用 LLM 重生 data,但現在走 tool 直接跑)

#### 既有元件複用(關鍵:不發明新輪子)

| 層 | 直接複用 | 位置 |
|----|---------|------|
| 分享選擇 UI | `ShareGranteePicker` | [client/src/components/common/ShareGranteePicker.tsx](../client/src/components/common/ShareGranteePicker.tsx) |
| 分享 Modal | 仿 `dashboard/ShareModal.tsx` 結構 | [client/src/components/dashboard/ShareModal.tsx](../client/src/components/dashboard/ShareModal.tsx) |
| Shares schema 標準 | 對齊 `ai_dashboard_shares` 欄位簽名 | [server/database-oracle.js:1133](../server/database-oracle.js#L1133) |
| 權限檢查 pattern | 仿 `canAccessDesign` / `canAccessProject` | [server/routes/dashboard.js:33-95](../server/routes/dashboard.js#L33) |
| share_type 值 | `'use'` / `'manage'`(不發明 'view'/'edit') | 既有標準 |

**新增只有**:`user_charts` 表 + `user_chart_shares` 表(schema 對齊既有 `*_shares`)+ `canAccessUserChart` util(對齊既有 `canAccessX` pattern)。

#### DB Schema(對齊既有標準 — 刪除 snapshot 欄位、分享表完全照抄 `ai_dashboard_shares`)

```sql
-- 主表:儲存設計模板(零資料)
CREATE TABLE user_charts (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id NUMBER NOT NULL,              -- FK users
  title VARCHAR2(255) NOT NULL,
  description CLOB,
  chart_spec CLOB NOT NULL,              -- InlineChartSpec JSON(已參數化)
  source_type VARCHAR2(32),              -- 'mcp' / 'erp' / 'skill' / 'research' / 'chat_freeform'
  source_tool VARCHAR2(255),             -- 'erp:getStockByFactory' / 'mcp:warehouse:get_inv';freeform=NULL(不可分享)
  source_tool_version VARCHAR2(64),      -- tool 自身版本(若有)
  source_schema_hash VARCHAR2(64),       -- 執行時欄位 signature hash,偵測 schema 漂移
  source_prompt CLOB,                    -- 重建 data 用的 prompt(含 ${param} 佔位)
  source_params CLOB,                    -- 參數 template JSON(類型 / 預設值 / 選項)
  created_at TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 分享表:欄位 signature 完全對齊 ai_dashboard_shares(server/database-oracle.js:1133)
CREATE TABLE user_chart_shares (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chart_id NUMBER NOT NULL,              -- FK user_charts
  share_type VARCHAR2(16),               -- 'use' | 'manage'(不自創 'view'/'edit')
  grantee_type VARCHAR2(32),             -- 'user'|'role'|'factory'|'department'|'cost_center'|'division'|'org_group'
  grantee_id NUMBER,                     -- 依 grantee_type 解釋(public 留未來擴充)
  granted_by NUMBER,                     -- FK users
  created_at TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

> **砍掉的舊欄位**:`snapshot_mode` / `snapshot_data` / 自創的 `target_id` / `permission='view'|'edit'|'reshare'` — 都是 Template Share 模型不需要的。

#### 權限模型:Template Share(取代快照 / 代打之爭)

> **分享的是設計模板(spec + tool ref + params),絕不含資料。被分享者用自己權限跑 tool,資安全權交給既有 tool 層 RBAC。**

| 情境 | 行為 |
|------|------|
| B 有分享 chart 的 `use` 權限 **且** 有 `source_tool` 的執行權 | ✅ 正常跑 → 取自己權限範圍的資料 → 畫圖 |
| B 有 `use` 權限但無 tool 執行權 | ⚠ 顯示「你沒有 `X` 的使用權,請聯絡 admin 申請」(不 render 圖) |
| B 無 `use` 權限 | ✗ 拒開(即看不到模板本身) |
| Tool schema 已變(hash 不符) | ⚠ 顯示「資料來源欄位已變更」+ 標記需 owner 重新設計 |
| A 分享的是 **freeform chart**(無 `source_tool`) | ✗ 分享功能在 UI 就被 disable,只能私人收藏 |

**權限檢查函式**:新增 `canAccessUserChart(db, chart, user, shareType='any')`,**邏輯照抄** [canAccessDesign](../server/routes/dashboard.js#L33) — admin > owner > public + approved(若未來開 public)> 查 `user_chart_shares` 表(7 維度 grantee_type)。

#### 其他細節

- **敏感資料二次檢查**:釘選分享前掃 `source_params` 的 default value(e.g. 員編、料號)— hit sensitive keyword → 強制清空 default,B 要自己填
- **內容政策審核**:熱門分享圖可走 admin review queue(類似 feedback 平台的工單流程)
- **使用率遙測**:分享圖的打開次數 / 執行失敗次數(含 tool 無權 / schema 變動),給 admin 做採納決策參考
- **i18n**:圖表 title / description 三語言翻譯(複用既有 `*_translations` 表模式)

---

## 6. 雷區與開放問題

### 雷區

1. **Context 污染** — 若不做 `data_ref`,LLM 可能複述整張 MCP 結果到 fenced body,token 費翻倍。**Phase 2 必做 `data_ref`,不要 Phase 4 補**。
2. **LLM 亂畫** — Gemini 3 可能對「2 rows 資料畫 pie」這種 case 照畫。system prompt 明確給 threshold(3 ≤ rows ≤ 100)。
3. **JSON parse 失敗** — LLM 吐錯括號 / 多餘逗號很常見。parser **一定要 tolerant**,失敗 fallback 成 code block 原樣顯示,不要讓整個 message 顯示失敗。
4. **敏感資料 leak** — MCP 可能回個人資料 / 機密數字,畫成圖後也會 leak。**要跑一次既有 `audit_logs` sensitive keyword scan**,hit 就不 render 圖,改顯示「⚠ 含敏感資料,已遮蔽」。
5. **ECharts bundle 體積** — 全量 import 約 900KB。若 client bundle 太大,用 `echarts/core` + 按需 register(bar/line/pie 三個 + Canvas renderer)可降到 ~250KB。
6. **DB 重開對話遺失圖** — `chat_messages.charts_json` 必須存,否則重新 load 對話圖會不見。
7. **Token 統計** — `generate_chart` body 會吃 output token,要計入 `token_usage`(跟 `generate_xlsx` 一樣的邏輯)。

### 開放問題(需 user 決策)

| # | 問題 | 影響 | 建議 |
|---|------|------|------|
| Q1 | 範圍:MCP-only 還是 generic(含深度研究、一般對話)? | 決定 parser 呼叫點 | **建議 generic** — 在 chat SSE 統一層 parse,成本相同、效益擴大 |
| Q2 | 圖表是否可編輯(切換圖型、改欄位 mapping)? | Phase 3 範圍 | **建議先做唯讀**,使用者用「重畫」按鈕代替 inline 編輯 |
| Q3 | 是否支援多圖(一個 message 多張圖)? | schema / UI 配置 | **建議支援**,`charts: InlineChartSpec[]` 已是 array |
| Q4 | 敏感資料偵測粒度 | 命中策略 | **建議 message-level 遮蔽**(既有機制),不做 field-level(成本爆) |
| Q5 | 行動裝置體驗 | Phase 1 or 4 | **建議 Phase 1 就做 responsive**,ECharts 內建即可 |
| Q6 | Chart PNG 存 server 還是 client-only? | 儲存成本 vs 分享能力 | **建議 client-only 下載**,存 server 太重 |
| Q7 | **分享內容**:分享什麼? | Phase 5 核心設計 | ✅ **Template Share — 只分享設計(chart_spec + source_tool + params template),絕不含資料**。被分享者用自己 tool 權限執行。快照 / 代打模式皆**不做** |
| Q8 | **Chat chart → AI 戰情室的升級機制**? | 戰情室孵化管道 | ✅ **建議做**:admin 介面加「熱門分享圖」清單,一鍵匯入戰情室(LLM chart spec 當 SQL 起點) |
| Q9 | **參數化支援深度**? | Phase 5 複雜度 | ✅ **Phase 5a 先支援 3 類**:日期範圍 / dropdown / 自由文字;複雜條件(多欄位 and/or)留 Phase 5b |
| Q10 | **收藏 chart 的資料時效預設**? | 儲存成本 vs UX | ✅ **預設「重算」**(每次用被分享者權限跑 tool);5 分鐘 per-user 快取避免連打。不做「快照」(Template Share 下無此概念) |
| Q11 | **分享範圍粒度**? | 權限模型 | ✅ **直接複用既有 `ShareGranteePicker` 元件 + 標準 `*_shares` schema**,7 維度(user / role / factory / department / cost_center / division / org_group)。不發明新結構 |
| Q12 | **Freeform chart(無 tool 來源,純對話貼資料產的)能否分享**? | UI 限制 | ✅ **不可分享,只能私人收藏**。理由:無 tool ref = 無法重執行,分享出去沒意義;若硬要分享即變「分享資料」回到 Q7 的資安陷阱 |

---

## 7. 額外建議(非需求的補強)

### 7.1 擴大到 generic — 適用所有 tool-calling 資料源

**結論:這個功能本質是「LLM 輸出層」的圖表能力,跟資料來自哪個 tool 無關。限制成 MCP-only 等於白白丟掉大半 ROI。**

#### 為什麼統一層就 cover 全部
所有 tool 結果最終都透過 [gemini.js](../server/services/gemini.js) 的 `streamChat` / `generateWithToolsStream` 以 text / JSON 形式進 LLM context。Parser 只要掛在 chat SSE 最後的文字累積點(`done` event 前),對所有 tool 來源**自動生效,零額外 adapter**。

#### 受惠的工具類型

| 工具類型 | 資料形態 | 適合畫圖? | 備註 |
|---------|---------|----------|------|
| **ERP FUNCTION / PROCEDURE** | `{ rows: [...], columns: [...] }` 強 schema | ⭐⭐⭐ **甜點** | 欄位型別明確,LLM 直接 map,誤畫率低 |
| **自家 MCP server** | SQL-like / 結構化 JSON | ⭐⭐⭐ | 可控格式,品質穩定 |
| **第三方 MCP server** | 自由格式(可能混 markdown / text) | ⭐⭐ | 視 server 實作品質 |
| **技能(skills runner)** | 依實作,多半 JSON | ⭐⭐ | 依 skill 設計 |
| **DIFY agent** | 外部回 text / structured | ⭐ | 多半文字,結構少 |
| **KB retrieval** | chunks + metadata | ✗ | 文字為主,不畫 |
| **深度研究 final summary** | LLM 彙整 JSON / markdown | ⭐⭐⭐ | 最終 summary 階段效果最好 |
| **Webex / Gmail** | 訊息 / 郵件 list | ⭐ | 僅「頻率統計」類型可畫 |

#### ERP 是真正的甜點
> **這個功能的使用頻率天花板,比 MCP 還高,而且預計一上線就是主力 use case。**

- ERP procedure 回傳強 schema rows — LLM 不用猜欄位意義
- 常見 use case:「查上週各廠區出貨數」「過去 6 個月 XX 料號走勢」— 用口語問,自動出圖
- `erp-tools-design.md` 的工具化設計(LLM tool-calling + 手動 + Inject)直接對接,**無額外整合成本**

#### 實作層面的一致性影響
- parser 呼叫點:**chat SSE 的 stream 完成回呼**(而非 MCP-specific 層)
- `data_ref.tool_call_id` 設計要 generic —tool_call_id 目前 ERP / MCP / 技能都共用同一命名空間?**若否,Phase 2 要統一**
- System prompt 教學要描述「看到 tabular 資料就評估畫圖」,而不是「看到 MCP 結果」

### 7.2 其他補強

1. **Chart spec 版本欄位** — `InlineChartSpec.version: 1`,未來改 schema 不破壞舊訊息。
2. **Theme token** — 顏色用 CSS var(`--chart-primary` 等),讓 dark mode 自動跟。
3. **Error 遙測** — JSON parse 失敗 / 資料異常要 log 到 audit_logs,之後可以回看 LLM 常吐什麼錯並調 system prompt。
4. **類型安全 shim** — server 端用 Zod / Ajv 驗 chart spec,catch LLM 給錯型別(e.g. y_fields 是 string 而非 array)。
5. **Feature flag** — 加 `system_settings` key `chat_inline_chart_enabled`,出問題可即時關掉不用 rollback。
6. **Chart 之於 K8s** — 純前端渲染,無 server SSR,K8s 部署零影響。唯一注意是 `chat_messages.charts_json` CLOB 大小,避免 LLM 吐 50 張圖塞爆 row。

---

## 8. 附錄:檔案清單(預期改動)

### 新增(Phase 1–2)
- `server/services/chartSpecParser.js`
- `client/src/components/chat/InlineChart.tsx`
- `client/src/lib/chartCommon.ts`(若 Phase 4 需要)

### 新增(Phase 5 — 使用者自建 + 分享)
- `server/routes/userCharts.js` — CRUD + 分享 + 執行 API(仿 `dashboard.js` pattern)
- `server/services/chartAccessControl.js` — `canAccessUserChart` util(**照抄** `canAccessDesign` 邏輯,L33-95)
- `server/services/chartExecutor.js` — 打開時以被分享者權限重跑 tool + schema hash 比對
- `client/src/pages/MyChartsPage.tsx` — 「我的圖庫」頁
- `client/src/components/chat/PinChartButton.tsx` — 釘選 icon + 命名 + tool-bound 檢查(freeform disable)
- `client/src/components/chart/ChartShareModal.tsx` — **仿 `dashboard/ShareModal.tsx`**,內含 `ShareGranteePicker`(不發明新 picker)
- `client/src/components/chart/ChartParamForm.tsx` — 參數化 form(日期 / dropdown / 自由文字)
- `client/src/components/admin/ChartAdoptionPanel.tsx` — admin 熱門分享圖採納介面

### 修改
- `server/database-oracle.js` — runMigrations 加 `charts_json` + Phase 5 的 `user_charts` / `user_chart_shares` 表
- `server/routes/chat.js` — SSE 流程整合 parser
- `server/config/systemPrompts.js`(或等效檔) — 加教學 section
- `client/src/types.ts` — 加 `InlineChartSpec` + `ChatMessage.charts` + `UserChart` / `ChartShare`
- `client/src/components/ChatWindow.tsx` — 條件 render + PinChartButton
- `client/src/i18n/locales/{zh-TW,en,vi}.json` — 錯誤訊息、工具列文字、Phase 5 UI 文字
- `client/src/App.tsx` / router — 加 `/my-charts` 路由
- `server/routes/aiDashboard.js`(或對應檔) — 加「從 chat chart 採納為戰情室 chart」endpoint

### 不動
- `client/src/components/dashboard/AiChart.tsx` ← **刻意不動,維持與戰情室解耦**
- `server/services/mcpClient.js` ← MCP 層保持協議中立,不塞 chart hint
- `client/src/components/common/ShareGranteePicker.tsx` ← **直接 import 複用**,零修改
- 既有 `canAccessDesign` / `canAccessProject` 等 util ← 參考 pattern,但新 util 獨立檔不污染

---

## 9. 測試劇本(驗收用)

> 驗收優先序:**P0 必跑**(核心路徑,壞了功能等於沒做)→ **P1 應跑**(邊界條件 / UX)→ **P2 可省**(進階 / 罕用)
>
> 跑完請在每項劃 ✅ / ❌,❌ 附上 console log 或截圖。

### 環境準備
```bash
# 1. 啟 server + client
cd server && npm run dev
cd client && npm run dev

# 2. 確認 migration 有跑(server 啟動 log 要看到)
#    ALTER TABLE CHAT_MESSAGES ADD CHARTS_JSON CLOB
#    CREATE TABLE USER_CHARTS ...
#    CREATE TABLE USER_CHART_SHARES ...
#    ALTER TABLE AI_SELECT_DESIGNS ADD ADOPTED_FROM_USER_CHART_ID NUMBER

# 3. 登入 ADMIN,開新 chat 對話
```

---

### P0 — Phase 2:LLM 自動畫(最核心,必通)

**T0-1. 直接出圖(data inline)**
- 在 chat 輸入:「請給我 2026 Q1 三個廠的產量對比,龜山 12500、林口 9800、平鎮 14200,畫成 bar chart」
- **預期**:
  - 流完後出現一張 bar chart
  - server log:`[Chart] Parsed 1 inline chart(s)`
  - DevTools Network → SSE stream → 有 `{type:"charts",charts:[...]}` event
  - 回答文字中**不含**` ```generate_chart... ``` ` 區塊(已 strip)
  - 重整頁面(reload session)→ chart 仍在(代表 `charts_json` 有存 + GET 有 hydrate)

**T0-2. tool 結果自動畫**
- 選一個會回表格的 ERP 或 MCP 工具(如 ERP 查過去 6 個月某料號走勢)
- 輸入自然語言「幫我查 XX 的最近趨勢並畫線圖」
- **預期**:
  - LLM 吐 `generate_chart:line` 且 data 正確
  - **若 LLM 用 data_ref**(token 少)也要通 — server log 會印解析成功
  - chart 張數 ≥ 1

**T0-3. Invalid spec 不炸 message**
- 指示 LLM:「畫一張只有 x_field 沒 y_fields 的錯誤圖表」(或直接貼給它一個壞 JSON 示範)
- **預期**:
  - 整個 message 仍正常顯示(fallback 純文字)
  - server log:`[Chart] parse error: 缺 y_fields | preview: ...`
  - 沒有 chart 渲染,但也沒 UI crash

**T0-4. 大資料降採樣**
- 要 LLM 給 500 筆時間序列資料(「給我近 500 天的假訂單數」)
- **預期**:
  - chart 渲染正常(被 downsample 到 200 點)
  - tooltip hover 仍可用
  - 超過 30 點自動有 **底部 zoom slider**(Phase 4)

---

### P0 — Phase 3:切換圖型

**T0-5. Local 切換(不重打)**
- hover chart → 點右上 4 個圖型 icon 之一(bar ↔ line ↔ area ↔ pie)
- **預期**:
  - 圖瞬間切換(<100ms,不 loading)
  - DevTools Network:**沒有**新的 `/api/chat/sessions/...` request
  - 切回原圖型 → icon 取消高亮

**T0-6. Reprompt 重畫(會打 LLM)**
- 對**沒有現成 chart** 但**包含表格或百分比**的 assistant message hover → 出現「畫成圖表」dropdown
- 選「折線圖」
- **預期**:
  - 自動送一個 user message(前綴「請把上一個回答中的數據畫成折線圖...」)
  - LLM 回新訊息,包含 chart
  - 原訊息沒被改

---

### P0 — Phase 5:我的圖庫 + 分享

**T0-7. 釘選**
- chat 中出一張 chart → hover 右上 ⭐ → prompt 輸入 title → 確認
- **預期**:
  - Star icon 變 ✓ + 橘色
  - Network:`POST /api/user-charts` 回 200 + `{id:123}`
  - 進 `/my-charts` → 「我的」tab 看到該筆

**T0-8. Freeform 不可分享**
- 在 `/my-charts`,目前所有 pin 進來的 chart 都是 freeform(因 ChatPage 還沒注入 source metadata — 詳見 §5「Phase 5 留給 5b 的小尾巴」)
- **預期**:
  - card 右側**沒有** Share 按鈕(灰掉)
  - Card 上有「Freeform」tag
  - 手動 curl `POST /api/user-charts/:id/shares` → 應回 400「無 tool 來源的 freeform chart 不可分享」

**T0-9. 刪除**
- 「我的」tab 上某 chart → 點 Trash icon → 確認
- **預期**:Card 消失、DB `user_charts` 少一筆、對應 `user_chart_shares` 也被 CASCADE 刪

---

### P1 — Phase 4:進階圖型

**T1-1. scatter**
- 要 LLM:「畫一張 scatter,x 是員工年資(年),y 是月薪(k),給 10 筆假資料」
- **預期**:點散佈圖、xAxis 自動偵測為 value type

**T1-2. heatmap(3 維)**
- 要 LLM:「畫 heatmap,x 是 5 個廠,y_fields=[{field:'month',...},{field:'output',...}],data 是 5 廠 × 6 個月的產量」
- **預期**:渲染熱力圖、右下 visualMap 漸層藍、splitArea

**T1-3. radar(雷達圖 — 多系列比較)**
- 要 LLM:「畫 radar 比較三個廠在 5 個指標(品質/效率/成本/交期/安全)的表現」
- **預期**:三個多邊形疊加、legend 可切換

**T1-4. dataZoom**
- T0-4 已含此檢查(rows > 30)

---

### P1 — Phase 5 邊界

**T1-5. Schema hash 漂移**(難模擬,可跳過或手動)
- 先 pin 一張 ERP 圖
- 手動把該 ERP tool 的 output columns 改名(`DBA` 要配合 🤷)
- 重開 chart 執行
- **預期**:warnings 區塊出現「資料來源欄位已變更」提示,圖仍能渲染

**T1-6. 被分享者權限不足**
- admin 把一張用 ERP tool 的 chart 分享給 user B(user B 沒那支 ERP 的執行權)
- user B 進 `/my-charts` → expand → 執行
- **預期**:回 400,error 訊息包含 ERP 權限不足字樣(由 erpToolExecutor 層拋)

**T1-7. 不同 grantee_type 7 維分享**
- 測 `user` / `role` / `department` 三種(其他太難造資料可跳)
- 對每種 type POST `/api/user-charts/:id/shares` → reload `/my-charts` (以目標帳號) 看「別人分享給我的」tab 有該 chart

---

### P1 — Admin 採納

**T1-8. 熱門清單**
- Admin → 「使用者圖庫採納」tab
- **預期**:列表顯示所有有 `source_tool` 的 chart,按 `use_count` desc

**T1-9. 採納流程**
- 選一筆 → 點「採納」→ 填主題 / design name / 亂打一段 SQL → 確認
- **預期**:
  - `ai_select_designs` 新增一筆,`adopted_from_user_chart_id=<chart.id>`
  - 列表該筆狀態變「已採納 (#N)」
  - 進 AI 戰情室能看到該 design(但 SQL 要 admin 調對欄位才會跑對)

---

### P1 — ChartEditor 從零設計(Phase 5b 新增)

**T1-10. 進入點 + 返回鍵**
- 從 sidebar 點「我的圖庫」→ 進 `/my-charts`
- **預期**:左上 Cortex logo / 右上「← 返回對話」可點回 chat / 右側「+ 新增圖表」按鈕

**T1-11. ChartEditor wizard — 完整路徑**
- 點「+ 新增圖表」→ Modal 開啟,顯示 4 step bar
- **Step 1**:filter 搜「廠」找 ERP tool → 點 card 高亮 → 「下一步」
- **Step 2**:看到 tool params 自動帶 default → 不改參數 → 點「執行取欄位 →」
  - **預期**:綠色 ✓ 提示「取得 N 筆,M 個欄位:foo, bar, ..."
- **Step 3**:
  - 7 個 type icon 預設 bar,可切到 line / pie / scatter
  - x_field 自動猜為第一個 string 欄
  - y_fields 自動猜為第一個數值欄(綠色色塊)
  - 下方 InlineChart 即時預覽,改 type 即時刷新
  - 點「+ 加一個系列」加 y_fields → 預覽多系列疊圖
- **Step 4**:
  - 標題必填(否則「下一步」灰)
  - 「分享時可由被分享者改」勾選欄,未勾的會顯示「固定: <當下值>」
  - 點「儲存到圖庫 ✓」→ Modal 關 + `/my-charts` 出現新 card

**T1-12. 設計後的 chart 重執行**
- 接 T1-11,在「我的」tab expand 剛存的 chart
- 顯示 ChartParamForm(欄位來自 `source_params` template)
- 改個參數 → 點「執行」→ 渲染圖
- **預期**:
  - 圖正常出
  - DB `user_charts.use_count += 1`
  - 若 schema_hash 跟存的不符,出 warning(此項通常 design 當下就用最新 hash,正常不會 warn)

**T1-13. 設計時 0 筆 / 工具錯誤**
- Step 2 故意填一個會回 0 筆的條件(如不存在的料號)
- **預期**:紅色錯誤「工具回傳 0 筆資料,請檢查參數」,「下一步」灰
- 故意填會 ERP error 的條件 → 紅色顯示 ERP 拋的錯,wizard 不前進

**T1-14. heatmap 提示**
- Step 3 選 heatmap type 但只有 1 個 y_field
- **預期**:橘色提示「heatmap 需要 2 個 y_fields」

---

### P2 — 罕用邊界

**T2-1. tolerant JSON**
- 手動構造帶 trailing comma 的 chart block 給 LLM(例如「請這樣寫:`{...,}`」)
- **預期**:parser 仍收下,server log 不報 error

**T2-2. 多張 chart 在同一 message**
- 要 LLM「一次給 3 張不同 chart 比較」
- **預期**:全部 render,DB `charts_json` 是 array 長度 3

**T2-3. 中文 title / axis label**
- 前面測試自然有涵蓋,若字型錯亂重檢查 `client/src/components/chat/InlineChart.tsx` 的 `CHART_FONT`

**T2-4. PNG 下載**
- chart hover → 右上 Download icon → 取得 PNG
- **預期**:檔名 `<title>.png`、pixelRatio=2(高解析)、背景白色

**T2-5. 重整後 chart 還在 + 切換仍作用**
- T0-1 已測還在;再 hover 試切換圖型是否仍 local
- **預期**:切換正常(state 在元件內,不需 DB 往返)

---

### 已知限制(非 bug,實作取捨)

| 現象 | 原因 | 規劃 |
|------|------|------|
| Pin 下來的 chart 都是 freeform | ChatPage 還沒把 toolCallResults → source metadata 注給 PinChartButton | Phase 5b |
| skill 類來源不能重跑 | chartExecutor 只實作 erp / mcp;skill 要另外處理 user_token 簽 | Phase 5b |
| admin 採納要手填 SQL | tool 路徑 ↔ SQL 路徑的橋接,第一版不做自動 | Phase 5b(LLM 輔助) |
| 只有 LLM 回答時才偵測 chart | 不支援「把既有 message 貼一張 chart 進去」| 設計 by design |
| dataZoom 在 pie / heatmap / radar 沒意義 | 只在 bar/line/area 開 | 設計 by design |

---

### 快速驗收路徑(15 分鐘跑完核心)

只跑這 6 個就 ship:
```
T0-1   直接 inline data 畫 bar
T0-3   壞 JSON 不炸 message
T0-5   local 切換圖型
T0-7   釘選到圖庫
T1-9   admin 採納
T1-11  ChartEditor 從零設計(完整 4-step wizard)
```
這 6 個涵蓋 parser / render / persist / switch / pin / share schema / admin adoption / chart editor 的主幹路徑。
