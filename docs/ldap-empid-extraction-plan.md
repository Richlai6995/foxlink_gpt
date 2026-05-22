# LDAP 工號 Extraction 泛用化計畫

> 2026-05-22 ship — `server/services/empIdExtractor.js`
>
> 起因:2026-05-22 MCP `X-User-Token` 把 Joan_Lu 的工號發成 `999`（DB 內部 PK）
> 而非 9759。Joan 的 Redis session 是 LDAP 還沒同步 employee_id 時建的 — 但更
> 深層的問題是:**LDAP 一開始就沒解析到她的工號**,因為原本邏輯只認
> `"<empId> <name>"` 一種格式,正崴各子公司 AD 寫法不同就漏掉。

---

## 1. 痛點

正崴有多家子公司(foxlink / foxlinkxz / 越南廠 / 菲律賓 / 宿霧),每家 AD 規則不同:

| 子公司 | username 慣例 | displayName 慣例 | 工號塞哪 |
|--------|--------------|----------------|---------|
| 父公司 foxlink | 英文名 + 底線(`JOAN_LU`) | `"9759 Joan Lu 呂貝伶"` | displayName 首碼 |
| 父公司 foxlink | 字母+數字混合(`KM492`) | `"KM492 張小春"` | displayName 首碼(非純數字) |
| foxlinkxz 子公司 | 純數字(`675815`) | `"韓丹丹"` | username 本身 |
| 父公司 foxlink | 純數字(`1872747`) | `"楊曉旭"` | username 本身 |
| 外部 vendor | 英文名(`LUKE_LIN`) | `"林昕學"` | LDAP `employeeID` 屬性 |
| 設備帳號 | 機台代號(`CEBUCNC07`) | 同 username | 無工號(正確 fail) |
| 測試帳號 | `IT.TEST` 之類 | `"IT Test"` | 無工號(正確 fail) |

原本邏輯 `parts[0]` 必須是純數字,只 cover 第一行。其餘全部要 admin 手動補。

---

## 2. 設計

### 2.1 工號 pattern

```js
const EMP_RE = /^([A-Z]{1,3}\d{3,}|\d{4,})$/i;
```

- 純數字 4+ 位:6651 / 9759 / 1872747 / 675815
- 1-3 字母 + 3+ 數字:KM492 / U0033 / J0012
- 排除 1-3 位純數字(太短常是 false positive)

### 2.2 Resolution tier(優先序)

| Tier | Source | 說明 |
|------|--------|------|
| 1 | `ldap_attr` | LDAP `employeeID` / `employeeNumber` / `extensionAttribute1` 屬性。最權威,**不檢查 EMP_RE 格式**(子公司亂取的格式 admin 自行判斷) |
| 2 | `displayName_prefix` | `"<empId> <name...>"`,empId 符合 EMP_RE |
| 2 | `displayName_suffix` | `"<name...> <empId>"`,empId 符合 EMP_RE |
| 2 | `displayName_only` | displayName 整串就是工號(沒有姓名) |
| 3 | `sAMAccountName` | username 本身符合 EMP_RE |
| 4 | `email_local_part` | email `@` 之前符合 EMP_RE |
| - | (null) | 全 fail → admin UI 顯示 ⚠️ 提示手動補 |

### 2.3 寫進 DB:`users.employee_id_source`

新增 VARCHAR2(40) 欄位記錄是哪 tier 抓到的。額外 source 值:

- `sso_emp_cd` — SSO userinfo 給的 `emp_cd`
- `manual` — admin 在 UI 手動改的

Admin UI 對 `manual` / `ldap_attr` / `sso_emp_cd` 顯示中性 grey badge(可信);其他 tier(fallback)顯示橘色 badge 提示「建議複查」。

### 2.4 衝突處理

- **既有 user**:LDAP 重登時,extractor 抓到才更新 emp_id + source;沒抓到不動原值(避免清掉人工補過的工號)
- **`name_manually_set=1`**(admin 鎖姓名):emp_id 和 source 一起不動(同既有設計)
- **Admin PUT /users/:id**:只要 admin 改了 emp_id(跟 DB 不同),source 自動標 `manual`;沒改保留原 source

