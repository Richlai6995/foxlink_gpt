# ERP 補資料（emp-match）設計與實作

> 各廠 AD 規則不一,登入建帳號後常缺工號 / Email,且 AD 衍生的工號可能根本不是 ERP 真正的
> `EMPLOYEE_NO`。本功能以**姓名反查 ERP 員工主檔**取得權威工號 + Email,經**人工審核**後寫回。

## 核心洞察

- 既有 [orgSyncService](../server/services/orgSyncService.js) 是「用工號**正查** ERP → 回填 email/org」。
- 真正缺口:AD 抽出的工號（[empIdExtractor](../server/services/empIdExtractor.js) 從 displayName 猜）可能錯 →
  正查撈不到 → email 永遠空。
- 所以改用**姓名反查**取得權威 `EMPLOYEE_NO` + `EMAIL`,accept 時**覆寫**錯誤工號並補 email,
  再呼叫 orgSync 回填組織。

## Pipeline

| Stage | 內容 |
|-------|------|
| 1 候選生成（純 SQL,批次）| 取核心中文名 → `C_NAME IN (…)` exact;未命中再 `C_NAME LIKE '%核心名%'`（抓 ERP 側也含英文/括號的） |
| 2 分流 | 無中文名→tier C；0 候選→no_match；1 候選精確→tier A（免 LLM）；1 候選混名→tier B；≥2 候選→tier B（LLM） |
| 3 LLM（只 tier B 多候選）| Flash + 結構化 JSON,批次 15 人/call,挑 emp_no + confidence + reason,無法判定回 null 交人工 |

`extractCoreName` 抓最長 CJK 連續段:`趙開心 Joy` / `Joy Zhao 趙開心` / `趙開心(Joy)` / `KM492 張小春` 都正確
抽出中文名;`xzmis` / `FDNM02` 等純英文回空 → tier C 建議豁免。

## 資料模型

**`emp_match_suggestions`**（一 user 一筆,unique index on user_id）
- `status`: pending｜accepted｜rejected｜no_match｜conflict
- `tier`: A｜B｜C、`suggested_emp_no/email/name/dept`、`confidence`、`reason`、`candidates_json`、`conflict_user_id`
- scan 用 delete-then-insert 只刷新 pending/no_match/conflict;accepted/rejected 不動且不重撈。

**`users` 新增豁免欄位**（共用/管理帳號永久跳過）
- `emp_match_exempt` / `emp_match_exempt_reason` / `emp_match_exempt_by` / `emp_match_exempt_at`
- 三種狀態分清楚:`rejected`（這筆建議錯,人還在,可再試）≠ `no_match`（暫查無）≠ `emp_match_exempt`（帳號非真人,永久跳過）。

## API（皆 verifyAdmin,掛 [users.js](../server/routes/users.js)）

- `POST /api/users/emp-match/scan` `{userIds?, useLLM?}` → 產建議,回統計
- `GET  /api/users/emp-match/suggestions?status=` → 審核清單（JOIN users 帶現值 + 衝突帳號）
- `POST /api/users/emp-match/suggestions/:id/accept` `{emp_no?}` → 寫回;工號衝突回 **409**（擋下人工）
- `POST /api/users/emp-match/suggestions/:id/reject`
- `POST /api/users/emp-match/users/:id/exempt` `{reason}` / `DELETE …/exempt`（取消）

## 前端

- [UserManagement](../client/src/components/admin/UserManagement.tsx) 頂部「ERP 補資料」按鈕 → 切換子畫面
  [EmpMatchPanel](../client/src/components/admin/EmpMatchPanel.tsx)（同畫面內 view 切換,非獨立 route）。
- 子畫面:掃描鈕 + AI 開關 + 狀態 tab（待審/工號衝突/查無·建議豁免/已處理）;
  tier A 精確命中支援**批次接受**;tier B 多候選用下拉挑;每列可 接受 / 拒絕 / 🚫 免比對。
- 列表頁:`已豁免` filter chip + 姓名旁「已豁免」badge（點擊取消）。
- i18n key `users.empMatch.*` / `users.filter.exempt` 三語齊全。

## 關鍵決策（與需求對齊）

1. **審核畫面** = 使用者管理內的子畫面（view 切換),非 Modal、非獨立 route。
2. **工號衝突** = 擋下標 `conflict` 給人工處理,**不自動**寫入 / 不自動合併。
3. **共用/管理帳號** = user 層級 `emp_match_exempt` 旗標,scan 永久跳過;可自動預判（無 CJK 名）但只「建議」不自動執行。

## 雷區處理

- `employee_id` UNIQUE:accept 前先查占用 → 衝突擋下（避免 ORA-00001 噴 500）。
- 覆寫 vs 補空:accept 直接覆寫 `employee_id`（修正錯誤）+ `employee_id_source='ai_matched'`;email 僅當現值空白才覆蓋。
- 離職:候選查詢恆帶 `CURRENT_FLAG='Y' AND END_DATE IS NULL`。
- 成本:tier A/C 不進 LLM;tier B 批次打包;結果寫表快取,開畫面不重算。

## 已知限制 / 後續

- scan 目前**同步**執行（axios 5 min timeout 內）。量大（上千 tier-B）需改背景 job + SSE（抄 research_jobs）。
- 「零訊號 + 同名多人」(org 也空) AI 無法判定 → 一律攤候選交人工,這是資料本質限制。
