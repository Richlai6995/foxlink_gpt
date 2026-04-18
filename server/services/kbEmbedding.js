'use strict';
/**
 * Knowledge Base Embedding Service
 * 透過 geminiClient 自動切換 AI Studio / Vertex AI。
 * Supports variable output dimensionality (768 / 1536 / 3072).
 */

const { embedContent } = require('./geminiClient');

const DEFAULT_MODEL = process.env.KB_EMBEDDING_MODEL || 'gemini-embedding-001';

/**
 * Embed a single text string.
 * @param {string} text
 * @param {object} opts
 * @param {number} [opts.dims=768]
 * @param {string} [opts.model]
 * @returns {Promise<number[]>}
 */
async function embedText(text, { dims = 768, model } = {}) {
  return embedContent(text, { dims, model: model || DEFAULT_MODEL });
}

/**
 * Batch embed texts — sequential with configurable delay (legacy helper).
 * KB 上傳流程已改成 p-limit 並行（processDocument），這個 helper 目前沒人用但保留。
 */
async function embedBatch(texts, opts = {}) {
  const { dims = 768, model, delayMs = 150, onProgress } = opts;
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(await embedText(texts[i], { dims, model }));
    if (onProgress) onProgress(i + 1, texts.length);
    if (i < texts.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

/**
 * Convert a float array to an Oracle TO_VECTOR compatible JSON string.
 */
function toVectorStr(arr) {
  return JSON.stringify(arr);
}

module.exports = { embedText, embedBatch, toVectorStr, DEFAULT_MODEL };
