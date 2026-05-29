'use strict';
/**
 * pdfVisionRebuild.js — PDF Vision 智能重組(Phase 2)
 *
 * Pipeline:
 *   1. spawn python pdf_to_docx_worker render-pages → 每頁 PNG + 結構化文字 dict
 *   2. 每頁丟 Gemini Vision(JSON mode)→ 拿 blocks[]
 *   3. spawn python pdf_to_docx_worker build-docx → 用 python-docx 組原生 DOCX
 *
 * 為什麼這條路比 pdf2docx 好:
 *   - 整份複雜表格 PDF(每頁都 table-heavy),pdf2docx layout 跑掉
 *   - Gemini Pro / Flash 看圖判 table 結構準(rows/cols/merge/bg)
 *   - python-docx 組原生 docx table + cell shading + merge,Word 開起來乾淨
 *   - 缺點:慢(每頁 vision call ~3-5s)+ token cost
 *
 * 給 skill 用:走 internal HTTP endpoint(本檔不直接 callable from skill,因為 skill child
 * 無法 require server services/);skill child 走 fetch http://127.0.0.1:PORT/api/_internal/...
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const crypto = require('crypto');

const { getGenerativeModel, extractText, extractUsage } = require('./geminiClient');
const { runWorker } = require('../python_workers/pdfWorker');

const MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
const MODEL_PRO = process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview';
const TMP_ROOT = process.env.PDF_VISION_TMP_DIR || path.join(os.tmpdir(), 'pdf_vision_rebuild');

// 預設 Vision 提示詞 — 嚴格 JSON,被 merge 進的 cell 用 null
const VISION_PROMPT = `你是 PDF 文件結構分析助手。仔細看這張 PDF 頁面截圖,輸出**純 JSON**(不要 markdown 圍欄,不要任何解釋),描述頁面所有可見內容。

JSON schema:
{
  "blocks": [
    { "type":"heading", "level":1, "text":"標題", "color":"#1a73e8" },
    { "type":"paragraph", "text":"段落文字...", "bold":false, "italic":false, "color":"#000000" },
    {
      "type":"table",
      "rows": [
        [
          { "text":"欄1標題", "bg":"#4a90e2", "color":"#ffffff", "bold":true, "align":"center", "colspan":1, "rowspan":1 },
          { "text":"欄2標題", "bg":"#4a90e2", "color":"#ffffff", "bold":true }
        ],
        [
          { "text":"資料A1" },
          { "text":"資料B1" }
        ]
      ]
    },
    { "type":"page_break" }
  ]
}

**絕對規則**:
1. 文字內容**100% 一字不漏**保留原文(中文標點、數字、空白原樣),不改寫不翻譯不總結
2. **完整列出整頁從上到下「所有」blocks** — 同一頁若有 2、3、4 張表格,**全部**都要寫出來。
   若 output token 將近上限,寧可砍掉 paragraph 的詳細描述、簡化 cell 文字長度,**也絕對不能省略後續的 table 或讓 JSON 不完整**。
3. table 的 rows 必須是「方陣」— 每 row 的 cell 數一致;被 colspan/rowspan 吃掉的位置用 null 佔位
4. 顏色用 #RRGGBB 六位 hex 精確標出(看不清楚的範圍取色,不要省略 header row 的底色)
5. 標題列(header row)的底色、粗體、置中,務必標出
6. 沒看到的格式欄位省略;但 text 欄位永遠要
7. **直接輸出單一 JSON 物件**({ "blocks": [...] }),不要 \`\`\`json 圍欄,不要前導 / 後綴文字
8. JSON 結束前**自我檢查**:整頁從上到下肉眼可見的內容、所有 table、所有 paragraph 都列了嗎?沒列就補上`;

function _shortHash(s) { return crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 10); }

/**
 * 用 concurrency limit 跑一批 async tasks。
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} limit
 * @returns {Promise<any[]>}  按原順序的結果(每個 task 結果或 thrown error)
 */
async function _runWithLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= tasks.length) return;
      try { results[i] = await tasks[i](); }
      catch (e) { results[i] = { __error: e.message || String(e) }; }
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// maxOutputTokens 上限:Gemini 3 系列實測 Flash / Pro 都接受 ≥ 64K。
// 一張中文 table JSON 約 2K-4K token,4 張表 + paragraphs 約 15-25K。給 32K 給 Flash、
// 64K 給 Pro;若還是 MAX_TOKENS 截斷代表 PDF 一頁內容過於密集,要走「頁切片」策略(未來 phase)。
const MAX_OUTPUT_TOKENS_BY_MODEL = (modelName) => {
  if (/pro/i.test(modelName)) return 65536;
  return 32768;
};

