# Internal Code Skill 實作計畫

允許資訊部門人員直接撰寫 Node.js handler 作為 Skill 的內部 Endpoint，由平台托管子進程並管理其生命週期。

---

## Phase 1：DB Schema & 權限欄位

### skills 表新增欄位
```sql
ALTER TABLE skills ADD COLUMN code_snippet TEXT;        -- 用戶 handler code
ALTER TABLE skills ADD COLUMN code_packages TEXT DEFAULT '[]'; -- JSON: ["axios","mssql"]
ALTER TABLE skills ADD COLUMN code_status TEXT DEFAULT 'stopped'; -- stopped|starting|running|error
ALTER TABLE skills ADD COLUMN code_port INTEGER;        -- 動態分配 4000-4999
ALTER TABLE skills ADD COLUMN code_pid INTEGER;         -- 子進程 PID
ALTER TABLE skills ADD COLUMN code_error TEXT;          -- 最後一次錯誤訊息
```

### roles / users 表新增欄位
```sql
ALTER TABLE roles ADD COLUMN allow_code_skill INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN allow_code_skill INTEGER; -- NULL = 繼承 role
```

---

## Phase 2：子進程 Runner 機制

### 目錄結構
```
server/
  skill_runners/
    {skill_id}/
      user_code.js      ← 用戶貼的 handler（由 API 寫入）
      runner.js         ← 平台固定 wrapper
      package.json      ← 自動生成
      node_modules/     ← npm install 結果（各 skill 獨立）
```

### runner.js（平台固定 wrapper）
```js
'use strict';
const express = require('express');
const userHandler = require('./user_code');
const PORT = parseInt(process.env.SKILL_PORT);
const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/', async (req, res) => {
  try {
    const result = await userHandler(req.body);
    if (!result || (!result.system_prompt && !result.content)) {
      return res.status(500).json({ error: 'handler must return { system_prompt } or { content }' });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

process.on('uncaughtException', (e) => {
  process.send?.({ error: e.message });
});

app.listen(PORT, '127.0.0.1', () => {
  process.send?.({ ready: true, port: PORT });
});
```

### user_code.js 規定格式（文件給開發者）
```js
// 必須 export 一個 async function
// req.body 包含：{ user_message, session_id, user_id, skill_id }
// 回傳 { system_prompt: '...' }  → inject 模式
// 回傳 { content: '...' }        → answer 模式（直接回應，不經 Gemini）
module.exports = async function handler(body) {
  const { user_message } = body;
  // 可以 require 已安裝的 npm 套件
  return { system_prompt: `相關資訊：${user_message}` };
};
```

---

## Phase 3：後端 Service（`server/services/skillRunner.js`）

```
功能：
- portPool：管理可用 port 4000-4999
- spawnRunner(skill)：啟動子進程，寫入 DB port/pid/status
- killRunner(skillId)：kill 子進程，清除 DB port/pid
- restartRunner(skillId)：kill + spawn
- installPackages(skillId, packages, logCb)：
    exec npm install 在 skill 目錄下，callback 回傳 log 行
- saveCode(skillId, code)：寫入 user_code.js
- generatePackageJson(skillId, packages)：生成 package.json
- autoRestoreRunners(db)：Server 啟動時查 DB code_status='running' 自動重啟
```

---

## Phase 4：後端 API Routes

