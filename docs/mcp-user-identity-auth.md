# MCP User Identity 認證規劃

> **目的**：讓 MCP 伺服器端收到可信的「使用者身份」,以便 MCP 自己判斷資料權限(例如 email → AD group → data filter),不再依賴 FOXLINK GPT 端的分享/RBAC 設定。
>
> **範圍**：本文件只規範 FOXLINK GPT ↔ MCP 伺服器之間的認證傳遞方式。不改變 MCP Tool Protocol 本身(JSON-RPC / SSE / streamable-http)。
>
> **狀態**:Draft v2（HS256 → RS256）,需 MCP 開發團隊確認規格後實作。

---

## 1. 背景與需求

### 1.1 現況
FOXLINK GPT 呼叫 MCP 時:
- 只在 `Authorization: Bearer <api_key>` header 帶一把**服務層 API Key**（identifies the caller as FOXLINK GPT）
- **不傳送使用者身份** → MCP 無法知道現在是哪位 login user 在用
- 使用者權限由 FOXLINK GPT 端的 `mcp_access` 表控管（per user / role / dept / factory）

### 1.2 MCP 團隊需求
1. MCP 要自己做**資料權限控管**（例如只讓 A 部門看 A 部門資料）
2. **不信任** FOXLINK GPT 端的權限設定（希望在自己端有最終判權）
3. 關鍵資訊：**使用者 email**（搭配 MCP 自己的 AD 查詢邏輯）

### 1.3 為什麼不直接用 OAuth 2.0 Client Credentials / 完整 JWT 簽發流程
- 內部系統,過度設計
- Client Credentials 只解決「服務身份」,不帶 user → 要解決 user 還是得自己簽
- 走完整 OAuth Authorization Code Flow 對 MCP 開發者也過於複雜

### 1.4 為什麼選 RS256（非對稱）而非 HS256（對稱）

MCP 團隊提出的關鍵考量：

| | HS256（對稱） | RS256（非對稱，採用） |
|---|---|---|
| **金鑰** | 一把 shared secret,簽與驗用同一把 | 私鑰（簽）+ 公鑰（驗）,分開持有 |
| **MCP 能偽造 token？** | ⚠️ **能**——有 secret 就能簽出合法 JWT | ✅ **不能**——公鑰只能驗,不能簽 |
| **洩漏影響** | 任一 MCP 被攻破 = 攻擊者可偽造任意 user JWT,打所有 MCP | MCP 被攻破只拿到公鑰,**無法偽造** |
| **Secret 散佈範圍** | N 台 MCP + FOXLINK GPT 都持有同一把 | **只有 FOXLINK GPT 一台持有私鑰** |
| **部署** | 分發 secret（需保密） | 分發公鑰（可公開,不怕洩漏） |
| **效能** | ~μs | ~1ms（內網環境無感） |
| **Rotation** | 雙方同時換 secret,有 downtime 風險 | 換 key pair 後更新公鑰即可,無需同步重啟 |

**結論**：多個 MCP 團隊各自開發維護 → secret 散佈面大 → **RS256 是唯一合理選擇**。

---

## 2. 提案：RS256 短效 JWT 夾在 `X-User-Token` header

### 2.1 設計原則
- **與現有 api_key 認證並存**（`Authorization: Bearer <api_key>` 繼續代表服務信任，`X-User-Token` 另外代表 user 身份）
- **非對稱金鑰（RS256）**：FOXLINK GPT 持私鑰簽發，MCP 端只需公鑰驗證 → MCP 無法偽造 token
- **短效 token**（5 min exp）→ 洩漏後影響面小，不需 revoke 機制
- **Per-server 開關 `send_user_token`**（新增 `mcp_servers.send_user_token NUMBER(1) DEFAULT 0`）→ admin 可決定特定 MCP server 是否收 `X-User-Token`
  - 預設 `0`（不發）→ 現有 MCP / 不認證的 MCP 升級後不會壞
  - 新增 server 時 Modal 預設也是 `0`，admin 明確勾選才啟用
  - 這讓**漸進啟用**可行：MCP 團隊確認驗證 ready 後,再個別開啟該 server 的開關

### 2.2 認證雙層架構

