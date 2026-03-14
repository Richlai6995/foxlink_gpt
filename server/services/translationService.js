'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
function getAI() {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
}

/**
 * Translate a single text to { zh, en, vi }.
 * Uses Gemini Flash for speed. Returns null values on error (non-fatal).
 */
async function translateText(text) {
  if (!text?.trim()) return { zh: '', en: '', vi: '' };
  try {
    const model = getAI().getGenerativeModel({
      model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
    });
    const prompt = `Translate the following text to three languages.
Return ONLY a valid JSON object with exactly these three keys: "zh" (Traditional Chinese 繁體中文), "en" (English), "vi" (Vietnamese).
No markdown code block, no extra text, no explanation — just the raw JSON.

Text to translate:
${JSON.stringify(text)}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/^```json\s*|^```\s*|```\s*$/gm, '').trim();
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[Translation] translateText error:', e.message);
    return { zh: text, en: text, vi: text };
  }
}

/**
 * Translate name + optional description to all 3 languages.
 * @param {{ name?: string, description?: string }} fields
 * @returns {{ name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi }}
 */
async function translateFields(fields) {
  const { name = '', description = '' } = fields;
  const result = {
    name_zh: null, name_en: null, name_vi: null,
    desc_zh: null, desc_en: null, desc_vi: null,
  };

  if (name?.trim()) {
    const t = await translateText(name);
    result.name_zh = t.zh || null;
    result.name_en = t.en || null;
    result.name_vi = t.vi || null;
  }

  if (description?.trim()) {
    const t = await translateText(description);
    result.desc_zh = t.zh || null;
    result.desc_en = t.en || null;
    result.desc_vi = t.vi || null;
  }

  return result;
}

/**
 * Translate a single description field to { en, vi } (for schema column descriptions).
 * @param {string} description
 * @returns {{ desc_en, desc_vi }}
 */
async function translateDescription(description) {
  if (!description?.trim()) return { desc_en: null, desc_vi: null };
  try {
    const t = await translateText(description);
    return { desc_en: t.en || null, desc_vi: t.vi || null };
  } catch (_) {
    return { desc_en: null, desc_vi: null };
  }
}

module.exports = { translateText, translateFields, translateDescription };
