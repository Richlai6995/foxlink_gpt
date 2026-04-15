# MCP User Identity 認證規劃

> **目的**：讓 MCP 伺服器端收到可信的「使用者身份」,以便 MCP 自己判斷資料權限(例如 email → AD group → data filter),不再依賴 FOXLINK GPT 端的分享/RBAC 設定。
>
> **範圍**：本文件只規範 FOXLINK GPT ↔ MCP 伺服器之間的認證傳遞方式。不改變 MCP Tool Protocol 本身(JSON-RPC / SSE / streamable-http)。
>
> **狀態**:Draft,需 MCP 開發團隊確認規格後實作。

---

## 1. 背景與需求

### 1.1 現況
FOXLINK GPT 呼叫 MCP 時:
- 只在 `Authorization: Bearer <api_key>` header 帶一把**服務層 API Key**(identifies the caller as FOXLINK GPT)
- **不傳送使用者身份** → MCP 無法知道現在是哪位 login user 在用
- 使用者權限由 FOXLINK GPT 端的 `mcp_access` 表控管(per user / role / dept / factory)

### 1.2 MCP 團隊需求
1. MCP 要自己做**資料權限控管**(例如只讓 A 部門看 A 部門資料)
2. **不信任** FOXLINK GPT 端的權限設定(希望在自己端有最終判權)
3. 關鍵資訊:**使用者 email**(搭配 MCP 自己的 AD 查詢邏輯)

### 1.3 為什麼不直接用 OAuth 2.0 Client Credentials / 完整 JWT 簽發流程
- 內部系統,過度設計
- Client Credentials 只解決「服務身份」,不帶 user → 要解決 user 還是得自己簽
- 走完整 OAuth Authorization Code Flow 對 MCP 開發者也過於複雜

---

## 2. 提案:HS256 短效 JWT 夾在 `X-User-Token` header

### 2.1 設計原則
- **零 schema 變動**(不動 `mcp_servers` 表)
- **與現有 api_key 認證並存**(Bearer 繼續代表服務信任,JWT 另外代表 user 身份)
- **對稱金鑰**(HS256),共享一把 secret → 部署與驗證最簡單
- **短效 token**(5 min exp)→ 洩漏後影響面小,不需 revoke 機制

### 2.2 請求範例

```http
POST /mcp HTTP/1.1
Host: mcp.foxlink.internal
Content-Type: application/json
Authorization: Bearer <MCP_API_KEY>            ← 服務身份(現有)
X-User-Token: eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6...   ← 使用者身份(新增)

{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{...}}
```

### 2.3 JWT 規格

| 欄位 | 值 | 說明 |
|---|---|---|
| **alg** | `HS256` | HMAC-SHA256,對稱金鑰 |
| **secret** | 32-byte random(base64) | 透過 .env `MCP_USER_JWT_SECRET` 分發,全公司所有 MCP 共用同一把 |
| **iss** | `"foxlink-gpt"` | Issuer,固定值 |
| **exp** | `iat + 300` | 5 分鐘有效期 |
| **iat** | 發行時 UTC epoch | 標準 |

**Claims payload**:

```json
{
  "iss": "foxlink-gpt",
  "iat": 1744689600,
  "exp": 1744689900,
  "sub": "12345",                    // 員工編號(若無則 user id)
  "email": "peter.wang@foxlink.com",
  "name":  "王小明",
  "dept":  "IT-01"                   // dept_code,可為 null
}
```

### 2.4 MCP 端驗證範例

**Node.js**:
```js
const jwt = require('jsonwebtoken');

function verifyUserToken(req) {
  const token = req.headers['x-user-token'];
  if (!token) throw new Error('Missing X-User-Token');
  return jwt.verify(token, process.env.MCP_USER_JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'foxlink-gpt',
  });
  // → { sub, email, name, dept, iss, iat, exp }
}
```

**Python (PyJWT)**:
```python
import jwt, os
claims = jwt.decode(
    request.headers['X-User-Token'],
    os.environ['MCP_USER_JWT_SECRET'],
    algorithms=['HS256'],
    issuer='foxlink-gpt',
)
```

**Go (golang-jwt/jwt v5)**:
```go
claims := &jwt.RegisteredClaims{}
tok, err := jwt.ParseWithClaims(r.Header.Get("X-User-Token"), claims,
    func(t *jwt.Token) (interface{}, error) {
        return []byte(os.Getenv("MCP_USER_JWT_SECRET")), nil
    },
    jwt.WithValidMethods([]string{"HS256"}),
    jwt.WithIssuer("foxlink-gpt"),
)
```

