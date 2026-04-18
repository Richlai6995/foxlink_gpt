'use strict';
/**
 * 統一 Gemini 客戶端工廠 — 依 GEMINI_PROVIDER env 自動切換 AI Studio / Vertex AI。
 *
 * 使用方式
 *   const { getGenerativeModel, embedContent, extractText } = require('./geminiClient');
 *
 *   // 生成（兩 provider 共通，SDK interface 幾乎一致）
 *   const model = await getGenerativeModel({ model: 'gemini-2.0-flash' });
 *   const result = await model.generateContent([{ text: 'hi' }]);
 *   const text = extractText(result.response);
 *
 *   // Embedding（兩 provider 不同 backend，此 wrapper 統一）
 *   const vec = await embedContent('text...', { model: 'gemini-embedding-001', dims: 768 });
 *
 * Env 變數
 *   GEMINI_PROVIDER=vertex                  選擇 provider；其他值或未設 → AI Studio
 *   GEMINI_API_KEY=...                      AI Studio 用
 *   GCP_PROJECT_ID=gen-lang-client-xxx      Vertex AI 用
 *   GCP_LOCATION=us-central1                Vertex AI region
 *   GOOGLE_APPLICATION_CREDENTIALS=.../sa.json  Service account JSON 路徑
 */

const PROVIDER = process.env.GEMINI_PROVIDER === 'vertex' ? 'vertex' : 'studio';

// Model ID alias — map AI Studio 名稱到 Vertex AI 可用的 stable 版。
// 使用者可用 env var VERTEX_MODEL_ALIAS_<studio-id>=<vertex-id> 覆寫，
// e.g. VERTEX_MODEL_ALIAS_GEMINI_3_FLASH_PREVIEW=gemini-3-flash-preview-20250101
const VERTEX_MODEL_DEFAULTS = {
  'gemini-3-flash-preview':   'gemini-2.5-flash',
  'gemini-3-pro-preview':     'gemini-2.5-pro',
  'gemini-2.0-flash':         'gemini-2.5-flash',
  'gemini-2.0-flash-001':     'gemini-2.5-flash',
  'gemini-2.0-pro':           'gemini-2.5-pro',
};
function _resolveModelId(requested) {
  if (PROVIDER !== 'vertex' || !requested) return requested;
  // env override: VERTEX_MODEL_ALIAS_<normalized> (上底線取代 . 和 -)
  const envKey = 'VERTEX_MODEL_ALIAS_' + requested.toUpperCase().replace(/[.-]/g, '_');
  if (process.env[envKey]) return process.env[envKey];
  return VERTEX_MODEL_DEFAULTS[requested] || requested;
}

// ── Lazy singletons ──────────────────────────────────────────────────────────
let _vertexAI = null;
let _authClient = null;
let _studioGenAI = null;

function _initVertexAI() {
  if (_vertexAI) return _vertexAI;
  const { VertexAI } = require('@google-cloud/vertexai');
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';
  if (!project) throw new Error('GCP_PROJECT_ID 未設定（Vertex AI 必要）');
  _vertexAI = new VertexAI({ project, location });
  return _vertexAI;
}

async function _getAuthClient() {
  if (_authClient) return _authClient;
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  _authClient = await auth.getClient();
  return _authClient;
}

function _initStudioGenAI(apiKey) {
  if (_studioGenAI && !apiKey) return _studioGenAI;
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 未設定（AI Studio 必要）');
  const instance = new GoogleGenerativeAI(key);
  if (!apiKey) _studioGenAI = instance;
  return instance;
}

// ── Public: getGenerativeModel ────────────────────────────────────────────────

/**
 * 取得 generative model 實例。兩個 provider 都回傳 SDK 原生 model，
 * interface（generateContent / generateContentStream）一致。
 * @param {object} opts
 * @param {string} opts.model            — model id（e.g. 'gemini-2.0-flash'）
 * @param {string} [opts.systemInstruction]
 * @param {object} [opts.generationConfig]
 * @param {object} [opts.safetySettings]
 * @param {Array}  [opts.tools]
 * @param {string} [opts.apiKey]         — AI Studio only，覆寫 env key
 */
