# 分享設定新增「廠區」層級規劃

> grantee_type: `factory`，放在 `role` 與 `department` 之間
> zh-TW 名稱來源：EBS `FND_FLEX_VALUES_VL`（flex value set 1008041）
> en/vi 名稱來源：本地 `FACTORY_CODE_TRANSLATIONS`（LLM/Admin 維護）

---

## 1. 現況

### 目前支援的 grantee_type（6 種）

| 順序 | grantee_type | 顯示名稱 | 資料來源 |
|------|-------------|---------|---------|
| 1 | `user` | 使用者 | users 表 |
| 2 | `role` | 角色 | roles 表 |
| 3 | `department` | 部門 | users.dept_code / ERP |
| 4 | `cost_center` | 利潤中心 | users.profit_center / ERP |
| 5 | `division` | 事業處 | users.org_section / ERP |
| 6 | `org_group` | 事業群 | users.org_group_name / ERP |

### 新增後（7 種）

| 順序 | grantee_type | 顯示名稱 | 資料來源 |
|------|-------------|---------|---------|
| 1 | `user` | 使用者 | users 表 |
| 2 | `role` | 角色 | roles 表 |
| **3** | **`factory`** | **廠區** | **FND_FLEX_VALUES_VL (cache) + FACTORY_CODE_TRANSLATIONS** |
| 4 | `department` | 部門 | users.dept_code / ERP |
| 5 | `cost_center` | 利潤中心 | users.profit_center / ERP |
| 6 | `division` | 事業處 | users.org_section / ERP |
| 7 | `org_group` | 事業群 | users.org_group_name / ERP |

### factory_code 已存在的基礎設施

- `users.factory_code` — 已存在，`orgSyncService.js` 從 ERP 同步
- `erpDb.js` — `getEmployeeOrgData()` 已撈 `FACTORY_CODE`
- `orgSyncService.js` — `ORG_FIELDS` 已包含 `factory_code`

---

## 2. 名稱解析策略

### 2.1 資料源

**zh-TW（唯一真源 = ERP）**

```sql
SELECT fv.FLEX_VALUE factory_code,
       fv.DESCRIPTION factory_name
FROM FND_FLEX_VALUES_VL fv
WHERE fv.FLEX_VALUE_SET_ID = 1008041
  AND fv.END_DATE_ACTIVE IS NULL
```

**en / vi（本地表）**

```sql
CREATE TABLE FACTORY_CODE_TRANSLATIONS (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  factory_code  VARCHAR2(30) NOT NULL,
  lang          VARCHAR2(10) NOT NULL,           -- 'en' | 'vi'
  factory_name  NVARCHAR2(200) NOT NULL,
  updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT UQ_FACTORY_TRANS UNIQUE (factory_code, lang)
)
```

> 不存 zh-TW（永遠從 ERP 拉）→ 避免 ERP 改名後本地 stale。

### 2.2 In-memory cache（server/services/factoryCache.js）

```js
let _map = null;            // Map<factory_code, zh-TW name>
let _sortedCodes = null;    // string[] for LOV 顯示順序
let _loadedAt = 0;
const TTL_MS = 60 * 60 * 1000;  // 1h

async function loadFromErp() {
  const rs = await erpDb.execute(`
    SELECT FLEX_VALUE code, DESCRIPTION name
    FROM FND_FLEX_VALUES_VL
    WHERE FLEX_VALUE_SET_ID = 1008041 AND END_DATE_ACTIVE IS NULL
    ORDER BY FLEX_VALUE
  `);
  _map = new Map((rs?.rows || []).map(r => [r.CODE, r.NAME]));
  _sortedCodes = [...(rs?.rows || [])].map(r => r.CODE);
  _loadedAt = Date.now();
}

async function getFactoryMap() {
  if (!_map || Date.now() - _loadedAt > TTL_MS) await loadFromErp();
  return _map;
}

async function resolveFactoryName(code, lang = 'zh-TW') {
  if (!code) return null;
  if (lang === 'zh-TW') {
    return (await getFactoryMap()).get(code) || code;
  }
  // en / vi: 查翻譯表，fallback 回 zh-TW
  const row = await db.prepare(
    `SELECT factory_name FROM factory_code_translations WHERE factory_code=? AND lang=?`
  ).get(code, lang);
  if (row?.factory_name) return row.factory_name;
  return (await getFactoryMap()).get(code) || code;
}

async function batchResolveFactoryNames(codes, lang = 'zh-TW') { /* ... */ }

function invalidateCache() { _map = null; _loadedAt = 0; }

module.exports = { getFactoryMap, resolveFactoryName, batchResolveFactoryNames, invalidateCache };
```

