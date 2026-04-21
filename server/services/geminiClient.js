'use strict';
/**
 * 統一 Gemini 客戶端工廠 — generate / embed 可獨立選 AI Studio 或 Vertex AI。
 *
 * 設計理由
 *   • 生成(chat / vision / transcribe)預設走 Studio:Vertex gRPC inline payload
 *     上限 ~4MB,大檔 screenshot/wav 會被 backend silently drop 後回誤導性錯誤。
 *   • Embedding(KB 向量化)預設走 Vertex:Studio 的 RPM/RPD 配額做不完 KB 批次。
 *
 * 使用方式
 *   const { getGenerativeModel, embedContent, extractText } = require('./geminiClient');
 *   const model = await getGenerativeModel({ model: 'gemini-2.5-flash' });
 *   // 強制某個 provider:
 *   const model = await getGenerativeModel({ model: '...', provider: 'studio' });
 *   const vec = await embedContent('text...', { dims: 768 });
 *
 * Env 變數
 *   GEMINI_SDK=new|old                      SDK 選擇(new = @google/genai,old = 舊兩個 SDK 組合,預設 old)
 *   GEMINI_GENERATE_PROVIDER=studio|vertex  生成 provider(未設 = fallback legacy)
 *   GEMINI_EMBED_PROVIDER=studio|vertex     embedding provider(未設 = fallback legacy)
 *   GEMINI_PROVIDER=studio|vertex           legacy 單一開關(兩項未設時沿用)
 *   GEMINI_API_KEY=...                      AI Studio 必要
 *   GCP_PROJECT_ID / GCP_LOCATION / GOOGLE_APPLICATION_CREDENTIALS  Vertex 必要
 */

// ── SDK 選擇 ────────────────────────────────────────────────────────────────
// new = @google/genai(統一 SDK,支援 Vertex global endpoint,可跑真 Gemini 3.x preview)
// old = @google-cloud/vertexai + @google/generative-ai(現行、預設)
// 遷移期雙路並存,Phase 3 驗證全綠後切 new default;Phase 4 砍 old。
const SDK_MODE = process.env.GEMINI_SDK === 'new' ? 'new' : 'old';

// ── Provider 設定 ───────────────────────────────────────────────────────────
// 拆成兩組 provider,理由:
//   • LLM 生成(chat / vision / transcribe)— 走 Studio 避開 Vertex gRPC 4MB inline 上限
//   • Embedding(KB 向量化)— 走 Vertex 避開 Studio RPM/RPD 配額上限
// 向後相容:若只設 GEMINI_PROVIDER,兩者皆跟隨;細項 env 可單獨覆寫。
const LEGACY_PROVIDER = process.env.GEMINI_PROVIDER === 'vertex' ? 'vertex' : 'studio';
const GENERATE_PROVIDER =
  process.env.GEMINI_GENERATE_PROVIDER === 'vertex' ? 'vertex'
  : process.env.GEMINI_GENERATE_PROVIDER === 'studio' ? 'studio'
  : LEGACY_PROVIDER;
const EMBED_PROVIDER =
  process.env.GEMINI_EMBED_PROVIDER === 'vertex' ? 'vertex'
  : process.env.GEMINI_EMBED_PROVIDER === 'studio' ? 'studio'
  : LEGACY_PROVIDER;
// 對外仍暴露 PROVIDER(指 generate 主 provider,legacy callers 用)
const PROVIDER = GENERATE_PROVIDER;

