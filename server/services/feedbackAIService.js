/**
 * Feedback AI Service — AI 分析 + RAG 搜尋 + KB 同步
 */

const feedbackService = require('./feedbackService');

// ─── AI 分析 ──────────────────────────────────────────────────────────────────

async function analyzeTicket(db, ticketId, userId, onChunk) {
  const ticket = await feedbackService.getTicketById(db, ticketId);
  if (!ticket) throw new Error('工單不存在');

  // 取得設定
  const modelKey = await _getSetting(db, 'feedback_ai_model') || process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash';
  const temperature = parseFloat(await _getSetting(db, 'feedback_ai_temperature') || '0.3');
  const maxTokens = parseInt(await _getSetting(db, 'feedback_ai_max_tokens') || '4096', 10);
  const systemPrompt = await _getSetting(db, 'feedback_ai_system_prompt') ||
    '你是 FOXLINK 技術支援助手。請根據使用者的問題描述、附件內容和類似歷史工單，提供具體的解決建議。回答要專業、清晰、可操作。如果有參考歷史工單，請標注來源。';

  // 收集附件內容
  const attachments = await feedbackService.listAttachments(db, ticketId);
  let attachmentSummary = '';
  if (attachments.length > 0) {
    attachmentSummary = `\n\n附件 (${attachments.length} 個): ${attachments.map(a => a.file_name).join(', ')}`;
  }

  // RAG 搜尋類似工單
  let ragContext = '';
  let ragSources = [];
  try {
    // 優先用 KB embedding 向量搜尋，fallback 到關鍵字比對
    const { searchFeedbackKB } = require('./feedbackKBSync');
    const isAdmin = await _isAdmin(db, userId);
    let searchResults = await searchFeedbackKB(db, ticket.subject + ' ' + (ticket.description || ''), isAdmin, 5);

    // Fallback: 如果 KB 沒資料，用關鍵字比對
    if (searchResults.length === 0) {
      searchResults = await searchSimilarTickets(db, ticket.subject + ' ' + (ticket.description || ''), userId, 5);
    }

    if (searchResults.length > 0) {
      ragSources = searchResults.map(r => ({ ticket_no: r.ticket_no, subject: r.subject, score: r.score }));
      ragContext = '\n\n以下是類似的歷史問題及解法：\n' +
        searchResults.map((r, i) => `${i + 1}. [${r.ticket_no}] ${r.subject}\n   解法: ${r.resolution || '(無記錄)'}`).join('\n');
    }
  } catch (ragErr) {
    console.warn('[FeedbackAI] RAG search error:', ragErr.message);
  }

  // 組合 prompt
  const userPrompt = `問題主旨: ${ticket.subject}\n\n問題說明:\n${ticket.description || '(無說明)'}${attachmentSummary}${ticket.share_link ? '\n\n分享連結: ' + ticket.share_link : ''}${ragContext}`;

  // 呼叫 LLM
  let fullResponse = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const { getLlmService } = require('./llmService');
    const llm = getLlmService();
    const stream = await llm.generateStream({
      modelKey,
      systemPrompt,
      userPrompt,
      temperature,
      maxOutputTokens: maxTokens,
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        fullResponse += chunk.text;
        if (onChunk) onChunk(chunk.text);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.inputTokens || 0;
        outputTokens = chunk.usage.outputTokens || 0;
      }
    }
  } catch (llmErr) {
    // fallback: 用 gemini 直接
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: modelKey });
      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      });
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          if (onChunk) onChunk(text);
        }
      }
      const usage = await result.response;
      inputTokens = usage?.usageMetadata?.promptTokenCount || 0;
      outputTokens = usage?.usageMetadata?.candidatesTokenCount || 0;
    } catch (fallbackErr) {
      throw new Error('AI 分析失敗: ' + fallbackErr.message);
    }
  }

  // 儲存分析紀錄
  await db.prepare(`
    INSERT INTO feedback_ai_analyses (ticket_id, triggered_by, input_summary, suggestion, rag_sources, model, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ticketId, userId, userPrompt.slice(0, 2000), fullResponse, JSON.stringify(ragSources), modelKey, inputTokens, outputTokens);

  // 標記工單曾使用 AI
  await db.prepare('UPDATE feedback_tickets SET ai_assisted = 1, ai_model = ?, updated_at = SYSTIMESTAMP WHERE id = ?').run(modelKey, ticketId);

  return { suggestion: fullResponse, ragSources, model: modelKey, inputTokens, outputTokens };
}

// ─── RAG 搜尋（簡化版：直接搜 resolved tickets 全文比對）─────────────────────

async function searchSimilarTickets(db, query, userId, limit = 5) {
  // 簡化版：使用 LIKE 比對 subject + description
  // 正式版可接 KB embedding
  const keywords = query.replace(/[^\u4e00-\u9fff\w\s]/g, '').split(/\s+/).filter(k => k.length > 1).slice(0, 5);
  if (keywords.length === 0) return [];

  const conditions = keywords.map(() => '(UPPER(t.subject) LIKE UPPER(?) OR UPPER(t.description) LIKE UPPER(?))');
  const binds = [];
  keywords.forEach(k => { binds.push(`%${k}%`, `%${k}%`); });

  const isAdmin = await _isAdmin(db, userId);
  const rows = await db.prepare(`
    SELECT t.ticket_no, t.subject, t.resolution_note,
           t.applicant_name, t.applicant_dept
    FROM feedback_tickets t
    WHERE t.status IN ('resolved', 'closed')
    AND (${conditions.join(' OR ')})
    ORDER BY t.resolved_at DESC
    FETCH FIRST ${limit} ROWS ONLY
  `).all(...binds);

  return rows.map(r => ({
    ticket_no: r.ticket_no,
    subject: isAdmin ? r.subject : r.subject,
    resolution: r.resolution_note || null,
    applicant: isAdmin ? r.applicant_name : null, // 隱私：非管理員看不到申請者
    score: 1, // 簡化版無向量分數
  }));
}

// ─── AI 有幫助回饋 ──────────────────────────────────────────────────────────

async function markAIHelpful(db, analysisId, isHelpful) {
  await db.prepare('UPDATE feedback_ai_analyses SET is_helpful = ? WHERE id = ?').run(isHelpful ? 1 : 0, analysisId);
}

// ─── 工單結案 → KB 同步 ──────────────────────────────────────────────────────

async function syncTicketToKB(db, ticketId) {
  // Phase 4 簡化版：把結案工單的解法寫入 AI 分析表供 RAG 搜尋
  // 正式版可接 kbEmbedding.js 做 embedding
  console.log(`[FeedbackAI] Ticket ${ticketId} resolved — ready for KB sync (embedding TBD)`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _getSetting(db, key) {
  try {
    const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
    return row?.value || null;
  } catch {
    return null;
  }
}

async function _isAdmin(db, userId) {
  try {
    const row = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    return row?.role === 'admin';
  } catch {
    return false;
  }
}

module.exports = {
  analyzeTicket,
  searchSimilarTickets,
  markAIHelpful,
  syncTicketToKB,
};