**Server 啟動時 warm-up**：`server/index.js` 在 DB 初始化後呼叫 `factoryCache.getFactoryMap()`（非阻塞）。

### 2.3 Admin 管理

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/admin/factory-translations` | 列所有 factory_code 現況 + en/vi 翻譯（JOIN cache 補 zh-TW）|
| PUT | `/api/admin/factory-translations/:code/:lang` | upsert en/vi 翻譯 |
| DELETE | `/api/admin/factory-translations/:code/:lang` | 刪除某語言翻譯 |
| POST | `/api/admin/factory-translations/refresh-cache` | 強制重刷 ERP cache |
| POST | `/api/admin/factory-translations/llm-translate` | 批次 LLM 翻譯 en/vi（照 Help 翻譯模式） |

**Admin UI**：歸在「組織管理」底下新開 tab「廠區翻譯」
- 表格欄位：factory_code / zh-TW (ERP, 唯讀) / en (可編輯) / vi (可編輯) / 更新時間
- 「重刷 ERP 快取」按鈕
- 「LLM 批次翻譯」按鈕（只翻 en/vi 缺的）

---

## 3. 影響範圍 — 完整清單

### 3.1 TypeScript 型別

| 檔案 | 改動 |
|------|------|
| `client/src/types.ts` | `ShareGrantee.type` 加 `'factory'`；新增 `GranteeSelection` / `GranteeLovOption` 型別 |

### 3.2 前端 Share UI — **統一用共用元件** `<ShareGranteePicker>`

> 現況：各處 LOV 樣式不一致（有的原生 `<select>` 無搜尋、有的自製 combobox、欄位格式不同），本次一次抽共用元件。

**抽共用元件（Phase 3a，優先做完再動業務頁面）**：

| 新檔案 | 內容 |
|--------|------|
| `client/src/components/common/ShareGranteePicker.tsx` | grantee_type 切換 + 每 type 對應的搜尋/選擇 UI |
| `client/src/components/common/granteeFormat.ts` | `formatGranteeLabel(type, code, name)` helper — UI + 已分享列表共用 |

**`<ShareGranteePicker>` 規格**：

```tsx
interface Props {
  value: GranteeSelection | null        // { type, id, label }
  onChange: (v: GranteeSelection | null) => void
  shareType: string
  onShareTypeChange: (t: string) => void
  shareTypeOptions: { value: string; label: string }[]  // 各業務自訂 (use/manage, use/edit, view/develop)
  excludeTypes?: GranteeType[]          // 某些頁面不需某 type
  onAdd: () => Promise<void>
  disabled?: boolean
}
```

**標準顯示格式**（所有 7 種 grantee_type 統一）：

| grantee_type | 候選列表顯示 | 搜尋比對欄位 |
|-------------|-------------|-------------|
| user | 沿用 `<UserPicker>` | name / username / employee_id |
| role | `{name}` | name |
| **factory** | `{code} {name}` | code / name |
| department | `{code} {name}` | code / name |
| cost_center | `{code} {name}` | code / name |
| division | `{code} {name}` | code / name |
| org_group | `{name}` | name |

**Combobox 互動**：
- 輸入框 placeholder: `"輸入代碼或名稱搜尋..."`
- 打字即時過濾（`code.toLowerCase().includes(q) || name.toLowerCase().includes(q)`）
- dropdown 最多顯示前 50 筆（避免大量 org 渲染爆炸）
- 候選 row：左欄 code（monospace, 固定寬度）+ 右欄 name
- 選取後輸入框顯示 `{code} {name}`，點 × 清除

**已分享列表**：抽 helper `formatGranteeLabel(type, code, name)` 給各頁面列表 render 呼叫，UI 不強制統一（每個頁面的 share_type 按鈕/icon 配色可保留）。

**要遷移到共用元件的頁面（共 8 個）**：

| 檔案 | 現況 | 遷移後 |
|------|------|-------|
| `client/src/components/dashboard/ShareModal.tsx` | 自製 combobox，有模糊搜尋 | 換成 `<ShareGranteePicker>` |
| `client/src/components/training/editor/CourseShareTab.tsx` | 自製 combobox | 同上 |
| `client/src/components/templates/TemplateShareModal.tsx` | 原生 `<select>`，無搜尋 | 同上 |
| `client/src/pages/KnowledgeBaseDetailPage.tsx` | 原生 `<select>`，欄位混亂 | 同上 |
| `client/src/pages/SkillMarket.tsx` | 待掃 | 同上 |
| `client/src/components/admin/McpServersPanel.tsx` | 待掃 | 同上 |
| `client/src/components/admin/DifyKnowledgeBasesPanel.tsx` | 待掃 | 同上 |
| `client/src/pages/AiDashboardPage.tsx` / `DashboardBoardPage.tsx` | 用 ShareModal → 自動升級 | 驗證即可 |

**顯示 factory_name 的保證**：
- LOV API 回傳 `factories: [{ code, name }]` 已帶當前 lang 名稱
- Share list GET 回傳每筆帶 `grantee_name`（後端 `granteeNameResolver` 解析）
- 新增後 refetch（最安全）

### 3.3 後端 Org LOV API（**in-place 改欄位名，不建新端點**）

> ⚠️ **Breaking change**：直接改端點回傳欄位名，所有呼叫端（前端 + 後端）都要同步改。做完必須全 grep 一次 + runtime smoke test（見 §7）。

**統一 LOV 回傳格式**（所有 org 類 LOV 端點）：

```json
{
  "depts":          [{ "code": "0078", "name": "消費-系統-..." }],
  "profit_centers": [{ "code": "...",  "name": "..." }],       // ← 保持 profit_center（對齊 DB）
  "org_sections":   [{ "code": "TN",   "name": "台灣製造處" }],  // = divisions
  "org_groups":     [{ "code": null,   "name": "..." }],        // 統一有 code 欄位（可 null）
  "factories":      [{ "code": "TCC",  "name": "..." }]         // 新增
}
```

**注意**：
- **欄位名維持 `profit_centers` / `org_sections`**（對齊 DB `users.profit_center` / `users.org_section`）
- **`grantee_type` 字串值維持 `'cost_center'` / `'division'`**（歷史資料已存此值，不動 migration）
- LOV 欄位名與 grantee_type 字串值有命名落差，屬已知不一致，以註解說明

**端點改動清單**：

| 檔案 | 端點 | 改動 |
|------|------|-----|
| `server/routes/dataPermissions.js` | `GET /lov/org` | 回傳加 `factories`；欄位名對齊上表；支援 `?lang=` |
| `server/routes/dashboard.js` | `GET /dashboard/orgs` | 同上 |
| `server/routes/knowledgeBase.js` | `GET /kb/orgs` | 同上（原本叫 `depts/profit_centers/org_sections/org_groups`，加 `factories` + 支援 `?lang=`） |

**前端呼叫端要同步改**（全 grep `dashboard/orgs|kb/orgs|lov/org` 確認）：
- `client/src/components/dashboard/ShareModal.tsx`（`/dashboard/orgs`）
- `client/src/components/templates/TemplateShareModal.tsx`（`/kb/orgs`）
- `client/src/components/training/editor/CourseShareTab.tsx`（`/dashboard/orgs`）
- `client/src/pages/KnowledgeBaseDetailPage.tsx`（`/kb/orgs` 或 `/dashboard/orgs`）
- 其他（SkillMarket / McpServersPanel / DifyKnowledgeBasesPanel）待 Phase 3a 掃到時補

### 3.4 後端權限檢查 SQL（統一加 factory OR 分支）

每個 `grantee_type IN (...)` 的 WHERE 都要加：
```sql
OR (x.grantee_type='factory' AND x.grantee_id = u.factory_code)
```

| 檔案 | grantee_type 出現次數 | 說明 |
|------|---------------------|------|
| `server/routes/dashboard.js` | 115 | AI 戰情室 projects / designs / saved_queries / report_dashboards share |
| `server/routes/skills.js` | 34 | 技能存取 |
| `server/routes/knowledgeBase.js` | 24 | 文件知識庫分享 |
| `server/routes/mcpServers.js` | 22 | MCP server 存取 |
| `server/routes/difyKnowledgeBases.js` | 22 | Dify KB 存取 |
| `server/routes/research.js` | 17 | 深度研究 share |
| `server/routes/training.js` | 13 | 課程存取（注意既有 `'dept','department'` 別名處理，factory 只用單名） |
| `server/routes/webex.js` | 13 | Webex bot 權限 |
| `server/routes/chat.js` | 12 | 對話工具存取檢查 |
| `server/routes/scheduledTasks.js` | 8 | 排程任務存取 |

**Service 層也要改**：
- `server/services/docTemplateService.js`（12）
- `server/services/promptResolver.js`（2）
- `server/services/pipelineRunner.js`（2）
- `server/services/researchService.js`（6）
- `server/services/mcpClient.js`（6）

> `dataPermissions.js`（2 筆）是 AI policy assignment 的 role/user 單一分派，**不屬於** 多層級分享，不改。

### 3.5 Share CRUD — POST 驗證 + GET name resolution

**POST**：若路由有 `grantee_type` whitelist 驗證，加 `'factory'`。

涉及路由（列出 POST share/access 的端點）：
- `/dashboard/projects/:id/shares`
- `/dashboard/designs/:id/shares`
- `/dashboard/saved-queries/:id/shares`
- `/dashboard/report-dashboards/:id/shares`
- `/research/:id/shares`（若有）
- `/skills/:id/access`
- `/mcp-servers/:id/access`
- `/dify-kbs/:id/access`
- `/knowledge-bases/:id/shares`
- `/doc-templates/:id/shares`
- `/training/courses/:id/access`
- `/webex/...` 相關 share
- `/scheduled-tasks/:id/shares`（若有）

**GET**：grantee_name 解析。既有 SQL 多半用 CASE + 子查詢補 `grantee_name`（看 `dashboard.js:235-241`），factory 分支**不要塞進 SQL**（跨 DB 做不到），改在 JS 層補：

```js
// 撈完列表後
const factoryMap = await factoryCache.getFactoryMap();
const trans = lang !== 'zh-TW'
  ? await db.prepare(`SELECT factory_code, factory_name FROM factory_code_translations WHERE lang=?`).all(lang)
  : [];