// Model ID alias — 兩張 map,視 SDK_MODE 擇一。
//
// 【old SDK】@google-cloud/vertexai 1.12 不支援 Vertex global endpoint,
// Gemini 3.x preview 只在 global 上線,regional 下跑 3.x 要降級到 2.5 stable。
//
// 【new SDK】@google/genai 走 global 可跑真 3.x,不需降級。但仍要處理兩件事:
//   1. Google 2026 Q1 下架 gemini-3-pro-preview(401/404),正式版叫 gemini-3.1-pro-preview —
//      DB / env 裡的舊字串要 auto-fallback,免得 admin 漏 migrate 就炸 chat
//   2. Image generation (Nano Banana) 的 AI Studio 命名 ≠ Vertex 命名 — 保留翻譯
const VERTEX_MODEL_DEFAULTS_OLD_SDK = {
  'gemini-3-flash-preview':       'gemini-2.5-flash',
  'gemini-3-pro-preview':         'gemini-2.5-pro',
  'gemini-3.1-pro-preview':       'gemini-2.5-pro',
  'gemini-3.1-flash-preview':     'gemini-2.5-flash',
  'gemini-2.0-flash':             'gemini-2.5-flash',
  'gemini-2.0-flash-001':         'gemini-2.5-flash',
  'gemini-2.0-pro':               'gemini-2.5-pro',
  // Image generation (Nano Banana) — AI Studio 命名 → Vertex AI 命名
  'gemini-3-pro-image-preview':   'gemini-2.5-flash-image-preview',
  'gemini-3-flash-image-preview': 'gemini-2.5-flash-image-preview',
  'gemini-3.1-pro-image-preview': 'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image':       'gemini-2.5-flash-image-preview',
};
const VERTEX_MODEL_DEFAULTS_NEW_SDK = {
  // Google 2026 Q1 下架;3.x Pro 的正式 preview 名稱是 3.1
  'gemini-3-pro-preview':         'gemini-3.1-pro-preview',
  // Image generation — 新 SDK 在 Vertex global 的 image model 命名尚未完全對齊,先保持翻譯
  'gemini-3-pro-image-preview':   'gemini-2.5-flash-image-preview',
  'gemini-3-flash-image-preview': 'gemini-2.5-flash-image-preview',
  'gemini-3.1-pro-image-preview': 'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image':       'gemini-2.5-flash-image-preview',
};
// Legacy 名稱保留給外部 inspector / admin UI(現行實作 import 這個常數顯示 alias 表)
const VERTEX_MODEL_DEFAULTS = SDK_MODE === 'new' ? VERTEX_MODEL_DEFAULTS_NEW_SDK : VERTEX_MODEL_DEFAULTS_OLD_SDK;
function _resolveModelId(requested, targetProvider) {
  if (targetProvider !== 'vertex' || !requested) return requested;
  // env override: VERTEX_MODEL_ALIAS_<normalized> (上底線取代 . 和 -)— 永遠最高優先
  const envKey = 'VERTEX_MODEL_ALIAS_' + requested.toUpperCase().replace(/[.-]/g, '_');
  if (process.env[envKey]) return process.env[envKey];
  const table = SDK_MODE === 'new' ? VERTEX_MODEL_DEFAULTS_NEW_SDK : VERTEX_MODEL_DEFAULTS_OLD_SDK;
  return table[requested] || requested;
}

// ── Lazy singletons ──────────────────────────────────────────────────────────
let _vertexAI = null;           // old SDK @google-cloud/vertexai
let _authClient = null;         // old SDK embed REST
let _studioGenAI = null;        // old SDK @google/generative-ai
let _newVertexGenAI = null;     // new SDK @google/genai (vertex)
let _newStudioGenAI = null;     // new SDK @google/genai (studio)

// ── Old SDK initialisers ─────────────────────────────────────────────────────

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

// ── New SDK initialisers (@google/genai) ─────────────────────────────────────

function _initNewVertexGenAI() {
  if (_newVertexGenAI) return _newVertexGenAI;
  const { GoogleGenAI } = require('@google/genai');
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';
  if (!project) throw new Error('GCP_PROJECT_ID 未設定（Vertex AI 必要）');
  _newVertexGenAI = new GoogleGenAI({ vertexai: true, project, location });
  return _newVertexGenAI;
}

function _initNewStudioGenAI(apiKey) {
  if (_newStudioGenAI && !apiKey) return _newStudioGenAI;
  const { GoogleGenAI } = require('@google/genai');
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 未設定（AI Studio 必要）');
  const instance = new GoogleGenAI({ apiKey: key });
  if (!apiKey) _newStudioGenAI = instance;
  return instance;
}

