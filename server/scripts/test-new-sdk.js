'use strict';
/**
 * Phase 1 新 SDK 最小可用驗證 — 把 GEMINI_SDK=new 暫時設在 env 裡,
 * 跑過 geminiClient.js 的 public API,確認 6 個關鍵 case 都通。
 *
 * 用法:
 *   cd server
 *   GEMINI_SDK=new node scripts/test-new-sdk.js                        # 跑全部
 *   GEMINI_SDK=new node scripts/test-new-sdk.js 3                       # 只跑 case 3
 *   GEMINI_SDK=new GCP_LOCATION=global node scripts/test-new-sdk.js     # 強制 global
 *
 * 1. 純文字 chat               — getGenerativeModel + generateContent('prompt')
 * 2. streaming                 — generateContentStream 邊收 chunks 邊 aggregate
 * 3. startChat + sendMsgStream — gemini.js streamChat 用的路徑
 * 4. googleSearch tool         — confirm groundingMetadata 回來
 * 5. embedContent (768 dims)   — KB 向量化路徑
 * 6. inlineData vision         — 小 PNG 塞進 parts 讓 Vertex 看圖
 *
 * Exit code 非 0 = 有 case 失敗。
 */

require('dotenv').config();
// 強制新 SDK(script 專用)
process.env.GEMINI_SDK = 'new';

const fs = require('fs');
const path = require('path');
const {
  SDK_MODE, GENERATE_PROVIDER, EMBED_PROVIDER,
  getGenerativeModel, embedContent, extractText, extractUsage, logStartupInfo,
} = require('../services/geminiClient');

const MODEL_PRO = process.env.GEMINI_MODEL_PRO || 'gemini-3.1-pro-preview';
const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash';

// 1x1 red PNG base64(不依賴外部檔案)
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED   = (s) => `\x1b[31m${s}\x1b[0m`;
const YEL   = (s) => `\x1b[33m${s}\x1b[0m`;
const GRY   = (s) => `\x1b[90m${s}\x1b[0m`;

const CASES = [];
function addCase(name, fn) { CASES.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + msg); }

// ────────────────────────────────────────────────────────────────
// Case 1 — 純文字 chat(generateContent string 輸入)
// ────────────────────────────────────────────────────────────────
addCase('1. 純文字 chat (generateContent)', async () => {
  const model = getGenerativeModel({ model: MODEL_FLASH });
  const result = await model.generateContent('用繁體中文回「OK pass」三個字,不要其他字');
  const text = extractText(result);
  const usage = extractUsage(result);
  console.log(GRY(`   text="${text.slice(0, 40)}"  tokens=${usage.inputTokens}/${usage.outputTokens}`));
  assert(text.length > 0, 'text 不應為空');
  assert(usage.outputTokens > 0, 'outputTokens 應 > 0');
});

// ────────────────────────────────────────────────────────────────
// Case 2 — streaming(generateContentStream)
// ────────────────────────────────────────────────────────────────
addCase('2. streaming (generateContentStream)', async () => {
  const model = getGenerativeModel({
    model: MODEL_FLASH,
    generationConfig: { maxOutputTokens: 200 },
  });
  const res = await model.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: '依序念出 A B C D E,每字一行' }] }],
  });
  let full = '';
  let chunkCount = 0;
  for await (const chunk of res.stream) {
    const t = extractText(chunk);
    if (t) { full += t; chunkCount++; }
  }
  const response = await res.response;
  const usage = extractUsage(response);
  console.log(GRY(`   chunks=${chunkCount}  fullLen=${full.length}  tokens=${usage.inputTokens}/${usage.outputTokens}`));
  assert(chunkCount >= 1, 'chunks 至少 1');
  assert(full.length > 0, 'fullText 不應為空');
  assert(response.candidates?.[0]?.content?.parts, 'response.candidates[0].content.parts 應存在');
});