/**
 * 對單張頁面 PNG 跑 Gemini Vision → 拿 blocks JSON。
 */
async function _visionOnePage({ pngPath, modelName, pageNo, totalPages }) {
  const imgBuf = await fsp.readFile(pngPath);
  const maxOut = MAX_OUTPUT_TOKENS_BY_MODEL(modelName);
  const model = getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxOut,
      // 結構化抽取要穩定,別讓 Gemini 隨機性把 hex / JSON 寫壞
      temperature: 0.1,
    },
  });

  const t0 = Date.now();
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: imgBuf.toString('base64'), mimeType: 'image/png' } },
        { text: VISION_PROMPT },
      ],
    }],
  });
  const text = extractText(result);
  const usage = extractUsage(result);
  const elapsed = Date.now() - t0;

  // 檢查 finishReason — MAX_TOKENS / SAFETY / RECITATION 都會讓 JSON 不完整或被截
  const target = result.response || result;
  const cand = target.candidates?.[0];
  const finishReason = cand?.finishReason;
  const truncated = finishReason === 'MAX_TOKENS';

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // Gemini 偶爾不聽話包 ```json,清掉再 parse
    const cleaned = String(text)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    try { parsed = JSON.parse(cleaned); }
    catch (e2) {
      // 若是 MAX_TOKENS 截斷導致 JSON 殘缺,明確 throw 而不是回部分結果騙人
      if (truncated) {
        throw new Error(`vision JSON 被 MAX_TOKENS 截斷(page ${pageNo},out=${usage.outputTokens}/${maxOut}),JSON 殘缺無法 parse。建議:(1) 改用 vision_model='pro' 拉高 maxOutputTokens (2) 將密集 PDF 切成多頁`);
      }
      throw new Error(`vision JSON parse failed (page ${pageNo}, finishReason=${finishReason}): ${e.message}; text preview: ${String(text).slice(0, 200)}`);
    }
  }

  if (truncated) {
    // JSON 能 parse 但 finishReason=MAX_TOKENS — 罕見但會發生(JSON 剛好 close 在 token 上限),
    // 仍可能漏後面的 table。明確 throw 讓 caller 標 page failed 而不是吞掉。
    throw new Error(`vision finishReason=MAX_TOKENS (page ${pageNo}, out=${usage.outputTokens}/${maxOut}),JSON 可能不完整(已 parse 出 ${(parsed.blocks || []).length} blocks)。建議改 vision_model='pro' 或切頁`);
  }

  console.log(`[pdfVision] page ${pageNo}/${totalPages} done in ${elapsed}ms (in=${usage.inputTokens}, out=${usage.outputTokens}/${maxOut}, finishReason=${finishReason}, blocks=${(parsed.blocks || []).length})`);
  return {
    page_no: pageNo,
    blocks: parsed.blocks || [],
    _tokens: { input: usage.inputTokens || 0, output: usage.outputTokens || 0 },
  };
}

/**
 * 主入口:對一份 PDF 跑 Vision 重組 pipeline。
 *
 * @param {object} opts
 * @param {string} opts.pdfPath       輸入 PDF 絕對路徑
 * @param {string} opts.outDocxPath   輸出 DOCX 絕對路徑(目錄需先存在)
 * @param {string} [opts.password]    PDF 解密密碼
 * @param {'flash'|'pro'} [opts.model='flash']
 * @param {number} [opts.dpi=200]     render PNG dpi
 * @param {number} [opts.concurrency=3]  Vision call 並發
 * @param {(progress:{stage,pageNo?,totalPages?,elapsedMs}) => void} [opts.onProgress]
 *
 * @returns {Promise<{ outDocxPath, totalPages, totalTokens:{input,output}, elapsedMs }>}
 */
