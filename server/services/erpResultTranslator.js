'use strict';

/**
 * ERP 結果翻譯 service
 * - 從 erp_translation_glossary 載入專有名詞對照表(app-level cache 10 分鐘)
 * - 用 Gemini Flash 翻譯結果文字
 * - Redis cache 24h(key = erp:trans:{hash}:{lang})
 *
 * 翻譯後保留所有代碼/ID/數字/日期原樣,避免 LLM 亂翻。
 */

const crypto = require('crypto');
const { getStore } = require('./redisClient');
const { createClient } = require('./llmService');
const { db } = require('../database-oracle');

const CACHE_TTL = parseInt(process.env.ERP_RESULT_TRANS_CACHE_TTL || '86400', 10);

let _glossaryCache = null;
let _glossaryCacheAt = 0;
const GLOSSARY_TTL_MS = 10 * 60 * 1000;

async function loadGlossary() {
  const now = Date.now();
  if (_glossaryCache && now - _glossaryCacheAt < GLOSSARY_TTL_MS) return _glossaryCache;
  try {
    const rows = await db.prepare(`
      SELECT source_text, en_text, vi_text, notes
      FROM erp_translation_glossary
    `).all();
    _glossaryCache = (rows || []).map(r => ({
      source_text: r.source_text || r.SOURCE_TEXT,
      en_text:     r.en_text     || r.EN_TEXT,
      vi_text:     r.vi_text     || r.VI_TEXT,
      notes:       r.notes       || r.NOTES,
    }));
    _glossaryCacheAt = now;
  } catch (e) {
    console.warn('[ErpResultTranslator] glossary load failed:', e.message);
    _glossaryCache = _glossaryCache || [];
  }
  return _glossaryCache;
}

function invalidateGlossaryCache() {
  _glossaryCache = null;
  _glossaryCacheAt = 0;
}

function hash16(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

function buildGlossaryLines(glossary, targetLang) {
  const key = targetLang === 'vi' ? 'vi_text' : 'en_text';
  const lines = [];
  for (const g of glossary) {
    if (!g.source_text) continue;
    const t = g[key];
    if (!t) continue;
    lines.push(`${g.source_text} = ${t}`);
  }
  return lines;
}

/**
 * 翻譯文字(短字串或長段落都 OK)。
 * @param {string} text         原文(通常是中文)
 * @param {'en'|'vi'} targetLang 目標語言
 * @param {object} [opts]       { useCache?: boolean }
 * @returns {Promise<{ translated: string, cached: boolean }>}
 */
async function translateResult(text, targetLang, opts = {}) {
  if (!text || !String(text).trim()) return { translated: text || '', cached: false };
  if (targetLang !== 'en' && targetLang !== 'vi') {
    return { translated: text, cached: false };
  }

  const rawText = String(text);
  const cacheKey = `erp:trans:${hash16(rawText)}:${targetLang}`;
  const useCache = opts.useCache !== false;

  // 1. Cache lookup
  if (useCache) {
    try {
      const store = getStore();
      const cached = await store.get(cacheKey);
      if (cached) return { translated: cached, cached: true };
    } catch (_) {}
  }

  // 2. 組 prompt(含 glossary)
  const glossary = await loadGlossary();
  const gLines = buildGlossaryLines(glossary, targetLang);
  const targetName = targetLang === 'en' ? 'English' : 'Vietnamese';

  const glossaryBlock = gLines.length > 0
    ? `\n\nGlossary (use these exact translations for any term that appears):\n${gLines.map(l => '- ' + l).join('\n')}`
    : '';

  const prompt = `You are translating ERP system output from Chinese to ${targetName}.

Strict rules:
1. Keep ALL codes, IDs, numbers, dates, and identifiers VERBATIM (e.g. NDA264343-A, G0C, 9628260420041, 2026/04/16).
2. Translate only natural-language words (labels, status descriptions, field names).
3. Preserve line breaks, commas, and structural separators exactly as in the original.
4. Do NOT add explanations, markdown, or extra text. Output only the translation.${glossaryBlock}

Text to translate:
${rawText}

Translation:`;

  // 3. Call Gemini Flash
  let translated;
  try {
    const client = await createClient(db, 'flash');
    const raw = await client.generate([{ role: 'user', parts: [{ text: prompt }] }]);
    translated = String(raw || '').trim();
    // 去除可能的 code fence
    translated = translated.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();
  } catch (e) {
    console.warn('[ErpResultTranslator] translate failed:', e.message);
    return { translated: rawText, cached: false };
  }

  // 4. Store in cache
  if (useCache && translated) {
    try {
      const store = getStore();
      await store.set(cacheKey, CACHE_TTL, translated);
    } catch (_) {}
  }
  return { translated, cached: false };
}

module.exports = {
  translateResult,
  loadGlossary,
  invalidateGlossaryCache,
};
