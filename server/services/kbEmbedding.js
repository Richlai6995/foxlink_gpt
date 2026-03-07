'use strict';
/**
 * Knowledge Base Embedding Service
 * Uses Google Generative AI embedding models (gemini-embedding-001 / text-embedding-004)
 * Supports variable output dimensionality (768 / 1536 / 3072) for models that allow it.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let _genAI = null;
function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

const DEFAULT_MODEL = process.env.KB_EMBEDDING_MODEL || 'gemini-embedding-001';

/**
 * Embed a single text string.
 * @param {string} text
 * @param {object} opts
 * @param {number} [opts.dims=768]   Output dimensionality
 * @param {string} [opts.model]      Override model name
 * @returns {Promise<number[]>}
 */
async function embedText(text, { dims = 768, model } = {}) {
  const modelName = model || DEFAULT_MODEL;
  const embModel = getGenAI().getGenerativeModel({ model: modelName });

  const req = {
    content: { parts: [{ text: text.slice(0, 25000) }] },
  };
  // Always request the configured dimension count.
  // Only 'embedding-001' (the legacy model) doesn't support outputDimensionality.
  // 'gemini-embedding-001' defaults to 3072, so we must explicitly set it even for 768.
  if (dims && modelName !== 'embedding-001') {
    req.outputDimensionality = dims;
  }

  const result = await embModel.embedContent(req);
  return Array.from(result.embedding.values);
}

/**
 * Batch embed texts. Adds small delay between calls to respect rate limits.
 * @param {string[]} texts
 * @param {object}   opts
 * @param {number}   [opts.dims=768]
 * @param {string}   [opts.model]
 * @param {number}   [opts.delayMs=150]   ms between requests
 * @param {function} [opts.onProgress]   (done: number, total: number) => void
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts, opts = {}) {
  const { dims = 768, model, delayMs = 150, onProgress } = opts;
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    const emb = await embedText(texts[i], { dims, model });
    results.push(emb);
    if (onProgress) onProgress(i + 1, texts.length);
    if (i < texts.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

/**
 * Convert a float array to an Oracle TO_VECTOR compatible JSON string.
 * e.g. "[0.1, 0.2, ...]"
 */
function toVectorStr(arr) {
  return JSON.stringify(arr);
}

module.exports = { embedText, embedBatch, toVectorStr, DEFAULT_MODEL };
