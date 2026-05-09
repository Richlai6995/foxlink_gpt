# Auth LDAP Hardening — 規劃與實作紀錄

> **狀態**:**已 ship**(2026-05-09)
> **作者**:資安白箱審計 → Claude
> **範圍**:解決 LDAP injection(#2)+ LDAP TLS 不驗 cert(#3)兩個 critical / high
> **影響檔案**:[server/routes/auth.js](../server/routes/auth.js)、`server/.env.example`、[server/scripts/test-ldap-escape.js](../server/scripts/test-ldap-escape.js)

---

## 1. 問題

### 1.1 LDAP injection

```js
// auth.js (修補前)
const opts = {
  filter: `(sAMAccountName=${account})`,  // ← user input 直接 string interpolation
  scope: 'sub',
  ...
};
```

`account` 來自登入表單,直接拼 LDAP filter。攻擊向量:

| Payload | 後果 |
|---------|------|
| `*` | filter = `(sAMAccountName=*)` → 列舉全 AD 帳號 |
| `*)(objectClass=*` | filter = `(sAMAccountName=*)(objectClass=*)` → 任意條件搜尋 |
| `admin)(|(cn=admin*)` | 找特定條件 user(如所有 admin* 開頭) |
| `*)(displayName=*` | enumerate displayName 規則 |

> **bind 仍要密碼正確才過**,但攻擊者已能列舉/probe AD 結構,且若 search 多筆 entry,`searchEntry` 事件被多次觸發,程式只取最後一筆 → 攻擊者可用「特定條件密碼有效」的目標 user 強行 bind。

### 1.2 LDAP TLS 不驗 cert

```js
tlsOptions: { rejectUnauthorized: false }
```

ldaps 連線跳過 cert 驗證 → 內網有跳板的攻擊者可 MITM 攔截 manager bind 跟員工 bind 流量,**直接偷明文密碼**(LDAP bind 的 simple auth 本來就是明文密碼,只靠 TLS 保護)。

`CLAUDE.md` 寫「LDAP 走 ldaps」,但這行讓 ldaps 等於沒開。

---

## 2. 修補

### 2.1 LDAP injection — 雙層防護

**第一層:RFC 4515 escape**(`escapeLdapFilter`)

```js
function escapeLdapFilter(s) {
  return String(s).replace(/[\\*()]/g, (c) => {
    switch (c) {
      case '\\': return '\\5c';
      case '*':  return '\\2a';
      case '(':  return '\\28';
      case ')':  return '\\29';
      default:   return c;
    }
  });
}
```

**第二層:username 白名單**(`isValidLdapUsername`)

```js
const LDAP_USERNAME_REGEX = /^[A-Za-z0-9._\-@]{1,64}$/;
```

Foxlink AD username 規範一律 alphanumeric + 少數符號。`authenticateLDAP` 入口先 reject 不合白名單的 input(包含 NUL byte / 控制字元),escape 失效仍能擋。

> 第一層用 escape 是因為 sAMAccountName 規範上允許某些非英文字元(雖然實務沒人這樣設),保留 escape 容錯。第二層白名單是激進的「Foxlink 用法」防護。

被 reject 的 input 不洩漏「格式錯」訊息,跟「找不到此帳號」同回應,避免攻擊者 probe 白名單規則。

### 2.2 LDAP TLS — 三段式 fallback

`buildLdapTlsOptions()` 啟動時根據 env 決定 tlsOptions:

| 條件 | 行為 | 適用 |
|------|------|------|
| `LDAP_CA_PATH` 設定且檔案讀得到 | `rejectUnauthorized: true, ca: [PEM]` | **prod 推薦**(自簽 CA) |
| `LDAP_TLS_VERIFY=true` 但無 CA | `rejectUnauthorized: true` 走 system root | 公網 CA 簽的 cert |
| 預設(沒設) | `rejectUnauthorized: false` + 啟動 warn | **過渡期**(現況沿用,大聲警告) |

啟動 log:
```
[LDAP] ⚠️  TLS verify DISABLED — MITM 風險。請設 LDAP_CA_PATH 啟用 CA 驗證
[LDAP] TLS verify ENABLED (CA=/app/certs/foxlink-ad-root.pem)        ← 正確設定後
```

**沒立刻 enforce 的原因**:
- prod 跑中的 LDAP cert 可能是自簽 + 沒人手上有 CA 副本
- 立刻強驗證會炸所有 LDAP 登入 → 員工進不來
- 改成「預設不驗 + 啟動 warn」推 ops 自己升級

**ops 升級流程**:
1. 從 AD 拿 root CA pem(domain controller `Active Directory Certificate Services` 匯出)
2. 放進 `server/certs/foxlink-ad-root.pem`(K8s 用 ConfigMap 掛 volume)
3. `.env` 設 `LDAP_CA_PATH=./certs/foxlink-ad-root.pem`
4. 重啟 → 看到 `[LDAP] TLS verify ENABLED (CA=...)` 即成功
5. 試一個 LDAP 登入,確認 bind 成功(若 cert 跟 host 不對,會回 `Hostname/IP does not match certificate`)

---

## 3. 測試

### 3.1 Escape 單元測試

`server/scripts/test-ldap-escape.js`:

```
✅ "ADMIN"          → "ADMIN"
✅ "rich_lai"       → "rich_lai"
✅ "user.with.dots" → "user.with.dots"
✅ "*"              → "\2a"
✅ "*)(uid=*"       → "\2a\29\28uid=\2a"
✅ "admin)(|(cn=*"  → "admin\29\28|\28cn=\2a"
✅ "back\slash"     → "back\5cslash"

7/7 passed
```

### 3.2 整合測試(由開發端 QA 跑)

- [ ] 正常 AD 帳號登入 → 仍可進
- [ ] LDAP server log 看 search filter,確認 `(sAMAccountName=ADMIN)` 沒帶 escape 字
- [ ] 送 `username='*'` → 401 + server log 印 `[LDAP] rejected suspicious username`
- [ ] 送 `username='admin)('` → 401 + 同上
- [ ] 設 `LDAP_CA_PATH` 後重啟,登入仍 OK + log 印 `TLS verify ENABLED`
- [ ] 故意設錯誤 PEM 檔 → 啟動印錯誤 + 退回 unverified 模式

---

## 4. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|------|-----|------|------|
| 白名單 regex 拒絕了某員工合法 username(如含中文) | 低 | 該員工進不來 | Foxlink AD 規範皆 alphanumeric;真碰到放寬 regex 即可(改 LDAP_USERNAME_REGEX) |
| `LDAP_CA_PATH` 路徑錯 | 中 | warn 後降級不驗證,LDAP 仍可用 | log 明確指出 path,ops 易修 |
| 自簽 CA 的 cert SAN/CN 不對 | 中 | TLS handshake 失敗 → 全 LDAP 登入炸 | 上線前先用 `openssl s_client` 驗,確認再設 LDAP_CA_PATH |
| Server 啟動 warn 被 ops 忽略 | 高 | TLS 持續不驗,#3 沒實質解決 | 文件 + Slack 告知:本 PR ship 後**還是**要拿 CA |

---

## 5. 後續(out of scope)

- 此 PR **不**處理:
  - `manager_bind` 改用 cert auth(目前仍 simple bind)— 通常不必
  - LDAP 連線池(每次 createClient 是 fresh)— 性能無感不急
  - LDAP search timeout(沒設)— 萬一 AD hang 會影響登入,可加 `connectTimeout`
- PR-ldap-2 候選:**ops 拿到 CA 後**確認驗證通過,把 fallback 「預設不驗」改成「預設驗 + 沒 CA 直接拒絕啟動」(類似目前 MFA 強制檢查)

---

## 變更紀錄

| 日期 | 異動 | 作者 |
|------|------|------|
| 2026-05-09 | 初稿 + ship(白箱審計 #2 + #3) | rich_lai + Claude |