```
┌─────────────────────────────────────────────────────────────────┐
│                    FOXLINK GPT (我方)                           │
│                                                                 │
│  1. Authorization: Bearer <api_key>   ← 服務身份（現有）        │
│     → MCP 用來確認「是 FOXLINK GPT 在打我」                     │
│     → api_key 在 admin UI 設定,per-MCP 獨立                    │
│                                                                 │
│  2. X-User-Token: <RS256 JWT>         ← 使用者身份（新增）      │
│     → MCP 用來確認「是哪個使用者在操作」                        │
│     → FOXLINK GPT 用私鑰簽,MCP 用公鑰驗                       │
│     → MCP 無法偽造（沒有私鑰）                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 請求範例

```http
POST /mcp HTTP/1.1
Host: mcp.foxlink.internal
Content-Type: application/json
Authorization: Bearer <MCP_API_KEY>                               ← 服務身份（現有）
X-User-Token: eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6...              ← 使用者身份（新增，RS256）

{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{...}}
```

### 2.4 JWT 規格

**Header**:
```json
{ "alg": "RS256", "typ": "JWT" }
```

**Registered claims**:

| 欄位 | 值 | 說明 |
|---|---|---|
| **alg** | `RS256` | RSA-SHA256，非對稱金鑰 |
| **簽名金鑰** | RSA 2048-bit 私鑰 | 僅 FOXLINK GPT 持有，存於 `MCP_JWT_PRIVATE_KEY_PATH` |
| **驗證金鑰** | 對應公鑰 | 發給所有 MCP 團隊，**可公開** |
| **iss** | `"foxlink-gpt"` | Issuer，固定值 |
| **exp** | `iat + 300` | 5 分鐘有效期 |
| **iat** | 簽發時 UTC epoch | 標準 |
| **jti** | UUID v4 | JWT ID，每次簽發唯一，方便 MCP 端做 replay 防禦 + 審計 log 對照 |

**Custom claims payload**:

```json
{
  "iss": "foxlink-gpt",
  "iat": 1744689600,
  "exp": 1744689900,
  "jti": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",  // 每次簽發唯一
  "sub": "12345",                    // 員工編號（若無則 user id）
  "email": "peter.wang@foxlink.com", // MCP 做權限判斷的主要依據
  "name":  "王小明",
  "dept":  "IT-01"                   // dept_code，可為 null
}
```

> **給 MCP 開發者的建議**：`email` 是最可靠的 user 識別欄位。`dept` / `name` 來自 FOXLINK GPT 資料庫，若需最權威資訊請自行拿 `email` 再查 AD。

### 2.5 MCP 端驗證範例

MCP 團隊只需要拿到公鑰檔 `foxlink-gpt-public.pem`，放在自己的專案或環境裡。

**Node.js (jsonwebtoken)**:
```js
const jwt = require('jsonwebtoken');
const fs  = require('fs');

// 公鑰載入（啟動時讀一次即可）
const PUBLIC_KEY = fs.readFileSync(process.env.MCP_JWT_PUBLIC_KEY_PATH || './foxlink-gpt-public.pem');

function verifyUserToken(req) {
  const token = req.headers['x-user-token'];
  if (!token) throw new Error('Missing X-User-Token');

  // 驗簽：用公鑰驗證，只接受 RS256
  const claims = jwt.verify(token, PUBLIC_KEY, {
    algorithms: ['RS256'],   // 重要：只接受 RS256，防止 alg 切換攻擊
    issuer: 'foxlink-gpt',
    clockTolerance: 30,      // 容忍 30 秒時鐘誤差，避免 pod 間 NTP 不同步造成假陰性
  });

  return claims;
  // → { sub: "12345", email: "peter.wang@foxlink.com", name: "王小明", dept: "IT-01", iss, iat, exp }
}

