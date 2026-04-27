/**
 * test_html_artifact.js — HTML artifact passthrough 測試 skill
 *
 * 用途:在 MCP 還沒 ready 前,用 Skill 路徑驗證 ArtifactCard 對 HTML 的渲染。
 *      Passthrough 機制在 server / SSE / 前端是 MCP / Skill 共用,所以這個 skill
 *      測過代表 MCP 那條路也會 work(只剩 mcpClient.callTool returnRaw 路徑要實機驗)。
 *
 * 預設打 PCS 測試圖表;LLM 也可帶 url 參數抓任意內網 HTML 頁。
 *
 * 設定步驟見 docs/tool-artifact-passthrough.md (本檔最末段註解亦有摘要)。
 */

module.exports = async function handler(body) {
  const DEFAULT_URL = 'http://60.198.31.158:8308/pcs-api/test_records/5/chart/line';
  const url = (body && body.url) ? String(body.url).trim() : DEFAULT_URL;

  // 簡單 SSRF 防護:只允許 http/https,避免 file:// / gopher:// 之類
  if (!/^https?:\/\//i.test(url)) {
    return {
      system_prompt: `❌ URL 必須是 http/https,收到:${url}`,
      data: { url, error: 'invalid_protocol' },
    };
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return {
      system_prompt: `❌ 抓 ${url} 例外:${e.message}`,
      data: { url, error: e.message, name: e.name },
    };
  }

  if (!resp.ok) {
    return {
      system_prompt: `❌ ${url} 回 HTTP ${resp.status} ${resp.statusText}`,
      data: { url, status: resp.status, ok: false },
    };
  }

  const html = await resp.text();
  const contentType = resp.headers.get('content-type') || '';
  const looksLikeHtml = /html/i.test(contentType) || /^\s*<(!doctype|html|head|body)/i.test(html);

  if (!looksLikeHtml) {
    return {
      system_prompt: `⚠️ ${url} 回應不是 HTML(content-type: ${contentType||'(無)'}),前 300 字:\n${html.slice(0, 300)}`,
      data: { url, content_type: contentType, body_preview: html.slice(0, 300) },
    };
  }

  // 抽 <title> 當 artifact 標題;沒有就用 URL
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = (titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '') || `HTML 測試:${url}`;

  return {
    // LLM 收到簡短指引(不重複 HTML 全文)
    system_prompt:
      `已抓取 ${url} 並產出 HTML artifact「${title.slice(0, 80)}」(${html.length} bytes)。\n` +
      `Artifact 已直接顯示給使用者,請勿重複 HTML 內容,只需簡短說明即可。\n` +
      `若使用者問細節,可引用 data 欄位的 status / size / content_type。`,
    // ↓ passthrough 機制偵測到這個欄位 + skill.passthrough_enabled=1 就會直送前端 iframe
    artifact: {
      mime: 'text/html',
      title,
      content: html,
    },
    data: {
      url,
      size: html.length,
      content_type: contentType,
      status: resp.status,
      title,
    },
  };
};

/* ── 設定步驟(Method A:直接在 SkillMarket UI 貼程式碼,最快)──
 *
 *  1. SkillMarket → 「建立技能」
 *  2. 類型 = 「程式碼 (Code Runner)」(需 admin 授「allow_code_skill」)
 *  3. 名稱:「測試 HTML 圖表」(或任意,但最好含「測試 HTML」配合 manifest match_name)
 *  4. 「工具」分頁 → tool_schema 貼:
 *     {
 *       "description": "測試 HTML artifact passthrough — 從內網抓 HTML 頁並直接渲染給使用者",
 *       "parameters": {
 *         "type": "object",
 *         "properties": {
 *           "url": { "type": "string", "description": "要抓的 URL,留空用預設 PCS 測試圖表" }
 *         }
 *       }
 *     }
 *  5. 程式碼:整段貼入(或讓 syncSkillSources 自動同步,見 Method B)
 *  6. 「進階」分頁 → 勾「啟用自動 Passthrough」+ 允許格式留 HTML 勾選
 *  7. 儲存 → 啟動 runner(等到 status=running)
 *  8. 在對話中工具列 ✦ 勾選此技能,問「測試 HTML 圖表」或「用 test_html_artifact 抓 PCS 圖表」
 *
 *  ── Method B:走 git source-of-truth ──
 *  本檔已登錄 manifest.json(match_name=測試 HTML|test.?html.?artifact),
 *  只要 SkillMarket 已建一個名稱 match 的 skill,server restart 時會自動把這份程式碼
 *  推進 DB.code_snippet,並 hot-reload 子程序。
 *
 *  ── 預期行為 ──
 *  - LLM 呼叫 → skill 子程序 fetch URL → 回 { artifact, data }
 *  - chat.js tryPassthrough 偵測 → SSE event:artifact → 前端 ArtifactCard 用
 *    sandbox="allow-scripts" iframe 渲染整段 HTML(限高 600px,可全螢幕)
 *  - LLM 收到 system_prompt 短文(token 省 >90%),不會把 HTML 整段重述
 *  - audit_logs 留 [passthrough] skill:test_html_artifact (... bytes, text/html) 紀錄
 */
