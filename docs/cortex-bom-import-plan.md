# Cortex BOM 匯入 → 接引擎 全鏈 實作計畫(SOT)

> 下一刀:把 BOM 建檔/匯入功能層做出來,material rollup 接進 S1 計算引擎,對真 Excel 端到端驗。
> 決策(2026-07-01,user 拍板):**BOM 匯入 → 接引擎全鏈**(不是只做匯入、也不是先做操作 UI)。
> 原則 2「先從 BOM 建立開始,一步一步完整所有程式」的正式起手。

---

## 🅡 RESUME POINT — 2026-07-02(休假前快照 · 約 07-12 回來續作)

> 接手第一件事:讀這節。整條 BOM 鏈(材料匯入 → rollup → 接引擎 → 落庫 → route → 上傳 UI)已打通並自驗;全程 dark-launch(gate `ENABLE_CORTEX_BOM`,flag off = 對現有使用者零影響)。

> **🔄 UPDATE 2026-07-16(回來後 · A 收尾完成)**:
> 1. 揪出並修 **`/cases?projectId` filter bind bug**(bind 綁到 `prepare()` 是 no-op → 專案內 BomSection 永遠 `hasCase=false`、算不了成本)· commit `04490e0`
> 2. BOM 匯入**已搬進專案內**(War Room 報價 Form「📦 BOM/材料」· `requireVisible` · commit `55f496b`);standalone `/projects-platform/bom` 保留當 fallback
> 3. **5 commits `aa89026..04490e0` 已 push** origin/master(0/0 同步)
> 4. **UI 瀏覽器實測通過**:專案 82 → 匯入 8.68(EE 6.181/ME 1.671/PKG 0.828)→ 算成本 total 12.22 = HTTP 一致 · UI 接線確認
> 5. **下一刀 = B-5 兩階段 BOM**(RD 無價匯入 + 採購多組 vendor/price enrich)· user 2026-07-16 拍板先做 · **詳見 §10**(含 SD v0.4 全面對照)

### ✅ 已完成 + commit(master · 全 gated)
| commit | 內容 | push? |
|---|---|---|
| `4b5a5f7` | S0 三軸 RBAC 地基 + BOM superset 50 表 | ✅ 已 push |
| `b51cf3e` | S1 計算引擎(FULL_MVA 1.8522 / SIMPLIFIED 89.5537 對真 Excel ε<0.01 + 落庫 + 冪等)| ✅ 已 push |
| `277638c` | B-1 EE BOM 匯入正規化 + material rollup | ✅ 已 push |
| `aa89026` | B-2 全材料(EE+ME+PKG)rollup 接引擎(computeCase bomInstanceId)| ❌ **未 push** |
| `a099f2c` | B-3 `/api/projects/bom/*` route(import/compute/view · admin-only)| ❌ **未 push** |
| `ab4e1c5` | B-3.5 標準範本上傳(範本下載 + importBomTemplate + React 頁 /projects-platform/bom)| ❌ **未 push** |

→ **回來第一步(可選):`git push origin master`** 把 `aa89026..ab4e1c5` 推上去(dark-launch 安全)。

### 🧪 可測狀態
- **離線 regression(server/ 目錄跑 · 需 ENABLE_CORTEX_BOM=true)全綠**:
  - `test-bom-cost-engine.js` — S1 引擎(DL 9/9 · MVA_SUM 1.8522 · WHOOP 89.5537 · 落庫 · 冪等)
  - `test-bom-import.js` — B-1/B-2(EE 6.017 · 全材料 8.516 · 接引擎)
  - `test-bom-template.js` — 範本產生 + 標準格式匯入 + rollup + 冪等
- **API 端點 e2e 驗過**(harness 假 admin + 真 3007 import)
- ⏸ **UI 尚未瀏覽器實測** — route+React 頁已 commit 但休假前沒點過。**回來先走瀏覽器測試(見下)確認頁面 OK**。

### ▶ 瀏覽器測試(回來先做)
1. 重啟 server(`cd server; npm run dev` · .env 要 `ENABLE_CORTEX_BOM=true` + `ENABLE_PROJECTS_PLATFORM=true`)+ client(`cd client; npm run dev`)
2. 登入 admin(**ADMIN / Foxlink123**)→ `http://localhost:5173/projects-platform/bom`(或 sidebar 內部 Admin → 📦 BOM 匯入)
3. ① 下載範本 → 填 EE/ME/PKG 幾列 → ② 選 case **#1 Rival3-CN(FULL_MVA)** + 上傳 → ③ 看 rollup → ④ 算成本 → ⑤ Total
4. curl 版步驟見對話記錄(login → /bom/cases → /import → /compute → /runs)

