# Tool Artifact Passthrough 規劃書

> MCP / Skill 回傳的 Markdown / HTML 跳過 LLM 直接渲染給使用者
>
> 草案日期:2026-04-24 · 狀態:規劃中(未實作)

---

## 0. TL;DR

目前 MCP tool / Skill 回傳的內容都會被當成 context 丟給 LLM,LLM 再「整理後回答」。對於本身就是成品的 Markdown 表格 / HTML 報表,這是三重浪費:

1. **Token 浪費** — 大張 HTML 報表佔滿 context window
2. **延遲變長** — 多一趟 LLM 生成,ttft 變慢
3. **品質下降** — LLM 有機率「美化」掉原本精準的表格內容

**解法**:新增 passthrough 管線,偵測 tool 回應是否為 `text/markdown` / `text/html`,命中就直接當 artifact 送到前端 SSE 渲染,**同時**把結構化摘要塞進 LLM context 讓 LLM 知道發生什麼事、使用者問後續問題時可引用。

適用對象:MCP tools + 自家 Skills + 未來的 DIFY tools(Phase 1 只做前兩個)。

---

## 1. 背景與動機

### 1.1 現況

現有 MCP server 設定有兩個 response_mode:
- **Inject(補充 Prompt)** — tool 結果注入 LLM prompt,LLM 整理後回答(當前預設)
- **Answer(直接回答)** — tool 結果直接當 LLM 輸入但引導 LLM 簡化回覆

兩者**都經過 LLM**。

Skills 回傳格式目前是 `{ system_prompt, data }`,其中 `system_prompt` 被 skill runner 注入 LLM。例如 [server/skill_sources/metal_prices.js](../server/skill_sources/metal_prices.js) 回的金屬報價 markdown 表格,會被 LLM 讀一遍再產生「最近銅價上漲 3%…」這類文字回應 — 但使用者其實只想看表。

### 1.2 需求

使用者回饋:**有些 MCP / Skill 的輸出本身就是成品,希望直接呈現,不要被 LLM 改寫或包裝**。

同時:
- 仍需可解析這些 MD / HTML(不是單純下載連結)
- 安全(HTML 是 XSS 向量)
- 不能全面替換現有 inject / answer 機制(多數 tool 回 JSON 仍需 LLM 整理)

---

## 2. 設計決策(已確認)

| # | 決策 | 選擇 | 理由 |
|---|---|---|---|
| A | LLM context 摘要策略 | 結構化抽取(title / headings / table 表頭 / 前 N 字)+ tool metadata | 免多呼一次 LLM,token 佔用可控 |
| B | ~~再問一次 about this~~ → **不做 reinject** | Artifact 純讀取;使用者想追問請複製 MD 或下載檔案走既有附件上傳流程 | 避免 ephemeral message / token 爆炸複雜度,使用者對內容流向更可控 |
| C | Passthrough 粒度 | Auto-detect(mimeType / content sniff)+ per-server 開關作為 gate | 同一 server 可能有多個 tool,per-tool 設定太煩 |
| D | 敏感詞 audit | 只記 event(誰 / 哪個 source / 內容 size / mime),不掃內容 | 使用者應為打開的 MCP server 負責,全掃會誤傷大檔 |
| 1 | Scope | Phase 1 同時做 MCP + Skills | Skills 套同一管線,一次到位 |
| 2 | Admin UI | `Inject / Answer` radio + 獨立 `auto-passthrough` checkbox | 允許 inject + passthrough 共存(JSON 走 inject、HTML 走 passthrough) |
| 3 | ~~Reinject session~~ | 不適用(取消 reinject) | |
| 4 | Skill contract | `system_prompt` + `artifact` 並存,artifact opt-in | 零 breaking change,作者有完整控制權 |

### 2.1 為什麼 inline iframe(Phase 1)而非 side panel artifact

| 差異 | Inline iframe | Side Panel |
|---|---|---|
| 工程成本 | 低 | 中(要 panel + store + route) |
| 短 MD 說明 | 自然 | 殺雞用牛刀 |
| 長 HTML 報表 | iframe 捲軸打架 | 滿版舒服 |
| 連續多次呼叫比對 | 要捲回去 | panel 列表切換 |
| 邊看邊問 | 被新訊息洗掉 | panel 常駐 |

