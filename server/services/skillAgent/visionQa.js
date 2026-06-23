// -*- coding: utf-8 -*-
/**
 * visionQa.js — 收尾用「視覺審美」QA。
 *
 * 為何存在:程式化 slide_qa 只能擋「硬約束」(溢出/重疊/出界/金色超用),
 * 抓不到「色調過深/留白不足/貼邊/上下不平衡」這類美學問題(Phase 0 實測結論)。
 * 故在幾何 QA 通過後,渲染成圖 → 丟給 Gemini 看圖,以資深審稿人視角回 JSON 評估。
 * 不過則把 issues(+渲染圖)回灌給 agent 修。vision 只在「幾何已乾淨」時跑,且設輪數上限,控成本。
 */
const fs = require('fs');
const path = require('path');
const gemini = require('../gemini');
const { runInWorkspace, resolvePython, resolveSoffice } = require('./sandbox');

const VISION_DPI = 130; // 夠審美判斷又不撐爆 inline(<4MB);220 是給人看的高解析

/**
 * 渲染 pptx → png[](soffice → pdf → PyMuPDF)。可信步驟 → fullEnv。
 * @returns {Promise<string[]>} png 絕對路徑陣列(失敗回 [])
 */
async function renderDeck(pptxPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const soffice = resolveSoffice();
  const profileUri = 'file:///' + path.join(outDir, '.lo_profile').replace(/\\/g, '/');
  await runInWorkspace(
    `"${soffice}" --headless "-env:UserInstallation=${profileUri}" --convert-to pdf --outdir "${outDir}" "${pptxPath}"`,
    outDir, { timeout: 90_000, fullEnv: true }
  );
  const pdf = path.join(outDir, path.basename(pptxPath).replace(/\.pptx$/i, '.pdf'));
  if (!fs.existsSync(pdf)) return [];
  const renderPy = path.join(__dirname, 'render_preview.py');
  const out = await runInWorkspace(
    `"${resolvePython()}" "${renderPy}" "${pdf}" "${outDir}" ${VISION_DPI}`,
    outDir, { timeout: 60_000, fullEnv: true }
  );
  return out.split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.png') && fs.existsSync(s));
}

const CRITIQUE_PROMPT = `你是企業級簡報的資深視覺設計審稿人。上面的圖片是一份「企業級專業報告 · 藍色基調」投影片的實際渲染。
請以專業審美「嚴格」檢視,只挑真的會讓高階主管覺得不夠專業的排版問題,重點看:
- **色調平衡(兩個極端都扣分)**:整片深 navy 壓迫、缺層次要扣分;但整片洗白成純白、缺乏藍色基調與對比、顯得平淡廉價也要扣分。理想是「中藍面板 + 白色內卡」的層次,深 navy 只留給最上方 header 標題列。
- **間距(過鬆也扣分)**:元素貼邊/文字貼底緣要扣;但元件之間留出大片空隙、間距過大鬆散同樣不專業,也要扣。理想是間距緊湊一致、內容紮實鋪滿各分區,呼吸感靠卡片內 padding 而非拉大元件間隔。
- 對齊與一致性:左右欄不對齊、間距不一致、區塊比例失衡。
- 可讀性:文字過小、標題與內文層級不清、藍底上文字對比不足。
- 金色重點:是否恰當地只強調「一個」最關鍵數字。
版面若已專業俐落就回 pass=true(門檻別過高,90 分以上的成品就該 pass),別雞蛋裡挑骨頭。issues 要「具體可執行」:指明哪一區、哪個元素、該怎麼改(例:「右面板太空,四個項目間距過大,收緊到緊湊一致並加大卡內 padding」)。
只輸出 JSON,不要 markdown fence:
{"pass": true/false, "score": 0-100, "issues": ["...", "..."]}`;

/**
 * 對渲染圖做視覺審美評估。
 * @returns {Promise<{pass:boolean, score:number|null, issues:string[], inputTokens:number, outputTokens:number, imageParts:object[]}>}
 */
async function visionCritique(apiModel, pngPaths) {
  if (!pngPaths.length) {
    return { pass: true, score: null, issues: [], skipped: 'no_images', inputTokens: 0, outputTokens: 0, imageParts: [] };
  }
  const imageParts = pngPaths.map((p) => ({
    inlineData: { mimeType: 'image/png', data: fs.readFileSync(p).toString('base64') },
  }));
  // image 放 history 的 user turn、prompt 當最後一句 nudge(generateTextSync 會把 prompt 包成最後 user turn)
  const history = [{ role: 'user', parts: [...imageParts, { text: CRITIQUE_PROMPT }] }];
  const { text, inputTokens, outputTokens } = await gemini.generateTextSync(
    apiModel, history, '請依上述圖片與標準,輸出 JSON 評估。', {}
  );

  let parsed;
  try {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    parsed = JSON.parse(text.slice(a, b + 1));
  } catch (_) {
    // 解析失敗 → 保守當 pass(不擋流程),但帶原文供 debug
    parsed = { pass: true, score: null, issues: [], _parseError: (text || '').slice(0, 200) };
  }
  return {
    pass: parsed.pass !== false,
    score: parsed.score ?? null,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    _parseError: parsed._parseError,
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    imageParts,
  };
}

module.exports = { renderDeck, visionCritique, VISION_DPI };
