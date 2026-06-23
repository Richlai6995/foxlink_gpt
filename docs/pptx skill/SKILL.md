---
name: exec-blue-deck
description: >-
  製作「企業級專業報告 · 藍色基調」簡報投影片時使用。當使用者要做給高階主管/管理層看的
  PowerPoint、需要乾淨專業的藍色調投影片、把技術內容精簡成商業重點、或明確說
  「用我們的藍色風格 / FOXLINK 企業藍風格 / exec-blue 風格」時觸發。提供固定配色、
  版面規格與可重用的 python-pptx 元件庫 (blue_style.py),可快速產出帶漸層與陰影的
  4:3 投影片(標題列、重點帶、功能卡、數字 callout、流程箭頭、資料庫圓柱、路線圖 V 形)。
  Use when creating executive / management-facing PowerPoint slides in this professional blue house style.
license: Proprietary
---

# Executive Blue Deck(企業級專業報告 · 藍色基調)

把密集的技術投影片,改寫成乾淨、專業、以藍色為主調的高階主管簡報。核心精神:
**重點先講、術語收小字、藍色主導、單一金色重點、色塊都有漸層與陰影。**

## 何時使用

- 要做給高階主管 / 管理層的呈報簡報,需要專業俐落的版面。
- 手上有一頁塞滿技術細節的投影片,要精簡成「老闆視角」的重點。
- 使用者說「用藍色風格 / exec-blue / 企業專業報告風格 / 跟上次一樣的風格」。

## 設計原則(務必遵守)

1. **以藍色為主**:深海軍藍 → 藍 → 淺藍構成 60–70% 視覺重量。背景用淺藍 `EAF2FB`。
2. **單一金色重點**:整頁(最多整份)只用「一次」金色 `C99A3B→E0B85A`,標示最關鍵的數字、節點或「規劃中」標籤。其餘一律藍色,避免色塊過多。
3. **漸層 + 陰影**:每個色塊都用線性漸層 (`grad`) 與柔和外陰影 (`add_shadow`),營造立體專業感。
4. **商業語言**:標題與卡片用白話效益(更快、更省、看得見、不漏單);把 SQL / API / SCD / vCenter 這類術語放進小字描述或直接省略。
5. **留白充足**:4:3 版面、邊距 ≥ 0.3"、卡片間距 0.12–0.15"、不要塞滿。
6. **不要**:多種鮮豔色塊、置中的內文段落、純文字無視覺元素、標題底下的裝飾線。

## 配色表

| 角色 | Hex | 用途 |
|------|-----|------|
| Navy | `0B2D5C` | 標題列漸層起點、圓柱底 |
| Blue | `1E5BA8` | 主色:卡片標題列、圖示圈、流程 |
| Blue2 | `2E78C7` | 漸層終點(亮藍) |
| Blue-L | `5B9BD5` | 副標、邊框、箭頭起點 |
| Sky | `EAF2FB` | 投影片背景 |
| Sky2 | `DCEAF9` | 淺藍卡片漸層終點 |
| Card | `FFFFFF` | 功能卡底色 |
| Border | `D3E1F2` | 卡片邊框 |
| Ink | `16263D` | 主要文字 |
| Mute | `5C6B80` | 次要說明文字 |
| **Gold** | `C99A3B→E0B85A` | **唯一暖色重點(限用一次)** |

字型:中文 `Microsoft JhengHei`(微軟正黑體)、英數 `Calibri`。
尺寸:主標題 26pt 粗 / 卡片標題 13pt 粗 / 內文 10.5pt / 說明小字 8–9pt。

## 版面規格(10 × 7.5 in,4:3)

- **標題列** 0–1.28":navy→blue 漸層,含副標(eyebrow)、主標題、單行重點;可選右上金色 badge。
- **重點帶** ~1.40":淺藍底 + 左側藍色強調條,一行講清系統價值。
- **內容區**:常見為 2×2 功能卡,或左卡(條列)+ 右卡(數字 callout)。
- **流程**:水平 V 形(`chevron_row`,色彩由淺漸深表現推進)或圓柱+箭頭架構圖。
- **頁尾** ~7.22":左側出處說明 + 右側日期。

## 怎麼做(建議流程)

1. **先抓重點**:讀原始資料,把每個區塊濃縮成「一句效益 + 一行說明」,術語降為小字。
2. **選版型**:價值/功能 → 2×2 `feature_card`;成效數字 → `metric_tile`;階段規劃 → `chevron_row`;系統架構 → `db_cylinder` + `right_arrow`。
3. **寫腳本**:`from blue_style import *`,用元件函式組版(見 `examples/example_deck.py`)。
4. **產檔**:`prs.save("out.pptx")`。

## 元件 API(scripts/blue_style.py)

```python
from blue_style import *
prs = new_deck()                              # 4:3 空白簡報
s   = add_slide(prs)                          # 加一頁(鋪淺藍背景)

header(s, eyebrow, title, subtitle, badge=None)        # 頂部標題列(+可選金色標籤)
concept_band(s, text, y=1.40)                          # 一行重點帶
feature_card(s, x, y, w, h, num, title, desc, accent=False)   # 白底功能卡(accent=金色)
metric_tile(s, x, y, val, title, desc, accent=False)   # 數字 callout(accent=金色)
right_arrow(s, x, y)                                   # 流程藍色箭頭
db_cylinder(s, x, y, w, h, [(txt,size,color,bold)...]) # 資料庫圓柱
chevron_row(s, [(主字,副字), ...])                      # 路線圖 V 形(由淺漸深)
footer(s, left_text, right_text="2026-06")             # 頁尾
prs.save("out.pptx")
```
低階工具:`box(...)`(漸層/實色/邊框色塊)、`circle(...)`、`add_text(...)`、`grad()`、`add_shadow()`、`set_run_font()`。常用座標:左卡 `x=0.3 w=4.68`、右卡 `x=5.12 w=4.58`、2×2 列 `y=2.82 / 4.62`、卡高 `1.72`。

## 視覺 QA(必做)

產出後務必轉圖檢查一次(最常見問題是文字溢出色塊):

```bash
soffice --headless --convert-to pdf out.pptx
pdftoppm -jpeg -r 150 out.pdf slide
```

逐頁檢查:文字是否超出卡片、元素是否重疊、邊距是否足夠、是否只用了一次金色。發現問題就縮字級或加大容器,修一輪即可,不必追求像素級完美。
