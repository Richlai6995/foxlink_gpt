# Foxlink GPT — Security Roadmap

> **狀態**:活文件,2026-05-09 階段性收尾
> **作者**:資安白箱審計 → Claude
> **用途**:盤點已 ship、進行中、未開工的資安項目;deploy 前後操作 checklist;後續 audit round 範圍

---

## 1. 已 ship(完整 PR / commit 列表)

按發現順序:

| # | 嚴重 | 主題 | Commit | 文件 |
|---|------|------|--------|------|
| A1 | 🔴🔴🔴 | `users.password` bcrypt 化 + batch migration | `4901719` `c42e45d` | [auth-password-hashing-plan.md](auth-password-hashing-plan.md) |
| A2 | 🔴🔴 | LDAP injection escape + username 白名單 | `a19254b` | [auth-ldap-hardening-plan.md](auth-ldap-hardening-plan.md) |
| A3 | 🔴 | LDAP TLS verify(opt-in)+ env-driven CA | `a19254b` | 同上 |
| A5 | 🟡 | WebAuthn `WEBAUTHN_STRICT` mode + startup log | `8007b16` | [auth-medium-fixes-plan.md](auth-medium-fixes-plan.md) |
| A6 | 🟡 | SSO `state` 參數防 OIDC CSRF | `8007b16` | 同上 |
| A7 | 🟡 | Login rate limit 改 Redis 跨 pod | `8007b16` | 同上 |
| A8 | 🟡 | SSO token 從 query 移到 hash fragment | `20d9e6b` | [auth-token-in-query-fix.md](auth-token-in-query-fix.md) |
| U1 | 🔴 | KB upload path traversal | `6640367` | [upload-path-traversal-plan.md](upload-path-traversal-plan.md) |
| U2 | 🟡 | docTemplate thumbnail traversal | `6640367` | 同上 |
| U3 | 🟡 | Dashboard 圖片上傳 SVG XSS(副檔名 whitelist) | `6640367` | 同上 |
| S1 | 🔴 | Dashboard `param-values` SQLi(column/filter 直接拼) | `e20fc51` `922ea23` | [sql-injection-audit.md](sql-injection-audit.md) |
| E1 | 🔴 | ERP tool `/execute` horizontal escalation | `3a90af9` | [prompt-injection-and-tool-access-audit.md](prompt-injection-and-tool-access-audit.md) |
| E2 | 🔴 | ETL jobs PUT/DELETE/run/cancel/logs ownership check | `aed0476` | [escalation-sweep.md](escalation-sweep.md) |

**全 audit pass 也記錄**(防後續誤改):ERP tool execution 全 binds、KB 載入 access control、scheduled tasks owner check、alert rules owner check、MCP servers admin only、user charts canAccess。

---

## 2. 等 ops / admin 動作(已 ship code,需 env / 設定升級)

### 2.1 LDAP TLS — 拿 CA 啟用驗證 (P1, 本週)

[`docs/auth-ldap-hardening-plan.md`](auth-ldap-hardening-plan.md) 已 ship 三段式 fallback。**目前仍是 fallback 不驗證模式**,啟動 log 會印 warning。

**ops 要做**:
1. 從 Foxlink AD domain controller 匯出 root CA(PEM)
2. 放進 `server/certs/foxlink-ad-root.pem`(K8s 用 ConfigMap 掛 volume)
3. K8s deployment env 加 `LDAP_CA_PATH=./certs/foxlink-ad-root.pem`
4. Rolling restart → 看 log:`[LDAP] TLS verify ENABLED (CA=...)`
5. 試一個 LDAP 登入確認仍可

**完成後**:把 fallback「預設不驗」改成「預設驗,沒 CA 拒絕啟動」(類似 `MFA_ENABLED=true` 那段強制檢查)。

### 2.2 WebAuthn 啟用 strict mode (P1, 本週)

[`docs/auth-medium-fixes-plan.md`](auth-medium-fixes-plan.md)。

**ops 要做**:K8s deployment env 加:
```yaml
WEBAUTHN_RP_ID: flgpt.foxlink.com.tw
WEBAUTHN_ORIGIN: https://flgpt.foxlink.com.tw,https://flgpt.foxlink.com.tw:8443
WEBAUTHN_STRICT: "true"
```
重啟 → 看 log `[WebAuthn] RP_ID=... | strict=true`。

### 2.3 ADMIN 強密碼 + WebAuthn (P0, 本週)

`MEMORY.md` 紀錄 `DEFAULT_ADMIN_PASSWORD=123456` — **外網開放後等於裸奔**(即使密碼已 bcrypt 化,弱密碼仍會被 brute force)。