### ⏸ 待辦(優先序)
0. **🆕【架構修正 · user 2026-07-02 拍板】BOM 功能要進「專案內」(War Room 報價 Form · RD 權限),不是 standalone admin 頁**。standalone `/projects-platform/bom` 只是 dev-test 臨時入口。**詳見 §9**。這是回來的主線。
1. **UI 瀏覽器實測**(standalone /bom · 驗後端管線 OK)— route+頁已 ship,沒點過。之後照 §9 搬進專案。
2. **決策:SG&A+Profit 慣例分歧** — 引擎 %-based `(MVA+MB)×0.16`=1.686 vs Unit Cost **flat 0.75** → total 12.03 vs 11.12。對應 schema true/quote 雙價。建議雙軌(baseline 加 `sga_profit_mode` 或 run_result mva/sga/profit 雙側)。見 §5 B-2b 註 + §6。
3. **B-4**:ME/PKG **White 變體** + 其他廠(VN/TW)/ Option A/B/C / PKG 多版本選擇(目前鎖 Black+China)
4. **Track N(NRE)**:N-0 golden(NRE Summary quote 37876/true 123566)→ N-1 `bom_nre_item` 表 → N-2 引擎接 `nre_mode`(SEPARATE/AMORTIZED)。見 §8。
5. **S2 三軸 RBAC 整合**:BOM 功能接資料範圍(allowed_org_ids · RD 只看自己專案)/ 欄位機密(true cost vs quote 遮罩)· reconcile v1 `aiCleansheetService`(LLM 舊路)

### 🔑 關鍵事實(免得忘)
- **material = EE+ME+PKG**(≈ Cleansheet motherboard 8.683)· **Unit Cost sheet 是 golden 源 + BOM↔引擎交會點**(Material + MVA + SG&A/Profit)
- sheet 鎖 **Black+China**:EE `EE bom 0227` / ME `ME bom 0618_Black`(V29=1.671)/ PKG `PKG BOM 20241023_Amber`(M32=0.828)
- 真實使用者走 **下載範本→填→上傳**(`importBomTemplate` · header-based · EE/ME/PKG 分頁);硬解 Rival3 原始 23-sheet BOM 是 `format=rival3`(dev fixture only · SHEET_CONFIGS)
- 帳密 **ADMIN / Foxlink123** · caseFactoryId **1=Rival3-CN(FULL)** / **21=WHOOP(SIMPLIFIED)** · projectId 82=Rival3 / 101=WHOOP
- ⚠️ git remote URL 內嵌 GitHub PAT(`ghp_...`)· 建議 revoke 重發
- golden:`tmp/rival3_golden.json`(FULL)· `tmp/whoop_golden.json`(SIMPLIFIED)· `tmp/rival3_gen2_bom_golden.json`(材料)· `tmp/mva_cells_dump.txt`

---

## 0. 現況快照(接手前先讀)

- **S1 計算引擎已完成 + commit master**(`b51cf3e`,接在 S0 `4b5a5f7` 後,**未 push**):
  - `bomCostEngine.computeCase` 兩路徑對真 Excel ε<0.01(FULL Rival3 1.8522 / SIMPLIFIED WHOOP 89.5537)
  - 落庫 run/run_cell/run_result/audit + 冪等
  - 全 dark-launch:gate 在 `ENABLE_CORTEX_BOM`,flag off = 現有使用者零影響
- **BOM 結構鏈(013b `bom_instance/section/item/item_flk/item_mfg/item_price_*`)= 純 schema,零功能層**(無 parse/create/view)
- **material 目前哪來的**:FULL 靠 `computeCase({motherboardCostUsd})` 參數或 `baseline.motherboard_cost_ref`(fixture 灌 8.683);SIMPLIFIED 靠 `bom_cs_case_simplified_line`(fixture 灌材料 line)。**BOM→成本接線尚未做**——這份計畫就是做這個。
- **v1 `aiCleansheetService`(/api/projects/ai/cleansheet-analyze)= LLM 分析式舊路,沒接正規化表也沒接新引擎**。本計畫不動它;日後 S2/整合再 reconcile(當 adapter 或廢棄)。

---

## 1. 目標(端到端可驗)

```
Rival3 Gen2 BOM Excel  →  parse  →  bom_instance + bom_item(正規化 · 三廠/選項)
                                        │
                                        ├─ material rollup(Σ item extended cost / 每廠)
                                        │
                                        └─→ 餵 computeCase 的 material_true(取代 fixture motherboard 8.683)
                                                    │
                                                    └─→ 對 Build Cost sheet 廠別總價 ε<0.01
```

**驗收**:匯入 Rival3 Gen2 BOM → 選 CN 廠 → material rollup 值對得上 Excel「Unit Cost / Build Cost」sheet 的材料小計;再跑 computeCase → 完整報價對 Build Cost 總價 ε<0.01。

---

## 2. Rival3 Gen2 BOM Excel 結構(`docs/Rival 3 Gen2 uni bom_112624_v1_Internal_Troy_Amber rev2.xlsx`)