**Phase 1 走 inline**(MD 走現有 markdown renderer、HTML 用 sandboxed iframe 限高 600px),Phase 2 視使用情況升級 side panel。

---

## 3. 架構總覽

```
┌──────────────────────────────────────────────────────────────────────┐
│                      LLM chat 回合(SSE)                              │
│                                                                      │
│  User ──► chat.js ──► Gemini(tool_use) ──┐                          │
│                                           ▼                          │
│                          ┌─────────────────────────┐                 │
│                          │  Tool Dispatch Loop     │                 │
│                          └──────────┬──────────────┘                 │
│                                     │                                │
│              ┌──────────────────────┼──────────────────────┐         │
│              ▼                                             ▼         │
│     ┌────────────────┐                          ┌─────────────────┐  │
│     │  mcpClient.js  │                          │   skillRunner   │  │
│     └───────┬────────┘                          └────────┬────────┘  │
│             │                                            │           │
│             └──────────────┐         ┌────────────────── ┘           │
│                            ▼         ▼                               │
│              ┌────────────────────────────────────┐                  │
│              │  toolResultPassthrough.js(新)     │                  │
│              │  detectPassthrough(result, config) │                  │
│              └───────────┬──────────────┬─────────┘                  │
│                          │ 命中          │ 未命中                     │
│                          ▼              ▼                            │
│              ┌───────────────┐   ┌──────────────────┐                │
│              │  Artifact     │   │ 照舊:tool result │                │
│              │  - 存 DB      │   │ append 進 LLM    │                │
│              │  - SSE 發送   │   │ messages(Inject)│                │
│              │  - summary    │   └──────────────────┘                │
│              │    塞 messages│                                       │
│              └───────┬───────┘                                       │
│                      ▼                                               │
│              ┌──────────────┐                                        │
│              │ LLM 最終回答  │                                        │
│              └──────┬───────┘                                        │
└─────────────────────┼────────────────────────────────────────────────┘
                      ▼ SSE
         ┌───────────────────────────┐
         │  Client                   │
         │  - text chunk(正常訊息)  │
         │  - artifact event         │
         │      ▼                    │
         │  ArtifactCard             │
         │   ├─ MD → MarkdownRender  │
         │   └─ HTML → iframe sandbox│
         └───────────────────────────┘
```

---

## 4. DB Schema 異動

### 4.1 `mcp_servers` 加 3 欄

```sql
-- 寫在 database-oracle.js runMigrations(),加 column existence check
ALTER TABLE mcp_servers ADD (
  passthrough_enabled NUMBER(1) DEFAULT 0,
  passthrough_max_bytes NUMBER DEFAULT 512000,              -- 500KB
  passthrough_mime_whitelist VARCHAR2(200) DEFAULT 'text/html,text/markdown'
);
```

### 4.2 `skills` 同樣 3 欄

```sql
ALTER TABLE skills ADD (
  passthrough_enabled NUMBER(1) DEFAULT 0,
  passthrough_max_bytes NUMBER DEFAULT 512000,
  passthrough_mime_whitelist VARCHAR2(200) DEFAULT 'text/html,text/markdown'
);
```

**注意**:skill 的 passthrough 門檻略低 — skill 作者明確回 `artifact` 欄位就算 opt-in,這個 gate 是「總開關」(管理員可以全域關掉某 skill 的 passthrough 即使 code 回了 artifact)。

### 4.3 新增 `chat_artifacts` 表

```sql
CREATE TABLE chat_artifacts (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id NUMBER NOT NULL,                -- FK chat_messages.id
  session_id VARCHAR2(64) NOT NULL,
  user_id NUMBER NOT NULL,                   -- 快查個人 artifact
  source_type VARCHAR2(20) NOT NULL,         -- 'mcp' | 'skill' | 'dify'
  source_id NUMBER,                          -- mcp_servers.id / skills.id
  tool_name VARCHAR2(200),
  tool_args CLOB,                            -- JSON string
  mime_type VARCHAR2(50) NOT NULL,           -- text/html | text/markdown
  title VARCHAR2(500),
  content CLOB NOT NULL,                     -- 原始 MD / HTML
  content_size NUMBER NOT NULL,
  summary CLOB,                              -- 結構化摘要(塞 LLM 的版本)
  detection_method VARCHAR2(30),             -- 'mime' | 'sniff' | 'skill_opt_in'
  created_at TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_artifacts_session ON chat_artifacts(session_id, created_at);
CREATE INDEX idx_artifacts_message ON chat_artifacts(message_id);
CREATE INDEX idx_artifacts_user ON chat_artifacts(user_id, created_at);
```