// ── NewSdkModel proxy ────────────────────────────────────────────────────────
// 把 @google/genai 的 `genai.models.generateContent({ model, contents, config })` flat API
// 包成舊 SDK 的 `model.generateContent(req)` / `model.generateContentStream(req)` /
// `model.startChat({history}).sendMessageStream(parts)` interface,讓 21 個 caller 不用改。
//
// 翻譯規則:
//   • getGenerativeModel({ systemInstruction, generationConfig, tools, safetySettings })
//     → 存在 proxy instance 裡,每次 call 時 merge 成 config
//   • generationConfig 展平到 config (新 SDK 把 temperature / maxOutputTokens 等直接放 config 頂層)
//   • { stream, response } 介面:wrappedStream 邊 iter 邊收集 chunks,response getter 等 stream drain
//     完後 aggregate 成舊 SDK 格式 ({ candidates, usageMetadata })

function _aggregateStreamChunks(chunks) {
  const allParts = [];
  let finishReason;
  let groundingMetadata;
  let usageMetadata;
  for (const chunk of chunks) {
    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
    const cand = chunk.candidates?.[0];
    if (!cand) continue;
    if (cand.finishReason) finishReason = cand.finishReason;
    if (cand.groundingMetadata) groundingMetadata = cand.groundingMetadata;
    const parts = cand.content?.parts || [];
    allParts.push(...parts);
  }
  return {
    candidates: [{
      content: { role: 'model', parts: allParts },
      ...(finishReason ? { finishReason } : {}),
      ...(groundingMetadata ? { groundingMetadata } : {}),
    }],
    usageMetadata,
    // 舊 SDK response.text() 是 method;這裡提供 property 作相容 shim,extractText 會 fallback
    text: allParts.filter((p) => p.text && !p.thought).map((p) => p.text).join(''),
  };
}

class NewSdkModel {
  constructor(genai, opts) {
    this.genai = genai;
    this.modelName = opts.model;
    this.systemInstruction = opts.systemInstruction;
    this.generationConfig = opts.generationConfig || {};
    this.safetySettings = opts.safetySettings;
    this.tools = opts.tools;
  }

  _buildConfig(extraReq) {
    const cfg = {};
    if (this.systemInstruction) cfg.systemInstruction = this.systemInstruction;
    if (this.tools && this.tools.length) cfg.tools = this.tools;
    if (this.safetySettings) cfg.safetySettings = this.safetySettings;
    // generationConfig 展平到 config top-level(新 SDK 的 shape)
    Object.assign(cfg, this.generationConfig);
    // 每次 call 可再覆寫
    if (extraReq && typeof extraReq === 'object' && !Array.isArray(extraReq)) {
      if (extraReq.generationConfig) Object.assign(cfg, extraReq.generationConfig);
      if (extraReq.tools && extraReq.tools.length) cfg.tools = extraReq.tools;
      if (extraReq.systemInstruction) cfg.systemInstruction = extraReq.systemInstruction;
      if (extraReq.safetySettings) cfg.safetySettings = extraReq.safetySettings;
    }
    // Gemini 3.x(preview)預設 includeThoughts=false → thought 合併進 final text 回,
    // streamChat 會把英文 planning leak 到中文回答前。強制開讓 SDK 切獨立 parts,
    // 配合 extractText 的 !p.thought filter 乾淨剝離。caller 顯式設則尊重。
    //
    // thinkingBudget 不在 wrapper 層 default — chat / tool-loop 的 default=512 在 gemini.js 的
    // `_resolveThinkingBudget` 處理,其他 batch service(dashboard SQL、research、OCR、翻譯)
    // 各自的 Flash 行為保留 SDK default(dynamic),不受 chat 優化影響。
    if (/gemini-3/i.test(this.modelName || '')) {
      const tc = { ...(cfg.thinkingConfig || {}) };
      if (tc.includeThoughts === undefined) tc.includeThoughts = true;
      cfg.thinkingConfig = tc;
    }
    return cfg;
  }

  _normalizeContents(input) {
    // 舊 SDK generateContent 可接受:
    //   - 'string'                             → { role: 'user', parts: [{text}] }
    //   - [{text}, {inlineData}, ...]          → { role: 'user', parts: [...] }
    //   - { contents: [...] }                  → contents 原樣
    // 新 SDK 的 contents 欄位支援上面所有格式 + Content/Content[],直接透傳
    if (typeof input === 'string') return input;
    if (Array.isArray(input)) return [{ role: 'user', parts: input }];
    if (input && input.contents) return input.contents;
    return input;
  }