// 使用範例（Express middleware）
function requireUser(req, res, next) {
  try {
    req.userClaims = verifyUserToken(req);
    next();
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
}
```

**Python (PyJWT + cryptography)**:
```python
# pip install PyJWT cryptography
import jwt
from pathlib import Path

PUBLIC_KEY = Path("foxlink-gpt-public.pem").read_text()

def verify_user_token(request):
    token = request.headers.get("X-User-Token")
    if not token:
        raise ValueError("Missing X-User-Token")

    claims = jwt.decode(
        token,
        PUBLIC_KEY,
        algorithms=["RS256"],   # 只接受 RS256
        issuer="foxlink-gpt",
        leeway=30,              # 容忍 30 秒時鐘誤差
    )
    return claims
    # → {"sub": "12345", "email": "peter.wang@foxlink.com", "name": "王小明", "dept": "IT-01"}
```

**Go (golang-jwt/jwt v5)**:
```go
import (
    "os"
    "github.com/golang-jwt/jwt/v5"
)

var publicKey *rsa.PublicKey  // init() 時從 PEM 載入

func VerifyUserToken(r *http.Request) (*jwt.RegisteredClaims, error) {
    tokenStr := r.Header.Get("X-User-Token")
    if tokenStr == "" {
        return nil, fmt.Errorf("missing X-User-Token")
    }

    token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
        if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
        }
        return publicKey, nil
    }, jwt.WithIssuer("foxlink-gpt"), jwt.WithLeeway(30*time.Second))  // 30s clock skew

    if err != nil {
        return nil, err
    }
    claims := token.Claims.(jwt.MapClaims)
    // claims["email"], claims["sub"], claims["name"], claims["dept"]
    return claims, nil
}
```

**C# (.NET)**:
```csharp
using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;
using System.Security.Cryptography;

// 啟動時載入公鑰
var pem = File.ReadAllText("foxlink-gpt-public.pem");
var rsa = RSA.Create();
rsa.ImportFromPem(pem);
var securityKey = new RsaSecurityKey(rsa);

var validationParams = new TokenValidationParameters {
    ValidateIssuer = true,
    ValidIssuer = "foxlink-gpt",
    ValidateAudience = false,
    IssuerSigningKey = securityKey,
    ValidAlgorithms = new[] { "RS256" },
    ClockSkew = TimeSpan.FromSeconds(30),  // 容忍 30 秒時鐘誤差
};

var handler = new JwtSecurityTokenHandler();
var principal = handler.ValidateToken(token, validationParams, out _);
var email = principal.FindFirst("email")?.Value;
```

### 2.6 錯誤處理建議（MCP 端）

| 情境 | HTTP Status | 行為 |
|---|---|---|
| `X-User-Token` header 缺失 | `401 Unauthorized` | 回 `{"error":"missing user token"}` |
| JWT 簽章無效（公鑰驗不過） | `401` | 可能是公鑰版本不一致，紀錄 log |
| JWT `exp` 過期 | `401` | FOXLINK GPT 每次呼叫重簽，正常不應遇到 |
| `iss` 不是 `"foxlink-gpt"` | `401` | 防止其他服務偽用 |
| `alg` 不是 `RS256` | `401` | ⚠️ **重要：防止 alg 切換攻擊**（攻擊者可能塞 `HS256` + 公鑰當 secret） |
| `email` claim 缺失 | `403 Forbidden` | 不正常情境，紀錄 log |
| 使用者不具備該資料權限 | `403` | 正常業務邏輯，回 MCP tool error 訊息 |

> **⚠️ 重要安全提醒**：MCP 端驗簽時**務必限定 `algorithms: ['RS256']`**。若不限定，攻擊者可將 JWT header 改為 `"alg":"HS256"` 並用公鑰（公開的）當作 HMAC secret 簽名 → 通過驗證。這是 JWT 已知攻擊向量（CVE-2016-5431）。

> **⏱️ 時鐘誤差提醒**：MCP 端驗簽**務必設 `clockTolerance` / `leeway` ≥ 30 秒**（見 §2.5 各語言範例）。K8s pod 間 NTP 不一定完全同步，token `exp` 只有 5 分鐘，沒 tolerance 很容易遇到「剛簽發就過期」的假陰性。

---

## 3. 實作範圍（FOXLINK GPT 端）

### 3.1 改動檔案
| 檔案 | 改動 |
|---|---|
| `server/database-oracle.js` | `mcp_servers` 加欄位 `send_user_token NUMBER(1) DEFAULT 0`；`mcp_call_logs` 加 `user_email VARCHAR2(200)` + `jti VARCHAR2(64)`（事後追查用） |
| `server/services/mcpClient.js` | `makeAuthHeaders(apiKey, userCtx, sendUserToken)` 用私鑰簽 RS256 JWT 夾 `X-User-Token`；`withSession` / `callTool` signature 加 `userCtx`；email 缺失時 throw；`send_user_token=0` 時直接不簽 |
| `server/services/mcpClient.js` | 啟動時嘗試載入私鑰，讀不到僅 warn（不 crash）；runtime 若 `send_user_token=1` 但私鑰未載入 → throw `MCP_JWT_PRIVATE_KEY_NOT_CONFIGURED` |
| `server/routes/chat.js` | 呼叫 `mcpClient.callTool` 時傳 `{ id, email, name, employee_id, dept_code }` |
| `server/routes/mcpServers.js` | CRUD 支援 `send_user_token`；新增 admin endpoints：`GET /public-key`、`POST /test-token`、`POST /verify-token` |
| `server/scripts/verify-mcp-token.js` | CLI 驗證工具：`node verify-mcp-token.js <token>` → 用公鑰解出 claims 印出 |
| `client/src/components/admin/McpServersPanel.tsx` | Modal 新增「使用者身份認證」區塊（checkbox + 公鑰下載 + 測試 token）；列表卡片加 🔐 icon |
| `client/src/i18n/locales/{zh-TW,en,vi}.json` | 新增 `mcp.form.sendUserToken` 等 i18n keys |
| `server/.env` | 新增 `MCP_JWT_PRIVATE_KEY_PATH=./certs/mcp-jwt-private.pem`、`MCP_JWT_PUBLIC_KEY_PATH=./certs/foxlink-gpt-public.pem` |
| `server/certs/` | 存放私鑰（`.gitignore` 排除），公鑰發給 MCP 團隊 |
| `server/certs/README.md` | 給運維的金鑰產生指引 |

### 3.2 核心程式碼片段

```js
// server/services/mcpClient.js
const jwt  = require('jsonwebtoken');
const fs   = require('fs');
const { randomUUID } = require('crypto');