**為什麼存 DB**:
- Session 切換後仍可復現(chat_messages 有存訊息 → artifact 要能附著)
- 「再問一次 about this」要能用 artifact_id 撈回全文 inject
- Phase 2 side panel 的「本 session 所有 artifacts」列表直接 query

**容量估算**:500KB × 假設每使用者月產 20 artifacts × 100 人 = 1 GB/月。Oracle CLOB 還行,但**要監控**,Phase 2 超過一定大小考慮外移到 NFS,DB 只存 path。

---

## 5. Skill Contract(Option 4 — opt-in)

### 5.1 新 schema(向下相容)

```ts
interface SkillReturn {
  system_prompt?: string;        // ← 保留,給 LLM 的 context / 指引
  artifact?: {                   // ← 新增,opt-in
    mime: 'text/markdown' | 'text/html';
    title: string;
    content: string;
  };
  data?: any;                    // ← 保留,給 LLM downstream 加工
}
```

### 5.2 行為矩陣

| 回傳 | LLM 收到 | 使用者看到 |
|---|---|---|
| 只有 `system_prompt` | system_prompt 全文 | LLM 整理後的回答 |
| 只有 `artifact` | artifact summary | Artifact 直出 + LLM 可選的簡短 acknowledgement |
| `system_prompt` + `artifact` 都有 | system_prompt + artifact summary | LLM 文字回答 + Artifact 獨立顯示 |
| 都沒有 / 只有 `data` | `data` JSON | LLM 依 data 產文字 |

### 5.3 Helper(新增 `server/services/skillHelpers.js`)

```js
function toMarkdownArtifact(markdown, title) {
  return { mime: 'text/markdown', title, content: markdown };
}
function toHtmlArtifact(html, title) {
  return { mime: 'text/html', title, content: html };
}
module.exports = { toMarkdownArtifact, toHtmlArtifact };
```

### 5.4 升級範例([metal_prices.js](../server/skill_sources/metal_prices.js))

```diff
+ const { toMarkdownArtifact } = require('../services/skillHelpers');

  return {
-   system_prompt: table,
+   system_prompt: `已產出「全球主要金屬即時報價 (${today})」markdown artifact。若使用者問具體價格,請引用 data 欄位的數值;artifact 會直接顯示給使用者,不需重複內容。`,
+   artifact: toMarkdownArtifact(table, `全球主要金屬即時報價 (${today})`),
    data: { as_of: today, prices: {...} },
  };
```

**效益**:
- LLM context 從整張 markdown table(~2000 tokens)降到指引字串(~50 tokens)
- 使用者直接看到漂亮的表格,LLM 只做文字補充 / 台幣換算
- Token 省 ~95%、ttft 顯著縮短

---

## 6. Server 實作

### 6.1 新增 `server/services/toolResultPassthrough.js`

```js
// 單一入口,MCP / Skill 共用
//
// Input:  { result, mimeHint, source: { type, id, name, config } }
// Output: { passthrough: boolean, artifact?: {...}, summary?: string, reason?: string }

function detectPassthrough({ result, mimeHint, source }) { ... }

function sniffMime(content) { ... }          // content-based 偵測
function extractSummary(content, mime) { ... }
function validateContent(content, mime, maxBytes) { ... }
```

**偵測流程**:
1. `source.config.passthrough_enabled === 0` → 直接 return false
2. 決定 mimeType:
   - Skill 回 `{ artifact }` → `artifact.mime`(detection_method=`skill_opt_in`)
   - MCP `content[i].type === 'resource'` 且有 `mimeType` → 用它(`mime`)
   - 否則 sniff content(`sniff`):
     - `<!DOCTYPE html>` / `<html` 開頭 → `text/html`
     - 第一行 `#` / `|` / `---` 且整體有 markdown 結構 → `text/markdown`
     - 其他 → 不命中
