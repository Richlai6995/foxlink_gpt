'use strict';
/**
 * Phase 2 — 直接跑 gemini.js 的 5 個實戰 function 驗證新 SDK 無 regression。
 *
 * 用法:
 *   cd server
 *   GCP_LOCATION=global node scripts/test-new-sdk-gemini.js       # 跑全部
 *   GCP_LOCATION=global node scripts/test-new-sdk-gemini.js 3     # 只跑 case 3
 *
 * 1. streamChat 純文字 (無 search)                  — Vertex 路徑
 * 2. streamChat 帶 inlineData (PNG)                 — 動態降級 Studio
 * 3. generateTextSync                                — 非串流
 * 4. generateTitle                                   — 三語言 JSON 解析
 * 5. generateWithTools (非串流 tool loop)            — function calling
 * 6. generateWithToolsStream (串流 tool loop)        — streaming + tool calling
 */

require('dotenv').config();
process.env.GEMINI_SDK = 'new';
process.env.GCP_LOCATION = process.env.GCP_LOCATION || 'global';

const {
  streamChat, generateTextSync, generateTitle,
  generateWithTools, generateWithToolsStream, MODEL_FLASH,
} = require('../services/gemini');
const { SDK_MODE, GENERATE_PROVIDER, EMBED_PROVIDER, logStartupInfo } = require('../services/geminiClient');

// 1x1 red PNG base64
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED   = (s) => `\x1b[31m${s}\x1b[0m`;
const YEL   = (s) => `\x1b[33m${s}\x1b[0m`;
const GRY   = (s) => `\x1b[90m${s}\x1b[0m`;

const CASES = [];
function addCase(name, fn) { CASES.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + msg); }

function capture() {
  let out = '';
  return { fn: (s) => { out += s; }, get out() { return out; } };
}

// ────────────────────────────────────────────────────────────────
// 1. streamChat 純文字(disableSearch=true 避開 googleSearch grounding)
// ────────────────────────────────────────────────────────────────
addCase('1. streamChat 純文字', async () => {
  const cap = capture();
  const res = await streamChat(
    MODEL_FLASH,
    [],
    [{ text: '用繁體中文回「streamChat OK」六個字即可,不要其他文字' }],
    cap.fn,
    '', true,
    { max_output_tokens: 3000 },
  );
  console.log(GRY(`   streamedLen=${cap.out.length}  returnedLen=${res.text.length}  tokens=${res.inputTokens}/${res.outputTokens}`));
  assert(res.text.length > 0, 'res.text 不應為空');
  assert(cap.out.length > 0, 'onChunk 應被呼叫');
  assert(res.outputTokens > 0, 'outputTokens > 0');
});

// ────────────────────────────────────────────────────────────────
// 2. streamChat 帶 inlineData(會動態降級 Studio)
// ────────────────────────────────────────────────────────────────
addCase('2. streamChat 帶 inlineData (auto-downgrade to Studio)', async () => {
  const cap = capture();
  const res = await streamChat(
    MODEL_FLASH,
    [],
    [
      { inlineData: { data: TINY_PNG_B64, mimeType: 'image/png' } },
      { text: '這張圖主要是什麼顏色?一句話回答' },
    ],
    cap.fn,
    '', true,
    { max_output_tokens: 3000 },
  );
  console.log(GRY(`   reply="${res.text.slice(0, 80)}"  tokens=${res.inputTokens}/${res.outputTokens}`));
  assert(res.text.length > 0, 'res.text 不應為空');
  assert(cap.out.length > 0, 'onChunk 應被呼叫');
});

// ────────────────────────────────────────────────────────────────
// 3. generateTextSync (非串流)
// ────────────────────────────────────────────────────────────────
addCase('3. generateTextSync', async () => {
  const res = await generateTextSync(MODEL_FLASH, [], '用繁體中文回「OK」兩個字即可');
  console.log(GRY(`   text="${res.text.slice(0, 40)}"  tokens=${res.inputTokens}/${res.outputTokens}`));
  assert(res.text.length > 0, 'res.text 不應為空');
  assert(res.outputTokens > 0, 'outputTokens > 0');
});

