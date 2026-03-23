const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('./auth');
const { streamChat, generateWithImage, generateWithTools, transcribeAudio, extractTextFromFile, fileToGeminiPart, generateTitle } = require('../services/gemini');
const { streamChatAoai } = require('../services/llmService');
const { processGenerateBlocks } = require('../services/fileGenerator');
const { notifyAdminSensitiveKeyword } = require('../services/mailService');
const mcpClient = require('../services/mcpClient');

// ── Self-Built Knowledge Base — function-calling approach ────────────────────

/** Load accessible self-built KBs for a user and return Gemini function declarations. */
async function getSelfKbDeclarations(db, userId) {
  try {
    const user = await db.prepare(
      'SELECT role, dept_code, profit_center, org_section, org_group_name, role_id FROM users WHERE id=?'
    ).get(userId);
    if (!user) return { declarations: [], kbMap: {} };

    let kbs;
    if (user.role === 'admin') {
      kbs = await db.prepare(
        `SELECT id, name, description, retrieval_mode, embedding_dims, top_k_return, score_threshold
         FROM knowledge_bases WHERE chunk_count > 0 ORDER BY name ASC`
      ).all();
    } else {
      kbs = await db.prepare(`
        SELECT kb.id, kb.name, kb.description, kb.retrieval_mode, kb.embedding_dims, kb.top_k_return, kb.score_threshold
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
    return { declarations, kbMap };
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

// Load active DIFY KBs for a user (dify_access-filtered) and return as Gemini function declarations
async function getDifyFunctionDeclarations(db, userCtx) {
  let kbs;
  try {
    if (!userCtx) {
      kbs = await db.prepare(
        `SELECT id, name, api_server, api_key, description FROM dify_knowledge_bases WHERE is_active=1 ORDER BY sort_order ASC`
      ).all();
    } else {
      const { userId, roleId, deptCode, profitCenter, orgSection, orgGroupName } = userCtx;
      kbs = await db.prepare(
        `SELECT DISTINCT d.id, d.name, d.api_server, d.api_key, d.description
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
        orgGroupName, orgGroupName
      );
    }
  } catch (e) {
    console.error('[DIFY] getDifyFunctionDeclarations error:', e.message);
    return { declarations: [], kbMap: {} };
  }

  const declarations = [];
  const kbMap = {};

  for (const kb of kbs) {
    // Gemini function name: only [a-zA-Z0-9_]
    const safeName = `dify_kb_${kb.id}`;
    // Wrap user description as "scope", not as LLM instructions
    const scopeText = kb.description
      ? `此工具的適用範疇：${kb.description}`
      : `企業內部知識庫「${kb.name}」`;
    const desc = `知識庫查詢工具「${kb.name}」。${scopeText}。` +
      `呼叫規則：(1) 使用者問題的核心意圖必須明確屬於上述範疇才呼叫，主題相關但意圖不符時不要呼叫；` +
      `(2) 每次對話此工具只呼叫一次，已呼叫後不得重複呼叫。`;
    declarations.push({
      name: safeName,
      description: desc,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要查詢的問題，通常與使用者輸入相同' },
        },
        required: ['query'],
      },
    });
    kbMap[safeName] = kb;
  }

  return { declarations, kbMap };
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
    console.log(`[DIFY Intent] "${userMessage.slice(0, 60)}" → [${filtered.map(d => d.name).join(',') || 'none'}]`);
    return filtered;
  } catch (e) {
    console.warn('[DIFY Intent] Classification failed, skipping all DIFY:', e.message);
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

// Execute a single DIFY KB query (called when LLM decides to invoke it)
async function executeDifyQuery(db, kb, query, sessionId, userId) {
  const t0 = Date.now();
  const conversationId = getDifyConvId(sessionId, kb.id);
  try {
    const difyRes = await fetch(`${kb.api_server}/chat-messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kb.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {},
        query,
        response_mode: 'blocking',
        conversation_id: conversationId,
        user: `foxlink-user-${userId}`,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const duration = Date.now() - t0;
    if (difyRes.ok) {
      const data = await difyRes.json();
      if (data.conversation_id) setDifyConvId(sessionId, kb.id, data.conversation_id);
      const answer = (data.answer || '').trim();
      try {
        await db.prepare(
          `INSERT INTO dify_call_logs (kb_id, session_id, user_id, query_preview, response_preview, status, duration_ms) VALUES (?,?,?,?,?,?,?)`
        ).run(kb.id, sessionId, userId, query.slice(0, 200), answer.slice(0, 300), 'ok', duration);
      } catch (_) { }
      console.log(`[DIFY] KB "${kb.name}" ok in ${duration}ms`);
      return answer || `[知識庫「${kb.name}」無相關回應]`;
    } else {
      const errText = await difyRes.text().catch(() => '');
      const msg = `HTTP ${difyRes.status}`;
      try {
        await db.prepare(
          `INSERT INTO dify_call_logs (kb_id, session_id, user_id, query_preview, status, error_msg, duration_ms) VALUES (?,?,?,?,?,?,?)`
        ).run(kb.id, sessionId, userId, query.slice(0, 200), 'error', msg, duration);
      } catch (_) { }
      console.warn(`[DIFY] KB "${kb.name}" ${msg}: ${errText.slice(0, 100)}`);
      return `[知識庫「${kb.name}」查詢失敗: ${msg}]`;
    }
  } catch (e) {
    const duration = Date.now() - t0;
    try {
      await db.prepare(
        `INSERT INTO dify_call_logs (kb_id, session_id, user_id, query_preview, status, error_msg, duration_ms) VALUES (?,?,?,?,?,?,?)`
      ).run(kb.id, sessionId, userId, query.slice(0, 200), 'error', e.message.slice(0, 200), duration);
    } catch (_) { }
    console.error(`[DIFY] KB "${kb.name}" failed:`, e.message);
    return `[知識庫「${kb.name}」查詢失敗: ${e.message}]`;
  }
}

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const upload = multer({
  dest: path.join(UPLOAD_DIR, 'tmp'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB ceiling; per-user limits enforced below
  fileFilter: (req, file, cb) => {
    // Reject video files
    if (file.mimetype.startsWith('video/')) {
      return cb(new Error('不允許上傳影片檔案'), false);
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
              endpoint_url, api_version, deployment_name, base_model, key
       FROM llm_models WHERE key=? AND is_active=1`
    ).get(modelKey);
    if (row?.api_model) return {
      apiModel:     row.api_model,
      imageOutput:  !!row.image_output,
      providerType: row.provider_type || 'gemini',
      modelRow:     row,
    };
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
              r.budget_daily AS role_daily, r.budget_weekly AS role_weekly, r.budget_monthly AS role_monthly
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    ).get(req.user.id);

    const limitD = budgetRow?.budget_daily ?? budgetRow?.role_daily ?? null;
    const limitW = budgetRow?.budget_weekly ?? budgetRow?.role_weekly ?? null;
    const limitM = budgetRow?.budget_monthly ?? budgetRow?.role_monthly ?? null;

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

    // Restore tool selections from log tables (MCP/DIFY) + stored context (KB)
    const usedMcpRaw  = await db.prepare(`SELECT DISTINCT server_id FROM mcp_call_logs  WHERE session_id=?`).all(req.params.id).catch(() => []);
    const usedDifyRaw = await db.prepare(`SELECT DISTINCT kb_id      FROM dify_call_logs WHERE session_id=?`).all(req.params.id).catch(() => []);
    const usedMcpIds  = usedMcpRaw.map(r => Number(r.server_id));
    const usedDifyIds = usedDifyRaw.map(r => Number(r.kb_id));
    let usedKbIds = [];
    if (session.tools_context_json) {
      try { usedKbIds = JSON.parse(session.tools_context_json).kb || []; } catch {}
    }

    res.json({ session, messages, skills, used_mcp_ids: usedMcpIds, used_dify_ids: usedDifyIds, used_kb_ids: usedKbIds });
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
    await db.prepare('DELETE FROM session_skills WHERE session_id=?').run(req.params.id);
    for (const [idx, id] of skillIds.entries()) {
      await db.prepare('INSERT INTO session_skills (session_id, skill_id, sort_order) VALUES (?,?,?)').run(req.params.id, id, idx);
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
router.post('/sessions/:id/messages', upload.array('files', 10), async (req, res) => {
  const db = require('../database-oracle').db;
  const sessionId = req.params.id;

  // Verify session ownership
  const session = await db
    .prepare(`SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?`)
    .get(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: '找不到對話' });
  }

  const { message = '', model } = req.body;

  // Explicit tool selection sent by the UI (JSON arrays or undefined)
  // When present (even as '[]'), skip auto-discovery + intent filtering for that category.
  function parseIds(raw) {
    if (raw === undefined || raw === null) return null;
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
  }
  const userMcpIds   = parseIds(req.body.mcp_server_ids);  // number[] | null
  const userDifyIds  = parseIds(req.body.dify_kb_ids);      // number[] | null
  const userSelfKbIds = parseIds(req.body.self_kb_ids);     // string[] | null
  const explicitMode = userMcpIds !== null || userDifyIds !== null || userSelfKbIds !== null;
  // 儲存工具選擇到 session（供歷史載入時恢復）
  if (explicitMode) {
    try {
      const ctx = JSON.stringify({ mcp: userMcpIds || [], dify: userDifyIds || [], kb: userSelfKbIds || [] });
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
    const mimeType = file.mimetype;
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
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
      const maxBytes = (userPerms.text_max_mb || 10) * 1024 * 1024;
      if (file.size > maxBytes) {
        fs.unlinkSync(file.path);
        return res.status(413).json({ error: `文字檔超過上限 ${userPerms.text_max_mb || 10}MB。(${originalName})` });
      }
    }
  }

  // Budget limit check (admin exempt)
  // NOTE: requires token prices configured in admin panel for cost to be non-null.
  // cost=NULL rows (unconfigured model) are treated as $0 by SQL SUM; budget still enforces on non-null rows.
  if (req.user.role !== 'admin') {
    const budgetRow = await db.prepare(
      `SELECT u.budget_daily, u.budget_weekly, u.budget_monthly,
              r.budget_daily AS role_daily, r.budget_weekly AS role_weekly, r.budget_monthly AS role_monthly
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    ).get(req.user.id);

    if (budgetRow) {
      const limitD = budgetRow.budget_daily ?? budgetRow.role_daily;
      const limitW = budgetRow.budget_weekly ?? budgetRow.role_weekly;
      const limitM = budgetRow.budget_monthly ?? budgetRow.role_monthly;

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);

      console.log(`[Budget] user=${req.user.id}(${req.user.username}) limitD=${limitD} limitW=${limitW} limitM=${limitM} date=${todayStr}`);

      // Helper: sum cost across all models; if no price configured for any model,
      // fall back to counting images * $0.04 as minimum estimate so image-only usage is still tracked.
      const sumCost = (rows) => {
        const { total, images } = rows || {};
        if ((total || 0) > 0) return total;
        // fallback: if cost is all-null but images were generated, use $0.04/image as proxy
        return (images || 0) * 0.04;
      };

      const D = `TO_DATE(?, 'YYYY-MM-DD')`;
      if (limitD != null) {
        const row = await db.prepare(
          `SELECT COALESCE(SUM(cost),0) AS total, COALESCE(SUM(image_count),0) AS images
           FROM token_usage WHERE user_id=? AND usage_date=${D}`
        ).get(req.user.id, todayStr);
        const spent = sumCost(row);
        console.log(`[Budget] daily spent=${spent} limit=${limitD}`);
        if (spent >= limitD) {
          return res.status(429).json({ error: `當日使用金額已達上限 $${limitD}（已使用 $${spent.toFixed(4)}），請明日再試。` });
        }
      }

      if (limitW != null) {
        const dow = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow));
        const mondayStr = monday.toISOString().slice(0, 10);
        const row = await db.prepare(
          `SELECT COALESCE(SUM(cost),0) AS total, COALESCE(SUM(image_count),0) AS images
           FROM token_usage WHERE user_id=? AND usage_date>=${D} AND usage_date<=${D}`
        ).get(req.user.id, mondayStr, todayStr);
        const spent = sumCost(row);
        console.log(`[Budget] weekly spent=${spent} limit=${limitW}`);
        if (spent >= limitW) {
          return res.status(429).json({ error: `本週使用金額已達上限 $${limitW}（已使用 $${spent.toFixed(4)}），請下週一再試。` });
        }
      }

      if (limitM != null) {
        const firstOfMonth = `${todayStr.slice(0, 7)}-01`;
        const row = await db.prepare(
          `SELECT COALESCE(SUM(cost),0) AS total, COALESCE(SUM(image_count),0) AS images
           FROM token_usage WHERE user_id=? AND usage_date>=${D} AND usage_date<=${D}`
        ).get(req.user.id, firstOfMonth, todayStr);
        const spent = sumCost(row);
        console.log(`[Budget] monthly spent=${spent} limit=${limitM}`);
        if (spent >= limitM) {
          return res.status(429).json({ error: `本月使用金額已達上限 $${limitM}（已使用 $${spent.toFixed(4)}），請下月一日再試。` });
        }
      }
    }
  }

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
    // Process uploaded files
    const fileMetas = [];
    const userParts = [];
    let combinedUserText = message;

    for (const file of uploadedFiles) {
      const ext = path.extname(file.originalname).toLowerCase();
      const mimeType = file.mimetype;
      const filePath = file.path;
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      console.log(`[Chat] Processing file: "${originalName}" size=${file.size} bytes mime=${mimeType}`);

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
      const MAX_PDF_INLINE_MB = 15;
      if (mimeType === 'application/pdf' && file.size <= MAX_PDF_INLINE_MB * 1024 * 1024) {
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

    // Foxlink corporate PPT detection — brand + ppt 出現就夠，不嚴格要求動作詞
    const isFoxlinkBrand = lowerMsg.includes('foxlink') || lowerMsg.includes('正崴') || lowerMsg.includes('福連');
    const isPptRequest = lowerMsg.includes('ppt') || lowerMsg.includes('簡報') || lowerMsg.includes('投影片') || lowerMsg.includes('slide');
    const wantsFoxlinkPpt = isPptRequest &&
      (isFoxlinkBrand || lowerMsg.includes('foxlink風格') || lowerMsg.includes('公司風格') || lowerMsg.includes('企業風格') || lowerMsg.includes('公司簡報') || lowerMsg.includes('企業簡報'));

    if (wantsFoxlinkPpt) {
      console.log(`[Chat] Foxlink PPT detected, injecting design system prompt`);
      userParts.push({
        text:
          '[系統指令] 使用者要求生成 Foxlink 企業風格投影片。你必須輸出以下格式的代碼區塊（使用 generate_foxlink_pptx，不是 generate_pptx）：\n' +
          '\n```generate_foxlink_pptx:presentation.pptx\n' +
          '{\n' +
          '  "author": "作者姓名",\n' +
          '  "date": "YYYY-MM-DD",\n' +
          '  "slides": [\n' +
          '    { "type": "title", "title": "主標題", "subtitle": "副標題（選填）" },\n' +
          '    { "type": "bullets", "title": "章節標題", "icon": "shield", "highlight": "重點摘要（選填）", "bullets": ["要點一", "要點二"] },\n' +
          '    { "type": "3col", "title": "三欄標題", "columns": [\n' +
          '        { "title": "欄1", "icon": "target", "bullets": ["內容"] },\n' +
          '        { "title": "欄2", "icon": "users", "bullets": ["內容"] },\n' +
          '        { "title": "欄3", "icon": "bar-chart", "bullets": ["內容"] }\n' +
          '    ]},\n' +
          '    { "type": "flow", "title": "流程標題", "steps": [\n' +
          '        { "title": "步驟一", "desc": "說明" },\n' +
          '        { "title": "步驟二", "desc": "說明" }\n' +
          '    ]}\n' +
          '  ]\n' +
          '}\n```\n' +
          '\n可用 icon 名稱：shield, shield-check, alert, info, check, check-circle, user, users, bar-chart, line-chart, pie-chart, trending-up, trending-down, target, building, briefcase, settings, globe, lightbulb, rocket, file, file-text, clipboard, clock, calendar, arrow-right, star, award, package, link\n' +
          '規則：1)第一張必須是 title 封面；2)bullets 最多 7 條；3)3col 最多 3 欄每欄最多 5 條；4)flow 最多 5 步驟；5)所有文字使用使用者指定語言（預設繁體中文）；6)必須輸出完整 JSON 代碼區塊。',
      });
    } else if (wantsFileGen) {
      console.log(`[Chat] File generation detected, injecting reminder`);
      userParts.push({
        text: '[系統規則強制提醒] 你必須在本次回覆中直接輸出完整的 generate_xxx:filename 代碼區塊（包含所有檔案內容）。只說「已生成」「系統處理」「點擊連結」是無效的，絕對不會產生任何檔案。',
      });
    }

    if (userParts.length === 0) {
      sendEvent({ type: 'error', message: '請輸入訊息或上傳檔案' });
      return res.end();
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

      // Step 3: history must end with model turn
      while (merged.length > 0 && merged[merged.length - 1].role === 'user') {
        merged.pop();
      }

      return merged;
    };

    // Save user message first
    const userMsgResult = await db
      .prepare(
        `INSERT INTO chat_messages (session_id, role, content, files_json) VALUES (?, 'user', ?, ?)`
      )
      .run(sessionId, combinedUserText, fileMetas.length ? JSON.stringify(fileMetas) : null);

    // Audit check
    await checkSensitiveKeywords(db, req.user, sessionId, combinedUserText);

    // ── Load & Apply Session Skills ────────────────────────────────────────────
    const sessionSkills = await db.prepare(`
      SELECT s.* FROM session_skills ss
      JOIN skills s ON s.id = ss.skill_id
      WHERE ss.session_id = ? ORDER BY ss.sort_order ASC
    `).all(sessionId);

    // Collect system prompts from builtin skills
    const skillSystemPrompts = [];
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

    for (const sk of sessionSkills) {
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
      } else if ((sk.type === 'external' || sk.type === 'code') && sk.endpoint_url) {
        // For code runners, do a quick health check first
        if (sk.type === 'code') {
          const healthy = await checkCodeSkillHealth(sk.endpoint_url);
          if (!healthy) {
            console.warn(`[Skill] "${sk.name}" health check failed (url=${sk.endpoint_url}), skipping`);
            sendEvent({ type: 'status', message: `⚠️ Skill "${sk.name}" 離線，已跳過` });
            continue;
          }
        }
        if (sk.endpoint_mode === 'answer') {
          externalAnswerSkill = sk;
        } else {
          externalInjectSkills.push(sk);
        }
      }
    }

    // External inject: call endpoints and collect additional system prompts
    for (const sk of externalInjectSkills) {
      const _t0 = Date.now();
      let _status = 'ok', _errMsg = null, _respPreview = null;
      try {
        const resp = await Promise.race([
          fetch(sk.endpoint_url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Source': 'foxlink-gpt',
              ...(sk.endpoint_secret ? { Authorization: `Bearer ${sk.endpoint_secret}` } : {}),
            },
            body: JSON.stringify({ user_message: combinedUserText, session_id: sessionId, user_id: req.user.id }),
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ]);
        if (resp.ok) {
          const data = await resp.json();
          console.log(`[Skill] inject response for "${sk.name}":`, JSON.stringify(data).slice(0, 300));
          const added = data.system_prompt || data.content || '';
          if (added) { skillSystemPrompts.push(`# Skill: ${sk.name}\n${added}`); _respPreview = added.slice(0, 200); }
        } else {
          _status = 'error'; _errMsg = `HTTP ${resp.status}`;
          console.warn(`[Skill] inject HTTP ${resp.status} for "${sk.name}"`);
        }
      } catch (e) {
        _status = 'error'; _errMsg = e.message;
        console.warn(`[Skill] External inject failed for "${sk.name}": ${e.message} — skipping`);
      }
      // Log skill call
      try {
        await db.prepare(`INSERT INTO skill_call_logs (skill_id, user_id, session_id, query_preview, response_preview, status, error_msg, duration_ms) VALUES (?,?,?,?,?,?,?,?)`)
          .run(sk.id, req.user.id, sessionId, combinedUserText.slice(0, 200), _respPreview, _status, _errMsg, Date.now() - _t0);
      } catch (_) {}
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
            body: JSON.stringify({ user_message: combinedUserText, session_id: sessionId, user_id: req.user.id }),
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000)),
        ]);
        let answerContent = `[Skill "${sk.name}" 無法取得回應]`;
        let skillAudioUrl = null;
        if (resp.ok) {
          const data = await resp.json();
          console.log(`[Skill] answer "${sk.name}" HTTP 200 keys=${Object.keys(data).join(',')} audio=${!!data.audio_url} ${Date.now()-_ansT0}ms`);
          answerContent = data.content || data.system_prompt || answerContent;
          if (data.audio_url) skillAudioUrl = data.audio_url;
        } else {
          console.warn(`[Skill] answer "${sk.name}" HTTP ${resp.status} url=${sk.endpoint_url}`);
        }
        sendEvent({ type: 'chunk', content: answerContent });
        if (skillAudioUrl) {
          const fname = require('path').basename(skillAudioUrl);
          sendEvent({ type: 'generated_files', files: [{ type: 'audio', filename: fname, publicUrl: skillAudioUrl }] });
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
    const skillModelKey = sessionSkills.find(sk => sk.model_key)?.model_key;

    // Stream AI response
    let aiText = '';
    const chosenModel = skillModelKey || model || session.model || 'pro';
    const { apiModel, imageOutput, providerType, modelRow } = await resolveApiModel(db, chosenModel);
    const history = sanitizeHistory(buildHistory(historyMessages, imageOutput));

    // Inject skill system prompts into Gemini instruction
    const skillExtraInstruction = skillSystemPrompts.length > 0
      ? '\n\n---\n' + skillSystemPrompts.join('\n\n')
      : '';

    // Inject user language preference into system instruction
    const userRow = await db.prepare('SELECT preferred_language FROM users WHERE id=?').get(req.user.id);
    const resolvedLang = userRow?.preferred_language || 'zh-TW';
    const LANG_NAMES = { 'zh-TW': '繁體中文', 'en': 'English', 'vi': 'Tiếng Việt' };
    const langInstruction = `\n\n---\n請使用 ${LANG_NAMES[resolvedLang] || '繁體中文'} 回答，除非使用者在問題中明確指定輸出語言（例如翻譯任務）。`;
    // Disable Google Search when inject skills have provided data (avoid Gemini overriding with Search)
    const disableSearchForSkill = externalInjectSkills.length > 0 && skillSystemPrompts.length > 0;

    console.log(`[Chat] Calling Gemini (model=${chosenModel} → ${apiModel}, imageOutput=${imageOutput}, skills=${sessionSkills.length}) parts=${userParts.length} history=${history.length}`);
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
      console.log(`[Chat] Image gen done in ${Date.now() - t0}ms, images=${imgResult.images.length} in=${inputTokens} out=${outputTokens}`);
    } else {
      // ── Get user context (role + org fields for mcp_access / dify_access) ──
      const userCtxRow = await db.prepare(
        `SELECT role_id, dept_code, profit_center, org_section, org_group_name FROM users WHERE id=?`
      ).get(req.user.id);
      const roleId = userCtxRow?.role_id || null;
      const userCtx = req.user.role === 'admin' ? null : {
        userId: req.user.id,
        roleId,
        deptCode:     userCtxRow?.dept_code      || null,
        profitCenter: userCtxRow?.profit_center  || null,
        orgSection:   userCtxRow?.org_section    || null,
        orgGroupName: userCtxRow?.org_group_name || null,
      };

      // Shared maps for toolHandler (populated below regardless of mode)
      let serverMap = {}, kbMap = {}, selfKbMap = {};
      let allDeclarations = [];

      if (explicitMode) {
        // ── Explicit selection mode: user chose tools manually, skip intent filtering ──
        if (userMcpIds && userMcpIds.length > 0) {
          // Explicit mode: bypass role filter, use all active servers then filter by selected IDs
          const { functionDeclarations: allMcpDecls, serverMap: sm } = await mcpClient.getActiveToolDeclarations(db, null);
          serverMap = sm;
          // Apply Skill MCP disable rule (safety constraint)
          const hasSkillDisable = sessionSkills.some(sk => sk.mcp_tool_mode === 'disable');
          if (!hasSkillDisable) {
            const selectedIds = userMcpIds.map(Number);
            const selected = allMcpDecls.filter(d => {
              const entry = sm[d.name];
              return entry && selectedIds.includes(Number(entry.server.id));
            });
            allDeclarations.push(...selected);
          }
        }
        if (userDifyIds && userDifyIds.length > 0) {
          // Explicit mode: bypass access filter (same as MCP) — user already selected from /my which is access-controlled
          const { declarations, kbMap: km } = await getDifyFunctionDeclarations(db, null);
          kbMap = km;
          const selectedIds = userDifyIds.map(Number);
          const selected = declarations.filter(d => {
            const kb = km[d.name];
            return kb && selectedIds.includes(Number(kb.id));
          });
          allDeclarations.push(...selected);
        }
        if (userSelfKbIds && userSelfKbIds.length > 0) {
          const { declarations, kbMap: km } = await getSelfKbDeclarations(db, req.user.id);
          selfKbMap = km;
          const selected = declarations.filter(d => {
            const kb = km[d.name];
            return kb && userSelfKbIds.includes(String(kb.id));
          });
          allDeclarations.push(...selected);
        }
        console.log(`[Chat] Explicit tool mode: mcp=${userMcpIds?.length||0} dify=${userDifyIds?.length||0} selfkb=${userSelfKbIds?.length||0} → ${allDeclarations.length} tools`);
      } else {
        // ── Auto mode: load all accessible tools + intent filtering ───────────
        const { functionDeclarations: allMcpDecls, serverMap: sm } = await mcpClient.getActiveToolDeclarations(db, userCtx);
        serverMap = sm;
        const { declarations: difyDecls, kbMap: km } = await getDifyFunctionDeclarations(db, userCtx);
        kbMap = km;
        const { declarations: selfKbDecls, kbMap: skm } = await getSelfKbDeclarations(db, req.user.id);
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

        // Intent-filter MCP tools, DIFY KBs, and self-built KBs before passing to LLM
        const recentCtx = historyMessages.slice(-4)
          .map(m => `${m.role === 'user' ? '使用者' : 'AI'}: ${m.content.slice(0, 300)}`).join('\n');
        const intentCtx = { db, userId: req.user.id };
        const [mcpDecls, filteredDifyDecls, filteredSelfKbDecls] = await Promise.all([
          filterMcpDeclsByIntent(combinedUserText, filteredAllMcpDecls, recentCtx, intentCtx),
          filterDifyDeclsByIntent(combinedUserText, difyDecls, recentCtx, intentCtx),
          filterDifyDeclsByIntent(combinedUserText, selfKbDecls, recentCtx, intentCtx),
        ]);
        allDeclarations = [...mcpDecls, ...filteredDifyDecls, ...filteredSelfKbDecls];
      }
      // ── End tool loading ─────────────────────────────────────────────────

      if (allDeclarations.length > 0) {
        const mcpCount = allDeclarations.filter(d => !d.name.startsWith('selfkb_') && !kbMap[d.name]).length;
        const kbTotal  = allDeclarations.length - mcpCount;

        // ── Fast path: pure SelfKB only (no MCP, no DIFY) → pre-fetch + stream ──
        const pureSelfKb = mcpCount === 0 && allDeclarations.every(d => selfKbMap[d.name]);

        if (pureSelfKb) {
          sendEvent({ type: 'status', message: `查詢 ${kbTotal} 個知識庫...` });

          // Run all KB searches in parallel
          const kbContextParts = await Promise.all(
            allDeclarations.map(async (decl) => {
              const kb = selfKbMap[decl.name];
              if (!kb) return null;
              const t1 = Date.now();
              const result = await executeSelfKbSearch(db, kb, combinedUserText, { userId: req.user.id, sessionId });
              console.log(`[SelfKB] "${kb.name}" prefetch done in ${Date.now() - t1}ms`);
              if (!result?.trim()) return null;
              return `## 知識庫：${kb.name}\n\n${result}`;
            })
          );

          const kbContext = kbContextParts.filter(Boolean).join('\n\n---\n\n');
          const kbInstruction = kbContext
            ? `以下是從知識庫檢索到的相關資料，請優先根據這些資料回答問題：\n\n${kbContext}`
            : '';

          sendEvent({ type: 'status', message: 'AI 思考中...' });

          const finalInstruction = [skillExtraInstruction, kbInstruction, langInstruction].filter(Boolean).join('\n\n---\n\n');
          let firstChunkReceived = false;
          const keepAliveInterval = setInterval(() => {
            if (!firstChunkReceived && !clientDisconnected) sendEvent({ type: 'status', message: 'AI 思考中...' });
            else clearInterval(keepAliveInterval);
          }, 15000);

          try {
            const _onChunk = (chunk) => {
              if (clientDisconnected) throw new Error('CLIENT_DISCONNECTED');
              firstChunkReceived = true; aiText += chunk;
              sendEvent({ type: 'chunk', content: chunk });
            };
            if (providerType === 'azure_openai' && modelRow) {
              ({ text, inputTokens, outputTokens } = await streamChatAoai(modelRow, history, userParts, _onChunk, finalInstruction));
            } else {
              ({ text, inputTokens, outputTokens } = await streamChat(apiModel, history, userParts, _onChunk, finalInstruction, kbContext ? true : disableSearchForSkill));
            }
          } finally {
            clearInterval(keepAliveInterval);
          }
          console.log(`[Chat] SelfKB fast-path done in ${Date.now() - t0}ms, kbs=${kbTotal} hasCtx=${!!kbContext} in=${inputTokens} out=${outputTokens} tokens`);

        } else {
          // ── Tool-calling path (MCP and/or DIFY mixed) ──────────────────────
          sendEvent({ type: 'status', message: `已載入 ${mcpCount} 個 MCP 工具、${kbTotal} 個知識庫` });

          const calledDifyKbs = new Set();
          const calledSelfKbs = new Set();

          const toolHandler = async (toolName, args) => {
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
                console.warn(`[DIFY] Duplicate call prevented for ${toolName}`);
                return `[知識庫已在本輪查詢過，請直接使用先前的查詢結果]`;
              }
              calledDifyKbs.add(toolName);
              const kb = kbMap[toolName];
              sendEvent({ type: 'status', message: `查詢知識庫：${kb.name}` });
              return await executeDifyQuery(db, kb, args.query || combinedUserText, sessionId, req.user.id);
            }
            const entry = serverMap[toolName];
            if (!entry) return `[未知工具: ${toolName}]`;
            sendEvent({ type: 'status', message: `呼叫工具：${toolName}` });
            return await mcpClient.callTool(db, entry.server, sessionId, req.user.id, entry.originalName, args);
          };

          // Build set of tool names that should bypass LLM and return raw result directly
          const directAnswerTools = new Set(
            Object.entries(serverMap)
              .filter(([, entry]) => entry.server?.response_mode === 'answer')
              .map(([toolName]) => toolName)
          );

          let isDirectAnswer = false;
          ({ text, inputTokens, outputTokens, isDirectAnswer } = await generateWithTools(
            apiModel, history, userParts, allDeclarations, toolHandler, skillExtraInstruction,
            { directAnswerTools }
          ));
          if (text) {
            // Direct answer mode: ensure newlines render as markdown line breaks
            const displayText = isDirectAnswer
              ? text.replace(/\n/g, '  \n')  // trailing 2 spaces = markdown hard line break
              : text;
            aiText = displayText;
            sendEvent({ type: 'chunk', content: displayText });
          }
          console.log(`[Chat] Tools+Gemini done in ${Date.now() - t0}ms, tools=${allDeclarations.length} in=${inputTokens} out=${outputTokens} tokens`);
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
            firstChunkReceived = true; aiText += chunk;
            sendEvent({ type: 'chunk', content: chunk });
          };
          if (providerType === 'azure_openai' && modelRow) {
            ({ text, inputTokens, outputTokens } = await streamChatAoai(modelRow, history, userParts, _onChunk, skillExtraInstruction));
          } else {
            ({ text, inputTokens, outputTokens } = await streamChat(apiModel, history, userParts, _onChunk, skillExtraInstruction, disableSearchForSkill));
          }
        } finally {
          clearInterval(keepAliveInterval);
        }
        console.log(`[Chat] ${providerType === 'azure_openai' ? 'AOAI' : 'Gemini'} done in ${Date.now() - t0}ms, in=${inputTokens} out=${outputTokens} tokens`);
      }

      // Debug: check if response contains generate blocks
      const blockHeaders = text.match(/```generate_\w+:[^\n]+/g);
      console.log(`[Chat] Generate block headers in response: ${blockHeaders ? JSON.stringify(blockHeaders) : 'none'}`);

      if (blockHeaders && blockHeaders.length > 0) {
        sendEvent({ type: 'status', message: `正在生成 ${blockHeaders.length} 個檔案...` });
      }

      const generatedFiles = await processGenerateBlocks(text, sessionId);
      if (generatedFiles.length > 0) {
        const clientFiles = generatedFiles.map(({ type, filename, publicUrl }) => ({ type, filename, publicUrl }));
        sendEvent({ type: 'generated_files', files: clientFiles });
        allGeneratedFiles = clientFiles;
      }

      displayText = text
        .replace(/```generate_[a-z]+:[^\n]+\n[\s\S]*?```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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
      `INSERT INTO audit_logs (user_id, session_id, content, has_sensitive, sensitive_keywords)
       VALUES (?, ?, ?, ?, ?)`
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