3. 檢查 mimeType 在 `passthrough_mime_whitelist` 內
4. 檢查 size ≤ `passthrough_max_bytes`(超過 → 不 passthrough,fallback 正常 flow,log warn)
5. 抽 summary
6. return `{ passthrough: true, artifact, summary }`

**Summary 抽取(對應決策 A:結構化 + metadata)**:

```js
// Markdown
{
  tool: { name, source_type, source_id, args },
  title: 第一個 # heading 或 tool_name,
  headings: 前 10 個 ##/### heading,
  tables: 第一個表格的表頭 + 第一列資料,
  first_chars: 前 500 字(去除 code block),
  size: N bytes,
  mime: 'text/markdown',
}

// HTML(用 cheerio 或輕量 regex)
{
  tool: { ... },
  title: <title> 或第一個 <h1>,
  headings: 前 10 個 h1-h3,
  tables: 第一個 <table> 的 <th> 列 + 第一個 <tr>,
  first_chars: innerText 前 500 字,
  size: N bytes,
  mime: 'text/html',
}
```

注入 LLM context 時 render 成:

```
[工具 metal_prices 產出 markdown artifact「全球主要金屬即時報價 (2026-04-24)」,12345 bytes]
主要標題:📊 全球主要金屬即時報價 (USD, 2026-04-24)
表格欄位:金屬 | 最新報價 | 計價單位 | 漲跌幅
第一列:銅 (Copper) | 4.52 | USD/lb | +1.23%
(artifact 已直接顯示給使用者,請勿重複內容,可針對 data 欄位做補充說明)
```

### 6.2 改 `server/services/mcpClient.js`

找到現有 callTool 後的處理點,加:

```js
const result = await callTool(serverConfig, toolName, args);

const pt = detectPassthrough({
  result,
  mimeHint: result?.content?.[0]?.mimeType,
  source: { type: 'mcp', id: serverConfig.id, name: toolName, config: serverConfig },
});

if (pt.passthrough) {
  return {
    __passthrough: true,
    artifact: pt.artifact,         // 給 chat.js 存 DB + 發 SSE
    llm_message: pt.summary,        // 給 LLM messages(取代原 tool result)
  };
}

return result;  // 照舊
```

### 6.3 找 skill runner 整合點

**待確認**:需要 grep `skill_sources` 怎麼被 require / 呼叫。typical pattern:
```js
const handler = require(skillPath);
const result = await handler(body);
// ← 加 detectPassthrough
```

Skill 走的是 opt-in(看 `result.artifact` 是否存在),不做 content sniff。

### 6.4 改 `server/routes/chat.js` SSE 串流

假設現在的 tool loop 長類似:

```js
while (toolCalls.length) {
  for (const tc of toolCalls) {
    const result = await dispatchTool(tc);
    messages.push({ role: 'tool', content: result });
  }
  const next = await gemini.generate({ messages, ... });
  // stream ...
}
```

改成:

```js
while (toolCalls.length) {
  for (const tc of toolCalls) {
    const result = await dispatchTool(tc);

    if (result?.__passthrough) {
      // 1. 存 DB
      const artifactId = await db.insertArtifact({
        message_id: currentAssistantMessageId,
        session_id, user_id,
        source_type: tc.source_type,       // 'mcp' | 'skill'
        source_id: tc.source_id,
        tool_name: tc.name,
        tool_args: JSON.stringify(tc.args),
        mime_type: result.artifact.mime,
        title: result.artifact.title,
        content: result.artifact.content,
        content_size: Buffer.byteLength(result.artifact.content, 'utf8'),
        summary: JSON.stringify(result.artifact.summary_structured),
        detection_method: result.artifact.detection_method,
      });

      // 2. SSE 發 artifact event
      res.write(`event: artifact\ndata: ${JSON.stringify({
        id: artifactId,
        message_id: currentAssistantMessageId,
        mime_type: result.artifact.mime,
        title: result.artifact.title,
        content: result.artifact.content,
        size: result.artifact.content.length,
        tool_name: tc.name,
        source_type: tc.source_type,
      })}\n\n`);

      // 3. 塞 summary 當 tool result 給 LLM
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result.llm_message });

      // 4. Audit event-only
      await logAudit({
        user_id, session_id,
        content: `[passthrough] ${tc.source_type}:${tc.name} (${result.artifact.content.length} bytes, ${result.artifact.mime})`,
        has_sensitive: 0,
      });
    } else {
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
  // 再 call LLM ...
}
```

