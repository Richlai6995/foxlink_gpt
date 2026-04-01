/**
 * Help Section Translation Service
 * Uses LLM models (from llm_models table) to translate help content blocks
 */
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { decryptKey } = require('./llmKeyService');

const LANG_NAMES = {
  en: 'English',
  vi: 'Vietnamese (Tiếng Việt)',
};

const SYSTEM_PROMPT = `You are a professional technical document translator. Your task is to translate a JSON object containing help documentation content.

## Rules:
1. Translate all text values from Traditional Chinese (繁體中文) to the target language
2. **DO NOT translate** these proper nouns — keep them exactly as-is:
   - Product names: Foxlink GPT, Cortex, DIFY, MCP, AOAI, Gemini, Oracle, Webex
   - Technical terms: SSO, LDAP, AD, API, Token, Schema, ETL, PDF, Word, Excel, PPT, PPTX, TXT, SMTP, KB, LLM, System Prompt, Function Calling, Flash, Pro, Session, Fork, Badge, Dashboard, Markdown, Code Runner, URL, JSON, ZIP, CSV
   - Model names: GPT-4o, GPT-4o-mini, gemini-3-pro-preview, gemini-3-flash-preview, gemini-2.5-flash-preview, Imagen 3
3. Preserve **markdown formatting**: **bold**, \`code\`, etc.
4. Preserve all JSON structure — only change string values
5. Keep emoji characters as-is
6. For the "type" field in blocks, keep the value unchanged (e.g., "para", "tip", "note", "table", etc.)
7. For color values (borderColor, color fields in tags), keep them unchanged
8. For the "emoji" field, keep it unchanged
9. Return ONLY valid JSON — no markdown code fences, no explanation

## Input format:
{
  "title": "...",
  "sidebarLabel": "...",
  "blocks": [...]
}

## Output format:
Return the same JSON structure with translated text values.`;

/**
 * Resolve model info from DB
 */
async function resolveModelInfo(db, modelKey) {
  try {
    const row = await db.prepare(
      `SELECT api_model, api_key_enc, provider_type FROM llm_models WHERE key=? AND is_active=1`
    ).get(modelKey);
    if (row) {
      const apiKey = row.api_key_enc
        ? (decryptKey(row.api_key_enc) || process.env.GEMINI_API_KEY)
        : process.env.GEMINI_API_KEY;
      return { apiModel: row.api_model, apiKey, provider: row.provider_type || 'gemini' };
    }
  } catch { /* ignore */ }
  // Fallback
  const flashModel = process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash-preview-05-20';
  const proModel   = process.env.GEMINI_MODEL_PRO   || 'gemini-3-pro-preview';
  if (modelKey === 'pro')   return { apiModel: proModel,   apiKey: process.env.GEMINI_API_KEY, provider: 'gemini' };
  return { apiModel: flashModel, apiKey: process.env.GEMINI_API_KEY, provider: 'gemini' };
}

// Max blocks per chunk — keeps each LLM call well within output token limits
const CHUNK_SIZE = 8;
const MAX_RETRIES = 2;

/**
 * Call LLM to translate a JSON payload, with retry on JSON parse failure
 */
async function callLLM(payload, targetLang, modelInfo, signal) {
  const langName = LANG_NAMES[targetLang] || targetLang;

  const genAI = new GoogleGenerativeAI(modelInfo.apiKey);
  const model = genAI.getGenerativeModel({
    model: modelInfo.apiModel,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
    },
  });

  const prompt = `Translate the following help documentation content from Traditional Chinese to ${langName}.

${JSON.stringify(payload, null, 2)}`;

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('Translation aborted');

    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      });

      const text = result.response.text();
      let cleaned = text.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      return JSON.parse(cleaned);
    } catch (err) {
      lastError = err;
      if (err.message === 'Translation aborted') throw err;
      console.warn(`[HelpTranslator]   Attempt ${attempt + 1} failed: ${err.message}${attempt < MAX_RETRIES ? ', retrying...' : ''}`);
    }
  }
  throw lastError;
}

/**
 * Translate a single section's content from zh-TW to target language.
 * For large sections (many blocks), automatically splits into chunks
 * to avoid LLM output truncation.
 *
 * @param {object} zhContent - { title, sidebarLabel, blocks }
 * @param {string} targetLang - 'en' | 'vi'
 * @param {object} modelInfo - { apiModel, apiKey, provider }
 * @param {AbortSignal} [signal] - optional abort signal
 */
async function translateSection(zhContent, targetLang, modelInfo, signal) {
  const blocks = zhContent.blocks || [];

  // Small section — translate in one shot
  if (blocks.length <= CHUNK_SIZE) {
    return callLLM(zhContent, targetLang, modelInfo, signal);
  }

  // Large section — translate title/sidebarLabel first, then blocks in chunks
  console.log(`[HelpTranslator]   Large section (${blocks.length} blocks), splitting into chunks of ${CHUNK_SIZE}`);

  // 1) Translate metadata (title + sidebarLabel) with first chunk
  const firstChunk = blocks.slice(0, CHUNK_SIZE);
  const firstResult = await callLLM(
    { title: zhContent.title, sidebarLabel: zhContent.sidebarLabel, blocks: firstChunk },
    targetLang, modelInfo, signal,
  );

  const translatedBlocks = [...(firstResult.blocks || firstChunk)];

  // 2) Translate remaining chunks (blocks only)
  for (let i = CHUNK_SIZE; i < blocks.length; i += CHUNK_SIZE) {
    if (signal?.aborted) throw new Error('Translation aborted');

    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(blocks.length / CHUNK_SIZE);
    console.log(`[HelpTranslator]   Chunk ${chunkNum + 1}/${totalChunks} (blocks ${i}-${Math.min(i + CHUNK_SIZE, blocks.length) - 1})`);

    const chunkResult = await callLLM(
      { title: '_', sidebarLabel: '_', blocks: chunk },
      targetLang, modelInfo, signal,
    );

    translatedBlocks.push(...(chunkResult.blocks || chunk));
  }

  return {
    title: firstResult.title || zhContent.title,
    sidebarLabel: firstResult.sidebarLabel || zhContent.sidebarLabel,
    blocks: translatedBlocks,
  };
}

