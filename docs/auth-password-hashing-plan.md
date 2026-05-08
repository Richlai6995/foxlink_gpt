# Auth Password Hashing — 風險評估與遷移規劃

> **狀態**:**PR-1 已 ship**(2026-05-09)
> **作者**:資安白箱審計 → Claude
> **範圍**:解決 `users.password` 明文存 Oracle 的 critical 漏洞
> **實際工時**:當天完成(策略升級為 batch migration,比原規劃更乾淨)

---

## 1. 問題陳述

`users.password` 欄位目前以 **明文(plaintext)** 儲存,所有寫入/比對路徑均直接拿原始密碼字串操作。任何能 SELECT 此欄位的角色(Oracle DBA、application user、SQL injection、DB 備份持有者)即可拿到全公司**真實 AD 密碼**。

外網於 2026-05 開放後,攻擊面從「內網威脅」擴大為「全球可達」,本漏洞已從「中度風險」升級為**必須立刻修復的 critical**。

### 1.1 為什麼比一般 SaaS 更嚴重

| 一般 SaaS | Foxlink GPT |
|----------|-------------|
| 密碼僅用於該服務 | LDAP 路徑會把使用者**真實 AD 密碼**寫入本地 DB(line 451/498) |
| 洩漏只影響單一服務 | AD 密碼洩漏 = ERP / VPN / Email / 整個 Foxlink AD 域全爆 |
| 通常 hash 過 | 完全明文,連 SHA-1 都沒有 |
| 加鹽 + 慢 hash | 無 |

### 1.2 攻擊路徑(已成立)

1. **內部威脅**:Oracle DBA、有 SELECT 權限的 ETL 帳號、看備份的 ops 直接撈
2. **SQL injection**:應用層任一處 SQLi(ERP tools 動態 SQL、AI 戰情查詢都是高風險點)→ `UNION SELECT username, password FROM users`
3. **DB 備份外洩**:Synology NFS 備份、磁帶、雲端備份落入第三方
4. **離職員工**:過去任何曾用過此系統的員工密碼仍以明文存在,離職後仍可被撈出
5. **稽核日誌反推**:某些 stack trace / error log 可能意外把 password 物件序列化進 log

---

## 2. 明文密碼 Touchpoint 清單(完整 audit)

### 2.1 寫入點(必須改 hash)

