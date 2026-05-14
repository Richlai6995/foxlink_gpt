# 排程任務分享 — 設計文件

> Ship date: 2026-05-14

## 為什麼

Admin 幫 user 建排程,希望 user 能「自己維護」(改 prompt、調時段、加收件人、立刻執行),但**不能刪除、不能改分享、不能新增危險節點繞權限**。

對齊既有 KB / Skill / 戰情 design 的 7 grantee_type 分享模型 + 兩級權限。

---

## 權限矩陣

| 動作 | use(檢視)| develop(開發)| owner | admin |
|---|---|---|---|---|
| 看到任務、看設定、看歷史、下載產出 | ✅ | ✅ | ✅ | ✅ |
| 立刻執行 ▶ | ❌ | ✅ | ✅ | ✅ |
| 改 prompt / pipeline / 時段 / 收件人 | ❌ | ✅ | ✅ | ✅ |
| 啟用/停用 toggle | ❌ | ✅ | ✅ | ✅ |
| 改分享設定 | ❌ | ❌ | ✅ | ✅ |
| **刪除任務** | ❌ | ❌ | ✅ | ✅ |
| **新增 db_write / kb_write / alert 節點** | ❌ | ❌ (整段封禁) | ✅ | ✅ |

**核心保證**:**排程觸發時的執行身份永遠 = task.user_id(owner)**,develop 受贈者改了內容也不會切權限。

---

## 危險節點封禁(整段)

任務的 `pipeline_json` 含有 `db_write` / `kb_write` / `alert` 任一節點 → **完全禁止分享 `share_type='develop'`**(只能 view)。

理由:這些節點是用 owner 權限寫進敏感表 / 知識庫 / 觸發告警的,如果允許 develop user 改 column_mapping,就等同**用 admin 權限亂寫資料**。整段封禁(B 方案)是最簡單、可解釋、不踩雷的設計。

| 場景 | 行為 |
|---|---|
| 任務有危險節點 → 嘗試 POST share `share_type='develop'` | 403 + 訊息「不允許分享 develop 權限」 |
| 任務無危險節點 → 分享 develop 給 user → user 改 pipeline 加上 db_write | 403 + 訊息「develop 不可新增 db_write 節點」 |
| 任務有危險節點 → 分享 `share_type='use'` | ✅ OK,user 只能看不能改 |

實作位置:
- POST share:[scheduledTasks.js: POST /:id/shares](../server/routes/scheduledTasks.js)
- PUT task:[scheduledTasks.js: PUT /:id](../server/routes/scheduledTasks.js) 對 develop 角色額外檢查新 pipeline

---

## 資料模型

```sql
CREATE TABLE scheduled_task_shares (
  id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id      NUMBER NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  grantee_type VARCHAR2(20) NOT NULL,  -- user/role/department/cost_center/division/factory/org_group
  grantee_id   VARCHAR2(100) NOT NULL,
  share_type   VARCHAR2(20) DEFAULT 'use' NOT NULL,  -- use / develop
  granted_by   NUMBER,
  created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT scheduled_task_shares_uk UNIQUE (task_id, grantee_type, grantee_id)
)
```

對齊 `ai_dashboard_shares`:
- 同 7 種 grantee_type
- 同 unique constraint
- 同 FK + cascade(刪 task 時自動清 shares)

---

## 列表 SQL 改造

`GET /api/scheduled-tasks` 現在回傳:
- admin:所有 task + `share_role='admin'`
- user:自己的 + 被分享的 + 每筆計算 `share_role` 欄位

```sql
-- user view
SELECT t.*,
       CASE WHEN t.user_id = ? THEN 'owner'
            WHEN EXISTS (...develop share...) THEN 'develop'
            ELSE 'use'
       END AS share_role
FROM scheduled_tasks t
WHERE t.user_id = ?
   OR EXISTS (...any share...)
```

`share_role` 給前端決定 icon 顯示(分享 / 刪除按鈕只有 admin/owner 看得到)。

---

## 程式碼定位

### Backend
| 檔案 | 改動 |
|---|---|
| [database-oracle.js](../server/database-oracle.js) | `createTable('SCHEDULED_TASK_SHARES', ...)` 對齊 ai_dashboard_shares |
| [routes/scheduledTasks.js](../server/routes/scheduledTasks.js) | `resolveTaskRole()` helper、`hasDangerousNodes()` helper、列表 SQL OR EXISTS、PUT/DELETE/toggle/run-now 改用 role check、新增 3 個 shares endpoints |

### Frontend
| 檔案 | 改動 |
|---|---|
| [components/common/ShareModal.tsx](../client/src/components/common/ShareModal.tsx) | re-export from `dashboard/ShareModal`(新功能用這個語意正確的 path) |
| [components/dashboard/ShareModal.tsx](../client/src/components/dashboard/ShareModal.tsx) | 增強:`shareTypeOptions` / `defaultShareType` / `hint` / `headerTitle` props,既有 6 caller 0 破壞 |
| [components/admin/ScheduledTasksPanel.tsx](../client/src/components/admin/ScheduledTasksPanel.tsx) | 列表 row 加分享 icon(admin/owner 才顯示)、TaskFormModal header 加分享按鈕、root render ShareModal |
| [types.ts](../client/src/types.ts) | ScheduledTask 加 `share_role?` 欄位 |
| `i18n/locales/{zh-TW,en,vi}.json` | scheduledTask.share / shareTypeUse / shareTypeDevelop / shareHint |

---

## 測試 checklist

### 基本
- [ ] admin 建任務 → row icon 出現「⌗ 分享」→ 開 modal 加 grantee → 列表顯示
- [ ] admin 加 user A `share_type='use'` → A 登入後看到此任務在列表(share_role='use')
- [ ] A 編輯任務 → 403(use 無權編輯)
- [ ] A 立刻執行 ▶ → 403(use 不能 run-now)
- [ ] admin 改 A 為 develop → A 編輯任務 → ✅,改 prompt / pipeline / 時段 / 收件人 / toggle OK
- [ ] A 立刻執行 ▶ → ✅
- [ ] A 嘗試刪除 → 403(develop 不能 delete)

### 危險節點封禁
- [ ] admin 建 task 含 db_write 節點 → 嘗試分享 develop → 403「不允許分享 develop 權限」
- [ ] admin 改回成 view 分享 → ✅
- [ ] admin 建 task 不含危險節點 → 分享 develop 給 user → user 在 pipeline 加 db_write → PUT 失敗 403

### 執行身份(關鍵)
- [ ] admin 建 task(用 admin 才能看的 AI 戰情 design)→ develop 分享給 user
- [ ] user 改 question → 立刻執行 → **要成功**(因為以 admin 名義跑)
- [ ] 此時 user 自己連那個 design 都看不到,但排程跑出 Excel 寄到 user 信箱 ✅

### Cascade
- [ ] admin 刪 task → scheduled_task_shares 自動清(FK ON DELETE CASCADE)
- [ ] 確認 `SELECT * FROM scheduled_task_shares WHERE task_id=<deleted>` 回 0 列

### UI
- [ ] 編輯頁 header 出現「⌗ 分享」按鈕(只在 admin/owner + isEdit 時)
- [ ] 點按鈕 → ShareModal 蓋在 TaskFormModal 上 → 關 ShareModal 後仍看到編輯頁

---

## 後續(未做)

- 列表 row 標示「(分享自 ADMIN)」讓被分享 user 知道任務不是自己建的
- Audit log:誰改了什麼欄位、何時改的(目前 develop 改任務沒留痕)
- Transfer ownership(把 task.user_id 整個移交)— 獨立 endpoint,跟 share 解耦