---

## 3. 實作清單

- [x] `server/services/empIdExtractor.js` — extractor + label map
- [x] `server/database-oracle.js` — `safeAddColumn USERS.EMPLOYEE_ID_SOURCE VARCHAR2(40)`
- [x] `server/routes/auth.js`:
  - [x] LDAP search 多撈 `cn` / `employeeID` / `employeeNumber` / `extensionAttribute1`
  - [x] `authenticateLDAP` 改用 `extractEmpId`,回傳 `employeeIdSource`
  - [x] LDAP UPDATE / INSERT 寫 `employee_id_source`
  - [x] SSO UPDATE / INSERT 寫 `employee_id_source = 'sso_emp_cd'`
- [x] `server/routes/users.js`:
  - [x] GET 回 `employee_id_source` 給 UI
  - [x] PUT 偵測 emp_id 改動 → `employee_id_source = 'manual'`
- [x] `client/src/components/admin/UserManagement.tsx`:
  - [x] 工號欄旁邊顯示 source badge(橘色 = 自動 fallback / 灰色 = 可信)
  - [x] 缺工號顯示 ⚠️ + tooltip
  - [x] i18n keys 三語系

---

## 4. 驗證 case(unit-style sanity test)

`empIdExtractor.js` 已通過下列 10 case(2026-05-22):

| Case | Input | Expected | Source |
|------|-------|----------|--------|
| Joan_Lu | displayName="9759 Joan Lu 呂貝伶" | 9759 | displayName_prefix |
| KM492 | displayName="KM492 張小春" | KM492 | displayName_prefix |
| 純工號 user | sAM="1872747" | 1872747 | sAMAccountName |
| foxlinkxz | mail="675815@foxlinkxz.com" | 675815 | sAMAccountName(或 email_local_part) |
| LDAP attr 權威 | ldapEmpAttr="U0033" | U0033 | ldap_attr |
| displayName suffix | "張小明 12345" | 12345 | displayName_suffix |
| 設備帳號 fail | sAM="CEBUCNC07" | null | null ✓ |
| 測試帳號 fail | "IT.TEST" | null | null ✓ |
| ADMIN fail | "ADMIN" | null | null ✓ |
| LDAP attr 補對 jackal | ldapEmpAttr="6651" | 6651 | ldap_attr |

---

## 5. 沒做(留 future)

1. **ERP cross-check**:parse 出工號後 query ERP `EMPLOYEES` 表確認存在,不存在記 warning log。減少猜錯。需要 ERP DB 連線 + LOV 表 schema 確認。
2. **`sync-org-all` 重 parse**:現有 admin 同步按鈕(`POST /admin/users/sync-org-all`)只同步組織資料,不重 parse 工號。未來可加「Re-extract employee_id from LDAP」按鈕,批次跑一遍 extractor 補既有 user 的 source 欄位。
3. **`employee_id_manually_set` 獨立欄位**:目前 emp_id 鎖定共用 `name_manually_set`,未來可拆分(admin 改 emp_id 但允許 LDAP 同步姓名的 use case)。
4. **LDAP per-OU 規則設定**:讓 admin 在 UI 設定「foxlinkxz OU 工號永遠看 sAMAccountName」之類 hint,給 extractor 用。
5. **單元測試**:現有 sanity check 是 ad-hoc node script,可以放進 Jest / vitest。

---

## 6. 部署 / Rollout

1. `./deploy.sh` 部署 image(會跑 `safeAddColumn` migration,加 `EMPLOYEE_ID_SOURCE`)
2. 既有 user 的 source 一律 NULL — admin UI 會顯示沒 badge 但工號還在,沒問題
3. 從下一次 LDAP / SSO 登入起,新進 user 自動寫 source;既有 user 重登時也補寫
4. 想批次補既有 user 的 source 值:跑 `node server/scripts/purge-stale-sessions.js --apply` 把所有 stale session 砍掉,讓他們重登一輪自動補(這也順便修了 MCP X-User-Token 殘留 session bug)
