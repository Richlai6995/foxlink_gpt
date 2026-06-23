// -*- coding: utf-8 -*-
/**
 * loop.js — Skill Agent 的大腦:組 system prompt + 驅動 agentic loop。
 *
 * 兩層迴圈(對齊 Phase 0 設計):
 *   內層(模型自驅):generateWithToolsStream 內建 ≤10 輪 tool loop — 模型自己
 *                    write_file → bash 跑 → qa_check → 看 issues → 改 → 再跑。
 *   外層(保險閘):本檔。一次 generateWithToolsStream 回來後再「獨立」QA 一次,
 *                  若仍有 issue 且預算未爆 → 把 issues 當新 user turn 回灌續跑。
 *
 * 為何要外層:內層 10 輪可能在最後一輪純 tool call 結束(text 空)、或模型自以為
 * 收工但 QA 沒過。外層用「客觀 QA 結果」當收斂條件,不信模型的自我宣稱。
 */
const fs = require('fs');
const path = require('path');
const gemini = require('../gemini');
const { functionDeclarations, makeToolHandler } = require('./tools');
const { runInWorkspace, resolvePython } = require('./sandbox');
const { renderDeck, visionCritique } = require('./visionQa');

// ── 預算閘(防 agentic 失控燒 token) ──────────────────────────────
const MAX_OUTER_ROUNDS = 6;
const TOKEN_BUDGET = 500_000; // in+out 合計(含 vision 的 image token)
const WALL_MS = 10 * 60_000;

// ── 收尾視覺審稿 ────────────────────────────────────────────────
const VISION_ENABLED = process.env.SKILLAGENT_VISION !== '0'; // 預設開,設 0 可關
const MAX_VISION_FIX_ROUNDS = Number(process.env.SKILLAGENT_VISION_ROUNDS || 3); // 視覺最多「回灌修正」幾次
const VISION_PASS_SCORE = Number(process.env.SKILLAGENT_VISION_PASS || 90); // score ≥ 此值即視為過(別追 100 空燒)

const DEFAULT_MODEL = process.env.GEMINI_MODEL_PRO || 'gemini-3.1-pro-preview';

/**
 * 組 system prompt:餵 blue_style API 簽名 + 設計鐵則 + 嚴格工作流。
 * 不塞 blue_style.py 原始碼(省 token + 避免模型亂改庫)。
 * Phase 1 匯入器要做的,就是從 SKILL.md + 掃 .py 的 def 自動生這段。
 */
