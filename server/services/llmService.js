'use strict';
/**
 * Unified LLM service — supports Gemini and Azure OpenAI.
 *
 * Usage:
 *   const { createClient, streamChat, generateContent } = require('./llmService');
 *   const client = await createClient(db, modelKey);
 *   const text = await client.generate(messages, systemPrompt);
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getGenerativeModel, extractText, extractUsage, PROVIDER: GEMINI_PROVIDER } = require('./geminiClient');
const { decryptKey } = require('./llmKeyService');

// ── Resolve model row from DB ─────────────────────────────────────────────────
async function resolveModel(db, modelKey) {
  try {
    const row = await db.prepare(
      `SELECT * FROM llm_models WHERE key=? AND is_active=1`
    ).get(modelKey);
    if (row) return row;
  } catch { /* ignore */ }
  // Fallback synthetic rows for env-only Gemini
  const flashModel = process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
  const proModel   = process.env.GEMINI_MODEL_PRO   || 'gemini-3-pro-preview';
  if (modelKey === 'flash') return { provider_type: 'gemini', api_model: flashModel };
  if (modelKey === 'pro')   return { provider_type: 'gemini', api_model: proModel };
  return { provider_type: 'gemini', api_model: modelKey };
}

// ── Gemini streaming wrapper ──────────────────────────────────────────────────
// Vertex AI 模式下忽略 per-model api_key_enc，一律走 service account；
// 只有 studio 模式才讀 DB 裡的 API key 欄位。
function makeGeminiClient(model) {
  const imageOutput = !!model.image_output;
  const apiModel    = model.api_model;

  // Studio-only: allow per-model override API key; Vertex 無此概念
  let studioKey = null;
  if (GEMINI_PROVIDER !== 'vertex') {
    studioKey = model.api_key_enc
      ? (decryptKey(model.api_key_enc) || process.env.GEMINI_API_KEY)
      : process.env.GEMINI_API_KEY;
    if (!studioKey) throw new Error('Gemini API key 未設定');
  }

  const makeModel = (systemPrompt) => getGenerativeModel({
    model: apiModel,
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    ...(studioKey ? { apiKey: studioKey } : {}),
  });

  return {
    provider:    'gemini',
    apiModel,
    imageOutput,
    geminiProvider: GEMINI_PROVIDER,
    // Single-turn generate (returns text)
    async generate(contents, systemPrompt) {
      const m = makeModel(systemPrompt);
      const result = await m.generateContent({ contents });
      return extractText(result);
    },
    // Streaming generate — yields chunks, returns { text, usage }
    async *stream(contents, systemPrompt) {
      const m = makeModel(systemPrompt);
      const result = await m.generateContentStream({ contents });
      let fullText = '';
      for await (const chunk of result.stream) {
        const t = extractText(chunk);
        if (t) { fullText += t; yield t; }
      }
      const usage = extractUsage(await result.response);
      return {
        text: fullText,
        inputTokens:  usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    },
  };
}

// ── Azure OpenAI wrapper ──────────────────────────────────────────────────────
function makeAzureOpenAIClient(model) {
  const { AzureOpenAI } = require('openai');
  const apiKey = decryptKey(model.api_key_enc);
  if (!apiKey)          throw new Error(`AOAI model "${model.key}" 的 API key 未設定`);
  if (!model.endpoint_url)     throw new Error(`AOAI model "${model.key}" 的 Endpoint URL 未設定`);
  if (!model.deployment_name)  throw new Error(`AOAI model "${model.key}" 的 Deployment Name 未設定`);

  const client = new AzureOpenAI({
    endpoint:   model.endpoint_url,
    apiKey,
    apiVersion: model.api_version || '2024-08-01-preview',
    deployment: model.deployment_name,
  });

  return {
    provider:    'azure_openai',
    apiModel:    model.deployment_name,
    imageOutput: false,
    // Single-turn generate
    async generate(contents, systemPrompt) {
      const messages = contentsToOpenAI(contents, systemPrompt);
      const resp = await client.chat.completions.create({
        model:    model.deployment_name,
        messages,
      });
      return resp.choices[0]?.message?.content || '';
    },
    // Streaming
    async *stream(contents, systemPrompt) {
      const messages = contentsToOpenAI(contents, systemPrompt);
      const stream = await client.chat.completions.create({
        model:    model.deployment_name,
        messages,
        stream:   true,
      });
      let fullText = '';
      let inputTokens = 0, outputTokens = 0;
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content || '';
        if (delta) { fullText += delta; yield delta; }
        if (chunk.usage) {
          inputTokens  = chunk.usage.prompt_tokens     || 0;
          outputTokens = chunk.usage.completion_tokens || 0;
        }
      }
      return { text: fullText, inputTokens, outputTokens };
    },
  };
}

// ── Convert Gemini inlineData → AOAI image_url content part ─────────────────
function inlineDataToAoai(part) {
  const { data, mimeType } = part.inlineData;
  if (mimeType && mimeType.startsWith('image/')) {
    return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } };
  }
  return null; // non-image inlineData (e.g. PDF) should have been text-extracted upstream
}

