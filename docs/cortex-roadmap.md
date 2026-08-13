# Cortex BOM 報價平台 — Roadmap(SOT)

> 更新:2026-08-06。**下一步規劃的唯一紀錄處** —— 拍板/完成後更新此檔。
> 相關:[cortex-bom-source-excel-structure.md](cortex-bom-source-excel-structure.md)(資料 SOT)· [cortex-bom-import-plan.md](cortex-bom-import-plan.md) · [cortex-cost-model-import-plan.md](cortex-cost-model-import-plan.md) · [cortex-whoop-e2e-plan.md](cortex-whoop-e2e-plan.md)

## ✅ 已完成(至 2026-07-29 · commit 460d4f0)

| 區塊 | 內容 |
|---|---|
| 統一匯入 | canonical v2 格式(半成品料號/名稱/分類/Item No/FLK/適用)· mapping profile(進階轉檔)· MERGE 分開匯入 · 變異軸隨檔(「變異軸」分頁自動建定義) |
| super-BOM 變異 | 料層 effectivity(顏色/包裝)· 先定義硬擋 · 產品配置切換((全部) 選項)· 明細/rollup/compute/run 全連動 |
| BOM 層級 | Item→FLK候選→Vendor 三層 · ERP 樹狀明細(模組tab→半成品→分類)· 換料/換價連動 · 自然排序 |
| 多廠矩陣 | 配置×廠別 on-demand+快取 · 算全部/重算全部 · 👑 最便宜 |
| 成本模型(C 系列) | 通用匯入/匯出(round-trip 六位等值 · SIMPLIFIED 3頁/FULL 8頁)· 月薪→時薪換算 · 範本庫(系統範本專案+版本化+停用)· 標準範本三層指南 · NRE/NRE-Config 隨檔 |
| 流程終點 | NRE 攤提入 total · 定版送審(SoD)· W3 端到端(開案→官方版)驗證 |
| DEMO | tmp/cortex-demo/ 6 檔+README(兩檔=一專案全資料 · 純檔案零手設 e2e 驗證) |
| **P1 全清(2026-07-28/29)** | **S2 機密遮罩**(6f6a95c:bom router res.json 深層遮 true/margin · RoleSwitcher 即時 · cost-model 匯出 403)· **報價 PDF**(191da17/467f4f6:雙語 zh/en · 檔名=碼+名+日期+語言 · DRAFT 浮水印 · quote 側 only)· **Stage Gate**(6a60246/123d527:開案 activate 第一階 + BOM 六事件自動推進(import/詢價完/compute/compare/submit/approve)+ CustomEvent 即時刷 ribbon)· **議價紀錄**(93e2306:013t 輪次 · vs 底線虧本紅字 · 成交🤝 · S2 遮罩)· **開案 Wizard 報價設定**(b4e0b66:Step5 附掛 廠別模型 chips 同廠單選/變異軸/NRE 自動帶入)· **AI 比對上代**(460d4f0:程式 diff 權威(FPN 匹配+替換料偵測+成本橋)+ Pro 只解讀;demo=167 CORTEX-FIX-RIVAL3-GEN1) |

| **開案 Wizard 全面去假改版(2026-08-05/06 · 7→5 步)** | Step1 客戶信息(範本 xlsx 雙軌/老客戶選單帶 8 欄/重複開案偵測/交期紅綠燈真歷史)· 廢歷史參考步 · 機密設定去假 AI · **Step3 PM/Team 真使用者**(/wizard/users 搜尋+在手案數負載/上次合作 DPM 一鍵套用/啟動自動入成員+鈴鐺通知/確認頁缺角警示)· **gated Gate 權限修真**(members PM/sales 可代行 + 013x QUOTE stage 1/6/7/8 gate seed 補 1,原全 0 從未生效)· **Step4 流程模板接真範本**(GET /wizard/workflow-template 與 create 同源/假 AI deadlines→真週期參考)· **priority 步砍除**(系統評自動:交期壓力×年量×客戶案數;確認頁 mini 矩陣可覆寫;priority_score 落主表(原 create 從不寫)+ 列表 P 置頂排序) |
| **v0.16 報價 Form 全清(2026-07-29)** | 14 段對齊 [cortex-quote-form-v016-plan.md](cortex-quote-form-v016-plan.md):form 欄位 data_payload+完成度真計算+sidebar 進度條 · 客戶 8 欄 · 🎬26步 checklist(自動判定+附圖) · CMF share/qty · BOM 案級欄+採購總覽 · 包裝 markup+Pallet · NRE 議價雙欄(effective)+防呆 · 矩陣 qty 軸+分解列(013v run key 擴) · 🧮Cleansheet 檢視(9×10 矩陣+公式 hover) · 🛠️MVA 流程 A-G · 📈Margin heatmap+Top Markup · 成本卡(售價草/年營收) · 🎯議價策略 10 欄+AI 填空(Pro 遵守底線鐵則) |