function buildSystemPrompt() {
  return `你是簡報製作 agent。工作目錄已備妥 blue_style.py(企業級專業報告 · 藍色基調元件庫,只能 import,**不准修改**)、slide_qa.py(視覺 QA)。
任務:把使用者提供的內容,做成「企業級專業報告 · 藍色基調」4:3 簡報——乾淨、俐落、適合對高階主管呈報。

## 設計鐵則(違反會被 QA 打回)
- **單一金色(必做)**:整份**務必挑「正好一個」最關鍵的數字/節點設 accent=true(金色 C99A3B)**,其餘全藍。不是「最多一個」,是「一定要有一個、且只有一個」做視覺焦點。
- **不要編造數字(必做)**:**沒有來源數據就不要生出任何百分比/具體數字**(例如憑空的「<5%」「80%」「35%」)。質化內容(風險、影響、策略這類)請用 \`items\` 條列呈現,**不要為了填 metric_tile/metrics 版型硬湊假數字**。metrics/數字塊只用在「真的有來源數字」時;沒有就改用 items 或 cards。
- 藍色主導 60-70%,色塊都加漸層+陰影(用庫函式預設,別自己畫)。
- 文字不可溢出色塊、不可重疊、不可出界(留白 ≥0.2")。
- 商業語言(更快/更省/看得見),SQL/API/SCD 這類術語收進小字或省略。
- 4:3 版面 10×7.5in,留白充足,別塞滿。

## 視覺審美(收尾會有「看圖」審稿,不過會被打回)
- **避免兩個極端**:不要整片深 navy(壓迫沉重),也不要把面板洗成純白(平淡無層次、廉價)。理想是「中藍面板 + 白色內卡」,有清楚的藍色基調與對比;深 navy 只留給最上方 header。
- **呼吸感靠內距、不是靠拉大間隔**:元件間距要緊湊且一致(0.1~0.15"),內容紮實鋪滿各分區;呼吸感用「卡片內 padding」達成,別為了留白把元件間隔拉得很大、留出大片空隙(過鬆同樣不專業)。
- 卡片/面板內文字離邊 ≥0.16"、底部別貼底緣;左右欄對齊、間距一致、區塊比例協調。

## 主要做法:compose_slide(**優先用這個**,座標自動算、保證填滿+平衡)
blue_style 提供「版面組合器」compose_slide —— 你只把內容整理成 blocks 結構,它自動垂直切分整頁、每塊撐滿、欄/項目均分座標。**這是版面不稀疏、不失衡的關鍵:不要自己手擺 x/y/w/h。**

from blue_style import *
prs = new_deck(); s = add_slide(prs)
compose_slide(s, eyebrow, title, subtitle, blocks=[...], footer_left="出處", badge=None)

blocks 每項是一個 dict,三種型別:
- {"type":"columns", "cols":[ 欄1, 欄2(,欄3) ]}   # 左右並排白底面板(藍標題條),2~3 欄
    每欄 = {"title":"面板標題", + 下面三選一}:
       "items":   [{"title":"標題","desc":"小字","accent":false}, ...]               # 編號圓條列
       "metrics": [{"value":"↓70%","label":"標題","desc":"小字","accent":false}, ...]  # 數字塊 callout
       "flow":    [{"title":"步驟","desc":"小字"}, ...]                               # chevron
- {"type":"band", "title":"全寬面板標題", "flow":[{"title":"步驟","desc":"…"}, ...], "caption":"一行說明"}
- {"type":"cards", "cards":[{"title":"…","desc":"…"}, ...], "cols":2}                # 自動 grid 功能卡
每個 block 可選 "weight"(佔高比例,預設 columns=3 / band=1.35 / cards=1.5)。accent=true 給金色(整份只准一個)。

**範例 examples/golden_deck.py 是密集三欄總覽的黃金樣板,先讀它、照結構改內容最快。**

## 內容 → blocks 對應
- 一組「目標/價值」(多點)→ columns 一欄 items;一組「成效數字」→ 同 block 另一欄 metrics(兩者並排成 2 欄)
- N 階段流程 → band + flow;佐證/補充(2~4 條)→ cards
- **來源有幾個區塊就保幾個 block,別壓成稀疏單塊**;內容多就多分 block 把整頁填滿,別只放幾個元件浮在上半頁。

## 低階元件(只有 compose_slide 兜不住的特殊版面才直接用)
header / concept_band / feature_card(s,x,y,w,h,num,title,desc,accent) / metric_tile / chevron_row / db_cylinder / right_arrow / box / circle / footer。色名常數:NAVY BLUE BLUE2 BLUE_L SKY INK MUTE GOLD GOLD2 WHITE。

## 工作流(嚴格遵守,用工具完成,別只用講的)
1. write_file 寫 deck.py:開頭 \`from blue_style import *\`,**優先用 compose_slide 一次組好整頁**,結尾\`prs.save("out.pptx")\`。
2. bash 跑 \`python deck.py\`。若報錯,讀 traceback 修 deck.py 再跑。
3. qa_check("out.pptx") 看 issues。
4. 有 issue → 改 deck.py 修(通常是精簡文字 / 調 block weight / 金色只留一個)→ 回到步驟 2。
5. QA 回 0 issue 就停,輸出一句「DONE」。最多修 5 輪,別追求像素級完美。`;
}

