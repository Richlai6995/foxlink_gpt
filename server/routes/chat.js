const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('./auth');
const { streamChat, generateWithImage, generateWithTools, generateWithToolsStream, transcribeAudio, extractTextFromFile, fileToGeminiPart, generateTitle } = require('../services/gemini');
const { streamChatAoai } = require('../services/llmService');
const { processGenerateBlocks } = require('../services/fileGenerator');
const { notifyAdminSensitiveKeyword } = require('../services/mailService');
const { budgetGuard } = require('../middleware/budgetGuard');
const mcpClient = require('../services/mcpClient');
const { classifyUpload, canonicalMimeForKind, TEXT_HARD_CAP_BYTES } = require('../utils/uploadFileTypes');

/**
 * ERP 執行 heartbeat wrapper:長任務每 20 秒送一次狀態 + 經過時間,
 * 防止前端 SSE 閒置斷線,也讓使用者知道還在跑。
 * @param {Function} sendEvent chat.js 的 SSE 送出函式
 * @param {string} toolName 顯示用
 * @param {Promise} execPromise 實際執行的 promise
 */
async function execWithHeartbeat(sendEvent, toolName, execPromise) {
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    try { sendEvent({ type: 'status', message: `查詢 ERP：${toolName}…（已 ${elapsed} 秒）` }); } catch (_) {}
  }, 20000);
  try {
    return await execPromise;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * ERP Answer 模式:用 Flash LLM 快速從使用者訊息中抽取參數值。
 * 只抽需要使用者輸入的 required 參數,回傳 { PARAM_NAME: value }。
 */
async function extractErpParamsWithFlash(db, userMessage, params) {
  const { createClient } = require('../services/llmService');
  const client = await createClient(db, 'flash');

  const paramDesc = params.map(p => {
    const hint = p.ai_hint || p.name;
    const type = p.data_type || 'VARCHAR2';
    return `- ${p.name} (${type}): ${hint}`;
  }).join('\n');

  const prompt = `從以下使用者訊息中提取參數值。只回傳 JSON 物件,不要多餘文字。
如果訊息中找不到某個參數的值,該欄位設為 null。

需要提取的參數:
${paramDesc}

使用者訊息:
${userMessage}

回傳格式範例: {"PARAM1": "value1", "PARAM2": 123}
只回傳 JSON:`;

  const raw = (await client.generate([{ role: 'user', parts: [{ text: prompt }] }]))
    .trim()
    .replace(/^```json\s*|^```\s*|```\s*$/gm, '')
    .trim();

  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[ErpAnswer] Flash returned non-JSON: ${raw.slice(0, 200)}`);
    return {};
  }
}

/**
 * ERP answer 模式:拆解 executor 回傳 JSON 為使用者可讀 Markdown。
 * 不直接丟 JSON,而是拆出 function_return、每個 OUT param 的 cursor/scalar。
 */
function formatErpResultForUser(toolName, result, cacheKey) {
  if (!result) return `**${toolName}**\n\n(無資料)`;
  const lines = [`**${toolName}** 查詢結果\n`];

  if (result.function_return !== undefined && result.function_return !== null) {
    lines.push(`**回傳值：** \`${result.function_return}\`\n`);
  }

  if (result.params) {
    for (const [name, v] of Object.entries(result.params)) {
      if (v && typeof v === 'object' && Array.isArray(v.rows)) {
        const rows = v.rows;
        if (rows.length === 0) {
          lines.push(`**${name}：** (空)\n`);
          continue;
        }
        const cols = Object.keys(rows[0]);
        const header = '| ' + cols.join(' | ') + ' |';
        const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
        const body = rows.slice(0, 100).map(r =>
          '| ' + cols.map(c => {
            const val = r[c];
            if (val === null || val === undefined) return '-';
            const s = String(val);
            return s.length > 60 ? s.slice(0, 57) + '...' : s;
          }).join(' | ') + ' |'
        ).join('\n');
        lines.push(`**${name}** (${v.total_fetched || rows.length} 列${v.truncated ? '，已截斷' : ''})：\n`);
        lines.push(header);
        lines.push(sep);
        lines.push(body);
        if (rows.length > 100) lines.push(`\n_...僅顯示前 100 列_`);
        lines.push('');
      } else if (v === null || v === undefined) {
        lines.push(`**${name}：** -\n`);
      } else if (typeof v === 'string' && v.length > 500) {
        lines.push(`**${name}：**\n\`\`\`\n${v.slice(0, 500)}...\n\`\`\`\n`);
      } else {
        lines.push(`**${name}：** \`${v}\`\n`);
      }
    }
  }

  if (cacheKey) {
    lines.push(`\n_完整結果 cache: \`${cacheKey}\`（30 分鐘內有效）_`);
  }

  return lines.join('\n');
}

// ── Pending TTS map: sessionId → { aiResponse, skill, timestamp } ────────────
// When a post_answer TTS skill returns { pending:true } (no voice pref given),
// we store the AI response here and wait for the user's next message with voice keywords.
const pendingTtsMap = new Map();
// Auto-expire stale entries every 10 minutes
setInterval(() => {
  const tenMin = 10 * 60 * 1000;
  const now = Date.now();
  for (const [sid, entry] of pendingTtsMap) {
    if (now - entry.timestamp > tenMin) pendingTtsMap.delete(sid);
  }
}, 60000);

// ── Tool declaration short-term cache (30s TTL) ─────────────────────────────
const _toolDeclCache = new Map();
const TOOL_CACHE_TTL = 30_000; // 30 seconds

function _toolCacheKey(prefix, ctx) {
  if (!ctx) return `${prefix}:null`;
  if (typeof ctx === 'object') return `${prefix}:${ctx.userId || ''}:${ctx.roleId || ''}:${ctx.deptCode || ''}`;
  return `${prefix}:${ctx}`; // userId for selfKb
}

function getCachedToolDecl(prefix, ctx) {
  const key = _toolCacheKey(prefix, ctx);
  const entry = _toolDeclCache.get(key);
  if (entry && Date.now() - entry.ts < TOOL_CACHE_TTL) return entry.data;
  return null;
}

function setCachedToolDecl(prefix, ctx, data) {
  const key = _toolCacheKey(prefix, ctx);
  _toolDeclCache.set(key, { data, ts: Date.now() });
}

// Evict stale cache entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _toolDeclCache) {
    if (now - v.ts > TOOL_CACHE_TTL * 2) _toolDeclCache.delete(k);
  }
}, 60_000);

// ── Self-Built Knowledge Base — function-calling approach ────────────────────

/** Load accessible self-built KBs for a user and return Gemini function declarations. */
async function getSelfKbDeclarations(db, userId) {
  const cached = getCachedToolDecl('selfkb', userId);
  if (cached) return cached;
  try {
    const user = await db.prepare(
      'SELECT role, dept_code, profit_center, org_section, org_group_name, role_id, factory_code FROM users WHERE id=?'
    ).get(userId);
    if (!user) return { declarations: [], kbMap: {} };

    let kbs;
    if (user.role === 'admin') {
      kbs = await db.prepare(
        `SELECT id, name, description, tags, retrieval_mode, embedding_dims, top_k_return, score_threshold
         FROM knowledge_bases WHERE chunk_count > 0 ORDER BY name ASC`
      ).all();
    } else {
      kbs = await db.prepare(`
        SELECT kb.id, kb.name, kb.description, kb.tags, kb.retrieval_mode, kb.embedding_dims, kb.top_k_return, kb.score_threshold
        FROM knowledge_bases kb
        WHERE kb.chunk_count > 0 AND (
          kb.creator_id=?
          OR kb.is_public=1
          OR EXISTS (
            SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
              (ka.grantee_type='user'         AND ka.grantee_id=TO_CHAR(?))
              OR (ka.grantee_type='role'      AND ka.grantee_id=TO_CHAR(?))
              OR (ka.grantee_type='dept'      AND ka.grantee_id=? AND ? IS NOT NULL)
              OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
              OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
              OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
              OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
            )
          )
        )
        ORDER BY kb.name ASC
      `).all(
        userId,
        userId, user.role_id,
        user.dept_code, user.dept_code,
        user.profit_center, user.profit_center,
        user.org_section, user.org_section,
        user.factory_code, user.factory_code,
        user.org_group_name, user.org_group_name,
      );
    }

    const declarations = [];
    const kbMap = {};
    for (const kb of kbs) {
      const safeName = `selfkb_${kb.id.replace(/-/g, '_')}`;
      const scopeText = kb.description ? `適用範疇：${kb.description}` : `企業自建知識庫「${kb.name}」`;
      declarations.push({
        name: safeName,
        description: `自建知識庫查詢「${kb.name}」。${scopeText}。呼叫規則：(1) 使用者問題核心意圖必須明確屬於上述範疇才呼叫；(2) 每次對話此工具只呼叫一次，已呼叫後不得重複呼叫。`,
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '要查詢的問題' } },
          required: ['query'],
        },
      });
      kbMap[safeName] = kb;
    }
    const result = { declarations, kbMap };
    setCachedToolDecl('selfkb', userId, result);
    return result;
  } catch (e) {
    console.warn('[SelfKB] Failed to load KBs:', e.message);
    return { declarations: [], kbMap: {} };
  }
}

/** Execute a search against a self-built KB and return formatted result text. */
async function executeSelfKbSearch(db, kb, query, { userId, sessionId } = {}) {
  const t0 = Date.now();
  try {
    const { embedText, toVectorStr } = require('../services/kbEmbedding');
    const mode   = kb.retrieval_mode || 'hybrid';
    const topK   = Math.min(Number(kb.top_k_return) || 5, 20);
    const dims   = kb.embedding_dims || 768;
    const thresh = Number(kb.score_threshold) || 0;

    let results = [];

    if (mode === 'vector' || mode === 'hybrid') {
      const qEmb    = await embedText(query, { dims });
      const qVecStr = toVectorStr(qEmb);
      const fetchK  = Math.min(topK * 3, 60);
      const rows = await db.prepare(`
        SELECT c.id, c.content, c.parent_content, d.filename,
               VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vector_score
        FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
        WHERE c.kb_id=? AND c.chunk_type != 'parent'
        ORDER BY vector_score ASC FETCH FIRST ? ROWS ONLY
      `).all(qVecStr, kb.id, fetchK);
      results = rows.map((r) => ({ ...r, score: 1 - (r.vector_score || 0), match_type: 'vector' }));
    }

    if (mode === 'fulltext' || mode === 'hybrid') {
      const likeQ = `%${query.replace(/[%_]/g, '\\$&')}%`;
      const ftRows = await db.prepare(`
        SELECT c.id, c.content, c.parent_content, d.filename, 1 AS vector_score
        FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
        WHERE c.kb_id=? AND c.chunk_type != 'parent' AND UPPER(c.content) LIKE UPPER(?)
        FETCH FIRST ? ROWS ONLY
      `).all(kb.id, likeQ, topK * 2);

      if (mode === 'fulltext') {
        results = ftRows.map((r) => ({ ...r, score: 0.5, match_type: 'fulltext' }));
      } else {
        const vecIds = new Set(results.map((r) => r.id));
        for (const r of ftRows) {
          if (vecIds.has(r.id)) {
            const ex = results.find((x) => x.id === r.id);
            if (ex) { ex.score = Math.min(1, ex.score + 0.15); ex.match_type = 'hybrid'; }
          } else {
            results.push({ ...r, score: 0.4, match_type: 'fulltext' });
          }
        }
      }
    }

    results = results.filter((r) => r.score >= thresh).sort((a, b) => b.score - a.score);

    // ── Rerank ────────────────────────────────────────────────────────────
    try {
      const rerankKey = kb.rerank_model;
      const rerankRow = rerankKey
        ? await db.prepare(`SELECT api_model, extra_config_enc FROM llm_models WHERE key=? AND model_role='rerank' AND is_active=1`).get(rerankKey)
        : await db.prepare(`SELECT api_model, extra_config_enc FROM llm_models WHERE model_role='rerank' AND is_active=1 AND ROWNUM=1`).get();

      if (rerankRow?.extra_config_enc && results.length > 1) {
        const { decryptKey } = require('../services/llmKeyService');
        const creds = JSON.parse(decryptKey(rerankRow.extra_config_enc));
        const { rerankOci } = require('../services/ociAi');
        const docs = results.map((r) => r.content || '');
        const rerankResp = await rerankOci(creds, rerankRow.api_model, query, docs, results.length);
        const ranked = rerankResp?.results || rerankResp?.rankings || [];
        if (ranked.length > 0) {
          results = ranked.map((item) => {
            const orig = results[item.index ?? item.resultIndex ?? 0];
            return { ...orig, rerank_score: item.relevanceScore ?? item.score ?? 0 };
          }).sort((a, b) => b.rerank_score - a.rerank_score);
          console.log(`[SelfKB] Rerank applied for KB "${kb.name}"`);
        }
      }
    } catch (e) {
      console.warn(`[SelfKB] Rerank skipped for KB "${kb.name}":`, e.message);
    }

    results = results.slice(0, topK);

    const elapsed = Date.now() - t0;
    console.log(`[SelfKB] KB "${kb.name}" search done in ${elapsed}ms, results=${results.length}`);

    // Log to kb_retrieval_tests with source='chat'
    if (userId) {
      try {
        const { v4: uuid } = require('uuid');
        await db.prepare(`
          INSERT INTO kb_retrieval_tests (id, kb_id, user_id, query_text, retrieval_mode, top_k, elapsed_ms, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'chat')
        `).run(uuid(), kb.id, userId, query.slice(0, 500), kb.retrieval_mode || 'hybrid', topK, elapsed);
      } catch (_) {}
    }

    if (results.length === 0) return `[知識庫「${kb.name}」未找到相關內容]`;

    const chunks = results.map((r, i) => {
      const displayScore = r.rerank_score != null ? r.rerank_score.toFixed(3) : `${(r.score * 100).toFixed(0)}%`;
      const context = r.parent_content ? `上下文：${r.parent_content.slice(0, 300)}\n\n片段：` : '';
      return `[${i + 1}] 來源: ${r.filename} (相關度 ${displayScore})\n${context}${r.content}`;
    });
    return `【來自知識庫「${kb.name}」的相關內容】\n\n${chunks.join('\n\n---\n\n')}`;
  } catch (e) {
    console.error(`[SelfKB] Search failed for KB "${kb.name}":`, e.message);
    return `[知識庫「${kb.name}」查詢失敗: ${e.message}]`;
  }
}

// ── DIFY Knowledge Base — function-calling approach ──────────────────────────
// Per-session conversation_id cache: Map<sessionId, Map<kbId, conversationId>>
const difyConvIds = new Map();

function getDifyConvId(sessionId, kbId) {
  return difyConvIds.get(sessionId)?.get(kbId) || '';
}
function setDifyConvId(sessionId, kbId, conversationId) {
  if (!conversationId) return;
  if (!difyConvIds.has(sessionId)) difyConvIds.set(sessionId, new Map());
  difyConvIds.get(sessionId).set(kbId, conversationId);
}

// Load active API connectors (DIFY + REST API) for a user (dify_access-filtered)
// and return as Gemini function declarations
async function getDifyFunctionDeclarations(db, userCtx) {
  const cached = getCachedToolDecl('dify', userCtx);
  if (cached) return cached;
  const { buildFunctionDeclaration } = require('../services/apiConnectorService');
  let kbs;
  try {
    const connectorCols = `d.id, d.name, d.api_server, d.api_key, d.description, d.tags, d.sort_order,
      d.connector_type, d.http_method, d.content_type,
      d.auth_type, d.auth_header_name, d.auth_query_param_name, d.auth_config,
      d.request_headers, d.request_body_template, d.input_params,
      d.response_type, d.response_extract, d.response_template, d.empty_message, d.error_mapping,
      d.email_domain_fallback`;

    if (!userCtx) {
      kbs = await db.prepare(
        `SELECT ${connectorCols} FROM dify_knowledge_bases d WHERE d.is_active=1 ORDER BY d.sort_order ASC`
      ).all();
    } else {
      const { userId, roleId, deptCode, profitCenter, orgSection, orgGroupName, factoryCode } = userCtx;
      kbs = await db.prepare(
        `SELECT DISTINCT ${connectorCols}
         FROM dify_knowledge_bases d
         WHERE d.is_active=1 AND (
           (d.is_public=1 AND d.public_approved=1)
           OR EXISTS (
             SELECT 1 FROM dify_access a WHERE a.dify_kb_id = d.id AND (
               (a.grantee_type='user'        AND a.grantee_id=TO_CHAR(?))
               OR (a.grantee_type='role'     AND a.grantee_id=TO_CHAR(?) AND ? IS NOT NULL)
               OR (a.grantee_type='department'  AND a.grantee_id=? AND ? IS NOT NULL)
               OR (a.grantee_type='cost_center' AND a.grantee_id=? AND ? IS NOT NULL)
               OR (a.grantee_type='division'    AND a.grantee_id=? AND ? IS NOT NULL)
               OR (a.grantee_type='factory'     AND a.grantee_id=? AND ? IS NOT NULL)
               OR (a.grantee_type='org_group'   AND a.grantee_id=? AND ? IS NOT NULL)
             )
           )
         )
         ORDER BY d.sort_order ASC`
      ).all(
        userId,
        roleId, roleId,
        deptCode, deptCode,
        profitCenter, profitCenter,
        orgSection, orgSection,
        factoryCode, factoryCode,
        orgGroupName, orgGroupName
      );
    }
  } catch (e) {
    console.error('[API] getDifyFunctionDeclarations error:', e.message);
    return { declarations: [], kbMap: {} };
  }

  const declarations = [];
  const kbMap = {};

  for (const kb of kbs) {
    const decl = buildFunctionDeclaration(kb);
    declarations.push(decl);
    kbMap[decl.name] = kb;
  }

  const result = { declarations, kbMap };
  setCachedToolDecl('dify', userCtx, result);
  return result;
}

