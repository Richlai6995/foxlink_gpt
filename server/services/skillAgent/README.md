# Skill Agent — Phase 0 PoC

把 AI 平台產生的 **Anthropic-style skill 包**(SKILL.md + 元件庫)接成 Cortex 可執行的「通用 Skill Agent runtime」。第一個 skill 包 = `docs/pptx skill`(董事長藍色簡報風格)。

## 這階段只證一件事

> 給 Gemini 一份 SKILL.md + `blue_style.py`,它能不能靠 `write_file/bash` + **程式化 QA** 迴圈,端到端產出一份 **QA-clean** 的 pptx。

**不做**:沙箱加固、多租戶、背景 job、`type='agent'` 整合、vision、Claude。全留 Phase 1+。

## 檔案

| 檔 | 作用 |
|----|------|
| `poc.js` | 入口 + CLI;備工作區 → 跑 agent loop → 渲染 truth-check 預覽 → 收產物到 `_runs/<ts>/` |
| `loop.js` | 大腦:組 system prompt(餵 blue_style API 簽名)+ 外層 QA gate 包住 `generateWithToolsStream` 內建 10 輪 tool loop |
| `tools.js` | 三件工具宣告 + handler:`write_file` / `bash` / `qa_check`(回傳一律 string) |
| `sandbox.js` | per-run mkdtemp 工作區、`runInWorkspace`(cwd 鎖、SIGKILL 逾時、utf-8)、python/soffice 解析 |
| `render_preview.py` | PDF→PNG(PyMuPDF,免 poppler) |

## 跑

```bash
node server/services/skillAgent/poc.js "用董事長藍色風格,做一份介紹 Cortex 智慧戰情室的簡報,涵蓋即時監控、AI 診斷、主動告警、成本控管四大價值"
# 保留工作區除錯:加 --keep
# 從檔讀任務:--file task.txt
```

產物在 `_runs/<ts>/`:`out.pptx`、`slide_*.png`(人眼 truth-check 用)、`run.log`。

## Phase 0 的隱藏目標

**驗證「程式化 QA(`slide_qa.py`)能否替代 vision」**:跑完人眼比對 `slide_*.png` 與 QA 結論。
- 一致 → 證明省 vision 的路成立(便宜一個量級)。
- QA 說 clean 但圖很醜 → Phase 1 得把 vision QA 加回來。

> 已知:`slide_qa.py` 的 OVERLAP 規則原本會把「編號圓嵌在卡內」這種刻意內嵌誤報成碰撞,已加 `_contains` 排除(commit 內)。這類 false-positive 是程式 QA 當 reward 前必清的,否則 agent 會被誤報逼著空轉燒 token。

## 環境前置(dev 已備)

- python-pptx ✓、PyMuPDF ✓、Noto Sans TC(使用者字型)✓
- LibreOffice(`soffice`)— 渲染預覽用;`SOFFICE_BIN` env 可覆寫路徑
- `blue_style.py` 字型由 `BLUE_STYLE_EA_FONT` 覆寫,預設 `Noto Sans TC`(dev/Linux prod 一致)

## 已知限制 / 往 Phase 1

- **隔離不足**:Phase 0 在本機跑「自己的」skill。跑外部/不可信 skill 前,須換成 forked `child_process` + `oom_score_adj=1000` + egress 鎖 + non-root(抄 `excelQueryJobService`)。
- **執行模型**:目前同步跑。產品化要對齊背景 job(research_jobs / 長音訊 job)+ 鈴鐺回報。
- **per-skill 環境宣告**:目前 python 依賴假設已裝。Phase 1 由 skill 包自帶 `requirements.txt` → venv pip(抄 `installPackages`)。