// ────────────────────────────────────────────────────────────────
// Case 3 — startChat + sendMessageStream(gemini.js streamChat 路徑)
// ────────────────────────────────────────────────────────────────
addCase('3. startChat + sendMessageStream', async () => {
  const model = getGenerativeModel({
    model: MODEL_FLASH,
    systemInstruction: '你叫阿發,每次都要自稱阿發。',
    // Gemini 3 系列 thinking mode default on,budget 會吃 output quota;給足夠空間
    generationConfig: { maxOutputTokens: 2000 },
  });
  const chat = model.startChat({
    history: [
      { role: 'user', parts: [{ text: '嗨' }] },
      { role: 'model', parts: [{ text: '嗨,我是阿發!' }] },
    ],
  });
  const result = await chat.sendMessageStream([{ text: '你叫什麼名字?只回名字,不要其他字' }]);
  let full = '';
  for await (const chunk of result.stream) {
    full += extractText(chunk);
  }
  const response = await result.response;
  const usage = extractUsage(response);
  console.log(GRY(`   reply="${full.slice(0, 30)}"  tokens=${usage.inputTokens}/${usage.outputTokens}`));
  assert(full.toLowerCase().includes('阿發') || full.includes('阿'), '回覆應提到阿發');
});

// ────────────────────────────────────────────────────────────────
// Case 4 — googleSearch grounding
// ────────────────────────────────────────────────────────────────
addCase('4. googleSearch grounding', async () => {
  const model = getGenerativeModel({
    model: MODEL_FLASH,
    tools: [{ googleSearch: {} }],
    generationConfig: { maxOutputTokens: 400 },
  });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: '台北目前天氣?' }] }],
  });
  const text = extractText(result);
  const response = result.response || result;
  const gm = response.candidates?.[0]?.groundingMetadata;
  console.log(GRY(`   queries=${(gm?.webSearchQueries || []).length}  sources=${(gm?.groundingChunks || []).length}  textLen=${text.length}`));
  assert(text.length > 0, 'text 不應為空');
  assert(gm, 'groundingMetadata 應存在');
  assert((gm.webSearchQueries || []).length > 0, '應有 webSearchQueries');
});

// ────────────────────────────────────────────────────────────────
// Case 5 — embedContent(768 dims)
// ────────────────────────────────────────────────────────────────
addCase('5. embedContent 768 dims', async () => {
  const vec = await embedContent('hello world 這是一段測試文字', { dims: 768 });
  console.log(GRY(`   dim=${vec.length}  first3=[${vec.slice(0, 3).map(x => x.toFixed(4)).join(', ')}]`));
  assert(Array.isArray(vec), '回傳應是 array');
  assert(vec.length === 768, `dim 應是 768,實際 ${vec.length}`);
  assert(typeof vec[0] === 'number', 'element 應是 number');
});

// ────────────────────────────────────────────────────────────────
// Case 6 — inlineData vision(小 PNG)
// ────────────────────────────────────────────────────────────────
addCase('6. inlineData vision', async () => {
  const model = getGenerativeModel({
    model: MODEL_FLASH,
    generationConfig: { maxOutputTokens: 300 },
  });
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: TINY_PNG_B64, mimeType: 'image/png' } },
        { text: '這張圖主要是什麼顏色?用一句話回答。' },
      ],
    }],
  });
  const text = extractText(result);
  console.log(GRY(`   reply="${text.slice(0, 60)}"`));
  assert(text.length > 0, 'text 不應為空');
});

// ────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n=== @google/genai (new SDK) smoke test ===`);
  console.log(`SDK_MODE=${SDK_MODE}  generate=${GENERATE_PROVIDER}  embed=${EMBED_PROVIDER}`);
  console.log(`GCP_LOCATION=${process.env.GCP_LOCATION || 'us-central1'}  MODEL_PRO=${MODEL_PRO}  MODEL_FLASH=${MODEL_FLASH}\n`);
  logStartupInfo();
  console.log('');

  const onlyIdx = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  let pass = 0, fail = 0;
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    if (onlyIdx && (i + 1) !== onlyIdx) continue;
    process.stdout.write(`${c.name} ... `);
    try {
      const t0 = Date.now();
      await c.fn();
      const ms = Date.now() - t0;
      console.log(GREEN(`PASS (${ms}ms)`));
      pass++;
    } catch (e) {
      console.log(RED(`FAIL`));
      console.log(RED(`   ${e.message}`));
      if (process.env.DEBUG) console.log(GRY(e.stack));
      fail++;
    }
  }
  console.log(`\n=== Result: ${GREEN(pass + ' pass')} / ${fail > 0 ? RED(fail + ' fail') : YEL('0 fail')} ===\n`);
  process.exit(fail > 0 ? 1 : 0);
})();