**23 個 sheet · 多料別(EE/ME/PKG)× 三廠(China/Vietnam/Taiwan)× Option A/B/C** —— 比 Cleansheet 複雜得多。關鍵 sheet:

| # | sheet | 用途 |
|---|---|---|
| 0 | `Unit Cost` (30×45) | 三廠 × Option A/B/C 單位成本彙總(A1 Project=ELM5 · Retail Packaging 分廠分 Option)|
| 5 | `EE bom 0227` (184×45) | **電子料主 BOM**(184 列,主料源,第一刀就抽這張)|
| 3/4/10/11 | `ME bom ..._Black/_White` | 機構料(黑白配色件)|
| 1/2/8/9/12/13 | `PKG BOM ...`(多版本) | 包裝料(多日期版本,要挑對版)|
| 7 | `Build Cost` (37×238) | **成本彙總(驗收 golden 來源)**|
| 6/15/... | NRE / MTE / Dev Labor | 一次性費用(**本刀先不碰**)|

**⚠️ 複雜度雷**:同料別多版本(PKG BOM 有 7 版)、黑白兩色 ME、Option A/B/C、三廠幣別。第一刀**只抽 EE BOM 主料 + 單一廠(CN)+ 單一 Option**,ME/PKG/多廠/多 Option 後續切片。

---

## 2.5 B-0 探勘結果(2026-07-01 已完成)

**golden 源 = `Unit Cost` sheet(不是 Build Cost!)** — Build Cost 是 EV/DV/PV/MP 開發/樣品費(200 台 line charge + NRE),非 per-unit 產品成本。Unit Cost 把全鏈串起(col D=China):

| Unit Cost 列 | 值(China) | 關係 |
|---|---|---|
| EE (Black) / (White) | **6.017395** / 6.088895 | EE 材料(rollup 目標)|
| ME (Black) / (White) | 1.67134 / 1.815194 | 機構材料 |
| Packaging | 0.828095 | 包裝 |
| **Black Material Cost** | **8.51683** | = EE+ME+PKG |
| MVA | **1.8558** | **= Cleansheet 的 MVA(≈1.8522)** |
| PRIME COST (Black) | 10.37263 | = Material + MVA |
| SG&A+Profit | 0.75 | |
| Total Cost Ex-Factory (Black) | 11.12263 | = PRIME + SG&A+Profit |

**✅ 解掉待確認 #3**:Cleansheet motherboard 8.683 ≈ BOM **Material Cost = EE+ME+PKG**(Black 8.517 / White 8.732,8.683 在中間)。**不是只有 EE**。→ material rollup 目標 = EE+ME+PKG 三料別加總;MVA 由 Cleansheet 引擎(S1)算,兩表在 Unit Cost 交會。

**EE BOM 佈局(`EE bom 0227` · 184 列)**:
- header 在 **r3**:`B=Item# · C/D/E=Qt'y(三版) · F=FLK P/N · G=Type · H=SMD/DIP/ASSEMBLY · I=Description · J=Reference · K=Vendor · L=Part number · M=MOQ/SPQ · N/O=L/T · P=U/P(USD) · Q/R=Sub-Total · S=U/P(USD)2 · T=Sub-Total2 · U=Remark`
- **料件列**:B 有 item#、P/S 有單價;下方**多列只有 K(vendor)+L(part#)= 替代供應商**(→ `bom_item_mfg`)
- 分類列:B 欄放類別名(如 "Capacitor" / "Main Board")無 item# → `bom_section`/`bom_category`
- **欄位映射(對帳實證)**:`Σ(S × E) = 6.016795 ≈ EE_black 6.017395`(Δ0.0006)。**用「有價格的 item 列」的 U/P(S 欄)× qty(E 欄)**;**Excel 自帶 Q/R/T sub-total 不可用**(11.35/11.54/19.80,把 alt-vendor/雙情境重複算)。Δ0.0006 待 B-1 釐清(可能 scrap% 或某列手值)。
- golden 檔:`tmp/rival3_gen2_bom_golden.json`

## 3. 目標 schema(013b · 已確認)