### 6.5 新路由:`server/routes/chatArtifacts.js`

```js
// GET /api/chat/artifacts/:id
//   權限檢查:只能撈自己 session 的 artifact
//   回 { id, mime_type, title, content, size, tool_name, created_at }
//   用途:下載 / lazy load(若 SSE event 未帶全文)

// GET /api/chat/sessions/:id/artifacts
//   回 session 所有 artifacts(session 復載用)
```

**注意**:不提供 `reinject` 路由。使用者想讓 LLM 處理 artifact 內容的流程是:
- **MD**:前端 `📋 複製 Markdown` → 貼進下一輪對話 → LLM 自然讀到 markdown
- **HTML / 大檔**:前端 `📥 下載` → 在下一輪對話附件欄上傳 → 走既有 multipart file parse 流程

這條路徑零新開發,既有 size limit / audit / file gen 邏輯照舊生效。

### 6.6 Audit(決策 D:event-only)

沿用 `audit_logs` 表,加一種 content 格式 prefix `[passthrough]`,**不**跑 `sensitive_keywords` 掃描。

---

## 7. Client 實作

### 7.1 Types

```ts
// client/src/types/artifact.ts
export interface ChatArtifact {
  id: number;
  message_id: number;
  mime_type: 'text/html' | 'text/markdown';
  title: string;
  content: string;
  size: number;
  tool_name: string;
  source_type: 'mcp' | 'skill' | 'dify';
}
```

### 7.2 SSE handler(改 `useChatStream` 或現有 hook)

接 `event: artifact` 事件:

```ts
case 'artifact': {
  const artifact: ChatArtifact = JSON.parse(data);
  setMessages(prev => prev.map(m =>
    m.id === artifact.message_id
      ? { ...m, artifacts: [...(m.artifacts ?? []), artifact] }
      : m
  ));
  break;
}
```

### 7.3 `ArtifactCard` component(Phase 1 inline)

```tsx
// client/src/components/ArtifactCard.tsx
export function ArtifactCard({ artifact }: { artifact: ChatArtifact }) {
  const [fullscreen, setFullscreen] = useState(false);

  if (artifact.mime_type === 'text/markdown') {
    return (
      <div className="artifact-md-card rounded-lg border p-3 my-2">
        <div className="text-xs text-gray-500 mb-2">
          📎 {artifact.title} · {artifact.tool_name} · {fmtSize(artifact.size)}
        </div>
        <MarkdownRenderer content={artifact.content} />
        <ArtifactActions artifact={artifact} kind="md" />
      </div>
    );
  }

  // HTML
  return (
    <div className="artifact-html-card rounded-lg border my-2">
      <div className="flex items-center justify-between p-2 bg-gray-50 border-b">
        <span className="text-xs">📎 {artifact.title} · {fmtSize(artifact.size)}</span>
        <button onClick={() => setFullscreen(true)}>🔍</button>
      </div>
      <iframe
        srcDoc={artifact.content}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: 600, border: 'none' }}
        title={artifact.title}
      />
      <ArtifactActions artifact={artifact} kind="html" />
      {fullscreen && <FullscreenArtifactModal artifact={artifact} onClose={() => setFullscreen(false)} />}
    </div>
  );
}

function ArtifactActions({ artifact, kind }: { artifact: ChatArtifact; kind: 'md' | 'html' }) {
  return (
    <div className="flex items-center gap-3 p-2 text-xs text-gray-600">
      {kind === 'md' && (
        <button onClick={() => copyMarkdown(artifact)}>📋 複製 Markdown</button>
      )}
      <button onClick={() => downloadArtifact(artifact)}>📥 下載</button>
      <span className="ml-auto text-gray-400">
        💡 要讓 AI 分析此內容?請下載後在新對話上傳為附件
      </span>
    </div>
  );
}

async function copyMarkdown(a: ChatArtifact) {
  try {
    await navigator.clipboard.writeText(a.content);
    toast.success('已複製 Markdown');
  } catch {
    // HTTPS 以外 / 舊瀏覽器 fallback
    openCopyFallbackModal(a.content);
  }
}
```

