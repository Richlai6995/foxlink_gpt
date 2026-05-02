# 外網開放安全強化(External Access Security Hardening)

> 配合外網開放需求,在 WAF + Firewall 之外加上的應用層安全防線。
> 涵蓋 Trust Proxy、Webex MFA、Anti-bot、認證稽核、Rate limit 等。
>
> 啟動指令的 env 預設保守(MFA 關閉、access mode = webhook_only),
> ops 可逐項拆解風險再逐項打開。

---

## 1. 整體架構

外網請求進來會經過六道關卡(內網全部跳過):

```
client (外網)
  ↓
[1] Ingress whitelist-source-range  ← 還沒拆 (ingress.yaml)
  ↓
[2] Ingress nginx limit-rps / limit-connections  ← L7 anti-flood 兜底
  ↓
[3] Express trust proxy=1  ← 從 nginx 拿真實 client IP
  ↓
[4] AccessControl middleware:
      ├─ IP 黑名單檢查(Redis cache)
      ├─ UA 黑名單(sqlmap / nikto / ...)→ 自動加黑名單
      ├─ Internal-only paths
      └─ EXTERNAL_ACCESS_MODE 模式判斷
  ↓
[5] ExternalRateLimit middleware  ← 跨 pod per-IP rate limit
  ↓
[6] Auth route:
      ├─ admin 帳號禁止外網
      ├─ 沒 email 拒絕
      ├─ 已通過 MFA 的 trusted IP 跳過
      └─ Webex DM OTP 驗證
  ↓
正常 API
```

---

## 2. 改動列表(commits 順序)

| Commit | PR | 內容 |
|---|---|---|
| `fe9a84a` | PR 1 | `fix(security)`: X-Forwarded-For spoofing 修補(trust proxy=1) |
| `8c61b84` | PR 2 | `feat(auth)`: Webex MFA 主體 + admin 認證稽核 UI |
| `414892c` | PR 3a | admin 限內網 / 改密碼踢 sessions / 失敗 alert / forgot rate / 異常登入 DM / admin TTL / helmet |
| `d41609b` | PR 3b | IP 黑名單 + UA anti-bot |
| `a03557e` | PR 3c | App + Ingress 兩層 per-IP rate limit |

---

## 3. 各功能模組

### 3.1 Trust Proxy(PR 1)

**修補對象:** [server/middleware/accessControl.js](../server/middleware/accessControl.js) `getClientIp` 原本直接信 `X-Forwarded-For` 鏈第 1 個值,攻擊者可塞 `X-Forwarded-For: 10.0.0.1` 偽造成內網 IP 繞過 `isInternal()` → 連帶繞過 access control。

**修法:**
- [server/server.js](../server/server.js) `app.set('trust proxy', 1)`(env `TRUST_PROXY=1`)
- `getClientIp` 改用 `req.ip`,Express 從 socket peer 起回溯 1 跳取 XFF 最右邊 IP
- nginx-ingress append 真實 client IP 在 XFF 右邊,偽造的 header 永遠在左邊不被信

**環境前提:** K8s 架構 `client → nginx-ingress(1 跳) → pod`。多層 proxy / CDN 要調 `TRUST_PROXY` 數字。

---

### 3.2 Webex MFA(PR 2)

外網登入第二道防線,失敗 / 帳號被竊時可即時察覺。

**流程:**
1. 帳密驗證通過(LDAP / SSO / 本地)
2. `proceedOrChallenge` 判斷需 MFA
3. 產 6 位 OTP + challenge_id(uuid),寫 Redis 5 分鐘
4. Webex Bot DM 給使用者(三語:zh-TW / en / vi)
5. 使用者輸入 OTP → `POST /api/auth/2fa/verify`
6. 通過 → 寫 trusted IP(/32 嚴格,7 天 TTL)+ 建 session

**核心檔:**
- [server/services/webexMfaService.js](../server/services/webexMfaService.js) — challenge / OTP / verify / DM
- [server/services/authAuditLog.js](../server/services/authAuditLog.js) — fire-and-forget 稽核
- [server/routes/auth.js](../server/routes/auth.js) — `proceedOrChallenge` / `/2fa/verify` / `/2fa/resend`

