# SQL Injection Audit — ERP / AI 戰情 / 全域動態 SQL

> **狀態**:**已 ship critical 修補**(2026-05-09)
> **作者**:資安白箱審計 → Claude
> **範圍**:盤點所有 server 內動態 SQL,找出 user input 直接拼接進 SQL 字串的點

---

## 1. 全域 audit 結論

掃完 60+ 個 `${...}` 進 SQL 字串的點,結論按嚴重度分:

### 🔴 Critical(已修)

| 位置 | 漏洞 | 修補 |
|------|------|------|
| [`dashboard.js:2737`](../server/routes/dashboard.js#L2737) `cascadeClause` | `filter_column` 直接拼 + `filter_value` 只 escape `'` | identifier whitelist + bind 變數 |
| [`dashboard.js:2743-2746`](../server/routes/dashboard.js#L2743) `param-values SQL` | `column_name` / `source` / `searchFilter` 全拼 | identifier whitelist + bind LIKE |

### ✅ 已有保護(audit pass,不修)

| 位置 | 為什麼安全 |
|------|------------|
| `erpToolExecutor.js:541-543` `BEGIN ${qualified}(${argFragments})` | `qualified` = admin 設的 routine 名稱(server-trusted);`argFragments` 全是 `=> :bindName` 走 binds |
| `dashboardService.js:84-86` `assertErpReadOnly` | ERP read-only proxy 阻擋所有 DML/DDL,只准 SELECT/WITH(注解被 strip 後再驗) |
| `monitor.js:403/414/558/572` `INTERVAL '${hours}' HOUR` | `parseInt(req.query.hours)` 已轉數字,fallback 24 |
| `chat.js:2225/2232` `${intervalExpr}` | 硬編三選一 `INTERVAL '1' MINUTE/HOUR/DAY` |
| `erpTools.js:917` `UPDATE erp_tools SET ${field}` | `allowed = ['enabled','is_public']` whitelist |
| `erpTools.js:816` audit-log `${toolId}` | `Number(req.query.tool_id)` |
| `admin.js:1910` token cost `WHERE ${wheres.join(' AND ')}` | wheres 全是硬編字串(`u.factory_code = ?` 等),user input 全走 `?` binds |
| `helpSections.js:36/40/59/63` `${orClauses}` | `(grantee_type = ? AND grantee_id = ?)` × N,server-built |
| `pmBriefing.js:530/748` `${where}` | `buildNewsWhere()` 內部 `where.push('col = ?'); params.push(v)`,bind 走完 |
| 多處 `IN (${placeholders})` | placeholders = `'?,?,?'` 來自 `arr.map(() => '?').join(',')`,server-built |
| 多處 `UPDATE ... SET ${setClauses}` | setClauses 來自 server 配對(`fields.push('col=?')`),user value 走 binds |

### ⚠️ Admin-only flow,風險受限(本 PR 不動)

| 位置 | 風險 | 為什麼不在此 PR 修 |
|------|------|------|
| `aiSchemaAutoRegister.js:164/195` `${tableName}` | 拼 source SQL,tableName 來自 ETL job / admin 註冊 | admin-only flow,且 tableName 一旦寫進 schema 後續查詢仍由 admin 控 |
| `dashboard.js:486/824` `${filter}` 等 | server-built whereparts | server-built,風險低 |

---

## 2. 主要修補:`dashboard.js` param-values

### 2.1 攻擊面

`GET /api/dashboard/saved-queries/param-values` 給 LOV 下拉用,query 參數:
- `schema_id`(指向 admin 設的 schema)
- `column_name`(要 distinct 的欄位)
- `filter_column` / `filter_value`(父欄位 cascade)
- `search`(LIKE 搜尋)

權限:`requireDashboard` — admin / `can_use_ai_dashboard=1` / 有共享 project 的 user 都可。**不限 admin**,任何戰情權限都能 hit。

### 2.2 漏洞 payload(修補前)

```bash
# Payload 1:抓任意欄位 → leak users.password (即使 hash 仍是結構洩漏)
curl 'http://localhost:3007/api/dashboard/saved-queries/param-values?schema_id=1&column_name=PASSWORD'

# Payload 2:filter_column injection
curl 'http://localhost:3007/api/dashboard/saved-queries/param-values?schema_id=1&column_name=ID&filter_column=1=(SELECT+password+FROM+users+WHERE+id=1)--&filter_value=x'
```

ERP read-only proxy 擋 DML,但 SELECT injection 仍能 leak DB 內容。

### 2.3 修補關鍵

```js
// 識別字白名單(Oracle bind 不支援 identifier)
const IDENT_RE       = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;
const TABLE_IDENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,29}(\.[A-Za-z][A-Za-z0-9_]{0,29})?$/;

if (!IDENT_RE.test(String(column_name))) return res.status(400)...;
if (filter_column && !IDENT_RE.test(String(filter_column))) return res.status(400)...;

// 值改 bind 變數
binds.p_filter_value = String(filter_value);
binds.p_search = `%${searchFilter}%`;
sql = `... WHERE ${col} = :p_filter_value AND UPPER(${col}) LIKE UPPER(:p_search)`;

// table_name 從 schemaDef 來,server-trusted,但仍驗格式 + 長度上限防呆
if (schemaDef.source_type === 'sql') {
  if (ss.length > 8192) return res.status(400)...;
  source = `(${ss})`;
} else {
  if (!TABLE_IDENT_RE.test(tableName)) return res.status(400)...;
}
```

---

## 3. ERP Tool Execution(白箱深審結論)

LLM-driven attack 最擔心的路徑:`POST /api/erp-tools/:id/execute` → `executor.execute()` → `BEGIN PKG.PROC(...) END;`。

**結論:安全**。

```js
// erpToolExecutor.js:519-543
binds[bindName] = { dir: oracledb.BIND_IN, type: ..., val: coerceInput(raw, p) };
argFragments.push(`${p.name} => :${bindName}`);
sql = `BEGIN ${qualified}(${argFragments.join(', ')}); END;`;
```

- `qualified` = admin 設定的 `OWNER.PACKAGE.PROC`(從 `erp_tools` 表讀,**非 LLM 可控**)
- 每個 input 參數走 `=> :bindName`,**100% bind**
- LLM 即使 prompt injection 想吐惡意 payload,只能影響 input value(被 coerceInput / oracledb bind 處理)

LLM 唯一能傷的是「亂呼叫 admin 配的工具」— 這是工具設計權限問題,不是 SQLi。

---

## 4. ERP Read-only Proxy(現有保護機制)

[`dashboardService.js:51-66`](../server/services/dashboardService.js#L51) 的 `assertErpReadOnly` 是 **重要的多層防護**:

```js
function assertErpReadOnly(sql) {
  const stripped = sql.replace(/--.../g, ' ').replace(/\/\*...\*\//g, ' ').trim();
  if (!/^\s*(SELECT|WITH)\b/i.test(stripped)) throw new Error('[ERP 唯讀保護]...');
  if (ERP_FORBIDDEN.test(stripped)) throw new Error('[ERP 唯讀保護] DML/DDL...');
}
```

注解先 strip → 再驗開頭 → 再驗禁字。這擋住:
- `SELECT ...; DROP TABLE` (multi-statement)
- `WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x` (CTE 內 DML)
- `BEGIN EXECUTE IMMEDIATE 'DROP'; END;` (PLSQL)
- 加注解混淆 (`/*xx*/ DROP` `-- xx \n DROP`)

所有 dashboard / AI 戰情 SQL 都走這層 → **即使有 SELECT injection,也無法 DML/DDL**。

---

## 5. 測試

### 5.1 已 fix 的攻擊應該 400

```bash
TOKEN="<your token>"

# 1. column_name injection → 400
curl "http://localhost:3007/api/dashboard/saved-queries/param-values?schema_id=1&column_name=1+UNION+SELECT+1+FROM+dual" \
  -H "Authorization: Bearer $TOKEN"
# 預期:400 欄位名稱格式錯誤

# 2. filter_column injection → 400
curl "http://localhost:3007/api/dashboard/saved-queries/param-values?schema_id=1&column_name=ID&filter_column=1=1--&filter_value=x" \
  -H "Authorization: Bearer $TOKEN"
# 預期:400 filter_column 格式錯誤

# 3. 正常 LOV 查詢 → 200
curl "http://localhost:3007/api/dashboard/saved-queries/param-values?schema_id=1&column_name=PROFIT_CENTER" \
  -H "Authorization: Bearer $TOKEN"
# 預期:200 + JSON array
```

### 5.2 ERP read-only proxy 防呆

無需額外測試,本來就在跑。Server log 看到 `[ERP 唯讀保護] 僅允許 SELECT / WITH...` warning 即代表攻擊被擋。

---

## 6. Out of Scope(後續 PR)

- `aiSchemaAutoRegister.js` 的 tableName 拼接 — admin-only flow,風險受限,後續可加 identifier 白名單防呆
- 把 `assertErpReadOnly` 抽成共用 lib,讓所有 user-driven SQL 路徑都走過(預防將來新增 endpoint 漏設)
- 加 SQL injection regression test(對所有 query endpoint 自動跑 payload)

---

## 變更紀錄

| 日期 | 異動 | 作者 |
|------|------|------|
| 2026-05-09 | 初稿 + ship dashboard.js param-values 修補 | rich_lai + Claude |