**設計決策**:
- MD 有「複製 Markdown」;HTML **沒有** 複製按鈕(抽 innerText 跑版嚴重,不如下載)
- **完全移除** 「再問一次 about this」按鈕 — 改走既有附件上傳流程(決策 B 更動)
- Footer 小字明確告訴使用者「想 AI 分析請下載 + 上傳」

### 7.4 `ChatMessage` 整合

```tsx
<div>
  <MarkdownRenderer content={message.content} />
  {message.artifacts?.map(a => <ArtifactCard key={a.id} artifact={a} />)}
</div>
```

Artifact 出現順序:在同一 assistant message 的文字內容**下方**(代表 tool call 的產出,LLM 文字回應在上)。

### 7.5 Session 復載

進入已存在的 session 時,GET `/api/chat/sessions/:id/artifacts` 撈所有 artifacts,按 message_id 分組塞回 messages state。

---

## 8. Admin UI

### 8.1 MCP Server 編輯 Modal(改 `MCPServerEditModal` 或類似)

現有:
```
回應模式
○ Inject (補充 Prompt)
○ Answer (直接回答)
```

加在下方(**獨立 checkbox,不是 radio 第三選項** — 決策 2):

```
─────────────────────
☑ 啟用自動 Passthrough
   偵測到 MD / HTML 回應時直接呈現,跳過 LLM 整理
   ├─ 最大內容     [500    ] KB
   ├─ 允許格式     ☑ Markdown  ☑ HTML
   └─ ℹ️ Passthrough 內容不經 LLM,敏感詞掃描也會跳過
```

### 8.2 Skills 編輯介面

一樣的 block。加註:「Skill 必須在 handler 回傳 `artifact` 欄位才會生效(詳見 [docs/tool-artifact-passthrough.md](tool-artifact-passthrough.md))。」

### 8.3 新增「我的 Artifacts」頁(Phase 1 選配 / Phase 2 必做)

列使用者所有 artifacts(跨 session),可搜尋、下載、刪除。Phase 1 可先不做,直接靠 session 內顯示。

---

## 9. Security

### 9.1 HTML iframe sandbox

```html
<iframe
  srcDoc={html}
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
/>
```

**不加**的屬性:
- `allow-same-origin` — 禁止存取 `parent`、cookie、localStorage、IndexedDB
- `allow-top-navigation` — 禁止把整頁 location 改掉
- `allow-forms` — Phase 1 不開放 form submit(視需求 Phase 2 再考慮)
- `allow-popups` — 禁止彈 window.open

**後果**:iframe 內的 `fetch()` 會是 null origin,不能打自家 API(想保留 cookie session)。這個 trade-off 符合安全優先。

### 9.2 CSP

現有的 Helmet / CSP 設定要確認允許:
- `frame-src 'self' data:`(iframe 用 srcdoc 算 same-origin data)
- 不要 loose `script-src`

### 9.3 Markdown

MD 走現有 renderer。確認現有 renderer **有 sanitize**(DOMPurify / 不啟用 raw HTML)。若允許 raw HTML,passthrough MD 等同 HTML passthrough,這條風險要 close。

### 9.4 Size limit 繞過

- Server 強制 `content_size > passthrough_max_bytes` → 直接 fallback 走 inject,log warn
- Client 再 check 一次(防 API 被亂打)

### 9.5 Audit trail

雖然決策 D 是 event-only、不掃內容,但 **content 本身存在 DB**。若未來需稽核,DBA 可直接 query。這點在使用者告知文案明講。

---

## 10. i18n

新增三語 key(`zh-TW`、`en`、`vi`):