## 🔜 Backlog(優先序草案 · 待拍板)

### P1.5 — 參數全面線上化(2026-07-30 拍板 · 競價前提:範本=架構起點,所有參數系統上隨時調+視覺化試算)
| # | 項 | Scope | 狀態 |
|---|---|---|---|
| R1 | 調參 gap 補齊 | IDL 年薪可編輯(COW)· Qty scenario 增刪改 UI · 設備/廠房/耗材 列增刪(製程列增刪留 Excel) | ✅ cc47298 |
| R1.5 | 廠級基礎維護頁 | 「⚙ 廠級基礎維護」入口 → 開 CORTEX-COST-TPL WarRoom(amber banner)→ Cleansheet 編輯器直編範本 cf;templates 回 tplProjectId/bg/bu;chips 顯 BU | ✅ 3ef8d37 |
| R2 | What-if 試算沙盒 | 013w snapshot;start(私有化+快照+基準)→ 改參數 auto dryRun(persist:false)→ 對比表 Δ 紅綠 → 套用(正式重算)/放棄(全還原) | ✅ 7a1455b |
| R3 | SIMPLIFIED line 編輯 | Step 1(SIMP 廠)= line 表(金額/in_subtotal/排序 編輯 + 加刪列);kind=line param/row API | ✅ |
| R4 | Goal-seek 反推 | 目標價 → 反推 料價降幅/Profit%/量;等成本架構穩定(最後做) | ✅ 2026-08-13(見候選佇列 4) |

三層定位(拍板):L1 廠級基礎(範本庫=國別×BU×模型,維護 UI 直編)→ L2 開案 clone 案級快照 → L3 案級線上調(COW 隔離)。既有案永不受廠級改動影響。

### P2 — 管理介面補完
| 項 | Scope |
|---|---|
| 範本庫管理頁 | 列表(含歷史版)/檢視參數/停用啟用/下載,取代散在 BOM 區的小按鈕 |
| Profile 管理 UI(U2) | 進階轉檔 profile CRUD + AI 輔助對映(丟 raw Excel 自動猜欄位) |

### P3 — 深化(2026-08-07 A 盤點後:B-4 + per-factory 料價 提為 active 下一步)
> A(WHOOP e2e)盤點結果 = W0~W4 全完成([cortex-whoop-e2e-plan.md](cortex-whoop-e2e-plan.md) 已歸檔);成本正確性(B)接棒。

| 項 | Scope |
|---|---|
| **B-4' line×config 用量倍率** ✅(2026-08-10 · 取代誤讀的乘數版) | **誤讀更正**(user 真 Excel 截圖):2.72 是金額(=Suit subtotal $68×4%,公式 `=G23*K24`)非乘數;OH/SGA/Profit = 各 config subtotal × 共用 %,無加權機制。乘數版(c6334fa/013y)已撤(013y 改 DROP)。**真需求** = WHOOP row 14~22 line 用量倍率:013z `bom_cs_case_line_config`(cf×line×配置值→倍率 · 0=不做/0.05/1.7=yield 差 · provision/What-if 納入)· engine line 金額×倍率 → subtotal per-config → 加成自動隨動 · API GET/PUT line-config(×1 自動刪列)· Cleansheet SIMP「⚙ Line × 配置 用量倍率」矩陣。驗:cf87 迴歸 89.5537 + Battery 情境(0/0.05/1.7)subtotal/OH/SGA 手算精確 + Retail 隔離。SOT §1.2 已同步更正 |
| **Yield loss 勾選式 % 化** ✅ 8e270dd(2026-08-10) | user 真表公式佐證(SMT loss=I6×0.5% / FATP=SUM(勾選欄)×5%):013aa calc_mode('AMOUNT'\|'YIELD_PCT')+yield_pct+yield_basis_json;engine effAmt 逐線累積(含倍率生效額+BOM_MATERIAL_* 虛擬項)· 勾選集合全案一份,per-config 差異由 013z 倍率自動(Battery:Harvard 系倍率 0 → 基數 77.8→32.2)· UI「%」切換+基數勾選面板。驗:golden 3.1138 精確重現。**製程線(SMT/glue/FATP)接製程試算(smt_point/macro_process 表在但空)= 未做,列 backlog** |
| **製程 MVA 段→站彈性化 M1+M2** ✅ 0e40936(2026-08-11) | 對齊真表(FATP/SMA+BFT=段→站、SMT cost=點數制):013ab 站表+line.macro_code;calc_mode 再擴 MACRO(Σ站 DL×wage÷UPH,無站用段級)/SMT_POINTS(Σ點×單價);UI 四模式下拉+段站/SMT 編輯子區;provision 站表 macro_id 重映 clone。驗:段 2.1067/站混合 0.038034/SMT 0.5733 全精確。**M3+M4 完成**(3591d0a):cost-model 三分頁隨檔(MacroStation special 映射)+ 013ac 單價精度 4→6 位;真表抽 FATP 82 站/ATE 38 站/SMT 25 列落 cf83,校準後 SMT=1.7736/FATP=1.6031 精確、glue=0.4894(共用 wage 偏差) |
| **per-廠別/區域 料價** ✅(2026-08-11) | to/out of China 泛化成區域彈性(user 拍板:CN/VN/TW+規劃中 US+IN):013ad `bom_item_price_region`(snapshot×區→覆寫價,無列 fallback 主價)+ `bom_factory.price_region`(廠→區映射,NULL=廠碼)· rollup region NVL 覆寫 · computeCase 依廠解析 → 矩陣材料隨廠變 · BomItemsPanel「🌐 區域價」chips。驗:MULTI 案 VN Δ=qty×主價精確/CN 不變/US fallback |
| B-6 ERP 帶價 | 採購 PO 歷史自動建議單價(SD §3.2.4) |
| EPM 角色權限 | 範本庫維護從 admin 細化到 EPM 角色(接 012 RBAC) |
| i18n | BOM/成本模型 UI 三語(現全 zh-TW hardcode) |