**成本不在 bom_item**(它只有 qty/desc/part#),走價格鏈:
- `bom_instance`(project_id→projects · version_no · variant_key black/white · price_strategy MIN|AVG|MAX)
- → `bom_section`(module_category EE|ME · name)→ `bom_category`(process_type SMD|DIP|ASSEMBLY)→ `bom_item`(qty · description · customer_item · fpn/wpn · item_sequence)
- → `bom_item_price_snapshot`(applied_price_usd · price_min/avg/max · strategy_used)→ `bom_item_price_tier`(true_cost_source/fx_rate→true_cost_usd VIRTUAL · quote_price_usd · markup VIRTUAL)
- `bom_item_flk`(FLK 料號候選)· `bom_item_mfg`(替代供應商 ← EE BOM 的 alt-vendor 列)

**B-1 匯入映射**:EE BOM 每「有價 item 列」→ `bom_item`(qty=E 欄 · description=I · customer_item=F FLK P/N)+ `bom_item_price_snapshot`(applied_price=S 欄 · strategy='EXCEL')+ 單一 `bom_item_price_tier`(true_cost_source=S · fx_rate=1 · quote=S)。alt-vendor 列 → `bom_item_mfg`(manufacturer_name=K · mfg_part_number=L)。section=EE,category 依 G/H(Capacitor/SMD…)。

### (原 §3 schema 清單保留於下,已併入上方)

- `bom_instance` — 一份 BOM 的 header(接 projects?case?待確認 FK)
- `bom_section` — BOM 分區(EE/ME/PKG?)
- `bom_item` — 逐料件(part_no / desc / qty / unit_cost / extended_cost / 廠別?)
- `bom_item_flk` / `bom_item_mfg` — 正崴料號 / 廠商料號對應
- `bom_item_price_snapshot` / `bom_item_price_tier` — 價格快照 / 級距
- `bom_erp_item_index` — 接 ERP 料號索引

**接手第一步**:`sed -n '/CREATE TABLE bom_instance/,/)`)/p' server/projects-platform/migrations/013b_bom_collection.js`(+ bom_section/bom_item)拿到真欄位,再定 parse→insert 映射。

---

## 4. 引擎接線點(已備好的 hook)

`bomCostEngine.computeCase(db, opts)`:
- **FULL**:`materialUsd = motherboardCostUsd 參數 ?? baseline.motherboard_cost_ref`。→ **改成:先算 BOM material rollup,當 `motherboardCostUsd` 傳入**(或新增 `materialSource:'bom'` 讓 engine 自己撈 rollup)。
- **SIMPLIFIED**:`materialUsd = Σ simplified_line`。→ WHOOP 的材料 line 未來也可由 BOM rollup 產,但**本刀先做 FULL(Rival3)**。
- run_result 已有 `material_true_usd` 欄,rollup 值落這。

**建議**:新增 service `bomMaterialRollup.js`(讀 bom_item → 依廠/Option 加總 extended cost → 回 material_true),`computeCase` 在 FULL 路徑優先用 rollup(有 BOM 時)否則 fallback 參數/baseline。保持引擎解耦:rollup 是獨立 service,computeCase 只收一個數。

---

## 5. 切片(慢慢推進 · 每刀對 Excel 驗)

| 切片 | 內容 | 驗收 |
|---|---|---|
| ~~**B-0 探勘**~~ ✅ 2026-07-01 | 013b schema 確認 + EE BOM 佈局(header r3 · S×E 映射)+ golden 源=Unit Cost(非 Build Cost)+ 解掉 #3(material=EE+ME+PKG)| golden `tmp/rival3_gen2_bom_golden.json` ✓ · 見 §2.5 |
| ~~**B-1 parse+normalize**~~ ✅ 2026-07-01 | `bomImportService.importEeBom`(Node 直讀 xlsx)抽 EE BOM → bom_instance/section/category/item + price_snapshot/tier + mfg(類別取 G 欄 · 有價列=item · 無價 K/L=替代供應商)| **通過**:item 70 · mfg 137 · cat 10 · rollup 6.0168 對 EE_black 6.0174 Δ0.0006<0.01 · 冪等 ✓ · test-bom-import.js |
| ~~**B-2a rollup 接引擎(EE-only)**~~ ✅ 2026-07-01 | `bomMaterialRollup.rollupMaterial`(獨立 service · 解耦)+ `computeCase({bomInstanceId})` FULL material 改由 BOM rollup | **通過**:run_result.material_true=6.0168=rollup · MVA 隨材料重算 · total(EE-only)9.12 · test-bom-import.js [4] |
| ~~**B-2b 全材料**~~ ✅ 2026-07-02 | config-driven importer(EE/ME/PKG 各 colMap · 匯進同 instance)+ rollupMaterial byCategory | **通過**:EE 6.017+ME 1.671+PKG 0.828=**8.5162 對 Unit Cost Material 8.51683 Δ0.0007<0.01** · material_true 進引擎 · sheet 鎖 Black+China(EE 0227/ME 0618_Black/PKG 20241023_Amber)· test-bom-import.js [5] |

