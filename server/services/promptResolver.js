'use strict';
/**
 * Prompt Tool Reference Resolver
 *
 * Supported syntax (processed BEFORE the main AI call):
 *   {{skill:技能名稱}}                       - execute skill, inject result
 *   {{skill:技能名稱 input="some text"}}      - explicit input override
 *   {{kb:知識庫名稱}}                         - search KB with task context
 *   {{kb:知識庫名稱 query="specific query"}}  - explicit query override
 *   {{mcp:toolName}}                         - future placeholder (returns note)
 *   {{dify:名稱}}                             - future placeholder (returns note)
 *
 * Returns: { resolvedText, toolsUsed }
 *   toolsUsed = { skills: [{id,name}], kbs: [{id,name,query}], mcp_tools: [], dify_kbs: [] }
 */

// ── KB Search helper ──────────────────────────────────────────────────────────
async function searchKbChunks(db, kbId, query, topK = 5) {
  const dims = 768;

  // Try vector search first
  try {
    const { embedText, toVectorStr } = require('./kbEmbedding');
    const qEmb = await embedText(query, { dims });
    const qVecStr = toVectorStr(qEmb);
    const rows = await db.prepare(`
      SELECT c.content, c.parent_content,
             VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vscore
      FROM kb_chunks c
      WHERE c.kb_id=? AND c.chunk_type != 'parent' AND c.embedding IS NOT NULL
      ORDER BY vscore ASC
      FETCH FIRST ? ROWS ONLY
    `).all(qVecStr, kbId, topK);
    if (rows.length > 0) return rows.map(r => r.parent_content || r.content);
  } catch (_) {}

  // Fallback: fulltext search
  try {
    const likeQuery = `%${query.slice(0, 100).replace(/[%_]/g, '\\$&')}%`;
    const rows = await db.prepare(`
      SELECT content FROM kb_chunks
      WHERE kb_id=? AND chunk_type != 'parent'
        AND UPPER(content) LIKE UPPER(?)
      FETCH FIRST ? ROWS ONLY
    `).all(kbId, likeQuery, topK);
    if (rows.length > 0) return rows.map(r => r.content);
  } catch (_) {}

  // Last resort: return most recent chunks
  const rows = await db.prepare(`
    SELECT content FROM kb_chunks
    WHERE kb_id=? AND chunk_type != 'parent'
    ORDER BY id DESC
    FETCH FIRST ? ROWS ONLY
  `).all(kbId, topK);
  return rows.map(r => r.content);
}