// ────────────────────────────────────────────────────────────────
// 4. generateTitle(三語言 JSON 解析)
// ────────────────────────────────────────────────────────────────
addCase('4. generateTitle', async () => {
  const res = await generateTitle('請幫我寫一份Q1業績報告', '好的,我先依營收、費用、淨利三段彙整');
  console.log(GRY(`   zh="${res.title_zh}" en="${res.title_en}" vi="${res.title_vi}"`));
  assert(res.title && res.title.length > 0, 'title 不應為空');
  assert(res.title_zh && res.title_zh !== '請幫我寫一份Q1業績報告', 'title_zh 應為 LLM 生成,非 fallback');
  assert(res.title_en && /[a-zA-Z]/.test(res.title_en), 'title_en 應含英文');
});

// ────────────────────────────────────────────────────────────────
// 5. generateWithTools (非串流 tool loop)
// ────────────────────────────────────────────────────────────────
addCase('5. generateWithTools (non-streaming)', async () => {
  const functionDeclarations = [{
    name: 'add',
    description: '兩數相加',
    parameters: {
      type: 'OBJECT',
      properties: {
        a: { type: 'NUMBER', description: '第一個數' },
        b: { type: 'NUMBER', description: '第二個數' },
      },
      required: ['a', 'b'],
    },
  }];
  const toolHandler = async (name, args) => {
    if (name === 'add') return String(Number(args.a) + Number(args.b));
    return '[unknown tool]';
  };
  const res = await generateWithTools(
    MODEL_FLASH,
    [],
    [{ text: '請用 add 工具計算 17 加 25,算完直接告訴我答案' }],
    functionDeclarations,
    toolHandler,
    '',
    {},
  );
  console.log(GRY(`   text="${res.text.slice(0, 60)}"  toolCalls=${res.toolCallCount}  tokens=${res.inputTokens}/${res.outputTokens}`));
  assert(res.toolCallCount >= 1, '應至少呼叫 1 次 tool');
  assert(res.text.includes('42'), 'text 應包含正確答案 42');
});

// ────────────────────────────────────────────────────────────────
// 6. generateWithToolsStream (streaming tool loop)
// ────────────────────────────────────────────────────────────────
addCase('6. generateWithToolsStream (streaming)', async () => {
  const functionDeclarations = [{
    name: 'multiply',
    description: '兩數相乘',
    parameters: {
      type: 'OBJECT',
      properties: {
        a: { type: 'NUMBER' },
        b: { type: 'NUMBER' },
      },
      required: ['a', 'b'],
    },
  }];
  const toolHandler = async (name, args) => {
    if (name === 'multiply') return String(Number(args.a) * Number(args.b));
    return '[unknown tool]';
  };
  const cap = capture();
  const toolStatus = [];
  const res = await generateWithToolsStream(
    MODEL_FLASH,
    [],
    [{ text: '請用 multiply 工具算 7 乘 6,算完告訴我答案' }],
    functionDeclarations,
    toolHandler,
    cap.fn,
    (msg) => toolStatus.push(msg),
    '',
    {},
    { max_output_tokens: 3000 },
  );
  console.log(GRY(`   text="${res.text.slice(0, 60)}"  toolCalls=${res.toolCallCount}  streamedLen=${cap.out.length}  status=${toolStatus.length}`));
  assert(res.toolCallCount >= 1, '應至少呼叫 1 次 tool');
  assert(res.text.includes('42'), 'text 應包含正確答案 42');
  assert(cap.out.length > 0, 'onChunk 應被呼叫(final text 串流)');
  assert(toolStatus.length >= 1, 'onToolStatus 應被呼叫');
});

// ────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n=== gemini.js smoke test (SDK_MODE=${SDK_MODE}) ===`);
  console.log(`GCP_LOCATION=${process.env.GCP_LOCATION}  MODEL_FLASH=${MODEL_FLASH}`);
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
