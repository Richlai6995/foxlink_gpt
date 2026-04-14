# 分享設定新增「廠區」層級規劃

> grantee_type: `factory`，放在 `role` 與 `department` 之間
> 資料來源：`APPS.FL_ORG_EMP_DEPT_MV.FACTORY_CODE` + users 表已同步的 `factory_code`

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
| **3** | **`factory`** | **廠區** | **users.factory_code / FACTORY_CODE_MAPPINGS** |
| 4 | `department` | 部門 | users.dept_code / ERP |
| 5 | `cost_center` | 利潤中心 | users.profit_center / ERP |
| 6 | `division` | 事業處 | users.org_section / ERP |
| 7 | `org_group` | 事業群 | users.org_group_name / ERP |

### factory_code 已存在的基礎設施

- `users.factory_code` — 已存在，`orgSyncService.js` 從 ERP 同步
- `erpDb.js` — `getEmployeeOrgData()` 已撈 `FACTORY_CODE`
- `orgSyncService.js` — `ORG_FIELDS` 已包含 `factory_code`

---

## 2. FACTORY_CODE 名稱對照表

### 問題

`FL_ORG_EMP_DEPT_MV.FACTORY_CODE` 只有代碼（如 `TCC`, `KS1`），無對應名稱欄位。分享 UI 的 dropdown 需要顯示名稱。

### 方案：建立 `FACTORY_CODE_MAPPINGS` 對照表

```sql
-- database-oracle.js createTable()
CREATE TABLE FACTORY_CODE_MAPPINGS (
  factory_code   VARCHAR2(30) PRIMARY KEY,
  factory_name   NVARCHAR2(100) NOT NULL,
  sort_order     NUMBER DEFAULT 0,
  is_active      NUMBER(1) DEFAULT 1,
  created_at     TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at     TIMESTAMP DEFAULT SYSTIMESTAMP
)
```

#### 多語言支援

```sql
CREATE TABLE FACTORY_CODE_TRANSLATIONS (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  factory_code  VARCHAR2(30) NOT NULL REFERENCES FACTORY_CODE_MAPPINGS(factory_code),
  lang          VARCHAR2(10) NOT NULL,   -- 'en', 'vi'
  factory_name  NVARCHAR2(100) NOT NULL,
  CONSTRAINT UQ_FACTORY_TRANS UNIQUE (factory_code, lang)
)
```

#### Admin 管理 API

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/admin/factory-mappings` | 列出所有對照（含翻譯） |
| POST | `/api/admin/factory-mappings` | 新增對照 |
| PUT | `/api/admin/factory-mappings/:code` | 修改名稱/排序/啟用 |
| DELETE | `/api/admin/factory-mappings/:code` | 刪除對照 |
| POST | `/api/admin/factory-mappings/sync-from-erp` | 從 ERP 拉取所有 distinct FACTORY_CODE 自動建立（名稱暫填代碼） |

#### Admin 管理 UI

在 Admin 頁面新增「廠區對照管理」tab 或獨立頁面：
- 表格列出 factory_code / factory_name / sort_order / is_active
- 支援 inline edit
- 「從 ERP 同步」按鈕：自動抓 distinct factory_code，缺少的自動新增
- 翻譯按鈕：可用 LLM 批次翻譯 en/vi

> **替代方案**：如果 ERP `APPS` schema 有 factory master table，可直接 LEFT JOIN 取名稱，免建對照表。實作前先確認。

---

## 3. 影響範圍 — 完整清單

### 3.1 TypeScript 型別

| 檔案 | 行 | 改動 |
|------|---|------|
| `client/src/types.ts` | 708 | `ShareGrantee.type` 加 `'factory'` |

```typescript
// before
type: 'user' | 'role' | 'department' | 'cost_center' | 'division' | 'org_group'
// after
type: 'user' | 'role' | 'factory' | 'department' | 'cost_center' | 'division' | 'org_group'
```

### 3.2 前端 Share 元件（3 個）

#### a) `client/src/components/dashboard/ShareModal.tsx`
- grantee type dropdown 加入「廠區」選項（排在角色後面）
- 選擇廠區時顯示 factory_code 列表（從 LOV API 拉）
- 搜尋邏輯：比對 factory_code + factory_name

#### b) `client/src/components/templates/TemplateShareModal.tsx`
- 同上，加入廠區 grantee type
- 資料來源用 `/api/kb/orgs` 或 `/api/data-permissions/lov/org`

#### c) `client/src/components/training/editor/CourseShareTab.tsx`
- 同上，加入廠區 grantee type
- name resolution：factory_code → factory_name

### 3.3 後端 Org LOV API（2 處）

#### a) `server/routes/dataPermissions.js` — `GET /lov/org`
```javascript
// 加入 FACTORY_CODE 到 ERP 查詢
// 回傳格式加入 factories: [{ factory_code, factory_name }]
// fallback 到 users 表 distinct factory_code + LEFT JOIN factory_code_mappings
```

#### b) `server/routes/dashboard.js` — `GET /dashboard/orgs`
```javascript
// 同上，加入 factories 到回傳資料
```

### 3.4 後端權限檢查（逐檔案）

每個權限檢查的 SQL WHERE 條件都要加上 factory 的 OR 分支：

```sql
-- 現有 pattern
... OR (sa.grantee_type='department' AND sa.grantee_id = u.dept_code)
-- 新增
... OR (sa.grantee_type='factory' AND sa.grantee_id = u.factory_code)
```

| 檔案 | 函式/位置 | 說明 |
|------|----------|------|
| `server/routes/dashboard.js` | `checkAccessByUser()` 等 (~4 處) | AI 戰情室所有權限檢查 |
| `server/routes/chat.js` | 技能/MCP/Dify 存取檢查 (~3 處) | 對話時檢查使用者可用工具 |
| `server/routes/skills.js` | 技能列表過濾 | 使用者可見技能 |
| `server/routes/mcpServers.js` | MCP 列表過濾 | 使用者可見 MCP |
| `server/routes/difyKnowledgeBases.js` | Dify KB 列表過濾 | 使用者可見知識庫 |
| `server/routes/docTemplates.js` | 模板列表過濾 + 存取檢查 | 使用者可見模板 |
| `server/routes/training.js` | 課程列表過濾 + 存取檢查 | 使用者可見課程 |

### 3.5 後端 Share CRUD API

新增/刪除 share 時 grantee_type 驗證要接受 `'factory'`（如果有 whitelist 驗證的話）。

涉及的路由：

| 路由 | 方法 |
|------|------|
| `dashboard/projects/:id/shares` | POST |
| `dashboard/designs/:id/shares` | POST |
| `dashboard/saved-queries/:id/shares` | POST |
| `dashboard/report-dashboards/:id/shares` | POST |
| `skills/:id/access` | POST |
| `mcp-servers/:id/access` | POST |
| `dify-kbs/:id/access` | POST |
| `doc-templates/:id/shares` | POST |
| `training/courses/:id/access` | POST |

### 3.6 後端 Share GET（name resolution）

GET share 列表時，grantee_type='factory' 的 grantee_name 需要解析：

```sql
CASE
  WHEN sa.grantee_type = 'factory'
  THEN (SELECT factory_name FROM factory_code_mappings WHERE factory_code = sa.grantee_id)
  ...