const transMap = new Map(trans.map(t => [t.factory_code, t.factory_name]));

for (const row of shareRows) {
  if (row.grantee_type === 'factory') {
    row.grantee_name = transMap.get(row.grantee_id) || factoryMap.get(row.grantee_id) || row.grantee_id;
  }
}
```

建議抽成 helper：`server/services/granteeNameResolver.js`（所有 share list 共用）。

### 3.6 i18n 三語言檔

| 檔案 | key |
|------|-----|
| `client/src/i18n/locales/zh-TW.json` | `share.granteeType.factory = "廠區"`, `admin.factoryTrans.title` 等 |
| `client/src/i18n/locales/en.json` | `= "Factory"` |
| `client/src/i18n/locales/vi.json` | `= "Nhà máy"` |

---

## 4. DB 改動總結

| 類型 | 項目 |
|------|------|
| 新建表 | `FACTORY_CODE_TRANSLATIONS`（只存 en/vi） |
| 不建表 | factory_code/zh-TW 名稱走 ERP cache，不落地 |
| 不需改 | 所有既有 share/access 表（grantee_type 已是 VARCHAR） |
| 不需改 | `users.factory_code`（已存在） |

---

## 5. 實作順序

### Phase 1：基礎建設
1. `factoryCache.js` service（ERP 讀取 + memory cache + TTL + invalidate）
2. `FACTORY_CODE_TRANSLATIONS` 表（database-oracle.js createTable）
3. `granteeNameResolver.js` helper（給 GET share list 補 name）
4. Server 啟動 warm-up factoryCache

### Phase 2：Admin 管理
5. Admin API — 翻譯 CRUD + 重刷 cache + LLM 批翻
6. Admin UI — 「廠區翻譯」tab（zh-TW 唯讀 / en / vi 可編輯 / LLM 按鈕 / 重刷按鈕）
7. i18n 三語言加 key

### Phase 3：後端 LOV 端點改動（in-place breaking change）
8. `types.ts` 加 `'factory'`、新增 `GranteeSelection` / `GranteeLovOption` 型別
9. `GET /dashboard/orgs` — 加 `factories`、支援 `?lang=`、欄位名對齊 §3.3
10. `GET /lov/org` — 同上
11. `GET /kb/orgs` — 同上
12. **全 grep 呼叫端確認沒漏**（`dashboard/orgs|kb/orgs|lov/org`）

### Phase 3a：**前端抽共用元件**（關鍵里程碑）
13. `client/src/components/common/granteeFormat.ts` — `formatGranteeLabel` helper
14. `client/src/components/common/ShareGranteePicker.tsx` — 共用元件
   - 7 種 grantee_type 統一 combobox 互動
   - 部門/利潤中心/事業處/廠區顯示 `{code} {name}`
   - 代碼 / 名稱 雙欄模糊搜尋
   - 前 50 筆虛擬化（可選）
15. 寫簡單手動 demo page 或 Storybook 驗證共用元件

### Phase 3b：前端 Share UI 遷移到共用元件（共 8 處）
16. `ShareModal.tsx`（dashboard / AiDashboardPage / DashboardBoardPage 共用）
17. `TemplateShareModal.tsx`
18. `CourseShareTab.tsx`
19. `KnowledgeBaseDetailPage.tsx`
20. `SkillMarket.tsx`
21. `McpServersPanel.tsx`
22. `DifyKnowledgeBasesPanel.tsx`
→ 每處都驗證「新增 factory share 後列表顯示 factory_name」

### Phase 4：後端權限檢查（10 個 routes + 5 個 services）
23. `dashboard.js`、`skills.js`、`knowledgeBase.js`、`mcpServers.js`、`difyKnowledgeBases.js`
24. `research.js`、`training.js`、`webex.js`、`chat.js`、`scheduledTasks.js`
25. `docTemplateService.js`、`promptResolver.js`、`pipelineRunner.js`、`researchService.js`、`mcpClient.js`

### Phase 5：Share CRUD 補完
26. 所有 POST share/access 路由 — 驗證接受 `'factory'`
27. 所有 GET share/access 列表 — 接上 `granteeNameResolver`

---

## 6. 待確認事項

- [ ] ERP DB 連線失敗時的行為：cache 未載入就查 `getFactoryMap()` 返回空 Map → LOV 顯示不到廠區、已存在 share 的 grantee_name 顯示 code。可接受？還是要 fallback 到 `users` 表 distinct factory_code？
- [ ] LLM 批次翻譯要不要加「覆寫已有翻譯」選項（預設只補缺）？
- [ ] 是否需要支援「廠區 + 部門」的組合權限？（目前各 grantee_type 是 OR 關係，非 AND，一致性考量應維持 OR）
- [ ] `training.js` 既有 `grantee_type IN ('dept','department')` 的別名 pattern，factory 只用單名 `'factory'`，不需別名
- [ ] **命名落差**：LOV 欄位用 `profit_centers` / `org_sections`（對齊 DB），但 `grantee_type` 字串值是 `'cost_center'` / `'division'`。目前決定**不動**（避免歷史資料 migration），需全專案加註解說明。未來若要一致化，需寫 migration `UPDATE ... SET grantee_type='profit_center' WHERE grantee_type='cost_center'` + 全檔案搜尋替換。

---

## 7. 驗證 Checklist（Phase 3 改欄位名 + Phase 3a 共用元件完成後必做）

> 用戶要求：「做完記得要多檢查幾遍」。每個勾都必須實際執行，不是靠 TS compile 通過就當完成。

### 7.1 後端 LOV 端點改動驗證（Phase 3 完成後）

- [ ] `grep -r "dashboard/orgs\|kb/orgs\|lov/org" client/ server/` 列出所有呼叫端
- [ ] 每個呼叫端確認：新欄位 `factories` 有被處理
- [ ] 每個呼叫端確認：既有欄位名（`depts` / `profit_centers` / `org_sections` / `org_groups`）**沒被改錯**
- [ ] 三種 lang 各切一次，確認 `factory_name` 顯示正確（zh-TW 來自 ERP、en/vi 來自 translations 表、缺翻譯時 fallback zh-TW）
- [ ] ERP 離線情境：停掉 ERP DB 連線，確認 LOV 不噴錯、factories 欄位回空陣列
- [ ] 手動跑 `SELECT DISTINCT grantee_type FROM ai_project_shares` 等 9 張 share/access 表，確認沒有意外值

### 7.2 共用元件遷移驗證（Phase 3b 完成後）

對 8 個遷移的頁面逐一跑：

- [ ] 頁面能正常打開，無 console error
- [ ] 切換 7 種 grantee_type，UI 都正常顯示
- [ ] 部門 / 利潤中心 / 事業處 / **廠區** 都能：
  - [ ] 輸入 code 前幾碼（例如 `007`）→ 過濾出相關項目
  - [ ] 輸入 name 片段（例如 `消費-系統`）→ 過濾出相關項目
  - [ ] 列表顯示 `{code} {name}` 格式
- [ ] 選取後輸入框顯示 `{code} {name}`，點 × 能清除
- [ ] 新增 share 成功後，列表顯示 `grantee_name`（不是只顯示 code）
- [ ] 移除 share 運作正常
- [ ] 切換語系（zh-TW / en / vi），grantee_type label 與 factory_name 都對應切換
- [ ] 既有 non-factory share（例如已存在的部門 share）顯示不受影響

### 7.3 權限檢查驗證（Phase 4 完成後）

- [ ] 建立測試帳號 A：`factory_code='TCC'`
- [ ] 對某個 project / skill / KB / course 設定 `grantee_type='factory', grantee_id='TCC'` share
- [ ] 用 A 登入 → 確認能看到該資源（各 10 個 routes 都要驗）
- [ ] 修改 A 的 `factory_code='KS1'` → 確認看不到
- [ ] 既有 non-factory share（user/role/department/cost_center/division/org_group）權限不受影響

### 7.4 最終全專案搜尋 Checklist

- [ ] `grep -r "grantee_type" client/ server/` 逐檔確認 factory 分支都加了
- [ ] `grep -r "cost_center\|profit_center" client/ server/` 確認命名落差有註解
- [ ] `grep -r "depts\|profit_centers\|org_sections\|org_groups\|factories" client/` 確認前端都處理了
- [ ] 跑一次 `npm run build` on client + `npm run typecheck` 確認型別全通
- [ ] 跑一次 integration test（如果有）

---

## 8. 歷史決策紀錄

- **2026-04-14** — 確認 factory_name 資料源為 `FND_FLEX_VALUES_VL` (flex value set 1008041)，zh-TW 唯一真源為 ERP，不落地；en/vi 走本地 `FACTORY_CODE_TRANSLATIONS` 表。
- **2026-04-14** — 決定 in-place 改 LOV 端點欄位名（不另建新端點），breaking change 完成後須依 §7 checklist 全面驗證。
- **2026-04-14** — 決定抽共用元件 `ShareGranteePicker`，一次統一 7 種 grantee_type 的 LOV 樣式與模糊搜尋行為。
- **2026-04-14** — LOV 回傳欄位名維持 `profit_centers`（對齊 DB），不採 `cost_centers`；但 `grantee_type='cost_center'` 不動（避免歷史資料 migration）。
- **2026-04-14** — cache TTL 1h + admin 手動重刷按鈕。
- **2026-04-14** — `/data-permissions/lov/org` 為 flat array 格式，供 DataPermissionsPanel 政策指派用，**不走共用分享元件**，本次不改。只改 `/dashboard/orgs` 和 `/kb/orgs`。

---

## 9. 實作進度紀錄

- **2026-04-14 Phase 1 完成**
  - `server/services/factoryCache.js` — ERP cache + 1h TTL + invalidate + forceReload
  - `FACTORY_CODE_TRANSLATIONS` 表（database-oracle.js）
  - `server/services/granteeNameResolver.js` — 批次解析 factory grantee_name
  - `server/server.js` — 啟動 warm-up factoryCache

- **2026-04-14 Phase 2 完成**
  - `server/routes/factoryTranslations.js` — CRUD + refresh-cache + llm-translate
  - `client/src/components/admin/FactoryTranslationsPanel.tsx` — 列表 + inline edit + LLM 批翻
  - AdminDashboard 加入「廠區翻譯」tab
  - i18n 三語言 key（`grantee.type.*`, `admin.factoryTrans.*`, `admin.tabs.factoryTranslations`）

- **2026-04-14 Phase 3 完成（後端 LOV）**
  - `GET /dashboard/orgs?lang=` — 加 `factories`，`org_groups` 統一 `{code:null, name}` 格式
  - `GET /kb/orgs?lang=` — 同上
  - `types.ts` 加 `GranteeType` / `GranteeLovOption` / `OrgLovResponse` / `GranteeSelection`
  - 既有 8 個呼叫端（ShareModal / DesignerPanel / AiDashboardAdmin / KnowledgeBaseDetailPage / SkillMarket / ProgramEditor / TemplateShareModal / CourseShareTab）— 新增欄位向後相容，無破壞性

- **2026-04-14 Phase 3a 完成（共用元件）**
  - `client/src/components/common/granteeFormat.ts` — `formatGranteeLabel` / `filterAndRank` / `splitForHighlight`
  - `client/src/components/common/ShareGranteePicker.tsx` — 7 種 grantee_type 統一 combobox + 模糊搜尋 + code/name 雙欄

- **2026-04-14 Phase 3b 完成（8 頁面遷移）**
  - `ShareModal.tsx` (dashboard) — 重寫使用 ShareGranteePicker
  - `TemplateShareModal.tsx` — 同上，換掉原生 `<select>`
  - `CourseShareTab.tsx` — 簡化移除自製 combobox 邏輯
  - `KnowledgeBaseDetailPage.tsx ShareTab` — 換掉原生 `<select>`，用 STANDARD_TO_KB_TYPE / KB_TYPE_TO_STANDARD 對應舊型別
  - `SkillMarket.tsx SkillShareModal` — 同 KB 模式（用 SKILL_STD_TO_LEGACY 對應）
  - `McpServersPanel.tsx` / `DifyKnowledgeBasesPanel.tsx` — 自動升級（內部用 ShareModal）
  - `AiDashboardPage.tsx` / `DashboardBoardPage.tsx` — 自動升級（用 ShareModal）

- **2026-04-14 Phase 4 完成（後端權限檢查 SQL）**
  - `dashboard.js` — 10 個 SQL block 加 factory OR + factory_code 參數
  - `skills.js` — 5 個 SQL block（dept/profit_center/org_section 舊名）
  - `knowledgeBase.js` — 4 個 SQL block
  - `training.js` — 2 個 SQL block
  - `mcpServers.js` — 2 個 SQL block
  - `difyKnowledgeBases.js` — 2 個 SQL block
  - `research.js` — 2 個 SQL block
  - `chat.js` — 2 個 SQL block + userCtx 加 factoryCode
  - `SELECT ... FROM users` 各處補齊 `factory_code` 欄位
  - **未完成**：`webex.js` / `scheduledTasks.js` / service 層（mcpClient/researchService/promptResolver/pipelineRunner/docTemplateService）— 留待下一階段驗證時補齊

- **2026-04-14 Phase 5 完成（Share CRUD）**
  - 所有 GET share/access 接上 `granteeNameResolver` JS 層補 factory grantee_name：
    - `dashboard.js` — projects/designs/saved-queries/report-dashboards shares
    - `skills.js` `/:id/access`
    - `mcpServers.js` GET + POST `/:id/access`（POST 白名單加 'factory'）
    - `difyKnowledgeBases.js` GET + POST `/:id/access`（POST 白名單加 'factory'）
    - `knowledgeBase.js` GET `/:id/access`（POST 白名單加 'factory'）
    - `docTemplates.js` GET `/:id/shares`
    - `training.js` GET `/courses/:id/access`

- **已知不一致 / TODO（追蹤）**
  - `data-permissions/lov/org` 回傳 flat array 未改（不影響 share UI，僅 DataPermissionsPanel 使用）
  - 部分 service 層（mcpClient/researchService 等）未加 factory OR — 需後續補齊
  - `webex.js` / `scheduledTasks.js` 未加 factory OR — 次要 routes
  - `knowledgeBase.js` 的 `grantee_type='dept'/'profit_center'/'org_section'` 與 `skills.js` 的同樣落差命名維持歷史值；共用元件前端用標準名稱，呼叫時透過 mapping 對應
