# Cortex 成本引擎強化階段 — 細部測試步驟(2026-08-10 ~ 08-12 修改)

> 涵蓋:B-4' line×config 倍率(9df9af1)· Yield 勾選式 %(8e270dd/aba2f3b)· Waterfall 明細(e27428b)·
> 製程段→站 MVA M1~M4(0e40936/3591d0a)· per-區域料價(aebcc34/6dcc19f)· 5-pack 校準(runs #341–345)·
> price_region 管理(d062ca6)· 區域價隨檔匯入(0c4f07b)
>
> **前置**:`ADMIN / Foxlink123` 登入 · 測前 **Ctrl+F5 硬刷新** · dev server 執行中。
> 測試案:`CORTEX-W3-WHOOP`(WHOOP demo · VN 廠)與 `CORTEX-FIX-MULTI`(CN+VN 雙廠)。
> 所有數字為錨點值;±0.0005 內視為通過。

---

## T1 五種包裝配置 → 五個報價(5-pack 校準成果)

| # | 操作 | 預期 |
|---|------|------|
| 1 | 專案平台 → 專案列表 → 進 **CORTEX-W3-WHOOP** → 報價 Form → 📦 BOM/材料 | 頁面正常,BOM 已匯入 |
| 2 | 「產品配置」切 **包裝=Retail** → ④ 算成本 | total = **90.1062** |
| 3 | 切 **WB-Suit** → 算成本 | **92.7984**(最貴:Suit 盒) |
| 4 | 切 **WB-Strap** → 算成本 | **85.1043**(不含電池料) |
| 5 | 切 **WB-Batt** → 算成本 | **80.3269**(不含錶帶 + 不做點膠 + 損耗差異) |
| 6 | 切 **WB-StrapBatt** → 算成本 | **88.8029** |
| 7 | 多廠成本矩陣 →「算全部」 | 五個 config 欄位同上值 |

## T2 Cleansheet:四種計算模式 + 段站 + SMT 點數 + Waterfall

進同案 → **🧮 Cleansheet(MVA)** → 廠別 tab 選 **VN**。

| # | 操作 | 預期 |
|---|------|------|
| 1 | 看頂端紫色 baseline bar | **DL wage 3.6559/hr · OH 4% · SG&A 3% · Profit 3% · Transport 0.5 $/unit · 年量** 全部顯示且可點擊編輯 |
| 2 | Line 表:看 SMT 列 | 模式下拉 = **SMT點**,顯示「= 1.7736」 |
| 3 | 看 BOARD_GLUE_ATE / FATP 列 | 模式 = **段站**,綁 GLUE_ATE / FATP 段,顯示「= 0.4894 / = 1.6031」 |
| 4 | 看 SMT_YIELD_LOSS / FATP_YIELD_LOSS 列 | 模式 = **%基數**:SMT 0.3682% 基數(2)、FATP 4% 基數(6),各有「= 算出值」 |
| 5 | 點 FATP_YIELD_LOSS 的「基數(6)」 | 展開勾選面板:BOM_MATERIAL_ALL、CONSUMABLE、SMT、BOARD_GLUE_ATE、FATP、SMT_YIELD_LOSS 已勾 |
| 6 | ⚙ 製程計算(段→站):FATP 段點 ▸ | 展開 **82 個真站**(B301 支架貼膠…含 站數/UPH/Yield/工時/DL) |
| 7 | 改 B301 的 DL 1→**2** → 上方「重算」 | FATP 線算出值**變大**;total 同步變 |
| 8 | B301 DL 改回 **1** → 重算 | FATP 回 **1.6031**;Retail total 回 90.1062 |
| 9 | GLUE_ATE 段點 ▸ | 38 站(B201…/H201…) |
| 10 | SMT 點數表 | 25 列(3 板 × 類別);單價 **0.002625 $/pt** 可編 |
| 11 | ⚙ Line × 配置 用量倍率 | WB-Batt 欄:BOARD_GLUE_ATE=**0**、SMT_YIELD_LOSS=**0.05**、FATP_YIELD_LOSS=**1.7**(amber 標底);其他格 = 1 |
| 12 | Final TC Waterfall | 六段:Subtotal / **+ Over-head(4.0%)** / **+ Transportation(固定)** / + SG&A / + Profit / + NRE 攤提;逐列相加 = Total |
| 13 | 點 Subtotal 前的 ▸ | 展開:材料合計(BOM rollup 標示)+ 各製程/損耗線金額;YIELD 線帶「= 基數 × %」註記 |
| 14 | 點 Over-head 的 ▸ | 公式列「= Subtotal xx.xx × 4.0%」 |

## T3 What-if 沙盒相容(選測)

| # | 操作 | 預期 |
|---|------|------|
| 1 | Cleansheet →「What-if」啟動沙盒 | 快照建立,顯示基準 |
| 2 | 改任一倍率格 / yield % / 站 DL | **自動試算**(不落 run 歷史),Δ 顯示 |
| 3 | 「放棄」 | 全部參數還原(倍率/%/站值回原);重算回基準 |

## T4 區域價 — 手動 UI(per-廠別料價)

進 **CORTEX-FIX-MULTI**(CN+VN)→ 📦 BOM/材料 → 料件明細。

| # | 操作 | 預期 |
|---|------|------|
| 1 | 展開一顆**有價**料件 → 看「採用中」報價列下方 | 有「**🌐 區域價**」列 +「＋ 區域價」按鈕 |
| 2 | ＋ 區域價 → 區填 `VN`、quote 填 **主價×2** → 存 | chip 出現 `VN $x.xx` |
| 3 | 多廠矩陣「重算全部」 | **VN 欄材料 +（qty×主價）**;CN 欄完全不變 |
| 4 | chip 點 × 刪除 → 重算全部 | VN 材料還原 = CN |

## T5 廠別 → 價格區域映射(管理頁)

| # | 操作 | 預期 |
|---|------|------|
| 1 | 管理 → 廠級成本範本 → 捲到頁尾「**🌐 廠別 → 價格區域**」 | 列出 CN / TW / VN 三廠,價格區域皆空,生效價區 = 廠碼自身 |
| 2 | TW 的價格區域填 `cn`(小寫)→ Enter | 存檔後顯示 **CN**(自動大寫),生效價區 = CN |
| 3 | (進 T4 的案,若有 TW 廠)算 TW 成本 | TW 材料 = CN 區價(含 T4 設的覆寫則同 CN 主價) |
| 4 | 清空 TW 的價格區域 → Enter | 生效價區回 **TW** |

## T6 區域價隨檔匯入(U/P@區 欄)

| # | 操作 | 預期 |
|---|------|------|
| 1 | 📦 BOM 區「下載匯入範本」→ 開「說明」分頁 | 第 8 點:單價欄名加 @區碼 教學(U/P@VN / TRUE@VN) |
| 2 | 範本 EE 分頁填 3 列:Qty=1/10/5、Unit Price=2.5/0.01/0.02;**新增兩欄** `U/P@VN`=2.75/0.012/(空)、`TRUE@VN`=2.6/(空)/(空) | — |
| 3 | 開一個新測試專案(Wizard 快速開)→ 匯入該檔 | 匯入成功 3 料 |
| 4 | 料件明細展開第 1、2 顆料 | 「🌐 區域價」**自動帶** VN 列(2.75 帶 true 2.6;0.012 無 true) |
| 5 | 第 3 顆料(@VN 空) | 無區域價列(fallback 主價) |
| 6 | 算成本(該案廠別)/ 加 VN 廠算 | 主價區材料 = **2.70**;VN 區 = **2.97** |

## T7 迴歸錨點(改動不該影響的)

| # | 操作 | 預期 |
|---|------|------|
| 1 | 管理 → 廠級成本範本 → VN SIMPLIFIED 範本「編輯」→ Compute | total = **89.5537**(範本 golden 不變) |
| 2 | 專案 82(Rival3-CN)→ 算成本(Black+Amber) | total = **12.0270** 不變 |
| 3 | CORTEX-W3-WHOOP Retail 重算 | **90.1062**(本階段新基準) |
| 4 | 任一案 What-if 開→放棄 | run 歷史筆數不變(沙盒零污染) |

---

**判定**:T1~T7 全過 = 本階段驗收完成。任何錨點值對不上:先確認 Ctrl+F5、廠別 tab 與產品配置選對,再回報實得值與步驟編號。
