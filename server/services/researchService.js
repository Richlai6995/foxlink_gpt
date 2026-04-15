'use strict';
/**
 * Deep Research Service
 * Executes a research job: KB search → LLM per sub-question → synthesize → generate files
 * Supports task-level and per-topic binding of self KB / Dify KB / MCP servers
 * Enhanced: global file context, per-SQ hint/files/web, streaming sections, prev research refs
 */

const path = require('path');
const fs   = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { embedText, toVectorStr } = require('./kbEmbedding');
const { generateFile } = require('./fileGenerator');
const { upsertTokenUsage } = require('./tokenService');
const { extractTextFromFile } = require('./gemini');
const { UPLOAD_DIR } = require('../config/paths');
const { createClient } = require('./llmService');

const MODEL_PRO   = process.env.GEMINI_MODEL_PRO   || 'gemini-2.5-pro';
const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH  || 'gemini-2.5-flash';

// ─── KB Search ────────────────────────────────────────────────────────────────

/**
 * Search all accessible KBs for a user (fallback when no specific IDs given).
 */
async function searchUserKbs(db, userId, query, topK = 6) {
  return searchKbsInternal(db, userId, null, query, topK);
}

/**
 * Search only the specified KB IDs (permission still verified).
 */
async function searchSpecificKbs(db, userId, kbIds, query, topK = 6) {
  if (!kbIds || !kbIds.length) return '';
  return searchKbsInternal(db, userId, kbIds, query, topK);
}

