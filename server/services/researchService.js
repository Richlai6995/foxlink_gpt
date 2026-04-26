'use strict';
/**
 * Deep Research Service
 * Executes a research job: KB search → LLM per sub-question → synthesize → generate files
 * Supports task-level and per-topic binding of self KB / Dify KB / MCP servers
 * Enhanced: global file context, per-SQ hint/files/web, streaming sections, prev research refs
 */

const path = require('path');
const fs   = require('fs');
const { getGenerativeModel, extractText, extractUsage } = require('./geminiClient');
const { embedText, toVectorStr } = require('./kbEmbedding');
const { generateFile } = require('./fileGenerator');
const { upsertTokenUsage } = require('./tokenService');
const { calcCallUsd, HARD_KILL_MULTIPLIER } = require('./researchTokenEstimator');
const { extractTextFromFile } = require('./gemini');
const { UPLOAD_DIR } = require('../config/paths');
const { createClient } = require('./llmService');

const MODEL_PRO   = process.env.GEMINI_MODEL_PRO   || 'gemini-2.5-pro';
const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH  || 'gemini-2.5-flash';

// Research reasoning_effort → thinkingBudget 對應 (Pro scale;研究吃重思考,用最高預設)
const RESEARCH_BUDGET_MAP = { low: 2048, medium: 8192, high: 24576 };

/**
 * Resolve research 專用 model + thinking budget (from system_settings).
 * 每個 runResearchJob 開頭 call 一次,往下傳給 generateSection / synthesizeReport,
 * 避免多次 DB 撈 settings.
 * @returns {Promise<{ apiModel: string, thinkingBudget: number|undefined }>}
 */
async function _resolveResearchCfg(db) {
  try {
    const { resolveResearchConfig } = require('./llmDefaults');
    const { apiModel, reasoningEffort } = await resolveResearchConfig(db);
    const thinkingBudget = reasoningEffort ? RESEARCH_BUDGET_MAP[reasoningEffort] : undefined;
    return { apiModel: apiModel || MODEL_PRO, thinkingBudget };
  } catch {
    return { apiModel: MODEL_PRO, thinkingBudget: RESEARCH_BUDGET_MAP.high };
  }
}

/**
 * Build generationConfig for research LLM calls.
 * - thinkingBudget: 24576 (high) by default → 仍保留充足思考空間
 * - maxOutputTokens: 65536 (Gemini 2.5/3.x Pro 支援上限) → 解除預設 8192 截斷,單章節可寫到 ~3 萬中文字
 *
 * 注意:maxOutputTokens 是「output(含 thought)」總上限,thinkingBudget 在這之中。
 * thinkingBudget=24576 + maxOutputTokens=65536 → 實際寫作空間 ~40k tokens (~25k 中文字)
 */
function _buildResearchGenConfig(cfg, opts = {}) {
  const config = {};
  if (cfg?.thinkingBudget) {
    config.thinkingConfig = { thinkingBudget: cfg.thinkingBudget };
  }
  // 預設 65536(Pro 上限);呼叫端可覆寫(例如 plan/critic 用 Flash 時設小一點)
  config.maxOutputTokens = opts.maxOutputTokens ?? 65536;
  return Object.keys(config).length ? config : undefined;
}

// ─── KB Search ────────────────────────────────────────────────────────────────

/**
 * Search all accessible KBs for a user (fallback when no specific IDs given).
 */
async function searchUserKbs(db, userId, query, topK = 12) {
  return searchKbsInternal(db, userId, null, query, topK);
}

/**
 * Search only the specified KB IDs (permission still verified).
 */
async function searchSpecificKbs(db, userId, kbIds, query, topK = 12) {
  if (!kbIds || !kbIds.length) return '';
  return searchKbsInternal(db, userId, kbIds, query, topK);
}

/**
 * HyDE (Hypothetical Document Embeddings) query rewrite:
 * 用 Flash 對問題寫一段「假設答案」(150-300 字,含領域術語),
 * 把它與原問題合併作為 KB 召回 query。
 * 實證上對 vector retrieval 召回比直接用 raw question 高 20-30%。
 *
 * Falls back to original query if Flash fails.
 */
async function hydeRewriteQuery(question, language = 'zh-TW') {
  try {
    const isZh = language === 'zh-TW';
    const prompt = isZh
      ? `你是一位研究員。對以下研究問題,寫一段 150-300 字的「假設答案」(只用於資料檢索,不需完全正確,但須涵蓋該主題的常見專業術語、機構名稱、量化指標、時間範圍等)。直接寫答案,不要前言。\n\n研究問題:${question}`
      : `You are a researcher. For the following research question, write a 150-300 word "hypothetical answer" (used for retrieval only — accuracy is secondary; coverage of relevant domain terminology, organization names, quantitative indicators, time ranges is primary). Write the answer directly, no preamble.\n\nQuestion: ${question}`;
    const model = getGenerativeModel({
      model: MODEL_FLASH,
      generationConfig: { maxOutputTokens: 800 },
    });
    const result = await model.generateContent(prompt);
    const hyde = (extractText(result) || '').trim();
    const usage = extractUsage(result);
    if (!hyde || hyde.length < 50) {
      return { rewrittenQuery: question, inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 };
    }
    return {
      rewrittenQuery: `${hyde}\n\n${isZh ? '原始問題:' : 'Original question: '}${question}`,
      inputTokens:    usage.inputTokens  || 0,
      outputTokens:   usage.outputTokens || 0,
    };
  } catch (e) {
    console.warn('[Research] HyDE rewrite failed, fallback to raw query:', e.message);
    return { rewrittenQuery: question, inputTokens: 0, outputTokens: 0 };
  }
}

async function searchKbsInternal(db, userId, kbIds, query, topK) {
  try {
    // 含完整組織欄位,供 kb_access 比對
    const user = await db.prepare(
      `SELECT role, role_id, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?`
    ).get(userId);
    if (!user) return '';

    const orgBinds = [
      user.dept_code, user.dept_code,
      user.profit_center, user.profit_center,
      user.org_section, user.org_section,
      user.factory_code, user.factory_code,
      user.org_group_name, user.org_group_name,
    ];
    const orgClause = `
      OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
      OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
      OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
      OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
      OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
    `;

    // ⚠️ retrieveKbChunks 必須拿到完整 kb row 含 retrieval_config(CLAUDE.md 警告:少撈會讓 per-KB 覆寫 noop)
    const KB_COLS = `kb.id, kb.name, kb.embedding_dims, kb.retrieval_mode,
                     kb.top_k_return, kb.score_threshold, kb.retrieval_config,
                     kb.chunk_count`;

    let kbs;
    if (kbIds && kbIds.length) {
      const idPlaceholders = kbIds.map(() => '?').join(',');
      if (user.role === 'admin') {
        kbs = await db.prepare(
          `SELECT ${KB_COLS} FROM knowledge_bases kb
           WHERE kb.chunk_count > 0 AND kb.id IN (${idPlaceholders})`
        ).all(...kbIds);
      } else {
        kbs = await db.prepare(`
          SELECT ${KB_COLS} FROM knowledge_bases kb
          WHERE kb.chunk_count > 0 AND kb.id IN (${idPlaceholders}) AND (
            kb.creator_id=? OR kb.is_public=1
            OR EXISTS (SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
              (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
              OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
              ${orgClause}
            ))
          )
        `).all(...kbIds, userId, userId, user.role_id, ...orgBinds);
      }
    } else {
      if (user.role === 'admin') {
        kbs = await db.prepare(
          `SELECT ${KB_COLS} FROM knowledge_bases kb
           WHERE kb.chunk_count > 0 FETCH FIRST 5 ROWS ONLY`
        ).all();
      } else {
        kbs = await db.prepare(`
          SELECT ${KB_COLS} FROM knowledge_bases kb
          WHERE kb.chunk_count > 0 AND (
            kb.creator_id=? OR kb.is_public=1
            OR EXISTS (SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
              (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
              OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
              ${orgClause}
            ))
          )
          FETCH FIRST 5 ROWS ONLY
        `).all(userId, userId, user.role_id, ...orgBinds);
      }
    }

    if (!kbs.length) return '';

    const { retrieveKbChunks } = require('./kbRetrieval');
    const allResults = [];
    // 每個 KB 拉 topK*2(因為要跨 KB merge 後再 cut),最大 20 由 retrieveKbChunks 自行 clamp
    const perKbTopK = Math.min(20, Math.max(topK * 2, 12));

    for (const kb of kbs) {
      try {
        const { results } = await retrieveKbChunks(db, {
          kb, query, userId,
          source: 'research',
          topK: perKbTopK,
        });
        for (const r of results) {
          allResults.push({
            content: r.parent_content || r.content,
            filename: r.filename,
            score: r.score,
            kb_name: kb.name,
          });
        }
      } catch (e) {
        console.warn(`[Research] KB ${kb.id} retrieveKbChunks error:`, e.message);
      }
    }

    if (!allResults.length) return '';
    allResults.sort((a, b) => b.score - a.score);
    return allResults
      .slice(0, topK)
      .map((r) => `[來源: ${r.filename} (${r.kb_name})]\n${r.content}`)
      .join('\n\n---\n\n');
  } catch (e) {
    console.warn('[Research] searchKbs error:', e.message);
    return '';
  }
}