// 啟動時嘗試載入私鑰（僅 FOXLINK GPT 持有）
// 載入失敗 → warn（不 crash），dev 環境不塞 key 也能跑
let _privateKey = null;
let _privateKeyLoaded = false;
function getPrivateKey() {
  if (_privateKeyLoaded) return _privateKey;
  _privateKeyLoaded = true;

  const keyPath = process.env.MCP_JWT_PRIVATE_KEY_PATH;
  if (!keyPath) {
    console.warn('[mcp-jwt] MCP_JWT_PRIVATE_KEY_PATH not set — X-User-Token disabled');
    return null;
  }
  try {
    _privateKey = fs.readFileSync(keyPath, 'utf8');
    console.log('[mcp-jwt] private key loaded from', keyPath);
  } catch (e) {
    console.warn('[mcp-jwt] failed to load private key:', e.message, '— X-User-Token disabled');
  }
  return _privateKey;
}

/**
 * @param {string|null} apiKey          服務 api key (Layer 1)
 * @param {object|null} userCtx         { id, email, name, employee_id, dept_code }
 * @param {boolean}     sendUserToken   server.send_user_token === 1
 */
function makeAuthHeaders(apiKey, userCtx, sendUserToken) {
  const h = {};

  // Layer 1: 服務身份（現有邏輯不變）
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;

  // Layer 2: 使用者身份（RS256 JWT）— 僅在 per-server 開關啟用時才簽發
  if (!sendUserToken) return h;

  if (!userCtx?.email) {
    // Fail fast：配置要求發 token，但 user 沒 email → 拒絕呼叫
    const err = new Error('MCP_JWT_EMAIL_REQUIRED: user has no email but MCP requires X-User-Token');
    err.code = 'MCP_JWT_EMAIL_REQUIRED';
    throw err;
  }

  const privateKey = getPrivateKey();
  if (!privateKey) {
    const err = new Error('MCP_JWT_PRIVATE_KEY_NOT_CONFIGURED: send_user_token=1 but private key not loaded');
    err.code = 'MCP_JWT_PRIVATE_KEY_NOT_CONFIGURED';
    throw err;
  }

  h['X-User-Token'] = jwt.sign(
    {
      jti:   randomUUID(),
      sub:   String(userCtx.employee_id || userCtx.id),
      email: userCtx.email,
      name:  userCtx.name || null,
      dept:  userCtx.dept_code || null,
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '5m', issuer: 'foxlink-gpt' }
  );
  return h;
}
```

> **審計紀錄**：`mcp_call_logs` 在寫入時，把當次簽發的 `jti` 和 `user_email` 一併寫入，方便事後跟 MCP 端的 log 對照（MCP 那邊若紀錄了 `jti` → 兩邊可對齊單一次呼叫）。

### 3.3 stdio transport 處理

stdio 子程序沒有 HTTP header → 透過環境變數傳遞：
```js
env.MCP_USER_TOKEN = <JWT>;   // 每次 spawn 前由 FOXLINK GPT 用私鑰重新簽
env.MCP_API_KEY    = apiKey;
```
MCP stdio server 自 `process.env.MCP_USER_TOKEN` 讀取，用公鑰驗簽。

#### ⚠️ 重要約束：stdio process 必須 per-call spawn，不可常駐

**規則（MUST）**：
- 每次 `tools/call` 都 **spawn 一個新的 stdio 子程序**，執行完畢後立刻 `kill`
- **禁止** keep-alive / process pool / session 重用
- 目前 `server/services/mcpClient.js` 的 `withStdio()` 就是這樣做（於 `finally` 區塊 `proc.kill()`），**後續優化請勿改成長壽命 process**

**為什麼（Why）**：
- `MCP_USER_TOKEN` 的 `exp` 只有 5 分鐘，且環境變數在 process 啟動後**不可更新**
- 若 stdio process 常駐超過 5 分鐘，後續所有 tool call 都會用到**已過期的 token**，MCP 端驗簽必定回 401
- HTTP transport（http-post / streamable-http / http-sse）沒這問題，因為每次請求都現簽 header

**若要改為常駐 process**（Phase 2，非當前範圍）：
- 選項 A：把 token 改由 stdin 每次 call 前注入（而不是 env），需擴充 JSON-RPC 訊息格式
- 選項 B：stdio process 透過反向 IPC 向 FOXLINK GPT 重新取 token
- 選項 C：stdio 改走 Unix socket + HTTP（本質就不是 stdio 了）
> 上述皆改變 MCP stdio server 端實作，**屬於破壞性變更，需先跟 MCP 團隊同步**。

**給 AI/Code reviewer 的檢查點**：
- 看到 `withStdio` 裡 `proc.kill()` 被挪出 `finally` → **拒絕 PR**
- 看到新增「stdio session cache / pool」→ **拒絕 PR**
- 看到 `spawn()` 的呼叫位置從 `withStdio` 內移到模組頂層（變 global singleton）→ **拒絕 PR**

### 3.4 自我驗證工具（因尚無 MCP 團隊對接，我方先實作）

目前還沒有真實的 MCP server 能驗收 FOXLINK GPT 發出的 JWT。為了確保簽發邏輯正確、未來給 MCP 團隊聯合測試時有基準，**本階段一併實作以下兩個工具**：

#### (a) Admin API — Token 測試／驗證 endpoint

定義於 `server/routes/mcpServers.js`，僅 admin 可用：

| Endpoint | 用途 |
|---|---|
| `GET  /api/mcp-servers/public-key` | 回傳 `foxlink-gpt-public.pem` 內容 + SHA-256 fingerprint。UI 用它做「下載公鑰」按鈕。 |
| `POST /api/mcp-servers/test-token` | body `{ email, name?, sub?, dept? }` → 用私鑰簽發一顆 JWT 回傳。給 MCP 團隊驗證時拿這顆 token 丟進自己的驗簽流程。 |
| `POST /api/mcp-servers/verify-token` | body `{ token }` → 用公鑰驗簽,回傳 decoded claims 或錯誤原因。讓 admin 直接在 UI 上測「我剛發出去的 token 長什麼樣」。 |

UI 對應：
- Modal 的「使用者身份認證」區塊放「下載公鑰」+「產生測試 Token」兩個按鈕
- 產生測試 token 後,顯示 raw JWT（可複製）+ decode 後的 claims 表格

#### (b) CLI 驗證腳本

`server/scripts/verify-mcp-token.js`：

```bash
# 基本用法：貼 token 進去，用 env 的公鑰解
node server/scripts/verify-mcp-token.js eyJhbGciOiJSUzI1NiJ9...