async function rebuildPdfWithVision(opts) {
  const {
    pdfPath, outDocxPath, password,
    model: modelChoice = 'flash',
    // dpi 200 vision 判 cell 底色 / 細邊框會失真,300 才夠;代價是 PNG 約 2x 大、render 慢 ~2x
    dpi = 300,
    concurrency = 3,
    onProgress,
  } = opts || {};

  if (!pdfPath || !outDocxPath) throw new Error('rebuildPdfWithVision: pdfPath / outDocxPath required');
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);

  const modelName = modelChoice === 'pro' ? MODEL_PRO : MODEL_FLASH;
  const tStart = Date.now();
  const sessionTmpDir = path.join(TMP_ROOT, `${Date.now()}_${_shortHash(pdfPath)}`);
  await fsp.mkdir(sessionTmpDir, { recursive: true });

  let renderResult, visionResults, buildResult;
  try {
    // ── Stage 1:render PNG ────────────────────────────────────────────────────
    onProgress?.({ stage: 'render', elapsedMs: 0 });
    const renderArgs = ['render-pages', '--in', pdfPath, '--out-dir', sessionTmpDir, '--dpi', String(dpi)];
    if (password) renderArgs.push('--password', password);
    renderResult = await runWorker(renderArgs, { timeoutMs: 5 * 60_000 });
    if (!renderResult.ok) {
      throw new Error(`render-pages failed: ${renderResult.error_code} ${renderResult.error || ''}`);
    }
    const pages = renderResult.pages || [];
    if (pages.length === 0) throw new Error('render-pages returned 0 pages');

    // ── Stage 2:Gemini Vision per-page(concurrency-limited)──────────────────
    onProgress?.({ stage: 'vision_start', totalPages: pages.length, elapsedMs: Date.now() - tStart });
    const tasks = pages.map((p) => async () => {
      const r = await _visionOnePage({
        pngPath: p.png_path,
        modelName,
        pageNo: p.page_no,
        totalPages: pages.length,
      });
      onProgress?.({ stage: 'vision_page_done', pageNo: p.page_no, totalPages: pages.length, elapsedMs: Date.now() - tStart });
      return r;
    });
    visionResults = await _runWithLimit(tasks, concurrency);

    const failed = visionResults
      .map((r, i) => (r && r.__error) ? { page: pages[i].page_no, err: r.__error } : null)
      .filter(Boolean);
    if (failed.length > 0) {
      // 部分頁面 vision 失敗 — 不直接 throw,讓 build 階段降級成 placeholder(避免整份白費)
      console.warn(`[pdfVision] ${failed.length} page(s) vision failed, will insert error placeholders:`, failed.slice(0, 5));
    }

    const pagesJson = visionResults.map((r, i) => {
      if (r && r.__error) {
        return {
          page_no: pages[i].page_no,
          blocks: [{ type: 'paragraph', text: `[第 ${pages[i].page_no} 頁 Vision 失敗:${r.__error}]`, italic: true, color: '#cc0000' }],
        };
      }
      return { page_no: r.page_no, blocks: r.blocks };
    });
    const totalTokens = visionResults.reduce(
      (acc, r) => ({
        input: acc.input + (r?._tokens?.input || 0),
        output: acc.output + (r?._tokens?.output || 0),
      }),
      { input: 0, output: 0 }
    );

    // ── Stage 3:build-docx ──────────────────────────────────────────────────
    onProgress?.({ stage: 'build', elapsedMs: Date.now() - tStart });
    const visionJsonPath = path.join(sessionTmpDir, 'vision.json');
    await fsp.writeFile(visionJsonPath, JSON.stringify({ pages: pagesJson }), 'utf-8');

    buildResult = await runWorker(
      ['build-docx', '--in-json', visionJsonPath, '--out', outDocxPath],
      { timeoutMs: 2 * 60_000 }
    );
    if (!buildResult.ok) {
      throw new Error(`build-docx failed: ${buildResult.error_code} ${buildResult.error || ''}`);
    }

    onProgress?.({ stage: 'done', totalPages: pages.length, elapsedMs: Date.now() - tStart });
    return {
      outDocxPath,
      totalPages: pages.length,
      totalTokens,
      visionFailedPages: failed.map(f => f.page),
      elapsedMs: Date.now() - tStart,
    };
  } finally {
    // Cleanup tmp PNG / JSON
    try { await fsp.rm(sessionTmpDir, { recursive: true, force: true }); }
    catch (e) { console.warn(`[pdfVision] tmp cleanup failed: ${e.message}`); }
  }
}

module.exports = {
  rebuildPdfWithVision,
  // 給 background job / test 直接戳的內部 helpers(慎用)
  _visionOnePage,
  _runWithLimit,
  VISION_PROMPT,
  MODEL_FLASH, MODEL_PRO,
};
