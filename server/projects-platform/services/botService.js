/**
 * Bot Service — spec §12 戰情會議室 AI Bot
 *
 * Sprint I ship(2026-05-18)— Phase 1 MVP 範圍:
 *   - Tier 1 問答檢索(Q&A)— 預設開
 *   - Tier 3 產生內容(draft)— 已天然支援(回 AI_INSIGHT,user 自己 Pin)
 *   - Tier 2 read-only tool 待 Cortex skill / MCP infra 接(Phase 2 補)
 *   - Tier 4 write action 待白名單 + 二次確認(Phase 2 補)
 *
 * 流程:
 *   1. 載 project + ACL 套用 confidentiality(user 看的版本)
 *   2. 載 channel 最近 N 訊息 + 對應 KB chunks(live + sediment)
 *   3. plugin.scrub_rules 把 Tier-A / [CUST_01] 等 placeholder 套上
 *   4. Gemini Flash 跑(streaming OK,Phase 1 直接 non-streaming)
 *   5. Unscrub 回 user 視角
 *   6. 以 AI_INSIGHT 訊息 post 進該 channel
 *   7. 回 message metadata
 *
 * 安全:
 *   - 永遠以發起 user 身份(spec §12.3)— 機密 / KB / ERP 都受 user 權限限制
 *   - 失敗 graceful fallback(post AI_INSIGHT 標「(bot 暫無法回答)」+ error log)
 *   - 自動拒答觸發機密欄位 raw 值(scrub map 全 placeholder)
 */

const { makeLogger } = require('./logger');
const log = makeLogger('botService');

const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true';

const MAX_CONTEXT_MESSAGES = 25;
const MAX_KB_CHUNKS = 8;

/**
 * 主入口 — user @bot 提問
 *
 * @param {object} db
 * @param {object} input
 * @param {number} input.projectId
 * @param {number} input.channelId
 * @param {object} input.user            — req.user(id, role, name, username)
 * @param {string} input.question        — user 訊息(含 @bot 已 strip)
 * @param {string} [input.demoRole]      — 機密 displayStrategy 用
 * @returns {Promise<{ message_id, content, scrub_map, llm_used, fallback_reason? }>}
 */
