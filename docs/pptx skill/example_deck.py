# -*- coding: utf-8 -*-
"""範例:用 blue_style 元件庫產出一頁示範投影片。
執行: python example_deck.py  (需 scripts/ 在 sys.path 或同層放 blue_style.py)
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
sys.path.insert(0, os.path.dirname(__file__))
from blue_style import *

prs = new_deck()
s = add_slide(prs)

header(s, "智慧維運平台  ·  第一階段(已上線)", "AI 智慧資料庫監控平台",
       "跨平台即時監控  ·  異常主動告警  ·  AI 線上診斷")
concept_band(s, "透過 Dashboard 與 AI 即時監控跨平台系統,異常時主動告警並提供排除建議,實現智慧維運。")

# 架構流程:圓柱 + 箭頭(中央 AI 核心用金色,整頁唯一重點)
db_cylinder(s, 0.55, 2.04, 2.35, 0.62, [("Oracle-Lite-EM", 11, WHITE, True), ("監控端", 9, "D6E6F7", False)], g=(BLUE, BLUE2))
right_arrow(s, 3.0, 2.20)
db_cylinder(s, 3.7, 2.02, 1.7, 0.66, [("23 AI DB", 11.5, WHITE, True), ("AI 核心", 9, "FFF3DA", False)], g=(GOLD, GOLD2))
right_arrow(s, 5.55, 2.20)
db_cylinder(s, 6.25, 2.02, 1.55, 0.66, [("ERP DB", 11, WHITE, True)])
db_cylinder(s, 7.95, 2.02, 1.55, 0.66, [("SFC DB", 11, WHITE, True)])

# 2x2 功能卡
feature_card(s, 0.3, 2.82, 4.68, 1.72, "1", "資料庫即時監控", "即時效能看板,精準定位異常與空間問題;\n狀況一眼看見,不必再人工翻查。")
feature_card(s, 5.12, 2.82, 4.58, 1.72, "2", "AI 智慧診斷", "自動收集錯誤日誌並結合業務背景,\n由 AI 分析潛在風險並提供排除建議。")
feature_card(s, 0.3, 4.62, 4.68, 1.72, "3", "主動告警與互動", "異常每 5 分鐘自動偵測,主動推送告警;\n可與 AI 線上問答,即時取得處理方案。")
feature_card(s, 5.12, 4.62, 4.58, 1.72, "4", "擴充監控與成本控管", "涵蓋主機與虛擬機效能監控;\n自動回收閒置授權帳號,降低成本。")

footer(s, "exec-blue-deck 範例  ·  內部呈核版")
prs.save(os.path.join(os.path.dirname(__file__), "example_out.pptx"))
print("saved example_out.pptx")
