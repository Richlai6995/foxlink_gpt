# Auth #8 — Token in Query String 修補

> **狀態**:**已 ship Phase 1**(2026-05-09)— 修最大宗(SSO callback)
> **作者**:資安白箱審計 → Claude
> **影響檔案**:[server/routes/auth.js](../server/routes/auth.js)、[client/src/pages/Login.tsx](../client/src/pages/Login.tsx)、[client/src/context/AuthContext.tsx](../client/src/context/AuthContext.tsx)

---

## 1. 問題

`verifyToken` middleware 同時接受 `Authorization: Bearer ...` header 跟 `?token=...` query 參數:

```js
// auth.js:1509-1514
const authHeader = req.headers.authorization;
if (authHeader?.startsWith('Bearer ')) token = authHeader.split(' ')[1];
else if (req.query.token) token = req.query.token;
```

Query token 的問題:
- **nginx access log 留 token**:`GET /api/auth/sso/user?token=abc123 200` → log 行被 SOC / ops / Loki 看到
- **Browser history 留 token**:user 不小心 share URL
- **Referer header 洩漏**:點外連時 token 跟著 referer 出去
- **Proxy / CDN 可能 cache 整個 URL**:含 token 的 response 被快取

---

## 2. Query Token 真實使用場景盤點

| 場景 | 用 query 原因 | 修補對應 |
|------|--------------|---------|
| **SSO callback** (`/login?sso_token=`) | server redirect 後 client 抓 | 🆕 **改 hash fragment**(`#sso_token=`) |
| **`/auth/sso/user?token=`** | client 第二次取 user info | 🆕 **改 Authorization header** |
| **EventSource SSE**(deploy / skill-runners) | `EventSource` API 不支援 header | ⏳ Phase 2(short-lived signed URL) |
| **`<video>` src**(training video-proxy) | `<video>` 不支援 header | ⏳ Phase 2 |
| **`window.open()` download**(export-package) | 下載觸發不能設 header | ⏳ Phase 2 |

> **為什麼先做 SSO**:它是「全部外網 user 必經流程」,留在 nginx log 等於每次登入都洩漏一次 token。SSE / video / download 是 admin panel 操作,影響面相對窄。

---

## 3. 修補(Phase 1)

### 3.1 SSO callback redirect 用 hash fragment

```js
// 修補前
res.redirect(`${target}/login?sso_token=${sessionToken}`);

// 修補後
res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
res.redirect(`${target}/login#sso_token=${sessionToken}`);
```

**為什麼 hash 安全**:
- Hash fragment 只存在 client side,**完全不送 server**
- 不進 nginx access log
- 不進 Referer header(瀏覽器規範)
- 仍進 browser history,但 client 拿到後立刻 `history.replaceState` 清掉

### 3.2 Client 讀 hash + 過渡期相容 query

```tsx
const params = new URLSearchParams(window.location.search)
const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
const ssoToken = hashParams.get('sso_token') || params.get('sso_token')  // ← hash 優先,query fallback
```

過渡期 fallback 讓**舊 client 仍能處理新 server 的 redirect**(極端情況 — server 已 deploy 但 client 還在 cache,理論上 SPA 會重新 fetch chunks,但留 fallback 安全)。

### 3.3 `/auth/sso/user` 改用 Authorization header

server:
```js
const authHeader = req.headers.authorization;
let token = null;
if (authHeader?.startsWith('Bearer ')) token = authHeader.split(' ')[1];
else if (req.query.token) token = req.query.token;  // 過渡期相容
res.set('Cache-Control', 'private, no-store');
```

client (`AuthContext.tsx`):
```tsx
const res = await api.get('/auth/sso/user', {
  headers: { Authorization: `Bearer ${ssoToken}` },
})
```

---

## 4. 攻擊鏈影響

修補前完整 SSO 流程的 token 軌跡:

```
1. user 點 SSO 登入 → Foxlink SSO 驗證
2. SSO server redirect 回 /api/auth/sso/callback?code=xxx&state=xxx
3. server 換 token,redirect 回 /login?sso_token=NEW_SESSION_TOKEN
                                      ^^^^^^^^^^^^^^^^^^^^^^^^^
                                      ← nginx access log 留這個!
4. client 讀 query 拿 token
5. client 打 /auth/sso/user?token=NEW_SESSION_TOKEN 取 user info
                                  ^^^^^^^^^^^^^^^^^
                                  ← 第二次留 nginx log!
```

修補後:
```
3. server redirect 回 /login#sso_token=...
                            ↑ hash 不送 server,nginx 看不到
4. client 從 hash 讀 token
5. client 打 /auth/sso/user 帶 Authorization: Bearer ...
                            ↑ header 不進 access log query field
```

token 從「每次登入留 2 行 nginx log」→「完全不留」。

---

## 5. Phase 2(後續 PR,範圍較大)

剩下三個場景需要 short-lived signed URL 機制:

| 場景 | 設計 |
|------|------|
| EventSource SSE | `GET /api/auth/sse-token` 回 90 秒 TTL 的子 token,只能訪問 SSE endpoints |
| `<video>` 串流 | 同上,訪問 `/api/training/video-proxy` |
| 下載 | `GET /api/training/courses/:id/export-package` → 回 redirect 到 signed URL |

需要新增 helper:
```js
async function issueShortToken(parentToken, allowedPath, ttlSec = 90) {
  const subToken = uuidv4();
  await redis.setSharedValue(`sub:${subToken}`, JSON.stringify({
    parent: parentToken, path: allowedPath, exp: Date.now() + ttlSec*1000
  }), ttlSec);
  return subToken;
}
```

verifyToken 對 query-token 訪問加 path 比對。Phase 2 推給後續 PR。

---

## 6. 測試

```bash
# 1. SSO 流程仍可走完
# - 點 SSO 登入 → SSO 主機驗證 → redirect 回 /login → user 進 dashboard
# - 觀察 nginx access log:應只看到 /login 200(無 sso_token query)
# - 觀察 browser address bar:刷一下後 URL 是 /login(hash 已被 replaceState 清掉)

# 2. 過渡期相容(server 已新 client 還舊)
# - 暫時 server 改回舊 redirect URL,client 仍能讀 query → 正常登入
# - 確認沒因為兩邊版本不同步 break(下版可砍 query fallback)

# 3. /auth/sso/user header
curl -H "Authorization: Bearer <ssoToken>" http://localhost:3007/api/auth/sso/user
# 預期:200 + { token, user }

# 4. /auth/sso/user 仍接受 query(過渡相容)
curl 'http://localhost:3007/api/auth/sso/user?token=<ssoToken>'
# 預期:200 + { token, user }(下版砍掉)
```

---

## 變更紀錄

| 日期 | 異動 | 作者 |
|------|------|------|
| 2026-05-09 | Phase 1 ship:SSO callback hash fragment + /sso/user header | rich_lai + Claude |
