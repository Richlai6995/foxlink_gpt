'use strict';

const { createClient } = require('./llmService');
const { db } = require('../database-oracle');

/**
 * Translate a single text to { zh, en, vi }.
 * Uses the configured 'flash' LLM model from DB settings.
 */
async function translateText(text) {
  if (!text?.trim()) return { zh: '', en: '', vi: '' };
  try {
    // 翻譯服務固定用 env 的 flash model，不走 DB（避免 DB model 設定過時導致失敗）
    const flashModel = process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash-lite';
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY 未設定');
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: flashModel });
    const client = {
      generate: async (contents) => {
        const result = await model.generateContent({ contents });
        return result.response.text();
      }
    };
    const prompt = `Translate the following text to three languages.
Return ONLY a valid JSON object with exactly these three keys: "zh" (Traditional Chinese 繁體中文), "en" (English), "vi" (Vietnamese).
No markdown code block, no extra text, no explanation — just the raw JSON.

Text to translate:
${JSON.stringify(text)}`;

    const raw = (await client.generate([{ role: 'user', parts: [{ text: prompt }] }]))
      .trim()
      .replace(/^```json\s*|^```\s*|```\s*$/gm, '')
      .trim();
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

/**
 * Batch translate multiple descriptions in a single LLM call.
 * @param {Array<{id, description}>} items
 * @param {number} batchSize  max items per LLM call (default 30)
 * @returns {Map<id, {desc_en, desc_vi}>}
 */
async function batchTranslateDescriptions(items, batchSize = 30) {
  const results = new Map();
  const valid = items.filter(i => i.description?.trim());
  for (let i = 0; i < valid.length; i += batchSize) {
    const chunk = valid.slice(i, i + batchSize);
    try {
      const flashModel = process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash-lite';
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY 未設定');
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const m = genAI.getGenerativeModel({ model: flashModel });
      const client = { generate: async (contents) => { const r = await m.generateContent({ contents }); return r.response.text(); } };
      const payload = chunk.map((c, idx) => `${idx + 1}. ${c.description}`).join('\n');
      const prompt = `Translate each numbered item below to English (en) and Vietnamese (vi).
Return ONLY a valid JSON array with objects: [{"en":"...","vi":"..."}, ...].
Same order as input. No markdown, no extra text.

Items:
${payload}`;
      const raw = (await client.generate([{ role: 'user', parts: [{ text: prompt }] }]))
        .trim()
        .replace(/^```json\s*|^```\s*|```\s*$/gm, '')
        .trim();
      const parsed = JSON.parse(raw);
      chunk.forEach((c, idx) => {
        const t = parsed[idx] || {};
        results.set(c.id, { desc_en: t.en || null, desc_vi: t.vi || null });
      });
    } catch (e) {
      console.warn('[Translation] batchTranslateDescriptions error:', e.message);
      chunk.forEach(c => results.set(c.id, { desc_en: null, desc_vi: null }));
    }
  }
  return results;
}

module.exports = { translateText, translateFields, translateDescription, batchTranslateDescriptions };
