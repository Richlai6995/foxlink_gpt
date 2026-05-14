# 排程任務 × AI 戰情整合 — 設計文件

> 在排程 Pipeline 內以 node 的方式呼叫 AI 戰情查詢,將結果落地成 Excel 或 JSON 給下游節點。
>
> Ship date:
> - Phase 1 (基礎): 2026-05-14 — dashboard node + buffered wrapper + failed_nodes + Try it
> - Phase 2 (擴充): 2026-05-14 — restrict_multi_org chips + merge_excel node + format='none'

---

## 1. 為什麼要做

| 現況 | 缺口 |
|---|---|
| AI 戰情只能在 UI 互動查 | 沒有「每天早上 8 點寄超額庫存報表給某主管」這種自動化能力 |
| 排程能呼叫 skill / kb / mcp / db_write | 無法引用結構化 DB 查詢結果(AI 戰情已封裝好的 NL → SQL → 結果 pipeline) |
| 設計者已寫好的「合理庫存」「設備稼動」「Token 統計」等 design | 只能讓 user 手點,無法定時推送給更廣的對象 |

整合後:**排程設計者選 design → 寫題目(支援 `{{date}}` 插值)→ 自動產 Excel 寄信**,且**完全等同於該排程擁有者本人手點查詢**的權限結果(design 存取權 + 資料政策 + Multi-Org scope)。

---

## 2. 架構

