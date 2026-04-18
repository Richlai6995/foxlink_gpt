'use strict';
/* Gemini embedding API latency baseline — 10 serial calls, 768 dim */
const path = require('path');
const fs = require('fs');
// Manually parse server/.env to get GEMINI_API_KEY
const envContent = fs.readFileSync(path.join(__dirname, '../server/.env'), 'utf8');
envContent.split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});
// Load kbEmbedding from server node_modules path
const SERVER_DIR = path.resolve(__dirname, '../server');
process.chdir(SERVER_DIR);
const { embedText } = require(path.join(SERVER_DIR, 'services/kbEmbedding'));

(async () => {
  const text = '本系統為正崴 AI 整合平台，整合 LLM 對話、教育訓練與 AI 工具集。'.repeat(10);
  const times = [];
  console.log(`[Baseline] text length=${text.length} chars, dims=768`);
  for (let i = 0; i < 10; i++) {
    const t = Date.now();
    try {
      await embedText(text, { dims: 768 });
      const ms = Date.now() - t;
      times.push(ms);
      console.log(`call ${i + 1}: ${ms}ms`);
    } catch (e) {
      console.error(`call ${i + 1} ERROR:`, e.message);
      return;
    }
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times), max = Math.max(...times);
  console.log(`\n[Baseline] 768-dim: avg=${avg.toFixed(0)}ms min=${min}ms max=${max}ms`);

  // Also test 3072-dim
  console.log('\n--- 3072-dim ---');
  const times3072 = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    try {
      await embedText(text, { dims: 3072 });
      const ms = Date.now() - t;
      times3072.push(ms);
      console.log(`call ${i + 1}: ${ms}ms`);
    } catch (e) {
      console.error(`call ${i + 1} ERROR:`, e.message);
      return;
    }
  }
  const avg3072 = times3072.reduce((a, b) => a + b, 0) / times3072.length;
  console.log(`[Baseline] 3072-dim: avg=${avg3072.toFixed(0)}ms`);
})();