# 明確指定公鑰檔
MCP_JWT_PUBLIC_KEY_PATH=./certs/foxlink-gpt-public.pem \
  node server/scripts/verify-mcp-token.js <token>
```

輸出：
- 驗簽通過 → 印出 header + claims（JSON）+ `iat/exp` 對應的 UTC/Local 時間
- 驗簽失敗 → 明確指出原因（簽章錯、過期、iss 不符、alg 不是 RS256 等）

這個腳本讓 MCP 團隊將來要 onboarding 時有個「不依賴自己環境」的驗證工具。

---

## 4. 金鑰管理

### 4.1 產生 RSA Key Pair

```bash
# 在 FOXLINK GPT server 上執行一次
# 產生 2048-bit RSA 私鑰
openssl genrsa -out mcp-jwt-private.pem 2048

# 從私鑰導出公鑰
openssl rsa -in mcp-jwt-private.pem -pubout -out foxlink-gpt-public.pem
```

產出兩個檔案：
| 檔案 | 持有者 | 機密性 | 用途 |
|---|---|---|---|
| `mcp-jwt-private.pem` | **僅 FOXLINK GPT** | 🔴 機密，不可外洩 | 簽發 JWT |
| `foxlink-gpt-public.pem` | **所有 MCP 團隊** | 🟢 可公開 | 驗證 JWT |

### 4.2 分發

**私鑰（FOXLINK GPT 端）**：
- 存放路徑：`server/certs/mcp-jwt-private.pem`
- `.gitignore` 排除 `server/certs/*.pem`
- K8s 部署：掛為 Kubernetes Secret → volumeMount 到 `/app/certs/`
- `.env` 指定路徑：`MCP_JWT_PRIVATE_KEY_PATH=./certs/mcp-jwt-private.pem`
- **絕不** commit 到版控、寫入 log、存入 DB

**公鑰（MCP 團隊）**：
- 直接發給 MCP 團隊（email / Teams / 內部 Git repo 皆可）
- 公鑰**可以公開**，洩漏不會造成安全問題（只能驗、不能簽）
- MCP 團隊存為 `foxlink-gpt-public.pem`，環境變數指向 `MCP_JWT_PUBLIC_KEY_PATH`

### 4.3 Rotation 策略

**RS256 的 rotation 比 HS256 簡單得多**，因為公鑰可以公開分發：

1. FOXLINK GPT 產生新 key pair（`private-v2.pem` / `public-v2.pem`）
2. **先**把新公鑰發給所有 MCP 團隊，MCP 端同時接受新舊兩把公鑰：
   ```js
   // MCP 端 rotation 期間
   const PUBLIC_KEYS = [
     fs.readFileSync('./foxlink-gpt-public-v2.pem'),  // 新
     fs.readFileSync('./foxlink-gpt-public.pem'),      // 舊
   ];
   function verify(token) {
     for (const key of PUBLIC_KEYS) {
       try { return jwt.verify(token, key, { algorithms: ['RS256'], issuer: 'foxlink-gpt' }); }
       catch (_) { continue; }
     }
     throw new Error('Invalid token');
   }
   ```
3. 確認所有 MCP 已部署新公鑰後，FOXLINK GPT 切換到新私鑰
4. 一週後 MCP 移除舊公鑰

> Rotation 頻率建議：**1 年**，或有人員異動（能接觸私鑰的人離職）時。

### 4.4 未來選項：JWKS endpoint（Phase 2）

若 MCP 數量成長到手動分發公鑰不實際，可讓 FOXLINK GPT 提供 JWKS endpoint：
```
GET https://foxlink-gpt.internal/api/.well-known/jwks.json
```
MCP 端定期拉取公鑰，自動 rotation，無需手動分發。
> 初版不做，手動分發公鑰即可。

---

## 5. 安全考量

| 風險 | 緩解措施 |
|---|---|
| JWT 被抓包重放 | 5 min exp 限制影響面；K8s 內網 + HTTPS 傳輸 |
| 私鑰洩漏 → 可偽造任意使用者 | 私鑰僅存於 FOXLINK GPT 一台（K8s Secret + PEM 檔案），不進版控 |
| MCP server 被攻破 | 攻擊者只能拿到**公鑰**，**無法偽造 JWT**（RS256 關鍵優勢） |
| alg 切換攻擊（CVE-2016-5431） | MCP 驗簽時必須硬編碼 `algorithms: ['RS256']`，見 §2.6 |
| FOXLINK GPT bug 誤夾錯誤 user | 靠 code review + 單元測試（驗證 userCtx 來源一定是 `req.user`） |
| 使用者提權攻擊（改寫 header） | FOXLINK GPT 端 user 只能透過 chat API 間接觸發 MCP 呼叫，無法直接控制 header |

**已知限制**：
- JWT 裡的 `dept` / `name` 是 FOXLINK GPT 從自己 DB 查出來後簽的，若 DB 與 AD 不同步，MCP 拿到可能是舊值。MCP 如需最權威資訊應自己拿 `email` 再查 AD。

---

## 6. 給 MCP 團隊的 Checklist

### 驗證階段（在任一 MCP 上實作）

- [ ] 收到 FOXLINK GPT 發的公鑰檔 `foxlink-gpt-public.pem`
- [ ] 用公鑰驗簽成功（FOXLINK GPT 會提供一組測試 token）
- [ ] 確認 `email` / `sub` / `name` / `dept` 四個 claim 都可讀到
- [ ] 驗證過期 token（人工塞一個 `exp` 已過的）會被拒
- [ ] 驗證 `iss != "foxlink-gpt"` 會被拒
- [ ] 驗證 `alg` 切換攻擊防護：把 JWT header 改成 `"alg":"HS256"` 並用公鑰當 secret 簽 → 必須被拒
- [ ] 驗簽時設定 `clockTolerance` / `leeway` / `ClockSkew` ≥ **30 秒**（避免 NTP 漂移造成假陰性，見 §2.5 / §2.6）
- [ ] 缺 `X-User-Token` 時回 `401` 而非 `500`
- [ ] （建議）在 MCP 自己的 log 紀錄 `jti`，方便與 FOXLINK GPT 端 `mcp_call_logs` 對齊單次呼叫
- [ ] stdio 模式 MCP 改自 `process.env.MCP_USER_TOKEN` 讀取驗簽

### 回覆我方的問題

1. 能接受 `X-User-Token` 這個 header 名嗎？（若有慣例命名可改）
2. 能接受 5 min exp 嗎？（若某些 tool 執行 > 5min 可延長到 15min）
3. 需要 FOXLINK GPT 在 claim 中額外帶什麼欄位？（目前只有 `sub` / `email` / `name` / `dept`）
4. 公鑰分發方式：直接給 PEM 檔 OK 嗎？還是需要 JWKS endpoint？

---

## 7. Phase 2（視需求，本階段不做）

- **JWKS endpoint**（`/.well-known/jwks.json`）→ MCP 自動拉取公鑰，免手動分發
- **OAuth 2.0 Client Credentials** 支援（當有外部 MCP 要求時再加）
- **加入 `roles` / `groups` / `factory` claim**（若 MCP 端不想自己查 AD）
- **stdio 常駐 process 支援**（見 §3.3 Phase 2 選項）

---

## 8. 時程預估（FOXLINK GPT 端）

| Phase | 項目 | 時間 |
|---|---|---|
| **0** | 產生 RSA key pair + `.gitignore` + `.env.example` + 安裝 `jsonwebtoken`/`uuid`  | 0.5 day |
| **1** | Schema migration（`send_user_token` + `mcp_call_logs` 欄位） + `mcpClient.js` 簽發邏輯 + 4 個 transport 的 `userCtx` pass-through + email 缺失 throw + chat.js 串接 | 1 day |
| **2** | `routes/mcpServers.js` 加 `public-key` / `test-token` / `verify-token` 三個 admin endpoint + CRUD 支援 `send_user_token` | 0.5 day |
| **3** | `McpServersPanel.tsx` Modal 認證區塊 + 卡片 icon + 三語 i18n | 0.5 day |
| **4** | CLI 驗證腳本 `verify-mcp-token.js` + 文件更新（本文件 + CLAUDE.md + tool-architecture.md + `server/certs/README.md`） | 0.5 day |
| | **合計** | **~3 day** |

> 本階段**不含**與 MCP 團隊聯合測試（目前尚無 MCP 對接對象）。待首個 MCP 團隊 onboarding 時，再用 §3.4 的測試工具做驗證。
