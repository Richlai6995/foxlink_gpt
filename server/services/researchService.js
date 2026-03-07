'use strict';
/**
 * Deep Research Service
 * Executes a research job: KB search → LLM per sub-question → synthesize → generate files
 */

const path = require('path');
const fs   = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { embedText, toVectorStr } = require('./kbEmbedding');
const { generateFile } = require('./fileGenerator');
const { upsertTokenUsage } = require('./tokenService');

const MODEL_PRO   = process.env.GEMINI_MODEL_PRO   || 'gemini-2.0-flash';
const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH  || 'gemini-2.0-flash';
const UPLOAD_DIR  = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

// ─── KB Search ────────────────────────────────────────────────────────────────

/**
 * Search all accessible KBs for a user and return combined context text.
 * Returns '' if no KBs are accessible or no relevant chunks found.
 */
async function searchUserKbs(db, userId, query, topK = 6) {
  try {
    const user = await db.prepare(
      'SELECT role, role_id FROM users WHERE id=?'
    ).get(userId);
    if (!user) return '';

    let kbs;
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
            )
          )
        )
        FETCH FIRST 5 ROWS ONLY
      `).all(userId, userId, user.role_id);
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
            allResults.push({
              content:  r.parent_content || r.content,
              filename: r.filename,
              score,
            });
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
    console.warn('[Research] searchUserKbs error:', e.message);
    return '';
  }
}

// ─── LLM Helpers ──────────────────────────────────────────────────────────────

function detectLanguage(text) {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh-TW' : 'en';
}

/**
 * Generate plan JSON for a research question.
 * Returns { plan, inputTokens, outputTokens }
 */
async function generatePlan(question, depth, hasKb) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const lang  = detectLanguage(question);
  const langHint = lang === 'zh-TW' ? '請以繁體中文生成。' : 'Please generate in English.';
  const count = Math.max(2, Math.min(8, depth));

  const model = genAI.getGenerativeModel({
    model: MODEL_FLASH,
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `你是一位研究規劃專家。使用者想深度研究：\n"${question}"\n\n${langHint}\n請生成一份研究計畫，含 ${count} 個子問題。\n\n回傳 JSON（嚴格格式，不加其他文字）：\n{"title":"研究主題（15字內）","objective":"目標說明（50字內）","language":"${lang}","sub_questions":[{"id":1,"question":"子問題1"},{"id":2,"question":"子問題2"}]}`;

  const result = await model.generateContent(prompt);
  const usage  = result.response.usageMetadata || {};
  return {
    plan: JSON.parse(result.response.text().trim()),
    inputTokens:  usage.promptTokenCount     || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/**
 * Generate the answer to a single sub-question.
 * Returns { answer, inputTokens, outputTokens }
 */
async function generateSection(question, kbContext, useWebSearch, language) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const langHint = language === 'zh-TW' ? '請以繁體中文詳細回答。' : 'Please answer in detail in English.';

  const contextPart = kbContext
    ? `以下是從知識庫檢索到的相關資料：\n\n${kbContext}\n\n請根據以上資料，`
    : '請';

  const prompt = `${langHint}\n\n${contextPart}詳細研究並回答以下問題：\n${question}\n\n請提供結構化分析，包含具體數據或例子（如果有）。`;

  const tools = useWebSearch ? [{ googleSearch: {} }] : undefined;
  const model = genAI.getGenerativeModel({ model: MODEL_PRO });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(tools ? { tools } : {}),
  });

  const usage = result.response.usageMetadata || {};
  return {
    answer:       result.response.text().trim(),
    inputTokens:  usage.promptTokenCount     || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/**
 * Synthesize all section answers into a final report in Markdown.
 * Returns { report, inputTokens, outputTokens }
 */
async function synthesizeReport(title, sections, language) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
        // Excel: structured sheet with all sections
        content = JSON.stringify([
          {
            sheetName: '研究摘要',
            data: [
              ['研究主題', title],
              ['生成時間', new Date().toLocaleString('zh-TW')],
              [],
              ['子問題', '研究結果'],
              ...sections.map((s) => [s.question, s.answer.slice(0, 800)]),
            ],
          },
        ]);
      } else if (fmt === 'pptx') {
        // PPTX: pass Markdown; pptxgenjs generator will parse it
        content = report;
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
  try {
    job = await db.prepare('SELECT * FROM research_jobs WHERE id=?').get(jobId);
    if (!job) return;

    const plan         = JSON.parse(job.plan_json || '{}');
    const subQuestions = plan.sub_questions || [];
    const total        = subQuestions.length;
    const language     = plan.language || 'zh-TW';
    const useWebSearch = job.use_web_search === 1;

    await db.prepare(
      "UPDATE research_jobs SET status='running', progress_total=?, updated_at=SYSTIMESTAMP WHERE id=?"
    ).run(total, jobId);

    const sections     = [];
    const today        = new Date().toISOString().split('T')[0];
    const tokensByModel = {}; // { [modelName]: { in, out } }
    const addTokens = (modelName, inT, outT) => {
      if (!tokensByModel[modelName]) tokensByModel[modelName] = { in: 0, out: 0 };
      tokensByModel[modelName].in  += (inT  || 0);
      tokensByModel[modelName].out += (outT || 0);
    };

    for (let i = 0; i < subQuestions.length; i++) {
      const sq = subQuestions[i];
      await db.prepare(
        'UPDATE research_jobs SET progress_step=?, progress_label=?, updated_at=SYSTIMESTAMP WHERE id=?'
      ).run(i + 1, `正在研究：${sq.question.slice(0, 80)}`, jobId);

      // KB search first; only fall back to web if KB empty
      let kbContext = '';
      try { kbContext = await searchUserKbs(db, job.user_id, sq.question); } catch (_) {}

      const shouldWeb = useWebSearch && !kbContext;
      let answer = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const sec = await generateSection(sq.question, kbContext, shouldWeb, language);
          answer = sec.answer;
          addTokens(MODEL_PRO, sec.inputTokens, sec.outputTokens);
          break;
        } catch (e) {
          if (attempt === 2) answer = `（研究此問題時發生錯誤：${e.message}）`;
          else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      sections.push({ question: sq.question, answer });
    }

    // Synthesize
    await db.prepare(
      "UPDATE research_jobs SET progress_label='正在整合報告...', updated_at=SYSTIMESTAMP WHERE id=?"
    ).run(jobId);
    const { report, inputTokens: synIn, outputTokens: synOut } = await synthesizeReport(plan.title, sections, language);
    addTokens(MODEL_PRO, synIn, synOut);

    // Generate files
    await db.prepare(
      "UPDATE research_jobs SET progress_label='正在生成文件...', updated_at=SYSTIMESTAMP WHERE id=?"
    ).run(jobId);
    const files = await generateOutputFiles(jobId, plan.title, report, sections, job.output_formats || 'docx');

    // Flush token usage to token_usage table
    for (const [modelName, t] of Object.entries(tokensByModel)) {
      await upsertTokenUsage(db, job.user_id, today, modelName, t.in, t.out).catch((e) =>
        console.warn('[Research] upsertTokenUsage error:', e.message)
      );
    }
    console.log(`[Research] Token usage flushed for job ${jobId}:`, JSON.stringify(tokensByModel));

    // Mark done
    const summary = report.slice(0, 800);
    await db.prepare(`
      UPDATE research_jobs
      SET status='done', progress_step=?, progress_label='研究完成',
          result_summary=?, result_files_json=?,
          completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(total, summary, JSON.stringify(files), jobId);

    // Update placeholder chat message
    if (job.session_id) {
      const downloadLinks = files
        .map((f) => `[📥 下載 ${f.type.toUpperCase()}](${f.url})`)
        .join('  \n');
      const msgContent =
        `**📊 深度研究完成：${plan.title}**\n\n` +
        `${report.slice(0, 300)}${report.length > 300 ? '...' : ''}\n\n` +
        `${downloadLinks}`;
      await db.prepare(
        `UPDATE chat_messages SET content=? WHERE session_id=? AND content='__RESEARCH_JOB__:${jobId}'`
      ).run(msgContent, job.session_id);
    }

    console.log(`[Research] Job ${jobId} completed — ${files.length} files`);
  } catch (e) {
    console.error(`[Research] Job ${jobId} failed:`, e.message);
    await db.prepare(
      "UPDATE research_jobs SET status='failed', error_msg=?, updated_at=SYSTIMESTAMP WHERE id=?"
    ).run((e.message || 'Unknown error').slice(0, 500), jobId);

    // Update placeholder message with error
    if (job?.session_id) {
      await db.prepare(
        `UPDATE chat_messages SET content=? WHERE session_id=? AND content='__RESEARCH_JOB__:${jobId}'`
      ).run(`**❌ 深度研究失敗**\n\n${e.message}`, job.session_id).catch(() => {});
    }
  }
}

module.exports = { runResearchJob, generatePlan, searchUserKbs };