**⚠️ B-2b 發現 · SG&A+Profit 慣例分歧(待拍板)**:引擎(Cleansheet)算 `SG&A+Profit=(MVA+MB)×0.16`(%-based · Rival3 CN → 1.686),但 Unit Cost sheet(客戶報價)用 **flat 0.75**。兩者 total 因此不同(引擎 12.03 vs Unit Cost 11.12)。這**不是 bug**——Cleansheet 是「true cost 詳細建構」、Unit Cost 是「客戶報價(談定的 flat markup)」。**符合 schema 已有的 true/quote 雙價**:引擎 %-based = true 側,flat 0.75 = quote 側 markup。**決策**:平台最終報價走哪個?建議 run_result 的 mva/sga/profit 也做 true/quote 雙軌(quote 側可設 flat markup),或 baseline 加 `sga_profit_mode = pct|flat`。留待 B-3 或專門 slice。
| **B-3 檢視入口** | 極簡 read route/CLI:列 bom_instance / bom_item / 觸發算 / 看 run_result | 能點/查看到匯入的 BOM + 算出的報價 |
| **B-4 擴充** | ME/PKG 料別、三廠、Option A/B/C、多版本挑選 | 各廠/Option 對 Unit Cost sheet |

**MVP 線**:B-0 → B-1 → B-2(打通 BOM→成本端到端),B-3/B-4 後續。

---

## 6. 待確認 / 決策(接手時拍板)

1. **`bom_instance` 掛哪**:接 `projects(id)`?還是 `bom_cs_case_factory`?(cleansheet 是 case_id→projects;BOM 應該也掛 case/project)→ 看 013b FK。
2. **廠別/Option 在 item 層還是 instance 層**:Unit Cost sheet 是「三廠×3 Option」矩陣。item 的 unit_cost 是否 per 廠?→ 決定 schema 用法(可能一個 bom_instance 對一廠一 Option,或 item 帶廠別欄)。
3. **BOM material 與 Cleansheet motherboard 的關係**:Cleansheet 的 motherboard=8.683 是 PCBA 成本;Gen2 BOM 的 EE rollup 是否 = 這個 8.683,還是更大範圍(含 ME/PKG)?→ B-0 對帳時釐清(可能 EE rollup→motherboard,ME/PKG 另外進 material 或 pkg_true)。
4. **parse 方式**:沿用 tmp/ python(openpyxl 先驗 golden)+ Node service(正式匯入)雙軌?還是直接 Node xlsx?→ 建議同 Cleansheet:python 抽 golden 對帳、Node 正式匯入。
5. **Excel 版本雜訊**:PKG BOM 7 版、ME 黑白、Option A/B/C —— B-1 先鎖 EE + CN + 單 Option,其餘明確標「後續」。

---

## 7. 接手第一步(resume 時直接做)

```bash
# 1. 確認 013b 目標 schema 欄位
sed -n '/CREATE TABLE bom_instance/,/)`)/p;/CREATE TABLE bom_section/,/)`)/p;/CREATE TABLE bom_item /,/)`)/p' \
  server/projects-platform/migrations/013b_bom_collection.js

# 2. 抽 EE BOM sheet 欄位佈局 + Build Cost golden(寫 tmp/dump_gen2_bom.py,UTF-8 避 cp950)
#    看 EE bom 0227 的 header 列(part_no/desc/qty/unit_cost/extended 在哪欄)
#    看 Build Cost / Unit Cost sheet 的廠別材料小計 + 總價 → tmp/rival3_gen2_bom_golden.json

# 3. 依 golden 定 parse→bom_item 映射,寫 B-1 匯入 service + 驗證 script
```

**驗證節奏**:同 S1 —— 每刀寫 offline regression(對 golden ε<0.01),user 跑 test 貼結果,綠了再下一刀。全程 gate 在 `ENABLE_CORTEX_BOM`。

---

## 8. Track N — NRE 一次性工程費(2026-07-01 補規劃 · 原漏)

**缺口**:S1 引擎 + B-track 材料鏈都只做 per-unit 產品成本,**NRE 完全沒規劃**。NRE 可「單獨報」或「由產品單價分攤」,平台兩種都要吃。Track N 正交於材料鏈(B-1/B-2),兩者在最終報價匯總。

### 8.1 NRE 結構(`NRE Summary` sheet · 11 項 · 雙價 quote/true)

| # | 項目 | quote(charged) | true(cost) | 明細 sheet |
|---|---|---|---|---|
| 1 | Build Cost | 13600 | 33900 | `Build Cost` |
| 3 | EMC Debugging | 3750 | 3750 | |
| 6 | DVE Chromebook | 165 | 165 | |
| 7 | Travel Expense | 0(waived)| 0 | `Travel Expense` |
| 8 | Dev + NPI Labor | 10000 | 0 | `Dev+NPI Labor`(逐工種 61916)|
| 9 | Reliability(RET/ORT/PkgRET)| 1500+500+361 | ... | `RET(option1/2)` `ORT` `PKG RET` |
| 10 | Unique Fixtures(MTE)| 5000 | 80184 | `MTE NRE`(逐治具 EV/DV 19700 + PV/MP 56524 = 76224)|
| 11 | Tooling | 3000 | 2401 | |
| | **Total** | **37876** | **123566** | |

- **雙價 = 跟 `bom_item_price_tier`(true_cost/quote)同 pattern**,沿用 VIRTUAL 欄。
- 此 Excel 是**單獨報**(Unit Cost 的 per-unit 11.12 **不含** NRE)。
- 有下鑽層:MTE 治具逐項、Dev Labor 逐工種、RET 測項。

### 8.2 Data model(全新 · gated · dark-launch)

```
bom_nre_item(case_factory_id 或 project · 逐項)
  category         VARCHAR2(30)   -- BUILD|EMC|DEV_LABOR|RELIABILITY|MTE_FIXTURE|TOOLING|TRAVEL|DVE
  item_no, description
  qty              NUMBER
  unit_price_true  NUMBER(15,6)   -- true 成本側
  unit_price_quote NUMBER(15,6)   -- quote 收費側
  sub_total_true   VIRTUAL = qty × unit_price_true
  sub_total_quote  VIRTUAL = qty × unit_price_quote
  factory_code     VARCHAR2(20)   -- 選填(MTE 治具廠別相關)
  detail_json      CLOB           -- 下鑽(治具/工種明細)
  remark, sort_order