**DB schema:**
- `users` 加 `webex_person_id`(cache)、`webex_mfa_enabled`(預設 1)
- `user_trusted_ips`:`(user_id, ip)` UNIQUE,改密碼 / reset 時自動清空
- `auth_audit_logs`:全部認證事件永久保留

**安全要點:**
- OTP `crypto.randomInt`,比對 `crypto.timingSafeEqual`,**不寫任何 log**
- challenge_id uuid v4,verify 通過立刪
- 5 次錯誤刷掉 challenge(防爆破),給 incident_id 給使用者報告管理員
- DM 失敗 hard error(不放行),失敗訊息含 incident_id 方便 admin 比對 log
- Webex `/people?email=` 找不到 person → 拒絕(防止 LDAP email ≠ Webex email)

---

### 3.3 Admin 限內網 + change-password 踢 sessions(PR 3a)

`proceedOrChallenge` 對 `user.role === 'admin'` 從外網嘗試 → `login_failed_admin_external` audit + 403。

改密碼 / reset-password 後:
- `mfa.revokeAllTrustedIps(userId)` 清空該 user 所有 trusted IPs
- `redis.revokeAllUserSessions(userId, exceptToken)` SCAN sess:* → 比對 user_id → DEL
  - change-password 保留當前 token(不踢自己)
  - reset-password 全踢(reset 走的人本來就沒 session)

---

### 3.4 認證失敗告警 + forgot rate limit(PR 3a)

[server/services/authThrottle.js](../server/services/authThrottle.js) 集中管理。

**失敗計數:**
- Redis key `auth:fail:user:{userId}` / `auth:fail:ip:{ip}`,TTL 1 小時
- 同 user ≥ `AUTH_FAIL_ALERT_PER_USER`(預設 5)/ 同 IP ≥ `AUTH_FAIL_ALERT_PER_IP`(預設 10)→ 寄信 `ADMIN_NOTIFY_EMAIL`
- 同 user / IP 1 小時內不重寄(`auth:alerted:user/ip:{key}` 旗標)
- 同 IP 達閾值同時自動加入 IP 黑名單 24 小時(PR 3b)

**告警觸發點:** `login_failed_credentials` / `login_failed_admin_external` / `mfa_verify_failed` / `mfa_verify_too_many`。

**forgot-password 限流:**
- 同 IP / username 1 小時最多 `FORGOT_PASSWORD_RATE_LIMIT`(預設 3)次
- 限流時不洩漏細節仍回標準訊息(防 username enumeration),但 log 給 admin 看

---

### 3.5 異常登入 DM 通知(PR 3a)

MFA verify 通過後,查 `auth_audit_logs` 該 user+ip 過去 30 天有沒有 `login_success_*` 紀錄,沒有 → DM 三語通知:

```
🔔 Cortex 新位置登入提醒
- 時間 / IP / 裝置(UA 截斷 100 字)
- 若非本人,1) 改密碼 2) 聯絡資安
```

非阻塞,失敗只 log。

---

### 3.6 Helmet 安全 headers(PR 3a)

[server/server.js](../server/server.js) `app.use(helmet({...}))` 加:
- HSTS 180 天 + includeSubDomains
- X-Content-Type-Options
- X-Frame-Options
- Referrer-Policy
- 等預設 helmet 規則

**CSP 暫關**(`contentSecurityPolicy: false`),預設規則太嚴會破前端 inline style / Tailwind / Vite。後續單獨評估。

---

### 3.7 Admin Session TTL(PR 3a)

[server/services/redisClient.js](../server/services/redisClient.js):
- `ADMIN_TOKEN_TTL`:30 天 → 8 小時(同一般 user)
- 過去設 30 天為 ops 方便,但 admin token 一旦被竊有最大爆炸半徑
- env `ADMIN_SESSION_TTL_SECONDS=28800`

---

### 3.8 IP 黑名單 + UA anti-bot(PR 3b)

**新表 `ip_blacklist`:** `(ip)` UNIQUE,`expires_at NULL = 永久`。

**[server/services/ipBlacklist.js](../server/services/ipBlacklist.js):** Redis cache(`bl:ip:{ip}`)+ DB CRUD + UA pattern 偵測