END AS grantee_name
```

### 3.7 i18n 翻譯

三個語言檔都要加：

```json
{
  "share.granteeType.factory": "廠區 / Factory / Nhà máy",
  "admin.factoryMappings.title": "廠區對照管理",
  "admin.factoryMappings.syncFromErp": "從 ERP 同步"
  // ...
}
```

| 檔案 | 新增 key |
|------|---------|
| `client/src/i18n/locales/zh-TW.json` | 廠區相關 |
| `client/src/i18n/locales/en.json` | Factory 相關 |
| `client/src/i18n/locales/vi.json` | Nhà máy 相關 |

---

## 4. DB 改動總結

| 類型 | 項目 |
|------|------|
| 新建表 | `FACTORY_CODE_MAPPINGS` |
| 新建表 | `FACTORY_CODE_TRANSLATIONS` |
| 不需改 | 9 張 share/access 表（grantee_type 本來就是 VARCHAR，不需 DDL） |
| 不需改 | `users.factory_code`（已存在） |

---

## 5. 實作順序

### Phase 1：基礎建設
1. 建立 `FACTORY_CODE_MAPPINGS` + `FACTORY_CODE_TRANSLATIONS` 表（database-oracle.js）
2. Admin API — CRUD + ERP 同步
3. Admin UI — 廠區對照管理頁面
4. 種子資料 — 從 ERP 初始拉取 distinct factory_code

### Phase 2：LOV API + 型別
5. `types.ts` 加 `'factory'` 到 ShareGrantee
6. `GET /lov/org` 加入 factories 回傳
7. `GET /dashboard/orgs` 加入 factories 回傳

### Phase 3：前端 Share UI
8. `ShareModal.tsx` — 加廠區 grantee type + 選擇器
9. `TemplateShareModal.tsx` — 同上
10. `CourseShareTab.tsx` — 同上
11. i18n 三語言檔加 key

### Phase 4：後端權限檢查
12. `dashboard.js` — 所有 checkAccess 函式加 factory OR 條件
13. `chat.js` — 工具存取檢查加 factory
14. `skills.js` / `mcpServers.js` / `difyKnowledgeBases.js` — 列表過濾加 factory
15. `docTemplates.js` — 同上
16. `training.js` — 同上

### Phase 5：Share CRUD 補完
17. 所有 POST share 路由 — grantee_type 驗證接受 factory
18. 所有 GET share 路由 — name resolution 加 factory 分支

---

## 6. 待確認事項

- [ ] ERP `APPS` schema 是否有 factory master table（有名稱欄位）？有的話可省掉對照表
- [ ] 目前系統有哪些 factory_code 值？跑 `SELECT DISTINCT factory_code FROM users WHERE factory_code IS NOT NULL` 確認
- [ ] 廠區對照管理放在 Admin 的哪個位置？獨立 tab 或歸在「組織管理」下？
- [ ] 是否需要支援「廠區 + 部門」的組合權限？（目前各 grantee_type 是 OR 關係，非 AND）