// Pre-filter DIFY declarations by intent using a quick Flash classification call.
// Removes irrelevant KBs BEFORE the main LLM sees them — most reliable guard.
async function filterDifyDeclsByIntent(userMessage, difyDecls, recentContext = '', { db, userId } = {}) {
  if (difyDecls.length === 0) return [];
  const { generateTextSync, MODEL_FLASH } = require('../services/gemini');
  const toolList = difyDecls
    .map(d => `工具名稱: ${d.name}\n適用描述: ${d.description.slice(0, 400)}`)
    .join('\n---\n');
  const contextSection = recentContext
    ? `\n【最近對話紀錄（供上下文參考）】\n${recentContext}\n`
    : '';
  const prompt = `你是工具呼叫意圖分類器，只需判斷哪些知識庫工具應被呼叫，不需要回答問題本身。

【工具清單】
${toolList}
${contextSection}
【使用者當前訊息】
「${userMessage}」

【判斷規則（嚴格執行）】
- 使用者問題的核心意圖必須完全符合工具的「適用描述」才能選用
- 若當前訊息是對上一輪 AI 問題的跟進回答（如選擇廠區、補充資訊），且上一輪對話顯示已使用某工具，應繼續使用同一工具
- 問題包含相同關鍵字但核心目的不同時，絕對不選用
  - 範例：詢問「誰開發了某程式」≠ 詢問「模組負責人是誰」
  - 範例：查詢DB資料、技術問題 ≠ 查詢人員組織資訊
- **問題詢問的是外部公開資訊（如政府法規、國際政策、時事新聞、市場行情等），而非企業內部資料時，一律不選用任何知識庫工具**
- 不確定時，不選用

請只回覆純 JSON，不要有其他文字，格式：{"call":["工具名稱"]} 或 {"call":[]}`;

  try {
    const { text, inputTokens: iT, outputTokens: oT } = await generateTextSync(MODEL_FLASH, [], prompt);
    if ((iT || oT) && db && userId) {
      const today = new Date().toISOString().split('T')[0];
      upsertTokenUsage(db, userId, today, MODEL_FLASH, iT, oT).catch(() => {});
    }
    const m = text.match(/\{[\s\S]*?"call"\s*:\s*\[[\s\S]*?\]\s*\}/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    const callSet = new Set(parsed.call || []);
    const filtered = difyDecls.filter(d => callSet.has(d.name));
    console.log(`[API Intent] "${userMessage.slice(0, 60)}" → [${filtered.map(d => d.name).join(',') || 'none'}]`);
    return filtered;
  } catch (e) {
    console.warn('[API Intent] Classification failed, skipping all API connectors:', e.message);
    return [];
  }
}

// Pre-filter MCP tool declarations by intent — prevents irrelevant tools from being called.
// Falls back to passing ALL tools if classification fails (safe fallback).
async function filterMcpDeclsByIntent(userMessage, mcpDecls, recentContext = '', { db, userId } = {}) {
  if (mcpDecls.length === 0) return [];
  const { generateTextSync, MODEL_FLASH } = require('../services/gemini');
  const toolList = mcpDecls
    .map(d => `工具名稱: ${d.name}\n描述: ${(d.description || '').slice(0, 400)}`)
    .join('\n---\n');
  const contextSection = recentContext
    ? `\n【最近對話紀錄（供上下文參考）】\n${recentContext}\n`
    : '';
  const prompt = `你是工具呼叫意圖分類器，只需判斷哪些 MCP 工具應被呼叫，不需要回答問題本身。

【工具清單】
${toolList}
${contextSection}
【使用者當前訊息】
「${userMessage}」

【判斷規則（嚴格執行）】
- 只有使用者的問題明確需要透過外部工具查詢/操作才能回答時，才選用對應工具
- 一般知識問題、聊天、寫作、分析、摘要等不需要外部工具的問題，一律不選任何工具
- 不確定是否需要工具時，不選用

請只回覆純 JSON，不要有其他文字，格式：{"call":["工具名稱"]} 或 {"call":[]}`;

  try {
    const { text, inputTokens: iT, outputTokens: oT } = await generateTextSync(MODEL_FLASH, [], prompt);
    if ((iT || oT) && db && userId) {
      const today = new Date().toISOString().split('T')[0];
      upsertTokenUsage(db, userId, today, MODEL_FLASH, iT, oT).catch(() => {});
    }
    const m = text.match(/\{[\s\S]*?"call"\s*:\s*\[[\s\S]*?\]\s*\}/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    const callSet = new Set(parsed.call || []);
    const filtered = mcpDecls.filter(d => callSet.has(d.name));
    console.log(`[MCP Intent] "${userMessage.slice(0, 60)}" → [${filtered.map(d => d.name).join(',') || 'none'}]`);
    return filtered;
  } catch (e) {
    console.warn('[MCP Intent] Classification failed, passing all MCP tools:', e.message);
    return mcpDecls; // fallback: pass all tools so functionality isn't broken
  }
}

// Execute a single API connector query (DIFY or REST API)
// This is a thin wrapper that delegates to apiConnectorService.executeConnector
async function executeDifyQuery(db, kb, query, sessionId, userId, reqUser, extraArgs = {}) {
  const { executeConnector } = require('../services/apiConnectorService');
  // Build user context for system parameter resolution
  const apiUserCtx = {
    id: userId,
    email: reqUser?.email || '',
    name: reqUser?.name || '',
    employee_id: reqUser?.employee_id || '',
    dept_code: reqUser?.dept_code || '',
    title: reqUser?.title || '',
  };
  // 合併 query + AI function calling 回傳的其他參數（如 days, keyword 等）
  const aiArgs = { query, ...extraArgs };
  return await executeConnector(kb, aiArgs, apiUserCtx, {
    sessionId,
    db,
    getDifyConvId,
    setDifyConvId,
  });
}

// ── Explicit KB bypass detection ─────────────────────────────────────────────
/**
 * Returns true if the user explicitly requests to skip KB and use LLM directly.
 */
function userWantsSkipKb(text) {
  return /不要.{0,8}(用|查|參考|使用).{0,8}知識庫|忽略知識庫|跳過知識庫|直接(用你|根據你).{0,10}(自己|本身).{0,5}知識|不(需要|用).{0,5}查(詢|找)|用你.{0,5}(本身能力|自己回答)/.test(text);
}

// ── Post-retrieval KB relevance check ────────────────────────────────────────
/**
 * Uses Flash to judge whether KB results actually answer the user's question.
 * Returns true  → KB data is relevant, use it (and disable Google Search to prevent pollution).
 * Returns false → KB data is NOT relevant, discard it and fall back to LLM + Google Search.
 * On failure defaults to true (safe: don't silently drop KB data).
 */
async function checkKbRelevance(userMessage, kbContext, { db, userId } = {}) {
  const { generateTextSync, MODEL_FLASH } = require('../services/gemini');
  const prompt = `你是知識庫相關性判斷器，只需判斷 true 或 false，不需要回答問題本身。

【使用者問題】
「${userMessage.slice(0, 400)}」

【知識庫返回的資料（部分）】
${kbContext.slice(0, 2500)}

【判斷規則：預設為 true，只有以下兩種情況才回 false】
1. 知識庫資料明確回覆「找不到」「無相關內容」「缺乏資料」，且沒有任何實際內容
2. 問題明確詢問外部公開知識（政府政策更新、國際法規、股市行情、時事新聞、各國貿易規則），而知識庫資料明顯是企業內部文件（操作手冊、流程說明、人員聯絡資訊等）——兩者同時成立才為 false

其他一律回 {"relevant": true}，包括：
- 知識庫有部分相關資料（如人名、聯絡方式、片段流程）
- 不確定是否完全回答問題
- 資料量少但有相關性

請只回覆純 JSON，不要有其他文字：{"relevant": true} 或 {"relevant": false}`;

  try {
    const { text, inputTokens: iT, outputTokens: oT } = await generateTextSync(MODEL_FLASH, [], prompt);
    if ((iT || oT) && db && userId) {
      const today = new Date().toISOString().split('T')[0];
      upsertTokenUsage(db, userId, today, MODEL_FLASH, iT, oT).catch(() => {});
    }
    const m = text.match(/\{[\s\S]*?"relevant"\s*:\s*(true|false)[\s\S]*?\}/);
    if (!m) { console.warn('[KBRelevance] Unexpected response:', text.slice(0, 100)); return true; }
    const result = !!JSON.parse(m[0]).relevant;
    console.log(`[KBRelevance] "${userMessage.slice(0, 60)}" → ${result ? 'RELEVANT ✓' : 'NOT_RELEVANT ✗'}`);
    return result;
  } catch (e) {
    console.warn('[KBRelevance] check failed, assuming relevant:', e.message);
    return true; // safe fallback: don't silently discard KB data
  }
}

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const upload = multer({
  dest: path.join(UPLOAD_DIR, 'tmp'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB ceiling; per-user limits enforced below
  fileFilter: (req, file, cb) => {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const c = classifyUpload(name, file.mimetype);
    if (!c.ok) {
      return cb(new Error(c.reason || '不支援的檔案格式'), false);
    }
    cb(null, true);
  },
});

router.use(verifyToken);

// Resolve API model info from DB (with env fallback)
// Returns { apiModel, imageOutput, providerType, modelRow }
async function resolveApiModel(db, modelKey) {
  try {
    const row = await db.prepare(
      `SELECT api_model, image_output, provider_type, api_key_enc,
              endpoint_url, api_version, deployment_name, base_model, key,
              generation_config
       FROM llm_models WHERE key=? AND is_active=1`
    ).get(modelKey);
    if (row?.api_model) {
      // Parse generation_config CLOB → object
      let genConfig = null;
      try { genConfig = row.generation_config ? JSON.parse(row.generation_config) : null; } catch (_) {}
      row._genConfig = genConfig;
      return {
        apiModel:     row.api_model,
        imageOutput:  !!row.image_output,
        providerType: row.provider_type || 'gemini',
        modelRow:     row,
      };
    }
  } catch (e) { }
  if (modelKey === 'flash') return { apiModel: process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',   imageOutput: false, providerType: 'gemini', modelRow: null };
  if (modelKey === 'pro')   return { apiModel: process.env.GEMINI_MODEL_PRO   || 'gemini-1.5-pro',     imageOutput: false, providerType: 'gemini', modelRow: null };
  return { apiModel: modelKey, imageOutput: false, providerType: 'gemini', modelRow: null };
}

// GET /api/chat/models — active models for frontend selector
router.get('/models', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const models = await db.prepare(
      "SELECT key, name, api_model, description, image_output, provider_type, deployment_name FROM llm_models WHERE is_active=1 AND (model_role IS NULL OR model_role='chat') ORDER BY sort_order ASC, id ASC"
    ).all();
    if (models.length) return res.json(models);
    // Fallback if table empty
    res.json([
      { key: 'pro', name: 'Gemini Pro', api_model: process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview', description: '強大、深度分析', image_output: 0 },
      { key: 'flash', name: 'Gemini Flash', api_model: process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview', description: '快速、輕量回應', image_output: 0 },
    ]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/budget — returns effective limits + today/week/month spent for current user
router.get('/budget', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const budgetRow = await db.prepare(
      `SELECT u.budget_daily, u.budget_weekly, u.budget_monthly,
              u.quota_exceed_action AS user_action,
              r.budget_daily AS role_daily, r.budget_weekly AS role_weekly, r.budget_monthly AS role_monthly,
              r.quota_exceed_action AS role_action
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    ).get(req.user.id);

    const limitD = budgetRow?.budget_daily ?? budgetRow?.role_daily ?? null;
    const limitW = budgetRow?.budget_weekly ?? budgetRow?.role_weekly ?? null;
    const limitM = budgetRow?.budget_monthly ?? budgetRow?.role_monthly ?? null;
    const exceedAction = budgetRow?.user_action || budgetRow?.role_action || 'block';

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const getSpent = async (sql, ...params) => {
      const row = await db.prepare(sql).get(...params);
      const total = row?.total || 0;
      const images = row?.images || 0;
      return total > 0 ? total : images * 0.04;
    };

    const D = `TO_DATE(?, 'YYYY-MM-DD')`;
    const spentD = await getSpent(
      `SELECT COALESCE(SUM(cost),0) AS total, COALESCE(SUM(image_count),0) AS images FROM token_usage WHERE user_id=? AND usage_date=${D}`,
      req.user.id, todayStr
    );

    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow));
    const mondayStr = monday.toISOString().slice(0, 10);
    const spentW = await getSpent(
      `SELECT COALESCE(SUM(cost),0) AS total, COALESCE(SUM(image_count),0) AS images FROM token_usage WHERE user_id=? AND usage_date>=${D} AND usage_date<=${D}`,
      req.user.id, mondayStr, todayStr
    );

    const firstOfMonth = `${todayStr.slice(0, 7)}-01`;
    const spentM = await getSpent(
      `SELECT COALESCE(SUM(cost),0) AS total, COALESCE(SUM(image_count),0) AS images FROM token_usage WHERE user_id=? AND usage_date>=${D} AND usage_date<=${D}`,
      req.user.id, firstOfMonth, todayStr
    );

    res.json({
      isAdmin: req.user.role === 'admin',
      quota_exceed_action: exceedAction,
      daily: limitD != null ? { limit: limitD, spent: spentD, remaining: Math.max(0, limitD - spentD), exceeded: spentD >= limitD } : null,
      weekly: limitW != null ? { limit: limitW, spent: spentW, remaining: Math.max(0, limitW - spentW), exceeded: spentW >= limitW } : null,
      monthly: limitM != null ? { limit: limitM, spent: spentM, remaining: Math.max(0, limitM - spentM), exceeded: spentM >= limitM } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/sessions
router.get('/sessions', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const sessions = await db
      .prepare(
        `SELECT id, title, title_zh, title_en, title_vi, model, created_at, updated_at
         FROM chat_sessions
         WHERE user_id = ? AND (source IS NULL OR source != 'scheduled')
           AND EXISTS (SELECT 1 FROM chat_messages WHERE session_id = chat_sessions.id)
         ORDER BY updated_at DESC`
      )
      .all(req.user.id);
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/chat/sessions
router.post('/sessions', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const id = uuidv4();
    const model = req.body.model || 'pro';
    const title = req.body.title || '新對話';
    await db.prepare(
      `INSERT INTO chat_sessions (id, user_id, title, model) VALUES (?, ?, ?, ?)`
    ).run(id, req.user.id, title, model);
    res.json({ id, title, model });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/sessions/:id
router.get('/sessions/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const session = await db
      .prepare(`SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: '找不到對話' });

    const messages = await db
      .prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`)
      .all(req.params.id);

    messages.forEach((m) => {
      if (m.files_json) {
        try {
          const parsed = JSON.parse(m.files_json);
          if (m.role === 'assistant') {
            // New format: { generated: [...], historyParts: [...] }
            // Old format: [ {...}, ... ]
            m.generated_files = parsed?.generated ?? (Array.isArray(parsed) ? parsed : []);
          } else {
            m.files = parsed;            // uploaded file metadata
          }
        } catch (e) { }
      }
    });

    // Include attached skills
    const skills = await db.prepare(`
      SELECT s.id, s.name, s.icon, s.type, s.description, s.model_key, ss.sort_order
      FROM session_skills ss JOIN skills s ON s.id = ss.skill_id
      WHERE ss.session_id = ? ORDER BY ss.sort_order ASC
    `).all(req.params.id);

    // Restore tool selections from stored context (primary) + call logs (fallback)
    let usedMcpIds = [], usedDifyIds = [], usedKbIds = [], usedErpIds = [];
    if (session.tools_context_json) {
      try {
        const ctx = JSON.parse(session.tools_context_json);
        usedMcpIds  = (ctx.mcp  || []).map(Number);
        usedDifyIds = (ctx.dify || []).map(Number);
        usedKbIds   = ctx.kb    || [];
        usedErpIds  = (ctx.erp  || []).map(Number);
      } catch {}
    }
    // Fallback: if tools_context_json was empty, try call logs
    if (!usedMcpIds.length) {
      const raw = await db.prepare(`SELECT DISTINCT server_id FROM mcp_call_logs WHERE session_id=?`).all(req.params.id).catch(() => []);
      usedMcpIds = raw.map(r => Number(r.server_id));
    }
    if (!usedDifyIds.length) {
      const raw = await db.prepare(`SELECT DISTINCT kb_id FROM dify_call_logs WHERE session_id=?`).all(req.params.id).catch(() => []);
      usedDifyIds = raw.map(r => Number(r.kb_id));
    }

    res.json({ session, messages, skills,
      used_mcp_ids: usedMcpIds, used_dify_ids: usedDifyIds, used_kb_ids: usedKbIds,
      used_erp_tool_ids: usedErpIds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/chat/sessions/:id/title — 手動改名，自動翻譯成 zh/en/vi
router.patch('/sessions/:id/title', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { title } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: '標題不可空白' });
    const session = await db.prepare('SELECT id FROM chat_sessions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: '找不到對話' });

    const newTitle = title.trim().slice(0, 100);
    let titleZh = newTitle, titleEn = newTitle, titleVi = newTitle;

    try {
      const { generateTextSync, MODEL_FLASH } = require('../services/gemini');
      const prompt = `請將以下對話標題翻譯成繁體中文、英文、越南文，以 JSON 回覆。\n標題：「${newTitle}」\n格式：{"zh":"...","en":"...","vi":"..."}`;
      const { text } = await generateTextSync(MODEL_FLASH, [], prompt);
      const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] || '{}');
      if (parsed.zh) titleZh = parsed.zh;
      if (parsed.en) titleEn = parsed.en;
      if (parsed.vi) titleVi = parsed.vi;
    } catch (_) { /* 翻譯失敗時維持原標題 */ }

    await db.prepare('UPDATE chat_sessions SET title=?, title_zh=?, title_en=?, title_vi=?, updated_at=SYSTIMESTAMP WHERE id=?')
      .run(newTitle, titleZh, titleEn, titleVi, req.params.id);
    res.json({ success: true, title: newTitle, title_zh: titleZh, title_en: titleEn, title_vi: titleVi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/chat/sessions/:id/skills — 更新 session 掛載的 skills（array of skill ids）
router.put('/sessions/:id/skills', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const session = await db.prepare('SELECT id FROM chat_sessions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: '找不到對話' });
    const skillIds = Array.isArray(req.body.skill_ids) ? req.body.skill_ids : [];
    const skillVariables = req.body.skill_variables || {};
    await db.prepare('DELETE FROM session_skills WHERE session_id=?').run(req.params.id);
    for (const [idx, id] of skillIds.entries()) {
      await db.prepare('INSERT INTO session_skills (session_id, skill_id, sort_order) VALUES (?,?,?)').run(req.params.id, id, idx);
    }
    // Update variables_json for skills that have prompt_variables
    for (const [skillId, vars] of Object.entries(skillVariables)) {
      await db.prepare('UPDATE session_skills SET variables_json=? WHERE session_id=? AND skill_id=?')
        .run(JSON.stringify(vars), req.params.id, skillId);
    }
    res.json({ success: true, skill_ids: skillIds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/chat/sessions/:id
router.delete('/sessions/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const session = await db
      .prepare(`SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: '找不到對話' });

    await db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(req.params.id);
    await db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/chat/sessions/:id/messages  (SSE streaming)
const CHAT_MAX_FILES_PER_MESSAGE = parseInt(process.env.CHAT_MAX_FILES_PER_MESSAGE || '10', 10);
// Wrap multer to return JSON on upload rejection (fileFilter errors, size limits, etc.).
// Without this, Express default handler returns HTML 500 → frontend JSON.parse fails.
const uploadChatFiles = (req, res, next) => {
  upload.array('files', CHAT_MAX_FILES_PER_MESSAGE)(req, res, (err) => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413
                 : err.code === 'LIMIT_FILE_COUNT' ? 413
                 : 400;
    return res.status(status).json({ error: err.message || '檔案上傳失敗' });
  });
};
router.post('/sessions/:id/messages', uploadChatFiles, budgetGuard, async (req, res) => {
  const db = require('../database-oracle').db;
  const sessionId = req.params.id;

  // Verify session ownership
  const session = await db
    .prepare(`SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?`)
    .get(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: '找不到對話' });
  }

  const { message = '', model, reasoning_effort: userReasoningEffort } = req.body;

  // Explicit tool selection sent by the UI (JSON arrays or undefined)
  // When present (even as '[]'), skip auto-discovery + intent filtering for that category.
  function parseIds(raw) {
    if (raw === undefined || raw === null) return null;
    try {
      const v = JSON.parse(raw);
      // Empty array → null so auto TAG routing kicks in instead of explicit mode
      if (!Array.isArray(v) || v.length === 0) return null;
      return v;
    } catch { return null; }
  }
  const userMcpIds   = parseIds(req.body.mcp_server_ids);  // number[] | null
  const userDifyIds  = parseIds(req.body.dify_kb_ids);      // number[] | null
  const userSelfKbIds = parseIds(req.body.self_kb_ids);     // string[] | null
  const userErpToolIds = parseIds(req.body.erp_tool_ids);   // number[] | null
  const explicitMode = userMcpIds !== null || userDifyIds !== null || userSelfKbIds !== null || userErpToolIds !== null;
  // 儲存工具選擇到 session（供歷史載入時恢復）
  if (explicitMode) {
    try {
      const ctx = JSON.stringify({ mcp: userMcpIds || [], dify: userDifyIds || [], kb: userSelfKbIds || [], erp: userErpToolIds || [] });
      await require('../database-oracle').db.prepare(
        `UPDATE chat_sessions SET tools_context_json=? WHERE id=?`
      ).run(ctx, sessionId);
    } catch (_) {}
  }
  const uploadedFiles = req.files || [];

  // Load per-user upload permissions
  const userPerms = await db.prepare(
    `SELECT allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
            allow_image_upload, image_max_mb FROM users WHERE id = ?`
  ).get(req.user.id) || { allow_text_upload: 1, text_max_mb: 10, allow_audio_upload: 0, audio_max_mb: 10, allow_image_upload: 1, image_max_mb: 10 };

  // Validate files against user permissions before starting SSE
  const isAudioMime = (m) => m.startsWith('audio/');
  const isImageMime = (m) => m.startsWith('image/');
  const isTextFile = (m) => !isImageMime(m) && !isAudioMime(m);

  for (const file of uploadedFiles) {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // Normalize empty / octet-stream mime to a canonical value so downstream
    // mime-based branching (image inline / audio transcribe / PDF inline /
    // Office extractor) works even when the browser didn't set mime properly.
    // fileFilter already validated via classifyUpload; we just align mime here.
    if (!file.mimetype || file.mimetype === 'application/octet-stream') {
      const canonical = canonicalMimeForKind(classifyUpload(originalName, file.mimetype));
      if (canonical) file.mimetype = canonical;
    }
    const mimeType = file.mimetype;

    if (isAudioMime(mimeType)) {
      if (!userPerms.allow_audio_upload) {
        fs.unlinkSync(file.path);
        return res.status(403).json({ error: `無聲音檔上傳權限，請聯絡管理員開啟。(${originalName})` });
      }
      const maxBytes = (userPerms.audio_max_mb || 10) * 1024 * 1024;
      if (file.size > maxBytes) {
        fs.unlinkSync(file.path);
        return res.status(413).json({ error: `聲音檔超過上限 ${userPerms.audio_max_mb || 10}MB。(${originalName})` });
      }
    } else if (isImageMime(mimeType)) {
      if (userPerms.allow_image_upload === 0) {
        fs.unlinkSync(file.path);
        return res.status(403).json({ error: `無圖片上傳權限，請聯絡管理員開啟。(${originalName})` });
      }
      const maxBytes = (userPerms.image_max_mb || 10) * 1024 * 1024;
      if (file.size > maxBytes) {
        fs.unlinkSync(file.path);
        return res.status(413).json({ error: `圖片檔超過上限 ${userPerms.image_max_mb || 10}MB。(${originalName})` });
      }
    } else if (isTextFile(mimeType)) {
      if (!userPerms.allow_text_upload) {
        fs.unlinkSync(file.path);
        return res.status(403).json({ error: `無文字檔上傳權限，請聯絡管理員開啟。(${originalName})` });
      }
      const userMax = (userPerms.text_max_mb || 10) * 1024 * 1024;
      // Hard 5MB cap only for newly-supported code/config/log/special types;
      // PDF / Office / plain doc keep user's text_max_mb (backward compat).
      const cls = classifyUpload(originalName, mimeType);
      const applyHardCap = cls.ok && cls.kind === 'text' && cls.subtype && cls.subtype !== 'doc';
      const maxBytes = applyHardCap ? Math.min(userMax, TEXT_HARD_CAP_BYTES) : userMax;
      if (file.size > maxBytes) {
        fs.unlinkSync(file.path);
        const capMb = (maxBytes / 1024 / 1024).toFixed(1);
        return res.status(413).json({ error: `檔案超過上限 ${capMb}MB。(${originalName})` });
      }
    }
  }

  // Budget limit check is now handled by budgetGuard middleware (before this handler)

  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders(); // Force headers to be sent immediately (before any async work)
  // CRITICAL: write an initial SSE comment immediately after flushing headers.
  // Some proxies/HTTP stacks won't forward a chunked response until the first body chunk is sent.
  // Without this, the client may never receive the headers and the connection appears to hang.
  res.write(': stream-init\n\n');
  console.log(`[SSE] headers+init flushed for session ${sessionId}`);

  // Detect actual client disconnection (tab closed / stop button).
  // IMPORTANT: use res.on('close'), NOT req.on('close')!
  // req 'close' fires when the request BODY is fully consumed (~80ms for POST),
  // which is NOT a disconnect. res 'close' fires when the response stream is
  // actually terminated (client navigated away / aborted).
  let clientDisconnected = false;
  res.on('close', () => {
    if (!clientDisconnected) {
      clientDisconnected = true;
      console.log('[Chat] Client disconnected (res close)');
    }
  });

  const sendEvent = (data) => {
    if (clientDisconnected) return;  // 客戶端已中斷，忽略寫入
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      clientDisconnected = true;
    }
  };

  // Global SSE keep-alive: send a comment periodically to keep the connection alive.
  // SSE comments (lines starting with ":") are ignored by the browser parser.
  const sseKeepAlive = setInterval(() => {
    if (clientDisconnected) {
      clearInterval(sseKeepAlive);
      return;
    }
    try {
      res.write(': keep-alive\n\n');
    } catch (e) {
      clientDisconnected = true;
      clearInterval(sseKeepAlive);
    }
  }, 3000);

  // Max combined input text sent to Gemini (~50k tokens to stay well within limits)
  const MAX_COMBINED_INPUT = 200000;

  try {
    // ── Timing breakdown ──────────────────────────────────────────────────────
    const _timing = { start: Date.now(), fileStart: 0, fileEnd: 0, skillStart: 0, skillEnd: 0, llmStart: 0, ttft: 0, llmEnd: 0, postStart: 0, postEnd: 0 };

    // Process uploaded files
    const fileMetas = [];
    const userParts = [];
    let combinedUserText = message;

    // ── Doc Template Tag Detection ──────────────────────────────────────────
    // Message prefix: [使用範本:UUID:name:outputFormat] or [使用範本:UUID:name:pptx:rich:dark]
    let docTemplateId = null;
    let docTemplateName = '';
    let docTemplateSchema = null;
    let docTemplateOutputFmt = null;
    let pptxRenderMode = null;  // 'rich' | null (null = use template format)
    let pptxRichTheme = null;   // 'dark' | 'light' | 'corporate' | null
    {
      const tplMatch = combinedUserText.match(/^\[使用範本:([^:]+):([^:\]]+)(?::([^:\]]+))?(?::([^:\]]+))?(?::([^\]]+))?\]\s*/);
      if (tplMatch) {
        docTemplateId      = tplMatch[1];
        docTemplateName    = tplMatch[2];
        docTemplateOutputFmt = tplMatch[3] || null;
        // Extended fields for PPTX rich mode: [使用範本:id:name:pptx:rich:dark]
        if (tplMatch[4] === 'rich') {
          pptxRenderMode = 'rich';
          pptxRichTheme  = tplMatch[5] || 'dark';
        }
        combinedUserText = combinedUserText.slice(tplMatch[0].length).trim();
        try {
          const tplRow = await db.prepare('SELECT schema_json, name FROM doc_templates WHERE id=?').get(docTemplateId);
          if (tplRow?.schema_json) {
            docTemplateSchema = typeof tplRow.schema_json === 'string'
              ? JSON.parse(tplRow.schema_json) : tplRow.schema_json;
            docTemplateName = tplRow.name || docTemplateName;
            console.log(`[DocTemplate] Chat template: id=${docTemplateId} name="${docTemplateName}" vars=${docTemplateSchema.variables?.length}`);
          }
        } catch (e) {
          console.warn('[DocTemplate] Failed to load schema:', e.message);
          docTemplateId = null;
        }
      }
    }

    // Early provider detection: Azure OpenAI cannot handle inlineData (base64 files),
    // so PDFs/images must be text-extracted instead of sent inline.
    const earlyModel = model || session.model || 'pro';
    const { providerType: earlyProvider } = await resolveApiModel(db, earlyModel);
    const isAoaiProvider = earlyProvider === 'azure_openai';

    _timing.fileStart = Date.now();
    for (const file of uploadedFiles) {
      const ext = path.extname(file.originalname).toLowerCase();
      const mimeType = file.mimetype;
      const filePath = file.path;
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      console.log(`[Chat] Processing file: "${originalName}" size=${file.size} bytes mime=${mimeType} provider=${earlyProvider}`);

      // Audio → transcribe
      if (mimeType.startsWith('audio/')) {
        sendEvent({ type: 'status', message: `正在轉錄音訊: ${originalName}...` });
        try {
          const transcribeResult = await transcribeAudio(filePath, mimeType);
          const transcription = transcribeResult.text;
          combinedUserText += `\n\n[音訊轉錄: ${originalName}]\n${transcription}`;
          fileMetas.push({ name: originalName, type: 'audio', transcription });
          console.log(`[Chat] Audio transcribed: ${transcription.length} chars, in=${transcribeResult.inputTokens} out=${transcribeResult.outputTokens}`);
          // Plan B: record transcription tokens as a separate flash entry
          if (transcribeResult.inputTokens > 0 || transcribeResult.outputTokens > 0) {
            const today = new Date().toISOString().slice(0, 10);
            await upsertTokenUsage(db, req.user.id, today, 'flash',
              transcribeResult.inputTokens, transcribeResult.outputTokens, 0);
          }
        } catch (e) {
          console.error(`[Chat] Audio transcription failed for "${originalName}":`, e.message);
          combinedUserText += `\n\n[音訊轉錄失敗: ${originalName}]`;
        }
        fs.unlinkSync(filePath);
        continue;
      }

      // Image → inline + persist for multi-turn editing continuity
      if (mimeType.startsWith('image/')) {
        const userImgDir = path.join(UPLOAD_DIR, 'user_images');
        if (!fs.existsSync(userImgDir)) fs.mkdirSync(userImgDir, { recursive: true });
        const imgExt = path.extname(originalName).toLowerCase() || '.jpg';
        const persistFname = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${imgExt}`;
        const persistPath = path.join(userImgDir, persistFname);
        fs.copyFileSync(filePath, persistPath);
        userParts.push(await fileToGeminiPart(filePath, mimeType));
        fileMetas.push({ name: originalName, type: 'image', localPath: persistPath, mimeType });
        fs.unlinkSync(filePath);
        console.log(`[Chat] Image added as inline part, persisted to ${persistFname}`);
        continue;
      }

      // PDF → send as inline data to Gemini (handles images + text natively, better than pdf-parse)
      // Gemini supports inline PDF up to ~20MB; larger files fall back to text extraction
      // Azure OpenAI cannot handle inlineData, so always use text extraction for AOAI
      const MAX_PDF_INLINE_MB = 15;
      if (mimeType === 'application/pdf' && file.size <= MAX_PDF_INLINE_MB * 1024 * 1024 && !isAoaiProvider) {
        sendEvent({ type: 'status', message: `正在解析: ${originalName}...` });
        userParts.push(await fileToGeminiPart(filePath, mimeType));
        fileMetas.push({ name: originalName, type: 'document' });
        console.log(`[Chat] PDF sent as inline data to Gemini: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
        fs.unlinkSync(filePath);
        continue;
      }

      // Other documents (or large PDFs) → extract text
      console.log(`[Chat] Extracting text from "${originalName}"...`);
      sendEvent({ type: 'status', message: `正在解析: ${originalName}...` });
      const extractedText = await extractTextFromFile(filePath, mimeType, originalName);
      if (extractedText) {
        console.log(`[Chat] Extracted ${extractedText.length} chars from "${originalName}"`);
        combinedUserText += `\n\n${extractedText}`;
        fileMetas.push({ name: originalName, type: 'document' });
      } else {
        console.warn(`[Chat] Extraction returned null for "${originalName}" (mime=${mimeType})`);
        fileMetas.push({ name: originalName, type: 'unknown' });
      }
      fs.unlinkSync(filePath);
    }

    // Guard: cap combined input text to prevent Gemini API rejection
    if (combinedUserText.length > MAX_COMBINED_INPUT) {
      console.warn(`[Chat] Combined input too large (${combinedUserText.length} chars), truncating to ${MAX_COMBINED_INPUT}`);
      combinedUserText = combinedUserText.slice(0, MAX_COMBINED_INPUT) + '\n\n[⚠️ 輸入內容過長，已截斷]';
    }
    console.log(`[Chat] Total combined input: ${combinedUserText.length} chars, files=${fileMetas.length}`);

    _timing.fileEnd = Date.now();

    if (fileMetas.length > 0) {
      sendEvent({ type: 'files', files: fileMetas });
    }

    // Add text part
    if (combinedUserText.trim()) {
      userParts.push({ text: combinedUserText });
    }

    // If user is requesting file generation, inject inline reminder so Gemini reliably outputs code blocks
    const lowerMsg = message.toLowerCase();
    const fileTypeWords = ['pdf', 'word', 'docx', 'excel', 'xlsx', 'ppt', 'pptx', 'txt', '投影片', '簡報'];
    const fileActionWords = ['生成', '匯出', '下載', '轉出', '轉換', '轉成', '輸出', '產出', '製作', '建立', '重新生成', '再生成', '產生', '做一', '做個', '幫我做', '幫我產', '幫我建', 'export', 'generate', 'download', 'create', 'make'];
    const wantsFileGen = fileTypeWords.some((t) => lowerMsg.includes(t)) &&
      fileActionWords.some((a) => lowerMsg.includes(a));

    // PPT detection — rich PPTX is now the default for all PPT requests
    const isFoxlinkBrand = lowerMsg.includes('foxlink') || lowerMsg.includes('正崴') || lowerMsg.includes('福連');
    const isPptRequest = lowerMsg.includes('ppt') || lowerMsg.includes('簡報') || lowerMsg.includes('投影片') || lowerMsg.includes('slide');
    // Suppress when user already selected a doc template — template_values path takes priority
    const wantsRichPpt = !docTemplateId && isPptRequest &&
      (wantsFileGen || isFoxlinkBrand || lowerMsg.includes('foxlink風格') || lowerMsg.includes('公司風格') || lowerMsg.includes('企業風格') || lowerMsg.includes('公司簡報') || lowerMsg.includes('企業簡報'));

    if (wantsRichPpt) {
      // Detect theme from user message keywords
      let richTheme = 'dark'; // default
      if (isFoxlinkBrand || lowerMsg.includes('企業風') || lowerMsg.includes('公司風') || lowerMsg.includes('corporate')) {
        richTheme = 'corporate';
      } else if (lowerMsg.includes('淺色') || lowerMsg.includes('亮色') || lowerMsg.includes('白色') || lowerMsg.includes('light') || lowerMsg.includes('明亮')) {
        richTheme = 'light';
      } else if (lowerMsg.includes('深色') || lowerMsg.includes('暗色') || lowerMsg.includes('dark') || lowerMsg.includes('暗黑')) {
        richTheme = 'dark';
      }
      const brandStr = isFoxlinkBrand ? '  "brand": "FOXLINK",\n' : '';
      console.log(`[Chat] Rich PPT detected (theme=${richTheme}), injecting rich slide schema`);
      userParts.push({
        text:
          `[系統指令] 使用者要求生成投影片。建議主題：${richTheme}（如使用者另有指定請從 dark/light/corporate 中選用）。\n` +
          '你必須輸出以下格式的代碼區塊（使用 generate_rich_pptx）：\n' +
          '\n```generate_rich_pptx:presentation.pptx\n' +
          '{\n' +
          `  "theme": "${richTheme}",\n` +
          '  "author": "作者姓名",\n' +
          '  "date": "YYYY-MM-DD",\n' +
          brandStr +
          '  "slides": [ ... ]\n' +
          '}\n```\n\n' +
          '可用 slide types（根據內容選擇最適合的類型混搭使用）：\n' +
          '1. title — 封面：{ "type":"title", "title":"主標題", "subtitle":"副標題" }\n' +
          '2. closing — 結尾：{ "type":"closing", "title":"感謝聆聽", "subtitle":"聯絡資訊" }\n' +
          '3. bullets — 條列：{ "type":"bullets", "title":"標題", "icon":"shield", "highlight":"重點(選填)", "bullets":["項目1","項目2"] }\n' +
          '4. dashboard — KPI儀表板：{ "type":"dashboard", "title":"摘要", "subtitle":"說明", "cards":[{"number":"22","label":"專案總數","color":"blue"},{"number":"7","label":"上線","color":"green"}], "section_title":"明細", "table":{"headers":["部門","數量"],"rows":[["IT","5"],["HR","3"]]} }\n' +
          '5. data_table — 資料表格：{ "type":"data_table", "title":"明細表", "columns":[{"name":"名稱","width":30},{"name":"狀態","width":15,"statusColors":{"上線":"22C55E","進行中":"EAB308","POC":"F97316"}},{"name":"效益","width":25}], "rows":[["AI系統","上線","100萬"],["分析平台","進行中","50萬"]] }\n' +
          '6. chart — 圖表：{ "type":"chart", "title":"趨勢", "chartType":"line|bar|pie|doughnut|radar|area", "data":[{"name":"營收","labels":["Q1","Q2","Q3"],"values":[100,200,300]}], "showValue":true, "description":"說明文字(選填)" }\n' +
          '7. infographic — 資訊圖：{ "type":"infographic", "title":"成果", "items":[{"icon":"trending-up","number":"23%","label":"成長率","color":"green"},{"icon":"users","number":"1200","label":"用戶數","color":"blue"}] }\n' +
          '8. timeline — 時間軸：{ "type":"timeline", "title":"里程碑", "events":[{"date":"Q1","title":"啟動","desc":"需求分析"},{"date":"Q2","title":"開發","desc":"系統開發"}] }\n' +
          '9. comparison — 對比：{ "type":"comparison", "title":"方案比較", "left":{"title":"方案A","icon":"shield","items":["優點1","優點2"],"color":"blue"}, "right":{"title":"方案B","icon":"rocket","items":["優點1","優點2"],"color":"green"} }\n' +
          '10. process_flow — 流程：{ "type":"process_flow", "title":"實施流程", "steps":[{"title":"分析","icon":"target","desc":"需求訪談"},{"title":"設計","icon":"settings","desc":"架構設計"}] }\n' +
          '11. 3col — 三欄：{ "type":"3col", "title":"三大面向", "columns":[{"title":"面向1","icon":"target","bullets":["內容"]},{"title":"面向2","icon":"users","bullets":["內容"]},{"title":"面向3","icon":"bar-chart","bullets":["內容"]}] }\n' +
          '12. two_col — 雙欄：{ "type":"two_col", "title":"對照", "left_title":"左欄", "left_bullets":["項目"], "right_title":"右欄", "right_bullets":["項目"] }\n' +
          '13. quote — 引言：{ "type":"quote", "quote":"引言文字", "author":"作者" }\n' +
          '14. section — 章節分隔：{ "type":"section", "title":"章節標題", "subtitle":"說明" }\n\n' +
          '可用 icon：shield, shield-check, alert, info, check, check-circle, user, users, bar-chart, line-chart, pie-chart, trending-up, trending-down, target, building, briefcase, settings, globe, lightbulb, rocket, file, file-text, clipboard, clock, calendar, arrow-right, star, award, package, link\n' +
          '可用 card color：blue, green, yellow, red, orange, purple, gray\n' +
          '可用 theme：dark（深色專業風）、light（淺色清爽）、corporate（企業藍白風）\n\n' +
          '規則：\n' +
          '1) 第一張必須是 title 封面，最後一張建議是 closing\n' +
          '2) 根據內容特性選擇最適合的 slide type（有數據用 dashboard/chart，有表格用 data_table，有流程用 process_flow/timeline）\n' +
          '3) 不要所有頁都用 bullets — 混搭不同 type 讓簡報更豐富\n' +
          '4) chart.data 的 values 必須是數字陣列\n' +
          '5) data_table 的 rows 是二維陣列 [[cell1,cell2,...],[...]]\n' +
          '6) 所有文字使用使用者指定語言（預設繁體中文）\n' +
          '7) 必須輸出完整 JSON 代碼區塊',
      });
    } else if (wantsFileGen && !docTemplateId) {
      // Only inject file-gen reminder when no doc template is selected
      console.log(`[Chat] File generation detected, injecting reminder`);
      userParts.push({
        text: '[系統規則強制提醒] 你必須在本次回覆中直接輸出完整的 generate_xxx:filename 代碼區塊（包含所有檔案內容）。只說「已生成」「系統處理」「點擊連結」是無效的，絕對不會產生任何檔案。',
      });
    }

    // ── Doc Template: inject strong override to prevent generate_xxx conflicts ──
    if (docTemplateId && docTemplateSchema) {
      const varKeys = (docTemplateSchema.variables || []).map(v => v.key).join(', ');
      const isPptxLayout = docTemplateSchema.pptx_settings?.slide_config?.some(c => c.type === 'layout_template');
      let pptxHint = '';
      if (isPptxLayout && pptxRenderMode === 'rich') {
        // ── AI 自由設計模式：強制使用豐富 slide types ──
        const themeLabel = { dark: '深色專業風', light: '淺色清爽', corporate: '企業藍白風' }[pptxRichTheme] || '深色專業風';
        pptxHint =
          `\n5. PPTX 版型（AI 自由設計模式，主題：${themeLabel}）：slides 欄位是陣列，系統會自動保留封面封底並用豐富渲染引擎生成內頁。` +
          `\n   ★★★ 重要：你必須使用以下進階 slide types（至少 3 種不同 type），禁止全部用 bullets ★★★` +
          `\n   - "dashboard"：KPI 數字卡片 + 摘要表格（需要 cards 陣列 [{title,value,subtitle,icon,color}] + table {headers,rows}）` +
          `\n   - "data_table"：帶狀態色彩的資料表格（需要 columns 陣列 + rows 二維陣列，可加 statusColumn 欄位名 + statusColors {值:顏色}）` +
          `\n   - "chart"：圖表（需要 chartType:"line|bar|pie|doughnut|radar|area" + data:[{name,labels,values}]，可加 showValue:true）` +
          `\n   - "infographic"：大數字 + icon 資訊圖（需要 items:[{icon,number,label,color}]）` +
          `\n   - "timeline"：時間軸里程碑（需要 events:[{date,title,desc}]）` +
          `\n   - "comparison"：左右對比（需要 left:{title,icon,items,color} + right:{title,icon,items,color}）` +
          `\n   - "process_flow"：流程圖（需要 steps:[{title,icon,desc}]）` +
          `\n   - "bullets"：傳統條列（需要 bullets 陣列）— 僅在純文字摘要時使用` +
          `\n   - "3col"：三欄卡片（需要 columns:[{title,icon,bullets}]）` +
          `\n   - "two_col"：雙欄對照（需要 left_title, left_bullets, right_title, right_bullets）` +
          `\n   可用 icon：shield, shield-check, alert, info, check, check-circle, user, users, bar-chart, line-chart, pie-chart, trending-up, trending-down, target, building, briefcase, settings, globe, lightbulb, rocket, file, file-text, clipboard, clock, calendar, arrow-right, star, award, package, link` +
          `\n   可用 card color：blue, green, yellow, red, orange, purple, gray` +
          `\n   規則：根據內容特性選擇最適合的 type — 有數據用 dashboard/chart，有表格用 data_table，有流程用 process_flow/timeline，混搭不同 type 讓簡報更豐富專業` +
          `\n   ★ bullets 僅作為最後手段使用 — 如果內容可以用其他任何 type 表達，就必須用該 type`;
      } else if (isPptxLayout) {
        // ── 依範本格式模式：列出可用類型但不強制 ──
        pptxHint =
          `\n5. PPTX 版型：slides 欄位是陣列。你可以使用以下進階 slide types 來產生更豐富的投影片（系統會自動保留封面封底並用豐富渲染引擎生成內頁）：` +
          `\n   - "dashboard"、"data_table"、"chart"、"infographic"、"timeline"、"comparison"、"process_flow"、"bullets"、"3col"` +
          `\n   根據內容需求選擇最適合的 type，不要全用 bullets。`;
      }
      userParts.push({
        text: `[強制系統指令 — 文件範本模式] 使用者已選擇文件範本「${docTemplateName}」（ID: ${docTemplateId}）。` +
          `本次回覆你必須遵守以下規則，違反任何一條都會導致系統無法產生檔案：\n` +
          `1. 絕對不可輸出 generate_pptx、generate_foxlink_pptx、generate_docx、generate_xlsx 或任何 generate_xxx 代碼區塊\n` +
          `2. 必須在回覆最後輸出一個 \`\`\`template_values 代碼區塊，格式如下：\n` +
          `\`\`\`template_values\n{"${varKeys ? varKeys.split(', ')[0] : 'key'}": "value", ...}\n\`\`\`\n` +
          `3. 範本需要的欄位 key：${varKeys || '（請參考系統指令說明）'}，以及 _ai_filename（依報告內容產生簡短中文檔名）\n` +
          `4. 即使對話歷史中有 generate_xxx 的範例，本次也必須使用 template_values 格式` +
          pptxHint,
      });
      console.log(`[DocTemplate] Injected strong override into userParts for template "${docTemplateName}" isPptxLayout=${isPptxLayout}`);
    }

    if (userParts.length === 0) {
      sendEvent({ type: 'error', message: '請輸入訊息或上傳檔案' });
      return res.end();
    }

    // ── Pending TTS: user replied with voice preference → execute TTS now ──
    const pendingTts = pendingTtsMap.get(sessionId);
    if (pendingTts) {
      const hasVoicePref = /男聲|女聲|wavenet|neural2|standard|male|female|英文|越文|日文|韓文|cmn-|en-US|vi-VN|ja-JP|ko-KR/i.test(combinedUserText);
      if (hasVoicePref) {
        console.log(`[TTS pending] Session ${sessionId}: voice pref detected, running deferred TTS`);
        pendingTtsMap.delete(sessionId);
        const { sk } = pendingTts;
        try {
          sendEvent({ type: 'status', message: `Skill: ${sk.name} 語音合成中...` });
          const resp = await Promise.race([
            fetch(sk.endpoint_url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Source': 'foxlink-gpt',
                ...(sk.endpoint_secret ? { Authorization: `Bearer ${sk.endpoint_secret}` } : {}),
              },
              body: JSON.stringify({
                user_message: combinedUserText,
                ai_response: pendingTts.aiResponse,
                session_id: sessionId,
                user_id: req.user.id,
              }),
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000)),
          ]);
          if (resp.ok) {
            const data = await resp.json();
            console.log(`[TTS pending] result keys=${Object.keys(data).join(',')}`);
            if (data.audio_url) {
              let audioUrl = data.audio_url;
              try {
                const audioPath = path.join(UPLOAD_DIR, 'generated', path.basename(data.audio_url));
                if (fs.existsSync(audioPath)) {
                  const buf = fs.readFileSync(audioPath);
                  audioUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`;
                }
              } catch (_) {}
              sendEvent({ type: 'audio', audio_url: audioUrl, filename: path.basename(data.audio_url || 'output.mp3') });
            }
            const ttsDisplayText = (data.system_prompt || '✅ 語音合成完成！').trim();
            // Save minimal user + assistant messages for this TTS-reply turn
            await db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)`).run(sessionId, combinedUserText);
            await db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`).run(sessionId, ttsDisplayText);
            sendEvent({ type: 'chunk', content: ttsDisplayText });
            sendEvent({ type: 'done' });
          } else {
            sendEvent({ type: 'error', message: `TTS 合成失敗 (HTTP ${resp.status})` });
            sendEvent({ type: 'done' });
          }
        } catch (e) {
          console.warn(`[TTS pending] failed:`, e.message);
          sendEvent({ type: 'error', message: `TTS 合成失敗: ${e.message}` });
          sendEvent({ type: 'done' });
        }
        clearInterval(sseKeepAlive);
        return res.end();
      } else {
        // No voice keywords → discard pending TTS
        console.log(`[TTS pending] Session ${sessionId}: no voice pref, discarding pending TTS`);
        pendingTtsMap.delete(sessionId);
      }
    }

    // Load history (include files_json for image continuity)
    const historyMessages = await db
      .prepare(
        `SELECT role, content, files_json FROM chat_messages
         WHERE session_id = ? ORDER BY created_at ASC`
      )
      .all(sessionId);

    // Determine if we need image-aware history (resolved after resolveApiModel below)
    const buildHistory = (msgs, withImages) => {
      if (!withImages) {
        return msgs.map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          // Gemini rejects empty string parts — use single space as placeholder
          parts: [{ text: m.content || ' ' }],
        }));
      }
      // Include saved images in history for multi-turn image editing
      return msgs.map((m) => {
        const role = m.role === 'user' ? 'user' : 'model';
        let parsed = null;
        if (m.files_json) {
          try { parsed = JSON.parse(m.files_json); } catch { }
        }

        // ── Model message: use historyParts for verbatim replay (includes thoughtSignatures) ──
        if (role === 'model' && parsed?.historyParts) {
          const parts = [];
          for (const p of parsed.historyParts) {
            if (p._type === 'text') {
              const part = { text: p.text || ' ' };
              if (p.thoughtSignature) part.thoughtSignature = p.thoughtSignature;
              parts.push(part);
            } else if (p._type === 'image' && p.filename) {
              try {
                const localFile = path.join(UPLOAD_DIR, 'generated', p.filename);
                if (fs.existsSync(localFile)) {
                  const data = fs.readFileSync(localFile).toString('base64');
                  const imgPart = { inlineData: { data, mimeType: p.mimeType || 'image/jpeg' } };
                  if (p.thoughtSignature) imgPart.thoughtSignature = p.thoughtSignature;
                  parts.push(imgPart);
                }
              } catch { }
            }
          }
          if (parts.length === 0) parts.push({ text: m.content || ' ' });
          return { role, parts };
        }

        // ── User message OR legacy model message: reconstruct from content + files ──
        const parts = [];
        if (m.content) parts.push({ text: m.content });
        const files = Array.isArray(parsed) ? parsed : (parsed?.generated || []);
        for (const f of files) {
          if (f.type !== 'image') continue;
          if (f.localPath) {
            try {
              if (fs.existsSync(f.localPath)) {
                const data = fs.readFileSync(f.localPath).toString('base64');
                parts.push({ inlineData: { data, mimeType: f.mimeType || 'image/jpeg' } });
              }
            } catch { }
          } else if (f.publicUrl) {
            try {
              const localFile = path.join(UPLOAD_DIR, 'generated', path.basename(f.publicUrl));
              if (fs.existsSync(localFile)) {
                const data = fs.readFileSync(localFile).toString('base64');
                const mime = f.publicUrl.match(/\.png$/i) ? 'image/png' : 'image/jpeg';
                parts.push({ inlineData: { data, mimeType: mime } });
              }
            } catch { }
          }
        }
        if (parts.length === 0) parts.push({ text: ' ' });
        return { role, parts };
      });
    };

    /**
     * Sanitize Gemini history:
     * 1. Remove model turns that have no meaningful content (empty text + no image parts)
     *    — Gemini rejects these with "model output must contain either output text or tool calls"
     * 2. Merge consecutive messages with the same role (Gemini requires strict alternation)
     * 3. Drop trailing user-role messages (history must end with model turn)
     */
    const sanitizeHistory = (hist) => {
      if (!hist || hist.length === 0) return [];

      // Helper: is this a meaningless part? (text-only with blank/whitespace string)
      const isEmptyTextPart = (p) => !p.inlineData && !p.functionCall && !p.functionResponse
        && typeof p.text === 'string' && p.text.trim() === '';

      // Step 1: filter out model turns that have only empty text parts and no images
      const filtered = hist.filter((entry) => {
        if (entry.role !== 'model') return true; // keep all user turns
        const nonEmpty = entry.parts.filter((p) => !isEmptyTextPart(p));
        return nonEmpty.length > 0; // drop model turns with nothing meaningful
      });

      // Step 2: merge consecutive same-role entries
      const merged = [];
      for (const entry of filtered) {
        const last = merged[merged.length - 1];
        if (last && last.role === entry.role) {
          last.parts = [...last.parts, ...entry.parts];
        } else {
          merged.push({ role: entry.role, parts: [...entry.parts] });
        }
      }

      // Step 3: strip leading model turns (Gemini requires first content = user)
      while (merged.length > 0 && merged[0].role === 'model') {
        merged.shift();
      }

      // Step 4: history must end with model turn
      while (merged.length > 0 && merged[merged.length - 1].role === 'user') {
        merged.pop();
      }

      return merged;
    };

    _timing.skillStart = Date.now();

    // Save user message first
    const userMsgResult = await db
      .prepare(
        `INSERT INTO chat_messages (session_id, role, content, files_json) VALUES (?, 'user', ?, ?)`
      )
      .run(sessionId, combinedUserText, fileMetas.length ? JSON.stringify(fileMetas) : null);

    // Audit check
    await checkSensitiveKeywords(db, req.user, sessionId, combinedUserText);

    // ── Load session skills + accessible skills + user profile (all parallel) ──
    const [sessionSkills, _allAccessibleSkills, _userProfile] = await Promise.all([
      db.prepare(`
        SELECT s.* FROM session_skills ss
        JOIN skills s ON s.id = ss.skill_id
        WHERE ss.session_id = ? ORDER BY ss.sort_order ASC
      `).all(sessionId),
      db.prepare(`
        SELECT * FROM skills
        WHERE owner_user_id=? OR is_public=1
        ORDER BY id ASC
      `).all(req.user.id),
      db.prepare(
        `SELECT preferred_language, role_id, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?`
      ).get(req.user.id),
    ]);

    // ── TAG-based skill auto-routing (skills not manually attached but tags match) ──
    const sessionSkillIds = new Set(sessionSkills.map(s => String(s.id)));
    let tagRoutedSkills = [];
    try {
      const allAccessibleSkills = _allAccessibleSkills;
      console.log(`[Skill] TAG routing: found ${allAccessibleSkills.length} accessible skills for user ${req.user.id}`);
      const msgLower = combinedUserText.toLowerCase();
      for (const sk of allAccessibleSkills) {
        if (sessionSkillIds.has(String(sk.id))) continue;
        const rawTags = sk.tags;
        // Split each stored tag by comma to handle comma-in-string storage issues
        const tags = (() => {
          try {
            const t = JSON.parse(rawTags || '[]');
            if (!Array.isArray(t)) return [];
            return t.flatMap(tag => String(tag).split(',').map(s => s.trim()).filter(Boolean));
          } catch { return []; }
        })();
        console.log(`[Skill] Checking skill "${sk.name}" id=${sk.id} public=${sk.is_public} mode=${sk.endpoint_mode} tags=${JSON.stringify(tags)}`);
        if (tags.length === 0) continue;
        // Bidirectional match: message contains tag, OR any 2+ char segment of tag is in message
        const tagMatch = tags.some(tag => {
          const t = String(tag).toLowerCase();
          if (msgLower.includes(t)) return true;
          // Check 2-4 char substrings of tag against message (e.g. "聲音" in "文字轉聲音" matches "轉成聲音檔")
          for (let len = 2; len <= Math.min(t.length, 4); len++) {
            for (let i = 0; i <= t.length - len; i++) {
              if (msgLower.includes(t.slice(i, i + len))) return true;
            }
          }
          return false;
        });
        if (tagMatch) {
          tagRoutedSkills.push(sk);
          console.log(`[Skill] TAG-auto-routed skill "${sk.name}" tags=[${tags.join(',')}]`);
        }
      }
    } catch (e) {
      console.warn('[Skill] TAG auto-routing for skills failed:', e.message);
    }
    const tagRoutedSkillIds = new Set(tagRoutedSkills.map(s => String(s.id)));
    const allSkillsToProcess = [...sessionSkills, ...tagRoutedSkills];
    // TAG-routed external/answer skills run AFTER Gemini (post_answer) so the AI search can still happen
    const postAnswerSkills = [];
    // Pre-inject system hint for TAG-routed post_answer skills so AI doesn't try to handle it itself
    const tagRoutedPostHints = tagRoutedSkills
      .filter(sk => sk.endpoint_mode === 'post_answer' || (sk.endpoint_mode === 'answer'))
      .map(sk => `注意：系統已偵測到使用者需要「${sk.name}」技能，該技能將在 AI 回答後自動處理，請勿在回答中提及無法執行此功能，也不要自行嘗試替代方案（如生成 txt 檔案）。`);

    // Collect system prompts from builtin skills
    const skillSystemPrompts = [];
    // Track skills that have output_template_id (for post-AI-output file generation)
    let skillOutputTemplateIds = null;
    // Track which skills need external-inject calls
    const externalInjectSkills = [];
    // Check for direct-answer external skill
    let externalAnswerSkill = null;

    const { resolveToolRefs, hasToolRefs } = require('../services/promptResolver');
    const { substituteVarsAsync } = require('../services/scheduledTaskService');

    async function checkCodeSkillHealth(endpointUrl) {
      try {
        const r = await Promise.race([
          fetch(endpointUrl.replace(/\/$/, '') + '/health'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000)),
        ]);
        return r.ok;
      } catch (_) { return false; }
    }

    // ── Rate limiting for skills ─────────────────────────────────────────
    for (const sk of allSkillsToProcess) {
      if (sk.rate_limit_per_user || sk.rate_limit_global) {
        const window = sk.rate_limit_window || 'hour';
        const intervalExpr = window === 'minute' ? "INTERVAL '1' MINUTE" : window === 'day' ? "INTERVAL '1' DAY" : "INTERVAL '1' HOUR";

        if (sk.rate_limit_per_user) {
          const row = await db.prepare(`SELECT COUNT(*) AS cnt FROM skill_call_logs WHERE skill_id=? AND user_id=? AND called_at > SYSTIMESTAMP - ${intervalExpr}`).get(sk.id, req.user.id);
          if ((row?.cnt || 0) >= sk.rate_limit_per_user) {
            sendEvent({ type: 'error', message: `技能「${sk.name}」呼叫已達上限（每${window === 'minute' ? '分鐘' : window === 'day' ? '天' : '小時'} ${sk.rate_limit_per_user} 次）` });
            sendEvent({ type: 'done' }); res.end(); return;
          }
        }
        if (sk.rate_limit_global) {
          const row = await db.prepare(`SELECT COUNT(*) AS cnt FROM skill_call_logs WHERE skill_id=? AND called_at > SYSTIMESTAMP - ${intervalExpr}`).get(sk.id);
          if ((row?.cnt || 0) >= sk.rate_limit_global) {
            sendEvent({ type: 'error', message: `技能「${sk.name}」全域呼叫已達上限` });
            sendEvent({ type: 'done' }); res.end(); return;
          }
        }
      }
    }

    for (const sk of allSkillsToProcess) {
      console.log(`[Skill] id=${sk.id} name="${sk.name}" type=${sk.type} mode=${sk.endpoint_mode} url=${sk.endpoint_url}`);
      if (sk.type === 'builtin' && sk.system_prompt) {
        // Resolve {{date}}, {{scrape:url}}, {{fetch:url}} vars first
        let resolvedSystemPrompt = sk.system_prompt;
        try {
          resolvedSystemPrompt = await substituteVarsAsync(sk.system_prompt, sk.name);
        } catch (e) {
          console.warn(`[Skill] substituteVarsAsync failed for "${sk.name}": ${e.message}`);
        }
        // Then resolve any {{skill:}} / {{kb:}} refs
        if (hasToolRefs(resolvedSystemPrompt)) {
          try {
            const r = await resolveToolRefs(resolvedSystemPrompt, db, { userId: req.user.id, sessionId });
            resolvedSystemPrompt = r.resolvedText;
          } catch (e) {
            console.warn(`[Skill] promptResolver failed for "${sk.name}": ${e.message}`);
          }
        }
        skillSystemPrompts.push(`# Skill: ${sk.name}\n${resolvedSystemPrompt}`);
        // Output schema
        if (sk.output_schema) {
          try {
            const oSchema = JSON.parse(sk.output_schema);
            skillSystemPrompts.push(`# 輸出格式要求 (Skill: ${sk.name})\n請嚴格按照以下 JSON Schema 格式回答：\n\`\`\`json\n${JSON.stringify(oSchema, null, 2)}\n\`\`\``);
          } catch (_) {}
        }
        // ── Template output: inject JSON schema instruction ─────────────────
        if (sk.output_template_id) {
          try {
            const { getTemplateSchemaInstruction } = require('../services/docTemplateService');
            const instr = await getTemplateSchemaInstruction(db, sk.output_template_id);
            if (instr) {
              skillSystemPrompts.push(`# 輸出範本 (Skill: ${sk.name})${instr}`);
              // Track for post-processing
              if (!skillOutputTemplateIds) skillOutputTemplateIds = [];
              skillOutputTemplateIds.push(sk.output_template_id);
            }
          } catch (e) {
            console.warn(`[Skill] template schema instruction failed for "${sk.name}": ${e.message}`);
          }
        }
      } else if (sk.type === 'external' || sk.type === 'code') {
        // For code runners, resolve endpoint URL from code_port if not set
        if (sk.type === 'code' && !sk.endpoint_url && sk.code_port) {
          sk = { ...sk, endpoint_url: `http://localhost:${sk.code_port}` };
        }
        if (!sk.endpoint_url) {
          console.warn(`[Skill] "${sk.name}" skipped: no endpoint_url (code_status=${sk.code_status}, code_port=${sk.code_port})`);
          continue;
        }
        // For code runners, do a quick health check first
        if (sk.type === 'code') {
          const healthy = await checkCodeSkillHealth(sk.endpoint_url);
          if (!healthy) {
            console.warn(`[Skill] "${sk.name}" health check failed (url=${sk.endpoint_url}), skipping`);
            sendEvent({ type: 'status', message: `⚠️ Skill "${sk.name}" 離線，請先在技能設定中啟動 Code Runner` });
            continue;
          }
        }
        if (sk.endpoint_mode === 'answer') {
          // TAG-routed skills run AFTER Gemini so the AI can still process other intents first
          if (tagRoutedSkillIds.has(String(sk.id))) {
            postAnswerSkills.push(sk);
          } else {
            externalAnswerSkill = sk;
          }
        } else if (sk.endpoint_mode === 'post_answer') {
          postAnswerSkills.push(sk);
          // Allow post_answer code skills to ALSO inject a system_prompt into Gemini
          // (e.g. TTS: tell Gemini to ask user about voice preferences)
          if (sk.system_prompt) {
            skillSystemPrompts.push(`# Skill: ${sk.name}\n${sk.system_prompt}`);
          }
        } else {
          externalInjectSkills.push(sk);
        }
      } else if (sk.type === 'workflow' && sk.workflow_json) {
        // Workflow skills are executed inline — they process the user's message through the workflow
        sendEvent({ type: 'status', message: `執行工作流：${sk.name}` });
        try {
          const { WorkflowEngine } = require('../services/workflowEngine');
          const workflow = JSON.parse(sk.workflow_json);
          // Resolve prompt_variables from session_skills
          const ssRow = await db.prepare('SELECT variables_json FROM session_skills WHERE session_id=? AND skill_id=?').get(sessionId, sk.id);
          const vars = (() => { try { return JSON.parse(ssRow?.variables_json || '{}'); } catch { return {}; } })();

          const engine = new WorkflowEngine(db, { userId: req.user.id, sessionId, user: req.user });
          const { output, log } = await engine.execute(workflow, combinedUserText, vars);

          if (output) {
            skillSystemPrompts.push(`# Workflow Result: ${sk.name}\n${output}`);
          }
          console.log(`[Skill] Workflow "${sk.name}" executed: ${log.length} nodes, output=${output?.length || 0} chars`);

          // Log skill call
          try {
            await db.prepare(`INSERT INTO skill_call_logs (skill_id, user_id, session_id, query_preview, response_preview, status, duration_ms) VALUES (?,?,?,?,?,?,?)`)
              .run(sk.id, req.user.id, sessionId, combinedUserText.slice(0, 200), (output || '').slice(0, 200), 'ok', log.reduce((s, n) => s + (n.duration || 0), 0));
          } catch (_) {}
        } catch (e) {
          console.error(`[Skill] Workflow "${sk.name}" error:`, e.message);
          skillSystemPrompts.push(`# Workflow Error: ${sk.name}\n工作流執行失敗: ${e.message}`);
        }
      } else if (sk.type === 'erp_proc' && (sk.erp_tool_id || sk.ERP_TOOL_ID)) {
        // ── ERP Inject / Answer:依 endpoint_mode 處理 ───────────────
        const erpToolId = sk.erp_tool_id || sk.ERP_TOOL_ID;
        const erpMode = (sk.endpoint_mode || sk.ENDPOINT_MODE || 'tool').toLowerCase();
        if (erpMode !== 'inject' && erpMode !== 'answer') continue;

        try {
          const toolRow = await db.prepare(
            `SELECT name, endpoint_mode, inject_config_json, params_json FROM erp_tools WHERE id=? AND enabled=1`
          ).get(erpToolId);
          if (!toolRow) continue;

          const injectConfigRaw = toolRow.inject_config_json || toolRow.INJECT_CONFIG_JSON;
          let injectConfig = {};
          try { injectConfig = JSON.parse(injectConfigRaw || '{}') || {}; } catch (_) {}

          if (erpMode === 'answer') {
            // ── Answer 模式:檢查是否有需要使用者輸入的 required 參數 ──
            const toolParamsRaw = toolRow.params_json || toolRow.PARAMS_JSON || '[]';
            const toolParams = JSON.parse(toolParamsRaw);
            const userInputParams = toolParams.filter(tp => {
              const io = (tp.in_out || 'IN').toUpperCase();
              if (io === 'OUT') return false;
              if (tp.visible === false || tp.editable === false) return false;
              if (tp.inject_source || tp.inject_value != null) return false;
              const cfg = tp.default_config;
              if (cfg && cfg.mode !== 'none') return false;
              if (tp.default_value != null) return false;
              return tp.required;
            });

            let extractedArgs = {};
            if (userInputParams.length > 0) {
              // ── 用 Flash 從使用者訊息中快速抽取參數 ──
              sendEvent({ type: 'status', message: `解析參數中…` });
              try {
                extractedArgs = await extractErpParamsWithFlash(db, combinedUserText, userInputParams);
                console.log(`[ErpAnswer] Flash extracted: ${JSON.stringify(extractedArgs)}`);
              } catch (exErr) {
                console.warn(`[ErpAnswer] Flash extraction failed: ${exErr.message}, fallback to tool mode`);
              }
              // 檢查是否全部 required 都抽到
              const missing = userInputParams.filter(tp => {
                const val = extractedArgs[tp.name];
                return val === null || val === undefined || val === '';
              });
              if (missing.length > 0) {
                // 抽取不完整 → 降級為 tool 模式
                console.log(`[ErpAnswer] Missing params after extraction: ${missing.map(p => p.name).join(',')}, fallback to tool mode`);
                try {
                  const schema = JSON.parse(sk.tool_schema);
                  const fallbackName = schema.name || `erp_tool_${erpToolId}`;
                  codeSkillToolMap[fallbackName] = sk;
                } catch (_) {}
                continue;
              }
            }

            // ── 直接執行(全自動帶入 + Flash 抽取) → 格式化直達使用者 ──
            sendEvent({ type: 'status', message: `查詢 ERP：${sk.name}` });
            const erpExec = require('../services/erpToolExecutor');
            const ansResult = await execWithHeartbeat(sendEvent, sk.name,
              erpExec.execute(db, erpToolId, extractedArgs, req.user, {
                trigger_source: 'answer',
                session_id: sessionId,
              }));
            const formatted = formatErpResultForUser(sk.name, ansResult?.result ?? ansResult, ansResult?.cache_key);
            sendEvent({ type: 'chunk', content: formatted });
            // 存 AI 訊息
            try {
              await db.prepare(
                `INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`
              ).run(sessionId, formatted);
            } catch (_) {}
            // 自動命名對話(跟一般 chat 一樣)
            try {
              const sessionRow = await db.prepare(`SELECT title FROM chat_sessions WHERE id=?`).get(sessionId);
              const curTitle = sessionRow?.title || sessionRow?.TITLE || '';
              const DEFAULT_TITLES = new Set(['新對話', 'New Chat', 'Cuộc trò chuyện mới']);
              if (!curTitle || DEFAULT_TITLES.has(curTitle)) {
                const quickTitle = combinedUserText.slice(0, 30).replace(/\n/g, ' ') || sk.name;
                await db.prepare(`UPDATE chat_sessions SET title=?, updated_at=SYSTIMESTAMP WHERE id=?`).run(quickTitle, sessionId);
                sendEvent({ type: 'title', title: quickTitle });
                generateTitle(combinedUserText, formatted).then(async ({ title: llmTitle, title_zh, title_en, title_vi }) => {
                  if (llmTitle) {
                    await db.prepare(`UPDATE chat_sessions SET title=?, title_zh=?, title_en=?, title_vi=? WHERE id=?`)
                      .run(llmTitle, title_zh || llmTitle, title_en || llmTitle, title_vi || llmTitle, sessionId);
                  }
                }).catch(() => {});
              } else {
                await db.prepare(`UPDATE chat_sessions SET updated_at=SYSTIMESTAMP WHERE id=?`).run(sessionId);
              }
            } catch (_) {}
            sendEvent({ type: 'done' });
            res.end();
            return;
          }

          // ── Inject 模式 ──
          const erpExec = require('../services/erpToolExecutor');
          const injectResult = await execWithHeartbeat(sendEvent, sk.name,
            erpExec.execute(db, erpToolId, {}, req.user, {
              trigger_source: 'inject',
              session_id: sessionId,
            }));
          const label = toolRow.name || toolRow.NAME || sk.name;
          const payload = injectResult?.result ?? injectResult;

          let rendered;
          if (injectConfig.result_template && typeof injectConfig.result_template === 'string') {
            rendered = injectConfig.result_template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
              const parts = path.split('.');
              let v = payload;
              for (const p of parts) v = v?.[p];
              return v === null || v === undefined ? '' : String(v);
            });
          } else {
            rendered = '```json\n' + JSON.stringify(payload, null, 2) + '\n```';
          }
          skillSystemPrompts.push(`# ERP 即時資訊:${label}\n${rendered}`);
          console.log(`[ErpInject] Injected "${label}" id=${erpToolId} rows=${injectResult?.rows_returned ?? 0}`);
        } catch (e) {
          console.warn(`[Erp${erpMode === 'answer' ? 'Answer' : 'Inject'}] "${sk.name}" failed: ${e.message}`);
          if (erpMode === 'answer') {
            sendEvent({ type: 'chunk', content: `⚠️ ERP 工具「${sk.name}」執行失敗：${e.message}` });
            sendEvent({ type: 'done' }); res.end(); return;
          }
          skillSystemPrompts.push(`# ERP 即時資訊:${sk.name}\n[此工具暫時無法取得即時資料]`);
        }
      }
    }

    // ── Register code skills with tool_schema as Gemini function declarations ──
    // post_answer / answer skills run AFTER Gemini — do NOT register them as Gemini tools
    const codeSkillToolMap = {};
    for (const sk of allSkillsToProcess) {
      if ((sk.type === 'code' || sk.type === 'external') && sk.tool_schema && sk.code_status === 'running' && sk.endpoint_url
          && sk.endpoint_mode !== 'post_answer' && sk.endpoint_mode !== 'answer') {
        try {
          const schema = JSON.parse(sk.tool_schema);
          const toolName = `skill_tool_${sk.id}`;
          codeSkillToolMap[toolName] = sk;
          // Will be added to allDeclarations later
          console.log(`[Skill] Registered code skill "${sk.name}" as Gemini tool: ${toolName}`);
        } catch (e) {
          console.warn(`[Skill] Failed to parse tool_schema for "${sk.name}":`, e.message);
        }
      } else if (sk.type === 'erp_proc' && sk.tool_schema && (sk.erp_tool_id || sk.ERP_TOOL_ID)) {
        const erpId = Number(sk.erp_tool_id || sk.ERP_TOOL_ID);
        const erpMode = (sk.endpoint_mode || sk.ENDPOINT_MODE || 'tool').toLowerCase();
        // 只有 tool 模式才註冊為 Gemini function;inject/answer 已在上面的 skill 迴圈處理
        if (erpMode !== 'tool') continue;
        if (explicitMode) {
          if (!Array.isArray(userErpToolIds) || !userErpToolIds.map(Number).includes(erpId)) continue;
        }
        try {
          const schema = JSON.parse(sk.tool_schema);
          const toolName = schema.name || `erp_tool_${erpId}`;
          codeSkillToolMap[toolName] = sk;
          console.log(`[Skill] Registered ERP tool "${sk.name}" as Gemini tool: ${toolName}`);
        } catch (e) {
          console.warn(`[Skill] Failed to parse ERP tool_schema for "${sk.name}":`, e.message);
        }
      }
    }

    // Build recent conversation context to pass to skills (last 6 messages, newest last)
    const recentMessages = historyMessages.slice(-6).map(m => ({
      role: m.role,
      content: (m.content || '').slice(0, 1000),
    }));

    // External inject: call endpoints in parallel and collect additional system prompts
    if (externalInjectSkills.length > 0) {
      const injectResults = await Promise.all(externalInjectSkills.map(async (sk) => {
        const _t0 = Date.now();
        let _status = 'ok', _errMsg = null, _respPreview = null, added = '';
        try {
          const resp = await Promise.race([
            fetch(sk.endpoint_url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Source': 'foxlink-gpt',
                ...(sk.endpoint_secret ? { Authorization: `Bearer ${sk.endpoint_secret}` } : {}),
              },
              body: JSON.stringify({ user_message: combinedUserText, session_id: sessionId, user_id: req.user.id, recent_messages: recentMessages }),
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
          ]);
          if (resp.ok) {
            const data = await resp.json();
            console.log(`[Skill] inject response for "${sk.name}":`, JSON.stringify(data).slice(0, 300));
            added = data.system_prompt || data.content || '';
            if (added) _respPreview = added.slice(0, 200);
          } else {
            _status = 'error'; _errMsg = `HTTP ${resp.status}`;
            console.warn(`[Skill] inject HTTP ${resp.status} for "${sk.name}"`);
          }
        } catch (e) {
          _status = 'error'; _errMsg = e.message;
          console.warn(`[Skill] External inject failed for "${sk.name}": ${e.message} — skipping`);
        }
        // Log skill call (fire-and-forget)
        db.prepare(`INSERT INTO skill_call_logs (skill_id, user_id, session_id, query_preview, response_preview, status, error_msg, duration_ms) VALUES (?,?,?,?,?,?,?,?)`)
          .run(sk.id, req.user.id, sessionId, combinedUserText.slice(0, 200), _respPreview, _status, _errMsg, Date.now() - _t0).catch(() => {});
        return { sk, added };
      }));
      // Collect results in original order
      for (const { sk, added } of injectResults) {
        if (added) skillSystemPrompts.push(`# Skill: ${sk.name}\n${added}`);
      }
    }

    // External answer: bypass Gemini entirely
    if (externalAnswerSkill) {
      const sk = externalAnswerSkill;
      const _ansT0 = Date.now();
      sendEvent({ type: 'status', message: `Skill: ${sk.name} 處理中...` });
      try {
        const resp = await Promise.race([
          fetch(sk.endpoint_url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Source': 'foxlink-gpt',
              ...(sk.endpoint_secret ? { Authorization: `Bearer ${sk.endpoint_secret}` } : {}),
            },
            body: JSON.stringify({ user_message: combinedUserText, session_id: sessionId, user_id: req.user.id, recent_messages: recentMessages }),
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000)),
        ]);
        let answerContent = `[Skill "${sk.name}" 無法取得回應]`;
        let skillAudioUrl = null;
        let skillAudioFileUrl = null;  // original file URL (for filename)
        if (resp.ok) {
          const data = await resp.json();
          console.log(`[Skill] answer "${sk.name}" HTTP 200 keys=${Object.keys(data).join(',')} audio=${!!data.audio_url} ${Date.now()-_ansT0}ms`);
          answerContent = data.content || data.system_prompt || answerContent;
          if (data.audio_url) {
            skillAudioFileUrl = data.audio_url;
            skillAudioUrl = data.audio_url;
            // Inline audio as base64 data URL — bypasses static file serving issues in K8s
            try {
              const audioPath = path.join(UPLOAD_DIR, 'generated', path.basename(data.audio_url));
              if (fs.existsSync(audioPath)) {
                const buf = fs.readFileSync(audioPath);
                skillAudioUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`;
                console.log(`[Skill] inlined audio ${buf.length} bytes from ${audioPath}`);
              } else {
                console.warn(`[Skill] audio file not found: ${audioPath}`);
              }
            } catch (e) {
              console.warn(`[Skill] inline audio failed: ${e.message}, using file URL`);
            }
          }
        } else {
          console.warn(`[Skill] answer "${sk.name}" HTTP ${resp.status} url=${sk.endpoint_url}`);
        }
        sendEvent({ type: 'chunk', content: answerContent });
        if (skillAudioUrl) {
          const isDataUrl = skillAudioUrl.startsWith('data:');
          const fname = skillAudioFileUrl ? path.basename(skillAudioFileUrl) : `tts_${Date.now()}.mp3`;
          console.log(`[Skill] sending audio: isDataUrl=${isDataUrl} fileUrl=${skillAudioFileUrl} dataUrlLen=${isDataUrl ? skillAudioUrl.length : 0} fname=${fname}`);
          sendEvent({ type: 'generated_files', files: [{ type: 'audio', filename: fname, publicUrl: skillAudioUrl }] });
        } else {
          console.log(`[Skill] NO audio_url from skill "${sk.name}"`);
        }
        sendEvent({ type: 'done' });
        // Record 0-token usage for tracing
        const today = new Date().toISOString().slice(0, 10);
        await upsertTokenUsage(db, req.user.id, today, 'external-skill', 0, 0, 0);
        await db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`)
          .run(sessionId, answerContent);
        // Auto-generate session title (same logic as normal chat path)
        try {
          const sessionRow = await db.prepare(`SELECT title FROM chat_sessions WHERE id=?`).get(sessionId);
          const currentTitle = sessionRow?.title || '';
          const DEFAULT_TITLES = new Set(['新對話', 'New Chat', 'Cuộc trò chuyện mới']);
          if (!currentTitle || DEFAULT_TITLES.has(currentTitle)) {
            const quickTitle = combinedUserText.slice(0, 30).replace(/\n/g, ' ') || sk.name;
            await db.prepare(`UPDATE chat_sessions SET title=?, updated_at=SYSTIMESTAMP WHERE id=?`).run(quickTitle, sessionId);
            sendEvent({ type: 'title', title: quickTitle });
            // Async LLM title refinement
            generateTitle(combinedUserText, answerContent).then(async ({ title: llmTitle, title_zh, title_en, title_vi }) => {
              if (llmTitle) {
                await db.prepare(`UPDATE chat_sessions SET title=?, title_zh=?, title_en=?, title_vi=? WHERE id=?`)
                  .run(llmTitle, title_zh || llmTitle, title_en || llmTitle, title_vi || llmTitle, sessionId);
                try { sendEvent({ type: 'title', title: llmTitle, title_zh, title_en, title_vi }); } catch (_) {}
              }
            }).catch(() => {});
          } else {
            await db.prepare(`UPDATE chat_sessions SET updated_at=SYSTIMESTAMP WHERE id=?`).run(sessionId);
          }
        } catch (_) {}
        // Log skill call
        try {
          await db.prepare(`INSERT INTO skill_call_logs (skill_id, user_id, session_id, query_preview, response_preview, status, duration_ms) VALUES (?,?,?,?,?,?,?)`)
            .run(sk.id, req.user.id, sessionId, combinedUserText.slice(0, 200), answerContent.slice(0, 200), 'ok', Date.now() - _ansT0);
        } catch (_) {}
        return res.end();
      } catch (e) {
        console.error(`[Skill] External answer failed for "${sk.name}":`, e.message);
        try {
          await db.prepare(`INSERT INTO skill_call_logs (skill_id, user_id, session_id, query_preview, status, error_msg, duration_ms) VALUES (?,?,?,?,?,?,?)`)
            .run(sk.id, req.user.id, sessionId, combinedUserText.slice(0, 200), 'error', e.message, Date.now() - _ansT0);
        } catch (_) {}
        // Fall through to normal Gemini path
      }
    }

    // Determine model (skill's model_key takes priority if set)
    const skillModelKey = allSkillsToProcess.find(sk => sk.model_key)?.model_key;

    // Stream AI response
    let aiText = '';
    const chosenModel = skillModelKey || model || session.model || 'pro';
    const { apiModel, imageOutput, providerType, modelRow } = await resolveApiModel(db, chosenModel);
    // Merge DB default genConfig with user per-message overrides
    const genConfig = modelRow?._genConfig ? { ...modelRow._genConfig } : {};
    if (userReasoningEffort && ['low', 'medium', 'high'].includes(userReasoningEffort)) {
      genConfig.reasoning_effort = userReasoningEffort;
    }
    const history = sanitizeHistory(buildHistory(historyMessages, imageOutput));

    // Inject skill system prompts into Gemini instruction (+ TAG-routed post_answer hints)
    const allSkillPrompts = [...skillSystemPrompts, ...tagRoutedPostHints];
    const skillExtraInstruction = allSkillPrompts.length > 0
      ? '\n\n---\n' + allSkillPrompts.join('\n\n')
      : '';

    // ── Doc Template system injection ──────────────────────────────────────
    let templateExtraInstruction = '';
    if (docTemplateId && docTemplateSchema?.variables?.length > 0) {
      const varList = docTemplateSchema.variables.map(v => {
        const flatV = v.type === 'loop' ? (v.children || []) : [v];
        const preserveChildren = flatV.filter(c => !c.allow_ai_rewrite);
        let desc = `- ${v.label}（key: ${v.key}, type: ${v.type}${v.required ? ', 必填' : ''}${!v.allow_ai_rewrite && v.type !== 'loop' ? '【★保留原文】' : ''}）`;
        if (v.type === 'loop' && v.children?.length)
          desc += `\n  子欄位: ${v.children.map(c => `${c.label}(${c.key})${!c.allow_ai_rewrite ? '【★保留原文】' : ''}`).join(', ')}`;
        return desc;
      }).join('\n');
      const hasPreserve = docTemplateSchema.variables.some(v => {
        if (v.type === 'loop') return (v.children || []).some(c => !c.allow_ai_rewrite);
        return !v.allow_ai_rewrite;
      });
      // Check if this is a PPTX layout_template schema
      const isPptxLayout = docTemplateSchema.pptx_settings?.slide_config?.some(c => c.type === 'layout_template');
      const slidesVar = isPptxLayout ? docTemplateSchema.variables?.find(v => v.key === 'slides') : null;
      const layoutOpts = slidesVar?.children?.find(c => c.key === 'type')?.options || ['bullets'];
      const has3col = layoutOpts.includes('3col');

      let pptxLayoutNote = '';
      if (isPptxLayout) {
        pptxLayoutNote = `
【PPTX 多版型規則（重要）】
- "slides" 是 loop 陣列，每個元素 = 一張內頁投影片
- 每個元素必須包含 "type" 欄位：${layoutOpts.map(o => `"${o}"`).join(' 或 ')}
- 版型選擇規則：
  - "bullets"：標題 + 條列重點（用 \\n 分隔各條，前面可加 • 或不加）
  - ${has3col ? '"3col"：標題 + 三欄（col1/col2/col3 各有 title 和 content）' : ''}
- 內容請依主題合理拆分成多張投影片，每張 bullets 最多 6 條，不要塞進單一投影片
- slide_content / col*_content：每行一條重點，用 \\n 分隔（不要用 HTML 或 markdown）
- 範例：
\`\`\`template_values
{
  "cover_title": "Q1 業績報告",
  "cover_date": "2025-03-31",
  "cover_presenter": "業務部",
  "slides": [
    {"type": "bullets", "slide_title": "本季亮點", "slide_content": "營收成長 15%\\n新客戶 23 家\\n滿意度評分 4.8"},
    ${has3col ? '{"type": "3col", "slide_title": "三大策略", "col1_title": "品質", "col1_content": "ISO 認證\\n零缺陷目標", "col2_title": "效率", "col2_content": "流程精簡\\n自動化導入", "col3_title": "創新", "col3_content": "研發投入\\n新品開發"},' : ''}
    {"type": "bullets", "slide_title": "下季目標", "slide_content": "擴展三個新市場\\n推出兩款新產品\\n提升毛利率 2%"}
  ]
}
\`\`\``;
      }

      templateExtraInstruction = `

---
【文件範本填寫模式】
使用者選擇了文件範本「${docTemplateName}」，請從使用者提供的文字中提取變數值並填入範本。

範本變數清單：
${varList}
${pptxLayoutNote}
請執行以下步驟：
1. 簡短說明你識別到的內容（1-2句）
2. 在回覆最後加上一個 JSON 代碼塊（必須以 \`\`\`template_values 開頭），格式如下：
\`\`\`template_values
{"key1": "value1", "key2": "value2"}
\`\`\`

注意：
- loop 類型的值應為陣列，例如 [{"子key1": "值", "子key2": "值"}, ...]
- 文字中找不到的欄位設為空字串 ""
${hasPreserve ? '- 標記【★保留原文】的欄位：必須完整複製原始文字，絕對不得摘要、縮短、改寫或省略任何字句，原文是什麼就填什麼' : ''}
- 未標記保留原文的欄位：直接提取文字中的資料，不要杜撰`;
    }

    // Inject user language preference into system instruction (pre-loaded in _userProfile)
    const resolvedLang = _userProfile?.preferred_language || 'zh-TW';
    const LANG_NAMES = { 'zh-TW': '繁體中文', 'en': 'English', 'vi': 'Tiếng Việt' };
    const langInstruction = `\n\n---\n請使用 ${LANG_NAMES[resolvedLang] || '繁體中文'} 回答，除非使用者在問題中明確指定輸出語言（例如翻譯任務）。`;
    // Disable Google Search when inject skills have provided data (avoid Gemini overriding with Search)
    const disableSearchForSkill = externalInjectSkills.length > 0 && skillSystemPrompts.length > 0;

    _timing.skillEnd = Date.now();
    console.log(`[Chat] Calling Gemini (model=${chosenModel} → ${apiModel}, imageOutput=${imageOutput}, skills=${sessionSkills.length}) parts=${userParts.length} history=${history.length}`);
    _timing.llmStart = Date.now();
    const t0 = Date.now();

    let text, inputTokens, outputTokens;
    let displayText;
    let imgResult = null;
    let allGeneratedFiles = [];  // collect for DB persistence

    if (imageOutput) {
      // ── Image-generation model (non-streaming) ──────────────────────────
      sendEvent({ type: 'status', message: '正在生成圖片，請稍候...' });
      imgResult = await generateWithImage(apiModel, history, userParts);
      text = imgResult.text;
      inputTokens = imgResult.inputTokens;
      outputTokens = imgResult.outputTokens;

      // Save each returned image to uploads/generated/
      const outputDir = require('path').join(UPLOAD_DIR, 'generated');
      if (!require('fs').existsSync(outputDir)) require('fs').mkdirSync(outputDir, { recursive: true });

      const savedImages = [];
      for (let i = 0; i < imgResult.images.length; i++) {
        const img = imgResult.images[i];
        const ext = img.mimeType.split('/')[1] || 'png';
        const fname = `img_${Date.now()}_${i}.${ext}`;
        const fpath = require('path').join(outputDir, fname);
        require('fs').writeFileSync(fpath, Buffer.from(img.data, 'base64'));
        savedImages.push({ type: 'image', filename: fname, publicUrl: `/uploads/generated/${fname}` });
        console.log(`[Chat] Image saved: ${fname} (thoughtSignature=${img.thoughtSignature ? 'yes' : 'no'})`);
      }

      // Build historyParts for verbatim replay — replaces image binary with filename ref
      const historyParts = (imgResult.rawParts || []).map((p) => {
        if (p._type === 'image') {
          const saved = savedImages[p.imageIdx];
          return { _type: 'image', filename: saved?.filename, mimeType: p.mimeType, thoughtSignature: p.thoughtSignature };
        }
        return p;  // text part (includes thoughtSignature)
      });

      if (savedImages.length > 0) {
        sendEvent({ type: 'generated_files', files: savedImages });
        // Store extended format: generated files + historyParts for replay
        allGeneratedFiles = { generated: savedImages, historyParts };
      }

      // Send text part as a single chunk (if any)
      if (text) {
        sendEvent({ type: 'chunk', content: text });
      }

      displayText = text || (savedImages.length > 0 ? `已生成 ${savedImages.length} 張圖片` : '圖片生成失敗');
      _timing.llmEnd = Date.now();
      console.log(`[Chat] Image gen done in ${Date.now() - t0}ms, images=${imgResult.images.length} in=${inputTokens} out=${outputTokens}`);
    } else {
      // ── User context (pre-loaded in _userProfile) ──
      const roleId = _userProfile?.role_id || null;
      const userCtx = req.user.role === 'admin' ? null : {
        userId: req.user.id,
        roleId,
        deptCode:     _userProfile?.dept_code      || null,
        profitCenter: _userProfile?.profit_center  || null,
        orgSection:   _userProfile?.org_section    || null,
        orgGroupName: _userProfile?.org_group_name || null,
        factoryCode:  _userProfile?.factory_code   || null,
      };

      // Shared maps for toolHandler (populated below regardless of mode)
      let serverMap = {}, kbMap = {}, selfKbMap = {};
      let allDeclarations = [];

      if (explicitMode) {
        // ── Explicit selection mode: load selected tools in parallel ─────────
        const _explicitLoaders = [];
        const hasMcp = userMcpIds && userMcpIds.length > 0;
        const hasDify = userDifyIds && userDifyIds.length > 0;
        const hasSelfKb = userSelfKbIds && userSelfKbIds.length > 0;
        if (hasMcp)    _explicitLoaders.push(mcpClient.getActiveToolDeclarations(db, null));
        if (hasDify)   _explicitLoaders.push(getDifyFunctionDeclarations(db, null));
        if (hasSelfKb) _explicitLoaders.push(getSelfKbDeclarations(db, req.user.id));
        const _explicitResults = await Promise.all(_explicitLoaders);
        let _idx = 0;
        if (hasMcp) {
          const { functionDeclarations: allMcpDecls, serverMap: sm } = _explicitResults[_idx++];
          serverMap = sm;
          const hasSkillDisable = allSkillsToProcess.some(sk => sk.mcp_tool_mode === 'disable');
          if (!hasSkillDisable) {
            const selectedIds = userMcpIds.map(Number);
            const selected = allMcpDecls.filter(d => {
              const entry = sm[d.name];
              return entry && selectedIds.includes(Number(entry.server.id));
            });
            allDeclarations.push(...selected);
          }
        }
        if (hasDify) {
          const { declarations, kbMap: km } = _explicitResults[_idx++];
          kbMap = km;
          const selectedIds = userDifyIds.map(Number);
          const selected = declarations.filter(d => {
            const kb = km[d.name];
            return kb && selectedIds.includes(Number(kb.id));
          });
          allDeclarations.push(...selected);
        }
        if (hasSelfKb) {
          const { declarations, kbMap: km } = _explicitResults[_idx++];
          selfKbMap = km;
          const selected = declarations.filter(d => {
            const kb = km[d.name];
            return kb && userSelfKbIds.includes(String(kb.id));
          });
          allDeclarations.push(...selected);
        }
        console.log(`[Chat] Explicit tool mode: mcp=${userMcpIds?.length||0} api=${userDifyIds?.length||0} selfkb=${userSelfKbIds?.length||0} → ${allDeclarations.length} tools`);
      } else {
        // ── Auto mode: load all accessible tools in parallel + intent filtering ──
        const [_mcpResult, _difyResult, _selfKbResult] = await Promise.all([
          mcpClient.getActiveToolDeclarations(db, userCtx),
          getDifyFunctionDeclarations(db, userCtx),
          getSelfKbDeclarations(db, req.user.id),
        ]);
        const { functionDeclarations: allMcpDecls, serverMap: sm } = _mcpResult;
        serverMap = sm;
        const { declarations: difyDecls, kbMap: km } = _difyResult;
        kbMap = km;
        const { declarations: selfKbDecls, kbMap: skm } = _selfKbResult;
        selfKbMap = skm;

        // ── Apply Skill MCP tool mode filtering ─────────────────────────────
        const skillMcpRules = sessionSkills
          .filter(sk => sk.mcp_tool_mode && sk.mcp_tool_mode !== 'append' || (sk.mcp_tool_ids && sk.mcp_tool_ids !== '[]' && sk.mcp_tool_ids !== 'null'))
          .map(sk => ({
            mode: sk.mcp_tool_mode || 'append',
            serverIds: (() => { try { return JSON.parse(sk.mcp_tool_ids || '[]'); } catch { return []; } })(),
          }))
          .filter(r => r.mode !== 'append' || r.serverIds.length > 0);

        let filteredAllMcpDecls = allMcpDecls;
        if (skillMcpRules.length > 0) {
          const hasDisable = skillMcpRules.some(r => r.mode === 'disable');
          if (hasDisable) {
            filteredAllMcpDecls = [];
            console.log('[Skill] MCP tool mode=disable → all MCP tools removed');
          } else {
            const exclusiveServerIds = new Set();
            const appendServerIds = new Set();
            let hasExclusive = false;
            for (const rule of skillMcpRules) {
              if (rule.mode === 'exclusive') { hasExclusive = true; rule.serverIds.forEach(id => exclusiveServerIds.add(id)); }
              else if (rule.mode === 'append') { rule.serverIds.forEach(id => appendServerIds.add(id)); }
            }
            if (hasExclusive) {
              const allowedServerIds = new Set([...exclusiveServerIds, ...appendServerIds]);
              filteredAllMcpDecls = allMcpDecls.filter(decl => { const e = sm[decl.name]; return e && allowedServerIds.has(e.server.id); });
              console.log(`[Skill] MCP tool mode=exclusive, allowed servers=${[...allowedServerIds].join(',')}, tools=${filteredAllMcpDecls.length}`);
            } else if (appendServerIds.size > 0) {
              const alreadyIncluded = new Set(allMcpDecls.map(d => sm[d.name]?.server.id));
              const toForceAdd = [...appendServerIds].filter(id => !alreadyIncluded.has(id));
              if (toForceAdd.length > 0) {
                const extraDecls = [];
                for (const sid of toForceAdd) {
                  const srv = await db.prepare(`SELECT * FROM mcp_servers WHERE id=? AND is_active=1`).get(sid);
                  if (!srv || !srv.tools_json) continue;
                  try {
                    const tools = JSON.parse(srv.tools_json);
                    for (const tool of tools) {
                      if (!tool.name) continue;
                      const safeName = tool.name.replace(/[^a-zA-Z0-9_]/g, '_');
                      extraDecls.push({ name: safeName, description: tool.description || tool.name, parameters: tool.inputSchema || { type: 'object', properties: {} } });
                      sm[safeName] = { server: srv, originalName: tool.name };
                    }
                  } catch (_) { }
                }
                filteredAllMcpDecls = [...allMcpDecls, ...extraDecls];
                console.log(`[Skill] MCP tool mode=append, force-added ${extraDecls.length} tools from ${toForceAdd.length} servers`);
              }
            }
          }
        }
        // ── End Skill MCP filtering ──────────────────────────────────────────

        // ── Apply Skill KB binding (self_kb_ids + dify_kb_ids + kb_mode) ──────
        for (const sk of allSkillsToProcess) {
          const skSelfKbIds = (() => { try { return JSON.parse(sk.self_kb_ids || '[]'); } catch { return []; } })();
          const skDifyKbIds = (() => { try { return JSON.parse(sk.dify_kb_ids || '[]'); } catch { return []; } })();
          const kbMode = sk.kb_mode || 'append';

          if (kbMode === 'disable') {
            // Remove all KB declarations (but keep MCP)
            difyDecls.length = 0;
            selfKbDecls.length = 0;
            console.log(`[Skill] KB mode=disable for "${sk.name}" → all KBs removed`);
          } else if (kbMode === 'exclusive') {
            // Only keep specified KBs
            const allowedDifyIds = new Set(skDifyKbIds.map(Number));
            const allowedSelfIds = new Set(skSelfKbIds.map(String));
            difyDecls.splice(0, difyDecls.length, ...difyDecls.filter(d => { const kb = km[d.name]; return kb && allowedDifyIds.has(Number(kb.id)); }));
            selfKbDecls.splice(0, selfKbDecls.length, ...selfKbDecls.filter(d => { const kb = skm[d.name]; return kb && allowedSelfIds.has(String(kb.id)); }));
            console.log(`[Skill] KB mode=exclusive for "${sk.name}" → dify=${difyDecls.length} selfkb=${selfKbDecls.length}`);
          } else if (kbMode === 'append') {
            // Force-add specified KBs even if not in user's access list
            for (const kbId of skSelfKbIds) {
              const alreadyHas = selfKbDecls.some(d => skm[d.name]?.id === kbId);
              if (!alreadyHas) {
                const kb = await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kbId);
                if (kb) {
                  const declName = `selfkb_${kb.id}`;
                  selfKbDecls.push({ name: declName, description: `自建知識庫查詢「${kb.name}」。適用範疇：${(kb.description || '').slice(0, 200)}`, parameters: { type: 'object', properties: { query: { type: 'string', description: '查詢關鍵字' } }, required: ['query'] } });
                  skm[declName] = kb;
                  console.log(`[Skill] KB append: force-added selfkb "${kb.name}"`);
                }
              }
            }
            for (const kbId of skDifyKbIds) {
              const alreadyHas = difyDecls.some(d => km[d.name]?.id === Number(kbId));
              if (!alreadyHas) {
                const kb = await db.prepare('SELECT * FROM dify_knowledge_bases WHERE id=? AND is_active=1').get(kbId);
                if (kb) {
                  const { buildFunctionDeclaration } = require('../services/apiConnectorService');
                  const decl = buildFunctionDeclaration(kb);
                  difyDecls.push(decl);
                  km[decl.name] = kb;
                  console.log(`[Skill] KB append: force-added api "${kb.name}"`);
                }
              }
            }
          }
        }

        // ── post_answer skills with no KB bindings → suppress KB TAG routing ──
        // A post_answer skill (e.g. TTS) processes the AI response and doesn't need KBs.
        // If such a skill is active and no inject/answer skill explicitly requested KBs,
        // clear KB pools so TAG routing can't accidentally pull in unrelated KBs.
        if (postAnswerSkills.length > 0 && externalInjectSkills.length === 0) {
          const postAnswerHasKb = postAnswerSkills.some(sk => {
            const dIds = (() => { try { const v = JSON.parse(sk.dify_kb_ids || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })();
            const sIds = (() => { try { const v = JSON.parse(sk.self_kb_ids || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })();
            return dIds.length > 0 || sIds.length > 0;
          });
          if (!postAnswerHasKb) {
            difyDecls.length = 0;
            selfKbDecls.length = 0;
            console.log('[Skill] post_answer skill(s) with no KB bindings → suppressed KB TAG routing');
          }
        }

        // ── Skip auto tool discovery when skills are manually attached ──────
        // Saves 200-1500ms by avoiding LLM intent classification calls.
        // Skills define their tool needs via kb_mode / mcp_tool_mode bindings.
        if (sessionSkills.length > 0) {
          allDeclarations = [...filteredAllMcpDecls, ...difyDecls, ...selfKbDecls];
          console.log(`[Chat] Skill-attached: skip auto-routing, mcp=${filteredAllMcpDecls.length} dify=${difyDecls.length} selfkb=${selfKbDecls.length} total=${allDeclarations.length}`);
        } else {
          // ── TAG-based auto-routing (only when no skills attached) ─────────
          const recentCtx = historyMessages.slice(-4)
            .map(m => `${m.role === 'user' ? '使用者' : 'AI'}: ${m.content.slice(0, 300)}`).join('\n');

          try {
            const { autoRouteByTags } = require('../services/tagRouter');
            // Build unified tool list with tags
            const allToolsWithTags = [
              ...filteredAllMcpDecls.map(d => {
                const entry = sm[d.name];
                const tags = (() => { try { return JSON.parse(entry?.server?.tags || '[]'); } catch { return []; } })();
                return { ...d, tags, toolType: 'mcp' };
              }),
              ...difyDecls.map(d => {
                const kb = km[d.name];
                const tags = (() => { try { return JSON.parse(kb?.tags || '[]'); } catch { return []; } })();
                return { ...d, tags, toolType: kb?.connector_type === 'rest_api' ? 'api' : 'dify' };
              }),
              ...selfKbDecls.map(d => {
                const kb = skm[d.name];
                const tags = (() => { try { return JSON.parse(kb?.tags || '[]'); } catch { return []; } })();
                return { ...d, tags, toolType: 'selfkb' };
              }),
            ];

            const hasAnyTags = allToolsWithTags.some(t => t.tags.length > 0);
            if (hasAnyTags) {
              const { selected, intentTags, method } = await autoRouteByTags(combinedUserText, recentCtx, allToolsWithTags, db);
              allDeclarations = selected.map(({ tags, toolType, ...decl }) => decl);
              console.log(`[Chat] TAG auto-route: method=${method} intentTags=[${intentTags.join(',')}] selected=${allDeclarations.length}/${allToolsWithTags.length}`);
            } else {
              // No tags defined anywhere → fallback to existing intent filtering
              const intentCtx = { db, userId: req.user.id };
              const [mcpDecls, filteredDifyDecls, filteredSelfKbDecls] = await Promise.all([
                filterMcpDeclsByIntent(combinedUserText, filteredAllMcpDecls, recentCtx, intentCtx),
                filterDifyDeclsByIntent(combinedUserText, difyDecls, recentCtx, intentCtx),
                filterDifyDeclsByIntent(combinedUserText, selfKbDecls, recentCtx, intentCtx),
              ]);
              allDeclarations = [...mcpDecls, ...filteredDifyDecls, ...filteredSelfKbDecls];
              console.log(`[Chat] Legacy intent-filter: ${allDeclarations.length} tools`);
            }
          } catch (tagErr) {
            console.warn('[Chat] TAG routing failed, falling back to intent filter:', tagErr.message);
            const intentCtx = { db, userId: req.user.id };
            const [mcpDecls, filteredDifyDecls, filteredSelfKbDecls] = await Promise.all([
              filterMcpDeclsByIntent(combinedUserText, filteredAllMcpDecls, recentCtx, intentCtx),
              filterDifyDeclsByIntent(combinedUserText, difyDecls, recentCtx, intentCtx),
              filterDifyDeclsByIntent(combinedUserText, selfKbDecls, recentCtx, intentCtx),
            ]);
            allDeclarations = [...mcpDecls, ...filteredDifyDecls, ...filteredSelfKbDecls];
          }
        }
      }

      // ── Add code skill tool declarations ───────────────────────────────
      for (const [toolName, sk] of Object.entries(codeSkillToolMap)) {
        try {
          const schema = JSON.parse(sk.tool_schema);
          allDeclarations.push({
            name: toolName,
            description: schema.description || sk.description || sk.name,
            parameters: schema.parameters || { type: 'object', properties: {} },
          });
        } catch (_) {}
      }

      // ── End tool loading ─────────────────────────────────────────────────

      // ── Explicit KB bypass: user asked to skip KB and use LLM directly ──
      if (userWantsSkipKb(combinedUserText)) {
        const before = allDeclarations.length;
        allDeclarations = allDeclarations.filter(d => !kbMap[d.name] && !selfKbMap[d.name]);
        console.log(`[Chat] User skip-KB flag: removed ${before - allDeclarations.length} KB tools, remaining=${allDeclarations.length}`);
      }

      // ── P3: Task Planner — detect multi-step request and execute via pipelineRunner ──
      if (!docTemplateId) { // Template mode has its own pipeline; skip P3 for it
        const agents = require('../services/pipelineAgents');
        if (agents._isLikelyMultiStep(combinedUserText)) {
          try {
            // Build capability list from available tools
            const capabilities = [
              ...allDeclarations.map(d => ({ name: d.name, type: 'tool', description: d.description || '' })),
              ...sessionSkills.map(sk => ({ name: sk.name, type: 'skill', description: sk.description || '' })),
            ].slice(0, 40);

            const plan = await agents.planDynamicTask(combinedUserText, recentCtx, capabilities);
            if (plan?.nodes?.length >= 2) {
              console.log(`[P3:Planner] Executing dynamic plan with ${plan.nodes.length} nodes`);
              sendEvent({ type: 'status', message: `規劃任務中：${plan.summary || '多步驟執行'}` });
              const { text: planText, generatedFiles: planFiles } = await agents.executeDynamicPlan(
                plan.nodes,
                combinedUserText,
                db,
                { userId: req.user.id, sessionId, user: req.user },
                sendEvent
              );
              // Save message and send results
              await saveMessage(db, sessionId, 'model', planText, [], inputTokensCount, 0);
              if (planFiles.length > 0) {
                const clientFiles = planFiles.map(f => ({ type: f.filename?.split('.').pop() || 'file', filename: f.filename, publicUrl: f.publicUrl }));
                sendEvent({ type: 'generated_files', files: clientFiles });
              }
              sendEvent({ type: 'done', content: planText });
              return res.end();
            }
          } catch (planErr) {
            console.warn('[P3:Planner] Plan execution failed, falling back to normal flow:', planErr.message);
          }
        }
      }

      if (allDeclarations.length > 0) {
        const mcpCount = allDeclarations.filter(d => !d.name.startsWith('selfkb_') && !kbMap[d.name]).length;
        const kbTotal  = allDeclarations.length - mcpCount;

        // ── Fast path: pure SelfKB only (no MCP, no DIFY) → pre-fetch + stream ──
        const pureSelfKb = mcpCount === 0 && allDeclarations.every(d => selfKbMap[d.name]);
        // ── Fast path: pure API connector only (no MCP, no selfKB) → pre-fetch + stream ──
        // Only if all connectors have NO user_input params (system/fixed params can be auto-resolved)
        const { executeConnector: execConn, parseJson: pj } = require('../services/apiConnectorService');
        const allAreConnectors = allDeclarations.every(d => kbMap[d.name]);
        const hasUserInputParams = allAreConnectors && allDeclarations.some(d => {
          const kb = kbMap[d.name];
          const params = pj(kb.input_params) || [];
          return params.some(p => p.source === 'user_input');
        });
        const pureDify = mcpCount === 0 && allAreConnectors && !hasUserInputParams;

        if (pureDify) {
          sendEvent({ type: 'status', message: `查詢 ${allDeclarations.length} 個 API 連接器...` });
          const apiUserCtx = {
            id: req.user.id,
            email: req.user.email || '',
            name: req.user.name || '',
            employee_id: req.user.employee_id || '',
            dept_code: req.user.dept_code || '',
            title: req.user.title || '',
          };
          const difyContextParts = await Promise.all(
            allDeclarations.map(async (decl) => {
              const kb = kbMap[decl.name];
              if (!kb) return null;
              const t1 = Date.now();
              try {
                const answer = await execConn(kb, { query: combinedUserText }, apiUserCtx, {
                  sessionId, db, getDifyConvId, setDifyConvId,
                });
                console.log(`[API] Fast-path "${kb.name}" ok in ${Date.now() - t1}ms answer="${(answer || '').slice(0, 150)}"`);
                if (!answer || !answer.trim() || answer.startsWith(`[${kb.name}: 查詢失敗`)) return null;
                return `## 知識庫：${kb.name}\n\n${answer}`;
              } catch (e) {
                console.warn(`[API] Fast-path "${kb.name}" failed:`, e.message);
                return null;
              }
            })
          );
          const difyContext = difyContextParts.filter(Boolean).join('\n\n---\n\n');

          // ── Post-retrieval relevance check ───────────────────────────────
          let difyIsRelevant = false;
          if (difyContext) {
            sendEvent({ type: 'status', message: '驗證知識庫相關性...' });
            difyIsRelevant = await checkKbRelevance(combinedUserText, difyContext, { db, userId: req.user.id });
            if (!difyIsRelevant) console.log('[Chat] DIFY post-retrieval: NOT relevant, discarding KB context');
          }
          const effectiveDifyContext = difyIsRelevant ? difyContext : '';
          const difyInstruction = effectiveDifyContext
            ? `以下是從知識庫檢索到的相關資料，請優先根據這些資料回答問題：\n\n${effectiveDifyContext}`
            : '';
          // KB relevant → disable Google Search (防止 Search 污染 KB 資料)
          // KB not relevant → enable Google Search (讓 LLM 自行搜尋回答)
          const difyDisableSearch = difyIsRelevant ? true : disableSearchForSkill;

          sendEvent({ type: 'status', message: 'AI 整理回覆中...' });
          const finalInstruction = [skillExtraInstruction, templateExtraInstruction, difyInstruction, langInstruction].filter(Boolean).join('\n\n---\n\n');
          let firstChunkReceived = false;
          const keepAliveInterval = setInterval(() => {
            if (!firstChunkReceived && !clientDisconnected) sendEvent({ type: 'status', message: 'AI 整理回覆中...' });
            else clearInterval(keepAliveInterval);
          }, 15000);
          try {
            const _onChunk = (chunk) => {
              if (clientDisconnected) throw new Error('CLIENT_DISCONNECTED');
              if (!_timing.ttft) _timing.ttft = Date.now();
              firstChunkReceived = true; aiText += chunk;
              sendEvent({ type: 'chunk', content: chunk });
            };
            if (providerType === 'azure_openai' && modelRow) {
              ({ text, inputTokens, outputTokens } = await streamChatAoai(modelRow, history, userParts, _onChunk, finalInstruction, genConfig));
            } else {
              ({ text, inputTokens, outputTokens } = await streamChat(apiModel, history, userParts, _onChunk, finalInstruction, difyDisableSearch, genConfig));
            }
          } finally {
            clearInterval(keepAliveInterval);
          }
          _timing.llmEnd = Date.now();
          console.log(`[Chat] DIFY fast-path done in ${Date.now() - t0}ms, kbs=${allDeclarations.length} relevant=${difyIsRelevant} in=${inputTokens} out=${outputTokens} tokens`);

        } else if (pureSelfKb) {
          sendEvent({ type: 'status', message: `查詢 ${kbTotal} 個知識庫...` });

          // Run all KB searches in parallel
          const kbContextParts = await Promise.all(
            allDeclarations.map(async (decl) => {
              const kb = selfKbMap[decl.name];
              if (!kb) return null;
              const t1 = Date.now();
              const result = await executeSelfKbSearch(db, kb, combinedUserText, { userId: req.user.id, sessionId });
              console.log(`[SelfKB] "${kb.name}" prefetch done in ${Date.now() - t1}ms`);
              if (!result?.trim() || result.startsWith('[知識庫') && result.includes('未找到相關內容')) return null;
              return `## 知識庫：${kb.name}\n\n${result}`;
            })
          );

          const kbContext = kbContextParts.filter(Boolean).join('\n\n---\n\n');

          // ── Post-retrieval relevance check ───────────────────────────────
          let kbIsRelevant = false;
          if (kbContext) {
            sendEvent({ type: 'status', message: '驗證知識庫相關性...' });
            kbIsRelevant = await checkKbRelevance(combinedUserText, kbContext, { db, userId: req.user.id });
            if (!kbIsRelevant) console.log('[Chat] SelfKB post-retrieval: NOT relevant, discarding KB context');
          }
          const effectiveKbContext = kbIsRelevant ? kbContext : '';
          const kbInstruction = effectiveKbContext
            ? `以下是從知識庫檢索到的相關資料，請優先根據這些資料回答問題：\n\n${effectiveKbContext}`
            : '';
          // KB relevant → disable Google Search (防止 Search 污染 KB 資料)
          // KB not relevant → enable Google Search (讓 LLM 自行搜尋回答)
          const selfKbDisableSearch = kbIsRelevant ? true : disableSearchForSkill;

          sendEvent({ type: 'status', message: 'AI 思考中...' });

          const finalInstruction = [skillExtraInstruction, templateExtraInstruction, kbInstruction, langInstruction].filter(Boolean).join('\n\n---\n\n');
          let firstChunkReceived = false;
          const keepAliveInterval = setInterval(() => {
            if (!firstChunkReceived && !clientDisconnected) sendEvent({ type: 'status', message: 'AI 思考中...' });
            else clearInterval(keepAliveInterval);
          }, 15000);

          try {
            const _onChunk = (chunk) => {
              if (clientDisconnected) throw new Error('CLIENT_DISCONNECTED');
              if (!_timing.ttft) _timing.ttft = Date.now();
              firstChunkReceived = true; aiText += chunk;
              sendEvent({ type: 'chunk', content: chunk });
            };
            if (providerType === 'azure_openai' && modelRow) {
              ({ text, inputTokens, outputTokens } = await streamChatAoai(modelRow, history, userParts, _onChunk, finalInstruction, genConfig));
            } else {
              ({ text, inputTokens, outputTokens } = await streamChat(apiModel, history, userParts, _onChunk, finalInstruction, selfKbDisableSearch, genConfig));
            }
          } finally {
            clearInterval(keepAliveInterval);
          }
          _timing.llmEnd = Date.now();
          console.log(`[Chat] SelfKB fast-path done in ${Date.now() - t0}ms, kbs=${kbTotal} relevant=${kbIsRelevant} in=${inputTokens} out=${outputTokens} tokens`);

        } else {
          // ── Tool-calling path (MCP and/or DIFY mixed) ──────────────────────
          sendEvent({ type: 'status', message: `已載入 ${mcpCount} 個 MCP 工具、${kbTotal} 個知識庫` });

          const calledDifyKbs = new Set();
          const calledSelfKbs = new Set();

          const toolHandler = async (toolName, args) => {
            // ── Code skill tool handling ──────────────────────────────────
            if (codeSkillToolMap[toolName]) {
              const sk = codeSkillToolMap[toolName];

              // ── ERP proc 分支 ────────────────────────────────────────
              if (sk.type === 'erp_proc') {
                const erpToolId = sk.erp_tool_id || sk.ERP_TOOL_ID;
                sendEvent({ type: 'status', message: `呼叫 ERP：${sk.name}` });
                console.log(`[ERP-Call] tool=${toolName} args=${JSON.stringify(args)}`);
                try {
                  const erpExec = require('../services/erpToolExecutor');
                  const out = await execWithHeartbeat(sendEvent, sk.name,
                    erpExec.execute(db, erpToolId, args || {}, req.user, {
                      trigger_source: 'llm_tool_call',
                      session_id: sessionId,
                    }));
                  if (out.requires_confirmation) {
                    sendEvent({
                      type: 'erp_confirm',
                      tool_id: erpToolId,
                      tool_code: toolName,
                      confirmation_token: out.confirmation_token,
                      summary: out.summary,
                      args: args || {},
                    });
                    return `[等待使用者確認 WRITE 操作] ${out.summary}。使用者同意後會手動確認執行,你現在不用再呼叫此工具。`;
                  }
                  const summary = {
                    ok: true,
                    duration_ms: out.duration_ms,
                    rows_returned: out.rows_returned,
                    cache_key: out.cache_key,
                    result: out.result,
                  };
                  return JSON.stringify(summary);
                } catch (e) {
                  return `[ERP 工具執行失敗: ${e.message}]\n(LLM 傳入參數: ${JSON.stringify(args)})`;
                }
              }

              sendEvent({ type: 'status', message: `執行技能程式：${sk.name}` });
              const _t0 = Date.now();
              try {
                const resp = await fetch(sk.endpoint_url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...(sk.endpoint_secret ? { Authorization: `Bearer ${sk.endpoint_secret}` } : {}) },
                  body: JSON.stringify({ ...args, user_message: combinedUserText, user_id: req.user.id, session_id: sessionId, recent_messages: recentMessages }),
                  signal: AbortSignal.timeout(120000),
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                const result = data.content || data.result || JSON.stringify(data);
                try { await db.prepare(`INSERT INTO skill_call_logs (skill_id, user_id, session_id, query_preview, response_preview, status, duration_ms) VALUES (?,?,?,?,?,?,?)`).run(sk.id, req.user.id, sessionId, JSON.stringify(args).slice(0, 200), String(result).slice(0, 200), 'ok', Date.now() - _t0); } catch (_) {}
                return result;
              } catch (e) {
                try { await db.prepare(`INSERT INTO skill_call_logs (skill_id, user_id, session_id, query_preview, status, error_msg, duration_ms) VALUES (?,?,?,?,?,?,?)`).run(sk.id, req.user.id, sessionId, JSON.stringify(args).slice(0, 200), 'error', e.message, Date.now() - _t0); } catch (_) {}
                return `[技能程式執行失敗: ${e.message}]`;
              }
            }
            if (selfKbMap[toolName]) {
              if (calledSelfKbs.has(toolName)) {
                console.warn(`[SelfKB] Duplicate call prevented for ${toolName}`);
                return `[知識庫已在本輪查詢過，請直接使用先前的查詢結果]`;
              }
              calledSelfKbs.add(toolName);
              const kb = selfKbMap[toolName];
              sendEvent({ type: 'status', message: `查詢知識庫：${kb.name}` });
              return await executeSelfKbSearch(db, kb, args.query || combinedUserText, { userId: req.user.id, sessionId });
            }
            if (kbMap[toolName]) {
              if (calledDifyKbs.has(toolName)) {
                console.warn(`[API] Duplicate call prevented for ${toolName}`);
                return `[此工具已在本輪查詢過，請直接使用先前的查詢結果]`;
              }
              calledDifyKbs.add(toolName);
              const kb = kbMap[toolName];
              const connType = kb.connector_type || 'dify';
              sendEvent({ type: 'status', message: connType === 'dify' ? `查詢知識庫：${kb.name}` : `呼叫 API：${kb.name}` });
              const { query: _q, ...restArgs } = args || {};
              return await executeDifyQuery(db, kb, _q || combinedUserText, sessionId, req.user.id, req.user, restArgs);
            }
            const entry = serverMap[toolName];
            if (!entry) return `[未知工具: ${toolName}]`;
            sendEvent({ type: 'status', message: `呼叫工具：${toolName}` });
            // userCtx 只在 server.send_user_token=1 時才會被用來簽 X-User-Token JWT
            const mcpUserCtx = {
              id: req.user.id,
              email: req.user.email || '',
              name: req.user.name || '',
              employee_id: req.user.employee_id || '',
              dept_code: req.user.dept_code || '',
            };
            return await mcpClient.callTool(db, entry.server, sessionId, req.user.id, entry.originalName, args, mcpUserCtx);
          };

          // Build set of tool names that should bypass LLM and return raw result directly
          const directAnswerTools = new Set(
            Object.entries(serverMap)
              .filter(([, entry]) => entry.server?.response_mode === 'answer')
              .map(([toolName]) => toolName)
          );

          let isDirectAnswer = false;
          let firstToolChunk = false;
          const _onToolChunk = (chunk) => {
            if (clientDisconnected) throw new Error('CLIENT_DISCONNECTED');
            if (!_timing.ttft) _timing.ttft = Date.now();
            if (!firstToolChunk) { firstToolChunk = true; }
            aiText += chunk;
            sendEvent({ type: 'chunk', content: chunk });
          };
          const _onToolStatus = (msg) => {
            sendEvent({ type: 'status', message: msg });
          };
          ({ text, inputTokens, outputTokens, isDirectAnswer } = await generateWithToolsStream(
            apiModel, history, userParts, allDeclarations, toolHandler,
            _onToolChunk, _onToolStatus, skillExtraInstruction,
            { directAnswerTools }, genConfig
          ));
          if (isDirectAnswer && text) {
            // Direct answer mode: wasn't streamed — send as one chunk
            const displayText = text.replace(/\n/g, '  \n');
            aiText = displayText;
            sendEvent({ type: 'chunk', content: displayText });
          }
          _timing.llmEnd = Date.now();
          console.log(`[Chat] Tools+Gemini done in ${Date.now() - t0}ms, tools=${allDeclarations.length} api_called=${calledDifyKbs.size} mcp_called=${Object.keys(serverMap).length > 0 ? 'yes' : 'no'} in=${inputTokens} out=${outputTokens} tokens`);
        }
      } else {
        // ── Standard streaming chat (no tools) ───────────────────────────
        // Send an initial status event so the proxy knows the connection is alive
        // (Gemini with google search grounding can take several seconds before first chunk)
        sendEvent({ type: 'status', message: 'AI 思考中...' });

        // Keep-alive heartbeat: send a status ping every 15s while waiting for Gemini chunks
        // This prevents Vite proxy / nginx from killing the idle SSE connection
        let firstChunkReceived = false;
        const keepAliveInterval = setInterval(() => {
          if (!firstChunkReceived && !clientDisconnected) {
            sendEvent({ type: 'status', message: 'AI 思考中...' });
          } else {
            clearInterval(keepAliveInterval);
          }
        }, 15000);

        try {
          const _onChunk = (chunk) => {
            if (clientDisconnected) throw new Error('CLIENT_DISCONNECTED');
            if (!_timing.ttft) _timing.ttft = Date.now();
            firstChunkReceived = true; aiText += chunk;
            sendEvent({ type: 'chunk', content: chunk });
          };
          const combinedInstruction = [skillExtraInstruction, templateExtraInstruction].filter(Boolean).join('\n\n---\n\n') || skillExtraInstruction;
          if (providerType === 'azure_openai' && modelRow) {
            ({ text, inputTokens, outputTokens } = await streamChatAoai(modelRow, history, userParts, _onChunk, combinedInstruction, genConfig));
          } else {
            ({ text, inputTokens, outputTokens } = await streamChat(apiModel, history, userParts, _onChunk, combinedInstruction, disableSearchForSkill, genConfig));
          }
        } finally {
          clearInterval(keepAliveInterval);
        }
        _timing.llmEnd = Date.now();
        console.log(`[Chat] ${providerType === 'azure_openai' ? 'AOAI' : 'Gemini'} done in ${Date.now() - t0}ms, in=${inputTokens} out=${outputTokens} tokens`);
      }

      _timing.postStart = Date.now();

      // Debug: check if response contains generate blocks
      const blockHeaders = text.match(/```generate_\w+:[^\n]+/g);
      console.log(`[Chat] Generate block headers in response: ${blockHeaders ? JSON.stringify(blockHeaders) : 'none'}`);

      if (!docTemplateId && blockHeaders && blockHeaders.length > 0) {
        sendEvent({ type: 'status', message: `正在生成 ${blockHeaders.length} 個檔案...` });
      }

      // When a doc template is selected, skip free-form file generation entirely
      const generatedFiles = docTemplateId ? [] : await processGenerateBlocks(text, sessionId);
      if (generatedFiles.length > 0) {
        const clientFiles = generatedFiles.map(({ type, filename, publicUrl }) => ({ type, filename, publicUrl }));
        sendEvent({ type: 'generated_files', files: clientFiles });
        allGeneratedFiles = clientFiles;
      }

      // ── Skill output_template_id: generate file from AI JSON output ────────
      if (skillOutputTemplateIds && skillOutputTemplateIds.length > 0) {
        const { parseJsonFromAiOutput, generateDocumentFromJson } = require('../services/docTemplateService');
        const jsonData = parseJsonFromAiOutput(text);
        if (jsonData) {
          const skillTemplateFiles = [];
          for (const tid of skillOutputTemplateIds) {
            try {
              sendEvent({ type: 'status', message: '正在生成範本文件...' });
              const tplFile = await generateDocumentFromJson(db, tid, jsonData, req.user);
              const ext = tplFile.filename.split('.').pop();
              const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
              const skillAiName = jsonData._ai_filename
                ? jsonData._ai_filename.replace(/[\\/:*?"<>|]/g, '').trim()
                : '';
              const skillFilename = skillAiName ? `${skillAiName}_${todayStr}.${ext}` : tplFile.filename;
              skillTemplateFiles.push({ type: ext, filename: skillFilename, publicUrl: tplFile.publicUrl });
              console.log(`[Skill Template] Generated: ${tplFile.publicUrl}`);
            } catch (e) {
              console.error(`[Skill Template] template ${tid} failed:`, e.message);
            }
          }
          if (skillTemplateFiles.length > 0) {
            const allFiles = [...allGeneratedFiles, ...skillTemplateFiles];
            sendEvent({ type: 'generated_files', files: allFiles });
            allGeneratedFiles = allFiles;
          }
        } else {
          console.warn('[Skill Template] AI output is not valid JSON, skipping template generation');
        }
      }

      // ── Doc Template auto-generate: P2 → P1 → P0 → generateDocument ──────────
      if (docTemplateId && docTemplateSchema) {
        try {
          const agents = require('../services/pipelineAgents');
          const svc    = require('../services/docTemplateService');
          const valMatch = text.match(/```template_values\s*([\s\S]*?)```/);

          // P2: Schema Extractor — parse Pro block, or Flash-extract if missing/malformed
          let inputData = null;
          if (valMatch) {
            try { inputData = JSON.parse(valMatch[1].trim()); } catch {}
          }
          if (!inputData) {
            console.warn('[DocTemplate] template_values missing/malformed — P2 Flash extraction');
            sendEvent({ type: 'status', message: 'AI 提取範本數據中...' });
            inputData = await agents.extractTemplateValues(text, docTemplateSchema);
          }

          if (!inputData) throw new Error('無法從 AI 回覆中解析範本資料');

          // Extract _ai_filename before schema processing (it's not a template variable)
          let aiFilenameFromData = inputData._ai_filename;
          delete inputData._ai_filename;
          // Strip extension if AI accidentally included it (e.g. "報告.pptx" → "報告")
          if (aiFilenameFromData) {
            aiFilenameFromData = String(aiFilenameFromData).replace(/\.\w{2,5}$/, '').trim();
          }

          // Use _ai_filename as cover title: find cover_* var with largest detected fontSize
          if (aiFilenameFromData) {
            const schemaVars = docTemplateSchema.variables || [];
            const coverVars = schemaVars.filter(v => v.type !== 'loop' && /^cover_/i.test(v.key));
            if (coverVars.length > 0) {
              const titleVar = coverVars.reduce((best, v) => {
                const sz = v.style?.detected?.fontSize || 0;
                const bestSz = best?.style?.detected?.fontSize || 0;
                return sz > bestSz ? v : best;
              }, coverVars[0]);
              console.log(`[DocTemplate] Cover title: ${titleVar.key} = "${aiFilenameFromData}" (was "${inputData[titleVar.key]}")`);
              inputData[titleVar.key] = aiFilenameFromData;
            }
          }

          // P1: Schema Validator + AutoFix
          // In rich mode, preserve slides — P1 validates against template schema
          // which doesn't understand rich types (dashboard, chart, timeline, etc.)
          const richSlidesBak = (pptxRenderMode === 'rich' && Array.isArray(inputData.slides))
            ? JSON.parse(JSON.stringify(inputData.slides)) : null;
          inputData = await agents.validateAndFixSchema(inputData, docTemplateSchema);
          if (richSlidesBak) {
            inputData.slides = richSlidesBak;
            console.log(`[DocTemplate] Rich mode: restored ${richSlidesBak.length} slides after P1 validation`);
          }

          // P0: Layout Engine — only for template-format mode, NOT rich/free mode
          const isPptxLayout = docTemplateSchema.pptx_settings?.slide_config?.some(c => c.type === 'layout_template');
          if (isPptxLayout && pptxRenderMode !== 'rich' && Array.isArray(inputData.slides) && inputData.slides.length > 0) {
            sendEvent({ type: 'status', message: '排版引擎優化中...' });
            inputData = await agents.runPptxLayoutEngine(inputData, docTemplateSchema);
          }

          // Inject PPTX rich mode + theme so docTemplateService picks it up
          if (pptxRenderMode === 'rich') {
            inputData._pptxRenderMode = 'rich';
            inputData._theme = pptxRichTheme || 'dark';
          }

          sendEvent({ type: 'status', message: '正在生成文件範本...' });
          const result = await svc.generateDocument(db, docTemplateId, req.user.id, inputData, docTemplateOutputFmt);
          const ext = result.filePath.split('.').pop();
          const publicUrl = `/uploads/${result.filePath}`;
          // Use AI-suggested filename + date, fallback to template name
          const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const aiName = aiFilenameFromData
            ? String(aiFilenameFromData).replace(/[\\/:*?"<>|]/g, '').trim()
            : '';
          const baseName = aiName || docTemplateName;
          const tplFile = { type: ext, filename: `${baseName}_${today}.${ext}`, publicUrl };
          const allFiles = [...allGeneratedFiles, tplFile];
          sendEvent({ type: 'generated_files', files: allFiles });
          allGeneratedFiles = allFiles;
          console.log(`[DocTemplate] Auto-generated: ${publicUrl}`);
        } catch (e) {
          console.error('[DocTemplate] Auto-generate failed:', e.message, '\n', e.stack);
          sendEvent({ type: 'chunk', content: `\n\n⚠️ 文件自動生成失敗: ${e.message}` });
          text += `\n\n⚠️ 文件自動生成失敗: ${e.message}`;
        }
      }

      displayText = text
        .replace(/```generate_[a-z]+:[^\n]+\n[\s\S]*?```/g, '')
        .replace(/```template_values[\s\S]*?```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // ── Post-answer skills (run after Gemini, receive AI response as input) ──
    for (const sk of postAnswerSkills) {
      try {
        sendEvent({ type: 'status', message: `Skill: ${sk.name} 後處理中...` });
        const resp = await Promise.race([
          fetch(sk.endpoint_url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Source': 'foxlink-gpt',
              ...(sk.endpoint_secret ? { Authorization: `Bearer ${sk.endpoint_secret}` } : {}),
            },
            body: JSON.stringify({
              user_message: combinedUserText,
              ai_response: displayText || text,
              session_id: sessionId,
              user_id: req.user.id,
              recent_messages: recentMessages,
            }),
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000)),
        ]);
        if (resp.ok) {
          const data = await resp.json();
          console.log(`[Skill] post_answer "${sk.name}" keys=${Object.keys(data).join(',')}`);
          // ── Pending TTS: skill needs voice preference before synthesizing ──
          if (data.pending === true) {
            pendingTtsMap.set(sessionId, { aiResponse: displayText || text, sk, timestamp: Date.now() });
            console.log(`[TTS pending] Stored pending TTS for session ${sessionId}`);
            // Append the prompt asking user for voice preference to the AI response
            if (data.system_prompt) {
              displayText = (displayText || text) + data.system_prompt;
            }
            continue;
          }
          if (data.audio_url) {
            let audioUrl = data.audio_url;
            try {
              const audioPath = path.join(UPLOAD_DIR, 'generated', path.basename(data.audio_url));
              if (fs.existsSync(audioPath)) {
                const buf = fs.readFileSync(audioPath);
                audioUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`;
              }
            } catch (_) {}
            sendEvent({ type: 'audio', audio_url: audioUrl, filename: path.basename(data.audio_url || 'output.mp3') });
          }
          if (data.files && Array.isArray(data.files)) {
            sendEvent({ type: 'generated_files', files: data.files });
          }
          if (data.content && !data.audio_url) {
            // Append to display text if skill returned additional content
            displayText = (displayText || text) + '\n\n' + data.content;
          }
        } else {
          console.warn(`[Skill] post_answer HTTP ${resp.status} for "${sk.name}"`);
        }
        try {
          await db.prepare(`INSERT INTO skill_call_logs (skill_id, user_id, session_id, query_preview, status, duration_ms) VALUES (?,?,?,?,?,?)`)
            .run(sk.id, req.user.id, sessionId, combinedUserText.slice(0, 200), 'ok', 0);
        } catch (_) {}
      } catch (e) {
        console.warn(`[Skill] post_answer failed for "${sk.name}":`, e.message);
      }
    }

    // Save AI message
    // allGeneratedFiles is either an array (text/file path) or { generated, historyParts } (image path)
    const filesJsonToStore = (() => {
      if (!allGeneratedFiles || (Array.isArray(allGeneratedFiles) && allGeneratedFiles.length === 0)) return null;
      if (Array.isArray(allGeneratedFiles)) return JSON.stringify(allGeneratedFiles);
      // Object format (image-output): { generated, historyParts }
      return JSON.stringify(allGeneratedFiles);
    })();
    await db.prepare(
      `INSERT INTO chat_messages (session_id, role, content, input_tokens, output_tokens, files_json)
       VALUES (?, 'assistant', ?, ?, ?, ?)`
    ).run(sessionId, displayText, inputTokens, outputTokens, filesJsonToStore);

    // Update session title (first message)
    if (historyMessages.length === 0 && combinedUserText.trim()) {
      // 1. Immediately set a quick title from user message so the sidebar updates right away
      const quickTitle = combinedUserText.trim().replace(/\s+/g, ' ').slice(0, 50);
      // 防止重複或不必要的 title 事件：只有當會話目前的 title 為預設值時才更新
      const currentTitleRow = await db.prepare('SELECT title FROM chat_sessions WHERE id=?').get(sessionId);
      const currentTitle = currentTitleRow?.title;
      const DEFAULT_TITLES = new Set(['新對話', 'New Chat', 'Cuộc trò chuyện mới']);
      if (!currentTitle || DEFAULT_TITLES.has(currentTitle)) {
        await db.prepare(`UPDATE chat_sessions SET title=?, model=?, updated_at=SYSTIMESTAMP WHERE id=?`).run(
          quickTitle, chosenModel, sessionId
        );
        sendEvent({ type: 'title', title: quickTitle });
      }
      // 記錄已發送過 title，避免同一 session 重複
      if (typeof global.titleSentSessions === 'undefined') {
        global.titleSentSessions = new Set();
      }
      global.titleSentSessions.add(sessionId);
      console.log(`[Chat] Title event sent: "${quickTitle}" for session ${sessionId}`);

      // 2. Fire-and-forget: refine with LLM semantic title (no await, won't block done event)
      generateTitle(combinedUserText, text).then(async ({ title: llmTitle, title_zh, title_en, title_vi, inputTokens: tIn, outputTokens: tOut, model: tModel }) => {
        if (llmTitle) {
          await db.prepare(
            `UPDATE chat_sessions SET title=?, title_zh=?, title_en=?, title_vi=? WHERE id=?`
          ).run(llmTitle, title_zh || llmTitle, title_en || llmTitle, title_vi || llmTitle, sessionId);
          // Push updated multilingual titles to client via a title event (if SSE still open)
          try { sendEvent({ type: 'title', title: llmTitle, title_zh, title_en, title_vi }); } catch (_) {}
        }
        if (tIn || tOut) {
          const tday = new Date().toISOString().split('T')[0];
          upsertTokenUsage(db, req.user.id, tday, tModel, tIn, tOut).catch(() => {});
        }
      }).catch(() => { });
    } else {
      await db.prepare(`UPDATE chat_sessions SET updated_at=SYSTIMESTAMP WHERE id=?`).run(sessionId);
    }

    // Update token usage (upsert via SELECT+UPDATE/INSERT)
    const today = new Date().toISOString().split('T')[0];
    const imageCount = imageOutput ? (imgResult?.images?.length || 0) : 0;
    await upsertTokenUsage(db, req.user.id, today, chosenModel, inputTokens, outputTokens, imageCount);

    _timing.postEnd = Date.now();

    // ── Timing summary ────────────────────────────────────────────────────
    const _t = _timing;
    const _files  = _t.fileEnd  && _t.fileStart  ? _t.fileEnd  - _t.fileStart  : 0;
    const _skills = _t.skillEnd && _t.skillStart ? _t.skillEnd - _t.skillStart : 0;
    const _ttft   = _t.ttft     && _t.llmStart   ? _t.ttft     - _t.llmStart   : 0;
    const _llm    = _t.llmEnd   && _t.llmStart   ? _t.llmEnd   - _t.llmStart   : 0;
    const _post   = _t.postEnd  && _t.postStart  ? _t.postEnd  - _t.postStart  : 0;
    const _total  = _t.postEnd - _t.start;
    console.log(`[Chat][Timing] model=${chosenModel} files=${_files}ms skills=${_skills}ms ttft=${_ttft}ms llm_total=${_llm}ms post=${_post}ms total=${_total}ms in=${inputTokens} out=${outputTokens}`);

    sendEvent({ type: 'usage', inputTokens, outputTokens });
    sendEvent({ type: 'done' });
    clearInterval(sseKeepAlive);
    res.end();
  } catch (e) {
    // 客戶端主動中斷（停止按鈕 / 關閉分頁）→ 正常結束，不算錯誤
    if (e?.message === 'CLIENT_DISCONNECTED') {
      console.log('[Chat] Streaming stopped: client disconnected');
      clearInterval(sseKeepAlive);
      try { res.end(); } catch { }
      for (const file of uploadedFiles) {
        try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch { }
      }
      return;
    }

    console.error('[Chat] Stream error:', e?.message || e);
    console.error('[Chat] Stack:', e?.stack);
    clearInterval(sseKeepAlive);
    try {
      sendEvent({ type: 'error', message: e?.message || '發生錯誤，請稍後再試' });
      res.end();
    } catch (writeErr) {
      console.error('[Chat] Failed to send error event (connection already closed?):', writeErr.message);
      try { res.end(); } catch { }
    }

    // Cleanup tmp files on error
    for (const file of uploadedFiles) {
      try {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      } catch { }
    }
  }
});