掛在 `/api/admin/skill-runners`（需 admin 權限）和 `/api/skills`（code 相關需 allow_code_skill）：

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/skills` | 新增，type=code 時需 allow_code_skill |
| PUT | `/api/skills/:id` | 更新 code_snippet / code_packages；若已 running 需先停止 |
| POST | `/api/admin/skill-runners/:id/start` | 啟動子進程 |
| POST | `/api/admin/skill-runners/:id/stop` | 停止子進程 |
| POST | `/api/admin/skill-runners/:id/restart` | 重啟子進程 |
| POST | `/api/admin/skill-runners/:id/install` | npm install（SSE log 串流） |
| GET | `/api/admin/skill-runners/:id/logs` | 即時 stdout/stderr SSE |
| GET | `/api/admin/skill-runners` | 所有 internal skill 狀態一覽 |

---

## Phase 5：Server 啟動自動恢復

在 [server.js](file:///d:/vibe_coding/foxlink_gpt/server/server.js) 初始化後、路由掛載前加入：

```js
const { autoRestoreRunners } = require('./services/skillRunner');
autoRestoreRunners(db); // 非同步，不 block 啟動
```

邏輯：
1. 查 `SELECT * FROM skills WHERE type='code' AND code_status='running'`
2. 對每筆呼叫 `spawnRunner(skill)`
3. spawn 失敗則更新 `code_status='error', code_error=...`

---

## Phase 6：前端 UI

### SkillMarket.tsx — 建立/編輯表單

- `type` 選擇器新增 `code（內部程式）` 選項，**僅 allow_code_skill=true 的使用者可看見**
- 選擇 code 後顯示：
  - `<textarea>` Code Editor（未來可換 Monaco Editor）
  - Packages 輸入（逗號分隔 or tag input）
  - 狀態提示：「儲存後請至後台啟動此 Skill」

### AdminDashboard.tsx — 新增「Code Runners」頁簽

```
┌──────────────────────────────────────────────────────┐
│ Skill名稱       Port   狀態       操作               │
│ ERP 查詢助手   4001   🟢 Running  [停止] [重啟] [Log]│
│ 庫存查詢       ----   🔴 Stopped  [啟動] [安裝套件]  │
│ 翻譯 API       4003   🔴 Error    [查看錯誤] [重啟]  │
└──────────────────────────────────────────────────────┘
```

功能按鈕：
- **啟動 / 停止 / 重啟**：呼叫對應 API
- **安裝套件**：輸入 package names → POST /install → SSE log 顯示安裝進度
- **查看 Log**：SSE 串流即時 stdout/stderr

### RoleManagement.tsx / UserManagement.tsx

新增 `allow_code_skill` 欄位（checkbox / dropdown）。

---

## Phase 7：chat.js 整合

既有 external skill 呼叫 `endpoint_url` 的邏輯已完整，**code skill 不需要修改 chat.js**：

- code skill 啟動後 `endpoint_url` = `http://127.0.0.1:{port}`
- chat.js 對 external 的呼叫邏輯完全適用

> ⚠️ 注意：code skill 的 `type` 在 DB 存為 `'code'`，但 chat.js 處理時需視同 `'external'` 且呼叫 `endpoint_url`。調整 chat.js 的 skill type 判斷即可，改動小。

---

## Phase 8：.gitignore 更新

```gitignore
# Code Skill runners（含用戶 code 和 node_modules）
server/skill_runners/*/node_modules/
server/skill_runners/*/user_code.js  # 視安全需求決定是否排除
```

---

## 工時估計

| 階段 | 內容 | 估計 |
|---|---|---|
| Phase 1 | DB migration + 權限欄位 | 0.5 天 |
| Phase 2-3 | runner.js + skillRunner.js service | 1 天 |
| Phase 4 | Admin API routes | 0.5 天 |
| Phase 5 | Server 重啟自動恢復 | 0.5 天 |
| Phase 6 | 前端 UI（市集 + 後台 + 日誌） | 1 天 |
| Phase 7 | chat.js 微調 | 0.25 天 |
| **合計** | | **≈ 3.75 天** |

---

## 安全注意事項

> [!IMPORTANT]
> - `allow_code_skill` 必須嚴格控制在資訊部門，其他角色不可開啟
> - child_process 不做沙盒，代碼完全信任執行
> - skill_runners/{id}/ 目錄建議不對外暴露，僅 127.0.0.1 binding
> - 建議記錄每次 code 修改的 audit log（誰改了什麼）