// ─── Dify KB Query ────────────────────────────────────────────────────────────

/**
 * Query a single API connector (DIFY or REST API) with a question. Returns answer text or ''.
 */
async function queryDifyKb(connector, question) {
  const { executeConnector } = require('./apiConnectorService');
  try {
    const answer = await executeConnector(
      connector,
      { query: question },
      { id: 0, email: '', name: 'research', employee_id: '', dept_code: '' },
      { sessionId: null, db: null }
    );
    // Strip error brackets for empty-like responses
    return (answer && !answer.startsWith('[')) ? answer : '';
  } catch (e) {
    console.warn(`[Research] API connector ${connector.id} query error:`, e.message);
    return '';
  }
}

// ─── MCP Tool Declarations ────────────────────────────────────────────────────

/**
 * Build Gemini function declarations from specific MCP server IDs.
 */
async function getMcpDeclarations(db, mcpServerIds) {
  if (!mcpServerIds || !mcpServerIds.length) return [];
  try {
    const idPlaceholders = mcpServerIds.map(() => '?').join(',');
    const servers = await db.prepare(
      `SELECT id, name, tools_json FROM mcp_servers WHERE is_active=1 AND id IN (${idPlaceholders})`
    ).all(...mcpServerIds);

    const decls = [];
    for (const srv of servers) {
      const tools = JSON.parse(srv.tools_json || '[]');
      for (const t of tools) {
        decls.push({
          _serverId: srv.id,
          _serverName: srv.name,
          name: `mcp_${String(t.name).replace(/[^a-zA-Z0-9_]/g, '_')}`,
          description: `[${srv.name}] ${t.description || t.name}`,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        });
      }
    }
    return decls;
  } catch (e) {
    console.warn('[Research] getMcpDeclarations error:', e.message);
    return [];
  }
}

/**
 * Call an MCP tool by name. Returns result text or ''.
 */