// ── Convert Gemini-style parts array → AOAI content (string or array) ───────
function geminiPartsToAoaiContent(parts) {
  if (!Array.isArray(parts)) return String(parts || '');
  const contentParts = [];
  for (const p of parts) {
    if (p.text) {
      contentParts.push({ type: 'text', text: p.text });
    } else if (p.inlineData) {
      const converted = inlineDataToAoai(p);
      if (converted) contentParts.push(converted);
    }
  }
  if (contentParts.length === 0) return null;
  // If only text parts, flatten to simple string for compatibility
  if (contentParts.every((p) => p.type === 'text')) {
    return contentParts.map((p) => p.text).join('\n');
  }
  return contentParts;
}

// ── Convert Gemini-style contents → OpenAI messages ──────────────────────────
function contentsToOpenAI(contents, systemPrompt) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (const c of contents) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    if (typeof c.parts === 'string') {
      messages.push({ role, content: c.parts });
    } else if (Array.isArray(c.parts)) {
      const content = geminiPartsToAoaiContent(c.parts);
      if (content) messages.push({ role, content });
    }
  }
  return messages;
}

// ── Azure OpenAI streamChat (same interface as gemini.js streamChat) ──────────
/**
 * AOAI streaming chat — mirrors gemini.js streamChat signature so chat.js can
 * route to either provider with a single function swap.
 *
 * @param {object} modelRow   - Full llm_models DB row (needs api_key_enc, endpoint_url, etc.)
 * @param {Array}  history    - Gemini-format history [{role, parts:[{text}]}]
 * @param {Array}  userParts  - Current user message parts [{text}] | [{inlineData}]
 * @param {Function} onChunk  - Called with each text chunk string
 * @param {string} extraSystem - Additional system instruction text
 * @returns {{ text, inputTokens, outputTokens }}
 */
async function streamChatAoai(modelRow, history, userParts, onChunk, extraSystem = '', genConfig = null) {
  const { AzureOpenAI } = require('openai');
  const apiKey = decryptKey(modelRow.api_key_enc);
  if (!apiKey)                throw new Error(`AOAI model "${modelRow.key}" 的 API key 未設定`);
  if (!modelRow.endpoint_url) throw new Error(`AOAI model "${modelRow.key}" 的 Endpoint URL 未設定`);

  const client = new AzureOpenAI({
    endpoint:   modelRow.endpoint_url,
    apiKey,
    apiVersion: modelRow.api_version || '2024-08-01-preview',
    deployment: modelRow.deployment_name,
  });

  // Convert history to OpenAI messages
  const messages = [];

  // System prompt
  const systemPrompt = [
    '你是 Cortex，一個企業智能助手。請以清晰、專業的繁體中文回答問題，並使用 Markdown 格式化輸出。',
    extraSystem,
  ].filter(Boolean).join('\n\n---\n\n');
  messages.push({ role: 'system', content: systemPrompt });

  // History (with image support via inlineData → image_url conversion)
  for (const h of history) {
    const role = h.role === 'model' ? 'assistant' : 'user';
    const content = geminiPartsToAoaiContent(h.parts);
    if (content) messages.push({ role, content });
  }

  // Current user message (text + image inlineData → AOAI content array)
  const userContent = geminiPartsToAoaiContent(userParts);
  if (userContent) messages.push({ role: 'user', content: userContent });

  // o1/o3 series: no system role, no streaming, use max_completion_tokens
  const isO1 = /^o\d/i.test(modelRow.deployment_name || '');
  // GPT-5.x series: supports streaming + system role + reasoning_effort
  const isGpt5 = /^gpt-5/i.test(modelRow.deployment_name || '');

  if (isO1) {
    // o1/o3 doesn't support streaming — do a regular call and simulate chunking
    const filteredMsgs = messages.filter((m) => m.role !== 'system');
    const resp = await client.chat.completions.create({
      model: modelRow.deployment_name,
      messages: filteredMsgs,
      max_completion_tokens: genConfig?.max_output_tokens || 8192,
    });
    const text = resp.choices?.[0]?.message?.content || '';
    onChunk(text);
    return {
      text,
      inputTokens:  resp.usage?.prompt_tokens     || 0,
      outputTokens: resp.usage?.completion_tokens || 0,
    };
  }

  const streamOpts = {
    model:    modelRow.deployment_name,
    messages,
    stream:   true,
    stream_options: { include_usage: true },
    ...(genConfig?.temperature != null ? { temperature: genConfig.temperature } : {}),
    ...(genConfig?.top_p != null ? { top_p: genConfig.top_p } : {}),
    ...(isGpt5 ? {
      max_completion_tokens: genConfig?.max_output_tokens || 16384,
      reasoning_effort: genConfig?.reasoning_effort || 'low',
    } : {
      ...(genConfig?.max_output_tokens ? { max_tokens: genConfig.max_output_tokens } : {}),
    }),
  };
  const stream = await client.chat.completions.create(streamOpts);

  let fullText = '';
  let inputTokens = 0, outputTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) { fullText += delta; onChunk(delta); }
    if (chunk.usage) {
      inputTokens  = chunk.usage.prompt_tokens     || 0;
      outputTokens = chunk.usage.completion_tokens || 0;
    }
  }

  return { text: fullText, inputTokens, outputTokens };
}

// ── Public API ────────────────────────────────────────────────────────────────
async function createClient(db, modelKey) {
  const model = await resolveModel(db, modelKey);
  const pt = (model.provider_type || 'gemini').toLowerCase();
  if (pt === 'azure_openai') return makeAzureOpenAIClient(model);
  return makeGeminiClient(model);
}

module.exports = { createClient, resolveModel, streamChatAoai };