  async generateContent(req) {
    const contents = this._normalizeContents(req);
    const config = this._buildConfig(req);
    const res = await this.genai.models.generateContent({
      model: this.modelName,
      contents,
      config,
    });
    // 仿舊 SDK `result.response` — 讓 callers 同時能 `.candidates[0]` 或 `.response.candidates[0]`
    // 新 SDK 的 `.text` 是 getter 回 string,舊 SDK 是 method;extractText 會 fallback 到從 parts 抽
    // 所以兩種 shape 都能正常 work
    if (!res.response) {
      try { Object.defineProperty(res, 'response', { value: res, enumerable: false, configurable: true }); }
      catch (_) { /* some responses are frozen */ }
    }
    return res;
  }

  async generateContentStream(req) {
    const contents = this._normalizeContents(req);
    const config = this._buildConfig(req);
    const rawStream = await this.genai.models.generateContentStream({
      model: this.modelName,
      contents,
      config,
    });

    const chunks = [];
    async function* wrapped() {
      for await (const c of rawStream) {
        chunks.push(c);
        yield c;
      }
    }
    const iter = wrapped();
    let responsePromise = null;
    return {
      stream: iter,
      get response() {
        if (!responsePromise) {
          responsePromise = (async () => {
            // 若 caller 沒 drain,先 drain 完才能 aggregate
            // eslint-disable-next-line no-unused-vars
            for await (const _ of iter) { /* exhaust */ }
            return _aggregateStreamChunks(chunks);
          })();
        }
        return responsePromise;
      },
    };
  }

  startChat({ history = [] } = {}) {
    const chatHistory = history.slice();
    const self = this;
    return {
      async sendMessage(parts) {
        const partsArr = Array.isArray(parts) ? parts
          : typeof parts === 'string' ? [{ text: parts }]
          : [parts];
        const userContent = { role: 'user', parts: partsArr };
        const contents = [...chatHistory, userContent];
        const result = await self.generateContent({ contents });
        chatHistory.push(userContent);
        const modelParts = result.candidates?.[0]?.content?.parts || [];
        if (modelParts.length) chatHistory.push({ role: 'model', parts: modelParts });
        return result;
      },
      async sendMessageStream(parts) {
        const partsArr = Array.isArray(parts) ? parts
          : typeof parts === 'string' ? [{ text: parts }]
          : [parts];
        const userContent = { role: 'user', parts: partsArr };
        const contents = [...chatHistory, userContent];
        // streaming 版不自動 append model turn 到 chatHistory —
        // 實戰 callers(gemini.js streamChat)每次新 startChat + 自管 history,不依賴 chat 記回。
        // 若在此 access streamResult.response 會立刻觸發 getter → drain iter,caller 拿不到 chunks。
        return self.generateContentStream({ contents });
      },
      getHistory() { return chatHistory.slice(); },
    };
  }
}

// ── Public: getGenerativeModel ────────────────────────────────────────────────

/**
 * 取得 generative model 實例。兩個 provider 都回傳 SDK 原生 model(或新 SDK proxy),
 * interface(generateContent / generateContentStream / startChat)一致。
 * @param {object} opts
 * @param {string} opts.model            — model id(e.g. 'gemini-2.0-flash')
 * @param {string} [opts.systemInstruction]
 * @param {object} [opts.generationConfig]
 * @param {object} [opts.safetySettings]
 * @param {Array}  [opts.tools]
 * @param {string} [opts.provider]       — 'studio' | 'vertex' 強制 override
 * @param {string} [opts.apiKey]         — AI Studio only,覆寫 env key
 */
function getGenerativeModel(opts = {}) {
  const { apiKey, provider: forceProvider, ...modelOpts } = opts;
  const useProvider = forceProvider === 'studio' || forceProvider === 'vertex'
    ? forceProvider
    : GENERATE_PROVIDER;
  // 只有走 vertex 時才需要 alias 轉換(studio 用原本的 model id)
  if (modelOpts.model && useProvider === 'vertex') {
    modelOpts.model = _resolveModelId(modelOpts.model, 'vertex');
  }

  if (SDK_MODE === 'new') {
    const genai = useProvider === 'vertex' ? _initNewVertexGenAI() : _initNewStudioGenAI(apiKey);
    return new NewSdkModel(genai, modelOpts);
  }

  // Old SDK path(保留)
  if (useProvider === 'vertex') {
    return _initVertexAI().getGenerativeModel(modelOpts);
  }
  return _initStudioGenAI(apiKey).getGenerativeModel(modelOpts);
}

