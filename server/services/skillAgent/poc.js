// -*- coding: utf-8 -*-
/**
 * poc.js — Skill Agent PoC 入口。
 *
 * 驗證的唯一命題:給 Gemini 一份 SKILL.md + blue_style 元件庫,它能不能靠
 * write_file/bash + 程式化 QA 迴圈,端到端產出一份 QA-clean 的 pptx。
 *
 * CLI:
 *   node server/services/skillAgent/poc.js "用董事長藍色風格做一份關於 X 的簡報"
 *   node server/services/skillAgent/poc.js --file task.txt
 *   環境:GEMINI_* 由 server/.env 載入(同 server 端設定)。
 *
 * 產物:server/services/skillAgent/_runs/<ts>/ 下 out.pptx + slide_*.png + run.log
 *   PNG 是給「人眼 truth-check」用 — 對照 QA 結論,判斷程式 QA 能否替代 vision。
 */
const fs = require('fs');
const path = require('path');

// 載入 server/.env(gemini client 在呼叫時讀 env)
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// .env 內的路徑是相對 server/ cwd 寫的(server 正常從 server/ 啟動)。
// PoC 可能從 repo root 跑 → 把憑證等相對路徑正規化成絕對,免得 Vertex auth ENOENT。
const SERVER_DIR = path.join(__dirname, '../..');
for (const k of ['GOOGLE_APPLICATION_CREDENTIALS', 'MCP_JWT_PRIVATE_KEY_PATH', 'MCP_JWT_PUBLIC_KEY_PATH']) {
  if (process.env[k] && !path.isAbsolute(process.env[k])) {
    process.env[k] = path.resolve(SERVER_DIR, process.env[k]);
  }
}

const { prepWorkspace, cleanupWorkspace, runInWorkspace, resolvePython, resolveSoffice } = require('./sandbox');
const { runAgentLoop, DEFAULT_MODEL } = require('./loop');

const SKILL_DIR = path.resolve(__dirname, '../../../docs/pptx skill');
const RUNS_DIR = path.join(__dirname, '_runs');

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 渲染 pptx → pdf(soffice)→ png(PyMuPDF),best-effort。 */
async function renderPreview(pptxPath, outDir, log) {
  const soffice = resolveSoffice();
  log(`\n── 渲染 truth-check 預覽 ──`);
  // 1) pptx → pdf。可信步驟 → fullEnv(否則 soffice 找不到 user profile 靜默失敗);
  //    -env:UserInstallation 給 soffice 獨立 profile,避免與已開的 LibreOffice 衝突。
  const profileUri = 'file:///' + path.join(outDir, '.lo_profile').replace(/\\/g, '/');
  const conv = await runInWorkspace(
    `"${soffice}" --headless "-env:UserInstallation=${profileUri}" --convert-to pdf --outdir "${outDir}" "${pptxPath}"`,
    outDir, { timeout: 90_000, fullEnv: true }
  );
  const pdf = path.join(outDir, path.basename(pptxPath).replace(/\.pptx$/i, '.pdf'));
  if (!fs.existsSync(pdf)) {
    log(`  ⚠ soffice 轉 PDF 失敗(可能 LibreOffice 未裝好):\n${conv}`);
    return [];
  }
  // 2) pdf → png(PyMuPDF)
  const renderPy = path.join(__dirname, 'render_preview.py');
  const out = await runInWorkspace(
    `"${resolvePython()}" "${renderPy}" "${pdf}" "${outDir}" 150`,
    outDir, { timeout: 60_000, fullEnv: true }
  );
  const pngs = out.split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.png') && fs.existsSync(s));
  log(`  🖼  產出 ${pngs.length} 張預覽圖`);
  return pngs;
}

/**
 * 跑一次 Skill Agent。
 * @param {string} task        使用者任務/內容
 * @param {object} [o]
 * @param {string} [o.packageDir]  skill 包目錄(含 SKILL.md / 元件庫);預設內建 pptx skill。
 *                                 S3 的 agentJobService 會傳「匯入 skill 的 NFS 路徑」。
 * @param {boolean}[o.keepWorkspace]
 * @param {(s:string)=>void}[o.onLog]  額外 log sink(背景 job 串進度用)
 */
async function runSkillAgentPoC(task, { packageDir = SKILL_DIR, keepWorkspace = false, onLog, images = [] } = {}) {
  const runDir = path.join(RUNS_DIR, ts());
  fs.mkdirSync(runDir, { recursive: true });
  const logLines = [];
  const log = (s) => { logLines.push(s); console.log(s); if (onLog) { try { onLog(s); } catch (_) {} } };

  log(`# Skill Agent PoC`);
  log(`model: ${DEFAULT_MODEL}`);
  log(`task:  ${task}`);
  log(`skill: ${packageDir}`);
  if (!fs.existsSync(path.join(packageDir, 'SKILL.md'))) {
    log(`  ⚠ 警告:${packageDir} 內找不到 SKILL.md`);
  }

  const ws = prepWorkspace(packageDir);
  log(`ws:    ${ws}`);

  let result;
  try {
    result = await runAgentLoop({ task, ws, images, log });

    // 收檔到 runDir
    if (result.pptxPath && fs.existsSync(result.pptxPath)) {
      const dst = path.join(runDir, 'out.pptx');
      fs.copyFileSync(result.pptxPath, dst);
      log(`\n📦 out.pptx → ${dst}`);
      // truth-check 預覽
      try {
        const wsPptx = result.pptxPath;
        await renderPreview(wsPptx, runDir, log);
      } catch (e) {
        log(`  ⚠ 預覽渲染例外:${e.message}`);
      }
    }
  } catch (e) {
    log(`\n💥 例外:${e.stack || e.message}`);
    result = { ok: false, error: e.message };
  } finally {
    if (!keepWorkspace) cleanupWorkspace(ws);
  }

  log(`\n=== 結果 ===`);
  log(`ok(幾何 QA + 視覺審稿皆過): ${result.ok}`);
  if (result.vision) {
    log(`視覺審稿: pass=${result.vision.pass} score=${result.vision.score ?? '?'} · 回灌修正 ${result.visionFixRounds} 輪`);
    if (!result.vision.pass && result.vision.issues?.length) {
      log(`視覺殘留 issues:`); result.vision.issues.forEach((i) => log(`  · ${i}`));
    }
  }
  log(`tokens: ${JSON.stringify(result.tokens || {})}`);
  log(`tool calls: ${(result.toolCalls || []).length}`);
  fs.writeFileSync(path.join(runDir, 'run.log'), logLines.join('\n'), 'utf8');
  console.log(`\n📁 全部產物:${runDir}`);
  return { ...result, runDir };
}

// ── CLI ──
if (require.main === module) {
  const argv = process.argv.slice(2);
  let task;
  const fi = argv.indexOf('--file');
  if (fi >= 0 && argv[fi + 1]) {
    task = fs.readFileSync(argv[fi + 1], 'utf8');
  } else {
    task = argv.filter((a) => !a.startsWith('--')).join(' ');
  }
  if (!task || !task.trim()) {
    console.error('用法: node poc.js "任務描述"  [--file task.txt] [--skill <packageDir>] [--keep]');
    process.exit(1);
  }
  const keep = argv.includes('--keep');
  const si = argv.indexOf('--skill');
  const packageDir = si >= 0 && argv[si + 1] ? path.resolve(argv[si + 1]) : undefined;
  runSkillAgentPoC(task, { keepWorkspace: keep, packageDir })
    .then((r) => process.exit(r.ok ? 0 : 2))
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { runSkillAgentPoC, runSkillAgent: runSkillAgentPoC };