async function callMcpTool(db, mcpServerIds, toolName, args) {
  try {
    const idPlaceholders = mcpServerIds.map(() => '?').join(',');
    const servers = await db.prepare(
      `SELECT id, url, api_key, tools_json FROM mcp_servers WHERE is_active=1 AND id IN (${idPlaceholders})`
    ).all(...mcpServerIds);

    // Find which server owns this tool
    const rawName = toolName.replace(/^mcp_/, '');
    for (const srv of servers) {
      const tools = JSON.parse(srv.tools_json || '[]');
      const tool = tools.find((t) => String(t.name).replace(/[^a-zA-Z0-9_]/g, '_') === rawName
        || t.name === rawName);
      if (!tool) continue;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(srv.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(srv.api_key ? { 'Authorization': `Bearer ${srv.api_key}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool.name, arguments: args } }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) return '';
      const data = await resp.json();
      const content = data.result?.content;
      if (Array.isArray(content)) return content.map((c) => c.text || '').join('\n');
      return String(data.result || '');
    }
    return '';
  } catch (e) {
    console.warn(`[Research] callMcpTool ${toolName} error:`, e.message);
    return '';
  }
}

// ─── AI 戰情 Declarations & Query ─────────────────────────────────────────────

/**
 * Build Gemini function declarations from AI 戰情 design IDs.
 * @returns {Array<{_designId, name, description, parameters}>}
 */
async function getDashboardDeclarations(db, userId, designIds) {
  if (!designIds || !designIds.length) return [];
  try {
    const placeholders = designIds.map(() => '?').join(',');
    const designs = await db.prepare(
      `SELECT d.id, d.name, d.description, t.name AS topic_name
       FROM ai_select_designs d
       JOIN ai_select_topics t ON t.id = d.topic_id
       WHERE d.id IN (${placeholders})`
    ).all(...designIds);
    return designs.map((d) => ({
      _designId: d.id,
      name: `dashboard_${d.id}`,
      description: `[AI戰情:${d.topic_name}] ${d.name}${d.description ? ' — ' + d.description : ''}。當需要查詢此主題的業務數據時呼叫。`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '用自然語言描述你想查詢的內容，例如：「查詢2024年Q1各產品線的出貨量」' },
        },
        required: ['query'],
      },
    }));
  } catch (e) {
    console.warn('[Research] getDashboardDeclarations error:', e.message);
    return [];
  }
}

/**
 * Format query result table as readable text (max 100 rows).
 */
function formatTableAsText(result) {
  const { rows, columns, designName } = result;
  if (!rows || !rows.length) return `【${designName}】查無符合資料。`;
  const header = columns.join(' | ');
  const divider = columns.map(() => '---').join(' | ');
  const body = rows.slice(0, 100).map(r =>
    columns.map(c => (r[c] === null || r[c] === undefined) ? '' : String(r[c])).join(' | ')
  ).join('\n');
  return `【${designName} 查詢結果（共 ${rows.length} 筆）】\n${header}\n${divider}\n${body}`;
}

// ─── Fetch URL Tool (for ReAct agent) ────────────────────────────────────────

/**
 * 抓取 URL 內容供 agent 深入閱讀(googleSearch 只給 snippet,不夠深)。
 * SSRF 防護:禁止內網 / localhost。
 * 大小限制:200KB raw,strip 後再 cap 50K 字元。
 */
async function fetchUrlForAgent(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '錯誤:僅支援 http/https 協定';

    // SSRF 防護(避免 agent 抓內網)
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' || host === '0.0.0.0' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||  // link-local
      /^fc00:/.test(host) ||       // IPv6 ULA
      host.endsWith('.foxlink.com.tw')   // 內部域名也擋
    ) {
      return '錯誤:不允許抓取內網或受限 URL';
    }

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let resp;
    try {
      resp = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'FoxlinkResearchBot/1.0 (deep research agent)' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return `HTTP ${resp.status} ${resp.statusText}`;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!/text|html|json|xml/.test(ct)) return `不支援的 content-type: ${ct}`;

    let body = await resp.text();
    if (body.length > 200000) body = body.slice(0, 200000);

    // strip HTML
    if (/html/.test(ct) || /<html/i.test(body)) {
      body = body
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (body.length > 50000) body = body.slice(0, 50000) + '\n...[已截斷至 50K 字元]';
    return body || '(頁面無內容)';
  } catch (e) {
    return `抓取失敗:${e.message}`;
  }
}

const FETCH_URL_DECL = {
  name: 'fetch_url',
  description: '抓取指定公開網頁的文字內容,用於深入閱讀 google_search 找到的特定頁面(google_search 只提供片段)。回傳純文字,最多 50K 字元。禁止抓取內網。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '完整的 http(s) URL,例如 https://example.com/article' },
    },
    required: ['url'],
  },
};

// ─── File Context Extraction ──────────────────────────────────────────────────

/**
 * Extract text from a list of file objects [{name, path, mime_type}].
 * Returns combined text context string.
 */
async function extractFilesContext(files) {
  if (!files || !files.length) return '';
  const parts = [];
  for (const f of files) {
    try {
      if (!fs.existsSync(f.path)) continue;
      const text = await extractTextFromFile(f.path, f.mime_type, f.name);
      if (text?.trim()) parts.push(`【附件：${f.name}】\n${text.trim()}`);
    } catch (e) {
      console.warn(`[Research] extractFilesContext error for ${f.name}:`, e.message);
    }
  }
  return parts.join('\n\n---\n\n');
}

// ─── KB Suggestion ─────────────────────────────────────────────────────────────

/**
 * Suggest relevant KB IDs for a question by doing a quick search and
 * returning IDs that returned results above threshold.
 */
async function suggestKbs(db, userId, question) {
  try {
    const user = await db.prepare(
      `SELECT role, role_id, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?`
    ).get(userId);
    if (!user) return [];

    let kbs;
    if (user.role === 'admin') {
      kbs = await db.prepare(
        `SELECT id, embedding_dims, top_k_return, score_threshold, retrieval_config
         FROM knowledge_bases WHERE chunk_count > 0 ORDER BY name FETCH FIRST 20 ROWS ONLY`
      ).all();
    } else {
      kbs = await db.prepare(`
        SELECT kb.id, kb.embedding_dims, kb.top_k_return, kb.score_threshold, kb.retrieval_config
        FROM knowledge_bases kb
        WHERE kb.chunk_count > 0 AND (
          kb.creator_id=? OR kb.is_public=1
          OR EXISTS (SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
            (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
            OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
            OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
          ))
        )
        FETCH FIRST 20 ROWS ONLY
      `).all(
        userId, userId, user.role_id || 0,
        user.dept_code || null, user.dept_code || null,
        user.profit_center || null, user.profit_center || null,
        user.org_section || null, user.org_section || null,
        user.factory_code || null, user.factory_code || null,
        user.org_group_name || null, user.org_group_name || null,
      );
    }

    const embedding = await embedText(question, kbs[0]?.embedding_dims || 768);
    const vecStr = toVectorStr(embedding);
    const suggested = [];

    for (const kb of kbs) {
      try {
        const topK = Math.max(1, kb.top_k_return || 3);
        const threshold = kb.score_threshold || 0;
        const chunks = await db.prepare(`
          SELECT 1 FROM kb_chunks
          WHERE kb_id=? AND VECTOR_DISTANCE(embedding_vec, TO_VECTOR(?, FLOAT32, ${kb.embedding_dims || 768}), COSINE) < ?
          FETCH FIRST 1 ROWS ONLY
        `).all(kb.id, vecStr, 1 - threshold);
        if (chunks.length > 0) suggested.push(kb.id);
      } catch (_) {}
    }
    return suggested;
  } catch (e) {
    console.warn('[Research] suggestKbs error:', e.message);
    return [];
  }
}

// ─── LLM Helpers ──────────────────────────────────────────────────────────────

function detectLanguage(text) {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh-TW' : 'en';
}

/**
 * Generate plan JSON. Returns { plan, inputTokens, outputTokens }
 */
async function generatePlan(question, depth, hasKb, llmClient = null) {
  const lang     = detectLanguage(question);
  const langHint = lang === 'zh-TW' ? '請以繁體中文生成。' : 'Please generate in English.';
  const count    = Math.max(2, Math.min(8, depth));
  const prompt   = `你是一位研究規劃專家。使用者想深度研究：\n"${question}"\n\n${langHint}\n請生成一份研究計畫，含 ${count} 個子問題。\n\n回傳 JSON（嚴格格式，不加其他文字）：\n{"title":"研究主題（15字內）","objective":"目標說明（50字內）","language":"${lang}","sub_questions":[{"id":1,"question":"子問題1"},{"id":2,"question":"子問題2"}]}`;

  if (llmClient) {
    const raw  = await llmClient.generate([{ role: 'user', parts: [{ text: prompt }] }]);
    const text = raw.trim().replace(/^```json\s*|^```\s*|```\s*$/gm, '').trim();
    return { plan: JSON.parse(text), inputTokens: 0, outputTokens: 0 };
  }

  // fallback: direct Gemini env
  const model = getGenerativeModel({
    model: MODEL_FLASH,
    generationConfig: { responseMimeType: 'application/json' },
  });
  const result = await model.generateContent(prompt);
  const usage  = extractUsage(result);
  return {
    plan: JSON.parse(extractText(result).trim()),
    inputTokens:  usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

/**
 * Generate a section answer for one sub-question.
 * Supports KB context, Dify context, MCP function calling, web search,
 * global file context, per-SQ file context, and research hints.
 */
async function generateSection(question, kbContext, difyContext, mcpDecls, useWebSearch, language,
  globalFileContext = '', sqFileContext = '', hint = '', dashboardDecls = [],
  db = null, userId = null, modelKey = null, llmClient = null, researchCfg = null) {
  const isZh = language === 'zh-TW';

  const contextParts = [];
  if (globalFileContext) contextParts.push(isZh ? `【研究附件（全局）】\n${globalFileContext}` : `[Research Attachments (Global)]\n${globalFileContext}`);
  if (sqFileContext)     contextParts.push(isZh ? `【本子議題附件】\n${sqFileContext}` : `[Sub-topic Attachments]\n${sqFileContext}`);
  if (kbContext)         contextParts.push(isZh ? `【知識庫參考資料】\n${kbContext}` : `[Knowledge Base References]\n${kbContext}`);
  if (difyContext)       contextParts.push(isZh ? `【Dify知識庫參考資料】\n${difyContext}` : `[Dify KB References]\n${difyContext}`);
  const combinedContext = contextParts.join('\n\n---\n\n');

  const hintPart = hint?.trim() ? (isZh ? hint.trim() : hint.trim()) : '';

  // ── 研究員身份 prompt(Tier 1):強制結構化骨架 + 字數下限 + 量化數據要求 ──
  const prompt = isZh ? `你是一位資深研究分析師，正在撰寫一份深度研究報告中的單一章節。最終報告會由多個章節組成，本次任務只負責**一個**章節的內容深度。

【章節主題】
${question}
${hintPart ? `\n【研究方向提示】\n${hintPart}\n` : ''}
${combinedContext ? `\n【可用資料來源（請優先參考並引用）】\n${combinedContext}\n` : ''}
【撰寫要求（嚴格遵守）】

1. **字數要求**：本章節**至少 1500 字**，理想長度 2500-4000 字。內容必須有實質深度，不是流水帳。寧可深入單一面向，也不要泛泛而談。

2. **章節結構**：請使用 Markdown 二級（##）/三級（###）標題，將本章拆成 4-7 個子節，必須涵蓋下列大多數面向（依議題性質取捨）：
   - **背景與現況**：定義關鍵概念、列出可觀察的事實基礎
   - **量化證據**：必須包含**至少 3 個具體數字**（百分比、金額、時間、比例、增長率、市佔率等）。如資料來源沒有，請從一般知識補充，並標註「依公開資料」
   - **比較或對照**：與競爭對手 / 過往時期 / 不同情境的對比分析
   - **影響與意涵**：對相關 stakeholder（公司、客戶、員工、產業）的具體影響鏈條
   - **風險與不確定性**：列出 3-5 個潛在風險或反例，並評估發生機率
   - **前瞻判斷或建議**（適用時）：可執行的行動方案或觀察指標

3. **引用標註**：當引用「可用資料來源」中的內容時，在句末加 \`[來源:檔名]\` 或 \`[Dify:庫名]\`。內部知識補充不需引用。

4. **避免空泛**：禁用「非常重要」「具有深遠影響」「不容忽視」這類無資訊量的形容詞。每個論斷必須有具體例證、數據或邏輯支撐。

5. **不要寫執行摘要或結論**：那是後續整合階段的工作。本章節直接從第一個子節進入內容。

6. **資料不足時的處理**：明確標註「以下基於 X 推論」「資料缺口：應再查 Y」，**禁止編造數字**。

請以繁體中文撰寫，從第一個 \`##\` 標題開始，不要有開場白。` : `You are a senior research analyst writing a single chapter of a deep research report. Multiple chapters will be combined later; your sole task is to maximize the depth of THIS chapter.

[Chapter Topic]
${question}
${hintPart ? `\n[Research direction hint]\n${hintPart}\n` : ''}
${combinedContext ? `\n[Available sources — cite them where relevant]\n${combinedContext}\n` : ''}
[Writing requirements — strictly enforced]

1. **Length**: At least 1500 words, ideally 2500-4000 words. Substantive depth required, not a list.

2. **Structure**: Use Markdown ## / ### headings to split the chapter into 4-7 subsections covering most of:
   - Background & current state — define key concepts, observable facts
   - **Quantitative evidence** — at least **3 concrete numbers** (percentages, amounts, time, growth rates, market share). If sources lack them, supplement from general knowledge with a "per public data" caveat
   - Comparison — vs competitors / past periods / alternative scenarios
   - Impact & implications — concrete impact chain for stakeholders
   - Risks & uncertainty — 3-5 risks with probability assessment
   - Forward-looking judgment or recommendations (when applicable)

3. **Citations**: When using "Available sources", append \`[source:filename]\` or \`[Dify:kbname]\` at sentence end.

4. **No fluff**: Avoid empty adjectives like "very important", "far-reaching impact". Every claim needs concrete evidence, data, or logic.

5. **No executive summary or conclusion** — those are for later synthesis. Start directly from the first subsection.

6. **When data is missing**: Mark explicitly "Based on inference from X" or "Data gap: need to look up Y". Never fabricate numbers.

Start from the first \`##\` heading, no opening remarks.`;

  const tools = [];
  if (useWebSearch) tools.push({ googleSearch: {} });

  // Merge MCP + AI 戰情 function declarations + 內建 fetch_url(只在 useWebSearch 時提供,
  // 用於對 google_search snippet 找到的 URL 做深入閱讀)
  const cleanMcpDecls = mcpDecls.map(({ _serverId: _s, _serverName: _n, ...d }) => d);
  const cleanDashDecls = dashboardDecls.map(({ _designId: _d, ...d }) => d);
  const builtinDecls = useWebSearch ? [FETCH_URL_DECL] : [];
  const allFnDecls = [...cleanMcpDecls, ...cleanDashDecls, ...builtinDecls];
  if (allFnDecls.length) tools.push({ functionDeclarations: allFnDecls });

  // Note: 一律走 raw Gemini(thinkingBudget / maxOutputTokens / tools 都是 Gemini 專屬,
  // 走 llmClient 抽象會失去這些控制)
  const effectiveCfg = researchCfg || (db ? await _resolveResearchCfg(db) : { apiModel: MODEL_PRO, thinkingBudget: RESEARCH_BUDGET_MAP.high });
  const modelGenConfig = _buildResearchGenConfig(effectiveCfg);
  const model = getGenerativeModel({
    model: effectiveCfg.apiModel,
    ...(modelGenConfig ? { generationConfig: modelGenConfig } : {}),
  });
  let totalIn = 0, totalOut = 0;

  // ── ReAct-style function calling loop ───────────────────────────────────
  // Tier 3:從 5 → 15 turns,讓 agent 能反覆 web/fetch_url/MCP 深挖
  const MAX_TURNS = 15;
  let contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const toolCalls = []; // scratchpad: 紀錄 agent 每次工具呼叫,供前端展示

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const result = await model.generateContent({ contents, ...(tools.length ? { tools } : {}) });
    const usage = extractUsage(result);
    totalIn  += usage.inputTokens;
    totalOut += usage.outputTokens;

    const response = result.response || result;
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const fnCalls = parts.filter((p) => p.functionCall);

    if (!fnCalls.length) {
      // No more function calls — extract final text(剔除 thought parts,
      // Gemini 3.x 在 wrapper 自動 includeThoughts=true 下會切出 {text,thought:true} parts)
      const answer = parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim()
        || extractText(result).trim();
      return { answer, inputTokens: totalIn, outputTokens: totalOut, toolCalls };
    }

    // Execute each function call
    const fnResponses = [];
    for (const part of fnCalls) {
      const { name, args } = part.functionCall;
      let responseText = '';
      try {
        if (name === 'fetch_url') {
          console.log(`[Research] fetch_url: ${args.url}`);
          responseText = await fetchUrlForAgent(args.url);
          if (responseText.length > 30000) responseText = responseText.slice(0, 30000) + '\n...[已截斷]';
        } else if (name.startsWith('dashboard_') && db && userId) {
          const designId = parseInt(name.replace('dashboard_', ''), 10);
          console.log(`[Research] AI 戰情 function call: dashboard_${designId}, query: "${args.query}"`);
          const { queryDashboardDesignSync } = require('./dashboardService');
          const qResult = await queryDashboardDesignSync(db, userId, designId, args.query || question, modelKey);
          responseText = formatTableAsText(qResult);
        } else if (name.startsWith('mcp_')) {
          console.log(`[Research] MCP function call: ${name}`);
          const mcpServerIds = mcpDecls.map((d) => d._serverId).filter(Boolean);
          responseText = await callMcpTool(db, mcpServerIds, name, args);
        }
      } catch (e) {
        responseText = `查詢失敗：${e.message}`;
        console.warn(`[Research] function call ${name} error:`, e.message);
      }
      // 記錄到 scratchpad(回傳前 truncate,避免塞爆 DB)
      toolCalls.push({
        turn,
        name,
        args: JSON.stringify(args || {}).slice(0, 500),
        result_preview: String(responseText || '').slice(0, 300),
        result_length:  (responseText || '').length,
      });
      fnResponses.push({ functionResponse: { name, response: { result: responseText } } });
    }

    // Append model turn + function responses to conversation
    contents.push({ role: 'model', parts });
    contents.push({ role: 'user', parts: fnResponses });
  }

  // Fallback if loop exhausted without text answer
  return { answer: '（研究生成逾時，請稍後重試）', inputTokens: totalIn, outputTokens: totalOut, toolCalls };
}

/**
 * Synthesize all section answers into a final Markdown report.
 * Tier 1 改造:不再「縫合保留」,而是用 sections 當素材,**擴寫成完整報告骨架**。
 * - 執行摘要(800-1200 字,跨章節提煉)
 * - 各章節原文保留(已含深度內容)
 * - **跨章節綜合分析**(新增):章節間的關聯、矛盾、補強
 * - 結論與建議(800-1500 字,具體可執行)
 * - 附錄:資料缺口、後續研究建議
 */
async function synthesizeReport(title, sections, language, llmClient = null, researchCfg = null) {
  const isZh = language === 'zh-TW';

  const sectionsText = sections
    .map((s, i) => `# 第 ${i + 1} 章：${s.question}\n\n${s.answer}`)
    .join('\n\n---\n\n');

  const prompt = isZh ? `你是一位資深研究分析師,正在整合一份深度研究報告。各章節內容已由團隊分頭完成(下方提供),你的工作不是縫合,而是**為這份報告補上骨架與跨章節分析**,讓它成為一份完整的研究文件。

【研究主題】
${title}

【已完成的各章節原文】
${sectionsText}

【整合任務(嚴格遵守)】

1. **執行摘要**(800-1200 字,放在報告最前面)
   - 先以一段話點出研究問題與核心結論
   - 列出 3-5 個關鍵發現(每個 1-2 句,含具體數字)
   - 給出 2-3 個最重要的建議
   - 不要逐章節重述,要做**重點提煉**

2. **各章節**:**完整保留**上方各章原文(包含子標題與引用標註),不要刪減、不要改寫。每章前可加一行「章節要點」(1-2 句)幫讀者導讀。

3. **跨章節綜合分析**(新增章節,放在所有章節之後,800-1500 字):
   - 章節間的**關聯與互補**:章 A 的現象如何被章 B 的數據佐證
   - 章節間的**矛盾或張力**:不同章節給出的判斷是否衝突,衝突的原因
   - **整體圖像**:把分散的論點拼成完整圖像
   - **共通主題**:橫跨多個章節的趨勢

4. **結論與建議**(800-1500 字)
   - **結論**:基於全部研究的核心判斷,3-5 點,每點要有依據
   - **可執行建議**:分短期(0-3 月)、中期(3-12 月)、長期(1-3 年),每段含具體行動與預期成效
   - **後續觀察指標**:列出 3-5 個應持續追蹤的指標

5. **附錄:資料缺口與後續研究建議**(300-600 字)
   - 本研究發現的**未解問題**
   - 應補充的**資料來源**或**研究方法**

【格式要求】
- 用 Markdown,標題層級:報告主標題用 \`#\`,章節用 \`##\`,子節用 \`###\`
- 開頭直接寫主標題 \`# ${title}\`,不要有「以下是報告」這種開場白
- 整份報告無多餘客套,直接呈現內容

請以繁體中文撰寫。` : `You are a senior research analyst integrating a deep research report. Section drafts (below) are already done; your job is NOT to stitch them together, but to **add the spine and cross-cutting analysis** that turns them into a complete research document.

[Research Topic]
${title}

[Completed section drafts]
${sectionsText}

[Integration tasks — strictly enforced]

1. **Executive Summary** (800-1200 words, at the very top)
   - One paragraph framing the research question and core conclusion
   - 3-5 key findings (each 1-2 sentences with concrete numbers)
   - 2-3 most important recommendations
   - Do NOT re-summarize chapter by chapter — distill the essentials

2. **Chapters**: **Preserve all section drafts in full** (subheadings, citations included). You may prepend a 1-2 sentence "chapter pointer" before each.

3. **Cross-cutting analysis** (NEW chapter after all sections, 800-1500 words):
   - Inter-chapter linkages and reinforcement
   - Tensions and contradictions between chapters
   - Holistic picture
   - Cross-cutting themes

4. **Conclusion & Recommendations** (800-1500 words)
   - 3-5 core judgments with reasoning
   - Actionable recommendations: short-term (0-3 mo) / mid-term (3-12 mo) / long-term (1-3 yr)
   - 3-5 indicators to track going forward

5. **Appendix: Data gaps & further research** (300-600 words)
   - Unresolved questions
   - Sources / methods to add

[Format]
- Markdown, # for report title, ## for chapters, ### for subsections
- Start directly with \`# ${title}\` — no "Here is the report" preamble
- No fluff, no courtesies

Write in English.`;

  // Note: 一律走 raw Gemini(thinkingBudget / maxOutputTokens 都是 Gemini 專屬)
  const effectiveCfg = researchCfg || { apiModel: MODEL_PRO, thinkingBudget: RESEARCH_BUDGET_MAP.high };
  const modelGenConfig = _buildResearchGenConfig(effectiveCfg);
  const model = getGenerativeModel({
    model: effectiveCfg.apiModel,
    ...(modelGenConfig ? { generationConfig: modelGenConfig } : {}),
  });
  const result = await model.generateContent(prompt);
  const usage  = extractUsage(result);
  return {
    report:       extractText(result).trim(),
    inputTokens:  usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

// ─── File Generation ──────────────────────────────────────────────────────────

async function generateOutputFiles(jobId, title, report, sections, outputFormats) {
  const outputDir = path.join(UPLOAD_DIR, 'generated');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 30);
  const formats   = (outputFormats || 'docx').split(',').map((f) => f.trim()).filter(Boolean);
  const files     = [];

  for (const fmt of formats) {
    try {
      const filename = `research_${safeTitle}_${Date.now()}.${fmt}`;
      let content = report;

      if (fmt === 'xlsx') {
        content = JSON.stringify([{
          sheetName: '研究摘要',
          data: [
            ['研究主題', title],
            ['生成時間', new Date().toLocaleString('zh-TW')],
            [],
            ['子問題', '研究結果'],
            ...sections.map((s) => [s.question, s.answer.slice(0, 800)]),
          ],
        }]);
      }

      const filePath = await generateFile(fmt, filename, content, `research_${jobId}`);
      if (filePath) {
        files.push({
          name: path.basename(filePath),
          url:  `/uploads/generated/${path.basename(filePath)}`,
          type: fmt,
        });
      }
    } catch (e) {
      console.error(`[Research] generateFile ${fmt} error:`, e.message);
    }
  }
  return files;
}

// ─── Sub-question Pipeline (shared by runResearchJob + rerunSections) ────────

/**
 * Run the full retrieval + generation pipeline for a single sub-question.
 * Caller is responsible for streaming UI updates and sections array push.
 *
 * @param {object} db
 * @param {object} ctx — shared per-job context. Required keys:
 *   {
 *     userId, modelKey, language, isEn, useWebSearch,
 *     taskBinding, topicBindings, hasKbConfig,
 *     globalFileContext, llmClient, researchCfg,
 *     addTokens (modelName,in,out)=>void
 *   }
 * @param {object} sq — { id, question, hint?, files?, use_web_search? }
 * @returns {Promise<{
 *   answer: string,
 *   sourceLabel: string,
 *   selfKbIds: number[]|null, difyKbIds: number[],
 *   mcpServerIds: number[], dashboardDesignIds: number[]
 * }>}
 */
async function _processSubQuestion(db, ctx, sq) {
  const {
    userId, modelKey, language, isEn, useWebSearch,
    taskBinding, topicBindings, hasKbConfig,
    globalFileContext, llmClient, researchCfg, addTokens,
  } = ctx;

  // 1) Resolve bindings: topic > task > (search all only when no kb_config)
  const topicBind = topicBindings[String(sq.id)] || {};
  const selfKbIds = topicBind.self_kb_ids?.length   ? topicBind.self_kb_ids
                  : taskBinding.self_kb_ids?.length  ? taskBinding.self_kb_ids
                  : hasKbConfig ? [] : null;
  const difyKbIds = topicBind.dify_kb_ids?.length  ? topicBind.dify_kb_ids
                  : taskBinding.dify_kb_ids?.length ? taskBinding.dify_kb_ids
                  : [];
  const mcpServerIds = topicBind.mcp_server_ids?.length  ? topicBind.mcp_server_ids
                     : taskBinding.mcp_server_ids?.length ? taskBinding.mcp_server_ids
                     : [];
  const dashboardDesignIds = topicBind.dashboard_design_ids?.length  ? topicBind.dashboard_design_ids
                           : taskBinding.dashboard_design_ids?.length ? taskBinding.dashboard_design_ids
                           : [];

  const sqUseWeb = sq.use_web_search !== undefined ? Boolean(sq.use_web_search) : useWebSearch;

  // 2) Per-SQ file context
  let sqFileContext = '';
  if (sq.files?.length) {
    try { sqFileContext = await extractFilesContext(sq.files); } catch (_) {}
  }

  // 3) HyDE 改寫 + Self KB search
  // 只在「真的會搜 KB」時跑 HyDE,免費浪費 Flash 成本
  let kbContext = '';
  const willSearchKb = (selfKbIds === null) || (selfKbIds && selfKbIds.length > 0);
  let kbQuery = sq.question;
  if (willSearchKb) {
    try {
      const hyde = await hydeRewriteQuery(sq.question, language);
      kbQuery = hyde.rewrittenQuery;
      addTokens(MODEL_FLASH, hyde.inputTokens, hyde.outputTokens);
    } catch (_) {}
  }
  try {
    if (selfKbIds === null) kbContext = await searchUserKbs(db, userId, kbQuery);
    else if (selfKbIds.length) kbContext = await searchSpecificKbs(db, userId, selfKbIds, kbQuery);
  } catch (_) {}

  // 4) Dify KB query
  let difyContext = '';
  for (const difyId of difyKbIds) {
    try {
      const difyKb = await db.prepare(
        'SELECT * FROM dify_knowledge_bases WHERE id=? AND is_active=1'
      ).get(difyId);
      if (!difyKb) continue;
      const ans = await queryDifyKb(difyKb, sq.question);
      if (ans) difyContext += (difyContext ? '\n\n---\n\n' : '') + `[Dify「${difyKb.name}」]\n${ans}`;
    } catch (_) {}
  }

  // 5) MCP + AI 戰情 declarations
  let mcpDecls = [];
  try { mcpDecls = await getMcpDeclarations(db, mcpServerIds); } catch (_) {}
  let dashboardDecls = [];
  try { dashboardDecls = await getDashboardDeclarations(db, userId, dashboardDesignIds); } catch (_) {}

  // 6) Source label (for progress UI)
  const allKbLabel = isEn ? 'all KB' : '全部KB';
  const fileCount  = (sq.files?.length || 0);
  const sourceLabel = [
    selfKbIds ? `${selfKbIds.length}KB` : allKbLabel,
    difyKbIds.length ? `${difyKbIds.length}Dify` : '',
    mcpServerIds.length ? `${mcpServerIds.length}MCP` : '',
    fileCount ? `${fileCount}${isEn ? ' files' : '個附件'}` : '',
  ].filter(Boolean).join('+');

  // 7) Generate section with retry (Tier 1: web 不再因為附件而被關掉,讓 LLM/agent 自行決定)
  const shouldWeb = sqUseWeb;

  let answer = '';
  let toolCalls = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const sec = await generateSection(
        sq.question, kbContext, difyContext, mcpDecls, shouldWeb, language,
        globalFileContext, sqFileContext, sq.hint || '', dashboardDecls,
        db, userId, modelKey, llmClient, researchCfg
      );
      answer = sec.answer;
      toolCalls = sec.toolCalls || [];
      addTokens(researchCfg.apiModel, sec.inputTokens, sec.outputTokens);
      break;
    } catch (e) {
      if (attempt === 2) {
        answer = isEn
          ? `(Error researching this topic: ${e.message})`
          : `（研究此問題時發生錯誤：${e.message}）`;
      } else {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  return { answer, sourceLabel, toolCalls, selfKbIds, difyKbIds, mcpServerIds, dashboardDesignIds };
}

// ─── Active Jobs Tracker (for graceful SIGTERM) ──────────────────────────────
// 紀錄此 process 內正在跑的 jobIds,SIGTERM 時把這些 job 標回 pending 讓他 pod 接手。
const ACTIVE_JOBS = new Set();
const HEARTBEAT_INTERVAL_MS = 60_000;
const STALE_HEARTBEAT_MIN   = 5;     // 心跳超過 5 分鐘無更新 → 視為死掉
const MAX_RECOVERY_COUNT    = 3;

async function _markJobForRecovery(db, jobId) {
  // SIGTERM 時呼叫:把 in-flight job 狀態標成「等待恢復」(清 lock_token,heartbeat 設舊時間)
  // 其他 pod 的 recovery scheduler 會在下次掃描時撿起來
  try {
    await db.prepare(`
      UPDATE research_jobs SET
        progress_label = '節點關閉中,等待其他節點接手...',
        lock_token = NULL,
        heartbeat_at = SYSTIMESTAMP - INTERVAL '10' MINUTE,
        updated_at = SYSTIMESTAMP
      WHERE id = ? AND status = 'running'
    `).run(jobId);
  } catch (e) {
    console.warn(`[Research] _markJobForRecovery ${jobId} error:`, e.message);
  }
}

/**
 * SIGTERM 入口:把所有 in-flight jobs 標回可恢復狀態。
 * 由 server.js graceful shutdown 呼叫。
 */
async function gracefullyPauseActiveJobs(db) {
  const ids = Array.from(ACTIVE_JOBS);
  if (!ids.length) return;
  console.log(`[Research] SIGTERM: marking ${ids.length} active jobs for recovery`);
  for (const id of ids) {
    await _markJobForRecovery(db, id);
  }
}

/**
 * Recovery scheduler:掃描 stale jobs 並 resume。由 server.js 啟動時 + 每 5 分鐘 cron 呼叫。
 * - heartbeat_at 過期 5 min + recovery_count<3 → 嘗試恢復
 * - recovery_count>=3 → 直接標 failed
 */
async function recoverStaleJobs(db) {
  try {
    // 1) 標記:超過 3 次 recovery 仍失敗的,直接 failed
    await db.prepare(`
      UPDATE research_jobs SET
        status='failed',
        error_msg='已嘗試 ${MAX_RECOVERY_COUNT} 次恢復仍失敗',
        updated_at=SYSTIMESTAMP
      WHERE status='running'
        AND COALESCE(recovery_count, 0) >= ${MAX_RECOVERY_COUNT}
        AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
    `).run();

    // 2) 找到 stale jobs(running 但 heartbeat 過期,且 recovery 次數還沒滿)
    const stale = await db.prepare(`
      SELECT id, COALESCE(recovery_count, 0) AS recovery_count
      FROM research_jobs
      WHERE status='running'
        AND COALESCE(recovery_count, 0) < ${MAX_RECOVERY_COUNT}
        AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
    `).all();

    for (const row of stale) {
      // 防多 pod 同時搶:UPDATE WHERE 老 heartbeat 條件,只有第一個會成功
      try {
        const res = await db.prepare(`
          UPDATE research_jobs SET
            recovery_count = COALESCE(recovery_count,0) + 1,
            lock_token = NULL,
            progress_label = ?,
            heartbeat_at = SYSTIMESTAMP,
            updated_at = SYSTIMESTAMP
          WHERE id = ? AND status = 'running'
            AND COALESCE(recovery_count, 0) = ?
            AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
        `).run(`從中斷恢復(第 ${row.recovery_count + 1}/${MAX_RECOVERY_COUNT} 次)...`, row.id, row.recovery_count);

        const affected = res?.rowsAffected || res?.changes || 0;
        if (affected > 0) {
          console.log(`[Research] Recovering job ${row.id} (attempt ${row.recovery_count + 1}/${MAX_RECOVERY_COUNT})`);
          // detached
          setImmediate(() => runResearchJob(db, row.id).catch((e) =>
            console.error(`[Research] Recovery ${row.id} failed:`, e.message)
          ));
        }
      } catch (e) {
        console.warn(`[Research] Recovery ${row.id} update error:`, e.message);
      }
    }
  } catch (e) {
    console.error('[Research] recoverStaleJobs error:', e.message);
  }
}

// ─── Main Job Runner ──────────────────────────────────────────────────────────

async function runResearchJob(db, jobId) {
  let job;
  let isEn = false;
  let heartbeatTimer = null;
  let lockToken = null;
  ACTIVE_JOBS.add(jobId);
  try {
    job = await db.prepare('SELECT * FROM research_jobs WHERE id=?').get(jobId);
    if (!job) {
      ACTIVE_JOBS.delete(jobId);
      return;
    }

    // 取 row lock(避免兩個 pod 同時跑同一 job):lock_token 設成 process.pid 識別
    lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    await db.prepare(`
      UPDATE research_jobs SET lock_token=?, heartbeat_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=? AND (lock_token IS NULL OR lock_token=?)
    `).run(lockToken, jobId, lockToken);

    // 啟動 heartbeat(每 60s 更新)
    heartbeatTimer = setInterval(async () => {
      try {
        await db.prepare(
          `UPDATE research_jobs SET heartbeat_at=SYSTIMESTAMP WHERE id=? AND lock_token=?`
        ).run(jobId, lockToken);
      } catch (_) {}
    }, HEARTBEAT_INTERVAL_MS);

    // Build LLM client from job's model_key (follows session's chosen model)
    const llmClient = await createClient(db, job.model_key || 'pro').catch(() => null);
    // Resolve research-specific config (model + reasoning_effort → thinkingBudget)
    const researchCfg = await _resolveResearchCfg(db);

    const plan          = JSON.parse(job.plan_json || '{}');
    const subQuestions  = plan.sub_questions || [];
    const total         = subQuestions.length;
    const language      = plan.language || 'zh-TW';
    isEn                = language !== 'zh-TW';
    const useWebSearch  = job.use_web_search === 1;

    // ── KB config resolution ──────────────────────────────────────────────────
    const kbConfig      = JSON.parse(job.kb_config_json || '{}');
    const taskBinding   = kbConfig.task   || {};
    const topicBindings = kbConfig.topics || {};
    // hasKbConfig=true 表示使用者有進入 KB 設定畫面（即使全部留空）
    // selfKbIds=null → 搜全部 KB（舊行為，僅在完全無設定時觸發）
    // selfKbIds=[]   → 不搜任何 KB（使用者明確不選）
    const hasKbConfig   = !!job.kb_config_json;

    // ── Global file context (extract once, reuse for all sub-questions) ───────
    const globalFiles   = JSON.parse(job.global_files_json || '[]');
    let globalFileContext = '';
    if (globalFiles.length) {
      try {
        globalFileContext = await extractFilesContext(globalFiles);
      } catch (_) {}
    }

    // ── Previous research references ──────────────────────────────────────────
    let prevResearchContext = '';
    const refJobIds = JSON.parse(job.ref_job_ids_json || '[]');
    for (const refId of refJobIds.slice(0, 3)) {
      try {
        const refJob = await db.prepare(
          'SELECT title, result_summary FROM research_jobs WHERE id=? AND user_id=? AND status=\'done\''
        ).get(refId, job.user_id);
        if (refJob?.result_summary) {
          prevResearchContext += (prevResearchContext ? '\n\n---\n\n' : '') +
            (isEn
              ? `[Previous Research: ${refJob.title}]\n${refJob.result_summary}`
              : `【前次研究：${refJob.title}】\n${refJob.result_summary}`);
        }
      } catch (_) {}
    }
    if (prevResearchContext) {
      globalFileContext = (globalFileContext
        ? globalFileContext + '\n\n---\n\n'
        : '') + (isEn
          ? `[Previous Research Context]\n${prevResearchContext}`
          : `【前次研究背景】\n${prevResearchContext}`);
    }

    await db.prepare(
      "UPDATE research_jobs SET status='running', progress_total=?, updated_at=SYSTIMESTAMP WHERE id=?"
    ).run(total, jobId);

    const sections      = [];
    // Resume:從 DB 讀既有 streamingSections,recovery 時跳過 done=true 的 SQ
    let streamingSections = [];
    try {
      const existingSec = JSON.parse(job.sections_json || '[]');
      if (Array.isArray(existingSec)) streamingSections = existingSec;
    } catch (_) {}
    // 確保 streamingSections 長度 == subQuestions.length(對齊 index)
    while (streamingSections.length < subQuestions.length) streamingSections.push(null);

    const today         = new Date().toISOString().split('T')[0];
    // 從 DB 讀既有 tokensByModel(支援 resume / rerun 累計)
    let tokensByModel = {};
    try {
      const existing = JSON.parse(job.tokens_by_model_json || '{}');
      if (existing && typeof existing === 'object') tokensByModel = existing;
    } catch (_) {}
    let actualUsd = Number(job.actual_usd) || 0;
    const estimatedUsd = Number(job.estimated_usd) || 0;
    const hardKillUsd = estimatedUsd * HARD_KILL_MULTIPLIER;
    let killed = false;

    const addTokens = (modelName, inT, outT) => {
      if (!tokensByModel[modelName]) tokensByModel[modelName] = { in: 0, out: 0 };
      tokensByModel[modelName].in  += (inT  || 0);
      tokensByModel[modelName].out += (outT || 0);
    };

    // Build shared context for _processSubQuestion
    const ctx = {
      userId: job.user_id, modelKey: job.model_key, language, isEn, useWebSearch,
      taskBinding, topicBindings, hasKbConfig,
      globalFileContext, llmClient, researchCfg, addTokens,
    };

    // ── 並行版(p-limit(3)) ──────────────────────────────────────────────
    // 注意:Promise.all + p-limit 可能讓 1-2 個 in-flight task 在 killed=true 後仍跑完,
    // 但這是可接受的 trade-off(中斷 in-flight 需要 abort signal 一路傳到 Gemini SDK,工程量太大)
    const pLimitMod = await import('p-limit');
    const limit = pLimitMod.default(3);

    const sectionAnswers = new Array(subQuestions.length).fill(null);
    let completedCount = 0;
    // Resume agent_state(scratchpad)— { tool_calls_by_sq: { [sq_id]: [...] } }
    let agentState = { tool_calls_by_sq: {} };
    try {
      const existingAS = JSON.parse(job.agent_state_json || '{}');
      if (existingAS && existingAS.tool_calls_by_sq) agentState = existingAS;
    } catch (_) {}

    // Resume:預先把已完成的 SQ(streamingSections[i].done=true 且有 answer)填入 sectionAnswers
    for (let i = 0; i < subQuestions.length; i++) {
      const existing = streamingSections[i];
      if (existing && existing.done && existing.answer) {
        sectionAnswers[i] = { question: existing.question || subQuestions[i].question, answer: existing.answer };
        completedCount++;
      }
    }
    if (completedCount > 0) {
      console.log(`[Research] Resume job ${jobId}: ${completedCount}/${subQuestions.length} SQ already done, skipping`);
    }

    await Promise.all(subQuestions.map((sq, i) => limit(async () => {
      // Resume:已完成的 SQ 直接跳過
      if (sectionAnswers[i] !== null) return;

      // 進入 task 前若已 killed,直接跳過
      if (killed) {
        streamingSections[i] = { id: sq.id, question: sq.question,
          answer: isEn ? '(skipped — cost limit)' : '（已跳過 — 成本超限）', done: true };
        sectionAnswers[i] = { question: sq.question,
          answer: isEn ? '(Cost limit reached; this sub-question was skipped.)'
                       : '（成本超限,本子議題未執行。）' };
        return;
      }

      // mark in-progress
      streamingSections[i] = { id: sq.id, question: sq.question, answer: '', done: false };
      const tempLabel = isEn
        ? `Researching: ${sq.question.slice(0, 60)} [${completedCount}/${subQuestions.length}]`
        : `正在研究:${sq.question.slice(0, 60)} [${completedCount}/${subQuestions.length}]`;
      try {
        await db.prepare(
          'UPDATE research_jobs SET progress_step=?, progress_label=?, sections_json=?, updated_at=SYSTIMESTAMP WHERE id=?'
        ).run(completedCount, tempLabel, JSON.stringify(streamingSections), jobId);
      } catch (_) {}

      const { answer, sourceLabel, toolCalls } = await _processSubQuestion(db, ctx, sq);

      // 收集 scratchpad
      if (toolCalls && toolCalls.length) {
        agentState.tool_calls_by_sq[String(sq.id)] = toolCalls;
      }

      // 重算累計 USD
      let newUsd = 0;
      for (const [m, t] of Object.entries(tokensByModel)) {
        newUsd += await calcCallUsd(db, m, t.in, t.out);
      }
      actualUsd = newUsd;

      completedCount++;
      const finalLabel = isEn
        ? `${completedCount}/${subQuestions.length}: ${sq.question.slice(0, 60)} (${sourceLabel})`
        : `${completedCount}/${subQuestions.length}:${sq.question.slice(0, 60)}(${sourceLabel})`;

      streamingSections[i] = { id: sq.id, question: sq.question, answer, done: true };
      sectionAnswers[i] = { question: sq.question, answer };

      try {
        await db.prepare(
          'UPDATE research_jobs SET progress_step=?, progress_label=?, sections_json=?, actual_usd=?, tokens_by_model_json=?, agent_state_json=?, updated_at=SYSTIMESTAMP WHERE id=?'
        ).run(completedCount, finalLabel, JSON.stringify(streamingSections), actualUsd, JSON.stringify(tokensByModel), JSON.stringify(agentState), jobId);
      } catch (_) {}

      // Hard kill check(設 flag,其他並行 task 進入時會 skip)
      if (estimatedUsd > 0 && actualUsd > hardKillUsd && !killed) {
        killed = true;
        const killMsg = isEn
          ? `⚠️ Hard kill: $${actualUsd.toFixed(2)} > estimated × 2 ($${hardKillUsd.toFixed(2)})`
          : `⚠️ 強制中止:$${actualUsd.toFixed(2)} > 預估 ×2($${hardKillUsd.toFixed(2)})`;
        console.warn(`[Research] ${killMsg}`);
        try {
          await db.prepare(
            'UPDATE research_jobs SET progress_label=?, updated_at=SYSTIMESTAMP WHERE id=?'
          ).run(killMsg.slice(0, 300), jobId);
        } catch (_) {}
      }
    })));

    // 重組 sections 為按 SQ 順序的陣列(過濾 null = 並行 skipped 不該發生,但 defensive)
    for (const s of sectionAnswers) if (s) sections.push(s);

    // Synthesize(若被 hard-kill,仍對已完成 sections 整合,讓使用者拿到部分結果)
    await db.prepare(
      'UPDATE research_jobs SET progress_label=?, updated_at=SYSTIMESTAMP WHERE id=?'
    ).run(
      killed
        ? (isEn ? 'Hard-killed; synthesizing partial report...' : '已強制中止,正在整合部分報告...')
        : (isEn ? 'Synthesizing report...' : '正在整合報告...'),
      jobId
    );
    const { report, inputTokens: synIn, outputTokens: synOut } = await synthesizeReport(plan.title, sections, language, llmClient, researchCfg);
    addTokens(researchCfg.apiModel, synIn, synOut);

    // Recompute final actual_usd including synth tokens
    actualUsd = 0;
    for (const [m, t] of Object.entries(tokensByModel)) {
      actualUsd += await calcCallUsd(db, m, t.in, t.out);
    }

    // Generate files
    await db.prepare(
      'UPDATE research_jobs SET progress_label=?, actual_usd=?, tokens_by_model_json=?, updated_at=SYSTIMESTAMP WHERE id=?'
    ).run(isEn ? 'Generating documents...' : '正在生成文件...', actualUsd, JSON.stringify(tokensByModel), jobId);
    const files = await generateOutputFiles(jobId, plan.title, report, sections, job.output_formats || 'docx');

    // Flush token usage
    for (const [modelName, t] of Object.entries(tokensByModel)) {
      await upsertTokenUsage(db, job.user_id, today, modelName, t.in, t.out).catch((e) =>
        console.warn('[Research] upsertTokenUsage error:', e.message)
      );
    }

    // Mark done(killed 時用不同 label 但仍存檔讓使用者拿到部分結果)
    const summary = report.slice(0, 800);
    const finalLabel = killed
      ? (isEn ? `Partial result (hard-killed at $${actualUsd.toFixed(2)})` : `部分結果(成本超限中止 $${actualUsd.toFixed(2)})`)
      : (isEn ? 'Research complete' : '研究完成');
    await db.prepare(`
      UPDATE research_jobs
      SET status='done', progress_step=?, progress_label=?,
          result_summary=?, result_files_json=?, actual_usd=?, tokens_by_model_json=?,
          completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(total, finalLabel, summary, JSON.stringify(files), actualUsd, JSON.stringify(tokensByModel), jobId);

    if (job.session_id) {
      const downloadLinks = files.map((f) => `[📥 ${isEn ? 'Download' : '下載'} ${f.type.toUpperCase()}](${f.url})`).join('  \n');
      const msgContent = isEn
        ? `**📊 Deep Research Complete: ${plan.title}**\n\n${report.slice(0, 300)}${report.length > 300 ? '...' : ''}\n\n${downloadLinks}`
        : `**📊 深度研究完成：${plan.title}**\n\n${report.slice(0, 300)}${report.length > 300 ? '...' : ''}\n\n${downloadLinks}`;
      await db.prepare(
        `UPDATE chat_messages SET content=? WHERE session_id=? AND TO_CHAR(DBMS_LOB.SUBSTR(content,100,1))=?`
      ).run(msgContent, job.session_id, `__RESEARCH_JOB__:${jobId}`);
    }

    console.log(`[Research] Job ${jobId} completed — ${files.length} files`);
  } catch (e) {
    console.error(`[Research] Job ${jobId} failed:`, e.message);
    await db.prepare(
      "UPDATE research_jobs SET status='failed', error_msg=?, updated_at=SYSTIMESTAMP WHERE id=?"
    ).run((e.message || 'Unknown error').slice(0, 500), jobId);
    if (job?.session_id) {
      await db.prepare(
        `UPDATE chat_messages SET content=? WHERE session_id=? AND TO_CHAR(DBMS_LOB.SUBSTR(content,100,1))=?`
      ).run(isEn ? `**❌ Deep Research Failed**\n\n${e.message}` : `**❌ 深度研究失敗**\n\n${e.message}`, job.session_id, `__RESEARCH_JOB__:${jobId}`)
        .catch(() => {});
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    ACTIVE_JOBS.delete(jobId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// rerunSections — re-run selected sub-questions of an existing done/failed job
// sqOverrides: [{ id, question, hint, files, use_web_search }]
// ─────────────────────────────────────────────────────────────────────────────
async function rerunSections(db, jobId, sectionIds, sqOverrides = []) {
  let job;
  let isEn = false;
  try {
    job = await db.prepare('SELECT * FROM research_jobs WHERE id=?').get(jobId);
    if (!job) throw new Error('Job not found');

    const llmClient = await createClient(db, job.model_key || 'pro').catch(() => null);
    const researchCfg = await _resolveResearchCfg(db);

    const plan          = JSON.parse(job.plan_json || '{}');
    const subQuestions  = plan.sub_questions || [];
    const language      = plan.language || 'zh-TW';
    isEn                = language !== 'zh-TW';
    const useWebSearch  = job.use_web_search === 1;

    // Load existing sections (to preserve non-rerun sections)
    let streamingSections = [];
    try { streamingSections = JSON.parse(job.sections_json || '[]'); } catch (_) {}

    // Build override map
    const overrideMap = {};
    for (const ov of sqOverrides) overrideMap[String(ov.id)] = ov;

    const kbConfig      = JSON.parse(job.kb_config_json || '{}');
    const taskBinding   = kbConfig.task   || {};
    const topicBindings = kbConfig.topics || {};
    const hasKbConfig   = !!job.kb_config_json;

    // Global file context
    const globalFiles = JSON.parse(job.global_files_json || '[]');
    let globalFileContext = '';
    if (globalFiles.length) {
      try { globalFileContext = await extractFilesContext(globalFiles); } catch (_) {}
    }

    // Previous research context
    let prevResearchContext = '';
    const refJobIds = JSON.parse(job.ref_job_ids_json || '[]');
    for (const refId of refJobIds.slice(0, 3)) {
      try {
        const refJob = await db.prepare(
          "SELECT title, result_summary FROM research_jobs WHERE id=? AND user_id=? AND status='done'"
        ).get(refId, job.user_id);
        if (refJob?.result_summary) {
          prevResearchContext += (prevResearchContext ? '\n\n---\n\n' : '') +
            (isEn ? `[Previous Research: ${refJob.title}]\n${refJob.result_summary}`
                  : `【前次研究：${refJob.title}】\n${refJob.result_summary}`);
        }
      } catch (_) {}
    }
    if (prevResearchContext) {
      globalFileContext = (globalFileContext ? globalFileContext + '\n\n---\n\n' : '') +
        (isEn ? `[Previous Research Context]\n${prevResearchContext}`
              : `【前次研究背景】\n${prevResearchContext}`);
    }

    const sectionIdSet = new Set(sectionIds.map(String));
    const total = sectionIds.length;

    await db.prepare(
      "UPDATE research_jobs SET status='running', progress_step=0, progress_total=?, updated_at=SYSTIMESTAMP WHERE id=?"
    ).run(total, jobId);

    const today = new Date().toISOString().split('T')[0];
    // 從 DB 讀既有 tokensByModel(rerun 累計含先前 run 的 tokens)
    let tokensByModel = {};
    try {
      const existing = JSON.parse(job.tokens_by_model_json || '{}');
      if (existing && typeof existing === 'object') tokensByModel = existing;
    } catch (_) {}
    const addTokens = (modelName, inT, outT) => {
      if (!tokensByModel[modelName]) tokensByModel[modelName] = { in: 0, out: 0 };
      tokensByModel[modelName].in  += (inT  || 0);
      tokensByModel[modelName].out += (outT || 0);
    };

    const ctx = {
      userId: job.user_id, modelKey: job.model_key, language, isEn, useWebSearch,
      taskBinding, topicBindings, hasKbConfig,
      globalFileContext, llmClient, researchCfg, addTokens,
    };

    let rerunCount = 0;
    for (let i = 0; i < subQuestions.length; i++) {
      const sq = subQuestions[i];
      if (!sectionIdSet.has(String(sq.id))) continue;

      rerunCount++;
      const ov = overrideMap[String(sq.id)] || {};

      // Apply overrides → build effective sq
      const effectiveSq = {
        ...sq,
        question: ov.question || sq.question,
        hint:     ov.hint     !== undefined ? ov.hint     : (sq.hint || ''),
        files:    ov.files    || sq.files   || [],
        use_web_search: ov.use_web_search !== undefined ? ov.use_web_search : sq.use_web_search,
      };
      if (ov.question && ov.question !== sq.question) {
        subQuestions[i] = { ...sq, question: effectiveSq.question };
      }

      const researchingLabel = isEn
        ? `Re-researching (${rerunCount}/${total}): ${effectiveSq.question.slice(0, 50)}`
        : `重跑中 (${rerunCount}/${total})：${effectiveSq.question.slice(0, 50)}`;

      // Update streaming section as in-progress
      const existingIdx = streamingSections.findIndex((s) => String(s.id) === String(sq.id));
      const inProg = { id: sq.id, question: effectiveSq.question, answer: '', done: false };
      if (existingIdx >= 0) streamingSections[existingIdx] = inProg;
      else streamingSections.push(inProg);

      await db.prepare(
        'UPDATE research_jobs SET progress_step=?, progress_label=?, sections_json=?, updated_at=SYSTIMESTAMP WHERE id=?'
      ).run(rerunCount, researchingLabel, JSON.stringify(streamingSections), jobId);

      const { answer } = await _processSubQuestion(db, ctx, effectiveSq);

      const finIdx = streamingSections.findIndex((s) => String(s.id) === String(sq.id));
      const finSec = { id: sq.id, question: effectiveSq.question, answer, done: true };
      if (finIdx >= 0) streamingSections[finIdx] = finSec;
      else streamingSections.push(finSec);

      await db.prepare(
        'UPDATE research_jobs SET sections_json=?, updated_at=SYSTIMESTAMP WHERE id=?'
      ).run(JSON.stringify(streamingSections), jobId);
    }

    // Re-synthesize with all sections (including untouched ones)
    await db.prepare(
      'UPDATE research_jobs SET progress_label=?, updated_at=SYSTIMESTAMP WHERE id=?'
    ).run(isEn ? 'Re-synthesizing report...' : '重新整合報告...', jobId);

    // Update plan_json if questions changed
    plan.sub_questions = subQuestions;

    const allSections = streamingSections
      .filter((s) => s.done)
      .map((s) => ({ question: s.question, answer: s.answer }));

    const { report, inputTokens: synIn, outputTokens: synOut } = await synthesizeReport(plan.title, allSections, language, llmClient, researchCfg);
    addTokens(researchCfg.apiModel, synIn, synOut);

    await db.prepare(
      'UPDATE research_jobs SET progress_label=?, updated_at=SYSTIMESTAMP WHERE id=?'
    ).run(isEn ? 'Generating documents...' : '正在生成文件...', jobId);
    const files = await generateOutputFiles(jobId, plan.title, report, allSections, job.output_formats || 'docx');

    // rerun 只 upsert「本次新增」的部分 — 但 tokensByModel 已含先前累計,
    // 為避免重複 token_usage,只 flush 本次新增量(tokensByModel - existing)
    let prevTokens = {};
    try { prevTokens = JSON.parse(job.tokens_by_model_json || '{}') || {}; } catch (_) {}
    for (const [modelName, t] of Object.entries(tokensByModel)) {
      const prev = prevTokens[modelName] || { in: 0, out: 0 };
      const dIn  = (t.in || 0)  - (prev.in  || 0);
      const dOut = (t.out || 0) - (prev.out || 0);
      if (dIn > 0 || dOut > 0) {
        await upsertTokenUsage(db, job.user_id, today, modelName, dIn, dOut).catch(() => {});
      }
    }

    // 重算最終 actual_usd(用累計 tokensByModel)
    let finalUsd = 0;
    for (const [m, t] of Object.entries(tokensByModel)) {
      finalUsd += await calcCallUsd(db, m, t.in, t.out);
    }

    const summary = report.slice(0, 800);
    await db.prepare(`
      UPDATE research_jobs
      SET status='done', progress_step=?, progress_label=?,
          plan_json=?, result_summary=?, result_files_json=?,
          actual_usd=?, tokens_by_model_json=?,
          completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(total, isEn ? 'Research complete' : '研究完成',
      JSON.stringify(plan), summary, JSON.stringify(files),
      finalUsd, JSON.stringify(tokensByModel), jobId);

    if (job.session_id) {
      const downloadLinks = files.map((f) => `[📥 ${isEn ? 'Download' : '下載'} ${f.type.toUpperCase()}](${f.url})`).join('  \n');
      const msgContent = isEn
        ? `**📊 Deep Research Updated: ${plan.title}**\n\n${report.slice(0, 300)}${report.length > 300 ? '...' : ''}\n\n${downloadLinks}`
        : `**📊 深度研究已更新：${plan.title}**\n\n${report.slice(0, 300)}${report.length > 300 ? '...' : ''}\n\n${downloadLinks}`;
      await db.prepare(
        `UPDATE chat_messages SET content=? WHERE session_id=? AND TO_CHAR(DBMS_LOB.SUBSTR(content,100,1))=?`
      ).run(msgContent, job.session_id, `__RESEARCH_JOB__:${jobId}`).catch(() => {});
    }

    console.log(`[Research] Job ${jobId} rerun completed — ${sectionIds.length} sections`);
  } catch (e) {
    console.error(`[Research] Job ${jobId} rerun failed:`, e.message);
    await db.prepare(
      "UPDATE research_jobs SET status='failed', error_msg=?, updated_at=SYSTIMESTAMP WHERE id=?"
    ).run((e.message || 'Unknown error').slice(0, 500), jobId);
  }
}

module.exports = {
  runResearchJob,
  rerunSections,
  generatePlan,
  searchUserKbs,
  suggestKbs,
  recoverStaleJobs,
  gracefullyPauseActiveJobs,
};