// ── Public: embedContent ──────────────────────────────────────────────────────

/**
 * 向量化文字。
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.model]    — 預設 gemini-embedding-001
 * @param {number} [opts.dims]     — 預設 768
 * @param {string} [opts.provider] — 'studio' | 'vertex' 強制 override
 * @returns {Promise<number[]>}
 */
async function embedContent(text, opts = {}) {
  const useProvider = opts.provider === 'studio' || opts.provider === 'vertex'
    ? opts.provider
    : EMBED_PROVIDER;
  const modelName = _resolveModelId(opts.model || process.env.KB_EMBEDDING_MODEL || 'gemini-embedding-001', useProvider);
  const dims = opts.dims || 768;
  const trimmed = String(text).slice(0, 25000);

  if (SDK_MODE === 'new') {
    const genai = useProvider === 'vertex' ? _initNewVertexGenAI() : _initNewStudioGenAI();
    const res = await genai.models.embedContent({
      model: modelName,
      contents: trimmed,
      config: { outputDimensionality: dims },
    });
    const values = res?.embeddings?.[0]?.values;
    if (!values) throw new Error(`@google/genai embedContent empty response: ${JSON.stringify(res).slice(0, 200)}`);
    return values;
  }

  // Old SDK path
  if (useProvider === 'vertex') {
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

// ── Public: text / usage 抽取(兩 SDK 回應結構不同,統一) ────────────────────

/**
 * 從 response 或 stream chunk 抽取 text — **會過濾 thought parts**。
 *
 * 行為統一:一律走 parts 迴圈 + `!p.thought` filter,不用 SDK 內建 `.text` 取值器,
 * 原因:
 *   • 舊 SDK Studio 的 .text() method 內部已過濾 thoughts,結果相同
 *   • 新 SDK(@google/genai)的 .text getter 實測對 Gemini 3 thinking
 *     會把 plan/outline 段當成 final text 一起回,直接用會在 streamChat 中看到
 *     英文 thinking 段 leak 到中文回答前(使用者回報的 bug)
 * 結論:一律從 parts 自己抽並剔除 thought,行為最可預期。
 */
function extractText(respOrChunk) {
  if (!respOrChunk) return '';
  const target = respOrChunk.response || respOrChunk;
  const parts = target.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('');
}

/**
 * 從 response 抽取 usage(token count)。
 * 兩 SDK 都有 usageMetadata,舊 Vertex 有時在最外層、舊 Studio 在 response.usageMetadata、
 * 新 SDK 回扁平 response 直接 .usageMetadata。extractUsage 已 unwrap `.response`。
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
  const needsVertex = GENERATE_PROVIDER === 'vertex' || EMBED_PROVIDER === 'vertex';
  const sdkTag = SDK_MODE === 'new' ? '@google/genai' : '@google-cloud/vertexai + @google/generative-ai';
  if (needsVertex) {
    const project = process.env.GCP_PROJECT_ID;
    const location = process.env.GCP_LOCATION || 'us-central1';
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '(default ADC)';
    console.log(`[GeminiClient] sdk=${SDK_MODE} (${sdkTag}) generate=${GENERATE_PROVIDER} embed=${EMBED_PROVIDER} (vertex project=${project} location=${location} sa=${saPath})`);
  } else {
    console.log(`[GeminiClient] sdk=${SDK_MODE} (${sdkTag}) generate=${GENERATE_PROVIDER} embed=${EMBED_PROVIDER} (all AI Studio)`);
  }
}

module.exports = {
  SDK_MODE,
  PROVIDER,            // = GENERATE_PROVIDER,legacy callers 用
  GENERATE_PROVIDER,
  EMBED_PROVIDER,
  getGenerativeModel,
  embedContent,
  extractText,
  extractUsage,
  logStartupInfo,
  // Power users
  getVertexAI: _initVertexAI,
  getStudioGenAI: _initStudioGenAI,
  getNewGenAI: (provider) => (provider === 'studio' ? _initNewStudioGenAI() : _initNewVertexGenAI()),
};