### 2.5 錯誤處理建議(MCP 端)

| 情境 | HTTP / JSON-RPC error | 行為 |
|---|---|---|
| `X-User-Token` 缺失 | `401 Unauthorized` | 拒絕,回 `{"error":"missing user token"}` |
| JWT 簽章無效 | `401` | 可能是 secret 不一致,紀錄 log |
| JWT `exp` 過期 | `401` | FOXLINK GPT 會在每次呼叫前重簽,不應該遇到 |
| `iss != "foxlink-gpt"` | `401` | 防止其他服務偽用 |
| `email` claim 缺失 | `403 Forbidden` | 不正常情境,紀錄 log |
| 使用者不具備該資料權限 | `403` | 正常業務邏輯,回 MCP 格式錯誤訊息 |

---

## 3. 實作範圍(FOXLINK GPT 端)

### 3.1 改動檔案
| 檔案 | 改動 |
|---|---|
| `server/services/mcpClient.js` | `makeAuthHeaders()` 加 userCtx 參數,簽 JWT 夾 `X-User-Token`;`withSession` / `callTool` signature 加 userCtx |
| `server/routes/chat.js` | 呼叫 `mcpClient.callTool` 時傳 `{ id, email, name, employee_id, dept_code }` |
| `server/.env` | 新增 `MCP_USER_JWT_SECRET=<32-byte base64>` |
| `.env.example` | 同上 |

### 3.2 核心程式碼片段

```js
// mcpClient.js
const jwt = require('jsonwebtoken');

function makeAuthHeaders(apiKey, userCtx) {
  const h = {};
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;

  if (userCtx?.email && process.env.MCP_USER_JWT_SECRET) {
    h['X-User-Token'] = jwt.sign(
      {
        sub:   String(userCtx.employee_id || userCtx.id),
        email: userCtx.email,
        name:  userCtx.name,
        dept:  userCtx.dept_code || null,
      },
      process.env.MCP_USER_JWT_SECRET,
      { expiresIn: '5m', issuer: 'foxlink-gpt', algorithm: 'HS256' }
    );
  }
  return h;
}
```

### 3.3 stdio transport 處理

stdio 子程序沒有 HTTP header → 透過環境變數傳遞:
```js
env.MCP_USER_TOKEN = <JWT>;   // 每次 spawn 前由 FOXLINK GPT 重新簽
env.MCP_API_KEY    = apiKey;
```
MCP stdio server 自 `process.env.MCP_USER_TOKEN` 讀取驗簽。

#### ⚠️ 重要約束:stdio process 必須 per-call spawn,不可常駐

**規則(MUST)**:
- 每次 `tools/call` 都 **spawn 一個新的 stdio 子程序**,執行完畢後立刻 `kill`
- **禁止** keep-alive / process pool / session 重用
- 目前 `server/services/mcpClient.js` 的 `withStdio()` 就是這樣做(於 `finally` 區塊 `proc.kill()`),**後續優化請勿改成長壽命 process**

**為什麼(Why)**:
- `MCP_USER_TOKEN` 的 `exp` 只有 5 分鐘,且環境變數在 process 啟動後**不可更新**
- 若 stdio process 常駐超過 5 分鐘,後續所有 tool call 都會用到**已過期的 token**,MCP 端驗簽必定回 401
- HTTP transport(http-post / streamable-http / http-sse)沒這問題,因為每次請求都現簽 header

**若要改為常駐 process**(Phase 2,非當前範圍):
- 選項 A:把 token 改由 stdin 每次 call 前注入(而不是 env),需擴充 JSON-RPC 訊息格式
- 選項 B:stdio process 透過反向 IPC 向 FOXLINK GPT 重新取 token
- 選項 C:stdio 改走 Unix socket + HTTP(本質就不是 stdio 了)
> 上述皆改變 MCP stdio server 端實作,**屬於破壞性變更,需先跟 MCP 團隊同步**。

**給 AI/Code reviewer 的檢查點**:
- 看到 `withStdio` 裡 `proc.kill()` 被挪出 `finally` → **拒絕 PR**
- 看到新增「stdio session cache / pool」→ **拒絕 PR**
- 看到 `spawn()` 的呼叫位置從 `withStdio` 內移到模組頂層(變 global singleton)→ **拒絕 PR**

