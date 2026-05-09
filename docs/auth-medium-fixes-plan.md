# Auth Medium-priority Fixes — #5 / #6 / #7

> **狀態**:**已 ship**(2026-05-09)
> **作者**:資安白箱審計 → Claude
> **範圍**:WebAuthn host header trust、SSO state 缺失、login rate limit per-pod
> **影響檔案**:[server/routes/webauthn.js](../server/routes/webauthn.js)、[server/routes/auth.js](../server/routes/auth.js)、[server/middleware/accessControl.js](../server/middleware/accessControl.js)、`server/.env.example`

---

## #5 WebAuthn — RP_ID / Origin host header trust

### 問題

```js
// webauthn.js:34-39 (修補前)
function getRpId(req) {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  return host || 'localhost';
}
```

`WEBAUTHN_RP_ID` 沒設時從 `X-Forwarded-Host` 推。攻擊者打:

```
POST /api/webauthn/auth/options
Host: flgpt.foxlink.com.tw
X-Forwarded-Host: evil.com
```

server 回 challenge 帶 `rpID: evil.com`。WebAuthn spec 本身保護 credential 不能 cross-origin 用,但這仍是 input validation 弱點 —
`expectedRPID` 完全由 untrusted header 決定 → 配合其他攻擊鏈可能放大影響。

### 修補

加 `WEBAUTHN_STRICT=true` env(prod 推薦):
- 啟用後 `RP_ID` / `ORIGIN` 必須由 env 明確設定
- 沒設 → endpoint throw → 回 500
- 預設 `false` 沿用 fallback(過渡期 / dev)

啟動 log 印出本 process 解析狀態,ops 一眼確認:
```
[WebAuthn] RP_ID=flgpt.foxlink.com.tw | ORIGIN=https://flgpt.foxlink.com.tw,... | strict=true
```

`server/.env.example` 加 sample。Prod 部署 checklist 加一項:設 `WEBAUTHN_STRICT=true`。

---

## #6 SSO — OIDC state 缺失(login CSRF)

### 問題

`/sso/login` 沒帶 `state`,`/sso/callback` 也沒驗 → 攻擊者可發起 SSO 流程,把 victim session 綁到攻擊者帳號(login CSRF)。雖然 Foxlink 的 `/sso/login` 限定 internal IP,風險面有限,但仍違反 OIDC spec。

### 修補

`/sso/login`:
```js
const state = uuidv4();
await redis.setSharedValue(`sso:state:${state}`, '1', 300);  // 5 min TTL
params.set('state', state);
```

`/sso/callback`:
```js
const stateValid = await redis.getSharedValue(`sso:state:${state}`);
if (!stateValid) return redirect_with_error('SSO 流程已過期或無效');
await redis.getStore().del(`sso:state:${state}`);  // one-shot,防 replay
```

跨 pod 共用 Redis,K8s 無問題。

---

## #7 Login rate limit — 改用 Redis 跨 pod

### 問題

```js
// accessControl.js:55 (修補前)
const loginAttempts = new Map(); // ip → { count, resetAt }
```

K8s 3 pods × max 10/min = 攻擊者實際 30/min,rate limit 失去意義。
另外 setInterval 5 分鐘 cleanup 在 graceful shutdown 期間可能殘留 leak(雖小)。

### 修補

```js
async function checkLoginRate(ip, max) {
  if (!max) return true;
  try {
    const n = await redis.incrSharedValue(`auth:rate:login:${ip}`, 60);
    return n <= max;
  } catch (e) {
    console.warn(`[AccessControl] login rate check failed (allow): ${e.message}`);
    return true;  // fail-open:Redis 抖動不要把全公司擋外
  }
}
```

`incrSharedValue` 第一次寫入時設 60s TTL,後續 INCR 不重設 → 精確 sliding window。
跨 pod 共享。setInterval cleanup 移除(Redis 自動 TTL 處理)。

呼叫端從同步改 async,middleware 加 `await`。

---

## 部署說明

### 本批 PR 上 K8s 立即生效的修補

- **#6** 跟 **#7** 自動生效,不需 env 變更(但 SSO 流程舊 cookie/page 需重整一次)。
- **#5** 預設仍是 fallback 模式(strict=false),避免 prod 沒設 env 立刻炸。

### 後續手動升級到完整保護

1. K8s deployment env 加:
   ```
   WEBAUTHN_RP_ID=flgpt.foxlink.com.tw
   WEBAUTHN_ORIGIN=https://flgpt.foxlink.com.tw,https://flgpt.foxlink.com.tw:8443
   WEBAUTHN_STRICT=true
   ```
2. Rolling restart → 看 startup log:`[WebAuthn] RP_ID=... | strict=true`
3. 一個 user 試 Face ID / 指紋登入 → 驗證仍可

---

## QA(開發端可驗)

```bash
# 1. SSO state — 故意改 state 參數應被拒
#    a. 走 /sso/login 拿 redirect URL,記下 state 參數
#    b. 改 state 後手動打 /sso/callback?code=xxx&state=tampered
#    預期:redirect to /login?sso_error=SSO 流程已過期或無效

# 2. Login rate limit — 同 IP 連發 31 次應 429
for i in $(seq 1 35); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3007/api/auth/login \
    -H "Content-Type: application/json" -d '{"username":"x","password":"x"}'
done
# 預期:前 30 次 401,第 31 次起 429
# 重啟一個 pod 後再打,counter 仍在 Redis 不會重置 ✓

# 3. WebAuthn strict — 設 WEBAUTHN_STRICT=true 但不設 RP_ID,啟動後打 /api/webauthn/auth/options
#    預期:500 + log 印 ⚠️ STRICT 模式啟用但 WEBAUTHN_RP_ID 未設
```

---

## 變更紀錄

| 日期 | 異動 | 作者 |
|------|------|------|
| 2026-05-09 | 初稿 + ship | rich_lai + Claude |