```
┌─────────────────────────────────────────────────────────────────┐
│ Scheduled Task (per cron tick)                                  │
│                                                                 │
│  1) Render prompt (substituteVarsAsync) → 帶 {{date}}/{{fetch:}}│
│  2) Call Gemini (main AI response)                              │
│  3) Run pipeline nodes                                          │
│       ├─ skill / kb / mcp ...                                   │
│       ├─ ai (chain LLM)                                         │
│       ├─ dashboard ★ 新增                                       │
│       │    └─→ runDashboardQueryBuffered(designId, question…)   │
│       │            ├─ canAccessDesign() — design 存取權          │
│       │            ├─ getEffectivePolicies() — 資料政策          │
│       │            ├─ full_block 三層檢查                        │
│       │            ├─ checkForbiddenInQuestion() — 關鍵字        │
│       │            └─ runDashboardQuery() — SQL gen + 執行       │
│       │                 └─→ rowsToXlsxJsonString() → xlsx 檔     │
│       ├─ db_write / kb_write / alert / generate_file ...        │
│  4) Collect failedNodes[] — fail-fast 或 ⚠️ 標記                 │
│  5) Email: 主旨 prefix ⚠️ (N 節點失敗) + body 紅字錯誤段         │
│  6) Insert scheduled_task_runs.failed_nodes_json (CLOB)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 關鍵檔案

| 層級 | 檔案 | 改動 |
|---|---|---|
| Service | [server/services/dashboardService.js](../server/services/dashboardService.js) | 新增 `runDashboardQueryBuffered()` — 把 SSE callback 包成 buffer 給非 HTTP caller 用 |
| Service | [server/services/pipelineRunner.js](../server/services/pipelineRunner.js) | 新增 `execDashboard()` node executor + `rowsToXlsxJsonString()` helper;`runPipeline()` 改 return `failedNodes`,支援 `required` 旗標 |
| Service | [server/services/scheduledTaskService.js](../server/services/scheduledTaskService.js) | 收 `failedNodes`,組進 email 主旨/body + 寫進 `scheduled_task_runs.failed_nodes_json` |
| Route | [server/routes/dashboard.js](../server/routes/dashboard.js) | export `checkForbiddenInQuestion` / `canAccessDesign` 給 service 層 lazy require |
| Route | [server/routes/scheduledTasks.js](../server/routes/scheduledTasks.js) | tools-catalog 加 `dashboards` 分類;新增 `POST /dashboards/:design_id/preview`(Try it) |
| Schema | [server/database-oracle.js](../server/database-oracle.js) | `addCol('SCHEDULED_TASK_RUNS', 'FAILED_NODES_JSON', 'CLOB')` |
| UI | [client/src/components/admin/PipelineTab.tsx](../client/src/components/admin/PipelineTab.tsx) | 新增 `DashboardForm`、NODE_TYPES 加 `dashboard`、PipelineNode interface 擴充 |
| UI | [client/src/components/admin/ScheduledTasksPanel.tsx](../client/src/components/admin/ScheduledTasksPanel.tsx) | ToolCatalog interface + 預設 state |
| i18n | `client/src/i18n/locales/{zh-TW,en,vi}.json` | `scheduledTask.pipeline.nodeType.dashboard` + `dashboardNode.*` 約 14 個 key |

---

## 4. Pipeline node JSON 格式

```json
{
  "id": "dash_1",
  "type": "dashboard",
  "design_id": 12,
  "question": "{{date}} 各 ORG_CODE 超額庫存金額 TOP 10",
  "model_key": null,
  "force_fresh": true,
  "output": {
    "format": "xlsx",
    "filename": "庫存日報_{{date}}.xlsx",
    "sheet_name": "TOP10"
  },
  "required": false,
  "label": "庫存日報"
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `design_id` | ✅ | `ai_select_designs.id`,UI 從 tools-catalog 的 `dashboards` 下拉選 |
| `question` | ✅ | 自然語言題目,支援 `{{ai_output}}` / `{{date}}` / `{{node_X_output}}` / `{{task_name}}` 插值 |
| `model_key` | — | `llm_models.key`(如 `pro` / `flash`);null = 用 design 預設 |
| `force_fresh` | — | 預設 true。目前 `runDashboardQuery` 不走 cache,no-op,保留給未來 |
| `output.format` | — | `xlsx`(預設,落檔)/ `json_text`(rows 序列化給下游 ai/db_write 接) / `none`(只寫 artifacts,供 merge_excel 拉) |
| `output.filename` | — | xlsx 檔名樣板,自動補 `.xlsx`。預設 `{designName}_{{date}}.xlsx` |
| `output.sheet_name` | — | xlsx 工作表名(預設 `Result`) |
| `required` | — | true = 失敗時整段 pipeline 中斷;false = 寄信時標 ⚠️ 但繼續其他 node |
| `restrict_multi_org` | — | `{ org_ids?, ou_ids?, sob_ids? }` — 進一步限縮 user 的 multi-org scope(**intersection-only**,不能擴張) |

### Merge Excel node JSON

```json
{
  "id": "merge_1",
  "type": "merge_excel",
  "source_node_ids": ["dash_inv", "dash_wip", "dash_po"],
  "mode": "multi_sheet",
  "filename": "週報_{{date}}.xlsx",
  "sheet_name": "Merged",
  "required": false
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `source_node_ids` | ✅ | 引用的 dashboard node IDs(在此 merge_excel 之前必須跑過) |
| `mode` | — | `multi_sheet`(預設,每個 source 一個 sheet)/ `single_sheet`(全部接成一張,加 `_source` 標記欄) |
| `filename` | — | 預設 `merged_dashboards_{{date}}.xlsx` |
| `sheet_name` | — | 只 `single_sheet` 模式用 |
| `required` | — | 同 dashboard 節點 |

**建議**:被合併的 dashboard node 設 `output.format='none'`,避免「個別檔 + 合併檔」重複落檔。

---

## 5. 失敗策略 — Hybrid D2

排程不是 fail-fast 設計(整天什麼都收不到比錯誤更慘),也不能完全靜默(user 以為正常)。採取:

1. **每個 node 預設 `required: false`** → 失敗不中斷其他 node
2. **`required: true`** → fail-fast(等同舊 `on_fail: 'stop'`)
3. **`failedNodes[]` 蒐集所有失敗節點**(含 parallel 內部的 rejected promise)
4. **Email 警告**:
   - 主旨 prefix:`⚠️ (N 節點失敗) `(N > 0 時)
   - body 開頭插「⚠️ 本次執行有 N 個節點失敗」紅字段,列出每個 node 的 label + error message
5. **History UI**:`scheduled_task_runs.failed_nodes_json` CLOB 可被前端 parse 顯示

---

## 6. 權限模型

排程觸發時,user identity = `task.user_id`(排程擁有者),**完全等同於該擁有者親自手點查詢**:

| 層 | 檢查 | 程式碼 |
|---|---|---|
| 排程任務權限 | `allow_scheduled_tasks` + 全域 toggle | [scheduledTasks.js:13-25](../server/routes/scheduledTasks.js#L13) |
| Design 存取權 | `canAccessDesign` — owner / public / ai_dashboard_shares(7 種 grantee_type) | [dashboardService.js runDashboardQueryBuffered](../server/services/dashboardService.js) |
| 資料政策(主題綁定) | `getEffectivePolicies(db, userId, topic.policy_category_id)` | [dataPermissions.js](../server/routes/dataPermissions.js) |
| Full block 三層 | L1/L2 帳號全禁 → L3 組織層 → L4 ERP Multi-Org | 同 routes/dashboard.js POST /query 行 1788-1832 |
| 關鍵字 | `checkForbiddenInQuestion(question, rules)` | export from [routes/dashboard.js](../server/routes/dashboard.js) |
| Multi-Org WHERE 注入 | `organization_id` / `operating_unit` / `set_of_books_id` IN (...) | `runDashboardQuery` 內 multiOrgService |
| Multi-Org 限縮(可選) | `restrict_multi_org.{org_ids,ou_ids,sob_ids}` **intersection** with user scope | `runDashboardQuery` 行 884+ |

**所以**:Design 被收回 share / 政策變更 → 下次排程觸發即失效,**不能透過排程繞過任何權限**。
**restrict_multi_org 只能限縮**:user 沒 GAD 權限就算設 `org_ids=[GAD]` 也會被 intersection 過濾成空 → 走 `1=0` 安全 fallback。

---

## 7. Try it 預覽 API

`POST /api/scheduled-tasks/dashboards/:design_id/preview`

Body:
```json
{
  "question": "...",
  "model_key": null,
  "lang": "zh-TW",
  "restrict_multi_org": { "org_ids": [101, 102] }
}
```

Response (200):
```json
{
  "sql": "SELECT ...",
  "design_name": "合理庫存主表查詢",
  "topic_name": "合理庫存分析",
  "policy_category_id": 3,
  "multiorg_scope": { "allowed_org_names": [...] },
  "row_count": 152,
  "columns": ["org_code", "qty", ...],
  "column_labels": { "org_code": "ORG 代碼", ... },
  "rows": [...100 筆],
  "truncated": true,
  "duration_ms": 8421
}
```

Error:
- 400 `question 為必填` / `design_id 無效`
- 403 `⛔ 開頭`的政策錯誤
- 500 其他

UI 在 DashboardForm 內按 Try it 觸發,即時顯示 SQL + 前 20 筆 rows table。

---

## 8. 限制與後續

| 限制 | 原因 | 狀態 / 後續 |
|---|---|---|
| ~~`org_scope_override` UI 預留但未實作~~ | — | **Phase 2 已 ship**:`restrict_multi_org` chips,UI 在 Try it 後顯示可選的 org/ou/sob 全集 |
| ~~不支援多 dashboard 合併一個 Excel~~ | — | **Phase 2 已 ship**:`merge_excel` node,搭配 dashboard `format='none'` 使用 |
| `force_fresh` no-op | dashboard 路徑沒走 cache(`getCachedResult`/`setCachedResult` 為 dead code) | 啟用 cache 後加 cache hint flag |
| Excel row cap 50000 | 避免單檔 > 100MB 撐爆 mail attachment | 超大資料考慮 CSV / 分檔 |
| Try it 用 buffered 非 SSE | 排程設計頁 UX 容忍 spinner | 改 SSE streaming 顯示 SQL 先出、rows 後到 |
| AI 摘要要使用者自己接 `ai` node | C 設計選擇 | 提供 wizard 模板(Phase 3) |

---

## 9. 測試 checklist

### Phase 1 — Dashboard node 核心
- [ ] 一般情境:user 有 design 權限 + 政策正常 → Excel 生成 + email 送達
- [ ] Design 存取權被收回 → required=false 時其他 node 繼續 + email 標 ⚠️
- [ ] Design 存取權被收回 + required=true → 整個 pipeline 中斷 + email 不寄
- [ ] L1 full_block → ⛔ 拒絕(throw)
- [ ] 問題含未授權關鍵字 → ⛔ 拒絕
- [ ] 結果 0 筆 → 不產空 xlsx,email 顯示「(查詢無結果)」
- [ ] 結果 > 50000 筆 → 截斷 + 文字註記「已截斷至 50000 筆」
- [ ] Multi-Org 設定 → SQL 注入 IN (...) 正確套用 user 的 allowed_org_ids
- [ ] Try it 預覽 SQL + 前 20 rows 顯示正確
- [ ] Try it 401 / 政策拒絕 → 紅字錯誤訊息
- [ ] format=json_text → 下游 ai node 能讀 `{{node_X_output}}` 拿到 rows
- [ ] parallel 內含 dashboard node 失敗 → failedNodes 正確收集

### Phase 2 — restrict_multi_org
- [ ] User 有 5 個 org → restrict 選 2 個 → SQL `IN (2 個 id)`
- [ ] User 有 5 個 org → restrict 選 1 個沒權限的 → intersection 0 個 → `1=0` 拒絕
- [ ] 沒設 restrict → 用 user 全 scope(等同 Phase 1 行為)
- [ ] Try it 第一次出 multiorg_scope → 第二次 Try it 帶 restrict → 結果限縮正確
- [ ] 排程儲存後執行 → SQL injection 帶 restrict

### Phase 2 — merge_excel
- [ ] 3 個 dashboard(format=none)+ 1 個 merge_excel(multi_sheet)→ 出 1 個 xlsx with 3 sheets
- [ ] dashboard 失敗(required=false)→ merge_excel 標記 `[missing: id]` + 其他 sheet 正常
- [ ] 全部 dashboard 失敗 → merge_excel throw `所有 source dashboard node 都沒有 artifacts`
- [ ] single_sheet 模式 → 多 source 合在同一 sheet,第一欄是 `_source`
- [ ] Sheet name > 31 chars → 自動截斷 + 替換非法字元
- [ ] source dashboard 同時 format=xlsx → 既出個別檔也出合併檔(user 自行決定)

---

## 10. 觀察/回滾

**觀察點**:
- `scheduled_task_runs.failed_nodes_json` 內出現 dashboard 節點 → 看 error 是政策 / Oracle / token budget
- Pro 模型用量是否暴增(每 dashboard 跑一次 NL→SQL = 1 次 Pro call)
- ERP pool exhaustion(多 task 排在同一 cron tick 觸發大量 dashboard query)

**回滾**:
- 刪 pipeline 內的 `dashboard` node 即可,backend 仍會 dispatch 到 `default: throw 未知節點類型`(不影響其他 node)
- 完全 disable:在 `pipelineRunner.runNode()` 把 `case 'dashboard'` 註解掉
- 不需 DB 回滾(`failed_nodes_json` 是新增欄位,沒寫進去就維持 null)