```
passthrough.enable          = "啟用自動 Passthrough" / "Enable auto-passthrough" / ...
passthrough.desc            = "偵測到 MD/HTML 回應時直接呈現"
passthrough.max_bytes       = "最大內容"
passthrough.allowed_mime    = "允許格式"
passthrough.no_audit_warn   = "Passthrough 內容不經 LLM,敏感詞掃描也會跳過"

artifact.download           = "下載"
artifact.fullscreen         = "全螢幕"
artifact.copy_md            = "複製 Markdown"
artifact.copy_success       = "已複製 Markdown"
artifact.copy_fallback.title = "請手動複製"
artifact.analyze_hint       = "要讓 AI 分析此內容?請下載後在新對話上傳為附件"
artifact.size               = "大小"
artifact.source             = "來源"
```

---

## 11. Migration / Rollout

### 11.1 DB migration

`database-oracle.js` `runMigrations()` 加三段 ALTER + 一段 CREATE TABLE,都帶 existence check(失敗不 block server 啟動)。

### 11.2 既有 MCP servers

DB 欄位 default `passthrough_enabled = 0` → 既有 server 不受影響,沿用原 inject/answer 行為。Admin 手動勾選後才啟用。

### 11.3 既有 Skills

同樣 default 0 + skill code 沒回 `artifact` 欄位 → 完全不受影響。

升級路徑:
1. Admin 在 skill 設定勾「啟用自動 Passthrough」
2. Skill 作者改 handler 回傳加 `artifact` 欄位
3. 兩者都成立 → passthrough 生效

### 11.4 Rollback

- Env var `PASSTHROUGH_FEATURE_DISABLED=1` 強制關閉整個機制(所有 server / skill 的 passthrough 都 noop)
- 或 DB 全域 `UPDATE mcp_servers SET passthrough_enabled=0; UPDATE skills SET passthrough_enabled=0;`

---

## 12. Phase 劃分

### Phase 1(本規劃書 scope)

- [ ] DB schema migration
- [ ] `toolResultPassthrough.js` 核心
- [ ] `skillHelpers.js`
- [ ] mcpClient 整合
- [ ] skillRunner 整合
- [ ] chat.js SSE artifact event
- [ ] chatArtifacts.js 路由(GET artifact、GET session artifacts)
- [ ] Client `ArtifactCard`(inline MD + HTML iframe)
- [ ] Client `copyMarkdown` + clipboard fallback modal
- [ ] Session 復載 artifacts
- [ ] Admin UI(MCP + Skill passthrough 設定)
- [ ] Audit log event
- [ ] i18n 三語
- [ ] [metal_prices.js](../server/skill_sources/metal_prices.js) 升級示範(可選)
- [ ] Help 系統新增「Passthrough 模式」說明(含「要 AI 分析請下載上傳」流程)

### Phase 2(未排期,視使用情況)

- [ ] Side panel artifact UI
- [ ] Artifact 版本管理(同 tool 多次呼叫 → v1 / v2 / v3 切換)
- [ ] Artifact 獨立分享 URL
- [ ] 「我的 Artifacts」頁(跨 session 列表)
- [ ] DIFY tool passthrough 支援
- [ ] Artifact content 外移 NFS(DB 只存 path)
- [ ] iframe `allow-forms` 開放(需加 CSRF 保護)
- [ ] Passthrough 內容選擇性敏感詞掃描(變 admin 可配)
- [ ] **Pin-to-context 模式**:若使用者連續多輪追問同一 artifact,提供「釘選」功能讓該 artifact 在後續 N 輪自動當 system context(比 reinject 更好的設計,取代 Phase 1 移除的 reinject)

---

## 13. 未決 / 風險

### 13.1 MCP 現實 mimeType 覆蓋率

現實中多數 MCP server 只回 plain text,不標 mimeType。我們靠 content sniff 補。**需 Phase 1 上線後收集 metric**:

```
[metric] passthrough.detect.mime     # MCP 自己標的
[metric] passthrough.detect.sniff    # 我們 sniff 命中
[metric] passthrough.detect.miss     # 未命中(該有但沒抓到?)
```

若 sniff miss 率高,調整 heuristic。

### 13.2 CLOB 存量

500KB × N 成長速度。Phase 1 先記錄 `content_size` 統計,一旦總量 > 某閾值(10 GB?)啟動 Phase 2 外移 NFS。

### 13.3 iframe 無 same-origin 可能限制功能

某些 MCP 產的 HTML 若需要 fetch 自家 API 呈現動態資料,會被 sandbox 擋。這種 case 應該讓該 MCP 走 inject(auto-detect 不開)。