async function searchKbsInternal(db, userId, kbIds, query, topK) {
  try {
    // 含完整組織欄位，供 kb_access 比對（使用 kb 舊 grantee_type：dept/profit_center/org_section）
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

    let kbs;
    if (kbIds && kbIds.length) {
      // Specific IDs requested — still filter by permission
      const idPlaceholders = kbIds.map(() => '?').join(',');
      if (user.role === 'admin') {
        kbs = await db.prepare(
          `SELECT id, embedding_dims, retrieval_mode, top_k_return, score_threshold
           FROM knowledge_bases WHERE chunk_count > 0 AND id IN (${idPlaceholders})`
        ).all(...kbIds);
      } else {
        kbs = await db.prepare(`
          SELECT kb.id, kb.embedding_dims, kb.retrieval_mode, kb.top_k_return, kb.score_threshold
          FROM knowledge_bases kb
          WHERE kb.chunk_count > 0 AND kb.id IN (${idPlaceholders}) AND (
            kb.creator_id=?
            OR kb.is_public=1
            OR EXISTS (
              SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
                (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
                OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
                ${orgClause}
              )
            )
          )
        `).all(...kbIds, userId, userId, user.role_id, ...orgBinds);
      }
    } else {
      // All accessible KBs
      if (user.role === 'admin') {
        kbs = await db.prepare(
          `SELECT id, embedding_dims, retrieval_mode, top_k_return, score_threshold
           FROM knowledge_bases WHERE chunk_count > 0 FETCH FIRST 5 ROWS ONLY`
        ).all();
      } else {
        kbs = await db.prepare(`
          SELECT kb.id, kb.embedding_dims, kb.retrieval_mode, kb.top_k_return, kb.score_threshold
          FROM knowledge_bases kb
          WHERE kb.chunk_count > 0 AND (
            kb.creator_id=?
            OR kb.is_public=1
            OR EXISTS (
              SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
                (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
                OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
                ${orgClause}
              )
            )
          )
          FETCH FIRST 5 ROWS ONLY
        `).all(userId, userId, user.role_id, ...orgBinds);
      }
    }

    if (!kbs.length) return '';

    const allResults = [];
    for (const kb of kbs) {
      try {
        const dims    = kb.embedding_dims || 768;
        const qEmb    = await embedText(query, { dims });
        const qVecStr = toVectorStr(qEmb);
        const rows    = await db.prepare(`
          SELECT c.content, c.parent_content, d.filename,
                 VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vector_score
          FROM kb_chunks c
          JOIN kb_documents d ON d.id = c.doc_id
          WHERE c.kb_id=? AND c.chunk_type != 'parent'
          ORDER BY vector_score ASC
          FETCH FIRST ? ROWS ONLY
        `).all(qVecStr, kb.id, topK);

        const threshold = Number(kb.score_threshold) || 0;
        for (const r of rows) {
          const score = 1 - (Number(r.vector_score) || 0);
          if (score >= threshold) {
            allResults.push({ content: r.parent_content || r.content, filename: r.filename, score });
          }
        }
      } catch (e) {
        console.warn(`[Research] KB ${kb.id} search error:`, e.message);
      }
    }

    if (!allResults.length) return '';
    allResults.sort((a, b) => b.score - a.score);
    return allResults
      .slice(0, topK)
      .map((r) => `[來源: ${r.filename}]\n${r.content}`)
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
        `SELECT id, embedding_dims, top_k_return, score_threshold
         FROM knowledge_bases WHERE chunk_count > 0 ORDER BY name FETCH FIRST 20 ROWS ONLY`
      ).all();
    } else {
      kbs = await db.prepare(`
        SELECT kb.id, kb.embedding_dims, kb.top_k_return, kb.score_threshold
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
  const count    = Math.max(2, Math.min(12, depth));
  const prompt   = `你是一位研究規劃專家。使用者想深度研究：\n"${question}"\n\n${langHint}\n請生成一份研究計畫，含 ${count} 個子問題。\n\n回傳 JSON（嚴格格式，不加其他文字）：\n{"title":"研究主題（15字內）","objective":"目標說明（50字內）","language":"${lang}","sub_questions":[{"id":1,"question":"子問題1"},{"id":2,"question":"子問題2"}]}`;

  if (llmClient) {
    const raw  = await llmClient.generate([{ role: 'user', parts: [{ text: prompt }] }]);
    const text = raw.trim().replace(/^```json\s*|^```\s*|```\s*$/gm, '').trim();
    return { plan: JSON.parse(text), inputTokens: 0, outputTokens: 0 };
  }

  // fallback: direct Gemini env
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: MODEL_FLASH,
    generationConfig: { responseMimeType: 'application/json' },
  });
  const result = await model.generateContent(prompt);
  const usage  = result.response.usageMetadata || {};
  return {
    plan: JSON.parse(result.response.text().trim()),
    inputTokens:  usage.promptTokenCount     || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/**
 * Generate a section answer for one sub-question.
 * Supports KB context, Dify context, MCP function calling, web search,
 * global file context, per-SQ file context, and research hints.
 */
async function generateSection(question, kbContext, difyContext, mcpDecls, useWebSearch, language,
  globalFileContext = '', sqFileContext = '', hint = '', dashboardDecls = [],
  db = null, userId = null, modelKey = null, llmClient = null) {
  const genAI = llmClient ? null : new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const isZh = language === 'zh-TW';
  const langHint = isZh ? '請以繁體中文詳細回答。' : 'Please answer in detail in English.';

  const contextParts = [];
  if (globalFileContext) contextParts.push(isZh ? `【研究附件（全局）】\n${globalFileContext}` : `[Research Attachments (Global)]\n${globalFileContext}`);
  if (sqFileContext)     contextParts.push(isZh ? `【本子議題附件】\n${sqFileContext}` : `[Sub-topic Attachments]\n${sqFileContext}`);
  if (kbContext)         contextParts.push(isZh ? `【知識庫參考資料】\n${kbContext}` : `[Knowledge Base References]\n${kbContext}`);
  if (difyContext)       contextParts.push(isZh ? `【Dify知識庫參考資料】\n${difyContext}` : `[Dify KB References]\n${difyContext}`);
  const combinedContext = contextParts.join('\n\n---\n\n');

  const hintPart = hint?.trim()
    ? (isZh ? `\n\n研究方向提示：${hint.trim()}` : `\n\nResearch direction hint: ${hint.trim()}`)
    : '';

  const contextPrefix = combinedContext
    ? (isZh
        ? `以下是參考資料與附件：\n\n${combinedContext}\n\n請根據以上資料並補充您的知識，`
        : `Reference materials and attachments:\n\n${combinedContext}\n\nUsing the above and your knowledge, `)
    : (isZh ? '請' : 'Please ');

  const prompt = `${langHint}\n\n${contextPrefix}${isZh ? '詳細研究並回答以下問題' : 'research and answer in detail'}：\n${question}${hintPart}\n\n${isZh ? '請提供結構化分析，包含具體數據或例子（如果有）。' : 'Provide structured analysis with specific data or examples where available.'}`;

  const tools = [];
  if (useWebSearch && !combinedContext) tools.push({ googleSearch: {} });

  // Merge MCP + AI 戰情 function declarations
  const cleanMcpDecls = mcpDecls.map(({ _serverId: _s, _serverName: _n, ...d }) => d);
  const cleanDashDecls = dashboardDecls.map(({ _designId: _d, ...d }) => d);
  const allFnDecls = [...cleanMcpDecls, ...cleanDashDecls];
  if (allFnDecls.length) tools.push({ functionDeclarations: allFnDecls });

  if (llmClient) {
    const answer = await llmClient.generate([{ role: 'user', parts: [{ text: prompt }] }]);
    return { answer: answer.trim(), inputTokens: 0, outputTokens: 0 };
  }

  const model = genAI.getGenerativeModel({ model: MODEL_PRO });
  let totalIn = 0, totalOut = 0;

  // ── Function calling loop (max 5 turns) ──────────────────────────────────
  const MAX_TURNS = 5;
  let contents = [{ role: 'user', parts: [{ text: prompt }] }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const result = await model.generateContent({ contents, ...(tools.length ? { tools } : {}) });
    const usage = result.response.usageMetadata || {};
    totalIn  += usage.promptTokenCount     || 0;
    totalOut += usage.candidatesTokenCount || 0;

    const candidate = result.response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const fnCalls = parts.filter((p) => p.functionCall);

    if (!fnCalls.length) {
      // No more function calls — extract final text
      const answer = parts.map((p) => p.text || '').join('').trim()
        || result.response.text().trim();
      return { answer, inputTokens: totalIn, outputTokens: totalOut };
    }

    // Execute each function call
    const fnResponses = [];
    for (const part of fnCalls) {
      const { name, args } = part.functionCall;
      let responseText = '';
      try {
        if (name.startsWith('dashboard_') && db && userId) {
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
      fnResponses.push({ functionResponse: { name, response: { result: responseText } } });
    }

    // Append model turn + function responses to conversation
    contents.push({ role: 'model', parts });
    contents.push({ role: 'user', parts: fnResponses });
  }

  // Fallback if loop exhausted without text answer
  return { answer: '（研究生成逾時，請稍後重試）', inputTokens: totalIn, outputTokens: totalOut };
}

/**
 * Synthesize all section answers into a final Markdown report.
 */
async function synthesizeReport(title, sections, language, llmClient = null) {
  const genAI = llmClient ? null : new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const langHint = language === 'zh-TW'
    ? '請以繁體中文撰寫完整研究報告。'
    : 'Please write a complete research report in English.';

  const sectionsText = sections
    .map((s, i) => `### ${i + 1}. ${s.question}\n\n${s.answer}`)
    .join('\n\n---\n\n');

  const prompt = `${langHint}

請根據以下各子問題的研究成果，整合撰寫一份完整的 Markdown 格式研究報告。

研究主題：${title}

各子問題研究內容：
${sectionsText}

要求：
1. 開頭加入「執行摘要」（約 200 字）
2. 各章節對應一個子問題，保留原始研究內容並適當整合
3. 結尾加入「結論與建議」章節
4. 使用清晰的 Markdown 標題與格式`;

  if (llmClient) {
    const report = await llmClient.generate([{ role: 'user', parts: [{ text: prompt }] }]);
    return { report: report.trim(), inputTokens: 0, outputTokens: 0 };
  }

  const model  = genAI.getGenerativeModel({ model: MODEL_PRO });
  const result = await model.generateContent(prompt);
  const usage  = result.response.usageMetadata || {};
  return {
    report:       result.response.text().trim(),
    inputTokens:  usage.promptTokenCount     || 0,
    outputTokens: usage.candidatesTokenCount || 0,
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

// ─── Main Job Runner ──────────────────────────────────────────────────────────

async function runResearchJob(db, jobId) {
  let job;
  let isEn = false;
  try {
    job = await db.prepare('SELECT * FROM research_jobs WHERE id=?').get(jobId);
    if (!job) return;

    // Build LLM client from job's model_key (follows session's chosen model)
    const llmClient = await createClient(db, job.model_key || 'pro').catch(() => null);

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
    const streamingSections = [];  // for real-time preview
    const today         = new Date().toISOString().split('T')[0];
    const tokensByModel = {};
    const addTokens = (modelName, inT, outT) => {
      if (!tokensByModel[modelName]) tokensByModel[modelName] = { in: 0, out: 0 };
      tokensByModel[modelName].in  += (inT  || 0);
      tokensByModel[modelName].out += (outT || 0);
    };

    for (let i = 0; i < subQuestions.length; i++) {
      const sq = subQuestions[i];

      // Resolve bindings: topic > task > (搜全部 KB 僅在完全無 kb_config 時)
      const topicBind    = topicBindings[String(sq.id)] || {};
      const selfKbIds    = topicBind.self_kb_ids?.length   ? topicBind.self_kb_ids
                         : taskBinding.self_kb_ids?.length  ? taskBinding.self_kb_ids
                         : hasKbConfig                       ? []   // 有設定但沒選 → 不引用任何 KB
                         : null;                                    // 完全無設定 → 搜全部 KB
      const difyKbIds    = topicBind.dify_kb_ids?.length  ? topicBind.dify_kb_ids
                         : taskBinding.dify_kb_ids?.length ? taskBinding.dify_kb_ids
                         : [];
      const mcpServerIds = topicBind.mcp_server_ids?.length  ? topicBind.mcp_server_ids
                         : taskBinding.mcp_server_ids?.length ? taskBinding.mcp_server_ids
                         : [];
      const dashboardDesignIds = topicBind.dashboard_design_ids?.length  ? topicBind.dashboard_design_ids
                               : taskBinding.dashboard_design_ids?.length ? taskBinding.dashboard_design_ids
                               : [];

      // Per-SQ web search override
      const sqUseWeb  = sq.use_web_search !== undefined ? Boolean(sq.use_web_search) : useWebSearch;

      // Per-SQ file context
      let sqFileContext = '';
      if (sq.files?.length) {
        try { sqFileContext = await extractFilesContext(sq.files); } catch (_) {}
      }

      // Per-SQ hint
      const hint = sq.hint || '';

      const allKbLabel = isEn ? 'all KB' : '全部KB';
      const fileCount  = (globalFiles.length + (sq.files?.length || 0));
      const sourceLabel = [
        selfKbIds ? `${selfKbIds.length}KB` : allKbLabel,
        difyKbIds.length ? `${difyKbIds.length}Dify` : '',
        mcpServerIds.length ? `${mcpServerIds.length}MCP` : '',
        fileCount ? `${fileCount}${isEn ? ' files' : '個附件'}` : '',
      ].filter(Boolean).join('+');
      const researchingLabel = isEn
        ? `Researching: ${sq.question.slice(0, 60)} (${sourceLabel})`
        : `正在研究：${sq.question.slice(0, 60)}（${sourceLabel}）`;

      // Mark streaming section as in-progress
      streamingSections[i] = { id: sq.id, question: sq.question, answer: '', done: false };
      await db.prepare(
        'UPDATE research_jobs SET progress_step=?, progress_label=?, sections_json=?, updated_at=SYSTIMESTAMP WHERE id=?'
      ).run(i + 1, researchingLabel, JSON.stringify(streamingSections), jobId);

      // ── Self KB search ──────────────────────────────────────────────────────
      let kbContext = '';
      try {
        if (selfKbIds === null) {
          kbContext = await searchUserKbs(db, job.user_id, sq.question);
        } else if (selfKbIds.length) {
          kbContext = await searchSpecificKbs(db, job.user_id, selfKbIds, sq.question);
        }
        // selfKbIds=[] → 使用者沒選任何 KB，kbContext 維持空字串
      } catch (_) {}

      // ── Dify KB query ───────────────────────────────────────────────────────
      let difyContext = '';
      for (const difyId of difyKbIds) {
        try {
          const difyKb = await db.prepare(
            'SELECT * FROM dify_knowledge_bases WHERE id=? AND is_active=1'
          ).get(difyId);
          if (!difyKb) continue;
          const ans = await queryDifyKb(difyKb, sq.question);
          if (ans) difyContext += (difyContext ? '\n\n---\n\n' : '') +
            `[Dify「${difyKb.name}」]\n${ans}`;
        } catch (_) {}
      }

      // ── MCP declarations ────────────────────────────────────────────────────
      let mcpDecls = [];
      try { mcpDecls = await getMcpDeclarations(db, mcpServerIds); } catch (_) {}

      // ── AI 戰情 declarations ─────────────────────────────────────────────────
      let dashboardDecls = [];
      try { dashboardDecls = await getDashboardDeclarations(db, job.user_id, dashboardDesignIds); } catch (_) {}

      const shouldWeb = sqUseWeb && !kbContext && !difyContext && !globalFileContext && !sqFileContext;

      // ── Generate section (retry 3x) ─────────────────────────────────────────
      let answer = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const sec = await generateSection(
            sq.question, kbContext, difyContext, mcpDecls, shouldWeb, language,
            globalFileContext, sqFileContext, hint, dashboardDecls, db, job.user_id, job.model_key, llmClient
          );
          answer = sec.answer;
          addTokens(MODEL_PRO, sec.inputTokens, sec.outputTokens);
          break;
        } catch (e) {
          if (attempt === 2) answer = isEn ? `(Error researching this topic: ${e.message})` : `（研究此問題時發生錯誤：${e.message}）`;
          else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }

      sections.push({ question: sq.question, answer });
      // Update streaming preview
      streamingSections[i] = { id: sq.id, question: sq.question, answer, done: true };
      await db.prepare(
        'UPDATE research_jobs SET sections_json=?, updated_at=SYSTIMESTAMP WHERE id=?'
      ).run(JSON.stringify(streamingSections), jobId);
    }

    // Synthesize
    await db.prepare(
      'UPDATE research_jobs SET progress_label=?, updated_at=SYSTIMESTAMP WHERE id=?'
    ).run(isEn ? 'Synthesizing report...' : '正在整合報告...', jobId);
    const { report, inputTokens: synIn, outputTokens: synOut } = await synthesizeReport(plan.title, sections, language, llmClient);
    addTokens(MODEL_PRO, synIn, synOut);

    // Generate files
    await db.prepare(
      'UPDATE research_jobs SET progress_label=?, updated_at=SYSTIMESTAMP WHERE id=?'
    ).run(isEn ? 'Generating documents...' : '正在生成文件...', jobId);
    const files = await generateOutputFiles(jobId, plan.title, report, sections, job.output_formats || 'docx');

    // Flush token usage
    for (const [modelName, t] of Object.entries(tokensByModel)) {
      await upsertTokenUsage(db, job.user_id, today, modelName, t.in, t.out).catch((e) =>
        console.warn('[Research] upsertTokenUsage error:', e.message)
      );
    }

    // Mark done
    const summary = report.slice(0, 800);
    await db.prepare(`
      UPDATE research_jobs
      SET status='done', progress_step=?, progress_label=?,
          result_summary=?, result_files_json=?,
          completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(total, isEn ? 'Research complete' : '研究完成', summary, JSON.stringify(files), jobId);

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
    const tokensByModel = {};
    const addTokens = (modelName, inT, outT) => {
      if (!tokensByModel[modelName]) tokensByModel[modelName] = { in: 0, out: 0 };
      tokensByModel[modelName].in  += (inT  || 0);
      tokensByModel[modelName].out += (outT || 0);
    };

    let rerunCount = 0;
    for (let i = 0; i < subQuestions.length; i++) {
      const sq = subQuestions[i];
      if (!sectionIdSet.has(String(sq.id))) continue;

      rerunCount++;
      const ov = overrideMap[String(sq.id)] || {};

      // Apply overrides
      const question     = ov.question  || sq.question;
      const hint         = ov.hint      !== undefined ? ov.hint : (sq.hint || '');
      const sqFiles      = ov.files     || sq.files || [];
      const sqUseWeb     = ov.use_web_search !== undefined ? Boolean(ov.use_web_search)
                         : (sq.use_web_search !== undefined ? Boolean(sq.use_web_search) : useWebSearch);

      // If question changed, update in plan
      if (ov.question && ov.question !== sq.question) {
        subQuestions[i] = { ...sq, question };
      }

      // Resolve bindings
      const topicBind    = topicBindings[String(sq.id)] || {};
      const selfKbIds    = topicBind.self_kb_ids?.length   ? topicBind.self_kb_ids
                         : taskBinding.self_kb_ids?.length  ? taskBinding.self_kb_ids
                         : hasKbConfig                       ? []
                         : null;
      const difyKbIds    = topicBind.dify_kb_ids?.length  ? topicBind.dify_kb_ids
                         : taskBinding.dify_kb_ids?.length ? taskBinding.dify_kb_ids
                         : [];
      const mcpServerIds = topicBind.mcp_server_ids?.length  ? topicBind.mcp_server_ids
                         : taskBinding.mcp_server_ids?.length ? taskBinding.mcp_server_ids
                         : [];
      const dashboardDesignIds = topicBind.dashboard_design_ids?.length  ? topicBind.dashboard_design_ids
                               : taskBinding.dashboard_design_ids?.length ? taskBinding.dashboard_design_ids
                               : [];

      let sqFileContext = '';
      if (sqFiles.length) {
        try { sqFileContext = await extractFilesContext(sqFiles); } catch (_) {}
      }

      const researchingLabel = isEn
        ? `Re-researching (${rerunCount}/${total}): ${question.slice(0, 50)}`
        : `重跑中 (${rerunCount}/${total})：${question.slice(0, 50)}`;

      // Update streaming section as in-progress
      const existingIdx = streamingSections.findIndex((s) => String(s.id) === String(sq.id));
      const updated = { id: sq.id, question, answer: '', done: false };
      if (existingIdx >= 0) streamingSections[existingIdx] = updated;
      else streamingSections.push(updated);

      await db.prepare(
        'UPDATE research_jobs SET progress_step=?, progress_label=?, sections_json=?, updated_at=SYSTIMESTAMP WHERE id=?'
      ).run(rerunCount, researchingLabel, JSON.stringify(streamingSections), jobId);

      let kbContext = '';
      try {
        if (selfKbIds === null) {
          kbContext = await searchUserKbs(db, job.user_id, question);
        } else if (selfKbIds.length) {
          kbContext = await searchSpecificKbs(db, job.user_id, selfKbIds, question);
        }
      } catch (_) {}

      let difyContext = '';
      for (const difyId of difyKbIds) {
        try {
          const difyKb = await db.prepare(
            'SELECT * FROM dify_knowledge_bases WHERE id=? AND is_active=1'
          ).get(difyId);
          if (!difyKb) continue;
          const ans = await queryDifyKb(difyKb, question);
          if (ans) difyContext += (difyContext ? '\n\n---\n\n' : '') + `[Dify「${difyKb.name}」]\n${ans}`;
        } catch (_) {}
      }

      let mcpDecls = [];
      try { mcpDecls = await getMcpDeclarations(db, mcpServerIds); } catch (_) {}

      let dashboardDecls = [];
      try { dashboardDecls = await getDashboardDeclarations(db, job.user_id, dashboardDesignIds); } catch (_) {}

      const shouldWeb = sqUseWeb && !kbContext && !difyContext && !globalFileContext && !sqFileContext;

      let answer = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const sec = await generateSection(question, kbContext, difyContext, mcpDecls, shouldWeb,
            language, globalFileContext, sqFileContext, hint, dashboardDecls, db, job.user_id, job.model_key, llmClient);
          answer = sec.answer;
          addTokens(MODEL_PRO, sec.inputTokens, sec.outputTokens);
          break;
        } catch (e) {
          if (attempt === 2) answer = isEn
            ? `(Error: ${e.message})` : `（錯誤：${e.message}）`;
          else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }

      const finIdx = streamingSections.findIndex((s) => String(s.id) === String(sq.id));
      const finSec = { id: sq.id, question, answer, done: true };
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

    const { report, inputTokens: synIn, outputTokens: synOut } = await synthesizeReport(plan.title, allSections, language, llmClient);
    addTokens(MODEL_PRO, synIn, synOut);

    await db.prepare(
      'UPDATE research_jobs SET progress_label=?, updated_at=SYSTIMESTAMP WHERE id=?'
    ).run(isEn ? 'Generating documents...' : '正在生成文件...', jobId);
    const files = await generateOutputFiles(jobId, plan.title, report, allSections, job.output_formats || 'docx');

    for (const [modelName, t] of Object.entries(tokensByModel)) {
      await upsertTokenUsage(db, job.user_id, today, modelName, t.in, t.out).catch(() => {});
    }

    const summary = report.slice(0, 800);
    await db.prepare(`
      UPDATE research_jobs
      SET status='done', progress_step=?, progress_label=?,
          plan_json=?, result_summary=?, result_files_json=?,
          completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(total, isEn ? 'Research complete' : '研究完成',
      JSON.stringify(plan), summary, JSON.stringify(files), jobId);

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

module.exports = { runResearchJob, rerunSections, generatePlan, searchUserKbs, suggestKbs };