**Middleware 兩道(只對外網):**
1. IP 在黑名單 → 直接 403(Redis cache <1ms,DB 為 source of truth)
2. UA 命中已知滲透工具(`sqlmap` / `nikto` / `nmap` / `masscan` / `zmap` / `dirbuster` / `gobuster` / `wpscan` / `hydra` / `metasploit` / `burp` / `acunetix` / `nessus` / `openvas` / `w3af` / `skipfish`)→ 自動加 7 天黑名單 + 403

**故意不擋:** `curl` / `wget` / `python-requests` / `Go-http-client` — K8s probe / monitoring / 內部腳本也用,誤殺風險高

**自動加入 blacklist:**
- 同 IP 失敗達 `AUTH_FAIL_ALERT_PER_IP` → 自動加 24 hr(`source=auto_failure`)
- UA 命中 → 自動加 7 天(`source=auto_ua`)
- Admin 手動加(`source=manual`,可永久)

**Redis 故障:** `isBlacklisted` console.warn + 放行,有 ingress 層兜底。

---

### 3.9 Per-IP Rate Limit(PR 3c)

兩層,內網跳過。

**App 層(主要):** [server/middleware/externalRateLimit.js](../server/middleware/externalRateLimit.js)
- Redis INCR + 60s TTL,跨 pod 共享 quota
- 預設 120 req/min/IP(`EXTERNAL_RATE_LIMIT_PER_MIN`)
- **排除 SSE 路徑**:`/api/health` / `/api/chat/sessions` / `/api/research` / `/api/training/sessions`
  (單連線多 chunks,不該按 request 算)
- Redis 故障保守放行 + log

**Ingress 層(兜底):** [k8s/ingress.yaml](../k8s/ingress.yaml)
- `nginx.ingress.kubernetes.io/limit-rps: "30"`(每 IP 每秒 30 req)
- `limit-burst-multiplier: "5"`(突發 150 req/s)
- `limit-connections: "50"`
- **前提:nginx-ingress controller service 設了 `externalTrafficPolicy: Local`**,否則所有人共用 quota → 503

---

## 4. ENV 全列表

```bash
# Trust proxy
TRUST_PROXY=1                          # K8s nginx-ingress 1 跳

# 外網存取模式
EXTERNAL_ACCESS_MODE=webhook_only      # internal_only | webhook_only | full
INTERNAL_NETWORKS=10.0.0.0/8,...       # 內網 CIDR(MFA + access control 共用)

# Webex MFA
MFA_ENABLED=false                      # ⚠️ EXTERNAL_ACCESS_MODE=full 時必須 true 否則啟動失敗
MFA_TRUSTED_IP_TTL_DAYS=7
MFA_OTP_TTL_SECONDS=300
MFA_RESEND_COOLDOWN_SECONDS=60
MFA_MAX_VERIFY_ATTEMPTS=5
MFA_DM_TIMEOUT_MS=8000
MFA_RATE_LIMIT_PER_USER_PER_HOUR=20

# 認證失敗告警 + forgot rate
AUTH_FAIL_ALERT_PER_USER=5
AUTH_FAIL_ALERT_PER_IP=10
FORGOT_PASSWORD_RATE_LIMIT=3

# Anti-bot 黑名單
ANTI_BOT_FAIL_BLOCK_HOURS=24           # 同 IP 失敗達閾值自動加黑名單時間
ANTI_BOT_UA_BLOCK_DAYS=7

# Per-IP rate limit
EXTERNAL_RATE_LIMIT_PER_MIN=120
EXTERNAL_RATE_WINDOW_SEC=60

# Session
SESSION_TTL_SECONDS=28800              # 一般 user 8 小時
ADMIN_SESSION_TTL_SECONDS=28800        # admin 8 小時(從 30 天縮)
```

---

## 5. 啟動安全聯動

[server/server.js](../server/server.js) 啟動時檢查:

```js
if (mode === 'full' && process.env.MFA_ENABLED !== 'true') {
  console.error('[FATAL] EXTERNAL_ACCESS_MODE=full 必須搭配 MFA_ENABLED=true');
  process.exit(1);
}
```

防 ops 失誤把外網打開但忘記開 MFA → 裸奔。緊急狀況改回 `webhook_only` 收回外網,而非關 MFA 留外網開放。

---

## 6. 部署 / 切換 Checklist

### 6.1 第一次部署(env 全部維持安全 default)

