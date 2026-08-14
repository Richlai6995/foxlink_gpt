# Cortex v0.15 demo 驗收清單(一頁)

> 檔案:[Cortex_互動Demo_v0.16.html](Cortex_互動Demo_v0.16.html)(最新 · v0.15 為前一版)· 對應 SD:[cortex-integration-sd.md](cortex-integration-sd.md)
> 用法:照「操作」做,核對「預期」,勾 ☐。右上「登入身分」是唯一切角色入口。
> 進報價 Form 路徑:**點專案卡 → 戰情會議室 → 報價 Form 分頁**(form 不在首頁)

---

## A. 角色切換 → section 權限投影(報價案視圖)

| 操作 | 預期 | ☐ |
|---|---|---|
| 登入身分切 **Troy 黃(RD)** | 左 nav 只剩 BOM/CMF變體/Gap;成本類全進「🔒 無權檢視」· BOM 內容完整可編 ✏️ | ☐ |
| 切 **Amy 業助** | §Margin **整段消失**(nav 不出現);多數 section 唯讀 👁 | ☐ |
| 切 **Mike 王(DPM)** | §Margin/成本核算/多廠矩陣 全出現;section 頂 banner 顯 view✓ edit✓ | ☐ |
| 切 **David(一人多役 BPM+業務+業助)** | section 變多(權限聯集 union) | ☐ |
| 每 section 頂 banner | 顯「查 F_XXX · 不查角色字串」+ view/edit/機密欄狀態 | ☐ |

## B. 機密欄遮罩(軸③)

| 操作 | 預期 | ☐ |
|---|---|---|
| **Amy 業助**(無 VIEW_TRUE_COST)進 §成本矩陣 | true cost / MVA 欄打 ▒;quote 欄仍可見 | ☐ |
| **Mike DPM**(有兩 cap)同頁 | 雙價全顯,無遮罩 | ☐ |
| 無 VIEW_MARGIN 者 | §Margin 整頁隱藏(非打▒ = 反推鎖) | ☐ |

## C. SoD 動作鈕(distinct-actor · 5 對)

| 操作 | 預期 | ☐ |
|---|---|---|
| **Mike DPM** 進 §成本核算 → SoD 動作條 | 「🔒 Final Lock · SoD 擋」紅 disabled(他是此案 cost maker)+ Baseline 二簽 | ☐ |
| **Andy EPM** 進 §製程/Cleansheet(切 WHOOP 案 QT-2026-0167) | 「🔒 廠 Lock · SoD 擋」(他是 process maker) | ☐ |
| **Karen 周(採購+採購主管)** 進 §詢價彙總 | 「✅ 核准採購策略 · SoD 擋」(自建自核) | ☐ |
| 滑過 disabled 鈕 | tooltip 顯 SoD 原因 | ☐ |

## D. IT 權限後台(切 **Cortex Admin** → 左 nav 🔐 權限/角色)

| 操作 | 預期 | ☐ |
|---|---|---|
| **矩陣** 點某格 verb | 即時切 ALLOW(綠)/無(灰)· 表頭三語(滑過顯 en) | ☐ |
| 矩陣表頭 **+新建/⧉複製/✏️改名/🚫停用/🗑刪** | seed(⭐)不可刪只可停用;自建(🆕)可刪 | ☐ |
| 改 DPM 的 F_COST_MATRIX view → 切 Mike | §成本矩陣消失(改格即時生效=角色動態) | ☐ |
| **三軸彙總** 選 role | ①Function grid ②角色↔資料政策(org+caps)③caps ④**對應使用者(指派/移除)** | ☐ |
| 三軸彙總軸③ 點 DPM 的 VIEW_MARGIN(off)→ 切 Mike | §Margin 即時消失(角色↔資料政策落地) | ☐ |
| 三軸彙總「+ 指派給」 | 選 user → 即時加角色 · 移除 ✕ · 無 F_ROLE_ASSIGN 者該選單灰(分權) | ☐ |
| **Gate** 分頁 | F_QUOTE_APPROVE 🚨「被架空(無人持)」 | ☐ |
| **變更稽核 Audit** 分頁 | 權限變更/角色 CRUD/指派/gate-skip/SoD 命中 時間序列 | ☐ |
| **Config Lint** 分頁 | 過授/缺口警示(業助看矩陣全遮、F_QUOTE_APPROVE 架空、Karen 自核、admin 雙權) | ☐ |

## E. 機密策略 / 資料政策(切 admin → 左 nav 🔒)

| 操作 | 預期 | ☐ |
|---|---|---|
| 開畫面 | 軸②(L1-L4 + **角色→org live 表**)+ 軸③(欄位政策 + **各 user 當前 cap live 表**) | ☐ |
| 三軸關係說明 | ① 進不進 function → ② 看哪些列 → ③ 列裡哪些欄 | ☐ |

## F. admin-only nav + 殘留檢查

| 操作 | 預期 | ☐ |
|---|---|---|
| 非 admin(Mike)看左 nav | 「🔐 權限/角色」「🔒 機密策略」**完全隱藏**(看不到 · v0.16 定案) | ☐ |
| admin 看 | 兩項出現、正常開 | ☐ |
| 右上切換器 | **只剩「登入身分」一個**(舊 DEMO 視角已移除) | ☐ |

---

## 已知簡化(demo 故意不做 · 生產才補)

- 軸② scope 只展示不實際比對 org 列 · gate `isGateActive()` 靜態 · stage/lock 短路未做
- function 27/35(補了 SoD/Gate 故事線需要的;其餘生產補)· SoD/Gate/scope 規則編輯 UI 未做
- distinct-actor maker 用 `CASE_MAKERS` 寫死(生產讀 `project_editing_log`)

## 驗收後想調的點(回填)

- [ ] ……
- [ ] ……