---

## 4. Secret 管理

### 4.1 產生
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4.2 分發
- 全公司所有 MCP 共用**同一把** secret(簡單、夠用)
- 存於各 MCP 服務的環境變數 `MCP_USER_JWT_SECRET`
- 不落 DB、不進版控、不寫 log
- Rotation 頻率:1 年(或有人離職/洩漏疑慮時)

### 4.3 Rotation 策略(未來)
若要無痛 rotation:
1. MCP 端同時接受兩把 secret(`MCP_USER_JWT_SECRET_CURRENT` + `_PREVIOUS`)
2. FOXLINK GPT 先改用新 secret
3. 24 小時後 MCP 移除舊 secret
> 初版先不做,單把共用。

---

## 5. 安全考量

| 風險 | 緩解 |
|---|---|
| JWT 被抓包重放 | 5 min exp 限制影響面;K8s 內網 + HTTPS 傳輸 |
| Secret 洩漏 → 偽造任意使用者 | Secret 僅存於 .env / K8s Secret,不進版控;rotation 計畫備用 |
| MCP server 被攻破 → 看到 secret | 所有 MCP 共用同一把 secret 的缺點:任一 MCP 被攻破則所有 MCP 的 user header 都可被偽造。若風險不可接受,改為 per-MCP 獨立 secret(存 `mcp_servers.user_jwt_secret` 欄位) |
| FOXLINK GPT bug 誤夾錯誤 user | 靠 code review + 單元測試(驗證 userCtx 來源一定是 `req.user`) |
| 使用者提權攻擊(改寫 header) | FOXLINK GPT 端 user 只能透過 chat API 間接觸發 MCP 呼叫,無法直接控制 header |

**已知限制**:
- JWT 裡的 `dept` / `name` 是 FOXLINK GPT 從自己 DB 查出來後簽的,若 DB 與 AD 不同步,MCP 拿到可能是舊值。MCP 如需最權威資訊應自己拿 `email` 再查 AD。

---

## 6. 給 MCP 團隊的 Checklist

驗證階段(在任一 MCP 上實作):
- [ ] 確認收到的 `MCP_USER_JWT_SECRET` 可順利驗簽 FOXLINK GPT 產生的 JWT
- [ ] 確認 `email` / `sub` / `name` / `dept` 四個 claim 都可讀到
- [ ] 驗證過期 token(人工塞一個 `exp` 已過的)會被拒
- [ ] 驗證 `iss != foxlink-gpt` 會被拒
- [ ] 缺 `X-User-Token` 時回 401 而非 500
- [ ] stdio 模式 MCP 改自 `process.env.MCP_USER_TOKEN` 讀

回覆我方的問題:
1. 能接受 `X-User-Token` 這個 header 名嗎?(若有慣例命名可改)
2. 能接受 5 min exp 嗎?(若某些 tool 執行 > 5min 可延長到 15min)
3. 需要 FOXLINK GPT 在 claim 中額外帶什麼欄位?(目前只有 sub / email / name / dept)
4. 若 MCP 本身已經是 OAuth Resource Server,想走 Bearer 格式(`Authorization: Bearer <JWT>`)而不是 `X-User-Token` header 也可以 → 但會跟現有 service api_key 衝突,需討論如何二擇一或疊放

---

## 7. Phase 2(視需求,本階段不做)

- **OAuth 2.0 Client Credentials** 支援(當有外部 MCP 要求時再加,設計見第 1 版初稿的方案 A)
- **Per-MCP 獨立 secret**(若信任邊界變嚴)
- **JWT 以 RS256 簽**(FOXLINK GPT 私鑰簽、MCP 拿公鑰驗;適合對外 MCP)
- **加入 `roles` / `groups` claim**(若 MCP 端不想自己查 AD)

---

## 8. 時程預估(FOXLINK GPT 端)

| 項目 | 時間 |
|---|---|
| 核心實作(4 個 transport + userCtx pass-through) | 0.5 day |
| chat.js 呼叫端 + env 設定 | 0.5 day |
| 與 MCP 團隊聯合測試(HS256 驗簽通 + 過期測試) | 0.5 day |
| 文件更新(CLAUDE.md / tool-architecture.md) | 0.5 day |
| **合計** | **~2 day** |