```
1. ./deploy.sh
2. 觀察 server log,應有:
   [Express] trust proxy = 1
   [Security] accessMode=webhook_only | mfaEnabled=false
   [ExternalRateLimit] enabled | external IPs: 120 req per 60s
   [Migration] Created table USER_TRUSTED_IPS ✓
   [Migration] Created table AUTH_AUDIT_LOGS ✓
   [Migration] Created table IP_BLACKLIST ✓
3. 內網登入測試 — 跟過去行為應 100% 一致
4. Admin 介面確認新 tab 可進入(認證稽核 / IP 黑名單)
```

### 6.2 啟用 MFA(內網仍 ok,外網 webhook_only 不影響)

```
1. .env: MFA_ENABLED=true
2. ./deploy.sh
3. server log: [Security] accessMode=webhook_only | mfaEnabled=true
4. 找一台外網 IP 測試(暫時把自己 IP 從 INTERNAL_NETWORKS 移走模擬):
   - 應跳 OTP 輸入畫面
   - Webex 應收到 DM
   - OTP 通過後正常登入
5. 改回 INTERNAL_NETWORKS
```

### 6.3 正式對外開放(ingress + access mode 同步切)

⚠️ **必須同一次部署同時切兩個 env**,否則 server.js 啟動 safety check 會 process.exit(1)。

```
1. WAF / firewall 規則確認到位
2. 確認 nginx-ingress controller service 是 externalTrafficPolicy: Local
   (沒這個 limit-rps 會誤殺,參見 3.9)
3. 改 [k8s/ingress.yaml]:
   - 移除 / 修改 nginx.ingress.kubernetes.io/whitelist-source-range
4. 改 .env:
   - EXTERNAL_ACCESS_MODE=full
   - (MFA_ENABLED=true 已啟用)
5. ./deploy.sh
6. server log 應有:
   [Security] accessMode=full | mfaEnabled=true
   ⚠️  FULL external access | loginRateLimit=10/min
7. 第一週每天看 admin → 認證稽核 / IP 黑名單,觀察:
   - login_failed_credentials 趨勢
   - mfa_verify_failed 趨勢
   - 自動加入的 IP 黑名單筆數
   - 是否有人卡 Webex 帳號 mismatch
```

---

## 7. 故障 Runbook

### 7.1 Webex 整體故障 → 全公司外網無法登入

```
1. ssh K8s,改 deployment ENV:
   kubectl edit deployment foxlink-gpt -n foxlink
   - EXTERNAL_ACCESS_MODE=webhook_only(收回外網,不裸奔)
2. (MFA_ENABLED 維持 true 也 OK,因為已切 webhook_only)
3. kubectl rollout restart deployment foxlink-gpt -n foxlink
4. 通知使用者「外網登入暫停服務,請從內網或 VPN」
5. Webex 復原後反向操作切回 full
```

### 7.2 自動黑名單誤殺 admin / 重要使用者

```
1. Admin 進「IP 黑名單」tab
2. 找到該 IP 點「移除」
   (移除後 Redis cache 自動 invalidate,下個 request 立即生效)
3. 必要時調 .env 的 AUTH_FAIL_ALERT_PER_IP 提高閾值
```

### 7.3 Rate limit 誤殺(自己用都被擋)

最常見原因:nginx-ingress controller 不是 `externalTrafficPolicy: Local`,所有人共用 quota。

```
1. 把 ingress.yaml 的三行 annotation 註解掉:
   # nginx.ingress.kubernetes.io/limit-rps: "30"
   # nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"
   # nginx.ingress.kubernetes.io/limit-connections: "50"
2. kubectl apply -f k8s/ingress.yaml
3. 仍有 app 層 rate limit 兜底
4. 跟平台組協調 ingress controller externalTrafficPolicy
```

### 7.4 Redis 故障 → 多功能降級

- MFA challenge 寫不進 → user 看到「驗證碼發送失敗,請聯絡管理員(代碼:XXXX)」
- IP 黑名單 cache miss → DB 查仍可用,但效能差
- ExternalRateLimit → 保守放行 + log

**修復:** `kubectl get pods -n foxlink | grep redis`,Redis 重啟通常 30 秒復原。

---

## 8. 已知 Gap(後續)

