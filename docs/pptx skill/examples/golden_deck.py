# -*- coding: utf-8 -*-
"""黃金範例:用 composer(compose_slide)組「BOM × MVA 單頁總覽」。
示範「主動編排」—— 把內容整理成 blocks,座標全由 composer 自動算,撐滿且平衡。
執行:python golden_deck.py  (同層或 ../ 需有 blue_style.py)
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
from blue_style import new_deck, add_slide, compose_slide

prs = new_deck()
s = add_slide(prs)

compose_slide(
    s,
    "FOXLINK 正崴 · Cortex AI 整合平台",
    "Cortex BOM × MVA 業務快接接單平台",
    "報價週期 3-4 週 → 1 週 · 跨案重用知識資產 · Margin 即時透明 · EPM 走人不重做",
    blocks=[
        {"type": "columns", "weight": 3.0, "cols": [
            {"title": "系統設計目標 (Why)", "items": [
                {"title": "業務快接接單", "desc": "報價週期 3-4 週壓到 1 週,同步多廠多色多批量"},
                {"title": "跨案 / 跨廠重用", "desc": "廠級 master 結構化,EPM 走人不用重做 1500 行 Excel"},
                {"title": "Margin 即時透明", "desc": "True Cost / Quote Price 雙價分層,議價當下看毛利"},
                {"title": "雙價 + 4 級權限", "desc": "業務只看 Quote,採購/CFO 看 True Cost,機密控管"},
            ]},
            {"title": "預期達成效果 (Impact)", "metrics": [
                {"value": "↓70%", "label": "報價週期", "desc": "3-4 週 → 1 週", "accent": True},
                {"value": "3 廠", "label": "同步並行 RFQ", "desc": "CN / VN / TW 同時跑 Cleansheet"},
                {"value": "24", "label": "一鍵多視角", "desc": "3 廠×2 色×2 批量×2 包裝 pivot"},
                {"value": "0", "label": "漏單", "desc": "BOM 鎖版 → MVA×SGA×Profit 自動寫 fact"},
            ]},
        ]},
        {"type": "band", "weight": 1.3, "title": "系統怎麼運作 — 七個步驟 (What)",
         "flow": [
             {"title": "建置", "desc": "廠 master"}, {"title": "月維", "desc": "月度 baseline"},
             {"title": "開案", "desc": "選模板/設 qty"}, {"title": "配置", "desc": "案級 9×17"},
             {"title": "算", "desc": "30 秒 compute"}, {"title": "鎖", "desc": "DPM lock"},
             {"title": "報", "desc": "Margin + 業務 gate"},
         ],
         "caption": "把過去分散在個人 Excel 的報價邏輯,變成一套標準化、可重複使用的系統流程。"},
        {"type": "cards", "weight": 1.4, "cards": [
            {"title": "已用兩案範本驗證可行性", "desc": "SteelSeries Rival 3+ Wired(9 製程)、WHOOP Gen4 MP(8 sub-BOM)"},
            {"title": "開發排程", "desc": "6.5 sprint ≈ 5-6 週 / 1 人;Phase 1-4 核心,Phase 5-6 跨廠擴充"},
        ]},
    ],
    footer_left="Cortex BOM × MVA 模組 · v0.9 內部呈核版",
)

out = os.path.join(os.path.dirname(__file__), "golden_out.pptx")
prs.save(out)
print("saved", out)