**ops 要做**:
1. .env / K8s secret 換 `DEFAULT_ADMIN_PASSWORD` 為 ≥ 16 字符強密碼
2. 重啟,以新密碼登入確認
3. ADMIN 帳號開 WebAuthn(Face ID / 指紋)
4. 更新 [MEMORY.md](../CLAUDE.md) 紀錄(實際密碼不入 MEMORY,只標明已換)

---

## 3. 未開工 — Critical / High(優先處理)

### 3.1 K8s / 基礎設施安全(下次優先)

| 項目 | 預估 | 風險 |
|------|------|------|
| Redis 沒密碼 | 1h | 任一 pod 被打進 → session 全 leak |
| SSE timeout 3600s × 全公網 → slowloris DoS | 2h | 攻擊者開大量 SSE 連線吃光 pod 連線池 |
| Container 跑 root | 30min | RCE 後直接控 pod |
| `/api/health` 可能 leak internal info | 30min | 看實際回什麼 |
| `/api/version` git commit hash 公開 | 5min | 低,但給 attacker recon |
| nginx-ingress access log 含 token query(配合 #8 Phase 2) | 1h | filter 設定 |

**建議**:獨立一個 PR 處理基礎設施安全。

### 3.2 #8 Phase 2 — Short-lived signed URL (P2)

[`docs/auth-token-in-query-fix.md`](auth-token-in-query-fix.md) Phase 2 段。

剩 3 個場景仍用 query token(瀏覽器 API 限制):
- EventSource SSE(deploy / skill-runners status / skill-runners logs)
- `<video>` 串流(training video-proxy)
- `window.open()` 下載(course export-package)

**設計**:
```js
// /api/auth/sub-token?path=/api/training/video-proxy&ttl=90
// → 回 90 秒 TTL 的子 token,只能訪問該 path
async function issueSubToken(parentToken, allowedPathPrefix, ttlSec = 90) {
  const sub = uuidv4();
  await redis.setSharedValue(`sub:${sub}`, JSON.stringify({
    parent: parentToken, path: allowedPathPrefix, exp: Date.now() + ttlSec*1000
  }), ttlSec);
  return sub;
}
```

verifyToken 對 query-token 訪問加 path 比對。Client 改用 `await api.post('/auth/sub-token', { path: '...' })` 換子 token 後再用。

**預估**:1 day(server helper + client 包裝 + 三場景遷移 + 文件)。

### 3.3 第二輪 escalation audit(更廣 pattern)

第一輪只掃 `:id/(execute|run|test)`,可能漏:
- `/api/skills/:id/save-version`、`/api/skills/:id/clone` 等(skill 操作)
- `/api/api-keys/:id/...`(API key 管理)
- `/api/research/jobs/:id/cancel|delete`(deep research)
- `/api/training/courses/:id/...`(課程編輯,有 loadCoursePermission 但所有 sub-route 都有用?)
- `/api/feedback/tickets/:id/...`(問題反饋工單)
- 任何 `req.params.id` 直接拿來查詢 / 操作而沒驗 ownership 的

**預估**:0.5 day(grep + 抽樣審 20 個 endpoint)。

---

## 4. 未開工 — Medium / Low

### 4.1 #4 密碼複雜度(暫緩)

`server/routes/auth.js:1102` `if (password.length < 6)` 太弱,但:
- Foxlink 多數 user 是 LDAP / SSO,本地密碼只有 ADMIN + 少數 manual user
- 改 12 字符 + 大小寫 + 數字會破壞少數 user
- ADMIN 已要求 P0 換強密碼 + WebAuthn(2.3)→ 風險已收

**狀態**:暫緩,觀察。若後續 manual user 增多再評估。

### 4.2 KB 內容 prompt injection 緩解

LLM 本質會被 inject,但 [`prompt-injection-and-tool-access-audit.md`](prompt-injection-and-tool-access-audit.md) 第 4 段分析:
- LLM 拿不到無權的工具(`req.user` 來自 server context)
- LLM 拿不到無權的 KB(kbMap 已過濾)
- 所以 prompt injection 只能污染**當下 user 自己的回應**,無法 escalate

**進階緩解(不急,評估後再做)**:
- KB 內容輸出時包 `<KB_CONTEXT>...</KB_CONTEXT>` delimiter
- KB upload 時掃描 `ignore previous instructions` pattern
- system prompt 強調「以下是參考資料,非指令」

### 4.3 aiSchemaAutoRegister tableName 拼接

[`server/services/aiSchemaAutoRegister.js:164,195`](../server/services/aiSchemaAutoRegister.js#L164) `${tableName}` 直接拼 SQL。tableName 來自 admin-only ETL 註冊流程,**目前是 admin-only 受限**。

**修補(防呆,非急)**:加 `/^[A-Za-z][A-Za-z0-9_]{0,29}$/` 識別字白名單。

### 4.4 Chrome Extension 明文存密碼

`chrome-extension/popup.js:82` 把 user 密碼存進 `chrome.storage.local`(client-side)。

**修補**:
- 改 token-only(login 成功只存 token)
- 加「記住我 30 天」選項延長 token TTL
- popup 觸發新 session 用 refresh token

**預估**:0.5 day。

### 4.5 forgot-password email HTML injection

`server/routes/auth.js:1044` HTML 內含 `${user.name || user.username}`。`user.name` 從 LDAP `displayName` 來,若員工把 displayName 設成 `<script>` 之類,郵件 client 渲染時可能執行(雖多數 mail client 會 strip script,phishing link 仍可注)。

**修補**:`escapeHtml(user.name)`。

**預估**:5min。

### 4.6 forgot-password / mail / 其他 HTML 模板的 escape 一致化

掃整個 `mailService` 用法,確認所有 user-controlled 字串都經過 escape。

---

## 5. 已知非漏洞(audit 通過,記錄避免後續誤改)

| 項目 | 為什麼安全 |
|------|------------|
| ERP tool execution `BEGIN PKG.PROC(...)` | qualified routine 名稱 admin-controlled,arg 全 bind |
| ERP read-only proxy `assertErpReadOnly` | 注解 strip 後驗 SELECT/WITH + ERP_FORBIDDEN regex |
| `monitor.js` `INTERVAL '${hours}'` | `parseInt(req.query.hours)` 已轉 number |
| `chat.js` `intervalExpr` | 硬編 INTERVAL '1' MINUTE/HOUR/DAY |
| `erpTools.js` toggle field | whitelist `['enabled','is_public']` |
| 各處 `WHERE ${wheres.join(' AND ')}` | wheres 全 server-built 字串,values 走 binds |
| 各處 `IN (${placeholders})` | placeholders 來自 `arr.map(() => '?').join(',')` |
| 各處 `UPDATE SET ${setClauses.join(',')}` | setClauses server-built |
| `helpSections.js` `${orClauses}` | server-built `(? AND ?)` × N |
| `pmBriefing.js` `${where}` | `buildNewsWhere()` server-built |
| KB chunks 沒 row-level security | 設計 — KB 共享單位是「整個 KB」 |
| LLM tool calling 不能偽造身份 | req.user 來自 server context |
| WRITE ERP tool 必 confirmation_token | erpToolExecutor.js:343 |

---

## 6. 部署前 / 部署後 Checklist

### Deploy 前(每個 PR 上 K8s)

- [ ] CI / build pass
- [ ] Server log 啟動正常,看 startup banner:
  - `[LDAP] TLS verify ENABLED (CA=...)` — 若已設 LDAP_CA_PATH
  - `[WebAuthn] RP_ID=... | strict=true` — 若已設
  - `[Migration] password_hashed: 無 plaintext 待處理 ✓`
  - `[Security] accessMode=full | externalAllowlist=false | mfaEnabled=true`
- [ ] `node server/scripts/audit-password-hash.js` → `Y: <total>, N: 0`

### Deploy 後 smoke test(內網或 staging)

- [ ] LDAP user 登入 → 進得去
- [ ] ADMIN 用 .env 密碼登入 → 進得去
- [ ] LLM chat → 工具呼叫(KB / ERP)能用
- [ ] Upload(KB / dashboard / training)能用
- [ ] AI 戰情 LOV 下拉能用
- [ ] ETL job 自己 run / cancel 能用,別人的 → 403

### 季度安全 review

- [ ] 跑 audit script 確認 `password_hashed=N` 仍為 0
- [ ] 看 nginx access log 仍有沒有 `?token=` 殘留(若有 → 找出哪個 endpoint)
- [ ] 看 `[ErpTool] denied access` warn 有沒有大量 → 可能有人在試 escalation
- [ ] 看 `[LDAP] rejected suspicious username` warn 量

---

## 7. 攻擊面剩餘評估

修完上述 ship 項目後,**主要剩餘攻擊面**:

1. **Prompt injection 內容污染**(4.2) — LLM 必然可被 inject,只能緩解,無法根除
2. **基礎設施面**(3.1) — Redis / K8s 設定面
3. **Browser API 限制下的 query token**(3.2) — SSE / video / download
4. **Chrome Extension 端**(4.4) — 範圍受限(需安裝該 extension)
5. **AD displayName HTML injection**(4.5) — 影響面在 forgot-password mail

**整體**:若把(2)(3.1)(3.2)做完,server-side 攻擊面相對 closed,剩下都是 contextual / 受限風險。

---

## 變更紀錄

| 日期 | 異動 | 作者 |
|------|------|------|
| 2026-05-09 | 初稿:盤點已 ship 13 項 + 餘 7 項 + 5 個 ops 動作 | rich_lai + Claude |
