# 使用者手冊章節結構與審計紀錄

> 最後審計日期：2026-04-17
> 章節總數：一般使用者 31 個 + 管理員 31 個

---

## 一般使用者手冊 — 分組邏輯

新增章節時，依下表分組邏輯決定 `sort_order`，插入對應分組的尾端。

| 分組 | sort_order | 概念 | 章節 |
|------|-----------|------|------|
| **入門** | 1–4 | 新使用者第一次使用必看 | u-intro(1) 系統介紹、u-login(2) 登入登出、u-ui(3) 介面導覽、u-lang(4) 語言切換 |
| **核心功能** | 5–12 | 日常對話相關的高頻功能 | u-chat(5) 開始對話、u-model(6) 選擇模型、u-upload(7) 上傳檔案、u-history(8) 對話歷史、u-output(9) 輸出下載、u-share(10) 分享對話、u-image(11) 圖片生成、u-toolbar-toggles(12) 工具列開關 |
| **工具** | 13–16 | 需要額外操作的輔助工具 | u-tools(13) 可用工具、u-skill(14) 技能市集、u-kb(15) 知識庫市集、u-doc-template(16) 文件範本 |
| **進階** | 17–25 | 進階功能，需額外權限 | u-research(17) 深度研究、u-ai-bi(18) AI 戰情室、u-ai-bi-query(19)~u-ai-bi-schema(24) 戰情子章節、u-schedule(25) 自動排程 |
| **教育訓練** | 26–27 | 教育訓練專區 | u-training(26) 訓練教室、u-training-dev(27) 教材開發 ※權限限定 |
| **輔助** | 28–32 | 不常用/特定場景 | u-feedback(28) 問題反饋、u-webex-bot(29) Webex Bot、u-budget(30) 使用額度、u-help-kb(31) 說明書KB、u-erp-tools(32) ERP 工具 |

### 新增章節規則

1. 確定新章節屬於哪個分組
2. 在該分組的最後一個 sort_order + 1 插入
3. 後續分組的 sort_order 全部 +1（或留空隙，建議用 10 的倍數預留空間）
4. 若有權限限制（如 u-training-dev 只對有權限的使用者顯示），在 HelpPage.tsx 的 filter 加條件
5. `last_modified` 設為當天日期
6. 修改 `_helpSeed_part1.js` 或 `_helpSeed_part2.js`，然後跑 `node server/data/mergeSeeds.js`

### 權限控制章節

| section ID | 條件 | 控制位置 |
|-----------|------|---------|
| `u-training-dev` | `canAccessTrainingDev`（上架或編輯權限） | HelpPage.tsx apiSections filter |

未來新增權限限定章節時，在 HelpPage.tsx 的 filter 加入類似邏輯：
```tsx
s.id !== 'u-xxx' || somePermissionFlag
```

---

## 管理員手冊 — 章節結構

管理員手冊為 hardcoded JSX（HelpPage.tsx 的 `AdminManual()` 函數），section ID 以 `a-` 開頭。

| 分組 | section ID | 標題 |
|------|-----------|------|
| **帳號管理** | a-users | 使用者管理 |
| | a-roles | 角色管理 |
| **測試與調試** | a-admin-test | 管理員測試模式 |
| **知識與技能** | a-kb | 自建知識庫管理 |
| | a-skill | 技能市集管理 |
| | a-code-runners | Code Runners 管理 |
| **排程與語法** | a-schedule | 排程任務 |
| | a-prompt | 排程 Prompt 語法 |
| | a-generate | 檔案生成語法 |
| | a-example | 完整 Prompt 範例 |
| **統計與稽核** | a-tokens | Token 與費用統計 |
| | a-audit | 稽核與敏感詞 |
| | a-cost-analysis | 費用分析 |
| **整合服務** | a-mcp | MCP 伺服器管理 |
| | a-dify | API 連接器整合 |
| | a-erp-tools | ERP 工具管理 |
| | a-llm | LLM 模型管理 |
| **資料權限** | a-data-permissions | 資料權限管理 |
| | a-db-sources | AI 戰情外部資料來源 |
| | a-vector-defaults | 向量預設模型設定 |
| **進階管理** | a-research-logs | 深度研究紀錄 |
| | a-api-keys | 外部 API 金鑰管理 |
| **系統設定** | a-system | 系統設定 |
| | a-monitor | 系統監控 |
| | a-k8s | K8s 部署更新 |
| | a-env-config | ENV 環境變數設定 |
| **說明書管理** | a-help-kb-sync | 說明書 KB 自動同步 |
| | a-help-translation | 說明文件翻譯管理 |
| **功能管理** | a-doc-template | 文件範本管理 |
| | a-webex-bot | Webex Bot 管理 |
| | a-training | 教育訓練權限管理 |

### 新增管理員章節

1. 在 HelpPage.tsx 的 `adminSections` 陣列加 sidebar entry
2. 在 `AdminManual()` 函數內加 `<Section id="a-xxx">` JSX
3. 使用現有的元件：`Section`, `SubSection`, `Para`, `TipBox`, `NoteBox`, `Table`

---

## 審計紀錄

### 2026-04-08 審計

**審計範圍**：一般使用者 31 章 + 管理員 30 章，全部逐一與原始碼比對

**結果**：

| 章節 | 狀態 | 修正內容 |
|------|------|---------|
| u-intro | ⚠ 修正 | 加入 OCI/Cohere LLM provider |
| u-login | ✅ OK | |
| u-ui | ⚠ 修正 | 「更多功能」選單加文件範本/教育訓練/問題反饋 |
| u-lang | ✅ OK | |
| u-chat | ✅ OK | |
| u-model | ⚠ 修正 | 加 OCI/Cohere + AOAI 推理力度說明 |
| u-upload | ⚠ 修正 | 音訊格式 +WEBM/MP4/AAC，大小分文件10MB/音訊50MB |
| u-history | ✅ OK | |
| u-output | ✅ OK | |
| u-share | ✅ OK | |
| u-image | ✅ OK | |
| u-toolbar-toggles | ✅ OK | |
| u-tools | ✅ OK | |
| u-skill | ✅ OK | |
| u-kb | ✅ OK | |
| u-doc-template | ✅ OK | |
| u-research | ✅ OK | |
| u-ai-bi ~ u-ai-bi-schema | ✅ OK (7章) | |
| u-schedule | ✅ OK | |
| u-training | ✅ OK | |
| u-training-dev | ⚠ 修正 | 課程編輯器 tab 卡片補「分享」tab |
| u-feedback | ✅ OK | |
| u-webex-bot | ✅ OK | |
| u-budget | ✅ OK | |
| u-help-kb | ✅ OK | |
| 管理員手冊 (30章) | ✅ 全部 OK | 無需修正 |

**修正 commit**：`3848ca4`
