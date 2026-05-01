'use strict';
/**
 * 測 Vertex Gemini 3.1 Pro Preview 對 urlContext tool 的支援度。
 *
 * 跑法:
 *   node server/scripts/test-pro-urlcontext.js [model]
 *
 * 預期結果:
 *   - groundingMetadata 含 urlContextMetadata.urlMetadata 陣列 → Pro 真的 fetch 了 ✓
 *   - groundingMetadata = undefined → Pro 也 silent ignore tool,跟 Flash 一樣
 *
 * 測完判斷:
 *   - 有 groundingMetadata → 把 PM 抓新聞 task model 切 'pro',改 scheduledTaskService 啟用 grounding
 *   - 沒 → 換 server-side white-list 路線(改 scrapeUrl 抽 link 給 LLM 當白名單)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getGenerativeModel, extractText, SDK_MODE } = require('../services/geminiClient');

(async () => {
  const model = process.argv[2] || 'gemini-3.1-pro-preview';
  console.log(`SDK_MODE=${SDK_MODE} model=${model}`);
  console.log(`GEMINI_GENERATE_PROVIDER=${process.env.GEMINI_GENERATE_PROVIDER || '(unset)'}`);
  console.log(`GCP_LOCATION=${process.env.GCP_LOCATION || '(unset)'}`);
  console.log('---');

  const m = getGenerativeModel({
    model,
    tools: [{ urlContext: {} }],
  });

  const prompt = `請用 urlContext 工具 fetch https://news.smm.cn/ 這個首頁,然後列出前 3 篇 article 的「真實完整 URL」(從工具回傳的 link 中複製,不要編 ID)。

格式:
1. <真實 URL>
2. <真實 URL>
3. <真實 URL>

如果工具沒回傳東西,請明確說「urlContext 沒給我內容」,不要憑記憶補。`;

  console.log('Prompt:', prompt);
  console.log('---');
  const t0 = Date.now();
  const result = await m.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const dt = Date.now() - t0;

  const cand = result.candidates?.[0] || result.response?.candidates?.[0];
  const finishReason = cand?.finishReason;
  const parts = cand?.content?.parts || [];
  const groundingMetadata = cand?.groundingMetadata;
  const usage = result.usageMetadata || result.response?.usageMetadata || {};

  console.log(`elapsed: ${dt}ms`);
  console.log(`finishReason: ${finishReason}`);
  console.log(`tokens: in=${usage.promptTokenCount} out=${usage.candidatesTokenCount} total=${usage.totalTokenCount}`);
  console.log(`parts: ${parts.length} (text=${parts.filter(p => p.text && !p.thought).length}, thought=${parts.filter(p => p.thought).length})`);
  console.log('---');
  console.log('groundingMetadata:');
  if (groundingMetadata) {
    console.log(JSON.stringify(groundingMetadata, null, 2).slice(0, 4000));
  } else {
    console.log('(none — Pro 也不支援 urlContext on Vertex)');
  }
  console.log('---');
  console.log('extracted text:');
  console.log(extractText(result));
})().catch((e) => {
  console.error('ERROR:', e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
});
