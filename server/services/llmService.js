'use strict';
/**
 * Unified LLM service — supports Gemini and Azure OpenAI.
 *
 * Usage:
 *   const { createClient, streamChat, generateContent } = require('./llmService');
 *   const client = await createClient(db, modelKey);
 *   const text = await client.generate(messages, systemPrompt);
 */
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

// ── Azure OpenAI streamChat + tool-calling (mirrors gemini.generateWithToolsStream) ──
/**
 * AOAI streaming chat with function/tool calling loop.
 *
 * Converts Gemini-style functionDeclarations → OpenAI tools[], runs the
 * tool-call loop: stream → if finish_reason='tool_calls' → execute → feed back
 * as role:'tool' messages → stream again, up to MAX_TOOL_ROUNDS.
 *
 * @param {object}   modelRow              - Full llm_models row
 * @param {Array}    history               - Gemini-format history
 * @param {Array}    userParts             - [{text}] | [{inlineData}]
 * @param {Array}    functionDeclarations  - [{name, description, parameters}] (Gemini-style)
 * @param {Function} toolHandler           - async (name, args) => result
 * @param {Function} onChunk               - (text) => void
 * @param {Function} onToolStatus          - (msg) => void
 * @param {string}   extraSystemInstruction
 * @param {object}   opts                  - { directAnswerTools: Set<string> }
 * @param {object}   genConfig
 */
async function streamChatAoaiWithTools(
  modelRow, history, userParts, functionDeclarations, toolHandler,
  onChunk, onToolStatus, extraSystemInstruction = '', opts = {}, genConfig = null
) {
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

  // ── Build initial messages ────────────────────────────────────────────────
  const systemPrompt = [
    '你是 Cortex，一個企業智能助手。請以清晰、專業的繁體中文回答問題，並使用 Markdown 格式化輸出。',
    extraSystemInstruction,
  ].filter(Boolean).join('\n\n---\n\n');

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history) {
    const role = h.role === 'model' ? 'assistant' : 'user';
    const content = geminiPartsToAoaiContent(h.parts);
    if (content) messages.push({ role, content });
  }
  const userContent = geminiPartsToAoaiContent(userParts);
  if (userContent) messages.push({ role: 'user', content: userContent });

  // ── Convert Gemini functionDeclarations → OpenAI tools ───────────────────
  // OpenAI tool names: ^[a-zA-Z0-9_-]{1,64}$ (Gemini 的 safeName 已符合)
  const tools = functionDeclarations.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description || '',
      parameters: d.parameters || { type: 'object', properties: {} },
    },
  }));

  const isGpt5 = /^gpt-5/i.test(modelRow.deployment_name || '');
  const buildStreamOpts = () => ({
    model:          modelRow.deployment_name,
    messages,
    stream:         true,
    stream_options: { include_usage: true },
    tools,
    tool_choice:    'auto',
    ...(genConfig?.temperature != null ? { temperature: genConfig.temperature } : {}),
    ...(genConfig?.top_p != null ? { top_p: genConfig.top_p } : {}),
    ...(isGpt5 ? {
      max_completion_tokens: genConfig?.max_output_tokens || 16384,
      reasoning_effort: genConfig?.reasoning_effort || 'low',
    } : {
      ...(genConfig?.max_output_tokens ? { max_tokens: genConfig.max_output_tokens } : {}),
    }),
  });

  let fullText = '';
  let inputTokens = 0, outputTokens = 0;
  let toolCallCount = 0;
  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await client.chat.completions.create(buildStreamOpts());

    let roundText = '';
    let finishReason = null;
    // tool_calls accumulator indexed by `index` field from OpenAI deltas
    const toolCallsAcc = {};

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) {
        if (chunk.usage) {
          inputTokens  += chunk.usage.prompt_tokens     || 0;
          outputTokens += chunk.usage.completion_tokens || 0;
        }
        continue;
      }
      const delta = choice.delta || {};

      if (delta.content) {
        roundText += delta.content;
        fullText  += delta.content;
        onChunk(delta.content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsAcc[idx]) {
            toolCallsAcc[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
          }
          if (tc.id) toolCallsAcc[idx].id = tc.id;
          if (tc.function?.name) toolCallsAcc[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallsAcc[idx].function.arguments += tc.function.arguments;
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) {
        inputTokens  += chunk.usage.prompt_tokens     || 0;
        outputTokens += chunk.usage.completion_tokens || 0;
      }
    }

    const toolCalls = Object.keys(toolCallsAcc)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => toolCallsAcc[k])
      .filter((c) => c.function.name);

    console.log(`[AOAI][round=${round}] finish=${finishReason} text=${roundText.length} toolCalls=${toolCalls.length}${toolCalls.length ? ' (' + toolCalls.map(c => c.function.name).join(',') + ')' : ''}`);

    if (toolCalls.length === 0) break;

    // ── Append assistant turn (with tool_calls) to history ───────────────
    messages.push({
      role:       'assistant',
      content:    roundText || null,
      tool_calls: toolCalls,
    });

    // ── Execute tools ────────────────────────────────────────────────────
    let directAnswerText = null;
    for (const call of toolCalls) {
      toolCallCount++;
      const name = call.function.name;
      let args = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; }
      catch (e) { console.warn(`[AOAI] Failed to parse tool args for ${name}: ${e.message}`); }

      if (onToolStatus) onToolStatus(`呼叫工具：${name}`);
      let toolResult;
      try {
        toolResult = await toolHandler(name, args);
      } catch (e) {
        toolResult = `[Tool error: ${e.message}]`;
      }

      if (opts.directAnswerTools?.has(name)) {
        directAnswerText = String(toolResult);
      }

      messages.push({
        role:         'tool',
        tool_call_id: call.id,
        content:      String(toolResult),
      });
    }

    if (directAnswerText !== null) {
      return { text: directAnswerText, inputTokens, outputTokens, toolCallCount, isDirectAnswer: true };
    }

    // Loop → next round will call the model with tool results appended
  }

  return { text: fullText, inputTokens, outputTokens, toolCallCount };
}

// ── Public API ────────────────────────────────────────────────────────────────
async function createClient(db, modelKey) {
  const model = await resolveModel(db, modelKey);
  const pt = (model.provider_type || 'gemini').toLowerCase();
  if (pt === 'azure_openai') return makeAzureOpenAIClient(model);
  return makeGeminiClient(model);
}

module.exports = { createClient, resolveModel, streamChatAoai, streamChatAoaiWithTools };