/** 外層獨立 QA:跑 slide_qa.py,判斷是否乾淨。 */
async function outerQa(ws, pptxName = 'out.pptx') {
  const pptxPath = path.resolve(ws, pptxName);
  if (!fs.existsSync(pptxPath)) {
    return { producedFile: false, clean: false, raw: `(尚未產出 ${pptxName})` };
  }
  const raw = await runInWorkspace(`"${resolvePython()}" slide_qa.py "${pptxName}"`, ws);
  const clean = /0 issue\(s\)/.test(raw) || /\(clean\)/.test(raw);
  return { producedFile: true, clean, raw: raw.trim() };
}

/**
 * 跑一次 Skill Agent。
 * @param {object} o
 * @param {string} o.task    使用者任務(自然語言)
 * @param {string} o.ws      已備妥的工作區(含 blue_style.py / slide_qa.py)
 * @param {string} [o.apiModel]
 * @param {string} [o.pptxName='out.pptx']
 * @param {(s:string)=>void} [o.log]  進度輸出
 * @returns {Promise<{ok, pptxPath, qa, rounds, tokens, toolCalls}>}
 */
async function runAgentLoop({ task, ws, images = [], apiModel = DEFAULT_MODEL, pptxName = 'out.pptx', log = () => {} }) {
  const systemPrompt = buildSystemPrompt();
  const genConfig = { reasoning_effort: process.env.SKILLAGENT_EFFORT || 'medium', max_output_tokens: 16384 };

  const toolCalls = [];
  const toolHandler = makeToolHandler(ws, (name, args) => {
    const brief = name === 'write_file' ? `${args.path}` : name === 'bash' ? args.cmd : args.pptx;
    toolCalls.push({ name, brief });
    log(`  🔧 ${name}(${brief})`);
  });

  // onChunk 必填(非 null-guard);把模型可見文字收進 log。
  let streamBuf = '';
  const onChunk = (t) => { streamBuf += t; };
  const onToolStatus = (m) => log(`  · ${m}`);

  let history = [];
  // 若有附件來源圖(使用者要「重製」的投影片)→ 首輪把圖當 vision 參考餵進去,看圖復刻內容與結構。
  let userParts;
  const imgParts = [];
  for (const im of (images || []).slice(0, 4)) {
    try {
      const b64 = fs.readFileSync(im.path).toString('base64');
      imgParts.push({ inlineData: { mimeType: im.mimeType || 'image/png', data: b64 } });
    } catch (e) { log(`  ⚠ 讀附件圖失敗(${im.path}): ${e.message}`); }
  }
  if (imgParts.length) {
    userParts = [
      { text: `附件是使用者要「重製」的來源投影片(圖片)。請仔細看圖,把它的**內容(標題/文字/數字/分區結構)與版面密度**用「企業級專業報告 · 藍色基調」重畫成一張新投影片:\n- 用 compose_slide 組版;來源是幾欄/幾區就保幾個 block,別壓成稀疏單塊。\n- 文字與數字**忠實取自圖中**,不要自行編造內容。\n- 補充文字指示(若有):${task}` },
      ...imgParts,
    ];
    log(`  🖼  附件來源圖 ${imgParts.length} 張 → 看圖重製`);
  } else {
    userParts = [{ text: `請依「企業級專業報告 · 藍色基調」,把以下內容做成簡報:\n\n${task}` }];
  }
  let totalIn = 0, totalOut = 0;
  const started = Date.now();
  let qa = { producedFile: false, clean: false, raw: '(未執行)' };
  let vision = null;          // 最後一次 vision 評估
  let visionFixRounds = 0;    // 已被視覺「回灌修正」幾次

  for (let round = 0; round < MAX_OUTER_ROUNDS; round++) {
    log(`\n── 外層第 ${round + 1}/${MAX_OUTER_ROUNDS} 輪 ──`);
    streamBuf = '';

    const res = await gemini.generateWithToolsStream(
      apiModel, history, userParts, functionDeclarations, toolHandler,
      onChunk, onToolStatus, systemPrompt, {}, genConfig
    );
    totalIn += res.inputTokens || 0;
    totalOut += res.outputTokens || 0;
    log(`  ↳ 模型文字: ${(res.text || streamBuf || '').slice(0, 120).replace(/\n/g, ' ')}`);
    log(`  ↳ tokens: in=${res.inputTokens} out=${res.outputTokens} · 累計 ${totalIn + totalOut}/${TOKEN_BUDGET}`);

    // 外層獨立 QA — 不信模型自稱 DONE,看客觀結果
    qa = await outerQa(ws, pptxName);

    let feedbackParts = null; // 本輪要回灌的 user parts(null = 不續跑)

    if (!qa.clean) {
      log(`  ⚠ 幾何 QA 未過:\n${qa.raw.split('\n').map((l) => '     ' + l).join('\n')}`);
      feedbackParts = [{
        text: qa.producedFile
          ? `幾何 QA 仍未過,請針對性修正 deck.py 後重新 python deck.py + qa_check:\n${qa.raw}`
          : `你還沒成功產出 ${pptxName}。請 write_file 寫 deck.py(from blue_style import *,prs.save("${pptxName}"))再 bash 跑。`,
      }];
    } else {
      log(`  ✅ 幾何 QA clean`);
      if (!VISION_ENABLED) break; // 不開 vision → 收工
      // 一律 critique 當前 deck(確保「最終版」一定有被評分 — 修掉「最後一修沒驗證」缺陷)
      log(`  👁  視覺審稿中(render → Gemini 看圖)…`);
      const pngs = await renderDeck(path.resolve(ws, pptxName), path.join(ws, '.vision'));
      vision = await visionCritique(apiModel, pngs);
      totalIn += vision.inputTokens || 0;
      totalOut += vision.outputTokens || 0;
      log(`  👁  視覺評估: pass=${vision.pass} score=${vision.score ?? '?'} · ${vision.issues.length} issue · 累計 ${totalIn + totalOut}/${TOKEN_BUDGET}`);
      if (vision._parseError) log(`     ⚠ JSON 解析失敗,原文: ${vision._parseError}`);
      const scorePass = vision.score != null && vision.score >= VISION_PASS_SCORE;
      if (vision.pass || scorePass) { log(`  ✅ 視覺通過(${vision.pass ? 'model pass' : `score≥${VISION_PASS_SCORE}`})`); break; }
      if (visionFixRounds >= MAX_VISION_FIX_ROUNDS) { log(`  ⛔ 視覺修正輪數用罄(已記錄最終評分 ${vision.score ?? '?'})`); break; }
      visionFixRounds++;
      vision.issues.forEach((i) => log(`     · ${i}`));
      // 回灌:文字 issues + 渲染圖(讓 agent「看到」自己的成品再改)
      feedbackParts = [
        { text: `幾何 QA 已過,但收尾視覺審稿(score=${vision.score ?? '?'}）認為排版仍不夠專業,請改 deck.py 修正下列問題,再 python deck.py + qa_check:\n- ${vision.issues.join('\n- ')}\n(附上目前渲染圖供你對照)` },
        ...vision.imageParts,
      ];
    }

    // 預算/時間閘
    if (totalIn + totalOut > TOKEN_BUDGET) { log('  ⛔ token 預算用罄,停'); break; }
    if (Date.now() - started > WALL_MS) { log('  ⛔ wall-clock 逾時,停'); break; }
    if (round === MAX_OUTER_ROUNDS - 1 || !feedbackParts) break;

    // 回灌:把本輪對話接進 history(對齊 buildHistory 的 replayTurns 展開法)
    history = [
      ...history,
      { role: 'user', parts: userParts },
      ...(res.toolTurns || []),
      { role: 'model', parts: [{ text: res.text || ' ' }] },
    ];
    userParts = feedbackParts;
  }

  return {
    ok: qa.clean && (!VISION_ENABLED || !vision || vision.pass || (vision.score != null && vision.score >= VISION_PASS_SCORE)),
    pptxPath: qa.producedFile ? path.resolve(ws, pptxName) : null,
    qa,
    vision,
    visionFixRounds,
    tokens: { in: totalIn, out: totalOut, total: totalIn + totalOut },
    toolCalls,
  };
}

module.exports = { runAgentLoop, buildSystemPrompt, outerQa, DEFAULT_MODEL };