function getGenerativeModel(opts = {}) {
  const { apiKey, ...modelOpts } = opts;
  if (modelOpts.model) modelOpts.model = _resolveModelId(modelOpts.model);
  if (PROVIDER === 'vertex') {
    return _initVertexAI().getGenerativeModel(modelOpts);
  }
  return _initStudioGenAI(apiKey).getGenerativeModel(modelOpts);
}

// ── Public: embedContent ──────────────────────────────────────────────────────

/**
 * 向量化文字。
 * AI Studio 用 embedContent SDK method；Vertex AI 直接打 predict REST。
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.model]  — 預設 gemini-embedding-001
 * @param {number} [opts.dims]   — 預設 768
 * @returns {Promise<number[]>}
 */
async function embedContent(text, opts = {}) {
  const modelName = _resolveModelId(opts.model || process.env.KB_EMBEDDING_MODEL || 'gemini-embedding-001');
  const dims = opts.dims || 768;
  const trimmed = String(text).slice(0, 25000);

  if (PROVIDER === 'vertex') {
    const authClient = await _getAuthClient();
    const project = process.env.GCP_PROJECT_ID;
    const location = process.env.GCP_LOCATION || 'us-central1';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${modelName}:predict`;

    const res = await authClient.request({
      url,
      method: 'POST',
      data: {
        instances: [{ content: trimmed }],
        parameters: { outputDimensionality: dims },
      },
    });
    const values = res?.data?.predictions?.[0]?.embeddings?.values;
    if (!values) throw new Error(`Vertex AI embedContent empty response: ${JSON.stringify(res?.data).slice(0, 200)}`);
    return values;
  }

  // AI Studio
  const genAI = _initStudioGenAI();
  const embModel = genAI.getGenerativeModel({ model: modelName });
  const req = { content: { parts: [{ text: trimmed }] } };
  if (dims && modelName !== 'embedding-001') req.outputDimensionality = dims;
  const result = await embModel.embedContent(req);
  return Array.from(result.embedding.values);
}

// ── Public: text / usage 抽取（兩 SDK 回應結構不同，統一） ────────────────────

/**
 * 從 response 或 stream chunk 抽取 text。
 * AI Studio 有 .text() 方法；Vertex AI 只有 candidates[0].content.parts。
 */
function extractText(respOrChunk) {
  if (!respOrChunk) return '';
  // Some results wrap .response — unwrap
  const target = respOrChunk.response || respOrChunk;
  if (typeof target.text === 'function') {
    try { return target.text(); } catch { /* fall through */ }
  }
  const parts = target.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
}

/**
 * 從 response 抽取 usage（token count）。
 * 兩 SDK 都有 usageMetadata，但 Vertex AI 有時在 response 最外層、AI Studio 在 response.usageMetadata。
 */
function extractUsage(respOrResult) {
  const target = respOrResult?.response || respOrResult;
  const usage = target?.usageMetadata || {};
  return {
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
  };
}

// ── Diagnostic ────────────────────────────────────────────────────────────────
function logStartupInfo() {
  if (PROVIDER === 'vertex') {
    const project = process.env.GCP_PROJECT_ID;
    const location = process.env.GCP_LOCATION || 'us-central1';
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '(default ADC)';
    console.log(`[GeminiClient] provider=vertex project=${project} location=${location} sa=${saPath}`);
  } else {
    console.log(`[GeminiClient] provider=studio (AI Studio)`);
  }
}

module.exports = {
  PROVIDER,
  getGenerativeModel,
  embedContent,
  extractText,
  extractUsage,
  logStartupInfo,
  // Power users
  getVertexAI: _initVertexAI,
  getStudioGenAI: _initStudioGenAI,
};