### 13.4 ~~Reinject 爆 token~~ → 設計上迴避

**原始擔憂**:500KB artifact 當 inject 會讓後續每輪對話重複帶 180k tokens,token 費用飆 + 長對話記憶體壓力。

**最終決策**:Phase 1 **完全不做 reinject**。Artifact 為純讀取展示物,使用者若要讓 LLM 處理內容,走以下兩條路:

1. **MD**:`📋 複製 Markdown` → 貼進下一輪對話 → LLM 自然收到(使用者自行決定貼多少)
2. **HTML / 大檔**:`📥 下載` → 新對話附件上傳 → 走既有 multipart 解析路徑

**收益**:
- Token 流向完全使用者可控,不會被暗中注入大 content
- 零新程式碼(reinject endpoint、ephemeral message state、modal 全砍)
- 對齊「**artifact 是成品展示,對話是對話**」的心智模型

**取捨**:
- 連續多輪追問同一 artifact 較麻煩(每輪都要貼 / 上傳一次)— 若實測有明顯痛點,Phase 2 再加「pin to context」模式(標記某 artifact 持續當 system context),比 reinject 更好的設計
- HTML 無法方便複製內容 — 設計上就是「下載 + 上傳」這條唯一路徑,不讓使用者產生「有複製按鈕但 LLM 讀不好」的期望落差

### 13.5 Skill contract 的 `system_prompt` 與 artifact 衝突情境

若 skill 同時回:
```js
{
  system_prompt: "請用三點式分析金屬走勢...",
  artifact: toMarkdownArtifact(table, "金屬報價"),
}
```

LLM 會讀到 `system_prompt` + artifact summary,可能會用 table 資料重複產文字 → 違背「跳過 LLM」本意。

**建議**:在 `system_prompt` 內明確寫「artifact 已直接顯示,請勿重複 table 內容,僅做文字補充」。Helper 可以自動在 summary 加這句。

### 13.6 與 Gemini 的 tool_use / function calling 格式搭配

Gemini SDK(new=@google/genai)的 tool result 格式要確認:`tool result` 內容是字串還是物件?summary 是 plain text 還是結構化 JSON?需看 [geminiClient.js](../server/services/geminiClient.js) 現行 tool_use 處理,照格式填。

---

## 14. 驗收標準

Phase 1 完成的定義:

1. ✅ 既有 MCP servers / skills 預設行為**完全不變**(passthrough_enabled=0)
2. ✅ [metal_prices.js](../server/skill_sources/metal_prices.js) 升級後:問「金屬報價」→ 前端直接看到 markdown 表、LLM 文字 < 100 字、token 省 >80%
3. ✅ 找一個 MCP 工具回 HTML → iframe 正確 sandbox 渲染,scripts 不能存取 parent
4. ✅ Passthrough 內容 > 500KB → fallback 走 inject,不壞 flow
5. ✅ Session 切換回來 → artifact 仍顯示
6. ✅ MD artifact `📋 複製 Markdown` 成功複製 raw markdown 到 clipboard;HTML artifact `📥 下載` 產出完整 .html 檔
7. ✅ Admin UI 三語正常
8. ✅ Audit log 有 passthrough event 紀錄

---

## 15. 相關文件

- [tool-architecture.md](tool-architecture.md) — MCP / DIFY / 技能工具架構
- [mcp-user-identity-auth.md](mcp-user-identity-auth.md) — MCP JWT 使用者身份
- [chat-inline-chart-plan.md](chat-inline-chart-plan.md) — Chat Inline Chart(類似理念的前端渲染)
- [llm-performance-optimization.md](llm-performance-optimization.md) — streaming / genConfig 相關

---

## 16. 變更紀錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-04-24 | v0.1 | 初版草案,架構 + 四大決策(A/B/C/D)+ 四大子決策確認後寫入 |
| 2026-04-24 | v0.2 | **取消 reinject 機制**:決策 B / 子決策 3 失效。Artifact 純讀取,MD 提供 `複製 Markdown`、HTML 僅下載 / 全螢幕。追問改走既有附件上傳流程。Phase 2 改為規劃「Pin-to-context」取代 reinject |
