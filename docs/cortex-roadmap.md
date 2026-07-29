# Cortex BOM 報價平台 — Roadmap(SOT)

> 更新:2026-07-29。**下一步規劃的唯一紀錄處** —— 拍板/完成後更新此檔。
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

## 🔜 Backlog(優先序草案 · 待拍板)

### P2 — 管理介面補完
| 項 | Scope |
|---|---|
| 範本庫管理頁 | 列表(含歷史版)/檢視參數/停用啟用/下載,取代散在 BOM 區的小按鈕 |
| Profile 管理 UI(U2) | 進階轉檔 profile CRUD + AI 輔助對映(丟 raw Excel 自動猜欄位) |

### P3 — 深化(有資料依據,不急)
| 項 | Scope |
|---|---|
| B-4 config 加權 | WHOOP OH×2.72/SGA×2.04 per-包裝 加權(SOT §1.2) |
| per-factory 料價 | EE 兩組 U/P(to/out of China)→ 料價隨廠別(SOT §2.3) |
| B-6 ERP 帶價 | 採購 PO 歷史自動建議單價(SD §3.2.4) |
| EPM 角色權限 | 範本庫維護從 admin 細化到 EPM 角色(接 012 RBAC) |
| i18n | BOM/成本模型 UI 三語(現全 zh-TW hardcode) |

### 技術債
- wrapper bind-on-prepare lint(踩過 4 次)
- fixture 專案(CORTEX-FIX-\*)退場評估(範本庫已接手 seed 職能)
- dark-launch 出場計畫(ENABLE_CORTEX_BOM 轉正式的 gate 清單)