// Active translation jobs — Map<jobId, AbortController>
const activeJobs = new Map();

/**
 * Translate multiple sections and save to DB
 * @param {object} db - Database wrapper
 * @param {string[]} sectionIds - Section IDs to translate
 * @param {string} targetLang - 'en' or 'vi'
 * @param {string} [modelKey] - LLM model key from llm_models table
 * @param {string} [jobId] - unique job ID for abort support
 * @param {function} [onProgress] - callback({ sectionId, status, error, index, total })
 * @returns {object} { results, aborted }
 */
async function translateHelpSections(db, sectionIds, targetLang, modelKey = 'flash', jobId, onProgress) {
  const modelInfo = await resolveModelInfo(db, modelKey);
  console.log(`[HelpTranslator] Using model: ${modelInfo.apiModel} (key=${modelKey})`);

  const abortController = new AbortController();
  if (jobId) activeJobs.set(jobId, abortController);

  const total = sectionIds.length;
  const notify = (data) => { try { onProgress?.(data); } catch {} };

  const results = [];
  let aborted = false;

  try {
    for (let i = 0; i < sectionIds.length; i++) {
      const sectionId = sectionIds[i];

      // Check abort
      if (abortController.signal.aborted) {
        aborted = true;
        const r = { sectionId, ok: false, error: 'Aborted' };
        results.push(r);
        notify({ sectionId, status: 'aborted', index: i, total });
        continue;
      }

      notify({ sectionId, status: 'translating', index: i, total });

      try {
        // Get zh-TW source
        const zhTrans = await db.prepare(`
          SELECT title, sidebar_label, blocks_json
          FROM help_translations
          WHERE section_id = ? AND lang = 'zh-TW'
        `).get(sectionId);

        if (!zhTrans) {
          const r = { sectionId, ok: false, error: 'No zh-TW source found' };
          results.push(r);
          notify({ sectionId, status: 'error', error: r.error, index: i, total });
          continue;
        }

        const zhContent = {
          title: zhTrans.title,
          sidebarLabel: zhTrans.sidebar_label,
          blocks: JSON.parse(zhTrans.blocks_json),
        };

        console.log(`[HelpTranslator] Translating ${sectionId} → ${targetLang} ...`);
        const translated = await translateSection(zhContent, targetLang, modelInfo, abortController.signal);

        // Validate structure
        if (!translated.title || !translated.sidebarLabel || !Array.isArray(translated.blocks)) {
          const r = { sectionId, ok: false, error: 'Invalid translation structure' };
          results.push(r);
          notify({ sectionId, status: 'error', error: r.error, index: i, total });
          continue;
        }

        const now = new Date().toISOString().slice(0, 10);
        const blocksJson = JSON.stringify(translated.blocks);

        // Upsert translation
        const existing = await db.prepare(
          'SELECT id FROM help_translations WHERE section_id = ? AND lang = ?'
        ).get(sectionId, targetLang);

        if (existing) {
          await db.prepare(`
            UPDATE help_translations
            SET title = ?, sidebar_label = ?, blocks_json = ?, translated_at = ?, updated_at = SYSTIMESTAMP
            WHERE section_id = ? AND lang = ?
          `).run(translated.title, translated.sidebarLabel, blocksJson, now, sectionId, targetLang);
        } else {
          await db.prepare(`
            INSERT INTO help_translations (section_id, lang, title, sidebar_label, blocks_json, translated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(sectionId, targetLang, translated.title, translated.sidebarLabel, blocksJson, now);
        }

        console.log(`[HelpTranslator] ✓ ${sectionId} → ${targetLang}`);
        results.push({ sectionId, ok: true });
        notify({ sectionId, status: 'done', index: i, total });
      } catch (err) {
        if (abortController.signal.aborted) {
          aborted = true;
          results.push({ sectionId, ok: false, error: 'Aborted' });
          notify({ sectionId, status: 'aborted', index: i, total });
        } else {
          console.error(`[HelpTranslator] ✗ ${sectionId} → ${targetLang}:`, err.message);
          results.push({ sectionId, ok: false, error: err.message });
          notify({ sectionId, status: 'error', error: err.message, index: i, total });
        }
      }
    }
  } finally {
    if (jobId) activeJobs.delete(jobId);
  }

  return { results, aborted };
}

/**
 * Abort a running translation job
 */
function abortTranslation(jobId) {
  const controller = activeJobs.get(jobId);
  if (controller) {
    controller.abort();
    activeJobs.delete(jobId);
    console.log(`[HelpTranslator] Job ${jobId} aborted`);
    return true;
  }
  return false;
}

module.exports = { translateHelpSections, translateSection, abortTranslation };