// ── Skill Executor helper ─────────────────────────────────────────────────────
async function executeSkillByRow(db, skill, input, context = {}) {
  const { userId, sessionId } = context;

  if (skill.type === 'builtin') {
    const { generateTextSync } = require('./gemini');
    let apiModel = skill.model_key || null;
    if (apiModel) {
      try {
        const row = await db.prepare('SELECT api_model FROM llm_models WHERE key=? AND is_active=1').get(apiModel);
        if (row?.api_model) apiModel = row.api_model;
      } catch (_) {}
    }
    if (!apiModel) {
      // Use default chat model
      try {
        const { resolveDefaultModel } = require('./llmDefaults');
        apiModel = await resolveDefaultModel(db, 'chat');
      } catch (_) { apiModel = null; }
    }
    const sysPrompt = skill.system_prompt || '';
    const history = sysPrompt ? [{ role: 'user', parts: [{ text: sysPrompt }] }, { role: 'model', parts: [{ text: '好的，我明白了。' }] }] : [];
    const { text } = await generateTextSync(apiModel, history, input || '請執行');
    return text;
  }

  if (skill.type === 'external' && skill.endpoint_url) {
    const res = await fetch(skill.endpoint_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(skill.endpoint_secret ? { 'x-secret': skill.endpoint_secret } : {}),
      },
      body: JSON.stringify({ user_message: input, user_id: userId, session_id: sessionId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`外部技能回應 ${res.status}`);
    const data = await res.json();
    return data.content || data.system_prompt || '';
  }

  if (skill.type === 'code') {
    if (!skill.code_port) throw new Error('Code skill 尚未啟動，請先在管理後台啟動');
    const res = await fetch(`http://127.0.0.1:${skill.code_port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_message: input, user_id: userId, session_id: sessionId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Code skill 回應 ${res.status}`);
    const data = await res.json();
    return data.content || data.system_prompt || '';
  }

  return `[技能類型 "${skill.type}" 不支援直接呼叫]`;
}

// ── Main resolver ─────────────────────────────────────────────────────────────
/**
 * @param {string} text  - prompt text (after basic var substitution)
 * @param {object} db    - Oracle DB wrapper
 * @param {object} opts
 *   @param {number}  opts.userId
 *   @param {string}  opts.sessionId
 *   @param {string}  opts.taskName   - used as default KB query / skill input
 */
async function resolveToolRefs(text, db, opts = {}) {
  const { userId, sessionId, taskName = '' } = opts;
  const toolsUsed = { skills: [], kbs: [], mcp_tools: [], dify_kbs: [] };
  let result = text;

  // ── {{kb:name}} / {{kb:name query="..."}} ──────────────────────────────────
  const kbPattern = /\{\{kb:([^}"]+?)(?:\s+query="([^"]*)")?\}\}/g;
  const kbMatches = [...result.matchAll(kbPattern)];
  for (const m of kbMatches) {
    const kbName = m[1].trim();
    const query = (m[2] || taskName || kbName).trim();
    const placeholder = m[0];
    try {
      const kb = await db.prepare(
        `SELECT id, name FROM knowledge_bases WHERE UPPER(name)=UPPER(?) AND is_active=1 FETCH FIRST 1 ROWS ONLY`
      ).get(kbName);
      if (!kb) {
        result = result.replace(placeholder, `[知識庫「${kbName}」不存在或未啟用]`);
        continue;
      }
      console.log(`[PromptResolver] KB search: "${kbName}" query="${query}"`);
      const chunks = await searchKbChunks(db, kb.id, query);
      const content = chunks.length > 0
        ? chunks.join('\n---\n').slice(0, 8000)
        : '（未找到相關內容）';
      result = result.replace(placeholder, `\n【知識庫「${kbName}」相關內容】\n${content}\n`);
      toolsUsed.kbs.push({ id: kb.id, name: kb.name, query });
    } catch (e) {
      console.error(`[PromptResolver] KB "${kbName}" error:`, e.message);
      result = result.replace(placeholder, `[知識庫查詢失敗: ${e.message}]`);
    }
  }

  // ── {{skill:name}} / {{skill:name input="..."}} ────────────────────────────
  const skillPattern = /\{\{skill:([^}"]+?)(?:\s+input="([^"]*)")?\}\}/g;
  const skillMatches = [...result.matchAll(skillPattern)];
  for (const m of skillMatches) {
    const skillName = m[1].trim();
    const input = (m[2] || taskName || '').trim();
    const placeholder = m[0];
    try {
      const skill = await db.prepare(
        `SELECT * FROM skills
         WHERE UPPER(name)=UPPER(?)
           AND (owner_user_id=? OR is_public=1
                OR EXISTS (
                  SELECT 1 FROM skill_access sa WHERE sa.skill_id=skills.id AND (
                    (sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
                    OR (sa.grantee_type='role' AND sa.grantee_id=(SELECT role FROM users WHERE id=?))
                  )
                ))
         FETCH FIRST 1 ROWS ONLY`
      ).get(skillName, userId ?? 0, userId ?? 0, userId ?? 0);
      if (!skill) {
        result = result.replace(placeholder, `[技能「${skillName}」不存在]`);
        continue;
      }
      console.log(`[PromptResolver] Skill exec: "${skillName}" input="${input.slice(0, 50)}"`);
      const content = await executeSkillByRow(db, skill, input, { userId, sessionId });
      result = result.replace(placeholder, `\n【技能「${skillName}」執行結果】\n${content}\n`);
      toolsUsed.skills.push({ id: skill.id, name: skill.name });
    } catch (e) {
      console.error(`[PromptResolver] Skill "${skillName}" error:`, e.message);
      result = result.replace(placeholder, `[技能執行失敗: ${e.message}]`);
    }
  }

  // ── {{mcp:toolName}} — future ──────────────────────────────────────────────
  const mcpPattern = /\{\{mcp:([^}]+)\}\}/g;
  for (const m of [...result.matchAll(mcpPattern)]) {
    const toolName = m[1].trim();
    result = result.replace(m[0], `[MCP 工具「${toolName}」（尚未支援，敬請期待）]`);
    toolsUsed.mcp_tools.push(toolName);
  }

  // ── {{dify:name}} — future ─────────────────────────────────────────────────
  const difyPattern = /\{\{dify:([^}]+)\}\}/g;
  for (const m of [...result.matchAll(difyPattern)]) {
    const name = m[1].trim();
    result = result.replace(m[0], `[API 連接器「${name}」（尚未支援，敬請期待）]`);
    toolsUsed.dify_kbs.push(name);
  }

  const hasTools = toolsUsed.skills.length + toolsUsed.kbs.length +
    toolsUsed.mcp_tools.length + toolsUsed.dify_kbs.length > 0;
  return { resolvedText: result, toolsUsed, hasTools };
}

/**
 * Check if text contains any tool references
 */
function hasToolRefs(text) {
  return /\{\{(skill|kb|mcp|dify):/.test(text || '');
}

module.exports = { resolveToolRefs, hasToolRefs };
