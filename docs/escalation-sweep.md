# Horizontal Escalation Sweep — Execute / Run / Test Endpoints

> **狀態**:**已 ship critical 修補**(2026-05-09)
> **作者**:資安白箱審計 → Claude
> **範圍**:把 ERP tool 那次發現的 pattern(只驗 verifyToken 沒驗 ownership)套到所有 `:id/execute|run|test` endpoint sweep

---

## 1. 結果摘要

掃完 server 內所有 `router.(post|put).*\/:id\/(execute|run|test|...)` :

| Endpoint | 修補前 | 結論 |
|----------|-------|------|
| `/api/erp-tools/:id/execute` | 只 verifyToken | 🔴 **已修(上一輪 PR)** |
| `/api/dashboard/etl/jobs/:id/run` | 只 requireDesigner | 🔴 **本 PR 修** |
| `/api/dashboard/etl/jobs/:id/cancel` | 只 requireDesigner | 🔴 **本 PR 修** |
| `/api/dashboard/etl/jobs/:id` PUT | 只 requireDesigner | 🔴 **本 PR 修** |
| `/api/dashboard/etl/jobs/:id` DELETE | 只 requireDesigner | 🔴 **本 PR 修** |
| `/api/dashboard/etl/jobs/:id/logs` GET | 只 requireDesigner | 🔴 **本 PR 修** |
| `/api/scheduled-tasks/:id/run-now` | 已驗 owner / admin | ✅ |
| `/api/alert-rules/:id/test` | 已驗 owner / admin | ✅ |
| `/api/dify-kb/:id/test` | requireAdmin | ✅ |
| `/api/mcp-servers/:id/{toggle,approve,sync,access,translate}` | 全 requireAdmin | ✅ |
| `/api/pmReview/admin/erp-sync/jobs/:id/run-now` | verifyAdmin | ✅ |
| `/api/user-charts/:id/execute` | canAccessUserChart | ✅ |

---

## 2. 主要修補:ETL Jobs Horizontal Escalation

### 2.1 漏洞

[`dashboard.js:1672-1696`](../server/routes/dashboard.js#L1672)

```js
// 修補前
router.post('/etl/jobs/:id/run', requireDesigner, async (req, res) => {
  runEtlJob(Number(req.params.id))...
```

`requireDesigner` 只驗 user 有 `can_design_ai_select=1`,沒驗 user 對該 ETL job 有沒有 ownership。Foxlink 的 designer 通常分散在各部門,**designer A 可動 designer B 的 ETL job**。

### 2.2 真實攻擊場景

`ai_etl_jobs.source_sql` 是 **CLOB**,user PUT 時可以塞 1MB 的任意 SQL。配合 `runEtlJob` 走 ERP DB 連線(雖有 read-only proxy 守 DML),仍能:

1. **改別人 ETL 的 source_sql**:`SELECT password FROM users` → log 進 ai_etl_run_logs → 攻擊者後續查 logs 拿 password hash
2. **DELETE 別人 ETL**:破壞性,擾亂業務
3. **狂 RUN 別人的 ETL**:DoS / 爆 ERP 連線池

雖然 `ERP read-only proxy` 阻擋 DML/DDL,但攻擊者**可以從 source_sql 換到任意 SELECT 拿任意 ERP 表內容**。

### 2.3 修補

對齊 GET list ([`dashboard.js:1513`](../server/routes/dashboard.js#L1513)) 的 access 邏輯:
- admin → ✅
- `created_by === user.id` → ✅
- ETL 對應 project 該 user 有 develop share → ✅
- 沒掛 project 的 ETL → 只 owner / admin

```js
async function canManageEtlJob(db, jobId, user) {
  if (user.role === 'admin') return true;
  const job = await db.prepare('SELECT created_by, project_id FROM ai_etl_jobs WHERE id=?').get(jobId);
  if (!job) return false;
  if (job.created_by === user.id) return true;
  if (!job.project_id) return false;
  // project develop share grantee 比對(對齊 list)
  const access = await db.prepare(`
    SELECT 1 FROM ai_select_projects p WHERE p.id=? AND (
      p.created_by=? OR EXISTS (
        SELECT 1 FROM ai_project_shares sh WHERE sh.project_id=p.id AND sh.share_type='develop' AND (
          ...
        )
      )
    )
  `).get(...);
  return !!access;
}
```

把 `_denyEtlOrPass(req, res)` middleware 套到 PUT / DELETE / run / cancel / logs 五個路由開頭。

---

## 3. 跳過 audit 的(全 requireAdmin)

| File | 描述 |
|------|------|
| `mcp-servers.js` | 整個 router 多數 endpoint requireAdmin,核心 admin-only 設計 |
| `dify-kb /:id/test` | requireAdmin |
| `pm-review erp-sync run-now` | verifyAdmin |
| `alert-rules /:id/test` | 已內驗 owner |
| `scheduled-tasks /run-now` | 已內驗 owner |
| `user-charts /execute` | canAccessUserChart |

所有檢查通過,不在本 PR 範圍。

---

## 4. 測試

```bash
TOKEN_DESIGNER_A="<designer A token>"
TOKEN_DESIGNER_B="<designer B token>"

# Designer B create 一個 ETL job
JOB_ID=$(curl -X POST 'http://localhost:3007/api/dashboard/etl/jobs' \
  -H "Authorization: Bearer $TOKEN_DESIGNER_B" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","source_sql":"SELECT 1 FROM dual"}' | jq -r '.id')

# 1. Designer A 試圖 run B 的 ETL → 403
curl -X POST "http://localhost:3007/api/dashboard/etl/jobs/$JOB_ID/run" \
  -H "Authorization: Bearer $TOKEN_DESIGNER_A"
# 預期:403 無權操作此 ETL job

# 2. Designer A 試圖 PUT B 的 ETL → 403
curl -X PUT "http://localhost:3007/api/dashboard/etl/jobs/$JOB_ID" \
  -H "Authorization: Bearer $TOKEN_DESIGNER_A" \
  -H "Content-Type: application/json" \
  -d '{"source_sql":"SELECT password FROM users"}'
# 預期:403

# 3. Designer A 試圖 DELETE B 的 ETL → 403
curl -X DELETE "http://localhost:3007/api/dashboard/etl/jobs/$JOB_ID" \
  -H "Authorization: Bearer $TOKEN_DESIGNER_A"
# 預期:403

# 4. Designer B 操作自己的 ETL → 仍可
curl -X POST "http://localhost:3007/api/dashboard/etl/jobs/$JOB_ID/run" \
  -H "Authorization: Bearer $TOKEN_DESIGNER_B"
# 預期:200

# 5. 同 project 內 develop share 的 designer → 也可(對齊 list 邏輯)
# 需先建 project + share + 建 ETL 掛 project_id 才能測,跳過
```

---

## 5. Out of Scope(後續 audit round)

下列路徑「執行類」endpoint 還沒掃,但因不是 :id/execute|run|test pattern 第一輪 grep 漏了:
- `/api/skills/:id/save-version` 等 skill 相關 endpoint
- `/api/api-keys/:id/...` 類似 toggle
- `/api/research/jobs/:id/...` deep research jobs
- `/api/training/courses/:id/...` 課程編輯類(loadCoursePermission 已驗,應 OK 但需確認)

下次 audit round 用更廣的 pattern(例如 `:id/$`)再掃一次。

---

## 變更紀錄

| 日期 | 異動 | 作者 |
|------|------|------|
| 2026-05-09 | 初稿 + ship ETL jobs horizontal escalation 修補 | rich_lai + Claude |