async function ask(db, { projectId, channelId, user, question, demoRole }) {
  if (!projectId || !channelId || !user?.id) throw new Error('projectId / channelId / user required');
  question = String(question || '').trim();
  if (!question) throw new Error('question required');

  // 1. 載專案 metadata
  const project = await db.prepare(`
    SELECT id, project_code, project_type_id, pm_user_id, sales_user_id, bu_id,
           lifecycle_status, is_confidential, data_payload, current_stage_id
      FROM projects WHERE id = ?
  `).get(projectId);
  if (!project) throw new Error('project not found');

  // 2. 載 channel + 最近 N 訊息(deleted 不算)
  const channel = await db.prepare(`
    SELECT id, name, channel_type FROM project_channels WHERE id = ? AND project_id = ?
  `).get(channelId, projectId);
  if (!channel) throw new Error('channel not in project');

  const recentMsgs = await db.prepare(`
    SELECT m.content, m.message_type, m.created_at, u.name AS user_name, u.username
      FROM project_messages m
      LEFT JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = ? AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC
     FETCH FIRST ${MAX_CONTEXT_MESSAGES} ROWS ONLY
  `).all(channelId).catch(() => []);

  // 3. 抓 KB chunks(live + sediment)— 用 question 簡易 LIKE 找
  const kbChunks = await _searchKbChunks(db, projectId, question);

  // 4. 套機密 mask(以 user 視角)
  const projectMasked = _applyMaskForBot(project, demoRole, user);

  // 5. Plugin scrub map(把 Tier-A / Apple 換成 placeholder)
  const scrubMap = _buildScrubMap(project, kbChunks);
  const scrubbedQuestion  = _applyScrub(question, scrubMap);
  const scrubbedMessages  = recentMsgs.map((m) => ({
    ...m,
    content: _applyScrub(String(m.content || ''), scrubMap),
  }));
  const scrubbedKb = kbChunks.map((k) => ({
    ...k,
    content: _applyScrub(String(k.content || ''), scrubMap),
  }));

  // 6. 生 prompt
  const systemPrompt = _buildSystemPrompt(projectMasked, channel, user);
  const userPrompt = _buildUserPrompt({
    question: scrubbedQuestion,
    recentMsgs: scrubbedMessages,
    kbChunks: scrubbedKb,
  });

  let botText;
  let llmUsed = false;
  let fallbackReason = null;

  if (!USE_LLM) {
    botText = _stubAnswer(question, recentMsgs.length, kbChunks.length);
    fallbackReason = 'PROJECTS_PLATFORM_USE_LLM=false';
  } else {
    try {
      botText = await _callGemini(systemPrompt, userPrompt);
      llmUsed = true;
    } catch (e) {
      log.warn(`Gemini ask failed: ${e.message}`);
      botText = _stubAnswer(question, recentMsgs.length, kbChunks.length);
      fallbackReason = `gemini_error: ${e.message}`;
    }
  }

  // 7. Unscrub 回 user 視角
  const finalText = _unscrubText(botText, scrubMap);

  // 8. Post as AI_INSIGHT
  const messagesService = require('./messagesService');
  const r = await messagesService.post(db, {
    channelId,
    userId: user.id,        // spec §12.3 — 以發起 user 身份(audit 上看就是該 user 觸發 Bot)
    content: `🤖 **AI Bot**\n\n${finalText}\n\n${llmUsed ? `_由 Gemini Flash 回覆_${fallbackReason ? ` · _${fallbackReason}_` : ''}` : `_${fallbackReason}_`}`,
    messageType: 'AI_INSIGHT',
  });

  log.log(`bot ask · project=${projectId} channel=${channelId} user=${user.id} llm=${llmUsed} ctx_msgs=${recentMsgs.length} kb=${kbChunks.length}`);

  return {
    message_id: r.id,
    announcement_msg_id: r.announcementMsgId,
    content: finalText,
    llm_used: llmUsed,
    fallback_reason: fallbackReason,
    context: {
      messages_count: recentMsgs.length,
      kb_chunks_count: kbChunks.length,
    },
    scrub_keys_count: Object.keys(scrubMap).length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 內部 helpers
// ─────────────────────────────────────────────────────────────────────

function _applyMaskForBot(project, role, user) {
  // 不重新 mask CLOB,直接從 data_payload 抓欄位
  let payload = {};
  try { payload = JSON.parse(project.data_payload || '{}') || {}; } catch (_) {}

  const isAdmin = user?.role === 'admin';
  const isPm    = Number(project.pm_user_id) === Number(user?.id);
  const isSales = Number(project.sales_user_id) === Number(user?.id);
  const fullView = isAdmin || isPm || isSales || role === 'HOST' || role === 'OBSERVER';

  // 機密 + 非 fullView → mask 機密欄位
  if (Number(project.is_confidential) === 1 && !fullView) {
    payload = { ...payload };
    for (const k of ['amount', 'margin', 'cost_breakdown', 'cost', 'price']) {
      if (payload[k] !== undefined) payload[k] = 'Tier-?';
    }
    for (const k of ['customer', 'customer_name']) {
      if (payload[k] !== undefined) payload[k] = '[CUST_REDACTED]';
    }
  }
  return { ...project, data_payload: payload };
}

async function _searchKbChunks(db, projectId, question) {
  if (!question) return [];
  // 取頭幾個關鍵字(中文 simple split)— Phase 2 換 embedding 召回
  const keywords = String(question)
    .split(/[\s,。?!,?]+/)
    .filter((s) => s && s.length >= 2 && !/^@/.test(s))
    .slice(0, 5);
  if (keywords.length === 0) return [];

  const wh = ['project_id = ?', '(' + keywords.map(() => 'UPPER(content) LIKE UPPER(?)').join(' OR ') + ')'];
  const params = [projectId, ...keywords.map((k) => `%${k}%`)];

  try {
    const rows = await db.prepare(`
      SELECT id, project_id, kind, content, tags, is_sediment, created_at
        FROM project_kb_chunks
       WHERE ${wh.join(' AND ')}
       ORDER BY is_sediment ASC, created_at DESC
       FETCH FIRST ${MAX_KB_CHUNKS} ROWS ONLY
    `).all(...params);
    return rows || [];
  } catch (e) {
    log.warn(`kb search failed: ${e.message}`);
    return [];
  }
}

/**
 * 建 scrub map — 把專案資料的機密 raw 值替成 placeholder
 * 回傳 { 'Apple Inc.': '[CUST_01]', 'Tier-A': '[PRICE_01]', ... }
 */
function _buildScrubMap(project, kbChunks) {
  const m = {};
  try {
    const payload = JSON.parse(project.data_payload || '{}') || {};
    // 真實客戶名(若 plugin 有 confidential 設定中 customer_name)
    if (payload.customer && typeof payload.customer === 'string' && payload.customer !== '[CUST_REDACTED]') {
      m[payload.customer] = '[CUST_01]';
    }
    if (payload.customer_name && payload.customer_name !== '[CUST_REDACTED]') {
      m[payload.customer_name] = '[CUST_01]';
    }
    // 真實 amount / margin(數字,Phase 1 不掃,只 mask 字串)
    if (typeof payload.amount === 'string' && /^[\d.,$ ]+$/.test(payload.amount)) {
      m[payload.amount] = '[PRICE_01]';
    }
  } catch (_) {}

  // 從 KB chunks 補抓 — 找已 scrub 過的 alias 對應(沉澱 chunk 本身已洗,不需再洗)
  // 反過來:live chunk 含 raw,可能要掃,但 Phase 1 簡化 — 只看 project payload。
  return m;
}

function _applyScrub(text, map) {
  if (!text || !map) return text;
  let out = text;
  for (const [raw, placeholder] of Object.entries(map)) {
    if (!raw) continue;
    out = out.split(raw).join(placeholder);
  }
  return out;
}

function _unscrubText(text, map) {
  if (!text || !map) return text;
  let out = text;
  // 反向替回:[CUST_01] → 原 raw
  for (const [raw, placeholder] of Object.entries(map)) {
    out = out.split(placeholder).join(raw);
  }
  return out;
}

function _buildSystemPrompt(project, channel, user) {
  let payload = {};
  try { payload = typeof project.data_payload === 'object' ? project.data_payload : JSON.parse(project.data_payload || '{}'); }
  catch (_) {}

  return [
    `你是 Cortex 通用專案管理平台的 AI 助手(代號 #21 戰情會議室 Bot)。`,
    `用繁體中文回答,簡潔有重點,2-5 段為限。`,
    `若 user 問及機密欄位 raw 值(如真實金額 / 客戶名),回答「該欄位機密,僅顯示策略後版本(Tier-? / [CUST_01])」。`,
    ``,
    `=== 專案 metadata ===`,
    `code: ${project.project_code}`,
    `title: ${payload.title || '—'}`,
    `lifecycle: ${project.lifecycle_status}`,
    `customer: ${payload.customer || payload.customer_name || '—'}`,
    `part_no: ${payload.partNo || payload.part_no || '—'}`,
    `quantity: ${payload.quantity || '—'}`,
    `due_date: ${payload.dueDate || payload.due_date || '—'}`,
    `is_confidential: ${Number(project.is_confidential) === 1 ? '是' : '否'}`,
    `current channel: #${channel.name} (${channel.channel_type})`,
    ``,
    `=== 發問者 ===`,
    `${user.name || user.username || `user#${user.id}`}`,
  ].join('\n');
}

function _buildUserPrompt({ question, recentMsgs, kbChunks }) {
  const ctxParts = [];

  if (recentMsgs?.length) {
    ctxParts.push(`=== 最近頻道訊息(新到舊)===`);
    for (const m of recentMsgs.slice(0, MAX_CONTEXT_MESSAGES)) {
      const who = m.user_name || m.username || 'user';
      ctxParts.push(`[${m.message_type || 'NORMAL'}] ${who}: ${String(m.content).slice(0, 300)}`);
    }
    ctxParts.push('');
  }

  if (kbChunks?.length) {
    ctxParts.push(`=== KB 相關 chunks(${kbChunks.length} 筆,可能含沉澱專案歷史)===`);
    for (const c of kbChunks) {
      const layer = Number(c.is_sediment) === 1 ? '📦 沉澱' : '🔴 live';
      ctxParts.push(`[${layer}/${c.kind}] ${String(c.content).slice(0, 400)}`);
    }
    ctxParts.push('');
  }

  ctxParts.push(`=== 問題 ===`);
  ctxParts.push(question);

  return ctxParts.join('\n');
}

async function _callGemini(systemPrompt, userPrompt) {
  const { getGenerativeModel, extractText } = require('../../services/geminiClient');
  const llmQueue = require('./llmQueue');

  const model = getGenerativeModel({
    model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
    systemInstruction: systemPrompt,
  });

  return await llmQueue.withLLM(async () => {
    const res = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    });
    const text = extractText(res).trim();
    if (!text) throw new Error('empty bot response');
    return text;
  }, { label: 'bot_ask', timeoutMs: 45_000 });
}

function _stubAnswer(question, msgsCount, kbCount) {
  return [
    `📌 **Stub 模式回應**(`,
    `沒接 LLM,看 PROJECTS_PLATFORM_USE_LLM env`,
    `)`,
    ``,
    `已收到問題:「${question.slice(0, 80)}${question.length > 80 ? '…' : ''}」`,
    ``,
    `已撈到上下文:`,
    `- 最近頻道訊息 ${msgsCount} 筆`,
    `- KB 相關 chunks ${kbCount} 筆`,
    ``,
    `設 \`PROJECTS_PLATFORM_USE_LLM=true\` 後 Bot 會真的用 Gemini Flash 回答`,
    `(機密欄位會走兩段 scrub,Tier-A / Apple 自動換成 placeholder)`,
  ].join('\n');
}

module.exports = {
  ask,
};