| Gap | 影響 | 後續處理 |
|---|---|---|
| 改密碼後沒清掉 active sessions(舊架構就沒做)| 帳號被釣後攻擊者持有 token 仍可用 | PR 3a 已修(對自己這條) |
| Admin 沒「強制下線單一 user」按鈕 | 緊急應變不便 | 後續加 admin endpoint + UI |
| 沒「重置 trusted IPs」UI | admin 只能 SQL 改 | 後續加 |
| TOTP 備援(Webex 故障時) | 全公司外網登入掛 | 第二版,需 enrollment UX |
| CSP | 阻 XSS / clickjacking | helmet 預設規則太嚴,需單獨評估前端兼容 |
| 個資合規 | `auth_audit_logs` 永久保留 IP/email/UA | 看公司政策,可加 90 天後 hash IP |
| TLS / Cipher 強度 | 弱 cipher 可能被降級攻擊 | `ssllabs.com/ssltest` 測一次再調 |
| 「異常登入」的「拒絕此次登入」按鈕 | 使用者只能「事後改密碼」 | 第二版加 Adaptive Card |

---

## 9. 相關檔案索引

**Backend:**
- [server/server.js](../server/server.js) — trust proxy / helmet / startup safety check
- [server/middleware/accessControl.js](../server/middleware/accessControl.js) — IP 黑名單 + UA + access mode
- [server/middleware/externalRateLimit.js](../server/middleware/externalRateLimit.js) — per-IP rate limit
- [server/services/webexMfaService.js](../server/services/webexMfaService.js) — challenge / OTP / DM / trusted IP
- [server/services/authAuditLog.js](../server/services/authAuditLog.js) — 認證稽核 logger
- [server/services/authThrottle.js](../server/services/authThrottle.js) — 失敗告警 / forgot rate / 新 IP 判斷
- [server/services/ipBlacklist.js](../server/services/ipBlacklist.js) — 黑名單 CRUD + UA 偵測
- [server/services/redisClient.js](../server/services/redisClient.js) — `revokeAllUserSessions` / `incrSharedValue`
- [server/services/webexService.js](../server/services/webexService.js) — `findPersonByEmail` / `sendDirectMessage`
- [server/routes/auth.js](../server/routes/auth.js) — `proceedOrChallenge` / `/2fa/verify` / `/2fa/resend`
- [server/routes/admin.js](../server/routes/admin.js) — `/admin/auth-audit-logs` / `/admin/ip-blacklist`
- [server/database-oracle.js](../server/database-oracle.js) — `runMigrations` 加 3 個新表 + USERS 兩個欄位

**Frontend:**
- [client/src/pages/Login.tsx](../client/src/pages/Login.tsx) — OTP step UI / SSO `mfa_challenge`
- [client/src/context/AuthContext.tsx](../client/src/context/AuthContext.tsx) — `verifyMfa` / `resendMfa`
- [client/src/components/admin/AuthAuditLogsPanel.tsx](../client/src/components/admin/AuthAuditLogsPanel.tsx) — 認證稽核查詢
- [client/src/components/admin/IpBlacklistPanel.tsx](../client/src/components/admin/IpBlacklistPanel.tsx) — IP 黑名單管理

**K8s:**
- [k8s/ingress.yaml](../k8s/ingress.yaml) — whitelist + limit-rps

**i18n:** `client/src/i18n/locales/{zh-TW,en,vi}.json`(`login.mfa.*` + `admin.tabs.{authAudit,ipBlacklist}`)

---

## 10. 補丁邏輯 / 設計決策

- **IP 信任 /32 嚴格而非 /24**:外網本來就要嚴,鄰居 NAT 共用風險不可接受
- **改密碼一律踢 trusted IPs + sessions**:標準做法,密碼洩漏後第一道補救
- **MFA 不做帳號鎖定**:5 次失敗只刷 challenge,防止惡意鎖人
- **不擋 curl/wget UA**:K8s probe 用 curl,內部腳本用 wget,誤殺風險高
- **SSE 路徑跳過 rate limit**:單連線多 chunks 不該算多次 request
- **Audit log 永久保留**:認證稽核合規角度永久比較硬,Oracle 量上沒問題
- **Webex DM 失敗 hard error**:不能默默放行(等於 MFA 形同虛設)