| # | 位置 | 用途 | 改造優先序 |
|---|------|------|-----------|
| W1 | [server/database-oracle.js:268](../server/database-oracle.js#L268) | `ensureDefaultAdmin` 啟動時 INSERT 預設 admin | P0 |
| W2 | [server/database-oracle.js:274](../server/database-oracle.js#L274) | `ensureDefaultAdmin` 每次啟動 UPDATE admin 密碼到 env 值(逃生門) | P0 |
| W3 | [server/routes/auth.js:451](../server/routes/auth.js#L451) | LDAP 登入成功後同步 AD 密碼到本地 DB | P0(高敏感) |
| W4 | [server/routes/auth.js:498](../server/routes/auth.js#L498) | LDAP first-login INSERT 新使用者(含 AD 密碼) | P0(高敏感) |
| W5 | [server/routes/auth.js:1047](../server/routes/auth.js#L1047) | `reset-password` 用 email token 重置 | P0 |
| W6 | [server/routes/auth.js:1092](../server/routes/auth.js#L1092) | `change-password` 已登入使用者改密 | P0 |
| W7 | [server/routes/users.js:94](../server/routes/users.js#L94) | Admin 從管理介面新增使用者(含初始密碼) | P0 |
| W8 | [server/routes/users.js:229](../server/routes/users.js#L229) | Admin 編輯使用者(可選擇變更密碼) | P0 |

### 2.2 讀取點(必須改 `bcrypt.compare`)

| # | 位置 | 用途 |
|---|------|------|
| R1 | [server/routes/auth.js:525](../server/routes/auth.js#L525) | local 登入 `WHERE UPPER(username)=? AND password=?` |
| R2 | [server/routes/auth.js:1089](../server/routes/auth.js#L1089) | `change-password` 驗舊密 `user.password !== old_password` |

### 2.3 衍生風險(本次 PR 順手清,不額外開 ticket)

| # | 位置 | 問題 |
|---|------|------|
| D1 | [chrome-extension/popup.js:82](../chrome-extension/popup.js#L82) | Chrome Extension 把使用者密碼明文存進 `chrome.storage.local`,雖屬 client-side 風險但 user 心智上「密碼存哪都在 Foxlink GPT 系統內」 |
| D2 | `data/aiDashboardCostAnalysisSeed.js:436` | LLM seed prompt 已警告「**絕對不要查 users.password 欄位**」— 顯示開發者本來就知道此欄位敏感,但仍以明文存 |

---

## 3. 設計決策

### 3.1 Hash 演算法選擇

| 候選 | 評估 | 結論 |
|------|------|------|
| `bcrypt`(node-bcrypt / bcryptjs) | 業界標準,cost factor 可調,Node 生態完整 | **採用** |
| `argon2`(node-argon2) | 更現代、抗 GPU 強;但 native binding 在 Alpine / Windows 編譯較坑 | 否決(Docker base 為 node:slim,argon2 native build 在 deploy.sh 沒測過,風險高) |
| `scrypt`(Node crypto 內建) | 不需依賴,但 cost 調整繁瑣 | 否決(無 verify helper) |
| `pbkdf2` | 業界已淘汰 | 否決 |

**最終選擇:`bcrypt`,cost = 12**(2026 標準,單次 hash ~250ms,K8s pod 可承受)

> 改用 `bcryptjs`(純 JS)可避開 native binding 安裝問題,但慢 ~3x;先試 `bcrypt`,build 出問題降級 `bcryptjs`。

### 3.2 Hash 格式 → 直接覆用 `users.password` CLOB 欄位

bcrypt hash 字串長度固定 60 字符(`$2b$12$...`),`users.password` 目前是 `VARCHAR2(255)` / `CLOB`,空間綽綽有餘。**不需要新增欄位**,直接 in-place migration。

### 3.3 LDAP 路徑的特殊處理

#### 為什麼之前要把 AD 密碼存本地?

讀 auth.js:519-525,**LDAP 連不上時會 fallback 到 local DB 比對密碼**:

```js
} catch (ldapErr) {
  console.log('[Auth] LDAP failed, fallback to local DB:', ...);
}
// Local DB fallback (case-insensitive username)
const user = await db.prepare('SELECT * FROM users WHERE UPPER(username) = UPPER(?) AND password = ?').get(username, password);
```

LDAP 服務 down 時,使用者仍能用「上次成功 LDAP 登入時記下的密碼」進系統。這是業務上必要的可用性 fallback(AD server 維護時 ops 仍要能進 admin 介面救火)。

#### 改造方案(三選一,推薦 B)

| 方案 | 描述 | 取捨 |
|------|------|------|
| A. 完全不存 AD 密碼 | LDAP user 的 `password` 永遠 NULL,LDAP down 時直接拒登 | 最安全,但 AD 維護時系統完全無法登入 → ops 反對 |
| **B. Hash 後存 AD 密碼**(推薦) | 每次 LDAP bind 成功後 `bcrypt.hash(password, 12)` 寫回 | 仍保留 fallback 能力,洩漏時攻擊者要逐 hash 暴力破解(成本指數提高) |
| C. 改用 cached JWT | LDAP bind 成功後簽 7 天 cached token,LDAP down 時驗 token 替代密碼 | 最複雜,需要客戶端配合,本次不做 |

**採方案 B**:既保留可用性,又把「明文 AD 密碼大規模洩漏」風險壓回到「個別密碼暴力破解」,風險量級降 10⁶ 以上。

### 3.4 `ensureDefaultAdmin` 邏輯改寫

現況:**每次 server 啟動把 admin 密碼 reset 成 env 值**(database-oracle.js:274)。這是 ops 救命用的逃生門。

改造後:
- INSERT(W1):`bcrypt.hash(envPassword, 12)` 後存
- UPDATE(W2)維持現有行為,但 hash 後寫入 — 確保 ops 改 .env 並重啟後 admin 密碼仍可用,且 DB 內仍是 hash

```js
async function ensureDefaultAdmin(db) {
  const account  = (process.env.DEFAULT_ADMIN_ACCOUNT || 'admin').toUpperCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD || '123456';
  const hashed   = await bcrypt.hash(password, 12);

  const existing = await db.prepare('SELECT id FROM users WHERE UPPER(username)=?').get(account);
  if (!existing) {
    await db.prepare(
      `INSERT INTO users (username, password, name, role, status, creation_method)
       VALUES (?,?,?,'admin','active','manual')`
    ).run(account, hashed, account);
  } else {
    await db.prepare(`UPDATE users SET password=?, role='admin', status='active' WHERE UPPER(username)=?`)
      .run(hashed, account);
  }
}
```

> **副作用警告**:每次 server 重啟都會 re-hash(每次 hash 結果不同,即使密碼相同)。但語意上等價、且只跑一次,可接受。
>
> **強烈建議**順帶把 `DEFAULT_ADMIN_PASSWORD=123456` 換掉(MEMORY.md 紀錄目前是 `123456`,外網開放後等於裸奔)。

### 3.5 既有資料 migration 策略

#### 風險:現有 DB 全是明文密碼

不能直接「刪掉明文 → 強迫所有人 reset」 — 會炸全公司的登入。

#### 規劃 vs 實際差異(重要)

**原規劃**:lazy hash on next login(等使用者下次登入才 hash)。
**實際採用**:**batch migration + lazy fallback** 雙保險,**比原規劃更安全**。

> **為什麼改方案**:lazy-only 有三大缺點 ——
> 1. 久未登入的 user 明文**無限期殘留**,DB 偷走時仍 leak
> 2. **離職員工**的舊明文密碼**永遠**清不掉(他們不會再登入)
> 3. 過渡期攻擊者撈 DB 仍能拿到「未登入過的所有明文」
>
> Foxlink GPT 只有幾百個 user,bcrypt cost=12 batch 一次只要幾秒鐘,**沒必要保留明文 window**。原規劃學自 GitHub/Twitter pattern,但他們是億級 user 才需要 lazy。

#### 採用「**batch hash at startup + lazy fallback**」策略

1. **Migration A(server 啟動時自動跑,zero downtime):**
   - 加欄位 `password_hashed CHAR(1) DEFAULT 'N'`
   - **`ensurePasswordHashing()`** scan 所有 `password_hashed='N' AND password IS NOT NULL` 的 row,逐筆 `bcrypt.hash(plaintext)` 寫回 + flip 'Y'
   - 跑完 DB 立刻**零明文**,包括離職員工的舊密碼也被 hash 化
   - 在 [`server/database-oracle.js`](../server/database-oracle.js) 的 `init()` 流程**最早**執行,確保 fresh install 也有欄位給 ensureDefaultAdmin 用
   - 防呆:遇到看起來已是 bcrypt 的 row 不重 hash,只 flip 旗標

2. **登入比對(R1)— Lazy fallback 雙保險:**
   ```js
   const user = await db.prepare('SELECT * FROM users WHERE UPPER(username)=UPPER(?)').get(username);
   if (!user) return 401;

   let valid;
   if (user.password_hashed === 'Y') {
     valid = await passwordService.verify(password, user.password);
   } else {
     // 防呆 fallback — batch migration 應已清空,但若有 race condition / batch 失敗
     // 漏網的 row,登入時仍能比對 + 補 hash
     valid = (user.password === password);
     if (valid) {
       const hashed = await passwordService.hash(password);
       await db.prepare(`UPDATE users SET password=?, password_hashed='Y' WHERE id=?`).run(hashed, user.id);
       console.log(`[Auth] lazy-hashed password for user_id=${user.id}`);
     }
   }
   ```

3. **所有寫入點改寫(W1-W8):** 一律 `passwordService.hash`,並設 `password_hashed='Y'`

4. **SSO first-login 特例(額外發現):** SSO user 永不走 local 比對,塞 random hash 作 sentinel(避免 `password='' + password_hashed='N'` 留下「空密碼 + 未 hashed」的曖昧狀態)。

5. **觀察期(0 天):** batch 跑完即可,**無需** 30 天等待。
   仍保留 lazy fallback 作雙保險。

6. **PR-3 收尾(可選,非急):**
   - 砍 R1 的 fallback 分支(batch 後永遠不會走到)
   - 保留 `password_hashed` 欄位作 audit 信號

#### 實測結果(2026-05-09)

```
$ node server/scripts/audit-password-hash.js
USERS.PASSWORD_HASHED column exists: ✅

=== 整體分布 ===
  Y: 5 hashed (✅ 安全)

=== 仍 plaintext (n=0) ===

✅ 所有 password_hashed=Y 的 row 格式皆為合法 bcrypt
```

5 個 user 全部 `Y`,**0 plaintext**。批次處理 5 筆耗時 < 2 秒。

### 3.6 `ensureDefaultAdmin` 在 lazy migration 期間的特例

啟動時 reset admin 密碼到 env 值的邏輯會跟 lazy migration 打架(每次重啟都 hash 一次,把 admin 永遠定在 hashed 狀態)。這是預期行為,不修。

---

## 4. 實作計畫(分 PR)

### PR-1:bcrypt + batch + lazy fallback(P0,**已 ship 2026-05-09**)

**Scope(實際完成)**:
- [x] `npm install bcrypt`
- [x] 新增 `server/services/passwordService.js` — 統一封裝 `hash` / `verify` / `isHashed`
- [x] 新增 `server/database-oracle.js` 的 `ensurePasswordHashing()` — 加欄位 + batch hash
- [x] 在 `init()` 中把 `ensurePasswordHashing` 排在 `ensureDefaultAdmin` **之前**(fresh install 必要)
- [x] 改寫 W1-W8 全部寫入點呼叫 `passwordService.hash`(含 SSO sentinel 防呆)
- [x] 改寫 R1 / R2 為 hash-first + lazy fallback
- [x] `ensureDefaultAdmin` 啟動時 hash 化 + 弱密碼警告
- [x] 新增 `server/scripts/audit-password-hash.js` — 觀察 / PR-3 收尾用

**驗收條件(實測通過)**:
- [x] DB 內 plaintext 數量 = **0**(audit script 確認)
- [x] 所有 `password_hashed=Y` 的 row 皆為合法 bcrypt 格式
- [x] ADMIN 用 .env 的密碼登入成功(http=200)
- [x] 重啟 server 後再登入仍成功

**剩餘人工驗證(由開發端 QA)**:
- [ ] 從 client UI 走完登入流程
- [ ] 一般 LDAP user 登入(觸發 W3 LDAP UPDATE 路徑)
- [ ] forgot-password / reset-password 流程
- [ ] change-password 流程
- [ ] admin 從管理介面新增 / 編輯使用者 + 改密碼

### PR-2:DEFAULT_ADMIN_PASSWORD 改強密碼 + 強制 admin reset(P1,本週)

- [ ] .env / k8s secret 換掉 `DEFAULT_ADMIN_PASSWORD=123456`
- [ ] `ensureDefaultAdmin` 加 console warn:若 env 密碼 < 16 字符或符合常見弱密碼樣式 → log 警告
- [ ] 通知 admin 重新 set 強密碼
- [ ] 同步開啟 ADMIN 帳號的 WebAuthn(Face ID / 指紋)雙因子

### PR-3:Fallback 清理(P3,可選,非急)

- [x] ~~寫 admin script `scripts/audit-plaintext-passwords.js`~~ → 已隨 PR-1 完成 [`scripts/audit-password-hash.js`](../server/scripts/audit-password-hash.js)
- [ ] 觀察 server log:確認沒人觸發 `[Auth] lazy-hashed password for user_id=...`(代表 fallback 永遠沒走到)
- [ ] 移除 R1 / R2 的明文 fallback 分支
- [ ] 保留 `password_hashed` 欄位作為 audit signal(未來新欄位漏設時能立刻發現)

### PR-4(衍生,選做):Chrome Extension 不存明文密碼

- [ ] popup.js 改用 token-only(login 成功只存 token,不存 password)
- [ ] token 過期由 user 重新輸入(可加「記住我 30 天」延長 token TTL)

---

## 5. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|------|-----|------|------|
| bcrypt cost=12 拖慢登入 | 高 | 每次登入 +250ms,可接受 | 量測後若有感受可降 cost=10 |
| `bcrypt` native build 在 Docker 失敗 | 中 | deploy 卡關 | Dockerfile 加 `apk add --no-cache python3 make g++` 或降級 `bcryptjs` |
| Lazy migration 期間 SQL injection 仍能撈明文 | 高 | 部分 user 仍裸奔 | 此 PR 不解 SQLi,後續審 ERP tools 時處理;但本 PR 上線後攻擊面隨時間單調收斂 |
| LDAP user 的 hash 化 password 跟 AD 異步 | 中 | AD 改密後本地 hash 仍可用 ≤ 8hr (token TTL) | 修改密碼時 AD 連動觸發 invalidate;本期不做,記在 backlog |
| `ensureDefaultAdmin` 啟動時 hash 把 admin 鎖死 | 低 | 若 .env 密碼錯了 admin 進不去 | 啟動 log 印 admin username + hash prefix,ops 可從 .env 確認 |
| 改密碼 / reset 時 hash 失敗 silently 寫進明文 | 中 | 退化 | passwordService 內部嚴格 throw,呼叫端不 catch,讓 request 500 比靜默成功安全 |
| 既有 DB 明文密碼仍存在於備份檔 | 高 | 即使 prod 改了,舊備份還是裸的 | 通知 ops:本 PR 上線後立刻輪替備份金鑰 + 30 天後刪除舊備份 |

---

## 6. 出 PR 前 checklist

- [ ] `bcrypt` 加到 server/package.json,且 `npm install` 在 Docker build 通過
- [ ] 所有 8 個寫入點 grep `users SET password=` / `INSERT INTO users.*password` 驗證已改造
- [ ] 所有 2 個讀取點 grep `password\s*=\s*\?` / `\.password\s*===?\s*` 驗證已改造
- [ ] 新增 unit test:`passwordService.hash().then(h => verify(p, h))` round-trip
- [ ] 新增 integration test:lazy migration 路徑(明文 → 成功登入 → 自動 hash)
- [ ] runMigrations 加欄位後執行 `SELECT password_hashed, COUNT(*) FROM users GROUP BY password_hashed` 確認結果
- [ ] CHANGELOG / commit message 標明「BREAKING:既有 DB 自動 lazy migration,無需 manual reset」
- [ ] MEMORY.md 更新 `DEFAULT_ADMIN_PASSWORD` 為新值(若 PR-2 一起做)
- [ ] CLAUDE.md 更新 Auth 段:標註「password 以 bcrypt cost=12 hash 後儲存」

---

## 7. Out of Scope(後續 PR / 其他資安項)

下列與密碼 hash 相關但**不在本 PR**:

- LDAP injection(filter `(sAMAccountName=${account})` 未 escape)— 另開 `auth-ldap-hardening-plan.md`
- LDAP TLS `rejectUnauthorized: false` — 同上 PR
- 密碼複雜度 6 字符 → 12 字符 — 另開 PR
- WebAuthn `rpID` / `origin` 不應信任 `x-forwarded-host` — 另開 PR
- SSO state 缺失 — 另開 PR
- Login rate limit 在 K8s 多 pod 不共享 — 另開 PR
- Session token 透過 query string 傳輸 — 另開 PR

---

## 8. 預期成果

- DB 中 `users.password` **永遠不再以明文存在**(PR-3 完成後)
- DBA、SQLi、備份外洩 → 攻擊者拿到的是 bcrypt hash,暴力破解單一密碼成本 ~$1000+(GPU 算力 / 時間)
- LDAP user 的 AD 密碼洩漏風險從「批次明文」降為「逐一 hash crack」
- 整體攻擊面相對現況降 **6 個量級以上**

---

## 變更紀錄

| 日期 | 異動 | 作者 |
|------|------|------|
| 2026-05-08 | 初稿建立(白箱審計後立案) | rich_lai + Claude |
| 2026-05-09 | PR-1 ship:策略從 lazy-only 升級為 batch + lazy fallback,DB 內 plaintext 數量 0 | rich_lai + Claude |