### 候選佇列(2026-08-11 詳述並拍板順序:1→3→2→4)
1. **demo 假價校準 5 pack 結構化** ✅(2026-08-11):W3 案(cf83)板級縮放到 89.554 表 golden(Harvard Main/Bird Main/Strap/Battery/PKG Retail→3)· STRAP/Battery 料 effectivity(013ae 一料多值:STRAP 缺 WB-Batt、Battery 缺 WB-Strap)· consumable 線 group=CONSUM(免被 BOM skip,1.14 計回)· WB-Batt 倍率(glue×0/SMTyield×0.05/FATPyield×1.7)· loss 線 YIELD_PCT(SMT 0.3682% 基數 EE+SMT、FATP 4% 累積)。5 config compute=獨立手算精確:Retail 90.11/Suit 92.80/Strap 85.10/Batt 80.33/StrapBatt 88.80;相對序對齊 golden 表(Suit>StrapBatt>Strap>Batt;golden Retail=71 為表內 1/1/1 定額異常口徑,不對此值)。Harvard tier true 補縮(ratio 1.57→0.96)
2. price_region 管理 UI ✅(2026-08-12):GET/PUT /bom/factories price-region + 廠級範本頁「🌐 廠別 → 價格區域」表(空=廠碼自身;TW 填 CN = 共用 to-China 價)
3. 區域價隨檔匯入 ✅ 0c4f07b(2026-08-12):U/P@VN/單價@US/TRUE@VN 欄名慣例(@攔截先於 u/p contains)· canonical+標準範本兩路徑 · 範本說明補第 8 點 · 端到端驗 rollup CN 2.70/VN 2.97 精確
4. R4 goal-seek ✅(2026-08-13):engine materialScale + POST /case/:cf/goal-seek 四路徑(PROFIT 解析/MATERIAL 兩點法+top8 料件/QTY 枚舉/COMBO)+ Cleansheet「🎯 目標價」面板(PROFIT 可套用到 What-if 沙盒)。驗:cf83 Retail 目標 89 → 3%→1.64%/-1.33%/組合 全對手算

### 收尾小項
- Wizard 確認頁 STARTUP_ACTIONS 逐項核實(7 channels/RACI 指派/Webex 三通道/Pin 公告/SLA 倒數 — 部分為假承諾,對照啟動實況改寫)
- **範本庫 TW 參數未差異化**(2026-08-06 發現:TW·FULL DL=4.95 與 CN 全同、CN/TW SIMP 全同;僅 VN 有差異化 → 選 TW 比價無意義。需真實 TW 參數維護進「管理→廠級成本範本」)

### 技術債
- wrapper bind-on-prepare lint(踩過 4 次)
- fixture 專案(CORTEX-FIX-\*)退場評估(範本庫已接手 seed 職能)
- dark-launch 出場計畫(ENABLE_CORTEX_BOM 轉正式的 gate 清單)