```
模式開關(掛 `bom_cs_case_factory` 或 quote header,ALTER 加欄):
- `nre_mode        VARCHAR2(12) DEFAULT 'SEPARATE'`  -- SEPARATE | AMORTIZED
- `nre_amortize_qty NUMBER`                          -- 分攤基數(program 總量)

### 8.3 引擎接法

- **SEPARATE**(預設):NRE **不進** computeCase,獨立回 NRE 彙總(quote 37876 / true 123566),當單獨報價交付。
- **AMORTIZED**:`nre_per_unit = Σ NRE(quote) / nre_amortize_qty` → 新增成本 component **`NRE_AMORT`** 進 total。
  - `bom_cs_component` 需加 `NRE_AMORT`(BOTH · seed);`bom_cs_run_result` **加 `nre_per_unit_usd` 欄**(便宜加性 ALTER · gated),total_true/quote VIRTUAL 公式納入。
- computeCase 讀 nre_mode:SEPARATE → NRE 走旁路 service(`bomNreRollup`)只回總表;AMORTIZED → 併入 per-unit。

### 8.4 切片(Track N · 排在 B-2 之後)

| 切片 | 內容 | 驗收 |
|---|---|---|
| **N-0** | 抽 NRE Summary + 明細 sheet golden(quote/true 逐項)→ `tmp/rival3_nre_golden.json` | 對 Total 37876/123566 |
| **N-1** | migration `bom_nre_item` + mode 欄;匯入 NRE Summary 11 項(+ 明細 JSON)| 逐項 + Total ε<0.01 |
| **N-2** | `bomNreRollup` service + computeCase 接 nre_mode;SEPARATE 回總表 / AMORTIZED 加 NRE_AMORT | 兩模式各驗;AMORTIZED 對「per-unit + NRE/qty」|

**不影響現況**:run_result 加 nre 欄是加性 ALTER(gated),現在不加、之後 N-2 再加也不破壞 B-1/B-2。

### 8.5 待拍板(N 開工時)

1. **NRE 掛層級**:project(一產品一組 NRE)還是 case_factory(廠別)?MTE 治具是廠別相關 → 傾向 **project 掛主表 + item.factory_code 選填**。
2. **分攤用 quote 還是 true**:AMORTIZED 通常攤 quote 側(客戶透過量攤付)。預設 quote,可設定。
3. **明細層深度**:MTE/Dev Labor/RET 明細先塞 `detail_json`,還是各自建子表?MVP 先 JSON,之後有 UI 編輯需求再正規化。

## 9. 架構修正 — BOM 功能進「專案內」(RD 權限 · 2026-07-02 user 拍板)

**修正**:BOM 匯入 / 成本試算是**專案內功能**,屬 War Room 的「報價 Form」一環,由 **RD 角色**在自己的專案裡操作 —— 不是 standalone admin 頁。

**✅ 位置變更已做(commit `55f496b` · 2026-07-02)**:新增 `WarRoom/Form/BomSection.tsx` → 報價 Form 加「📦 BOM / 材料」section(scoped 當前 project);route 權限 admin-only → `requireVisible`(專案成員/RD 可用)+ `/cases?projectId` 篩選。standalone `/projects-platform/bom` 保留當 admin dev-test(移出 sidebar)。
**仍待(§9.3 3-5 · 回來續)**:① 其餘 Form section(Packaging/CMF/NRE/成本核算)改讀 bom_*/run_result 取代 data_payload demo ② 真實專案 case_factory 自動建(開案流程)③ 三軸 RBAC 細粒度(S2)。

### 9.1 現況(v1 form section 是 demo · 沒接真 BOM)
War Room 報價 Form 已有 sections(截圖驗證):`客戶資料 / CMF 變體 / Packaging / NRE 成本 / 成本核算`,元件在 `client/src/pages/ProjectsPlatform/WarRoom/Form/`(CustomerSection / VariantSection / PackagingSection / NreSection / FactoryMatrixSection + CleansheetPanel)。
**但**這些 section **讀 `project.data_payload.packaging` 之類的 demo JSON(唯讀、假資料)**,**沒接正規化 `bom_*` 表、也沒接 `bomCostEngine`**。這就是先前一直標記要 reconcile 的「v1 form/demo ↔ 新引擎」。

### 9.2 對應關係(form section ↔ BOM 後端)
| War Room Form section | 後端(新)|
|---|---|
| CMF 變體 / (EE/ME 料)| `bom_instance → section(EE/ME)→ item` + rollup byCategory |
| Packaging | `bom_section(PKG)` + rollup PKG |
| NRE 成本 | Track N `bom_nre_item`(§8)|
| 成本核算 | `bomCostEngine.computeCase` → `bom_cs_run_result`(material/MVA/SGA/Profit/total)|

一個 project ↔ `bom_cs_case_factory`(case_id→projects.id);BOM 匯入寫 `bom_instance.project_id`;compute 用該 project 的 case_factory。

### 9.3 整合計畫(回來做 · 取代 B-3.5 standalone 定位)
1. **後端已就緒**:`importBomTemplate` / `rollupMaterial` / `computeCase` / route `/api/projects/bom/*` 都能用 —— 只是入口要改從專案進(帶 project 的 case_factory)。
2. **前端**:把 BOM 匯入 + rollup + compute 接進 War Room Form(可新增「BOM / 材料」section 或強化 Packaging/CMF/成本核算 section),讓它們**讀 `bom_*` rollup + `run_result`**,取代 `data_payload` demo。RD 在專案內:上傳範本 → 看材料 → 算成本。
3. **權限(S2 三軸)**:RD 角色 × 「編輯 BOM / 算成本」功能權 × 資料範圍(只自己的專案)× 欄位機密(true cost 可能只給特定角色,quote 給業務)。BOM route 從 admin-only 改成走三軸 RBAC。
4. **真實專案要有 case_factory**:demo 專案(如 Q-2026-DEMO-009-SS)目前沒 case_factory;要嘛開案時建、要嘛匯入 BOM 時順帶建(project → 預設 case_factory + baseline 綁定)。
5. standalone `/projects-platform/bom`:保留當 admin dev-test / 或搬進專案後移除。

### 9.4 開放問題(回來拍板)
- form_template 驅動的 section(v0.5)vs 正規化 bom_* — 是「form 存 data_payload、算完寫回」還是「form 直接讀 bom_*」?建議後者(bom_* 為真相源,form 只是 UI)。
- 開案流程要不要自動建 case_factory + 選 baseline(廠/版本)?
- CMF「變體」(Black/White)↔ bom_instance.variant_key 的 UI 綁定。

## 10. SD v0.4 全面對照 + B-5 兩階段 BOM(2026-07-16 · user 拍板 B-5 先做)

> 觸發:user 問「RD 初期只有料號、沒單價/供應商,後面採購才補『多組』vendor/mfg + 單價,對不對?」→ 對照 `docs/bom-collection-sd.md` **v0.4** 確認這正是 SD §0/§1.2/§19 原設計。

### 10.1 定位:目前是 SD 的「垂直切片」
- SD v0.4 = 10-12 週完整規格(ERP 串接 + AI 補料 + 多組織資料政策 + 雙價 true/quote + 多維 廠×變體×量×PKG 結果)。
- SD 附錄 A 白紙黑字:**P0 前置 = §16.5 MVA 6 問業主拍板才開工** → 整份 SD 當年卡在 MVA。
- 我的 S0-B3.5 切在這裡:**把 MVA 引擎逆向到 ε<0.001(解掉 SD 卡點)**,代價是 BOM 匯入走「template 手打價」測試捷徑,跳過 SD §3/§4 ERP/AI 資料收集。
- **結論:引擎維度超前 SD,資料收集維度落後 SD。**

### 10.2 Schema:013b/013c 已 100% 對齊 SD v0.4(已 migrate)
「RD 可選填 vendor/mfg、採購補多組 + 多單價」**不用改結構**:
| 需求 | SD | 已建表 |
|---|---|---|
| 多組 vendor/mfg | §2.2.6 | `bom_item_mfg`(1..N · flk 連結 · is_preferred)|
| 採購多單價 | §19 | `bom_item_price_tier`(N tier · true/quote · markup VIRTUAL · is_chosen)|
| FLK 候選 | §2.2.5 | `bom_item_flk`(RD_MANUAL/AI/ERP source)|
| 價格聚合 | §2.2.7 | `bom_item_price_snapshot`(min/avg/max · po/vendor count)|

缺的是**填滿的服務層**,不是 schema。

### 10.3 缺口盤點(service/UI 層)
| SD | 建? | 現況 |
|---|---|---|
| §2 schema | ✅ | 013b/c 全 migrate |
| §16.5 MVA 引擎 | ✅ 超前 | ε<0.001,SD 當年沒做 |
| §3 ERP 串接(價格聚合 PO 歷史)| ❌ | 「採購價從 ERP」核心 · 沒 service |
| §4 AI 補料 | ❌ | 表在 pipeline 沒跑 |
| §3.5 ETL embedding | ❌ | `bom_erp_item_index` 表在沒填 |
| §19 雙價 tier | 🟡 | 只填 1 tier(template 手打)|
| §17 多 PKG / §18 Qty scenario | 🟡 | 表在,引擎鎖單一 |
| §19.2.3 多維 run_result | 🟡 | 只寫單維 |
| §16 factory_matrix 4 表 | ❌ | 還是 data_payload JSON(= §9.3 主線)|
| §20 view_true_cost 遮罩 | ❌ | = S2 RBAC |
| §8.4 single-edit lock/heartbeat | ❌ | 多人同編保護沒做 |
| §3.0 多組織資料政策 L4 | ❌ | 沒接 multiOrgService |

### 10.4 B-5 切法(對齊 SD §0 步驟 1-3 + §19 + §2.2.6)
| 刀 | 內容 | 依賴 | 排 |
|---|---|---|---|
| **B-5a** RD 無價匯入 | `importBomTemplate` price 可空 → 建 item + flk(RD 填 fpn/mfg 就寫)+ snapshot 標 `PENDING`;rollup 回 pending count;compute gate 擋未詢價 | 無 | **先做** |
| **B-5b** 採購手動 enrich | UI 逐料填**多組 mfg** + **多 tier 價**(true/quote)+ 選 `is_chosen` · 寫 SD schema | B-5a | 接著 |
| **B-6**(原 B-5c)ERP 自動帶價 | 接 SD §3.2.4 PO 歷史聚合 + §3.2.1/3.2.3 ERP 反查 FLK/mfg | ERP pool + multiOrgService + ledger 反推 | **延後** |

### 10.5 決策/取捨
1. ERP 自動帶價很重(ETL 8-16h 初次 + multiOrgService + ledger OU 反推)→ B-5 只做手動(a+b)寫 SD schema,ERP 自動化切 B-6 延後。
2. 雙價 true/quote 跟 SG&A/Profit 雙軌決策合流 → rollup 現讀 `applied_price`,B-5b 後要能選 true / quote 兩軌。SD §19:markup 主要藏料件 true→quote 價差,SG&A 只象徵值。
3. view_true_cost 遮罩(§20)先不做,但 B-5b UI 預留 true/quote 兩欄(S2 RBAC 再加遮罩)。
4. §16 factory_matrix 4 表現可開工(MVA 已解),屬 §9.3/9.4 主線非 B-5。

### 10.6 B-5a 實作契約(給接手/自己)
- `importBomTemplate`:qty 必填、**price 可空**。每列都建 `bom_item`;有 fpn → 建 `bom_item_flk`(source `RD_MANUAL`)+ 設 `bom_item.final_flk_id`;有 vendor/mfgPn → `bom_item_mfg`(連 flk)。
  - 有價:snapshot `strategy_used='TEMPLATE'` + applied_price + 1 tier(is_chosen)· `pricedCount++`
  - 無價:snapshot `strategy_used='PENDING'` + applied_price=NULL + 無 tier · `pendingCount++`
- `rollupMaterial`:回傳加 `pricedCount / pendingCount`;`materialUsd` 只加已詢價(applied 非 NULL)。
- `computeCase`:`opts.allowPending`(預設 false)· bomInstanceId rollup 有 pending 且未 allow → throw `BOM_HAS_PENDING_PRICES`(route 轉 409 + pendingCount,帶 `force=true` 才放行)。

## 附:相關檔案索引

- 引擎:`server/projects-platform/services/bomCostEngine.js`(computeCase / persistRun)
- S1 計畫 + 驗證:`docs/cortex-s1-cost-engine-plan.md`、`server/projects-platform/scripts/test-bom-cost-engine.js`
- BOM schema:`server/projects-platform/migrations/013b_bom_collection.js`
- 待抽 Excel:`docs/Rival 3 Gen2 uni bom_112624_v1_Internal_Troy_Amber rev2.xlsx`
- golden(S1):`tmp/rival3_golden.json`、`tmp/whoop_golden.json`、`tmp/mva_cells_dump.txt`
- 記憶:`project_cortex_cost_engine_s1d.md`(S1 全紀錄 + 兩 bug + 設備真模型)