// POST /api/chat/sessions/:id/export
router.post('/sessions/:id/export', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { format = 'txt' } = req.body;
    const session = await db
      .prepare(`SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: '找不到對話' });

    const messages = await db
      .prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`)
      .all(req.params.id);

    if (format === 'txt') {
      let text = `對話標題: ${session.title}\n日期: ${session.created_at}\n${'='.repeat(50)}\n\n`;
      messages.forEach((m) => {
        text += `[${m.role === 'user' ? '使用者' : 'AI'}] ${m.created_at}\n${m.content}\n\n`;
      });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="chat_${req.params.id}.txt"`);
      return res.send(text);
    }

    res.status(400).json({ error: '不支援的格式' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/chat/messages/:id
router.put('/messages/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { content } = req.body;
    // Verify ownership via session
    const msg = await db
      .prepare(
        `SELECT m.id FROM chat_messages m
         JOIN chat_sessions s ON m.session_id = s.id
         WHERE m.id = ? AND s.user_id = ?`
      )
      .get(req.params.id, req.user.id);
    if (!msg) return res.status(404).json({ error: '找不到訊息' });

    await db.prepare(`UPDATE chat_messages SET content = ? WHERE id = ?`).run(content, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helpers

const { upsertTokenUsage } = require('../services/tokenService');

async function checkSensitiveKeywords(db, user, sessionId, content) {
  try {
    const keywords = await db.prepare(`SELECT keyword FROM sensitive_keywords`).all();

    const lowerContent = content.toLowerCase();
    const matched = keywords
      .map((k) => k.keyword)
      .filter((kw) => lowerContent.includes(kw.toLowerCase()));

    const hasSensitive = matched.length > 0 ? 1 : 0;

    await db.prepare(
      `INSERT INTO audit_logs (user_id, session_id, content, has_sensitive, sensitive_keywords, source)
       VALUES (?, ?, ?, ?, ?, 'web')`
    ).run(user.id, sessionId, content, hasSensitive, matched.length ? JSON.stringify(matched) : null);

    if (hasSensitive) {
      // Notify admin async (don't await to not block stream)
      notifyAdminSensitiveKeyword({ user, content, keywords: matched, sessionId })
        .then(async () => {
          await db.prepare(
            `UPDATE audit_logs SET notified=1 WHERE id = (
               SELECT id FROM audit_logs WHERE user_id=? AND session_id=? ORDER BY id DESC LIMIT 1
             )`
          ).run(user.id, sessionId);
        })
        .catch((e) => console.error('[Audit] Notify error:', e.message));
    }
  } catch (e) {
    console.error('[Audit] Check error:', e.message);
  }
}

module.exports = router;
